// public/js/portfolio/main.js
import { PortfolioDataManager } from './PortfolioDataManager.js';
import { PortfolioRenderer } from './PortfolioRenderer.js';
import { auth, onAuthStateChanged, monitoringService, ipRecordsService } from '../../firebase-config.js';
import { loadSharedLayout } from '../layout-loader.js';
import { showNotification } from '../../utils.js';
import Pagination from '../pagination.js';

class PortfolioController {
    constructor() {
        this.dataManager = new PortfolioDataManager();
        this.renderer = new PortfolioRenderer('portfolioTableBody', this.dataManager);
        this.pagination = null;
        
        this.state = {
            activeTab: 'all',
            searchQuery: '',
            columnFilters: {},
            sort: { column: 'applicationDate', direction: 'desc' },
            currentPage: 1,
            selectedRecords: new Set() // Seçili kayıtları tutar
        };

        this.init();
    }

    async init() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                await loadSharedLayout({ activeMenuLink: 'portfolio.html' });
                this.renderer.showLoading(true);
                
                try {
                    await this.dataManager.loadInitialData();
                    this.setupPagination();
                    this.setupEventListeners();
                    this.render();
                } catch (e) {
                    console.error('Init hatası:', e);
                } finally {
                    this.renderer.showLoading(false);
                }
            } else {
                window.location.href = 'index.html';
            }
        });
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
        // --- TAB DEĞİŞİMİ ---
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                this.state.activeTab = e.target.dataset.type;
                this.state.currentPage = 1;
                this.state.searchQuery = '';
                this.state.selectedRecords.clear(); // Tab değişince seçimleri sıfırla
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

        // --- ARAMA VE FİLTRELEME ---
        document.getElementById('searchBar').addEventListener('input', (e) => {
            this.state.searchQuery = e.target.value;
            this.state.currentPage = 1;
            this.render();
        });

        document.getElementById('portfolioTableFilterRow').addEventListener('input', (e) => {
            if (e.target.classList.contains('column-filter')) {
                this.state.columnFilters[e.target.dataset.column] = e.target.value;
                this.state.currentPage = 1;
                this.render();
            }
        });

        // --- SIRALAMA ---
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

        // --- SEÇİM VE TOPLU İŞLEMLER ---
        
        // Tümünü Seç
        const selectAllCb = document.getElementById('selectAllCheckbox');
        if (selectAllCb) {
            selectAllCb.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                const currentRecords = this.getCurrentPageRecords();
                currentRecords.forEach(r => {
                    if (isChecked) this.state.selectedRecords.add(r.id);
                    else this.state.selectedRecords.delete(r.id);
                });
                this.render(); // Checkboxları güncellemek için
                this.updateBulkActionButtons();
            });
        }

        // Satır Seçimi (Delegation)
        document.getElementById('portfolioTableBody').addEventListener('change', (e) => {
            if (e.target.classList.contains('record-checkbox')) {
                const id = e.target.dataset.id;
                if (e.target.checked) this.state.selectedRecords.add(id);
                else this.state.selectedRecords.delete(id);
                this.updateBulkActionButtons();
            }
        });

        // Butonlar: Aktif/Pasif, İzleme
        document.getElementById('toggleRecordStatusBtn')?.addEventListener('click', () => this.handleBulkStatusChange());
        document.getElementById('addToMonitoringBtn')?.addEventListener('click', () => this.handleBulkMonitoring());

        // --- DIŞA AKTARMA (EXPORT) ---
        document.getElementById('exportExcelBtn')?.addEventListener('click', () => this.handleExport('excel'));
        document.getElementById('exportPdfBtn')?.addEventListener('click', () => this.handleExport('pdf'));

        // --- TABLO İÇİ AKSİYONLAR ---
        document.getElementById('portfolioTableBody').addEventListener('click', (e) => {
            // Accordion (Caret)
            const caret = e.target.closest('.row-caret') || (e.target.closest('tr.group-header') && !e.target.closest('button, a, input'));
            if (caret) this.toggleAccordion(caret);

            // Butonlar (Görüntüle, Sil)
            const btn = e.target.closest('.action-btn');
            if (btn) {
                const id = btn.dataset.id;
                if (btn.classList.contains('view-btn')) {
                    if (this.state.activeTab === 'litigation') window.location.href = `suit-detail.html?id=${id}`;
                    else window.open(`portfolio-detail.html?id=${id}`, '_blank');
                } else if (btn.classList.contains('delete-btn')) {
                    this.handleDelete(id);
                } else if (btn.classList.contains('edit-btn')) {
                     if (this.state.activeTab === 'litigation') window.location.href = `suit-detail.html?id=${id}`; // Düzenleme detay sayfasında
                     else window.location.href = `data-entry.html?id=${id}`;
                }
            }
        });
    }

    // --- MANTIK VE YARDIMCILAR ---

    getCurrentPageRecords() {
        // O anki filtre ve sayfalama durumuna göre ekrandaki kayıtları döndürür
        let filtered = this.dataManager.filterRecords(this.state.activeTab, this.state.searchQuery, this.state.columnFilters);
        filtered = this.dataManager.sortRecords(filtered, this.state.sort.column, this.state.sort.direction);
        return this.pagination.getCurrentPageData(filtered);
    }

    updateSelectAllCheckbox() {
        const selectAllCb = document.getElementById('selectAllCheckbox');
        if (!selectAllCb) return;
        
        const pageRecords = this.getCurrentPageRecords();
        if (pageRecords.length === 0) {
            selectAllCb.checked = false;
            return;
        }
        // Sayfadaki herkes seçili mi?
        const allSelected = pageRecords.every(r => this.state.selectedRecords.has(r.id));
        selectAllCb.checked = allSelected;
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

    async handleBulkStatusChange() {
        if (this.state.selectedRecords.size === 0) return;
        if (!confirm(`${this.state.selectedRecords.size} kaydın durumu değiştirilecek. Emin misiniz?`)) return;

        const ids = Array.from(this.state.selectedRecords);
        // Basitlik için hepsini toggle ediyoruz (veya seçilenlerin durumuna göre karar verilebilir)
        // Burada dataManager üzerinden servise gidiyoruz
        try {
            this.renderer.showLoading(true);
            await this.dataManager.toggleRecordsStatus(ids);
            showNotification('Kayıtların durumu güncellendi.', 'success');
            this.state.selectedRecords.clear();
            this.updateBulkActionButtons();
            // Veriyi yenile
            await this.dataManager.loadRecords(); 
            this.render();
        } catch (e) {
            showNotification('Hata oluştu: ' + e.message, 'error');
        } finally {
            this.renderer.showLoading(false);
        }
    }

    async handleBulkMonitoring() {
        const ids = Array.from(this.state.selectedRecords);
        if (ids.length === 0) return;

        try {
            this.renderer.showLoading(true);
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
        } catch (e) {
            showNotification('İzlemeye eklerken hata: ' + e.message, 'error');
        } finally {
            this.renderer.showLoading(false);
        }
    }

    async handleDelete(id) {
        if (!confirm('Bu kaydı ve tüm verilerini silmek istediğinize emin misiniz?')) return;
        try {
            this.renderer.showLoading(true);
            await this.dataManager.deleteRecord(id);
            showNotification('Kayıt silindi.', 'success');
            await this.dataManager.loadRecords(); // Listeyi yenile
            this.render();
        } catch (e) {
            showNotification('Silme hatası: ' + e.message, 'error');
        } finally {
            this.renderer.showLoading(false);
        }
    }

    async handleExport(type) {
        // Şu anki filtrelenmiş veriyi al
        let filtered = this.dataManager.filterRecords(this.state.activeTab, this.state.searchQuery, this.state.columnFilters);
        filtered = this.dataManager.sortRecords(filtered, this.state.sort.column, this.state.sort.direction);

        if (filtered.length === 0) {
            showNotification('Dışa aktarılacak veri yok.', 'warning');
            return;
        }

        this.renderer.showLoading(true);
        try {
            if (type === 'excel') {
                const { default: ExcelJS } = await import('../libs/exceljs.min.js');
                const { saveAs } = await import('../libs/FileSaver.min.js');
                await this.dataManager.exportToExcel(filtered, ExcelJS, saveAs);
            } else if (type === 'pdf') {
                const { default: html2pdf } = await import('../libs/html2pdf.bundle.min.js');
                await this.dataManager.exportToPdf(filtered, html2pdf);
            }
        } catch (e) {
            console.error(e);
            showNotification('Dışa aktarma hatası.', 'error');
        } finally {
            this.renderer.showLoading(false);
        }
    }

    toggleAccordion(target) {
        const tr = target.closest('tr');
        if (tr && tr.dataset.groupId) {
            const groupId = tr.dataset.groupId;
            const isExpanded = tr.getAttribute('aria-expanded') === 'true';
            tr.setAttribute('aria-expanded', !isExpanded);
            
            const icon = tr.querySelector('.row-caret');
            if(icon) {
                icon.className = !isExpanded ? 'fas fa-chevron-down row-caret' : 'fas fa-chevron-right row-caret';
            }
            // Child satırları bul ve aç/kapa
            const children = document.querySelectorAll(`tr.child-row[data-parent-id="${groupId}"]`);
            children.forEach(child => child.style.display = !isExpanded ? 'table-row' : 'none');
        }
    }

    render() {
        const cols = this.getColumnsForTab(this.state.activeTab);
        this.renderer.renderHeaders(cols);

        let filtered = this.dataManager.filterRecords(
            this.state.activeTab, 
            this.state.searchQuery, 
            this.state.columnFilters
        );
        filtered = this.dataManager.sortRecords(filtered, this.state.sort.column, this.state.sort.direction);

        this.pagination.update(filtered.length);
        const pageData = this.pagination.getCurrentPageData(filtered);

        this.renderer.clear();
        const frag = document.createDocumentFragment();
        
        pageData.forEach(item => {
            if (this.state.activeTab === 'objections') {
                const tr = this.renderer.renderObjectionRow(item, item.hasChildren, item.isChild);
                if (item.isChild) tr.style.display = 'none';
                frag.appendChild(tr);
            } else if (this.state.activeTab === 'litigation') {
                 frag.appendChild(this.renderer.renderLitigationRow(item));
            } else {
                // Standart satıra seçili olma durumunu da gönderiyoruz
                const isSelected = this.state.selectedRecords.has(item.id);
                frag.appendChild(this.renderer.renderStandardRow(item, this.state.activeTab === 'trademark', isSelected));
            }
        });
        
        this.renderer.tbody.appendChild(frag);
        this.updateSelectAllCheckbox();
        this.updateBulkActionButtons();
    }

    getColumnsForTab(tab) {
        // ... (Eski koddaki gibi kolon tanımları) ...
        const base = [
            { key: 'selection', isCheckbox: true, width: '40px' },
            { key: 'status', label: 'Durum', sortable: true },
            { key: 'title', label: 'Başlık', sortable: true },
            { key: 'applicationNumber', label: 'Başvuru No', sortable: true },
            { key: 'applicationDate', label: 'Başvuru Tar.', sortable: true },
            { key: 'actions', label: 'İşlemler', width: '150px' }
        ];
        if (tab === 'trademark') {
            base.splice(2, 0, { key: 'brandImage', label: 'Görsel' });
            base.splice(4, 0, { key: 'country', label: 'Ülke', sortable: true });
        } else if(tab === 'objections') {
             return [
                { key: 'toggle', width: '40px' },
                { key: 'transactionTypeName', label: 'İşlem', sortable: true },
                { key: 'title', label: 'Konu', sortable: true },
                { key: 'opponent', label: 'Karşı Taraf', sortable: true },
                { key: 'statusText', label: 'Durum', sortable: true },
                { key: 'documents', label: 'Evraklar' }
            ];
        } else if(tab === 'litigation') {
             return [
                { key: 'title', label: 'Konu', sortable: true },
                { key: 'suitType', label: 'Tür', sortable: true },
                { key: 'caseNo', label: 'Dosya No', sortable: true },
                { key: 'court', label: 'Mahkeme', sortable: true },
                { key: 'status', label: 'Durum', sortable: true },
                { key: 'actions', label: 'İşlemler' }
            ];
        }
        return base;
    }
}

new PortfolioController();