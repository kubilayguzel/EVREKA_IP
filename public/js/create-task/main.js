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

    setupEventListeners() {
        document.getElementById('mainIpType')?.addEventListener('change', (e) => this.handleMainTypeChange(e));
        document.getElementById('specificTaskType')?.addEventListener('change', (e) => this.handleSpecificTypeChange(e));
        document.getElementById('originSelect')?.addEventListener('change', (e) => this.handleOriginChange(e.target.value));
        document.getElementById('saveTaskBtn')?.addEventListener('click', (e) => this.submitHandler.handleFormSubmit(e, this.state));
        document.addEventListener('click', (e) => {
            if (e.target.id === 'cancelBtn' && confirm('İptal etmek istediğinize emin misiniz?')) window.location.href = 'task-management.html';
        });
        $(document).on('shown.bs.tab', '#myTaskTabs a', async (e) => {
            const targetTabId = e.target.getAttribute('href').substring(1);
            if (targetTabId === 'goods-services' && !this.state.isNiceClassificationInitialized) {
                await initializeNiceClassification();
                this.state.isNiceClassificationInitialized = true;
            }
            this.uiManager.updateButtonsAndTabs(targetTabId === 'summary');
            if (targetTabId === 'summary') this.uiManager.renderSummaryTab(this.state);
        });
        document.addEventListener('input', (e) => {
            if (['officialFee', 'serviceFee', 'vatRate'].includes(e.target.id)) this.calculateTotalAmount();
            this.validator.checkCompleteness(this.state);
        });
        document.addEventListener('change', (e) => {
            if (e.target.id === 'applyVatToOfficialFee') this.calculateTotalAmount();
            if (['brandType', 'brandCategory', 'assignedTo', 'taskDueDate'].includes(e.target.id)) this.validator.checkCompleteness(this.state);
        });
        
        // Parent Seçim Modalı Kapatma
        const closeModalBtns = document.querySelectorAll('#selectParentModal .close, #selectParentModal .btn-secondary');
        closeModalBtns.forEach(btn => btn.addEventListener('click', () => this.uiManager.hideParentSelectionModal()));

        // Parent Seçim Listesi Tıklama (Delegation)
        const parentListContainer = document.getElementById('parentListContainer');
        if (parentListContainer) {
            parentListContainer.addEventListener('click', (e) => {
                const item = e.target.closest('.list-group-item');
                if (item) {
                    this.submitHandler.selectedParentTransactionId = item.dataset.id;
                    this.uiManager.hideParentSelectionModal();
                    // Seçim yapıldığını belirtmek için UI güncellemesi yapılabilir
                    alert('İşlem seçildi.');
                }
            });
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
                return (t.hierarchy === 'parent' && t.ipType === mainType) || (t.hierarchy === 'child' && t.isTopLevelSelectable && (t.applicableToMainType?.includes(mainType) || t.applicableToMainType?.includes('all')));
            }).sort((a, b) => (a.order || 999) - (b.order || 999));
            filtered.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id; opt.textContent = t.alias || t.name; specificSelect.appendChild(opt);
            });
            specificSelect.disabled = false;
        } else { specificSelect.disabled = true; }
        this.uiManager.populateDropdown('originSelect', (mainType === 'suit' ? [{value:'TURKEY', text:'Türkiye'}, {value:'FOREIGN_NATIONAL', text:'Yurtdışı'}] : [{value:'TÜRKPATENT', text:'TÜRKPATENT'}, {value:'WIPO', text:'WIPO'}, {value:'EUIPO', text:'EUIPO'}, {value:'ARIPO', text:'ARIPO'}, {value:'Yurtdışı Ulusal', text:'Yurtdışı Ulusal'}]), 'value', 'text', 'Seçiniz...');
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
        if (isMarkaBasvuru) this.uiManager.renderTrademarkApplicationForm();
        else this.uiManager.renderBaseForm(selectedType.alias || selectedType.name, selectedType.id, selectedType.ipType === 'suit');
        
        setTimeout(() => { initTaskDatePickers(); this.setupBrandExample(); }, 100);
        this.setupIpRecordSearch();
        if (!isMarkaBasvuru) this.setupPersonSearchListeners();
        else this.setupApplicantListeners();

        const rule = await this.dataManager.getAssignmentRule(typeId);
        this.applyAssignmentRule(rule);
        
        // Buton temizliği (Dedupe)
        this.dedupeActionButtons();
        
        this.validator.checkCompleteness(this.state);
    }

    // --- EKLENEN FONKSİYON: Buton Çoklamasını Önle ---
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

    handleBrandFile(file) {
        if (!file || !file.type.startsWith('image/')) return alert('Geçerli bir resim dosyası seçin.');
        this.state.uploadedFiles = [file];
        const img = document.getElementById('brandExamplePreview');
        if(img) { img.src = URL.createObjectURL(file); document.getElementById('brandExamplePreviewContainer').style.display = 'block'; }
    }

    // --- IP KAYIT SEÇİMİ & GERİ ÇEKME MANTIĞI ---
    setupIpRecordSearch() {
        const input = document.getElementById('ipRecordSearch');
        const results = document.getElementById('ipRecordSearchResults');
        if (!input || !results) return;
        
        const typeId = this.state.selectedTaskType?.id;
        this.state.searchSource = [TASK_IDS.ITIRAZ_YAYIN, '20'].includes(String(typeId)) ? 'bulletin' : 'portfolio';
        
        let timer;
        input.addEventListener('input', (e) => {
            const term = e.target.value.trim();
            clearTimeout(timer);
            if (term.length < 2) { results.style.display = 'none'; return; }
            timer = setTimeout(async () => {
                let items = [];
                if (this.state.searchSource === 'bulletin') items = await this.dataManager.searchBulletinRecords(term);
                else items = this.state.allIpRecords.filter(r => (r.title+r.applicationNumber).toLowerCase().includes(term.toLowerCase())).slice(0, 20);
                this.renderIpSearchResults(items, results);
            }, 300);
        });
    }

    renderIpSearchResults(items, container) {
        container.innerHTML = items.length ? items.map(i => `<div class="search-result-item p-2 border-bottom" style="cursor:pointer;" data-id="${i.id}"><strong>${i.title||i.markName}</strong><br><small>${i.applicationNumber||i.applicationNo}</small></div>`).join('') : '<div class="p-2">Sonuç yok</div>';
        container.style.display = 'block';
        container.querySelectorAll('.search-result-item').forEach(el => {
            el.addEventListener('click', async () => {
                const r = items.find(i => i.id === el.dataset.id);
                // Bulletin ise detayını çek
                if(this.state.searchSource === 'bulletin') {
                    const details = await this.dataManager.fetchAndStoreBulletinData(r.id);
                    if(details) Object.assign(r, details);
                }
                this.selectIpRecord(r);
                container.style.display = 'none';
            });
        });
    }

    async selectIpRecord(record) {
        this.state.selectedIpRecord = record;
        document.getElementById('selectedIpRecordLabel').textContent = record.title || record.markName;
        document.getElementById('selectedIpRecordContainer').style.display = 'block';
        
        // Geri Çekme Kontrolü
        if (this.state.isWithdrawalTask) {
            const txs = await this.dataManager.getRecordTransactions(record.id);
            if (txs.success && txs.data) {
                record.transactions = txs.data;
                this.processParentTransactions(record);
            }
        }
        
        // WIPO Child Kontrolü
        if (record.wipoIR || record.aripoIR) {
             const ir = record.wipoIR || record.aripoIR;
             this.state.selectedWipoAripoChildren = this.state.allIpRecords.filter(c => c.transactionHierarchy === 'child' && (c.wipoIR === ir || c.aripoIR === ir));
             this.uiManager.renderWipoAripoChildRecords(this.state.selectedWipoAripoChildren);
        }

        this.validator.checkCompleteness(this.state);
    }

    processParentTransactions(record) {
        const parentTypes = (String(this.state.selectedTaskType?.id) === '21') ? ['20'] : ['7'];
        const parents = (record.transactions || []).filter(t => parentTypes.includes(String(t.type)) && t.transactionHierarchy === 'parent');
        
        if (parents.length > 1) {
            // İşlem adlarını zenginleştir
            const enrichedParents = parents.map(p => ({
                ...p,
                transactionTypeName: this.getTransactionTypeName(p.type)
            }));
            this.uiManager.showParentSelectionModal(enrichedParents, 'Geri Çekilecek İşlemi Seçin');
        } else if (parents.length === 1) {
            this.submitHandler.selectedParentTransactionId = parents[0].id;
        } else {
            alert('Uygun işlem bulunamadı.');
            this.state.selectedIpRecord = null;
            document.getElementById('selectedIpRecordContainer').style.display = 'none';
        }
    }
    
    // --- EKLENEN HELPER: İşlem Adı Getirme ---
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
            inp.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                const resId = role === 'relatedParty' ? 'personSearchResults' : (role === 'tpInvoiceParty' ? 'tpInvoicePartyResults' : 'serviceInvoicePartyResults');
                const resDiv = document.getElementById(resId);
                if (term.length < 2) { resDiv.style.display = 'none'; return; }
                const found = this.state.allPersons.filter(p => p.name.toLowerCase().includes(term)).slice(0,10);
                resDiv.innerHTML = found.map(p => `<div class="search-result-item p-2" data-id="${p.id}">${p.name}</div>`).join('');
                resDiv.style.display = 'block';
                resDiv.querySelectorAll('.search-result-item').forEach(el => {
                    el.addEventListener('click', () => {
                        this.handlePersonSelection(this.state.allPersons.find(p=>p.id===el.dataset.id), role);
                        resDiv.style.display = 'none';
                    });
                });
            });
        }
        document.getElementById('addNewPersonBtn')?.addEventListener('click', () => {
            openPersonModal((p) => { this.state.allPersons.push(p); this.handlePersonSelection(p, 'relatedParty'); });
        });
    }

    handlePersonSelection(person, role) {
        if (role === 'relatedParty') {
            if (!this.state.selectedRelatedParties.some(p => p.id === person.id)) {
                this.state.selectedRelatedParties.push(person);
                this.state.selectedRelatedParty = person;
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
             }
        });
    }

    handleOriginChange(val) {
        const countryDiv = document.getElementById('countrySelectionContainer');
        if (countryDiv) countryDiv.style.display = ['Yurtdışı Ulusal', 'WIPO', 'ARIPO', 'FOREIGN_NATIONAL'].includes(val) ? 'block' : 'none';
        if (['Yurtdışı Ulusal', 'FOREIGN_NATIONAL'].includes(val)) this.uiManager.populateDropdown('countrySelect', this.state.allCountries, 'code', 'name');
    }

    applyAssignmentRule(rule) {
        const select = document.getElementById('assignedTo');
        if (!select) return;
        select.innerHTML = '<option value="">Seçiniz...</option>';
        let users = this.state.allUsers;
        if (rule?.assigneeIds?.length) {
            users = this.state.allUsers.filter(u => rule.assigneeIds.includes(u.id));
            if (!rule.allowManualOverride) select.disabled = true;
        }
        users.forEach(u => { const o = document.createElement('option'); o.value = u.id; o.textContent = u.displayName; select.appendChild(o); });
        if (users.length === 1) { select.value = users[0].id; select.disabled = true; }
    }

    calculateTotalAmount() {
        const off = parseFloat(document.getElementById('officialFee')?.value || 0);
        const srv = parseFloat(document.getElementById('serviceFee')?.value || 0);
        const vat = parseFloat(document.getElementById('vatRate')?.value || 20);
        const total = document.getElementById('applyVatToOfficialFee')?.checked ? (off+srv)*(1+vat/100) : off+(srv*(1+vat/100));
        document.getElementById('totalAmountDisplay').textContent = total.toFixed(2) + ' TRY';
    }

    resetSelections() {
        this.state.selectedIpRecord = null;
        this.state.selectedRelatedParties = [];
        this.state.selectedApplicants = [];
        this.state.uploadedFiles = [];
        this.state.priorities = [];
    }
}

new CreateTaskController().init();