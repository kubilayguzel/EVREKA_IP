// --- Safe DOM helpers ---
function _el(id){ return document.getElementById(id); }
function _show(id){ const n=_el(id); if(n && n.classList) n.classList.remove('d-none'); return n; }
function _hide(id){ const n=_el(id); if(n && n.classList) n.classList.add('d-none'); return n; }
function _toggleActionButtons(visible){ const ab=_el('actionButtons'); if(!ab) return; ab.style.display = visible ? 'flex' : 'none'; }
// --- end helpers ---

import { app } from '../firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/9.1.2/firebase-functions.js";

const functions = getFunctions(app);
const scrapeTrademarkFunction = httpsCallable(functions, 'scrapeTrademark');

const transferOptionRadios = document.getElementsByName('transferOption');
const basvuruNoInput = document.getElementById('basvuruNoInput');
const addBasvuruNoBtn = document.getElementById('addBasvuruNoBtn');
const transferListContainer = document.getElementById('transferListContainer');
const transferList = document.getElementById('transferList');
const queryBtn = document.getElementById('queryBtn');
const singleResultContainer = document.getElementById('singleResultContainer');
const bulkResultsContainer = document.getElementById('bulkResultsContainer');
const resultsTableBody = document.getElementById('resultsTableBody');
const actionButtons = document.getElementById('actionButtons');

let basvuruNumbers = [];

// Transfer seçeneğine göre UI'ı ayarla
transferOptionRadios.forEach(radio => {
  radio.addEventListener('change', (event) => {
    if (event.target.value === 'single') {
      _hide('transferListContainer');
      _hide('singleResultContainer');
      _hide('bulkResultsContainer');
      _toggleActionButtons(false);
      if (basvuruNoInput) basvuruNoInput.disabled = false;
    } else {
      _show('transferListContainer');
      _hide('singleResultContainer');
      _hide('bulkResultsContainer');
      _toggleActionButtons(false);
      if (basvuruNoInput) basvuruNoInput.disabled = false;
      basvuruNumbers = [];
      if (transferList) transferList.innerHTML = '';
    }
  });
});

// Listeye başvuru numarası ekle
if (addBasvuruNoBtn) {
  addBasvuruNoBtn.addEventListener('click', () => {
    const number = basvuruNoInput?.value.trim();
    if (number && !basvuruNumbers.includes(number)) {
      basvuruNumbers.push(number);
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.innerHTML = `
        <span>${number}</span>
        <button class="btn btn-sm btn-danger remove-btn">X</button>
      `;
      if (transferList) transferList.appendChild(li);
      if (basvuruNoInput) basvuruNoInput.value = '';
      
      // Tekil transfer seçili ise, sadece bir eleman eklenebilir
      const singleTransferRadio = document.getElementById('singleTransfer');
      if (singleTransferRadio?.checked) {
        addBasvuruNoBtn.disabled = true;
        if (basvuruNoInput) basvuruNoInput.disabled = true;
        _show('transferListContainer');
      }
    }
  });
}

// Listeden başvuru numarası kaldır
if (transferList) {
  transferList.addEventListener('click', (event) => {
    if (event.target.classList.contains('remove-btn')) {
      const li = event.target.closest('li');
      const numberToRemove = li.querySelector('span').textContent;
      basvuruNumbers = basvuruNumbers.filter(n => n !== numberToRemove);
      li.remove();
      
      const singleTransferRadio = document.getElementById('singleTransfer');
      if (singleTransferRadio?.checked) {
        if (addBasvuruNoBtn) addBasvuruNoBtn.disabled = false;
        if (basvuruNoInput) basvuruNoInput.disabled = false;
        if (basvuruNumbers.length === 0) {
          _hide('transferListContainer');
        }
      }
    }
  });
}

// Sorgula butonuna tıklandığında
if (queryBtn) {
  queryBtn.addEventListener('click', async () => {
    
    // Loading göster, diğer container'ları gizle
    _show('loading');
    _hide('singleResultContainer');
    _hide('bulkResultsContainer');
    _toggleActionButtons(false);
    
    const singleTransferRadio = document.getElementById('singleTransfer');
    const isSingle = singleTransferRadio?.checked;
    
    if (isSingle) {
      const basvuruNo = basvuruNumbers[0];
      _hide('singleResultContainer');
      _toggleActionButtons(false);
      
      try {
        const result = await scrapeTrademarkFunction({ basvuruNo });
        displaySingleResult(result.data);
        _toggleActionButtons(true);
      } catch (error) {
        console.error("Sorgulama hatası:", error);
        showNotification('Sorgulama sırasında bir hata oluştu: ' + (error.message || error), 'danger');
      }
    } else {
      _show('bulkResultsContainer');
      if (resultsTableBody) resultsTableBody.innerHTML = '';
      _toggleActionButtons(false);
      const results = [];
      
      for (const basvuruNo of basvuruNumbers) {
        const row = document.createElement('tr');
        const safeBasvuruNo = basvuruNo.replace(/[^\w-]/g, '-'); // ID için güvenli hale getir
        row.innerHTML = `<td>${basvuruNo}</td><td id="status-${safeBasvuruNo}">Sorgulanıyor...</td>`;
        if (resultsTableBody) resultsTableBody.appendChild(row);
        
        try {
          const result = await scrapeTrademarkFunction({ basvuruNo });
          results.push({ number: basvuruNo, status: 'Başarılı', data: result.data });
          
          const statusElement = document.getElementById(`status-${safeBasvuruNo}`);
          if (statusElement) {
            statusElement.textContent = 'Transfer Başarılı';
            statusElement.classList.add('status-ok');
          }
        } catch (error) {
          console.error("Sorgulama hatası:", error);
          results.push({ number: basvuruNo, status: 'Hata', error: error.message });
          
          const statusElement = document.getElementById(`status-${safeBasvuruNo}`);
          if (statusElement) {
            statusElement.textContent = 'Hata: ' + (error.message || error);
            statusElement.classList.add('status-error');
          }
          showNotification(`${basvuruNo} numaralı başvuruda hata: ${error.message}`, 'warning');
        }
      }
      
      _toggleActionButtons(true);
      
      const savePortfolioBtn = document.getElementById('savePortfolioBtn');
      const saveThirdPartyBtn = document.getElementById('saveThirdPartyBtn');
      if (savePortfolioBtn) savePortfolioBtn.disabled = false;
      if (saveThirdPartyBtn) saveThirdPartyBtn.disabled = false;
    }
    
    _hide('loading');
  });
}

// Tekil sonuçları göster
function displaySingleResult(data) {
  if (!data) {
    showNotification("Veri bulunamadı.", 'warning');
    return;
  }
  
  const heroTitle = document.getElementById('heroTitle');
  const applicationNumber = document.getElementById('applicationNumber');
  const applicationDate = document.getElementById('applicationDate');
  const brandImage = document.getElementById('brandImage');
  
  if (heroTitle) heroTitle.textContent = data.trademarkName || 'Marka Adı Bulunamadı';
  if (applicationNumber) applicationNumber.textContent = data.applicationNumber || 'Bulunamadı';
  if (applicationDate) applicationDate.textContent = data.applicationDate || 'Bulunamadı';
  if (brandImage) {
    brandImage.src = data.imageUrl || '';
    brandImage.alt = data.trademarkName || 'Marka Görseli';
  }
  
  _show('singleResultContainer');
  _toggleActionButtons(true);
}

// Buton event listener'ları - güvenli şekilde
const savePortfolioBtn = document.getElementById('savePortfolioBtn');
if (savePortfolioBtn) {
  savePortfolioBtn.addEventListener('click', () => {
    showNotification('Portföye kaydetme işlemi başlatıldı.', 'info');
    // Firestore veya başka bir veritabanı kaydetme fonksiyonu buraya gelecek
  });
}

const saveThirdPartyBtn = document.getElementById('saveThirdPartyBtn');
if (saveThirdPartyBtn) {
  saveThirdPartyBtn.addEventListener('click', () => {
    showNotification('3. Tarafa aktarma işlemi başlatıldı.', 'info');
    // Başka bir API'ye veri gönderme fonksiyonu buraya gelecek
  });
}

const cancelBtn = document.getElementById('cancelBtn');
if (cancelBtn) {
  cancelBtn.addEventListener('click', () => {
    // Sayfa sıfırlama veya yönlendirme
    window.location.reload();
  });
}

// Küçük bir bildirim gösterme fonksiyonu
function showNotification(message, type) {
  // Notification container oluştur/bul
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
  alert.style.marginBottom = '10px';
  alert.textContent = message;
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-close';
  closeBtn.setAttribute('type', 'button');
  closeBtn.setAttribute('data-bs-dismiss', 'alert');
  closeBtn.setAttribute('aria-label', 'Close');
  
  // Bootstrap 4 uyumluluğu için eski stil close button
  closeBtn.innerHTML = '<span aria-hidden="true">&times;</span>';
  closeBtn.style.background = 'none';
  closeBtn.style.border = 'none';
  closeBtn.style.fontSize = '1.2rem';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.float = 'right';
  
  closeBtn.addEventListener('click', () => alert.remove());
  
  alert.appendChild(closeBtn);
  container.appendChild(alert);
  
  // 5 saniye sonra otomatik kaldır
  setTimeout(() => {
    if (alert.parentNode) alert.remove();
  }, 5000);
}