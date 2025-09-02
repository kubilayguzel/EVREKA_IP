// =============================
// TP Kişi Numarası Otomasyon Eklentisi
// =============================

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

// -------------- Yardımcılar --------------
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
    const to = setTimeout(() => {
      obs.disconnect();
      reject(new Error(`waitFor timeout: ${selector}`));
    }, timeout);
    const _resolve = (v) => { clearTimeout(to); resolve(v); };
  });
}

function click(el) {
  if (!el) return false;
  el.click();
  return true;
}

function findButtonByTextFast(text) {
  const btns = document.querySelectorAll('button');
  for (const b of btns) {
    if ((b.textContent || '').trim().includes(text)) return b;
    const spanBtn = b.querySelector('span');
    if (spanBtn && (spanBtn.textContent || '').trim().includes(text)) return b;
  }
  return null;
}

// -------------- Ana akış --------------
async function runAutomation() {
  console.log('[TP Eklenti] Otomasyon başladı. Kişi No:', targetOwnerId);

  // 1) Popup kapat
  try {
    const dialog = document.querySelector('[role="dialog"], .MuiDialog-root');
    if (dialog) {
      const closeBtn = dialog.querySelector('button[aria-label="Kapat"], .close');
      if (closeBtn) click(closeBtn);
    }
  } catch {}

  // 2) Formu doldur + Sorgula
  try {
    const input = await waitFor('input[placeholder*="Kişi Numarası"]', { timeout: 4000 });
    let sorgulaBtn = findButtonByTextFast('Sorgula');
    if (!sorgulaBtn) {
      sorgulaBtn = await waitFor('button', { timeout: 3000, test: (el) => (el.textContent || '').includes('Sorgula') });
    }

    input.focus();
    input.value = targetOwnerId;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[TP Eklenti] Kişi No yazıldı:', targetOwnerId);

    click(sorgulaBtn);
    console.log('[TP Eklenti] Sorgula butonuna tıklandı.');

    // 3) Sonuç tablosunun yüklenmesini bekle
    const tableExists = await waitFor('.MuiTable-root tbody tr', { timeout: 15000 });
    console.log('[TP Eklenti] Sonuç tablosu yüklendi. Veriler alınıyor.');

    // 4) Veriyi scrape et
    const scrapedData = [];
    const rows = document.querySelectorAll('.MuiTable-root tbody tr');
    
    rows.forEach(row => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const get = (role) => norm(row.querySelector(`td[role="${role}"]`)?.innerText);
      const imgEl = row.querySelector('td[role="image"] img');

      scrapedData.push({
        applicationNumber: get('applicationNo'),
        brandName: get('markName'),
        ownerName: get('holdName'),
        applicationDate: get('applicationDate'),
        registrationNumber: get('registrationNo'),
        status: get('state'),
        niceClasses: get('niceClasses'),
        imageUrl: imgEl ? imgEl.getAttribute('src') : '',
      });
    });

  // 5) Müvekkilin Uygulamadaki Verisi ile Kıyaslamak için Veriyi Uygulamaya Geri Gönder
  console.log('[TP Eklenti] Veriler başarıyla toplandı. PostMessage ile gönderiliyor.');
  window.postMessage({
    source: 'tp-extension-sahip',
    type: 'VERI_GELDI_KISI',
    data: scrapedData
  }, '*');
  console.log('[TP Eklenti] PostMessage gönderildi:', scrapedData.length, 'kayıt');

} catch (error) {
  console.error('[TP Eklenti] Otomasyon hatası:', error);
  // Hata durumunda da uygulamayı bilgilendir
  window.postMessage({
    source: 'tp-extension-sahip',
    type: 'HATA_KISI',
    data: { message: error.message }
  }, '*');
}
}