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
// Yeni: Sahip numarasıyla liste döndüren uç (sunucuda uygulanmalı)
let scrapeOwnerTrademarks;
try {
  scrapeOwnerTrademarks = httpsCallable(functions, 'scrapeOwnerTrademarks', { timeout: 240000 });
} catch (e) {
  // yoksa çağrı anında yakalanacak
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

// Eklentinin ID'sini buraya ekleyin
// ÖNEMLİ: Eklentinizi Chrome'a yükledikten sonra bu ID'yi güncelleyin.

const EXTENSION_ID_BASVURU = 'bbcpnpgglakoagjakgigmgjpdpiigpah';  // Başvuru numarası için
const EXTENSION_ID_SAHIP = 'abnopnippoapheoakgangaofeelllpbm';  // Sahip numarası için (tp-sorgu-eklentisi-2)

// --------------- INIT ---------------
async function init() {
  try {
    const personsResult = await personService.getPersons();
    allPersons = Array.isArray(personsResult.data) ? personsResult.data : [];
    console.log(`[INIT] ${allPersons.length} kişi yüklendi.`);

    // Eklentiden gelen mesajları dinle
    setupExtensionMessageListener();
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

  queryBtn?.addEventListener('click', onSingleQuery);
  bulkQueryBtn?.addEventListener('click', onBulkQuery);

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

  // Bulk tabloda DETAY tıklamaları
  bulkResultsBody?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.js-bulk-detail');
    if (!btn) return;
    const appNo = btn.dataset.appno;
    if (!appNo) return;
    try {
      _showBlock(loadingEl);
      const result = await scrapeTrademarkFunction({ basvuruNo: appNo });
      const data = result?.data || {};
      if (!data || data.found === false) {
        showToast(data?.message || 'Detay alınamadı.', 'warning');
      } else {
        // Tekli paneli doldur ve yukarı kaydır
        renderSingleResult(data);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err) {
      showToast('Detay sorgu hatası: ' + (err?.message || err), 'danger');
    } finally {
      _hideBlock(loadingEl);
    }
  });

  // CSV dışa aktar
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
  // temizle
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

function setupExtensionMessageListener() {
    console.log('[DEBUG] PostMessage dinleyicisi kuruluyor...');
    
    // Web sayfası olduğumuz için sadece PostMessage ile iletişim kuruyoruz
    window.addEventListener('message', (event) => {
        // Güvenlik: Sadece TÜRKPATENT ve kendi origin'imizden mesajları kabul et
        const allowedOrigins = [
            window.location.origin,
            'https://www.turkpatent.gov.tr',
            'https://turkpatent.gov.tr'
        ];
        
        if (!allowedOrigins.includes(event.origin)) {
            return;
        }
        
        if (event.data && event.data.source === 'tp-extension-sahip') {
            console.log('[DEBUG] PostMessage alındı:', event.data);
            
            // Global timeout'u iptal et
            if (window.tpQueryTimeout) {
                clearTimeout(window.tpQueryTimeout);
                delete window.tpQueryTimeout;
            }
            
            // Query status'u güncelle
            document.body.setAttribute('data-tp-query-status', 'completed');
            
            if (event.data.type === 'VERI_GELDI_KISI') {
                _hideBlock(bulkLoadingEl);
                lastBulkItems = event.data.data || [];
                
                if (!lastBulkItems.length) {
                    showToast('Bu sahip numarası için sonuç bulunamadı.', 'warning');
                } else {
                    renderBulkResults({ items: lastBulkItems });
                    showToast(`${lastBulkItems.length} kayıt başarıyla alındı.`, 'success');
                }
                
            } else if (event.data.type === 'HATA_KISI') {
                _hideBlock(bulkLoadingEl);
                const errorMsg = event.data.data?.message || 'Bilinmeyen Hata';
                showToast('Eklenti hatası: ' + errorMsg, 'danger');
                
            } else if (event.data.type === 'SORGU_BASLADI') {
                showToast('TÜRKPATENT sayfasında sorgu başladı. Lütfen bekleyin...', 'info');
                
            } else if (event.data.type === 'MODAL_KAPATILDI') {
                console.log('[DEBUG] Modal kapatıldı bilgisi alındı');
                
            } else if (event.data.type === 'EKLENTI_HAZIR') {
                console.log('[DEBUG] Eklenti hazır olduğunu bildirdi');
            }
            
            // İşlem tamamlandıysa data attribute'ları temizle
            if (event.data.type === 'VERI_GELDI_KISI' || event.data.type === 'HATA_KISI') {
                setTimeout(() => {
                    document.body.removeAttribute('data-tp-query');
                    document.body.removeAttribute('data-tp-query-type'); 
                    document.body.removeAttribute('data-tp-query-status');
                    document.body.removeAttribute('data-tp-timestamp');
                }, 1000);
            }
        }
    });
    
    console.log('[DEBUG] ✅ Event dinleyicileri kuruldu.');
}

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