// public/js/indexing/portfolio-update-manager.js
// (Eski: indexing-portfolioupdate.js)

import { db, ipRecordsService } from '../../firebase-config.js';
import { doc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { showNotification, STATUSES, debounce } from '../../utils.js';

// Sınıf Adı: PortfolioUpdateManager
export class PortfolioUpdateManager {
    constructor() {
        // Durum (State) Yönetimi
        this.state = {
            selectedRecordId: null,
            recordData: null,
            niceClasses: [],
            bulletins: []
        };

        // DOM Elementlerini Önbellekle
        this.elements = this.cacheElements();
        
        this.init();
    }

    cacheElements() {
        const $ = (id) => document.getElementById(id);
        return {
            searchInput: $('recordSearchInput'),
            searchResults: $('searchResultsContainer'),
            selectedDisplay: $('selectedRecordDisplay'),
            
            // Form Alanları
            registryStatus: $('registry-status'),
            appDate: $('registry-application-date'),
            regNo: $('registry-registration-no'),
            regDate: $('registry-registration-date'),
            renewalDate: $('registry-renewal-date'),
            
            // Butonlar ve Listeler
            btnSaveAll: $('btn-save-all'),
            bulletinList: $('bulletin-list'),
            btnAddBulletin: $('btn-add-bulletin'),
            bulletinNoInput: $('bulletin-no-input'),
            bulletinDateInput: $('bulletin-date-input'),
            niceList: $('nice-list'),
            
            // Konteynerler
            detailsContainer: $('record-details-wrapper') // Tüm detayların olduğu wrapper
        };
    }

    init() {
        this.setupEventListeners();
        this.renderInitialState();
        console.log('✅ PortfolioUpdateManager initialized');
    }

    renderInitialState() {
        if (this.elements.detailsContainer) {
            this.elements.detailsContainer.style.display = 'none';
        }
    }

    setupEventListeners() {
        // 1. Arama Dinleyicisi (Debounce ile)
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', debounce((e) => {
                this.handleSearch(e.target.value);
            }, 300));
        }

        // 2. Arama Sonucu Seçimi (Delegation)
        if (this.elements.searchResults) {
            this.elements.searchResults.addEventListener('click', (e) => {
                const item = e.target.closest('.search-result-item');
                if (item) this.selectRecord(item.dataset.id);
            });
        }

        // 3. Seçimi Kaldırma
        if (this.elements.selectedDisplay) {
            this.elements.selectedDisplay.addEventListener('click', (e) => {
                if (e.target.closest('.remove-selected-item-btn')) {
                    this.clearSelection();
                }
            });
        }

        // 4. Bülten Ekleme
        if (this.elements.btnAddBulletin) {
            this.elements.btnAddBulletin.addEventListener('click', () => this.addBulletin());
        }

        // 5. Kaydetme
        if (this.elements.btnSaveAll) {
            this.elements.btnSaveAll.addEventListener('click', () => this.saveAllChanges());
        }

        // 6. Bülten Silme (Delegation)
        if (this.elements.bulletinList) {
            this.elements.bulletinList.addEventListener('click', (e) => {
                if (e.target.closest('.delete-bulletin-btn')) {
                    const index = e.target.closest('.delete-bulletin-btn').dataset.index;
                    this.removeBulletin(index);
                }
            });
        }
    }

    // --- ARAMA VE SEÇİM ---

    async handleSearch(query) {
        if (!query || query.length < 3) {
            this.elements.searchResults.style.display = 'none';
            return;
        }

        const results = await ipRecordsService.searchRecords(query); // Servis üzerinden arama
        this.renderSearchResults(results);
    }

    renderSearchResults(results) {
        const container = this.elements.searchResults;
        container.innerHTML = '';
        container.style.display = results.length ? 'block' : 'none';

        if (!results.length) return;

        container.innerHTML = results.map(r => `
            <div class="search-result-item" data-id="${r.id}">
                <div class="d-flex align-items-center">
                    ${r.brandImageUrl ? `<img src="${r.brandImageUrl}" class="mini-thumb mr-2">` : ''}
                    <div>
                        <strong>${r.title}</strong>
                        <div class="text-muted small">${r.applicationNumber || 'No: Yok'}</div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async selectRecord(id) {
        this.elements.searchInput.value = '';
        this.elements.searchResults.style.display = 'none';
        
        showNotification('Kayıt yükleniyor...', 'info');

        try {
            const result = await ipRecordsService.getRecordById(id);
            if (!result.success) throw new Error(result.error);

            this.state.recordData = result.data;
            this.state.selectedRecordId = id;
            this.state.bulletins = result.data.bulletins || [];
            this.state.niceClasses = result.data.goodsAndServicesByClass || [];

            this.renderSelectedRecordUI();
            this.populateFormFields();
            
            if (this.elements.detailsContainer) {
                this.elements.detailsContainer.style.display = 'block';
            }

        } catch (error) {
            console.error(error);
            showNotification('Kayıt yüklenemedi', 'error');
        }
    }

    clearSelection() {
        this.state = { selectedRecordId: null, recordData: null, niceClasses: [], bulletins: [] };
        this.elements.selectedDisplay.innerHTML = '';
        this.elements.selectedDisplay.style.display = 'none';
        this.elements.searchInput.style.display = 'block';
        if (this.elements.detailsContainer) this.elements.detailsContainer.style.display = 'none';
    }

    renderSelectedRecordUI() {
        const r = this.state.recordData;
        this.elements.searchInput.style.display = 'none';
        this.elements.selectedDisplay.style.display = 'block';
        this.elements.selectedDisplay.innerHTML = `
            <div class="selected-record-card">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="d-flex align-items-center">
                        ${r.brandImageUrl ? `<img src="${r.brandImageUrl}" class="record-thumb mr-3">` : ''}
                        <div>
                            <h5 class="mb-0">${r.title}</h5>
                            <span class="badge badge-primary">${r.applicationNumber}</span>
                        </div>
                    </div>
                    <button class="btn btn-sm btn-outline-danger remove-selected-item-btn">✕ Seçimi Kaldır</button>
                </div>
            </div>
        `;
    }

    populateFormFields() {
        const r = this.state.recordData;
        
        // 1. Tescil Bilgileri
        if(this.elements.registryStatus) this.elements.registryStatus.value = r.status || '';
        if(this.elements.appDate) this.elements.appDate.value = r.applicationDate || '';
        if(this.elements.regNo) this.elements.regNo.value = r.registrationNumber || '';
        if(this.elements.regDate) this.elements.regDate.value = r.registrationDate || '';
        if(this.elements.renewalDate) this.elements.renewalDate.value = r.renewalDate || '';

        // 2. Bültenler
        this.renderBulletins();

        // 3. Nice Sınıfları
        this.renderNiceClasses();
    }

    // --- BÜLTEN YÖNETİMİ ---

    addBulletin() {
        const no = this.elements.bulletinNoInput.value.trim();
        const date = this.elements.bulletinDateInput.value;

        if (!no || !date) {
            showNotification('Bülten no ve tarihi giriniz', 'warning');
            return;
        }

        this.state.bulletins.push({ bulletinNo: no, bulletinDate: date });
        this.renderBulletins();
        
        // Inputları temizle
        this.elements.bulletinNoInput.value = '';
        this.elements.bulletinDateInput.value = '';
    }

    removeBulletin(index) {
        this.state.bulletins.splice(index, 1);
        this.renderBulletins();
    }

    renderBulletins() {
        if (!this.elements.bulletinList) return;
        
        if (this.state.bulletins.length === 0) {
            this.elements.bulletinList.innerHTML = '<div class="text-muted small">Kayıtlı bülten yok.</div>';
            return;
        }

        this.elements.bulletinList.innerHTML = this.state.bulletins.map((b, i) => `
            <div class="list-group-item d-flex justify-content-between align-items-center p-2">
                <span><strong>No:</strong> ${b.bulletinNo} (${b.bulletinDate})</span>
                <button class="btn btn-sm btn-danger delete-bulletin-btn" data-index="${i}">Sil</button>
            </div>
        `).join('');
    }

    // --- NICE SINIF YÖNETİMİ ---

    renderNiceClasses() {
        if (!this.elements.niceList) return;
        
        // Bu kısım genelde read-only veya basit düzenleme olabilir.
        // Karmaşık editör yerine listeyi gösteriyoruz.
        const classes = this.state.niceClasses;
        if (!classes || classes.length === 0) {
            this.elements.niceList.innerHTML = '<div class="text-muted">Sınıf bilgisi yok.</div>';
            return;
        }

        this.elements.niceList.innerHTML = classes.map(c => `
            <div class="nice-class-item mb-2">
                <div class="font-weight-bold">Sınıf ${c.classNo}</div>
                <div class="small text-muted">${c.items ? c.items.join(', ').substring(0, 100) + '...' : ''}</div>
            </div>
        `).join('');
    }

    // --- KAYDETME ---

    async saveAllChanges() {
        if (!this.state.selectedRecordId) return;

        this.elements.btnSaveAll.disabled = true;
        this.elements.btnSaveAll.textContent = 'Kaydediliyor...';

        try {
            const updates = {
                status: this.elements.registryStatus.value,
                applicationDate: this.elements.appDate.value,
                registrationNumber: this.elements.regNo.value,
                registrationDate: this.elements.regDate.value,
                renewalDate: this.elements.renewalDate.value,
                bulletins: this.state.bulletins,
                // Nice sınıfları sadece görüntülendiği için güncellemeye dahil etmedik,
                // eğer düzenlenebilir yaptıysanız buraya ekleyin:
                // goodsAndServicesByClass: this.state.niceClasses 
                updatedAt: new Date().toISOString()
            };

            const recordRef = doc(db, 'ipRecords', this.state.selectedRecordId);
            await updateDoc(recordRef, updates);

            showNotification('Kayıt başarıyla güncellendi!', 'success');
            
            // UI Güncelle (Reload etmeye gerek yok, state zaten güncel)
            
        } catch (error) {
            console.error('Güncelleme hatası:', error);
            showNotification('Hata oluştu: ' + error.message, 'error');
        } finally {
            this.elements.btnSaveAll.disabled = false;
            this.elements.btnSaveAll.textContent = 'Tüm Değişiklikleri Kaydet';
        }
    }
}

// Sayfa yüklendiğinde başlat
document.addEventListener('DOMContentLoaded', () => {
    // Bu kodun sadece ilgili sayfada çalışması için ID kontrolü
    if (document.getElementById('recordSearchInput')) {
        new PortfolioUpdateManager();
    }
});