// =============================
// TP Kişi Numarası Otomasyon Eklentisi (GÜNCEL)
// =============================
// Değişiklikler (2025-09-03):
// - Modal kapatma mantığı güçlendirildi (kullanıcının önerdiği snippet entegre edildi)
// - "Kişi Numarası" alanını bulma stratejisi çok daha dayanıklı hale getirildi (label/placeholder/role/name/id taraması)
// - "Sahip / Vekil" sekmesini ve "Kişi Numarası" filtresini otomatik seçme adımları eklendi
// - MUI/React kontrollü inputlarda reliable value set + input/change event dispatch eklendi
// - Sorgula butonu için metin/aria ve genel fallback ile gelişmiş buton bulucu eklendi
// - Sonuç tablosu bekleme ve scrape akışı korundu

let targetOwnerId = null;
let sourceOrigin = null;

// =============== Yardımcılar ===============
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

    const _resolve = resolve;
    resolve = (v) => { clearTimeout(timeoutId); _resolve(v); };
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
    const t = (btn.textContent || '').trim();
    const a = (btn.getAttribute('aria-label') || '').trim();
    if (t.includes(text) || a.includes(text)) return btn;
    const spanChild = btn.querySelector('span');
    if (spanChild) {
      const st = (spanChild.textContent || '').trim();
      if (st.includes(text)) return btn;
    }
  }
  return null;
}

function setReactInputValue(input, value) {
  // React kontrollü inputlarda value ataması için güvenli yol
  const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  nativeDescriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function sendErrorMessage(errorMsg) {
  try {
    if (sourceOrigin && window.opener) {
      window.opener.postMessage({ source: 'tp-extension-sahip', type: 'HATA_KISI', data: { message: errorMsg } }, sourceOrigin);
    } else {
      window.postMessage({ source: 'tp-extension-sahip', type: 'HATA_KISI', data: { message: errorMsg } }, '*');
    }
  } catch (e) {}
}

function sendSuccessMessage(data) {
  const messageData = {
    source: 'tp-extension-sahip',
    type: 'VERI_GELDI_KISI',
    data,
    timestamp: Date.now()
  };
  try {
    if (window.opener && sourceOrigin) {
      window.opener.postMessage(messageData, sourceOrigin);
    } else {
      window.postMessage(messageData, '*');
    }
  } catch {}
}

// =============== URL param kontrolü ===============
function checkAutoQuery() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const autoQuery = urlParams.get('auto_query');
    const queryType = urlParams.get('query_type');
    sourceOrigin = urlParams.get('source');

    console.log('[TP Eklenti] URL params:', { autoQuery, queryType, sourceOrigin });
    if (autoQuery && queryType === 'sahip') {
      targetOwnerId = autoQuery;
      if (sourceOrigin) {
        try {
          window.opener?.postMessage({ source: 'tp-extension-sahip', type: 'EKLENTI_HAZIR', data: { ownerId: targetOwnerId } }, sourceOrigin);
        } catch {}
      }
      setTimeout(() => {
        runAutomation().catch(err => {
          console.error('[TP Eklenti] Otomasyon hatası:', err);
          sendErrorMessage(err.message || 'Otomasyon hatası');
        });
      }, 1600);
      return true;
    }
  } catch (e) {
    console.error('[TP Eklenti] URL kontrol hatası:', e);
    sendErrorMessage('URL parametre kontrolü hatası: ' + e.message);
  }
  return false;
}

// =============== Background uyumluluğu ===============
chrome.runtime?.onMessage?.addListener?.((request, sender, sendResponse) => {
  if (request.type === 'AUTO_FILL_KISI' && request.data) {
    targetOwnerId = request.data;
    console.log('[TP Eklenti] Background mesajı (ownerId):', targetOwnerId);
    runAutomation().catch(err => {
      console.error('[TP Eklenti] Hata:', err);
      sendErrorMessage(err.message || 'Background mesajı işleme hatası');
    });
    sendResponse?.({ status: 'OK' });
  }
  return true;
});

// =============== Gelişmiş modal kapatma ===============
async function closeModalsAdvanced() {
  console.log('[TP Eklenti] Modal kapatma başlıyor');

  // Kullanıcının önerdiği hızlı strateji
  try {
    // a) “Dolandırıcılık Hakkında” popup
    const fraudClose = await waitFor('.jss84 .jss92', { timeout: 1500 });
    click(fraudClose);
    console.log('[Evreka Eklenti] Dolandırıcılık popup kapatıldı.');
    await new Promise(r => setTimeout(r, 400));
    return;
  } catch {}

  try {
    // b) Klasik MUI dialog/overlay (varsa)
    const anyDialog = await waitFor('[role="dialog"], .MuiDialog-root, .MuiModal-root, .modal', { timeout: 800 });
    const closeCandidate = anyDialog.querySelector('button[aria-label="Close"], button[aria-label="Kapat"], .close') || anyDialog.querySelector('button');
    if (closeCandidate) {
      click(closeCandidate);
      console.log('[Evreka Eklenti] MUI modal kapatıldı.');
      await new Promise(r => setTimeout(r, 400));
      return;
    }
  } catch {}

  // Ek geniş kapsam
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

  for (const sel of modalSelectors) {
    const el = document.querySelector(sel);
    if (el && click(el)) {
      console.log('[TP Eklenti] Modal kapatıldı (selector):', sel);
      await new Promise(r => setTimeout(r, 400));
      return;
    }
  }

  // Text tabanlı son şans
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    const text = (btn.textContent || '').toLowerCase();
    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (text.includes('devam') || text.includes('kapat') || text.includes('tamam') ||
        text.includes('close') || text.includes('anladım') || aria.includes('close') || aria.includes('kapat')) {
      if (click(btn)) {
        console.log('[TP Eklenti] Modal kapatıldı (text/aria):', text || aria);
        await new Promise(r => setTimeout(r, 400));
        return;
      }
    }
  }

  // ESC
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 250));
  console.log('[TP Eklenti] Modal kapatma tamam');
}

// =============== Form sekmesi ve input bulma ===============
function getInputByLabelTexts(candidateTexts) {
  // Label -> input eşleştirme
  const labels = Array.from(document.querySelectorAll('label'));
  for (const lbl of labels) {
    const t = (lbl.textContent || '').trim().toLowerCase();
    if (candidateTexts.some(c => t.includes(c))) {
      // for/id ilişkisi
      const forId = lbl.getAttribute('for');
      if (forId) {
        const byId = document.getElementById(forId);
        if (byId) return byId;
      }
      // sibling input
      const sibInput = lbl.parentElement?.querySelector('input, [contenteditable="true"]');
      if (sibInput) return sibInput;
    }
  }
  return null;
}

function findOwnerIdInputRobust() {
  // 1) Placeholder
  let el = document.querySelector('input[placeholder*="Kişi Numarası" i]')
        || document.querySelector('input[placeholder*="Sahip Numarası" i]')
        || document.querySelector('input[placeholder*="Sahip / Kişi" i]');
  if (el) return el;

  // 2) Label temelli
  el = getInputByLabelTexts(['kişi numarası', 'sahip numarası', 'sahip', 'kişi']);
  if (el) return el;

  // 3) Name/ID tahminleri
  const guesses = ['owner', 'holder', 'kisi', 'sahip', 'identity', 'tpe', 'tax', 'id'];
  for (const g of guesses) {
    el = document.querySelector(`input[name*="${g}" i]`) || document.querySelector(`input[id*="${g}" i]`);
    if (el) return el;
  }

  // 4) MUI TextField input
  el = document.querySelector('.MuiTextField-root input') || document.querySelector('.MuiInputBase-input');
  if (el) return el;

  return null;
}

async function activateOwnerSearchContext() {
  // Bazı sayfalarda "Sahip / Vekil" sekmesi veya "Kişi Numarası" filtresi seçilmeli
  const possibleOwnerTabTexts = ['Sahip', 'Sahip / Vekil', 'Vekil', 'Kişi'];
  // Sekmeler
  const tabs = Array.from(document.querySelectorAll('[role="tab"], .MuiTab-root, .tab, .nav-tabs .nav-link'));
  for (const t of tabs) {
    const tx = (t.textContent || '').trim();
    if (possibleOwnerTabTexts.some(s => tx.includes(s))) {
      click(t);
      await new Promise(r => setTimeout(r, 200));
      break;
    }
  }

  // Radio veya dropdown filtresi
  const radios = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
  for (const r of radios) {
    const label = document.querySelector(`label[for="${r.id}"]`);
    const lt = (label?.textContent || '').toLowerCase();
    if (lt.includes('kişi') || lt.includes('sahip')) {
      if (!r.checked) {
        r.click();
        await new Promise(r => setTimeout(r, 200));
      }
      break;
    }
  }

  // Açılır menü (select)
  const selects = Array.from(document.querySelectorAll('select'));
  for (const s of selects) {
    const option = Array.from(s.options).find(o => /kişi|sahip/i.test(o.textContent || ''));
    if (option) { s.value = option.value; s.dispatchEvent(new Event('change', { bubbles: true })); break; }
  }
}

// =============== Ana akış ===============
async function runAutomation() {
  console.log('[TP Eklenti] Otomasyon başladı. Kişi No:', targetOwnerId);

  if (sourceOrigin && window.opener) {
    try {
      window.opener.postMessage({ source: 'tp-extension-sahip', type: 'SORGU_BASLADI', data: { ownerId: targetOwnerId } }, sourceOrigin);
    } catch {}
  }

  // 1) Modal kapat
  try { await closeModalsAdvanced(); } catch (e) { console.log('[TP Eklenti] Modal kapatma hatası:', e?.message); }

  // 2) Sahip/kişi kontekstini aktive et
  try { await activateOwnerSearchContext(); } catch {}

  // 3) Input'u bul ve yaz
  let input = null;
  try {
    input = findOwnerIdInputRobust() || await waitFor('input', { timeout: 5000, test: (el) => true });
  } catch {}
  if (!input) throw new Error('Kişi/Sahip numarası girişi bulunamadı.');

  try {
    input.focus();
    setReactInputValue(input, targetOwnerId);
    console.log('[TP Eklenti] Kişi No yazıldı:', targetOwnerId);
  } catch (e) {
    console.warn('[TP Eklenti] Input set hatası, fallback deneniyor:', e?.message);
    try {
      input.value = targetOwnerId;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {}
  }

  // 4) Sorgula butonunu bul ve tıkla
  let sorgulaBtn = findButtonByTextFast('Sorgula');
  if (!sorgulaBtn) {
    try {
      sorgulaBtn = await waitFor('button', { timeout: 5000, test: (el) => /sorgula/i.test(el.textContent || '') || /sorgu|ara/i.test(el.getAttribute('aria-label') || '') });
    } catch {}
  }
  if (!sorgulaBtn) throw new Error('Sorgula butonu bulunamadı.');
  click(sorgulaBtn);
  console.log('[TP Eklenti] Sorgula butonuna tıklandı.');

  // 5) Sonuç bekle ve topla
  const tableExists = await waitFor('.MuiTable-root tbody tr, table tbody tr', { timeout: 25000 });
  if (!tableExists) throw new Error('Sonuç tablosu bulunamadı.');
  await new Promise(r => setTimeout(r, 900));

  const scrapedData = [];
  const rows = document.querySelectorAll('.MuiTable-root tbody tr, table tbody tr');
  rows.forEach((row, index) => {
    try {
      const normalize = (str) => (str || '').replace(/\s+/g, ' ').trim();
      const getByRole = (role) => normalize(row.querySelector(`td[role="${role}"]`)?.innerText);
      const imageElement = row.querySelector('td[role="image"] img');

      const applicationNumber = getByRole('applicationNo') || normalize(row.cells?.[1]?.innerText);
      const brandName = getByRole('markName') || normalize(row.cells?.[2]?.innerText);
      const ownerName = getByRole('holdName') || normalize(row.cells?.[3]?.innerText);
      const applicationDate = getByRole('applicationDate') || normalize(row.cells?.[4]?.innerText);
      const registrationNumber = getByRole('registrationNo') || normalize(row.cells?.[5]?.innerText);
      const status = getByRole('state') || normalize(row.cells?.[6]?.innerText);
      const niceClasses = getByRole('niceClasses') || normalize(row.cells?.[7]?.innerText);

      const rowData = {
        applicationNumber,
        brandName,
        ownerName,
        applicationDate,
        registrationNumber,
        status,
        niceClasses,
        imageUrl: imageElement ? imageElement.getAttribute('src') : '',
      };

      if (rowData.applicationNumber || rowData.brandName || rowData.ownerName) {
        scrapedData.push(rowData);
      }
    } catch (rowError) {
      console.warn('[TP Eklenti] Satır işleme hatası:', index, rowError?.message);
    }
  });

  console.log('[TP Eklenti] Toplanan kayıt sayısı:', scrapedData.length);
  sendSuccessMessage(scrapedData);
}

// =============== Yaşam döngüsü ===============
document.addEventListener('DOMContentLoaded', () => {
  console.log('[TP Eklenti] DOMContentLoaded');
  checkAutoQuery();
});
window.addEventListener('load', () => {
  if (!targetOwnerId) checkAutoQuery();
});

let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log('[TP Eklenti] URL değişti:', currentUrl);
    checkAutoQuery();
  }
});
urlObserver.observe(document, { subtree: true, childList: true });

console.log('[TP Eklenti] Content script (güncel) yüklendi.');
