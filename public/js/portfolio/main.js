import { db, auth } from '../../firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { PortfolioDataManager } from './PortfolioDataManager.js';
import { PortfolioRenderer } from './PortfolioRenderer.js';

class PortfolioController {
    constructor() {
        this.dataManager = new PortfolioDataManager();
        this.renderer = new PortfolioRenderer(this.dataManager);

        this.state = {
            activeTab: 'trademark', // Varsayılan Tab
            currentPage: 1,
            selectedRecords: new Set(),
            sortColumn: null,
            sortDirection: 'desc',
            filteredData: null // Arama yapıldığında burası dolacak
        };

        this.pagination = {
            itemsPerPage: 10
        };

        this.init();
    }

    // --- 1. BAŞLANGIÇ VE VERİ YÜKLEME ---
    async init() {
        try {
            // A) Auth Kontrolü
            const user = await new Promise((resolve) => {
                const unsubscribe = onAuthStateChanged(auth, u => {
                    unsubscribe();
                    resolve(u);
                });
            });

            if (!user) {
                window.location.href = 'index.html';
                return;
            }

            // B) UI Güncelleme (Header'daki İsim vb.)
            this.updateAuthUI(user);

            // C) Yükleniyor Göstergesi
            if (this.renderer && this.renderer.tbody) {
                this.renderer.tbody.innerHTML = '<tr><td colspan="12" class="text-center p-5"><div class="spinner-border text-primary mb-2" role="status"></div><br>Veriler ve Dava Dosyaları Yükleniyor...</td></tr>';
            }

            console.log("📥 Veriler çekiliyor...");

            // D) Verileri Çek ve Ata (HATAYI ÇÖZEN KISIM)
            // Paralel istek atıyoruz
            const [ipItems, litItems, objItems] = await Promise.all([
                this.dataManager.fetchAllItems(),      // Marka/Patent
                this.dataManager.loadLitigationData(), // Davalar
                this.dataManager.loadObjectionsData ? this.dataManager.loadObjectionsData() : [] // İtirazlar
            ]);

            // Dönen verileri Manager içine kaydediyoruz ki render erişebilsin
            this.dataManager.rows = ipItems || []; 
            // litigationRows zaten dataManager içinde set ediliyor ama garanti olsun
            if(!this.dataManager.litigationRows) this.dataManager.litigationRows = litItems || []; 
            
            console.log(`✅ Yüklendi -> IP: ${this.dataManager.rows.length}, Dava: ${this.dataManager.litigationRows.length}`);

            // E) URL'den Tab Seçimi
            const urlParams = new URLSearchParams(window.location.search);
            const tab = urlParams.get('tab');
            if (tab && ['trademark', 'patent', 'design', 'litigation', 'objections'].includes(tab)) {
                this.state.activeTab = tab;
                // Bootstrap Tab'ı tetikle
                const tabLink = document.querySelector(`#portfolioTabs a[href="#${tab}"]`);
                if(tabLink) $(tabLink).tab('show');
            }

            // F) Event Listenerları Kur ve Çiz
            this.setupEventListeners();
            this.render();

        } catch (error) {
            console.error("Başlangıç hatası:", error);
            if (this.renderer && this.renderer.tbody) {
                this.renderer.tbody.innerHTML = '<tr><td colspan="12" class="text-center text-danger p-4">Veri yüklenirken hata oluştu.<br>' + error.message + '</td></tr>';
            }
        }
    }

    // --- 2. AUTH UI (Eksik Olan Metod) ---
    updateAuthUI(user) {
        const userNameEl = document.getElementById('userNameDisplay') || document.querySelector('.user-name');
        const userEmailEl = document.getElementById('userEmailDisplay');
        const userAvatarEl = document.getElementById('userAvatar'); // id'si userAvatar olan img tag

        if (userNameEl) userNameEl.textContent = user.displayName || 'Kullanıcı';
        if (userEmailEl) userEmailEl.textContent = user.email;
        if (userAvatarEl && user.photoURL) userAvatarEl.src = user.photoURL;
    }

    // --- 3. EVENT LISTENERS ---
    setupEventListeners() {
        // Tab Değişimi (Bootstrap Event)
        $('a[data-toggle="tab"]').on('shown.bs.tab', (e) => {
            const targetId = $(e.target).attr('href').replace('#', '');
            console.log(`Tab değişti: ${targetId}`);
            
            this.state.activeTab = targetId;
            this.state.currentPage = 1;
            this.state.selectedRecords.clear();
            this.state.filteredData = null; // Filtreyi sıfırla
            document.getElementById('searchInput').value = ''; // Arama kutusunu temizle
            
            this.render();
        });

        // Arama Kutusu
        document.getElementById('searchInput')?.addEventListener('input', (e) => {
            this.handleSearch(e.target.value);
        });

        // Accordion (Aç/Kapa) Tıklama Yönetimi
        this.renderer.tbody.addEventListener('click', (e) => {
            // Eğer oka veya toggle hücresine tıklandıysa
            if (e.target.closest('.row-caret') || e.target.classList.contains('toggle-cell')) {
                const tr = e.target.closest('tr');
                const rowId = tr.dataset.id;
                const icon = tr.querySelector('.row-caret');
                
                // Bu ID'ye (veya ParentID'ye) sahip child satırları bul
                // Not: Renderer'da child satırlara data-parent-id atamıştık.
                const childRows = this.renderer.tbody.querySelectorAll(`.child-row[data-parent-id="${rowId}"]`);
                
                if (childRows.length > 0) {
                    let isHidden = childRows[0].style.display === 'none';
                    childRows.forEach(child => {
                        child.style.display = isHidden ? 'table-row' : 'none';
                    });
                    
                    // İkonu döndür
                    if(icon) {
                        icon.classList.toggle('fa-rotate-90'); 
                    }
                }
            }
        });

        // Sayfalama Tıklamaları (Delegation)
        document.getElementById('paginationContainer')?.addEventListener('click', (e) => {
            if (e.target.tagName === 'A' || e.target.closest('a')) {
                e.preventDefault();
                const btn = e.target.closest('a');
                const page = btn.dataset.page;
                
                if (page === 'prev') {
                    if (this.state.currentPage > 1) this.state.currentPage--;
                } else if (page === 'next') {
                    // Toplam sayfa kontrolü render içinde yapılır ama basitçe artıralım
                    this.state.currentPage++;
                } else {
                    this.state.currentPage = parseInt(page);
                }
                this.render();
            }
        });

        // Tümünü Seç Checkbox
        document.getElementById('selectAll')?.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const currentData = this.getPaginatedData();
            
            currentData.forEach(item => {
                if (isChecked) this.state.selectedRecords.add(item.id);
                else this.state.selectedRecords.delete(item.id);
            });
            this.render();
        });
    }

    // --- 4. VERİ FİLTRELEME VE SAYFALAMA ---
    
    // Arama Mantığı
    handleSearch(query) {
        query = query.toLowerCase().trim();
        let sourceData = [];

        // Hangi veri kümesinde arıyoruz?
        if (this.state.activeTab === 'litigation') sourceData = this.dataManager.litigationRows;
        else if (this.state.activeTab === 'objections') sourceData = this.dataManager.objectionRows;
        else sourceData = this.dataManager.rows;

        if (!query) {
            this.state.filteredData = null;
        } else {
            this.state.filteredData = sourceData.filter(item => {
                // Aranabilir alanlar
                const text = [
                    item.title, 
                    item.applicationNumber, 
                    item.client,
                    item.caseNo, // Dava No
                    item.court   // Mahkeme
                ].join(' ').toLowerCase();
                return text.includes(query);
            });
        }
        
        this.state.currentPage = 1;
        this.render();
    }

    // Sıralama ve Sayfalama (Eksik Olan Fonksiyon buydu)
    getPaginatedData() {
        // 1. Veri Kaynağını Seç
        let data = this.state.filteredData; // Önce filtreye bak

        if (!data) { // Filtre yoksa sekmeye göre ham veriyi al
            if (this.state.activeTab === 'litigation') {
                data = this.dataManager.litigationRows || [];
            } else if (this.state.activeTab === 'objections') {
                data = this.dataManager.objectionRows || []; 
            } else {
                // Diğer sekmeler (trademark, patent, design) için filtrele
                const allRows = this.dataManager.rows || [];
                if (this.state.activeTab === 'trademark') {
                    data = allRows.filter(r => !r.type || r.type === 'Marka'); // type yoksa marka varsay
                } else if (this.state.activeTab === 'patent') {
                    data = allRows.filter(r => r.type === 'Patent' || r.type === 'Faydalı Model');
                } else if (this.state.activeTab === 'design') {
                    data = allRows.filter(r => r.type === 'Tasarım');
                } else {
                    data = allRows;
                }
            }
        }

        // 2. Sıralama
        const { sortColumn, sortDirection } = this.state;
        if (sortColumn) {
            data.sort((a, b) => {
                let valA = a[sortColumn] || '';
                let valB = b[sortColumn] || '';
                
                // Tarih kontrolü
                if (sortColumn.toLowerCase().includes('date')) {
                    valA = new Date(valA).getTime();
                    valB = new Date(valB).getTime();
                } else {
                    valA = String(valA).toLowerCase();
                    valB = String(valB).toLowerCase();
                }

                if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
                if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            });
        }

        // 3. Sayfalama
        const perPage = this.pagination.itemsPerPage;
        const startIndex = (this.state.currentPage - 1) * perPage;
        const endIndex = startIndex + perPage;

        // Sayfalama UI güncellemesi için toplam sayfa sayısı lazım
        this.updatePaginationUI(data.length);

        return data.slice(startIndex, endIndex);
    }

    // --- 5. RENDER (ÇİZİM) ---
    render() {
        if (!this.renderer || !this.renderer.tbody) return;

        // Tabloyu Temizle
        this.renderer.clear();
        
        // Başlıkları Çiz
        const columns = this.getColumnsForTab(this.state.activeTab);
        this.renderer.renderHeader(columns);

        // Veriyi Al
        const pageData = this.getPaginatedData();
        const frag = document.createDocumentFragment();
        
        // Sıra No Başlangıcı
        const startIndex = (this.state.currentPage - 1) * this.pagination.itemsPerPage;

        if (pageData.length === 0) {
            this.renderer.tbody.innerHTML = '<tr><td colspan="12" class="text-center p-4 text-muted">Kayıt bulunamadı.</td></tr>';
            return;
        }

        pageData.forEach((item, loopIndex) => {
            const rowIndex = startIndex + loopIndex + 1;
            const isSelected = this.state.selectedRecords.has(item.id);

            // A) DAVA TABLOSU
            if (this.state.activeTab === 'litigation') {
                const tr = this.renderer.renderLitigationRow(item, rowIndex);
                frag.appendChild(tr);

                // Alt İşlemler (Varsa)
                if (item.children && item.children.length > 0) {
                    item.children.forEach(child => {
                        const childTr = this.renderer.renderLitigationChildRow(child);
                        frag.appendChild(childTr);
                    });
                }
            }
            // B) İTİRAZ TABLOSU 
            else if (this.state.activeTab === 'objections') {
                 // (Objection render metodunuz varsa buraya eklenir)
                 // const tr = this.renderer.renderObjectionRow(...)
            }
            // C) STANDART (MARKA/PATENT)
            else {
                const tr = this.renderer.renderStandardRow(
                    item, 
                    this.state.activeTab === 'trademark', 
                    isSelected, 
                    rowIndex
                );
                frag.appendChild(tr);

                // WIPO Alt Aile Kayıtları
                if ((item.origin === 'WIPO' || item.origin === 'ARIPO') && item.transactionHierarchy === 'parent') {
                    const irNo = item.wipoIR || item.aripoIR;
                    const children = this.dataManager.getWipoChildren(irNo);
                    
                    children.forEach(child => {
                        const childTr = this.renderer.renderStandardRow(child, this.state.activeTab === 'trademark', false, '');
                        childTr.classList.add('child-row');
                        childTr.dataset.parentId = item.id;
                        childTr.style.display = 'none';
                        childTr.style.backgroundColor = '#f9f9f9';
                        // Alt satırda toggle butonunu temizle
                        const toggleCell = childTr.querySelector('.toggle-cell');
                        if(toggleCell) toggleCell.innerHTML = ''; 
                        frag.appendChild(childTr);
                    });
                }
            }
        });

        this.renderer.tbody.appendChild(frag);
        this.updateSelectAllCheckbox();
    }

    // --- 6. YARDIMCILAR ---
    getColumnsForTab(tab) {
        // DAVA
        if (tab === 'litigation') {
            return [
                { key: 'rowNumber', label: '#', width: '40px' },
                { key: 'toggle', label: '', width: '30px' },
                { key: 'title', label: 'Konu Varlık / Başlık', sortable: true },
                { key: 'suitType', label: 'Dava Türü', sortable: true },
                { key: 'caseNo', label: 'Dosya No', sortable: true },
                { key: 'court', label: 'Mahkeme', sortable: true },
                { key: 'client', label: 'Müvekkil', sortable: true },
                { key: 'opposingParty', label: 'Karşı Taraf', sortable: true },
                { key: 'suitStatus', label: 'Durum', sortable: true },
                { key: 'openedDate', label: 'Açılış Tar.', sortable: true },
                { key: 'actions', label: 'İşlemler', width: '90px', className: 'text-end' }
            ];
        }

        // STANDART
        const columns = [
            { key: 'selection', isCheckbox: true, width: '40px' },
            { key: 'rowNumber', label: '#', width: '40px' },
            { key: 'toggle', label: '', width: '30px' },
            { key: 'portfoyStatus', label: 'Durum', sortable: true, width: '80px' }
        ];

        if (tab !== 'trademark') columns.push({ key: 'type', label: 'Tür', sortable: true, width: '80px' });

        columns.push({ key: 'title', label: 'Başlık / Marka Adı', sortable: true });

        if (tab === 'trademark') {
            columns.push({ key: 'image', label: 'Görsel', width: '60px' });
            columns.push({ key: 'origin', label: 'Menşe', sortable: true, width: '80px' });
            columns.push({ key: 'country', label: 'Ülke', sortable: true, width: '100px' });
        }

        columns.push(
            { key: 'applicationNumber', label: 'Başvuru No', sortable: true },
            { key: 'applicationDate', label: 'Başvuru Tar.', sortable: true },
            { key: 'classes', label: 'Sınıflar', sortable: false },
            { key: 'applicant', label: 'Başvuru Sahibi', sortable: true },
            { key: 'actions', label: 'İşlemler', width: '100px', className: 'text-end' }
        );

        return columns;
    }

    updatePaginationUI(totalItems) {
        const container = document.getElementById('paginationContainer');
        const info = document.getElementById('paginationInfo');
        if (!container) return;

        const totalPages = Math.ceil(totalItems / this.pagination.itemsPerPage);
        
        // Bilgi Yazısı
        if (info) {
            info.textContent = `Toplam ${totalItems} kayıttan ${(this.state.currentPage - 1) * this.pagination.itemsPerPage + 1} - ${Math.min(this.state.currentPage * this.pagination.itemsPerPage, totalItems)} arası gösteriliyor.`;
        }

        // Sayfa Numaraları
        let html = `
            <li class="page-item ${this.state.currentPage === 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" data-page="prev">«</a>
            </li>
        `;

        for (let i = 1; i <= totalPages; i++) {
            // Basitlik için tüm sayfaları gösteriyorum, çok sayfa varsa ... mantığı eklenebilir
            if (totalPages > 10 && Math.abs(this.state.currentPage - i) > 3 && i !== 1 && i !== totalPages) continue;
             
            html += `
                <li class="page-item ${this.state.currentPage === i ? 'active' : ''}">
                    <a class="page-link" href="#" data-page="${i}">${i}</a>
                </li>
            `;
        }

        html += `
            <li class="page-item ${this.state.currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}">
                <a class="page-link" href="#" data-page="next">»</a>
            </li>
        `;
        container.innerHTML = html;
    }

    updateSelectAllCheckbox() {
        const cb = document.getElementById('selectAll');
        if (cb) cb.checked = false; // Sayfa değişince resetle
    }
}

// Uygulamayı Başlat
document.addEventListener('DOMContentLoaded', () => {
    window.app = new PortfolioController();
});