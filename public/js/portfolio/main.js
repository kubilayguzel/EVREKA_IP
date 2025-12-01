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
        // Auth Kontrolü
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
            }
        });
    }

    setupEventListeners() {
        // Tab Değişimi
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.state.activeTab = e.target.dataset.type;
                this.state.currentPage = 1;
                
                // Özel veri yüklemeleri
                if (this.state.activeTab === 'litigation') this.dataManager.loadLitigationData();
                // Objection loading mantığı buraya eklenebilir (create-portfolio-by-opposition ile entegre)

                this.render();
            });
        });

        // Arama
        document.getElementById('searchBar').addEventListener('input', (e) => {
            this.state.searchQuery = e.target.value;
            this.state.currentPage = 1;
            this.render();
        });

        // Kolon Başlıkları (Sıralama)
        document.getElementById('portfolioTableHeaderRow').addEventListener('click', (e) => {
            if (e.target.classList.contains('sortable-header')) {
                const col = e.target.dataset.column;
                if (this.state.sort.column === col) {
                    this.state.sort.direction = this.state.sort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    this.state.sort.column = col;
                    this.state.sort.direction = 'asc';
                }
                this.render();
            }
        });

        // Tablo İçi Butonlar (Delegation)
        document.getElementById('portfolioTableBody').addEventListener('click', (e) => {
            const btn = e.target.closest('.action-btn');
            if (!btn) return;
            const id = btn.dataset.id;
            
            if (btn.classList.contains('view-btn')) {
                 window.open(`portfolio-detail.html?id=${id}`, '_blank');
            }
            // Edit ve Delete işlemleri...
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

        // 3. Update Pagination
        this.pagination.update(filtered.length);
        const pageData = this.pagination.getCurrentPageData(filtered);

        // 4. Render Rows
        this.renderer.clear();
        const frag = document.createDocumentFragment();
        
        pageData.forEach(item => {
            // Tab'a göre render fonksiyonu seçimi
            if (this.state.activeTab === 'objections') {
                // Objection logic...
            } else {
                frag.appendChild(this.renderer.renderStandardRow(item, this.state.activeTab === 'trademark'));
            }
        });
        
        this.renderer.tbody.appendChild(frag);
    }

    getColumnsForTab(tab) {
        // Basit kolon tanımları
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
        }
        return base;
    }
}

// Başlat
new PortfolioController();