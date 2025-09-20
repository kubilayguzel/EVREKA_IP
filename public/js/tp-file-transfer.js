import { collection, addDoc, serverTimestamp, writeBatch, doc, getDocs, query, where, getFirestore  } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';


// === TP Import → transaction helpers (embedded) ===
function buildTpImportTransaction({ recordId, recordData, user, hierarchy = 'parent', parentTransactionId = null, countryCode = null }) {
  return {
    transactionTypeId: 'tp_transfer',
    transactionSource: 'tp_import',
    transactionHierarchy: hierarchy,
    parentTransactionId,
    recordId,
    countryCode: (recordData && (recordData.countryCode || recordData.country)) || null,
    niceClasses: Array.isArray(recordData && recordData.niceClasses) ? recordData.niceClasses : null,
    applicationNumber: (recordData && (recordData.applicationNumber || recordData.basvuruNo)) || null,
    applicationDate: (recordData && (recordData.applicationDate || recordData.basvuruTarihi)) || null,
    bulletinNo: recordData && recordData.bulletinNo || null,
    note: 'Kayıt TurkPatent portföy transferi ile oluşturuldu.',
    createdAt: serverTimestamp(),
    createdBy_uid: (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || null,
    createdBy_email: (typeof currentUser !== 'undefined' && currentUser && currentUser.email) || null,
    createdBy_displayName: (typeof currentUser !== 'undefined' && currentUser && currentUser.displayName) || null,
    state: 'completed',
    isSystemGenerated: true,
  };
}

async function findChildrenForRecord({ db, parentRecordId, parentData }) {
  const candidates = [];
  try {
    const q1 = query(collection(db, 'ipRecords'), where('parentRecordId', '==', parentRecordId));
    (await getDocs(q1)).forEach(d => candidates.push({ id: d.id, data: d.data() }));
  } catch (e) {}
  try {
    const q2 = query(collection(db, 'ipRecords'), where('wipoParentId', '==', parentRecordId));
    (await getDocs(q2)).forEach(d => candidates.push({ id: d.id, data: d.data() }));
  } catch (e) {}
  try {
    const q3 = query(collection(db, 'ipRecords'), where('aripoParentId', '==', parentRecordId));
    (await getDocs(q3)).forEach(d => candidates.push({ id: d.id, data: d.data() }));
  } catch (e) {}

  const irFields = ['wipoIR', 'aripoIR', 'wipoIRNo', 'aripoIRNo'];
  const parentIR = irFields.map(f => parentData && parentData[f]).find(Boolean);
  if (parentIR) {
    for (const f of irFields) {
      try {
        const q = query(collection(db, 'ipRecords'), where(f, '==', parentIR));
        (await getDocs(q)).forEach(d => candidates.push({ id: d.id, data: d.data() }));
      } catch (e) {}
    }
  }
  const seen = new Set();
  return candidates.filter(x => !seen.has(x.id) && seen.add(x.id));
}

async function createTransactionsForTpImport({ db, recordId, recordData, user }) {
  try {
    const parentColl = collection(db, 'ipRecords', recordId, 'transactions');
    const parentPayload = buildTpImportTransaction({ recordId, recordData, user, hierarchy: 'parent' });
    const parentRef = await addDoc(parentColl, parentPayload);

    const children = await findChildrenForRecord({ db, parentRecordId: recordId, parentData: recordData });
    console.log('[TP→TX] Found children:', children?.length || 0);
    
    if (!children || children.length === 0) {
      console.log('[TP→TX] Parent transaction created, no children.');
      return { parentTransactionId: parentRef.id, childTransactionIds: [] };
    }
    const batch = writeBatch(db);
    const childIds = [];
    for (const child of children) {
      const childTxRef = doc(collection(db, 'ipRecords', child.id, 'transactions'));
      const childPayload = buildTpImportTransaction({
        recordId: child.id,
        recordData: child.data,
        user,
        hierarchy: 'child',
        parentTransactionId: parentRef.id,
        countryCode: (child.data && (child.data.countryCode || child.data.country)) || null,
      });
      batch.set(childTxRef, childPayload);
      childIds.push(childTxRef.id);
    }
    await batch.commit();
    console.log('[TP→TX] Parent+child transactions created:', { parent: parentRef.id, children: childIds.length });
    return { parentTransactionId: parentRef.id, childTransactionIds: childIds };
  } catch (e) {
    console.warn('[TP→TX] createTransactionsForTpImport failed', e);
    return { error: e?.message || String(e) };
  }
}
// === /TP Import → transaction helpers ===


// =============================
// TÜRKPATENT Dosya Aktarım Modülü - TEMİZ VERSİYON
// =============================

// --- DOM Helper Fonksiyonlar ---
function _el(id) { return document.getElementById(id); }
function _showBlock(el) { if(!el) return; el.classList.remove('hide'); el.style.display=''; }
function _hideBlock(el) { if(!el) return; el.classList.add('hide'); }

function showToast(msg, type='info') {
  const cls = type==='danger'?'alert-danger':(type==='success'?'alert-success':(type==='warning'?'alert-warning':'alert-info'));
  const div = document.createElement('div');
  div.className = `alert ${cls}`;
  div.style.position = 'fixed';
  div.style.top = '18px';
  div.style.right = '18px';
  div.style.zIndex = '9999';
  div.style.minWidth = '260px';
  div.innerHTML = `<div class="d-flex align-items-center justify-content-between">
    <div>${msg}</div><button class="close ml-3" aria-label="Close"><span>&times;</span></button>
  </div>`;
  document.body.appendChild(div);
  setTimeout(()=>{ div.classList.add('fade'); div.addEventListener('transitionend', ()=>div.remove()); }, 3500);
  div.querySelector('.close')?.addEventListener('click', ()=>div.remove());
}

function fmtDateToTR(isoOrDDMMYYYY) {
  if(!isoOrDDMMYYYY) return '';
  if(/^\d{2}\.\d{2}\.\d{4}$/.test(isoOrDDMMYYYY)) return isoOrDDMMYYYY;
  const m = String(isoOrDDMMYYYY).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m) return `${m[3]}.${m[2]}.${m[1]}`;
  return String(isoOrDDMMYYYY);
}

// Tarih parse yardımcı fonksiyonu - dosyanın en üstüne ekleyin
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // DD.MM.YYYY formatı
  const match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }
  
  // Diğer formatları dene
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

// --- Firebase Imports ---
import { app, db, personService, ipRecordsService } from '../firebase-config.js';
import { loadSharedLayout, ensurePersonModal, openPersonModal } from './layout-loader.js';
import { mapTurkpatentResultsToIPRecords } from './turkpatent-mapper.js';

// --- DOM Elements ---
const basvuruNoInput = _el('basvuruNoInput');
const sahipNoInput = _el('ownerIdInput');
const loadingEl = _el('loading');
const singleResultContainer = _el('singleResultContainer');
const singleResultInner = _el('singleResultInner');
const cancelBtn = _el('cancelBtn');

// Kişi yönetimi elementleri
const relatedPartySearchInput = _el('relatedPartySearchInput');
const relatedPartySearchResults = _el('relatedPartySearchResults');
const addNewPersonBtn = _el('addNewPersonBtn');
const relatedPartyList = _el('relatedPartyList');
const relatedPartyCount = _el('relatedPartyCount');

// --- Global State ---
let allPersons = [];
let selectedRelatedParties = [];
let currentOwnerResults = []; // CSV export için

// --- Extension ID ---
const EXTENSION_ID_SAHIP = 'gkhmldkbjmnipikgjabmlilibllikapk';

// ===============================
// INITIALIZATION
// ===============================

async function init() {
  try {
    const personsResult = await personService.getPersons();
    allPersons = Array.isArray(personsResult.data) ? personsResult.data : [];
    console.log(`[INIT] ${allPersons.length} kişi yüklendi.`);
    
    setupEventListeners();
    setupExtensionMessageListener();
    setupRadioButtons();
  } catch (error) {
    console.error("Veri yüklenirken hata oluştu:", error);
    showToast("Gerekli veriler yüklenemedi.", "danger");
  }
}

// ===============================
// EVENT LISTENERS
// ===============================

function setupEventListeners() {
  // HER İKİ ALANDA DA TEK SORGULA BUTONU
  document.addEventListener('click', (e) => {
    if (e.target.id === 'queryBtn' || e.target.id === 'bulkQueryBtn') {
      e.preventDefault();
      handleQuery();
    }
  });
  
  // Portföye kaydet butonu
  document.addEventListener('click', (e) => {
    if (e.target.id === 'savePortfolioBtn') {
      e.preventDefault();
      handleSaveToPortfolio();
    }
  });
  
  // İptal butonu
  cancelBtn?.addEventListener('click', () => history.back());
  
  // Kişi arama
  let searchTimer;
  relatedPartySearchInput?.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchTimer);
    if (query.length < 2) {
      relatedPartySearchResults.innerHTML = '';
      _hideBlock(relatedPartySearchResults);
      return;
    }
    searchTimer = setTimeout(() => searchPersons(query), 250);
  });
  
  // Arama sonuçlarına tıklama
  relatedPartySearchResults?.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (!item) return;
    const personId = item.dataset.id;
    const person = allPersons.find(p => p.id === personId);
    if (person) {
      addRelatedParty(person);
      relatedPartySearchInput.value = '';
      _hideBlock(relatedPartySearchResults);
    }
  });
  
  // Yeni kişi ekleme
  addNewPersonBtn?.addEventListener('click', async () => {
    if (typeof ensurePersonModal === 'function') await ensurePersonModal();
    if (typeof openPersonModal === 'function') {
      openPersonModal('relatedParty', (newPerson) => {
        if (newPerson) {
          allPersons.push(newPerson);
          addRelatedParty(newPerson);
        }
      });
    }
  });
  
  // Kişi silme
  relatedPartyList?.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-selected-item-btn');
    if (btn) removeRelatedParty(btn.dataset.id);
  });

  console.log('[DEBUG] Event listeners kuruldu');
}

// SİL: handleSaveToPortfolio fonksiyonunu

// DEĞIŞTIR/EKLE:
async function handleSaveToPortfolio() {
  const checkedBoxes = document.querySelectorAll('.record-checkbox:checked');
  
  if (checkedBoxes.length === 0) {
    showToast('Kaydetmek için en az bir kayıt seçin.', 'warning');
    return;
  }
  
  const selectedIndexes = Array.from(checkedBoxes).map(cb => parseInt(cb.dataset.index));
  const selectedRecords = selectedIndexes.map(index => currentOwnerResults[index]).filter(Boolean);
  
  if (selectedRecords.length === 0) {
    showToast('Seçili kayıtlar bulunamadı.', 'danger');
    return;
  }

  // Simple Loading ile kaydetme progress
  const saveLoading = window.showSimpleLoading(
    'Portföye kaydediliyor',
    `${selectedRecords.length} kayıt veritabanına aktarılıyor...`
  );

  try {
    console.log('Kaydetme işlemi başladı:', selectedRecords.length, 'kayıt');
    
    saveLoading.updateText('Veriler hazırlanıyor', 'TÜRKPATENT formatı dönüştürülüyor...');
    
    const ipRecords = await mapTurkpatentResultsToIPRecords(selectedRecords, selectedRelatedParties);
    
    saveLoading.updateText('Veritabanına kaydediliyor', 'Kayıtlar tek tek işleniyor...');
    
    const results = [];
    let savedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < ipRecords.length; i++) {
      const record = ipRecords[i];
      try {
        saveLoading.updateText(
          'Kaydediliyor', 
          `${i + 1}/${ipRecords.length} kayıt işleniyor...`
        );
        
        const result = await ipRecordsService.createRecord(record);
        results.push(result);
        if (result && result.success && result.id) {
          try {
            console.log('[TP→TX] Transaction oluşturuluyor:', result.id);
            const txResult = await createTransactionsForTpImport({ 
              db: db, 
              recordId: result.id, 
              recordData: record, 
              user: (typeof currentUser !== 'undefined' ? currentUser : null) 
            });
            
            if (txResult.error) {
              console.error('[TP→TX] Transaction oluşturulamadı:', txResult.error);
            } else {
              console.log('[TP→TX] Transactions created for', result.id, txResult);
            }
          } catch (e) { 
            console.error('[TP→TX] Transaction creation failed for', result?.id, e); 
          }
        }
        
        if (result.success) {
          savedCount++;
        } else if (result.isDuplicate || result.isExistingRecord) {
          skippedCount++;
        } else {
          errorCount++;
        }
      } catch (error) {
        console.error('Kayıt hatası:', error);
        results.push({ success: false, error: error.message });
        errorCount++;
      }
    }
    
    console.log('Kaydetme sonuçları:', results);
    
    // Sonuç mesajı
    let message = '';
    if (savedCount > 0) message += `${savedCount} kayıt başarıyla kaydedildi. `;
    if (skippedCount > 0) message += `${skippedCount} kayıt zaten mevcut olduğu için atlandı. `;
    if (errorCount > 0) message += `${errorCount} kayıtta hata oluştu. `;
    
    if (errorCount === 0) {
      saveLoading.showSuccess(message.trim());
      showToast(message.trim(), 'success');
    } else {
      saveLoading.showError(message.trim());
      showToast(message.trim(), 'warning');
    }
    
  } catch (error) {
    console.error('Portföye kaydetme hatası:', error);
    saveLoading.showError('Kaydetme işlemi sırasında hata oluştu: ' + error.message);
    showToast('Kaydetme işlemi sırasında hata oluştu: ' + error.message, 'danger');
  }
}

// ===============================
// RADIO BUTTON YÖNETİMİ
// ===============================

function setupRadioButtons() {
  const singleRadio = _el('singleTransfer');
  const ownerRadio = _el('bulkByOwner');
  const singleFields = _el('singleFields');
  const ownerFields = _el('bulkFields');
  
  function toggleFields() {
    if (singleRadio?.checked) {
      _showBlock(singleFields);
      _hideBlock(ownerFields);
      console.log('[DEBUG] Başvuru numarası alanı aktif');
    } else if (ownerRadio?.checked) {
      _hideBlock(singleFields);
      _showBlock(ownerFields);
      console.log('[DEBUG] Sahip numarası alanı aktif');
    }
    // Sonuçları temizle
    _hideBlock(singleResultContainer);
    if (singleResultInner) singleResultInner.innerHTML = '';
  }
  
  singleRadio?.addEventListener('change', toggleFields);
  ownerRadio?.addEventListener('change', toggleFields);
  
  // Initial state
  toggleFields();
}

// ===============================
// ANA SORGULAMA FONKSİYONU
// ===============================

async function handleQuery() {
  // Hangi alan dolu?
  const basvuruNo = (basvuruNoInput?.value || '').trim();
  const sahipNo = (sahipNoInput?.value || '').trim();
  
  console.log('[DEBUG] handleQuery çağrıldı:', { basvuruNo, sahipNo });
  
  if (basvuruNo && !sahipNo) {
    // BAŞVURU NUMARASI VAR
    await queryByApplicationNumber(basvuruNo);
    
  } else if (sahipNo && !basvuruNo) {
    // SAHİP NUMARASI VAR - Simple Loading ile
    let loading = window.showLoadingWithCancel(
      'TÜRKPATENT sorgulanıyor',
      'Sahip numarası ile kayıtlar araştırılıyor...',
      () => {
        console.log('[DEBUG] Sorgu iptal edildi');
        if (window.currentLoading) {
          window.currentLoading = null;
        }
      }
    );

    console.log('[DEBUG] Sahip numarası eklentiye yönlendiriliyor:', sahipNo);
    
    window.searchedOwnerNumber = sahipNo;
    const url = `https://www.turkpatent.gov.tr/arastirma-yap?form=trademark&auto_query=${encodeURIComponent(sahipNo)}&query_type=sahip&source=${encodeURIComponent(window.location.origin)}`;
    console.log('[DEBUG] TÜRKPATENT URL açılıyor:', url);
    
    const newWindow = window.open(url, '_blank');
    if (!newWindow) {
      loading.showError('Pop-up engellendi. Tarayıcı ayarlarından pop-up\'ları açın.');
      return;
    }

    // Loading referansını global'e kaydet
    window.currentLoading = loading;
    
  } else if (basvuruNo && sahipNo) {
    // İKİSİ DE DOLU
    showToast('Lütfen sadece bir alan doldurun.', 'warning');
    
  } else {
    // İKİSİ DE BOŞ
    showToast('Başvuru numarası veya sahip numarası girin.', 'warning');
  }
}

// ===============================
// BAŞVURU NUMARASI SORGULAMA
// ===============================

async function queryByApplicationNumber(basvuruNo) {
  console.log('[DEBUG] Başvuru numarası eklentiye yönlendiriliyor (scrapeTrademark DEVREDİŞI):', basvuruNo);

  try {
    _showBlock(loadingEl);
    _hideBlock(singleResultContainer);

    // ÖNEMLİ: scrapeTrademark fonksiyonunu devre dışı bırak
    window.skipScrapeTrademark = true;

    // TÜRKPATENT sayfasını aç (eklentinin otomatik akışı için)
    const turkPatentUrl = `https://www.turkpatent.gov.tr/arastirma-yap?form=trademark&auto_query=${encodeURIComponent(basvuruNo)}&query_type=basvuru&source=${encodeURIComponent(window.location.origin)}`;
    console.log('[DEBUG] TÜRKPATENT URL açılıyor (başvuru):', turkPatentUrl);

    // Simple Loading ile kontrol
    let loading = window.showLoadingWithCancel?.(
      'TÜRKPATENT sorgulanıyor',
      'Başvuru numarası ile kayıt araştırılıyor (sadece eklenti)...',
      () => {
        console.log('[DEBUG] Sorgu iptal edildi (basvuru)');
        if (window.currentLoading) window.currentLoading = null;
        // İptal edilince flag'i temizle
        window.skipScrapeTrademark = false;
      }
    );

    const newWindow = window.open(turkPatentUrl, '_blank');
    if (!newWindow) {
      if (loading && loading.showError) loading.showError('Pop-up engellendi. Tarayıcı ayarlarından pop-up\'ları açın.');
      _hideBlock(loadingEl);
      // Hata durumunda flag'i temizle
      window.skipScrapeTrademark = false;
      return;
    }

    // Loading referansını global'e kaydet
    window.currentLoading = loading || null;

    // Zaman aşımı emniyeti (flag'i de temizle)
    setTimeout(() => { 
      try { _hideBlock(loadingEl); } catch {} 
      window.skipScrapeTrademark = false;
    }, 45000);

    showToast('TÜRKPATENT sayfası açıldı. Eklenti çalışacak ve sonuçları gönderecek.', 'info');
  } catch (err) {
    _hideBlock(loadingEl);
    // Hata durumunda flag'i temizle
    window.skipScrapeTrademark = false;
    console.error('[DEBUG] Başvuru numarası sorgulama hatası (eklentili):', err);
    showToast('İşlem hatası: ' + (err?.message || err), 'danger');
  }
}

// ===============================
// SAHİP NUMARASI SORGULAMA
// ===============================

async function queryByOwnerNumber(sahipNo) {
  console.log('[DEBUG] Sahip numarası eklentiye yönlendiriliyor:', sahipNo);
  
  try {
    _showBlock(loadingEl);
    _hideBlock(singleResultContainer);
    
    window.searchedOwnerNumber = sahipNo;
    // TÜRKPATENT sayfasını aç
    const turkPatentUrl = `https://www.turkpatent.gov.tr/arastirma-yap?form=trademark&auto_query=${encodeURIComponent(sahipNo)}&query_type=sahip&source=${encodeURIComponent(window.location.origin)}`;
    
    console.log('[DEBUG] TÜRKPATENT URL açılıyor:', turkPatentUrl);
    
    // Yeni sekme aç
    const newWindow = window.open(turkPatentUrl, '_blank');
    
    if (newWindow) {
      showToast('TÜRKPATENT sayfası açıldı. Eklenti çalışacak ve sonuçları gönderecek.', 'info');
      
      // Timeout
      setTimeout(() => {
        _hideBlock(loadingEl);
      }, 45000);
      
    } else {
      _hideBlock(loadingEl);
      showToast('Pop-up engellendi. Tarayıcı ayarlarından pop-up\'ları açın.', 'danger');
    }

  } catch (err) {
    _hideBlock(loadingEl);
    console.error('[DEBUG] Sahip numarası sorgulama hatası:', err);
    showToast('İşlem hatası: ' + (err.message || err), 'danger');
  }
}

// ===============================
// OTOMATİK SAHİP EŞLEŞTİRME
// ===============================

function autoMatchOwnerByTpeNo(searchedTpeNo) {
  console.log('[DEBUG] 🔍 Otomatik sahip eşleştirme başladı:', searchedTpeNo);
  console.log('[DEBUG] allPersons sayısı:', allPersons?.length || 0);
  console.log('[DEBUG] selectedRelatedParties mevcut:', selectedRelatedParties?.length || 0);
  
  if (!searchedTpeNo) {
    console.log('[DEBUG] ❌ Sahip no boş');
    return;
  }
  
  if (!allPersons?.length) {
    console.log('[DEBUG] ❌ Kişi listesi boş veya yüklenmemiş');
    showToast('Kişi listesi henüz yüklenmemiş. Lütfen bekleyin.', 'warning');
    return;
  }
  
  console.log('[DEBUG] Kişi listesindeki TPE No\'lar:', allPersons.map(p => ({
    name: p.name,
    tpeNo: p.tpeNo,
    type: typeof p.tpeNo
  })));
  
  // TPE No ile eşleşen kişi ara
  const matchedPerson = allPersons.find(person => {
    const personTpeNo = String(person.tpeNo || '').trim();
    const searchTpeNo = String(searchedTpeNo || window.searchedOwnerNumber || '').trim();
    
    console.log(`[DEBUG] Karşılaştırma: "${personTpeNo}" === "${searchTpeNo}"`);
    
    return personTpeNo && searchTpeNo && personTpeNo === searchTpeNo;
  });
  
  console.log('[DEBUG] Eşleşen kişi:', matchedPerson || 'Bulunamadı');
  
  if (matchedPerson) {
    console.log('[DEBUG] ✅ Eşleşen kişi bulundu:', matchedPerson.name, 'TPE No:', matchedPerson.tpeNo);
    
    const alreadyAdded = selectedRelatedParties.find(p => p.id === matchedPerson.id);
    
    if (!alreadyAdded) {
      selectedRelatedParties.push({
        id: matchedPerson.id,
        name: matchedPerson.name,
        email: matchedPerson.email || '',
        phone: matchedPerson.phone || '',
        tpeNo: matchedPerson.tpeNo || ''
      });
      
      renderSelectedRelatedParties();
      showToast(`✅ ${matchedPerson.name} otomatik olarak sahip listesine eklendi`, 'success');
      console.log('[DEBUG] ✅ Kişi sahip listesine eklendi');
    } else {
      console.log('[DEBUG] ⚠️ Kişi zaten listede mevcut');
      showToast(`${matchedPerson.name} zaten sahip listesinde`, 'info');
    }
  } else {
    console.log('[DEBUG] ❌ Bu TPE No ile eşleşen kişi bulunamadı');
  }
}

// ===============================
// EKLENTİ MESAJ DİNLEYİCİSİ
// ===============================


// === Auto add owner helper ===
function tryAutoAddOwner(searchedTpeNo) {
  try {
    if (!Array.isArray(allPersons) || !allPersons.length) {
      console.log('[DEBUG] ❌ Kişi listesi boş veya yüklenmemiş');
      showToast('Kişi listesi henüz yüklenmemiş. Lütfen bekleyin.', 'warning');
      return;
    }
    const searchTpeNo = String(searchedTpeNo || window.searchedOwnerNumber || '').trim();
    console.log('[DEBUG] AutoAddOwner - aranan TPE No:', searchTpeNo);
    const matchedPerson = allPersons.find(p => String(p.tpeNo || '').trim() === searchTpeNo);
    console.log('[DEBUG] AutoAddOwner - eşleşen kişi:', matchedPerson || 'Bulunamadı');
    if (matchedPerson) {
      const already = selectedRelatedParties.find(x => x.id === matchedPerson.id);
      if (!already) {
        selectedRelatedParties.push({
          id: matchedPerson.id,
          name: matchedPerson.name,
          email: matchedPerson.email || '',
          phone: matchedPerson.phone || '',
          tpeNo: matchedPerson.tpeNo || ''
        });
        renderSelectedRelatedParties();
        showToast(`✅ ${matchedPerson.name} otomatik olarak sahip listesine eklendi`, 'success');
      } else {
        showToast(`${matchedPerson.name} zaten sahip listesinde`, 'info');
      }
    }
  } catch (err) {
    console.warn('tryAutoAddOwner error:', err);
  }
}

function setupExtensionMessageListener() {
  console.log('[DEBUG] Eklenti mesaj dinleyicisi kuruluyor...');
  
  // Global batch state - temizle
  window.batchResults = [];
  window.batchProgress = null;
  
  window.addEventListener('message', (event) => {
    const allowedOrigins = [
      window.location.origin,
      'https://www.turkpatent.gov.tr',
      'https://turkpatent.gov.tr'
    ];
    
    if (!allowedOrigins.includes(event.origin)) return;
    
    if (event.data && event.data.source === 'tp-extension-sahip') {
      console.log('[DEBUG] Eklenti mesajı alındı:', event.data);
      
      if (event.data.type === 'SORGU_BASLADI') {
        console.log('[DEBUG] Eklenti sorguyu başlattı');
        if (window.currentLoading) {
          window.currentLoading.updateText('Sorgu çalıştırılıyor', 'Sonuçlar yükleniyor...');
        }
        showToast('TÜRKPATENT sayfasında sorgu başladı...', 'info');
      }
      
      else if (event.data.type === 'BATCH_VERI_GELDI_KISI') {
        window.isProgressiveMode = true; // progressive mode aktif
        // YENİ: Progressive batch loading
        const { batch, batchNumber, totalBatches, processedCount, totalCount, isComplete } = event.data.data;
        
        console.log(`[DEBUG] Batch ${batchNumber}/${totalBatches} alındı: ${batch.length} kayıt`);
        
        // Duplicate kontrolü ile batch'i ekle
        batch.forEach(item => {
          const exists = window.batchResults.some(existing => 
            existing.applicationNumber && 
            existing.applicationNumber === item.applicationNumber
          );
          if (!exists) {
            window.batchResults.push(item);
          }
        });
        
        // Loading güncelle
        if (window.currentLoading) {
          const progress = Math.round((processedCount / totalCount) * 100);
          window.currentLoading.updateText(
            `Veriler işleniyor (${progress}%)`,
            `${processedCount}/${totalCount} kayıt işlendi - Batch ${batchNumber}/${totalBatches}`
          );
        }
        
        // İlk batch geldiğinde tabloyu başlat, sonrakiler için append
        /* Progressive batch: always re-render full list to avoid missing rows */
        renderOwnerResults(window.batchResults);
        try { setupCheckboxListeners(); updateSaveButton(); } catch (e) { console.warn('listeners refresh failed', e); }
        
        showToast(`Batch ${batchNumber}/${totalBatches} yüklendi`, 'info');
        
        // Son batch ise complete olarak işaretle
        if (isComplete) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('message', {
              detail: {
                origin: event.origin,
                data: {
                  source: 'tp-extension-sahip',
                  type: 'VERI_GELDI_KISI_COMPLETE',
                  data: { totalProcessed: window.batchResults.length }
                }
              }
            }));
          }, 500);
        }
      }
      
      else if (event.data.type === 'VERI_GELDI_KISI_COMPLETE') {
        // Tüm process tamamlandı - SADECE EVENT LISTENERS GÜNCELLE
        console.log('[DEBUG] Tüm batch işlemi tamamlandı');
        
        if (window.currentLoading) {
          window.currentLoading.showSuccess(`${window.batchResults.length} kayıt başarıyla yüklendi!`);
          window.currentLoading = null;
        }
        
        showToast(`Tüm veriler yüklendi: ${window.batchResults.length} kayıt`, 'success');
        
        // SADECE event listeners'ı güncelle, tekrar render etme
        currentOwnerResults = window.batchResults;
        setupCheckboxListeners();
        updateSaveButton();
      }
      
      else if (event.data.type === 'VERI_GELDI_KISI') {
        // Eğer progressive mod aktifse, legacy mesajı yok say
        if (window.isProgressiveMode) { console.log('[DEBUG] Legacy VERI_GELDI_KISI progressive modda yok sayıldı'); return; }
        // Eski format - geriye uyumluluk - TEK RENDER
        _hideBlock(loadingEl);
        const data = event.data.data || [];
        
        if (window.currentLoading) {
          window.currentLoading.updateText('Veriler işleniyor', 'Sonuçlar hazırlanıyor...');
        }
        
        if (!data.length) {
          if (window.currentLoading) {
            window.currentLoading.showError('Bu sahip numarası için sonuç bulunamadı.');
            window.currentLoading = null;
          }
          showToast('Bu sahip numarası için sonuç bulunamadı.', 'warning');
        } else {
          // TEK SEFER RENDER - başka render çağrısı YOK
          renderOwnerResults(data);
          
          try { if (window.searchedOwnerNumber) { tryAutoAddOwner(window.searchedOwnerNumber); } } catch (e) { console.warn('Owner autofill failed:', e); }
          if (window.currentLoading) {
            window.currentLoading.showSuccess(`${data.length} kayıt başarıyla alındı!`);
            window.currentLoading = null;
          }
          showToast(`${data.length} kayıt başarıyla alındı.`, 'success');
        }
      } 
      
      else if (event.data.type === 'HATA_KISI') {
        _hideBlock(loadingEl);
        const errorMsg = event.data.data?.message || 'Bilinmeyen Hata';
        
        if (window.currentLoading) {
          window.currentLoading.showError('Eklenti hatası: ' + errorMsg);
          window.currentLoading = null;
        }
        showToast('Eklenti hatası: ' + errorMsg, 'danger');
        
        // Batch state'i temizle
        window.batchResults = [];
      }
      
      else if (event.data.type === 'VERI_GELDI_BASVURU') {
        _hideBlock(loadingEl);
        window.skipScrapeTrademark = false;
        const data = event.data.data;
        
        // DEBUG: Veri yapısını kontrol et
        console.log('[DEBUG] VERI_GELDI_BASVURU - data yapısı:', data);
        if (data && data.length > 0) {
          console.log('[DEBUG] data[0] yapısı:', data[0]);
          console.log('[DEBUG] data[0] keys:', Object.keys(data[0]));
        }

        if (!data || !data.length) {
          if (window.currentLoading) {
            window.currentLoading.showError('Bu başvuru numarası için sonuç bulunamadı.');
            window.currentLoading = null;
          }
          showToast('Bu başvuru numarası için sonuç bulunamadı.', 'warning');
        } else {
          // Başvuru numarası verilerini zenginleştir
          const enrichedData = data.map(item => {
            // renewalDate hesapla
            let renewalDate = null;
            
            // Koruma tarihi varsa + 10 yıl
            if (item.details && item.details['Koruma Tarihi']) {
              const korumaDateStr = item.details['Koruma Tarihi'];
              const korumaDate = parseDate(korumaDateStr); // DD.MM.YYYY -> Date
              if (korumaDate) {
                const renewal = new Date(korumaDate);
                renewal.setFullYear(renewal.getFullYear() + 10);
                renewalDate = renewal.toISOString().split('T')[0]; // YYYY-MM-DD format
              }
            }
            
            // Tescil tarihi varsa + 10 yıl (koruma tarihi yoksa)
            if (!renewalDate && item.registrationDate) {
              const regDate = new Date(item.registrationDate);
              if (!isNaN(regDate.getTime())) {
                const renewal = new Date(regDate);
                renewal.setFullYear(renewal.getFullYear() + 10);
                renewalDate = renewal.toISOString().split('T')[0];
              }
            }
            
            return {
              ...item,
              renewalDate: renewalDate
            };
          });
          
          // Tek sonuç için renderSingleResult kullan
          renderSingleResult(enrichedData[0]);
          
          if (window.currentLoading) {
            window.currentLoading.showSuccess('Başvuru numarası sonucu başarıyla alındı!');
            window.currentLoading = null;
          }
          showToast('Başvuru numarası sonucu başarıyla alındı.', 'success');
        }
      } 
      
      else if (event.data.type === 'HATA_BASVURU') {
        _hideBlock(loadingEl);
        window.skipScrapeTrademark = false;
        const errorMsg = event.data.data?.message || 'Başvuru numarası sorgulama hatası';
        
        if (window.currentLoading) {
          window.currentLoading.showError(errorMsg);
          window.currentLoading = null;
        }
        showToast(errorMsg, 'danger');
      }
    }
  });
  
  console.log('[DEBUG] ✅ Eklenti mesaj dinleyicisi kuruldu.');
}

// Yardımcı fonksiyon - tablo sayacını güncelle
function updateTableRowCount() {
  const bulkMeta = document.getElementById('bulkMeta');
  if (bulkMeta && currentOwnerResults?.length) {
    bulkMeta.textContent = `(${currentOwnerResults.length} kayıt)`;
  }
}

// ===============================
// RENDER FONKSİYONLARI
// ===============================

function renderSingleResult(payload) {
  console.log('[DEBUG] renderSingleResult çağrıldı, payload:', payload);
  const d = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  console.log('[DEBUG] renderSingleResult - parsed d:', d);
  
  // Tek sonucu da tablo formatında göster
  renderOwnerResults([d]);
}

function renderOwnerResults(items) {
  if (!items?.length) return;
  
  console.log('🔄 renderOwnerResults başladı:', items.length, 'kayıt');
  const startTime = performance.now();
  
  // Sahip bilgisini hızlıca bul
  const ownerRecord = items.find(item => item.ownerName?.trim());
  const ownerInfo = ownerRecord ? ` - Sahip: ${ownerRecord.ownerName}` : '';

  // Fragment kullanarak hızlı DOM oluşturma
  const container = document.createElement('div');
  container.className = 'section-card';
  
  // Header kısmı
  const header = document.createElement('div');
  header.className = 'results-header d-flex justify-content-between align-items-center mb-3';
  header.innerHTML = `
    <div><strong>${items.length} sonuç bulundu${ownerInfo}</strong> <small class="text-muted" id="bulkMeta"></small></div>
    <div>
      <button id="exportCsvBtn" class="btn btn-outline-primary btn-sm"><i class="fas fa-file-csv mr-1"></i> CSV Dışa Aktar</button>
    </div>
  `;
  
  // Tablo wrapper
  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-responsive';
  
  // Tablo ve header
  const table = document.createElement('table');
  table.className = 'table table-hover table-striped tp-results-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th><input type="checkbox" id="selectAllRecords" checked></th>
        <th>Görsel</th>
        <th>Başvuru Numarası</th>
        <th>Marka Adı</th>
        <th>Başvuru Tarihi</th>
        <th>Tescil No</th>
        <th>Durumu</th>
        <th>Nice Sınıfları</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  
  const tbody = table.querySelector('tbody');
  
  // Array.map ile hızlı row oluşturma
  const rows = items.map((item, i) => {
    const imgSrc = item.brandImageDataUrl || item.brandImageUrl || item.imageSrc;
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="record-checkbox" data-index="${i}" checked></td>
      <td>${imgSrc ? `<img src="${imgSrc}" alt="" style="height:56px;max-width:120px;border:1px solid #eee;border-radius:6px;" />` : ''}</td>
      <td>${item.applicationNumber || ''}</td>
      <td>${item.brandName || ''}</td>
      <td>${fmtDateToTR(item.applicationDate || '')}</td>
      <td>${item.registrationNumber || ''}</td>
      <td>${item.status || ''}</td>
      <td>${item.niceClasses || ''}</td>
    `;
    
    return row;
  });
  
  // Batch DOM insertion (DocumentFragment kullan)
  const fragment = document.createDocumentFragment();
  rows.forEach(row => fragment.appendChild(row));
  tbody.appendChild(fragment);
  
  // Assembly
  tableWrapper.appendChild(table);
  container.appendChild(header);
  container.appendChild(tableWrapper);
  
  // Global değişkene kaydet
  currentOwnerResults = items;

  // Single DOM manipulation
  singleResultInner.innerHTML = '';
  singleResultInner.appendChild(container);
  _showBlock(singleResultContainer);
  
  const endTime = performance.now();
  console.log(`✅ renderOwnerResults tamamlandı: ${(endTime - startTime).toFixed(2)}ms`);
  
  // ✅ SONUÇLAR RENDER EDİLDİKTEN SONRA SAHİP EŞLEŞTİRME
  if (window.searchedOwnerNumber) {
    console.log('[DEBUG] UI hazır, şimdi sahip eşleştirme yapılıyor...');
    setTimeout(() => {
      autoMatchOwnerByTpeNo(window.searchedOwnerNumber);
      window.searchedOwnerNumber = null; // Temizle
    }, 100); // UI'ın tam yüklenmesi için kısa bekleme
  }
  
  // Event listeners - requestAnimationFrame ile asenkron yap
  requestAnimationFrame(() => {
    setupCheckboxListeners();
    updateSaveButton();
    
    // CSV export event listener
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportOwnerResultsCSV);
    }
  });
}

function setupCheckboxListeners() {
  const selectAll = document.getElementById('selectAllRecords');
  const checkboxes = document.querySelectorAll('.record-checkbox');
  
  if (!selectAll || !checkboxes.length) return;
  
  // Event delegation kullan (daha performanslı)
  const handleChange = (e) => {
    if (e.target.id === 'selectAllRecords') {
      const checked = e.target.checked;
      checkboxes.forEach(cb => cb.checked = checked);
    } else if (e.target.classList.contains('record-checkbox')) {
      const allChecked = Array.from(checkboxes).every(c => c.checked);
      const noneChecked = Array.from(checkboxes).every(c => !c.checked);
      
      selectAll.checked = allChecked;
      selectAll.indeterminate = !allChecked && !noneChecked;
    }
    
    updateSaveButton();
  };
  
  // Single event listener
  document.addEventListener('change', handleChange);
}

function updateSaveButton() {
  const saveBtn = document.getElementById('savePortfolioBtn');
  if (!saveBtn) return;
  
  const checkedCount = document.querySelectorAll('.record-checkbox:checked').length;
  saveBtn.disabled = checkedCount === 0;
}


// CSV Export fonksiyonu
function exportOwnerResultsCSV() {
  if (!currentOwnerResults?.length) {
    showToast('Dışa aktarılacak veri yok.', 'warning');
    return;
  }
  
  // Worker kullanmadan hızlı CSV oluşturma
  const headers = ['Sıra','Başvuru Numarası','Marka Adı','Marka Sahibi','Başvuru Tarihi','Tescil No','Durumu','Nice Sınıfları','Görsel'];
  
  // Array.map ile hızlı dönüşüm
  const csvContent = [
    headers.join(','),
    ...currentOwnerResults.map((x, i) => [
      i+1,
      x.applicationNumber || '',
      x.brandName || '',
      x.ownerName || '',
      fmtDateToTR(x.applicationDate || ''),
      x.registrationNumber || '',
      x.status || '',
      x.niceClasses || '',
      (x.brandImageDataUrl || x.brandImageUrl || x.imageSrc) ? 'VAR' : ''
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))
  ].join('\n');
  
  // Blob ve download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `turkpatent_sahip_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('CSV dosyası indirildi.', 'success');
}

// ===============================
// KİŞİ YÖNETİMİ FONKSİYONLARI
// ===============================

function searchPersons(searchQuery) {
  if (!searchQuery || searchQuery.length < 2) return;
  
  const filtered = allPersons.filter(person => {
    const name = (person.name || '').toLowerCase();
    const tpeNo = (person.tpeNo || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query) || tpeNo.includes(query);
  }).slice(0, 10);

  if (!filtered.length) {
    relatedPartySearchResults.innerHTML = '<div class="search-result-item">Sonuç bulunamadı</div>';
  } else {
    relatedPartySearchResults.innerHTML = filtered.map(person => 
      `<div class="search-result-item" data-id="${person.id}">
        <strong>${person.name}</strong>
        ${person.tpeNo ? `<br><small class="text-muted">TPE No: ${person.tpeNo}</small>` : ''}
      </div>`
    ).join('');
  }
  
  _showBlock(relatedPartySearchResults);
}

function addRelatedParty(person) {
  if (selectedRelatedParties.find(p => p.id === person.id)) {
    showToast('Bu kişi zaten eklenmiş.', 'warning');
    return;
  }
  selectedRelatedParties.push(person);
  renderSelectedRelatedParties();
}

function removeRelatedParty(personId) {
  selectedRelatedParties = selectedRelatedParties.filter(p => p.id !== personId);
  renderSelectedRelatedParties();
}

function renderSelectedRelatedParties() {
  const list = _el('relatedPartyList');
  const countEl = _el('relatedPartyCount');

  if (!list) return;

  if (selectedRelatedParties.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <i class="fas fa-user-friends fa-3x text-muted mb-3"></i>
      <p class="text-muted">Henüz taraf eklenmedi.</p>
    </div>`;
  } else {
    list.innerHTML = selectedRelatedParties.map(p =>
      `<div class="selected-item d-flex justify-content-between align-items-center p-2 mb-2 border rounded">
        <span>${p.name} <small class="text-muted">TPE No: ${p.tpeNo || ''}</small></span>
        <button type="button" class="btn btn-sm btn-danger remove-selected-item-btn" data-id="${p.id}">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>`
    ).join('');
  }

  if (countEl) countEl.textContent = selectedRelatedParties.length;
}

// EKLE: tp-file-transfer.js'e
function appendBatchToTable(batchItems) {
  const tbody = document.querySelector('.tp-results-table tbody');
  if (!tbody) return;
  
  const startIndex = window.batchResults.length - batchItems.length;
  
  const fragment = document.createDocumentFragment();
  
  batchItems.forEach((item, localIdx) => {
    const globalIdx = startIndex + localIdx;
    const imgSrc = item.brandImageDataUrl || item.brandImageUrl || item.imageSrc;
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="record-checkbox" data-index="${globalIdx}" checked></td>
      <td>${imgSrc ? `<img src="${imgSrc}" alt="" style="height:56px;max-width:120px;border:1px solid #eee;border-radius:6px;" />` : ''}</td>
      <td>${item.applicationNumber || ''}</td>
      <td>${item.brandName || ''}</td>
      <td>${fmtDateToTR(item.applicationDate || '')}</td>
      <td>${item.registrationNumber || ''}</td>
      <td>${item.status || ''}</td>
      <td>${item.niceClasses || ''}</td>
    `;
    
    fragment.appendChild(row);
  });
  
  tbody.appendChild(fragment);
  
  // Sonuç sayısını güncelle
  const resultsHeader = document.querySelector('.results-header strong');
  if (resultsHeader) {
    resultsHeader.textContent = `${window.batchResults.length} sonuç bulundu`;
  }
}

// ===============================
// SAYFA YÜKLENDİĞİNDE BAŞLAT
// ===============================

document.addEventListener('DOMContentLoaded', () => {
  loadSharedLayout();
  init();
});
