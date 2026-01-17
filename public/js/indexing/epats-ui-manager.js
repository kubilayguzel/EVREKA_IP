// public/js/indexing/epats-ui-manager.js

import { PersonDataManager } from '../persons/PersonDataManager.js';
import { PortfolioDataManager } from '../portfolio/PortfolioDataManager.js';
import { ipRecordsService } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { Pagination } from '../pagination.js';

export class EpatsUiManager {
    constructor() {
        this.personData = new PersonDataManager();
        this.portfolioData = new PortfolioDataManager();
        this.filteredRecords = [];
        this.selectedRecordIds = new Set();
        this.pagination = null;
        
        // Eklenti İletişim ID'si (Manifest.json'daki ID ile aynı olmalı)
        // Eğer eklenti ID'niz sabitse buraya yazın, değilse window.postMessage kullanacağız.
        this.extensionId = "YOUR_EXTENSION_ID_HERE"; 

        this.init();
    }

    async init() {
        console.log('EpatsUiManager başlatılıyor...');
        await this.loadClients();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Eksik Belgeleri Listele Butonu
        const fetchBtn = document.getElementById('btnFetchMissingDocs');
        if (fetchBtn) {
            fetchBtn.addEventListener('click', () => this.findMissingDocuments());
        }

        // Transferi Başlat Butonu
        const startBtn = document.getElementById('btnStartEpatsTransfer');
        if (startBtn) {
            startBtn.addEventListener('click', () => this.startTransfer());
        }

        // Tümünü Seç Checkbox
        const selectAll = document.getElementById('selectAllEpats');
        if (selectAll) {
            selectAll.addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));
        }
    }

    async loadClients() {
        const select = document.getElementById('epatsClientSelect');
        if (!select) return;

        try {
            const response = await this.personData.fetchPersons();
            if (response.success && Array.isArray(response.data)) {
                // Sadece müvekkil (client) olanları veya hepsini listele
                const clients = response.data.sort((a, b) => a.name.localeCompare(b.name));
                
                select.innerHTML = '<option value="">Müvekkil Seçiniz...</option>' + 
                    clients.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
            }
        } catch (error) {
            console.error('Müvekkil listesi hatası:', error);
            showNotification('Müvekkil listesi yüklenemedi.', 'error');
        }
    }

    async findMissingDocuments() {
        const clientId = document.getElementById('epatsClientSelect').value;
        const ipType = document.getElementById('epatsIpTypeSelect').value;
        const docType = document.getElementById('epatsDocTypeSelect').value; // örn: "tescil_belgesi"

        if (!clientId) {
            showNotification('Lütfen bir müvekkil seçiniz.', 'warning');
            return;
        }

        const btn = document.getElementById('btnFetchMissingDocs');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Taranıyor...';

        try {
            // 1. Portföyü Yükle
            await this.portfolioData.loadInitialData();
            
            // 2. Temel Filtreleme (Sahip + Tür + Status)
            // Status: 'registered' olanları alıyoruz (Tescil belgesi tescillilerde olur)
            const candidates = this.portfolioData.allRecords.filter(r => {
                const isClientMatch = r.applicants && r.applicants.some(app => app.id === clientId);
                const isTypeMatch = r.type === ipType;
                // Status kontrolü: registered, tescilli vb. veritabanındaki değere göre
                const isRegistered = r.status && ['registered', 'tescilli'].includes(r.status.toLowerCase());
                
                return isClientMatch && isTypeMatch && isRegistered;
            });

            console.log(`${candidates.length} adet aday kayıt bulundu. Detaylı tarama yapılıyor...`);

            // 3. Detaylı Tarama (Transaction Kontrolü)
            // Her kaydın işlemlerini çekip, seçilen belge türü var mı bakacağız.
            const missingDocs = [];
            
            // Paralel sorgu limiti (Firestore'u yormamak için)
            const chunkSize = 10;
            for (let i = 0; i < candidates.length; i += chunkSize) {
                const chunk = candidates.slice(i, i + chunkSize);
                const results = await Promise.all(chunk.map(async (record) => {
                    const txResult = await ipRecordsService.getTransactionsForRecord(record.id);
                    if (txResult.success) {
                        // Belge türü kontrolü
                        // Transaction type ID'si veya designation kontrolü yapılabilir.
                        // Şimdilik type üzerinden veya description üzerinden basit kontrol:
                        const hasDocument = txResult.transactions.some(t => {
                            // Type kontrolü (Selectbox value'su ile transaction type ID veya alias eşleşmesi)
                            // Veya documents array içinde documentDesignation kontrolü
                            // Basitlik adına:
                            return t.type === docType || 
                                   (t.description && t.description.toLowerCase().includes('tescil belgesi'));
                        });

                        if (!hasDocument) return record; // Belge yoksa listeye ekle
                    }
                    return null;
                }));
                
                missingDocs.push(...results.filter(r => r !== null));
            }

            this.filteredRecords = missingDocs;
            this.renderTable();
            
            if (missingDocs.length === 0) {
                showNotification('Eksik belgesi olan kayıt bulunamadı.', 'success');
            } else {
                showNotification(`${missingDocs.length} adet eksik belgeli kayıt bulundu.`, 'info');
                document.getElementById('epatsResultsSection').style.display = 'block';
            }

        } catch (error) {
            console.error('Tarama hatası:', error);
            showNotification('Tarama sırasında hata oluştu: ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-search mr-2"></i>Eksik Belgeleri Listele';
        }
    }

    renderTable() {
        // Pagination entegrasyonu
        if (this.pagination) {
            // Varolan pagination'ı güncelle
            this.pagination.data = this.filteredRecords;
            this.pagination.render(); // Varsayımsal metod
        } else {
            // Yeni pagination oluştur (Pagination.js yapınıza göre)
            this.pagination = new Pagination({
                containerId: 'epatsPagination',
                itemsPerPage: 10,
                totalItems: this.filteredRecords.length,
                onPageChange: (pageItems) => {
                    this.renderTableRows(pageItems);
                }
            });
            this.pagination.render(this.filteredRecords);
        }
    }

    renderTableRows(items) {
        const tbody = document.getElementById('epatsResultsBody');
        if (!tbody) return;

        tbody.innerHTML = items.map(r => `
            <tr>
                <td class="text-center">
                    <input type="checkbox" class="epats-row-check" 
                           value="${r.id}" 
                           data-appno="${r.applicationNumber}"
                           ${this.selectedRecordIds.has(r.id) ? 'checked' : ''}
                           onchange="window.epatsUiManager.handleCheck(this)">
                </td>
                <td><span style="font-family:monospace; font-weight:bold;">${r.applicationNumber}</span></td>
                <td>${r.title || '-'}</td>
                <td><span class="badge badge-success">Tescilli</span></td>
            </tr>
        `).join('');
    }

    handleCheck(checkbox) {
        if (checkbox.checked) {
            this.selectedRecordIds.add(checkbox.value);
        } else {
            this.selectedRecordIds.delete(checkbox.value);
        }
        this.updateActionButtons();
    }

    toggleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.epats-row-check');
        checkboxes.forEach(cb => {
            cb.checked = checked;
            if (checked) this.selectedRecordIds.add(cb.value);
            else this.selectedRecordIds.delete(cb.value);
        });
        this.updateActionButtons();
    }

    updateActionButtons() {
        const btn = document.getElementById('btnStartEpatsTransfer');
        const countSpan = document.getElementById('selectedEpatsCount');
        
        if (btn) btn.disabled = this.selectedRecordIds.size === 0;
        if (countSpan) countSpan.textContent = this.selectedRecordIds.size;
    }

    startTransfer() {
        const queue = [];
        // Seçili ID'lerden full data oluştur
        this.selectedRecordIds.forEach(id => {
            const record = this.filteredRecords.find(r => r.id === id);
            if (record) {
                queue.push({
                    appNo: record.applicationNumber,
                    ipId: record.id,
                    docType: document.getElementById('epatsDocTypeSelect').value
                });
            }
        });

        if (queue.length === 0) return;

        // 1. Yöntem: Window Message (Content Script yakalar)
        window.postMessage({
            type: "EPATS_QUEUE_START",
            data: queue
        }, "*");

        // 2. Yöntem: Extension ID varsa direkt mesaj (Daha güvenilir)
        if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
             chrome.runtime.sendMessage(this.extensionId, {
                action: "START_QUEUE",
                queue: queue
            }, (response) => {
                console.log("Extension response:", response);
            });
        }

        showNotification(`${queue.length} adet işlem eklentiye gönderildi. EPATS açılıyor...`, 'success');
        
        // Seçimleri sıfırla
        this.selectedRecordIds.clear();
        this.updateActionButtons();
        // Checkboxları temizle
        document.querySelectorAll('.epats-row-check').forEach(cb => cb.checked = false);
    }
}