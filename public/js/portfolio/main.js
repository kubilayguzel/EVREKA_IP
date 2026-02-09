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
        // --- 1. ANA SEKME (TAB) DEĞİŞİMİ ---
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                // Sınıf temizliği (Aktif sınıfını diğerlerinden kaldır)
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                
                // Tıklanan butonu aktif yap
                const targetBtn = e.target.closest('.tab-button'); // closest ile varsa içindeki span/icon yerine butonu seç
                if(targetBtn) {
                   targetBtn.classList.add('active');
                   this.state.activeTab = targetBtn.dataset.type;
                }

                // MARKALAR sekmesi için ALT MENÜ YÖNETİMİ
                const subMenu = document.getElementById('trademarkSubMenu');
                if (subMenu) {
                    if (this.state.activeTab === 'trademark') {
                        subMenu.style.display = 'flex'; // Marka sekmesindeysek göster
                        this.state.subTab = 'turkpatent'; // Varsayılan olarak TÜRKPATENT seç
                        this.updateSubTabUI(); // UI butonlarını güncelle
                    } else {
                        subMenu.style.display = 'none'; // Diğer sekmelerde gizle
                        this.state.subTab = null; // Alt sekme filtresini temizle
                    }
                }

                // Durumları Sıfırla
                this.state.currentPage = 1;
                this.state.searchQuery = '';
                this.state.columnFilters = {};
                this.state.selectedRecords.clear(); // Seçimleri temizle
                
                // UI Elemanlarını Temizle
                const searchInput = document.getElementById('searchInput');
                if(searchInput) searchInput.value = '';
                
                // Tabloyu Yenile
                this.renderer.clearTable();
                this.render();
            });
        });

        // --- 2. ALT SEKME (SUB-TAB) DEĞİŞİMİ (TÜRKPATENT / YURTDIŞI) ---
        // Bu butonlar HTML'de trademarkSubMenu içinde yer almalı
        const subTabButtons = document.querySelectorAll('#trademarkSubMenu button');
        if (subTabButtons) {
            subTabButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    // UI Güncelle (Diğer butonların aktifliğini kaldır)
                    subTabButtons.forEach(b => b.classList.remove('active'));
                    
                    const clickedBtn = e.target.closest('button');
                    clickedBtn.classList.add('active'); // Tıklananı aktif yap

                    // State Güncelle
                    this.state.subTab = clickedBtn.dataset.sub; // 'turkpatent' veya 'foreign'
                    this.state.currentPage = 1; // İlk sayfaya dön
                    this.state.selectedRecords.clear(); // Seçimleri temizle

                    // Tabloyu Yenile
                    this.render();
                });
            });
        }

        // --- 3. ARAMA KUTUSU ---
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                // Debounce mekanizması (Hızlı yazarken sürekli sorgu atmamak için)
                if (this.searchTimeout) clearTimeout(this.searchTimeout);
                this.searchTimeout = setTimeout(() => {
                    this.state.searchQuery = e.target.value.trim();
                    this.state.currentPage = 1;
                    this.render();
                }, 300); // 300ms bekle
            });
        }

        // --- 4. SAYFALAMA (PAGINATION) ---
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

        // --- 5. FİLTRELERİ TEMİZLE BUTONU ---
        const clearFiltersBtn = document.getElementById('clearFilters');
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => {
                this.state.searchQuery = '';
                this.state.columnFilters = {};
                if(searchInput) searchInput.value = '';
                
                // Kolon filtre inputlarını da temizle (TableManager içinde varsa)
                document.querySelectorAll('.column-filter-input').forEach(input => input.value = '');

                this.render();
            });
        }

        // --- 6. EXCEL'E AKTAR (EXPORT) ---
        const btnExportSelected = document.getElementById('btnExportSelected');
        const btnExportAll = document.getElementById('btnExportAll');

        if (btnExportSelected) {
            btnExportSelected.addEventListener('click', (e) => {
                e.preventDefault(); // Link olduğu için sayfa yenilenmesin
                this.exportToExcel('selected');
            });
        }

        if (btnExportAll) {
            btnExportAll.addEventListener('click', (e) => {
                e.preventDefault();
                this.exportToExcel('all');
            });
        }

        // --- 7. EXCEL İLE VERİ YÜKLEME (IMPORT) ---
        const btnExcelUpload = document.getElementById('btnExcelUpload');
        const fileInput = document.getElementById('fileInput');

        if (btnExcelUpload && fileInput) {
            btnExcelUpload.addEventListener('click', () => {
                fileInput.click(); // Gizli input'u tetikle
            });

            fileInput.addEventListener('change', async (e) => {
                if (e.target.files.length > 0) {
                    const file = e.target.files[0];
                    // Dosya yükleme mantığını burada çağırabilirsiniz
                    // Örn: await this.handleFileUpload(file);
                    console.log("Dosya seçildi:", file.name);
                    
                    // İşlem bitince inputu sıfırla ki aynı dosyayı tekrar seçebilsin
                    fileInput.value = ''; 
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
    
    /**
     * Tabloyu ekrana çizer
     */
    async render() {
        this.renderer.showLoading(true);
        this.renderer.clearTable();

        // 1. Verileri Filtrele ve Sırala
        // subTab (TÜRKPATENT/YURTDIŞI) parametresini de gönderiyoruz
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
        this.updatePaginationUI(totalItems, totalPages);

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
        pageData.forEach(item => {
            const isSelected = this.state.selectedRecords.has(String(item.id));
            
            // Parent Satırı Çiz (Mavi arka plan Renderer içinde halledilecek)
            const tr = this.renderer.renderStandardRow(item, this.state.activeTab === 'trademark', isSelected);
            frag.appendChild(tr);

            // Eğer WIPO/ARIPO Parent ise ve akordeon yapısı gerekiyorsa CHILD'ları hazırla
            if ((item.origin === 'WIPO' || item.origin === 'ARIPO') && item.transactionHierarchy === 'parent') {
                const irNo = item.wipoIR || item.aripoIR;
                if (irNo) {
                    const children = this.dataManager.getWipoChildren(irNo);
                    
                    if (children && children.length > 0) {
                        children.forEach(child => {
                            // Child satırı çiz
                            const childIsSelected = this.state.selectedRecords.has(String(child.id));
                            const childTr = this.renderer.renderStandardRow(child, this.state.activeTab === 'trademark', childIsSelected);
                            
                            // Child satırına özel ayarlar
                            childTr.classList.add('child-row');
                            childTr.dataset.parentId = irNo;
                            childTr.style.display = 'none'; // Başlangıçta gizli
                            childTr.style.backgroundColor = '#ffffff'; // RENK DÜZELTME: Child'lar BEYAZ
                            
                            // Child satırında ok işareti (caret) olmamalı, temizle
                            const toggleCell = childTr.querySelector('.toggle-cell');
                            if(toggleCell) toggleCell.innerHTML = ''; 

                            frag.appendChild(childTr);
                        });
                    }
                }
            }
        });

        document.querySelector('#portfolioTable tbody').appendChild(frag);
        
        // Tooltip'leri etkinleştir (Bootstrap varsa)
        if(typeof $ !== 'undefined' && $.fn.tooltip) {
            $('[data-toggle="tooltip"]').tooltip();
        }

        this.renderer.showLoading(false);
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