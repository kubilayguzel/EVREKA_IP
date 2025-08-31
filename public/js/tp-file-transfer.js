// --- DOM helpers ---
function _el(id){ return document.getElementById(id); }
function _showBlock(el){
  if (!el) return;
  el.classList?.remove('d-none');
  el.style.display = '';
  const collapse = el.closest?.('.collapse');
  if (collapse){
    collapse.classList.add('show');
    collapse.style.height = 'auto';
  }
}
function _show(id){ const n=_el(id); _showBlock(n); return n; }
function _hide(id){ const n=_el(id); if(n){ n.classList?.add('d-none'); } return n; }
function _toggleActionButtons(visible){
  const ab = _el('actionButtons');
  if (!ab) return;
  ab.style.display = visible ? 'flex' : 'none';
}
function showNotification(message, type='info'){
  let container = document.getElementById('notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    container.style.position = 'fixed';
    container.style.top = '20px';
    container.style.right = '20px';
    container.style.zIndex = '9999';
    document.body.appendChild(container);
  }
  const alert = document.createElement('div');
  alert.className = `alert alert-${type} fade show`;
  alert.role = 'alert';
  alert.style.minWidth = '280px';
  alert.innerHTML = `
    <div class="d-flex align-items-center">
      <div class="flex-grow-1">${message}</div>
      <button type="button" class="close ml-3" data-dismiss="alert" aria-label="Close">
        <span aria-hidden="true">&times;</span>
      </button>
    </div>`;
  container.appendChild(alert);
  setTimeout(() => { alert.classList.remove('show'); alert.addEventListener('transitionend', () => alert.remove()); }, 3500);
  alert.querySelector('.close')?.addEventListener('click', () => alert.remove());
}

// --- Firebase Functions ---
import { app } from '../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';

const functions = getFunctions(app, 'europe-west1');
const scrapeTrademarkFunction = httpsCallable(functions, 'scrapeTrademarkPuppeteerCallable');

// --- Elements ---
const transferOptionRadios = document.getElementsByName('transferOption');
const basvuruNoInput = _el('basvuruNoInput');
const addBasvuruNoBtn = _el('addBasvuruNoBtn');
const transferListContainer = _el('transferListContainer');
const transferList = _el('transferList');
const transferListEmpty = _el('transferListEmpty');
const queryBtn = _el('queryBtn');
const singleResultContainer = _el('singleResultContainer');
const bulkResultsContainer = _el('bulkResultsContainer');
const resultsTableBody = _el('resultsTableBody');
const savePortfolioBtn = _el('savePortfolioBtn');
const saveThirdPartyBtn = _el('saveThirdPartyBtn');
const cancelBtn = _el('cancelBtn');
const heroTitle = _el('heroTitle');
const brandImage = _el('brandImage');
const applicationNumberEl = _el('applicationNumber');
const applicationDateEl = _el('applicationDate');

let basvuruNumbers = [];

// Enable Add button on input
function syncAdd(){
  if (!addBasvuruNoBtn) return;
  const enabled = !!(basvuruNoInput && basvuruNoInput.value.trim().length>0);
  addBasvuruNoBtn.disabled = !enabled;
  addBasvuruNoBtn.classList.toggle('disabled', !enabled);
}
basvuruNoInput?.addEventListener('input', syncAdd);
basvuruNoInput?.addEventListener('keydown', e => { if (e.key==='Enter'){ e.preventDefault(); addBasvuruNoBtn?.click(); }});
syncAdd();

// Mode toggle
transferOptionRadios.forEach(radio => {
  radio.addEventListener('change', ()=>{
    resetResults();
    _toggleActionButtons(false);
    _show('transferListContainer');
    syncAdd();
  });
});

// Add to list
addBasvuruNoBtn?.addEventListener('click', () => {
  const raw = (basvuruNoInput?.value || '').trim();
  if (!raw) return showNotification('Lütfen bir başvuru numarası girin', 'warning');
  const number = raw.replace(/[^\d/.-]/g, '');
  if (!number) return showNotification('Geçersiz başvuru numarası', 'warning');
  if (basvuruNumbers.includes(number)) return showNotification('Bu başvuru numarası zaten listede', 'info');

  basvuruNumbers.push(number);

  if (transferList){
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    li.innerHTML = `<span>${number}</span>
      <button class="btn btn-sm btn-danger remove-btn" title="Kaldır">X</button>`;
    transferList.appendChild(li);
    transferListEmpty?.classList.add('d-none');
    _show('transferListContainer');
  }

  const singleTransferRadio = _el('singleTransfer');
  if (singleTransferRadio?.checked){
    basvuruNoInput && (basvuruNoInput.disabled = true);
  } else {
    basvuruNoInput && (basvuruNoInput.value = '');
  }
  syncAdd();
  showNotification('Aktarım listesine eklendi', 'success');
});

// Remove from list
transferList?.addEventListener('click', (ev) => {
  const target = ev.target;
  if (!(target instanceof Element)) return;
  if (!target.classList.contains('remove-btn')) return;
  const li = target.closest('li');
  const span = li?.querySelector('span');
  const val = span?.textContent;
  if (val){
    basvuruNumbers = basvuruNumbers.filter(x => x !== val);
  }
  li?.remove();
  if (basvuruNumbers.length === 0){
    transferListEmpty?.classList.remove('d-none');
  }
});

// Query
queryBtn?.addEventListener('click', async () => {
  const singleMode = document.getElementById('singleTransfer')?.checked;
  if (singleMode){
    if (basvuruNumbers.length === 0){
      const n = (basvuruNoInput?.value || '').trim();
      if (!n) return showNotification('Önce başvuru numarası girin (Tekil Aktarım).', 'warning');
      basvuruNumbers = [n];
      // Listeye de yazdır
      addBasvuruNoBtn?.click();
    }
  } else if (basvuruNumbers.length === 0){
    return showNotification('Listeye en az bir başvuru numarası ekleyin.', 'warning');
  }

  _toggleActionButtons(false);
  savePortfolioBtn && (savePortfolioBtn.disabled = true);
  saveThirdPartyBtn && (saveThirdPartyBtn.disabled = true);

  if (singleMode){
    const basvuruNo = basvuruNumbers[0];
    try {
      const result = await scrapeTrademarkFunction({ basvuruNo });
      renderSingleResult(result?.data || null, basvuruNo);
      _toggleActionButtons(true);
      savePortfolioBtn && (savePortfolioBtn.disabled = false);
      saveThirdPartyBtn && (saveThirdPartyBtn.disabled = false);
    } catch (err){
      showNotification('Sorgulama hatası: ' + (err?.message || err), 'danger');
    }
  } else {
    resultsTableBody && (resultsTableBody.innerHTML = '');
    _show('bulkResultsContainer');

    for (const no of basvuruNumbers){
      const safeId = no.replace(/[^a-zA-Z0-9_-]/g, '_');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${no}</td><td id="status-${safeId}">Sorgulanıyor...</td>`;
      resultsTableBody?.appendChild(tr);
    }

    for (const no of basvuruNumbers){
      const safeId = no.replace(/[^a-zA-Z0-9_-]/g, '_');
      const statusEl = document.getElementById('status-' + safeId);
      try {
        const result = await scrapeTrademarkFunction({ basvuruNo: no });
        const data = result?.data || {};
        const ok = data?.found || data?.status === 'Bulundu' || data?.status === 'Navigated';
        if (statusEl){
          statusEl.textContent = ok ? 'Transfer Başarılı' : (data?.status || 'Tamamlandı');
          statusEl.classList.toggle('status-ok', !!ok);
        }
      } catch (err){
        if (statusEl){
          statusEl.textContent = 'Hata: ' + (err?.message || err);
          statusEl.classList.add('status-error');
        }
        showNotification(`${no} sorgusunda hata: ${err?.message || err}`, 'warning');
      }
    }

    _toggleActionButtons(true);
    savePortfolioBtn && (savePortfolioBtn.disabled = false);
    saveThirdPartyBtn && (saveThirdPartyBtn.disabled = false);
  }
});

// Render single
function renderSingleResult(payload, fallbackNo){
  if (!payload){
    showNotification('Sonuç verisi alınamadı', 'warning');
    return;
  }
  const name = payload?.trademarkName || payload?.message || '(İsim yok)';
  const img = payload?.imageUrl || '';
  if (heroTitle) heroTitle.textContent = name;
  if (brandImage){
    brandImage.src = img || '';
    brandImage.style.display = img ? 'block' : 'none';
  }
  // NEW: populate info fields
  if (applicationNumberEl) applicationNumberEl.textContent = payload?.applicationNumber || fallbackNo || '';
  if (applicationDateEl) applicationDateEl.textContent = payload?.applicationDate || '';
  _show('singleResultContainer');
  _hide('bulkResultsContainer');
}

// Reset
function resetResults(){
  basvuruNumbers = [];
  transferList && (transferList.innerHTML = '');
  if (basvuruNoInput){
    basvuruNoInput.value = '';
    basvuruNoInput.disabled = false;
  }
  addBasvuruNoBtn && (addBasvuruNoBtn.disabled = false);
  _hide('singleResultContainer');
  _hide('bulkResultsContainer');
  resultsTableBody && (resultsTableBody.innerHTML = '');
  transferListEmpty && transferListEmpty.classList.remove('d-none');
}
