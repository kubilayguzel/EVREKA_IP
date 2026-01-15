// ================================================
// Evreka IP — SADE (Sadece Sahip No) İçerik Scripti + Sonuç Toplama (STRICT)
// ================================================
console.log('[Evreka OPTS] ========== CONTENT SCRIPT LOADED ==========');
console.log('[Evreka OPTS] URL:', window.location.href);

const TAG = '[Evreka SahipNo]';
let __EVREKA_SENT_OPTS_MAP__ = {};
let __EVREKA_SENT_ERR_MAP__ = {};
let targetKisiNo = null;
let targetAppNo = null; // Başvuru No (Application Number) hedefi
let sourceOrigin = null; // opener target origin (from ?source=...)

// --------- Log Helpers ---------
const log = (...a) => console.log(TAG, ...a);
const warn = (...a) => console.warn(TAG, ...a);
const err = (...a) => console.error(TAG, ...a);

// --- Single Transfer helpers (OPTS) ---
const getHashParam = (name) => {
  const m = location.hash && location.hash.match(new RegExp(`[?#&]${name}=([^&]+)`));
  return m ? decodeURIComponent(m[1]) : null;
};

async function waitAndScrapeResultFromDom(appNo, timeout = 25000) {
  const root = document.body;
  let resolved = false;
  function scrape() {
    const appNoEl = root.querySelector('[data-app-no], .app-no, #appNo, td.appno, .application-number');
    let foundAppNo = appNoEl ? (appNoEl.textContent || appNoEl.value || '').trim() : null;
    if (!foundAppNo) {
      const labels = Array.from(root.querySelectorAll('th,td,div,span,label'));
      const cand = labels.find(el => /başvuru\s*no/i.test((el.textContent || ''))); // Düzeltildi
      if (cand) {
        const val = (cand.nextElementSibling && cand.nextElementSibling.textContent || '').trim();
        if (/\d{4}\/\d+/.test(val)) foundAppNo = val; // Düzeltildi
      }
    }
    if (!foundAppNo) {
      const text = (root.textContent || '');
      const m = text.match(/(\d{4}\/\d{3,})/); // Düzeltildi
      if (m) foundAppNo = m[1];
    }
    if (foundAppNo && (!appNo || foundAppNo === appNo)) {
      const titleEl = root.querySelector('[data-title], .result-title, h1, h2');
      return {
        applicationNumber: foundAppNo,
        title: titleEl ? (titleEl.textContent || '').trim() : null,
        source: 'dom'
      };
    }
    return null;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!resolved) {
        try { obs.disconnect(); } catch {}
        reject(new Error('RESULT_TIMEOUT'));
      }
    }, timeout);
    const obs = new MutationObserver(() => {
      const data = scrape();
      if (data) {
        resolved = true;
        clearTimeout(timer);
        obs.disconnect();
        resolve(data);
      }
    });
    const first = scrape();
    if (first) {
      resolved = true;
      clearTimeout(timer);
      resolve(first);
      return;
    }
    obs.observe(root, { childList: true, subtree: true, characterData: true });
  });
}
// --------- DOM Helpers ---------
function waitFor(selector, { root = document, timeout = 7000, test = null } = {}) {
  return new Promise((resolve, reject) => {
    let el = root.querySelector(selector);
    if (el && (!test || test(el))) return resolve(el);
    const obs = new MutationObserver(() => {
      el = root.querySelector(selector);
      if (el && (!test || test(el))) {
        cleanup();
        resolve(el);
      }
    });
    obs.observe(root, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => { cleanup(); reject(new Error(`waitFor timeout: ${selector}`)); }, timeout);
    function cleanup() { try { obs.disconnect(); } catch {} try { clearTimeout(timer); } catch {} }
  });
}
function click(el) {
  if (!el) return false;
  try {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  } catch {}
  return false;
}
function setReactInputValue(input, value) {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (desc && desc.set) desc.set.call(input, value); else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function pressEnter(el){
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
}


// --------- EVREKA PATCH HELPERS (appNo normalize & label extraction) ---------
function normalizeAppNo(appNo) {
  try {
    const raw = String(appNo || '').trim();
    if (!raw) return '';
    const parts = raw.split('/');
    if (parts.length != 2) return raw;
    let [yy, rest] = parts;
    yy = String(yy || '').trim();
    rest = String(rest || '').trim();
    if (/^\d{2}$/.test(yy)) { // Düzeltildi
      const n = parseInt(yy, 10);
      const fullYear = (n <= 24 ? 2000 + n : 1900 + n);
      return `${fullYear}/${rest}`;
    }
    return `${yy}/${rest}`;
  } catch { return String(appNo || '').trim(); }
}
function extractByLabel(root, label) {
  try {
    const tds = Array.from(root.querySelectorAll('td, .MuiTableCell-root, .MuiTableCell-body'));
    for (let i = 0; i < tds.length - 1; i++) {
      const k = (tds[i].textContent || '').trim().toLowerCase();
      if (k === String(label || '').trim().toLowerCase()) {
        return (tds[i + 1].textContent || '').trim();
      }
    }
  } catch {}
  return '';
}

// Opener'a mesaj gönder (window.opener veya chrome.runtime ile)
function sendToOpener(type, data) {
  try {
    // Önce window.opener'ı dene
    if (window.opener && !window.opener.closed) {
      log('📤 window.opener\'a postMessage gönderiliyor:', type); // Düzeltildi
      window.opener.postMessage({
        type: type,
        source: 'tp-sorgu-eklentisi-2',
        data: data
      }, '*');
      return;
    }
    
    // window.opener yoksa background'a gönder
    log('📤 Background\'a mesaj gönderiliyor:', type); // Düzeltildi
    if (chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'FORWARD_TO_APP',
        messageType: type,
        data: data
      });
    } else {
      warn('⚠️ Chrome runtime API yok');
    }
  } catch (error) {
    err('❌ sendToOpener hatası:', error);
  }
}

// --------- Modal Yardımcıları ---------
async function closeFraudModalIfAny() {
  try {
    const fraudContainer = await waitFor('.jss84', { timeout: 1800 }).catch(()=>null);
    if (fraudContainer) {
      const closeEl = fraudContainer.querySelector('.jss92');
      if (closeEl && click(closeEl)) {
        log('Dolandırıcılık popup kapatıldı (.jss92).');
        await new Promise(r => setTimeout(r, 100));
        return;
      }
      if (click(fraudContainer)) {
        log('Dolandırıcılık popup container tıklandı (fallback).');
        await new Promise(r => setTimeout(r, 80));
        return;
      }
    }
  } catch (e) { /* yoksay */ }

  try {
    const anyDialog = await waitFor('[role="dialog"], .MuiDialog-root, .MuiModal-root, .modal', { timeout: 700 }).catch(()=>null);
    if (anyDialog) {
      const closeCandidate = anyDialog.querySelector('button[aria-label="Close"], button[aria-label="Kapat"], .close, .MuiIconButton-root[aria-label="close"]')
        || anyDialog.querySelector('button');
      if (closeCandidate && click(closeCandidate)) {
        log('Genel MUI modal kapatıldı.');
        await new Promise(r => setTimeout(r, 80));
        return;
      }
    }
  } catch (e) { /* sessiz */ }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
}

function closeAnyOpenDialog() {
  const dialogs = document.querySelectorAll('[role="dialog"], .MuiDialog-root, .MuiModal-root, .modal');
  if (!dialogs.length) return;
  for (const d of dialogs) {
    const closeBtn = d.querySelector('button[aria-label="Close"], button[aria-label="Kapat"], .close, .MuiIconButton-root[aria-label="close"]')
      || d.querySelector('button');
    if (closeBtn) click(closeBtn);
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
}

// --------- Sonsuz Liste & Scroll Yardımcıları ---------
function elementHasText(el, text) {
  return !!el && (el.textContent || '').toLowerCase().includes((text || '').toLowerCase());
}
function findInfiniteToggle() {
  // "Sonsuz Liste" metnini taşıyan label/span'ı bul
  const labelCandidates = Array.from(document.querySelectorAll(
    'label.MuiFormControlLabel-root, .MuiFormControlLabel-root, label, .MuiFormControlLabel-label, .MuiTypography-root'
  ));
  const labelNode = labelCandidates.find(n => (n.textContent || '').toLowerCase().includes('sonsuz liste'));
  if (!labelNode) return null;

  const root = labelNode.closest('.MuiFormControlLabel-root') || labelNode.parentElement || labelNode;
  const input = root.querySelector('input.MuiSwitch-input[type="checkbox"], input[type="checkbox"]');
  const switchBase = root.querySelector('.MuiSwitch-switchBase');
  const switchRoot = root.querySelector('.MuiSwitch-root');
  const clickable = switchBase || switchRoot || root;

  return { root, labelNode, input, switchBase, switchRoot, clickable };
}
async function ensureInfiniteOn() {
  const t = findInfiniteToggle();
  if (!t) { log('Sonsuz Liste toggle bulunamadı.'); return false; }

  const isChecked = () => {
    try {
      if (t.input && typeof t.input.checked !== 'undefined') return !!t.input.checked;
      if (t.switchBase) return t.switchBase.classList.contains('Mui-checked');
      const checkedEl = t.root.querySelector('.MuiSwitch-switchBase.Mui-checked');
      return !!checkedEl;
    } catch { return false; }
  };

  if (isChecked()) { log('Sonsuz Liste zaten AÇIK.'); return true; }

  // 1) Switch base/root tıklaması
  if (t.clickable) click(t.clickable);
  await new Promise(r => setTimeout(r, 150));
  if (isChecked()) { log('Sonsuz Liste AÇILDI (clickable).'); return true; }

  // 2) Input tıklaması
  if (t.input) {
    click(t.input);
    await new Promise(r => setTimeout(r, 150));
    if (isChecked()) { log('Sonsuz Liste AÇILDI (input).'); return true; }
  }

  // 3) Label tıklaması
  if (t.labelNode) {
    click(t.labelNode);
    await new Promise(r => setTimeout(r, 150));
    if (isChecked()) { log('Sonsuz Liste AÇILDI (label).'); return true; }
  }

  // 4) Son çare: input.checked = true + event
  try {
    if (t.input) {
      t.input.checked = true;
      t.input.dispatchEvent(new Event('input', { bubbles: true }));
      t.input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      if (isChecked()) { log('Sonsuz Liste AÇILDI (forced).'); return true; }
    }
  } catch {}

  log('Sonsuz Liste AÇILAMADI.');
  return false;
}
function findScrollContainerFor(el) {
  let cur = el;
  while (cur) {
    const sh = cur.scrollHeight, ch = cur.clientHeight;
    const style = cur === document.documentElement ? '' : getComputedStyle(cur);
    const overflowY = style ? style.overflowY : '';
    if (sh && ch && (sh - ch > 5) && (overflowY === 'auto' || overflowY === 'scroll' || cur === document.scrollingElement)) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return document.scrollingElement || document.documentElement || document.body;
}

// ---- Beklenen Toplamı Oku: "34 kayıt bulundu. Sayfa 1 / 2" ----
function getExpectedTotalCountFromNodeText(txt) {
  const m = (txt || '').match(/(\d+)\s*kayıt\s*b[uü]lundu/i); // Düzeltildi
  return m ? parseInt(m[1], 10) : null;
}
function getExpectedTotalCount() {
  const nodes = Array.from(document.querySelectorAll('p, span, div'));
  const node = nodes.find(n => elementHasText(n, 'kayıt bulundu'));
  if (!node) return null;
  return getExpectedTotalCountFromNodeText(node.textContent || '');
}
async function waitForTotalMetaAndParse(timeout = 45000) {
  // Önce varsa direkt oku
  let expected = getExpectedTotalCount();
  if (typeof expected === 'number') return expected;

  // Yoksa "kayıt bulundu" metni gelene kadar bekle
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const nodes = Array.from(document.querySelectorAll('p, span, div'));
    const node = nodes.find(n => elementHasText(n, 'kayıt bulundu'));
    if (node) {
      expected = getExpectedTotalCountFromNodeText(node.textContent || '');
      if (typeof expected === 'number') return expected;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

// ---- Scroll Akışı: "yükleme → 1sn bekle → scroll" (beklenen sayıya ulaşana dek) ----
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
const countRows = () => document.querySelectorAll('tbody.MuiTableBody-root tr').length;
const isLoading = () =>
  !!document.querySelector('.MuiCircularProgress-root, [role="progressbar"], .MuiBackdrop-root[aria-hidden="false"]');

function waitForRowIncrease(baseCount, timeout = 35000) {
  return new Promise((resolve) => {
    const tbody = document.querySelector('tbody.MuiTableBody-root');
    if (!tbody) return resolve(false);

    const check = () => {
      const n = countRows();
      if (n > baseCount) { cleanup(); resolve(n); }
    };

    const cleanup = () => {
      try { obs.disconnect(); } catch {}
      if (poll) clearInterval(poll);
      if (timer) clearTimeout(timer);
    };

    const obs = new MutationObserver(check);
    obs.observe(tbody, { childList: true, subtree: true });

    // bazı ortamlarda sanal liste/paketli ekleme olabileceği için ek olarak poll
    const poll = setInterval(check, 400);
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeout);
  });
}

async function infiniteScrollAllRowsSTRICT(expectedTotal, { overallTimeoutMs = 360000 } = {}) {
  const tbody = document.querySelector('tbody.MuiTableBody-root');
  if (!tbody) return;

  const scroller = findScrollContainerFor(tbody);
  const scrollBottom = () => {
    try {
      if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
        window.scrollTo(0, document.body.scrollHeight);
      } else {
        scroller.scrollTop = scroller.scrollHeight;
      }
    } catch {}
  };

  const start = performance.now();
  let lastCount = countRows();

  // Eğer daha fazlası bekleniyorsa ilk scroll'u tetikle
  if (!expectedTotal || lastCount < expectedTotal) {
    await sleep(800); // ilk paket için kısa bekleme
    scrollBottom();
  }

  while (true) {
    if (expectedTotal && lastCount >= expectedTotal) {
      // küçük stabilize beklemesi
      await sleep(500);
      break;
    }

    // güvenlik: toplam süre aşıldıysa çık
    if (performance.now() - start > overallTimeoutMs) {
      log('Uyarı: overall timeout aşıldı. Yüklenen:', lastCount, 'beklenen:', expectedTotal);
      break;
    }

    // yeni kayıt gelmesini bekle
    const increasedTo = await waitForRowIncrease(lastCount, 35000); // 35s chunk beklemesi
    if (increasedTo && increasedTo > lastCount) {
      lastCount = increasedTo;
      log('Yeni kayıtlar geldi →', lastCount, '/', expectedTotal || '?');

      // İSTENEN: "yeni veriler geldikten sonra 1 sn bekle → scroll"
      await sleep(1000);
      scrollBottom();
      continue;
    }

    // artış yoksa ama spinner/loader görünüyorsa biraz daha bekle ve tekrar dene
    if (isLoading()) {
      log('Loader görünüyor, biraz daha bekleniyor...');
      await sleep(1500);
      scrollBottom();
      continue;
    }

    // artış yok, loader da yok → yine de bir şans daha ver
    await sleep(1200);
    scrollBottom();

    // küçük bir ek beklemeden sonra tekrar kontrol edilecek; döngü devam eder
  }

  log('STRICT: Yüklenen toplam satır:', lastCount, 'beklenen:', expectedTotal);
  return lastCount;
}

// --------- MODAL PARSE: Detay'ı aç ve görsel + alanları topla ---------
function findDetailButton(tr) {
  const btns = Array.from(tr.querySelectorAll('button, a[role="button"], .MuiIconButton-root'));
  const byLabel = btns.find(b => {
    const t = (b.textContent || '').toLowerCase();
    const a = (b.getAttribute?.('aria-label') || '').toLowerCase();
    return /detay|detail|incele/.test(t) || /detay|detail|incele/.test(a);
  });
  return byLabel || btns[btns.length - 1] || null;
}

//

function parseDetailsFromOpenDialog(dialogRoot) {
  console.log('🔍 parseDetailsFromOpenDialog çağrıldı (FINAL SMART MODE v4)');
  
  if (!dialogRoot) return {};

  const data = {
    imageDataUrl: null,
    fields: {},
    goodsAndServices: [],
    transactions: []
  };

  // =================================================================
  // 1. ETİKET TARAMA (DOM SCAN) - Tablo yapısından bağımsız yakalama
  // =================================================================
  // Bu bölüm, veriler tablo içinde olmasa bile (veya tablo yapısı bozuksa)
  // etiket isminden (örn: "Tescil Tarihi") veriyi bulur.
  try {
    const criticalFields = [
      { targetKey: 'Başvuru Numarası', labels: ['Başvuru Numarası', 'Başvuru No'] },
      { targetKey: 'Başvuru Tarihi',   labels: ['Başvuru Tarihi'] },
      { targetKey: 'Tescil Tarihi',    labels: ['Tescil Tarihi'] },
      { targetKey: 'Tescil Numarası',  labels: ['Tescil Numarası', 'Tescil No'] },
      { targetKey: 'Bülten Numarası',  labels: ['Bülten Numarası', 'Bülten No', 'Marka İlan Bülten No', 'Bülten'] },
      { targetKey: 'Bülten Tarihi',    labels: ['Bülten Tarihi', 'Yayım Tarihi', 'Marka İlan Bülten Tarihi'] },
      { targetKey: 'Koruma Tarihi',    labels: ['Koruma Tarihi'] },
      { targetKey: 'Karar',            labels: ['Karar', 'Durumu'] }
    ];

    for (const field of criticalFields) {
      for (const lbl of field.labels) {
        // extractByLabel fonksiyonu dosyanın üst kısımlarında tanımlıdır
        const val = extractByLabel(dialogRoot, lbl);
        if (val) {
          data.fields[field.targetKey] = normalizeAppNo(val); // normalizeAppNo sadece numara ise işler, metinse bozmz
          // Birini bulunca diğer etiket varyasyonlarını denemeye gerek yok
          break; 
        }
      }
    }
  } catch (e) { console.warn('DOM etiket tarama hatası:', e); }

  // =================================================================
  // 2. TABLO ANALİZİ (Tablo bazlı toplu veri çekme)
  // =================================================================
  try {
    const allTables = dialogRoot.querySelectorAll('table, .MuiTable-root');
    console.log('🔍 Modal içindeki tablo sayısı:', allTables.length);
    
    for (const table of allTables) {
      // Başlıkları topla
      const headers = Array.from(table.querySelectorAll('th')).map(h => h.textContent.trim());
      const headerText = headers.join(' ').toLowerCase();
      
      // Satırları topla
      const rows = table.querySelectorAll('tr, .MuiTableRow-root');
      if (rows.length === 0) continue;

      const firstRowText = (rows[0]?.textContent || '').trim();
      const hasDateInFirstRow = /\d{2}\.\d{2}\.\d{4}/.test(firstRowText);

      // A) MAL VE HİZMETLER TABLOSU
      if (headerText.includes('sınıf') && (headerText.includes('mal') || headerText.includes('hizmet'))) {
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const classNo = parseInt(cells[0].textContent.trim());
            const text = cells[1].textContent.trim();
            if (!isNaN(classNo) && text) {
              data.goodsAndServices.push({ classNo, items: [text] });
            }
          }
        });
      }
      
      // B) İŞLEM GEÇMİŞİ TABLOSU
      else if (
          (headerText.includes('tarih') && (headerText.includes('işlem') || headerText.includes('hareket'))) ||
          (!headerText && hasDateInFirstRow) ||
          (hasDateInFirstRow && rows.length > 1) 
      ) {
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          const texts = Array.from(cells).map(c => c.textContent.trim());
          
          // Akıllı Tarih Tespiti
          const dateIdx = texts.findIndex(t => /^\d{2}\.\d{2}\.\d{4}$/.test(t));
          
          if (dateIdx !== -1) {
             const dateVal = texts[dateIdx];
             const actionVal = texts[dateIdx + 1] || '';
             const noteVal = texts[dateIdx + 2] || '';
             
             if (actionVal && actionVal !== '--') {
                data.transactions.push({
                  date: dateVal,
                  description: actionVal,
                  note: (noteVal && noteVal !== '--' && noteVal !== '-') ? noteVal : null
                });
             }
          }
        });
      }
      
      // C) GENEL BİLGİLER TABLOSU (Key-Value Doldurma)
      // Yukarıdaki "Etiket Tarama"nın kaçırdığı veya tabloda duran veriler için
      else {
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          const texts = Array.from(cells).map(c => c.textContent.trim());
          
          // 4'lü Yapı: [Key] [Value] [Key] [Value]
          if (cells.length === 4) {
            if (texts[0]) data.fields[texts[0]] = texts[1];
            if (texts[2]) data.fields[texts[2]] = texts[3];
          } 
          // 2'li Yapı: [Key] [Value]
          else if (cells.length === 2) {
            // Sahip/Vekil gibi çok satırlı alanları birleştir
            if (texts[0].includes('Sahip') || texts[0].includes('Vekil')) {
               const lines = Array.from(cells[1].querySelectorAll('div, p, span'))
                                  .map(d=>d.textContent.trim())
                                  .filter(Boolean);
               data.fields[texts[0]] = lines.join(' | ') || texts[1];
            } else {
               data.fields[texts[0]] = texts[1];
            }
          }
        });
      }
    }
  } catch (e) {
    console.error('❌ Modal parse hatası:', e);
  }

  // 3. GÖRSEL ÇIKARMA
  const imgEl = dialogRoot.querySelector('img[src*="data:image"], img[src*="MarkaGorseli"]');
  if (imgEl?.src) {
    data.imageDataUrl = imgEl.src;
  }

  console.log(`📝 Modal Parse Bitti: 
    - Fields: ${Object.keys(data.fields).join(', ')}
    - Transactions: ${data.transactions.length}
    - Goods: ${data.goodsAndServices.length}`);
    
  return data;
}

async function openRowModalAndParse(tr, { timeout = 10000 } = {}) {
  try {
    console.log('🔍 openRowModalAndParse başladı');
    
    // Önceki modal'ı hızla kapat
    closeAnyOpenDialog();
    await sleep(100); // Azaltıldı

    const btn = findDetailButton(tr);
    if (!btn) {
      console.warn('❌ Detail butonu bulunamadı');
      return null;
    }
    
    console.log('✅ Detail butonu bulundu, tıklanıyor');
    click(btn);
    
    // Tıklama sonrası kısa bekleme
    await sleep(300); // Azaltıldı

    console.log('🔍 Modal aranıyor...');
    
    // Hızlı modal arama - sadece yüksek z-index stratejisi
    let dialog = null;
    const maxAttempts = 5; // Azaltıldı
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const highZElements = Array.from(document.querySelectorAll('div'))
        .filter(el => {
          const zIndex = parseInt(getComputedStyle(el).zIndex) || 0;
          return zIndex > 1000;
        })
        .sort((a, b) => {
          const aZ = parseInt(getComputedStyle(a).zIndex) || 0;
          const bZ = parseInt(getComputedStyle(b).zIndex) || 0;
          return bZ - aZ;
        });

      // Fieldset veya tablo içeren ilk element'i bul
      for (const el of highZElements.slice(0, 2)) { // Sadece ilk 2'sini kontrol et
        if (el.querySelector('fieldset, table')) {
          dialog = el;
          console.log(`✅ Modal bulundu (attempt ${attempt + 1})`);
          break;
        }
      }
      
      if (dialog) break;
      
      // Kısa bekleme
      await sleep(200); // Azaltıldı
    }

    if (!dialog) {
      console.error('❌ Modal bulunamadı');
      return null;
    }

    console.log('✅ Dialog bulundu, hızlı stabilizasyon...');

    // Hızlı stabilizasyon - sadece fieldset bekle
    try {
      await waitFor('fieldset', { root: dialog, timeout: 2000 }); // Azaltıldı
      console.log('✅ Fieldset bulundu');
    } catch (e) {
      console.log('⚠️ Fieldset bekleme timeout, devam ediliyor');
    }

    // Minimal ek bekleme
    await sleep(500); // Azaltıldı

    console.log('🔄 Parse işlemi başlatılıyor...');
    const parsed = await parseDetailsFromOpenDialog(dialog);

    console.log('🔄 Dialog kapatılıyor...');
    closeAnyOpenDialog();

    console.log('✅ openRowModalAndParse tamamlandı');
    return parsed;
  } catch (e) {
    console.error('❌ openRowModalAndParse hata:', (e && e.message) || e);
    return null;
  }
}

// --------- Sonuç Toplama ---------

function parseOwnerRowBase(tr, idx) {
  const orderTxt = (tr.querySelector('td .MuiTypography-alignCenter') || tr.querySelector('td'))?.textContent || `${idx+1}`;
  const tds = Array.from(tr.querySelectorAll('td'));

  // DEBUG: İlk 3 satır için detaylı log
  if (idx < 3) {
    console.log(`🔍 DETAY - Satır ${idx + 1}:`);
    console.log(`   Toplam hücre: ${tds.length}`);
    tds.forEach((td, i) => {
      const text = (td.textContent || '').trim();
      console.log(`   Hücre ${i}: "${text}" (${text.length} karakter)`);
    });
  }

  let applicationNumber = '';
  let brandName = '';
  let ownerName = '';
  let applicationDate = '';
  let registrationNumber = '';
  let status = ''; // <-- ham TÜRKPATENT metni olarak tutulacak
  let niceClasses = '';
  let imageSrc = null;

  // Görsel
  const img1 = tr.querySelector('img');
  if (img1?.src) imageSrc = img1.src;

  // Owner name (role)
  const ownerElement = tr.querySelector('td[role="holdName"]');
  if (ownerElement) {
    ownerName = ownerElement.textContent.trim().replace(/\s*\(\d+\)\s*$/, ''); // Düzeltildi
  }

  // TÜM HÜCRELERİ TARA (önce STATÜ, sonra diğer alanlar)
  for (let i = 0; i < tds.length; i++) {
    const cellText = (tds[i]?.textContent || '').trim();

    // --- STATÜ YAKALAMA (ham metinle) ---
    if (!status) {
      // En net kalıp: MARKA BAŞVURUSU/TESCİLİ GEÇERSİZ
      if (/MARKA\s*BAŞVURUSU\/TESCİLİ\s*GEÇERSİZ/i.test(cellText)) { // Düzeltildi
        status = 'MARKA BAŞVURUSU/TESCİLİ GEÇERSİZ';
      }
    }

    // Başvuru numarası: 2022/125224 gibi
    if (!applicationNumber && /^((?:19|20)\d{2}|\d{2})\/\d+$/.test(cellText)) { // Düzeltildi
      applicationNumber = normalizeAppNo(cellText);
      if (idx < 3) console.log(`   ✅ Başvuru no ${i}. hücrede bulundu: "${applicationNumber}"`);

      // Marka adı (bir sonraki hücre)
      if (tds[i + 1] && !brandName) {
        const nextCell = (tds[i + 1].textContent || '').trim();
        if (nextCell && !/LİMİTED|ŞİRKETİ/i.test(nextCell)) {
          brandName = nextCell;
        }
      }

      // Başvuru tarihi (iki sonraki hücre)
      if (tds[i + 2] && !applicationDate) {
        const dateCell = (tds[i + 2].textContent || '').trim();
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateCell)) { // Düzeltildi
          applicationDate = dateCell;
        }
      }
      continue;
    }

    // Tarih formatı: DD.MM.YYYY
    if (!applicationDate && /^\d{2}\.\d{2}\.\d{4}$/.test(cellText)) { // Düzeltildi
      applicationDate = cellText;
      continue;
    }

    // Tescil numarası: "2022 125224" gibi
    if (!registrationNumber && /^\d{4}\s+\d+$/.test(cellText)) { // Düzeltildi
      registrationNumber = cellText;
      continue;
    }

    // Nice sınıfları (metin içinde eğik çizgi vb. varsa)
    if (!niceClasses && /\d+/.test(cellText) && cellText.includes('/')) { // Düzeltildi
      niceClasses = cellText;
      continue;
    }
  }

  // Başvuru no hâlâ yoksa daha esnek tarama
  if (!applicationNumber) {
    for (let i = 0; i < tds.length; i++) {
      const cellText = (tds[i]?.textContent || '').trim();
      if (/(?:\d{4}|\d{2})\/\d/.test(cellText) || /\d{4}-\d/.test(cellText)) { // Düzeltildi
        applicationNumber = normalizeAppNo(cellText);
        if (idx < 3) console.log(`   ✅ Esnek pattern ile başvuru no bulundu: "${applicationNumber}"`);
        break;
      }
    }
  }

  if (idx < 3) {
    console.log(`   🔍 Parse sonucu - Başvuru No: "${applicationNumber}", Marka: "${brandName}", Tarih: "${applicationDate}", Statü: "${status}"`);
  }

  return {
    order: Number(orderTxt) || (idx + 1),
    applicationNumber,
    brandName,
    ownerName,
    applicationDate,
    registrationNumber,
    status,        // <-- mapper'a ham metin gidecek
    niceClasses,
    imageSrc
  };
}

// ============================================================
// GÜVENLİ TRANSFER AKIŞI v6 (RETRY & STRICT MATCH)
// ============================================================

// Yardımcı: Sadece rakamları ve '/' işaretini bırakır (Boşluk sorunu için)
function cleanAppNo(str) {
  return (str || '').replace(/[^0-9/]/g, '');
}

// Yardımcı: Modalın tamamen kapanmasını bekle
async function waitForModalClose() {
  for (let i = 0; i < 20; i++) { // Max 2 saniye
    const dialogs = document.querySelectorAll('div[role="dialog"], .MuiDialog-root');
    const visible = Array.from(dialogs).some(d => {
        const style = window.getComputedStyle(d);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
    });
    if (!visible) return true; 
    await sleep(100);
  }
  return false;
}

// Yardımcı: Modalın açılmasını bekle
async function waitForModalOpen() {
  for (let i = 0; i < 40; i++) { // Max 4 saniye
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], .MuiDialog-root'));
    const visibleDialog = dialogs.find(d => {
        const style = window.getComputedStyle(d);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
    });
    if (visibleDialog) return visibleDialog;
    await sleep(100);
  }
  return null;
}

async function collectOwnerResultsWithDetails() {
  console.log('🛡️ collectOwnerResultsWithDetails başladı (RETRY MODE)');
  
  const rows = Array.from(document.querySelectorAll('tbody.MuiTableBody-root tr, tbody tr'));
  console.log(`🔍 Toplam ${rows.length} satır bulundu`);
  
  const processedApplicationNumbers = new Set();
  const batchSize = 100;

  for (let batchStart = 0; batchStart < rows.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, rows.length);
    const currentBatch = rows.slice(batchStart, batchEnd);
    
    console.log(`📦 Batch ${Math.floor(batchStart/batchSize) + 1} işleniyor...`);
    
    const batchItems = [];
    
    for (const [localIdx, tr] of currentBatch.entries()) {
      const globalIdx = batchStart + localIdx;
      
      // 1. Listeden Temel Veriyi Al
      const base = parseOwnerRowBase(tr, globalIdx);
      if (!base.applicationNumber) continue;

      base.applicationNumber = normalizeAppNo(base.applicationNumber);
      
      // Duplicate kontrolü
      if (processedApplicationNumbers.has(base.applicationNumber)) continue; 
      processedApplicationNumbers.add(base.applicationNumber);

      // Konsol kirliliğini azalt
      // if (localIdx % 5 === 0) console.log(`⏳ İşleniyor: ${base.applicationNumber}`);

      // Varsayılan görsel (thumbnail)
      if (base.imageSrc) {
          base.brandImageDataUrl = base.imageSrc;
          base.brandImageUrl = base.imageSrc;
      }

      // ============================================================
      // 🔄 RETRY MEKANİZMASI (Doğru Veriyi Zorla)
      // ============================================================
      let success = false;
      const targetNoClean = cleanAppNo(base.applicationNumber);

      // Maksimum 2 kere dene (Hata alırsa kapatıp tekrar açacak)
      for (let retry = 0; retry < 2; retry++) {
          if (success) break;
          
          try {
            // A) Temizlik
            closeAnyOpenDialog();
            await waitForModalClose();
            await sleep(200); // DOM nefes alsın

            // B) Butonu Bul ve Tıkla
            const btn = findDetailButton(tr);
            if (btn) {
              btn.scrollIntoView({ behavior: 'auto', block: 'center' });
              await sleep(100); 
              click(btn);
              
              // C) Modalın Açılmasını Bekle
              const dialog = await waitForModalOpen();

              if (dialog) {
                // D) İçerik Kontrolü (Polling)
                // Modal açıldı ama içeriği hemen yüklenmeyebilir. 
                // 3 saniye boyunca içeriğin "hedef numara" ile eşleşmesini bekle.
                for (let poll = 0; poll < 30; poll++) {
                    // Modal içindeki TÜM metni al ve temizle
                    const dialogTextClean = cleanAppNo(dialog.textContent);
                    
                    // Eğer modalın içinde bizim numaramız geçiyorsa (örn: 2025083044)
                    if (dialogTextClean.includes(targetNoClean)) {
                        // Detaylı parse yap
                        const tempDetail = parseDetailsFromOpenDialog(dialog);
                        const modalAppNoClean = cleanAppNo(tempDetail.fields['Başvuru Numarası'] || '');

                        // Çifte Kontrol: Parsed numara da eşleşiyor mu?
                        if (modalAppNoClean === targetNoClean) {
                            // BINGO! Doğru veri.
                            base.details = tempDetail.fields || {};
                            if (Array.isArray(tempDetail.goodsAndServices)) base.goodsAndServicesByClass = tempDetail.goodsAndServices;
                            if (Array.isArray(tempDetail.transactions)) base.transactions = tempDetail.transactions;

                            // Görseli al (Varsa)
                            if (tempDetail.imageDataUrl && tempDetail.imageDataUrl.length > 200) {
                                base.brandImageDataUrl = tempDetail.imageDataUrl;
                                base.brandImageUrl = tempDetail.imageDataUrl;
                                base.imageSrc = tempDetail.imageDataUrl;
                            }
                            
                            success = true;
                            break; // Polling döngüsünü kır
                        }
                    }
                    await sleep(100); // 100ms sonra tekrar kontrol et
                }
              }
            }
          } catch (e) { console.error('Retry hatası:', e); }

          if (!success) {
              console.warn(`⚠️ Deneme ${retry+1} başarısız: ${base.applicationNumber}. Tekrar deneniyor...`);
              // Modal takılı kaldıysa kapatıp tekrar denemesi için loop devam eder
          }
      } // Retry Loop Sonu

      if (!success) {
          console.error(`❌ BAŞARISIZ: ${base.applicationNumber} için detay verisi alınamadı (Liste verisi kullanılıyor).`);
      } else {
          console.log(`✅ BAŞARILI: ${base.applicationNumber}`);
      }

      // Her işlemden sonra modalı kesin kapat
      closeAnyOpenDialog();
      await waitForModalClose();
      await sleep(200); // Satırlar arası güvenli bekleme

      batchItems.push(base);
    }

    // Batch Gönderimi
    if (batchItems.length > 0) {
      sendToOpener('BATCH_VERI_GELDI_KISI', {
        batch: batchItems,
        batchNumber: Math.floor(batchStart/batchSize) + 1,
        totalBatches: Math.ceil(rows.length / batchSize),
        processedCount: batchEnd,
        totalCount: rows.length,
        isComplete: batchEnd >= rows.length
      });
      await sleep(1000); // Batch arası mola
    }
  }

  console.log(`🎉 Tüm işlemler tamamlandı.`);
  sendToOpener('VERI_GELDI_KISI_COMPLETE', {
    totalProcessed: processedApplicationNumbers.size,
    totalRows: rows.length
  });
}

async function waitAndSendOwnerResults() {
  // 1) Önce meta: "... kayıt bulundu" gelene kadar bekle ve oku
  let expected = await waitForTotalMetaAndParse(60000); // 60s'e kadar bekle
  if (typeof expected !== 'number' || !(expected > 0)) {
    // Meta bulunamazsa yine de tabloya göre ilerleyelim (fallback)
    try { await waitFor('tbody.MuiTableBody-root tr', { timeout: 20000 }); } catch {}
    expected = getExpectedTotalCount(); // son bir kez daha dene
  }
  log('Beklenen toplam kayıt:', expected);

  // 2) Tablo en az bir satır gözüksün
  try { await waitFor('tbody.MuiTableBody-root tr', { timeout: 30000 }); } catch {}

  // 3) Sonsuz Liste gerekiyorsa aç
  try {
    const initialCount = document.querySelectorAll('tbody.MuiTableBody-root tr').length;
    const needInfinite = (typeof expected === 'number' ? expected >= 20 : initialCount >= 20);
    if (needInfinite) {
      const ok = await ensureInfiniteOn();
      if (ok && typeof expected === 'number' && expected > 0) {
        // 4) STRICT: beklenen sayıya ulaşana kadar yükleme→bekle→scroll
        const loaded = await infiniteScrollAllRowsSTRICT(expected, { overallTimeoutMs: 360000 });
        if (typeof loaded === 'number' && loaded < expected) {
          log('Uyarı: beklenen sayıya ulaşılamadı. loaded:', loaded, 'expected:', expected);
        }
      }
    }
  } catch (e) { /* yoksay */ }

  // 4) Beklenen sayıya ulaşmadan ERKEN GÖNDERMEYİ ÖNLE! (meta biliniyorsa)
  const finalCount = document.querySelectorAll('tbody.MuiTableBody-root tr').length;
  if (typeof expected === 'number' && expected > 0 && finalCount < expected) {
    log('Beklenen sayıya ulaşılmadı, veri gönderilmeyecek. final:', finalCount, 'expected:', expected);
    sendToOpener('HATA_KISI', { message: 'Sonuçların tam listelemesi tamamlanmadı.', loaded: finalCount, expected });
    return;
  }

  // 5) Satırları MODAL ile detaylı parse et (görsel dahil)
  await collectOwnerResultsWithDetails(); // Düzeltildi
}

// --------- Ana Akış ---------
async function runOwnerFlow() {
  log('Sahip No akışı başladı:', targetKisiNo);
  if (!targetKisiNo) { warn('targetKisiNo boş; çıkış.'); return; }

  try { await closeFraudModalIfAny(); } catch {}

  // input[placeholder="Kişi Numarası"]
  let kisiInput =
    document.querySelector('input.MuiInputBase-input.MuiInput-input[placeholder="Kişi Numarası"]') ||
    document.querySelector('input[placeholder="Kişi Numarası"]');

  if (!kisiInput) {
    kisiInput = await waitFor('input[placeholder="Kişi Numarası"]', { timeout: 6000 }).catch(()=>null);
  }
  if (!kisiInput) { err('Kişi Numarası alanı bulunamadı.'); sendToOpener('HATA_KISI', { message: 'Kişi Numarası alanı bulunamadı.' }); return; }

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

  sendToOpener('SORGU_BASLADI');
  if (sorgulaBtn && click(sorgulaBtn)) {
    log('Sorgula tıklandı. ✔');
  } else {
    pressEnter(kisiInput);
    log('Sorgula butonu yok; Enter gönderildi. ✔');
  }
  await waitAndSendOwnerResults();
}

// Yeni: "Dosya Takibi" sekmesine geçişi sağlayan yardımcı fonksiyon
async function ensureDosyaTakibiTab() {
  let tabBtn = document.querySelector('button[role="tab"]') || await waitFor('button[role="tab"]', { timeout: 4000 });
  if (!tabBtn) {
    log('Dosya Takibi/Marka Araştırma sekmeleri bulunamadı, bekleniyor...');
    tabBtn = await waitFor('button[role="tab"]', { timeout: 6000 });
  }

  // Doğru sekme metnini bul
  let dosyaTakibiBtn = Array.from(document.querySelectorAll('button[role="tab"]'))
    .find(btn => (btn.textContent || '').trim().toLowerCase().includes('dosya takibi'));
  
  if (dosyaTakibiBtn) {
    if (dosyaTakibiBtn.getAttribute('aria-selected') !== 'true') {
      click(dosyaTakibiBtn);
      log('[Evreka Eklenti] "Dosya Takibi" sekmesine tıklandı.');
      await sleep(500); // Sekme geçişi için kısa bekleme
    } else {
      log('[Evreka Eklenti] "Dosya Takibi" zaten aktif.');
    }
  } else {
    warn('[Evreka Eklenti] "Dosya Takibi" sekmesi bulunamadı.');
    // Hata durumunda akışı durdurabiliriz veya devam edebiliriz
    // Devam etmek, marka araştırması formunda sorgu yapmaya çalışır ki bu istenmeyen bir durum olabilir
  }
}

// Yeni: Başvuru No akışı
async function runApplicationFlow() {
  log('Başvuru No akışı başladı:', targetAppNo);
  if (!targetAppNo) { warn('targetAppNo boş; çıkış.'); return; }

  try { await closeFraudModalIfAny(); } catch {}

  // 1) Önce doğru sekmeye geçiş yap
  await ensureDosyaTakibiTab();
  
  // input[placeholder="Başvuru Numarası"]
  let appInput =
    document.querySelector('input.MuiInputBase-input.MuiInput-input[placeholder="Başvuru Numarası"]') ||
    document.querySelector('input[placeholder="Başvuru Numarası"]');

  if (!appInput) {
    appInput = await waitFor('input[placeholder="Başvuru Numarası"]', { timeout: 6000 }).catch(()=>null);
  }
  if (!appInput) {
    err('Başvuru Numarası alanı bulunamadı.');
    sendToOpener('HATA_BASVURU_ALANI_YOK', { message: 'Başvuru Numarası alanı bulunamadı.' });
    return;
  }

  // Aynı bloktaki Sorgula butonu → yoksa globalde bul → en sonda Enter
  let container = appInput.closest('.MuiFormControl-root') || appInput.closest('form') || document;
  let sorgulaBtn = Array.from(container.querySelectorAll('button')).find(b => /sorgula/i.test(b.textContent || ''));
  if (!sorgulaBtn) {
    const allButtons = Array.from(document.querySelectorAll('button'));
    sorgulaBtn = allButtons.find(b => /sorgula/i.test(b.textContent || ''));
  }

  appInput.focus();
  setReactInputValue(appInput, String(targetAppNo));
  log('Başvuru No yazıldı.');

  sendToOpener('SORGU_BASLADI');
  if (sorgulaBtn && click(sorgulaBtn)) {
    log('Sorgula tıklandı. ✔');
  } else {
    pressEnter(appInput);
    log('Sorgula butonu yok; Enter gönderildi. ✔');
  }

  // Sonuçları topla ve gönder (mevcut owner mantığını yeniden kullanıyoruz)
  await waitAndSendApplicationResults();
}

// Başvuru numarası sayfasından doğrudan detay çıkarımı (Optimized)
async function extractApplicationDetailsFromPage() {
  const details = {};
  
  try {
    log('HTML yapısından detaylar çıkarılıyor...');
    
    // Marka Bilgileri fieldset'ini bul
    const markaBilgileriFieldset = Array.from(document.querySelectorAll('fieldset')).find(fs => 
      fs.querySelector('legend')?.textContent?.includes('Marka Bilgileri')
    );
    
    if (markaBilgileriFieldset) {
      // Table hücrelerinden bilgi çıkar
      const extractFromTable = (label) => {
        const cells = Array.from(markaBilgileriFieldset.querySelectorAll('td'));
        for (let i = 0; i < cells.length - 1; i++) {
          if (cells[i].textContent.trim() === label) {
            return cells[i + 1].textContent.trim();
          }
        }
        return null;
      };
      
      // Temel bilgileri çıkar
      details.applicationNumber = normalizeAppNo(extractFromTable('Başvuru Numarası')) || '';
      details.applicationDate = extractFromTable('Başvuru Tarihi') || '';
      details.registrationNumber = extractFromTable('Tescil Numarası') || '';
      details.registrationDate = extractFromTable('Tescil Tarihi') || '';
      details.brandName = extractFromTable('Marka Adı') || '';
      details.niceClasses = extractFromTable('Nice Sınıfları') || '';
      details.brandType = extractFromTable('Türü') || '';
      details.protectionDate = extractFromTable('Koruma Tarihi') || '';
      details.status = extractFromTable('Durumu') || 'TESCİL EDİLDİ'; // Default değer
      
      // Sahip bilgileri - çok satırlı olabilir
      const sahipCell = Array.from(markaBilgileriFieldset.querySelectorAll('td')).find((cell, i, cells) => 
        cells[i-1]?.textContent?.trim() === 'Sahip Bilgileri'
      );
      if (sahipCell) {
        const sahipTexts = Array.from(sahipCell.querySelectorAll('p')).map(p => p.textContent.trim());
        if (sahipTexts.length > 1) {
          details.ownerName = sahipTexts[1]; // İkinci satır genellikle şirket adı
          details.ownerId = sahipTexts[0]; // İlk satır genellikle TPE numarası
        }
      }
      
      // Marka görseli
      const img = markaBilgileriFieldset.querySelector('img[src*="data:image"]');
      if (img && img.src) {
        details.brandImageUrl = img.src;
        details.brandImageDataUrl = img.src;
        details.imageSrc = img.src;
      }
    }
    
// Mal ve Hizmet Bilgileri
    const malHizmetFieldset = Array.from(document.querySelectorAll('fieldset')).find(fs => 
      fs.querySelector('legend')?.textContent?.includes('Mal ve Hizmet')
    );
    
    if (malHizmetFieldset) {
      const goodsAndServices = [];
      const niceClassesSet = new Set();
      const rows = malHizmetFieldset.querySelectorAll('tbody tr');
      
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const classNum = cells[0].textContent.trim();
          const description = cells[1].textContent.trim();
          if (classNum && description) {
            goodsAndServices.push({
              classNo: parseInt(classNum),
              items: description.split('\n').filter(item => item.trim() !== '') // Düzeltildi
            });
            niceClassesSet.add(classNum);
          }
        }
      });
      
      details.goodsAndServicesByClass = goodsAndServices;
      details.niceClasses = Array.from(niceClassesSet).join(' / ');
    }
    
    // İşlem Bilgileri - son durumu bul
    const islemFieldset = Array.from(document.querySelectorAll('fieldset')).find(fs => 
      fs.querySelector('legend')?.textContent?.includes('İşlem Bilgileri')
    );
    
    if (islemFieldset) {
      const transactions = [];
      const rows = islemFieldset.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          const tarih = cells[0].textContent.trim();
          const islem = cells[2].textContent.trim();
          if (tarih && islem && !cells[0].hasAttribute('colspan')) { // colspan olanları skip et
            transactions.push({
              date: tarih,
              action: islem,
              description: cells[3]?.textContent?.trim() || ''
            });
          }
        }
      });
      details.transactions = transactions;
      
      // En son işlemden durumu belirle
      if (transactions.length > 0) {
        const lastAction = transactions[transactions.length - 1].action;
        if (lastAction.includes('TESCİL')) {
          details.status = 'TESCİL EDİLDİ';
        } else if (lastAction.includes('YAYIN')) {
          details.status = 'YAYINLANDI';
        }
      }
    }
    
    log('HTML yapısından çıkarılan detaylar:', details);
    return details;
    
  } catch (e) {
    warn('Sayfa detay çıkarımında hata:', e?.message);
    // Fallback - basit text-based extraction
    return extractDetailsFromText();
  }
}

// Fallback fonksiyon
function extractDetailsFromText() {
  const details = {};
  const pageText = document.body.textContent || '';
  
  const appNoMatch = pageText.match(/Başvuru Numarası[:\s]*((?:\d{4}|\d{2})\/\d+)/i); // Düzeltildi
  if (appNoMatch) details.applicationNumber = normalizeAppNo(appNoMatch[1]);
  
  const brandNameMatch = pageText.match(/Marka Adı[:\s]*([^\n\r]+)/i); // Düzeltildi
  if (brandNameMatch) details.brandName = brandNameMatch[1].trim();
  
  const statusMatch = pageText.match(/TESCİL EDİLDİ|YAYINLANDI|KABUL|RET/i);
  if (statusMatch) details.status = statusMatch[0];
  
  const img = document.querySelector('img[src*="data:image"]');
  if (img && img.src) {
    details.brandImageUrl = img.src;
    details.brandImageDataUrl = img.src;
  }
  
  return details;
}

// Başvuru numarası için özelleştirilmiş sonuç toplama
async function waitAndSendApplicationResults() {
  log('Başvuru numarası sonuçları toplanıyor...');
  
  // Tek kayıt beklentisi ile basit bekleme
  try { 
    await waitFor('tbody.MuiTableBody-root tr, tbody tr', { timeout: 15000 }); 
  } catch {
    log('Sonuç tablosu bulunamadı, sayfa yapısı kontrol ediliyor...');
    // Alternatif: doğrudan sayfa içeriğinden parse et
    await parseApplicationResultFromPage();
    return;
  }

  // Tablo varsa basit parse (modal açmadan)
  const rows = Array.from(document.querySelectorAll('tbody.MuiTableBody-root tr, tbody tr'));
  if (rows.length === 0) {
    log('Hiç sonuç bulunamadı');
    sendToOpener('HATA_BASVURU', { message: 'Bu başvuru numarası için sonuç bulunamadı.' });
    return;
  }

  log(`${rows.length} sonuç bulundu, parse ediliyor...`);
  const items = [];
  
  for (let i = 0; i < rows.length; i++) {
    const tr = rows[i];
    const item = parseOwnerRowBase(tr, i);
    
    if (item.applicationNumber) {
      // Başvuru numarası için ek detayları sayfadan topla
      const pageDetails = await extractApplicationDetailsFromPage();
      if (pageDetails) {
        Object.assign(item, pageDetails);
      }
      items.push(item);
    }
  }

  if (items.length > 0) {
    sendToOpener('VERI_GELDI_BASVURU', items);
  } else {
    sendToOpener('HATA_BASVURU', { message: 'Başvuru numarası sonuçları işlenirken hata oluştu.' });
  }
}

// Yeni: parseApplicationResultFromPage fonksiyonunu ekleyelim (Eksikti)
async function parseApplicationResultFromPage() {
  try {
    // Basit parse'ı doğrudan çağırıyoruz (detaylı modal açma ihtiyacı yok)
    const details = await extractApplicationDetailsFromPage();
    if (!details || !details.applicationNumber) {
      throw new Error('Ana uygulama detayları çıkarılamadı.');
    }

    const item = {
      applicationNumber: details.applicationNumber,
      brandName: details.brandName || details.fields?.['Marka Adı'] || '',
      ownerName: details.ownerName || details.fields?.['Sahip Adı'] || '',
      applicationDate: details.applicationDate || details.fields?.['Başvuru Tarihi'] || '',
      registrationNumber: details.registrationNumber || details.fields?.['Tescil Numarası'] || '',
      status: details.status || details.fields?.['Durumu'] || 'Bilinmiyor',
      niceClasses: details.niceClasses || details.fields?.['Nice Sınıfları'] || '',
      brandImageUrl: details.brandImageUrl,
      brandImageDataUrl: details.brandImageDataUrl,
      details: details.fields || {},
      goodsAndServicesByClass: details.goodsAndServicesByClass || [],
      transactions: details.transactions || []
    };

    log('Tekil Başvuru Sonucu Gönderiliyor:', item.applicationNumber);
    sendToOpener('VERI_GELDI_BASVURU', [item]);
    return true;
  } catch (e) {
    err('❌ parseApplicationResultFromPage hatası:', e.message);
    sendToOpener('HATA_BASVURU', { message: 'Sayfa yüklenmesi bekleniyor veya detaylar bulunamadı.' });
    return false;
  }
}

// Dış mesajlar: AUTO_FILL (geri uyum) ve AUTO_FILL_BASVURU
chrome.runtime?.onMessage?.addListener?.((request, sender, sendResponse) => {
  if (request?.type === 'AUTO_FILL' && request?.data) {
    targetAppNo = request.data;
    runApplicationFlow().catch(err);
    sendResponse?.({ status: 'OK' });
    return true;
  }
  if (request?.type === 'AUTO_FILL_BASVURU' && request?.data) {
    targetAppNo = request.data;
    runApplicationFlow().catch(err);
    sendResponse?.({ status: 'OK' });
    return true;
  }
  return true;
});
// --------- Background ve URL tetikleyicileri ---------
chrome.runtime?.onMessage?.addListener?.((request, sender, sendResponse) => {
  if (request?.type === 'AUTO_FILL_KISI' && request?.data) {
    targetKisiNo = request.data;
    runOwnerFlow().catch(err);
    sendResponse?.({ status: 'OK' });
  }
  return true;
});

// Parent → iframe köprüsü
function broadcastAutoQueryToFrames(value, queryType = 'sahip') {
  try {
    const payload = { source: 'EVREKA', type: 'EVREKA_AUTO_QUERY', queryType, value };
    const frames = window.frames || [];
    for (let i = 0; i < frames.length; i++) {
      try { frames[i].postMessage(payload, '*'); } catch {}
    }
    window.postMessage(payload, '*');
    log('auto_query yayınlandı:', payload);
  } catch (e) { warn('broadcastAutoQueryToFrames hata:', e?.message); }
}
window.addEventListener('message', (e) => {
  const msg = e?.data;
  if (!msg || msg.source !== 'EVREKA' || msg.type !== 'EVREKA_AUTO_QUERY') return;
  if (msg.queryType === 'sahip') {
    targetKisiNo = msg.value;
    runOwnerFlow().catch(err);
  } else if (msg.queryType === 'basvuru') {
    targetAppNo = msg.value;
    runApplicationFlow().catch(err);
  }
}, false);

function captureUrlParams() {
  try {
    const url = new URL(window.location.href);
    const autoQuery = url.searchParams.get('auto_query');
    const queryType = url.searchParams.get('query_type');
    const src = url.searchParams.get('source');
    if (src) sourceOrigin = src;
    if (autoQuery && (queryType === 'sahip' || queryType === 'basvuru' || queryType === 'application')) {
      log('URL üzerinden auto_query alındı:', autoQuery, 'queryType:', queryType, 'sourceOrigin:', sourceOrigin);
      
      // QueryType parametresini broadcastAutoQueryToFrames'e geçir
      const broadcastQueryType = queryType === 'sahip' ? 'sahip' : 'basvuru';
      broadcastAutoQueryToFrames(autoQuery, broadcastQueryType);
      
      if (queryType === 'sahip') { 
        targetKisiNo = autoQuery; 
        runOwnerFlow().catch(err); 
      } else { 
        targetAppNo = autoQuery; 
        runApplicationFlow().catch(err); 
      }
      return true;
    }
  } catch (e) { warn('URL param hatası:', e?.message); }
  return false;
}

document.addEventListener('DOMContentLoaded', () => {
  log('DOMContentLoaded. frame:', window.self !== window.top ? 'iframe' : 'top');
  captureUrlParams();
});
window.addEventListener('load', () => {
  log('window.load. frame:', window.self !== window.top ? 'iframe' : 'top');
  captureUrlParams();
});

// ============================================
// OPTS.TURKPATENT.GOV.TR İÇİN ÖZEL AKIM
// ============================================
//

function scrapeOptsTableResults(rows, appNo) {
  // DEBUG BAŞLANGICI
  console.log('%c[OPTS-DEBUG] 🚀 SCRAPING BAŞLADI', 'background: #222; color: #bada55; font-size: 14px');
  console.log('[OPTS-DEBUG] Hedef Başvuru No:', appNo);
  
  const results = [];
  const imageContainer = document.querySelector('.MuiBox-root img[alt="Marka Görseli"]');
  const imgUrl = imageContainer ? imageContainer.src : null;
  
  const item = {
    applicationNumber: appNo,
    brandName: '',
    ownerName: '',
    applicationDate: '',
    registrationNumber: '',
    status: '',
    niceClasses: '',
    imageSrc: imgUrl,
    brandImageUrl: imgUrl,
    brandImageDataUrl: imgUrl,
    fields: {},
    details: {},
    goodsAndServicesByClass: [],
    transactions: [] 
  };

  // 1. TABLOLARI BUL
  const allTables = document.querySelectorAll('table.MuiTable-root');
  console.log(`[OPTS-DEBUG] Sayfada toplam ${allTables.length} adet tablo bulundu.`);

  // Tabloları tek tek analiz et
  allTables.forEach((tbl, index) => {
      const headerText = (tbl.querySelector('thead') || tbl).textContent.trim().replace(/\s+/g, ' ');
      const firstRowText = (tbl.querySelector('tbody tr')?.textContent || '').trim().replace(/\s+/g, ' ');
      
      console.log(`[OPTS-DEBUG] 🔎 TABLO ${index + 1} ANALİZİ:`);
      console.log(`   - Header İçeriği: "${headerText.substring(0, 50)}..."`);
      console.log(`   - İlk Satır Örneği: "${firstRowText.substring(0, 50)}..."`);
  });

  // --- TABLO 1: Marka Bilgileri ---
  if (allTables.length > 0) {
    console.log('[OPTS-DEBUG] 🟢 Tablo 1 (Marka Bilgileri) işleniyor...');
    const infoTable = allTables[0];
    const infoRows = infoTable.querySelectorAll('tbody tr');
    
    infoRows.forEach((dataRow) => {
      const rowCells = dataRow.querySelectorAll('td');
      const cellTexts = Array.from(rowCells).map(c => (c.textContent || '').trim());

      if (rowCells.length === 4) {
        const k1 = cellTexts[0], v1 = cellTexts[1];
        const k2 = cellTexts[2], v2 = cellTexts[3];
        if(k1) { item.fields[k1] = v1; item.details[k1] = v1; }
        if(k2) { item.fields[k2] = v2; item.details[k2] = v2; }
      }
      else if (rowCells.length === 2) {
        const key = cellTexts[0];
        if (key.includes('Sahip Bilgileri')) {
           const lines = Array.from(rowCells[1].querySelectorAll('div')).map(d=>d.textContent.trim()).filter(Boolean);
           if(lines.length > 1) item.ownerName = lines[1];
           item.fields[key] = lines.join(' | ');
        } else {
           item.fields[key] = cellTexts[1];
        }
        item.details[key] = item.fields[key];
      }
    });
  }

  // --- TABLO ANALİZİ (Mal/Hizmet vs İşlem Geçmişi) ---
  let goodsTable = null;
  let transactionsTable = null;

  for (let i = 1; i < allTables.length; i++) {
    const tbl = allTables[i];
    const headerText = (tbl.querySelector('thead') || tbl).textContent.toLowerCase();
    const firstRowText = (tbl.querySelector('tbody tr') || tbl).textContent.trim();

    if (headerText.includes('sınıf') && (headerText.includes('mal') || headerText.includes('hizmet'))) {
      goodsTable = tbl;
      console.log(`[OPTS-DEBUG] ✅ Tablo ${i + 1}: Mal/Hizmet Tablosu olarak belirlendi.`);
    } 
    else if (
        headerText.includes('işlem') || 
        headerText.includes('hareket') || 
        headerText.includes('tarih') || 
        /\d{2}\.\d{2}\.\d{4}/.test(firstRowText)
    ) {
      transactionsTable = tbl;
      console.log(`[OPTS-DEBUG] ✅ Tablo ${i + 1}: İŞLEM GEÇMİŞİ Tablosu olarak belirlendi.`);
    } else {
      console.log(`[OPTS-DEBUG] ⚠️ Tablo ${i + 1}: Tanımlanamadı.`);
    }
  }

  // Mal Hizmetleri İşle
  if (goodsTable) {
    const rows = goodsTable.querySelectorAll('tbody tr');
    rows.forEach(r => {
      const cells = r.querySelectorAll('td');
      if (cells.length >= 2) {
        const cls = parseInt(cells[0].textContent.trim());
        const txt = cells[1].textContent.trim();
        if (!isNaN(cls)) {
          item.goodsAndServicesByClass.push({ classNo: cls, items: [txt] });
        }
      }
    });
  }

  // --- KRİTİK BÖLÜM: İŞLEM GEÇMİŞİ ---
  if (transactionsTable) {
    console.log('[OPTS-DEBUG] ⏳ İşlem geçmişi satırları okunuyor...');
    const tRows = transactionsTable.querySelectorAll('tbody tr');
    
    tRows.forEach((row, idx) => {
      const cells = row.querySelectorAll('td');
      const texts = Array.from(cells).map(c => c.textContent.trim());
      
      console.log(`[OPTS-DEBUG]    👉 İşlem Satırı ${idx+1}:`, texts);

      if (cells.length >= 2) {
        // Tarih formatı bulucu
        const dateIdx = texts.findIndex(t => /^\d{2}\.\d{2}\.\d{4}$/.test(t));
        
        if (dateIdx !== -1) {
          const dateVal = texts[dateIdx];
          const actionVal = texts[dateIdx + 1] || '';
          const descVal = texts[dateIdx + 2] || '';
          
          item.transactions.push({
            date: dateVal,
            description: actionVal,
            note: descVal,
            action: actionVal
          });
          console.log(`[OPTS-DEBUG]       ✅ Eklendi: ${dateVal} - ${actionVal}`);
        } else {
          console.warn(`[OPTS-DEBUG]       ⚠️ Tarih formatı bulunamadı, atlandı.`);
        }
      }
    });
    console.log(`[OPTS-DEBUG] ✅ Toplam ${item.transactions.length} işlem yakalandı.`);
  } else {
    console.error('[OPTS-DEBUG] ❌ İŞLEM GEÇMİŞİ TABLOSU BULUNAMADI!');
  }

  // Final Mapping
  item.applicationDate = item.fields['Başvuru Tarihi'] || '';
  item.registrationNumber = item.fields['Tescil Numarası'] || '';
  item.niceClasses = item.fields['Nice Sınıfları'] || '';
  item.status = item.fields['Durumu'] || item.fields['Karar'] || '';
  item.brandName = item.fields['Marka Adı'] || '';
  
  const finalAppNo = normalizeAppNo(item.fields['Başvuru Numarası'] || item.applicationNumber);
  item.applicationNumber = finalAppNo;

  if (finalAppNo) results.push(item);

  // Sonuçları Gönder
  console.log('[OPTS-DEBUG] 📤 Uygulamaya gönderilecek veri:', results);

  if (results.length > 0) {
    const firstAppNo = results[0].applicationNumber;
    if (!__EVREKA_SENT_OPTS_MAP__[firstAppNo]) {
        __EVREKA_SENT_OPTS_MAP__[firstAppNo] = true;
        sendToOpener('VERI_GELDI_OPTS', results);
    }
  } else {
    console.error('[OPTS-DEBUG] ❌ Sonuç listesi boş oluştu.');
    // Hata yönetimi...
  }
}

// Sonuçları bekle ve scrape et
async function waitForOptsResultsAndScrape(appNo) {
  log('[OPTS] ⏳ Sonuçlar bekleniyor...');
  
  try {
    // ✅ YENİ SEÇİCİ: Sonuçları içeren ana tablo gövdesini bekliyoruz.
    // Material UI yapısını (.MuiTableContainer-root) ve tbody içeriğini hedef al
    const tableContainer = await waitFor('.MuiTableContainer-root', { 
      timeout: 35000, // Zaman aşımı süresi artırıldı
      test: (el) => {
          // Tablo içinde en az bir MuiTableRow-root sınıfına sahip satır var mı?
          return !!el.querySelector('tbody.MuiTableBody-root tr.MuiTableRow-root');
      }
    });

    // Tablonun içindeki tüm veri satırlarını topla
    const allRows = tableContainer.querySelectorAll('tbody.MuiTableBody-root tr.MuiTableRow-root');

    if (allRows.length === 0) {
      throw new Error("Sorgu sonucu bulunamadı (0 satır).");
    }
    
    log('[OPTS] ✅ Sonuç bulundu:', allRows.length, 'satır');
    scrapeOptsTableResults(Array.from(allRows), appNo);
    return true;

  } catch (error) {
      err('[OPTS] ❌ Timeout/Hata:', error.message);
      
      // Hata mesajını sadece 1 kez gönder
      const errorKey = `ERROR_${optsCurrentAppNo || appNo}`;
      if (!__EVREKA_SENT_ERR_MAP__[errorKey]) {
        __EVREKA_SENT_ERR_MAP__[errorKey] = true;
        sendToOpener('HATA_OPTS', { message: error.message || 'Sonuç tablosu bulunamadı veya zaman aşımı' });
      }
      return false;
    }
}

// ============================================
// OPTS.TURKPATENT.GOV.TR İÇİN ÖZEL AKIM
// ============================================
let optsAlreadyProcessed = false; // Global duplicate flag
let optsCurrentAppNo = null; // İşlenen başvuru no

// Chrome message listener için handler
chrome.runtime?.onMessage?.addListener?.((request, sender, sendResponse) => {
  if (request?.type === 'AUTO_FILL_OPTS' && request?.data) {
    const appNo = request.data;
    log('[OPTS] 📨 AUTO_FILL_OPTS mesajı alındı:', appNo);
    
    // OPTS sayfasında değilsek çık
    if (!/^https:\/\/opts\.turkpatent\.gov\.tr/i.test(window.location.href)) {
      log('[OPTS] ⚠️ OPTS sayfasında değil, atlanıyor');
      sendResponse?.({ status: 'IGNORED' });
      return;
    }
    
    // Duplicate kontrolü - GÜÇLENDİRİLDİ
    if (optsAlreadyProcessed && optsCurrentAppNo === appNo) {
      log('[OPTS] ⚠️ Bu başvuru zaten işleniyor (Msg Listener):', appNo);
      sendResponse?.({ status: 'ALREADY_PROCESSING' });
      return;
    }
    
    optsAlreadyProcessed = true;
    optsCurrentAppNo = appNo;
    
    log('[OPTS] 🚀 runOptsApplicationFlow başlatılıyor (Msg Listener)');
    
    // Async işlem başlat
    setTimeout(() => {
      runOptsApplicationFlow(appNo);
    }, 500);
    
    sendResponse?.({ status: 'OK' });
  }
});

// Sayfa yüklendiğinde hash kontrolü (fallback)
(function initOptsDetection() {
  const url = window.location.href;
  
  if (!/^https:\/\/opts\.turkpatent\.gov\.tr/i.test(url)) {
    return; // OPTS değilse çık
  }
  
  log('🎯 [OPTS] Sayfa algılandı:', url);
  
  // Hash'ten başvuru no al
  const hash = window.location.hash;
  const match = hash.match(/#bn=([^&]+)/);
  
  if (!match) {
    log('⚠️ [OPTS] Hash\'te başvuru no yok - Background\'dan mesaj bekleniyor');
    return;
  }
  
  const appNo = decodeURIComponent(match[1]);
  log('✅ [OPTS] Hash\'ten başvuru no bulundu:', appNo);
  
  // Duplicate kontrolü - GÜÇLENDİRİLDİ
  if (optsAlreadyProcessed && optsCurrentAppNo === appNo) {
    log('⚠️ [OPTS] Bu başvuru zaten işleniyor (Init IIFE), atlanıyor');
    return;
  }
  
  optsAlreadyProcessed = true;
  optsCurrentAppNo = appNo;
  
  // Sayfa yüklenene kadar bekle
  setTimeout(() => {
    log('🚀 [OPTS] runOptsApplicationFlow başlatılıyor (hash fallback)');
    runOptsApplicationFlow(appNo);
  }, 2000);
})();

// OPTS için başvuru no akışı - Sadece scraping yapar (input doldurma YOK)
async function runOptsApplicationFlow(appNo) {
  log('🚀 [OPTS] Scraping akışı başladı:', appNo);
  
  if (!appNo) {
    err('[OPTS] appNo parametresi boş!');
    return;
  }
  
  try {
    // Fraud modal varsa kapat
    await closeFraudModalIfAny().catch(() => {});
    
    // Direkt sonuçları bekle ve scrape et
    // OPTS sayfası hash ile açıldığında sonuçlar zaten yüklü oluyor
    log('[OPTS] Sonuçlar bekleniyor ve scrape edilecek...');
    await waitForOptsResultsAndScrape(appNo); 
    
  } catch (error) {
    err('[OPTS] ❌ Genel hata:', error);
    
    // Hata mesajını sadece 1 kez gönder
    const errorKey = `ERROR_${optsCurrentAppNo || appNo}`;
    if (!__EVREKA_SENT_ERR_MAP__[errorKey]) {
      __EVREKA_SENT_ERR_MAP__[errorKey] = true;
      sendToOpener('HATA_OPTS', { message: error.message || 'OPTS scraping hatası' });
    }
  }
}

chrome.runtime?.onMessage?.addListener?.((msg)=>{
  if (msg && msg.type === 'VERI_ALINDI_OK') {
    try {
      const sp = document.querySelector('#evrk-spinner,[data-evrk-spinner]');
      if (sp) sp.remove();
    } catch(e){}
  }
});