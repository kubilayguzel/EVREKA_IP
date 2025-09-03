
function getQueryParam(name) {
  const u = new URL(location.href);
  return u.searchParams.get(name);
}
function encodePayload(obj){
  try{ return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }catch(e){ return ''; }
}

function deliverResultsToReturnUrl(ownerId, data){
  const ret = getQueryParam('return');
  if (ret) {
    const url = new URL(decodeURIComponent(ret));
    url.hash = 'tpdata=' + encodePayload({ ownerId, items: data });
    location.href = url.toString();
    return true;
  }
  return false;
}


// =============================
// TP Kişi Numarası Otomasyon Eklentisi
// ===================================
let targetOwnerId = null;

// background.js'den komutu al
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AUTO_FILL_KISI' && request.data) {
    targetOwnerId = request.data;
    runAutomation().catch(err => console.error('[TP Eklenti] Hata:', err));
    sendResponse({ status: 'OK' });
  }
  return true;
});

// -------------- Yardımcı Fonksiyonlar --------------
function waitFor(selector, { root = document, timeout = 7000, test = null } = {}) {
  return new Promise((resolve, reject) => {
    let el = root.querySelector(selector);
    if (el && (!test || test(el))) return resolve(el);

    const obs = new MutationObserver(() => {
      el = root.querySelector(selector);
      if (el && (!test || test(el))) {
        obs.disconnect();
        resolve(el);
      }
    });
    obs.observe(root, { childList: true, subtree: true, attributes: true });

    const timeoutId = setTimeout(() => {
      obs.disconnect();
      reject(new Error(`waitFor timeout: ${selector}`));
    }, timeout);

    const originalResolve = resolve;
    resolve = (value) => {
      clearTimeout(timeoutId);
      originalResolve(value);
    };
  });
}

function click(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    el.click();
    return true;
  }
  return false;
}

function findButtonByTextFast(text) {
  const btns = document.querySelectorAll('button');
  for (const btn of btns) {
    if ((btn.textContent || '').trim().includes(text)) return btn;
    const spanChild = btn.querySelector('span');
    if (spanChild && (spanChild.textContent || '').trim().includes(text)) return btn;
  }
  return null;
}

function sendErrorMessage(errorMsg) {
  window.postMessage({
    source: 'tp-extension-sahip',
    type: 'HATA_KISI',
    data: { message: errorMsg }
  }, '*');
}

function if (!deliverResultsToReturnUrl(targetOwnerId, scrapedData)) { sendSuccessMessage(data); }{
  const messageData = {
    source: 'tp-extension-sahip',
    type: 'VERI_GELDI_KISI',
    data: data,
    timestamp: Date.now()
  };
  window.postMessage(messageData, '*');
}

// -------------- Ana Otomasyon Akışı --------------
async function runAutomation() {
  console.log('[TP Eklenti] Otomasyon başladı. Kişi No:', targetOwnerId);

  try {
    await closeModals();
  } catch (modalError) {
    console.log('[TP Eklenti] Modal kapatma hatası (devam ediliyor):', modalError.message);
  }

  try {
    const input = await waitFor('input[placeholder*="Kişi Numarası"]', { timeout: 6000 });
    
    let sorgulaBtn = findButtonByTextFast('Sorgula');
    if (!sorgulaBtn) {
      sorgulaBtn = await waitFor('button', { 
        timeout: 4000, 
        test: (el) => (el.textContent || '').includes('Sorgula') 
      });
    }

    input.focus();
    input.value = targetOwnerId;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[TP Eklenti] Kişi No yazıldı:', targetOwnerId);

    click(sorgulaBtn);
    console.log('[TP Eklenti] Sorgula butonuna tıklandı.');

    const tableExists = await waitFor('.MuiTable-root tbody tr', { timeout: 20000 });
    console.log('[TP Eklenti] Sonuç tablosu yüklendi. Veriler alınıyor.');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const scrapedData = [];
    const rows = document.querySelectorAll('.MuiTable-root tbody tr');
    
    if (rows.length === 0) {
      throw new Error('Sonuç tablosunda satır bulunamadı');
    }
    
    rows.forEach((row, index) => {
      try {
        const normalize = (str) => (str || '').replace(/\s+/g, ' ').trim();
        const getByRole = (role) => normalize(row.querySelector(`td[role="${role}"]`)?.innerText);
        const imageElement = row.querySelector('td[role="image"] img');

        const rowData = {
          applicationNumber: getByRole('applicationNo'),
          brandName: getByRole('markName'),
          ownerName: getByRole('holdName'),
          applicationDate: getByRole('applicationDate'),
          registrationNumber: getByRole('registrationNo'),
          status: getByRole('state'),
          niceClasses: getByRole('niceClasses'),
          imageUrl: imageElement ? imageElement.getAttribute('src') : '',
        };

        if (rowData.applicationNumber || rowData.brandName || rowData.ownerName) {
          scrapedData.push(rowData);
        }
      } catch (rowError) {
        console.warn('[TP Eklenti] Satır işleme hatası (atlanıyor):', index, rowError.message);
      }
    });

    console.log('[TP Eklenti] Veriler başarıyla toplandı:', scrapedData.length, 'kayıt');
if (!deliverResultsToReturnUrl(targetOwnerId, scrapedData)) {
  sendSuccessMessage(scrapedData);
}
} catch (error) {
    console.error('[TP Eklenti] Otomasyon hatası:', error);
    sendErrorMessage(error.message || 'Bilinmeyen otomasyon hatası');
  }
}

// Modal kapatma fonksiyonu (gelişmiş)
async function closeModals() {
  const modalSelectors = [
    '.jss84 .jss92',
    'button[aria-label="close"]',
    'button[aria-label="kapat"]',
    'button[aria-label="Close"]',
    '.modal-header .close',
    '.MuiIconButton-root[aria-label="close"]',
    '[data-testid="CloseIcon"]',
    '.popup .close',
    '[role="dialog"] button:last-child',
  ];

  for (const selector of modalSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element && click(element)) {
        console.log('[TP Eklenti] Modal kapatıldı (selector):', selector);
        await new Promise(resolve => setTimeout(resolve, 500));
        break;
      }
    } catch (e) {
      continue;
    }
  }

  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    const text = (btn.textContent || '').toLowerCase().trim();
    if (text.includes('devam') || text.includes('kapat') || text.includes('tamam') || text.includes('close')) {
      if (click(btn)) {
        console.log('[TP Eklenti] Modal kapatıldı (text):', text);
        await new Promise(resolve => setTimeout(resolve, 500));
        break;
      }
    }
  }

  try {
    document.dispatchEvent(new KeyboardEvent('keydown', { 
      key: 'Escape', 
      code: 'Escape',
      keyCode: 27 
    }));
    console.log('[TP Eklenti] ESC tuşu gönderildi');
  } catch (e) {
    console.log('[TP Eklenti] ESC tuşu gönderim hatası:', e.message);
  }
}

// Sayfa event dinleyicileri
document.addEventListener('DOMContentLoaded', () => {
    console.log('[TP Eklenti] DOMContentLoaded - Kontrol başlatılıyor');
    checkAutoQuery();
});

window.addEventListener('load', () => {
    console.log('[TP Eklenti] Window loaded - Kontrol başlatılıyor');
    if (!targetOwnerId) {
        checkAutoQuery();
    }
});

let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('[TP Eklenti] URL değişikliği tespit edildi:', currentUrl);
        if (checkAutoQuery()) {
            console.log('[TP Eklenti] URL değişikliği ile otomatik sorgu tetiklendi');
        }
    }
});

urlObserver.observe(document, { subtree: true, childList: true });

console.log('[TP Eklenti] Content script yüklendi ve hazır');