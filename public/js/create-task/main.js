import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { loadSharedLayout } from '../layout-loader.js';
import { initializeNiceClassification, getSelectedNiceClasses } from '../nice-classification.js';
import { TASK_IDS } from './TaskConstants.js';
import { auth } from '../../firebase-config.js';
import { PersonModalManager } from '../components/PersonModalManager.js';

// Modüller
import { TaskDataManager } from './TaskDataManager.js';
import { TaskUIManager } from './TaskUIManager.js';
import { TaskValidator } from './TaskValidator.js';
import { TaskSubmitHandler } from './TaskSubmitHandler.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';

function initTaskDatePickers(root = document) {
    try {
        const IDS = ['taskDueDate', 'priorityDate', 'lawsuitDate', 'lawsuitDecisionDate', 'suitOpeningDate'];
        const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;
        IDS.forEach(id => {
            const el = (root && root.querySelector) ? root.querySelector(`#${id}`) : document.getElementById(id);
            if (!el || el._flatpickr) return;
            try { if (el.type === 'date') el.type = 'text'; } catch (e) {}
            if (typeof flatpickr !== 'function') return;
            flatpickr(el, {
                dateFormat: "Y-m-d", altInput: true, altFormat: "d.m.Y", allowInput: true, clickOpens: true,
                locale: (window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.tr) ? window.flatpickr.l10ns.tr : "tr",
                onClose: (selectedDates, dateStr, inst) => { if (inst.altInput.value && !dateRegex.test(inst.altInput.value)) inst.clear(); }
            });
        });
    } catch (err) { console.warn('Date picker init error:', err); }
}

class CreateTaskController {
    constructor() {
        this.dataManager = new TaskDataManager();
        this.uiManager = new TaskUIManager();
        this.validator = new TaskValidator();
        this.submitHandler = new TaskSubmitHandler(this.dataManager, this.uiManager);
        this.accrualFormManager = null;

        this.state = {
            currentUser: null, allIpRecords: [], allPersons: [], allUsers: [], allTransactionTypes: [], allCountries: [],
            selectedIpRecord: null, selectedTaskType: null, selectedRelatedParties: [], selectedRelatedParty: null,
            selectedTpInvoiceParty: null, selectedServiceInvoiceParty: null, selectedApplicants: [], priorities: [],
            selectedCountries: [], uploadedFiles: [],
            selectedOwners: [],
            isWithdrawalTask: false, searchSource: 'portfolio', isNiceClassificationInitialized: false, selectedWipoAripoChildren: []
        };
        this.personModal = new PersonModalManager();
        
    }

    async init() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                this.state.currentUser = user;
                await loadSharedLayout({ activeMenuLink: 'create-task.html' });
                try {
                    const initialData = await this.dataManager.loadInitialData();
                    Object.assign(this.state, initialData);
                    this.setupEventListeners();
                    this.setupIpRecordSearch();
                } catch (e) { console.error('Init hatası:', e); }
            } else { window.location.href = 'index.html'; }
        });
    }

// --- GÜNCELLENEN METOT: Tüm Butonlar İçin Global Dinleyici ---
setupEventListeners() {
        if (this._eventsBound) return;
        this._eventsBound = true;
        
        // 1. Statik Alanlar (Değişmeyenler)
        document.getElementById('mainIpType')?.addEventListener('change', (e) => this.handleMainTypeChange(e));
        document.getElementById('specificTaskType')?.addEventListener('change', (e) => this.handleSpecificTypeChange(e));
        
        const originSelect = document.getElementById('originSelect');
        if (originSelect) {
            originSelect.addEventListener('change', (e) => this.handleOriginChange(e.target.value));
        }

        // 1.5. VALIDATOR TETİKLEYİCİLERİ (Input ve Change Eventleri)
        document.addEventListener('input', (e) => {
            if (!e.target) {
                this.validator.checkCompleteness(this.state);
                return;
            }
            // Fiyat hesaplama alanları
            if (['officialFee', 'serviceFee', 'vatRate'].includes(e.target.id)) {
                this.calculateTotalAmount();
            }
            // Genel kontrol (Her tuşta çalışır)
            this.validator.checkCompleteness(this.state);
        });
                
        document.addEventListener('change', (e) => {
            // Checkbox ve Select değişimlerinde hesapla/kontrol et
            if (e.target.id === 'applyVatToOfficialFee') this.calculateTotalAmount();
            this.validator.checkCompleteness(this.state);
        });

        // 2. GLOBAL TIKLAMA YÖNETİCİSİ
        document.addEventListener('click', (e) => {
            
            // --- A) FORM AKSİYONLARI ---
            
            // 💾 KAYDET BUTONU
            if (e.target.id === 'saveTaskBtn' || e.target.closest('#saveTaskBtn')) {
                const btn = e.target.closest('#saveTaskBtn') || e.target;
                if (btn.disabled) return;
                
                // Tahakkuk Verisini Al
                let accrualData = null;
                const isFree = document.getElementById('isFreeTransaction')?.checked;
                
                if (!isFree && this.accrualFormManager) {
                    const result = this.accrualFormManager.getData();
                    const isFormVisible = document.getElementById('accrualToggleWrapper')?.style.display !== 'none';
                    
                    if (isFormVisible && !result.success) {
                        alert(result.error);
                        return;
                    }
                    if (result.success) accrualData = result.data;
                }

                this.state.accrualData = accrualData; 
                this.state.isFreeTransaction = isFree;

                console.log('💾 Kaydediliyor...', this.state);
                this.submitHandler.handleFormSubmit(e, this.state);
            }

            // ❌ İPTAL BUTONU
            if (e.target.id === 'cancelBtn') {
                if (confirm('İşlem iptal edilsin mi? Girilen veriler kaybolacak.')) {
                    window.location.href = 'task-management.html';
                }
            }

            // ⏩ İLERLE BUTONU
            if (e.target.id === 'nextTabBtn') {
                this.handleNextTab();
            }

            // --- B) SİLME VE TEMİZLEME ---

            // Varlık (Asset) Kaldır
            if (e.target.closest('#clearSelectedIpRecord')) {
                this.state.selectedIpRecord = null;
                document.getElementById('selectedIpRecordContainer').style.display = 'none';
                document.getElementById('ipRecordSearch').value = '';
                
                const imgEl = document.getElementById('selectedIpRecordImage');
                if(imgEl) imgEl.src = '';

                this.uiManager.unlockAndClearLawsuitFields();
                // İlişkili her şeyi temizle
                this.state.selectedRelatedParties = [];
                this.state.selectedWipoAripoChildren = [];
                this.state.selectedOwners = []; // Sahipleri de temizle

                this.uiManager.renderWipoAripoChildRecords([]);
                this.uiManager.renderSelectedOwners([]); // UI temizle

                const originSelect = document.getElementById('originSelect');
                const mainIpTypeSelect = document.getElementById('mainIpType');
                if (originSelect) originSelect.disabled = false;
                if (mainIpTypeSelect) mainIpTypeSelect.disabled = false;
                
                this.validator.checkCompleteness(this.state);
            }

            // İlgili Taraf Sil
            const removePartyBtn = e.target.closest('.remove-party');
            if (removePartyBtn) {
                const id = removePartyBtn.dataset.id;
                this.state.selectedRelatedParties = this.state.selectedRelatedParties.filter(p => String(p.id) !== String(id));
                this.uiManager.renderSelectedRelatedParties(this.state.selectedRelatedParties);
                this.validator.checkCompleteness(this.state);
            }

            // YENİ: Sahip (Owner) Silme
            const removeOwnerBtn = e.target.closest('.remove-owner-btn');
            if (removeOwnerBtn) {
                const id = removeOwnerBtn.dataset.id;
                if (this.state.selectedOwners) {
                    this.state.selectedOwners = this.state.selectedOwners.filter(p => String(p.id) !== String(id));
                    this.uiManager.renderSelectedOwners(this.state.selectedOwners);
                    this.validator.checkCompleteness(this.state);
                }
            }

            // Başvuru Sahibi Sil / Liste Öğesi Sil (Genel)
            const removeListItemBtn = e.target.closest('.remove-selected-item-btn');
            if (removeListItemBtn) {
                const id = removeListItemBtn.dataset.id;
                // Sadece başvuru sahipleri listesindeyse oradan sil
                if (this.state.selectedApplicants.some(a=>a.id === id)) {
                    this.state.selectedApplicants = this.state.selectedApplicants.filter(p => String(p.id) !== String(id));
                    this.uiManager.renderSelectedApplicants(this.state.selectedApplicants);
                }
                // Ülke silme işlemi 'setupMultiCountrySelect' içinde ayrı yönetiliyor olabilir ama burada da check edilebilir
                this.validator.checkCompleteness(this.state);
            }

            // WIPO/ARIPO Alt Kayıt Sil
            const removeWipoBtn = e.target.closest('.remove-wipo-child-btn');
            if (removeWipoBtn) {
                const id = removeWipoBtn.dataset.id;
                this.state.selectedWipoAripoChildren = this.state.selectedWipoAripoChildren.filter(c => String(c.id) !== String(id));
                this.uiManager.renderWipoAripoChildRecords(this.state.selectedWipoAripoChildren);
                this.validator.checkCompleteness(this.state);
            }

            // --- C) ORTAK MODAL ENTEGRASYONU (Müvekkil, Başvuru Sahibi, Sahip) ---
            if (e.target.closest('#addNewPersonBtn') || e.target.closest('#addNewApplicantBtn') || e.target.closest('#addNewOwnerBtn')) {
                const isApplicant = e.target.closest('#addNewApplicantBtn'); 
                const isOwner = e.target.closest('#addNewOwnerBtn');

                // Ortak Modalımızı Açıyoruz
                this.personModal.open(null, (newPerson) => { 
                    // 1. Genel Listeye Ekle
                    this.state.allPersons.push(newPerson); 
                    
                    // 2. Tıklanan butona göre ilgili listeye ve UI'ya ekle
                    if (isApplicant) {
                        if(!this.state.selectedApplicants.some(a => a.id === newPerson.id)) {
                            this.state.selectedApplicants.push(newPerson);
                            this.uiManager.renderSelectedApplicants(this.state.selectedApplicants);
                        }
                    } 
                    else if (isOwner) {
                        this.handlePersonSelection(newPerson, 'owner');
                    }
                    else {
                        // Müvekkil / İlgili Taraf
                        this.handlePersonSelection(newPerson, 'relatedParty'); 
                    }
                    
                    this.validator.checkCompleteness(this.state);
                });
            }
            
            // --- D) TAHAKKUK UI ---
            if (e.target.id === 'toggleAccrualFormBtn' || e.target.closest('#toggleAccrualFormBtn')) {
                const wrapper = document.getElementById('accrualToggleWrapper'); 
                const btn = document.getElementById('toggleAccrualFormBtn');
                
                if (wrapper && wrapper.style.display === 'none') {
                    if (window.$) $(wrapper).slideDown(300); else wrapper.style.display = 'block';
                    btn.innerHTML = '<i class="fas fa-chevron-up mr-1"></i> Tahakkuk Formunu Gizle';
                    btn.classList.replace('btn-outline-primary', 'btn-outline-secondary');
                } else if (wrapper) {
                    if (window.$) $(wrapper).slideUp(300); else wrapper.style.display = 'none';
                    btn.innerHTML = '<i class="fas fa-chevron-down mr-1"></i> Tahakkuk Formu Aç';
                    btn.classList.replace('btn-outline-secondary', 'btn-outline-primary');
                }
            }

            // Ücretsiz İşlem Checkbox
            if (e.target.id === 'isFreeTransaction') {
                const isChecked = e.target.checked;
                const btn = document.getElementById('toggleAccrualFormBtn');
                const wrapper = document.getElementById('accrualToggleWrapper');
                
                if (isChecked) {
                    if(wrapper) wrapper.style.display = 'none';
                    if(btn) {
                        btn.disabled = true;
                        btn.innerHTML = '<i class="fas fa-chevron-down mr-1"></i> Tahakkuk Formu Aç';
                    }
                    if (this.accrualFormManager) this.accrualFormManager.reset();
                } else {
                    if(btn) btn.disabled = false;
                }
            }
        });
        
        // 3. Parent Transaction Event
        document.addEventListener('parentTransactionSelected', (e) => {
            this.submitHandler.selectedParentTransactionId = e.detail.id;
            this.uiManager.hideParentSelectionModal();
            alert('Geri çekilecek işlem seçildi.');
        });
        
        const closeModalBtns = document.querySelectorAll('#selectParentModal .close, #selectParentModal .btn-secondary');
        closeModalBtns.forEach(btn => btn.addEventListener('click', () => this.uiManager.hideParentSelectionModal()));

        // 4. Change Listeners (Mahkeme, Dosya vb.)
        document.addEventListener('change', (e) => {
            // Mahkeme "Diğer" seçimi
            if (e.target && e.target.id === 'courtName') {
                const customInput = document.getElementById('customCourtInput');
                if (customInput) {
                    if (e.target.value === 'other') {
                        customInput.style.display = 'block';
                        customInput.focus();
                        customInput.setAttribute('required', 'true');
                    } else {
                        customInput.style.display = 'none';
                        customInput.value = ''; 
                        customInput.removeAttribute('required');
                    }
                }
            }

            // Dava Dokümanı
            if (e.target.id === 'suitDocument') {
                const newFiles = Array.from(e.target.files);
                this.state.uploadedFiles = [...(this.state.uploadedFiles || []), ...newFiles];
                this.uiManager.renderUploadedFiles(this.state.uploadedFiles);
                e.target.value = ''; 
            }
        });

        // 5. TAB DEĞİŞİMİ VE VERİ YÜKLEME
        if (window.$) {
            $(document).on('shown.bs.tab', '#myTaskTabs a', async (e) => {
                const allTabs = document.querySelectorAll('#myTaskTabs .nav-link');
                const activeTab = e.target;
                const isLastTab = (allTabs[allTabs.length - 1] === activeTab);

                this.uiManager.updateButtonsAndTabs(isLastTab);

                const targetTabId = e.target.getAttribute('href').substring(1);
                
                if (targetTabId === 'goods-services' && !this.state.isNiceClassificationInitialized) {
                    if (typeof initializeNiceClassification === 'function') {
                         await initializeNiceClassification();
                         this.state.isNiceClassificationInitialized = true;
                    }
                }
                
                if (targetTabId === 'applicants') {
                    this.uiManager.renderSelectedApplicants(this.state.selectedApplicants);
                }
                
                if (targetTabId === 'priority') {
                    const prioSelect = document.getElementById('priorityCountry');
                    if (prioSelect && prioSelect.options.length <= 1) {
                        this.uiManager.populateDropdown('priorityCountry', this.state.allCountries, 'code', 'name');
                    }
                    this.uiManager.renderPriorities(this.state.priorities);
                }
                
                if (targetTabId === 'summary') {
                    this.uiManager.renderSummaryTab(this.state);
                }

                this.validator.checkCompleteness(this.state);
            });
        }
        
        // 6. ÖZEL TAKİPÇİ (Marka Adı İçin)
        document.addEventListener('focusin', (e) => {
            if (e.target.id === 'brandExampleText') {
                e.target.oninput = () => {
                    this.validator.checkCompleteness(this.state);
                };
            }
        });

        this.setupBrandExample();
    }

    setupNiceListObserver() {
        const niceListContainer = document.getElementById('selectedNiceClasses');
        if (niceListContainer) {
            // Varsa eski observer'ı temizlemek iyi olur ama basitlik adına direkt yenisini kuralım
            const niceListObserver = new MutationObserver(() => {
                console.log('🔄 Nice sınıf listesi değişti (Observer Aktif)');
                this.validator.checkCompleteness(this.state);
            });
            niceListObserver.observe(niceListContainer, { childList: true, subtree: true });
        }
    }

    handleNextTab() {
        // Aktif sekmeyi bul
        const activeTab = document.querySelector('#myTaskTabs .nav-link.active');
        if (!activeTab) return;
        
        // Bir sonraki sekmeyi (li elemanını) bul
        const parentLi = activeTab.parentElement;
        const nextLi = parentLi.nextElementSibling;
        
        // Eğer sonraki sekme varsa geçiş yap
        if (nextLi) {
            const nextLink = nextLi.querySelector('.nav-link');
            if (nextLink) {
                // Bootstrap tab fonksiyonu ile geçiş yap
                $(nextLink).tab('show');
            }
        }
    }

    handleMainTypeChange(e) {
        const mainType = e.target.value;
        const specificSelect = document.getElementById('specificTaskType');
        this.uiManager.clearContainer();
        this.resetSelections();
        specificSelect.innerHTML = '<option value="">Seçiniz...</option>';
        if (mainType) {
            const filtered = this.state.allTransactionTypes.filter(t => {
                return (t.hierarchy === 'parent' && t.ipType === mainType) || 
                       (t.hierarchy === 'child' && t.isTopLevelSelectable && (t.applicableToMainType?.includes(mainType) || t.applicableToMainType?.includes('all')));
            }).sort((a, b) => (a.order || 999) - (b.order || 999));
            filtered.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id; opt.textContent = t.alias || t.name; specificSelect.appendChild(opt);
            });
            specificSelect.disabled = false;
        } else { specificSelect.disabled = true; }
        
        this.uiManager.populateDropdown('originSelect', 
            (mainType === 'suit' ? [{value:'TURKEY', text:'Türkiye'}, {value:'FOREIGN_NATIONAL', text:'Yurtdışı'}] : 
            [{value:'TÜRKPATENT', text:'TÜRKPATENT'}, {value:'WIPO', text:'WIPO'}, {value:'EUIPO', text:'EUIPO'}, {value:'ARIPO', text:'ARIPO'}, {value:'Yurtdışı Ulusal', text:'Yurtdışı Ulusal'}]), 
            'value', 'text', 'Seçiniz...'
        );
        
        if (mainType === 'suit') { document.getElementById('originSelect').value = 'TURKEY'; this.handleOriginChange('TURKEY'); }
        else { document.getElementById('originSelect').value = 'TÜRKPATENT'; this.handleOriginChange('TÜRKPATENT'); }
    }


    toggleAssetSearchVisibility(originValue) {
        const typeId = String(this.state.selectedTaskType?.id || '');
        const container = document.getElementById('assetSearchContainer');
        
        // 79, 80 ve 82 nolu işlemlerde TÜRKPATENT seçilirse gizle
        if (container && ['79', '80', '82'].includes(typeId)) {
            if (originValue === 'TÜRKPATENT') {
                container.style.display = 'none';
            } else {
                container.style.display = 'block';
            }
        } else if (container) {
            container.style.display = 'block';
        }
    }

    async handleSpecificTypeChange(e) {
        const typeId = e.target.value;
        const selectedType = this.state.allTransactionTypes.find(t => t.id === typeId);
        this.state.selectedTaskType = selectedType;
        
        if (!selectedType) { this.uiManager.clearContainer(); return; }

        const tIdStr = String(typeId);
        this.state.isWithdrawalTask = (tIdStr === '21' || tIdStr === '8');
        
        // ============================================================
        // ---> ÖZEL İŞLEMLER (Unvan, Nevi, Araştırma, Adres - ID 79, 80, 81, 82)
        // ============================================================
        if (['79', '80', '81', '82'].includes(tIdStr)) {
            console.log('⚡ Özel İşlem Seçildi:', selectedType.name);
            
            // 1. Formu Çiz
            this.uiManager.renderOtherTaskForm(selectedType);

            // ---> YENİ: ID 82 İÇİN ŞEHİR VE ÜLKE MANTIĞI <---
            if (tIdStr === '82') {
                // A) Ülkeleri Doldur
                this.uiManager.populateDropdown('newAddressCountry', this.state.allCountries, 'code', 'name');
                
                // B) Şehirleri Çek (Eğer henüz çekilmediyse)
                // Not: DataManager düz string listesi ["Adana", ...] dönse bile aşağıda düzelteceğiz.
                if (!this.state.allCities || this.state.allCities.length === 0) {
                    try {
                        console.log("📥 Şehirler çekiliyor...");
                        this.state.allCities = await this.dataManager.getCities();
                        console.log(`✅ ${this.state.allCities.length} adet şehir çekildi.`);
                    } catch (err) {
                        console.error("Şehir çekme hatası:", err);
                        this.state.allCities = [];
                    }
                }

                // C) Ülke Değişimini Dinle
                const countrySelect = document.getElementById('newAddressCountry');
                const citySelect = document.getElementById('newAddressCity');

                if (countrySelect && citySelect) {
                    // Tekrar listener eklenmemesi için kontrol
                    if (!countrySelect.dataset.cityListenerAdded) {
                        countrySelect.addEventListener('change', (ev) => {
                            const val = ev.target.value;
                            console.log('🌍 Ülke seçildi:', val);
                            
                            // "Türkiye" kontrolü
                            const isTurkey = ['TR', 'TUR', 'Turkey', 'Türkiye'].includes(val);

                            if (isTurkey) {
                                console.log('🇹🇷 Türkiye seçildi, şehirler yükleniyor...');
                                citySelect.disabled = false;
                                
                                // --- KRİTİK DÜZELTME: VERİ FORMATI KONTROLÜ ---
                                let citiesToRender = this.state.allCities || [];
                                console.log('📊 Şehir verisi:', citiesToRender);
                                
                                // Eğer liste boş değilse ve ilk eleman bir 'string' ise (Örn: "Adana")
                                // Bunu dropdown'ın anlayacağı {name: "Adana"} formatına çeviriyoruz.
                                if (citiesToRender.length > 0 && typeof citiesToRender[0] === 'string') {
                                    citiesToRender = citiesToRender.map(c => ({ name: c }));
                                    console.log('✅ Şehirler obje formatına çevrildi');
                                }
                                
                                // Dropdown'ı doldur
                                this.uiManager.populateDropdown('newAddressCity', citiesToRender, 'name', 'name', 'Şehir Seçiniz...');
                                console.log('✅ Şehir dropdown dolduruldu');
                            } else {
                                console.log('🌎 Türkiye dışı ülke seçildi');
                                // Türkiye değilse kapat
                                citySelect.disabled = true;
                                citySelect.innerHTML = '<option value="">Önce Ülke Seçiniz...</option>';
                                citySelect.value = '';
                            }
                            this.validator.checkCompleteness(this.state);
                        });
                        countrySelect.dataset.cityListenerAdded = 'true';
                        console.log('✅ Ülke değişim listener eklendi');
                    }
                }
            }
            
            // 2. Tahakkuk (Accrual) Başlatma
            if (document.getElementById('createTaskAccrualContainer')) {
                this.accrualFormManager = new AccrualFormManager(
                    'createTaskAccrualContainer', 
                    'createTaskAcc', 
                    this.state.allPersons 
                );
                this.accrualFormManager.render();
            }

            // 3. Arama ve Validasyon Ayarları
            this.setupMultiAssetSearch(tIdStr);
            this.applyAssignmentRule(await this.dataManager.getAssignmentRule(typeId));
            this.dedupeActionButtons();
            
            // 4. Görünürlük Ayarı (TÜRKPATENT ise Gizle)
            const currentOrigin = document.getElementById('originSelect')?.value || 'TÜRKPATENT';
            if (this.toggleAssetSearchVisibility) {
                this.toggleAssetSearchVisibility(currentOrigin);
            }

            // 5. Kişi Arama Dinleyicileri (Sahip arama inputu için şart!)
            this.setupPersonSearchListeners();

            // 6. Tarihçiler ve Validasyon
            setTimeout(() => initTaskDatePickers(), 100);
            
            // Validasyon listesine yeni adres inputlarını ekle
            const newInputs = [
                'newTitleInput', 'newTypeInput', 'taxNumberInput', 'searchKeywordInput', 
                'newAddressText', 'newAddressCountry', 'newAddressCity'
            ];
            newInputs.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('input', () => this.validator.checkCompleteness(this.state));
                    el.addEventListener('change', () => this.validator.checkCompleteness(this.state));
                }
            });

            this.validator.checkCompleteness(this.state);
            return; // Standart akışı burada kes
        }

        // ============================================================
        // ---> STANDART İŞLEMLER (Mevcut Kodunuz)
        // ============================================================
        const isMarkaBasvuru = selectedType.alias === 'Başvuru' && selectedType.ipType === 'trademark';
        
        if (isMarkaBasvuru) {
            this.uiManager.renderTrademarkApplicationForm();
            setTimeout(() => this.setupNiceListObserver(), 100);
        } else {
            this.uiManager.renderBaseForm(
                selectedType.alias || selectedType.name,
                selectedType.id,
                selectedType.ipType === 'suit', 
                this.state.allTransactionTypes 
            );
        }
        
        const assetSource = selectedType.relatedAssetSource || 'ipRecords';
        this.state.searchSource = assetSource; 
        this.state.targetSuitTypes = selectedType.targetSuitTypes || []; 
        
        this.uiManager.updateAssetSearchLabel(assetSource);

        if (document.getElementById('createTaskAccrualContainer')) {
            this.accrualFormManager = new AccrualFormManager(
                'createTaskAccrualContainer', 
                'createTaskAcc', 
                this.state.allPersons 
            );
            this.accrualFormManager.render();
        }

        setTimeout(() => { initTaskDatePickers(); this.setupBrandExample(); }, 100);
        this.setupIpRecordSearch();
        
        if (!isMarkaBasvuru) {
            this.setupPersonSearchListeners();
        } else {
            this.setupApplicantListeners();
            this.handleOriginChange(document.getElementById('originSelect').value);
        }

        const rule = await this.dataManager.getAssignmentRule(typeId);
        this.applyAssignmentRule(rule);
        
        this.dedupeActionButtons();
        this.validator.checkCompleteness(this.state);
    }

// --- MENŞE VE ÜLKE SEÇİMİ (DÜZELTİLDİ) ---

    handleOriginChange(val) {
        // 1. Önceki seçimleri temizle (Kaynak değiştiği için eski veriler geçersiz olabilir)
        this.resetSelections();
        this.uiManager.unlockAndClearLawsuitFields();
        this.toggleAssetSearchVisibility(val);
        
        const ipRecordContainer = document.getElementById('selectedIpRecordContainer');
        if(ipRecordContainer) ipRecordContainer.style.display = 'none';

        // 2. Görünürlük Ayarları (Mevcut mantığın korunmuş hali)
        const container = document.getElementById('countrySelectionContainer');
        const singleWrapper = document.getElementById('singleCountrySelectWrapper');
        const multiWrapper = document.getElementById('multiCountrySelectWrapper');
        const title = document.getElementById('countrySelectionTitle');
        
        if (!container || !singleWrapper || !multiWrapper) return;

        // Varsayılan: Hepsini gizle
        container.style.display = 'none';
        singleWrapper.style.display = 'none';
        multiWrapper.style.display = 'none';

        // 3. İşlem Tipine Göre Kontrol
        const t = this.state.selectedTaskType;
        const isApplication = (t && (t.alias === 'Başvuru' || t.name === 'Başvuru'));
        const isSuit = (t && t.ipType === 'suit') || (document.getElementById('mainIpType')?.value === 'suit');

        // Sadece Başvuru veya Dava ise ülke seçimi aç
        if (!isApplication && !isSuit) return; 

        // 4. Seçime Göre Alanı Aç
        if (['Yurtdışı Ulusal', 'FOREIGN_NATIONAL'].includes(val)) {
            container.style.display = 'block';
            singleWrapper.style.display = 'block';
            if(title) title.textContent = 'Menşe Ülke Seçimi';
            this.uiManager.populateDropdown('countrySelect', this.state.allCountries, 'code', 'name');
        } 
        else if (['WIPO', 'ARIPO'].includes(val)) {
            container.style.display = 'block';
            multiWrapper.style.display = 'block';
            if(title) title.textContent = `Seçim Yapılacak Ülkeler (${val})`;
            this.setupMultiCountrySelect(); 
        }
    }

    // Kaynak TÜRKPATENT ise ve işlem tipi 79 veya 80 ise Varlık Arama alanını gizler
    toggleAssetSearchVisibility(originValue) {
        const typeId = String(this.state.selectedTaskType?.id || '');
        const container = document.getElementById('assetSearchContainer');
        
        // Sadece container varsa ve işlem Unvan (79) veya Nevi (80) ise çalışır
        if (container && ['79', '80', '82'].includes(typeId)) {
            if (originValue === 'TÜRKPATENT') {
                container.style.display = 'none';
                console.log('🙈 TÜRKPATENT seçildiği için Varlık Arama gizlendi.');
                // İsteğe bağlı: Gizlenince önceki seçimleri temizle
                this.state.selectedIpRecord = null;
                document.getElementById('selectedIpRecordContainer').style.display = 'none';
            } else {
                container.style.display = 'block';
                console.log('👀 Varlık Arama gösteriliyor.');
            }
        } else if (container) {
            // Diğer tüm işlemlerde her zaman göster
            container.style.display = 'block';
        }
    }

    // --- ÇOKLU ÜLKE SEÇİMİ (EKLENDİ) ---
    setupMultiCountrySelect() {
        const input = document.getElementById('countriesMultiSelectInput');
        const results = document.getElementById('countriesMultiSelectResults');
        const list = document.getElementById('selectedCountriesList');
        
        if (!input || !results) return;

        // Input Listener
        input.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            if (term.length < 2) { results.style.display = 'none'; return; }
            
            const filtered = this.state.allCountries.filter(c => 
                c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term)
            );
            this.renderCountrySearchResults(filtered);
        };

        // Results Click Listener (Delegation)
        results.onclick = (e) => {
            const item = e.target.closest('.search-result-item');
            if (item) {
                const code = item.dataset.code;
                const name = item.dataset.name;
                
                if (!this.state.selectedCountries.some(c => c.code === code)) {
                    this.state.selectedCountries.push({ code, name });
                    this.renderSelectedCountries();
                }
                input.value = '';
                results.style.display = 'none';
                this.validator.checkCompleteness(this.state);
            }
        };

        // Remove Click Listener (Delegation)
        list.onclick = (e) => {
            const btn = e.target.closest('.remove-selected-item-btn');
            if (btn) {
                const code = btn.dataset.code;
                this.state.selectedCountries = this.state.selectedCountries.filter(c => c.code !== code);
                this.renderSelectedCountries();
                this.validator.checkCompleteness(this.state);
            }
        };

        this.renderSelectedCountries(); // Varsa mevcutları göster
    }

    renderCountrySearchResults(items) {
        const results = document.getElementById('countriesMultiSelectResults');
        if (!results) return;
        
        if (items.length === 0) {
            results.innerHTML = '<div class="p-2 text-muted">Sonuç yok</div>';
        } else {
            results.innerHTML = items.map(c => `
                <div class="search-result-item p-2 border-bottom" style="cursor:pointer;" data-code="${c.code}" data-name="${c.name}">
                    ${c.name} (${c.code})
                </div>
            `).join('');
        }
        results.style.display = 'block';
    }

    renderSelectedCountries() {
        const list = document.getElementById('selectedCountriesList');
        const badge = document.getElementById('selectedCountriesCount');
        if (!list) return;

        if (badge) badge.textContent = this.state.selectedCountries.length;

        if (this.state.selectedCountries.length === 0) {
            list.innerHTML = '<div class="empty-state"><i class="fas fa-flag fa-2x text-muted mb-2"></i><p class="text-muted">Henüz ülke eklenmedi.</p></div>';
            return;
        }

        list.innerHTML = this.state.selectedCountries.map(c => `
            <div class="selected-item d-flex justify-content-between align-items-center p-2 mb-2 border rounded">
                <span>${c.name} (${c.code})</span>
                <button type="button" class="btn btn-sm btn-danger remove-selected-item-btn" data-code="${c.code}">&times;</button>
            </div>
        `).join('');
    }

    dedupeActionButtons() {
        const saves = Array.from(document.querySelectorAll('#saveTaskBtn'));
        if (saves.length > 1) saves.slice(0, -1).forEach(b => b.closest('.form-actions')?.remove());

        const cancels = Array.from(document.querySelectorAll('#cancelBtn'));
        if (cancels.length > 1) cancels.slice(0, -1).forEach(b => b.closest('.form-actions')?.remove());
    }

    // --- MARKA ÖRNEĞİ (DRAG & DROP) ---
    setupBrandExample() {
        const dropZone = document.getElementById('brand-example-drop-zone');
        const input = document.getElementById('brandExample');
        if(!dropZone || !input) return;

        dropZone.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => this.handleBrandFile(e.target.files[0]));
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => {
            dropZone.addEventListener(e, (ev) => { ev.preventDefault(); ev.stopPropagation(); });
        });
        dropZone.addEventListener('drop', (e) => this.handleBrandFile(e.dataTransfer.files[0]));
        
        document.getElementById('removeBrandExampleBtn')?.addEventListener('click', () => {
            this.state.uploadedFiles = [];
            document.getElementById('brandExamplePreviewContainer').style.display = 'none';
            input.value = '';
        });
    }

    async handleBrandFile(file) {
        if (!file) return;
        
        // 1. Validasyon
        if (!file.type.startsWith('image/')) {
            alert('Lütfen geçerli bir resim dosyası seçin (PNG, JPG, JPEG)');
            this.state.uploadedFiles = [];
            return;
        }

        console.log('🖼️ Görsel işleniyor...');

        // 2. Canvas ile Resize İşlemi (591x591)
        const img = new Image();
        img.src = URL.createObjectURL(file);
        
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 591;
            canvas.height = 591;
            const ctx = canvas.getContext('2d');
            
            // Arka planı beyaz yap (Şeffaf PNG'lerin siyah çıkmasını önler)
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Resmi canvas'a çiz (Stretch/Sığdırma)
            ctx.drawImage(img, 0, 0, 591, 591);
            
            // Blob'a çevir (JPEG formatında, %92 kalite)
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
            
            // Yeni dosya objesi oluştur
            const newFile = new File([blob], 'brand-example.jpg', { type: 'image/jpeg' });
            
            // 3. State'i Güncelle (SubmitHandler bu dosyayı kullanacak)
            this.state.uploadedFiles = [newFile];
            
            // 4. Önizlemeyi Göster
            const previewImg = document.getElementById('brandExamplePreview');
            const container = document.getElementById('brandExamplePreviewContainer');
            
            if(previewImg) previewImg.src = URL.createObjectURL(blob);
            if(container) container.style.display = 'block';
            
            console.log('✅ Görsel başarıyla dönüştürüldü (591x591):', newFile);
        };
        
        img.onerror = (err) => {
            console.error('Görsel yüklenirken hata:', err);
            alert('Görsel işlenemedi.');
        };
    }

// --- IP KAYIT SEÇİMİ & GERİ ÇEKME MANTIĞI ---
    setupIpRecordSearch() {
        const input = document.getElementById('ipRecordSearch');
        const results = document.getElementById('ipRecordSearchResults');
        if (!input || !results) return;
        
        const typeId = String(this.state.selectedTaskType?.id || '');
        const selectedType = this.state.selectedTaskType;

        // 1. Önce Veritabanı Ayarına Bak (Suits mi?)
        if (selectedType && selectedType.relatedAssetSource === 'suits') {
            this.state.searchSource = 'suits';
            this.state.targetSuitTypes = selectedType.targetSuitTypes || [];
        } 
        // 2. Yoksa ID Bazlı Arama Kaynağı Belirle
        else {
            // A) SADECE BÜLTEN ARAMASI YAPILACAKLAR
            // Buraya "3. Kişi Görüşü" (ID: 170 veya string ID) ekliyoruz.
            const isBulletinOnly = [
                '1'
            ].includes(typeId);

            // B) HİBRİT ARAMA (HEM PORTFÖY HEM BÜLTEN) YAPILACAKLAR
            const isHybrid = [
                '20', 'trademark_publication_objection', TASK_IDS.ITIRAZ_YAYIN,
                '19', 'trademark_reconsideration_of_publication_objection', TASK_IDS.YAYIMA_ITIRAZIN_YENIDEN_INCELENMESI,
                '8', TASK_IDS.KARARA_ITIRAZ_GERI_CEKME,
                '21', TASK_IDS.YAYINA_ITIRAZI_GERI_CEKME
            ].includes(typeId);

            // KARAR MEKANİZMASI
            if (isBulletinOnly) {
                this.state.searchSource = 'bulletin';
            } 
            else if (isHybrid) {
                this.state.searchSource = 'hybrid'; 
            } 
            else {
                this.state.searchSource = 'portfolio';
            }
        }
        
        console.log(`🔍 Arama Modu: ${this.state.searchSource.toUpperCase()}`);

        // Input Yenileme
        const newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);

        let timer;
        
        // --- NORMALİZASYON FONKSİYONU ---
        // Numaraları (2023/123 -> 2023123) saf hale getirir. Eşleşme başarısını artırır.
        const normalize = (val) => String(val || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

        newInput.addEventListener('input', (e) => {
            const term = e.target.value.trim();
            clearTimeout(timer);
            
            if (term.length < 2) { results.style.display = 'none'; return; }
            
            timer = setTimeout(async () => {
                let items = [];
                console.log(`🔎 Aranıyor (Mod: ${this.state.searchSource}): "${term}"`);

                try {
                    // --- 1. DAVA ARAMA MODU ---
                    if (this.state.searchSource === 'suits') {
                        // TaskDataManager'daki searchSuits fonksiyonunu kullan
                        items = await this.dataManager.searchSuits(term, this.state.targetSuitTypes);
                    }
                    // --- 2. BÜLTEN MODU ---
                    else if (this.state.searchSource === 'bulletin') {
                        const res = await this.dataManager.searchBulletinRecords(term);
                        items = res.map(x => ({ ...x, _source: 'bulletin' }));
                    } 
                    // --- 3. HİBRİT MODU ---
                    else if (this.state.searchSource === 'hybrid') {
                        const [bulletinRes, portfolioRes] = await Promise.all([
                            this.dataManager.searchBulletinRecords(term),
                            this._searchPortfolioLocal(term)
                        ]);
                        
                        // Deduplication (Çift kayıt engelleme)
                        const pItems = portfolioRes.map(x => ({ ...x, _source: 'portfolio' }));
                        const normalize = (val) => String(val || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                        const existingAppNos = new Set(pItems.map(p => normalize(p.applicationNumber || p.applicationNo)));

                        const uniqueBItems = bulletinRes
                            .map(x => ({ ...x, _source: 'bulletin' }))
                            .filter(b => !existingAppNos.has(normalize(b.applicationNo || b.applicationNumber)));

                        items = [...pItems, ...uniqueBItems];
                    }
                    // --- 4. PORTFÖY MODU ---
                    else {
                        const res = this._searchPortfolioLocal(term);
                        items = res.map(x => ({ ...x, _source: 'portfolio' }));
                    }
                    
                    // --- SONUÇLARI GÖSTER (TaskUIManager Kullanarak) ---
                    // onSelect callback'i ile seçim yapıldığında ne olacağını belirliyoruz
                    this.uiManager.renderAssetSearchResults(items, async (record, source) => {
                        
                        // Bülten ise detay çek
                        if (source === 'bulletin') {
                            console.log('📥 Bülten detayı çekiliyor...');
                            const details = await this.dataManager.fetchAndStoreBulletinData(record.id);
                            if(details) record = {...record, ...details};
                        }
                        
                        record._source = source;
                        this.selectIpRecord(record); // Seçim metodunu çağır
                        document.getElementById('ipRecordSearch').value = ''; // Inputu temizle

                    }, this.state.searchSource);

                } catch (err) {
                    console.error('Arama hatası:', err);
                }
            }, 300);
        });
        
        document.addEventListener('click', (e) => {
            if (!results.contains(e.target) && e.target !== newInput) results.style.display = 'none';
        });
    }

    setupMultiAssetSearch(typeId) {
        console.log('🛠️ Özel İşlem Modu Hazırlanıyor: ID', typeId);
        
        // 1. Arama Başlığını Güncelle
        // TaskUIManager'daki updateAssetSearchLabel metodunu kullanıyoruz
        if (typeId === '81') {
            this.uiManager.updateAssetSearchLabel('research'); // "Araştırma için Varlık Seçimi" gibi
        } else {
            this.uiManager.updateAssetSearchLabel('portfolio');
        }

        // 2. Varlık Arama Listener'ını Tekrar Başlat (Gerekirse modu değiştirerek)
        // searchSource state'ini güncelle
        this.state.searchSource = 'portfolio'; // Bu işlemler genelde portföydeki mevcut dosya üzerinden yapılır
        
        this.setupIpRecordSearch();
        
        // 3. Validator Kontrolü için Listener Ekle (Yeni inputlar için)
        const newInputs = ['newTitleInput', 'newTypeInput', 'searchKeywordInput'];
        newInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => this.validator.checkCompleteness(this.state));
            }
        });
    }

// --- GÜNCELLENEN METOT 2: Sonuç Gösterimi ve Etiketleme ---
    renderIpSearchResults(items, container) {
        if (items.length === 0) {
            container.innerHTML = '<div class="p-2 text-muted">Sonuç bulunamadı.</div>';
        } else {
            container.innerHTML = items.map(item => {
                let badge = '';
                let title = '';
                let subTitle = '';

                // --- A) DAVA KARTI TASARIMI ---
                if (item._source === 'suit') {
                    badge = '<span class="badge badge-primary float-right" style="font-size: 10px;">Dava</span>';
                    title = item.court || 'Mahkeme Bilgisi Yok';
                    subTitle = `Dosya: <b>${item.fileNumber || '-'}</b>`;
                } 
                // --- B) MARKA/PATENT KARTI TASARIMI ---
                else {
                    const isThirdParty = String(item.recordOwnerType || '').toLowerCase() === 'third_party';
                    
                    if (item._source === 'bulletin' || isThirdParty) {
                        badge = '<span class="badge badge-warning float-right" style="font-size: 10px;">Bülten</span>';
                    } else {
                        badge = '<span class="badge badge-info float-right" style="font-size: 10px;">Portföy</span>';
                    }
                    
                    title = item.title || item.markName || '-';
                    subTitle = item.applicationNumber || item.applicationNo || '-';
                }

                return `
                <div class="search-result-item p-2 border-bottom" style="cursor:pointer;" data-id="${item.id}" data-source="${item._source}">
                    ${badge}
                    <strong>${title}</strong>
                    <br><small>${subTitle}</small>
                </div>
            `}).join('');
            
            // Tıklama Olayları
            container.querySelectorAll('.search-result-item').forEach(el => {
                el.addEventListener('click', async () => {
                    const id = el.dataset.id;
                    const source = el.dataset.source;
                    
                    let record = items.find(i => i.id === id);
                    
                    // Eğer Bülten ise detayını çek
                    if (source === 'bulletin') {
                         console.log('📥 Bülten detayı çekiliyor...');
                         const details = await this.dataManager.fetchAndStoreBulletinData(record.id);
                         if(details) record = {...record, ...details};
                    }
                    
                    record._source = source;
                    this.selectIpRecord(record);
                    
                    container.style.display = 'none';
                    document.getElementById('ipRecordSearch').value = '';
                });
            });
        }
        container.style.display = 'block';
    }

// --- YENİ YARDIMCI METOT: Local Portföy Filtreleme ---
    _searchPortfolioLocal(term) {
        if (!this.state.allIpRecords) return [];
        
        const typeId = String(this.state.selectedTaskType?.id || '');
        
        // GRUP A: SADECE 3. TARAF (RAKİPLER)
        // Bu gruptaki işler portföyde arama yaparken ASLA sizin kendi dosyalarınızı (Self) getirmez.
        const isThirdPartyOnly = [
            '1',
            '20', 
            '37', 
            TASK_IDS.ITIRAZ_YAYIN
        ].includes(typeId);

        // GRUP B: KARIŞIK (SELF + 3. TARAF)
        // Bu gruptaki işler portföydeki her şeyi getirir.
        const allowThirdPartyMixed = [
            '19', '8', '21',
            TASK_IDS.YAYIMA_ITIRAZIN_YENIDEN_INCELENMESI,
            TASK_IDS.KARARA_ITIRAZ_GERI_CEKME,
            TASK_IDS.YAYINA_ITIRAZI_GERI_CEKME
        ].includes(typeId);
        
        const lowerTerm = term.toLowerCase();
        
        return this.state.allIpRecords.filter(r => {
            const ownerType = String(r.recordOwnerType || 'self').toLowerCase();

            // KURAL 1: "Sadece 3. Taraf" grubundaysa -> 'third_party' olmayanları (Self) ele.
            if (isThirdPartyOnly) {
                if (ownerType !== 'third_party') return false;
            }
            // KURAL 2: "Karışık" grupta DEĞİLSE -> 'third_party' olanları (Rakipleri) ele.
            // (Yani standart işlemler sadece Self getirir)
            else if (!allowThirdPartyMixed) {
                if (ownerType === 'third_party') return false; 
            }
            
            // KURAL 3: Eğer "Karışık" gruptaysa (19, 8, 21) -> Hepsini geçir (Filtre yok).

            // 4. Metin Eşleşmesi (Standart Arama)
            return (
                (r.title || '').toLowerCase().includes(lowerTerm) ||
                (r.markName || '').toLowerCase().includes(lowerTerm) ||
                (r.applicationNumber || '').includes(term) ||
                (r.applicationNo || '').includes(term)
            );
        }).slice(0, 20);
    }

// --- GÜNCELLENEN METOT: Varlık Seçimi, Görsel Yönetimi ve Alan Kilitleme ---
async selectIpRecord(record) {
        console.log('Seçilen Kayıt:', record);
        this.state.selectedIpRecord = record;
        
        // --- DURUM 1: DAVA DOSYASI SEÇİLDİYSE ---
        if (record._source === 'suit') {
            const displayCourt = record.displayCourt || record.suitDetails?.court || record.court || 'Mahkeme Yok';
            const displayFile = record.displayFileNumber || record.suitDetails?.caseNo || record.fileNumber || '-';
            const clientName = record.displayClient || record.client?.name || record.client || '-';

            // 1. MAHKEME ADI (BÜYÜK BAŞLIK)
            const labelEl = document.getElementById('selectedIpRecordLabel');
            if (labelEl) {
                labelEl.textContent = displayCourt;
                labelEl.style.fontSize = '1.3rem'; // Yazı boyutunu büyüttük
                labelEl.className = 'mb-1 font-weight-bold text-primary'; 
            }

            // 2. DOSYA NO VE MÜVEKKİL (DETAYLAR)
            const numberEl = document.getElementById('selectedIpRecordNumber');
            if (numberEl) {
                numberEl.innerHTML = `
                    <div style="font-size: 1.1rem; margin-bottom: 5px;">
                        Dosya No: <span class="text-dark font-weight-bold">${displayFile}</span>
                    </div>
                    <div style="font-size: 1rem; color: #555;">
                        <i class="fas fa-user-tie mr-1"></i> Müvekkil: <b>${clientName}</b>
                    </div>
                    <div class="mt-2">
                        <span class="badge badge-secondary p-2" style="font-size: 0.9rem;">${record.typeId || 'Dava'}</span>
                    </div>
                `;
            }

            // 3. İKON AYARLARI (BÜYÜK İKON)
            const imgEl = document.getElementById('selectedIpRecordImage');
            const phEl = document.getElementById('selectedIpRecordPlaceholder');
            
            if(imgEl) imgEl.style.display = 'none';
            if(phEl) {
                phEl.style.display = 'flex';
                phEl.style.width = '80px';  // Kutuyu büyüttük
                phEl.style.height = '80px'; // Kutuyu büyüttük
                phEl.innerHTML = '<i class="fas fa-gavel" style="font-size: 32px; color: #555;"></i>'; 
            }

            // Container'ı Aç
            document.getElementById('selectedIpRecordContainer').style.display = 'block';

            // ---> YENİ: Formu Doldur ve Kilitle <---
            // Dava bilgilerini (mahkeme, konu, karşı taraf) forma doldurur ve kilitler.
            this.uiManager.fillAndLockLawsuitFields(record);
            
            // State'i güncelle (Müvekkil için validator kontrolü)
            if (record.client) {
                 this.state.selectedRelatedParties = [record.client];
            } else if (record.clientName) {
                 this.state.selectedRelatedParties = [{ id: 'auto', name: record.clientName }];
            }

            this.validator.checkCompleteness(this.state);
            return;
        }

        // --- DURUM 2: MARKA/PATENT SEÇİLDİYSE (Standart Akış) ---
        
        // 1. Metin Alanları
        const title = record.title || record.markName || record.name || 'İsimsiz Kayıt';
        const appNo = record.applicationNumber || record.applicationNo || '-';

        const labelEl = document.getElementById('selectedIpRecordLabel');
        const numEl = document.getElementById('selectedIpRecordNumber');
        
        // Stil Sıfırlama (Dava'dan kalma stilleri temizle)
        if (labelEl) {
            labelEl.textContent = title;
            labelEl.style.fontSize = ''; 
            labelEl.className = ''; 
        }
        if (numEl) numEl.textContent = appNo;

        // 2. Menşe Kilitleme Mantığı
        const originSelect = document.getElementById('originSelect');
        const mainIpTypeSelect = document.getElementById('mainIpType');
        const recordOrigin = record.origin || 'TÜRKPATENT';
        
        if (originSelect) {
            if (originSelect.value !== recordOrigin) {
                originSelect.value = recordOrigin;
                this.handleOriginChange(recordOrigin);
            }
            originSelect.disabled = true;
        }
        if (mainIpTypeSelect) mainIpTypeSelect.disabled = true;

        // 3. Görsel İşlemleri
        const imgEl = document.getElementById('selectedIpRecordImage');
        const phEl = document.getElementById('selectedIpRecordPlaceholder');
        
        // Stil Sıfırlama
        if(phEl) {
             phEl.style.width = '60px'; 
             phEl.style.height = '60px';
        }

        if(imgEl) { imgEl.style.display = 'none'; imgEl.src = ''; }
        if(phEl) { phEl.style.display = 'flex'; phEl.innerHTML = '<i class="fas fa-image" style="font-size: 24px;"></i>'; }

        let finalImageUrl = null;
        const potentialPath = record.imagePath || record.brandImageUrl || record.image || record.logo || record.imageUrl;

        try {
            if (potentialPath) {
                if (potentialPath.startsWith('http') || potentialPath.startsWith('data:')) {
                    finalImageUrl = potentialPath;
                } else {
                    finalImageUrl = await this.dataManager.resolveImageUrl(potentialPath);
                }
            }
        } catch (err) { console.warn('Görsel hatası:', err); }

        if (finalImageUrl) {
            if(imgEl) { imgEl.src = finalImageUrl; imgEl.style.display = 'block'; }
            if(phEl) phEl.style.display = 'none';
        }
        
        document.getElementById('selectedIpRecordContainer').style.display = 'block';

        // 4. Geri Çekme Kontrolleri (Dava ve Marka/Patent Uyumlu)
        if (this.state.isWithdrawalTask) {
            console.log(`[Main] ${record.id} için geri çekilecek işlemler sorgulanıyor...`);

            // A) Kaynağı belirle: Eğer dava ise 'suits', değilse 'ipRecords'
            const sourceCollection = record._source === 'suit' ? 'suits' : 'ipRecords';
            
            let txResult = await this.dataManager.getRecordTransactions(record.id, sourceCollection);
            let combinedTransactions = txResult.success ? txResult.data : [];

            // B) Aile Taraması (Sadece Marka/Patent için ve WIPO/ARIPO varsa)
            if (sourceCollection === 'ipRecords' && combinedTransactions.length === 0 && (record.wipoIR || record.aripoIR)) {
                console.log('⚠️ Seçilen kayıtta işlem yok. Aile kayıtları taranıyor...');
                const irNumber = record.wipoIR || record.aripoIR;
                
                const relatives = this.state.allIpRecords.filter(r => 
                    (r.wipoIR === irNumber || r.aripoIR === irNumber) && r.id !== record.id
                );

                for (const rel of relatives) {
                    const relResult = await this.dataManager.getRecordTransactions(rel.id, 'ipRecords');
                    if (relResult.success && relResult.data.length > 0) {
                        combinedTransactions = [...combinedTransactions, ...relResult.data];
                    }
                }
            }

            // C) Sonuçları İşle
            if (combinedTransactions.length > 0) {
                record.transactions = combinedTransactions;
                this.processParentTransactions(record);
            } else {
                console.warn('❌ Geri çekilebilecek işlem bulunamadı.');
                alert('Bu varlık üzerinde geri çekilebilecek uygun bir işlem (İtiraz vb.) bulunamadı.');
            }
        }

        // 5. WIPO Alt Kayıtları
        if (record.wipoIR || record.aripoIR) {
            const ir = record.wipoIR || record.aripoIR;
            this.state.selectedWipoAripoChildren = this.state.allIpRecords.filter(c => 
                c.transactionHierarchy === 'child' && (c.wipoIR === ir || c.aripoIR === ir)
            );
            this.uiManager.renderWipoAripoChildRecords(this.state.selectedWipoAripoChildren);
        }

        this.validator.checkCompleteness(this.state);
    }

// --- GÜNCELLENEN METOT 1: Geri Çekme İşlemleri ve Modal Mantığı ---
    processParentTransactions(record) {
        console.log('Geri çekme işlemi için uygun itirazlar aranıyor...');
        
        const currentTaskTypeId = String(this.state.selectedTaskType?.id);
        let parentTypes = [];

        // 1. Yayına İtirazı Geri Çekme (Tip 21) -> Aranan: Yayına İtiraz (Tip 20)
        if (currentTaskTypeId === '21') {
            parentTypes = ['20', 'trademark_publication_objection'];
        } 
        // 2. Karara İtirazı Geri Çekme (Tip 8) -> Aranan: Karara İtiraz (Tip 7) VEYA Y.İ.Y.İ (Tip 19)
        else if (currentTaskTypeId === '8') {
            parentTypes = ['7', '19', 'trademark_decision_objection', 'trademark_reconsideration_of_publication_objection'];
        }

        // Transactions içinde tipi eşleşenleri bul
        // Not: transactionHierarchy kontrolünü kaldırdık, çünkü eski kayıtlarda bu alan olmayabilir.
        // Sadece işlem tipi (type) üzerinden eşleştirme yapıyoruz.
        const parents = (record.transactions || []).filter(t => 
            parentTypes.includes(String(t.type))
        );
        
        console.log(`Bulunan İşlem Sayısı: ${parents.length}`, parents);

        if (parents.length > 1) {
            // Birden fazla uygun işlem varsa kullanıcıya seçtir (Modal Aç)
            const enrichedParents = parents.map(p => ({
                ...p,
                transactionTypeName: this.getTransactionTypeName(p.type)
            }));
            this.uiManager.showParentSelectionModal(enrichedParents, 'Geri Çekilecek İşlemi Seçin');
        } else if (parents.length === 1) {
            // Tek bir işlem varsa otomatik seç
            this.submitHandler.selectedParentTransactionId = parents[0].id;
            console.log('Tek işlem bulundu, otomatik seçildi:', parents[0].id);
        } else {
            // Hiç işlem bulunamadıysa uyar
            alert('Bu varlık üzerinde geri çekilebilecek uygun bir işlem (İtiraz vb.) bulunamadı.');
            this.state.selectedIpRecord = null; // Seçimi iptal et
            document.getElementById('selectedIpRecordContainer').style.display = 'none';
        }
    }

    getTransactionTypeName(typeId) {
        const t = this.state.allTransactionTypes.find(x => String(x.id) === String(typeId));
        return t ? (t.alias || t.name) : 'Bilinmeyen İşlem';
    }

    // --- KİŞİ SEÇİMİ ---
    setupPersonSearchListeners() {
        // Hangi input'un hangi role karşılık geldiği
        const inputs = {
            'personSearchInput': 'relatedParty',
            'tpInvoicePartySearch': 'tpInvoiceParty',
            'serviceInvoicePartySearch': 'serviceInvoiceParty',
            'ownerSearchInput': 'owner' // YENİ: Sahip (Owner) rolü eklendi
        };

        for (const [iid, role] of Object.entries(inputs)) {
            const inp = document.getElementById(iid);
            if (!inp) continue;

            // Sonuç kutusunun ID'sini role göre belirle
            let resId = 'personSearchResults'; // Varsayılan
            if (role === 'tpInvoiceParty') resId = 'tpInvoicePartyResults';
            if (role === 'serviceInvoiceParty') resId = 'serviceInvoicePartyResults';
            if (role === 'owner') resId = 'ownerSearchResults'; // YENİ: Sahip sonuç kutusu

            const resDiv = document.getElementById(resId);
            if (!resDiv) continue; // Eğer HTML'de yoksa (örneğin Marka Başvuru sayfasındaysak) hata vermesin

            // Input Dinleyici
            inp.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();

                if (term.length < 2) {
                    resDiv.style.display = 'none';
                    return;
                }

                // Kişiler arasında arama yap
                const found = this.state.allPersons.filter(p =>
                    p.name.toLowerCase().includes(term)
                ).slice(0, 10);

                // Sonuçları HTML olarak oluştur
                resDiv.innerHTML = found.map(p => `
                    <div class="search-result-item p-2 border-bottom" data-id="${p.id}" style="cursor:pointer;">
                        ${p.name}
                    </div>`).join('');

                resDiv.style.display = 'block';

                // Tıklama olaylarını ekle (Delegasyon yerine her öğeye ekliyoruz, daha güvenli)
                resDiv.querySelectorAll('.search-result-item').forEach(el => {
                    el.addEventListener('click', () => {
                        const selectedPerson = this.state.allPersons.find(p => String(p.id) === String(el.dataset.id));

                        if (selectedPerson) {
                            this.handlePersonSelection(selectedPerson, role);
                            inp.value = '';
                            resDiv.style.display = 'none';
                        }
                    });
                });
            });

            // Dışarı tıklayınca kapatma
            document.addEventListener('click', (e) => {
                if (resDiv.style.display === 'block' && e.target !== inp && !resDiv.contains(e.target)) {
                    resDiv.style.display = 'none';
                }
            });
        }
    }

    handlePersonSelection(person, role) {
        if (role === 'relatedParty') {
            if (!this.state.selectedRelatedParties.some(p => p.id === person.id)) {
                this.state.selectedRelatedParties.push(person);
                this.state.selectedRelatedParty = person; // İlk seçilen (Eski kodlarla uyumluluk için)
                this.uiManager.renderSelectedRelatedParties(this.state.selectedRelatedParties);
            }
        } 
        else if (role === 'owner') { // YENİ: Sahip Ekleme Mantığı
            // State array yoksa oluştur
            if (!this.state.selectedOwners) this.state.selectedOwners = [];
            
            // Duplicate kontrolü
            if (!this.state.selectedOwners.some(p => p.id === person.id)) {
                this.state.selectedOwners.push(person);
                this.uiManager.renderSelectedOwners(this.state.selectedOwners);
            }
        }
        else if (role === 'tpInvoiceParty') {
            this.state.selectedTpInvoiceParty = person;
            const disp = document.getElementById('selectedTpInvoicePartyDisplay');
            if(disp) {
                disp.textContent = person.name;
                disp.style.display = 'block';
            }
        } 
        else if (role === 'serviceInvoiceParty') {
            this.state.selectedServiceInvoiceParty = person;
            const disp = document.getElementById('selectedServiceInvoicePartyDisplay');
            if(disp) {
                disp.textContent = person.name;
                disp.style.display = 'block';
            }
        }
        
        // Form bütünlüğünü kontrol et
        this.validator.checkCompleteness(this.state);
    }
    
    setupApplicantListeners() {
        const inp = document.getElementById('applicantSearchInput');
        if(inp) inp.addEventListener('input', (e) => {
             const term = e.target.value.toLowerCase();
             const resDiv = document.getElementById('applicantSearchResults');
             if(term.length<2) { resDiv.style.display='none'; return; }
             const found = this.state.allPersons.filter(p => p.name.toLowerCase().includes(term)).slice(0,10);
             resDiv.innerHTML = found.map(p => `<div class="search-result-item p-2" data-id="${p.id}">${p.name}</div>`).join('');
             resDiv.style.display='block';
             resDiv.querySelectorAll('.search-result-item').forEach(el => {
                 el.addEventListener('click', () => {
                     const p = this.state.allPersons.find(x=>x.id===el.dataset.id);
                     if(!this.state.selectedApplicants.some(a=>a.id===p.id)) this.state.selectedApplicants.push(p);
                     this.uiManager.renderSelectedApplicants(this.state.selectedApplicants);
                     resDiv.style.display='none';
                     this.validator.checkCompleteness(this.state);
                 });
             });
        });
        
        // Delegation for dynamic buttons
        document.addEventListener('click', (e) => {
            if(e.target.closest('.remove-selected-item-btn')) {
                const id = e.target.closest('.remove-selected-item-btn').dataset.id;
                this.state.selectedApplicants = this.state.selectedApplicants.filter(a=>a.id!==id);
                this.uiManager.renderSelectedApplicants(this.state.selectedApplicants);
            }
            if(e.target.closest('.remove-party')) {
                 const id = e.target.closest('.remove-party').dataset.id;
                 this.state.selectedRelatedParties = this.state.selectedRelatedParties.filter(p=>p.id!==id);
                 this.uiManager.renderSelectedRelatedParties(this.state.selectedRelatedParties);
                 this.validator.checkCompleteness(this.state);
            }
            if(e.target.closest('.remove-priority-btn')) {
                const id = e.target.closest('.remove-priority-btn').dataset.id;
                this.state.priorities = this.state.priorities.filter(p=>p.id!==id);
                this.uiManager.renderPriorities(this.state.priorities);
            }
        });

        // Rüçhan Ekleme
        const addPrioBtn = document.getElementById('addPriorityBtn');
        if(addPrioBtn) addPrioBtn.addEventListener('click', () => {
             const p = {
                 id: Date.now().toString(),
                 type: document.getElementById('priorityType').value,
                 date: document.getElementById('priorityDate').value,
                 country: document.getElementById('priorityCountry').value,
                 number: document.getElementById('priorityNumber').value
             };
             if(p.date && p.country && p.number) {
                 this.state.priorities.push(p);
                 this.uiManager.renderPriorities(this.state.priorities);
                 // Inputları temizle
                 document.getElementById('priorityDate').value = '';
                 document.getElementById('priorityCountry').value = '';
                 document.getElementById('priorityNumber').value = '';
             }
        });
    }

    applyAssignmentRule(rule) {
        const select = document.getElementById('assignedTo');
        if (!select) return;
        
        select.innerHTML = '<option value="">Seçiniz...</option>';
        let usersToShow = this.state.allUsers;

        if (rule && rule.assigneeIds && rule.assigneeIds.length > 0) {
            usersToShow = this.state.allUsers.filter(u => rule.assigneeIds.includes(u.id));
            if (rule.allowManualOverride === false) select.disabled = true;
        }

        usersToShow.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.displayName || u.email;
            select.appendChild(opt);
        });
        
        if (usersToShow.length === 1) {
            select.value = usersToShow[0].id;
            select.disabled = true;
        }
    }

    calculateTotalAmount() {
        const off = parseFloat(document.getElementById('officialFee')?.value || 0);
        const srv = parseFloat(document.getElementById('serviceFee')?.value || 0);
        const vat = parseFloat(document.getElementById('vatRate')?.value || 20);
        const apply = document.getElementById('applyVatToOfficialFee')?.checked;
        
        let total = apply ? (off + srv) * (1 + vat/100) : off + (srv * (1 + vat/100));
        document.getElementById('totalAmountDisplay').textContent = total.toFixed(2) + ' TRY';
    }

    renderSummary() {
        this.uiManager.renderSummaryTab(this.state);
    }

    resetSelections() {
        this.state.selectedIpRecord = null;
        this.state.selectedRelatedParties = [];
        this.state.selectedApplicants = [];
        this.state.selectedOwners = [];
        this.state.uploadedFiles = [];
        this.state.priorities = [];
        this.state.selectedWipoAripoChildren = [];
        this.state.selectedCountries = [];
    }
}

new CreateTaskController().init();