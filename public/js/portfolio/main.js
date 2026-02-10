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
        this.ITEMS_PER_PAGE = 50; // EKLENEN SATIR
        
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

            // Header'ları render et
            const columns = this.getColumns(this.state.activeTab);
            this.renderer.renderHeaders(columns, this.state.columnFilters);

            // 1. EĞER HAFIZADA KAYITLI SAYFA VARSA ONU YÜKLE
            const savedPage = sessionStorage.getItem('lastPageNumber');
            if (savedPage) {
                this.state.currentPage = parseInt(savedPage);
                // Pagination bileşeninin iç state'ini de güncelle (Eğer varsa)
                if (this.pagination) this.pagination.currentPage = this.state.currentPage;
                sessionStorage.removeItem('lastPageNumber'); // Tek kullanımlık olsun
            }

            // Alt menüyü göster (Marka sekmesi aktifse)
            const subMenu = document.getElementById('trademarkSubMenu');
            if (subMenu && this.state.activeTab === 'trademark') {
                subMenu.style.display = 'flex';
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
        const container = document.getElementById('paginationContainer');
        if (!container) {
            console.warn('Pagination konteyneri bulunamadı (id="paginationContainer").');
            return;
        }

        // Pagination sınıfını başlat
        this.pagination = new Pagination({
            containerId: 'paginationContainer',
            itemsPerPage: this.ITEMS_PER_PAGE,
            onPageChange: (page) => {
                this.state.currentPage = page;
                this.render(); // Sayfa değişince render'ı tekrar çağır
                this.updateSelectAllCheckbox();
                // Tablo başına kaydır
                document.querySelector('.portfolio-table-container')?.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    updateSortIcons() {
        document.querySelectorAll('.portfolio-table thead th.sortable-header').forEach(th => {
            th.classList.remove('asc', 'desc', 'inactive');
            
            if (th.dataset.column === this.state.sort.column) {
                th.classList.add(this.state.sort.direction);
            } else {
                th.classList.add('inactive');
            }
        });
    }

    setupEventListeners() {
    // --- 0. SIRALAMA (SORTING) ---
            const thead = document.querySelector('.portfolio-table thead');
            if (thead) {
                thead.addEventListener('click', (e) => {
                    const th = e.target.closest('th.sortable-header');
                    if (!th) return;
                    
                    const column = th.dataset.column;
                    if (!column) return;
                    
                    // Sıralama yönünü değiştir
                    if (this.state.sort.column === column) {
                        this.state.sort.direction = this.state.sort.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        this.state.sort.column = column;
                        this.state.sort.direction = 'asc';
                    }
                    
                    // Header ikonlarını güncelle
                    this.updateSortIcons();
                    
                    // Sayfayı yeniden render et
                    this.render();
                });
            }
        // --- 1. ANA SEKME (TAB) DEĞİŞİMİ ---
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                // Sınıf temizliği
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                
                const targetBtn = e.target.closest('.tab-button');
                if(targetBtn) {
                   targetBtn.classList.add('active');
                   this.state.activeTab = targetBtn.dataset.type;
                }

                // Marka alt menü yönetimi
                const subMenu = document.getElementById('trademarkSubMenu');
                if (subMenu) {
                    if (this.state.activeTab === 'trademark') {
                        subMenu.style.display = 'flex';
                        this.state.subTab = 'turkpatent'; // Varsayılan TÜRKPATENT
                        this.updateSubTabUI();
                    } else {
                        subMenu.style.display = 'none';
                        this.state.subTab = null;
                    }
                }

                // Sıfırlama
                this.state.currentPage = 1;
                this.state.searchQuery = '';
                this.state.columnFilters = {};
                this.state.selectedRecords.clear();

                const searchInput = document.getElementById('searchInput');
                if(searchInput) searchInput.value = '';

                // Header'ları güncelle
                const columns = this.getColumns(this.state.activeTab);
                this.renderer.renderHeaders(columns, this.state.columnFilters);

                this.renderer.clearTable();
                this.render();
            });
        });

        // --- 2. ALT SEKME (SUB-TAB) DEĞİŞİMİ ---
        const subTabButtons = document.querySelectorAll('#trademarkSubMenu button');
        if (subTabButtons) {
            subTabButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    subTabButtons.forEach(b => b.classList.remove('active'));
                    const clickedBtn = e.target.closest('button');
                    clickedBtn.classList.add('active');

                    this.state.subTab = clickedBtn.dataset.sub;
                    this.state.currentPage = 1;
                    this.state.selectedRecords.clear();

                    this.render();
                });
            });
        }

        // --- 3. ARAMA KUTUSU ---
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                if (this.searchTimeout) clearTimeout(this.searchTimeout);
                this.searchTimeout = setTimeout(() => {
                    this.state.searchQuery = e.target.value.trim();
                    this.state.currentPage = 1;
                    this.render();
                }, 300);
            });
        }

        // --- 4. SAYFALAMA ---
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (this.state.currentPage > 1) {
                    this.state.currentPage--;
                    this.render();
                }
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                const totalPages = Math.ceil(this.state.filteredData.length / this.ITEMS_PER_PAGE);
                if (this.state.currentPage < totalPages) {
                    this.state.currentPage++;
                    this.render();
                }
            });
        }

        // --- 5. FİLTRELERİ TEMİZLE ---
        const clearFiltersBtn = document.getElementById('clearFilters');
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => {
                this.state.searchQuery = '';
                this.state.columnFilters = {};
                if(searchInput) searchInput.value = '';
                document.querySelectorAll('.column-filter-input').forEach(input => input.value = '');
                this.render();
            });
        }

        // --- 6. EXCEL İŞLEMLERİ (EXPORT & IMPORT) ---
        const btnExportSelected = document.getElementById('btnExportSelected');
        const btnExportAll = document.getElementById('btnExportAll');
        const btnExcelUpload = document.getElementById('btnExcelUpload');
        const fileInput = document.getElementById('fileInput');

        if (btnExportSelected) {
            btnExportSelected.addEventListener('click', (e) => { e.preventDefault(); this.exportToExcel('selected'); });
        }
        if (btnExportAll) {
            btnExportAll.addEventListener('click', (e) => { e.preventDefault(); this.exportToExcel('all'); });
        }
        if (btnExcelUpload && fileInput) {
            btnExcelUpload.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async (e) => {
                 if (e.target.files.length > 0) {
                     // Dosya yükleme işlemleri burada yapılır
                     console.log("Dosya seçildi:", e.target.files[0].name);
                     fileInput.value = ''; 
                 }
            });
        }

        // --- 7. TABLO İÇİ İŞLEMLER (AKORDEON, BUTONLAR, CHECKBOX) ---
        // (EKSİK OLAN VE SORUNU ÇÖZEN KISIM BURASI)
        const tableBody = document.getElementById('portfolioTableBody');
        if (tableBody) {
            tableBody.addEventListener('click', (e) => {
                
                // A. CHECKBOX SEÇİMİ (Event Delegation)
                if (e.target.classList.contains('record-checkbox')) {
                    const id = e.target.dataset.id;
                    if (e.target.checked) {
                        this.state.selectedRecords.add(String(id)); // ID'yi string olarak sakla
                    } else {
                        this.state.selectedRecords.delete(String(id));
                    }
                    return; // İşlem tamam, diğer kontrollere gerek yok
                }

                // B. AKORDEON AÇMA/KAPAMA (Caret veya Grup Başlığına Tıklama)
                // Butonlara veya checkbox'a tıklanmadığından emin ol
                const caret = e.target.closest('.row-caret') || 
                              (e.target.closest('tr.group-header') && !e.target.closest('button, a, input, .action-btn'));
                
                if (caret) {
                    this.toggleAccordion(e.target.closest('tr') || caret);
                    return;
                }

                // C. AKSİYON BUTONLARI (Görüntüle, Düzenle, Sil)
                const btn = e.target.closest('.action-btn');
                if (btn) {
                    e.stopPropagation(); // Satır tıklamasını engelle
                    
                    const id = btn.dataset.id;
                    if (!id) return;

                    if (btn.classList.contains('view-btn')) {
                        // GÖRÜNTÜLE
                        if (this.state.activeTab === 'litigation') {
                            window.location.href = `suit-detail.html?id=${id}`;
                        } else {
                            window.open(`portfolio-detail.html?id=${id}`, '_blank', 'noopener');
                        }
                    } 
                    else if (btn.classList.contains('edit-btn')) {
                        // DÜZENLE
                        sessionStorage.setItem('lastPageNumber', this.state.currentPage);
                        if (this.state.activeTab === 'litigation') {
                            window.location.href = `suit-detail.html?id=${id}`;
                        } else {
                            window.location.href = `data-entry.html?id=${id}`;
                        }
                    } 
                    else if (btn.classList.contains('delete-btn')) {
                        // SİL
                        this.handleDelete(id);
                    }
                }
            });
        }
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

    // Bu fonksiyon main.js dosyasında PortfolioController sınıfı içine eklenmelidir.
    updateSubTabUI() {
        const subBtns = document.querySelectorAll('#trademarkSubMenu button');
        if (subBtns) {
            subBtns.forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.sub === this.state.subTab) {
                    btn.classList.add('active');
                }
            });
        }
    }
    
    /**
 * Tabloyu ekrana çizer
 */
    async render() {
        this.renderer.showLoading(true);
        this.renderer.clearTable();

        // 1. Verileri Filtrele ve Sırala
        let filtered = this.dataManager.filterRecords(
            this.state.activeTab, 
            this.state.searchQuery, 
            this.state.columnFilters,
            this.state.subTab 
        );

        filtered = this.dataManager.sortRecords(filtered, this.state.sort.column, this.state.sort.direction);
        this.state.filteredData = filtered;

        // 2. Sayfalama Hesapla
        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / this.ITEMS_PER_PAGE);

        // Pagination'ı güncelle
        if (this.pagination) {
            this.pagination.update(totalItems);
        }

        if (totalItems === 0) {
            this.renderer.renderEmptyState();
            this.renderer.showLoading(false);
            return;
        }

        // 3. Mevcut Sayfanın Verilerini Al
        const startIndex = (this.state.currentPage - 1) * this.ITEMS_PER_PAGE;
        const endIndex = startIndex + this.ITEMS_PER_PAGE;
        const pageData = filtered.slice(startIndex, endIndex);
        const frag = document.createDocumentFragment();

        // 4. Satırları Oluştur
        pageData.forEach((item, index) => {
            const globalIndex = ((this.state.currentPage - 1) * this.ITEMS_PER_PAGE) + index + 1;

            if (this.state.activeTab === 'objections') {
                const tr = this.renderer.renderObjectionRow(item, item.hasChildren, item.isChild);
                if (item.isChild) tr.style.display = 'none';
                frag.appendChild(tr);

            } else if (this.state.activeTab === 'litigation') {
                if (this.renderer.renderLitigationRow) {
                    frag.appendChild(this.renderer.renderLitigationRow(item, globalIndex));
                }
            } else {
                const isSelected = this.state.selectedRecords.has(String(item.id));
                const tr = this.renderer.renderStandardRow(item, this.state.activeTab === 'trademark', isSelected);
                
                frag.appendChild(tr);

                // Child Kayıtlar (WIPO/ARIPO)
                if ((item.origin === 'WIPO' || item.origin === 'ARIPO') && item.transactionHierarchy === 'parent') {
                    const irNo = item.wipoIR || item.aripoIR;
                    if(irNo) {
                        const children = this.dataManager.getWipoChildren(irNo);
                        children.forEach(child => {
                            const childIsSelected = this.state.selectedRecords.has(String(child.id));
                            const childTr = this.renderer.renderStandardRow(child, this.state.activeTab === 'trademark', childIsSelected);
                            
                            childTr.classList.add('child-row');
                            childTr.dataset.parentId = irNo;
                            childTr.style.display = 'none'; 
                            childTr.style.backgroundColor = '#ffffff'; 
                            
                            const toggleCell = childTr.querySelector('.toggle-cell');
                            if(toggleCell) toggleCell.innerHTML = ''; 
                            
                            frag.appendChild(childTr);
                        });
                    }
                }
            }
        });

        console.log('📦 Fragment child count:', frag.childNodes.length); // DEBUG

        // 5. Fragment'ı DOM'a ekle
        if (this.renderer.tbody) {
            this.renderer.tbody.appendChild(frag);
            console.log('✅ Fragment DOM\'a eklendi, tbody children:', this.renderer.tbody.children.length);
        } else {
            const fallbackBody = document.getElementById('portfolioTableBody');
            if (fallbackBody) {
                fallbackBody.appendChild(frag);
                console.log('✅ Fragment fallback ile eklendi');
            } else {
                console.error('❌ HATA: Tablo gövdesi (tbody) bulunamadı.');
            }
        }
        
        // Tooltip'leri etkinleştir
        if(typeof $ !== 'undefined' && $.fn.tooltip) {
            $('[data-toggle="tooltip"]').tooltip();
        }

        this.renderer.showLoading(false);
        console.log('🏁 RENDER tamamlandı');
    }

    /**
 * Sekmeye göre kolon tanımlarını döndürür
 */
    getColumns(tab) {
        if (tab === 'objections') {
            return [
                { key: 'toggle', width: '40px' },
                { key: 'title', label: 'Başlık', sortable: true, width: '250px' },
                { key: 'transactionType', label: 'İşlem Tipi', sortable: true, width: '150px' },
                { key: 'applicationNumber', label: 'Başvuru No', sortable: true, width: '140px' },
                { key: 'applicantName', label: 'Başvuru Sahibi', sortable: true, width: '200px' },
                { key: 'bulletinDate', label: 'Bülten Tarihi', sortable: true, width: '110px' },
                { key: 'bulletinNo', label: 'Bülten No', sortable: true, width: '80px' },
                { key: 'epatsDate', label: 'İşlem Tar.', sortable: true, width: '110px' },
                { key: 'statusText', label: 'Durum', sortable: true, width: '190px' },
                { key: 'documents', label: 'Evraklar', width: '80px' }
            ];
        } 
        if (tab === 'litigation') {
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
            // Bu satıra 'filterable: true' eklendi:
            { key: 'applicationNumber', label: 'Başvuru No', sortable: true, filterable: true, width: '140px' },
            
            { key: 'formattedApplicationDate', label: 'Başvuru Tar.', sortable: true, width: '140px', filterable: true, inputType: 'date' },
            { key: 'statusText', label: 'Başvuru Durumu', sortable: true, width: '130px', filterable: true },
            { key: 'formattedApplicantName', label: 'Başvuru Sahibi', sortable: true, filterable: true, width: '200px' }, 
            { key: 'formattedNiceClasses', label: 'Nice', sortable: true, width: '140px', filterable: true },
            { key: 'actions', label: 'İşlemler', width: '280px' }
        );

        return columns;
    }

    // Bu fonksiyonu PortfolioController sınıfının içine ekleyin
    updatePaginationUI(totalItems, totalPages) {
        const container = document.getElementById('paginationContainer');
        if (!container) return;

        // 1. Sayfalama HTML'ini Oluştur
        // Not: Butonlara 'prevPage' ve 'nextPage' ID'lerini veriyoruz
        const prevDisabled = this.state.currentPage <= 1 ? 'disabled' : '';
        const nextDisabled = this.state.currentPage >= totalPages ? 'disabled' : '';

        let html = `
            <nav aria-label="Sayfalama">
                <ul class="pagination justify-content-center">
                    <li class="page-item ${prevDisabled}">
                        <button class="page-link" id="prevPage" ${prevDisabled}>&laquo; Önceki</button>
                    </li>
                    <li class="page-item disabled">
                        <span class="page-link" style="background-color: #f8f9fa; color: #333;">
                            Sayfa ${this.state.currentPage} / ${totalPages} (Top. ${totalItems})
                        </span>
                    </li>
                    <li class="page-item ${nextDisabled}">
                        <button class="page-link" id="nextPage" ${nextDisabled}>Sonraki &raquo;</button>
                    </li>
                </ul>
            </nav>
        `;
        
        container.innerHTML = html;

        // 2. Tıklama Olaylarını Tanımla (Event Listeners)
        // Butonlar yeni oluşturulduğu için olayları burada bağlamalıyız
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');

        if (prevBtn) {
            prevBtn.onclick = (e) => {
                e.preventDefault();
                if (this.state.currentPage > 1) {
                    this.state.currentPage--;
                    this.render(); // Tabloyu yenile
                    // Sayfanın en üstüne veya tablo başına kaydır
                    document.querySelector('.portfolio-table-container')?.scrollIntoView({ behavior: 'smooth' });
                }
            };
        }

        if (nextBtn) {
            nextBtn.onclick = (e) => {
                e.preventDefault();
                if (this.state.currentPage < totalPages) {
                    this.state.currentPage++;
                    this.render(); // Tabloyu yenile
                    document.querySelector('.portfolio-table-container')?.scrollIntoView({ behavior: 'smooth' });
                }
            };
        }
    }

    /**
     * Excel'e Aktar (Seçili veya Tümü)
     */
    async exportToExcel(type) {
        // 1. Veriyi Hazırla (Mevcut filtre, sıralama ve alt sekme durumuna göre)
        let allFilteredData = this.dataManager.filterRecords(
            this.state.activeTab, 
            this.state.searchQuery, 
            this.state.columnFilters,
            this.state.subTab
        );
        allFilteredData = this.dataManager.sortRecords(allFilteredData, this.state.sort.column, this.state.sort.direction);

        let dataToExport = [];

        if (type === 'selected') {
            const selectedIds = this.state.selectedRecords;
            if (!selectedIds || selectedIds.size === 0) {
                // Eğer notification fonksiyonunuz yoksa alert kullanabilirsiniz
                if(typeof showNotification === 'function') showNotification('Lütfen en az bir kayıt seçiniz.', 'warning');
                else alert('Lütfen en az bir kayıt seçiniz.');
                return;
            }
            
            // DÜZELTME: ID Karşılaştırmasında String dönüşümü (Checkbox sorunu çözümü)
            dataToExport = allFilteredData.filter(item => selectedIds.has(String(item.id)));
        } else {
            // Tüm filtrelenmiş listeyi al
            dataToExport = [...allFilteredData];
        }

        if (dataToExport.length === 0) {
            if(typeof showNotification === 'function') showNotification('Aktarılacak veri bulunamadı.', 'warning');
            else alert('Aktarılacak veri bulunamadı.');
            return;
        }

        this.renderer.showLoading(true);

        try {
            // 2. Kütüphaneleri Dinamik Yükle
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

            // 3. Veriyi Hiyerarşik Sıraya Sok (Export için)
            const sortedData = [];
            const processedIds = new Set(); // Çift eklemeyi önlemek için

            dataToExport.forEach(parent => {
                if (!processedIds.has(String(parent.id))) {
                    sortedData.push(parent);
                    processedIds.add(String(parent.id));

                    // Eğer bu bir parent kayıt ise, çocuklarını bul ve hemen altına ekle
                    if ((parent.origin === 'WIPO' || parent.origin === 'ARIPO') && parent.transactionHierarchy === 'parent') {
                        const irNo = parent.wipoIR || parent.aripoIR;
                        if (irNo) {
                            // Ekranda filtreli olsa bile child kayıtlarını veritabanından/cache'ten çek
                            const children = this.dataManager.getWipoChildren(irNo);
                            
                            children.forEach(child => {
                                // Eğer çocuk daha önce eklenmediyse ekle
                                if (!processedIds.has(String(child.id))) {
                                    sortedData.push(child);
                                    processedIds.add(String(child.id));
                                }
                            });
                        }
                    }
                }
            });

            // 4. Workbook ve Worksheet Oluştur
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

                // Veri Formatlama
                let applicantStr = '';
                if (record.applicants && Array.isArray(record.applicants)) {
                    applicantStr = record.applicants.map(a => a.name).join(', ');
                } else if (record.applicantName) {
                    applicantStr = record.applicantName;
                }

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

                // Hiyerarşi Görselleştirmesi
                if (record.transactionHierarchy === 'child') {
                    row.getCell('title').alignment = { indent: 2, vertical: 'middle' };
                    row.getCell('title').font = { italic: true, color: { argb: 'FF555555' } };
                } else {
                    row.getCell('title').alignment = { indent: 0, vertical: 'middle', wrapText: true };
                    row.font = { bold: true };
                }

                // Hücre Hizalamaları
                ['logo', 'appNo', 'regNo', 'countryName', 'status', 'appDate', 'regDate'].forEach(key => {
                   if(key !== 'logo') row.getCell(key).alignment = { vertical: 'middle', horizontal: 'center' };
                });
                row.getCell('applicant').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

                // Resim Ekleme
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

            // İndirme İşlemi
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            
            const dateStr = new Date().toISOString().slice(0,10);
            const fileName = type === 'selected' ? `Secili_Portfoy_${dateStr}.xlsx` : `Tum_Portfoy_${dateStr}.xlsx`;
            
            window.saveAs(blob, fileName);
            
        } catch (error) {
            console.error('Excel hatası:', error);
            if(typeof showNotification === 'function') showNotification('Excel oluşturulurken bir hata oluştu.', 'error');
            else alert('Hata oluştu.');
        } finally {
            this.renderer.showLoading(false);
        }
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
            // Bu satıra 'filterable: true' eklendi:
            { key: 'applicationNumber', label: 'Başvuru No', sortable: true, filterable: true, width: '140px' },
            
            { key: 'formattedApplicationDate', label: 'Başvuru Tar.', sortable: true, width: '140px', filterable: true, inputType: 'date' },
            { key: 'statusText', label: 'Başvuru Durumu', sortable: true, width: '130px', filterable: true },
            { key: 'formattedApplicantName', label: 'Başvuru Sahibi', sortable: true, filterable: true, width: '200px' }, 
            { key: 'formattedNiceClasses', label: 'Nice', sortable: true, width: '140px', filterable: true },
            { key: 'actions', label: 'İşlemler', width: '280px' }
        );

        return columns;
    }
    /**
     * Excel'e Aktar (Seçili veya Tümü)
     */
    async exportToExcel(type) {
        // 1. Veriyi Hazırla (Mevcut filtre, sıralama ve alt sekme durumuna göre)
        let allFilteredData = this.dataManager.filterRecords(
            this.state.activeTab, 
            this.state.searchQuery, 
            this.state.columnFilters,
            this.state.subTab
        );
        allFilteredData = this.dataManager.sortRecords(allFilteredData, this.state.sort.column, this.state.sort.direction);

        let dataToExport = [];

        if (type === 'selected') {
            const selectedIds = this.state.selectedRecords;
            if (!selectedIds || selectedIds.size === 0) {
                // Eğer notification fonksiyonunuz yoksa alert kullanabilirsiniz
                if(typeof showNotification === 'function') showNotification('Lütfen en az bir kayıt seçiniz.', 'warning');
                else alert('Lütfen en az bir kayıt seçiniz.');
                return;
            }
            
            // DÜZELTME: ID Karşılaştırmasında String dönüşümü (Checkbox sorunu çözümü)
            dataToExport = allFilteredData.filter(item => selectedIds.has(String(item.id)));
        } else {
            // Tüm filtrelenmiş listeyi al
            dataToExport = [...allFilteredData];
        }

        if (dataToExport.length === 0) {
            if(typeof showNotification === 'function') showNotification('Aktarılacak veri bulunamadı.', 'warning');
            else alert('Aktarılacak veri bulunamadı.');
            return;
        }

        this.renderer.showLoading(true);

        try {
            // 2. Kütüphaneleri Dinamik Yükle
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

            // 3. Veriyi Hiyerarşik Sıraya Sok (Export için)
            const sortedData = [];
            const processedIds = new Set(); // Çift eklemeyi önlemek için

            dataToExport.forEach(parent => {
                if (!processedIds.has(String(parent.id))) {
                    sortedData.push(parent);
                    processedIds.add(String(parent.id));

                    // Eğer bu bir parent kayıt ise, çocuklarını bul ve hemen altına ekle
                    if ((parent.origin === 'WIPO' || parent.origin === 'ARIPO') && parent.transactionHierarchy === 'parent') {
                        const irNo = parent.wipoIR || parent.aripoIR;
                        if (irNo) {
                            // Ekranda filtreli olsa bile child kayıtlarını veritabanından/cache'ten çek
                            const children = this.dataManager.getWipoChildren(irNo);
                            
                            children.forEach(child => {
                                // Eğer çocuk daha önce eklenmediyse ekle
                                if (!processedIds.has(String(child.id))) {
                                    sortedData.push(child);
                                    processedIds.add(String(child.id));
                                }
                            });
                        }
                    }
                }
            });

            // 4. Workbook ve Worksheet Oluştur
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

                // Veri Formatlama
                let applicantStr = '';
                if (record.applicants && Array.isArray(record.applicants)) {
                    applicantStr = record.applicants.map(a => a.name).join(', ');
                } else if (record.applicantName) {
                    applicantStr = record.applicantName;
                }

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

                // Hiyerarşi Görselleştirmesi
                if (record.transactionHierarchy === 'child') {
                    row.getCell('title').alignment = { indent: 2, vertical: 'middle' };
                    row.getCell('title').font = { italic: true, color: { argb: 'FF555555' } };
                } else {
                    row.getCell('title').alignment = { indent: 0, vertical: 'middle', wrapText: true };
                    row.font = { bold: true };
                }

                // Hücre Hizalamaları
                ['logo', 'appNo', 'regNo', 'countryName', 'status', 'appDate', 'regDate'].forEach(key => {
                   if(key !== 'logo') row.getCell(key).alignment = { vertical: 'middle', horizontal: 'center' };
                });
                row.getCell('applicant').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

                // Resim Ekleme
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

            // İndirme İşlemi
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            
            const dateStr = new Date().toISOString().slice(0,10);
            const fileName = type === 'selected' ? `Secili_Portfoy_${dateStr}.xlsx` : `Tum_Portfoy_${dateStr}.xlsx`;
            
            window.saveAs(blob, fileName);
            
        } catch (error) {
            console.error('Excel hatası:', error);
            if(typeof showNotification === 'function') showNotification('Excel oluşturulurken bir hata oluştu.', 'error');
            else alert('Hata oluştu.');
        } finally {
            this.renderer.showLoading(false);
        }
    }

}

new PortfolioController();