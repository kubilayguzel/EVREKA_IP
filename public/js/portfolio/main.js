// public/js/portfolio/main.js
import { PortfolioDataManager } from './PortfolioDataManager.js';
import { PortfolioRenderer } from './PortfolioRenderer.js';
import { auth, onAuthStateChanged } from '../../firebase-config.js';
import { loadSharedLayout } from '../layout-loader.js';
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
            currentPage: 1
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
                    // İlk render
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
            }
        });
    }

    setupEventListeners() {
        // Tab Değişimi
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                this.state.activeTab = e.target.dataset.type;
                this.state.currentPage = 1;
                this.state.searchQuery = ''; // Tab değişiminde aramayı sıfırla
                document.getElementById('searchBar').value = '';

                this.renderer.showLoading(true);
                try {
                    if (this.state.activeTab === 'litigation') {
                        await this.dataManager.loadLitigationData();
                    } else if (this.state.activeTab === 'objections') {
                        await this.dataManager.loadObjectionRows();
                    }
                } finally {
                    this.renderer.showLoading(false);
                }

                this.render();
            });
        });

        // Arama
        document.getElementById('searchBar').addEventListener('input', (e) => {
            this.state.searchQuery = e.target.value;
            this.state.currentPage = 1;
            this.render();
        });

        // Kolon Filtreleri
        document.getElementById('portfolioTableFilterRow').addEventListener('input', (e) => {
            if (e.target.classList.contains('column-filter')) {
                this.state.columnFilters[e.target.dataset.column] = e.target.value;
                this.state.currentPage = 1;
                this.render();
            }
        });

        // Sıralama
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
                
                // UI güncelle (ok işaretleri)
                document.querySelectorAll('.sortable-header').forEach(h => {
                    h.classList.remove('asc', 'desc');
                    if(h.dataset.column === col) h.classList.add(this.state.sort.direction);
                });
                
                this.render();
            }
        });

        // Tablo İçi Tıklamalar (Accordion & Actions)
        const tbody = document.getElementById('portfolioTableBody');
        tbody.addEventListener('click', (e) => {
            // 1. Accordion Caret Tıklaması
            const caret = e.target.closest('.row-caret') || (e.target.closest('tr.group-header') && !e.target.closest('button, a, input'));
            
            if (caret) {
                // Tıklanan satırı bul (ya caret'in kendisi ya da satırın kendisi)
                const tr = e.target.closest('tr');
                if (tr && tr.dataset.groupId) {
                    const groupId = tr.dataset.groupId;
                    const isExpanded = tr.getAttribute('aria-expanded') === 'true';
                    
                    // Durumu tersine çevir
                    tr.setAttribute('aria-expanded', !isExpanded);
                    
                    // İkonu döndür
                    const icon = tr.querySelector('.row-caret');
                    if(icon) {
                        icon.style.transform = !isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
                        icon.className = !isExpanded ? 'fas fa-chevron-down row-caret' : 'fas fa-chevron-right row-caret';
                    }

                    // Alt satırları göster/gizle
                    const children = tbody.querySelectorAll(`tr.child-row[data-parent-id="${groupId}"]`);
                    children.forEach(child => {
                        child.style.display = !isExpanded ? 'table-row' : 'none';
                    });
                }
                return;
            }

            // 2. Aksiyon Butonları
            const btn = e.target.closest('.action-btn');
            if (btn) {
                const id = btn.dataset.id;
                if (btn.classList.contains('view-btn')) {
                    if (this.state.activeTab === 'litigation') {
                        // Dava detay (suit-detail.html)
                        window.location.href = `suit-detail.html?id=${id}`;
                    } else {
                        window.open(`portfolio-detail.html?id=${id}`, '_blank');
                    }
                }
                // Edit / Delete eklenebilir
            }
        });
    }

    render() {
        // 1. Headers
        const cols = this.getColumnsForTab(this.state.activeTab);
        this.renderer.renderHeaders(cols);

        // 2. Filter & Sort
        let filtered = this.dataManager.filterRecords(
            this.state.activeTab, 
            this.state.searchQuery, 
            this.state.columnFilters
        );
        
        filtered = this.dataManager.sortRecords(filtered, this.state.sort.column, this.state.sort.direction);

        // 3. Pagination
        this.pagination.update(filtered.length);
        const pageData = this.pagination.getCurrentPageData(filtered);

        // 4. Render Rows
        this.renderer.clear();
        const frag = document.createDocumentFragment();
        
        pageData.forEach(item => {
            if (this.state.activeTab === 'objections') {
                // Objection satırlarını render et
                // Not: Objection verisi düzleştirilmiş (flattened) gelebilir, 
                // ya da sadece parentları render edip childları gizli basabiliriz.
                
                // Eğer child ise ve parent'ı şu anki sayfada yoksa (pagination yüzünden) ne olacak?
                // ObjectionRows zaten düzleştirilmiş bir liste (parent, child, parent, child...).
                // Pagination bunu bölebilir. Bu yüzden DataManager'da objectionRows yapısı 'Görünür Parentlar' listesi olmalıydı.
                // Ancak basitlik adına: Her satırı basıyoruz, childlar default gizli.
                
                const tr = this.renderer.renderObjectionRow(item, item.hasChildren, item.isChild);
                
                // Child satırsa varsayılan olarak gizle
                if (item.isChild) tr.style.display = 'none'; 
                
                frag.appendChild(tr);

            } else if (this.state.activeTab === 'litigation') {
                // Dava satırları (renderLitigationRow metodunu renderer'a eklemek gerekebilir, veya standardRow'u modifiye)
                // Şimdilik standart row benzeri bir yapı kuralım renderer içinde
                 const tr = document.createElement('tr');
                 tr.innerHTML = `
                    <td>${item.title}</td>
                    <td>${item.suitType}</td>
                    <td>${item.caseNo}</td>
                    <td>${item.court}</td>
                    <td>${item.client}</td>
                    <td>${item.opposingParty}</td>
                    <td>${item.openedDate}</td>
                    <td><button class="action-btn view-btn" data-id="${item.id}">Görüntüle</button></td>
                 `;
                 frag.appendChild(tr);

            } else {
                frag.appendChild(this.renderer.renderStandardRow(item, this.state.activeTab === 'trademark'));
            }
        });
        
        this.renderer.tbody.appendChild(frag);
    }

    getColumnsForTab(tab) {
        if (tab === 'objections') {
            return [
                { key: 'toggle', width: '40px' },
                { key: 'transactionTypeName', label: 'İşlem Tipi', sortable: true },
                { key: 'applicationNumber', label: 'Başvuru No', sortable: true },
                { key: 'applicantName', label: 'Başvuru Sahibi', sortable: true },
                { key: 'opponent', label: 'Karşı Taraf', sortable: true },
                { key: 'bulletinNo', label: 'Bülten', sortable: true },
                { key: 'statusText', label: 'Durum', sortable: true },
                { key: 'documents', label: 'Evraklar' }
            ];
        }
        if (tab === 'litigation') {
            return [
                { key: 'title', label: 'Konu Varlık', sortable: true },
                { key: 'suitType', label: 'Dava Türü', sortable: true },
                { key: 'caseNo', label: 'Dosya No', sortable: true },
                { key: 'court', label: 'Mahkeme', sortable: true },
                { key: 'client', label: 'Müvekkil', sortable: true },
                { key: 'opposingParty', label: 'Karşı Taraf', sortable: true },
                { key: 'openedDate', label: 'Açılış Tarihi', sortable: true },
                { key: 'actions', label: 'İşlemler' }
            ];
        }

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
            base.splice(5, 0, { key: 'origin', label: 'Menşe', sortable: true });
        } else {
             base.splice(2, 0, { key: 'type', label: 'Tür', sortable: true });
        }
        return base;
    }
}

new PortfolioController();