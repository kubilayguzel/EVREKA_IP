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
const loading = document.getElementById('loading');
const actionButtons = document.getElementById('actionButtons');

let basvuruNumbers = [];

// Transfer seçeneğine göre UI'ı ayarla
transferOptionRadios.forEach(radio => {
  radio.addEventListener('change', (event) => {
    if (event.target.value === 'single') {
      if (transferListContainer) transferListContainer.classList.add('d-none');
      if (singleResultContainer) singleResultContainer.classList.add('d-none');
      if (bulkResultsContainer) bulkResultsContainer.classList.add('d-none');
      actionButtons.style.display = 'none';
      basvuruNoInput.disabled = false;
    } else {
      if (transferListContainer) transferListContainer.classList.remove('d-none');
      if (singleResultContainer) singleResultContainer.classList.add('d-none');
      if (bulkResultsContainer) bulkResultsContainer.classList.add('d-none');
      actionButtons.style.display = 'none';
      basvuruNoInput.disabled = false;
      basvuruNumbers = [];
      transferList.innerHTML = '';
    }
  });
});

// Listeye başvuru numarası ekle
addBasvuruNoBtn.addEventListener('click', () => {
  const number = basvuruNoInput.value.trim();
  if (number && !basvuruNumbers.includes(number)) {
    basvuruNumbers.push(number);
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    li.innerHTML = `
      <span>${number}</span>
      <button class="btn btn-sm btn-danger remove-btn">X</button>
    `;
    \1
refreshTransferListVisibility();
    basvuruNoInput.value = '';
    
    // Tekil transfer seçili ise, sadece bir eleman eklenebilir
    if (document.getElementById('singleTransfer').checked) {
      addBasvuruNoBtn.disabled = true;
      basvuruNoInput.disabled = true;
      if (transferListContainer) transferListContainer.classList.remove('d-none');
    }
  }
});

// Listeden başvuru numarası kaldır
transferList.addEventListener('click', (event) => {
  if (event.target.classList.contains('remove-btn')) {
    const li = event.target.closest('li');
    const numberToRemove = li.querySelector('span').textContent;
    basvuruNumbers = basvuruNumbers.filter(n => n !== numberToRemove);
    li.remove();
    if (document.getElementById('singleTransfer').checked) {
        addBasvuruNoBtn.disabled = false;
        basvuruNoInput.disabled = false;
        if (basvuruNumbers.length === 0) {
            if (transferListContainer) transferListContainer.classList.add('d-none');
        }
    }
  }
});

// Sorgula butonuna tıklandığında
queryBtn.addEventListener('click', async () => {
  if (loading) loading.classList.remove('d-none');
  const isSingle = document.getElementById('singleTransfer').checked;
  
  if (isSingle) {
    const basvuruNo = basvuruNumbers[0];
    if (singleResultContainer) singleResultContainer.classList.add('d-none');
    actionButtons.style.display = 'none';
    
    try {
      const result = await scrapeTrademarkFunction({ basvuruNo });
      displaySingleResult(result.data);
      actionButtons.style.display = 'flex';
    } catch (error) {
      console.error("Sorgulama hatası:", error);
      showNotification('Sorgulama sırasında bir hata oluştu.', 'danger');
    }
  } else {
  const __ab2=document.getElementById('actionButtons'); if(__ab2) __ab2.style.display='block';
    resultsTableBody.innerHTML = '';
    actionButtons.style.display = 'none';
    const results = [];
    
    for (const basvuruNo of basvuruNumbers) {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${basvuruNo}</td><td id="status-${basvuruNo}">Sorgulanıyor...</td>`;
      resultsTableBody.appendChild(row);
      
      try {
        const result = await scrapeTrademarkFunction({ basvuruNo });
        results.push({ number: basvuruNo, status: 'Başarılı', data: result.data });
        document.getElementById(`status-${basvuruNo}`).textContent = 'Transfer Başarılı';
        document.getElementById(`status-${basvuruNo}`).classList.add('status-ok');
      } catch (error) {
        console.error("Sorgulama hatası:", error);
        results.push({ number: basvuruNo, status: 'Hata', error: error.message });
        document.getElementById(`status-${basvuruNo}`).textContent = 'Hata';
        document.getElementById(`status-${basvuruNo}`).classList.add('status-error');
        showNotification(`${basvuruNo} numaralı başvuruda hata: ${error.message}`, 'warning');
      }
    }
    actionButtons.style.display = 'flex';
    document.getElementById('savePortfolioBtn').disabled = false;
    document.getElementById('saveThirdPartyBtn').disabled = false;
  }
  if (loading) loading.classList.add('d-none');
});

// Tekil sonuçları göster

function displaySingleResult(data) {
  const title = document.getElementById('heroTitle');
  const appNo = document.getElementById('applicationNumber');
  const appDate = document.getElementById('applicationDate');
  const imgEl = document.getElementById('brandImage');
  const single = document.getElementById('singleResultContainer');
  const bulk = document.getElementById('bulkResultsContainer');

  if (bulk) bulk.classList.add('d-none');
  if (single) single.classList.remove('d-none');

  if (title) title.textContent = data.trademarkName || '—';
  if (appNo) appNo.textContent = data.applicationNumber || '—';
  if (appDate) appDate.textContent = data.applicationDate || '—';

  const PH = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="180" height="120">
      <rect width="100%" height="100%" fill="#e5e7eb"/>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="14" fill="#6b7280"
            text-anchor="middle" dominant-baseline="middle">No Image</text>
    </svg>`);
  if (imgEl) {
    imgEl.src = data.imageUrl || PH;
    imgEl.alt = data.trademarkName || 'Marka Görseli';
    imgEl.addEventListener('error', () => { imgEl.src = PH; }, { once: true });
  }

  const ab = document.getElementById('actionButtons');
  if (ab) ab.style.display = 'block';
}

  
  document.getElementById('heroTitle').textContent = data.trademarkName || 'Marka Adı Bulunamadı';
  document.getElementById('applicationNumber').textContent = data.applicationNumber || 'Bulunamadı';
  document.getElementById('applicationDate').textContent = data.applicationDate || 'Bulunamadı';
    const imgEl = document.getElementById('brandImage');
    const __PH__ = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="180" height="120">
            <rect width="100%" height="100%" fill="#e5e7eb"/>
            <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="14" fill="#6b7280"
                text-anchor="middle" dominant-baseline="middle">No Image</text>
        </svg>
        `);
    if (!data.imageUrl) {
    imgEl.src = __PH__;
    } else {
    imgEl.src = data.imageUrl;
    imgEl.addEventListener('error', () => { imgEl.src = __PH__; }, { once: true });
    }

  document.getElementById('brandImage').alt = data.trademarkName || 'Marka Görseli';
  const __ab=document.getElementById('actionButtons'); if(__ab) __ab.style.display='block';
}

// Diğer butonların (Kaydet, İptal) mantığı buraya eklenecek
document.getElementById('savePortfolioBtn').addEventListener('click', () => {
  showNotification('Portföye kaydetme işlemi başlatıldı.', 'info');
  // Firestore veya başka bir veritabanı kaydetme fonksiyonu buraya gelecek
});

document.getElementById('saveThirdPartyBtn').addEventListener('click', () => {
  showNotification('3. Tarafa aktarma işlemi başlatıldı.', 'info');
  // Başka bir API'ye veri gönderme fonksiyonu buraya gelecek
});

document.getElementById('cancelBtn').addEventListener('click', () => {
    // Sayfa sıfırlama veya yönlendirme
    window.location.reload();
});


// Küçük bir bildirim gösterme fonksiyonu
function showNotification(message, type) {
  const container = document.getElementById('notification-container');
  const alert = document.createElement('div');
  alert.className = `alert alert-${type} fade show`;
  alert.role = 'alert';
  alert.textContent = message;
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('data-dismiss', 'alert');
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '<span aria-hidden="true">&times;</span>';
  
  alert.appendChild(closeBtn);
  container.appendChild(alert);
  
  setTimeout(() => alert.remove(), 5000);
}

function refreshTransferListVisibility() {
  const list = document.getElementById('transferList');
  const hasItems = list && list.children && list.children.length > 0;
  const cont = document.getElementById('transferListContainer');
  const empty = document.getElementById('transferListEmpty');
  if (cont && empty) {
    if (hasItems) {
      if (cont) cont.classList.remove('d-none');
      if (empty) empty.classList.add('d-none');
    } else {
      if (cont) cont.classList.add('d-none');
      if (empty) empty.classList.remove('d-none');
    }
  }
}


// Add by Enter key
(function(){
  const input = document.getElementById('basvuruNoInput');
  const addBtn = document.getElementById('addBasvuruNoBtn');
  if (input && addBtn) {
    input.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') {
        e.preventDefault();
        addBtn.click();
      }
    });
  }
})();


function refreshTransferListVisibility() {
  const list = document.getElementById('transferList');
  const empty = document.getElementById('transferListEmpty');
  const container = document.getElementById('transferListContainer');
  const hasItems = list && list.children && list.children.length > 0;
  if (container && empty) {
    if (hasItems) { container.classList.remove('d-none'); empty.classList.add('d-none'); }
    else { container.classList.add('d-none'); empty.classList.remove('d-none'); }
  }
}

function addCurrentInput() {
  const input = document.getElementById('basvuruNoInput');
  const list = document.getElementById('transferList');
  if (!input || !list) return;
  const val = (input.value || '').trim();
  if (!val) return;
  const li = document.createElement('li');
  li.className = 'list-group-item d-flex align-items-center justify-content-between';
  li.innerHTML = '<span>' + val + '</span><button type="button" class="btn btn-danger btn-sm">X</button>';
  li.querySelector('button').addEventListener('click', () => { li.remove(); refreshTransferListVisibility(); });
  list.appendChild(li);
  input.value = '';
  refreshTransferListVisibility();
}

(function setupAddHandlers(){
  const input = document.getElementById('basvuruNoInput');
  const addBtn = document.getElementById('addBasvuruNoBtn');
  if (addBtn) addBtn.addEventListener('click', addCurrentInput);
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addCurrentInput(); }
  });
})();

document.addEventListener('DOMContentLoaded', () => { try { refreshTransferListVisibility(); } catch(e){} });
