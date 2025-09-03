// =============================
// TP Kişi Numarası Otomasyon Eklentisi
// ===================================

let targetOwnerId = null;
let sourceOrigin = null;

// URL parametrelerini kontrol et ve otomatik sorguyu başlat
function checkAutoQuery() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const autoQuery = urlParams.get('auto_query');
    sourceOrigin = urlParams.get('source') || sourceOrigin;
        const queryType = urlParams.get('query_type');
        sourceOrigin = urlParams.get('source');
        
        console.log('[TP Eklenti] URL parametreleri kontrol ediliyor:', { 
            autoQuery, 
            queryType, 
            sourceOrigin,
            currentURL: window.location.href 
        });
        
        if (autoQuery && queryType === 'sahip') {
            console.log('[TP Eklenti] Otomatik sorgu parametresi bulundu:', autoQuery);
            targetOwnerId = autoQuery;
            
            // Ana sayfaya eklenti hazır olduğunu bildir
            if (sourceOrigin) {
                try {
                    window.opener?.postMessage({
                        source: 'tp-extension-sahip',
                        type: 'EKLENTI_HAZIR',
                        data: { ownerId: targetOwnerId }
                    }, sourceOrigin);
                } catch (e) {
                    console.log('[TP Eklenti] Hazır bildirimi gönderim hatası:', e.message);
                }
            }
            
            // Kısa gecikme ile otomasyonu başlat  
            setTimeout(() => {
                runAutomation().catch(err => {
                    console.error('[TP Eklenti] Otomasyon hatası:', err);
                    sendErrorMessage(err.message || 'Otomasyon hatası');
                });
            }, 2000);
            
            return true;
        }
    } catch (error) {
        console.error('[TP Eklenti] URL parametre kontrolü hatası:', error);
        sendErrorMessage('URL parametre kontrolü hatası: ' + error.message);
    }
    return false;
}

// background.js'den gelen mesajları dinle (eski sistem için compat)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AUTO_FILL_KISI' && request.data) {
    targetOwnerId = request.data;
    console.log('[TP Eklenti] Background.js\'den mesaj alındı:', targetOwnerId);
    runAutomation().catch(err => {
        console.error('[TP Eklenti] Hata:', err);
        sendErrorMessage(err.message || 'Background mesajı işleme hatası');
    });
    sendResponse({ status: 'OK' });
  }
  return true;
});

// -------------- Yardımcı Fonksiyonlar --------------
function waitFor(selector, { root = document, timeout = 7000, test = null } = {}) {
  return new Promise((resolve, reject) => {
    // Hemen var mı kontrol et
    let el = root.querySelector(selector);
    if (el && (!test || test(el))) return resolve(el);

    // Observer ile dinamik değişiklikleri yakala
    const obs = new MutationObserver(() => {
      el = root.querySelector(selector);
      if (el && (!test || test(el))) {
        obs.disconnect();
        resolve(el);
      }
    });
    obs.observe(root, { childList: true, subtree: true, attributes: true });

    // Timeout güvenlik mekanizması
    const timeoutId = setTimeout(() => {
      obs.disconnect();
      reject(new Error(`waitFor timeout: ${selector}`));
    }, timeout);

    // Resolve olunca timeout'u temizle
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
  // Hızlı text arama (span içindeki buttonlar dahil)
  const btns = document.querySelectorAll('button');
  for (const btn of btns) {
    if ((btn.textContent || '').trim().includes(text)) return btn;
    const spanChild = btn.querySelector('span');
    if (spanChild && (spanChild.textContent || '').trim().includes(text)) return btn;
  }
  return null;
}

// Hata mesajı gönderme fonksiyonu
function sendErrorMessage(errorMsg) {
    try {
        if (sourceOrigin && window.opener) {
            window.opener.postMessage({
                source: 'tp-extension-sahip',
                type: 'HATA_KISI',
                data: { message: errorMsg }
            }, sourceOrigin);
        } else {
            // Fallback: broadcast
            window.postMessage({
                source: 'tp-extension-sahip',
                type: 'HATA_KISI',
                data: { message: errorMsg }
            }, '*');
        }
    } catch (e) {
        console.log('[TP Eklenti] Hata bildirimi gönderim hatası:', e.message);
    }
}

// Başarı mesajı gönderme fonksiyonu
function sendSuccessMessage(data) {
    const messageData = {
        source: 'tp-extension-sahip',
        type: 'VERI_GELDI_KISI', 
        data: data,
        timestamp: Date.now()
    };

    try {
        // Ana sayfaya (opener) mesaj gönder
        if (window.opener && sourceOrigin) {
            window.opener.postMessage(messageData, sourceOrigin);
            console.log('[TP Eklenti] Ana sayfaya mesaj gönderildi:', sourceOrigin);
        } else {
            // Fallback: Broadcast mesaj
            window.postMessage(messageData, '*');
            console.log('[TP Eklenti] Broadcast mesaj gönderildi');
        }
    } catch (postErr) {
        console.error('[TP Eklenti] PostMessage gönderim hatası:', postErr);
    }
}

// -------------- Ana Otomasyon Akışı --------------
async function runAutomation() {
  console.log('[TP Eklenti] Otomasyon başladı. Kişi No:', targetOwnerId);

  // Sorgu başladığını bildir
  if (sourceOrigin && window.opener) {
    try {
      window.opener.postMessage({
        source: 'tp-extension-sahip',
        type: 'SORGU_BASLADI',
        data: { ownerId: targetOwnerId }
      }, sourceOrigin);
    } catch (e) {
      console.log('[TP Eklenti] Başlangıç bildirimi hatası:', e.message);
    }
  }

  // 1) Modal/popup kapat (gelişmiş logic - tp-sorgu-eklentisi'nden alınmış)
  try {
    await closeModalsAdvanced();
  } catch (modalError) {
    console.log('[TP Eklenti] Modal kapatma hatası (devam ediliyor):', modalError.message);
  }

  // 2) Formu doldur ve sorguyu başlat
  try {
    // Kişi numarası input'unu bekle
    const input = await waitFor('input[placeholder*="Kişi Numarası"]', { timeout: 8000 });
    
    // Sorgula butonunu bul
    let sorgulaBtn = findButtonByTextFast('Sorgula');
    if (!sorgulaBtn) {
      sorgulaBtn = await waitFor('button', { 
        timeout: 5000, 
        test: (el) => (el.textContent || '').includes('Sorgula') 
      });
    }

    // Form alanını doldur
    input.focus();
    input.value = targetOwnerId;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[TP Eklenti] Kişi No yazıldı:', targetOwnerId);

    // Sorgula butonuna tıkla
    click(sorgulaBtn);
    console.log('[TP Eklenti] Sorgula butonuna tıklandı.');

    // 3) Sonuç tablosunun yüklenmesini bekle
    const tableExists = await waitFor('.MuiTable-root tbody tr', { timeout: 25000 });
    console.log('[TP Eklenti] Sonuç tablosu yüklendi. Veriler alınıyor.');

    // Kısa bekleme (tablo tamamen yüklensin)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 4) Veriyi scrape et
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

        // Boş satırları filtrele
        if (rowData.applicationNumber || rowData.brandName || rowData.ownerName) {
          scrapedData.push(rowData);
        }
      } catch (rowError) {
        console.warn('[TP Eklenti] Satır işleme hatası (atlanıyor):', index, rowError.message);
      }
    });

    console.log('[TP Eklenti] Veriler başarıyla toplandı:', scrapedData.length, 'kayıt');

    // 5) Veriyi ana uygulamaya geri gönder
    sendSuccessMessage(scrapedData);

  } catch (error) {
    console.error('[TP Eklenti] Otomasyon hatası:', error);
    sendErrorMessage(error.message || 'Bilinmeyen otomasyon hatası');
  }
}

// Modal kapatma fonksiyonu (tp-sorgu-eklentisi'nden alınmış gelişmiş versiyon)
async function closeModalsAdvanced() {
  console.log('[TP Eklenti] Gelişmiş modal kapatma başlıyor...');

  // 1) Dolandırıcılık Hakkında popup (öncelik)
  try {
    const fraudClose = await waitFor('.jss84 .jss92', { timeout: 2000 });
    if (click(fraudClose)) {
      console.log('[TP Eklenti] Dolandırıcılık popup kapatıldı (.jss84 .jss92)');
      await new Promise(resolve => setTimeout(resolve, 800)); // Animasyon bekle
      return; // Başarılıysa diğerlerini deneme
    }
  } catch (e) {
    console.log('[TP Eklenti] Dolandırıcılık popup bulunamadı');
  }

  // 2) MUI Dialog/Modal
  try {
    const anyDialog = await waitFor('[role="dialog"], .MuiDialog-root, .MuiModal-root, .modal', { timeout: 2000 });
    const closeCandidate = anyDialog.querySelector('button[aria-label="Close"], button[aria-label="Kapat"], .close') || anyDialog.querySelector('button');
    if (closeCandidate && click(closeCandidate)) {
      console.log('[TP Eklenti] MUI modal kapatıldı');
      await new Promise(resolve => setTimeout(resolve, 800));
      return;
    }
  } catch (e) {
    console.log('[TP Eklenti] MUI modal bulunamadı');
  }

  // 3) Tüm modal selektorları (kapsamlı)
  const modalSelectors = [
    'button[aria-label="close"]',
    'button[aria-label="kapat"]', 
    'button[aria-label="Close"]',
    'button[aria-label="Kapat"]',
    '.modal-header .close',
    '.MuiIconButton-root[aria-label="close"]',
    '[data-testid="CloseIcon"]',
    '.popup .close',
    '[role="dialog"] button:last-child',
    '.modal-close',
    '.close-button',
    '.modal .close'
  ];

  for (const selector of modalSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element && click(element)) {
        console.log('[TP Eklenti] Modal kapatıldı (selector):', selector);
        await new Promise(resolve => setTimeout(resolve, 800));
        return;
      }
    } catch (e) {
      continue;
    }
  }

  // 4) Text tabanlı button arama (en kapsamlı)
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    const text = (btn.textContent || '').toLowerCase().trim();
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    
    if (text.includes('devam') || text.includes('kapat') || text.includes('tamam') || 
        text.includes('close') || text.includes('devam et') || text.includes('anladım') ||
        ariaLabel.includes('close') || ariaLabel.includes('kapat')) {
      if (click(btn)) {
        console.log('[TP Eklenti] Modal kapatıldı (text/aria):', text || ariaLabel);
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Modal kapatıldığını bildir
        if (sourceOrigin && window.opener) {
          try {
            window.opener.postMessage({
              source: 'tp-extension-sahip',
              type: 'MODAL_KAPATILDI',
              data: { buttonText: text || ariaLabel }
            }, sourceOrigin);
          } catch (e) {
            console.log('[TP Eklenti] Modal kapatma bildirimi hatası:', e.message);
          }
        }
        return;
      }
    }
  }

  // 5) Son çare: ESC tuşu
  try {
    document.dispatchEvent(new KeyboardEvent('keydown', { 
      key: 'Escape', 
      code: 'Escape',
      keyCode: 27,
      bubbles: true,
      cancelable: true
    }));
    console.log('[TP Eklenti] ESC tuşu gönderildi');
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (e) {
    console.log('[TP Eklenti] ESC tuşu gönderim hatası:', e.message);
  }

  console.log('[TP Eklenti] Modal kapatma işlemi tamamlandı');
}

// Sayfa event dinleyicileri
document.addEventListener('DOMContentLoaded', () => {
    console.log('[TP Eklenti] DOMContentLoaded - Kontrol başlatılıyor');
    checkAutoQuery();
});

window.addEventListener('load', () => {
    console.log('[TP Eklenti] Window loaded - Kontrol başlatılıyor');
    if (!targetOwnerId) { // Zaten başlatılmadıysa
        checkAutoQuery();
    }
});

// URL değişikliklerini takip et (SPA için)
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

// URL observer'ı başlat
urlObserver.observe(document, { subtree: true, childList: true });

console.log('[TP Eklenti] Content script yüklendi ve hazır');