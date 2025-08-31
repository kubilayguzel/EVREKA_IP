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
import { loadSharedLayout } from './layout-loader.js';
const functions = getFunctions(app, 'europe-west1');
const scrapeTrademarkFunction = httpsCallable(functions, 'scrapeTrademark');

// --- Optional person modal helpers from layout (if available) ---
let ensurePersonModal = null;
let openPersonModal = null;
(async () => {
  try {
    const mod = await import('./layout-loader.js');
    ensurePersonModal = mod.ensurePersonModal;
    openPersonModal = mod.openPersonModal;
  } catch (e) {
    // layout-loader may not exist in isolated preview; ignore
  }
})();

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
const singleResultContainer = _el('singleResultContainer');
const singleResultInner = _el('singleResultInner');
const relatedPartyCard = _el('relatedPartyCard');
const openPersonModalBtn = _el('openPersonModalBtn');
const selectedPersonSummary = _el('selectedPersonSummary');
const savePortfolioBtn = _el('savePortfolioBtn');
const saveThirdPartyBtn = _el('saveThirdPartyBtn');
const cancelBtn = _el('cancelBtn');

// Mode toggle
function syncMode(){
  const isSingle = singleRadio?.checked;
  if (isSingle){
    _showBlock(singleFields);
    _hideBlock(bulkFields);
  } else {
    _hideBlock(singleFields);
    _showBlock(bulkFields);
  }
  // temizle
  singleResultInner.innerHTML='';
  _hideBlock(singleResultContainer);
  _hideBlock(relatedPartyCard);
  savePortfolioBtn.disabled = true;
  saveThirdPartyBtn.disabled = true;
}
singleRadio?.addEventListener('change', syncMode);
bulkRadio?.addEventListener('change', syncMode);
syncMode();

// Query single
queryBtn?.addEventListener('click', async () => {
  const basvuruNo = (basvuruNoInput?.value || '').trim();
  if (!basvuruNo) return showToast('Başvuru numarası girin.', 'warning');
  try {
    _showBlock(loadingEl);
    const result = await scrapeTrademarkFunction({ basvuruNo });
    const data = result?.data || {};
    // Expected: data.status, data.found, ... and flattened fields
    if (!data || data.found === false){
      showToast(data?.message || 'Sonuç bulunamadı ya da erişilemedi.', 'warning');
      _hideBlock(loadingEl);
      return;
    }
    renderSingleResult(data);
    _hideBlock(loadingEl);
  } catch (err){
    _hideBlock(loadingEl);
    showToast('Sorgulama hatası: ' + (err?.message || err), 'danger');
  }
});

// Bulk placeholder
bulkQueryBtn?.addEventListener('click', () => {
  const ownerId = (ownerIdInput?.value || '').trim();
  if(!ownerId) return showToast('Sahip numarası girin.', 'warning');
  showToast('Toplu aktarım kurumsal uç tamamlandığında bağlanacaktır.', 'info');
});

// Person modal open
openPersonModalBtn?.addEventListener('click', async () => {
  if (typeof ensurePersonModal === 'function') try { await ensurePersonModal(); } catch {}
  if (typeof openPersonModal === 'function') {
    openPersonModal('relatedParty', (person) => {
      if (!person) return;
      selectedPersonSummary.innerHTML = `<div class="text-right">
        <div><strong>${person.name || person.displayName || person.title || 'Seçilen Kişi'}</strong></div>
        <div class="muted" style="font-size:12px;">${person.email || person.taxNo || ''}</div>
      </div>`;
      showToast('Kişi eklendi.', 'success');
    });
  } else {
    showToast('Kişi ekleme modülü bu sayfada devre dışı.', 'warning');
  }
});

cancelBtn?.addEventListener('click', () => {
  history.back();
});

function renderSingleResult(payload){
  // payload düzleştirilmiş olabilir: data içinde ve root'ta
  const d = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const trademarkName = d.trademarkName || '';
  const status = d.status || '';
  const imageUrl = d.imageUrl || '';
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

  // HERO CARD (Portfolio Detail'e benzer)
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
            <div class="label">Sahip</div>
            <div class="value">${owner || '-'}</div>
          </div>
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
          <div class="kv-item" style="grid-column:1 / -1;">
            <div class="label">Sahip Adresi</div>
            <div class="value">${ownerAddress || '-'}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // GOODS CARD
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
  _showBlock(relatedPartyCard);
  savePortfolioBtn.disabled = false;
  saveThirdPartyBtn.disabled = false;
}
