// --- Safe DOM helpers ---
function _el(id){ return document.getElementById(id); }
function _show(id){ const n=_el(id); if(n && n.classList) n.classList.remove('d-none'); return n; }
function _hide(id){ const n=_el(id); if(n && n.classList) n.classList.add('d-none'); return n; }
function _toggleActionButtons(visible){
  const ab = _el('actionButtons');
  if (!ab) return;
  ab.style.display = visible ? 'flex' : 'none';
}

// --- Lightweight notification ---
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
  setTimeout(() => { alert.classList.remove('show'); alert.addEventListener('transitionend', () => alert.remove()); }, 4000);
  alert.querySelector('.close')?.addEventListener('click', () => alert.remove());
}

// --- Imports ---
import { app } from '../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';

// Use europe-west1 to match your deployed region
const functions = getFunctions(app, 'europe-west1');
const scrapeTrademarkFunction = httpsCallable(functions, 'scrapeTrademarkPuppeteerCallable');

// --- Elements ---
const transferOptionRadios = document.getElementsByName('transferOption');
const basvuruNoInput = document.getElementById('basvuruNoInput');
const addBasvuruNoBtn = document.getElementById('addBasvuruNoBtn');
const transferListContainer = document.getElementById('transferListContainer');
const transferList = document.getElementById('transferList');
const transferListEmpty = document.getElementById('transferListEmpty');
const queryBtn = document.getElementById('queryBtn');
const singleResultContainer = document.getElementById('singleResultContainer');
const bulkResultsContainer = document.getElementById('bulkResultsContainer');
const resultsTableBody = document.getElementById('resultsTableBody');
const savePortfolioBtn = document.getElementById('savePortfolioBtn');
const saveThirdPartyBtn = document.getElementById('saveThirdPartyBtn');
const cancelBtn = document.getElementById('cancelBtn');
const heroTitle = document.getElementById('heroTitle');
const brandImage = document.getElementById('brandImage');

let basvuruNumbers = [];

// --- Helpers to handle button enabling ---
function forceEnableAddButton(){
  if (!addBasvuruNoBtn) return;
  addBasvuruNoBtn.disabled = false;
  addBasvuruNoBtn.classList.remove('disabled');
  addBasvuruNoBtn.style.pointerEvents = '';
  addBasvuruNoBtn.style.opacity = '';
}
function syncAddButtonEnabled(){
  if (!addBasvuruNoBtn) return;
  const hasVal = !!(basvuruNoInput && basvuruNoInput.value.trim().length > 0);
  addBasvuruNoBtn.disabled = !hasVal;
  addBasvuruNoBtn.classList.toggle('disabled', !hasVal);
}

// Make sure button becomes clickable on load even if HTML marks it disabled
forceEnableAddButton();
syncAddButtonEnabled();

// Enable/disable Add based on input typing
if (basvuruNoInput){
  basvuruNoInput.addEventListener('input', () => {
    forceEnableAddButton();
    syncAddButtonEnabled();
  });
  // Pressing Enter triggers Add
  basvuruNoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBasvuruNoBtn?.click();
    }
  });
}

// --- UI Mode toggle ---
transferOptionRadios.forEach(radio => {
  radio.addEventListener('change', (event) => {
    const mode = event.target.value;
    resetResults();
    if (mode === 'single') {
      _hide('transferListContainer');
      _hide('bulkResultsContainer');
      _hide('singleResultContainer');
      _toggleActionButtons(false);
      forceEnableAddButton();
      syncAddButtonEnabled();
      basvuruNoInput && (basvuruNoInput.disabled = false);
    } else {
      _show('transferListContainer');
      _hide('bulkResultsContainer');
      _hide('singleResultContainer');
      _toggleActionButtons(false);
      transferListEmpty && transferListEmpty.classList.remove('d-none');
      forceEnableAddButton();
      syncAddButtonEnabled();
      basvuruNoInput && (basvuruNoInput.disabled = false);
    }
  });
});

// If there are no radios on the page, default to single-mode behavior
if (!transferOptionRadios || transferOptionRadios.length === 0){
  _hide('transferListContainer');
  _toggleActionButtons(false);
  forceEnableAddButton();
  syncAddButtonEnabled();
}

// --- Add number to list ---
if (addBasvuruNoBtn) {
  addBasvuruNoBtn.addEventListener('click', () => {
    const raw = (basvuruNoInput?.value || '').trim();
    if (!raw) {
      showNotification('Lütfen bir başvuru numarası girin', 'warning');
      return;
    }
    const number = raw.replace(/[^\d/.-]/g, '');
    if (!number) {
      showNotification('Geçersiz başvuru numarası', 'warning');
      return;
    }
    if (basvuruNumbers.includes(number)) {
      showNotification('Bu başvuru numarası zaten listede', 'info');
      return;
    }
    basvuruNumbers.push(number);

    // Render list (for bulk); in single we lock the input but show result after query
    if (transferList) {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.innerHTML = `<span>${number}</span>
        <button class="btn btn-sm btn-danger remove-btn" title="Kaldır">X</button>`;
      transferList.appendChild(li);
      transferListEmpty && transferListEmpty.classList.add('d-none');
    }

    const singleTransferRadio = document.getElementById('singleTransfer');
    if (singleTransferRadio?.checked) {
      // Keep add button enabled so user can correct mistakes; just freeze the input value
      basvuruNoInput && (basvuruNoInput.disabled = true);
      syncAddButtonEnabled(); // may disable if input now empty/disabled
    } else {
      basvuruNoInput && (basvuruNoInput.value = '');
      _show('transferListContainer');
      forceEnableAddButton();
      syncAddButtonEnabled();
    }
  });
}

// Remove from list (bulk)
if (transferList) {
  transferList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.classList.contains('remove-btn')) {
      const li = target.closest('li');
      if (!li) return;
      const numberToRemove = li.querySelector('span')?.textContent;
      if (numberToRemove) basvuruNumbers = basvuruNumbers.filter(n => n !== numberToRemove);
      li.remove();
      if (basvuruNumbers.length === 0 && transferListEmpty) {
        transferListEmpty.classList.remove('d-none');
      }
    }
  });
}

// Query button
if (queryBtn) {
  queryBtn.addEventListener('click', async () => {
    const singleMode = document.getElementById('singleTransfer')?.checked;

    if (singleMode) {
      if (basvuruNumbers.length === 0) {
        const n = (basvuruNoInput?.value || '').trim();
        if (!n) {
          showNotification('Önce başvuru numarası girin (Tekil Aktarım).', 'warning');
          return;
        }
        basvuruNumbers = [n];
      }
    } else if (basvuruNumbers.length === 0) {
      showNotification('Listeye en az bir başvuru numarası ekleyin.', 'warning');
      return;
    }

    _toggleActionButtons(false);
    savePortfolioBtn && (savePortfolioBtn.disabled = true);
    saveThirdPartyBtn && (saveThirdPartyBtn.disabled = true);

    if (singleMode) {
      const basvuruNo = basvuruNumbers[0];
      try {
        const result = await scrapeTrademarkFunction({ basvuruNo });
        renderSingleResult(result?.data || null);
        _toggleActionButtons(true);
        savePortfolioBtn && (savePortfolioBtn.disabled = false);
        saveThirdPartyBtn && (saveThirdPartyBtn.disabled = false);
      } catch (err) {
        showNotification('Sorgulama hatası: ' + (err?.message || err), 'danger');
      }
    } else {
      resultsTableBody && (resultsTableBody.innerHTML = '');
      _show('bulkResultsContainer');

      for (const basvuruNo of basvuruNumbers) {
        const safeId = basvuruNo.replace(/[^a-zA-Z0-9_-]/g, '_');
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${basvuruNo}</td>
                        <td id="status-${safeId}">Sorgulanıyor...</td>`;
        resultsTableBody && resultsTableBody.appendChild(tr);
      }

      for (const basvuruNo of basvuruNumbers) {
        const safeId = basvuruNo.replace(/[^a-zA-Z0-9_-]/g, '_');
        const statusEl = document.getElementById('status-' + safeId);
        try {
          const result = await scrapeTrademarkFunction({ basvuruNo });
          const data = result?.data || {};
          const ok = data?.found || data?.status === 'Bulundu' || data?.status === 'Navigated';
          if (statusEl) {
            statusEl.textContent = ok ? 'Transfer Başarılı' : (data?.status || 'Tamamlandı');
            statusEl.classList.toggle('status-ok', !!ok);
          }
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = 'Hata: ' + (err?.message || err);
            statusEl.classList.add('status-error');
          }
          showNotification(`${basvuruNo} sorgusunda hata: ${err?.message || err}`, 'warning');
        }
      }

      _toggleActionButtons(true);
      savePortfolioBtn && (savePortfolioBtn.disabled = false);
      saveThirdPartyBtn && (saveThirdPartyBtn.disabled = false);
    }
  });
}

// Cancel button: reset UI
if (cancelBtn) {
  cancelBtn.addEventListener('click', () => {
    resetResults();
    _toggleActionButtons(false);
    forceEnableAddButton();
    syncAddButtonEnabled();
  });
}

// --- Render functions ---
function renderSingleResult(payload){
  if (!payload) {
    showNotification('Sonuç verisi alınamadı', 'warning');
    return;
  }
  const name = payload?.trademarkName || '(İsim yok)';
  const img = payload?.imageUrl || '';
  heroTitle && (heroTitle.textContent = name);
  if (brandImage) {
    brandImage.src = img || '';
    brandImage.style.display = img ? 'block' : 'none';
  }
  _show('singleResultContainer');
  _hide('bulkResultsContainer');
}

function resetResults(){
  basvuruNumbers = [];
  transferList && (transferList.innerHTML = '');
  if (basvuruNoInput) {
    basvuruNoInput.value = '';
    basvuruNoInput.disabled = false;
  }
  addBasvuruNoBtn && (addBasvuruNoBtn.disabled = false);
  _hide('singleResultContainer');
  _hide('bulkResultsContainer');
  resultsTableBody && (resultsTableBody.innerHTML = '');
  transferListEmpty && transferListEmpty.classList.remove('d-none');
}
