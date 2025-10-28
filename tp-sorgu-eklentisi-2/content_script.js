// ================================================
// Evreka IP — SADE (Sadece Sahip No) İçerik Scripti + Sonuç Toplama (STRICT)
// ================================================

const TAG = '[Evreka SahipNo]';
let targetKisiNo = null;
let targetAppNo = null; // Başvuru No (Application Number) hedefi
let sourceOrigin = null; // opener target origin (from ?source=...)

// --------- Log Helpers ---------
const log = (...a) => console.log(TAG, ...a);
const warn = (...a) => console.warn(TAG, ...a);
const err = (...a) => console.error(TAG, ...a);

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
    if (/^\d{2}$/.test(yy)) {
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
      log('📤 window.opener\'a postMessage gönderiliyor:', type);
      window.opener.postMessage({
        type: type,
        source: 'tp-sorgu-eklentisi-2',
        data: data
      }, '*');
      return;
    }
    
    // window.opener yoksa background'a gönder
    log('📤 Background\'a mesaj gönderiliyor:', type);
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
  const m = (txt || '').match(/(\d+)\s*kayıt\s*b[uü]lundu/i);
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
      const txtAll = (dialogRoot.textContent || '').replace(/\s+/g, ' ').trim();
      const m = txtAll.match(/\b((?:19|20)\d{2}|\d{2})\/\d{4,}\b/);
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
      
      console.log('📋 Tablo header\'ları:', headerTexts);
      
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
                .split(/\n+/)
                .map(item => item.trim())
                .filter(Boolean)
                .map(item => item.replace(/\s+/g, ' '));
              
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
        
        const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;
        
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
  
  console.log('🔍 Final data.fields:', data.fields);
  console.log('📦 Final data.goodsAndServices:', data.goodsAndServices.length, 'sınıf');
  console.log('📝 Final data.transactions:', data.transactions.length, 'işlem');
  
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
    ownerName = ownerElement.textContent.trim().replace(/\s*\(\d+\)\s*$/, '');
  }

  // TÜM HÜCRELERİ TARA (önce STATÜ, sonra diğer alanlar)
  for (let i = 0; i < tds.length; i++) {
    const cellText = (tds[i]?.textContent || '').trim();

    // --- STATÜ YAKALAMA (ham metinle) ---
    if (!status) {
      // En net kalıp: MARKA BAŞVURUSU/TESCİLİ GEÇERSİZ
      if (/MARKA\s*BAŞVURUSU\/TESCİLİ\s*GEÇERSİZ/i.test(cellText)) {
        status = 'MARKA BAŞVURUSU/TESCİLİ GEÇERSİZ';
      }
    }

    // Başvuru numarası: 2022/125224 gibi
    if (!applicationNumber && /^((?:19|20)\d{2}|\d{2})\/\d+$/.test(cellText)) {
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
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateCell)) {
          applicationDate = dateCell;
        }
      }
      continue;
    }

    // Tarih formatı: DD.MM.YYYY
    if (!applicationDate && /^\d{2}\.\d{2}\.\d{4}$/.test(cellText)) {
      applicationDate = cellText;
      continue;
    }

    // Tescil numarası: "2022 125224" gibi
    if (!registrationNumber && /^\d{4}\s+\d+$/.test(cellText)) {
      registrationNumber = cellText;
      continue;
    }

    // Nice sınıfları (metin içinde eğik çizgi vb. varsa)
    if (!niceClasses && /\d+/.test(cellText) && cellText.includes('/')) {
      niceClasses = cellText;
      continue;
    }
  }

  // Başvuru no hâlâ yoksa daha esnek tarama
  if (!applicationNumber) {
    for (let i = 0; i < tds.length; i++) {
      const cellText = (tds[i]?.textContent || '').trim();
      if (/(?:\d{4}|\d{2})\/\d/.test(cellText) || /\d{4}-\d/.test(cellText)) {
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


async function collectOwnerResultsWithDetails() {
  console.log('🔍 collectOwnerResultsWithDetails başladı');
  
  const rows = Array.from(document.querySelectorAll('tbody.MuiTableBody-root tr, tbody tr'));
  console.log(`🔍 Toplam ${rows.length} satır bulundu`);
  
  const processedApplicationNumbers = new Set();
  const batchSize = 100; // 100'er 100'er işle
  
  for (let batchStart = 0; batchStart < rows.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, rows.length);
    const currentBatch = rows.slice(batchStart, batchEnd);
    
    console.log(`🔄 Batch ${Math.floor(batchStart/batchSize) + 1}: ${batchStart + 1}-${batchEnd} satırları işleniyor...`);
    
    const batchItems = [];
    
    for (const [localIdx, tr] of currentBatch.entries()) {
      const globalIdx = batchStart + localIdx;
      console.log(`🔍 Satır ${globalIdx + 1}/${rows.length} işleniyor...`);
      
      const base = parseOwnerRowBase(tr, globalIdx);

      if (!base.applicationNumber) {
        console.log(`ℹ️ Satır ${globalIdx + 1} için modal üzerinden appNo deneniyor...`);
        const detailForAppNo = await openRowModalAndParse(tr, { timeout: 9000 });
        if (detailForAppNo && detailForAppNo.fields) {
          const cand = detailForAppNo.fields['Başvuru Numarası'];
          if (cand) base.applicationNumber = normalizeAppNo(cand);
        }
        if (!base.applicationNumber) {
          console.log(`⚠️ Başvuru numarası bulunamadı: satır ${globalIdx + 1} (modal fallback da başarısız)`);
          continue;
        }
      }

      base.applicationNumber = normalizeAppNo(base.applicationNumber);
      if (processedApplicationNumbers.has(base.applicationNumber)) {
        console.log(`⚠️ Çift kayıt atlandı: ${base.applicationNumber}`);
        continue;
      }
      processedApplicationNumbers.add(normalizeAppNo(base.applicationNumber));

      if (base.imageSrc) {
        base.brandImageDataUrl = base.imageSrc;
        base.brandImageUrl = base.imageSrc;
      }

      console.log(`🔄 Satır ${globalIdx + 1} için modal açılıyor...`);
      
      const detail = await openRowModalAndParse(tr, { timeout: 8000 });
      
      if (detail) {
        base.details = detail.fields || {};
        if (Array.isArray(detail.goodsAndServices)) {
          base.goodsAndServicesByClass = detail.goodsAndServices;
        }
        if (Array.isArray(detail.transactions)) {
          base.transactions = detail.transactions;
        }
        if (!base.imageSrc && detail.imageDataUrl) {
          base.brandImageDataUrl = detail.imageDataUrl;
          base.brandImageUrl = detail.imageDataUrl;
        }
      }

      batchItems.push(base);
      console.log(`✅ Satır ${globalIdx + 1} tamamlandı - ${base.applicationNumber}`);
    }

    // Batch tamamlandı - arayüze gönder
    if (batchItems.length > 0) {
      console.log(`📤 Batch ${Math.floor(batchStart/batchSize) + 1} gönderiliyor: ${batchItems.length} kayıt`);
      
      // Progressive data gönderimi
      sendToOpener('BATCH_VERI_GELDI_KISI', {
        batch: batchItems,
        batchNumber: Math.floor(batchStart/batchSize) + 1,
        totalBatches: Math.ceil(rows.length / batchSize),
        processedCount: batchEnd,
        totalCount: rows.length,
        isComplete: batchEnd >= rows.length
      });
      
      // Batch'ler arası kısa molası (DOM'un nefes alması için)
      if (batchEnd < rows.length) {
        await sleep(1000);
      }
    }
  }

  // Final mesaj - tüm process tamamlandı
  console.log(`🎉 collectOwnerResultsWithDetails tamamlandı: Toplam ${processedApplicationNumbers.size} kayıt işlendi`);
  
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
  const items = await collectOwnerResultsWithDetails();
  sendToOpener('VERI_GELDI_KISI', items);
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
    appInput = await waitFor('input[placeholder=\"Başvuru Numarası\"]', { timeout: 6000 }).catch(()=>null);
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
              items: description.split('\n').filter(item => item.trim() !== '')
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
  
  const appNoMatch = pageText.match(/Başvuru Numarası[:\s]*((?:\d{4}|\d{2})\/\d+)/i);
  if (appNoMatch) details.applicationNumber = normalizeAppNo(appNoMatch[1]);
  
  const brandNameMatch = pageText.match(/Marka Adı[:\s]*([^\n\r]+)/i);
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

// ============================================
// OPTS.TURKPATENT.GOV.TR İÇİN YENİ AKIM
// ============================================

// Sayfa yüklendiğinde URL kontrolü
(function initOptsFlow() {
  const currentUrl = window.location.href;
  
  // opts.turkpatent.gov.tr kontrolü
  if (/^https:\/\/opts\.turkpatent\.gov\.tr\/trademark/i.test(currentUrl)) {
    log('🎯 OPTS sayfası algılandı, hash kontrolü yapılıyor...');
    
    // Hash'den başvuru numarasını al
    const hash = window.location.hash;
    const match = hash.match(/#bn=([^&]+)/);
    
    if (match) {
      const appNo = decodeURIComponent(match[1]);
      log('✅ Hash\'den başvuru no bulundu:', appNo);
      
      // Kısa gecikme sonrası otomatik doldur ve veri topla
      setTimeout(() => {
        runOptsFlow(appNo);
      }, 1000);
    }
  }
})();

// OPTS akışını çalıştır
async function runOptsFlow(appNo) {
  log('🚀 OPTS akışı başlatılıyor:', appNo);
  
  try {
    // Sayfada input alanını bul
    const input = document.querySelector('input[id*="input-"][type="text"]') || 
                  document.querySelector('input[type="text"]');
    
    if (!input) {
      err('❌ Input alanı bulunamadı');
      sendToOpener('HATA_OPTS', { message: 'Input alanı bulunamadı' });
      return;
    }
    
    log('✅ Input bulundu, başvuru no yazılıyor...');
    
    // Input'u doldur
    input.value = '';
    input.focus();
    
    setTimeout(() => {
      input.value = appNo;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      
      log('📝 Başvuru no yazıldı');
      
      // Arama butonuna tıkla
      setTimeout(() => {
        const searchBtn = document.querySelector('button[type="submit"]') ||
                         document.querySelector('button.MuiButton-containedPrimary') ||
                         Array.from(document.querySelectorAll('button')).find(b => 
                           /ara|search|sorgula/i.test(b.textContent || '')
                         );
        
        if (searchBtn) {
          log('🔍 Arama butonu bulundu, tıklanıyor...');
          searchBtn.click();
          
          // Sonuçları bekle ve topla
          setTimeout(() => {
            waitForOptsResultsAndScrape(appNo);
          }, 1500);
        } else {
          log('⚠️ Arama butonu bulunamadı, Enter denenecek');
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
          
          setTimeout(() => {
            waitForOptsResultsAndScrape(appNo);
          }, 1500);
        }
      }, 500);
    }, 300);
    
  } catch (error) {
    err('❌ OPTS akış hatası:', error);
    sendToOpener('HATA_OPTS', { message: error.message });
  }
}

// OPTS sonuçlarını bekle ve scrape et
async function waitForOptsResultsAndScrape(appNo) {
  log('⏳ OPTS sonuçları bekleniyor...');
  
  let attempts = 0;
  const maxAttempts = 40; // 20 saniye (500ms * 40)
  
  const checkInterval = setInterval(() => {
    attempts++;
    
    // Sonuç tablosunu kontrol et
    const resultTable = document.querySelector('table.MuiTable-root, div[class*="MuiTable"] table, tbody');
    const resultRows = resultTable ? resultTable.querySelectorAll('tbody tr, tr') : [];
    
    // En az 1 satır var mı?
    const hasResults = resultRows.length > 0 && 
                      Array.from(resultRows).some(row => {
                        const cells = row.querySelectorAll('td');
                        return cells.length > 2; // En az 3 hücre olmalı
                      });
    
    if (hasResults) {
      log('✅ OPTS sonuçları bulundu, scraping başlatılıyor...');
      clearInterval(checkInterval);
      scrapeOptsData(appNo, resultTable);
      return;
    }
    
    // Maksimum deneme sayısına ulaşıldı
    if (attempts >= maxAttempts) {
      log('❌ OPTS Timeout: Sonuç bulunamadı');
      clearInterval(checkInterval);
      sendToOpener('HATA_OPTS', { message: 'Sonuç bulunamadı veya zaman aşımı' });
    }
  }, 500);
}

// OPTS verilerini scrape et
function scrapeOptsData(appNo, table) {
  log('🔍 OPTS veri scraping başladı...');
  
  try {
    const rows = table.querySelectorAll('tbody tr, tr');
    if (rows.length === 0) {
      sendToOpener('HATA_OPTS', { message: 'Tablo satırları bulunamadı' });
      return;
    }
    
    log(`📊 ${rows.length} satır bulundu, parse ediliyor...`);
    
    // İlk satırı al (opts genelde tek sonuç döner)
    const row = rows[0];
    const cells = Array.from(row.querySelectorAll('td'));
    
    if (cells.length === 0) {
      sendToOpener('HATA_OPTS', { message: 'Hücre bulunamadı' });
      return;
    }
    
    const data = {
      applicationNumber: appNo,
      brandName: '',
      ownerName: '',
      applicationDate: '',
      registrationNumber: '',
      status: '',
      niceClasses: '',
      imageSrc: null,
      brandImageUrl: null,
      brandImageDataUrl: null
    };
    
    // Görsel varsa çek
    const img = row.querySelector('img');
    if (img && img.src) {
      data.imageSrc = img.src;
      data.brandImageUrl = img.src;
      data.brandImageDataUrl = img.src;
      log('🖼️ Görsel bulundu');
    }
    
    // Hücreleri tara
    cells.forEach((cell, index) => {
      const text = cell.textContent.trim();
      
      log(`  Hücre ${index}: "${text}"`);
      
      // Başvuru numarası (2025/123 formatı)
      if (/^\d{4}\/\d+$/.test(text)) {
        data.applicationNumber = normalizeAppNo(text);
        log('  → Başvuru no');
      }
      
      // Tarih formatı (DD.MM.YYYY)
      else if (/^\d{2}\.\d{2}\.\d{4}$/.test(text)) {
        if (!data.applicationDate) {
          data.applicationDate = text;
          log('  → Başvuru tarihi');
        }
      }
      
      // Tescil numarası (2025 123456 formatı)
      else if (/^\d{4}\s+\d+$/.test(text)) {
        data.registrationNumber = text;
        log('  → Tescil no');
      }
      
      // Statü
      else if (/TESCİL|GEÇERSİZ|BAŞVURU|REDDEDİLDİ|YAYINLANDI/i.test(text)) {
        data.status = text;
        log('  → Statü');
      }
      
      // Nice sınıfları (eğik çizgi içeren sayılar)
      else if (text.includes('/') && /\d+/.test(text) && text.length < 50) {
        data.niceClasses = text;
        log('  → Nice sınıfları');
      }
      
      // Marka adı (ilk boş alan)
      else if (text.length > 0 && !data.brandName && text.length < 200) {
        // Şirket ismi değilse
        if (!/LİMİTED|A\.Ş\.|ŞİRKETİ|LTD|INCORPORATED/i.test(text)) {
          data.brandName = text;
          log('  → Marka adı');
        }
      }
      
      // Sahip adı (ikinci boş alan veya şirket içeriyorsa)
      else if (text.length > 0 && !data.ownerName) {
        data.ownerName = text;
        log('  → Sahip adı');
      }
    });
    
    log('✅ OPTS scraping tamamlandı:', data);
    
    // Veriyi ana uygulamaya gönder
    sendToOpener('VERI_GELDI_OPTS', [data]);
    
    // Sekmeyi kapat (isteğe bağlı)
    setTimeout(() => {
      window.close();
    }, 2000);
    
  } catch (error) {
    err('❌ OPTS scraping hatası:', error);
    sendToOpener('HATA_OPTS', { message: 'Scraping hatası: ' + error.message });
  }
}

// ============================================
// OPTS İÇİN MESSAGE LISTENER
// ============================================

// Mevcut listener'a ekle (veya yeni listener oluştur)
chrome.runtime?.onMessage?.addListener?.((request, sender, sendResponse) => {
  // OPTS için özel mesaj
  if (request?.type === 'AUTO_FILL_OPTS' && request?.data) {
    const appNo = request.data;
    log('📨 AUTO_FILL_OPTS mesajı alındı:', appNo);
    
    // Eğer zaten opts sayfasındaysa direkt çalıştır
    if (/^https:\/\/opts\.turkpatent\.gov\.tr/i.test(window.location.href)) {
      runOptsFlow(appNo);
    }
    
    sendResponse?.({ status: 'OK' });
    return true;
  }
  
  return true;
});

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

// Content script'ten gelen verileri ana uygulamaya ilet
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'FORWARD_TO_APP') {
    const { messageType, data } = request;
    
    console.log('[Background] Content script\'ten veri alındı:', messageType);
    
    // Tüm sekmelere broadcast et (ana uygulama dinleyecek)
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        // Sadece allowed domain'lere gönder
        const allowedOrigins = [
          'http://localhost',
          'https://ip-manager-production-aab4b.web.app',
          'https://kubilayguzel.github.io'
        ];
        
        const tabUrl = tab.url || '';
        const isAllowed = allowedOrigins.some(origin => tabUrl.startsWith(origin));
        
        if (isAllowed) {
          chrome.tabs.sendMessage(tab.id, {
            type: messageType,
            source: 'tp-sorgu-eklentisi-2',
            data: data
          }).catch(() => {
            // Tab mesaj dinlemiyorsa sessizce geç
          });
        }
      });
    });
    
    sendResponse({ status: 'OK' });
  }
  return true;
});