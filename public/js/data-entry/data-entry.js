// js/data-entry/data-entry.js

// 1. Bir üst klasöre (js/) çıkıp oradaki dosyaları çağırıyoruz
import { initializeNiceClassification, getSelectedNiceClasses, setSelectedNiceClasses } from '../nice-classification.js';
import { loadSharedLayout, openPersonModal, ensurePersonModal } from '../layout-loader.js';

// 2. İki üst klasöre (ana dizine) çıkıp oradaki dosyaları çağırıyoruz
// (Eski kodunda '../' idi, şimdi bir klasör daha indiğimiz için '../../' oldu)
import { personService, ipRecordsService, storage, auth, transactionTypeService } from '../../firebase-config.js';
import { STATUSES, ORIGIN_TYPES } from '../../utils.js';

// 3. Aynı klasördeki (js/data-entry/) kardeş dosyaları çağırıyoruz (Bunlar ./ kalır)
import { FormTemplates } from './form-templates.js';
import { TrademarkStrategy, PatentStrategy, DesignStrategy, SuitStrategy } from './strategies.js';

// 4. CDN (https://...) linkleri olduğu gibi kalır, değişiklik gerekmez
import { getStorage, ref, uploadBytes, deleteObject, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { collection, doc, getDoc, getDocs, getFirestore, query, where , updateDoc,  addDoc, Timestamp} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"; 

function __pathFromDownloadURL(url) {
  try {
    const m = String(url).match(/\/o\/(.+?)\?/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch (e) { return null; }
}

class DataEntryModule {
    
    // === BEGIN: WIPO/ARIPO Child Propagation Helpers ===
    setupChildPropagationModal() {
      this._childModal = {
        root: document.getElementById('childPropagationModal'),
        backdrop: document.getElementById('childPropagationBackdrop'),
        list: document.getElementById('childPropList'),
        listEmpty: document.getElementById('childPropListEmpty'),
        btnApply: document.getElementById('childPropApply'),
        btnCancel: document.getElementById('childPropCancel'),
        btnClose: document.getElementById('childPropCloseBtn'),
        checkAll: document.getElementById('childPropSelectAll'),
        txtIR: document.getElementById('childPropIR'),
        txtOrigin: document.getElementById('childPropOrigin')
      };
      const hide = () => {
        this._childModal.root.style.display = 'none';
        this._childModal.backdrop.style.display = 'none';
      };
      const onCancel = () => { hide(); if (this._childModal._resolver) this._childModal._resolver([]); };
      this._childModal.btnCancel?.addEventListener('click', onCancel);
      this._childModal.btnClose?.addEventListener('click', onCancel);
      this._childModal.checkAll?.addEventListener('change', (e) => {
        this._childModal.list.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = e.target.checked; });
      });
      this._childModal.btnApply?.addEventListener('click', () => {
        const selected = Array.from(this._childModal.list.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
        hide();
        if (this._childModal._resolver) this._childModal._resolver(selected);
      });
    }

    async openChildPropagationModalAndWait(parentRecord) {
      const origin = String(parentRecord.origin || '').toUpperCase();
      const isWipo = origin === 'WIPO';
      const irNumber = isWipo ? parentRecord.wipoIR : parentRecord.aripoIR;
      if (!irNumber) return [];
      const children = await this.fetchChildrenByIR(origin, String(irNumber || ''));
      this._childModal.txtIR.textContent = irNumber || '-';
      this._childModal.txtOrigin.textContent = origin;
      this._childModal.list.innerHTML = '';

      if (!children.length) {
        this._childModal.listEmpty.style.display = 'block';
      } else {
        this._childModal.listEmpty.style.display = 'none';
        const html = children.map(ch => {
          const name = this.findCountryName?.(ch.country) || ch.country;
          return `<label class="country-chip"><input type="checkbox" value="${ch.country}" checked> ${name}</label>`;
        }).join('');
        this._childModal.list.innerHTML = html;
      }
      this._childModal.backdrop.style.display = 'block';
      this._childModal.root.style.display = 'flex';

      return new Promise((resolve) => { this._childModal._resolver = resolve; });
    }

    async fetchChildrenByIR(origin, irNumber) {
      if (!['WIPO','ARIPO'].includes(String(origin).toUpperCase()) || !irNumber) return [];
      const db = getFirestore();
      const colRef = collection(db, 'ipRecords');
      const isWipo = String(origin).toUpperCase() === 'WIPO';
      const qy = query(
        colRef,
        where('transactionHierarchy', '==', 'child'),
        where('origin', '==', String(origin).toUpperCase()),
        where(isWipo ? 'wipoIR' : 'aripoIR', '==', String(irNumber))
      );
      const snap = await getDocs(qy);
      const out = [];
      snap.forEach(d => out.push({ id: d.id, ...d.data() }));
      return out;
    }

    findCountryName(code) {
      const arr = this.allCountries || [];
      const c = arr.find(x => String(x.code).toUpperCase() === String(code).toUpperCase());
      return c?.name;
    }

    mapParentFieldsForChildForPropagation(parentFields) {
    const allowed = [
        'status','brandText','description','renewalDate','goodsAndServices','updatedAt',
        'applicationDate','registrationDate','wipoIR','aripoIR' // Bu alanları ekle
    ];
    const out = {};
    for (const k of allowed) {
        if (k in parentFields && parentFields[k] !== null && parentFields[k] !== undefined) {
        out[k] = parentFields[k];
        }
    }
    console.log('🎯 Child\'lara aktarılacak alanlar:', out);
    return out;
    }

    // Collect current form fields relevant for parent/child propagation

    // Collect current form fields relevant for parent/child propagation
    collectPortfolioFields() {
    const origin = String(document.getElementById('originSelect')?.value || '').toUpperCase();
    const isWipo = origin === 'WIPO';
    const registrationNumber = document.getElementById('registrationNumber')?.value?.trim() || null;
    const status = document.getElementById('trademarkStatus')?.value || null;
    const brandText = document.getElementById('brandExampleText')?.value?.trim() || null;
    const description = document.getElementById('brandDescription')?.value?.trim() || null;
    const renewalDate = document.getElementById('renewalDate')?.value || null;
    
    // ÖNEMLİ: Tarih alanlarını da ekle
    const applicationDate = document.getElementById('applicationDate')?.value || null;
    const registrationDate = document.getElementById('registrationDate')?.value || null;
    
    let goodsAndServices = null;
    try {
        if (typeof getSelectedNiceClasses === 'function') goodsAndServices = getSelectedNiceClasses();
    } catch(e) {}
    
    const out = {
        origin: origin || null,
        status, brandText, description, renewalDate,
        applicationDate, registrationDate, // Bu alanları ekle
        goodsAndServices,
        updatedAt: new Date().toISOString()
    };
    
    if (registrationNumber) {
        if (isWipo) out.wipoIR = registrationNumber;
        else if (origin === 'ARIPO') out.aripoIR = registrationNumber;
    }
    
    console.log('📊 Toplanan form alanları:', out);
    return out;
    }
    // Apply updates from parent to selected child countries (WIPO/ARIPO)
    async propagateToSelectedChildren(parentRecord, selectedCountries, parentUpdateFields) {
      try {
        const origin = String(parentRecord.origin || '').toUpperCase();
        if (!['WIPO','ARIPO'].includes(origin)) return {updated:0};
        const isWipo = origin === 'WIPO';
        const oldIR = (isWipo ? parentRecord.wipoIR : parentRecord.aripoIR) || null;
        const newIR = isWipo ? parentUpdateFields.wipoIR : parentUpdateFields.aripoIR;
        const irToQuery = String(oldIR || newIR || '');
        if (!irToQuery) return {updated:0};

        const children = await this.fetchChildrenByIR(origin, irToQuery);
        const setSel = new Set((selectedCountries||[]).map(c => String(c).toUpperCase()));
        const patchBase = this.mapParentFieldsForChildForPropagation(parentUpdateFields);
        // also map IR if changed
        if (newIR && newIR !== oldIR) {
          if (isWipo) patchBase.wipoIR = String(newIR);
          else patchBase.aripoIR = String(newIR);
        }
        let updated = 0;
        for (const ch of children) {
          if (!ch?.id || !ch?.country) continue;
          if (!setSel.has(String(ch.country).toUpperCase())) continue;
          await ipRecordsService.updateRecord(String(ch.id), { ...patchBase, updatedAt: new Date().toISOString() });
          updated++;
        }
        console.debug('Child propagation done. Updated:', updated);
        return {updated};
      } catch (e) {
        console.warn('propagateToSelectedChildren error:', e);
        return {updated:0, error:String(e)};
      }
    }
    
// === END: WIPO/ARIPO Child Propagation Helpers ===
    
constructor() {
        this.ipTypeSelect = document.getElementById('ipTypeSelect');
        this.dynamicFormContainer = document.getElementById('dynamicFormContainer');
        this.saveBtn = document.getElementById('savePortfolioBtn');
        this.selectedApplicants = [];
        this.priorities = []; // Rüçhan bilgileri için
        this.isNiceInitialized = false;
        this.uploadedBrandImage = null;
        this.allPersons = [];
        this.recordOwnerTypeSelect = document.getElementById('recordOwnerType');
        this.editingRecordId = null;
        this.allCountries = [];
        this.currentIpType = null;
        this.selectedCountries = [];
        this.allTransactionTypes = []; 
        this.suitClientPerson = null;
        this.suitSpecificTaskType = null;
        this.authService = auth;
        this.strategies = {
        'trademark': new TrademarkStrategy(),
        'patent': new PatentStrategy(),
        'design': new DesignStrategy(),
        'suit': new SuitStrategy()
    };
    }

async init() {
        this.setupChildPropagationModal && this.setupChildPropagationModal();
console.log('🚀 Data Entry Module başlatılıyor...');
        try {
            await this.loadAllData();
            
            // ✅ YENİ: Menşe açılır listesini doldur ve varsayılan değeri ayarla.
            this.currentIpType = this.ipTypeSelect.value || 'trademark';
            this.populateOriginDropdown('originSelect', 'TÜRKPATENT', this.currentIpType);
            this.handleOriginChange(document.getElementById('originSelect').value);

            this.setupEventListeners();
            this.setupModalCloseButtons();

            // ✅ Yeni: URL'den kayıt ID'sini kontrol et ve kaydı yükle
            await this.loadRecordForEditing();

        } catch (error) {
            console.error('Data Entry Module init hatası:', error);
        }
    }

async loadAllData() {
    try {
        const [personsResult, countriesResult, transactionTypesResult] = await Promise.all([
            personService.getPersons(),
            this.getCountries(),
            this.getTaskTypes(), // Yeni: Task types çekildi
        ]);
        
        this.allPersons = personsResult.success ? personsResult.data : [];
        this.allCountries = countriesResult; 
        
        console.log('📊 Tüm veriler yüklendi:', this.allPersons.length, 'kişi,', this.allCountries.length, 'ülke,', this.allTransactionTypes.length, 'iş tipi.');
    } catch (error) {
        console.error('Veriler yüklenirken hata:', error);
        this.allPersons = [];
        this.allCountries = [];
        this.allTransactionTypes = [];
    }
}

    setupEventListeners() {
            console.log('🎯 Event listener kuruluyor...');
            
        if (this.ipTypeSelect) {
            this.ipTypeSelect.addEventListener('change', (e) => {
                this.handleIPTypeChange(e.target.value);
            });
        }
        
        // ✅ YENİ: Origin değiştiğinde tetiklenecek event
        const originSelect = document.getElementById('originSelect');
        if(originSelect){
            originSelect.addEventListener('change', (e) => {
                this.handleOriginChange(e.target.value);
            });
        }
        
        // ✅ YENİ EKLENECEK: İş Tipi değiştiğinde tetiklenecek event
        const specificTaskType = document.getElementById('specificTaskType');
        if (specificTaskType) {
            specificTaskType.addEventListener('change', (e) => {
                this.handleSpecificTaskTypeChange(e);
            });
        }

            if (this.saveBtn) {
                this.saveBtn.addEventListener('click', () => {
                    this.handleSavePortfolio();
                });
            }
            if (this.recordOwnerTypeSelect) {
                this.recordOwnerTypeSelect.addEventListener('change', () => {
                    this.updateSaveButtonState();
                });
            }
        }

// YENİ KOD (Değiştirilmesi Gereken Kısım)
populateOriginDropdown(dropdownId, selectedValue = 'TÜRKPATENT', ipType) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    
    let filteredOrigins = ORIGIN_TYPES;
    
    // Dava (suit) için menşe seçeneklerini filtrele
    if (ipType === 'suit') {
        filteredOrigins = ORIGIN_TYPES.filter(origin => 
            origin.value === 'TÜRKPATENT' || origin.value === 'Yurtdışı Ulusal'
        ).map(origin => {
             // Dava için menşe isimlerini ve değerlerini değiştir
            if(origin.value === 'TÜRKPATENT') return { value: 'TURKEY_NATIONAL', text: 'TÜRKİYE' };
            if(origin.value === 'Yurtdışı Ulusal') return { value: 'FOREIGN_NATIONAL', text: 'Yurtdışı' };
            return origin;
        });
        // Varsayılan değeri Dava tiplerine uygun olarak güncelle
        selectedValue = selectedValue === 'TÜRKPATENT' ? 'TURKEY_NATIONAL' : selectedValue;
    }

    dropdown.innerHTML = ''; // Önceki seçenekleri temizle
    
    // Menüde en üstte "Seçiniz" seçeneği her zaman olsun
    const selectOption = document.createElement('option');
    selectOption.value = "";
    selectOption.textContent = "Seçiniz...";
    dropdown.appendChild(selectOption);

    filteredOrigins.forEach(origin => {
        const option = document.createElement('option');
        option.value = origin.value;
        option.textContent = origin.text;
        if (origin.value === selectedValue) {
            option.selected = true;
        }
        // TÜRKPATENT/TURKEY_NATIONAL'ı varsayılan olarak seç
        if (ipType === 'suit' && origin.value === 'TURKEY_NATIONAL') {
            option.selected = true;
        } else if (ipType !== 'suit' && origin.value === 'TÜRKPATENT') {
             option.selected = true;
        }
        
        // Eğer seçili bir değer varsa, onu kullan
        if (selectedValue) {
             option.selected = (origin.value === selectedValue);
        }
        
        // Menüde Selectiniz seçeneği yoksa (eklendi) ve bu ilk seçenek değilse ekle
        if (origin.value) {
            dropdown.appendChild(option);
        }
    });
    
    // Menşe değişimi event'ini tetikle
    dropdown.dispatchEvent(new Event('change'));
}
   
handleOriginChange(originType) {
        const countrySelectionContainer = document.getElementById('countrySelectionContainer');
        const singleSelectWrapper = document.getElementById('singleCountrySelectWrapper');
        const multiSelectWrapper = document.getElementById('multiCountrySelectWrapper');
        const title = document.getElementById('countrySelectionTitle');

        if (!countrySelectionContainer || !singleSelectWrapper || !multiSelectWrapper || !title) return;

        const ipType = document.getElementById('ipTypeSelect')?.value;
        const isLawsuit = ipType === 'suit';

        this.selectedCountries = [];
        countrySelectionContainer.style.display = 'none';
        singleSelectWrapper.style.display = 'none';
        multiSelectWrapper.style.display = 'none';

        // Dava ve Yurtdışı menşe
        if (isLawsuit && originType === 'FOREIGN_NATIONAL') {
            title.textContent = 'Menşe Ülke Seçimi (Dava)';
            countrySelectionContainer.style.display = 'block';
            singleSelectWrapper.style.display = 'block';
            this.populateCountriesDropdown('countrySelect');
        } 
        // ORİJİNAL KOŞUL: Marka/Patent/Tasarım
        else if (originType === 'Yurtdışı Ulusal' && ipType !== 'suit') {
            title.textContent = 'Menşe Ülke Seçimi';
            countrySelectionContainer.style.display = 'block';
            singleSelectWrapper.style.display = 'block';
            this.populateCountriesDropdown('countrySelect');
        } else if ((originType === 'WIPO' || originType === 'ARIPO') && ipType !== 'suit') {
            title.textContent = `Seçim Yapılacak Ülkeler (${originType})`;
            countrySelectionContainer.style.display = 'block';
            multiSelectWrapper.style.display = 'block';
            this.setupMultiCountrySelect();
        }
    }

    setupModalCloseButtons() {
        const cancelPersonBtn = document.getElementById('cancelPersonBtn');
        if (cancelPersonBtn) {
            cancelPersonBtn.addEventListener('click', () => this.hideAddPersonModal());
        }
        
        const savePersonBtn = document.getElementById('savePersonBtn');
        if (savePersonBtn) {
            savePersonBtn.addEventListener('click', () => this.saveNewPerson());
        }
    }

    hideAddPersonModal() {
        const personModal = document.getElementById('personModal');
        if (personModal) {
            personModal.classList.remove('show');
            document.body.classList.remove('modal-open');
        }
    }

handleIPTypeChange(ipType) {
    console.log('📋 IP türü değişti:', ipType);
    
    this.currentIpType = ipType;
    
    const isSuit = ipType === 'suit';
    const ownerCard = document.getElementById('ownerCard');
    const specificTaskTypeWrapper = document.getElementById('specificTaskTypeWrapper');
    const originSelectWrapper = document.getElementById('originSelectWrapper');
    const suitSpecificFieldsCard = document.getElementById('suitSpecificFieldsCard');
    const dynamicFormContainer = document.getElementById('dynamicFormContainer');
    // Not: Müvekkil kartı, renderSuitClientSection içinde suitSpecificFieldsCard'dan önce eklendiği için
    // doğru bir şekilde seçilmesi gerekir.
    const clientSection = document.querySelector('.card.mb-4[id="clientSection"]'); 
    
    // Temizle
    dynamicFormContainer.innerHTML = '';
    if (clientSection) clientSection.remove(); // Önceki müvekkil kartını kaldır
    document.getElementById('countrySelectionContainer').style.display = 'none';

    // 1. Kayıt Sahibi (Owner) Alanı Kontrolü (Dava seçildiğinde gizle)
    if (ownerCard) {
        ownerCard.style.display = isSuit ? 'none' : 'block';
    }

    if (isSuit) {
        // Dava tipi seçildi:
        specificTaskTypeWrapper.style.display = 'block';
        originSelectWrapper.style.display = 'block';
        suitSpecificFieldsCard.style.display = 'block';
        
        // Müvekkil bölümünü ekle (Bu aynı zamanda clientSection'ı DOM'a ekler)
        this.renderSuitClientSection(); 

        this.populateOriginDropdown('originSelect', 'TURKEY_NATIONAL', ipType); 

        // Spesifik İş Tipi doldurma (Dava için filtrelenmiş)
        this.populateSpecificTaskTypeDropdown(ipType);

        // İş Tipi seçilene kadar Dava Detayları boş kalır.
        suitSpecificFieldsCard.querySelector('#suitSpecificFieldsContainer').innerHTML = '';

    } else {
        // Marka/Patent/Tasarım seçildi
        specificTaskTypeWrapper.style.display = 'none';
        originSelectWrapper.style.display = 'block'; 
        suitSpecificFieldsCard.style.display = 'none';

        // Normal IP render fonksiyonunu çağır
        dynamicFormContainer.style.display = 'block';
        
        switch(ipType) {
            case 'trademark': this.renderTrademarkForm(); break;
            case 'patent': this.renderPatentForm(); break;
            case 'design': this.renderDesignForm(); break;
            default: dynamicFormContainer.innerHTML = ''; // IP türü seçilmezse temizle
        }

        // Orijinal Menşe Listesini doldur
        this.populateOriginDropdown('originSelect', 'TÜRKPATENT', ipType);
        this.handleOriginChange(document.getElementById('originSelect')?.value);

    }

    this.updateSaveButtonState();
}

    // === YENİ: `handleSpecificTaskTypeChange` Fonksiyonu ===
    handleSpecificTaskTypeChange(e) {
        const taskTypeId = e.target.value;
        const suitSpecificFieldsCard = document.getElementById('suitSpecificFieldsCard');
        this.suitSpecificTaskType = this.allTransactionTypes.find(t => t.id === taskTypeId);

        const container = document.getElementById('suitSpecificFieldsContainer');

        if (this.suitSpecificTaskType) {
            container.innerHTML = this.renderSuitFields(this.suitSpecificTaskType.alias || this.suitSpecificTaskType.name);
            this.setupSuitPersonSearchSelectors(); 
            
            // ✅ Date Picker'ı başlat
            setTimeout(() => {
                if (typeof window.EvrekaDatePicker !== 'undefined' && window.EvrekaDatePicker.init) {
                    window.EvrekaDatePicker.init(container);
                    console.log('✅ Dava tarihi date picker başlatıldı');
                }
                
                // Form alanı değişikliklerini dinle
                const suitOpeningDate = document.getElementById('suitOpeningDate');
                if (suitOpeningDate) {
                    suitOpeningDate.addEventListener('change', () => {
                        this.updateSaveButtonState();
                    });
                }
                
                // Diğer form alanları için de listener ekle
                ['clientRole', 'suitCourt', 'suitCaseNo'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.addEventListener('change', () => {
                            this.updateSaveButtonState();
                        });
                    }
                });
            }, 100);
        } else {
            container.innerHTML = '';
        }
        this.updateSaveButtonState();
    }

renderTrademarkForm() {
        console.log('🏷️ Marka formu render ediliyor...');
        
        // Template'den HTML'i al
        this.dynamicFormContainer.innerHTML = FormTemplates.getTrademarkForm();
        
        // Durum select'ini STATUSES.trademark ile doldur
        const stSel = document.getElementById('trademarkStatus');
        if (stSel) {
            const emptyOpt = '<option value="">Durum Seçiniz...</option>';
            const statusOptions = STATUSES.trademark
                .map(s => `<option value="${s.value}">${s.text}</option>`)
                .join('');
            stSel.innerHTML = emptyOpt + statusOptions;
            
            if (!this.editingRecordId) {
                stSel.value = '';
            }
        }

        this.setupDynamicFormListeners();
        this.setupBrandExampleUploader();
        this.setupClearClassesButton(); 
        this.populateCountriesDropdown();
        this.updateSaveButtonState();
        this.populateOriginDropdown('originSelect');
    }

renderPatentForm() {
        console.log('⚗️ Patent formu render ediliyor...');
        this.dynamicFormContainer.innerHTML = FormTemplates.getPatentForm();
        this.updateSaveButtonState();
        this.populateOriginDropdown('originSelect');
    }


renderDesignForm() {
        console.log('🎨 Tasarım formu render ediliyor...');
        this.dynamicFormContainer.innerHTML = FormTemplates.getDesignForm();
        this.updateSaveButtonState();
        this.populateOriginDropdown('originSelect');
    }

    setupDynamicFormListeners() {
        console.log('🎯 Dynamic form listeners kuruluyor...');
        
        // Tab değişim listener'ları - jQuery ve vanilla JS ikisini de deneyelim
        const tabLinks = document.querySelectorAll('#portfolioTabs a[data-toggle="tab"]');
        tabLinks.forEach(tabLink => {
            // Bootstrap tab event
            tabLink.addEventListener('shown.bs.tab', (e) => {
                const targetTab = e.target.getAttribute('href');
                console.log('📋 Tab değişti (Bootstrap):', targetTab);
                this.handleTabChange(targetTab);
            });
            
            // Tıklama eventi de ekleyelim
            tabLink.addEventListener('click', (e) => {
                const targetTab = e.target.getAttribute('href');
                console.log('📋 Tab tıklandı:', targetTab);
                setTimeout(() => {
                    this.handleTabChange(targetTab);
                }, 200);
            });
        });

        // jQuery varsa o da çalışsın
        if (window.$ && window.$('#portfolioTabs a[data-toggle="tab"]').length > 0) {
            window.$('#portfolioTabs a[data-toggle="tab"]').on('shown.bs.tab', (e) => {
                const targetTab = window.$(e.target).attr('href');
                console.log('📋 Tab değişti (jQuery):', targetTab);
                this.handleTabChange(targetTab);
            });
        }

        // Başvuru sahibi arama
        const applicantSearch = document.getElementById('applicantSearch');
        if (applicantSearch) {
            applicantSearch.addEventListener('input', (e) => {
                this.searchPersons(e.target.value, 'applicant');
            });
        }

        // Yeni kişi ekleme butonu
        const addApplicantBtn = document.getElementById('addApplicantBtn');
        if (addApplicantBtn) {
            addApplicantBtn.addEventListener('click', () => {
                // openPersonModal fonksiyonuna, yeni kişi kaydedildiğinde
                // çalışacak bir callback fonksiyonu gönderiyoruz.
                openPersonModal((newPerson) => {
                    // Callback çağrıldığında, yeni kişiyi
                    // ana kişi listemize (allPersons) ekliyoruz.
                    this.allPersons.push(newPerson);

                    // Ardından, bu kişiyi başvuru sahipleri listesine ekliyoruz.
                    this.addSelectedPerson(newPerson, 'applicant');

                    // Modalı kapat
                    this.hideAddPersonModal();

                    // Konsol çıktısı
                    console.log('✅ Yeni kişi eklendi:', newPerson);
                });
            });
        }

        // Rüçhan ekleme butonu
        const addPriorityBtn = document.getElementById('addPriorityBtn');
        if (addPriorityBtn) {
            addPriorityBtn.addEventListener('click', () => {
                this.addPriority();
            });
        }

        // Rüçhan tipi değişim listener'ı
        const priorityType = document.getElementById('priorityType');
        if (priorityType) {
            priorityType.addEventListener('change', (e) => {
                this.handlePriorityTypeChange(e.target.value);
            });
        }

        // Rüçhan listesi click listener'ı
        const addedPrioritiesList = document.getElementById('addedPrioritiesList');
        if (addedPrioritiesList) {
            addedPrioritiesList.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.remove-priority-btn');
                if (removeBtn) {
                    const priorityId = removeBtn.dataset.id;
                    this.removePriority(priorityId);
                }
            });
        }

        // Form input change listeners
        this.dynamicFormContainer.addEventListener('input', () => {
            this.updateSaveButtonState();
        });

        // Temizle butonu için event listener
        $(document).on('click', '#clearAllClassesBtn', () => {
            if (typeof window.clearAllSelectedClasses === 'function') {
                window.clearAllSelectedClasses();
                console.log('✅ Tüm sınıflar temizlendi');
            } else {
                console.error('❌ clearAllSelectedClasses fonksiyonu bulunamadı.');
            }
        });
        this.initializeDatePickers();
    }
    // Yeni metod: Tarih seçicileri başlatma
initializeDatePickers() {
    const dateFields = [
        'applicationDate',
        'registrationDate',
        'renewalDate',
        'bulletinDate',
        'priorityDate',
    ];

    // dd.mm.yyyy formatını kontrol eden düzenli ifade
    const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;

    dateFields.forEach(fieldId => {
        const element = document.getElementById(fieldId);
        if (element) {
            flatpickr(element, {
                dateFormat: "d.m.Y",
                allowInput: true,
                clickOpens: false,
                locale: "tr",

                onReady: (selectedDates, dateStr, instance) => {
                    // Otomatik formatlama için event listener ekle
                    element.addEventListener('input', (event) => {
                        const input = event.target;
                        let value = input.value.replace(/[^\d.]/g, ''); // Sadece rakam ve nokta karakterlerini tut
                        
                        // Otomatik olarak . ekle
                        if (value.length === 2 && value.indexOf('.') === -1) {
                            value += '.';
                        } else if (value.length === 5 && value.split('.').length === 2) {
                            value += '.';
                        }

                        // Maksimum uzunluk
                        if (value.length > 10) {
                            value = value.substring(0, 10);
                        }
                        
                        input.value = value;
                    });
                },
                
                onClose: (selectedDates, dateStr, instance) => {
                    // Eğer girilen metin format regex'ine uymuyorsa temizle
                    if (dateStr && !dateRegex.test(dateStr)) {
                        instance.clear(); 
                        element.value = ''; 
                    }
                },
                
                onKeydown: (selectedDates, dateStr, instance, event) => {
                    if (event.key === 'Enter') {
                        // Enter'a basıldığında, onClose'u tetikle
                        element.blur(); 
                    }
                    const validKeys = [
                        'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'
                    ];
                    if (!validKeys.includes(event.key) && event.key.length === 1 && instance.latestSelectedDateObj) {
                        instance.clear();
                    }
                }
            });
            
            // Giriş alanına tıklandığında takvimi açmak için manuel dinleyici
            element.addEventListener('click', () => {
                element._flatpickr.open();
            });
        }
    });
}
    handleTabChange(targetTab) {
        if (targetTab === '#goods-services' && !this.isNiceInitialized) {
            console.log('🔄 Nice Classification başlatılıyor...');
            console.log('🔍 DOM elementleri kontrol ediliyor...');
            
            const niceList = document.getElementById('niceClassificationList');
            const selectedList = document.getElementById('selectedNiceClasses');
            const searchInput = document.getElementById('niceClassSearch');
            
            console.log('📋 Nice elementleri:', {
                niceList: !!niceList,
                selectedList: !!selectedList,
                searchInput: !!searchInput
            });
            
            if (niceList && selectedList && searchInput) {
                this.isNiceInitialized = true;
                console.log('✅ Nice Classification elementleri hazır, başlatılıyor...');
                
                setTimeout(() => {
                    initializeNiceClassification()
                        .then(() => {
                            console.log('✅ Nice Classification başarıyla başlatıldı');
                            // Temizle butonu event listener'ı ekle
                            this.setupClearClassesButton();

                            // [DEĞİŞİKLİK] Eğer daha önce yüklenmiş veri varsa, modül başlatılınca tekrar yükle
                            if (this.storedNiceClasses && this.storedNiceClasses.length > 0) {
                                console.log('🔄 Tab açılışında Nice sınıfları tekrar yükleniyor...');
                                setSelectedNiceClasses(this.storedNiceClasses);
                            }
                        })
                        .catch((error) => {
                            console.error('❌ Nice Classification başlatma hatası:', error);
                        });
                }, 100);
            } else {
                console.error('❌ Nice Classification elementleri bulunamadı');
            }
        }
    }

    setupClearClassesButton() {
        const clearBtn = document.getElementById('clearAllClassesBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Tüm seçilen sınıfları temizlemek istediğinizden emin misiniz?')) {
                    // clearAllSelectedClasses fonksiyonu nice-classification.js'de tanımlı
                    if (window.clearAllSelectedClasses) {
                        window.clearAllSelectedClasses();
                        console.log('✅ Tüm sınıflar temizlendi');
                    }
                }
            });
        }

        // MutationObserver ile selectedClassCount'u izle
        const countBadge = document.getElementById('selectedClassCount');
        if (countBadge) {
            const observer = new MutationObserver(() => {
                this.updateClearButtonVisibility();
            });
            observer.observe(countBadge, { childList: true, characterData: true, subtree: true });
        }
    }

    updateClearButtonVisibility() {
        const clearBtn = document.getElementById('clearAllClassesBtn');
        const countBadge = document.getElementById('selectedClassCount');
        
        if (clearBtn && countBadge) {
            const count = parseInt(countBadge.textContent) || 0;
            clearBtn.style.display = count > 0 ? 'inline-block' : 'none';
            console.log('🔄 Temizle butonu güncellendi, seçim sayısı:', count);
        }
    }

    searchPersons(searchTerm, type) {
        const resultsContainer = document.getElementById(`${type}SearchResults`);
        if (!resultsContainer) return;

        if (searchTerm.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }

        const filteredPersons = this.allPersons.filter(person => 
            person.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (person.email && person.email.toLowerCase().includes(searchTerm.toLowerCase()))
        );

        if (filteredPersons.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results-message">Sonuç bulunamadı</div>';
        } else {
            resultsContainer.innerHTML = filteredPersons.map(person => 
                '<div class="search-result-item" data-person-id="' + person.id + '">' +
                    '<strong>' + person.name + '</strong>' +
                    (person.email ? '<br><small class="text-muted">' + person.email + '</small>' : '') +
                '</div>'
            ).join('');

            // Tıklama listener'ları ekle
            resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const personId = item.dataset.personId;
                    const person = this.allPersons.find(p => p.id === personId);
                    if (person) {
                        this.addSelectedPerson(person, type);
                        document.getElementById(`${type}Search`).value = '';
                        resultsContainer.style.display = 'none';
                    }
                });
            });
        }

        resultsContainer.style.display = 'block';
    }

    addSelectedPerson(person, type) {
        if (type === 'applicant') {
            // Zaten seçili mi kontrol et
            if (this.selectedApplicants.find(p => p.id === person.id)) {
                alert('Bu kişi zaten seçili');
                return;
            }

            this.selectedApplicants.push(person);
            this.renderSelectedApplicants();
        }
        
        this.updateSaveButtonState();
    }

    renderSelectedApplicants() {
        const container = document.getElementById('selectedApplicantsContainer');
        if (!container) return;

        if (this.selectedApplicants.length === 0) {
            container.innerHTML = 
                '<div class="empty-state text-center py-4">' +
                    '<i class="fas fa-users fa-2x text-muted mb-2"></i>' +
                    '<p class="text-muted">Henüz başvuru sahibi seçilmedi</p>' +
                '</div>';
        } else {
            container.innerHTML = this.selectedApplicants.map(person => 
                '<div class="selected-item">' +
                    '<span><strong>' + person.name + '</strong>' + (person.email ? ' (' + person.email + ')' : '') + '</span>' +
                    '<button type="button" class="remove-selected-item-btn" data-person-id="' + person.id + '">' +
                        '&times;' +
                    '</button>' +
                '</div>'
            ).join('');

            // Kaldır butonları için listener'lar
            container.querySelectorAll('.remove-selected-item-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const personId = btn.dataset.personId;
                    this.selectedApplicants = this.selectedApplicants.filter(p => p.id !== personId);
                    this.renderSelectedApplicants();
                    this.updateSaveButtonState();
                });
            });
        }
    }

    setupBrandExampleUploader() {
        const uploadArea = document.getElementById('brandExampleUploadArea');
        const fileInput = document.getElementById('brandExample');
        
        if (!uploadArea || !fileInput) return;

        // Drag & Drop olayları
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.style.backgroundColor = '#e9ecef';
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.style.backgroundColor = '#f8f9fa';
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.style.backgroundColor = '#f8f9fa';
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleBrandExampleFile(files[0]);
            }
        });

        // Tıklama olayı
        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        // Dosya seçim olayı
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleBrandExampleFile(e.target.files[0]);
            }
        });

        // Kaldır butonu
        const removeBtn = document.getElementById('removeBrandExampleBtn');
        if (removeBtn && !removeBtn.dataset.listenerAttached) {
        removeBtn.addEventListener('click', async () => {
            const previewContainer = document.getElementById('brandExamplePreviewContainer');
            const previewImage = document.getElementById('brandExamplePreview');
            const fileInput = document.getElementById('brandExample'); // ← input'u al

            // brand-examples altındaki dosyayı Storage'dan da sil
            try {
            const url = (typeof this.uploadedBrandImage === 'string') ? this.uploadedBrandImage : null;
            const path = url ? __pathFromDownloadURL(url) : null;
            if (path && path.startsWith('brand-examples/')) {
                const sref = ref(storage, path);
                await deleteObject(sref);
                console.log('🗑️ brand-examples temizlendi:', path);
            }
            } catch (e) {
            console.warn('brand-examples silme uyarısı:', e?.message || e);
            }

            if (previewContainer) previewContainer.style.display = 'none';
            if (previewImage) previewImage.src = '';
            if (fileInput) fileInput.value = '';

            this.uploadedBrandImage = null;
            if (typeof this.updateSaveButtonState === 'function') {
            this.updateSaveButtonState();
            }
        });
        removeBtn.dataset.listenerAttached = '1';
        }
    }

    handleBrandExampleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Lütfen geçerli bir resim dosyası seçin (PNG, JPG, JPEG)');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const previewContainer = document.getElementById('brandExamplePreviewContainer');
            const previewImage = document.getElementById('brandExamplePreview');
            
            if (previewImage) previewImage.src = e.target.result;
            if (previewContainer) previewContainer.style.display = 'block';
            
            this.uploadedBrandImage = file;
            this.updateSaveButtonState();
        };
        
        reader.readAsDataURL(file);
    }

    // Rüçhan (Priority) Fonksiyonları
    handlePriorityTypeChange(value) {
        const priorityDateLabel = document.getElementById('priorityDateLabel');
        if (priorityDateLabel) {
            if (value === 'sergi') {
                priorityDateLabel.textContent = 'Sergi Tarihi';
            } else {
                priorityDateLabel.textContent = 'Rüçhan Tarihi';
            }
        }
    }

    addPriority() {
        const priorityType = document.getElementById('priorityType')?.value;
        const priorityDate = document.getElementById('priorityDate')?.value;
        const priorityCountry = document.getElementById('priorityCountry')?.value;
        const priorityNumber = document.getElementById('priorityNumber')?.value;

        if (!priorityDate || !priorityCountry || !priorityNumber) {
            alert('Lütfen tüm rüçhan bilgilerini doldurun.');
            return;
        }

        const newPriority = {
            id: Date.now().toString(),
            type: priorityType,
            date: priorityDate,
            country: priorityCountry,
            number: priorityNumber
        };

        this.priorities.push(newPriority);
        this.renderPriorities();

        // Formu temizle
        document.getElementById('priorityDate').value = '';
        document.getElementById('priorityCountry').value = '';
        document.getElementById('priorityNumber').value = '';
        
        console.log('✅ Rüçhan eklendi:', newPriority);
    }

    removePriority(priorityId) {
        this.priorities = this.priorities.filter(p => p.id !== priorityId);
        this.renderPriorities();
        console.log('🗑️ Rüçhan kaldırıldı:', priorityId);
    }

    renderPriorities() {
        const container = document.getElementById('addedPrioritiesList');
        if (!container) return;

        if (this.priorities.length === 0) {
            container.innerHTML = 
                '<div class="empty-state text-center py-4">' +
                    '<i class="fas fa-info-circle fa-2x text-muted mb-2"></i>' +
                    '<p class="text-muted">Henüz rüçhan bilgisi eklenmedi.</p>' +
                '</div>';
            return;
        }

        let html = '';
        this.priorities.forEach(priority => {
            html += 
                '<div class="selected-item d-flex justify-content-between align-items-center p-2 mb-2 border rounded">' +
                    '<span>' +
                        '<b>Tip:</b> ' + (priority.type === 'sergi' ? 'Sergi' : 'Başvuru') + ' | ' +
                        '<b>Tarih:</b> ' + priority.date + ' | ' +
                        '<b>Ülke:</b> ' + priority.country + ' | ' +
                        '<b>Numara:</b> ' + priority.number +
                    '</span>' +
                    '<button type="button" class="btn btn-sm btn-danger remove-priority-btn" data-id="' + priority.id + '">' +
                        '<i class="fas fa-trash-alt"></i>' +
                    '</button>' +
                '</div>';
        });
        
        container.innerHTML = html;
    }

    updateFormFieldsBasedOnOrigin() {
        const originType = document.getElementById('originSelect')?.value;
        const appNumberWrapper = document.getElementById('applicationNumberWrapper');
        const regNumberWrapper = document.getElementById('registrationNumberWrapper');
        const regNumberLabel = document.getElementById('registrationNumberLabel');
        const regNumberInput = document.getElementById('registrationNumber');

        if (originType === 'WIPO' || originType === 'ARIPO') {
            if (appNumberWrapper) appNumberWrapper.style.display = 'none';
            if (regNumberWrapper) regNumberWrapper.style.display = 'block';
            if (regNumberLabel) {
                regNumberLabel.textContent = originType === 'WIPO' ? 'WIPO IR No:' : 'ARIPO IR No:';
            }
            if (regNumberInput) {
                regNumberInput.placeholder = originType === 'WIPO' ? 'WIPO IR Numarasını Girin' : 'ARIPO IR Numarasını Girin';
            }
        } else {
            if (appNumberWrapper) appNumberWrapper.style.display = 'block';
            if (regNumberWrapper) regNumberWrapper.style.display = 'block';
            if (regNumberLabel) regNumberLabel.textContent = 'Tescil Numarası';
            if (regNumberInput) regNumberInput.placeholder = 'Tescil numarasını girin';
        }
    }

    updateSaveButtonState() {
        const ipType = this.ipTypeSelect.value;
        const recordOwnerType = this.recordOwnerTypeSelect?.value;
        const originType = document.getElementById('originSelect')?.value;
        let isComplete = false;

        if (!ipType || !recordOwnerType) {
            this.saveBtn.disabled = true;
            return;
        }

        if (ipType === 'trademark') {
            const brandText = document.getElementById('brandExampleText');
            const hasApplicants = this.selectedApplicants.length > 0;
            const regNumber = document.getElementById('registrationNumber')?.value.trim();

            if (originType === 'WIPO' || originType === 'ARIPO') {
                const hasCountries = this.selectedCountries.length > 0;
                isComplete = brandText && brandText.value.trim() && hasApplicants && hasCountries && regNumber;
            } else {
                isComplete = brandText && brandText.value.trim() && hasApplicants;
            }
        } else if (ipType === 'patent') {
            const patentTitle = document.getElementById('patentTitle');
            isComplete = patentTitle && patentTitle.value.trim();
        } else if (ipType === 'design') {
                const designTitle = document.getElementById('designTitle');
                isComplete = designTitle && designTitle.value.trim();
        } else if (ipType === 'suit') {
            const clientRole = document.getElementById('clientRole')?.value;
            const specificTaskType = document.getElementById('specificTaskType')?.value;
            const suitCourt = document.getElementById('suitCourt')?.value;
            const suitCaseNo = document.getElementById('suitCaseNo')?.value.trim();
            const suitOpeningDate = document.getElementById('suitOpeningDate')?.value.trim(); // YENİ EKLENDİ
            
            // Zorunlu alanlar: Müvekkil, Rol, İş Tipi, Mahkeme, Esas/Takip No, Dava Tarihi
            isComplete = 
                !!this.suitClientPerson && 
                !!clientRole && 
                !!specificTaskType && 
                !!suitCourt && 
                !!suitCaseNo &&
                !!suitOpeningDate; // YENİ KONTROL
        }

            if (this.saveBtn) {
                this.saveBtn.disabled = !isComplete;
            }
        }

    async uploadFileToStorage(file, path) {
        if (!file || !path) {
            return null;
        }
        
        const storageRef = ref(storage, path);
        try {
            const uploadResult = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(uploadResult.ref);
            return downloadURL;
        } catch (error) {
            console.error("Dosya yüklenirken hata oluştu:", error);
            return null;
        }
    }
// ✅ Eklenecek metod: loadRecordForEditing
async loadRecordForEditing() {
    const urlParams = new URLSearchParams(window.location.search);
    this.editingRecordId = urlParams.get('id');

    const formTitle = document.getElementById('formTitle');
    
    if (this.editingRecordId) {
        if (formTitle) formTitle.textContent = 'Kayıt Düzenle';

        try {
            const recordResult = await ipRecordsService.getRecordById(this.editingRecordId);
            if (recordResult.success) {
                this.populateFormFields(recordResult.data);
            } else {
                console.error('Kayıt yüklenemedi: ' + (recordResult.message || 'Bilinmeyen hata'));
            }
        } catch (error) {
            console.error('Kayıt yüklenirken bir hata oluştu:', error);
        }
    } else {
        if (formTitle) formTitle.textContent = 'Yeni Kayıt Ekle';
        this.currentIpType = this.ipTypeSelect.value;
        this.handleIPTypeChange(this.currentIpType);
    }
}
// ✅ YENİ: Çoklu ülke seçimi için arayüzü ve dinleyicileri ayarlar
    setupMultiCountrySelect() {
        const input = document.getElementById('countriesMultiSelectInput');
        const resultsContainer = document.getElementById('countriesMultiSelectResults');
        const selectedList = document.getElementById('selectedCountriesList');
        const countBadge = document.getElementById('selectedCountriesCount');
        
        // Dinleyicileri temizle (önceki render'lardan kalanları)
        if (this._multiCountryInputListener) {
            input.removeEventListener('input', this._multiCountryInputListener);
        }
        if (this._multiCountryResultsListener) {
            resultsContainer.removeEventListener('click', this._multiCountryResultsListener);
        }
        if (this._multiCountryListListener) {
            selectedList.removeEventListener('click', this._multiCountryListListener);
        }

        this.renderSelectedCountries();
        
        // Arama mantığı
        this._multiCountryInputListener = (e) => {
            const query = e.target.value.toLowerCase();
            if (query.length < 2) {
                resultsContainer.style.display = 'none';
                return;
            }
            const filtered = this.allCountries.filter(c => 
                c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query)
            );
            this.renderCountrySearchResults(filtered);
        };
        input.addEventListener('input', this._multiCountryInputListener);

        // Sonuç listesinden seçim yapma
        this._multiCountryResultsListener = (e) => {
            const item = e.target.closest('.search-result-item');
            if (item) {
                const countryCode = item.dataset.code;
                const countryName = item.dataset.name;
                const existing = this.selectedCountries.find(c => c.code === countryCode);
                if (!existing) {
                    this.selectedCountries.push({ code: countryCode, name: countryName });
                    this.renderSelectedCountries();
                    this.updateSaveButtonState();
                }
                input.value = '';
                resultsContainer.style.display = 'none';
            }
        };
        resultsContainer.addEventListener('click', this._multiCountryResultsListener);

        // Seçilen ülkeler listesinden silme
        this._multiCountryListListener = (e) => {
            const removeBtn = e.target.closest('.remove-selected-item-btn');
            if (removeBtn) {
                const countryCode = removeBtn.dataset.code;
                this.selectedCountries = this.selectedCountries.filter(c => c.code !== countryCode);
                this.renderSelectedCountries();
                this.updateSaveButtonState();
            }
        };
        selectedList.addEventListener('click', this._multiCountryListListener);
    }

    // ✅ YENİ: Arama sonuçlarını render eder
    renderCountrySearchResults(countries) {
        const resultsContainer = document.getElementById('countriesMultiSelectResults');
        if (!resultsContainer) return;

        resultsContainer.innerHTML = countries.map(c => `
            <div class="search-result-item" data-code="${c.code}" data-name="${c.name}">
                ${c.name} (${c.code})
            </div>
        `).join('');
        resultsContainer.style.display = countries.length > 0 ? 'block' : 'none';
    }

    // ✅ YENİ: Seçilen ülkeler listesini render eder
    renderSelectedCountries() {
        const selectedList = document.getElementById('selectedCountriesList');
        const countBadge = document.getElementById('selectedCountriesCount');
        if (!selectedList || !countBadge) return;

        countBadge.textContent = this.selectedCountries.length;

        if (this.selectedCountries.length === 0) {
            selectedList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-flag fa-3x text-muted mb-3"></i>
                    <p class="text-muted">Henüz ülke eklenmedi.</p>
                </div>`;
        } else {
            selectedList.innerHTML = this.selectedCountries.map(c => `
                <div class="selected-item d-flex justify-content-between align-items-center">
                    <span>${c.name} (${c.code})</span>
                    <button type="button" class="remove-selected-item-btn" data-code="${c.code}">
                        &times;
                    </button>
                </div>
            `).join('');
        }
    }

// ✅ Yeni veri yapısına uygun populateFormFields fonksiyonu
populateFormFields(recordData) {
    if (!recordData) return;

    console.log('🔄 Form alanları doldruluyor:', JSON.stringify(recordData, null, 2));
    console.log('📍 Origin:', recordData.origin);
    console.log('📍 TransactionHierarchy:', recordData.transactionHierarchy);
    console.log('📍 Country:', recordData.country);

    // IP türünü ayarla ve formu yeniden render et
    const ipType = recordData.type || recordData.ipType; // Yeni yapıda 'type' alanı
    this.ipTypeSelect.value = ipType || 'trademark';
    this.currentIpType = this.ipTypeSelect.value;
    this.handleIPTypeChange(this.currentIpType);

    // Record Owner Type
    if (this.recordOwnerTypeSelect && recordData.recordOwnerType) {
        this.recordOwnerTypeSelect.value = recordData.recordOwnerType;
    }

    // Formu render ettikten sonra alanları doldurmak için setTimeout kullan
    setTimeout(() => {
        // Ortak alanları doldur (yeni veri yapısından)
        const formTitle = document.getElementById('formTitle');
        if (formTitle) formTitle.textContent = 'Kayıt Düzenle';

        // ✅ Yeni yapıya göre - ana seviyeden al
        const applicationNumber = document.getElementById('applicationNumber');
        if (applicationNumber) applicationNumber.value = recordData.applicationNumber || '';

        const registrationNumber = document.getElementById('registrationNumber');
        if (registrationNumber) {
            registrationNumber.value = recordData.registrationNumber || recordData.wipoIR || recordData.aripoIR || '';
        }

        const applicationDate = document.getElementById('applicationDate');
        if (applicationDate) applicationDate.value = recordData.applicationDate || '';

        const registrationDate = document.getElementById('registrationDate');
        if (registrationDate) registrationDate.value = recordData.registrationDate || '';
        
        const renewalDate = document.getElementById('renewalDate');
        if (renewalDate) renewalDate.value = recordData.renewalDate || '';
        
        // ✅ YENİ: Origin alanını doldur
            const originSelect = document.getElementById('originSelect');
            if (originSelect) {
                this.populateOriginDropdown('originSelect', recordData.origin);
            }
            
        // ✅ YENİ: Origin değerine göre ülke seçimini ayarla
            // ÖNCELİKLE CHILD KONTROLÜ
            if ((recordData.origin === 'WIPO' || recordData.origin === 'ARIPO') && recordData.transactionHierarchy === 'child') {
                console.log('🔍 WIPO/ARIPO Child kaydı yükleniyor, ülke:', recordData.country);
                
                // Child kayıtlarda ülkeyi selectedCountries array'ine ekle
                if (recordData.country) {
                    const country = this.allCountries.find(c => c.code === recordData.country);
                    if (country) {
                        this.selectedCountries = [{ code: country.code, name: country.name }];
                        console.log('✅ Ülke bulundu:', country);
                    } else {
                        this.selectedCountries = [{ code: recordData.country, name: recordData.country }];
                        console.log('⚠️ Ülke bulunamadı, kod kullanılıyor:', recordData.country);
                    }
                }
                
                // Çoklu ülke seçim arayüzünü MANUEL olarak göster ama READ-ONLY yap
                const countrySelectionContainer = document.getElementById('countrySelectionContainer');
                const multiSelectWrapper = document.getElementById('multiCountrySelectWrapper');
                const singleSelectWrapper = document.getElementById('singleCountrySelectWrapper');
                const title = document.getElementById('countrySelectionTitle');
                const searchInput = document.getElementById('countriesMultiSelectInput');
                
                if (countrySelectionContainer && multiSelectWrapper && title) {
                    title.textContent = `Ülke (Değiştirilemez)`;
                    countrySelectionContainer.style.display = 'block';
                    singleSelectWrapper.style.display = 'none';
                    multiSelectWrapper.style.display = 'block';
                    
                    // Arama inputunu gizle (child'da ülke değiştirilemez)
                    if (searchInput) {
                        searchInput.closest('.form-group').style.display = 'none';
                    }
                    
                    console.log('✅ Child ülke read-only olarak gösterildi');
                } else {
                    console.log('❌ Ülke seçim container\'ları bulunamadı');
                }
                
                // Render et
                setTimeout(() => {
                    this.renderSelectedCountries();
                    // X butonlarını kaldır (child'da ülke silinmez)
                    const removeButtons = document.querySelectorAll('#selectedCountriesList .remove-selected-item-btn');
                    removeButtons.forEach(btn => btn.style.display = 'none');
                    console.log('✅ Child ülke bilgisi read-only render edildi:', this.selectedCountries);
                }, 100);
                
            } else if (recordData.origin === 'Yurtdışı Ulusal') {
                this.handleOriginChange(recordData.origin);
                setTimeout(() => {
                    const countrySelect = document.getElementById('countrySelect');
                    if (countrySelect && recordData.country) {
                        countrySelect.value = recordData.country;
                    }
                }, 50);
            } else if (recordData.origin === 'WIPO' || recordData.origin === 'ARIPO') {
                // PARENT kayıtlar için
                this.handleOriginChange(recordData.origin);
                // Çoklu seçim için veriyi state'e yükle ve render et
                if (Array.isArray(recordData.countries)) {
                    this.selectedCountries = recordData.countries.map(code => {
                        const country = this.allCountries.find(c => c.code === code);
                        return country || { code, name: code };
                    });
                    this.renderSelectedCountries();
                    // Ülke listesi ilk yüklemedeki "referans" durum
                    this._initialCountryCodes = (this.selectedCountries || [])
                    .map(c => String(c.code).toUpperCase())
                    .sort()
                    .join(',');
                }
            }
        
        // Marka özel alanları
        if (this.currentIpType === 'trademark') {
            const brandType = document.getElementById('brandType');
            if (brandType) brandType.value = recordData.brandType || null;

            const brandCategory = document.getElementById('brandCategory');
            if (brandCategory) brandCategory.value = recordData.brandCategory || null;

            const nonLatinAlphabet = document.getElementById('nonLatinAlphabet');
            if (nonLatinAlphabet) nonLatinAlphabet.value = recordData.nonLatinAlphabet || null;

            // ✅ Yeni yapıya göre - brandText ana seviyede
            const brandText = document.getElementById('brandExampleText');
            if (brandText) brandText.value = recordData.title || recordData.brandText || '';

            // ✅ Açıklama ana seviyeden
            const description = document.getElementById('brandDescription');
            if (description) description.value = recordData.description || '';
            
            // ✅ Status alanını doldur
            const trademarkStatus = document.getElementById('trademarkStatus');
            if (trademarkStatus && recordData.status) {
                trademarkStatus.value = recordData.status;
            }
            
            const b0 = Array.isArray(recordData.bulletins) ? recordData.bulletins[0] : null;
            const bNo = document.getElementById('bulletinNo');
            const bDt = document.getElementById('bulletinDate');
            if (b0) {
                if (bNo) bNo.value = b0.bulletinNo || '';
                if (bDt) bDt.value = b0.bulletinDate || '';
            } else {
                if (bNo) bNo.value = '';
                if (bDt) bDt.value = '';
            }

            // ✅ Marka görseli - brandImageUrl ana seviyede
            const brandImageUrl = this.uploadedBrandImage || null;
            if (recordData.brandImageUrl) {
                this.uploadedBrandImage = recordData.brandImageUrl; // String olarak sakla
                
                const imagePreview = document.getElementById('brandExamplePreview');
                if (imagePreview) {
                    imagePreview.src = recordData.brandImageUrl;
                    imagePreview.style.display = 'block';
                }
                
                const previewContainer = document.getElementById('brandExamplePreviewContainer');
                if (previewContainer) previewContainer.style.display = 'block';
            }

            // ✅ Nice sınıfları - goodsAndServicesByClass'tan yükle
            if (recordData.goodsAndServicesByClass && recordData.goodsAndServicesByClass.length > 0) {
                if (typeof setSelectedNiceClasses === 'function') {
                    
                    // 1. Adım: Veritabanındaki verileri sınıf numarasına göre grupla
                    const groupedData = {};
                    
                    recordData.goodsAndServicesByClass.forEach(group => {
                        const classNo = group.classNo;
                        if (!groupedData[classNo]) {
                            groupedData[classNo] = [];
                        }
                        // Items dizisini güvenli bir şekilde ekle
                        if (Array.isArray(group.items)) {
                            groupedData[classNo].push(...group.items);
                        }
                    });

                    // 2. Adım: Her sınıf için maddeleri birleştirip tek bir metin yap
                    const formattedClasses = Object.keys(groupedData).map(classNo => {
                        const items = groupedData[classNo];
                        // Maddeleri alt alta birleştir
                        const combinedText = items.join('\n'); 
                        
                        // Format: (35-1) Tüm Metin Bloğu
                        return `(${classNo}-1) ${combinedText}`;
                    });
                    
                    // 3. Adım: Veriyi sakla ve widget'a gönder
                    this.storedNiceClasses = formattedClasses;
                    console.log('🎯 Nice sınıfları (Birleştirilmiş):', formattedClasses);
                    setSelectedNiceClasses(formattedClasses);
                }
            }

            // ✅ Başvuru sahipleri - applicants ana seviyede
            if (recordData.applicants && recordData.applicants.length > 0) {
                this.selectedApplicants = recordData.applicants.map(applicant => ({
                    id: applicant.id,
                    name: applicant.name,
                    email: applicant.email || ''
                }));
                this.renderSelectedApplicants();
                console.log('👥 Başvuru sahipleri yüklendi:', this.selectedApplicants);
            }

            // ✅ Rüçhan bilgileri - priorities ana seviyede  
            if (recordData.priorities && recordData.priorities.length > 0) {
                this.priorities = recordData.priorities;
                this.renderPriorities();
                console.log('🏆 Rüçhan bilgileri yüklendi:', this.priorities);
            }
        }

        // Patent özel alanları
        else if (this.currentIpType === 'patent') {
            // ✅ Patent için title ana seviyede
            const patentTitle = document.getElementById('patentTitle');
            if (patentTitle) patentTitle.value = recordData.title || '';

            const patentApplicationNumber = document.getElementById('patentApplicationNumber');
            if (patentApplicationNumber) patentApplicationNumber.value = recordData.applicationNumber || '';

            const patentDescription = document.getElementById('patentDescription');
            if (patentDescription) patentDescription.value = recordData.description || '';

            // Başvuru sahipleri ve rüçhan bilgileri patent için de
            if (recordData.applicants && recordData.applicants.length > 0) {
                this.selectedApplicants = recordData.applicants;
                this.renderSelectedApplicants();
            }

            if (recordData.priorities && recordData.priorities.length > 0) {
                this.priorities = recordData.priorities;
                this.renderPriorities();
            }
        }

        // Tasarım özel alanları
        else if (this.currentIpType === 'design') {
            // ✅ Tasarım için title ana seviyede
            const designTitle = document.getElementById('designTitle');
            if (designTitle) designTitle.value = recordData.title || '';

            const designApplicationNumber = document.getElementById('designApplicationNumber');
            if (designApplicationNumber) designApplicationNumber.value = recordData.applicationNumber || '';

            const designDescription = document.getElementById('designDescription');
            if (designDescription) designDescription.value = recordData.description || '';

            // Başvuru sahipleri ve rüçhan bilgileri tasarım için de
            if (recordData.applicants && recordData.applicants.length > 0) {
                this.selectedApplicants = recordData.applicants;
                this.renderSelectedApplicants();
            }

            if (recordData.priorities && recordData.priorities.length > 0) {
                this.priorities = recordData.priorities;
                this.renderPriorities();
            }
        }
        //// 🔒 Düzenleme modunda IP türü ve menşe alanlarını kilitle
        if (this.editingRecordId) {
        // IP türü select
        if (this.ipTypeSelect) {
            this.ipTypeSelect.disabled = true;
            this.ipTypeSelect.classList.add('disabled'); // (opsiyonel görsel ipucu)
        }

        // Menşe select
        const originSelectEl = document.getElementById('originSelect');
        if (originSelectEl) {
            originSelectEl.disabled = true;
            originSelectEl.classList.add('disabled'); // (opsiyonel görsel ipucu)
        }
        }

        // Kaydet butonunun durumunu güncelle
        this.updateSaveButtonState();
        
        console.log('✅ Form alanları başarıyla dolduruldu');
    }, 500); // Form render edilmesini bekle
}

async handleSavePortfolio() {
        const ipType = this.ipTypeSelect.value;
        const strategy = this.strategies[ipType];

        if (!strategy) {
            alert('Geçersiz IP Türü');
            return;
        }

        // 1. Veriyi Topla
        const recordData = strategy.collectData(this);

        // 2. Validasyon
        const error = strategy.validate(recordData, this);
        if (error) {
            alert(error);
            return;
        }

        // 3. Ortak Alanları Ekle
        recordData.recordOwnerType = this.recordOwnerTypeSelect.value;
        
        // Tarihçeler
        if (!this.editingRecordId) {
            recordData.createdAt = new Date().toISOString(); // Sadece yeni kayıtta
        }
        recordData.updatedAt = new Date().toISOString(); // Her işlemde güncelle

        try {
            this.saveBtn.disabled = true;
            this.saveBtn.textContent = 'İşleniyor...';

            // --- DOSYA YÜKLEME MANTIĞI (Aynı kalıyor) ---
            if (ipType === 'trademark') {
                if (this.uploadedBrandImage instanceof File) {
                    console.log('📤 Resim Storage\'a yükleniyor...');
                    this.saveBtn.textContent = 'Resim Yükleniyor...';
                    
                    const fileName = `${Date.now()}_${this.uploadedBrandImage.name}`;
                    const storagePath = `brand-images/${fileName}`;
                    
                    const downloadURL = await this.uploadFileToStorage(this.uploadedBrandImage, storagePath);
                    
                    if (downloadURL) {
                        recordData.brandImageUrl = downloadURL;
                        console.log('✅ Resim yüklendi, URL:', downloadURL);
                    } else {
                        throw new Error("Resim yüklenemedi.");
                    }
                } else if (typeof this.uploadedBrandImage === 'string') {
                    recordData.brandImageUrl = this.uploadedBrandImage;
                }
            }
            // ----------------------------------------------

            this.saveBtn.textContent = 'Kaydediliyor...';

            // ============================================================
            // 🛠️ DÜZELTME: EDİT MANTIĞI EKLENDİ
            // ============================================================
            
            if (this.editingRecordId) {
                // --- GÜNCELLEME (UPDATE) MODU ---
                console.log('✏️ Mevcut kayıt güncelleniyor ID:', this.editingRecordId);

                if (ipType === 'suit') {
                    // Dava Güncelleme
                    const db = getFirestore();
                    const suitRef = doc(db, 'suits', this.editingRecordId);
                    await updateDoc(suitRef, recordData);
                    alert('Dava kaydı başarıyla güncellendi.');
                } else {
                    // Marka/Patent/Tasarım Güncelleme
                    // createRecord yerine updateRecord kullanıyoruz. 
                    // Bu sayede duplikasyon kontrolüne takılmıyoruz.
                    const result = await ipRecordsService.updateRecord(this.editingRecordId, recordData);
                    
                    if (!result.success) {
                        throw new Error(result.error || 'Güncelleme başarısız.');
                    }
                    
                    // Eğer WIPO/ARIPO parent kaydı güncellendiyse ve çocukları senkronize etmek istersen:
                    // (İsteğe bağlı, şimdilik sadece ana kaydı güncelliyoruz)
                    // await this.syncWipoAripoChildren(this.editingRecordId, recordData);

                    alert('Kayıt başarıyla güncellendi.');
                }

            } else {
                // --- YENİ KAYIT (CREATE) MODU ---
                console.log('➕ Yeni kayıt oluşturuluyor...');
                
                if (ipType === 'suit') {
                    const db = getFirestore();
                    const suitsColRef = collection(db, 'suits');
                    await addDoc(suitsColRef, recordData);
                    alert('Dava kaydı başarıyla oluşturuldu!');
                } else {
                    // Burası duplicate kontrolü yapan orijinal fonksiyonu çağırır
                    await this.saveIpRecordWithStrategy(recordData); 
                }
            }
            // ============================================================

            window.location.href = 'portfolio.html';

        } catch (error) {
            console.error('Kaydetme hatası:', error);
            // Hatayı kullanıcıya gösterirken duplicate hatasını daha net belirtelim
            if (error.message && error.message.includes('duplikasyon')) {
                alert('HATA: Bu kayıt zaten mevcut olduğu için işlem yapılamadı. Lütfen numarayı kontrol edin.');
            } else {
                alert('Bir hata oluştu: ' + error.message);
            }
        } finally {
            this.saveBtn.disabled = false;
            this.saveBtn.textContent = 'Kaydet';
        }
    }

/**
 * WIPO/ARIPO parent kaydında ülke listesi değiştiyse:
 *  - Eklenen ülkeler için child ipRecords oluşturur
 *  - Silinen ülkeler için ilgili child ipRecords'u siler
 */
async syncWipoAripoChildren(parentId, parentDataFromForm) {
  if (!parentId) return;

  // 1) Parent'ı al
  const parentRes = await ipRecordsService.getRecordById(parentId);
  if (!parentRes?.success || !parentRes?.data) return;
  const parent = parentRes.data;

  // 2) Origin ve IR kontrolü
  const origin = String(parent?.origin || parentDataFromForm?.origin || '').toUpperCase();
  if (!['WIPO','ARIPO'].includes(origin)) return;

  const isWipo = origin === 'WIPO';
  const irNumber = isWipo
    ? (parent?.wipoIR || parentDataFromForm?.wipoIR || null)
    : (parent?.aripoIR || parentDataFromForm?.aripoIR || null);
  if (!irNumber) return;

  // 3) Hedef ülke listesi (UI state öncelikli → form → yoksa boş)
  const desiredCountries =
    (Array.isArray(this.selectedCountries) && this.selectedCountries.length
      ? this.selectedCountries.map(c => c.code)
      : (Array.isArray(parentDataFromForm?.countries) ? parentDataFromForm.countries : [])
    ).filter(Boolean);

  // 4) Mevcut child kayıtlarını çek
  const db = getFirestore();
  const colRef = collection(db, 'ipRecords');
  const q = query(
    colRef,
    where('transactionHierarchy', '==', 'child'),
    where('origin', '==', origin),
    where(isWipo ? 'wipoIR' : 'aripoIR', '==', String(irNumber))
  );
  const snap = await getDocs(q);

  const existingChildren = [];
  snap.forEach(d => existingChildren.push({ id: d.id, ...d.data() }));
  const existingCountries = existingChildren.map(c => c.country).filter(Boolean);

  // 5) Fark kümeleri
  const desiredSet = new Set((desiredCountries || []).filter(Boolean));
  const existingSet = new Set((existingCountries || []).filter(Boolean));

  const toAdd = [...desiredSet].filter(code => !existingSet.has(code));
  const toRemove = existingChildren.filter(c => !desiredSet.has(c.country));

  // 6) Parent'tan kopyalanacak temel alanlar
  const baseCopy = {
    title: parent.title || parent.brandText || '',
    type: parent.type || 'trademark',
    portfoyStatus: parent.portfoyStatus || 'active',
    status: parent.status || 'filed',
    recordOwnerType: parent.recordOwnerType || 'self',
    origin,
    wipoIR: isWipo ? String(irNumber) : null,
    aripoIR: isWipo ? null : String(irNumber),
    transactionHierarchy: 'child',
    parentId: String(parentId),

    brandText: parent.brandText || null,
    brandImageUrl: parent.brandImageUrl || null,
    brandType: parent.brandType || null,
    brandCategory: parent.brandCategory || null,
    nonLatinAlphabet: parent.nonLatinAlphabet || null,

    goodsAndServicesByClass: parent.goodsAndServicesByClass || null,
    applicants: Array.isArray(parent.applicants) ? parent.applicants : [],
    priorities: Array.isArray(parent.priorities) ? parent.priorities : [],

    applicationNumber: null,           // ⚠️ child'ta IR veya başvuru no tutulmaz
    applicationDate: parent.applicationDate || null,
    registrationNumber: null,
    registrationDate: parent.registrationDate || null,
    renewalDate: parent.renewalDate || null,

    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // 7) Transaction type id (başvuru) — mümkünse servisle tespit et, olmazsa fallback
  const ipType = String(parent?.type || parentDataFromForm?.ipType || 'trademark').toLowerCase();
  const CODE_BY_IP = {
    trademark: 'TRADEMARK_APPLICATION',
    patent: 'PATENT_APPLICATION',
    design: 'DESIGN_APPLICATION'
  };
  const FALLBACK_TX_IDS = { trademark: '2', patent: '5', design: '8' };
  let txTypeId = null;
  try {
    const res = await transactionTypeService.getTransactionTypes();
    const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    const map = new Map(list.map(t => [String((t.code || '').toUpperCase()), String(t.id)]));
    txTypeId = map.get(CODE_BY_IP[ipType] || 'TRADEMARK_APPLICATION');
  } catch (e) {
    console.warn('Transaction types yüklenemedi, fallback kullanılacak:', e);
  }
  if (!txTypeId) txTypeId = FALLBACK_TX_IDS[ipType] || '2';

  // 8) Eklenen ülkeler için child oluştur + başvuru transaction ekle
  for (const code of toAdd) {
    try {
      const childData = {
        ...baseCopy,
        country: code,
        applicationNumber: null,
        registrationNumber: null,
        createdFrom: 'wipo_aripo_child_sync'
      };

      const createRes = await ipRecordsService.createRecordFromDataEntry(childData);
      if (!createRes?.success || !createRes?.id) {
        console.error('Child oluşturulamadı:', code, createRes?.error || createRes);
        continue;
      }
      const childId = String(createRes.id);

      // Başvuru transaction'ı (child)
      await ipRecordsService.addTransactionToRecord(childId, {
        type: String(txTypeId),
        transactionTypeId: String(txTypeId),
        description: 'Ülke başvurusu işlemi.',
        transactionHierarchy: 'child'
      });
    } catch (err) {
      console.error('Child oluşturma/transaction ekleme hatası (', code, '):', err);
    }
  }

  // 9) Silinen ülkeler için child sil
  for (const child of toRemove) {
    try {
      if (child?.id) {
        const delRes = await ipRecordsService.deleteRecord(String(child.id));
        if (!delRes?.success) {
          console.error('Child silinemedi:', child.id, delRes?.error || delRes);
        }
      }
    } catch (err) {
      console.error('Child silme hatası:', child?.id, err);
    }
  }
}

async saveIpRecordWithStrategy(data) {
        // Kontroller
        const isInternational = (data.origin === 'WIPO' || data.origin === 'ARIPO');
        const hasCountries = this.selectedCountries && this.selectedCountries.length > 0;

        console.log('🌍 WIPO Kontrol:', { 
            origin: data.origin, 
            isInt: isInternational, 
            count: this.selectedCountries.length 
        });

        if (isInternational && hasCountries) {
            // === SENARYO A: WIPO/ARIPO (Parent + Children) ===
            console.log('🚀 WIPO Modu devrede...');

            // 1. Parent Hazırlığı
            const parentData = { 
                ...data, 
                transactionHierarchy: 'parent', 
                countries: this.selectedCountries.map(c => c.code)
            };

            // IR Numarası Ayarı
            if (data.origin === 'WIPO') {
                parentData.wipoIR = data.internationalRegNumber || data.registrationNumber;
            } else {
                parentData.aripoIR = data.internationalRegNumber || data.registrationNumber;
            }

            // Parent Oluştur
            const parentResult = await ipRecordsService.createRecordFromDataEntry(parentData);
            if (!parentResult.success) throw new Error('Parent kayıt hatası: ' + parentResult.error);
            
            const parentId = parentResult.id;
            console.log('✅ Parent OK. ID:', parentId);

            // 2. Child Kayıtlar (Döngü)
            console.log('🔄 Child kayıtlar oluşturuluyor...');
            
            // Promise.all kullanarak paralel oluşturuyoruz
            const promises = this.selectedCountries.map(async (country) => {
                try {
                    const childData = { 
                        ...data, 
                        transactionHierarchy: 'child', 
                        parentId: parentId,
                        country: country.code,
                        
                        // 🛠️ KRİTİK DÜZELTME: Child kayıtlarda başvuru numarasını boşaltıyoruz
                        // Böylece duplicate (mükerrer) hatasına takılmıyorlar.
                        applicationNumber: null, 
                        registrationNumber: null, // Tescil no da çakışmasın

                        // IR numaralarını taşı
                        wipoIR: parentData.wipoIR,
                        aripoIR: parentData.aripoIR,
                        
                        createdFrom: 'wipo_child_generation'
                    };

                    const res = await ipRecordsService.createRecordFromDataEntry(childData);
                    if(res.success) {
                        console.log(`✅ Child Eklendi: ${country.code}`);
                        return res;
                    } else {
                        console.error(`❌ Child Hatası (${country.code}):`, res.error);
                        return null;
                    }
                } catch (err) {
                    console.error(`❌ Child Beklenmeyen Hata (${country.code}):`, err);
                    return null;
                }
            });

            await Promise.all(promises);
            console.log('🏁 WIPO işlemi tamamlandı.');

            // Transaction (Sadece Parent'a)
            await this.addTransactionForNewRecord(parentId, data.ipType);

        } else {
            // === SENARYO B: TEKİL KAYIT ===
            console.log('📍 Tekil Kayıt Modu');
            
            if (data.origin === 'Yurtdışı Ulusal' && !data.country) {
                const countrySelect = document.getElementById('countrySelect');
                if (countrySelect) data.country = countrySelect.value;
            }

            const result = await ipRecordsService.createRecordFromDataEntry(data);
            if (!result.success) throw new Error(result.error);

            await this.addTransactionForNewRecord(result.id, data.ipType);
        }
    }

// Transaction ekleme kodunu da ayırdık (DRY prensibi)
async addTransactionForNewRecord(recordId, ipType) {
    // ... (Eski koddaki transaction type bulma mantığı buraya) ...
    // Basitçe:
    const TX_IDS = { trademark: '2', patent: '5', design: '8' };
    const txTypeId = TX_IDS[ipType] || '2';

    await ipRecordsService.addTransactionToRecord(String(recordId), {
        type: String(txTypeId),
        transactionTypeId: String(txTypeId),
        description: 'Başvuru işlemi.',
        transactionHierarchy: 'parent'
    });
}

// === YENİ: Task Tiplerini Çekme Metodu ===
    async getTaskTypes() {
        try {
            // transactionTypeService mevcut, bu yüzden onu kullanın
            const r = await transactionTypeService.getTransactionTypes();
            // Varsayılan olarak 'data' veya direkt dizi beklenir
            const list = Array.isArray(r?.data) ? r.data : (Array.isArray(r) ? r : []); 
            this.allTransactionTypes = list;
            return list;
        } catch (error) {
            console.error('Task tipleri yüklenemedi:', error);
            this.allTransactionTypes = [];
            return [];
        }
    }
    
    // === YENİ: Dava için Spesifik İş Tipi Doldurma ===
    populateSpecificTaskTypeDropdown(mainType) {
        const dropdown = document.getElementById('specificTaskType');
        if (!dropdown) return;

        dropdown.innerHTML = '<option value="">Seçiniz...</option>';

        if (!mainType || !this.allTransactionTypes) return;

        // Dava (suit) tipine ait olanları ve hiyerarşisi 'parent' olanları filtrele
        const filteredTypes = this.allTransactionTypes.filter(type =>
            type.ipType === mainType && type.hierarchy === 'parent'
        );

        filteredTypes.sort((a, b) => (a.order || 999) - (b.order || 999));

        filteredTypes.forEach(type => {
            dropdown.innerHTML += `<option value="${type.id}">${type.alias || type.name}</option>`;
        });
    }

renderSuitFields(taskName) {
        return FormTemplates.getSuitFields(taskName);
    }

    
renderSuitClientSection() {
        const suitFieldsCard = document.getElementById('suitSpecificFieldsCard');
        if (!suitFieldsCard) return;

        // HTML Template'den geliyor
        const clientHtml = FormTemplates.getClientSection();
        
        suitFieldsCard.insertAdjacentHTML('beforebegin', clientHtml);

        document.getElementById('addNewPersonBtn')?.addEventListener('click', () => {
            openPersonModal((newPerson) => {
                this.allPersons.push(newPerson); 
                this.suitClientPerson = newPerson;
                document.getElementById('selectedSuitClientName').textContent = newPerson.name;
                document.getElementById('selectedSuitClient').style.display = 'block';
                document.getElementById('suitClientSearch').style.display = 'none';
                this.updateSaveButtonState();
            });
        });
        
        this.renderSuitSubjectAssetSection(); 
    }

renderSuitSubjectAssetSection() {
        const suitFieldsCard = document.getElementById('suitSpecificFieldsCard');
        if (!suitFieldsCard) return;

        const assetHtml = FormTemplates.getSubjectAssetSection();

        suitFieldsCard.insertAdjacentHTML('beforebegin', assetHtml);

        this.setupSuitSubjectAssetSearchSelectors();
    }

// YENİ: İşleme Konu Varlık Arama Selector'larını Ayarlama (Basit Versiyon)
setupSuitSubjectAssetSearchSelectors() {
    // Bu metod için tam arama mantığı (FireStore'dan ipRecords çekme) eklenmemiştir. 
    // Sadece UI etkileşimi ve state tutma mekanizması eklenmiştir. 
    // Gerçek arama (searchAssets) ayrı bir geliştirme gerektirecektir.

    const searchInput = document.getElementById('subjectAssetSearch');
    const searchResults = document.getElementById('subjectAssetSearchResults');
    const selectedDisplay = document.getElementById('selectedSubjectAsset');
    const clearBtn = document.getElementById('clearSubjectAsset');

    // State'i tutmak için yeni bir değişken
    this.suitSubjectAsset = null;
    
    // ✅ GERÇEK ARAMA FONKSİYONU: İpRecords koleksiyonundan ara
    const searchAssets = async (query) => {
        try {
            const db = getFirestore();
            const ipRecordsRef = collection(db, 'ipRecords');
            
            // Normalize query
            const normalizedQuery = query.toLowerCase().trim();
            
            // Tüm ipRecords'ları çek ve client-side filtrele
            const snapshot = await getDocs(ipRecordsRef);
            const results = [];
            
            snapshot.forEach(doc => {
                const data = doc.data();
                const searchFields = [
                    data.title,
                    data.brandText,
                    data.applicationNumber,
                    data.registrationNumber,
                    data.applicationNo,
                    data.registrationNo,
                    data.fileNo
                ].filter(Boolean).map(f => String(f).toLowerCase());
                
                // Eğer herhangi bir alanda query bulunuyorsa ekle
                if (searchFields.some(field => field.includes(normalizedQuery))) {
                    const typeMap = {
                        'trademark': 'Marka',
                        'patent': 'Patent', 
                        'design': 'Tasarım',
                        'suit': 'Dava'
                    };
                    
                    results.push({
                        id: doc.id,
                        title: data.title || data.brandText || 'İsimsiz',
                        type: typeMap[data.type] || data.type || 'Diğer',
                        number: data.applicationNumber || data.registrationNumber || data.applicationNo || data.registrationNo || data.fileNo || '-',
                        origin: data.origin || 'TÜRKPATENT',
                        rawData: data
                    });
                }
            });
            
            console.log('🔍 Varlık arama sonuçları:', results.length, 'kayıt bulundu');
            return results.slice(0, 50); // İlk 50 sonucu göster
            
        } catch (error) {
            console.error('❌ Varlık arama hatası:', error);
            return [];
        }
    };

    if (searchInput) {
        let timeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(timeout);
            const query = e.target.value.trim();
            if (query.length < 3) {
                searchResults.style.display = 'none';
                return;
            }

            timeout = setTimeout(async () => {
                const results = await searchAssets(query);
                
                if (results.length === 0) {
                    searchResults.innerHTML = '<div class="no-results-message">Varlık bulunamadı.</div>';
                } else {
                    searchResults.innerHTML = results.map(asset => 
                        `<div class="search-result-item" data-id="${asset.id}" data-type="${asset.type}" data-name="${asset.title}" data-number="${asset.number}">
                            <strong>${asset.title}</strong> (${asset.type}, ${asset.number})
                        </div>`
                    ).join('');
                }
                searchResults.style.display = 'block';
            }, 300);
        });
    }
    
    // Asset Seçim Mantığı
    if (searchResults) {
         searchResults.addEventListener('click', (e) => {
            const item = e.target.closest('.search-result-item');
            if (!item) return;

            const asset = {
                id: item.dataset.id,
                title: item.dataset.name,
                type: item.dataset.type,
                number: item.dataset.number
            };
            
            this.suitSubjectAsset = asset;
            document.getElementById('selectedSubjectAssetName').textContent = asset.title;
            document.getElementById('selectedSubjectAssetType').textContent = asset.type;
            document.getElementById('selectedSubjectAssetNumber').textContent = asset.number;
            
            selectedDisplay.style.display = 'block';
            searchInput.style.display = 'none';
            searchResults.style.display = 'none';
            searchInput.value = '';
            
            // ✅ Kaydet buton kontrolünü tetikle
            this.updateSaveButtonState();
        });
    }
    
    // Kaldır Butonu Mantığı
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            this.suitSubjectAsset = null;
            selectedDisplay.style.display = 'none';
            searchInput.style.display = 'block';
            searchInput.value = '';
            
            // ✅ Kaydet buton kontrolünü tetikle
            this.updateSaveButtonState();
        });
    }
}

// === YENİ: Müvekkil Arama Selector'larını Ayarlama ===
    setupSuitPersonSearchSelectors() {
        const clientSearchInput = document.getElementById('suitClientSearch');
        const searchResults = document.getElementById('suitClientSearchResults');
        const selectedDisplay = document.getElementById('selectedSuitClient');
        const selectedName = document.getElementById('selectedSuitClientName');
        const clearBtn = document.getElementById('clearSuitClient');
        const updateSaveButton = this.updateSaveButtonState.bind(this);

        // Person Search Logic
        if (clientSearchInput) {
            clientSearchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                if (query.length < 2) {
                    searchResults.style.display = 'none';
                    return;
                }
                this.searchPersons(query, 'suitClient');
            });
        }
        
        // Person Select Logic
        if (searchResults) {
             searchResults.addEventListener('click', (e) => {
                const item = e.target.closest('.search-result-item');
                if (!item) return;

                const personId = item.dataset.personId;
                const person = this.allPersons.find(p => p.id === personId);
                
                if (person) {
                    this.suitClientPerson = person;
                    selectedName.textContent = person.name;
                    selectedDisplay.style.display = 'block';
                    clientSearchInput.style.display = 'none';
                    searchResults.style.display = 'none';
                    updateSaveButton();
                }
            });
        }
        
        // Clear Logic
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.suitClientPerson = null;
                selectedDisplay.style.display = 'none';
                clientSearchInput.style.display = 'block';
                clientSearchInput.value = '';
                updateSaveButton();
            });
        }
    }

async getCountries() {
    try {
        const db = getFirestore();
        const docRef = doc(db, 'common', 'countries');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            return data.list || [];
        } else {
            console.log("common/countries belgesi bulunamadı!");
            return [];
        }
    } catch (error) {
        console.error("Ülke listesi çekilirken hata oluştu:", error);
        return [];
    }
}

populateCountriesDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    dropdown.innerHTML = '';
    
    const optionsHtml = this.allCountries.map(country => 
        `<option value="${country.code}">${country.name}</option>`
    ).join('');
    
    dropdown.innerHTML = optionsHtml;
}
}

// Global fonksiyonlar
window.clearNiceSearch = function() {
    const searchInput = document.getElementById('niceClassSearch');
    if (searchInput) {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
    }
};

// Temizle butonunun görünürlüğünü kontrol et
window.updateClearButton = function() {
    const clearBtn = document.getElementById('clearAllClassesBtn');
    const countBadge = document.getElementById('selectedClassCount');
    
    if (clearBtn && countBadge) {
        const count = parseInt(countBadge.textContent) || 0;
        clearBtn.style.display = count > 0 ? 'inline-block' : 'none';
        console.log('🔄 Temizle butonu güncellendi, seçim sayısı:', count);
    }
};

// Nice Classification render'ından sonra çağrılacak
window.addEventListener('load', () => {
    // Event-based güncelleme - interval yerine
    const observer = new MutationObserver(() => {
        if (window.updateClearButton) {
            window.updateClearButton();
        }
    });
    
    const target = document.getElementById('selectedClassCount');
    if (target) {
        observer.observe(target, { 
            childList: true, 
            subtree: true, 
            characterData: true 
        });
    }
});

// Sayfa yüklendiğinde modülü başlat

export default DataEntryModule; 
// === Tek DOMContentLoaded & guard'lı boot (await yok) ===
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Data Entry sayfası yükleniyor...');

  // Layout’u BEKLEMEDEN yükle (performans)
  loadSharedLayout({ activeMenuLink: 'data-entry.html' }).catch(console.error);

  // Modal'ı hazırla (varsa)
  if (typeof ensurePersonModal === 'function') {
    ensurePersonModal();
  }

  let started = false;
  function boot() {
    if (started) return;
    started = true;

    console.log('📋 Data Entry Module başlatılıyor...');
    const dataEntry = new DataEntryModule();
    // init içindeki async işleri kendi bekleyecek; burada await YOK
    dataEntry.init().then(() => {
      console.log('✅ Data Entry Module başlatıldı');
    }).catch((err) => {
      console.error('❌ Data Entry Module init hatası:', err);
    });
  }

  // Kullanıcı zaten girişliyse hemen başlat
  const current = (typeof auth !== 'undefined' && auth.currentUser) || (typeof authService !== 'undefined' && authService.getCurrentUser && authService.getCurrentUser());
  if (current) boot();

  // Auth olayını dinle; kullanıcı yoksa login'e REPLACE ile dön
  onAuthStateChanged(auth, (user) => {
    if (user) boot();
    else window.location.replace('index.html');
  });
});