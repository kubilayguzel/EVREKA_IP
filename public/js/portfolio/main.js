// public/js/portfolio/main.js
import { PortfolioDataManager } from './PortfolioDataManager.js';
import { PortfolioRenderer } from './PortfolioRenderer.js';
import { auth, monitoringService } from '../../firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"; 
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
            selectedRecords: new Set()
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
                    // YENİ: Görsel Hover Efektini Başlat
                    this.setupImageHover();
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

    // --- GÖRSEL HOVER MANTIĞI (BAĞIMSIZ POPUP) ---
    setupImageHover() {
        let previewEl = document.getElementById('floating-preview');
        if (!previewEl) {
            previewEl = document.createElement('img');
            previewEl.id = 'floating-preview';
            previewEl.className = 'floating-trademark-preview';
            document.body.appendChild(previewEl);
        }

        const tableBody = document.getElementById('portfolioTableBody');
        
        tableBody.addEventListener('mouseover', (e) => {
            if (e.target.classList.contains('trademark-image-thumbnail')) {
                const src = e.target.src;
                if (src) {
                    previewEl.src = src;
                    previewEl.style.display = 'block';
                    this.positionPreview(e, previewEl);
                }
            }
        });

        tableBody.addEventListener('mousemove', (e) => {
            if (previewEl.style.display === 'block') {
                this.positionPreview(e, previewEl);
            }
        });

        tableBody.addEventListener('mouseout', (e) => {
            if (e.target.classList.contains('trademark-image-thumbnail')) {
                previewEl.style.display = 'none';
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
                    else window.open(`portfolio-detail.html?id=${id}`, '_blank');
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
                { key: 'title', label: 'Konu Varlık', sortable: true, width: '220px' },
                { key: 'suitType', label: 'Dava Türü', sortable: true, width: '140px' },
                { key: 'caseNo', label: 'Dosya No', sortable: true, width: '110px' },
                { key: 'court', label: 'Mahkeme', sortable: true, width: '160px' },
                { key: 'client', label: 'Müvekkil', sortable: true, width: '140px' },
                { key: 'opposingParty', label: 'Karşı Taraf', sortable: true, width: '140px' },
                
                // YENİ EKLENEN KOLON
                { key: 'suitStatus', label: 'Durum', sortable: true, width: '130px' },
                
                { key: 'openedDate', label: 'Açılış Tar.', sortable: true, width: '100px' },
                { key: 'actions', label: 'İşlemler', width: '100px' }
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

        // Başlık (200px'e sabitlendi)
        columns.push({ key: 'title', label: 'Başlık', sortable: true, width: '200px' });

        if (tab === 'trademark') {
            columns.push({ key: 'brandImage', label: 'Görsel', width: '90px' }); // Genişletildi: 90px
            columns.push({ key: 'origin', label: 'Menşe', sortable: true, width: '140px' });
            columns.push({ key: 'country', label: 'Ülke', sortable: true, width: '130px' });
        }

        columns.push(
            { key: 'applicationNumber', label: 'Başvuru No', sortable: true, width: '140px' },
            { key: 'applicationDate', label: 'Başvuru Tar.', sortable: true, width: '110px' },
            { key: 'status', label: 'Başvuru Durumu', sortable: true, width: '130px' },
            
            // Başvuru Sahibi: ESNEK (Genişlik yok, kalan tüm alanı kaplayacak)
            { key: 'formattedApplicantName', label: 'Başvuru Sahibi', sortable: true }, 
            
            // İşlemler: Genişletildi
            { key: 'actions', label: 'İşlemler', width: '280px' } // 280px'e çıkarıldı
        );

        return columns;
    }
}

new PortfolioController();