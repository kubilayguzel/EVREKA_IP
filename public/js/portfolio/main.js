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
        try {
            // 1. Yetkilendirme Kontrolü
            const user = await new Promise((resolve) => {
                const unsubscribe = auth.onAuthStateChanged(u => {
                    unsubscribe();
                    resolve(u);
                });
            });

            if (!user) {
                window.location.href = 'index.html';
                return;
            }

            // 2. Kullanıcı Arayüzünü Başlat
            this.updateAuthUI(user);
            
            // Tabloya "Yükleniyor" yazısı koy
            if (this.renderer && this.renderer.tbody) {
                this.renderer.tbody.innerHTML = '<tr><td colspan="10" class="text-center p-4"><div class="spinner-border text-primary" role="status"></div><br>Veriler yükleniyor...</td></tr>';
            }

            console.log("📥 Veriler çekiliyor...");
            
            // 3. VERİLERİ ÇEK VE DEĞİŞKENLERE ATA (Kritik Düzeltme)
            // fetchAllItems: Marka/Patent/Tasarım verisini çeker
            const allItems = await this.dataManager.fetchAllItems();
            this.dataManager.rows = allItems; // <--- İşte eksik olan bağlantı bu!
            
            // loadLitigationData: Dava verilerini çeker
            // (DataManager içinde litigationRows'a kendi atıyor ama yine de çağırmalıyız)
            await this.dataManager.loadLitigationData();
            
            // loadObjectionsData: İtiraz verilerini çeker (Varsa)
            if (this.dataManager.loadObjectionsData) {
                await this.dataManager.loadObjectionsData();
            }

            console.log(`✅ Veriler yüklendi. IP: ${this.dataManager.rows.length}, Dava: ${this.dataManager.litigationRows?.length || 0}`);

            // 4. URL'den Tab Seçimi (Link ile gelindiyse)
            const urlParams = new URLSearchParams(window.location.search);
            const tab = urlParams.get('tab');
            if (tab && ['trademark', 'patent', 'design', 'litigation', 'objections'].includes(tab)) {
                this.state.activeTab = tab;
                // Bootstrap tab'ı aktifleştir
                $(`#portfolioTabs a[href="#${tab}"]`).tab('show');
            }

            // 5. Tabloyu Çiz
            this.render();

        } catch (error) {
            console.error("Başlangıç hatası:", error);
            if (this.renderer && this.renderer.tbody) {
                this.renderer.tbody.innerHTML = '<tr><td colspan="10" class="text-center text-danger p-4">Veri yüklenirken hata oluştu. Lütfen sayfayı yenileyin.</td></tr>';
            }
        }
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

// --- YARDIMCI METOD: Sayfalama ve Sıralama ---
    getPaginatedData() {
        // 1. Veri Kaynağını Belirle
        // Eğer arama/filtreleme yapıldıysa 'filteredData' kullanılır.
        // Yapılmadıysa aktif sekmeye göre ham veri seçilir.
        let data = this.filteredData;

        if (!data) {
            if (this.state.activeTab === 'litigation') {
                data = this.dataManager.litigationRows || [];
            } else if (this.state.activeTab === 'objections') {
                data = this.dataManager.objectionRows || []; 
            } else {
                data = this.dataManager.rows || [];
            }
        }

        // Güvenlik önlemi: Veri yoksa boş dizi dön
        if (!data || !Array.isArray(data)) return [];

        // 2. Sıralama (Sorting)
        const { sortColumn, sortDirection } = this.state;
        
        // Veriyi bozmamak için kopyasını alarak sırala
        let sortedData = [...data];

        if (sortColumn) {
            sortedData.sort((a, b) => {
                let valA = a[sortColumn];
                let valB = b[sortColumn];

                // Null/Undefined kontrolü
                if (valA == null) valA = '';
                if (valB == null) valB = '';

                // String ise küçük harfe çevir (Case insensitive)
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();

                // Tarih Sıralaması (Özel kolonlar için)
                if (['applicationDate', 'openedDate', 'bulletinDate'].includes(sortColumn)) {
                    valA = new Date(a[sortColumn] || 0);
                    valB = new Date(b[sortColumn] || 0);
                }

                if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
                if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            });
        }

        // 3. Sayfalama (Pagination)
        // Sayfa numarası ve sayfa başı öğe sayısına göre dilimle
        const perPage = this.pagination ? this.pagination.itemsPerPage : 10;
        const currentPage = this.state.currentPage || 1;
        
        const startIndex = (currentPage - 1) * perPage;
        const endIndex = startIndex + perPage;

        return sortedData.slice(startIndex, endIndex);
    }

    render() {
        if (!this.renderer || !this.renderer.tbody) return;

        // 1. Tabloyu Temizle
        this.renderer.clear();
        const frag = document.createDocumentFragment();

        // 2. Veriyi Al (Sayfalama ve Filtreleme uygulanmış veri)
        const pageData = this.getPaginatedData();
        
        // 3. Sıra Numarası Başlangıç Değeri (Örn: 2. sayfa ise 11'den başlar)
        // (currentPage 1 tabanlıdır, bu yüzden 1 çıkarıyoruz)
        const startIndex = (this.state.currentPage - 1) * this.pagination.itemsPerPage;

        // 4. Satırları Oluştur
        pageData.forEach((item, loopIndex) => {
            // Gerçek sıra numarası: Sayfa Başı + Döngü İndeksi + 1
            const rowIndex = startIndex + loopIndex + 1;

            // --- A) DAVA (LITIGATION) SATIRLARI ---
            if (this.state.activeTab === 'litigation') {
                // Ana Satır (Parent)
                const tr = this.renderer.renderLitigationRow(item, rowIndex);
                frag.appendChild(tr);

                // Alt Satırlar (Children - Transactions)
                // Eğer davanın alt işlemleri varsa bunları gizli satır olarak ekle
                if (item.hasChildren && item.children && item.children.length > 0) {
                    item.children.forEach(child => {
                        const childTr = this.renderer.renderLitigationChildRow(child);
                        frag.appendChild(childTr);
                    });
                }
            } 
            // --- B) İTİRAZ (OBJECTIONS) SATIRLARI ---
            else if (this.state.activeTab === 'objections') {
                const tr = this.renderer.renderObjectionRow(item, item.hasChildren, item.isChild, rowIndex);
                
                // Child ise varsayılan gizli, Parent ise görünür
                if (item.isChild) {
                    tr.style.display = 'none';
                    tr.classList.add('child-row');
                    tr.dataset.parentId = item.parentId; // İlişkilendirme için önemli
                }
                frag.appendChild(tr);
            } 
            // --- C) STANDART (MARKA/PATENT) SATIRLARI ---
            else {
                const isSelected = this.state.selectedRecords.has(item.id);
                
                // Ana Satır
                const tr = this.renderer.renderStandardRow(
                    item, 
                    this.state.activeTab === 'trademark', 
                    isSelected, 
                    rowIndex // Sıra numarasını gönderiyoruz
                );
                frag.appendChild(tr);

                // WIPO/ARIPO Alt Kayıtları (Varsa)
                // Parent kayıtsa ve WIPO ise, altındaki child kayıtları bulup ekle
                if ((item.origin === 'WIPO' || item.origin === 'ARIPO') && item.transactionHierarchy === 'parent') {
                    const irNo = item.wipoIR || item.aripoIR;
                    const children = this.dataManager.getWipoChildren(irNo);
                    
                    children.forEach(child => {
                        // Child satırlar için checkbox seçili mi?
                        const isChildSelected = this.state.selectedRecords.has(child.id);
                        
                        // Child satır render et (Sıra numarası boş gönderilebilir veya alt numara verilebilir)
                        const childTr = this.renderer.renderStandardRow(
                            child, 
                            this.state.activeTab === 'trademark', 
                            isChildSelected, 
                            '' // Child satırda sıra numarası göstermiyoruz
                        );
                        
                        // Child satır stil ayarları
                        childTr.classList.add('child-row');
                        childTr.dataset.parentId = item.id; // veya irNo
                        childTr.style.display = 'none'; // Başlangıçta gizli
                        childTr.style.backgroundColor = '#f8f9fa'; // Hafif gri
                        
                        // Child satırda accordion okunu temizle
                        const toggleCell = childTr.querySelector('.toggle-cell');
                        if(toggleCell) toggleCell.innerHTML = ''; 

                        frag.appendChild(childTr);
                    });
                }
            }
        });

        // 5. DOM'a Ekle
        this.renderer.tbody.appendChild(frag);

        // 6. Checkbox ve Buton Durumlarını Güncelle
        this.updateSelectAllCheckbox();
        this.updateBulkActionButtons();
    }

    // --- KOLON AYARLARI (İSTENİLEN GENİŞLİKLER) ---
    getColumnsForTab(tab) {
        // A) DAVA (LITIGATION) TABLO SÜTUNLARI
        if (tab === 'litigation') {
            return [
                { key: 'rowNumber', label: '#', width: '40px' }, // Sıra Numarası
                { key: 'toggle', label: '', width: '30px' },     // Accordion Oku
                { key: 'title', label: 'Konu Varlık / Başlık', sortable: true, width: '200px' },
                { key: 'suitType', label: 'Dava Türü', sortable: true, width: '130px' },
                { key: 'caseNo', label: 'Dosya No', sortable: true, width: '100px' },
                { key: 'court', label: 'Mahkeme', sortable: true, width: '150px' },
                { key: 'client', label: 'Müvekkil', sortable: true, width: '130px' },
                { key: 'opposingParty', label: 'Karşı Taraf', sortable: true, width: '130px' },
                { key: 'suitStatus', label: 'Durum', sortable: true, width: '120px' }, // Yeni Statü Kolonu
                { key: 'openedDate', label: 'Açılış Tar.', sortable: true, width: '90px' },
                { key: 'actions', label: 'İşlemler', width: '90px', className: 'text-end' }
            ];
        }

        // B) İTİRAZ (OBJECTIONS) TABLO SÜTUNLARI
        if (tab === 'objections') {
            return [
                { key: 'selection', isCheckbox: true, width: '40px' },
                { key: 'rowNumber', label: '#', width: '40px' },
                { key: 'toggle', label: '', width: '30px' },
                { key: 'bulletinNo', label: 'Bülten No', sortable: true },
                { key: 'bulletinDate', label: 'Bülten Tar.', sortable: true },
                { key: 'objectionType', label: 'İtiraz Türü', sortable: true },
                { key: 'markName', label: 'Marka Adı', sortable: true },
                { key: 'opponentName', label: 'Karşı Taraf', sortable: true },
                { key: 'status', label: 'Durum', sortable: true },
                { key: 'actions', label: 'İşlemler', className: 'text-end' }
            ];
        }

        // C) STANDART (MARKA/PATENT/TASARIM) TABLO SÜTUNLARI
        const columns = [
            { key: 'selection', isCheckbox: true, width: '40px' },
            { key: 'rowNumber', label: '#', width: '40px' }, // YENİ: Sıra No
            { key: 'toggle', label: '', width: '30px' },     // YENİ: Accordion Oku
            { key: 'portfoyStatus', label: 'Durum', sortable: true, width: '80px' }
        ];

        // Marka değilse 'Tür' kolonu ekle (Patent/Tasarım ayrımı için)
        if (tab !== 'trademark') {
            columns.push({ key: 'type', label: 'Tür', sortable: true, width: '80px' });
        }

        columns.push({ key: 'title', label: 'Başlık / Marka Adı', sortable: true });

        // Sadece Marka Tabında Görsel ve Menşe Göster
        if (tab === 'trademark') {
            columns.push({ key: 'image', label: 'Görsel', width: '60px' });
            columns.push({ key: 'origin', label: 'Menşe', sortable: true, width: '80px' });
            columns.push({ key: 'country', label: 'Ülke', sortable: true, width: '100px' });
        }

        columns.push(
            { key: 'applicationNumber', label: 'Başvuru No', sortable: true },
            { key: 'applicationDate', label: 'Başvuru Tar.', sortable: true },
            { key: 'classes', label: 'Sınıflar', sortable: false }, // Sınıf rozetleri için sortable kapalı
            { key: 'applicant', label: 'Başvuru Sahibi', sortable: true },
            { key: 'actions', label: 'İşlemler', width: '100px', className: 'text-end' }
        );

        return columns;
    }
}

new PortfolioController();