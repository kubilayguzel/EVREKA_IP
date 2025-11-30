// public/js/indexing/portfolio-update-manager.js

import { db, ipRecordsService } from '../../firebase-config.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { showNotification, debounce } from '../../utils.js';

export class PortfolioUpdateManager {
    constructor() {
        this.state = {
            selectedRecordId: null,
            recordData: null,
            niceClasses: [],           
            goodsAndServicesMap: {},   
            bulletins: []
        };

        this.elements = this.cacheElements();
        this.init();
    }

    cacheElements() {
        const $ = (id) => document.getElementById(id);
        return {
            searchInput: $('recordSearchInput'),
            searchResults: $('searchResultsContainer'),
            selectedDisplay: $('selectedRecordDisplay'),
            childTransactionType: $('detectedType') || $('childTransactionType'),
            
            detailsContainer: $('record-details-wrapper'), 
            registryEditorSection: $('registry-editor-section'),
            
            registryStatus: $('registry-status'),
            appDate: $('registry-application-date'),
            regNo: $('registry-registration-no'),
            regDate: $('registry-registration-date'),
            renewalDate: $('registry-renewal-date'),
            
            btnSaveAll: $('btn-save-all'),
            bulletinList: $('bulletin-list'),
            btnAddBulletin: $('btn-add-bulletin'),
            bulletinNoInput: $('bulletin-no-input'),
            bulletinDateInput: $('bulletin-date-input'),
            
            niceChips: $('nice-classes-chips'),         
            niceAccordion: $('nice-classes-accordion'),
            btnNiceAddModal: $('btn-add-nice-modal'),   
            niceClassModal: $('nice-class-modal'),
            niceModalAvailableClasses: $('available-nice-classes')
        };
    }

    init() {
        this.setupEventListeners();
        this.renderInitialState();

        document.addEventListener('record-selected', (e) => {
            if (e.detail && e.detail.recordId) {
                console.log('⚡ PortfolioManager: Kayıt seçimi algılandı:', e.detail.recordId);
                this.selectRecord(e.detail.recordId);
            }
        });
        console.log('✅ PortfolioUpdateManager initialized');
    }

    renderInitialState() {
        if (this.elements.detailsContainer) this.elements.detailsContainer.style.display = 'none';
        if (this.elements.registryEditorSection) this.elements.registryEditorSection.style.display = 'none';
    }

    setupEventListeners() {
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', debounce((e) => this.handleSearch(e.target.value), 300));
        }
        if (this.elements.searchResults) {
            this.elements.searchResults.addEventListener('click', (e) => {
                const item = e.target.closest('.search-result-item');
                if (item) this.selectRecord(item.dataset.id);
            });
        }
        if (this.elements.selectedDisplay) {
            this.elements.selectedDisplay.addEventListener('click', (e) => {
                if (e.target.closest('.remove-selected-item-btn')) this.clearSelection();
            });
        }

        if (this.elements.childTransactionType) {
            this.elements.childTransactionType.addEventListener('change', () => {
                this.handleTransactionTypeChange();
            });
        }

        if (this.elements.btnNiceAddModal) this.elements.btnNiceAddModal.addEventListener('click', () => this.openNiceModal());
        if (this.elements.btnSaveAll) this.elements.btnSaveAll.addEventListener('click', () => this.saveAllChanges());
        if (this.elements.btnAddBulletin) this.elements.btnAddBulletin.addEventListener('click', () => this.addBulletin());

        document.addEventListener('click', (e) => {
            if (e.target.matches('.delete-bulletin-btn')) this.removeBulletin(e.target.dataset.index);
            if (e.target.matches('[data-remove-class]') || e.target.closest('[data-remove-class]')) {
                const btn = e.target.closest('[data-remove-class]');
                this.removeNiceClass(btn.getAttribute('data-remove-class'));
            }
        });
        
        // Textarea değişikliklerini yakala
        if (this.elements.niceAccordion) {
            this.elements.niceAccordion.addEventListener('input', (e) => {
                if (e.target.classList.contains('gs-textarea')) {
                    this.state.goodsAndServicesMap[e.target.dataset.class] = e.target.value;
                }
            });

            // --- YENİ EKLENEN MANUEL ACCORDION MANTIĞI ---
            // Başlığa tıklayınca diğerlerini kapatıp sadece tıklananı açar
            this.elements.niceAccordion.addEventListener('click', (e) => {
                const headerBtn = e.target.closest('.nice-accordion-btn');
                if (!headerBtn) return;

                e.preventDefault(); // Varsayılan davranışı engelle
                
                const targetId = headerBtn.getAttribute('data-target-id');
                const targetContent = document.getElementById(targetId);
                
                // Diğer tüm panelleri kapat
                const allContents = this.elements.niceAccordion.querySelectorAll('.nice-collapse-content');
                allContents.forEach(el => {
                    if (el.id !== targetId) {
                        el.style.display = 'none';
                        el.classList.remove('show');
                    }
                });

                // Tıklananı toggle et
                if (targetContent.style.display === 'block') {
                    targetContent.style.display = 'none';
                    targetContent.classList.remove('show');
                } else {
                    targetContent.style.display = 'block';
                    targetContent.classList.add('show');
                }
            });
            // ---------------------------------------------
        }
    }

    handleTransactionTypeChange() {
        const selectEl = this.elements.childTransactionType;
        if (!selectEl) return;
        const typeValue = selectEl.value; 
        let typeText = '';
        if (selectEl.selectedIndex !== -1 && selectEl.options[selectEl.selectedIndex]) {
            typeText = selectEl.options[selectEl.selectedIndex].text.toLowerCase();
        }

        const isRegistration = (typeValue === '45') || typeText.includes('tescil belgesi') || typeText.includes('registration certificate');

        if (this.elements.registryEditorSection) {
            if (isRegistration) {
                this.elements.registryEditorSection.style.display = 'block';
                // Sayfanın en altına doğru kaydır
                setTimeout(() => {
                    window.scrollTo({
                        top: document.body.scrollHeight,
                        behavior: 'smooth'
                    });
                }, 100);
                showNotification('📝 Tescil ve Sınıf düzenleme alanı açıldı.', 'info');
            } else {
                this.elements.registryEditorSection.style.display = 'none';
            }
        }
    }

    async handleSearch(query) {
        if (!query || query.length < 3) {
            if(this.elements.searchResults) this.elements.searchResults.style.display = 'none';
            return;
        }
        const results = await ipRecordsService.searchRecords(query);
        this.renderSearchResults(results);
    }

    renderSearchResults(results) {
        if (!this.elements.searchResults) return;
        const container = this.elements.searchResults;
        container.innerHTML = '';
        container.style.display = results.length ? 'block' : 'none';
        if (!results.length) return;

        container.innerHTML = results.map(r => `
            <div class="search-result-item" data-id="${r.id}">
                <div class="d-flex align-items-center">
                    ${r.brandImageUrl ? `<img src="${r.brandImageUrl}" class="mini-thumb mr-2" style="width:40px;">` : ''}
                    <div>
                        <strong>${r.title}</strong>
                        <div class="text-muted small">${r.applicationNumber || 'No: Yok'}</div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async selectRecord(id) {
        if (this.elements.searchInput) this.elements.searchInput.value = '';
        if (this.elements.searchResults) this.elements.searchResults.style.display = 'none';

        try {
            const result = await ipRecordsService.getRecordById(id);
            if (!result.success) throw new Error(result.error);

            const data = result.data;
            this.state.recordData = data;
            this.state.selectedRecordId = id;
            this.state.bulletins = data.bulletins || [];
            
            this.parseNiceClassesFromData(data);

            if (this.elements.selectedDisplay) this.renderSelectedRecordUI();
            this.populateFormFields();

            if (this.elements.detailsContainer) this.elements.detailsContainer.style.display = 'block';
            
            if (this.elements.childTransactionType) {
                this.handleTransactionTypeChange();
            }

        } catch (error) {
            console.error('PortfolioManager Kayıt Yükleme Hatası:', error);
        }
    }

    parseNiceClassesFromData(data) {
        const gsList = data.goodsAndServicesByClass || [];
        // Map oluştururken anahtarı String'e çeviriyoruz
        this.state.goodsAndServicesMap = gsList.reduce((acc, curr) => {
            acc[String(curr.classNo)] = (curr.items || []).join('\n');
            return acc;
        }, {});

        let nClasses = data.niceClasses || [];
        if (!nClasses.length && gsList.length > 0) {
            nClasses = gsList.map(item => String(item.classNo));
        }
        if (!nClasses.length && data.niceClass) {
            nClasses = Array.isArray(data.niceClass) ? data.niceClass.map(String) : [String(data.niceClass)];
        }
        // Tüm sınıfları String formatına çevir
        this.state.niceClasses = nClasses.map(String);
    }

    clearSelection() {
        this.state = { selectedRecordId: null, recordData: null, niceClasses: [], goodsAndServicesMap: {}, bulletins: [] };
        if (this.elements.selectedDisplay) {
            this.elements.selectedDisplay.innerHTML = '';
            this.elements.selectedDisplay.style.display = 'none';
        }
        if (this.elements.searchInput) this.elements.searchInput.style.display = 'block';
        if (this.elements.detailsContainer) this.elements.detailsContainer.style.display = 'none';
    }

    renderSelectedRecordUI() {
        if (!this.elements.selectedDisplay) return;
        const r = this.state.recordData;
        if (this.elements.searchInput) this.elements.searchInput.style.display = 'none';
        
        this.elements.selectedDisplay.style.display = 'block';
        this.elements.selectedDisplay.innerHTML = `
            <div class="selected-record-card p-3 border rounded bg-white">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="d-flex align-items-center">
                        ${r.brandImageUrl ? `<img src="${r.brandImageUrl}" class="record-thumb mr-3" style="width:50px;">` : ''}
                        <div>
                            <h5 class="mb-0 text-primary">${r.title}</h5>
                            <span class="badge badge-secondary">${r.applicationNumber}</span>
                        </div>
                    </div>
                    <button class="btn btn-sm btn-outline-danger remove-selected-item-btn">✕ İptal</button>
                </div>
            </div>
        `;
    }

    populateFormFields() {
        const r = this.state.recordData;
        if(this.elements.registryStatus) this.elements.registryStatus.value = r.status || '';
        if(this.elements.appDate) this.elements.appDate.value = r.applicationDate || '';
        if(this.elements.regNo) this.elements.regNo.value = r.registrationNumber || '';
        if(this.elements.regDate) this.elements.regDate.value = r.registrationDate || '';
        if(this.elements.renewalDate) this.elements.renewalDate.value = r.renewalDate || '';

        this.renderBulletins();
        this.renderNiceEditor(); 
    }

    renderNiceEditor() {
        if (!this.elements.niceChips) return;
        
        if (this.state.niceClasses.length === 0) {
            this.elements.niceChips.innerHTML = '<div class="text-muted small">Sınıf eklenmemiş.</div>';
            if (this.elements.niceAccordion) this.elements.niceAccordion.innerHTML = '';
            return;
        }

        // 1. Çipleri Render Et
        this.elements.niceChips.innerHTML = this.state.niceClasses
            .sort((a, b) => Number(a) - Number(b))
            .map(c => `
                <span class="badge badge-primary border mr-1 mb-1 p-2 shadow-sm" style="font-size: 0.9em;">
                    Nice ${c}
                    <span style="cursor:pointer; margin-left:8px; opacity:0.7;" data-remove-class="${c}" title="Sil">
                        <i class="fas fa-times"></i>
                    </span>
                </span>
            `).join('');

        // 2. Accordion Render Et (Manual JS logic ile uyumlu)
        if (!this.elements.niceAccordion) return;

        this.elements.niceAccordion.innerHTML = this.state.niceClasses
            .sort((a, b) => Number(a) - Number(b))
            .map((c, idx) => {
                const content = this.state.goodsAndServicesMap[String(c)] || ''; // String key ile erişim
                const panelId = `nice-panel-${c}`;
                // İlk eleman açık gelsin
                const isShow = idx === 0 ? 'show' : '';
                const displayStyle = idx === 0 ? 'block' : 'none';

                return `
                    <div class="card mb-2 border">
                        <div class="card-header p-0 bg-light" id="heading-${c}">
                            <h6 class="mb-0">
                                <button class="btn btn-link btn-block text-left py-3 px-3 text-dark font-weight-bold nice-accordion-btn" 
                                        type="button" 
                                        data-target-id="${panelId}"
                                        style="text-decoration: none;">
                                    <i class="fas fa-chevron-right mr-2 text-primary" style="font-size:0.8em"></i>
                                    Nice ${c} — Mal & Hizmet Listesi
                                </button>
                            </h6>
                        </div>
                        <div id="${panelId}" class="nice-collapse-content ${isShow}" style="display:${displayStyle};">
                            <div class="card-body p-2">
                                <textarea class="form-control gs-textarea border-0 bg-light" 
                                    data-class="${c}" 
                                    rows="6" 
                                    style="resize:vertical; font-size:0.9rem;"
                                    placeholder="Sınıf ${c} için maddeleri buraya yapıştırın...">${content}</textarea>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
    }

    removeNiceClass(classNo) {
        if(!confirm(`Nice ${classNo} sınıfını silmek istiyor musunuz?`)) return;
        this.state.niceClasses = this.state.niceClasses.filter(x => x !== classNo);
        delete this.state.goodsAndServicesMap[classNo];
        this.renderNiceEditor();
    }

    async openNiceModal() {
        const allNiceClasses = Array.from({length: 45}, (_, i) => String(i + 1));
        const existing = new Set(this.state.niceClasses);
        const availableHtml = allNiceClasses.filter(c => !existing.has(c))
            .map(c => `<button class="list-group-item list-group-item-action add-modal-class" data-class="${c}">
                        <i class="fas fa-plus-circle text-success mr-2"></i>Nice ${c}
                       </button>`)
            .join('');

        if (this.elements.niceModalAvailableClasses) {
            this.elements.niceModalAvailableClasses.innerHTML = availableHtml || '<div class="p-3 text-center text-muted">Tüm sınıflar ekli.</div>';
        }
        
        // Modal Event Delegation
        this.elements.niceModalAvailableClasses.onclick = (e) => {
            const btn = e.target.closest('.add-modal-class');
            if (btn) {
                this.addClassFromModal(btn.dataset.class);
            }
        };

        if (window.$ && window.$.fn.modal) {
            $(this.elements.niceClassModal).modal('show');
        } else {
            this.elements.niceClassModal.style.display = 'block';
            this.elements.niceClassModal.classList.add('show');
        }
    }

    addClassFromModal(cls) {
        if (!this.state.niceClasses.includes(cls)) {
            this.state.niceClasses.push(cls);
            this.state.goodsAndServicesMap[cls] = '';
            this.renderNiceEditor();
            if (window.$ && window.$.fn.modal) $(this.elements.niceClassModal).modal('hide');
            else this.elements.niceClassModal.style.display = 'none';
        }
    }

    addBulletin() {
        const no = this.elements.bulletinNoInput.value.trim();
        const date = this.elements.bulletinDateInput.value;
        if (!no || !date) { showNotification('Eksik bilgi', 'warning'); return; }
        this.state.bulletins.push({ bulletinNo: no, bulletinDate: date });
        this.renderBulletins();
        this.elements.bulletinNoInput.value = '';
    }

    removeBulletin(index) {
        this.state.bulletins.splice(index, 1);
        this.renderBulletins();
    }

    renderBulletins() {
        if (!this.elements.bulletinList) return;
        this.elements.bulletinList.innerHTML = this.state.bulletins.map((b, i) => `
            <div class="d-flex justify-content-between border-bottom p-2">
                <span>No: ${b.bulletinNo} (${b.bulletinDate})</span>
                <button class="btn btn-sm btn-danger delete-bulletin-btn" data-index="${i}">Sil</button>
            </div>
        `).join('');
    }

    async saveAllChanges() {
        if (!this.state.selectedRecordId) return;

        if (this.elements.btnSaveAll) {
            this.elements.btnSaveAll.disabled = true;
            this.elements.btnSaveAll.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Kaydediliyor...';
        }

        try {
            const sortedClasses = [...this.state.niceClasses].sort((a, b) => Number(a) - Number(b));
            const goodsAndServicesByClass = sortedClasses.map(classNo => ({
                classNo: Number(classNo),
                items: (this.state.goodsAndServicesMap[String(classNo)] || '').split('\n').filter(i => i.trim() !== '')
            }));

            const updates = {
                status: this.elements.registryStatus ? this.elements.registryStatus.value : '',
                applicationDate: this.elements.appDate ? this.elements.appDate.value : '',
                registrationNumber: this.elements.regNo ? this.elements.regNo.value : '',
                registrationDate: this.elements.regDate ? this.elements.regDate.value : '',
                renewalDate: this.elements.renewalDate ? this.elements.renewalDate.value : '',
                bulletins: this.state.bulletins,
                niceClasses: sortedClasses,
                goodsAndServicesByClass: goodsAndServicesByClass,
                updatedAt: new Date().toISOString()
            };

            await updateDoc(doc(db, 'ipRecords', this.state.selectedRecordId), updates);
            showNotification('Kayıt ve portföy başarıyla güncellendi!', 'success');

        } catch (error) {
            console.error('Save Error:', error);
            showNotification('Hata: ' + error.message, 'error');
        } finally {
            if (this.elements.btnSaveAll) {
                this.elements.btnSaveAll.disabled = false;
                this.elements.btnSaveAll.textContent = 'Tüm Değişiklikleri Kaydet';
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('recordSearchInput') || document.getElementById('detectedType')) {
        window.portfolioUpdateManager = new PortfolioUpdateManager();
    }
});