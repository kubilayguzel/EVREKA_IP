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
        // 1) İlk auth durumunu stabil şekilde bekle (kısa süreli null dalgalanmasında zıplamasın)
        const user = await waitForAuthUser({ requireAuth: true, redirectTo: 'index.html', graceMs: 1200 });
        if (!user) return; // redirect başladıysa çık

        // 2) Sonraki gerçek logout durumlarında yönlendir
        redirectOnLogout('index.html', 1200);

        await loadSharedLayout({ activeMenuLink: 'portfolio.html' });
        this.renderer.showLoading(true);

        // --- YENİ: URL'den Tab Bilgisini Okuma ve Ayarlama ---
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
        // -----------------------------------------------------

        try {
            await Promise.all([
                this.dataManager.loadTransactionTypes(),
                this.dataManager.loadPersons(),
                this.dataManager.loadCountries()
            ]);

            this.unsubscribe = this.dataManager.startListening(() => {
                console.log("🔄 Veritabanında değişim algılandı, tablo güncelleniyor...");
                this.render();
            });

            this.setupPagination();
            this.setupEventListeners();
            this.setupFilterListeners();
            this.setupImageHover();
        } catch (e) {
            console.error('Init hatası:', e);
        } finally {
            this.renderer.showLoading(false);
        }
    }


    // --- GÖRSEL HOVER MANTIĞI (BAĞIMSIZ POPUP) ---

    setupImageHover() {
        console.log('Setup image hover calisti');
        
        let previewEl = document.getElementById('floating-preview');
        if (!previewEl) {
            previewEl = document.createElement('img');
            previewEl.id = 'floating-preview';
            previewEl.className = 'floating-trademark-preview';
            document.body.appendChild(previewEl);
        }

        const tableBody = document.getElementById('portfolioTableBody');
        if (!tableBody) {
            console.error('portfolioTableBody bulunamadi');
            return;
        }
        
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
    
    positionPreview(e, element) {
        const offset = 20;
        let left = e.clientX + offset;
        let top = e.clientY + offset;

        const rect = element.getBoundingClientRect();
        if (left + rect.width > window.innerWidth) {
            left = e.clientX - rect.width - offset;
        }
        if (top + rect.height > window.innerHeight) {
            top = e.clientY - rect.height - offset;
        }

        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
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

        document.getElementById('exportExcelBtn')?.addEventListener('click', () => this.handleExport('excel'));
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
                     if (this.state.activeTab === 'litigation') window.location.href = `suit-detail.html?id=${id}`;
                     else window.location.href = `data-entry.html?id=${id}`;
                }
            }
        });
    }

    getCurrentPageRecords() {
        let filtered = this.dataManager.filterRecords(this.state.activeTab, this.state.searchQuery, this.state.columnFilters);
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
        let filtered = this.dataManager.filterRecords(this.state.activeTab, this.state.searchQuery, this.state.columnFilters);
        filtered = this.dataManager.sortRecords(filtered, this.state.sort.column, this.state.sort.direction);
        if (filtered.length === 0) { showNotification('Dışa aktarılacak veri yok.', 'warning'); return; }

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
        } catch (e) { console.error(e); showNotification('Dışa aktarma hatası.', 'error'); }
        finally { this.renderer.showLoading(false); }
    }

    render() {
        const cols = this.getColumnsForTab(this.state.activeTab);
        this.renderer.renderHeaders(cols, this.state.columnFilters);

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
        
        // itemsPerPage değerine erişim (Pagination sınıfından veya sabit)
        const itemsPerPage = 20; 
        
        pageData.forEach((item, index) => {
            // Global sıra numarasını hesapla: (SayfaSayısı - 1) * SayfaBaşınaKayıt + MevcutIndex + 1
            const globalIndex = ((this.state.currentPage - 1) * itemsPerPage) + index + 1;

            if (this.state.activeTab === 'objections') {
                const tr = this.renderer.renderObjectionRow(item, item.hasChildren, item.isChild);
                if (item.isChild) tr.style.display = 'none';
                frag.appendChild(tr);
            } else if (this.state.activeTab === 'litigation') {
                 // YENİ: globalIndex parametresini gönderiyoruz
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

    // --- KOLON AYARLARI (İSTENİLEN GENİŞLİKLER) ---
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
                { key: 'index', label: '#', width: '50px' }, // En başta Sıra No
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

        // STANDART KOLONLAR
        const columns = [
            { key: 'selection', isCheckbox: true, width: '40px' }, // 1
            { key: 'toggle', width: '40px' }, // 2
            { key: 'portfoyStatus', label: 'Durum', sortable: true, width: '80px' }
        ];

        if (tab !== 'trademark') {
            columns.push({ key: 'type', label: 'Tür', sortable: true, width: '130px' });
        }

        // Başlık
        columns.push({ key: 'title', label: 'Başlık', sortable: true, width: '200px', filterable: true });

        if (tab === 'trademark') {
            // ... (görsel, menşe, ülke kısımları aynı kalıyor) ...
            columns.push({ key: 'brandImage', label: 'Görsel', width: '90px' });
            columns.push({ key: 'origin', label: 'Menşe', sortable: true, width: '140px' });
            columns.push({ key: 'country', label: 'Ülke', sortable: true, width: '130px' });
        }

        columns.push(
            { key: 'applicationNumber', label: 'Başvuru No', sortable: true, width: '140px' },

            // Başvuru Tarihi (Key değişti ve filterable eklendi)
            { key: 'formattedApplicationDate', label: 'Başvuru Tar.', sortable: true, width: '140px', filterable: true, inputType: 'date' },

            // Durum (Key değişti ve filterable eklendi)
            { key: 'statusText', label: 'Başvuru Durumu', sortable: true, width: '130px', filterable: true },

            // Başvuru Sahibi (filterable eklendi)
            { key: 'formattedApplicantName', label: 'Başvuru Sahibi', sortable: true, filterable: true },

            { key: 'actions', label: 'İşlemler', width: '280px' }
        );

        return columns;
    }
}

new PortfolioController();