// --- DOM helpers ---
function _el(id){ return document.getElementById(id); }
function _showBlock(el){ if(!el) return; el.classList.remove('hide'); el.style.display=''; }
function _hideBlock(el){ if(!el) return; el.classList.add('hide'); }
function showToast(msg, type='info'){
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
function fmtDateToTR(isoOrDDMMYYYY){
  if(!isoOrDDMMYYYY) return '';
  // If DD.MM.YYYY -> preserve
  if(/^\d{2}\.\d{2}\.\d{4}$/.test(isoOrDDMMYYYY)) return isoOrDDMMYYYY;
  // If ISO YYYY-MM-DD
  const m = String(isoOrDDMMYYYY).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m) return `${m[3]}.${m[2]}.${m[1]}`;
  return String(isoOrDDMMYYYY);
}

// --- Firebase Functions ---
import { app } from '../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { loadSharedLayout, ensurePersonModal, openPersonModal } from './layout-loader.js';
import { personService } from '../firebase-config.js';
const functions = getFunctions(app, 'europe-west1');
const scrapeTrademarkFunction = httpsCallable(functions, 'scrapeTrademark', { timeout: 120000 });
let scrapeOwnerTrademarks;
try {
  scrapeOwnerTrademarks = httpsCallable(functions, 'scrapeOwnerTrademarks', { timeout: 240000 });
} catch (e) {
  // Yoksa çağrı anında yakalanacak
}

// --- Elements ---
const singleFields = _el('singleFields');
const bulkFields   = _el('bulkFields');
const singleRadio  = _el('singleTransfer');
const bulkRadio    = _el('bulkByOwner');
const basvuruNoInput = _el('basvuruNoInput');
const queryBtn       = _el('queryBtn');
const ownerIdInput   = _el('ownerIdInput');
const bulkQueryBtn   = _el('bulkQueryBtn');
const loadingEl      = _el('loading');
const bulkLoadingEl  = _el('bulkLoading');
const singleResultContainer = _el('singleResultContainer');
const singleResultInner = _el('singleResultInner');
const bulkResultsContainer = _el('bulkResultsContainer');
const bulkResultsBody = _el('bulkResultsBody');
const bulkMeta = _el('bulkMeta');
const exportCsvBtn = _el('exportCsvBtn');
const savePortfolioBtn = _el('savePortfolioBtn');
const saveThirdPartyBtn = _el('saveThirdPartyBtn');
const cancelBtn = _el('cancelBtn');

// Yeni eklenen elementler
const relatedPartySearchInput = _el('relatedPartySearchInput');
const relatedPartySearchResults = _el('relatedPartySearchResults');
const addNewPersonBtn = _el('addNewPersonBtn');
const relatedPartyList = _el('relatedPartyList');
const relatedPartyCount = _el('relatedPartyCount');

// --- Global State ---
let allPersons = [];
let selectedRelatedParties = [];
let lastBulkItems = [];

// Eklentinin ID'sini buraya ekleyin (sadece bilgi amaçlı)
const EXTENSION_ID_BASVURU = 'bbcpnpgglakoagjakgigmgjpdpiigpah';  // Başvuru numarası için
const EXTENSION_ID_SAHIP = 'abnopnippoapheoakgangaofeelllpbm';  // Sahip numarası için (tp-sorgu-eklentisi-2)

// --------------- INIT ---------------
async function init() {
  try {
    const personsResult = await personService.getPersons();
    allPersons = Array.isArray(personsResult.data) ? personsResult.data : [];
    console.log(`[INIT] ${allPersons.length} kişi yüklendi.`);
    setupEventListeners();
  } catch (error) {
    console.error("Veri yüklenirken hata oluştu:", error);
    showToast("Gerekli veriler yüklenemedi.", "danger");
  }
}

function setupEventListeners() {
  singleRadio?.addEventListener('change', syncMode);
  bulkRadio?.addEventListener('change', syncMode);
  syncMode();

  queryBtn?.addEventListener('click', onQuery);
  cancelBtn?.addEventListener('click', () => history.back());
  
  // Yeni kişi yönetimi olayları
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
  relatedPartyList?.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-selected-item-btn');
    if (btn) removeRelatedParty(btn.dataset.id);
  });

  exportCsvBtn?.addEventListener('click', () => {
    if (!lastBulkItems || lastBulkItems.length === 0) {
      return showToast('Dışa aktarılacak veri yok.', 'warning');
    }
    const headers = ['Sıra','Başvuru Numarası','Marka Adı','Marka Sahibi','Başvuru Tarihi','Tescil No','Durumu','Nice Sınıfları'];
    const rows = lastBulkItems.map((x, i) => [
      i+1,
      x.applicationNumber || '',
      x.brandName || '',
      x.ownerName || '',
      fmtDateToTR(x.applicationDate || ''),
      x.registrationNumber || '',
      x.status || '',
      x.niceClasses || ''
    ]);
    const csv = [headers].concat(rows).map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `turkpatent_${Date.now()}_sahip_liste.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

function syncMode(){
  const isSingle = singleRadio?.checked;
  if (isSingle){
    _showBlock(singleFields);
    _hideBlock(bulkFields);
    _hideBlock(bulkResultsContainer);
  } else {
    _hideBlock(singleFields);
    _showBlock(bulkFields);
  }
  singleResultInner.innerHTML='';
  _hideBlock(singleResultContainer);
  selectedRelatedParties = [];
  renderSelectedRelatedParties();
  savePortfolioBtn.disabled = true;
  saveThirdPartyBtn.disabled = true;
}

// --------------- TEKLI SORGU ---------------
async function onSingleQuery(){
  const basvuruNo = (basvuruNoInput?.value || '').trim();
  if (!basvuruNo) return showToast('Başvuru numarası girin.', 'warning');
  try {
    _showBlock(loadingEl);
    const result = await scrapeTrademarkFunction({ basvuruNo });
    const data = result?.data || {};
    if (!data || data.found === false) {
      showToast(data?.message || 'Sonuç bulunamadı ya da erişilemedi.', 'warning');
    } else {
      renderSingleResult(data);
    }
  } catch (err) {
    showToast('Sorgulama hatası: ' + (err?.message || err), 'danger');
  } finally {
    _hideBlock(loadingEl);
  }
}

// --------------- TOPLU (SAHİP NO) - EKLENTİ İLE ---------------
// Bu fonksiyon, tekli sorguya odaklanıldığı için kaldırılmıştır.
// Ancak, eğer gelecekte bu işlevselliği eklemek isterseniz,
// kodun bu kısma eklenebileceğini unutmayın.

function renderBulkResults(payload){
  const items = Array.isArray(payload.items) ? payload.items : [];
  const ownerId = payload.ownerId || (items[0]?.ownerName?.match(/\((\d+)\)/)?.[1] || '');
  const total = payload.total ?? items.length;

  bulkMeta.textContent = `Sahip No: ${ownerId || '-'} • ${total} kayıt`;
  bulkResultsBody.innerHTML = items.map((x, idx) => `
    <tr>
      <td>${idx+1}</td>
      <td>${x.applicationNumber || ''}</td>
      <td>${x.brandName || ''}</td>
      <td>${x.ownerName || ''}</td>
      <td>${fmtDateToTR(x.applicationDate || '')}</td>
      <td>${x.registrationNumber || ''}</td>
      <td>${x.status || ''}</td>
      <td>${x.niceClasses || ''}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-primary js-bulk-detail" data-appno="${x.applicationNumber || ''}">
          Detay
        </button>
      </td>
    </tr>
  `).join('');

  _showBlock(bulkResultsContainer);
}

// --------------- TEKLI RENDER ---------------
function renderSingleResult(payload){
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

  // Önceki seçimleri temizle
  selectedRelatedParties = [];
  renderSelectedRelatedParties();

  // Sahip numarasını (ownerId) kullanarak veritabanında eşleşme ara
  if (ownerId) {
    const matchedPerson = allPersons.find(p => String(p.tpeNo) === String(ownerId));
    if (matchedPerson) {
      addRelatedParty(matchedPerson);
      showToast(`${matchedPerson.name} (${ownerId}) portföy sahibiyle eşleşti ve otomatik eklendi.`, 'success');
    }
  }

  const heroHtml = `
    <div class="hero">
      <div class="hero-img-wrap">
        <img class="hero-img" src="${imageUrl || ''}" alt="Marka Görseli" onerror="this.src=''; this.style.background='#f4f6f8';">
      </div>
      <div class="hero-meta flex-grow-1">
        <h4 class="mb-1">${trademarkName || '(Marka Adı Yok)'}</h4>
        <div class="mb-3"><span class="badge badge-soft">${status || 'Durum bilgisi yok'}</span></div>
        <div class="kv-grid">
          <div class="kv-item">
            <div class="label">Sahip No</div>
            <div class="value">${ownerId || '-'}</div>
          </div>
          <div class="kv-item">
            <div class="label">Başvuru No</div>
            <div class="value">${applicationNumber || '-'}</div>
          </div>
          <div class="kv-item">
            <div class="label">Başvuru Tarihi</div>
            <div class="value">${applicationDate || '-'}</div>
          </div>
          <div class="kv-item">
            <div class="label">Tescil No</div>
            <div class="value">${registrationNumber || '-'}</div>
          </div>
          <div class="kv-item">
            <div class="label">Tescil Tarihi</div>
            <div class="value">${registrationDate || '-'}</div>
          </div>
          <div class="kv-item">
            <div class="label">Uluslararası Tescil No</div>
            <div class="value">${intlRegNo || '-'}</div>
          </div>

          <div class="kv-item owner-wide" style="grid-column:1 / -1;">
            <div class="label">Sahip Adresi</div>
            <div class="value">${ownerAddress || '-'}</div>
          </div>
          <div class="kv-item owner-wide" style="grid-column:1 / -1;">
            <div class="label">Sahip</div>
            <div class="value">${owner || '-'}</div>
          </div>

          <div class="kv-item">
            <div class="label">Koruma Tarihi</div>
            <div class="value">${protectionDate || '-'}</div>
          </div>
          <div class="kv-item">
            <div class="label">Tür</div>
            <div class="value">${type || '-'}</div>
          </div>
          <div class="kv-item">
            <div class="label">Nice Sınıfları</div>
            <div class="value">${(niceClasses && niceClasses.length) ? niceClasses.join(', ') : '-'}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  let goodsHtml = '';
  if (goods.length){
    const clsMap = {};
    goods.forEach(g => {
      const c = String(g.class || g.cls || '').trim() || 'Genel';
      if(!clsMap[c]) clsMap[c] = [];
      const desc = (g.description || '').trim();
      if (desc) clsMap[c].push(desc);
    });
    goodsHtml = Object.keys(clsMap).map(cls => {
      const items = clsMap[cls].map(x => `<li>${x}</li>`).join('');
      return `<div class="goods-group"><div class="goods-class">Sınıf ${cls}</div><ul class="goods-items">${items}</ul></div>`;
    }).join('');
  } else {
    goodsHtml = `<div class="muted">Mal ve hizmetler listesi bulunamadı.</div>`;
  }

  singleResultInner.innerHTML = `
    <div class="section-card" style="box-shadow:none; border:none; padding:0; margin:0 0 12px 0;">
      ${heroHtml}
    </div>
    <div class="section-card" style="box-shadow:none; border:none; padding:0; margin:0;">
      <div class="section-title" style="padding-left:0; padding-right:0;">Mal ve Hizmetler</div>
      ${goodsHtml}
    </div>
  `;

  _showBlock(singleResultContainer);
  savePortfolioBtn.disabled = false;
  saveThirdPartyBtn.disabled = false;
}

// --- Kişi arama & ekleme ---
function searchPersons(query) {
  const container = _el('relatedPartySearchResults');
  const nq = query.toLowerCase();
  const filtered = allPersons.filter(p =>
    (p.name || '').toLowerCase().includes(nq) || (p.tpeNo || '').includes(nq)
  );

  if (filtered.length === 0) {
    container.innerHTML = '<p class="p-2 text-muted">Sonuç bulunamadı.</p>';
    _showBlock(container);
    return;
  }

  container.innerHTML = filtered.slice(0, 50).map(p =>
    `<div class="search-result-item" data-id="${p.id}">
      <b>${p.name}</b> <small class="text-muted">${p.email || ''} | TPE No: ${p.tpeNo || ''}</small>
    </div>`
  ).join('');

  _showBlock(container);
}

function addRelatedParty(person) {
  if (selectedRelatedParties.some(p => p.id === person.id)) {
    return showToast('Bu kişi zaten eklenmiş.', 'warning');
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
    list.innerHTML = `<div class="empty-state"><i class="fas fa-user-friends fa-3x text-muted mb-3"></i><p class="text-muted">Henüz taraf eklenmedi.</p></div>`;
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

document.addEventListener('DOMContentLoaded', () => {
  loadSharedLayout();
  init();
});
// === Tek buton handler ===
function onQuery(){
  if (bulkRadio?.checked) {
    onOwnerQueryViaExtension();
  } else {
    onSingleQuery();
  }
}

// === Sahip No akışı: eklentiyi tetikle ===
function onOwnerQueryViaExtension(){
  const ownerId = (ownerIdInput?.value || '').trim();
  if (!ownerId) return showToast('Sahip numarası girin.', 'warning');

  const tpUrl = 'https://www.turkpatent.gov.tr/arastirma-yap?tab=marka';
  window.open(tpUrl, '_blank');

  try {
    chrome?.runtime?.sendMessage?.(
      EXTENSION_ID_SAHIP,
      { type: 'START_KISI_QUERY', data: String(ownerId) },
      (resp) => {
        if (chrome.runtime.lastError) {
          console.error('Mesaj hata:', chrome.runtime.lastError.message);
          showToast('Eklentiye ulaşılamadı. Eklentinin yüklü/aktif olduğundan emin olun.', 'danger');
        } else {
          console.log('Eklentiye iletildi:', resp);
          showToast('TÜRKPATENT sayfasında sorgu başlatılıyor…', 'info');
        }
      }
    );
  } catch (e){
    console.error(e);
    showToast('Eklenti mesajı gönderilemedi.', 'danger');
  }
}

// === Eklentiden dönüş: sonuçları al ===
window.addEventListener('message', (ev) => {
  const msg = ev?.data || {};
  if (msg?.source !== 'tp-extension-sahip') return;
  if (msg.type === 'VERI_GELDI_KISI') {
    const items = Array.isArray(msg.data) ? msg.data : [];
    lastBulkItems = items;
    renderBulkResults({ items, ownerId: ownerIdInput?.value || '', total: items.length });
    showToast(`${items.length} kayıt alındı.`, 'success');
  } else if (msg.type === 'HATA_KISI') {
    showToast(`Sorgu hatası: ${msg.data?.message || 'Bilinmeyen'}`, 'danger');
  }
});
