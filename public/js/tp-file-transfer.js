
// ===== Helpers =====
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
  if(/^\d{2}\.\d{2}\.\d{4}$/.test(isoOrDDMMYYYY)) return isoOrDDMMYYYY;
  const m = String(isoOrDDMMYYYY).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m) return `${m[3]}.${m[2]}.${m[1]}`;
  return String(isoOrDDMMYYYY);
}

// ===== Firebase Functions =====
import { app } from './js/firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
const functions = getFunctions(app, 'europe-west1');
const scrapeTrademarkFunction = httpsCallable(functions, 'scrapeTrademark');

// ===== Elements =====
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

const bulkResultsContainer = _el('bulkResultsContainer');
const bulkResultsBody = _el('bulkResultsBody');
const bulkResultsCount = _el('bulkResultsCount');

const savePortfolioBtn = _el('savePortfolioBtn');
const saveThirdPartyBtn = _el('saveThirdPartyBtn');
const cancelBtn = _el('cancelBtn');

// ===== Mode toggle =====
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
  savePortfolioBtn.disabled = true;
  saveThirdPartyBtn.disabled = true;
}
singleRadio?.addEventListener('change', syncMode);
bulkRadio?.addEventListener('change', syncMode);
syncMode();

// ===== Single query =====
queryBtn?.addEventListener('click', async () => {
  const basvuruNo = (basvuruNoInput?.value || '').trim();
  if (!basvuruNo) return showToast('Başvuru numarası girin.', 'warning');
  try {
    _showBlock(loadingEl);
    const result = await scrapeTrademarkFunction({ basvuruNo });
    const data = result?.data || {};
    if (!data || data.found === false){
      showToast(data?.message || 'Sonuç bulunamadı ya da erişilemedi.', 'warning');
    } else {
      renderSingleResult(data);
    }
  } catch (err){
    showToast('Sorgulama hatası: ' + (err?.message || err), 'danger');
  } finally {
    _hideBlock(loadingEl);
  }
});

// ===== Bulk (ownerId) query =====
bulkQueryBtn?.addEventListener('click', async () => {
  const ownerId = (ownerIdInput?.value || '').trim();
  if (!ownerId) return showToast('Sahip numarası girin.', 'warning');

  try {
    bulkResultsBody.innerHTML = '';
    _showBlock(loadingEl);
    const res = await scrapeTrademarkFunction({ ownerId });
    const payload = res?.data || res; // either in data or root
    if (!payload || payload.status !== 'Success' || !Array.isArray(payload.items) || !payload.items.length){
      showToast(payload?.message || 'Sonuç bulunamadı.', 'warning');
      _hideBlock(bulkResultsContainer);
      return;
    }
    renderBulkResults(payload.items);
  } catch (e) {
    showToast('Arama hatası: ' + (e?.message || e), 'danger');
  } finally {
    _hideBlock(loadingEl);
  }
});

// ===== Renderers =====
function renderSingleResult(din){
  const d = din?.data && typeof din.data === 'object' ? { ...din, ...din.data } : din || {};
  const {
    applicationNumber, applicationDate,
    registrationNumber, registrationDate, intlRegistrationNumber: intlRegNo,
    protectionDate, type, niceClasses = [],
    owner, ownerAddress, trademarkName, imageUrl
  } = d;

  const heroHtml = `
  <div class="hero">
    <div class="hero-img-wrap">
      <img class="hero-img" src="${imageUrl || ''}" alt="Marka Görseli" onerror="this.style.display='none'">
    </div>
    <div style="flex:1;">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h2 class="mb-0">${trademarkName || '-'}</h2>
        <span class="badge badge-soft">${type || 'Marka'}</span>
      </div>

      <div class="kv-grid">
        <div class="kv-item"><div class="label">Başvuru No</div><div class="value">${applicationNumber || '-'}</div></div>
        <div class="kv-item"><div class="label">Başvuru Tarihi</div><div class="value">${fmtDateToTR(applicationDate) || '-'}</div></div>
        <div class="kv-item"><div class="label">Tescil No</div><div class="value">${registrationNumber || '-'}</div></div>
        <div class="kv-item"><div class="label">Tescil Tarihi</div><div class="value">${fmtDateToTR(registrationDate) || '-'}</div></div>
        <div class="kv-item"><div class="label">Uluslararası Tescil No</div><div class="value">${intlRegNo || '-'}</div></div>
        <div class="kv-item"><div class="label">Koruma Tarihi</div><div class="value">${fmtDateToTR(protectionDate) || '-'}</div></div>

        <!-- İSTEK: Sahip bilgisi geniş alan ve koruma tarihi ile sahip adresinin arasına -->
        <div class="kv-item" style="grid-column:1 / span 2;">
          <div class="label">Sahip</div>
          <div class="value">${owner || '-'}</div>
        </div>

        <div class="kv-item"><div class="label">Tür</div><div class="value">${type || '-'}</div></div>
        <div class="kv-item"><div class="label">Nice Sınıfları</div><div class="value">${niceClasses.length ? niceClasses.join(', ') : '-'}</div></div>

        <div class="kv-item" style="grid-column:1 / -1;">
          <div class="label">Sahip Adresi</div>
          <div class="value">${ownerAddress || '-'}</div>
        </div>
      </div>
    </div>
  </div>`;

  singleResultInner.innerHTML = `
    <div class="section-card" style="box-shadow:none; border:none; padding:0; margin:0 0 12px 0;">${heroHtml}</div>
  `;

  _showBlock(singleResultContainer);
  savePortfolioBtn.disabled = false;
  saveThirdPartyBtn.disabled = false;
}

function renderBulkResults(items){
  const rows = items.map((row, idx) => {
    const nice = Array.isArray(row.niceClasses) ? row.niceClasses.join(' / ') : (row.niceClasses || '');
    return `<tr data-appno="${row.applicationNo}">
      <td>${idx + 1}</td>
      <td>${row.applicationNo || ''}</td>
      <td>${row.markName || ''}</td>
      <td>${row.holdName || ''}</td>
      <td>${row.applicationDate || ''}</td>
      <td>${row.registrationNo || ''}</td>
      <td>${row.state || ''}</td>
      <td>${nice}</td>
      <td class="col-actions">
        <button class="btn btn-sm btn-outline-primary js-detail">Detay</button>
      </td>
    </tr>`;
  }).join('');

  bulkResultsBody.innerHTML = rows;
  bulkResultsCount.textContent = String(items.length);
  _showBlock(bulkResultsContainer);
}

// Delegated click for "Detay"
bulkResultsBody?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.js-detail');
  if (!btn) return;
  const tr = e.target.closest('tr');
  const appNo = tr?.dataset?.appno;
  if (!appNo) return;
  try {
    _showBlock(loadingEl);
    const result = await scrapeTrademarkFunction({ basvuruNo: appNo });
    const data = result?.data || {};
    if (!data || data.found === false){
      showToast(data?.message || 'Detay alınamadı.', 'warning');
      return;
    }
    // Switch to single tab automatically
    singleRadio.checked = true;
    syncMode();
    renderSingleResult(data);
    window.scrollTo({top: 0, behavior: 'smooth'});
  } catch (err) {
    showToast('Detay hatası: ' + (err?.message || err), 'danger');
  } finally {
    _hideBlock(loadingEl);
  }
});
