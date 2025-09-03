// ================================================
// Evreka IP — SADE (Sadece Sahip No) İçerik Scripti
// ================================================
// Çalışma şekli:
// - Yeni sekme URL'i: .../arastirma-yap?form=trademark&auto_query=SAHİP_NO&query_type=sahip
// - Veya background'dan: chrome.tabs.sendMessage({ type: 'AUTO_FILL_KISI', data: 'SAHİP_NO' })
// - iFrame (webim.turkpatent.gov.tr) içinde de çalışır (manifest: all_frames + matches).
//
// Yaptıkları:
// 1) Dolandırıcılık popup'ını kapatır (.jss84 .jss92 → svg/ikon).
// 2) "Marka Araştırması" tabında kalır (sekme değiştirmez).
// 3) input[placeholder="Kişi Numarası"] alanına sahip no'yu yazar (React controlled güvenli set).
// 4) Aynı bloktaki "Sorgula" butonuna tıklar; yoksa Enter gönderir.
// 5) Parent URL'deki auto_query'yi iframe'e yaymak için küçük postMessage köprüsü içerir.

const TAG = '[Evreka SahipNo]';

let targetKisiNo = null;

// --------- Yardımcılar ---------
function log(...args){ console.log(TAG, ...args); }
function warn(...args){ console.warn(TAG, ...args); }
function err(...args){ console.error(TAG, ...args); }

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

    const _resolve = resolve;
    resolve = (v) => { clearTimeout(to); _resolve(v); };
  });
}

function click(el) {
  if (!el) return false;
  try {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    }
  } catch {}
  return false;
}

function setReactInputValue(input, value) {
  const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (nativeDescriptor && nativeDescriptor.set) nativeDescriptor.set.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function pressEnter(el){
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
}

// --------- Modal Kapatma ---------
async function closeFraudModalIfAny() {
  // a) “Dolandırıcılık Hakkında” popup -> .jss84 > .jss92 (ikon)
  try {
    const fraudContainer = await waitFor('.jss84', { timeout: 1800 }).catch(()=>null);
    if (fraudContainer) {
      const closeEl = fraudContainer.querySelector('.jss92');
      if (closeEl && click(closeEl)) {
        log('Dolandırıcılık popup kapatıldı (.jss92).');
        await new Promise(r => setTimeout(r, 120));
        return;
      }
      // bazen kapatma handler'ı container'a bağlı olabilir
      if (click(fraudContainer)) {
        log('Dolandırıcılık popup container tıklandı (fallback).');
        await new Promise(r => setTimeout(r, 120));
        return;
      }
    }
  } catch (e) {
    warn('Fraud modal kapatma hata:', e?.message);
  }

  // b) Genel MUI dialog/overlay emniyet kemeri
  try {
    const anyDialog = await waitFor('[role="dialog"], .MuiDialog-root, .MuiModal-root, .modal', { timeout: 700 }).catch(()=>null);
    if (anyDialog) {
      const closeCandidate = anyDialog.querySelector('button[aria-label="Close"], button[aria-label="Kapat"], .close, .MuiIconButton-root[aria-label="close"]')
        || anyDialog.querySelector('button');
      if (closeCandidate && click(closeCandidate)) {
        log('Genel MUI modal kapatıldı.');
        await new Promise(r => setTimeout(r, 100));
        return;
      }
    }
  } catch (e) { /* sessiz geç */ }

  // c) ESC
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
}

// --------- Ana Akış (Sadece Kişi No) ---------
async function runOwnerFlow() {
  log('Sahip No akışı başladı:', targetKisiNo);
  if (!targetKisiNo) { warn('targetKisiNo boş; çıkış.'); return; }

  try { await closeFraudModalIfAny(); } catch {}

  // input[placeholder="Kişi Numarası"]
  let kisiInput =
    document.querySelector('input.MuiInputBase-input.MuiInput-input[placeholder="Kişi Numarası"]') ||
    document.querySelector('input[placeholder="Kişi Numarası"]');

  if (!kisiInput) {
    kisiInput = await waitFor('input[placeholder="Kişi Numarası"]', { timeout: 5000 }).catch(()=>null);
  }
  if (!kisiInput) { err('Kişi Numarası alanı bulunamadı.'); return; }

  // Aynı bloktaki Sorgula butonu → yoksa globalde bul → en sonda Enter
  let container = kisiInput.closest('.MuiFormControl-root') || kisiInput.closest('form') || document;
  let sorgulaBtn = Array.from(container.querySelectorAll('button')).find(b => /sorgula/i.test(b.textContent || ''));
  if (!sorgulaBtn) {
    const allButtons = Array.from(document.querySelectorAll('button'));
    sorgulaBtn = allButtons.find(b => /sorgula/i.test(b.textContent || ''));
  }

  kisiInput.focus();
  setReactInputValue(kisiInput, String(targetKisiNo));
  log('Kişi No yazıldı.');

  if (sorgulaBtn && click(sorgulaBtn)) {
    log('Sorgula tıklandı. ✔');
  } else {
    pressEnter(kisiInput);
    log('Sorgula butonu yok; Enter gönderildi. ✔');
  }
}

// --------- Background ve URL tetikleyicileri ---------
chrome.runtime?.onMessage?.addListener?.((request, sender, sendResponse) => {
  if (request?.type === 'AUTO_FILL_KISI' && request?.data) {
    targetKisiNo = request.data;
    runOwnerFlow().catch(err);
    sendResponse?.({ status: 'OK' });
  }
  return true;
});

// Parent → iframe köprüsü: üst sayfa auto_query'yi tüm framelere yayınlar
function broadcastAutoQueryToFrames(value) {
  try {
    const payload = { source: 'EVREKA', type: 'EVREKA_AUTO_QUERY', queryType: 'sahip', value };
    // tüm child framelere
    const frames = window.frames || [];
    for (let i = 0; i < frames.length; i++) {
      try { frames[i].postMessage(payload, '*'); } catch {}
    }
    // kendine de gönder (iframe'te olabiliriz)
    window.postMessage(payload, '*');
    log('auto_query yayınlandı:', payload);
  } catch (e) {
    warn('broadcastAutoQueryToFrames hata:', e?.message);
  }
}

// Her frame, köprü mesajını dinlesin
window.addEventListener('message', (e) => {
  const msg = e?.data;
  if (!msg || msg.source !== 'EVREKA' || msg.type !== 'EVREKA_AUTO_QUERY') return;
  if (msg.queryType === 'sahip') {
    targetKisiNo = msg.value;
    runOwnerFlow().catch(err);
  }
}, false);

// URL parametresi
function checkAutoQueryFromUrl() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const autoQuery = urlParams.get('auto_query');
    const queryType = urlParams.get('query_type');
    if (autoQuery && queryType === 'sahip') {
      log('URL üzerinden sahip no bulundu:', autoQuery);
      broadcastAutoQueryToFrames(autoQuery);
      targetKisiNo = autoQuery;
      runOwnerFlow().catch(err);
      return true;
    }
  } catch (e) {
    warn('URL param hatası:', e?.message);
  }
  return false;
}

document.addEventListener('DOMContentLoaded', () => {
  log('SahipNo script DOMContentLoaded. frame:', window.self !== window.top ? 'iframe' : 'top');
  checkAutoQueryFromUrl();
});
window.addEventListener('load', () => {
  log('SahipNo script window.load. frame:', window.self !== window.top ? 'iframe' : 'top');
  checkAutoQueryFromUrl();
});
