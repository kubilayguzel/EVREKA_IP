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

        // 🔥 YENİ: GÜNCELLEMEDEN DÖNÜLDÜYSE ESKİ DURUMU (STATE) YÜKLE
        const savedStateStr = sessionStorage.getItem('portfolioState');
        let restoredState = null;
        if (savedStateStr) {
            try {
                restoredState = JSON.parse(savedStateStr);
                this.state.activeTab = restoredState.activeTab || 'trademark';
                this.state.subTab = restoredState.subTab || 'turkpatent';
                this.state.searchQuery = restoredState.searchQuery || '';
                this.state.columnFilters = restoredState.columnFilters || {};
                this.state.sort = restoredState.sort || { column: 'applicationDate', direction: 'desc' };
                this.state.currentPage = restoredState.currentPage || 1;
                
                // Genel arama kutusunun metnini geri koy
                setTimeout(() => {
                    const searchInput = document.getElementById('searchBar');
                    if (searchInput && this.state.searchQuery) searchInput.value = this.state.searchQuery;
                }, 100);
            } catch (e) { console.error("State parse hatası:", e); }
            sessionStorage.removeItem('portfolioState'); // Sadece bir kere kullan (Tek kullanımlık)
        }

        // 4) Tab Yönetimi (Hafızada yoksa URL'den al)
        if (!restoredState) {
            const urlParams = new URLSearchParams(window.location.search);
            const tabParam = urlParams.get('activeTab');
            if (tabParam && ['all', 'trademark', 'patent', 'design', 'litigation', 'objections'].includes(tabParam)) {
                this.state.activeTab = tabParam;
            }
        }

        // Tab butonlarını görsel olarak aktif yap
        const tabButtons = document.querySelectorAll('.tab-button');
        if (tabButtons.length > 0) {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            const activeBtn = document.querySelector(`.tab-button[data-type="${this.state.activeTab}"]`);
            if (activeBtn) activeBtn.classList.add('active');
        }

        try {
            // Verilerin yüklenmesini BEKLE
            await this.dataManager.loadInitialData({ deferPersons: true });
            await this.dataManager.loadRecords({ type: 'trademark' }); // ✅ sadece marka

            // Ek verileri yükle
            if (this.state.activeTab === 'litigation') {
                await this.dataManager.loadLitigationData();
            } else if (this.state.activeTab === 'objections') {
                await this.dataManager.loadObjectionRows();
            }

            // Pagination'ı kur ve eski sayfayı set et
            this.setupPagination();
            if (this.pagination) {
                this.pagination.currentPage = this.state.currentPage;
            }

            // Header'ları ve filtreleri render et
            const columns = this.getColumns(this.state.activeTab);
            this.renderer.renderHeaders(columns, this.state.columnFilters);
            this.updateSortIcons(); // Sıralama oklarını geri getir

            // Alt menüyü göster (Marka sekmesi aktifse)
            const subMenu = document.getElementById('trademarkSubMenu');
            if (subMenu) {
                if (this.state.activeTab === 'trademark') {
                    subMenu.style.display = 'flex';
                    this.updateSubTabUI(); // Yurt içi / Yurt dışı seçimini geri getir
                } else {
                    subMenu.style.display = 'none';
                }
            }
            
            // Şimdi tabloyu çizebiliriz
            this.render();

            // 5. GÜNCELLENEN KAYDI BUL VE RENKLENDİR
            setTimeout(() => {
                const updatedId = sessionStorage.getItem('updatedRecordId');
                if (updatedId) {
                    this.state.updatedRecordId = updatedId; 
                    // true parametresi: Sayfaya ilk dönüşte ekranı oraya kaydır
                    this.highlightUpdatedRow(updatedId, true); 
                    sessionStorage.removeItem('updatedRecordId'); 
                }
            }, 800);

            // 🔥 YENİ: Başka sekmeden (data-entry) gelen canlı güncellemeleri dinle ve tabloyu yenile
            window.addEventListener('storage', async (e) => {
                if (e.key === 'crossTabUpdatedRecordId' && e.newValue) {
                    this.state.updatedRecordId = e.newValue;
                    
                    // 1. Önbelleği temizle ve aktif sekmenin verisini yeniden yükle
                    this.dataManager.clearCache();
                    if (this.state.activeTab === 'litigation') {
                        await this.dataManager.loadLitigationData();
                    } else if (this.state.activeTab === 'objections') {
                        await this.dataManager.loadObjectionRows();
                    }
                    // Not: 'trademark' ana sekmesi startListening (realtime) ile zaten otomatik güncelleniyor.

                    // 2. Tabloyu yeniden çiz (böylece değişen isimler/tarihler veya eklenen itirazlar anında görünür)
                    this.render();

                    // 3. İlgili satırı bul ve yeşile boya
                    setTimeout(() => {
                        this.highlightUpdatedRow(e.newValue, false);
                    }, 500); 
                    
                    localStorage.removeItem('crossTabUpdatedRecordId');
                }
            });

            // Listener başlat
            this.unsubscribe = this.dataManager.startListening(() => {
                // 🔥 ÇÖZÜM 2: RENDER DEBOUNCE (GECİKTİRİCİ)
                if (this.renderDebounceTimer) clearTimeout(this.renderDebounceTimer);
                this.renderDebounceTimer = setTimeout(() => {
                    this.render();
                }, 300);
            }, { type: 'trademark' }); // <-- Sizin kodunuzdaki özel parametreyi koruduk

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

    // public/js/portfolio/main.js içinde setupEventListeners metodunu bulun ve tamamen bununla değiştirin:

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
                // 🔥 YENİ: Eğer sekme verisi zaten yükleniyorsa çift tıklamayı engelle
                if (this.isTabLoading) return;

                // Sınıf temizliği
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));

                const targetBtn = e.target.closest('.tab-button');
                if (targetBtn) {
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

                // 🔥 YENİ KİLİT SİSTEMİ: Veriler çekilene kadar animasyonu aç ve çizimi kilitle
                this.isTabLoading = true;
                this.renderer.showLoading(true);

                try {
                    if (this.state.activeTab === 'litigation' && this.dataManager.litigationRows.length === 0) {
                        await this.dataManager.loadLitigationData();
                    } else if (this.state.activeTab === 'objections' && this.dataManager.objectionRows.length === 0) {
                        await this.dataManager.loadObjectionRows();
                    }
                } catch (err) {
                    console.error("Sekme verisi yüklenemedi:", err);
                } finally {
                    // İşlem (veya bekleme) bittiğinde kilidi mutlaka kaldır
                    this.isTabLoading = false;
                }

                // Sıfırlama
                this.state.currentPage = 1;
                this.state.searchQuery = '';
                this.state.columnFilters = {};
                this.state.selectedRecords.clear();

                const searchInput = document.getElementById('searchInput');
                if (searchInput) searchInput.value = '';

                // Header'ları güncelle
                const columns = this.getColumns(this.state.activeTab);
                this.renderer.renderHeaders(columns, this.state.columnFilters);

                this.renderer.clearTable();
                
                // Kilit kalktığı için artık güvenle verileri ekrana çizebiliriz
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
        const searchInput = document.getElementById('searchBar');
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
                if (searchInput) searchInput.value = '';
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
                    console.log("Dosya seçildi:", e.target.files[0].name);
                    fileInput.value = '';
                }
            });
        }

        // --- 7. TABLO İÇİ İŞLEMLER (AKORDEON, BUTONLAR, CHECKBOX) ---
        // Değişken ismini portfolioTableBody olarak kullanıyoruz
        const portfolioTableBody = document.getElementById('portfolioTableBody');
        if (portfolioTableBody) {
            // A. CHECKBOX SEÇİMİ (Change eventi)
            portfolioTableBody.addEventListener('change', (e) => {
                if (e.target.classList.contains('record-checkbox')) {
                    const id = e.target.dataset.id;
                    if (e.target.checked) {
                        this.state.selectedRecords.add(String(id));
                    } else {
                        this.state.selectedRecords.delete(String(id));
                    }
                    // KRİTİK: Her seçimde buton durumunu güncelle
                    this.updateActionButtons();
                }
            });

            // B. BUTONLAR VE AKORDEON (Click eventi)
            portfolioTableBody.addEventListener('click', (e) => {
                // AKORDEON
                const caret = e.target.closest('.row-caret') ||
                    (e.target.closest('tr.group-header') && !e.target.closest('button, a, input, .action-btn'));

                if (caret) {
                    this.toggleAccordion(e.target.closest('tr') || caret);
                    return;
                }

                // AKSİYON BUTONLARI
                const btn = e.target.closest('.action-btn');
                if (btn) {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    if (!id) return;

                    if (btn.classList.contains('view-btn')) {
                        if (this.state.activeTab === 'litigation') {
                            window.open(`suit-detail.html?id=${id}`, '_blank');
                        } else {
                            // 🔥 YENİ: Kaydı hafızadan bul ve TP sorgusu mu yoksa detay sayfası mı karar ver
                            const record = this.dataManager.getRecordById(id);
                            if (record) {
                                const isTP = [record.origin, record.source].map(s => (s||'').toUpperCase()).some(s => s.includes('TURKPATENT') || s.includes('TÜRKPATENT'));
                                const appNo = record.applicationNumber;

                                if (isTP && appNo) {
                                    // TÜRKPATENT Menşeli: Doğrudan sorguyu tetikle
                                    if (window.triggerTpQuery) {
                                        window.triggerTpQuery(appNo);
                                    } else {
                                        window.open(`https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(appNo)}`, '_blank');
                                    }
                                } else {
                                    // Diğer Kayıtlar veya Başvuru No Yok: Standart Detay Sayfasını Aç
                                    window.open(`portfolio-detail.html?id=${id}`, '_blank', 'noopener');
                                }
                            } else {
                                // Fallback
                                window.open(`portfolio-detail.html?id=${id}`, '_blank', 'noopener');
                            }
                        }
                    } else if (btn.classList.contains('edit-btn')) {
                        const stateToSave = {
                            activeTab: this.state.activeTab,
                            subTab: this.state.subTab,
                            searchQuery: this.state.searchQuery,
                            columnFilters: this.state.columnFilters,
                            sort: this.state.sort,
                            currentPage: this.state.currentPage
                        };
                        sessionStorage.setItem('portfolioState', JSON.stringify(stateToSave));

                        // 🔥 YENİ UX: Düzenleme ekranını yeni sekmede aç (sayfa sıfırlanmasın diye)
                        if (this.state.activeTab === 'litigation') {
                            window.open(`suit-detail.html?id=${id}`, '_blank');
                        } else {
                            window.open(`data-entry.html?id=${id}`, '_blank');
                        }
                    } else if (btn.classList.contains('delete-btn')) {
                        this.handleDelete(id);
                    }
                }
            });
        }

        // --- 8. TÜMÜNÜ SEÇ (HEADER) ---
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                const checkboxes = document.querySelectorAll('.record-checkbox');

                checkboxes.forEach(cb => {
                    cb.checked = isChecked;
                    const id = cb.dataset.id;
                    if (isChecked) {
                        this.state.selectedRecords.add(String(id));
                    } else {
                        this.state.selectedRecords.delete(String(id));
                    }
                });
                this.updateActionButtons(); // Butonları aktif/pasif yap
            });
        }

        // --- 9. DURUM DEĞİŞTİR (AKTİF/PASİF) ---
        const toggleStatusBtn = document.getElementById('toggleRecordStatusBtn');
        if (toggleStatusBtn) {
            toggleStatusBtn.addEventListener('click', async () => {
                if (this.state.selectedRecords.size === 0) return;

                if (!confirm(`${this.state.selectedRecords.size} kaydın durumunu değiştirmek istiyor musunuz?`)) return;

                try {
                    this.renderer.showLoading(true);
                    const ids = Array.from(this.state.selectedRecords);
                    await this.dataManager.toggleRecordsStatus(ids);

                    showNotification('Kayıtların durumu güncellendi.', 'success');
                    this.state.selectedRecords.clear();
                    const selectAll = document.getElementById('selectAllCheckbox');
                    if (selectAll) selectAll.checked = false;

                    await this.dataManager.loadRecords();
                    this.render();
                    this.updateActionButtons();
                } catch (error) {
                    console.error('Durum değiştirme hatası:', error);
                    showNotification('Hata: ' + error.message, 'error');
                } finally {
                    // Tablo ve filtre başlıkları oluştuktan sonra tarih seçicileri etkinleştir
                    if (window.EvrekaDatePicker) {
                        window.EvrekaDatePicker.refresh(document.querySelector('.portfolio-table thead'));
                    }
                    this.renderer.showLoading(false);
                }
            });
        }

        // --- 10. İZLEMEYE EKLE ---
        const addToMonitoringBtn = document.getElementById('addToMonitoringBtn');
        if (addToMonitoringBtn) {
            addToMonitoringBtn.addEventListener('click', async () => {
                if (this.state.selectedRecords.size === 0) return;

                if (!confirm(`${this.state.selectedRecords.size} kaydı izleme listesine eklemek istiyor musunuz?`)) return;

                try {
                    this.renderer.showLoading(true);
                    let successCount = 0;
                    const ids = Array.from(this.state.selectedRecords);

                    for (const id of ids) {
                        const record = this.dataManager.getRecordById(id);
                        if (!record) continue;

                        // DataManager içinde tanımladığımız yardımcı metodu kullan
                        const monitoringData = this.dataManager.prepareMonitoringData(record);
                        
                        // Servise gönder
                        const result = await monitoringService.addMonitoringItem(monitoringData);
                        if (result.success) successCount++;
                    }

                    showNotification(`${successCount} kayıt izlemeye eklendi.`, 'success');
                    this.state.selectedRecords.clear();
                    const selectAll = document.getElementById('selectAllCheckbox');
                    if (selectAll) selectAll.checked = false;

                    this.render();
                    this.updateActionButtons();
                } catch (error) {
                    console.error('İzleme ekleme hatası:', error);
                    showNotification('Hata: ' + error.message, 'error');
                } finally {
                    this.renderer.showLoading(false);
                }
            });
        }
    }

    // public/js/portfolio/main.js içinde

    updateActionButtons() {
        const count = this.state.selectedRecords.size;
        const hasSelection = count > 0;

        // 1. Aktif/Pasif Butonu (HTML ID: toggleRecordStatusBtn)
        const statusBtn = document.getElementById('toggleRecordStatusBtn');
        if (statusBtn) {
            statusBtn.disabled = !hasSelection;
            // Opsiyonel: Buton metnini güncelle
            statusBtn.textContent = hasSelection ? `Durum Değiştir (${count})` : 'Aktif/Pasif';
        }

        // 2. İzlemeye Ekle Butonu (HTML ID: addToMonitoringBtn)
        const monitorBtn = document.getElementById('addToMonitoringBtn');
        if (monitorBtn) {
            monitorBtn.disabled = !hasSelection;
            monitorBtn.textContent = hasSelection ? `İzlemeye Ekle (${count})` : 'İzlemeye Ekle';
        }
        
        // 3. Varsa diğer butonlar
        const exportSelectedBtn = document.getElementById('btnExportSelected');
        if (exportSelectedBtn) {
            // Dropdown içindeki link olduğu için class ile disable görünümü verilebilir
            if (!hasSelection) exportSelectedBtn.classList.add('disabled');
            else exportSelectedBtn.classList.remove('disabled');
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
            
            // 🔥 YENİ: Önbelleği temizle ve aktif sekmeye göre güncel veriyi çek
            this.dataManager.clearCache();
            if (this.state.activeTab === 'litigation') {
                await this.dataManager.loadLitigationData();
            } else if (this.state.activeTab === 'objections') {
                await this.dataManager.loadObjectionRows();
            } else {
                await this.dataManager.loadRecords();
            }
            
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
        // 🔥 YENİ EKLENDİ: Başka bir sekmenin verisi arka planda yükleniyorsa 
        // erken çizim yapmayı durdur. Bu sayede loading animasyonu asla erken kapanmaz 
        // ve "Kayıt bulunamadı" uyarısı sahte yere gözükmez.
        if (this.isTabLoading) return;
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
                // Önce Parent'ı ekle
                const tr = this.renderer.renderObjectionRow(item, item.children && item.children.length > 0, false);
                frag.appendChild(tr);

                // Sonra altına gizli (display:none) şekilde çocuklarını (Child) ekle
                if (item.children && item.children.length > 0) {
                    item.children.forEach(childItem => {
                        const childTr = this.renderer.renderObjectionRow(childItem, false, true);
                        childTr.style.display = 'none'; // Akordeon kapalı başlar
                        frag.appendChild(childTr);
                    });
                }

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

        // 🔥 YENİ: Tablo yenilense (filtre, sayfalama vs) bile güncellenen kaydı yeşil tut!
        if (this.state.updatedRecordId) {
            // false parametresi: Filtre veya sayfalama yaparken ekranı o kayda doğru zıplatma
            this.highlightUpdatedRow(this.state.updatedRecordId, false);
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
                { key: 'title', label: 'Başlık', sortable: true, width: '200px' },
                { key: 'transactionTypeName', label: 'İşlem Tipi', sortable: true, width: '150px' },
                { key: 'applicationNumber', label: 'Başvuru No', sortable: true, width: '110px' },
                { key: 'applicantName', label: 'Başvuru Sahibi', sortable: true, width: '200px' },
                { key: 'opponent', label: 'Karşı Taraf', sortable: true, width: '200px' },
                { key: 'bulletinDate', label: 'Bülten Tar.', sortable: true, width: '110px' },
                { key: 'bulletinNo', label: 'Bülten No', sortable: true, width: '80px' },
                { key: 'epatsDate', label: 'İşlem Tar.', sortable: true, width: '110px' },
                { key: 'statusText', label: 'Durum', sortable: true, width: '150px' },
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

    highlightUpdatedRow(id, shouldScroll = true) {
        const row = document.querySelector(`tr[data-id="${id}"]`);
        
        console.log("🔍 Satır Aranıyor... ID:", id, "Bulunan:", row); 

        if (row) {
            // 🔥 YENİ: 1. EĞER BU BİR ALT KAYITSA (CHILD), ÖNCE ANASININ AKORDEONUNU AÇ
            if (row.classList.contains('child-row') && row.dataset.parentId) {
                const parentId = row.dataset.parentId;
                const parentRow = document.querySelector(`tr[data-group-id="${parentId}"]`);
                
                // Ana akordeon kapalıysa aç
                if (parentRow && parentRow.getAttribute('aria-expanded') !== 'true') {
                    parentRow.setAttribute('aria-expanded', 'true');
                    
                    // İkonu aşağı bakar hale getir
                    const icon = parentRow.querySelector('.row-caret');
                    if (icon) icon.className = 'fas fa-chevron-down row-caret';
                    
                    // Bu anaya ait tüm alt kayıtları (children) görünür yap
                    const children = document.querySelectorAll(`tr.child-row[data-parent-id="${parentId}"]`);
                    children.forEach(child => child.style.display = 'table-row');
                }
            }

            // 2. SATIRI YEŞİLE BOYA
            row.classList.add('recently-updated');
            
            // 3. EKRANI KAYDIR (Sadece ilk dönüşte yapsın, filtreleme vs. yaparken ekranı zıplatmasın)
            if (shouldScroll) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } else {
            console.warn("⚠️ Satır bulunamadı! Sayfa verisi yüklenmemiş olabilir.");
        }
    }

    /**
     * Excel'e Aktar (Dinamik Sütun ve Ekrana Birebir Uyumlu Versiyon)
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
                if(typeof showNotification === 'function') showNotification('Lütfen en az bir kayıt seçiniz.', 'warning');
                else alert('Lütfen en az bir kayıt seçiniz.');
                return;
            }
            dataToExport = allFilteredData.filter(item => selectedIds.has(String(item.id)));
        } else {
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

            // 3. Veriyi Hiyerarşik Sıraya Sok (Export için Alt Dosyaları Yakala)
            const sortedData = [];
            const processedIds = new Set(); 

            dataToExport.forEach(parent => {
                if (!processedIds.has(String(parent.id))) {
                    sortedData.push(parent);
                    processedIds.add(String(parent.id));

                    // WIPO/ARIPO Child Ekleme
                    if ((parent.origin === 'WIPO' || parent.origin === 'ARIPO') && parent.transactionHierarchy === 'parent') {
                        const irNo = parent.wipoIR || parent.aripoIR;
                        if (irNo) {
                            const children = this.dataManager.getWipoChildren(irNo);
                            children.forEach(child => {
                                if (!processedIds.has(String(child.id))) {
                                    sortedData.push(child);
                                    processedIds.add(String(child.id));
                                }
                            });
                        }
                    }
                    
                    // İtirazlar (Objections) Child Ekleme (Akordeon içindekiler)
                    if (this.state.activeTab === 'objections' && parent.children && parent.children.length > 0) {
                        parent.children.forEach(child => {
                            if (!processedIds.has(String(child.id))) {
                                sortedData.push(child);
                                processedIds.add(String(child.id));
                            }
                        });
                    }
                }
            });

            // 4. Workbook ve Worksheet Oluştur
            const workbook = new window.ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Portföy Listesi');

            // 🔥 YENİ: Ekranda ne görünüyorsa dinamik olarak tam o sütunları alıyoruz!
            const screenColumns = this.getColumns(this.state.activeTab);
            const excludeKeys = ['selection', 'toggle', 'actions', 'documents', 'index']; // Excel'e gitmeyecek olan kontrol butonları
            
            const excelColumns = [];
            let imageColumnIndex = -1; // Görsel sütununun indeksini tutacağız

            screenColumns.forEach((col) => {
                if (!excludeKeys.includes(col.key)) {
                    let colWidth = 20; // Varsayılan Genişlik
                    
                    // Görsellik ayarları
                    if (col.key === 'title') colWidth = 40;
                    if (col.key === 'formattedApplicantName' || col.key === 'applicantName' || col.key === 'opponent' || col.key === 'client') colWidth = 35;
                    if (col.key === 'brandImage') { colWidth = 12; imageColumnIndex = excelColumns.length; }

                    excelColumns.push({
                        header: col.label || 'Sütun',
                        key: col.key,
                        width: colWidth
                    });
                }
            });

            worksheet.columns = excelColumns;

            // Başlık Stili
            const headerRow = worksheet.getRow(1);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
            headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3C72' } };
            headerRow.height = 30;
            headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

            // 5. Satırları İşle ve Veriyi Doldur
            for (let i = 0; i < sortedData.length; i++) {
                const record = sortedData[i];
                const rowData = {};

                // Ekranda görünen alanların (key'lerin) verisini record objesinden otomatik çekiyoruz
                excelColumns.forEach(col => {
                    if (col.key === 'brandImage') {
                        rowData[col.key] = ''; // Görsel için yer tutucu bırak
                    } else {
                        let val = record[col.key];
                        
                        // Ülke kodu (TR) yerine tam adı (TÜRKİYE) yazsın
                        if (col.key === 'country' && record.formattedCountryName) val = record.formattedCountryName;
                        
                        // Array gelirse (sınıflar vb.) virgülle ayırarak string'e çevir
                        if (Array.isArray(val)) val = val.join(', ');

                        rowData[col.key] = (val === null || val === undefined || val === '') ? '-' : val;
                    }
                });

                const row = worksheet.addRow(rowData);

                // Hiyerarşi Görselleştirmesi (Alt satırlar/Çocuklar Excel'de içe girintili olsun)
                if (record.transactionHierarchy === 'child' || record.isChild) {
                    const titleCell = row.getCell('title');
                    if (titleCell) {
                        titleCell.alignment = { indent: 2, vertical: 'middle' };
                        titleCell.font = { italic: true, color: { argb: 'FF555555' } };
                    }
                } else {
                    const titleCell = row.getCell('title');
                    if (titleCell) {
                        titleCell.alignment = { indent: 0, vertical: 'middle', wrapText: true };
                        titleCell.font = { bold: true };
                    }
                }

                // Genel Hücre Hizalamaları
                row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    const colKey = excelColumns[colNumber - 1].key;
                    if (colKey !== 'title' && !colKey.toLowerCase().includes('name') && !colKey.toLowerCase().includes('opponent') && !colKey.toLowerCase().includes('client')) {
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    } else if (!cell.alignment) {
                        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                    }
                });

                // Görsel (Resim) Ekleme İşlemi
                if (imageColumnIndex !== -1 && record.brandImageUrl) {
                    try {
                        const response = await fetch(record.brandImageUrl);
                        if (response.ok) {
                            const buffer = await response.arrayBuffer();
                            let ext = 'png';
                            if (record.brandImageUrl.toLowerCase().includes('.jpg') || record.brandImageUrl.toLowerCase().includes('.jpeg')) ext = 'jpeg';

                            const imageId = workbook.addImage({ buffer: buffer, extension: ext });
                            worksheet.addImage(imageId, {
                                tl: { col: imageColumnIndex, row: i + 1 }, // ExcelJS'de addImage indexleri 0'dan başlar
                                br: { col: imageColumnIndex + 1, row: i + 2 },
                                editAs: 'oneCell'
                            });
                            row.height = 50; 
                        } else { row.height = 30; }
                    } catch (err) { row.height = 30; }
                } else { row.height = 30; }
            }

            // 6. Dosyayı Kaydet
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            
            const dateStr = new Date().toISOString().slice(0,10);
            
            // Sekme ismine göre dosya adını belirle
            const tabNames = { 
                trademark: 'Markalar', 
                patent: 'Patentler', 
                design: 'Tasarimlar', 
                litigation: 'Davalar', 
                objections: 'Itirazlar' 
            };
            const currentTabName = tabNames[this.state.activeTab] || 'Portfoy';
            
            const fileName = type === 'selected' ? `Secili_${currentTabName}_${dateStr}.xlsx` : `Tum_${currentTabName}_${dateStr}.xlsx`;
            
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