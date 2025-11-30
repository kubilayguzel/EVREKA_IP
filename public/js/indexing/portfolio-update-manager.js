// public/js/indexing/portfolio-update-manager.js

import { db, ipRecordsService } from '../../firebase-config.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { showNotification, debounce } from '../../utils.js';

export class PortfolioUpdateManager {
    constructor() {
        // Durum Yönetimi
        this.state = {
            selectedRecordId: null,
            recordData: null,
            niceClasses: [],           // Örn: ['1', '35']
            goodsAndServicesMap: {},   // Örn: { '1': 'Kimyasallar...', '35': 'Mağazacılık...' }
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
            
            // İşlem Tipi Seçimi (Tetikleyici)
            childTransactionType: $('detectedType'),
            
            // Form Alanları (Wrapper)
            detailsContainer: $('record-details-wrapper'), 
            registryEditorSection: $('registry-editor-section'),
            
            // Tescil Bilgileri Inputları
            registryStatus: $('registry-status'),
            appDate: $('registry-application-date'),
            regNo: $('registry-registration-no'),
            regDate: $('registry-registration-date'),
            renewalDate: $('registry-renewal-date'),
            
            // Butonlar
            btnSaveAll: $('btn-save-all'),
            
            // Bülten Alanları
            bulletinList: $('bulletin-list'),
            btnAddBulletin: $('btn-add-bulletin'),
            bulletinNoInput: $('bulletin-no-input'),
            bulletinDateInput: $('bulletin-date-input'),
            
            // Nice Sınıfları (Eski yapıdan port edildi)
            niceChips: $('nice-classes-chips'),         // Chip'lerin duracağı yer
            niceAccordion: $('nice-classes-accordion'),
            btnNiceAddModal: $('btn-add-nice-modal'),   // Modal açma butonu
            
            // Modal Elementleri
            niceClassModal: $('nice-class-modal'),
            niceModalAvailableClasses: $('available-nice-classes'),
            niceModalSelectedClasses: $('selected-nice-classes-in-modal'),
            niceModalItemEditor: $('nice-modal-item-editor'),
            btnSaveNiceModal: $('btn-save-nice-modal')
        };
    }

    init() {
        this.setupEventListeners();
        this.renderInitialState();

        // DocumentReviewManager bir kayıt seçtiğinde burası tetiklenecek
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
        // Başlangıçta tescil editörü gizli olsun (İşlem tipi seçilene kadar)
        if (this.elements.registryEditorSection) this.elements.registryEditorSection.style.display = 'none';
    }

    setupEventListeners() {
        // --- Arama ve Seçim ---
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

        // --- Tetikleyici: İşlem Tipi Değişimi ---
        if (this.elements.childTransactionType) {
            this.elements.childTransactionType.addEventListener('change', (e) => {
                this.handleTransactionTypeChange(e.target.value);
            });
        }

        // --- Nice Modal İşlemleri ---
        if (this.elements.btnNiceAddModal) {
            this.elements.btnNiceAddModal.addEventListener('click', () => this.openNiceModal());
        }
        if (this.elements.btnSaveNiceModal) {
            this.elements.btnSaveNiceModal.addEventListener('click', () => this.saveNiceModalChanges());
        }

        // --- Kaydetme ---
        if (this.elements.btnSaveAll) {
            this.elements.btnSaveAll.addEventListener('click', () => this.saveAllChanges());
        }

        // --- Bülten Ekleme ---
        if (this.elements.btnAddBulletin) {
            this.elements.btnAddBulletin.addEventListener('click', () => this.addBulletin());
        }
        // Dinamik elemanlar için global click listener (Delegation)
        document.addEventListener('click', (e) => {
            // Bülten Silme
            if (e.target.matches('.delete-bulletin-btn')) {
                const idx = e.target.dataset.index;
                this.removeBulletin(idx);
            }
            // Nice Sınıfı Silme (Chip üzerindeki X)
            if (e.target.matches('[data-remove-class]') || e.target.closest('[data-remove-class]')) {
                const btn = e.target.closest('[data-remove-class]');
                const cls = btn.getAttribute('data-remove-class');
                this.removeNiceClass(cls);
            }
        });
        
        // Textarea değişikliklerini anlık yakala (Nice Accordion içindeki)
        if (this.elements.niceAccordion) {
            this.elements.niceAccordion.addEventListener('input', (e) => {
                if (e.target.classList.contains('gs-textarea')) {
                    const cls = e.target.dataset.class;
                    this.state.goodsAndServicesMap[cls] = e.target.value;
                }
            });
        }
    }

    // --- TETİKLEYİCİ MANTIK ---

    handleTransactionTypeChange(typeValue) {
        // Tescil Belgesi kodunu kontrol et (Genelde 'registration' veya ID'si)
        // Eğer seçilen işlem tipi Tescil Belgesi ise editörü aç
        
        // Not: typeValue değerinin ne olduğunu transactionTypes.json'dan veya console.log'dan teyit edin.
        // Örnek olarak 'registration' veya 'tescil' içeriyorsa:
        const isRegistration = typeValue && (typeValue.includes('registration') || typeValue === 'tescil_belgesi');

        if (this.elements.registryEditorSection) {
            this.elements.registryEditorSection.style.display = isRegistration ? 'block' : 'none';
        }
        
        if (isRegistration) {
            showNotification('Tescil bilgileri düzenleme modu aktif.', 'info');
        }
    }

    // --- ARAMA & SEÇİM ---

    async handleSearch(query) {
        if (!query || query.length < 3) {
            this.elements.searchResults.style.display = 'none';
            return;
        }
        const results = await ipRecordsService.searchRecords(query);
        this.renderSearchResults(results);
    }

    renderSearchResults(results) {
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
        this.elements.searchInput.value = '';
        this.elements.searchResults.style.display = 'none';
        showNotification('Kayıt verileri getiriliyor...', 'info');

        try {
            const result = await ipRecordsService.getRecordById(id);
            if (!result.success) throw new Error(result.error);

            const data = result.data;
            this.state.recordData = data;
            this.state.selectedRecordId = id;
            this.state.bulletins = data.bulletins || [];
            
            // Nice Sınıflarını Parse Et (Eski koddaki mantık)
            this.parseNiceClassesFromData(data);

            this.renderSelectedRecordUI();
            this.populateFormFields();

            if (this.elements.detailsContainer) {
                this.elements.detailsContainer.style.display = 'block';
            }
            
            // Eğer dropdown önceden seçiliyse kontrolü tekrar çalıştır
            if (this.elements.childTransactionType && this.elements.childTransactionType.value) {
                this.handleTransactionTypeChange(this.elements.childTransactionType.value);
            }

        } catch (error) {
            console.error(error);
            showNotification('Kayıt yüklenemedi', 'error');
        }
    }

    parseNiceClassesFromData(data) {
        // 1. goodsAndServicesByClass array'ini Map'e çevir
        const gsList = data.goodsAndServicesByClass || [];
        this.state.goodsAndServicesMap = gsList.reduce((acc, curr) => {
            acc[curr.classNo] = (curr.items || []).join('\n');
            return acc;
        }, {});

        // 2. Sınıf numaralarını çıkar
        let nClasses = data.niceClasses || [];
        if (!nClasses.length && gsList.length > 0) {
            nClasses = gsList.map(item => String(item.classNo));
        }
        // Fallback: eski tip veri varsa
        if (!nClasses.length && data.niceClass) {
            nClasses = Array.isArray(data.niceClass) ? data.niceClass.map(String) : [String(data.niceClass)];
        }

        this.state.niceClasses = nClasses.map(String);
    }

    clearSelection() {
        this.state = { selectedRecordId: null, recordData: null, niceClasses: [], goodsAndServicesMap: {}, bulletins: [] };
        this.elements.selectedDisplay.innerHTML = '';
        this.elements.selectedDisplay.style.display = 'none';
        this.elements.searchInput.style.display = 'block';
        if (this.elements.detailsContainer) this.elements.detailsContainer.style.display = 'none';
    }

    renderSelectedRecordUI() {
        const r = this.state.recordData;
        this.elements.searchInput.style.display = 'none';
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
        this.renderNiceEditor(); // Artık Read-only değil, Editör render ediyoruz
    }

    // --- NICE EDITOR (ESKİ KODDAN PORT EDİLEN KISIM) ---

    renderNiceEditor() {
        // 1. Chips (Üstteki etiketler)
        if (!this.elements.niceChips) return;
        
        if (this.state.niceClasses.length === 0) {
            this.elements.niceChips.innerHTML = '<div class="text-muted small">Sınıf eklenmemiş. "Sınıf Ekle" butonunu kullanın.</div>';
            this.elements.niceAccordion.innerHTML = '';
            return;
        }

        this.elements.niceChips.innerHTML = this.state.niceClasses
            .sort((a, b) => Number(a) - Number(b))
            .map(c => `
                <span class="badge badge-info border mr-1 mb-1 p-2" style="font-size: 0.9em;">
                    Nice ${c}
                    <span style="cursor:pointer; margin-left:5px; font-weight:bold;" data-remove-class="${c}">&times;</span>
                </span>
            `).join('');

        // 2. Accordion (Düzenlenebilir Textarea'lar)
        if (!this.elements.niceAccordion) return;

        this.elements.niceAccordion.innerHTML = this.state.niceClasses
            .sort((a, b) => Number(a) - Number(b))
            .map((c, idx) => {
                const content = this.state.goodsAndServicesMap[c] || '';
                const panelId = `nice-panel-${c}`;
                return `
                    <div class="card mb-2">
                        <div class="card-header p-2" id="heading-${c}">
                            <h6 class="mb-0">
                                <button class="btn btn-link btn-block text-left" type="button" data-toggle="collapse" data-target="#${panelId}">
                                    📂 Nice ${c} — Mal & Hizmet Listesi
                                </button>
                            </h6>
                        </div>
                        <div id="${panelId}" class="collapse ${idx === 0 ? 'show' : ''}" data-parent="#nice-classes-accordion">
                            <div class="card-body">
                                <textarea class="form-control gs-textarea" data-class="${c}" rows="5" 
                                    placeholder="Sınıf ${c} için maddeleri buraya yapıştırın...">${content}</textarea>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
    }

    removeNiceClass(classNo) {
        if(!confirm(`Nice ${classNo} sınıfını ve içeriğini silmek istediğinize emin misiniz?`)) return;
        
        this.state.niceClasses = this.state.niceClasses.filter(x => x !== classNo);
        delete this.state.goodsAndServicesMap[classNo];
        this.renderNiceEditor();
    }

    // --- MODAL YÖNETİMİ ---

    async openNiceModal() {
        const allNiceClasses = Array.from({length: 45}, (_, i) => String(i + 1));
        const existing = new Set(this.state.niceClasses);
        
        // Modal içeriğini oluştur
        // Sol taraf: Mevcut olmayan sınıflar
        const availableHtml = allNiceClasses
            .filter(c => !existing.has(c))
            .map(c => `<button class="list-group-item list-group-item-action add-modal-class" data-class="${c}">Nice ${c}</button>`)
            .join('');

        if (this.elements.niceModalAvailableClasses) {
            this.elements.niceModalAvailableClasses.innerHTML = availableHtml || '<div class="p-2">Tüm sınıflar ekli.</div>';
        }

        // Event delegation for modal buttons
        this.setupModalDynamicEvents();

        // Modalı göster (Bootstrap varsa)
        if (window.$ && window.$.fn.modal) {
            $(this.elements.niceClassModal).modal('show');
        } else {
            this.elements.niceClassModal.style.display = 'block';
            this.elements.niceClassModal.classList.add('show');
        }
    }

    setupModalDynamicEvents() {
        // Modal içindeki butonlara listener (Sadece bir kez eklenmeli veya temizlenmeli, burada basitleştirildi)
        const availableContainer = this.elements.niceModalAvailableClasses;
        
        // Önceki listenerları temizlemek zor olduğu için cloneNode yapabiliriz veya delegation kullanabiliriz.
        // Basit delegation:
        availableContainer.onclick = (e) => {
            if (e.target.classList.contains('add-modal-class')) {
                const cls = e.target.dataset.class;
                this.addClassFromModal(cls);
            }
        };
    }

    addClassFromModal(cls) {
        if (!this.state.niceClasses.includes(cls)) {
            this.state.niceClasses.push(cls);
            this.state.goodsAndServicesMap[cls] = ''; // Boş içerik başlat
            
            // UI Güncelle ve Modalı Kapat
            this.renderNiceEditor();
            
            if (window.$ && window.$.fn.modal) {
                $(this.elements.niceClassModal).modal('hide');
            } else {
                this.elements.niceClassModal.style.display = 'none';
            }
        }
    }

    // --- BÜLTENLER ---
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

    // --- KAYDETME ---

    async saveAllChanges() {
        if (!this.state.selectedRecordId) return;

        this.elements.btnSaveAll.disabled = true;
        this.elements.btnSaveAll.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Kaydediliyor...';

        try {
            // Nice sınıfları formatını hazırla
            const sortedClasses = [...this.state.niceClasses].sort((a, b) => Number(a) - Number(b));
            const goodsAndServicesByClass = sortedClasses.map(classNo => ({
                classNo: Number(classNo),
                items: (this.state.goodsAndServicesMap[classNo] || '').split('\n').filter(i => i.trim() !== '')
            }));

            const updates = {
                status: this.elements.registryStatus ? this.elements.registryStatus.value : '',
                applicationDate: this.elements.appDate ? this.elements.appDate.value : '',
                registrationNumber: this.elements.regNo ? this.elements.regNo.value : '',
                registrationDate: this.elements.regDate ? this.elements.regDate.value : '',
                renewalDate: this.elements.renewalDate ? this.elements.renewalDate.value : '',
                bulletins: this.state.bulletins,
                niceClasses: sortedClasses, // Sadece sınıf numaraları dizisi
                goodsAndServicesByClass: goodsAndServicesByClass, // Detaylı içerik
                updatedAt: new Date().toISOString()
            };

            await updateDoc(doc(db, 'ipRecords', this.state.selectedRecordId), updates);
            showNotification('Kayıt ve portföy başarıyla güncellendi!', 'success');
            
            // UI Temizliği yapmaya gerek yok, kullanıcı değişikliği görsün.

        } catch (error) {
            console.error('Save Error:', error);
            showNotification('Hata: ' + error.message, 'error');
        } finally {
            this.elements.btnSaveAll.disabled = false;
            this.elements.btnSaveAll.textContent = 'Tüm Değişiklikleri Kaydet';
        }
    }
}

// Global başlatma
document.addEventListener('DOMContentLoaded', () => {
    // Hem eski input'u (recordSearchInput) hem de yeni sayfadaki select'i (detectedType) kontrol et
    if (document.getElementById('recordSearchInput') || document.getElementById('detectedType')) {
        window.portfolioUpdateManager = new PortfolioUpdateManager();
    }
});