// public/js/portfolio/main.js
import { PortfolioDataManager } from './PortfolioDataManager.js';
import { PortfolioRenderer } from './PortfolioRenderer.js';
import { auth, monitoringService, waitForAuthUser, redirectOnLogout } from '../../firebase-config.js';
import { loadSharedLayout } from '../layout-loader.js';
import { showNotification } from '../../utils.js';
import Pagination from '../pagination.js';

class PortfolioController {
    constructor() {
        this.dataManager = new PortfolioDataManager();
        this.renderer = new PortfolioRenderer('portfolioTableBody', this.dataManager);
        this.pagination = null;
        
        this.state = {
            activeTab: 'trademark',
            subTab: 'turkpatent',
            searchQuery: '',
            columnFilters: {},
            sort: { column: 'applicationDate', direction: 'desc' },
            currentPage: 1,
            selectedRecords: new Set()
        };
        this.filterDebounceTimer = null;
        this.init();
    }

    async init() {
        // 1) Auth bekle
        const user = await waitForAuthUser({ requireAuth: true, redirectTo: 'index.html', graceMs: 1200 });
        if (!user) return; 

        // 2) Logout yönetimi
        redirectOnLogout('index.html', 1200);

        // 3) Layout ve Loading Başlat
        await loadSharedLayout({ activeMenuLink: 'portfolio.html' });
        this.renderer.showLoading(true);

        // 4) Tab Yönetimi (URL'den)
        const urlParams = new URLSearchParams(window.location.search);
        const tabParam = urlParams.get('activeTab');
        if (tabParam && ['all', 'trademark', 'patent', 'design', 'litigation', 'objections'].includes(tabParam)) {
            this.state.activeTab = tabParam;
            const tabButtons = document.querySelectorAll('.tab-button');
            if (tabButtons.length > 0) {
                tabButtons.forEach(btn => btn.classList.remove('active'));
                const activeBtn = document.querySelector(`.tab-button[data-type="${tabParam}"]`);
                if (activeBtn) activeBtn.classList.add('active');
            }
        }

        try {
            // Verilerin yüklenmesini BEKLE
            await this.dataManager.loadInitialData();

            // Ek verileri yükle
            if (this.state.activeTab === 'litigation') {
                await this.dataManager.loadLitigationData();
            } else if (this.state.activeTab === 'objections') {
                await this.dataManager.loadObjectionRows();
            }

            // DÜZELTME BURADA: Pagination'ı render'dan ÖNCE kurmalıyız
            this.setupPagination(); 

            // 1. EĞER HAFIZADA KAYITLI SAYFA VARSA ONU YÜKLE
            const savedPage = sessionStorage.getItem('lastPageNumber');
            if (savedPage) {
                this.state.currentPage = parseInt(savedPage);
                // Pagination bileşeninin iç state'ini de güncelle (Eğer varsa)
                if (this.pagination) this.pagination.currentPage = this.state.currentPage;
                sessionStorage.removeItem('lastPageNumber'); // Tek kullanımlık olsun
            }

            // Şimdi tabloyu çizebiliriz
            this.render();

            // 2. GÜNCELLENEN KAYDI BUL VE RENKLENDİR (Render'dan sonra çalışmalı)
            setTimeout(() => {
                const updatedId = sessionStorage.getItem('updatedRecordId');
                if (updatedId) {
                    this.highlightUpdatedRow(updatedId);
                    sessionStorage.removeItem('updatedRecordId'); // Tekrar yanmasın
                }
            }, 800); // Tablo çizimi için yarım saniye pay bırakıyoruz

            // Listener başlat
            this.unsubscribe = this.dataManager.startListening(() => {
                console.log("🔄 Veritabanında değişim algılandı, tablo güncelleniyor...");
                this.render();
            });

            this.setupEventListeners();
            this.setupFilterListeners();
            this.setupImageHover();

        } catch (e) {
            console.error('Init hatası:', e);
            showNotification('Veriler yüklenirken hata oluştu', 'error');
        } finally {
            this.renderer.showLoading(false);
        }
    }

    // --- GÖRSEL HOVER MANTIĞI ---
    setupImageHover() {
        let previewEl = document.getElementById('floating-preview');
        if (!previewEl) {
            previewEl = document.createElement('img');
            previewEl.id = 'floating-preview';
            previewEl.className = 'floating-trademark-preview';
            document.body.appendChild(previewEl);
        }

        const tableBody = document.getElementById('portfolioTableBody');
        if (!tableBody) return;
        
        tableBody.addEventListener('mouseover', (e) => {
            if (e.target.classList.contains('trademark-image-thumbnail')) {
                const src = e.target.src;
                if (src && src.length > 10) {
                    previewEl.src = src;
                    const rect = e.target.getBoundingClientRect();
                    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                    const leftPos = rect.right + 15;
                    const topPos = rect.top + scrollTop - 50;
                    previewEl.style.left = leftPos + 'px';
                    previewEl.style.top = topPos + 'px';
                    previewEl.style.display = 'block';
                    previewEl.style.opacity = '1';
                }
            }
        });
        
        tableBody.addEventListener('mouseout', (e) => {
            if (e.target.classList.contains('trademark-image-thumbnail')) {
                previewEl.style.display = 'none';
                previewEl.style.opacity = '0';
            }
        });
    }
    
    setupFilterListeners() {
        const thead = document.querySelector('.portfolio-table thead');
        if (thead) {
            thead.addEventListener('input', (e) => {
                if (e.target.classList.contains('column-filter')) {
                    const key = e.target.dataset.key;
                    const value = e.target.value;
                    clearTimeout(this.filterDebounceTimer);
                    this.filterDebounceTimer = setTimeout(() => {
                        this.state.columnFilters[key] = value;
                        this.state.currentPage = 1;
                        this.render();
                    }, 300);
                }
            });
        }
    }

    setupPagination() {
        this.pagination = new Pagination({
            containerId: 'paginationContainer',
            itemsPerPage: 20,
            onPageChange: (page) => {
                this.state.currentPage = page;
                this.render();
                this.updateSelectAllCheckbox();
            }
        });
    }

    setupEventListeners() {
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                this.state.activeTab = e.target.dataset.type;
                this.state.currentPage = 1;
                this.state.searchQuery = '';
                this.state.columnFilters = {};
                this.state.selectedRecords.clear();
                this.updateBulkActionButtons();
                
                document.getElementById('searchBar').value = '';

                this.renderer.showLoading(true);
                try {
                    if (this.state.activeTab === 'litigation') await this.dataManager.loadLitigationData();
                    else if (this.state.activeTab === 'objections') await this.dataManager.loadObjectionRows();
                } finally {
                    this.renderer.showLoading(false);
                }
                this.render();
            });
        });

        document.getElementById('searchBar').addEventListener('input', (e) => {
            this.state.searchQuery = e.target.value;
            this.state.currentPage = 1;
            this.render();
        });

        document.getElementById('portfolioTableHeaderRow').addEventListener('click', (e) => {
            const th = e.target.closest('.sortable-header');
            if (th) {
                const col = th.dataset.column;
                if (this.state.sort.column === col) {
                    this.state.sort.direction = this.state.sort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    this.state.sort.column = col;
                    this.state.sort.direction = 'asc';
                }
                document.querySelectorAll('.sortable-header').forEach(h => {
                    h.classList.remove('asc', 'desc');
                    if(h.dataset.column === col) h.classList.add(this.state.sort.direction);
                });
                this.render();
            }
        });

        const selectAllCb = document.getElementById('selectAllCheckbox');
        if (selectAllCb) {
            selectAllCb.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                const currentRecords = this.getCurrentPageRecords();
                currentRecords.forEach(r => {
                    if (isChecked) this.state.selectedRecords.add(r.id);
                    else this.state.selectedRecords.delete(r.id);
                });
                this.render();
                this.updateBulkActionButtons();
            });
        }

        document.getElementById('portfolioTableBody').addEventListener('change', (e) => {
            if (e.target.classList.contains('record-checkbox')) {
                const id = e.target.dataset.id;
                if (e.target.checked) this.state.selectedRecords.add(id);
                else this.state.selectedRecords.delete(id);
                this.updateBulkActionButtons();
            }
        });

        document.getElementById('toggleRecordStatusBtn')?.addEventListener('click', () => this.handleBulkStatusChange());
        document.getElementById('addToMonitoringBtn')?.addEventListener('click', () => this.handleBulkMonitoring());

        const btnExportSelected = document.getElementById('btnExportSelected');
        if (btnExportSelected) {
            btnExportSelected.addEventListener('click', (e) => {
                e.preventDefault();
                this.exportToExcel('selected');
            });
        }

        const btnExportAll = document.getElementById('btnExportAll');
        if (btnExportAll) {
            btnExportAll.addEventListener('click', (e) => {
                e.preventDefault();
                this.exportToExcel('all');
            });
        }
        document.getElementById('exportPdfBtn')?.addEventListener('click', () => this.handleExport('pdf'));

        document.getElementById('portfolioTableBody').addEventListener('click', (e) => {
            const caret = e.target.closest('.row-caret') || (e.target.closest('tr.group-header') && !e.target.closest('button, a, input'));
            if (caret) this.toggleAccordion(caret);

            const btn = e.target.closest('.action-btn');
            if (btn) {
                const id = btn.dataset.id;
                if (btn.classList.contains('view-btn')) {
                    if (this.state.activeTab === 'litigation') window.location.href = `suit-detail.html?id=${id}`;
                    else window.open(`portfolio-detail.html?id=${id}`, '_blank', 'noopener');
                } else if (btn.classList.contains('delete-btn')) {
                    this.handleDelete(id);
                } else if (btn.classList.contains('edit-btn')) {
                    sessionStorage.setItem('lastPageNumber', this.state.currentPage);
                    if (this.state.activeTab === 'litigation') window.location.href = `suit-detail.html?id=${id}`;
                    else window.location.href = `data-entry.html?id=${id}`;
                }
            }
        });
    }

    getCurrentPageRecords() {
        let filtered = this.dataManager.filterRecords(this.state.activeTab, this.state.searchQuery, this.state.columnFilters,this.state.subTab);
        filtered = this.dataManager.sortRecords(filtered, this.state.sort.column, this.state.sort.direction);
        return this.pagination.getCurrentPageData(filtered);
    }

    updateSelectAllCheckbox() {
        const selectAllCb = document.getElementById('selectAllCheckbox');
        if (!selectAllCb) return;
        const pageRecords = this.getCurrentPageRecords();
        if (pageRecords.length === 0) { selectAllCb.checked = false; return; }
        selectAllCb.checked = pageRecords.every(r => this.state.selectedRecords.has(r.id));
    }

    updateBulkActionButtons() {
        const count = this.state.selectedRecords.size;
        const statusBtn = document.getElementById('toggleRecordStatusBtn');
        const monitorBtn = document.getElementById('addToMonitoringBtn');
        if (statusBtn) {
            statusBtn.disabled = count === 0;
            statusBtn.textContent = count > 0 ? `Durum Değiştir (${count})` : 'Aktif/Pasif';
        }
        if (monitorBtn) {
            monitorBtn.disabled = count === 0;
            monitorBtn.textContent = count > 0 ? `İzlemeye Ekle (${count})` : 'İzlemeye Ekle';
        }
    }

    toggleAccordion(target) {
        const tr = target.closest('tr');
        if (tr && tr.dataset.groupId) {
            const groupId = tr.dataset.groupId;
            const isExpanded = tr.getAttribute('aria-expanded') === 'true';
            tr.setAttribute('aria-expanded', !isExpanded);
            const icon = tr.querySelector('.row-caret');
            if(icon) icon.className = !isExpanded ? 'fas fa-chevron-down row-caret' : 'fas fa-chevron-right row-caret';
            const children = document.querySelectorAll(`tr.child-row[data-parent-id="${groupId}"]`);
            children.forEach(child => child.style.display = !isExpanded ? 'table-row' : 'none');
        }
    }

    async handleBulkStatusChange() {
        if (this.state.selectedRecords.size === 0) return;
        if (!confirm(`${this.state.selectedRecords.size} kaydın durumu değiştirilecek. Emin misiniz?`)) return;
        try {
            this.renderer.showLoading(true);
            await this.dataManager.toggleRecordsStatus(Array.from(this.state.selectedRecords));
            showNotification('Kayıtların durumu güncellendi.', 'success');
            this.state.selectedRecords.clear();
            this.updateBulkActionButtons();
            await this.dataManager.loadRecords(); 
            this.render();
        } catch (e) { showNotification('Hata: ' + e.message, 'error'); } 
        finally { this.renderer.showLoading(false); }
    }

    async handleBulkMonitoring() {
        if (this.state.selectedRecords.size === 0) return;
        try {
            this.renderer.showLoading(true);
            const ids = Array.from(this.state.selectedRecords);
            let successCount = 0;
            for (const id of ids) {
                const record = this.dataManager.getRecordById(id);
                if (!record || record.type !== 'trademark') continue;
                const monitoringData = this.dataManager.prepareMonitoringData(record);
                const res = await monitoringService.addMonitoringItem(monitoringData);
                if (res.success) successCount++;
            }
            showNotification(`${successCount} kayıt izlemeye eklendi.`, 'success');
            this.state.selectedRecords.clear();
            this.updateBulkActionButtons();
            this.render();
        } catch (e) { showNotification('Hata: ' + e.message, 'error'); }
        finally { this.renderer.showLoading(false); }
    }

    async handleDelete(id) {
        if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
        try {
            this.renderer.showLoading(true);
            await this.dataManager.deleteRecord(id);
            showNotification('Kayıt silindi.', 'success');
            await this.dataManager.loadRecords();
            this.render();
        } catch (e) { showNotification('Silme hatası: ' + e.message, 'error'); }
        finally { this.renderer.showLoading(false); }
    }

    async handleExport(type) {
        // 1. Veriyi Hazırla (Mevcut sayfa filtrelerine göre)
        let filtered = this.dataManager.filterRecords(
            this.state.activeTab, 
            this.state.searchQuery, 
            this.state.columnFilters,
            this.state.subTab
        );
        filtered = this.dataManager.sortRecords(filtered, this.state.sort.column, this.state.sort.direction);
        
        if (!filtered || filtered.length === 0) {
            showNotification('Dışa aktarılacak veri bulunamadı.', 'warning');
            return;
        }

        this.renderer.showLoading(true);

        // Yardımcı Fonksiyon: Script Yükleyici
        const loadScript = (src) => {
            return new Promise((resolve, reject) => {
                // Zaten yüklüyse tekrar yükleme
                if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        };

        try {
            if (type === 'excel') {
                // ExcelJS ve FileSaver yükle (CDN üzerinden)
                if (!window.ExcelJS) await loadScript('https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js');
                if (!window.saveAs) await loadScript('https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js');

                // Global nesneleri kullan
                await this.dataManager.exportToExcel(filtered, window.ExcelJS, window.saveAs);
                showNotification('Excel dosyası başarıyla oluşturuldu.', 'success');

            } else if (type === 'pdf') {
                // html2pdf yükle (CDN üzerinden)
                if (!window.html2pdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');

                await this.dataManager.exportToPdf(filtered, window.html2pdf);
                showNotification('PDF dosyası başarıyla oluşturuldu.', 'success');
            }
        } catch (error) {
            console.error('Export hatası:', error);
            showNotification('Dışa aktarma sırasında bir hata oluştu.', 'error');
        } finally {
            this.renderer.showLoading(false);
        }
    }
    
    render() {
        const cols = this.getColumnsForTab(this.state.activeTab);
        this.renderer.renderHeaders(cols, this.state.columnFilters);

        let filtered = this.dataManager.filterRecords(
            this.state.activeTab, 
            this.state.searchQuery, 
            this.state.columnFilters,
            this.state.subTab
        );
        filtered = this.dataManager.sortRecords(filtered, this.state.sort.column, this.state.sort.direction);

        this.pagination.update(filtered.length);
        const pageData = this.pagination.getCurrentPageData(filtered);

        this.renderer.clear();
        const frag = document.createDocumentFragment();
        
        const itemsPerPage = 20; 
        
        pageData.forEach((item, index) => {
            const globalIndex = ((this.state.currentPage - 1) * itemsPerPage) + index + 1;

            if (this.state.activeTab === 'objections') {
                const tr = this.renderer.renderObjectionRow(item, item.hasChildren, item.isChild);
                if (item.isChild) tr.style.display = 'none';
                frag.appendChild(tr);
            } else if (this.state.activeTab === 'litigation') {
                 frag.appendChild(this.renderer.renderLitigationRow(item, globalIndex));
            } else {
                const isSelected = this.state.selectedRecords.has(item.id);
                const tr = this.renderer.renderStandardRow(item, this.state.activeTab === 'trademark', isSelected);
                frag.appendChild(tr);

                if ((item.origin === 'WIPO' || item.origin === 'ARIPO') && item.transactionHierarchy === 'parent') {
                    const irNo = item.wipoIR || item.aripoIR;
                    const children = this.dataManager.getWipoChildren(irNo);
                    children.forEach(child => {
                        const childTr = this.renderer.renderStandardRow(child, this.state.activeTab === 'trademark', false);
                        childTr.classList.add('child-row');
                        childTr.dataset.parentId = irNo;
                        childTr.style.display = 'none';
                        childTr.style.backgroundColor = '#f9f9f9';
                        childTr.querySelector('.toggle-cell').innerHTML = ''; 
                        frag.appendChild(childTr);
                    });
                }
            }
        });
        
        this.renderer.tbody.appendChild(frag);
        this.updateSelectAllCheckbox();
        this.updateBulkActionButtons();
    }

    highlightUpdatedRow(id) {
        const row = document.querySelector(`tr[data-id="${id}"]`);
        
        console.log("🔍 Satır Aranıyor... ID:", id, "Bulunan:", row); // Kontrol için log

        if (row) {
            row.classList.add('recently-updated');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            setTimeout(() => {
                row.classList.remove('recently-updated');
            }, 3000);
        } else {
            console.warn("⚠️ Satır bulunamadı! Sayfa verisi yüklenmemiş olabilir.");
        }
    }

    getColumnsForTab(tab) {
        if(tab === 'objections') {
             return [
                { key: 'toggle', width: '40px' },
                { key: 'transactionTypeName', label: 'İşlem & Konu', sortable: true, width: '200px' },
                { key: 'applicationNumber', label: 'Başvuru No', sortable: true, width: '110px' },
                { key: 'applicantName', label: 'Başvuru Sahibi', sortable: true, width: '210px' },
                { key: 'opponent', label: 'Karşı Taraf', sortable: true, width: '210px' },
                { key: 'bulletinDate', label: 'Bülten Tar.', sortable: true, width: '110px' },
                { key: 'bulletinNo', label: 'Bülten No', sortable: true, width: '80px' },
                { key: 'epatsDate', label: 'İşlem Tar.', sortable: true, width: '110px' },
                { key: 'statusText', label: 'Durum', sortable: true, width: '190px' },
                { key: 'documents', label: 'Evraklar', width: '80px' }
            ];
        } 
        if(tab === 'litigation') {
             return [
                { key: 'index', label: '#', width: '50px' },
                { key: 'title', label: 'Konu Varlık', sortable: true, width: '250px' },
                { key: 'suitType', label: 'Dava Türü', sortable: true, width: '150px' },
                { key: 'caseNo', label: 'Dosya No', sortable: true, width: '120px' },
                { key: 'court', label: 'Mahkeme', sortable: true, width: '180px' },
                { key: 'client', label: 'Müvekkil', sortable: true, width: '150px' },
                { key: 'opposingParty', label: 'Karşı Taraf', sortable: true, width: '150px' },
                { key: 'openedDate', label: 'Açılış Tarihi', sortable: true, width: '110px' },
                { key: 'status', label: 'Durum', sortable: true, width: '120px' }, 
                { key: 'actions', label: 'İşlemler', width: '140px' }
            ];
        }

        const columns = [
            { key: 'selection', isCheckbox: true, width: '40px' },
            { key: 'toggle', width: '40px' }
        ];

        if (tab !== 'trademark') {
            columns.push({ key: 'type', label: 'Tür', sortable: true, width: '130px' });
        }

        columns.push({ key: 'title', label: 'Başlık', sortable: true, width: '200px', filterable: true });

        if (tab === 'trademark') {
            columns.push({ key: 'brandImage', label: 'Görsel', width: '90px' });
            columns.push({ key: 'origin', label: 'Menşe', sortable: true, width: '140px' });
            columns.push({ key: 'country', label: 'Ülke', sortable: true, width: '130px' });
        }

        columns.push(
            { key: 'applicationNumber', label: 'Başvuru No', sortable: true, width: '140px' },
            { key: 'formattedApplicationDate', label: 'Başvuru Tar.', sortable: true, width: '140px', filterable: true, inputType: 'date' },
            { key: 'statusText', label: 'Başvuru Durumu', sortable: true, width: '130px', filterable: true },
            { key: 'formattedApplicantName', label: 'Başvuru Sahibi', sortable: true, filterable: true, width: '200px' }, 
            { key: 'formattedNiceClasses', label: 'Nice', sortable: true, width: '140px', filterable: true },
            { key: 'actions', label: 'İşlemler', width: '280px' }
        );

        return columns;
    }

    /**
     * Gelişmiş Excel Aktarımı (Parent + Child Destekli)
     */
    async exportToExcel(type) {
        // 1. Veriyi Hazırla (Mevcut filtre ve sıralamaya göre - Sadece Parentlar gelir)
        let dataToExport = [];

        // Filtrelenmiş veriyi al (Not: Bu listede child kayıtlar yoktur, sadece parentlar vardır)
        if (type === 'selected') {
            const selectedIds = this.state.selectedRecords; 
            if (!selectedIds || selectedIds.size === 0) {
                showNotification('Lütfen en az bir kayıt seçiniz.', 'warning');
                return;
            }
            // Sadece seçili olanları al
            dataToExport = this.state.filteredData.filter(item => selectedIds.has(item.id));
        } else {
            // Ekranda görünen tüm listeyi al
            dataToExport = [...this.state.filteredData];
        }

        if (dataToExport.length === 0) {
            showNotification('Aktarılacak veri bulunamadı.', 'warning');
            return;
        }

        this.renderer.showLoading(true);

        try {
            // 2. Kütüphaneleri Yükle
            const loadScript = (src) => {
                return new Promise((resolve, reject) => {
                    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
                    const script = document.createElement('script');
                    script.src = src;
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            };

            if (!window.ExcelJS) await loadScript('https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js');
            if (!window.saveAs) await loadScript('https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js');

            // 3. Veriyi Hiyerarşik Sıraya Sok (Parent -> Children)
            const sortedData = [];
            const processedIds = new Set();
            
            // Parent kayıtlar üzerinde dönüyoruz
            dataToExport.forEach(parent => {
                if (!processedIds.has(parent.id)) {
                    // Parent'ı ekle
                    sortedData.push(parent);
                    processedIds.add(parent.id);

                    // EĞER WIPO/ARIPO ise ve Parent ise, Child kayıtlarını bulup altına ekle
                    if ((parent.origin === 'WIPO' || parent.origin === 'ARIPO') && parent.transactionHierarchy === 'parent') {
                        const irNo = parent.wipoIR || parent.aripoIR;
                        if (irNo) {
                            // DataManager'dan çocukları çek (Ekrandaki filtreden bağımsız olarak tüm çocukları getirir)
                            const children = this.dataManager.getWipoChildren(irNo);
                            
                            if (children && children.length > 0) {
                                // Çocukları da listeye ekle
                                children.forEach(child => {
                                    if (!processedIds.has(child.id)) {
                                        sortedData.push(child);
                                        processedIds.add(child.id);
                                    }
                                });
                            }
                        }
                    }
                }
            });

            // 4. Excel Workbook Oluştur
            const workbook = new window.ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Portföy Listesi');

            // Sütunlar
            worksheet.columns = [
                { header: 'Görsel', key: 'logo', width: 12 },
                { header: 'Marka/Konu Adı', key: 'title', width: 40 },
                { header: 'Başvuru Sahibi', key: 'applicant', width: 35 },
                { header: 'Başvuru No', key: 'appNo', width: 20 },
                { header: 'Tescil No', key: 'regNo', width: 20 },
                { header: 'Ülke', key: 'countryName', width: 20 },
                { header: 'Sınıflar', key: 'classes', width: 15 },
                { header: 'Durum', key: 'status', width: 20 },
                { header: 'Başvuru Tarihi', key: 'appDate', width: 15 },
                { header: 'Tescil Tarihi', key: 'regDate', width: 15 }
            ];

            // Başlık Stili
            const headerRow = worksheet.getRow(1);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
            headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3C72' } };
            headerRow.height = 30;
            headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

            // 5. Satırları İşle
            for (let i = 0; i < sortedData.length; i++) {
                const record = sortedData[i];

                // Başvuru Sahibi
                let applicantStr = '';
                if (record.applicants && Array.isArray(record.applicants)) {
                    applicantStr = record.applicants.map(a => a.name).join(', ');
                } else if (record.applicantName) {
                    applicantStr = record.applicantName;
                }

                // Ülke Adı
                const countryNameStr = this.dataManager.getCountryName(record.country);

                const row = worksheet.addRow({
                    title: record.title || '',
                    applicant: applicantStr,
                    appNo: record.applicationNumber || '',
                    regNo: record.registrationNumber || '',
                    countryName: countryNameStr,
                    classes: Array.isArray(record.niceClasses) ? record.niceClasses.join(', ') : (record.niceClasses || ''),
                    status: record.statusText || record.status || '',
                    appDate: record.applicationDate ? new Date(record.applicationDate).toLocaleDateString('tr-TR') : '',
                    regDate: record.registrationDate ? new Date(record.registrationDate).toLocaleDateString('tr-TR') : ''
                });

                // GÖRSEL HİYERARŞİ: Child kayıtları girintili ve italik yap
                if (record.transactionHierarchy === 'child') {
                    row.getCell('title').alignment = { indent: 2, vertical: 'middle' };
                    row.getCell('title').font = { italic: true, color: { argb: 'FF555555' } }; 
                } else {
                    row.getCell('title').alignment = { indent: 0, vertical: 'middle', wrapText: true };
                    row.font = { bold: true };
                }

                // Diğer Hücre Hizalamaları
                ['logo', 'appNo', 'regNo', 'countryName', 'status', 'appDate', 'regDate'].forEach(key => {
                   if(key !== 'logo') row.getCell(key).alignment = { vertical: 'middle', horizontal: 'center' };
                });
                row.getCell('applicant').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

                // Resim Ekleme (Varsa)
                if (record.brandImageUrl) {
                    try {
                        const response = await fetch(record.brandImageUrl);
                        if (response.ok) {
                            const buffer = await response.arrayBuffer();
                            let ext = 'png';
                            if (record.brandImageUrl.toLowerCase().includes('.jpg') || record.brandImageUrl.toLowerCase().includes('.jpeg')) ext = 'jpeg';

                            const imageId = workbook.addImage({ buffer: buffer, extension: ext });
                            
                            worksheet.addImage(imageId, {
                                tl: { col: 0, row: i + 1 },
                                br: { col: 1, row: i + 2 },
                                editAs: 'oneCell'
                            });
                            row.height = 50; 
                        } else { row.height = 30; }
                    } catch (err) { row.height = 30; }
                } else { row.height = 30; }
            }

            // Dosyayı İndir
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            window.saveAs(blob, `Portfoy_Listesi_${new Date().toISOString().slice(0,10)}.xlsx`);
            
        } catch (error) {
            console.error('Excel oluşturma hatası:', error);
            showNotification('Excel oluşturulurken bir hata oluştu.', 'error');
        } finally {
            this.renderer.showLoading(false);
        }
    }
}

new PortfolioController();