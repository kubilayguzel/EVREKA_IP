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
      transferListContainer.classList.add('d-none');
      singleResultContainer.classList.add('d-none');
      bulkResultsContainer.classList.add('d-none');
      actionButtons.style.display = 'none';
      basvuruNoInput.disabled = false;
    } else {
      transferListContainer.classList.remove('d-none');
      singleResultContainer.classList.add('d-none');
      bulkResultsContainer.classList.add('d-none');
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
    transferList.appendChild(li);
    basvuruNoInput.value = '';
    
    // Tekil transfer seçili ise, sadece bir eleman eklenebilir
    if (document.getElementById('singleTransfer').checked) {
      addBasvuruNoBtn.disabled = true;
      basvuruNoInput.disabled = true;
      transferListContainer.classList.remove('d-none');
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
            transferListContainer.classList.add('d-none');
        }
    }
  }
});

// Sorgula butonuna tıklandığında
queryBtn.addEventListener('click', async () => {
  loading.classList.remove('d-none');
  const isSingle = document.getElementById('singleTransfer').checked;
  
  if (isSingle) {
    const basvuruNo = basvuruNumbers[0];
    singleResultContainer.classList.add('d-none');
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
  loading.classList.add('d-none');
});

// Tekil sonuçları göster
function displaySingleResult(data) {
  if (!data) {
    showNotification("Veri bulunamadı.", 'warning');
    return;
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
      cont.classList.remove('d-none');
      empty.classList.add('d-none');
    } else {
      cont.classList.add('d-none');
      empty.classList.remove('d-none');
    }
  }
}
