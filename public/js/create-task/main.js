import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { loadSharedLayout, openPersonModal } from '../layout-loader.js';
import { initializeNiceClassification, getSelectedNiceClasses } from '../nice-classification.js';
import { TASK_IDS } from './TaskConstants.js';
import { auth } from '../../firebase-config.js';

// Modüller
import { TaskDataManager } from './TaskDataManager.js';
import { TaskUIManager } from './TaskUIManager.js';
import { TaskValidator } from './TaskValidator.js';
import { TaskSubmitHandler } from './TaskSubmitHandler.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';

function initTaskDatePickers(root = document) {
    try {
        const IDS = ['taskDueDate', 'priorityDate', 'lawsuitDate', 'lawsuitDecisionDate'];
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
            isWithdrawalTask: false, searchSource: 'portfolio', isNiceClassificationInitialized: false, selectedWipoAripoChildren: []
        };
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

        // 2. GLOBAL TIKLAMA YÖNETİCİSİ (Dinamik Butonlar İçin)
        document.addEventListener('click', (e) => {
            
            // --- A) FORM AKSİYONLARI (KAYDET / İPTAL / İLERLE) ---
            
            // 💾 KAYDET BUTONU (Bu kısım eklendiği için artık çalışacak)
            if (e.target.id === 'saveTaskBtn' || e.target.closest('#saveTaskBtn')) {
                const btn = e.target.closest('#saveTaskBtn') || e.target;
                if (btn.disabled) return;
                
                // 1. Tahakkuk Verisini Al
                let accrualData = null;
                const isFree = document.getElementById('isFreeTransaction')?.checked;
                
                // Eğer ücretsiz değilse ve manager varsa veriyi çek
                if (!isFree && this.accrualFormManager) {
                    const result = this.accrualFormManager.getData();
                    
                    // Eğer form görünürse (Wrapper açıksa) validasyon yap
                    const isFormVisible = document.getElementById('accrualToggleWrapper')?.style.display !== 'none';
                    
                    if (isFormVisible && !result.success) {
                        // Form açık ama veri eksik/hatalıysa durdur
                        alert(result.error);
                        return;
                    }
                    
                    // Veri geçerliyse al (Form kapalı olsa bile dolu veriyi alabiliriz veya null geçebiliriz, ihtiyaca göre)
                    if (result.success) {
                        accrualData = result.data;
                    }
                }

                // 2. Bu veriyi State'e ekle (SubmitHandler bunu kullanacak)
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

            // ⏩ İLERLE BUTONU (Tab Geçişi)
            if (e.target.id === 'nextTabBtn') {
                this.handleNextTab();
            }

            // --- B) SİLME VE TEMİZLEME İŞLEMLERİ ---

            // Varlık (Asset) Kaldır
            if (e.target.closest('#clearSelectedIpRecord')) {
                this.state.selectedIpRecord = null;
                document.getElementById('selectedIpRecordContainer').style.display = 'none';
                document.getElementById('ipRecordSearch').value = '';
                
                // Görseli temizle
                const imgEl = document.getElementById('selectedIpRecordImage');
                if(imgEl) imgEl.src = '';

                // WIPO/ARIPO alt kayıtları temizle
                this.state.selectedWipoAripoChildren = [];
                this.uiManager.renderWipoAripoChildRecords([]);

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

            // Başvuru Sahibi Sil
            const removeApplicantBtn = e.target.closest('.remove-selected-item-btn');
            if (removeApplicantBtn) {
                const id = removeApplicantBtn.dataset.id;
                this.state.selectedApplicants = this.state.selectedApplicants.filter(p => String(p.id) !== String(id));
                this.uiManager.renderSelectedApplicants(this.state.selectedApplicants);
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

            // --- C) MODAL VE EKLEME İŞLEMLERİ ---

            // Yeni Kişi / Başvuru Sahibi Ekleme
            if (e.target.closest('#addNewPersonBtn') || e.target.closest('#addNewApplicantBtn')) {
                const isApplicant = e.target.closest('#addNewApplicantBtn'); 

                openPersonModal((newPerson) => { 
                    this.state.allPersons.push(newPerson); 
                    
                    if (isApplicant) {
                        if(!this.state.selectedApplicants.some(a=>a.id===newPerson.id)) {
                            this.state.selectedApplicants.push(newPerson);
                            this.uiManager.renderSelectedApplicants(this.state.selectedApplicants);
                        }
                    } else {
                        this.handlePersonSelection(newPerson, 'relatedParty'); 
                    }
                    this.validator.checkCompleteness(this.state);
                });

                // Modal açılınca şehir listesini tetikle (Türkiye seçiliyse)
                setTimeout(() => {
                    const countrySelect = document.getElementById('country') || document.getElementById('personCountry');
                    if (countrySelect && (countrySelect.value === 'Turkey' || countrySelect.value === 'TR' || countrySelect.value === 'Türkiye')) {
                        console.log('🌍 Şehir listesi tetikleniyor...');
                        countrySelect.dispatchEvent(new Event('change'));
                    }
                }, 300);
            }
            
            // Parent Transaction Seçim Listener (Modal İçin)
            if (e.target.closest('.list-group-item') && document.getElementById('parentListContainer')?.contains(e.target)) {
                 // Bu kısım TaskUIManager içindeki 'parentTransactionSelected' event'i ile de çalışıyor ama yedek olarak dursun
            }

            // --- D) TAHAKKUK UI YÖNETİMİ ---           
            // "Tahakkuk Formu Aç/Kapat" Butonu
            if (e.target.id === 'toggleAccrualFormBtn' || e.target.closest('#toggleAccrualFormBtn')) {
                const wrapper = document.getElementById('accrualToggleWrapper'); // Yeni Wrapper ID
                const btn = document.getElementById('toggleAccrualFormBtn');
                
                if (wrapper && wrapper.style.display === 'none') {
                    // AÇ
                    $(wrapper).slideDown(300);
                    btn.innerHTML = '<i class="fas fa-chevron-up mr-1"></i> Tahakkuk Formunu Gizle';
                    btn.classList.replace('btn-outline-primary', 'btn-outline-secondary');
                } else if (wrapper) {
                    // KAPAT
                    $(wrapper).slideUp(300);
                    btn.innerHTML = '<i class="fas fa-chevron-down mr-1"></i> Tahakkuk Formu Aç';
                    btn.classList.replace('btn-outline-secondary', 'btn-outline-primary');
                }
            }

            // --- ÜCRETSİZ İŞLEM CHECKBOX ---
            if (e.target.id === 'isFreeTransaction') {
                const isChecked = e.target.checked;
                const btn = document.getElementById('toggleAccrualFormBtn');
                const wrapper = document.getElementById('accrualToggleWrapper');
                
                if (isChecked) {
                    // Ücretsiz seçilirse formu kapat, butonu pasifleştir ve veriyi temizle
                    if(wrapper) wrapper.style.display = 'none';
                    if(btn) {
                        btn.disabled = true;
                        btn.innerHTML = '<i class="fas fa-chevron-down mr-1"></i> Tahakkuk Formu Aç';
                    }
                    // Manager'ı sıfırla
                    if (this.accrualFormManager) this.accrualFormManager.reset();
                } else {
                    // Seçim kalkarsa butonu aktifleştir
                    if(btn) btn.disabled = false;
                }
            }
        });
        
        // 3. PARENT TRANSACTION MODAL SEÇİMİ (Custom Event Listener)
        document.addEventListener('parentTransactionSelected', (e) => {
            const selectedId = e.detail.id;
            console.log('🎯 Modalden seçim geldi:', selectedId);
            
            this.submitHandler.selectedParentTransactionId = selectedId;
            this.uiManager.hideParentSelectionModal();
            alert('Geri çekilecek işlem seçildi.');
        });
        
        // Modal Kapatma Butonları
        const closeModalBtns = document.querySelectorAll('#selectParentModal .close, #selectParentModal .btn-secondary');
        closeModalBtns.forEach(btn => btn.addEventListener('click', () => this.uiManager.hideParentSelectionModal()));

        // 4. TAB DEĞİŞİMİ VE DİĞERLERİ
        $(document).on('shown.bs.tab', '#myTaskTabs a', async (e) => {
            this.uiManager.updateButtonsAndTabs();
            const targetTabId = e.target.getAttribute('href').substring(1);
            
            if (targetTabId === 'goods-services' && !this.state.isNiceClassificationInitialized) {
                await initializeNiceClassification();
                this.state.isNiceClassificationInitialized = true;
            }
            if (targetTabId === 'applicants') this.uiManager.renderSelectedApplicants(this.state.selectedApplicants);
            if (targetTabId === 'priority') this.uiManager.renderPriorities(this.state.priorities);
            if (targetTabId === 'summary') this.uiManager.renderSummaryTab(this.state);
        });
        
        // Form Elemanlarını Dinle (Validation için)
        document.addEventListener('input', (e) => {
            if (['officialFee', 'serviceFee', 'vatRate'].includes(e.target.id)) this.calculateTotalAmount();
            this.validator.checkCompleteness(this.state);
        });
        
        document.addEventListener('change', (e) => {
            if (e.target.id === 'applyVatToOfficialFee') this.calculateTotalAmount();
            if (['brandType', 'brandCategory', 'assignedTo', 'taskDueDate'].includes(e.target.id)) this.validator.checkCompleteness(this.state);
        });

        this.setupBrandExample();
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

    async handleSpecificTypeChange(e) {
        const typeId = e.target.value;
        const selectedType = this.state.allTransactionTypes.find(t => t.id === typeId);
        this.state.selectedTaskType = selectedType;
        
        if (!selectedType) { this.uiManager.clearContainer(); return; }

        const tIdStr = String(typeId);
        this.state.isWithdrawalTask = (tIdStr === '21' || tIdStr === '8');
        
        const isMarkaBasvuru = selectedType.alias === 'Başvuru' && selectedType.ipType === 'trademark';
        
        // 1. UI'ı Çizdir (Bu işlem DOM'a HTML stringini basar)
        if (isMarkaBasvuru) this.uiManager.renderTrademarkApplicationForm();
        else this.uiManager.renderBaseForm(selectedType.alias || selectedType.name, selectedType.id, selectedType.ipType === 'suit');
        
        // 3. İlgili Varlık Kaynağını Belirle (Yeni Kod)
        const assetSource = selectedType.relatedAssetSource || 'ipRecords';
        this.state.searchSource = assetSource; // State'e kaydet (suits veya ipRecords)
        this.state.targetSuitTypes = selectedType.targetSuitTypes || []; // Filtreleri kaydet
        
        // UI Başlığını Güncelle
        this.uiManager.updateAssetSearchLabel(assetSource);

        // 2. DOM oluştuktan hemen sonra AccrualFormManager'ı başlat ve render et
        // Container ID: 'createTaskAccrualContainer' (TaskUIManager'da verdiğimiz ID)
        if (document.getElementById('createTaskAccrualContainer')) {
            this.accrualFormManager = new AccrualFormManager(
                'createTaskAccrualContainer', 
                'createTaskAcc', // Prefix: ID çakışmasını önler
                this.state.allPersons // Kişi listesini ver
            );
            this.accrualFormManager.render();
        }

        // ... (Diğer tarih seçici, olay dinleyicisi kodları aynen devam eder) ...
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
        const container = document.getElementById('countrySelectionContainer');
        const singleWrapper = document.getElementById('singleCountrySelectWrapper');
        const multiWrapper = document.getElementById('multiCountrySelectWrapper');
        const title = document.getElementById('countrySelectionTitle');
        
        if (!container || !singleWrapper || !multiWrapper) return;

        // 1. Önce Hepsini Gizle (Varsayılan Durum)
        container.style.display = 'none';
        singleWrapper.style.display = 'none';
        multiWrapper.style.display = 'none';

        // 2. KONTROL: İşlem Tipi Nedir?
        const t = this.state.selectedTaskType;
        
        // "Ülke Seçimi" alanı SADECE şu durumlarda açılmalı:
        // A) Marka Başvurusu (Yeni Kayıt)
        // B) Dava İşlemi (Suit)
        const isApplication = (t && (t.alias === 'Başvuru' || t.name === 'Başvuru'));
        const isSuit = (t && t.ipType === 'suit') || (document.getElementById('mainIpType')?.value === 'suit');

        // Eğer bu bir Yenileme, Devir, İtiraz vb. ise (yani Başvuru veya Dava değilse),
        // menşe WIPO/ARIPO olsa bile ülke seçim kutusunu AÇMA.
        if (!isApplication && !isSuit) {
            return; 
        }

        // 3. Menşeye Göre Alanı Aç (Sadece yukarıdaki koşul sağlandıysa buraya gelir)
        
        // Yurtdışı Ulusal (Tekli Seçim)
        if (['Yurtdışı Ulusal', 'FOREIGN_NATIONAL'].includes(val)) {
            container.style.display = 'block';
            singleWrapper.style.display = 'block';
            if(title) title.textContent = 'Menşe Ülke Seçimi';
            this.uiManager.populateDropdown('countrySelect', this.state.allCountries, 'code', 'name');
        } 
        // WIPO / ARIPO (Çoklu Seçim)
        else if (['WIPO', 'ARIPO'].includes(val)) {
            container.style.display = 'block';
            multiWrapper.style.display = 'block';
            if(title) title.textContent = `Seçim Yapılacak Ülkeler (${val})`;
            this.setupMultiCountrySelect(); 
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
        // 2. Yoksa Eski Mantık Devam Etsin
        else {
            const isType20 = ['20', 'trademark_publication_objection', TASK_IDS.ITIRAZ_YAYIN].includes(typeId);
            const isHybrid = [
                '19', 'trademark_reconsideration_of_publication_objection', TASK_IDS.YAYIMA_ITIRAZIN_YENIDEN_INCELENMESI,
                '8', TASK_IDS.KARARA_ITIRAZ_GERI_CEKME,
                '21', TASK_IDS.YAYINA_ITIRAZI_GERI_CEKME
            ].includes(typeId);

            if (isType20) this.state.searchSource = 'bulletin';
            else if (isHybrid) this.state.searchSource = 'hybrid'; 
            else this.state.searchSource = 'portfolio';
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
        
        // 3. Taraf kayıtlarının görünmesine izin verilen işlem tipleri
        // 19: Yeniden İnceleme, 20: Yayına İtiraz, 8: Karara İtirazı G.Ç., 21: Yayına İtirazı G.Ç.
        const allowThirdParty = [
            '19', '20', '8', '21',
            TASK_IDS.ITIRAZ_YAYIN, 
            TASK_IDS.YAYIMA_ITIRAZIN_YENIDEN_INCELENMESI,
            TASK_IDS.KARARA_ITIRAZ_GERI_CEKME,
            TASK_IDS.YAYINA_ITIRAZI_GERI_CEKME
        ].includes(typeId);
        
        const lowerTerm = term.toLowerCase();
        
        return this.state.allIpRecords.filter(r => {
            // 1. Sahiplik Kontrolü
            if (!allowThirdParty) {
                // Sadece 'self' olanları getir
                const ownerType = String(r.recordOwnerType || 'self').toLowerCase();
                if (ownerType === 'third_party') return false; 
            }

            // 2. Metin Eşleşmesi
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
        
        // --- DURUM 1: DAVA DOSYASI SEÇİLDİYSE (GÜNCELLENDİ) ---
        if (record._source === 'suit') {
            const displayCourt = record.displayCourt || record.suitDetails?.court || record.court || 'Mahkeme Yok';
            const displayFile = record.displayFileNumber || record.suitDetails?.caseNo || record.fileNumber || '-';
            const clientName = record.displayClient || record.client?.name || record.client || '-';

            // 1. MAHKEME ADI (BÜYÜK BAŞLIK)
            const labelEl = document.getElementById('selectedIpRecordLabel');
            labelEl.textContent = displayCourt;
            labelEl.style.fontSize = '1.3rem'; // Yazı boyutunu büyüttük
            labelEl.className = 'mb-1 font-weight-bold text-primary'; // Renk ve kalınlık

            // 2. DOSYA NO VE MÜVEKKİL (DETAYLAR)
            const numberEl = document.getElementById('selectedIpRecordNumber');
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

            // 3. İKON AYARLARI (BÜYÜK İKON)
            const imgEl = document.getElementById('selectedIpRecordImage');
            const phEl = document.getElementById('selectedIpRecordPlaceholder');
            
            if(imgEl) imgEl.style.display = 'none';
            if(phEl) {
                phEl.style.display = 'flex';
                phEl.style.width = '80px';  // Kutuyu büyüttük
                phEl.style.height = '80px'; // Kutuyu büyüttük
                phEl.innerHTML = '<i class="fas fa-gavel" style="font-size: 32px; color: #555;"></i>'; // İkonu büyüttük
            }

            // Container'ı Aç
            document.getElementById('selectedIpRecordContainer').style.display = 'block';

            this.validator.checkCompleteness(this.state);
            return;
        }

        // --- DURUM 2: MARKA/PATENT SEÇİLDİYSE (Standart Akış) ---
        
        // 1. Metin Alanları
        const title = record.title || record.markName || record.name || 'İsimsiz Kayıt';
        const appNo = record.applicationNumber || record.applicationNo || '-';

        document.getElementById('selectedIpRecordLabel').textContent = title;
        document.getElementById('selectedIpRecordNumber').textContent = appNo;

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

        // 4. Geri Çekme Kontrolleri (Sadece Marka İşlemlerinde)
        if (this.state.isWithdrawalTask) {
            let txResult = await this.dataManager.getRecordTransactions(record.id);
            let combinedTransactions = txResult.success ? txResult.data : [];

            if (combinedTransactions.length === 0 && (record.wipoIR || record.aripoIR)) {
                const irNumber = record.wipoIR || record.aripoIR;
                const relatives = this.state.allIpRecords.filter(r => 
                    (r.wipoIR === irNumber || r.aripoIR === irNumber) && r.id !== record.id
                );
                for (const rel of relatives) {
                    const relResult = await this.dataManager.getRecordTransactions(rel.id);
                    if (relResult.success) combinedTransactions.push(...relResult.data);
                }
            }

            if (combinedTransactions.length > 0) {
                record.transactions = combinedTransactions;
                this.processParentTransactions(record);
            } else {
                alert('Geri çekilebilecek işlem bulunamadı.');
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
        const inputs = {'personSearchInput':'relatedParty', 'tpInvoicePartySearch':'tpInvoiceParty', 'serviceInvoicePartySearch':'serviceInvoiceParty'};
        
        for (const [iid, role] of Object.entries(inputs)) {
            const inp = document.getElementById(iid);
            if (!inp) continue;

            // DÜZELTME: resDiv tanımı buraya, olayların dışına taşındı.
            // Böylece hem 'input' hem de 'click' olayları bu değişkene erişebilir.
            const resId = role === 'relatedParty' ? 'personSearchResults' : (role === 'tpInvoiceParty' ? 'tpInvoicePartyResults' : 'serviceInvoicePartyResults');
            const resDiv = document.getElementById(resId);

            // Eğer sonuç kutusu HTML'de yoksa devam etme
            if (!resDiv) continue;

            inp.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                
                if (term.length < 2) { resDiv.style.display = 'none'; return; }
                
                const found = this.state.allPersons.filter(p => p.name.toLowerCase().includes(term)).slice(0, 10);
                
                resDiv.innerHTML = found.map(p => `
                    <div class="search-result-item p-2 border-bottom" data-id="${p.id}" style="cursor:pointer;">
                        ${p.name}
                    </div>`).join('');
                
                resDiv.style.display = 'block';

                // Tıklama Olayları
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
                // Artık resDiv burada tanımlı
                if (resDiv.style.display === 'block' && e.target !== inp && !resDiv.contains(e.target)) {
                    resDiv.style.display = 'none';
                }
            });
        }
        
        document.getElementById('addNewPersonBtn')?.addEventListener('click', () => {
            openPersonModal((p) => { 
                this.state.allPersons.push(p); 
                this.handlePersonSelection(p, 'relatedParty'); 
            });
        });
    }

    handlePersonSelection(person, role) {
        if (role === 'relatedParty') {
            if (!this.state.selectedRelatedParties.some(p => p.id === person.id)) {
                this.state.selectedRelatedParties.push(person);
                this.state.selectedRelatedParty = person; // İlk seçilen
                this.uiManager.renderSelectedRelatedParties(this.state.selectedRelatedParties);
            }
        } else if (role === 'tpInvoiceParty') {
            this.state.selectedTpInvoiceParty = person;
            document.getElementById('selectedTpInvoicePartyDisplay').textContent = person.name;
            document.getElementById('selectedTpInvoicePartyDisplay').style.display = 'block';
        } else {
            this.state.selectedServiceInvoiceParty = person;
            document.getElementById('selectedServiceInvoicePartyDisplay').textContent = person.name;
            document.getElementById('selectedServiceInvoicePartyDisplay').style.display = 'block';
        }
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
        this.state.uploadedFiles = [];
        this.state.priorities = [];
        this.state.selectedWipoAripoChildren = [];
        this.state.selectedCountries = [];
    }
}

new CreateTaskController().init();