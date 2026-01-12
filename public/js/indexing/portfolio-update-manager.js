// public/js/indexing/portfolio-update-manager.js

import { db, ipRecordsService } from '../../firebase-config.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { showNotification, debounce, STATUSES } from '../../utils.js';
import { getSelectedNiceClasses, setSelectedNiceClasses } from '../nice-classification.js';

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

        // --- 3. Buton Dinleyicileri ---
        // Merkezi Nice modalını açar
        if (this.elements.btnNiceAddModal) {
            this.elements.btnNiceAddModal.addEventListener('click', () => this.openNiceModal());
        }

        // Kaydetme butonunu tetikler (3. Adım burada devreye girecek)
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
        const selectEl = this.elements.childTransactionType;
        if (!selectEl) return;
        const typeValue = selectEl.value; 
        let typeText = '';
        if (selectEl.selectedIndex !== -1 && selectEl.options[selectEl.selectedIndex]) {
            typeText = selectEl.options[selectEl.selectedIndex].text.toLowerCase();
        }

        // 45 ID'si veya metin kontrolü
        const isRegistration = (typeValue === '45') || typeText.includes('tescil belgesi') || typeText.includes('registration certificate');

        if (this.elements.registryEditorSection) {
            if (isRegistration) {
                this.elements.registryEditorSection.style.display = 'block';
                this.initDatePickers();
                setTimeout(() => {
                    this.elements.registryEditorSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
                showNotification('📝 Tescil ve Sınıf düzenleme alanı açıldı.', 'info');
            } else {
                this.elements.registryEditorSection.style.display = 'none';
            }
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
        
        // --- Statüleri Doldur ---
        this.populateStatusDropdown(r.status);

        if(this.elements.appDate) this.elements.appDate.value = r.applicationDate || '';
        if(this.elements.regNo) this.elements.regNo.value = r.registrationNumber || '';
        if(this.elements.regDate) this.elements.regDate.value = r.registrationDate || '';
        if(this.elements.renewalDate) this.elements.renewalDate.value = r.renewalDate || '';

        // HATA KAYNAĞI: Fonksiyonların doğru çağrılması
        this.renderBulletins();
        // Merkezi Nice editörünü başlat (eğer kayıtlı veri varsa yükle)
        if (r.goodsAndServicesByClass) {
            const formattedClasses = r.goodsAndServicesByClass.map(g => 
                g.items.map(item => `(${g.classNo}-1) ${item}`).join('\n')
            ).flat();
            setSelectedNiceClasses(formattedClasses);
        } 
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
            // Eğer listede 'registered' var ama gelen 'Registered' ise yukarıda eşleşmiş olmalıydı.
            // Buraya düştüyse tamamen farklı bir statüdür.
            const option = document.createElement('option');
            option.value = currentStatus;
            option.textContent = currentStatus; // Olduğu gibi göster
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

        // Butonu yükleniyor moduna al
        if (this.elements.btnSaveAll) {
            this.elements.btnSaveAll.disabled = true;
            this.elements.btnSaveAll.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Kaydediliyor...';
        }

        try {
            // --- 1. Merkezi Editörden Güncel Verileri Çek ---
            // Merkezi nice-classification.js içindeki verileri dizi olarak alıyoruz
            const selectedNiceData = getSelectedNiceClasses(); 
            const tempMap = {};

            // --- 2. Veriyi Ayrıştır ve Grupla ---
            // Gelen veriler şu formatta: "(1-1) Madde Metni..."
            selectedNiceData.forEach(str => {
                const match = str.match(/^\((\d+)(?:-\d+)?\)\s*([\s\S]*)$/);
                if (match) {
                    const classNo = match[1]; // Sınıf numarası (örn: "5")
                    const content = match[2]; // Kullanıcının girdiği metin
                    
                    if (!tempMap[classNo]) tempMap[classNo] = [];
                    
                    // Metni satırlara böl, boşlukları temizle ve boş satırları filtrele
                    const items = content.split('\n')
                                        .map(i => i.trim())
                                        .filter(i => i !== '');
                    
                    tempMap[classNo].push(...items);
                }
            });

            // --- 3. Firestore Formatına Dönüştür ---
            // Mal ve Hizmet Listesi (Array of Objects)
            const goodsAndServicesByClass = Object.entries(tempMap).map(([num, items]) => ({
                classNo: Number(num),
                items: items
            })).sort((a, b) => a.classNo - b.classNo);

            // Flat Sınıf Listesi (örn: ["1", "5", "35"])
            const sortedNiceClasses = Object.keys(tempMap).sort((a, b) => Number(a) - Number(b));

            // --- 4. Güncelleme Paketini Hazırla ---
            const updates = {
                status: this.elements.registryStatus ? this.elements.registryStatus.value : '',
                applicationDate: this.elements.appDate ? this.elements.appDate.value : '',
                registrationNumber: this.elements.regNo ? this.elements.regNo.value : '',
                registrationDate: this.elements.regDate ? this.elements.regDate.value : '',
                renewalDate: this.elements.renewalDate ? this.elements.renewalDate.value : '',
                bulletins: this.state.bulletins,
                niceClasses: sortedNiceClasses, // Güncellenmiş sınıf listesi
                goodsAndServicesByClass: goodsAndServicesByClass, // Güncellenmiş detaylı liste
                updatedAt: new Date().toISOString()
            };

            // --- 5. Veritabanına Yaz ---
            await updateDoc(doc(db, 'ipRecords', this.state.selectedRecordId), updates);
            
            showNotification('Portföy bilgileri başarıyla güncellendi!', 'success');

        } catch (error) {
            console.error('Save Error:', error);
            showNotification('Kaydedilirken bir hata oluştu: ' + error.message, 'error');
        } finally {
            // Butonu eski haline getir
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