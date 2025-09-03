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

// --- Firebase Imports ---
import { app } from '../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { loadSharedLayout, ensurePersonModal, openPersonModal } from './layout-loader.js';
import { personService } from '../firebase-config.js';

// --- Firebase Functions ---
const functions = getFunctions(app, 'europe-west1');
const scrapeTrademarkFunction = httpsCallable(functions, 'scrapeTrademark', { timeout: 120000 });

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
    // SAHİP NUMARASI VAR  
    await queryByOwnerNumber(sahipNo);
    
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
  console.log('[DEBUG] Başvuru numarası sorgulanıyor:', basvuruNo);
  
  try {
    _showBlock(loadingEl);
    _hideBlock(singleResultContainer);
    
    const result = await scrapeTrademarkFunction({ basvuruNo });
    const data = result?.data || {};
    
    if (!data || data.found === false) {
      showToast(data?.message || 'Bu başvuru numarası için sonuç bulunamadı.', 'warning');
    } else {
      renderSingleResult(data);
      showToast('Başvuru bilgileri başarıyla alındı.', 'success');
    }
  } catch (err) {
    console.error('[DEBUG] Başvuru numarası sorgulama hatası:', err);
    showToast('Sorgulama hatası: ' + (err?.message || err), 'danger');
  } finally {
    _hideBlock(loadingEl);
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
    
    // TÜRKPATENT sayfasını aç
    const turkPatentUrl = `https://www.turkpatent.gov.tr/arastirma-yap?form=trademark&auto_query=${encodeURIComponent(sahipNo)}&query_type=sahip&source=${encodeURIComponent(window.location.origin)}`;
    
    console.log('[DEBUG] TÜRKPATENT URL açılıyor:', turkPatentUrl);
    
    // Yeni sekme aç
const newWindow = window.open(turkPatentUrl, '_blank'); // opener kalsın (mesaj için gerekli)
    
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
// EKLENTİ MESAJ DİNLEYİCİSİ
// ===============================

function setupExtensionMessageListener() {
  console.log('[DEBUG] Eklenti mesaj dinleyicisi kuruluyor...');
  
  window.addEventListener('message', (event) => {
    // Güvenlik kontrolü
    const allowedOrigins = [
      window.location.origin,
      'https://www.turkpatent.gov.tr',
      'https://turkpatent.gov.tr'
    ];
    
    if (!allowedOrigins.includes(event.origin)) return;
    
    if (event.data && event.data.source === 'tp-extension-sahip') {
      console.log('[DEBUG] Eklenti mesajı alındı:', event.data);
      
      if (event.data.type === 'VERI_GELDI_KISI') {
        _hideBlock(loadingEl);
        const data = event.data.data || [];
        
        if (!data.length) {
          showToast('Bu sahip numarası için sonuç bulunamadı.', 'warning');
        } else {
          renderOwnerResults(data);
          showToast(`${data.length} kayıt başarıyla alındı.`, 'success');
        }
        
      } else if (event.data.type === 'HATA_KISI') {
        _hideBlock(loadingEl);
        const errorMsg = event.data.data?.message || 'Bilinmeyen Hata';
        showToast('Eklenti hatası: ' + errorMsg, 'danger');
        
      } else if (event.data.type === 'SORGU_BASLADI') {
        showToast('TÜRKPATENT sayfasında sorgu başladı...', 'info');
      }
    }
  });
  
  console.log('[DEBUG] ✅ Eklenti mesaj dinleyicisi kuruldu.');
}

// ===============================
// RENDER FONKSİYONLARI
// ===============================

function renderSingleResult(payload) {
  const d = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  
  const trademarkName = d.trademarkName || '';
  const status = d.status || '';
  const imageUrl = d.imageSignedUrl || d.publicImageUrl || d.imageUrl || '';
  const owner = d.owner || '';
  const ownerId = d.ownerId || '';
  const ownerAddress = d.ownerAddress || '';
  const applicationNumber = d.applicationNumber || '';
  const applicationDate = fmtDateToTR(d.applicationDate || '');
  const registrationNumber = d.registrationNumber || '';
  const registrationDate = fmtDateToTR(d.registrationDate || '');
  const intlRegNo = d.intlRegistrationNumber || d.internationalRegistrationNumber || '';
  const protectionDate = fmtDateToTR(d.protectionDate || '');
  const type = d.type || d.trademarkType || '';
  const niceClasses = Array.isArray(d.niceClasses) ? d.niceClasses : [];
  const goods = Array.isArray(d.goods) ? d.goods : [];

  const niceStr = niceClasses.map(n => `Sınıf ${n}`).join(', ');
  const goodsStr = goods.length ? goods.join(', ') : '';

  let imageHTML = '';
  if (imageUrl) {
    imageHTML = `<div class="trademark-image-container mb-3">
      <img src="${imageUrl}" alt="Marka Görseli" class="trademark-image" style="max-width: 200px; max-height: 200px; border: 1px solid #ddd; border-radius: 8px;" />
    </div>`;
  }

  const htmlContent = `
    ${imageHTML}
    <div class="trademark-details">
      <div class="row">
        <div class="col-md-6">
          <div class="detail-group">
            <label class="detail-label">Marka Adı:</label>
            <div class="detail-value">${trademarkName || '—'}</div>
          </div>
          <div class="detail-group">
            <label class="detail-label">Başvuru Numarası:</label>
            <div class="detail-value">${applicationNumber || '—'}</div>
          </div>
          <div class="detail-group">
            <label class="detail-label">Başvuru Tarihi:</label>
            <div class="detail-value">${applicationDate || '—'}</div>
          </div>
          <div class="detail-group">
            <label class="detail-label">Tescil Numarası:</label>
            <div class="detail-value">${registrationNumber || '—'}</div>
          </div>
          <div class="detail-group">
            <label class="detail-label">Tescil Tarihi:</label>
            <div class="detail-value">${registrationDate || '—'}</div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="detail-group">
            <label class="detail-label">Durumu:</label>
            <div class="detail-value">${status || '—'}</div>
          </div>
          <div class="detail-group">
            <label class="detail-label">Sahibi:</label>
            <div class="detail-value">${owner || '—'}</div>
          </div>
          <div class="detail-group">
            <label class="detail-label">Sahip ID:</label>
            <div class="detail-value">${ownerId || '—'}</div>
          </div>
          <div class="detail-group">
            <label class="detail-label">Sahip Adresi:</label>
            <div class="detail-value">${ownerAddress || '—'}</div>
          </div>
          <div class="detail-group">
            <label class="detail-label">Marka Türü:</label>
            <div class="detail-value">${type || '—'}</div>
          </div>
        </div>
      </div>
      ${intlRegNo ? `
      <div class="detail-group">
        <label class="detail-label">Uluslararası Tescil No:</label>
        <div class="detail-value">${intlRegNo}</div>
      </div>` : ''}
      ${protectionDate ? `
      <div class="detail-group">
        <label class="detail-label">Koruma Tarihi:</label>
        <div class="detail-value">${protectionDate}</div>
      </div>` : ''}
      ${niceStr ? `
      <div class="detail-group">
        <label class="detail-label">Nice Sınıfları:</label>
        <div class="detail-value">${niceStr}</div>
      </div>` : ''}
      ${goodsStr ? `
      <div class="detail-group">
        <label class="detail-label">Mal/Hizmetler:</label>
        <div class="detail-value">${goodsStr}</div>
      </div>` : ''}
    </div>
  `;

  singleResultInner.innerHTML = htmlContent;
  _showBlock(singleResultContainer);
}

function renderOwnerResults(items) {
  if (!items || !items.length) {
    singleResultInner.innerHTML = '<p class="text-muted">Sonuç bulunamadı.</p>';
    _showBlock(singleResultContainer);
    return;
  }

  const total = items.length;
  const firstItem = items[0];
  const ownerName = firstItem.ownerName || '';
  
  let tableHTML = `
    <div class="owner-results">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h5>Sahip: ${ownerName} • ${total} kayıt</h5>
        <button class="btn btn-outline-primary btn-sm" onclick="exportOwnerResultsCSV()">
          <i class="fas fa-file-csv mr-1"></i> CSV Dışa Aktar
        </button>
      </div>
      <div class="table-responsive">
        <table class="table table-hover table-striped">
          <thead>
            <tr>
              <th>#</th>
              <th>Başvuru Numarası</th>
              <th>Marka Adı</th>
              <th>Başvuru Tarihi</th>
              <th>Tescil No</th>
              <th>Durumu</th>
              <th>Nice Sınıfları</th>
            </tr>
          </thead>
          <tbody>`;

  items.forEach((item, index) => {
    tableHTML += `
      <tr>
        <td>${index + 1}</td>
        <td>${item.applicationNumber || ''}</td>
        <td>${item.brandName || ''}</td>
        <td>${fmtDateToTR(item.applicationDate || '')}</td>
        <td>${item.registrationNumber || ''}</td>
        <td>${item.status || ''}</td>
        <td>${item.niceClasses || ''}</td>
      </tr>`;
  });

  tableHTML += `
          </tbody>
        </table>
      </div>
    </div>`;

  // Global değişkene kaydet (CSV export için)
  currentOwnerResults = items;

  singleResultInner.innerHTML = tableHTML;
  _showBlock(singleResultContainer);
}

// CSV Export fonksiyonu
window.exportOwnerResultsCSV = function() {
  if (!currentOwnerResults || !currentOwnerResults.length) {
    showToast('Dışa aktarılacak veri yok.', 'warning');
    return;
  }
  
  const headers = ['Sıra','Başvuru Numarası','Marka Adı','Marka Sahibi','Başvuru Tarihi','Tescil No','Durumu','Nice Sınıfları'];
  const rows = currentOwnerResults.map((x, i) => [
    i+1,
    x.applicationNumber || '',
    x.brandName || '',
    x.ownerName || '',
    fmtDateToTR(x.applicationDate || ''),
    x.registrationNumber || '',
    x.status || '',
    x.niceClasses || ''
  ]);
  
  const csv = [headers].concat(rows).map(r => 
    r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')
  ).join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `turkpatent_sahip_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  
  showToast('CSV dosyası indirildi.', 'success');
};

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

// ===============================
// SAYFA YÜKLENDİĞİNDE BAŞLAT
// ===============================

document.addEventListener('DOMContentLoaded', () => {
  loadSharedLayout();
  init();
});