// =============================
// Evreka IP - Turkpatent Otomasyon (owner + application)
// =============================
// 2025-09-03: GÜNCEL
// - Modal kapatma güçlendirildi (kullanıcının paylaştığı snippet + ek fallback'lar)
// - "Kişi Numarası" alanı için doğrudan placeholder hedefleme ve React-controlled input güvenli set
// - "AUTO_FILL_KISI" desteği eklendi (arka plandan veya URL paramıyla tetiklenebilir)
// - Mevcut "AUTO_FILL" (Başvuru No) akışı korunuyor
//
// Not: tabs iznine gerek yok; içerik scripti sayfa yüklendiğinde kendini çalıştırır.

let targetBasvuruNo = null;
let targetKisiNo = null;
let sourceOrigin = null;

// ---------------- Yardımcılar ----------------
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
      el.click();
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

// ---------------- Modal Kapatma ----------------
async function closeModalsAdvanced() {
  // 1) Kullanıcının önerdiği yol
  try {
    const fraudClose = await waitFor('.jss84 .jss92', { timeout: 1500 });
    click(fraudClose);
    console.log('[Evreka Eklenti] Dolandırıcılık popup kapatıldı.');
    await new Promise(r => setTimeout(r, 200));
    return;
  } catch {}

  try {
    const anyDialog = await waitFor('[role="dialog"], .MuiDialog-root, .MuiModal-root, .modal', { timeout: 900 });
    const closeCandidate =
      anyDialog.querySelector('button[aria-label="Close"], button[aria-label="Kapat"], .close') ||
      anyDialog.querySelector('button');
    if (closeCandidate) {
      click(closeCandidate);
      console.log('[Evreka Eklenti] MUI modal kapatıldı.');
      await new Promise(r => setTimeout(r, 200));
      return;
    }
  } catch {}

  // 2) Ek yaygın kapama hedefleri
  const modalSelectors = [
    'button[aria-label="close"]',
    'button[aria-label="kapat"]',
    'button[aria-label="Close"]',
    'button[aria-label="Kapat"]',
    '.modal-header .close',
    '.MuiIconButton-root[aria-label="close"]',
    '[data-testid="CloseIcon"]',
    '.popup .close',
    '.modal-close',
    '.close-button',
    '.modal .close'
  ];
  for (const sel of modalSelectors) {
    const el = document.querySelector(sel);
    if (el && click(el)) {
      console.log('[Evreka Eklenti] Modal kapatıldı (selector):', sel);
      await new Promise(r => setTimeout(r, 200));
      return;
    }
  }

  // 3) Text/Aria tabanlı fallback
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    const txt = (btn.textContent || '').toLowerCase();
    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (txt.includes('kapat') || txt.includes('devam') || txt.includes('tamam') || txt.includes('close') ||
        aria.includes('kapat') || aria.includes('close')) {
      if (click(btn)) {
        console.log('[Evreka Eklenti] Modal kapatıldı (text/aria)');
        await new Promise(r => setTimeout(r, 200));
        return;
      }
    }
  }

  // 4) ESC
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
}

// ---------------- Başvuru No Akışı (mevcut) ----------------
async function runAutomationApplication() {
  console.log('[Evreka Eklenti] Otomasyon (Başvuru No) başladı:', targetBasvuruNo);

  try { await closeModalsAdvanced(); } catch {}

  // "Dosya Takibi" sekmesine geç (mevcut mantığı koru)
  let tabBtn = findButtonByTextFast('Dosya Takibi');
  if (!tabBtn) {
    try {
      tabBtn = await waitFor('button[role="tab"]', {
        timeout: 4000,
        test: (el) => (el.textContent || '').includes('Dosya Takibi')
      });
    } catch {}
  }
  if (tabBtn && tabBtn.getAttribute('aria-selected') !== 'true') {
    click(tabBtn);
    console.log('[Evreka Eklenti] "Dosya Takibi" sekmesine tıklandı.');
  }

  // Formu doldur + Sorgula
  const input = await waitFor('input[placeholder="Başvuru Numarası"]', { timeout: 5000 }).catch(() => null);
  if (!input) throw new Error('Başvuru Numarası alanı bulunamadı.');

  let sorgulaBtn = findButtonByTextFast('Sorgula');
  if (!sorgulaBtn) {
    sorgulaBtn = await waitFor('button', {
      timeout: 4000,
      test: (el) => (el.textContent || '').includes('Sorgula')
    }).catch(() => null);
  }
  if (!sorgulaBtn) throw new Error('Sorgula butonu bulunamadı.');

  input.focus();
  setReactInputValue(input, targetBasvuruNo);
  console.log('[Evreka Eklenti] Başvuru No yazıldı.');

  click(sorgulaBtn);
  console.log('[Evreka Eklenti] Sorgula (Başvuru No) tıklandı.');
}

// ---------------- Kişi No Akışı (yeni) ----------------
async function runAutomationOwner() {
  console.log('[Evreka Eklenti] Otomasyon (Kişi No) başladı:', targetKisiNo);

  try { await closeModalsAdvanced(); } catch {}

  // Doğrudan "Kişi Numarası" placeholder'lı inputu hedefle
  // Kullanıcının verdiği tam yapı:
  // <input aria-invalid="false" placeholder="Kişi Numarası" type="text" class="MuiInputBase-input MuiInput-input" value="">
  const kisiInput =
    document.querySelector('input.MuiInputBase-input.MuiInput-input[placeholder="Kişi Numarası"]') ||
    document.querySelector('input[placeholder="Kişi Numarası"]');

  if (!kisiInput) {
    throw new Error('Kişi Numarası alanı bulunamadı (placeholder="Kişi Numarası").');
  }

  // Aynı form alanındaki Sorgula butonunu bul (önce yakın çevre, sonra genel)
  let container = kisiInput.closest('.MuiFormControl-root') || kisiInput.closest('form') || document;
  let sorgulaBtn = Array.from(container.querySelectorAll('button')).find(b => /sorgula/i.test(b.textContent || ''));

  if (!sorgulaBtn) {
    // Yakın çevrede bulunamazsa sayfa genelinden ara
    sorgulaBtn = findButtonByTextFast('Sorgula') ||
      await waitFor('button', {
        timeout: 4000,
        test: (el) => /sorgula/i.test(el.textContent || '') || /sorgu|ara/i.test(el.getAttribute('aria-label') || '')
      }).catch(() => null);
  }

  if (!sorgulaBtn) throw new Error('Sorgula butonu bulunamadı.');

  // Değeri güvenli şekilde yaz
  kisiInput.focus();
  setReactInputValue(kisiInput, String(targetKisiNo));
  console.log('[Evreka Eklenti] Kişi No yazıldı.');

  // Tıkla
  click(sorgulaBtn);
  console.log('[Evreka Eklenti] Sorgula (Kişi No) tıklandı.');
}

// ---------------- Mesaj dinleyiciler ----------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.type === 'AUTO_FILL' && request.data) {
      targetBasvuruNo = request.data;
      runAutomationApplication().catch(err => console.error('[Evreka Eklenti] Hata(başvuru):', err));
      sendResponse?.({ status: 'OK' });
    }
    if (request.type === 'AUTO_FILL_KISI' && request.data) {
      targetKisiNo = request.data;
      runAutomationOwner().catch(err => console.error('[Evreka Eklenti] Hata(kisi):', err));
      sendResponse?.({ status: 'OK' });
    }
  } catch (e) {
    console.error('[Evreka Eklenti] Listener hata:', e);
  }
  return true;
});

// ---------------- URL param desteği ----------------
function checkAutoQueryFromUrl() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const autoQuery = urlParams.get('auto_query');
    const queryType = urlParams.get('query_type');
    sourceOrigin = urlParams.get('source') || null;

    if (autoQuery && queryType) {
      if (queryType === 'sahip') {
        targetKisiNo = autoQuery;
        runAutomationOwner().catch(err => console.error('[Evreka Eklenti] Hata(kisi/url):', err));
        return true;
      }
      if (queryType === 'application') {
        targetBasvuruNo = autoQuery;
        runAutomationApplication().catch(err => console.error('[Evreka Eklenti] Hata(basvuru/url):', err));
        return true;
      }
    }
  } catch (e) {
    console.warn('[Evreka Eklenti] URL param hatası:', e?.message);
  }
  return false;
}

document.addEventListener('DOMContentLoaded', () => {
  checkAutoQueryFromUrl();
});
window.addEventListener('load', () => {
  checkAutoQueryFromUrl();
});

console.log('[Evreka Eklenti] content_script (güncel) yüklendi.');
