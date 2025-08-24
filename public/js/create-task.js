import { authService, taskService, ipRecordsService, personService, accrualService, auth, transactionTypeService, db, storage } from '../firebase-config.js';
import { loadSharedLayout, openPersonModal, ensurePersonModal } from './layout-loader.js';
import { initializeNiceClassification, getSelectedNiceClasses } from './nice-classification.js';
import { ref, uploadBytes, getStorage, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { getFirestore, collection, getDocs, getDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// === ID-based configuration (added by assistant) ===
export const TASK_IDS = {
  DEVIR: '5',
  LISANS: '10',
  REHIN_TEMINAT: '13',
  BIRLESME: '3',
  VERASET: '18',
  YAYIMA_ITIRAZIN_YENIDEN_INCELENMESI: '19',
  ITIRAZ_YAYIN: '20',
  KARARA_ITIRAZ: '7',
  UCUNCU_KISI_GORUSU: '1',
  KARARA_ITIRAZ_GERI_CEKME: '8',
  KULLANIM_DELILI_SUNMA: '9',
  SICIL_SURETI: '14',
  TANINMISLIK_TESPITI: '15',
  YAYINA_ITIRAZI_GERI_CEKME: '21',
  EKSIKLIK_GIDERME: '25',
  ITIRAZA_EK_BELGE: '37',
  KULLANIM_ISPATI_DELILI_SUNMA: '39'
};

export const RELATED_PARTY_REQUIRED = new Set([
  TASK_IDS.DEVIR,
  TASK_IDS.LISANS,
  TASK_IDS.REHIN_TEMINAT,
  TASK_IDS.BIRLESME,
  TASK_IDS.VERASET,
  TASK_IDS.YAYIMA_ITIRAZIN_YENIDEN_INCELENMESI,
  TASK_IDS.ITIRAZ_YAYIN,
  TASK_IDS.KARARA_ITIRAZ,
  TASK_IDS.UCUNCU_KISI_GORUSU,
  TASK_IDS.KARARA_ITIRAZ_GERI_CEKME,
  TASK_IDS.KULLANIM_DELILI_SUNMA,
  TASK_IDS.SICIL_SURETI,
  TASK_IDS.TANINMISLIK_TESPITI,
  TASK_IDS.YAYINA_ITIRAZI_GERI_CEKME,
  TASK_IDS.EKSIKLIK_GIDERME,
  TASK_IDS.ITIRAZA_EK_BELGE,
  TASK_IDS.KULLANIM_ISPATI_DELILI_SUNMA
]);

export const PARTY_LABEL_BY_ID = {
  [TASK_IDS.DEVIR]: 'Devralan Taraf',
  [TASK_IDS.LISANS]: 'Lisans Alan Taraf',
  [TASK_IDS.REHIN_TEMINAT]: 'Rehin Alan Taraf',
  [TASK_IDS.BIRLESME]: 'Birleşilen Taraf',
  [TASK_IDS.VERASET]: 'Mirasçı',
  [TASK_IDS.YAYIMA_ITIRAZIN_YENIDEN_INCELENMESI]: 'İtiraz Sahibi',
  [TASK_IDS.ITIRAZ_YAYIN]: 'İtiraz Sahibi',
  [TASK_IDS.KARARA_ITIRAZ]: 'İtiraz Sahibi',
  [TASK_IDS.UCUNCU_KISI_GORUSU]: 'Talep Sahibi',
  [TASK_IDS.KARARA_ITIRAZ_GERI_CEKME]: 'Talep Sahibi',
  [TASK_IDS.KULLANIM_DELILI_SUNMA]: 'Talep Sahibi',
  [TASK_IDS.SICIL_SURETI]: 'Talep Sahibi',
  [TASK_IDS.TANINMISLIK_TESPITI]: 'Talep Sahibi',
  [TASK_IDS.YAYINA_ITIRAZI_GERI_CEKME]: 'Talep Sahibi',
  [TASK_IDS.EKSIKLIK_GIDERME]: 'Talep Sahibi',
  [TASK_IDS.ITIRAZA_EK_BELGE]: 'Talep Sahibi',
  [TASK_IDS.KULLANIM_ISPATI_DELILI_SUNMA]: 'Talep Sahibi'
};

const asId = (v) => String(v ?? '');
// === end ID-based configuration ===
class CreateTaskModule {
    constructor() {
        this.currentUser = null;
        this.allIpRecords = [];
        this.allPersons = [];
        this.allUsers = [];
        this.uploadedFiles = [];
        this.selectedIpRecord = null;
        this.selectedRelatedParty = null;    
        this.selectedRelatedParties = []; // çoklu ilgili taraf listesi
        this.selectedTpInvoiceParty = null;
        this.selectedServiceInvoiceParty = null;
        this.pendingChildTransactionData = null;
        this.activeTab = 'brand-info';
        this.isNiceClassificationInitialized = false;
        this.selectedApplicants = [];
        this.priorities = [];
        this._rendering = false;
        this._lastRenderSig = '';
        this._eventsBound = false;
        this.searchSource = 'portfolio';       // 'portfolio' | 'bulletin'
        this.allBulletinRecords = [];          // itiraz aramaları için
        this.allCountries = [];
    }

async init() {
  this.currentUser = authService.getCurrentUser();
  if (!this.currentUser) { window.location.href = 'index.html'; return; }

  try {
    const [
      ipRecordsResult,
      personsResult,
      usersResult,
      transactionTypesResult,
      countriesResult
    ] = await Promise.all([
      ipRecordsService.getRecords(),
      personService.getPersons(),
      taskService.getAllUsers(),
      transactionTypeService.getTransactionTypes(),
      this.getCountries()
    ]);

    // Dönen yapıları normalize et (data / items / dizi)
    const pickArray = (x) =>
      Array.isArray(x?.data)  ? x.data  :
      Array.isArray(x?.items) ? x.items :
      (Array.isArray(x) ? x : []);

    this.allIpRecords        = pickArray(ipRecordsResult);
    this.allPersons          = pickArray(personsResult);
    this.allUsers            = pickArray(usersResult);
    this.allTransactionTypes = pickArray(transactionTypesResult);
    this.allCountries = pickArray(countriesResult);

    // Logları try bloğu içinde yap (scope hatası olmasın)
    console.log('[INIT] allIpRecords size =', this.allIpRecords.length);
    console.log('[INIT] persons size =', this.allPersons.length);
    console.log('[INIT] users size =', this.allUsers.length);
    console.log('[INIT] transactionTypes size =', this.allTransactionTypes.length);

  } catch (error) {
    console.error("Veri yüklenirken hata oluştu:", error);
    alert("Gerekli veriler yüklenemedi, lütfen sayfayı yenileyin.");
    return;
  }

  this.setupEventListeners();
  this.setupIpRecordSearchListeners();
}

    // Basit debounce

    debounce(fn, delay = 250) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), delay);
    };
    }

async initIpRecordSearchSelector() {
  const input = document.getElementById('ipRecordSearch');
  const results = document.getElementById('ipRecordSearchResults');
  const selectedBox = document.getElementById('selectedIpRecordContainer');
  const selectedLabel = document.getElementById('selectedIpRecordLabel');
  const selectedMeta = document.getElementById('selectedIpRecordMeta');
  const clearBtn = document.getElementById('clearSelectedIpRecord');
  if (!input || !results) return;

  // Kaynağa göre havuzu hazırla
  if (this.searchSource === 'portfolio') {
    if (!Array.isArray(this.allIpRecords) || !this.allIpRecords.length) {
      try {
        const r = await ipRecordsService.getRecords?.();
        const arr = Array.isArray(r?.data) ? r.data : (Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : []));
        this.allIpRecords = arr;
      } catch {}
    }
  } else {
    await this.loadBulletinRecordsOnce();
  }

  const norm = v => (v == null ? '' : String(v)).toLowerCase();

  const renderResults = (items) => {
    if (!items?.length) {
      results.innerHTML = `<div class="p-2 text-muted">Sonuç bulunamadı</div>`;
      results.style.display = 'block';
      return;
    }

    results.innerHTML = items.slice(0, 50).map(r => {
      // Kaynağa göre alan eşlemesi
      const id    = r.id || r.recordId || r.docId || r._id || r.uid
             || r.applicationNo || r.applicationNumber || '';
      const appNo = this.searchSource === 'bulletin'
        ? (r.applicationNo || '')
        : (r.applicationNo || r.applicationNumber || r.appNo || r.fileNo || r.registrationNo || '');
      const title = this.searchSource === 'bulletin'
        ? (r.markName || 'Başlık yok')
        : (r.title || r.name || r.markName || r.applicationTitle || 'Başlık yok');
      const owner = this.searchSource === 'bulletin'
        ? (Array.isArray(r.holders) && r.holders[0]?.name ? r.holders[0].name : '')
        : (r.ownerName || r.owner || r.applicantName || '');
      const img   = this.searchSource === 'bulletin'
        ? (r.imagePath || '')
        : (r.brandImageUrl || r.markImageUrl || r.brandSampleUrl || r.markSampleUrl || r.imageUrl || r.brandSamplePath || '');

      const line = `${appNo ? (appNo + ' — ') : ''}${title}`;
      const imgHtml = img
        ? (img.startsWith('http')
            ? `<img src="${img}" class="ip-thumb" style="width:96px;height:96px;object-fit:contain;border-radius:4px;border:1px solid #eee;background:#fff;">`
            : `<img data-storage-path="${img}" class="ip-thumb" style="width:96px;height:96px;object-fit:contain;border-radius:4px;border:1px solid #eee;background:#fff;">`)
        : '';

      return `
        <div class="search-result-item d-flex align-items-center"
             data-id="${id}"
             style="padding:8px 10px; border-bottom:1px solid #eee; cursor:pointer; gap:10px;">
          ${imgHtml}
          <div>
            <div><strong>${line}</strong></div>
            <div class="text-muted" style="font-size:12px;">${owner || ''}</div>
          </div>
        </div>`;
    }).join('');

    results.style.display = 'block';

    // Storage path -> URL çevir
    results.querySelectorAll('img[data-storage-path]').forEach(async imgEl => {
      const path = imgEl.getAttribute('data-storage-path');
      const url = await this.resolveImageUrl(path);
      if (url) {
        imgEl.src = url;
        imgEl.removeAttribute('data-storage-path');
      }
    });
  };

  const doSearch = this.debounce((raw) => {
    const term = norm(raw).trim();
    if (!term) { results.style.display = 'none'; results.innerHTML = ''; return; }

    // YENİ (yayına itiraz değilse self sahipli kayıtlarda ara)
    let pool;
    const typeId = document.getElementById('specificTaskType')?.value;
    const isOpposition = this.isPublicationOpposition(typeId);

    if (this.searchSource === 'bulletin') {
    pool = this.allBulletinRecords || [];
    } else {
    const basePool = this.allIpRecords || [];
    pool = isOpposition
        ? basePool
        : basePool.filter(r => String(r.recordOwnerType || '').toLowerCase() === 'self');
    }

    const filtered = pool.filter(r => {
      // Kaynağa göre aranan alanlar
      const hay = (this.searchSource === 'bulletin'
        ? [
            r.markName,
            r.applicationNo || r.applicationNumber
          ]
        : [
            r.title, r.name, r.markName, r.applicationTitle,
            r.ownerName, r.owner, r.applicantName,
            r.applicationNo, r.applicationNumber, r.appNo,
            r.fileNo, r.registrationNo
          ])
        .map(norm).join(' ');

      if (hay.includes(term)) return true;

      // Şemalar değişkense son güvenlik
      try { return Object.values(r).map(norm).join(' ').includes(term); }
      catch { return false; }
    });

    renderResults(filtered);
  }, 250);

  input.addEventListener('input', (e) => doSearch(e.target.value));

  results.addEventListener('click', async (e) => {
    const item = e.target.closest('.search-result-item');
    if (!item) return;

    const id = item.dataset.id;
    // YENİ — seçimde de aynı filtre
    let pool;
    const typeId2 = document.getElementById('specificTaskType')?.value;
    const isOpposition2 = this.isPublicationOpposition(typeId2);

    if (this.searchSource === 'bulletin') {
    pool = this.allBulletinRecords || [];
    } else {
    const basePool = this.allIpRecords || [];
    pool = isOpposition2
        ? basePool
        : basePool.filter(r => String(r.recordOwnerType || '').toLowerCase() === 'self');
    }

    const rec  = pool.find(x =>
    (x.id || x.recordId || x.docId || x._id || x.uid || x.applicationNo || x.applicationNumber) === id
    ) || {};
    const title = (this.searchSource === 'bulletin')
      ? (rec.markName || 'Başlık yok')
      : (rec.title || rec.name || rec.markName || rec.applicationTitle || 'Başlık yok');
    const owner = (this.searchSource === 'bulletin')
      ? (Array.isArray(rec.holders) && rec.holders[0]?.name ? rec.holders[0].name : '')
      : (rec.ownerName || rec.owner || rec.applicantName || '');
    const appNo = (this.searchSource === 'bulletin')
      ? (rec.applicationNo || rec.applicationNumber || '')
      : (rec.applicationNo || rec.applicationNumber || rec.appNo || rec.fileNo || rec.registrationNo || '');
    const img   = (this.searchSource === 'bulletin')
      ? (rec.imagePath || '')
      : (rec.brandImageUrl || rec.markImageUrl || rec.brandSampleUrl || rec.markSampleUrl || rec.imageUrl || rec.brandSamplePath || '');

     this.selectedIpRecord = {
        id: rec.id || id,
        title,
        ownerName: owner,
        applicationNo: appNo,
        source: this.searchSource
        };

    selectedBox.style.display = 'block';
    selectedLabel.innerHTML = `${appNo ? `<strong>${appNo}</strong> — ` : ''}${title}`;
    selectedMeta.textContent = owner || '';

    const host  = selectedBox.querySelector('.p-2') || selectedBox;
    const thumb = selectedBox.querySelector('.ip-thumb') || (() => {
      const ph = document.createElement('img');
      ph.className = 'ip-thumb';
      ph.style.cssText = 'width:96px;height:96px;object-fit:contain;border:1px solid #eee;border-radius:4px;margin-right:8px;background:#fff;';
      host.prepend(ph);
      return ph;
    })();

    if (img) {
      const url = await this.resolveImageUrl(img);
      if (url) thumb.src = url;
    }

    results.style.display = 'none';
    results.innerHTML = '';
    input.value = '';
    this.checkFormCompleteness();
    // Yalnızca portföy kaydı seçildiyse (gerçek IP record id'si varsa) parent/transaction vb. kontrolleri yap
    if (this.searchSource === 'portfolio' && this.selectedIpRecord?.id) {
    this.handleIpRecordChange(this.selectedIpRecord.id);
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      this.selectedIpRecord = null;
      selectedBox.style.display = 'none';
      selectedLabel.textContent = '';
      selectedMeta.textContent = '';
      const t = selectedBox.querySelector('.ip-thumb');
      if (t) t.remove();
      this.checkFormCompleteness();
    if (this.selectedIpRecord && this.selectedIpRecord.id) { this.handleIpRecordChange(this.selectedIpRecord.id); }
  });
  }

  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== input) results.style.display = 'none';
  });
}


    populateAssignedToDropdown() {
        const assignedToSelect = document.getElementById('assignedTo');
        if (!assignedToSelect) {
            return;
        }

        assignedToSelect.innerHTML = '<option value="">Seçiniz...</option>';

        this.allUsers.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.displayName || user.email;
            assignedToSelect.appendChild(option);
        });
    }
  _onPersonCreated(newPerson, target) {
    this.allPersons = this.allPersons || [];
    this.allPersons.push(newPerson);
    if (target === 'relatedParty' && typeof this.selectPerson === 'function') {
      this.selectPerson(newPerson, 'relatedParty');
    } else if (target === 'applicant' && typeof this.addApplicant === 'function') {
      this.addApplicant(newPerson);
    }
    console.log('✅ Yeni kişi eklendi:', newPerson);
  }



    setupEventListeners() {
        if (this._eventsBound) return;
        this._eventsBound = true;
        document.getElementById('mainIpType').addEventListener('change', (e) => this.handleMainTypeChange(e));
        document.getElementById('specificTaskType').addEventListener('change', (e) => this.handleSpecificTypeChange(e));
        document.getElementById('createTaskForm').addEventListener('submit', (e) => this.handleFormSubmit(e));

        document.addEventListener('click', (e) => {
            if (e.target.id === 'cancelBtn') {
                window.location.href = 'task-management.html';
            }
            if (e.target.id === 'nextTabBtn') {
                this.handleNextTab();
            }
        });

        $(document).on('shown.bs.tab', '#myTaskTabs a', async (e) => {
            this.updateButtonsAndTabs();
            const targetTabId = e.target.getAttribute('href').substring(1);
            if (targetTabId === 'goods-services' && !this.isNiceClassificationInitialized) {
                await initializeNiceClassification();
                this.isNiceClassificationInitialized = true;
            }
            if (targetTabId === 'applicants') {
                this.renderSelectedApplicants();
            }
            if (targetTabId === 'priority') {
                this.renderPriorities();
            }
            if (targetTabId === 'accrual') {
                this.setupAccrualTabListeners();
            }
            if (targetTabId === 'summary') {
                this.renderSummaryTab();
            }
        });

        this.setupBrandExampleUploader();
    }

updateRelatedPartySectionVisibility(selectedTaskType) {
    const section = document.getElementById('relatedPartySection');
    const titleEl = document.getElementById('relatedPartyTitle') || section?.querySelector('.section-title');
    const countEl = document.getElementById('relatedPartyCount');
    const tIdStr = asId(selectedTaskType?.id);
    const needsRelatedParty = RELATED_PARTY_REQUIRED.has(tIdStr);
    const label = PARTY_LABEL_BY_ID[tIdStr] || 'İlgili Taraf';
    if (section) section.classList.toggle('d-none', !needsRelatedParty);
    if (titleEl) titleEl.textContent = label;
    if (countEl) countEl.textContent = (Array.isArray(this.selectedRelatedParties) ? this.selectedRelatedParties.length : 0);
}

setupBaseFormListeners() {
  // Bu fonksiyon container'ı parametre almıyor; DOM'dan bulalım
  const container = document.getElementById('conditionalFieldsContainer');
  if (!container) return;

  // İptal butonu
  const cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (confirm('İşlem iptal edilsin mi? Girilen veriler kaybolacak.')) {
        window.location.href = 'task-management.html';
      }
    });
  }

  // Form submit
  const saveTaskBtn = document.getElementById('saveTaskBtn');
  if (saveTaskBtn) {
    saveTaskBtn.addEventListener('click', (e) => {
      this.handleFormSubmit(e);
    });
  }

  // Form validation için input listeners
  const inputs = container.querySelectorAll('input, select, textarea');
  inputs.forEach(input => {
    input.addEventListener('input', () => this.checkFormCompleteness());
    input.addEventListener('change', () => this.checkFormCompleteness());
  });
}

    setupAccrualTabListeners() {
        this.populateAssignedToDropdown();
        this.calculateTotalAmount();
        
        const officialFeeInput = document.getElementById('officialFee');
        const serviceFeeInput = document.getElementById('serviceFee');
        const vatRateInput = document.getElementById('vatRate');
        const applyVatCheckbox = document.getElementById('applyVatToOfficialFee');
        
        if (officialFeeInput) officialFeeInput.addEventListener('input', () => this.calculateTotalAmount());
        if (serviceFeeInput) serviceFeeInput.addEventListener('input', () => this.calculateTotalAmount());
        if (vatRateInput) vatRateInput.addEventListener('input', () => this.calculateTotalAmount());
        if (applyVatCheckbox) applyVatCheckbox.addEventListener('change', () => this.calculateTotalAmount());
        
        const tpInvoicePartySearch = document.getElementById('tpInvoicePartySearch');
        if (tpInvoicePartySearch) tpInvoicePartySearch.addEventListener('input', (e) => this.searchPersons(e.target.value, 'tpInvoiceParty'));
        
        const serviceInvoicePartySearch = document.getElementById('serviceInvoicePartySearch');
        if (serviceInvoicePartySearch) serviceInvoicePartySearch.addEventListener('input', (e) => this.searchPersons(e.target.value, 'serviceInvoiceParty'));

        const assignedToSelect = document.getElementById('assignedTo');
        if (assignedToSelect) {
            assignedToSelect.addEventListener('change', () => this.checkFormCompleteness());
        }
    }

    setupBrandExampleUploader() {
        const dropZone = document.getElementById('brand-example-drop-zone');
        const fileInput = document.getElementById('brandExample');

        if (!dropZone || !fileInput) {
            return;
        }
        dropZone.addEventListener('click', () => fileInput.click());
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('drag-over');
            }, false);
        });
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('drag-over');
            }, false);
        });
        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleBrandExampleFile(files[0]);
            }
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleBrandExampleFile(e.target.files[0]);
            }
        });
        const removeBtn = document.getElementById('removeBrandExampleBtn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                const previewContainer = document.getElementById('brandExamplePreviewContainer');
                const previewImage = document.getElementById('brandExamplePreview');
                const fileInput = document.getElementById('brandExample');
                if (previewContainer) previewContainer.style.display = 'none';
                if (previewImage) previewImage.src = '';
                if (fileInput) fileInput.value = '';
            });
        }
    }
    handleNextTab() {
        const currentTab = $(`#myTaskTabs a[href="#${this.activeTab}"]`);
        const nextTab = currentTab.parent().next().find('a');
        if (nextTab.length) {
            this.activeTab = nextTab.attr('href').substring(1);
            nextTab.tab('show');
        }
    }
    updateButtonsAndTabs() {
        const formActionsContainer = document.getElementById('formActionsContainer');
        if (!formActionsContainer) {
            const container = document.getElementById('conditionalFieldsContainer');
            if (container) {
                const newActionsContainer = document.createElement('div');
                newActionsContainer.id = 'formActionsContainer';
                newActionsContainer.className = 'form-actions';
                container.appendChild(newActionsContainer);
            }
        }
        const tabs = document.querySelectorAll('#myTaskTabs .nav-item');
        const activeTabIndex = Array.from(tabs).findIndex(tab => tab.querySelector('.nav-link.active'));
        const buttonHtml = activeTabIndex < tabs.length - 1 ?
            `<button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button><button type="button" id="nextTabBtn" class="btn btn-primary">İlerle</button>` :
            `<button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button><button type="submit" id="saveTaskBtn" class="btn btn-primary" disabled>İşi Oluştur ve Kaydet</button>`;
        const existingActionsContainer = document.getElementById('formActionsContainer');
        if (existingActionsContainer) {
            existingActionsContainer.innerHTML = buttonHtml;
        }
        if (activeTabIndex === tabs.length - 1) {
            this.checkFormCompleteness();
        }
    }
    async handleMainTypeChange(e) {
        const mainType = e.target.value;
        const specificTypeSelect = document.getElementById('specificTaskType');
        const conditionalFieldsContainer = document.getElementById('conditionalFieldsContainer');
        conditionalFieldsContainer.innerHTML = '';
        const saveTaskBtn = document.getElementById('saveTaskBtn');
        if (saveTaskBtn) saveTaskBtn.disabled = true;
        specificTypeSelect.innerHTML = '<option value="">Önce İşin Ana Türünü Seçin</option>';
        if (mainType) {
            specificTypeSelect.innerHTML = '<option value="">Seçiniz...</option>';
            const filteredTransactionTypes = this.allTransactionTypes.filter(type => {
                const isParentAndMatchesIpType = (type.hierarchy === 'parent' && type.ipType === mainType);
                const isTopLevelChildAndMatchesIpType = (
                    type.hierarchy === 'child' &&
                    type.isTopLevelSelectable &&
                    (type.applicableToMainType.includes(mainType) || type.applicableToMainType.includes('all'))
                );
                return isParentAndMatchesIpType || isTopLevelChildAndMatchesIpType;
            });
            filteredTransactionTypes.sort((a, b) => (a.order || 999) - (b.order || 999));
            filteredTransactionTypes.forEach(type => {
                specificTypeSelect.innerHTML += `<option value="${type.id}">${type.alias || type.name}</option>`;
            });
            specificTypeSelect.disabled = false;
        } else {
            specificTypeSelect.disabled = true;
        }
    }

      renderBaseForm(container, taskTypeName, taskTypeId) {
        const taskIdStr = asId(taskTypeId);
        const needsRelatedParty = RELATED_PARTY_REQUIRED.has(taskIdStr);
        const partyLabel = PARTY_LABEL_BY_ID[taskIdStr] || 'İlgili Taraf';

        let specificFieldsHtml = '';
        if (taskTypeId === 'litigation_yidk_annulment') {
            specificFieldsHtml = `
                <div class="form-section">
                    <h3 class="section-title">2. Dava Bilgileri</h3>
                    <div class="form-group full-width">
                        <label for="subjectOfLawsuit" class="form-label">Dava Konusu</label>
                        <textarea id="subjectOfLawsuit" name="subjectOfLawsuit" class="form-textarea"></textarea>
                    </div>
                    <div class="form-group">
                        <label for="courtName" class="form-label">Mahkeme Adı</label>
                        <input type="text" id="courtName" name="courtName" class="form-input">
                    </div>
                    <div class="form-group">
                        <label for="courtFileNumber" class="form-label">Dava Dosya Numarası</label>
                        <input type="text" id="courtFileNumber" name="courtFileNumber" class="form-input">
                    </div>
                    <div class="form-group date-picker-group">
                        <label for="lawsuitDate" class="form-label">Dava Tarihi</label>
                        <input type="date" id="lawsuitDate" name="lawsuitDate" class="form-input">
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = `
            <div class="section-card" id="card-asset">
            <h3 class="section-title">2. İşleme Konu Varlık</h3>

            <div class="form-group full-width">
                <label for="ipRecordSearch" class="form-label">Portföyden Ara</label>

                <!-- Arama kutusu -->
                <div class="position-relative">
                <input type="text" id="ipRecordSearch" class="form-input" placeholder="Başlık, dosya no, başvuru no, sahip adı...">
                <!-- Sonuç listesi (drop-down) -->
                <div id="ipRecordSearchResults"
                    style="position:absolute; top:100%; left:0; right:0; z-index:1000; background:#fff; border:1px solid #ddd; border-top:none; display:none; max-height:260px; overflow:auto;">
                </div>
                </div>

                <!-- Seçili kayıt özeti -->
                <div id="selectedIpRecordContainer" class="mt-2" style="display:none;">
                <div class="p-2 border rounded d-flex justify-content-between align-items-center">
                    <div>
                    <div class="text-muted" id="selectedIpRecordLabel"></div>
                    <small class="text-secondary" id="selectedIpRecordMeta"></small>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-danger" id="clearSelectedIpRecord">Kaldır</button>
                </div>
                </div>
            </div>
            </div>
             ${needsRelatedParty ? `
                <div class="section-card d-none" id="relatedPartySection">
                  <h3 class="section-title" id="relatedPartyTitle">3. ${partyLabel}</h3>
                    <div class="form-group full-width">
                    <label for="personSearchInput" class="form-label">Sistemdeki Kişilerden Ara</label>
                    <div class="d-flex" style="gap:10px; align-items:flex-start;">
                        <!-- input + sonuç listesi AYNI WRAPPER içinde -->
                        <div class="search-input-wrapper" style="flex:1; position:relative;">
                        <input type="text" id="personSearchInput" class="form-input" placeholder="Aramak için en az 2 karakter...">
                        <div id="personSearchResults" class="search-results-list" style="display:none;"></div>
                        </div>

                        <button type="button" id="addNewPersonBtn" class="btn-small btn-add-person">
                        <span>&#x2795;</span> Yeni Kişi
                        </button>
                    </div>

                    <div class="form-group full-width mt-2">
                        <label class="form-label">
                        Seçilen Taraflar <span class="badge badge-light ml-2" id="relatedPartyCount">0</span>
                        </label>
                        <div id="relatedPartyList" class="selected-items-list">
                        <div class="empty-state">
                            <i class="fas fa-user-friends fa-3x text-muted mb-3"></i>
                            <p class="text-muted">Henüz taraf eklenmedi.</p>
                        </div>
                        </div>
                    </div>
                    </div>
            ` : ''}

            ${specificFieldsHtml} <div class="section-card" id="card-accrual">
                <h3 class="section-title">Tahakkuk Bilgileri</h3>
                <div class="form-grid">
                    <div class="form-group">
                        <label for="officialFee" class="form-label">Resmi Ücret</label>
                        <div class="input-with-currency">
                            <input type="number" id="officialFee" class="form-input" placeholder="0.00" step="0.01">
                            <select id="officialFeeCurrency" class="currency-select">
                                <option value="TRY" selected>TL</option>
                                <option value="EUR">EUR</option>
                                <option value="USD">USD</option>
                                <option value="CHF">CHF</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="serviceFee" class="form-label">Hizmet Bedeli</label>
                        <div class="input-with-currency">
                            <input type="number" id="serviceFee" class="form-input" placeholder="0.00" step="0.01">
                            <select id="serviceFeeCurrency" class="currency-select">
                                <option value="TRY" selected>TL</option>
                                <option value="EUR">EUR</option>
                                <option value="USD">USD</option>
                                <option value="CHF">CHF</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="vatRate" class="form-label">KDV Oranı (%)</label>
                        <input type="number" id="vatRate" class="form-input" value="20">
                    </div>
                    <div class="form-group">
                        <label for="totalAmountDisplay" class="form-label">Toplam Tutar</label>
                        <div id="totalAmountDisplay" class="total-amount-display">0.00 TRY</div>
                    </div>
                    <div class="form-group full-width">
                        <label class="checkbox-label">
                            <input type="checkbox" id="applyVatToOfficialFee" checked>
                            Resmi Ücrete KDV Uygula
                        </label>
                    </div>
                    <div class="form-group full-width">
                        <label for="tpInvoicePartySearch" class="form-label">Türk Patent Faturası Tarafı</label>
                        <input type="text" id="tpInvoicePartySearch" class="form-input" placeholder="Fatura tarafı arayın...">
                        <div id="tpInvoicePartyResults" class="search-results-list"></div>
                        <div id="selectedTpInvoicePartyDisplay" class="search-result-display" style="display:none;"></div>
                    </div>
                    <div class="form-group full-width">
                        <label for="serviceInvoicePartySearch" class="form-label">Hizmet Faturası Tarafı</label>
                        <input type="text" id="serviceInvoicePartySearch" class="form-input" placeholder="Fatura tarafı arayın...">
                        <div id="serviceInvoicePartyResults" class="search-results-list"></div>
                        <div id="selectedServiceInvoicePartyDisplay" class="search-result-display" style="display:none;"></div>
                    </div>
                </div>
            </div>

            <div class="section-card" id="card-job">
                <h3 class="section-title">İş Detayları ve Atama</h3>
                <div class="form-grid">
                    <div class="form-group">
                        <label for="taskPriority" class="form-label">Öncelik</label>
                        <select id="taskPriority" class="form-select">
                            <option value="medium">Orta</option>
                            <option value="high">Yüksek</option>
                            <option value="low">Düşük</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="assignedTo" class="form-label">Atanacak Kullanıcı</label>
                        <select id="assignedTo" class="form-select">
                            <option value="">Seçiniz...</option>
                        </select>
                    </div>
                    <div class="form-group full-width">
                        <label for="taskDueDate" class="form-label">Operasyonel Son Tarih</label>
                        <input type="date" id="taskDueDate" class="form-input">
                    </div>
                </div>
            </div>
            <div class="form-actions"><button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button><button type="submit" id="saveTaskBtn" class="btn btn-primary" disabled>İşi Oluştur ve Kaydet</button></div>
        `;
        const selectedTaskTypeObj = this.allTransactionTypes.find(t => asId(t.id) === asId(taskTypeId));
        this.updateRelatedPartySectionVisibility(selectedTaskTypeObj);
        this.renderSelectedRelatedParties();
        this.setupDynamicFormListeners();
        this.setupAccrualTabListeners();
        this.populateAssignedToDropdown();
        this.setupBaseFormListeners();
        this.updateButtonsAndTabs();
        this.checkFormCompleteness();
        this.initIpRecordSearchSelector();
    }
handleIpRecordChange(recordId) {
    console.log('🔄 handleIpRecordChange çağrıldı:', recordId);
    // 🔥 YENİ: Geri çekme işlemi kontrolü
    const taskTypeId = document.getElementById('specificTaskType')?.value;
    console.log('📋 Task Type ID:', taskTypeId, 'isWithdrawalTask:', this.isWithdrawalTask);
    
    if (this.isWithdrawalTask && recordId) {
        let selectedRecord = this.allIpRecords.find(r => r.id === recordId);
        console.log('🔍 Seçilen portföy (başlangıç):', selectedRecord);
        
        if (selectedRecord) {
            // Eğer transactions yoksa veya boşsa, veritabanından yükle
            if (!selectedRecord.transactions || selectedRecord.transactions.length === 0) {
                console.log('⚠️ Transactions yok, veritabanından yükleniyor...');
                ipRecordsService.getRecordTransactions(recordId).then(transactionsResult => {
                    if (transactionsResult.success && transactionsResult.data) {
                        selectedRecord.transactions = transactionsResult.data;
                        console.log('✅ Transactions yüklendi:', selectedRecord.transactions);
                        this.processParentTransactions(selectedRecord, taskTypeId);
                    } else {
                        console.log('⚠️ Transactions yüklenemedi:', transactionsResult.error);
                        selectedRecord.transactions = [];
                    }
                }).catch(error => {
                    console.error('❌ Transactions yükleme hatası:', error);
                    selectedRecord.transactions = [];
                });
            } else {
                this.processParentTransactions(selectedRecord, taskTypeId);
            }
        }
    }
 
    if (recordId) {
        this.selectedIpRecord = this.allIpRecords.find(r => r.id === recordId);
        console.log('📋 IP kaydı seçildi:', this.selectedIpRecord);
    } else {
        this.selectedIpRecord = null;
        this.selectedParentTransactionId = null; // 🔥 YENİ: Parent seçimini de temizle
    }
    this.checkFormCompleteness();
}
processParentTransactions(selectedRecord, taskTypeId) {
    const parentTransactions = this.findParentObjectionTransactions(selectedRecord, taskTypeId);
    console.log('🔍 Bulunan parent itirazlar:', parentTransactions);
    
    this.pendingChildTransactionData = taskTypeId;
    
    if (parentTransactions.length > 1) {
        console.log('🔄 Birden fazla itiraz bulundu, modal açılıyor...', parentTransactions);
        this.showParentSelectionModal(parentTransactions, taskTypeId);
    } else if (parentTransactions.length === 1) {
        console.log('✅ Tek itiraz bulundu, otomatik seçiliyor:', parentTransactions[0]);
        const p0 = parentTransactions[0];
        this.selectedParentTransactionId = p0.transactionId || p0.id || p0.docId || p0.uid;
    } else {
        alert('Bu portföyde geri çekilecek uygun bir itiraz işlemi bulunamadı. Lütfen işleme konu olacak başka bir portföy seçin veya iş tipini değiştirin.');
        this.selectedIpRecord = null;
        document.getElementById('clearSelectedIpRecord')?.click();
        return;
    }
}

findParentObjectionTransactions(record, childTaskTypeId) {
    console.log('🔍 findParentObjectionTransactions çağrıldı:', {
        record: record,
        childTaskTypeId: childTaskTypeId,
        recordTransactions: record?.transactions,
        transactionsLength: record?.transactions?.length
    });
    
    if (!record || !record.transactions || !Array.isArray(record.transactions)) {
        console.log('❌ Record veya transactions array yok');
        return [];
    }

    const parentTxTypeIds = new Set();
    if (String(childTaskTypeId) === '21') { // Yayına İtirazı Geri Çekme
        parentTxTypeIds.add('20'); // Yayına İtiraz
        parentTxTypeIds.add('trademark_publication_objection');
    } else if (String(childTaskTypeId) === '8') { // Karara İtirazı Geri Çekme
        parentTxTypeIds.add('7'); // Karara İtiraz  
        parentTxTypeIds.add('trademark_decision_objection');
    }

    console.log('🔍 Aranacak parent type ID\'leri:', Array.from(parentTxTypeIds));
    
    const matchingTransactions = record.transactions.filter(tx => {
        console.log('🔍 Transaction kontrol ediliyor:', {
            txType: tx.type,
            txHierarchy: tx.transactionHierarchy,
            isParentType: parentTxTypeIds.has(String(tx.type)),
            isParentHierarchy: tx.transactionHierarchy === 'parent'
        });
        
        return parentTxTypeIds.has(String(tx.type)) && tx.transactionHierarchy === 'parent';
    });

    console.log('✅ Eşleşen parent transactions:', matchingTransactions);
    return matchingTransactions;
}

showParentSelectionModal(parentTransactions, childTaskTypeId) {
    console.log('🔄 Modal açılıyor...', { parentTransactions, childTaskTypeId });
    
    const modal = document.getElementById('selectParentModal');
    const parentListContainer = document.getElementById('parentListContainer');
    
    if (!modal) {
        console.error('❌ Modal element bulunamadı!');
        return;
    }
    
    if (!parentListContainer) {
        console.error('❌ Parent list container bulunamadı!');
        return;
    }

    // Modal başlığını güncelle
    const modalTitleEl = document.getElementById('selectParentModalLabel');
    if (modalTitleEl) {
        const isDecisionObjection = String(childTaskTypeId) === '8';
        modalTitleEl.textContent = isDecisionObjection ? 
            'Geri Çekilecek Karara İtirazı Seçin' : 
            'Geri Çekilecek Yayına İtirazı Seçin';
    }

    // Liste içeriğini temizle ve yeniden oluştur
    parentListContainer.innerHTML = '';
    
    parentTransactions.forEach((tx, index) => {
        const item = document.createElement('li');
        item.className = 'list-group-item list-group-item-action';
        item.style.cursor = 'pointer';
        
        // İtiraz tipini belirle
        const transactionTypeName = this.getTransactionTypeName(tx.type) || 'Bilinmeyen İtiraz Tipi';
        
        item.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <h6 class="mb-1">${transactionTypeName}</h6>
                    <p class="mb-1">${tx.description || 'Açıklama bulunmuyor'}</p>
                    <small class="text-muted">Oluşturulma: ${new Date(tx.timestamp).toLocaleDateString('tr-TR')}</small>
                </div>
                <i class="fas fa-chevron-right text-muted"></i>
            </div>
        `;
        
        // Click event listener
        item.onclick = () => {
          console.log('📋 İtiraz seçildi:', tx);
          const pid = tx.transactionId || tx.id || tx.docId || tx.uid;
          this.handleParentSelection(pid);
        };
       
        parentListContainer.appendChild(item);
    });

    // Bootstrap modal'ı göster
try {
    $('#selectParentModal').modal('show');
    console.log('✅ Modal başarıyla açıldı');
} catch (error) {
    console.error('❌ Modal açma hatası:', error);
    // Fallback
    modal.style.display = 'block';
    modal.classList.add('show');
    document.body.classList.add('modal-open');
}
}
getTransactionTypeName(typeId) {
    const transactionType = this.allTransactionTypes.find(t => t.id === typeId);
    return transactionType ? (transactionType.alias || transactionType.name) : null;
}

setupIpRecordSearchListeners() {
    const ipRecordSearchResults = document.getElementById('ipRecordSearchResults');
    if (ipRecordSearchResults) {
        ipRecordSearchResults.addEventListener('click', (e) => {
            const item = e.target.closest('.search-result-item') || e.target.closest('[data-id]');
            if (item) {
                const recordId = item.dataset.id;
                if (recordId && this.selectIpRecord) {
                    this.selectIpRecord(recordId);
                }
            }
        });
    }
}

async handleSpecificTypeChange(e) {
    const taskTypeId = e.target.value;
    const selectedTaskType = this.allTransactionTypes.find(t => t.id === taskTypeId);
    const tIdStr = String(selectedTaskType?.id ?? '');
    this.isWithdrawalTask = (tIdStr === '21' || tIdStr === '8'); // 21: Yayına İtirazı Geri Çekme, 8: Karara İtirazı Geri Çekme
    console.log('🔄 İş tipi değişti:', {
        taskTypeId: tIdStr, 
        isWithdrawalTask: this.isWithdrawalTask,
        taskName: selectedTaskType?.alias || selectedTaskType?.name
    });
    // — INSERT #1 — seçime göre arama kaynağı + ilgili taraf görünürlüğü
        try {
        // Eğer TASK_IDS sabitini kullanıyorsan:
        const tIdStr = String(selectedTaskType?.id ?? '');
        this.searchSource = (tIdStr === TASK_IDS.ITIRAZ_YAYIN) ? 'bulletin' : 'portfolio';

        // İlgili taraf (Devir/Lisans/Birleşme/… ve 19-20) görünürlük/başlık
        this.updateRelatedPartySectionVisibility(selectedTaskType);
        } catch (e) {
        console.warn('Tip sonrası görünürlük/arama kaynağı ayarlanamadı:', e);
        }

    const container = document.getElementById('conditionalFieldsContainer');
    if (!container) return;

    // ✅ ID BAZLI KONTROL - Çok daha güvenilir!
    // Yayına İtiraz tiplerinin ID'leri (Firebase'den gelen veriler)
    const YAYIN_ITIRAZ_IDS = [
        '20',  // Yayına İtiraz (ana tip)
        'trademark_publication_objection',  // Eğer başka formatta ID varsa
        // Gerekirse başka ID'ler de eklenebilir
    ];
    
    const isYayinaItiraz = selectedTaskType?.ipType === 'trademark' && 
                          YAYIN_ITIRAZ_IDS.includes(selectedTaskType.id);
    
    this.searchSource = isYayinaItiraz ? 'bulletin' : 'portfolio';
    
    console.log('[TYPE-ID-BASED]', { 
        id: selectedTaskType?.id,
        alias: selectedTaskType?.alias,
        ipType: selectedTaskType?.ipType, 
        isYayinaItiraz,
        searchSource: this.searchSource 
    });

    // Aynı seçim tekrar geldiyse ve içerik zaten varsa atla
    const sig = selectedTaskType ? 
        `${selectedTaskType.id}::${selectedTaskType.alias || selectedTaskType.name || ''}` : '';
    if (this._lastRenderSig === sig && container.childElementCount > 0) return;

    // Re-entrancy guard
    if (this._rendering) return;
    this._rendering = true;

    // Önceki form-actions düğmelerini temizle
    document.querySelectorAll('.form-actions').forEach(el => el.remove());

    container.innerHTML = '';
    this.resetSelections();

    const saveTaskBtn = document.getElementById('saveTaskBtn');
    if (saveTaskBtn) saveTaskBtn.disabled = true;

    if (!selectedTaskType) {
        this._rendering = false;
        return;
    }

    // Marka başvurusu için özel form
    if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
        this.renderTrademarkApplicationForm(container);
    } else {
        this.renderBaseForm(container, selectedTaskType.alias || selectedTaskType.name, selectedTaskType.id);
    }

    // Arama kaynağına göre veri yükle
    if (this.searchSource === 'bulletin') {
        await this.loadBulletinRecordsOnce();
        console.log('📚 Bulletin records loaded:', this.allBulletinRecords?.length || 0);
    }

    // Arama kutusunu başlat
    await this.initIpRecordSearchSelector();
    // — INSERT #2 — DOM çizimi sonrası görünürlüğü bir kez daha sabitle
    try {
    const tIdStr = String(document.getElementById('specificTaskType')?.value || '');
    const selected = this.allTransactionTypes.find(t => String(t.id) === tIdStr);
    this.updateRelatedPartySectionVisibility(selected);
    } catch (e) {}

    this.updateButtonsAndTabs();
    this.checkFormCompleteness();
    if (typeof this.dedupeActionButtons === 'function') {
        this.dedupeActionButtons();
    }

    this._lastRenderSig = sig;
    this._rendering = false;
}
    renderTrademarkApplicationForm(container) {
        container.innerHTML = `
            <div class="card-body">
                <ul class="nav nav-tabs" id="myTaskTabs" role="tablist">
                    <li class="nav-item">
                        <a class="nav-link active" id="brand-info-tab" data-toggle="tab" href="#brand-info" role="tab" aria-controls="brand-info" aria-selected="true">Marka Bilgileri</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="goods-services-tab" data-toggle="tab" href="#goods-services" role="tab" aria-controls="goods-services" aria-selected="false">Mal/Hizmet Seçimi</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="applicants-tab" data-toggle="tab" href="#applicants" role="tab" aria-controls="applicants" aria-selected="false">Başvuru Sahibi</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="priority-tab" data-toggle="tab" href="#priority" role="tab" aria-controls="priority" aria-selected="false">Rüçhan</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="accrual-tab" data-toggle="tab" href="#accrual" role="tab" aria-controls="accrual" aria-selected="false">Tahakkuk/Diğer</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="summary-tab" data-toggle="tab" href="#summary" role="tab" aria-controls="summary" aria-selected="false">Özet</a>
                    </li>
                </ul>
                <div class="tab-content mt-3 tab-content-card" id="myTaskTabContent">
                    <div class="tab-pane fade show active" id="brand-info" role="tabpanel" aria-labelledby="brand-info-tab">
                        <div class="form-section">
                            <h3 class="section-title">Marka Bilgileri</h3>
                            <div class="form-group row">
                                <label for="brandType" class="col-sm-3 col-form-label">Marka Tipi</label>
                                <div class="col-sm-9">
                                    <select class="form-control" id="brandType">
                                        <option value="Sadece Kelime">Sadece Kelime</option>
                                        <option value="Sadece Şekil">Sadece Şekil</option>
                                        <option value="Şekil + Kelime" selected>Şekil + Kelime</option>
                                        <option value="Ses">Ses</option>
                                        <option value="Hareket">Hareket</option>
                                        <option value="Renk">Renk</option>
                                        <option value="Üç Boyutlu">Üç Boyutlu</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-group row">
                                <label for="brandCategory" class="col-sm-3 col-form-label">Marka Türü</label>
                                <div class="col-sm-9">
                                    <select class="form-control" id="brandCategory">
                                        <option value="Ticaret/Hizmet Markası" selected>Ticaret/Hizmet Markası</option>
                                        <option value="Garanti Markası">Garanti Markası</option>
                                        <option value="Ortak Marka">Ortak Marka</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-group row">
                            <label for="brandExample" class="col-sm-3 col-form-label">Marka Örneği</label>
                            <div class="col-sm-9">
                                <div id="brand-example-drop-zone" class="file-upload-wrapper brand-upload-frame">
                                <input type="file" id="brandExample" accept="image/*" style="display:none;">
                                <div class="file-upload-button">
                                    <div class="upload-icon" style="font-size: 2.5em; color: #1e3c72;">🖼️</div>
                                    <div style="font-weight: 500;">Marka örneğini buraya sürükleyin veya seçmek için tıklayın</div>
                                </div>
                                <div class="file-upload-info">
                                    İstenen format: 591x591px, 300 DPI, JPEG. Yüklenen dosya otomatik olarak dönüştürülecektir.
                                </div>
                                </div>
                                <div id="brandExamplePreviewContainer" class="mt-3 text-center" style="display:none;">
                                <img id="brandExamplePreview" src="#" alt="Marka Örneği Önizlemesi"
                                    style="max-width:200px; max-height:200px; border:1px solid #ddd; padding:5px; border-radius:8px;">
                                <button id="removeBrandExampleBtn" type="button" class="btn btn-sm btn-danger mt-2">Kaldır</button>
                                <div id="image-processing-status" class="mt-2 text-muted" style="font-size: 0.9em;"></div>
                                </div>
                            </div>
                            </div>
                            <div class="form-group row">
                                <label for="brandExampleText" class="col-sm-3 col-form-label">Marka Örneği Yazılı İfadesi</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control" id="brandExampleText">
                                </div>
                            </div>
                            <div class="form-group row">
                                <label for="nonLatinAlphabet" class="col-sm-3 col-form-label">Marka Örneğinde Latin Alfabesi Haricinde Harf Var Mı?</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control" id="nonLatinAlphabet">
                                </div>
                            </div>
                            <div class="form-group row">
                                <label class="col-sm-3 col-form-label">Önyazı Talebi</label>
                                <div class="col-sm-9">
                                    <div class="form-check form-check-inline">
                                        <input class="form-check-input" type="radio" name="coverLetterRequest" id="coverLetterRequestVar" value="var">
                                        <label class="form-check-label" for="coverLetterRequestVar">Var</label>
                                    </div>
                                    <div class="form-check form-check-inline">
                                        <input class="form-check-input" type="radio" name="coverLetterRequest" id="coverLetterRequestYok" value="yok" checked>
                                        <label class="form-check-label" for="coverLetterRequestYok">Yok</label>
                                    </div>
                                </div>
                            </div>
                            <div class="form-group row">
                                <label class="col-sm-3 col-form-label">Muvafakat Talebi</label>
                                <div class="col-sm-9">
                                    <div class="form-check form-check-inline">
                                        <input class="form-check-input" type="radio" name="consentRequest" id="consentRequestVar" value="var">
                                        <label class="form-check-label" for="consentRequestVar">Var</label>
                                    </div>
                                    <div class="form-check form-check-inline">
                                        <input class="form-check-input" type="radio" name="consentRequest" id="consentRequestYok" value="yok" checked>
                                        <label class="form-check-label" for="consentRequestYok">Yok</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane fade" id="goods-services" role="tabpanel" aria-labelledby="goods-services-tab">
                        <div class="nice-classification-container mt-3">
                            <div class="row">
                                <div class="col-lg-8">
                                    
                                    <div class="classification-panel mb-3">
                                        <div class="panel-header">
                                            <h5 class="mb-0">
                                                <i class="fas fa-list-ul mr-2"></i>
                                                Nice Classification - Mal ve Hizmet Sınıfları
                                            </h5>
                                            <small class="text-white-50">1-45 arası sınıflardan seçim yapın</small>
                                        </div>
                                        
                                        <div class="search-section">
                                            <div class="input-group">
                                                <div class="input-group-prepend">
                                                    <span class="input-group-text">
                                                        <i class="fas fa-search"></i>
                                                    </span>
                                                </div>
                                                <input type="text" class="form-control" id="niceClassSearch" 
                                                       placeholder="Sınıf ara... (örn: kozmetik, kimyasal, teknoloji)">
                                                <div class="input-group-append">
                                                    <button class="btn btn-outline-secondary" type="button" onclick="clearNiceSearch()">
                                                        <i class="fas fa-times"></i>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="classes-list" id="niceClassificationList" 
                                             style="height: 450px; overflow-y: auto; background: #fafafa;">
                                            <div class="loading-spinner">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Yükleniyor...</span>
                                                </div>
                                                <p class="mt-2 text-muted">Nice sınıfları yükleniyor...</p>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="custom-class-frame">
                                        <div class="custom-class-section">
                                            <div class="d-flex align-items-center mb-2">
                                                <span class="badge badge-danger mr-2" style="font-size: 11px;">99</span>
                                                <strong class="text-danger">Özel Mal/Hizmet Tanımı</strong>
                                            </div>
                                            <p class="small text-muted mb-2">
                                                <i class="fas fa-info-circle mr-1"></i>
                                                Yukarıdaki sınıflarda yer almayan özel mal/hizmetler için kullanın.
                                            </p>
                                            <div class="input-group">
                                                <textarea class="form-control" id="customClassInput" 
                                                       placeholder="Özel mal/hizmet tanımınızı yazın..."
                                                       maxlength="50000" rows="3" style="resize: vertical;"></textarea>
                                                <div class="input-group-append">
                                                    <button class="btn btn-danger" type="button" id="addCustomClassBtn">
                                                        <i class="fas fa-plus mr-1"></i>99. Sınıfa Ekle
                                                    </button>
                                                </div>
                                            </div>
                                            <small class="form-text text-muted">
                                                <span id="customClassCharCount">0</span> / 50.000 karakter
                                            </small>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-lg-4 d-flex flex-column">
                                    <div class="selected-classes-panel flex-grow-1 d-flex flex-column">
                                        <div class="panel-header d-flex justify-content-between align-items-center">
                                            <h5 class="mb-0">
                                                <i class="fas fa-check-circle mr-2"></i>
                                                Seçilen Mal/Hizmet
                                            </h5>
                                            <span class="badge badge-light" id="selectedClassCount">0</span>
                                        </div>
                                        
                                        <div class="selected-classes-content" id="selectedNiceClasses" 
                                             style="height: 570px; overflow-y: auto; padding: 15px;">
                                            <div class="empty-state">
                                                <i class="fas fa-list-alt fa-3x text-muted mb-3"></i>
                                                <p class="text-muted">
                                                    Henüz hiçbir sınıf seçilmedi.<br>
                                                    Sol panelden sınıf ve alt sınıfları seçin.
                                                </p>
                                            </div>
                                        </div>
                                        <div class="border-top p-3">
                                            <button type="button" class="btn btn-outline-danger btn-sm btn-block"
                                                    onclick="clearAllSelectedClasses()">
                                                <i class="fas fa-trash mr-1"></i>Tümünü Temizle
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane fade" id="applicants" role="tabpanel" aria-labelledby="applicants-tab">
                        <div class="form-section">
                            <h3 class="section-title">Başvuru Sahibi Bilgileri</h3>
                            <p class="text-muted mb-3">İlgili başvuru sahiplerini arayarak ekleyebilir veya yeni bir kişi oluşturabilirsiniz.</p>
                            
                            <div class="form-group full-width">
                                <label for="applicantSearchInput" class="form-label">Başvuru Sahibi Ara</label>
                                <div style="display: flex; gap: 10px;">
                                    <input type="text" id="applicantSearchInput" class="form-input" placeholder="Aramak için en az 2 karakter...">
                                    <button type="button" id="addNewApplicantBtn" class="btn-small btn-add-person"><span>&#x2795;</span> Yeni Kişi</button>
                                </div>
                                <div id="applicantSearchResults" class="search-results-list"></div>
                            </div>

                            <div class="form-group full-width mt-4">
                                <label class="form-label">Seçilen Başvuru Sahipleri</label>
                                <div id="selectedApplicantsList" class="selected-items-list">
                                    <div class="empty-state">
                                        <i class="fas fa-user-plus fa-3x text-muted mb-3"></i>
                                        <p class="text-muted">Henüz başvuru sahibi seçilmedi.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane fade" id="priority" role="tabpanel" aria-labelledby="priority-tab">
                        <div class="form-section">
                            <h3 class="section-title">Rüçhan Bilgileri</h3>
                            <p class="text-muted mb-3">Birden fazla rüçhan hakkı ekleyebilirsiniz.</p>
                            
                            <div class="form-group row">
                                <label for="priorityType" class="col-sm-3 col-form-label">Rüçhan Tipi</label>
                                <div class="col-sm-9">
                                    <select class="form-control" id="priorityType" onchange="window.createTaskModule.handlePriorityTypeChange(this.value)">
                                        <option value="başvuru" selected>Başvuru</option>
                                        <option value="sergi">Sergi</option>
                                    </select>
                                </div>
                            </div>

                            <div class="form-group row">
                                <label for="priorityDate" class="col-sm-3 col-form-label" id="priorityDateLabel">Rüçhan Tarihi</label>
                                <div class="col-sm-9">
                                    <input type="date" class="form-control" id="priorityDate">
                                </div>
                            </div>
                            <div class="form-group row">
                                <label for="priorityCountry" class="col-sm-3 col-form-label">Rüçhan Ülkesi</label>
                                <div class="col-sm-9">
                                    <select class="form-control" id="priorityCountry">
                                        <option value="">Seçiniz...</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-group row">
                                <label for="priorityNumber" class="col-sm-3 col-form-label">Rüçhan Numarası</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control" id="priorityNumber" placeholder="Örn: 2023/12345">
                                </div>
                            </div>
                            
                            <div class="form-group full-width text-right mt-3">
                                <button type="button" id="addPriorityBtn" class="btn btn-secondary">
                                    <i class="fas fa-plus mr-1"></i> Rüçhan Ekle
                                </button>
                            </div>
                            
                            <hr class="my-4">
                            
                            <div class="form-group full-width">
                                <label class="form-label">Eklenen Rüçhan Hakları</label>
                                <div id="addedPrioritiesList" class="selected-items-list">
                                    <div class="empty-state">
                                        <i class="fas fa-info-circle fa-3x text-muted mb-3"></i>
                                        <p class="text-muted">Henüz rüçhan bilgisi eklenmedi.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane fade" id="accrual" role="tabpanel" aria-labelledby="accrual-tab">
                        <div class="form-section">
                            <h3 class="section-title">Tahakkuk Bilgileri</h3>
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="officialFee" class="form-label">Resmi Ücret</label>
                                    <div class="input-with-currency">
                                        <input type="number" id="officialFee" class="form-input" placeholder="0.00" step="0.01">
                                        <select id="officialFeeCurrency" class="currency-select">
                                            <option value="TRY" selected>TL</option>
                                            <option value="EUR">EUR</option>
                                            <option value="USD">USD</option>
                                            <option value="CHF">CHF</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label for="serviceFee" class="form-label">Hizmet Bedeli</label>
                                    <div class="input-with-currency">
                                        <input type="number" id="serviceFee" class="form-input" placeholder="0.00" step="0.01">
                                        <select id="serviceFeeCurrency" class="currency-select">
                                            <option value="TRY" selected>TL</option>
                                            <option value="EUR">EUR</option>
                                            <option value="USD">USD</option>
                                            <option value="CHF">CHF</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label for="vatRate" class="form-label">KDV Oranı (%)</label>
                                    <input type="number" id="vatRate" class="form-input" value="20">
                                </div>
                                <div class="form-group">
                                    <label for="totalAmountDisplay" class="form-label">Toplam Tutar</label>
                                    <div id="totalAmountDisplay" class="total-amount-display">0.00 TRY</div>
                                </div>
                                <div class="form-group full-width">
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="applyVatToOfficialFee" checked>
                                        Resmi Ücrete KDV Uygula
                                    </label>
                                </div>
                                <div class="form-group full-width">
                                    <label for="tpInvoicePartySearch" class="form-label">Türk Patent Faturası Tarafı</label>
                                    <input type="text" id="tpInvoicePartySearch" class="form-input" placeholder="Fatura tarafı arayın...">
                                    <div id="tpInvoicePartyResults" class="search-results-list"></div>
                                    <div id="selectedTpInvoicePartyDisplay" class="search-result-display" style="display:none;"></div>
                                </div>
                                <div class="form-group full-width">
                                    <label for="serviceInvoicePartySearch" class="form-label">Hizmet Faturası Tarafı</label>
                                    <input type="text" id="serviceInvoicePartySearch" class="form-input" placeholder="Fatura tarafı arayın...">
                                    <div id="serviceInvoicePartyResults" class="search-results-list"></div>
                                    <div id="selectedServiceInvoicePartyDisplay" class="search-result-display" style="display:none;"></div>
                                </div>
                            </div>
                        </div>
                        <div class="form-section">
                            <h3 class="section-title">İş Detayları ve Atama</h3>
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="taskPriority" class="form-label">Öncelik</label>
                                    <select id="taskPriority" class="form-select">
                                        <option value="medium">Orta</option>
                                        <option value="high">Yüksek</option>
                                        <option value="low">Düşük</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="assignedTo" class="form-label">Atanacak Kullanıcı</label>
                                    <select id="assignedTo" class="form-select">
                                        <option value="">Seçiniz...</option>
                                    </select>
                                </div>
                                <div class="form-group full-width">
                                    <label for="taskDueDate" class="form-label">Operasyonel Son Tarih</label>
                                    <input type="date" id="taskDueDate" class="form-input">
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane fade" id="summary" role="tabpanel" aria-labelledby="summary-tab">
                        <div id="summaryContent" class="form-section">
                            <div class="empty-state">
                                <i class="fas fa-search-plus fa-3x text-muted mb-3"></i>
                                <p class="text-muted">Özet bilgileri yükleniyor...</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="formActionsContainer" class="form-actions"></div>
    `;
        this.setupDynamicFormListeners();
        this.setupBrandExampleUploader();
        this.updateButtonsAndTabs();
        this.populateCountriesDropdown();
    }
    renderSummaryTab() {
        const container = document.getElementById('summaryContent');
        if (!container) return;
    
        let html = '';
        
        // Marka görseli
        const brandImage = document.getElementById('brandExamplePreview')?.src;
        if (brandImage && brandImage !== window.location.href + '#') {
            html += `<h4 class="section-title">Marka Örneği</h4>
                     <div class="summary-card text-center mb-4">
                        <img src="${brandImage}" alt="Marka Örneği" style="max-width:200px; border:1px solid #ddd; border-radius:8px;">
                     </div>`;
        }

        // 1. Marka Bilgileri
        html += `<h4 class="section-title">Marka Bilgileri</h4>`;
        html += `<div class="summary-card">
            <div class="summary-item">
                <span class="summary-label">Marka Tipi:</span>
                <span class="summary-value">${document.getElementById('brandType')?.value || '-'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Marka Türü:</span>
                <span class="summary-value">${document.getElementById('brandCategory')?.value || '-'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Yazılı İfadesi:</span>
                <span class="summary-value">${document.getElementById('brandExampleText')?.value || '-'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Latin Alfabesi Dışı Harf:</span>
                <span class="summary-value">${document.getElementById('nonLatinAlphabet')?.value || '-'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Önyazı Talebi:</span>
                <span class="summary-value">${document.querySelector('input[name="coverLetterRequest"]:checked')?.value || '-'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Muvafakat Talebi:</span>
                <span class="summary-value">${document.querySelector('input[name="consentRequest"]:checked')?.value || '-'}</span>
            </div>
        </div>`;
    
        // 2. Mal ve Hizmet Sınıfları
        const goodsAndServices = getSelectedNiceClasses();
        html += `<h4 class="section-title mt-4">Mal ve Hizmet Sınıfları</h4>`;
        if (goodsAndServices.length > 0) {
            html += `<div class="summary-card">
                <ul class="summary-list">`;
            goodsAndServices.forEach(item => {
                html += `<li>${item}</li>`;
            });
            html += `</ul></div>`;
        } else {
            html += `<p class="text-muted">Mal ve hizmet sınıfı seçilmedi.</p>`;
        }
    
        // 3. Başvuru Sahipleri
        html += `<h4 class="section-title mt-4">Başvuru Sahipleri</h4>`;
        if (this.selectedApplicants.length > 0) {
            html += `<div class="summary-card">
                <ul class="summary-list">`;
            this.selectedApplicants.forEach(applicant => {
                html += `<li>${applicant.name} (${applicant.email || '-'})</li>`;
            });
            html += `</ul></div>`;
        } else {
            html += `<p class="text-muted">Başvuru sahibi seçilmedi.</p>`;
        }
    
        // 4. Rüçhan Bilgileri
        html += `<h4 class="section-title mt-4">Rüçhan Bilgileri</h4>`;
        if (this.priorities.length > 0) {
            html += `<div class="summary-card">
                <ul class="summary-list">`;
            this.priorities.forEach(priority => {
                html += `<li><b>Tip:</b> ${priority.type === 'sergi' ? 'Sergi' : 'Başvuru'} | <b>Tarih:</b> ${priority.date} | <b>Ülke:</b> ${priority.country} | <b>Numara:</b> ${priority.number}</li>`;
            });
            html += `</ul></div>`;
        } else {
            html += `<p class="text-muted">Rüçhan bilgisi eklenmedi.</p>`;
        }
    
        // 5. Tahakkuk ve Diğer Bilgiler
        const assignedToUser = this.allUsers.find(u => u.id === document.getElementById('assignedTo')?.value);
        html += `<h4 class="section-title mt-4">Tahakkuk ve Diğer Bilgiler</h4>`;
        html += `<div class="summary-card">
            <div class="summary-item">
                <span class="summary-label">Resmi Ücret:</span>
                <span class="summary-value">${document.getElementById('officialFee')?.value || '0.00'} ${document.getElementById('officialFeeCurrency')?.value || 'TRY'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Hizmet Bedeli:</span>
                <span class="summary-value">${document.getElementById('serviceFee')?.value || '0.00'} ${document.getElementById('serviceFeeCurrency')?.value || 'TRY'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">KDV Oranı (%):</span>
                <span class="summary-value">${document.getElementById('vatRate')?.value || '0'}%</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Toplam Tutar:</span>
                <span class="summary-value">${document.getElementById('totalAmountDisplay')?.textContent || '-'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Atanan Kullanıcı:</span>
                <span class="summary-value">${assignedToUser?.displayName || assignedToUser?.email || '-'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Son Tarih:</span>
                <span class="summary-value">${document.getElementById('taskDueDate')?.value || '-'}</span>
            </div>
        </div>`;
    
        container.innerHTML = html;
    }
    setupDynamicFormListeners() {
        const brandExampleInput = document.getElementById('brandExample');
        if (brandExampleInput) {
            brandExampleInput.addEventListener('change', (e) => this.handleBrandExampleFile(e.target.files));
        }
        const dropZone = document.getElementById('dropZone');
        if (dropZone) {
            ['dragover', 'dragleave', 'drop'].forEach(event => {
                dropZone.addEventListener(event, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }, false);
            });
            dropZone.addEventListener('dragover', () => {
                dropZone.classList.add('bg-light');
            });
            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('bg-light');
            });
            dropZone.addEventListener('drop', (e) => {
                dropZone.classList.remove('bg-light');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    this.handleBrandExampleFile(files);
                }
            });
        }
        const tpInvoicePartySearch = document.getElementById('tpInvoicePartySearch');
        if (tpInvoicePartySearch) tpInvoicePartySearch.addEventListener('input', (e) => this.searchPersons(e.target.value, 'tpInvoiceParty'));
        const serviceInvoicePartySearch = document.getElementById('serviceInvoicePartySearch');
        if (serviceInvoicePartySearch) serviceInvoicePartySearch.addEventListener('input', (e) => this.searchPersons(e.target.value, 'serviceInvoiceParty'));
        const addNewPersonBtn = document.getElementById('addNewPersonBtn');
        if (addNewPersonBtn) addNewPersonBtn.addEventListener('click', () => { openPersonModal((newPerson) => { this.allPersons = this.allPersons || []; this.allPersons.push(newPerson); if (typeof this.selectPerson === 'function') this.selectPerson(newPerson, 'relatedParty'); }); });

        
        // — İlgili taraf çoklu arama —
        const relatedPartySearch  = document.getElementById('personSearchInput');
        const relatedPartyResults = document.getElementById('personSearchResults');
        let rpTimer;
        if (relatedPartySearch) {
            relatedPartySearch.addEventListener('input', (e) => {
                const q = e.target.value.trim();
                clearTimeout(rpTimer);
                if (q.length < 2) {
                    if (relatedPartyResults) { relatedPartyResults.innerHTML = ''; relatedPartyResults.style.display = 'none'; }
                    return;
                }
                rpTimer = setTimeout(() => {
                    const results = this.allPersons.filter(p => (p.name || '').toLowerCase().includes(q.toLowerCase()));
                    if (!relatedPartyResults) return;
                    relatedPartyResults.innerHTML = results.map(p => `
                        <div class="search-result-item d-flex align-items-center" data-id="${p.id}">
                            <span class="clickable-owner"><b>${p.name}</b> <small class="text-muted">${p.email || ''}</small></span>
                        </div>
                    `).join('');
                    relatedPartyResults.style.display = results.length ? 'block' : 'none';
                }, 250);
            });
        }

        if (relatedPartyResults) {
            relatedPartyResults.addEventListener('click', (e) => {
                const item = e.target.closest('.search-result-item');
                if (!item) return;

                const id = item.getAttribute('data-id');
                const person = this.allPersons.find(p => p.id === id);
                if (!person) return;

                // Burada sahibin ekleme işlemi yapılır
                if (!Array.isArray(this.selectedRelatedParties)) this.selectedRelatedParties = [];
                if (!this.selectedRelatedParties.some(p => String(p.id) === String(person.id))) {
                this.selectedRelatedParties.push({
                    id: person.id,
                    name: person.name,
                    email: person.email || '',
                    phone: person.phone || ''
                });
                this.renderSelectedRelatedParties();
                }

                // Arama sonuçlarını kapat
                relatedPartyResults.innerHTML = '';
                relatedPartyResults.style.display = 'none';
                relatedPartySearch.value = '';
            });
        }
        const applicantSearchInput = document.getElementById('applicantSearchInput');
        if (applicantSearchInput) applicantSearchInput.addEventListener('input', (e) => this.searchPersons(e.target.value, 'applicant'));
        const addNewApplicantBtn = document.getElementById('addNewApplicantBtn');
        if (addNewApplicantBtn) addNewApplicantBtn.addEventListener('click', () => { openPersonModal((newPerson) => { this.allPersons = this.allPersons || []; this.allPersons.push(newPerson); if (typeof this.addApplicant === 'function') this.addApplicant(newPerson); }); });

        const selectedApplicantsList = document.getElementById('selectedApplicantsList');
        if (selectedApplicantsList) {
            selectedApplicantsList.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.remove-selected-item-btn');
                if (removeBtn) {
                    const personId = removeBtn.dataset.id;
                    this.removeApplicant(personId);
                }
            });
        }

        const relatedPartyList = document.getElementById('relatedPartyList');
        if (relatedPartyList) {
        relatedPartyList.addEventListener('click', (e) => {
            const btn = e.target.closest('.remove-selected-item-btn');
            if (!btn) return;
            const id = btn.dataset.id;
            this.removeRelatedParty(id);
        });
        }
        
        const priorityTypeSelect = document.getElementById('priorityType');
        if (priorityTypeSelect) {
            priorityTypeSelect.addEventListener('change', (e) => this.handlePriorityTypeChange(e.target.value));
        }

        const addPriorityBtn = document.getElementById('addPriorityBtn');
        if (addPriorityBtn) addPriorityBtn.addEventListener('click', () => this.addPriority());

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

        ['officialFee', 'serviceFee', 'vatRate', 'applyVatToOfficialFee'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.calculateTotalAmount());
        });
    }
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

        document.getElementById('priorityDate').value = '';
        document.getElementById('priorityCountry').value = '';
        document.getElementById('priorityNumber').value = '';
    }
    removePriority(priorityId) {
        this.priorities = this.priorities.filter(p => p.id !== priorityId);
        this.renderPriorities();
    }
    renderPriorities() {
        const container = document.getElementById('addedPrioritiesList');
        if (!container) return;

        if (this.priorities.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-info-circle fa-3x text-muted mb-3"></i>
                    <p class="text-muted">Henüz rüçhan bilgisi eklenmedi.</p>
                </div>`;
            return;
        }

        let html = '';
        this.priorities.forEach(priority => {
            html += `
                <div class="selected-item d-flex justify-content-between align-items-center p-2 mb-2 border rounded">
                    <span>
                        <b>Tip:</b> ${priority.type === 'sergi' ? 'Sergi' : 'Başvuru'} | 
                        <b>Tarih:</b> ${priority.date} | 
                        <b>Ülke:</b> ${priority.country} | 
                        <b>Numara:</b> ${priority.number}
                    </span>
                    <button type="button" class="btn btn-sm btn-danger remove-priority-btn" data-id="${priority.id}">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            `;
        });
        container.innerHTML = html;
    }
    async handleBrandExampleFile(file) {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            this.uploadedFiles = [];
            const previewContainer = document.getElementById('brandExamplePreviewContainer');
            if (previewContainer) previewContainer.style.display = 'none';
            
            if (file && file.type && !file.type.startsWith('image/')) {
                alert('Lütfen geçerli bir resim dosyası seçin (PNG, JPG, JPEG)');
            }
            return;
        }
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 591;
            canvas.height = 591;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 591, 591);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
            const newFile = new File([blob], 'brand-example.jpg', {
                type: 'image/jpeg'
            });
            const previewImage = document.getElementById('brandExamplePreview');
            const previewContainer = document.getElementById('brandExamplePreviewContainer');
            if (previewImage && previewContainer) {
                previewImage.src = URL.createObjectURL(blob);
                previewContainer.style.display = 'block';
            }
            this.uploadedFiles = [newFile];
        };
    }
    calculateTotalAmount() {
        const officialFeeInput = document.getElementById('officialFee');
        const serviceFeeInput = document.getElementById('serviceFee');
        const vatRateInput = document.getElementById('vatRate');
        const applyVatCheckbox = document.getElementById('applyVatToOfficialFee');
        const totalAmountDisplay = document.getElementById('totalAmountDisplay');
        if (!officialFeeInput || !serviceFeeInput || !vatRateInput || !applyVatCheckbox || !totalAmountDisplay) {
            return;
        }
        const officialFee = parseFloat(officialFeeInput.value) || 0;
        const serviceFee = parseFloat(serviceFeeInput.value) || 0;
        const vatRate = parseFloat(vatRateInput.value) || 0;
        const applyVatToOfficial = applyVatCheckbox.checked;
        let total;
        if (applyVatToOfficial) {
            total = (officialFee + serviceFee) * (1 + vatRate / 100);
        } else {
            total = officialFee + (serviceFee * (1 + vatRate / 100));
        }
        totalAmountDisplay.textContent = new Intl.NumberFormat('tr-TR', {
            style: 'currency',
            currency: 'TRY'
        }).format(total);
    }
    resetSelections() {
        this.selectedIpRecord = null;
        this.selectedRelatedParty = null;
        this.selectedTpInvoiceParty = null;
        this.selectedServiceInvoiceParty = null;
        this.uploadedFiles = [];
        this.selectedApplicants = [];
        this.priorities = [];
    }
    searchPortfolio(query) {
        const container = document.getElementById('portfolioSearchResults');
        if (!container) return;
        container.innerHTML = '';
        if (query.length < 3) {
            container.innerHTML = '<p class="no-results-message">Aramak için en az 3 karakter girin.</p>';
            return;
        }
        const mainIpType = document.getElementById('mainIpType').value;
        const searchLower = query.toLowerCase();
        const filtered = this.allIpRecords.filter(r => {
            const rTypeLower = r.type ? r.type.toLowerCase() : '';
            const mainIpTypeLower = mainIpType ? mainIpType.toLowerCase() : '';
            if (mainIpTypeLower === 'litigation') {
                const rTitleLower = r.title ? r.title.toLowerCase() : '';
                const rAppNumberLower = r.applicationNumber ? r.applicationNumber.toLowerCase() : '';
                return rTitleLower.includes(searchLower) || rAppNumberLower.includes(searchLower);
            }
            if (rTypeLower !== mainIpTypeLower) return false;
            const rTitleLower = r.title ? r.title.toLowerCase() : '';
            const rAppNumberLower = r.applicationNumber ? r.applicationNumber.toLowerCase() : '';
            return rTitleLower.includes(searchLower) || rAppNumberLower.includes(searchLower);
        });
        if (filtered.length === 0) {
            container.innerHTML = '<p class="no-results-message">Kayıt bulunamadı.</p>';
            return;
        }
        filtered.forEach(r => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.dataset.id = r.id;
            item.innerHTML = `<div><b>${r.title}</b> (${r.applicationNumber || 'Numara Yok'})<br><small>Durum: ${r.status}</small></div>`;
            item.addEventListener('click', () => this.selectIpRecord(r.id));
            container.appendChild(item);
        });
    }
    selectIpRecord(recordId) {
        this.selectedIpRecord = this.allIpRecords.find(r => r.id === recordId);
        const display = document.getElementById('selectedIpRecordDisplay');
        if (display) {
            display.innerHTML = `<p><b>Seçilen Varlık:</b> ${this.selectedIpRecord.title}</p>`;
            display.style.display = 'flex';
        }
        const searchResults = document.getElementById('portfolioSearchResults');
        if (searchResults) searchResults.innerHTML = '';
        this.checkFormCompleteness();
        this.handleIpRecordChange(recordId);
    }
searchPersons(query, target) {
    const resultsContainerId = {
        'relatedParty': 'personSearchResults',
        'tpInvoiceParty': 'tpInvoicePartyResults',
        'serviceInvoiceParty': 'serviceInvoicePartyResults',
        'applicant': 'applicantSearchResults'
    }[target];

    const container = document.getElementById(resultsContainerId);
    if (!container) return;

    container.innerHTML = '';
    
    if (!query || query.length < 2) {
        container.innerHTML = '<p class="no-results-message">Aramak için en az 2 karakter girin.</p>';
        container.style.display = 'none'; // Yeterli karakter yoksa gizle
        return;
    }

    // 🔹 Sadece name alanında arama yapıyoruz
    const nq = query.toLowerCase();
    const filtered = (this.allPersons || []).filter(p =>
        (p.name || '').toLowerCase().includes(nq)
    );

    if (filtered.length === 0) {
        container.innerHTML = '<p class="no-results-message">Sonuç bulunamadı.</p>';
        container.style.display = 'block'; // Sonuç bulunamadı mesajını göster
        return;
    }

    // Sonuçları listele
    let html = '<ul class="list-group">';
    filtered.slice(0, 50).forEach(p => {
        const disp = p.name || '(İsimsiz)';
        html += `
        <li class="list-group-item d-flex justify-content-between align-items-center">
            <div><b>${disp}</b></div>
            <button type="button" class="btn btn-sm btn-primary" data-person-id="${p.id}" data-role="${target}">
            Seç
            </button>
        </li>`;
    });
    html += '</ul>';
    container.innerHTML = html;
    
    // ✅ ÖNEMLİ: Sonuçları göster!
    container.style.display = 'block';

    // Seç butonları
    container.querySelectorAll('button[data-person-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const pid = btn.getAttribute('data-person-id');
            const role = btn.getAttribute('data-role');
            const person = (this.allPersons || []).find(x => String(x.id) === String(pid));
            if (!person) return;

            if (role === 'applicant') this.addApplicant(person);
            else if (typeof this.selectPerson === 'function') this.selectPerson(person, role);

            container.innerHTML = '';
            container.style.display = 'none'; // Seçim sonrası gizle
            
            const inputId = {
                'relatedParty': 'personSearchInput',
                'tpInvoiceParty': 'tpInvoicePartySearch',
                'serviceInvoiceParty': 'serviceInvoicePartySearch',
                'applicant': 'applicantSearchInput'
            }[role];
            const input = document.getElementById(inputId);
            if (input) input.value = '';
            this.checkFormCompleteness();
        });
    });
}

    selectPerson(person, target) {
        const displayId = {
            'relatedParty': 'selectedRelatedPartyDisplay',
            'tpInvoiceParty': 'selectedTpInvoicePartyDisplay',
            'serviceInvoiceParty': 'selectedServiceInvoicePartyDisplay',
            'applicant': 'selectedApplicantsList'
        } [target];
        const inputId = {
            'relatedParty': 'personSearchInput',
            'tpInvoiceParty': 'tpInvoicePartySearch',
            'serviceInvoiceParty': 'serviceInvoicePartySearch',
            'applicant': 'applicantSearchInput'
        } [target];
        const resultsId = {
            'relatedParty': 'personSearchResults',
            'tpInvoiceParty': 'tpInvoicePartyResults',
            'serviceInvoiceParty': 'serviceInvoicePartyResults',
            'applicant': 'applicantSearchResults'
        } [target];

        if (target === 'relatedParty') {
        if (!Array.isArray(this.selectedRelatedParties)) this.selectedRelatedParties = [];
        if (!this.selectedRelatedParties.some(p => String(p.id) === String(person.id))) {
            this.selectedRelatedParties.push({ id: person.id, name: person.name, email: person.email || '', phone: person.phone || '' });
            this.renderSelectedRelatedParties();
        }
        }
        else if (target === 'tpInvoiceParty') this.selectedTpInvoiceParty = person;
        else if (target === 'serviceInvoiceParty') this.selectedServiceInvoiceParty = person;
        else if (target === 'applicant') {
            this.addApplicant(person);
        }

        const display = document.getElementById(displayId);
        if (display && target !== 'applicant' && target !== 'relatedParty') {
        display.innerHTML = `<p><b>Seçilen:</b> ${person.name}</p>`;
        display.style.display = 'block';
        }
        const resultsContainer = document.getElementById(resultsId);
        if (resultsContainer) resultsContainer.innerHTML = '';
        const inputField = document.getElementById(inputId);
        if (inputField) inputField.value = '';
        this.checkFormCompleteness();
    }
    
    addApplicant(person) {
        if (this.selectedApplicants.some(p => p.id === person.id)) {
            alert('Bu başvuru sahibi zaten eklenmiş.');
            return;
        }
        this.selectedApplicants.push(person);
        this.renderSelectedApplicants();
    }

    removeApplicant(personId) {
        this.selectedApplicants = this.selectedApplicants.filter(p => p.id !== personId);
        this.renderSelectedApplicants();
    }

    renderSelectedApplicants() {
        const container = document.getElementById('selectedApplicantsList');
        if (!container) return;

        if (this.selectedApplicants.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-user-plus fa-3x text-muted mb-3"></i>
                    <p class="text-muted">Henüz başvuru sahibi seçilmedi.</p>
                </div>`;
            return;
        }

        let html = '';
        this.selectedApplicants.forEach(person => {
            html += `
                <div class="selected-item d-flex justify-content-between align-items-center p-2 mb-2 border rounded">
                    <span>${person.name} (${person.email || 'E-posta Yok'})</span>
                    <button type="button" class="btn btn-sm btn-danger remove-selected-item-btn" data-id="${person.id}">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            `;
        });
        container.innerHTML = html;
    }

    renderSelectedRelatedParties() {
        const list = document.getElementById('relatedPartyList');
        const countEl = document.getElementById('relatedPartyCount');
        if (!list) return;
        const arr = Array.isArray(this.selectedRelatedParties) ? this.selectedRelatedParties : [];

        if (!arr.length) {
            list.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-user-friends fa-3x text-muted mb-3"></i>
                <p class="text-muted">Henüz taraf eklenmedi.</p>
            </div>`;
        } else {
            list.innerHTML = arr.map(p => `
            <div class="selected-item d-flex justify-content-between align-items-center p-2 mb-2 border rounded">
                <span>${p.name} <small class="text-muted">${p.email || ''}</small></span>
                <button type="button" class="btn btn-sm btn-danger remove-selected-item-btn" data-id="${p.id}">
                <i class="fas fa-trash-alt"></i>
                </button>
            </div>
            `).join('');
        }
        if (countEl) countEl.textContent = arr.length;
        }

        removeRelatedParty(id) {
        this.selectedRelatedParties = (this.selectedRelatedParties || []).filter(x => String(x.id) !== String(id));
        this.renderSelectedRelatedParties();
        this.checkFormCompleteness();
        }


    hideAddPersonModal() {
        const modal = document.getElementById('addPersonModal');
        if (modal) {
            $(modal).modal('hide');
        }
    }
    showParentSelectionModal(parentTransactions, childTaskTypeId) {
    console.log('🔄 Modal açılıyor...', { parentTransactions, childTaskTypeId });
    
    const modal = document.getElementById('selectParentModal');
    const parentListContainer = document.getElementById('parentListContainer');
    
    if (!modal) {
        console.error('❌ Modal element bulunamadı!');
        return;
    }
    
    if (!parentListContainer) {
        console.error('❌ Parent list container bulunamadı!');
        return;
    }

    // Modal başlığını güncelle
    const modalTitleEl = document.getElementById('selectParentModalLabel');
    if (modalTitleEl) {
        const isDecisionObjection = String(childTaskTypeId) === '8';
        modalTitleEl.textContent = isDecisionObjection ? 
            'Geri Çekilecek Karara İtirazı Seçin' : 
            'Geri Çekilecek Yayına İtirazı Seçin';
    }

    // Liste içeriğini temizle ve yeniden oluştur
    parentListContainer.innerHTML = '';
    
    parentTransactions.forEach((tx, index) => {
        const item = document.createElement('li');
        item.className = 'list-group-item list-group-item-action';
        item.style.cursor = 'pointer';
        
        // İtiraz tipini belirle
        const transactionTypeName = this.getTransactionTypeName(tx.type) || 'Bilinmeyen İtiraz Tipi';
        
        item.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <h6 class="mb-1">${transactionTypeName}</h6>
                    <p class="mb-1">${tx.description || 'Açıklama bulunmuyor'}</p>
                    <small class="text-muted">Oluşturulma: ${new Date(tx.timestamp).toLocaleDateString('tr-TR')}</small>
                </div>
                <i class="fas fa-chevron-right text-muted"></i>
            </div>
        `;
        
        // Click event listener
        item.onclick = () => {
            console.log('📋 İtiraz seçildi:', tx);
            const pid = tx.transactionId || tx.id || tx.docId || tx.uid || tx._id;
            this.handleParentSelection(pid);
        };
        
        parentListContainer.appendChild(item);
    });

    // 🔥 ZORLA MODAL AÇ - Hem jQuery hem vanilla JS
    console.log('🔥 Modal açmaya çalışılıyor...');
    
    // jQuery yöntemi
    if (window.$ && $('#selectParentModal').length > 0) {
        $('#selectParentModal').modal('show');
        console.log('✅ jQuery ile modal açıldı');
    } else {
        // Vanilla JS yöntemi
        modal.style.display = 'block';
        modal.classList.add('show', 'fade');
        modal.setAttribute('aria-hidden', 'false');
        
        // Backdrop ekle
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop fade show';
        backdrop.id = 'tempModalBackdrop';
        document.body.appendChild(backdrop);
        document.body.classList.add('modal-open');
        
        console.log('✅ Vanilla JS ile modal açıldı');
    }
}
    hideParentSelectionModal() {
        const modal = document.getElementById('selectParentModal');
        if (modal) modal.style.display = 'none';
        this.pendingChildTransactionData = null;
    }
async handleParentSelection(selectedParentId) {
    console.log('[handleParentSelection] selectedParentId param =', selectedParentId, ' this.selectedParentTransactionId =', this.selectedParentTransactionId);
    // Modal'ı kapat
    const modal = document.getElementById('selectParentModal');
    if (modal) {
        try {
            if (window.$ && typeof $ === 'function') {
                $(modal).modal('hide');
            } else {
                modal.style.display = 'none';
                modal.classList.remove('show');
                document.body.classList.remove('modal-open');
            }
        } catch (e) {
            console.warn('Modal kapatma sırasında uyarı:', e);
        }
    }
    // Parent ID güvenliği
    const parentId = selectedParentId || this.selectedParentTransactionId;
    if (!parentId) {
        alert('Parent işlem seçilemedi. Lütfen listeden bir itiraz seçin.');
        return;
    }
    // Child type
    const childTypeId = this.pendingChildTransactionData;
    if (!childTypeId) {
        alert('İşlem tipi belirlenemedi. Lütfen iş tipini yeniden seçin.');
        return;
    }
    // Alt işlem objesi
    const childTransactionData = {
        type: String(childTypeId),
        description: 'İtiraz geri çekme işlemi',
        parentId: String(parentId),
        transactionHierarchy: 'child'
    };
    if (!this.selectedIpRecord || !this.selectedIpRecord.id) {
        alert('Portföy kaydı bulunamadı. Lütfen bir portföy seçin.');
        return;
    }
    try {
        const addResult = await ipRecordsService.addTransactionToRecord(this.selectedIpRecord.id, childTransactionData);
        if (addResult && addResult.success) {
            alert('Alt işlem başarıyla kaydedildi.');
        } else {
            alert('Alt işlem kaydedilirken hata oluştu: ' + (addResult && addResult.error ? addResult.error : 'Bilinmeyen hata'));
        }
    } catch (err) {
        console.error('Alt işlem kayıt hatası:', err);
        alert('Alt işlem kaydedilirken hata oluştu.');
    }
}

dedupeActionButtons() {
    const saves = Array.from(document.querySelectorAll('#saveTaskBtn'));
    if (saves.length > 1) saves.slice(0, -1).forEach(b => b.closest('.form-actions')?.remove());

    const cancels = Array.from(document.querySelectorAll('#cancelBtn'));
    if (cancels.length > 1) cancels.slice(0, -1).forEach(b => b.closest('.form-actions')?.remove());
}
async resolveImageUrl(img) {
  if (!img) return '';
  if (typeof img === 'string' && img.startsWith('http')) return img;
  try {
    const storage = getStorage();                 // modular
    const url = await getDownloadURL(ref(storage, img));
    return url;
  } catch {
    return '';
  }
}

async loadBulletinRecordsOnce() {
  if (Array.isArray(this.allBulletinRecords) && this.allBulletinRecords.length) return;

  try {
    const db = getFirestore();
    
    // ✅ DOĞRU: trademarkBulletinRecords koleksiyonunu oku
    const snap = await getDocs(collection(db, 'trademarkBulletinRecords'));
    
    this.allBulletinRecords = snap.docs.map(d => {
      const x = d.data() || {};
      return {
        id: d.id,
        markName: x.markName || '',
        applicationNo: x.applicationNo || x.applicationNumber || '',
        imagePath: x.imagePath || '',
        holders: x.holders || [],
        bulletinId: x.bulletinId || '',
        attorneys: x.attorneys || [],
        // ihtiyacın olan başka alanlar da buraya eklenebilir
      };
    });
    
    console.log('[BULLETIN] yüklendi:', this.allBulletinRecords.length);
  } catch (err) {
    console.error('[BULLETIN] yüklenemedi:', err);
    this.allBulletinRecords = [];
  }
}


checkFormCompleteness() {
    const taskTypeId = document.getElementById('specificTaskType')?.value;
    const selectedTaskType = this.allTransactionTypes.find(type => type.id === taskTypeId);
    
    const saveTaskBtn = document.getElementById('saveTaskBtn');

    if (!selectedTaskType || !saveTaskBtn) {
        if (saveTaskBtn) saveTaskBtn.disabled = true;
        return;
    }

    let isComplete = false;

    if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
        const brandText = document.getElementById('brandExampleText')?.value?.trim();
        const hasNiceClasses = typeof getSelectedNiceClasses === 'function' && getSelectedNiceClasses().length > 0;
        const hasApplicants = this.selectedApplicants && this.selectedApplicants.length > 0;

        const assignedTo = document.getElementById('assignedTo')?.value;
        isComplete = !!(assignedTo && brandText && hasNiceClasses && hasApplicants);
    } else {
        const taskTitle = document.getElementById('taskTitle')?.value?.trim() || selectedTaskType?.alias || selectedTaskType?.name;
        const hasIpRecord = !!this.selectedIpRecord;

        // assignedTo, başlık ve portföy kaydı seçildiğinde tamamlandı olarak işaretle
        const tIdStr = asId(selectedTaskType.id);
        const needsRelatedParty = RELATED_PARTY_REQUIRED.has(tIdStr);
        const needsObjectionOwner = (tIdStr === TASK_IDS.ITIRAZ_YAYIN) || (tIdStr === '19') || (tIdStr === '7');
        const hasRelated = Array.isArray(this.selectedRelatedParties) && this.selectedRelatedParties.length > 0;
        isComplete = !!taskTitle && !!this.selectedIpRecord && (!needsRelatedParty || hasRelated) && (!needsObjectionOwner || hasRelated);
    }

    saveTaskBtn.disabled = !isComplete;
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
isPublicationOpposition(transactionTypeId) {
    // create-portfolio-by-opposition.js ile aynı kontrol mantığı
    const PUBLICATION_OPPOSITION_IDS = [
        'trademark_publication_objection',  // JSON'daki ID
        '20',                               // Sistemdeki numeric ID
        20                                  // Number olarak da olabilir
    ];
    
    return PUBLICATION_OPPOSITION_IDS.includes(transactionTypeId) || 
           PUBLICATION_OPPOSITION_IDS.includes(String(transactionTypeId)) ||
           PUBLICATION_OPPOSITION_IDS.includes(Number(transactionTypeId));
}
// CreateTaskModule sınıfının içinde, herhangi bir yere ekleyebilirsiniz
async getCountries() {
    try {
        const db = getFirestore();
        const docRef = doc(db, 'common', 'countries'); // 'common' koleksiyonu, 'countries' belgesi
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
// CreateTaskModule sınıfının içinde, herhangi bir yere ekleyebilirsiniz
populateCountriesDropdown() {
    const countrySelect = document.getElementById('priorityCountry');
    if (!countrySelect) return;

    countrySelect.innerHTML = '<option value="">Seçiniz...</option>'; // Önce mevcut seçenekleri temizle

    this.allCountries.forEach(country => {
        const option = document.createElement('option');
        option.value = country.code;
        option.textContent = country.name;
        countrySelect.appendChild(option);
    });
}
async handleFormSubmit(e) {
    e.preventDefault();
    const specificTaskTypeId = document.getElementById('specificTaskType')?.value;
    const selectedTransactionType = this.allTransactionTypes.find(type => type.id === specificTaskTypeId);

    if (!selectedTransactionType) {
        alert('Geçerli bir işlem tipi seçmediniz.');
        return;
    }

    const assignedToUser = this.allUsers.find(u => u.id === document.getElementById('assignedTo')?.value);

    let taskTitle, taskDescription;

    if (selectedTransactionType.alias === 'Başvuru' && selectedTransactionType.ipType === 'trademark') {
        taskTitle = document.getElementById('brandExampleText')?.value || selectedTransactionType.alias || selectedTransactionType.name;
        taskDescription = document.getElementById('taskDescription')?.value || `'${document.getElementById('brandExampleText')?.value || 'Yeni Başvuru'}' adlı marka için ${selectedTransactionType.alias || selectedTransactionType.name} işlemi.`;
    } else {
        taskTitle = document.getElementById('taskTitle')?.value || selectedTransactionType.alias || selectedTransactionType.name;
        taskDescription = document.getElementById('taskDescription')?.value || `${selectedTransactionType.alias || selectedTransactionType.name} işlemi.`;
    }

    let taskData = {
        taskType: selectedTransactionType.id,
        title: taskTitle,
        description: taskDescription,
        priority: document.getElementById('taskPriority')?.value || 'medium',
        assignedTo_uid: assignedToUser ? assignedToUser.id : null,
        assignedTo_email: assignedToUser ? assignedToUser.email : null,
        dueDate: document.getElementById('taskDueDate')?.value || null,
        status: 'open',
        relatedIpRecordId: this.selectedIpRecord ? this.selectedIpRecord.id : null,
        relatedIpRecordTitle: this.selectedIpRecord ? this.selectedIpRecord.title : taskTitle,
        details: {}
    };

    // -- İlgili taraf gerektiren işlem tiplerinde taskOwner yaz --
    const txIdStr = String(selectedTransactionType?.id || '');
    if (RELATED_PARTY_REQUIRED.has(txIdStr)) {
    // State'ten seçilen kişi(ler)
    const ownerIds = (Array.isArray(this.selectedRelatedParties) ? this.selectedRelatedParties : [])
        .map(p => String(p.id))
        .filter(Boolean);
    taskData.taskOwner = ownerIds; // ⭐ Tasks koleksiyonunda saklanacak alan
    }

    // --- İtiraz sahibi (opponent) yazımı: IDs 7, 19, 20 ---
    const tIdStr = String(selectedTransactionType?.id || '');
    const objectionTypeIds = new Set(['7', '19', '20']);

    // Birincil kaynak: çoklu ilgili taraf listesinin ilk elemanı
    let opponentCandidate = Array.isArray(this.selectedRelatedParties) && this.selectedRelatedParties.length
    ? this.selectedRelatedParties[0]
    : (this.selectedRelatedParty || null);

    if (objectionTypeIds.has(tIdStr) && opponentCandidate) {
    const opponent = {
        id: opponentCandidate.id || null,
        name: opponentCandidate.name || '',
        email: opponentCandidate.email || '',
        phone: opponentCandidate.phone || ''
    };
    // Kök seviyeye yaz
    taskData.opponent = opponent;

    // İstersen detaylara da ayna yapalım
    taskData.details = taskData.details || {};
    taskData.details.opponent = opponent;
    }

    if (selectedTransactionType.alias === 'Başvuru' && selectedTransactionType.ipType === 'trademark') {
        // 🔧 NICE bağını kur: goodsAndServices aynı kalacak, ayrıca niceClass ve goodsAndServicesByClass üretilecek
        const goodsAndServicesRaw = getSelectedNiceClasses();
        if (!Array.isArray(goodsAndServicesRaw) || goodsAndServicesRaw.length === 0) {
            alert('Lütfen en az bir mal veya hizmet seçin.');
            return;
        }

        // Yardımcılar (blok içi): sınıf numarası çıkarma ve gruplama
        const parseClassNo = (val) => {
            if (val == null) return null;
            if (typeof val === 'number') return Number(val);
            if (typeof val === 'object') {
                const cand = val.classNo ?? val.class ?? val.classNumber ?? val.niceClass ?? val.k ?? null;
                if (cand != null) return Number(cand);
                val = val.text ?? val.name ?? val.label ?? '';
            }
            const s = String(val);
            const m = s.match(/(?:^|\b)([1-9]|[12]\d|3\d|4[0-5])(?:\b|[^\d])/);
            return m ? Number(m[1]) : null;
        };

        const deriveNiceClasses = (gas) => {
            const set = new Set();
            const visit = (v) => {
                if (v == null) return;
                if (Array.isArray(v)) { v.forEach(visit); return; }
                if (typeof v === 'object') {
                    const cls = parseClassNo(v); if (cls != null) set.add(cls);
                    if (Array.isArray(v.items)) v.items.forEach(visit);
                    return;
                }
                const cls = parseClassNo(v); if (cls != null) set.add(cls);
            };
            visit(gas);
            return Array.from(set).sort((a,b)=>a-b);
        };

        const groupGoodsByClass = (gas) => {
            const groups = new Map();
            const add = (cls, text) => {
                if (cls == null) return;
                const key = Number(cls);
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(String(text ?? '').trim());
            };
            const visit = (v, currentClass=null) => {
                if (v == null) return;
                if (Array.isArray(v)) { v.forEach(e => visit(e, currentClass)); return; }
                if (typeof v === 'object') {
                    const cls = parseClassNo(v) ?? currentClass;
                    const maybeText = v.text ?? v.name ?? v.label ?? null;
                    if (maybeText) add(cls, maybeText);
                    if (Array.isArray(v.items)) {
                        v.items.forEach(it => {
                            if (typeof it === 'object') {
                                const t = it.text ?? it.name ?? it.label ?? JSON.stringify(it);
                                const itCls = parseClassNo(it) ?? cls;
                                add(itCls, t);
                            } else {
                                const itCls = parseClassNo(it) ?? cls;
                                add(itCls, it);
                            }
                        });
                    }
                    return;
                }
                const cls = parseClassNo(v) ?? currentClass;
                add(cls, v);
            };
            visit(gas);
            return Array.from(groups.entries())
                .sort((a,b)=>a[0]-b[0])
                .map(([classNo, items]) => ({ classNo, items }));
        };

        const niceClass = deriveNiceClasses(goodsAndServicesRaw);
        const goodsAndServicesByClass = groupGoodsByClass(goodsAndServicesRaw);

        if (this.selectedApplicants.length === 0) {
            alert('Lütfen en az bir başvuru sahibi seçin.');
            return;
        }

        let brandImageUrl = null;
        const brandExampleFile = this.uploadedFiles[0];
        if (brandExampleFile) {
            const storagePath = `brand-examples/${Date.now()}_${brandExampleFile.name}`;
            brandImageUrl = await this.uploadFileToStorage(brandExampleFile, storagePath);
            if (!brandImageUrl) {
                alert('Marka görseli yüklenirken bir hata oluştu.');
                return;
            }
        }

        const newIpRecordData = {
        title: taskData.title,
        type: selectedTransactionType.ipType,
        portfoyStatus: 'active',
        status: 'filed',
        recordOwnerType: 'self',
        applicationNumber: null,
        applicationDate: new Date().toISOString().split('T')[0],
        registrationNumber: null,
        registrationDate: null,
        renewalDate: null,
        brandText: document.getElementById('brandExampleText')?.value || null,
        brandImageUrl: brandImageUrl,
        description: null,
        applicants: this.selectedApplicants.map(p => ({ id: p.id, name: p.name, email: p.email || null })),
        priorities: this.priorities.length > 0 ? this.priorities : [],
        
        // Ana seviyeye taşınan alanlar
        brandType: document.getElementById('brandType')?.value || null,
        brandCategory: document.getElementById('brandCategory')?.value || null,
        nonLatinAlphabet: document.getElementById('nonLatinAlphabet')?.value || null,
        coverLetterRequest: document.querySelector('input[name="coverLetterRequest"]:checked')?.value || null,
        consentRequest: document.querySelector('input[name="consentRequest"]:checked')?.value || null,
        goodsAndServicesByClass: goodsAndServicesByClass,
        
        // `goodsAndServices` alanını tamamen kaldırıyoruz
        // `details` alanını tamamen kaldırıyoruz
        
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
        const newRecordResult = await ipRecordsService.createRecord(newIpRecordData);
        if (!newRecordResult.success) {
            alert('IP kaydı oluşturulurken hata oluştu: ' + newRecordResult.error);
            return;
        }

        taskData.relatedIpRecordId = newRecordResult.id;
        taskData.relatedIpRecordTitle = newIpRecordData.title;
   
        // Çoklu ilgili tarafları ekle
        try {
            const tIdStr = asId(selectedTransactionType.id);
            if (Array.isArray(this.selectedRelatedParties) && this.selectedRelatedParties.length) {
                taskData.details = taskData.details || {};
                taskData.details.relatedParties = this.selectedRelatedParties.map(p => ({
                    id: p.id,
                    name: p.name,
                    email: p.email || '',
                    phone: p.phone || ''
                }));
                if (!taskData.details.relatedParty) {
                    const p0 = this.selectedRelatedParties[0];
                    taskData.details.relatedParty = { 
                        id: p0.id, 
                        name: p0.name, 
                        email: p0.email || '', 
                        phone: p0.phone || '' 
                    };
                }
            }
            if ((tIdStr === TASK_IDS.YAYIMA_ITIRAZIN_YENIDEN_INCELENMESI || tIdStr === TASK_IDS.ITIRAZ_YAYIN) && taskData.details?.relatedParties) {
                taskData.details.objectionOwners = [...taskData.details.relatedParties];
            }
        } catch (e) { 
            console.warn('relatedParties ekleme hatası:', e); 
        }
        const taskResult = await taskService.createTask(taskData);
        if (!taskResult.success) {
            alert('İş oluşturulurken hata oluştu: ' + taskResult.error);
            return;
        }

        const officialFee = parseFloat(document.getElementById('officialFee')?.value) || 0;
        const serviceFee = parseFloat(document.getElementById('serviceFee')?.value) || 0;

        if (officialFee > 0 || serviceFee > 0) {
            const vatRate = parseFloat(document.getElementById('vatRate')?.value) || 0;
            const applyVatToOfficial = document.getElementById('applyVatToOfficialFee')?.checked;
            let totalAmount = applyVatToOfficial ?
                (officialFee + serviceFee) * (1 + vatRate / 100) :
                officialFee + (serviceFee * (1 + vatRate / 100));

            const accrualData = {
                taskId: taskResult.id,
                taskTitle: taskData.title,
                officialFee: { amount: officialFee, currency: 'TRY' },
                serviceFee: { amount: serviceFee, currency: 'TRY' },
                vatRate,
                applyVatToOfficialFee: applyVatToOfficial,
                totalAmount,
                totalAmountCurrency: 'TRY',
                tpInvoiceParty: this.selectedTpInvoiceParty ? {
                    id: this.selectedTpInvoiceParty.id,
                    name: this.selectedTpInvoiceParty.name
                } : null,
                serviceInvoiceParty: this.selectedServiceInvoiceParty ? {
                    id: this.selectedServiceInvoiceParty.id,
                    name: this.selectedServiceInvoiceParty.name
                } : null,
                status: 'unpaid',
                createdAt: new Date().toISOString()
            };

            const accrualResult = await accrualService.addAccrual(accrualData);
            if (!accrualResult.success) {
                alert('İş oluşturuldu ancak tahakkuk kaydedilirken bir hata oluştu: ' + accrualResult.error);
                return;
            }
        }

        const transactionData = {
            type: selectedTransactionType.id,
            description: `${selectedTransactionType.name} işlemi.`,
            parentId: null,
            transactionHierarchy: "parent"
        };
        const addTransactionResult = await ipRecordsService.addTransactionToRecord(newRecordResult.id, transactionData);
        if (!addTransactionResult.success) {
            console.error("Yeni IP kaydına işlem eklenirken hata oluştu:", addTransactionResult.error);
        }

        alert('İş ve ilgili kayıt başarıyla oluşturuldu!');
        window.location.href = 'task-management.html';
    } else {
        // ✅ NORMAL İŞLER İÇİN MANTIK
        
        if (!this.selectedIpRecord) {
            alert('Lütfen işleme konu olacak bir portföy kaydı seçin.');
            return;
        }

        const taskResult = await taskService.createTask(taskData);
        if (!taskResult.success) {
            alert('İş oluşturulurken hata oluştu: ' + taskResult.error);
            return;
        }

        // Tahakkuk işlemleri
        const officialFee = parseFloat(document.getElementById('officialFee')?.value) || 0;
        const serviceFee = parseFloat(document.getElementById('serviceFee')?.value) || 0;

        if (officialFee > 0 || serviceFee > 0) {
            const vatRate = parseFloat(document.getElementById('vatRate')?.value) || 0;
            const applyVatToOfficial = document.getElementById('applyVatToOfficialFee')?.checked;
            let totalAmount = applyVatToOfficial ?
                (officialFee + serviceFee) * (1 + vatRate / 100) :
                officialFee + (serviceFee * (1 + vatRate / 100));

            const accrualData = {
                taskId: taskResult.id,
                taskTitle: taskData.title,
                officialFee: { amount: officialFee, currency: 'TRY' },
                serviceFee: { amount: serviceFee, currency: 'TRY' },
                vatRate,
                applyVatToOfficialFee: applyVatToOfficial,
                totalAmount,
                totalAmountCurrency: 'TRY',
                tpInvoiceParty: this.selectedTpInvoiceParty ? {
                    id: this.selectedTpInvoiceParty.id,
                    name: this.selectedTpInvoiceParty.name
                } : null,
                serviceInvoiceParty: this.selectedServiceInvoiceParty ? {
                    id: this.selectedServiceInvoiceParty.id,
                    name: this.selectedServiceInvoiceParty.name
                } : null,
                status: 'unpaid',
                createdAt: new Date().toISOString()
            };

            const accrualResult = await accrualService.addAccrual(accrualData);
            if (!accrualResult.success) {
                console.warn('Tahakkuk oluşturulamadı:', accrualResult.error);
            }
        }

        // ✅ ÇÖZÜM: Yayına itiraz işleri için portföye işlem eklemeyi atla
        const isPublicationOpposition = this.isPublicationOpposition(selectedTransactionType.id);
        
        if (!isPublicationOpposition) {
            // Normal işler için portföye işlem ekle
            const transactionData = {
                type: selectedTransactionType.id,
                description: `${selectedTransactionType.name} işlemi.`,
                parentId: null,
                transactionHierarchy: "parent"
            };

            const addResult = await ipRecordsService.addTransactionToRecord(this.selectedIpRecord.id, transactionData);
            if (!addResult.success) {
                alert('İş oluşturuldu ama işlem kaydedilemedi: ' + addResult.error);
                return;
            }
        } else {
            console.log('🔄 Yayına itiraz işi: Portföye işlem ekleme atlandı, otomatik 3.taraf portföy oluşturulacak');
        }

        // ✅ Yayına itiraz işleri için otomatik 3.taraf portföy oluşturma
        if (window.portfolioByOppositionCreator) {
        try {
            const oppositionResult = await window.portfolioByOppositionCreator.handleTransactionCreated({
            id: taskResult.id,
            specificTaskType: selectedTransactionType.id,
            selectedIpRecord: this.selectedIpRecord
            });

            if (oppositionResult?.success && oppositionResult?.recordId) {
            const already = !!oppositionResult.isExistingRecord;
            const extraMsg = oppositionResult.message ? `\n\nNot: ${oppositionResult.message}` : '';

            if (already) {
                console.log('ℹ️ Otomatik 3.taraf portföy: mevcut kayıt ilişkilendirildi:', oppositionResult.recordId);
                alert(
                'İş başarıyla oluşturuldu!\n\n' +
                'Yayına itiraz işi olduğu için mevcut 3.taraf portföy kaydı İLİŞKİLENDİRİLDİ (ID: ' +
                oppositionResult.recordId + ').' + extraMsg
                );
            } else {
                console.log('✅ Otomatik 3.taraf portföy kaydı OLUŞTURULDU:', oppositionResult.recordId);
                alert(
                'İş başarıyla oluşturuldu!\n\n' +
                'Yayına itiraz işi olduğu için otomatik olarak 3.taraf portföy kaydı OLUŞTURULDU (ID: ' +
                oppositionResult.recordId + ').' + extraMsg
                );
            }
            } else if (oppositionResult && oppositionResult.error && oppositionResult.error !== 'Yayına itiraz işi değil') {
            console.warn('⚠️ 3.taraf portföy kaydı işlemi başarısız:', oppositionResult.error);
            alert(
                'İş başarıyla oluşturuldu!\n\n' +
                'Ancak 3.taraf portföy kaydı oluşturulurken bir hata oluştu: ' + oppositionResult.error
            );
            } else {
            // Yayına itiraz işi değil veya otomasyon yapılmadı
            alert('İş başarıyla oluşturuldu!');
            }
        } catch (err) {
            console.warn('⚠️ 3.taraf portföy otomasyonu sırasında beklenmeyen hata:', err);
            alert('İş başarıyla oluşturuldu!\n\nAncak 3.taraf portföy otomasyonu sırasında beklenmeyen bir hata oluştu.');
        }
        } else {
        alert('İş başarıyla oluşturuldu!');
        }

        window.location.href = 'task-management.html';

    }
}

}
// CreateTaskModule class'ını initialize et
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 DOM Content Loaded - CreateTask initialize ediliyor...');
    
    // Shared layout'u yükle
    await loadSharedLayout({ activeMenuLink: 'create-task.html' });
    
    
    ensurePersonModal();
// CreateTask instance'ını oluştur ve initialize et
    const createTaskInstance = new CreateTaskModule();
    
    // Global erişim için (debugging amaçlı)
    window.createTaskInstance = createTaskInstance;
    
    // Initialize et
    await createTaskInstance.init();
    
    console.log('✅ CreateTask başarıyla initialize edildi');
});