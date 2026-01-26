// public/js/indexing/portfolio-update-manager.js

import { db, ipRecordsService } from '../../firebase-config.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { showNotification, debounce, STATUSES } from '../../utils.js';
import { getSelectedNiceClasses, setSelectedNiceClasses, initializeNiceClassification } from '../nice-classification.js';

export class PortfolioUpdateManager {
    constructor() {
        this.state = {
            selectedRecordId: null,
            recordData: null,
            // Ana işlem seçimine göre (örn: 6, 17) alt işlem 40 seçildiğinde de
            // tescil/nice düzenleme formunu açabilmek için işlem geçmişini tutuyoruz.
            currentTransactions: [],
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
            parentTransactionSelect: $('parentTransactionSelect'),

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

        // Nice modülünü indeksleme sayfası için aktif hale getir
        initializeNiceClassification();

        document.addEventListener('record-selected', (e) => {
            if (e.detail && e.detail.recordId) {
                this.selectRecord(e.detail.recordId);
            }
        });
    }

    renderInitialState() {
        if (this.elements.detailsContainer) this.elements.detailsContainer.style.display = 'none';
        if (this.elements.registryEditorSection) this.elements.registryEditorSection.style.display = 'none';
    }

    setupEventListeners() {
        // --- 1. Arama ve Seçim Dinleyicileri ---
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

        // --- 2. İşlem Tipi Değişim Dinleyicisi (Tescil Belgesi Kontrolü) ---
        if (this.elements.childTransactionType) {
            this.elements.childTransactionType.addEventListener('change', () => {
                this.handleTransactionTypeChange();
            });
        }

        // Ana işlem değiştiğinde de (özellikle alt işlem 40 seçiliyken)
        // formun görünürlüğünü tekrar hesapla.
        if (this.elements.parentTransactionSelect) {
            this.elements.parentTransactionSelect.addEventListener('change', () => {
                this.handleTransactionTypeChange();
            });
        }

        // --- 3. Buton Dinleyicileri ---
        // Merkezi Nice modalını açar
        if (this.elements.btnNiceAddModal) {
            this.elements.btnNiceAddModal.addEventListener('click', () => this.openNiceModal());
        }

        // Kaydetme butonunu tetikler
        if (this.elements.btnSaveAll) {
            this.elements.btnSaveAll.addEventListener('click', () => this.saveAllChanges());
        }

        // Bülten ekleme butonu
        if (this.elements.btnAddBulletin) {
            this.elements.btnAddBulletin.addEventListener('click', () => this.addBulletin());
        }

        // --- 4. Global Silme Dinleyicileri ---
        document.addEventListener('click', (e) => {
            // Bülten silme
            if (e.target.matches('.delete-bulletin-btn')) {
                this.removeBulletin(e.target.dataset.index);
            }

            // Sınıf silme (Merkezi yapıya yönlendirilir)
            if (e.target.matches('[data-remove-class]') || e.target.closest('[data-remove-class]')) {
                const btn = e.target.closest('[data-remove-class]');
                this.removeNiceClass(btn.getAttribute('data-remove-class'));
            }
        });

        // NOT: Eski "ACCORDION DÜZELTMESİ" bloğu tamamen kaldırıldı.
        // Çünkü bu işlemler artık merkezi nice-classification.js içinde yapılıyor.
    }

    handleTransactionTypeChange() {
        if (!this.elements.childTransactionType || !this.elements.registryEditorSection) return;

        const selectedOption =
            this.elements.childTransactionType.options[this.elements.childTransactionType.selectedIndex];
        const typeId = String(this.elements.childTransactionType.value || '');
        const typeText = selectedOption ? String(selectedOption.text || '').toLowerCase() : '';

        // Parent işlem tipini bul
        // NOT: parent select'in value'su "transactionId" olduğu için state.currentTransactions'tan çözümlüyoruz
        let parentTypeId = '';
        const parentTxId = this.elements.parentTransactionSelect
            ? String(this.elements.parentTransactionSelect.value || '')
            : '';

        if (parentTxId && Array.isArray(this.state.currentTransactions)) {
            const parentTx = this.state.currentTransactions.find((t) => String(t.id) === parentTxId);
            if (parentTx) parentTypeId = String(parentTx.type || '');
        }

        // A) Alt işlem 45 (Tescil Belgesi)
        // B) Alt işlem metninde "tescil belgesi" geçiyorsa
        // C) Alt işlem 40 (Kabul) ve ana işlem tipi 6 veya 17 ise
        const isRegistry =
            typeId === '45' ||
            typeText.includes('tescil belgesi') ||
            (typeId === '40' && (parentTypeId === '6' || parentTypeId === '17'));

        if (isRegistry) {
            this.elements.registryEditorSection.style.display = 'block';

            const r = this.state.recordData;
            if (r && r.goodsAndServicesByClass) {
                const formatted = r.goodsAndServicesByClass.map(
                    (g) => `(${g.classNo}-1) ${g.items ? g.items.join('\n') : ''}`
                );

                // UI'ın (DOM) hazır olduğundan emin olmak için kısa bir gecikme
                setTimeout(() => {
                    setSelectedNiceClasses(formatted);
                }, 100);
            }
        } else {
            this.elements.registryEditorSection.style.display = 'none';
        }
    }

    initDatePickers() {
        if (typeof flatpickr !== 'undefined') {
            flatpickr(".datepicker", {
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "d.m.Y",
                locale: "tr",
                allowInput: true
            });
        }
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

            // Ana işlem tipini kontrol edebilmek için işlem geçmişini de çek
            try {
                const txResult = await ipRecordsService.getRecordTransactions(id);
                this.state.currentTransactions = txResult.success ? (txResult.data || []) : [];
            } catch (e) {
                console.warn('İşlem geçmişi yüklenemedi (registry form kontrolü için):', e);
                this.state.currentTransactions = [];
            }

            this.parseNiceClassesFromData(data);

            if (this.elements.selectedDisplay) this.renderSelectedRecordUI();

            // Verileri doldur
            this.populateFormFields();

            if (this.elements.detailsContainer) this.elements.detailsContainer.style.display = 'block';

            // Eğer işlem tipi zaten seçiliyse formu kontrol et
            if (this.elements.childTransactionType && this.elements.childTransactionType.value) {
                this.handleTransactionTypeChange();
            }

        } catch (error) {
            console.error('PortfolioManager Kayıt Yükleme Hatası:', error);
            showNotification('Kayıt verileri yüklenirken hata oluştu', 'error');
        }
    }

    populateFormFields() {
        const r = this.state.recordData;
        if (!r) return;

        // Standart alanları doldur
        if (this.elements.registryStatus) this.populateStatusDropdown(r.status);
        if (this.elements.appDate) this.elements.appDate.value = r.applicationDate || '';
        if (this.elements.regNo) this.elements.regNo.value = r.registrationNumber || '';
        if (this.elements.regDate) this.elements.regDate.value = r.registrationDate || '';
        if (this.elements.renewalDate) this.elements.renewalDate.value = r.renewalDate || '';

        this.renderBulletins();

        // İşlem tipini kontrol ederek Nice editörünü ve diğer alanları tetikle
        this.handleTransactionTypeChange();
    }

    populateStatusDropdown(currentStatus) {
        const select = this.elements.registryStatus;
        if (!select) return;

        select.innerHTML = '<option value="">Seçiniz...</option>';
        const statuses = STATUSES.trademark || [];

        // Mevcut statüyü normalize et (küçük harfe çevir)
        const normalizedCurrent = currentStatus ? currentStatus.toLowerCase() : '';

        let found = false;
        statuses.forEach(st => {
            const option = document.createElement('option');
            option.value = st.value;
            option.textContent = st.text;

            // Eşleşme kontrolü (küçük harf duyarsız)
            if (st.value.toLowerCase() === normalizedCurrent) {
                option.selected = true;
                found = true;
            }
            select.appendChild(option);
        });

        // Eğer listede yoksa ve bir değer varsa, onu da ekle (ama listedekiyle çakışmadığından emin ol)
        if (currentStatus && !found) {
            const option = document.createElement('option');
            option.value = currentStatus;
            option.textContent = currentStatus;
            option.selected = true;
            select.appendChild(option);
        }
    }

    parseNiceClassesFromData(data) {
        const gsList = data.goodsAndServicesByClass || [];
        this.state.goodsAndServicesMap = gsList.reduce((acc, curr) => {
            acc[String(curr.classNo)] = (curr.items || []).join('\n');
            return acc;
        }, {});

        let nClasses = data.niceClasses || [];
        if (!nClasses.length && gsList.length > 0) nClasses = gsList.map(item => String(item.classNo));
        if (!nClasses.length && data.niceClass) nClasses = Array.isArray(data.niceClass) ? data.niceClass.map(String) : [String(data.niceClass)];
        this.state.niceClasses = nClasses.map(String);
    }

    // --- Helper Metodlar ---

    async handleSearch(query) { /* ... */ }
    renderSearchResults(results) { /* ... */ }
    clearSelection() { /* ... */ }
    renderSelectedRecordUI() { /* ... */ }

    removeNiceClass(classNo) {
        // Direkt merkezi temizleme fonksiyonunu çağırıyoruz
        if (typeof window.clearClassSelection === 'function') {
            window.clearClassSelection(classNo);
        }
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

        this.elements.niceModalAvailableClasses.onclick = (e) => {
            const btn = e.target.closest('.add-modal-class');
            if (btn) this.addClassFromModal(btn.dataset.class);
        };

        if (window.$ && window.$.fn.modal) {
            $(this.elements.niceClassModal).modal('show');
        } else {
            this.elements.niceClassModal.style.display = 'block';
            this.elements.niceClassModal.classList.add('show');
        }
    }

    addClassFromModal(cls) {
        // Merkezi Nice editörüne yeni bir sınıf (boş içerikle) ekle
        const currentData = getSelectedNiceClasses();
        const newItem = `(${cls}-1) `;
        setSelectedNiceClasses([...currentData, newItem]);

        // Modalı kapat
        if (window.$ && window.$.fn.modal) {
            $(this.elements.niceClassModal).modal('hide');
        } else {
            this.elements.niceClassModal.style.display = 'none';
            this.elements.niceClassModal.classList.remove('show');
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

        try {
            const selectedNiceData = getSelectedNiceClasses();
            const goodsAndServicesByClass = [];
            const niceClasses = [];

            selectedNiceData.forEach(str => {
                const match = str.match(/^\((\d+)(?:-\d+)?\)\s*([\s\S]*)$/);
                if (match) {
                    const classNo = Number(match[1]);
                    const content = match[2];

                    // Sınıf listesini doldur
                    niceClasses.push(String(classNo));

                    // Satırlara böl, temizle, boş satırları at
                    const items = content.split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0);

                    goodsAndServicesByClass.push({
                        classNo: classNo,
                        items: items
                    });
                }
            });

            const updates = {
                // ... diğer alanlar ...
                niceClasses: niceClasses.sort((a, b) => Number(a) - Number(b)),
                goodsAndServicesByClass: goodsAndServicesByClass.sort((a, b) => a.classNo - b.classNo),
                updatedAt: new Date().toISOString()
            };

            await updateDoc(doc(db, 'ipRecords', this.state.selectedRecordId), updates);
            showNotification('Değişiklikler başarıyla kaydedildi!', 'success');

        } catch (error) {
            // Hata yönetimi...
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('recordSearchInput') || document.getElementById('detectedType')) {
        window.portfolioUpdateManager = new PortfolioUpdateManager();
    }
});
