// =============================
// Evreka IP - Turkpatent Otomasyon (Owner + Application)
// =============================
// 2025-09-03 (rev2):
// - iframe desteği için manifestte all_frames + webim.* eklendi (içerik scripti her frame'de yüklenecek)
// - Modal kapatma: .jss84 > .jss92 close ikonuna doğrudan tıkla + parent fallback
// - "Sahip / Vekil" sekmesi ve "Kişi" filtresi otomatik aktive edildi (activateOwnerSearchContext geri eklendi)
// - Kişi No akışında 3 aşamalı retry (modal -> sekme/filtresi -> input+buton) ve ayrıntılı log
// - React kontrollü input için güvenli set + 'Enter' fallback
//
// Not: Bu script, hem üst sayfada hem de iframe'lerde çalışır.

let targetBasvuruNo = null;
let targetKisiNo = null;
let sourceOrigin = null;

// --------------- Helpers ---------------
function log(...args){ console.log('[Evreka Eklenti]', ...args); }

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

function findButtonByTextFast(text) {
  const btns = document.querySelectorAll('button');
  for (const b of btns) {
    const t = (b.textContent || '').trim();
    const a = (b.getAttribute('aria-label') || '').trim();
    if (t.includes(text) || a.includes(text)) return b;
    const spanBtn = b.querySelector('span');
    if (spanBtn) {
      const st = (spanBtn.textContent || '').trim();
      if (st.includes(text)) return b;
    }
  }
  return null;
}

function setReactInputValue(input, value) {
  const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (nativeDescriptor && nativeDescriptor.set) {
    nativeDescriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function pressEnter(el){
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
}

// --------------- Modal Kapatma ---------------
async function closeModalsAdvanced() {
  // a) “Dolandırıcılık Hakkında” popup -> .jss84 > .jss92 (span)
  try {
    const fraudContainer = await waitFor('.jss84', { timeout: 2000 }).catch(()=>null);
    if (fraudContainer) {
      const closeEl = fraudContainer.querySelector('.jss92');
      if (closeEl && click(closeEl)) {
        log('Dolandırıcılık popup kapatıldı (.jss92).');
        await new Promise(r => setTimeout(r, 150));
        return;
      }
      // bazen kapatma handler'ı container'a bağlı olabilir
      if (click(fraudContainer)) {
        log('Dolandırıcılık popup container tıklandı (fallback).');
        await new Promise(r => setTimeout(r, 150));
        return;
      }
    }
  } catch {}

  // b) MUI dialog/overlay
  try {
    const anyDialog = await waitFor('[role="dialog"], .MuiDialog-root, .MuiModal-root, .modal', { timeout: 900 });
    const closeCandidate = anyDialog.querySelector('button[aria-label="Close"], button[aria-label="Kapat"], .close, .MuiIconButton-root[aria-label="close"]')
      || anyDialog.querySelector('button');
    if (closeCandidate && click(closeCandidate)) {
      log('MUI modal kapatıldı.');
      await new Promise(r => setTimeout(r, 150));
      return;
    }
  } catch {}

  // c) Text/aria fallback
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    const txt = (btn.textContent || '').toLowerCase();
    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (txt.includes('kapat') || txt.includes('devam') || txt.includes('tamam') || txt.includes('close') ||
        aria.includes('kapat') || aria.includes('close')) {
      if (click(btn)) {
        log('Modal kapatıldı (text/aria).');
        await new Promise(r => setTimeout(r, 150));
        return;
      }
    }
  }

  // d) ESC
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
}

// --------------- Owner context ---------------
async function activateOwnerSearchContext() {
  // "Sahip / Vekil" veya "Sahip" tabını dene
  const possibleOwnerTabTexts = ['Sahip / Vekil', 'Sahip', 'Kişi', 'Vekil'];
  let activated = false;

  const tabs = Array.from(document.querySelectorAll('[role="tab"], .MuiTab-root, .tab, .nav-tabs .nav-link'));
  for (const t of tabs) {
    const tx = (t.textContent || '').trim();
    if (possibleOwnerTabTexts.some(s => tx.includes(s))) {
      if (click(t)) {
        activated = true;
        await new Promise(r => setTimeout(r, 200));
        break;
      }
    }
  }

  // Radyo kutusu / select ile "Kişi Numarası" filtresi seç
  const radios = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
  for (const r of radios) {
    const label = document.querySelector(`label[for="${r.id}"]`);
    const lt = (label?.textContent || '').toLowerCase();
    if (lt.includes('kişi') || lt.includes('sahip')) {
      if (!r.checked) r.click();
      activated = true;
      await new Promise(r => setTimeout(r, 150));
      break;
    }
  }

  const selects = Array.from(document.querySelectorAll('select'));
  for (const s of selects) {
    const option = Array.from(s.options).find(o => /kişi|sahip/i.test(o.textContent || ''));
    if (option) { s.value = option.value; s.dispatchEvent(new Event('change', { bubbles: true })); activated = true; break; }
  }

  if (activated) log('Owner/Kişi konteksi aktive edildi.');
}

// --------------- Otomasyon Akışları ---------------
async function runAutomationOwner() {
  log('Otomasyon (Kişi No) başladı:', targetKisiNo);

  // Retry 1: Modal
  try { await closeModalsAdvanced(); } catch (e) { log('Modal kapatma hata:', e?.message); }

  // Retry 2: Owner/Kişi sekmesi
  try { await activateOwnerSearchContext(); } catch (e) { log('Owner context hata:', e?.message); }

  // Retry 3: Input + buton
  // <input placeholder="Kişi Numarası" class="MuiInputBase-input MuiInput-input">
  let kisiInput = document.querySelector('input.MuiInputBase-input.MuiInput-input[placeholder="Kişi Numarası"]') ||
                  document.querySelector('input[placeholder="Kişi Numarası"]');

  if (!kisiInput) {
    // Bazı durumlarda input geç yüklenebilir
    kisiInput = await waitFor('input[placeholder="Kişi Numarası"]', { timeout: 5000 }).catch(()=>null);
  }
  if (!kisiInput) throw new Error('Kişi Numarası alanı bulunamadı.');

  // Aynı blokta Sorgula
  let container = kisiInput.closest('.MuiFormControl-root') || kisiInput.closest('form') || document;
  let sorgulaBtn = Array.from(container.querySelectorAll('button')).find(b => /sorgula/i.test(b.textContent || ''));
  if (!sorgulaBtn) sorgulaBtn = findButtonByTextFast('Sorgula');

  if (!sorgulaBtn) {
    // bazı sayfalarda enter ile tetikleme çalışır
    log('Sorgula butonu bulunamadı; Enter denenecek.');
  }

  kisiInput.focus();
  setReactInputValue(kisiInput, String(targetKisiNo));
  log('Kişi No yazıldı.');

  if (sorgulaBtn) {
    click(sorgulaBtn);
    log('Sorgula (Kişi) tıklandı.');
  } else {
    pressEnter(kisiInput);
    log('Enter gönderildi.');
  }
}

async function runAutomationApplication() {
  log('Otomasyon (Başvuru No) başladı:', targetBasvuruNo);

  try { await closeModalsAdvanced(); } catch {}
  let tabBtn = findButtonByTextFast('Dosya Takibi');
  if (!tabBtn) {
    try {
      tabBtn = await waitFor('button[role="tab"]', {
        timeout: 4000,
        test: (el) => (el.textContent || '').includes('Dosya Takibi')
      });
    } catch {}
  }
  if (tabBtn && tabBtn.getAttribute('aria-selected') !== 'true') click(tabBtn);

  const input = await waitFor('input[placeholder="Başvuru Numarası"]', { timeout: 5000 }).catch(() => null);
  if (!input) throw new Error('Başvuru Numarası alanı bulunamadı.');

  let sorgulaBtn = findButtonByTextFast('Sorgula') ||
    await waitFor('button', { timeout: 4000, test: (el) => (el.textContent || '').includes('Sorgula') }).catch(() => null);
  if (!sorgulaBtn) throw new Error('Sorgula butonu bulunamadı.');

  input.focus();
  setReactInputValue(input, targetBasvuruNo);
  click(sorgulaBtn);
  log('Sorgula (Başvuru) tıklandı.');
}

// --------------- Messaging ---------------
chrome.runtime?.onMessage?.addListener?.((request, sender, sendResponse) => {
  try {
    if (request.type === 'AUTO_FILL' && request.data) {
      targetBasvuruNo = request.data;
      runAutomationApplication().catch(err => log('Hata(başvuru):', err));
      sendResponse?.({ status: 'OK' });
    }
    if (request.type === 'AUTO_FILL_KISI' && request.data) {
      targetKisiNo = request.data;
      runAutomationOwner().catch(err => log('Hata(kisi):', err));
      sendResponse?.({ status: 'OK' });
    }
  } catch (e) {
    log('Listener hata:', e);
  }
  return true;
});

function checkAutoQueryFromUrl() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const autoQuery = urlParams.get('auto_query');
    const queryType = urlParams.get('query_type');
    sourceOrigin = urlParams.get('source') || null;

    if (autoQuery && queryType) {
      if (queryType === 'sahip') {
        targetKisiNo = autoQuery;
        runAutomationOwner().catch(err => log('Hata(kisi/url):', err));
        return true;
      }
      if (queryType === 'application') {
        targetBasvuruNo = autoQuery;
        runAutomationApplication().catch(err => log('Hata(basvuru/url):', err));
        return true;
      }
    }
  } catch (e) {
    log('URL param hatası:', e?.message);
  }
  return false;
}

document.addEventListener('DOMContentLoaded', () => { checkAutoQueryFromUrl(); });
window.addEventListener('load', () => { checkAutoQueryFromUrl(); });

log('content_script (rev2) yüklendi. frame:', window.self !== window.top ? 'iframe' : 'top');
