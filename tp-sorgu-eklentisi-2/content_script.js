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

// --- 4.2 helpers: detail appNo çıkar + güvenli karşılaştır ---
function getDetailAppNo(detailObj) {
  if (!detailObj) return null;

  // 1) parseDetailsFromOpenDialog çıktısında applicationNumber alanı varsa
  if (detailObj.applicationNumber) return normalizeAppNo(detailObj.applicationNumber);

  // 2) send ettiğin yapıda fields map’i var (sende bu var)
  const f = detailObj.fields || detailObj.data || null;
  if (f) {
    const cand =
      f['Başvuru Numarası'] ||
      f['Başvuru No'] ||
      f['Basvuru Numarasi'] ||
      f['Application Number'] ||
      null;

    return cand ? normalizeAppNo(cand) : null;
  }

  return null;
}

function numbersMatch(a, b) {
  const aa = String(a || '').replace(/\D/g, '');
  const bb = String(b || '').replace(/\D/g, '');
  return aa && bb && aa === bb;
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

// ✅ Modal mutex: aynı anda tek modal işlemi
let __modalQueue = Promise.resolve();
function withModalLock(fn) {
  const run = __modalQueue.then(fn, fn);
  __modalQueue = run.catch(() => {});
  return run;
}

// ✅ Modal tamamen kapandı mı? (DOM'dan gerçekten kalkmasını bekle)
async function waitForNoDialog(timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const any = document.querySelector('[role="dialog"], .MuiDialog-root, .MuiModal-root, .modal');
    if (!any) return true;
    await sleep(100);
  }
  return false;
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

  // 1) aria-label güvenilir
  const byAria = btns.find(b => {
    const a = (b.getAttribute?.('aria-label') || '').toLowerCase();
    return a.includes('detay') || a.includes('detail') || a.includes('incele');
  });
  if (byAria) return byAria;

  // 2) görünen metin
  const byText = btns.find(b => {
    const t = (b.textContent || '').toLowerCase().trim();
    return t.includes('detay') || t.includes('incele') || t.includes('detail');
  });
  if (byText) return byText;

  // 3) title gibi attribute’lar
  const byTitle = btns.find(b => {
    const t = (b.getAttribute?.('title') || '').toLowerCase();
    return t.includes('detay') || t.includes('incele') || t.includes('detail');
  });
  if (byTitle) return byTitle;

  // ❌ fallback yok: bulamazsa null dön
  return null;
}


async function parseDetailsFromOpenDialog(dialogRoot) {
  console.log('🔍 parseDetailsFromOpenDialog çağrıldı');
  
  if (!dialogRoot) return {};

  const data = {
    imageDataUrl: null,
    fields: {},
    goodsAndServices: [],
    transactions: []
  };
  // --- EVREKA PATCH: Extract Application No & Date early (label-based) ---
  try {
    const labeledAppNo = extractByLabel(dialogRoot, 'Başvuru Numarası');
    if (labeledAppNo) {
      data.fields['Başvuru Numarası'] = normalizeAppNo(labeledAppNo);
    } else {
      const txtAll = (dialogRoot.textContent || '').replace(/\s+/g, ' ').trim(); // Düzeltildi
      const m = txtAll.match(/\b((?:19|20)\d{2}|\d{2})\/\d{4,}\b/); // Düzeltildi
      if (m) data.fields['Başvuru Numarası'] = normalizeAppNo(m[0]);
    }
    const labeledAppDate = extractByLabel(dialogRoot, 'Başvuru Tarihi');
    if (labeledAppDate) {
      data.fields['Başvuru Tarihi'] = labeledAppDate;
    }
  } catch (e) { /* ignore */ }


try {
    // YENİ: Tüm tabloları topla - hem eski hem yeni selector'lar
    const allTables = dialogRoot.querySelectorAll(
      'table, .MuiTable-root, table.MuiTable-root.css-175qdh6'
    );
    
    console.log('🔍 Toplam tablo sayısı:', allTables.length);
    
    for (const table of allTables) {
      // Header detection - YENİ CSS class'ları ekle
      const headers = table.querySelectorAll(
        'th, .MuiTableCell-head, thead .MuiTableCell-root, th.MuiTableCell-head.MuiTableCell-sizeSmall'
      );
      const headerTexts = Array.from(headers).map(h => h.textContent.trim());
      
      console.log('📋 Tablo header\'ları:', headerTexts); // Düzeltildi
      
      // tbody detection - YENİ CSS class'lı tbody
      const tbody = table.querySelector(
        'tbody, .MuiTableBody-root, tbody.MuiTableBody-root.css-y6j1my'
      );
      if (!tbody) {
        console.warn('⚠️ tbody bulunamadı, sonraki tabloya geç');
        continue;
      }
      
      // tr detection - YENİ CSS class'lı tr
      const rows = tbody.querySelectorAll(
        'tr, .MuiTableRow-root, tr.MuiTableRow-root.css-11biftp'
      );
      
      console.log('📊 Tablo satır sayısı:', rows.length);
      
      // ==========================================
      // 1) MAL VE HİZMETLER TABLOSU (2 kolonlu)
      // ==========================================
      if (headerTexts.some(h => h.includes('Sınıf')) && 
          headerTexts.some(h => h.includes('Mal') || h.includes('Hizmet'))) {
        
        console.log('✅ Mal ve Hizmetler tablosu tespit edildi');
        
        for (const row of rows) {
          const cells = row.querySelectorAll(
            'td, .MuiTableCell-body, td.MuiTableCell-root.MuiTableCell-body.MuiTableCell-sizeSmall'
          );
          
          if (cells.length === 2) {
            const classNoText = cells[0].textContent.trim();
            const goodsText = cells[1].textContent.trim();
            
            // Sınıf numarası parse et
            const classNo = parseInt(classNoText, 10);
            
            if (!isNaN(classNo) && classNo >= 1 && classNo <= 45 && goodsText.length > 0) {
              // Mal/hizmet metnini satırlara ayır
              const items = goodsText
                .split(/\n+/) // Düzeltildi
                .map(item => item.trim())
                .filter(Boolean)
                .map(item => item.replace(/\s+/g, ' ')); // Düzeltildi
              
              console.log(`📦 Sınıf ${classNo}: ${items.length} adet mal/hizmet bulundu`);
              data.goodsAndServices.push({ classNo, items });
            }
          }
        }
      }
      
      // ==========================================
      // 2) İŞLEM GEÇMİŞİ TABLOSU (4 kolonlu + başlık satırları)
      // ==========================================
      else if (headerTexts.some(h => h.includes('Tarih')) && 
               headerTexts.some(h => h.includes('İşlem'))) {
        
        console.log('✅ İşlem geçmişi tablosu tespit edildi');
        
        const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/; // Düzeltildi
        
        for (const row of rows) {
          const cells = row.querySelectorAll(
            'td, .MuiTableCell-body, td.MuiTableCell-root.MuiTableCell-body.MuiTableCell-sizeSmall'
          );
          
          // BAŞLIK SATIRLARI: 1 hücreli + colspan (Marka başvurusu, Marka Tescil Ücreti Ödeme gibi)
          if (cells.length === 1) {
            const titleText = cells[0].textContent.trim();
            if (titleText && titleText.length > 0) {
              console.log('📌 İşlem geçmişi başlık:', titleText);
              // Başlık satırlarını ignore et veya özel işle
            }
            continue;
          }
          
          // VERİ SATIRLARI: 4 hücreli (Tarih, Tebliğ Tarihi, İşlem, Açıklama)
          if (cells.length === 4) {
            const dateText = cells[0].textContent.trim();
            const notificationDate = cells[1].textContent.trim();
            const operationText = cells[2].textContent.trim();
            const noteText = cells[3].textContent.trim();
            
            // Sadece geçerli tarih formatına sahip satırları al
            if (dateRegex.test(dateText) && operationText && operationText !== '--') {
              const transaction = {
                date: dateText,
                description: operationText,
                note: (noteText && noteText !== '--' && noteText !== '-') ? noteText : null
              };
              
              // İsteğe bağlı: Tebliğ tarihini de ekle
              if (notificationDate && notificationDate !== '--') {
                transaction.notificationDate = notificationDate;
              }
              
              console.log('📝 Transaction eklendi:', transaction);
              data.transactions.push(transaction);
            }
          }
        }
      }
      
      // ==========================================
      // 3) ANA BİLGİLER TABLOSU (4 kolonlu Key-Value)
      // ==========================================
      else {
        console.log('✅ Ana bilgiler tablosu tespit edildi');
        
        for (const row of rows) {
          const cells = row.querySelectorAll(
            'td, .MuiTableCell-body, td.MuiTableCell-root.MuiTableCell-body.MuiTableCell-sizeSmall'
          );
          
          // 4 KOLONLU: Key1, Value1, Key2, Value2
          if (cells.length === 4) {
            const key1 = cells[0].textContent.trim();
            const value1 = cells[1].textContent.trim();
            const key2 = cells[2].textContent.trim();
            const value2 = cells[3].textContent.trim();
            
            console.log('🔍 4 hücreli satır:', key1, '=', value1, '|', key2, '=', value2);
            
            // Value normalize - "--" ve "-" boş kabul edilir
            const normalizedValue1 = (value1 === '--' || value1 === '-') ? '' : value1;
            const normalizedValue2 = (value2 === '--' || value2 === '-') ? '' : value2;
            
            if (key1 && normalizedValue1) data.fields[key1] = normalizedValue1;
            if (key2 && normalizedValue2) data.fields[key2] = normalizedValue2;
          }
          
          // 2 KOLONLU: Key, Value (Sahip Bilgileri, Vekil Bilgileri gibi)
          else if (cells.length === 2) {
            const key = cells[0].textContent.trim();
            const value = cells[1].textContent.trim();
            
            console.log('🔍 2 hücreli satır:', key, '=', value);
            
            const normalizedValue = (value === '--' || value === '-') ? '' : value;
            if (key && normalizedValue) data.fields[key] = normalizedValue;
          }
        }
      }
    }
    
    // EKSTRA GÜVENLIK: Tüm tablolardaki 4 hücreli satırları da tara
    // (Bazı bilgiler farklı tablolarda olabilir)
    const allTableRows = dialogRoot.querySelectorAll(
      'table tr, .MuiTable-root tr, tr.MuiTableRow-root'
    );
    
    for (const row of allTableRows) {
      const cells = row.querySelectorAll(
        'td, .MuiTableCell-body, td.MuiTableCell-root.MuiTableCell-body'
      );
      
      if (cells.length === 4) {
        const key1 = cells[0].textContent.trim();
        const value1 = cells[1].textContent.trim();
        const key2 = cells[2].textContent.trim();
        const value2 = cells[3].textContent.trim();
        
        // Sadece daha önce eklenmemiş bilgileri ekle
        const normalizedValue1 = (value1 === '--' || value1 === '-') ? '' : value1;
        const normalizedValue2 = (value2 === '--' || value2 === '-') ? '' : value2;
        
        if (key1 && normalizedValue1 && !data.fields[key1]) {
          data.fields[key1] = normalizedValue1;
        }
        if (key2 && normalizedValue2 && !data.fields[key2]) {
          data.fields[key2] = normalizedValue2;
        }
      }
    }
    
  } catch (e) {
    console.error('❌ Modal parse hatası:', e);
    console.error('❌ Hata detayı:', e.stack);
  }
    // Görsel çıkarma
    const imgEl = dialogRoot.querySelector('img[src*="data:image"], img[src*="MarkaGorseli"]');
    if (imgEl?.src) {
      data.imageDataUrl = imgEl.src;
      log('🖼️ Görsel URL\'si bulundu:', data.imageDataUrl.substring(0, 50) + '...');
    }

  console.log('🔍 Final data.fields:', data.fields);
  console.log('📦 Final data.goodsAndServices:', data.goodsAndServices.length, 'sınıf');
  console.log('📝 Final data.transactions:', data.transactions.length, 'işlem');
  
  return data;
}

async function openRowModalAndParse(tr, { timeout = 20000 } = {}) { // Timeout süresini artırdık
  try {
    // 1️⃣ TEMİZLİK: Önceki modalların kapandığından emin ol
    closeAnyOpenDialog();
    await waitForNoDialog(8000);
    
    // 🛑 FREN 1: Önceki işlemden sonra tarayıcının "soğuması" için bekle
    await sleep(1000); 

    // 2️⃣ BUTON BULMA
    const btn = findDetailButton(tr);
    if (!btn) return null;

    // Tıklamadan önce mevcut dialogları kaydet (Referans noktası)
    const existingDialogs = new Set(
      Array.from(document.querySelectorAll('[role="dialog"], .MuiDialog-root'))
    );

    // 3️⃣ TIKLAMA VE BEKLEME
    // Butonu görünür yap
    btn.scrollIntoView({ behavior: 'auto', block: 'center' });
    await sleep(500); // Scroll sonrası bekle
    
    click(btn);

    // 🛑 FREN 2: Tıkladıktan sonra modalın animasyonu ve sunucu isteği için KÖR BEKLEME.
    // Bu süre modalların "flaş gibi" geçmesini engeller.
    await sleep(2500); 

    // 4️⃣ YENİ DIALOGU YAKALA
    let dialog = null;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const dialogs = Array.from(
        document.querySelectorAll('[role="dialog"], .MuiDialog-root')
      );
      // Sadece yeni açılanı bul
      dialog = dialogs.find(d => !existingDialogs.has(d));
      if (dialog) break;
      await sleep(100);
    }

    if (!dialog) return null;

    // 5️⃣ İÇERİK BEKLEME (Metin gelene kadar)
    const contentStart = Date.now();
    let contentFound = false;
    while (Date.now() - contentStart < timeout) {
      const txt = dialog.textContent || '';
      // Başvuru numarası formatı veya anahtar kelimeler geldi mi?
      if (
        txt.includes('Başvuru Numarası') ||
        txt.includes('Başvuru No') ||
        /\d{4}\/\d{5,}/.test(txt)
      ) {
        contentFound = true;
        break;
      }
      await sleep(150);
    }

    if (!contentFound) return null;

    // 🛑 FREN 3: RESİM YÜKLENME PAYI (En Kritik Yer)
    // Metin gelse bile resim (img src) internet hızına bağlı olarak 1-2 saniye geç gelebilir.
    // Burada bekleyerek "eski resmi" alma riskini sıfırlarız.
    await sleep(2000); 

    // 6️⃣ PARSE ET
    // Artık hem metin hem resim yüklenmiş olmalı.
    const parsed = await parseDetailsFromOpenDialog(dialog);

    // 7️⃣ KAPATMA
    closeAnyOpenDialog();
    await waitForNoDialog(8000);
    
    // 🛑 FREN 4: Kapattıktan sonra bekle (DOM temizlensin)
    await sleep(1000);

    return parsed;
  } catch (e) {
    try {
      closeAnyOpenDialog();
      await waitForNoDialog(4000);
    } catch (_) {}
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
    console.log(`   Toplam hücre: ${tds.length}`);
    tds.forEach((td, i) => {
      const text = (td.textContent || '').trim();
      console.log(`   Hücre ${i}: "${text}" (${text.length} karakter)`);
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
      if (idx < 3) console.log(`   ✅ Başvuru no ${i}. hücrede bulundu: "${applicationNumber}"`);

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
        if (idx < 3) console.log(`   ✅ Esnek pattern ile başvuru no bulundu: "${applicationNumber}"`);
        break;
      }
    }
  }

  if (idx < 3) {
    console.log(`   🔍 Parse sonucu - Başvuru No: "${applicationNumber}", Marka: "${brandName}", Tarih: "${applicationDate}", Statü: "${status}"`);
  }

  return {
    order: Number(orderTxt) || (idx + 1),
    applicationNumber,
    brandName,
    ownerName,
    applicationDate,
    registrationNumber,
    status,        // <-- mapper'a ham metin gidecek
    niceClasses,
    imageSrc
  };
}

async function collectOwnerResultsWithDetails() {
  console.log('🐢 collectOwnerResultsWithDetails başladı (GÜVENLİ & YAVAŞ MOD)');

  const rows = Array.from(document.querySelectorAll('tbody.MuiTableBody-root tr, tbody tr'));
  console.log(`🔍 Toplam ${rows.length} satır bulundu`);

  const processedApplicationNumbers = new Set();
  const batchSize = 100; 

  // Modal reset yardımcısı
  async function resetModalState() {
    try {
      closeAnyOpenDialog();
      await waitForNoDialog(8000);
      await sleep(500);
    } catch (e) {}
  }

  for (let batchStart = 0; batchStart < rows.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, rows.length);
    const currentBatch = rows.slice(batchStart, batchEnd);

    console.log(`📦 Batch ${Math.floor(batchStart / batchSize) + 1} işleniyor...`);
    const batchItems = [];

    for (const [localIdx, tr] of currentBatch.entries()) {
      const globalIdx = batchStart + localIdx;
      
      // Satırı görünür yap
      tr.scrollIntoView({ block: 'center' });
      
      // 🛑 FREN: Satırlar arası geçiş beklemesi
      await sleep(1500); 

      // Satırdan temel veriyi al (Bu bizim referansımız)
      const base = parseOwnerRowBase(tr, globalIdx);
      
      // Listede Başvuru Numarası yoksa, modalı açıp bulmayı dene
      if (!base.applicationNumber) {
        console.log(`ℹ️ Liste bilgisinde numara yok, modal deneniyor... [Satır: ${globalIdx+1}]`);
        await resetModalState();
        // Hızlı bir deneme yap
        const detailForAppNo = await withModalLock(() => openRowModalAndParse(tr, { timeout: 15000 }));
        if (detailForAppNo && detailForAppNo.fields) {
          const cand = detailForAppNo.fields['Başvuru Numarası'] || detailForAppNo.fields['Başvuru No'];
          if (cand) base.applicationNumber = normalizeAppNo(cand);
        }
        // Hala yoksa atla
        if (!base.applicationNumber) {
             console.warn(`⚠️ Satır ${globalIdx+1} atlandı (Numara bulunamadı).`);
             continue;
        }
      }

      base.applicationNumber = normalizeAppNo(base.applicationNumber);

      // Duplicate Kontrolü
      if (processedApplicationNumbers.has(base.applicationNumber)) {
        console.log(`⏭️ Tekrar eden kayıt atlandı: ${base.applicationNumber}`);
        continue;
      }
      processedApplicationNumbers.add(base.applicationNumber);

      // Thumbnail'i yedekle (Eğer modal açılmazsa bu kullanılır)
      base.thumbnailSrc = base.imageSrc || null;

      console.log(`⏳ İşleniyor: ${base.applicationNumber}`);

      // --- DETAY VE GÖRSEL ÇEKME (DOĞRULAMALI) ---
      await resetModalState();
      
      // 1. Deneme
      let detail = await withModalLock(() => openRowModalAndParse(tr, { timeout: 20000 }));
      
      // DOĞRULAMA: Listeden okunan numara ile modaldan gelen numara aynı mı?
      let dNo = getDetailAppNo(detail);
      let isMatch = detail && dNo && numbersMatch(base.applicationNumber, dNo);

      // Eşleşmediyse RETRY (Yeniden Dene)
      if (!isMatch) {
          console.warn(`⚠️ Veri uyuşmazlığı veya boş veri! Beklenen: ${base.applicationNumber}, Gelen: ${dNo || 'YOK'}. Tekrar deneniyor...`);
          
          // 3 saniye ceza beklemesi (Sunucu veya DOM kendine gelsin)
          await sleep(3000); 
          await resetModalState();
          
          // 2. Deneme (Daha uzun süre tanı)
          detail = await withModalLock(() => openRowModalAndParse(tr, { timeout: 25000 }));
          dNo = getDetailAppNo(detail);
          isMatch = detail && dNo && numbersMatch(base.applicationNumber, dNo);
      }

      // KAYIT: Sadece eşleşme varsa kaydet
      if (isMatch) {
          base.details = detail.fields || {};
          if (Array.isArray(detail.goodsAndServices)) base.goodsAndServicesByClass = detail.goodsAndServices;
          if (Array.isArray(detail.transactions)) base.transactions = detail.transactions;

          // Görseli al
          if (detail.imageDataUrl && detail.imageDataUrl.length > 200) {
              base.brandImageDataUrl = detail.imageDataUrl;
              base.brandImageUrl = detail.imageDataUrl;
              base.imageSrc = detail.imageDataUrl;
              console.log(`✅ [${base.applicationNumber}] Görsel ve Veri Başarılı.`);
          } else {
              console.log(`⚠️ [${base.applicationNumber}] Veri tamam, Görsel yok.`);
          }
      } else {
          // Eşleşme yoksa, yanlış görsel kaydetmektense HİÇBİR ŞEY kaydetme (Sadece listeden gelenler kalır)
          console.error(`❌ [${base.applicationNumber}] Detay verisi EŞLEŞMEDİ. Liste verisiyle devam ediliyor.`);
      }

      batchItems.push(base);
      
      // 🛑 SATIR SONU UZUN MOLA
      // Modalların birbirine girmesini engellemek için.
      await sleep(2000); 
    }

    // Batch Gönderimi
    if (batchItems.length > 0) {
      sendToOpener('BATCH_VERI_GELDI_KISI', {
        batch: batchItems,
        batchNumber: Math.floor(batchStart / batchSize) + 1,
        totalBatches: Math.ceil(rows.length / batchSize),
        processedCount: batchEnd,
        totalCount: rows.length,
        isComplete: batchEnd >= rows.length
      });
      // Batch arası ekstra dinlenme
      await sleep(3000);
    }
  }

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
// Tablo sonuçlarını scrape et
function scrapeOptsTableResults(rows, appNo) {
  log('[OPTS] 📊 Scraping başlatıldı, appNo:', appNo);
  
  const results = [];
  
  // Marka Görselini doğrudan en üst seviye div'den çekelim
  const imageContainer = document.querySelector('.MuiBox-root img[alt="Marka Görseli"]');
  const imgUrl = imageContainer ? imageContainer.src : null;
  
  log('[OPTS] 🖼️ Görsel URL:', imgUrl ? 'Bulundu' : 'Bulunamadı');

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
    details: {}
  };

  // ✅ İLK TABLO: Marka Bilgileri (4 kolonlu Key-Value-Key-Value yapısı)
  const firstTableBody = document.querySelector('tbody.MuiTableBody-root');
  
  if (!firstTableBody) {
    err('[OPTS] ❌ tbody.MuiTableBody-root bulunamadı!');
    sendToOpener('HATA_OPTS', { message: 'Tablo yapısı bulunamadı' });
    return;
  }
  
  log('[OPTS] ✅ İlk tablo tbody bulundu');
  
  const dataRows = firstTableBody.querySelectorAll('tr.MuiTableRow-root');
  log('[OPTS] 📊 Toplam satır sayısı:', dataRows.length);
  
  dataRows.forEach((dataRow, rowIndex) => {
    const rowCells = dataRow.querySelectorAll('td.MuiTableCell-root, td.MuiTableCell-body');
    const cellTexts = Array.from(rowCells).map(c => (c.textContent || '').trim());
    
    // Debug: İlk 3 satırı logla
    if (rowIndex < 3) {
      log(`[OPTS] Satır ${rowIndex + 1}: ${rowCells.length} hücre -`, cellTexts);
    }

    // 4 HÜCRELİ: Key1, Value1, Key2, Value2
    if (rowCells.length === 4) {
      const key1 = cellTexts[0];
      let value1 = cellTexts[1];
      const key2 = cellTexts[2];
      let value2 = cellTexts[3];

      // '--' değerlerini boş string yap
      if (value1 === '--' || value1 === '-') value1 = '';
      if (value2 === '--' || value2 === '-') value2 = '';

      if (key1 && value1) {
        item.fields[key1] = value1;
        item.details[key1] = value1;
      }
      if (key2 && value2) {
        item.fields[key2] = value2;
        item.details[key2] = value2;
      }
      
      if (rowIndex < 3) {
        log(`[OPTS]   ✅ 4 hücreli: ${key1}="${value1}", ${key2}="${value2}"`);
      }
    } 
    // COLSPAN DURUMU (Sahip/Vekil Bilgileri)
    else if (rowCells.length === 2) {
      const key = cellTexts[0];
      const valueCell = rowCells[1];
      const colspanVal = valueCell.getAttribute('colspan');
      
      if (colspanVal === '3') {
        // Sahip/Vekil Bilgileri özel işleme
        if (key.includes('Sahip Bilgileri') || key.includes('Vekil Bilgileri')) {
          const lines = Array.from(valueCell.querySelectorAll('div'))
            .map(d => d.textContent.trim())
            .filter(Boolean);
          
          const joinedValue = lines.join(' | ');
          item.fields[key] = joinedValue;
          item.details[key] = joinedValue;
          
          // Sahip adını özel olarak çıkar
          if (key.includes('Sahip Bilgileri') && lines.length > 1) {
            item.ownerName = lines[1];
          }
          
          log(`[OPTS]   ✅ Colspan (${key}): ${lines.length} satır birleştirildi`);
        } else {
          let val = valueCell.textContent.trim();
          if (val === '--' || val === '-') val = '';
          if (key && val) {
            item.fields[key] = val;
            item.details[key] = val;
          }
        }
      } else {
        // Normal 2 hücreli
        let val = cellTexts[1];
        if (val === '--' || val === '-') val = '';
        if (key && val) {
          item.fields[key] = val;
          item.details[key] = val;
        }
      }
    }
  });

  // ✅ İKİNCİ TABLO: Mal ve Hizmetler (varsa)
  const allTables = document.querySelectorAll('table.MuiTable-root');
  log('[OPTS] 📋 Toplam tablo sayısı:', allTables.length);
  
  if (allTables.length > 1) {
    const secondTable = allTables[1];
    const headers = secondTable.querySelectorAll('th');
    const headerTexts = Array.from(headers).map(h => h.textContent.trim());
    
    log('[OPTS] 📋 2. tablo header\'ları:', headerTexts);
    
    if (headerTexts.some(h => h.includes('Sınıf'))) {
      const goodsRows = secondTable.querySelectorAll('tbody tr');
      const goodsAndServices = [];
      
      goodsRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length === 2) {
          const classNo = parseInt(cells[0].textContent.trim());
          const description = cells[1].textContent.trim();
          
          if (!isNaN(classNo) && description) {
            goodsAndServices.push({
              classNo: classNo,
              items: [description]
            });
          }
        }
      });
      
      if (goodsAndServices.length > 0) {
        item.goodsAndServicesByClass = goodsAndServices;
        log('[OPTS] ✅ Mal ve Hizmetler:', goodsAndServices.length, 'sınıf bulundu');
      }
    }
  }

  // Ana alanlara mapping
  item.applicationDate = item.fields['Başvuru Tarihi'] || '';
  item.registrationNumber = item.fields['Tescil Numarası'] || '';
  item.niceClasses = item.fields['Nice Sınıfları'] || '';
  item.status = item.fields['Durumu'] || item.fields['Karar'] || '';
  item.brandName = item.fields['Marka Adı'] || '';
  
  // Başvuru numarasını normalize et
  const finalAppNo = normalizeAppNo(item.fields['Başvuru Numarası'] || item.applicationNumber);
  item.applicationNumber = finalAppNo;

  log('[OPTS] 📝 Final değerler:', {
    appNo: finalAppNo,
    brandName: item.brandName,
    ownerName: item.ownerName,
    status: item.status,
    fieldsCount: Object.keys(item.fields).length
  });

  if (finalAppNo) {
    log(`[OPTS] ✅ Başarıyla tamamlandı: ${finalAppNo}`);
    results.push(item);
  } else {
    err('[OPTS] ❌ Başvuru numarası çıkarılamadı');
  }
  
  // Sonuçları gönder
  if (results.length > 0) {
    const firstAppNo = results[0].applicationNumber;
    
    // Duplicate kontrolü - Her başvuru için sadece 1 kez gönder
    if (__EVREKA_SENT_OPTS_MAP__[firstAppNo]) {
      log('[OPTS] ⚠️ Duplicate VERI_GELDI_OPTS engellendi:', firstAppNo);
      return; // Mesaj gönderme, direkt çık
    }
    
    __EVREKA_SENT_OPTS_MAP__[firstAppNo] = true;
    log('[OPTS] 📤 VERI_GELDI_OPTS gönderiliyor:', results);
    sendToOpener('VERI_GELDI_OPTS', results);
    
    // Başarılı scrape sonrası sekme kapatma
    setTimeout(() => {
      log('[OPTS] 🚪 Sekme kapatılıyor...');
      window.close();
    }, 2000); // 3 saniye -> 2 saniye
  } else {
    err('[OPTS] ❌ Sonuç listesi boş');
    
    // Hata mesajını da sadece 1 kez gönder
    const errorKey = `ERROR_${optsCurrentAppNo || 'unknown'}`;
    if (!__EVREKA_SENT_ERR_MAP__[errorKey]) {
      __EVREKA_SENT_ERR_MAP__[errorKey] = true;
      sendToOpener('HATA_OPTS', { message: 'Scrape sonrası sonuç listesi boş kaldı.' });
    }
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
    
    // Duplicate kontrolü
    if (optsAlreadyProcessed && optsCurrentAppNo === appNo) {
      log('[OPTS] ⚠️ Bu başvuru zaten işleniyor:', appNo);
      sendResponse?.({ status: 'ALREADY_PROCESSING' });
      return;
    }
    
    optsAlreadyProcessed = true;
    optsCurrentAppNo = appNo;
    
    log('[OPTS] 🚀 runOptsApplicationFlow başlatılıyor');
    
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
  
  // Duplicate kontrolü
  if (optsAlreadyProcessed && optsCurrentAppNo === appNo) {
    log('⚠️ [OPTS] Bu başvuru zaten işleniyor, atlanıyor');
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
