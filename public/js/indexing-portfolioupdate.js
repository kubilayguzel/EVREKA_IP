// js/indexing-portfolioupdate.js
// ES Module
import { db, ipRecordsService } from '../firebase-config.js';
import { doc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage, ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { STATUSES } from '../utils.js';

// DOM elemanlarını seçmek için yardımcı fonksiyonlar
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Uygulamanın durumunu yöneten nesne
const state = {
  ipRecordId: null,
  record: null,
  goodsAndServicesMap: {},
  niceClasses: [],
  allIpRecords: [],
  selectedIpRecord: null,
  bulletins: [],
};

// Gerekli tüm DOM elemanlarını döndüren yardımcı fonksiyon
function qs() {
  return {
    registryStatus: $('#registry-status'),
    registryApplicationDate: $('#registry-application-date'),
    registryRegistrationNo: $('#registry-registration-no'),
    registryRegistrationDate: $('#registry-registration-date'),
    registryRenewalDate: $('#registry-renewal-date'),
    btnSaveAll: $('#btn-save-all'),
    globalFeedback: $('#global-feedback'),
    bulletinNoInput: $('#bulletin-no-input'),
    bulletinDateInput: $('#bulletin-date-input'),
    btnAddBulletin: $('#btn-add-bulletin'),
    bulletinList: $('#bulletin-list'),
    
    // Nice modal yeni elemanları
    btnNiceAddModal: $('#btn-add-nice-modal'),
    niceClassModal: $('#nice-class-modal'),
    niceModalAvailableClasses: $('#available-nice-classes'),
    niceModalSelectedClasses: $('#selected-nice-classes-in-modal'),
    niceModalItemEditor: $('#nice-modal-item-editor'), // Yeni eklendi
    btnSaveNiceModal: $('#btn-save-nice-modal'),
    
    niceChips: $('#nice-classes-chips'),
    niceAccordion: $('#nice-classes-accordion'),
    
    recordSearchInput: $('#recordSearchInput'),
    searchResultsContainer: $('#searchResultsContainer'),
    selectedRecordDisplay: $('#selectedRecordDisplay'),
    saveUpdatePdfBtn: $('#saveUpdatePdfBtn'),
    indexPdfBtn: $('#indexPdfBtn'),
    childTransactionType: $('#childTransactionType'),
    deliveryDate: $('#deliveryDate'),
    transactionsList: $('#transactionsList'),
  };
}

function ipRecordRef(id) {
  return doc(db, 'ipRecords', id);
}
function getSelectionState() {
  const el = qs();
  const hasRecord = !!(state.selectedIpRecord && state.selectedIpRecord.id);
  const hasParentTransaction = !!document.querySelector('#transactionsList .transaction-item.selected');
  const childTypeVal = (el.childTransactionType && el.childTransactionType.value) || '';
  const hasChildType = !!childTypeVal;
  const deliveryDateVal = (el.deliveryDate && el.deliveryDate.value) || '';
  const hasDeliveryDate = !!deliveryDateVal;

  return {
    hasRecord,
    hasParentTransaction,
    hasChildType,
    hasDeliveryDate,
    allOk: hasRecord && hasParentTransaction && hasChildType && hasDeliveryDate
  };
}

// --- Kaydet/Güncelle butonlarının aktif/pasif yönetimi
function updateSaveButtonsState() {
  const el = qs();
  const st = getSelectionState();

  // Form içi büyük buton
  if (el.saveUpdatePdfBtn) {
    el.saveUpdatePdfBtn.disabled = !st.allOk;
    el.saveUpdatePdfBtn.classList.toggle('btn-disabled', !st.allOk);
  }

  // Fixed sağ alttaki genel buton (#btn-save-all)
  if (el.btnSaveAll) {
    el.btnSaveAll.disabled = !st.allOk;
    // isterseniz görsel olarak da gri yapabilirsiniz, ör. el.btnSaveAll.classList.toggle('btn-disabled', !st.allOk);
  }
}
async function loadRecord(ipRecordId) {
  if (!ipRecordId) {
    console.error("loadRecord çağrıldı ama ipRecordId boş.");
    return { record: null };
  }
  try {
    const snap = await getDoc(ipRecordRef(ipRecordId));
    if (!snap.exists()) {
      console.error('loadRecord: ipRecord bulunamadı.', ipRecordId);
      throw new Error('ipRecord bulunamadı');
    }
    const data = snap.data() || {};
    state.record = { id: snap.id, ...data };

    // goodsAndServicesByClass'tan goodsAndServicesMap'i oluştur
    const goodsAndServicesByClass = data.goodsAndServicesByClass || [];
    state.goodsAndServicesMap = goodsAndServicesByClass.reduce((acc, current) => {
        acc[current.classNo] = (current.items || []).join('\n');
        return acc;
    }, {});
    
    // niceClasses alanını kontrol et, yoksa goodsAndServicesByClass'tan çıkar
    let nClasses = data.niceClasses || [];
    
    // Eğer niceClasses boşsa, goodsAndServicesByClass'tan çıkar
    if (!nClasses || nClasses.length === 0) {
      nClasses = goodsAndServicesByClass.map(item => String(item.classNo));
    }
    
    // Alternatif olarak goodsAndServices, niceClass gibi eski alanları da kontrol et
    if ((!nClasses || nClasses.length === 0) && data.goodsAndServices) {
      // Eski goodsAndServices formatından Nice sınıflarını çıkar
      const extractedClasses = new Set();
      const extractNiceFromGoodsAndServices = (items) => {
        if (!Array.isArray(items)) return;
        items.forEach(item => {
          if (typeof item === 'string') {
            const match = item.match(/^\[(\d+)\]/);
            if (match) extractedClasses.add(match[1]);
          } else if (item && typeof item === 'object') {
            if (item.classNo) extractedClasses.add(String(item.classNo));
            if (item.class) extractedClasses.add(String(item.class));
            if (item.nice) extractedClasses.add(String(item.nice));
          }
        });
      };
      extractNiceFromGoodsAndServices(data.goodsAndServices);
      nClasses = Array.from(extractedClasses);
    }
    
    // niceClass alanını da kontrol et (tekil alan)
    if ((!nClasses || nClasses.length === 0) && data.niceClass) {
      nClasses = Array.isArray(data.niceClass) ? 
        data.niceClass.map(x => String(x)) : 
        [String(data.niceClass)];
    }
    
    state.bulletins = data.bulletins || [];
    state.niceClasses = Array.isArray(nClasses) ? 
        nClasses.map(x => String(x)) : [];

    return { record: state.record };
  } catch (e) {
    console.error('loadRecord error:', e);
    throw e;
  }
}

function renderRegistryInfo(record) {
  const el = qs();
  if (!record) return;

  // record.type alanına göre patent/trademark seç
  const recordType = record.type || 'trademark'; // default olarak trademark
  const statusesArray = STATUSES[recordType] || [];

  if (el.registryStatus) {
    el.registryStatus.innerHTML = '';

    // Boş option ekle (eğer status yoksa bu seçili kalacak)
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'Durum Seçiniz...';
    el.registryStatus.appendChild(emptyOpt);

    statusesArray.forEach(st => {
      const opt = document.createElement('option');
      opt.value = st.value;
      opt.textContent = st.text;
      el.registryStatus.appendChild(opt);
    });

    // ipRecords.status değerini seçili yap
    const currentStatus = record.status || '';
    if (currentStatus) {
      el.registryStatus.value = currentStatus;
      // listede yoksa fallback ekle
      if (el.registryStatus.value !== currentStatus) {
        const opt = document.createElement('option');
        opt.value = currentStatus;
        opt.textContent = currentStatus;
        el.registryStatus.appendChild(opt);
        el.registryStatus.value = currentStatus;
      }
    } else {
      // Status yoksa boş option seçili kalsın
      el.registryStatus.value = '';
    }
  }

  if (el.registryApplicationDate) el.registryApplicationDate.value = record.applicationDate || '';
  if (el.registryRegistrationNo)  el.registryRegistrationNo.value  = record.registrationNumber || '';
  if (el.registryRegistrationDate)el.registryRegistrationDate.value= record.registrationDate || '';
  if (el.registryRenewalDate)     el.registryRenewalDate.value     = record.renewalDate || '';
}

function renderBulletins() {
    const el = qs();
    if (!el.bulletinList) return;
    
    if (state.bulletins.length === 0) {
        el.bulletinList.innerHTML = '<div class="text-muted">Henüz bülten eklenmemiş.</div>';
        return;
    }
    
    el.bulletinList.innerHTML = state.bulletins.map((bulletin, index) => `
        <div class="bulletin-item border p-2 mb-2 rounded">
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>Bülten No:</strong> ${bulletin.bulletinNo}<br>
                    <strong>Tarih:</strong> ${bulletin.bulletinDate}
                </div>
                <button type="button" class="btn btn-sm btn-outline-danger" data-remove-bulletin="${index}">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    `).join('');

    // Bülten silme butonları için event listener ekle
    $$('[data-remove-bulletin]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.getAttribute('data-remove-bulletin'));
            state.bulletins.splice(index, 1);
            renderBulletins();
        });
    });
}

function renderNice() {
  const el = qs();
  
  if (!el.niceChips || !el.niceAccordion) {
    console.warn('⚠️ renderNice: DOM elementleri bulunamadı');
    return;
  }

  // Eğer Nice sınıfları yoksa boş mesaj göster  
  if (!state.niceClasses || state.niceClasses.length === 0) {
    el.niceChips.innerHTML = '<div class="text-muted">Henüz Nice sınıfı eklenmemiş. "Sınıf Ekle" butonunu kullanarak ekleyebilirsiniz.</div>';
    el.niceAccordion.innerHTML = '';
    return;
  }

  // Nice sınıfları chip'lerini render et
  el.niceChips.innerHTML = state.niceClasses
    .sort((a, b) => Number(a) - Number(b))
    .map((c) => `
      <span class="badge badge-light border mr-1 mb-1" data-class="${c}">
        Nice ${c}
        <button type="button" class="close ml-1" data-remove-class="${c}" aria-label="Sil">
          <span aria-hidden="true">&times;</span>
        </button>
      </span>
    `).join('');

  // Nice accordion'ını render et
  el.niceAccordion.innerHTML = state.niceClasses
    .sort((a, b) => Number(a) - Number(b))
    .map((c, idx) => {
      const content = state.goodsAndServicesMap[c] || '';
      const panelId = `nice-panel-${c}`;
      return `
        <div class="card mb-2">
          <div class="card-header p-2" id="heading-${c}">
            <h6 class="mb-0">
              <button class="btn btn-link" type="button" data-toggle="collapse" data-target="#${panelId}" aria-expanded="${idx===0?'true':'false'}" aria-controls="${panelId}">
                Nice ${c} — Mal &amp; Hizmetler
              </button>
            </h6>
          </div>
          <div id="${panelId}" class="collapse ${idx===0?'show':''}" aria-labelledby="heading-${c}">
            <div class="card-body">
              <textarea class="form-control gs-textarea" data-class="${c}" rows="5" placeholder="Sınıf ${c} için mal ve hizmetleri yazın...">${content}</textarea>
              <div class="text-right mt-2">
                <button type="button" class="btn btn-sm btn-outline-danger" data-remove-class="${c}">Bu sınıfı kaldır</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    bindDynamicNiceEvents();
}

function bindDynamicNiceEvents() {
  $$('[data-remove-class]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = String(btn.getAttribute('data-remove-class'));
      state.niceClasses = state.niceClasses.filter((x) => x !== c);
      delete state.goodsAndServicesMap[c];
      renderNice();
    });
  });
}

// === YENİ MODAL VE İLGİLİ FONKSİYONLAR ===
async function openNiceModal() {
    await renderNiceModalContent();
    window.showModal('#nice-class-modal');
}

async function renderNiceModalContent() {
    const el = qs();
    const existingClasses = new Set(state.niceClasses);
    const allClasses = await fetchAllNiceClasses();
    
    const availableContainer = el.niceModalAvailableClasses;
    const selectedContainer = el.niceModalSelectedClasses;
    const editorContainer = el.niceModalItemEditor;

    if (!availableContainer || !selectedContainer || !editorContainer) {
        console.error('Modal container elementleri bulunamadı');
        return;
    }
    
    renderSelectedClassesInModal(selectedContainer);
    renderAvailableClassesInModal(availableContainer, allClasses, existingClasses);
    renderItemEditorPanel(editorContainer);
    
    attachModalEventListeners();
}

function renderSelectedClassesInModal(container) {
    let html = '';
    const sortedClasses = state.niceClasses.sort((a, b) => Number(a) - Number(b));
    
    if (sortedClasses.length === 0) {
        container.innerHTML = '<div class="text-muted text-center p-3">Lütfen aşağıdaki sınıflardan birini seçin.</div>';
        return;
    }

    sortedClasses.forEach(classNum => {
        html += `
            <button type="button" class="list-group-item list-group-item-action modal-selected-class" data-class="${classNum}">
                Nice ${classNum}
            </button>
        `;
    });
    
    container.innerHTML = html;
}

function renderAvailableClassesInModal(container, allClasses, existingClasses) {
    const availableClasses = allClasses.filter(c => !existingClasses.has(String(c)));
    
    let html = '';
    availableClasses.forEach(classNum => {
        html += `
            <button type="button" class="list-group-item list-group-item-action add-modal-class" data-class="${classNum}">
                Nice ${classNum}
            </button>
        `;
    });
    
    container.innerHTML = html || '<div class="text-muted text-center p-3">Tüm sınıflar eklenmiş.</div>';
}

function renderItemEditorPanel(container) {
    let html = '';
    const sortedClasses = state.niceClasses.sort((a, b) => Number(a) - Number(b));
    
    if (sortedClasses.length === 0) {
        container.innerHTML = `
            <div class="card-body">
                <div class="text-muted text-center p-3">
                    Düzenlemek için bir sınıf seçin.
                </div>
            </div>
        `;
        return;
    }

    sortedClasses.forEach(classNum => {
        const content = state.goodsAndServicesMap[classNum] || '';
        html += `
            <div class="card mb-2">
                <div class="card-header">
                    <h6 class="mb-0">Nice ${classNum} Eşya Listesi</h6>
                </div>
                <div class="card-body">
                    <textarea class="form-control modal-textarea" data-class="${classNum}" rows="5" placeholder="Sınıf ${classNum} için eşya listesi...">${content}</textarea>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function attachModalEventListeners() {
    const el = qs();

    const addButtons = document.querySelectorAll('.add-modal-class');
    addButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const cls = btn.getAttribute('data-class');
            if (cls && !state.niceClasses.includes(cls)) {
                state.niceClasses.push(cls);
                state.goodsAndServicesMap[cls] = '';
                renderNiceModalContent();
            }
        });
    });
    
    const removeButtons = document.querySelectorAll('.remove-modal-class');
    removeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const cls = btn.getAttribute('data-class');
            if (cls) {
                state.niceClasses = state.niceClasses.filter(c => c !== cls);
                delete state.goodsAndServicesMap[cls];
                renderNiceModalContent();
            }
        });
    });

    const selectedClassesButtons = document.querySelectorAll('.modal-selected-class');
    selectedClassesButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.modal-selected-class').forEach(item => item.classList.remove('active'));
            e.target.classList.add('active');

            const cls = btn.getAttribute('data-class');
            const targetTextarea = document.querySelector(`#nice-modal-item-editor textarea[data-class="${cls}"]`);
            if (targetTextarea) {
                targetTextarea.scrollIntoView({ behavior: 'smooth', block: 'start' });
                targetTextarea.focus();
            }
        });
    });

    const textareas = document.querySelectorAll('.modal-textarea');
    textareas.forEach(ta => {
        ta.addEventListener('input', (e) => {
            const cls = e.target.getAttribute('data-class');
            state.goodsAndServicesMap[cls] = e.target.value.trim();
        });
    });

    el.niceModalClearAll?.addEventListener('click', () => {
        state.niceClasses = [];
        state.goodsAndServicesMap = {};
        renderNiceModalContent();
    });
}

function focusOnClassEditor(classNum) {
    const el = qs();
    const content = state.goodsAndServicesMap[classNum] || '';
    
    el.niceModalItemEditor.innerHTML = `
        <div class="card-body">
            <h6 class="card-title">Nice ${classNum} Eşya Listesi</h6>
            <textarea class="form-control modal-textarea" data-class="${classNum}" rows="10" placeholder="Sınıf ${classNum} için eşya listesi...">${content}</textarea>
        </div>
    `;
    const textarea = el.niceModalItemEditor.querySelector('textarea');
    if (textarea) textarea.focus();
}

async function fetchAllNiceClasses() {
    return Array.from({length: 45}, (_, i) => String(i + 1));
}

async function saveNiceModal() {
    const el = qs();
    
    const textareas = document.querySelectorAll('.modal-textarea');
    textareas.forEach(ta => {
        const cls = ta.getAttribute('data-class');
        state.goodsAndServicesMap[cls] = ta.value.trim();
    });
    
    window.hideModal('#nice-class-modal');
    renderNice();
}
// === END YENİ MODAL VE İLGİLİ FONKSİYONLAR ===

async function loadAllIpRecords() {
  try {
    const result = await ipRecordsService.getRecords();
    if (result.success) {
      state.allIpRecords = result.data;
    } else {
      console.error('loadAllIpRecords error:', result.error);
      state.allIpRecords = [];
    }
  } catch (error) {
    console.error('loadAllIpRecords error:', error);
    state.allIpRecords = [];
  }
}

function debounce(func, delay = 300) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(null, args), delay);
    };
}

async function resolveImageUrl(path) {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    
    try {
        const storage = getStorage();
        const imageRef = ref(storage, path);
        return await getDownloadURL(imageRef);
    } catch (error) {
        console.error('Image resolve error:', error);
        return null;
    }
}

function searchRecords(query) {
    const el = qs();
    if (!query.trim()) {
        el.searchResultsContainer.style.display = 'none';
        return;
    }

    const filtered = state.allIpRecords.filter(r => {
        const title = (r.title || r.brandText || '').toLowerCase();
        const appNo = (r.applicationNumber || r.applicationNo || '').toLowerCase();
        const regNo = (r.registrationNumber || '').toLowerCase();
        return title.includes(query.toLowerCase()) || 
               appNo.includes(query.toLowerCase()) || 
               regNo.includes(query.toLowerCase());
    }).slice(0, 10);

    if (filtered.length === 0) {
        el.searchResultsContainer.innerHTML = '<div class="p-2 text-muted">Sonuç bulunamadı</div>';
    } else {
        el.searchResultsContainer.innerHTML = filtered.map(r => {
            const title = r.title || r.brandText || 'Başlıksız';
            const appNo = r.applicationNumber || r.applicationNo || 'Bilinmiyor';
            const imgSrc = r.brandImageUrl || r.details?.brandInfo?.brandImage || '';
            const imgHtml = imgSrc ? 
                `<img src="${imgSrc}" class="ip-thumb" style="width:40px; height:40px; object-fit:contain; border-radius:4px; margin-right:8px;">` : '';

            return `<div class="search-result-item d-flex align-items-center" data-id="${r.id}" data-title="${title}" data-appno="${appNo}" data-img="${imgSrc}">
                    ${imgHtml}
                    <b>${title}</b> (${appNo})
                </div>`;
        }).join('');
        el.searchResultsContainer.querySelectorAll('img[src^="ipRecordDocs/"]').forEach(async imgEl => {
            const path = imgEl.getAttribute('src');
            const url = await resolveImageUrl(path);
            if (url) imgEl.src = url;
        });
    }
    el.searchResultsContainer.style.display = 'block';
}

function renderSelectedRecord(record) {
  const el = qs();
  const holder = el.selectedRecordDisplay;
  if (!holder) return;

  // hiç seçim yoksa
  if (!record) {
    holder.innerHTML = '';
    if (el.recordSearchInput) el.recordSearchInput.style.display = 'block';
    // diğer modüllere de seçim temizlendiğini duyur
    document.dispatchEvent(new CustomEvent('indexing:selection-changed'));
    return;
  }

  const title = record.title || record.brandText || 'Başlıksız';
  const appNo = record.applicationNo || record.applicationNumber || '-';
  const img  = record.brandImageUrl
    ? `<img src="${record.brandImageUrl}" class="ip-thumb" style="width:40px;height:40px;object-fit:contain;border-radius:4px;margin-right:8px;">`
    : '';

  holder.innerHTML = `
    <div class="selected-item d-flex align-items-center">
      ${img}
      <span><b>${title}</b> (${appNo})</span>
      <button type="button" class="remove-selected-item-btn" data-id="${record.id}">&times;</button>
    </div>
  `;

  // input’u gizle, kartı göster
  if (el.recordSearchInput) el.recordSearchInput.style.display = 'none';

  // diğer modüllere seçim değişti bilgisini gönder
  document.dispatchEvent(new CustomEvent('indexing:selection-changed', {
    detail: { ipRecordId: record.id }
  }));
}

function bindEvents() {
  const el = qs();
  const btnNiceAddModal  = document.getElementById('btn-add-nice-modal');
  const btnSaveNiceModal = document.getElementById('btn-save-nice-modal');

  // — Bülten ekleme
  el.btnAddBulletin?.addEventListener('click', () => {
    const bulletinNo   = el.bulletinNoInput.value.trim();
    const bulletinDate = el.bulletinDateInput.value;
    if (!bulletinNo || !bulletinDate) {
      alert('Bülten No ve Bülten Tarihi boş olamaz.');
      return;
    }
    state.bulletins.push({ bulletinNo, bulletinDate });
    renderBulletins();
    el.bulletinNoInput.value = '';
    el.bulletinDateInput.value = '';
  });

  // — Nice modal aç/kaydet
  btnNiceAddModal?.addEventListener('click', openNiceModal);
  btnSaveNiceModal?.addEventListener('click', saveNiceModal);

  // — Bootstrap modal kapatma
  document.addEventListener('click', (event) => {
    if (event.target.matches('[data-dismiss="modal"]') ||
        event.target.closest('[data-dismiss="modal"]')) {
      closeNiceModal();
    }
  });

  bindDynamicNiceEvents();

  // — Sabit sağ alttaki büyük Kaydet/Güncelle
  el.btnSaveAll?.addEventListener('click', async () => {
    try {
      toggleBtn(el.btnSaveAll, true);

      // 1) PDF’i indeksle (redirect olmadan)
      if (window.indexingDetailModule?.handleIndexing) {
        await window.indexingDetailModule.handleIndexing({ noRedirect: true });
      }

      // 2) Sicil / Nice / Bülten verilerini kaydet
      await saveAllData();

      // 3) Bilgi ve YÖNLENDİRME
      if (el.globalFeedback) {
        el.globalFeedback.innerHTML = `<div class="alert alert-success py-1 my-2">
          PDF ve veriler başarıyla güncellendi. Yönlendiriliyorsunuz...
        </div>`;
      }
      // 🔁 yönlendir
      window.location.href = 'bulk-indexing-page.html';

    } catch (e) {
      console.error(e);
      if (el.globalFeedback) el.globalFeedback.innerHTML =
        `<div class="alert alert-danger py-1 my-2">Kaydedilemedi: ${e.message}</div>`;
    } finally {
      toggleBtn(el.btnSaveAll, false);
    }
  });

  // — Seçim/alan değiştikçe butonların aktifliği
  const reevaluate = () => updateSaveButtonsState();

  // Alt işlem türü değişimi
  el.childTransactionType?.addEventListener('change', reevaluate);

  // Tebliğ tarihi değişimi
  el.deliveryDate?.addEventListener('change', reevaluate);
  el.deliveryDate?.addEventListener('input',  reevaluate);

  // Ana işlem satırı tıklanınca (seçili class değişir)
  el.transactionsList?.addEventListener('click', () => {
    setTimeout(reevaluate, 0); // class toggle sonrası oku
  });

  // Diğer modül seçim değişikliği yayarsa
  document.addEventListener('indexing:selection-changed', reevaluate);

  // İlk yüklemede durumları değerlendir
  updateSaveButtonsState();
}
async function saveAllData() {
    const el = qs();
    const patch = {};
    // Güvenli docId çözümü
    let docId = state.record?.id || state.selectedIpRecord?.id || state.ipRecordId;

    if (!docId) {
      throw new Error("Kayıt verisi bulunamadı, kaydedilemiyor.");
    }

    // eğer state.record.id yok ama elimizde docId varsa, kayıt yükle
    if (!state.record || !state.record.id) {
      const { record } = await loadRecord(docId);
      if (!record) throw new Error("Kayıt verisi bulunamadı, kaydedilemiyor.");
      docId = record.id;
    }
    const current = state.record;
    const newStatus = el.registryStatus?.value.trim() || '';
    const newApplicationDate = el.registryApplicationDate?.value || '';
    const newRegistrationNo = el.registryRegistrationNo?.value.trim() || '';
    const newRegistrationDate = el.registryRegistrationDate?.value || '';
    const newRenewalDate = el.registryRenewalDate?.value || '';

    if (newStatus !== (current.status || '')) patch.status = newStatus;
    if (newApplicationDate !== (current.applicationDate || '')) patch.applicationDate = newApplicationDate;
    if (newRegistrationNo !== (current.registrationNumber || '')) patch.registrationNumber = newRegistrationNo;
    if (newRegistrationDate !== (current.registrationDate || '')) patch.registrationDate = newRegistrationDate;
    if (newRenewalDate !== (current.renewalDate || '')) patch.renewalDate = newRenewalDate;
    
    patch.bulletins = state.bulletins;

    const allTextareas = document.querySelectorAll('[data-class]');
    allTextareas.forEach((ta) => {
        const cls = ta.getAttribute('data-class');
        state.goodsAndServicesMap[cls] = ta.value;
    });

    const niceClasses = [...state.niceClasses].sort((a, b) => Number(a) - Number(b));
    const goodsAndServicesMap = state.goodsAndServicesMap;
    const goodsAndServicesByClass = niceClasses.map(classNo => ({
        classNo: Number(classNo),
        items: (goodsAndServicesMap[classNo] || '').split('\n').filter(item => item.trim() !== '')
    }));

    patch['goodsAndServicesByClass'] = goodsAndServicesByClass;
    
    if (Object.keys(patch).length === 0) return;
    await updateDoc(ipRecordRef(docId), patch);

    Object.assign(state.record, patch);
}

function toggleBtn(btn, loading) {
  if (!btn) return;
  const original = btn.dataset.originalText || btn.innerHTML;
  if (!btn.dataset.originalText) {
    btn.dataset.originalText = original;
  }
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner-border spinner-border-sm mr-1"></span>Kaydediliyor...'
    : btn.dataset.originalText;
}
async function init({ ipRecordId }) {
  const el = qs();
  
  el.recordSearchInput.disabled = true;

  await loadAllIpRecords();
  el.recordSearchInput.disabled = false;

  if (ipRecordId) {
    state.selectedIpRecord = state.allIpRecords.find(r => r.id === ipRecordId);
    if (state.selectedIpRecord) {
        const { record } = await loadRecord(ipRecordId);
        if (record) {
            renderRegistryInfo(record);
            renderSelectedRecord({ 
                id: state.selectedIpRecord.id, 
                title: state.selectedIpRecord.title || state.selectedIpRecord.brandText,
                applicationNo: state.selectedIpRecord.applicationNumber || state.selectedIpRecord.applicationNo,
                brandImageUrl: state.selectedIpRecord.brandImageUrl || state.selectedIpRecord.details?.brandInfo?.brandImage
            });
            
            renderBulletins();
            renderNice();
        }
    }
  }

  if (!ipRecordId && el.recordSearchInput) {
      el.recordSearchInput.style.display = 'block';
  }

  state.ipRecordId = ipRecordId;
  bindEvents();

  el.recordSearchInput?.addEventListener('input', debounce((e) => searchRecords(e.target.value)));
  
  el.searchResultsContainer?.addEventListener('click', (e) => {
      const item = e.target.closest('.search-result-item');
      if (!item) return;
      
      const id = item.dataset.id;
      const title = item.dataset.title;
      const appNo = item.dataset.appno;
      const brandImageUrl = item.dataset.img;

      state.selectedIpRecord = { id, title, applicationNo: appNo, brandImageUrl };
      renderSelectedRecord(state.selectedIpRecord);
      el.searchResultsContainer.style.display = 'none';
      el.recordSearchInput.value = '';

      if (state.selectedIpRecord?.id) {
          loadRecord(state.selectedIpRecord.id).then(({ record }) => {
              renderRegistryInfo(record);
              renderBulletins();
              renderNice();
              updateSaveButtonsState();
          });
      }
  });

  el.selectedRecordDisplay?.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.remove-selected-item-btn');
      if (!removeBtn) return;
      
      state.selectedIpRecord = null;
      renderSelectedRecord(null);
      
      state.record = null;
      state.niceClasses = [];
      state.goodsAndServicesMap = {};
      state.bulletins = [];
      
      renderRegistryInfo({});
      renderBulletins();
      renderNice();
      updateSaveButtonsState();
  });
}
export const IndexingPortfolioUpdate = { init };
window.IndexingPortfolioUpdate = IndexingPortfolioUpdate;