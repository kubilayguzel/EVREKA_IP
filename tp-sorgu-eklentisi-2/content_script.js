// ================================================
// Evreka IP — SADE (Sadece Sahip No) İçerik Scripti + Sonuç Toplama (STRICT)
// ================================================

const TAG = '[Evreka SahipNo]';
let targetKisiNo = null;
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

// --------- Messaging ---------
function sendToOpener(type, data) {
  const payload = { source: 'tp-extension-sahip', type, data };
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, sourceOrigin || '*');
      log('Mesaj gönderildi:', type, payload);
    } else {
      warn('Opener yok veya kapalı; mesaj gönderilemedi:', type);
    }
  } catch (e) {
    err('postMessage hatası:', e?.message || e);
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

Anladım! Fieldset'ler bulunamıyor. Bu, DOM yapısının beklediğimizden farklı olması veya modal'ın tam yüklenmemiş olması anlamına geliyor.
Debug yapalım ve doğru selector'ları bulalım:
Dosya: tp-sorgu-eklentisi-2/content_script.js
javascript// SİL:
async function parseDetailsFromOpenDialog(dialogRoot) {
  if (!dialogRoot) {
    console.warn('❌ parseDetailsFromOpenDialog: dialogRoot boş');
    return {};
  }

  console.log('🔍 parseDetailsFromOpenDialog başladı');

  const data = {
    imageDataUrl: null,
    fields: {},
    goodsAndServices: [],
    transactions: []
  };

  // ---- EŞYA LİSTESİ - "Mal ve Hizmet Bilgileri" fieldset'i ----
  try {
    console.log('🔍 Eşya listesi aranıyor...');
    
    // "Mal ve Hizmet Bilgileri" legend'ına sahip fieldset'i bul
    const goodsFieldset = Array.from(dialogRoot.querySelectorAll('fieldset')).find(fs => {
      const legend = fs.querySelector('legend');
      const legendText = legend ? legend.textContent.trim() : '';
      return legendText.includes('Mal ve Hizmet');
    });

    if (goodsFieldset) {
      console.log('✅ Mal ve Hizmet Bilgileri fieldset bulundu');
      
      // Fieldset içindeki MuiTable tbody'sini bul
      const goodsTable = goodsFieldset.querySelector('.MuiTableContainer-root .MuiTable-root');
      if (goodsTable) {
        const tbody = goodsTable.querySelector('.MuiTableBody-root');
        if (tbody) {
          const rows = tbody.querySelectorAll('.MuiTableRow-root');
          console.log('🔍 Mal/Hizmet tablosunda', rows.length, 'satır bulundu');
          
          rows.forEach((row, index) => {
            const cells = row.querySelectorAll('.MuiTableCell-body');
            console.log(`🔍 Satır ${index + 1}: ${cells.length} hücre`);
            
            if (cells.length === 2) {
              const classNoText = cells[0].textContent.trim();
              const goodsText = cells[1].textContent.trim();
              
              console.log(`🔍 Sınıf: "${classNoText}", Eşyalar: "${goodsText.substring(0, 50)}..."`);
              
              const classNo = parseInt(classNoText, 10);
              if (!isNaN(classNo) && classNo >= 1 && classNo <= 45) {
                // Eşya listesini satırlara böl ve temizle
                const items = goodsText
                  .split(/\n+/)
                  .map(item => item.trim())
                  .filter(item => item && item.length > 0)
                  .map(item => item.replace(/\s+/g, ' '));
                
                console.log(`✅ Sınıf ${classNo} eklendi:`, items);
                data.goodsAndServices.push({ classNo, items });
              }
            }
          });
        }
      }
    } else {
      console.warn('⚠️ Mal ve Hizmet Bilgileri fieldset bulunamadı');
    }
    
    console.log('✅ Toplam eşya sınıfı:', data.goodsAndServices.length);
  } catch (e) {
    console.error('❌ Eşya listesi parse hatası:', e);
  }

  // ---- İŞLEM GEÇMİŞİ - "Başvuru İşlem Bilgileri" fieldset'i ----
  try {
    console.log('🔍 İşlem geçmişi aranıyor...');
    
    // "Başvuru İşlem Bilgileri" legend'ına sahip fieldset'i bul
    const transactionFieldset = Array.from(dialogRoot.querySelectorAll('fieldset')).find(fs => {
      const legend = fs.querySelector('legend');
      const legendText = legend ? legend.textContent.trim() : '';
      return legendText.includes('İşlem Bilgileri') || legendText.includes('Başvuru İşlem');
    });

    if (transactionFieldset) {
      console.log('✅ Başvuru İşlem Bilgileri fieldset bulundu');
      
      // Fieldset içindeki MuiTable tbody'sini bul  
      const transactionTable = transactionFieldset.querySelector('.MuiTableContainer-root .MuiTable-root');
      if (transactionTable) {
        const tbody = transactionTable.querySelector('.MuiTableBody-root');
        if (tbody) {
          const rows = tbody.querySelectorAll('.MuiTableRow-root');
          console.log('🔍 İşlem tablosunda', rows.length, 'satır bulundu');
          
          const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/; // DD.MM.YYYY formatı
          
          rows.forEach((row, index) => {
            const cells = row.querySelectorAll('.MuiTableCell-body');
            console.log(`🔍 İşlem satır ${index + 1}: ${cells.length} hücre`);
            
            // 4 hücreli satırlar (Tarih, Tebliğ Tarihi, İşlem, Açıklama)
            if (cells.length === 4) {
              const dateText = cells[0].textContent.trim();
              const notificationDate = cells[1].textContent.trim();
              const operationText = cells[2].textContent.trim();
              const descriptionText = cells[3].textContent.trim();
              
              console.log(`🔍 Tarih: "${dateText}", İşlem: "${operationText}"`);
              
              // Tarih formatını kontrol et
              if (dateRegex.test(dateText) && operationText && operationText !== '-') {
                const transaction = {
                  date: dateText,
                  description: operationText,
                  note: (descriptionText && descriptionText !== '-') ? descriptionText : null
                };
                
                console.log('✅ Transaction eklendi:', transaction);
                data.transactions.push(transaction);
              }
            }
            // 1 hücreli satırlar (colspan="4" - başlık satırları)
            else if (cells.length === 1) {
              const cellContent = cells[0].textContent.trim();
              console.log(`🔍 Başlık satırı atlandı: "${cellContent}"`);
            }
          });
        }
      }
    } else {
      console.warn('⚠️ Başvuru İşlem Bilgileri fieldset bulunamadı');
    }
    
    console.log('✅ Toplam transaction:', data.transactions.length);
  } catch (e) {
    console.error('❌ İşlem geçmişi parse hatası:', e);
  }

  // ---- GENEL BİLGİLER - Diğer fieldset'ler ----
  try {
    console.log('🔍 Genel bilgiler toplanıyor...');
    
    const allFieldsets = dialogRoot.querySelectorAll('fieldset');
    console.log('🔍 Toplam fieldset sayısı:', allFieldsets.length);
    
    allFieldsets.forEach((fieldset, index) => {
      const legend = fieldset.querySelector('legend');
      if (!legend) return;
      
      const legendText = legend.textContent.trim();
      console.log(`🔍 Fieldset ${index + 1}: "${legendText}"`);
      
      // Eşya ve işlem fieldset'lerini atla
      if (legendText.includes('Mal ve Hizmet') || 
          legendText.includes('İşlem Bilgileri') || 
          legendText.includes('Başvuru İşlem')) {
        console.log(`⚠️ Atlandı: ${legendText}`);
        return;
      }
      
      // Fieldset içeriğini al (legend'ı hariç tut)
      const content = fieldset.textContent.replace(legendText, '').trim();
      if (content && content.length > 0 && content.length < 2000) {
        data.fields[legendText] = content;
        console.log(`✅ Genel alan eklendi: "${legendText}" = "${content.substring(0, 100)}..."`);
      }
    });
  } catch (e) {
    console.error('❌ Genel bilgi parse hatası:', e);
  }

  console.log('🎉 parseDetailsFromOpenDialog tamamlandı:', {
    fieldsCount: Object.keys(data.fields).length,
    goodsAndServicesCount: data.goodsAndServices.length,
    transactionsCount: data.transactions.length
  });
  
  return data;
}

// DEĞIŞTIR/EKLE:
async function parseDetailsFromOpenDialog(dialogRoot) {
  if (!dialogRoot) {
    console.warn('❌ parseDetailsFromOpenDialog: dialogRoot boş');
    return {};
  }

  console.log('🔍 parseDetailsFromOpenDialog başladı');
  console.log('🔍 DialogRoot HTML:', dialogRoot.outerHTML.substring(0, 500) + '...');

  const data = {
    imageDataUrl: null,
    fields: {},
    goodsAndServices: [],
    transactions: []
  };

  // ---- DEBUG: Tüm DOM yapısını incele ----
  try {
    console.log('🔍 DOM YAPISI ARAŞTIRMASI:');
    
    // Tüm fieldset'leri listele
    const allFieldsets = dialogRoot.querySelectorAll('fieldset');
    console.log('🔍 Toplam fieldset sayısı:', allFieldsets.length);
    
    allFieldsets.forEach((fieldset, index) => {
      const legend = fieldset.querySelector('legend');
      const legendText = legend ? legend.textContent.trim() : 'LEGEND YOK';
      console.log(`🔍 Fieldset ${index + 1}: "${legendText}"`);
      
      // Fieldset içindeki table'ları say
      const tables = fieldset.querySelectorAll('table, .MuiTable-root');
      console.log(`   📊 ${tables.length} tablo bulundu`);
      
      // Her tablo için tbody'leri say
      tables.forEach((table, tableIndex) => {
        const tbodies = table.querySelectorAll('tbody, .MuiTableBody-root');
        console.log(`   📊 Tablo ${tableIndex + 1}: ${tbodies.length} tbody`);
        
        tbodies.forEach((tbody, tbodyIndex) => {
          const rows = tbody.querySelectorAll('tr, .MuiTableRow-root');
          console.log(`   📊 Tbody ${tbodyIndex + 1}: ${rows.length} satır`);
        });
      });
    });

    // Fieldset yoksa, direkt tablo ara
    if (allFieldsets.length === 0) {
      console.log('🔍 Fieldset yok, direkt tablo aranıyor...');
      const allTables = dialogRoot.querySelectorAll('table, .MuiTable-root');
      console.log('🔍 Direkt bulunan tablo sayısı:', allTables.length);
      
      allTables.forEach((table, index) => {
        const headers = table.querySelectorAll('th, .MuiTableCell-head');
        const headerTexts = Array.from(headers).map(h => h.textContent.trim());
        console.log(`🔍 Tablo ${index + 1} başlıkları:`, headerTexts);
      });
    }

  } catch (e) {
    console.error('❌ DOM araştırma hatası:', e);
  }

  // ---- EŞYA LİSTESİ - Farklı yöntemler dene ----
  try {
    console.log('🔍 EŞYA LİSTESİ ARAŞTIRMASI:');
    
    // Yöntem 1: Fieldset içinde ara
    let goodsFound = false;
    const allFieldsets = dialogRoot.querySelectorAll('fieldset');
    
    for (const fieldset of allFieldsets) {
      const legend = fieldset.querySelector('legend');
      const legendText = legend ? legend.textContent.trim() : '';
      console.log(`🔍 Fieldset kontrol: "${legendText}"`);
      
      if (legendText.includes('Mal') || legendText.includes('Hizmet') || legendText.includes('Sınıf')) {
        console.log('✅ Eşya fieldset bulundu:', legendText);
        
        const tbody = fieldset.querySelector('tbody, .MuiTableBody-root');
        if (tbody) {
          const rows = tbody.querySelectorAll('tr, .MuiTableRow-root');
          console.log(`📊 ${rows.length} satır bulundu`);
          
          for (const row of rows) {
            const cells = row.querySelectorAll('td, .MuiTableCell-body');
            if (cells.length === 2) {
              const classNoText = cells[0].textContent.trim();
              const goodsText = cells[1].textContent.trim();
              const classNo = parseInt(classNoText, 10);
              
              if (!isNaN(classNo) && classNo >= 1 && classNo <= 45) {
                const items = goodsText.split(/\n+/).map(item => item.trim()).filter(Boolean);
                data.goodsAndServices.push({ classNo, items });
                console.log(`✅ Sınıf ${classNo} eklendi: ${items.length} eşya`);
                goodsFound = true;
              }
            }
          }
        }
        break;
      }
    }
    
    // Yöntem 2: Fieldset yoksa direkt tablo ara (Sınıf + Mal/Hizmet başlıklı)
    if (!goodsFound) {
      console.log('🔍 Fieldset\'te bulunamadı, direkt tablo aranıyor...');
      
      const allTables = dialogRoot.querySelectorAll('table, .MuiTable-root');
      for (const table of allTables) {
        const headers = table.querySelectorAll('th, .MuiTableCell-head');
        const headerTexts = Array.from(headers).map(h => h.textContent.trim());
        
        // "Sınıf" ve "Mal" içeren başlık varsa bu eşya tablosu
        if (headerTexts.some(h => h.includes('Sınıf')) && 
            headerTexts.some(h => h.includes('Mal') || h.includes('Hizmet'))) {
          console.log('✅ Eşya tablosu bulundu (başlık kontrolü):', headerTexts);
          
          const tbody = table.querySelector('tbody, .MuiTableBody-root');
          if (tbody) {
            const rows = tbody.querySelectorAll('tr, .MuiTableRow-root');
            for (const row of rows) {
              const cells = row.querySelectorAll('td, .MuiTableCell-body');
              if (cells.length === 2) {
                const classNoText = cells[0].textContent.trim();
                const goodsText = cells[1].textContent.trim();
                const classNo = parseInt(classNoText, 10);
                
                if (!isNaN(classNo) && classNo >= 1 && classNo <= 45) {
                  const items = goodsText.split(/\n+/).map(item => item.trim()).filter(Boolean);
                  data.goodsAndServices.push({ classNo, items });
                  console.log(`✅ Sınıf ${classNo} eklendi: ${items.length} eşya`);
                  goodsFound = true;
                }
              }
            }
          }
          break;
        }
      }
    }
    
    console.log('✅ Eşya araştırması tamamlandı:', data.goodsAndServices.length, 'sınıf bulundu');
  } catch (e) {
    console.error('❌ Eşya listesi parse hatası:', e);
  }

  // ---- İŞLEM GEÇMİŞİ - Farklı yöntemler dene ----
  try {
    console.log('🔍 İŞLEM GEÇMİŞİ ARAŞTIRMASI:');
    
    let transactionsFound = false;
    const allFieldsets = dialogRoot.querySelectorAll('fieldset');
    
    // Yöntem 1: Fieldset içinde ara
    for (const fieldset of allFieldsets) {
      const legend = fieldset.querySelector('legend');
      const legendText = legend ? legend.textContent.trim() : '';
      
      if (legendText.includes('İşlem') || legendText.includes('Başvuru') || legendText.includes('Bilgi')) {
        console.log('✅ İşlem fieldset bulundu:', legendText);
        
        const tbody = fieldset.querySelector('tbody, .MuiTableBody-root');
        if (tbody) {
          const rows = tbody.querySelectorAll('tr, .MuiTableRow-root');
          console.log(`📊 ${rows.length} satır bulundu`);
          
          for (const row of rows) {
            const cells = row.querySelectorAll('td, .MuiTableCell-body');
            if (cells.length === 4) {
              const dateText = cells[0].textContent.trim();
              const operationText = cells[2].textContent.trim();
              const noteText = cells[3].textContent.trim();
              
              // Tarih formatı kontrolü
              if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateText) && operationText && operationText !== '-') {
                data.transactions.push({
                  date: dateText,
                  description: operationText,
                  note: (noteText && noteText !== '-') ? noteText : null
                });
                console.log(`✅ İşlem eklendi: ${dateText} - ${operationText}`);
                transactionsFound = true;
              }
            }
          }
        }
        break;
      }
    }
    
    // Yöntem 2: Fieldset yoksa direkt tablo ara (Tarih başlıklı)
    if (!transactionsFound) {
      console.log('🔍 Fieldset\'te bulunamadı, direkt tablo aranıyor...');
      
      const allTables = dialogRoot.querySelectorAll('table, .MuiTable-root');
      for (const table of allTables) {
        const headers = table.querySelectorAll('th, .MuiTableCell-head');
        const headerTexts = Array.from(headers).map(h => h.textContent.trim());
        
        // "Tarih" ve "İşlem" içeren başlık varsa bu işlem tablosu
        if (headerTexts.some(h => h.includes('Tarih')) && 
            headerTexts.some(h => h.includes('İşlem'))) {
          console.log('✅ İşlem tablosu bulundu (başlık kontrolü):', headerTexts);
          
          const tbody = table.querySelector('tbody, .MuiTableBody-root');
          if (tbody) {
            const rows = tbody.querySelectorAll('tr, .MuiTableRow-root');
            for (const row of rows) {
              const cells = row.querySelectorAll('td, .MuiTableCell-body');
              if (cells.length === 4) {
                const dateText = cells[0].textContent.trim();
                const operationText = cells[2].textContent.trim();
                const noteText = cells[3].textContent.trim();
                
                if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateText) && operationText && operationText !== '-') {
                  data.transactions.push({
                    date: dateText,
                    description: operationText,
                    note: (noteText && noteText !== '-') ? noteText : null
                  });
                  console.log(`✅ İşlem eklendi: ${dateText} - ${operationText}`);
                  transactionsFound = true;
                }
              }
            }
          }
          break;
        }
      }
    }
    
    console.log('✅ İşlem araştırması tamamlandı:', data.transactions.length, 'işlem bulundu');
  } catch (e) {
    console.error('❌ İşlem geçmişi parse hatası:', e);
  }

  console.log('🎉 parseDetailsFromOpenDialog tamamlandı:', {
    fieldsCount: Object.keys(data.fields).length,
    goodsAndServicesCount: data.goodsAndServices.length,
    transactionsCount: data.transactions.length
  });
  
  return data;
}

async function openRowModalAndParse(tr, { timeout = 9000 } = {}) {
  try {
    log('openRowModalAndParse: Detay butonu aranıyor ve modal açılıyor...');
    closeAnyOpenDialog();

    const btns = Array.from(tr.querySelectorAll('button, a[role="button"], .MuiIconButton-root'));
    let btn = btns.find(b => {
      const t = (b.textContent || '').toLowerCase();
      const a = (b.getAttribute?.('aria-label') || '').toLowerCase();
      return /detay|detail|incele/.test(t) || /detay|detail|incele/.test(a);
    }) || btns[btns.length - 1];
    if (!btn) {
      log('openRowModalAndParse: Detay butonu bulunamadı.');
      return null;
    }
    click(btn);

    const dialog = await waitFor('[role="dialog"], .MuiDialog-root, .MuiModal-root, .modal', { timeout }).catch(() => null);
    if (!dialog) {
      log('openRowModalAndParse: Modal bulunamadı, timeout.');
      return null;
    }
    log('openRowModalAndParse: Modal açıldı, içerik bekleniyor...');

    // Yükleme animasyonunun kaybolmasını bekle
    await waitFor('.MuiCircularProgress-root, .loader', { root: dialog, timeout: 5000, test: el => !el || el.style.display === 'none' }).catch(() => {});
    await sleep(200); // Ekstra küçük bir stabilizasyon beklemesi.

    log('openRowModalAndParse: İçerik yüklemesi tamamlandı gibi görünüyor, parse ediliyor...');
    const parsed = await parseDetailsFromOpenDialog(dialog);

    log('openRowModalAndParse: Modal parse edildi. Kapatılıyor...');
    closeAnyOpenDialog();

    log('openRowModalAndParse: Fonksiyon tamamlandı. Dönülen sonuç:', parsed);
    return parsed;
  } catch (e) {
    warn('openRowModalAndParse hata:', e?.message || e);
    return null;
  }
}

// --------- Sonuç Toplama ---------
function parseOwnerRowBase(tr, idx) {
  const get = (role) => {
    const td = tr.querySelector(`td[role="${role}"]`);
    return td ? (td.textContent || '').trim() : '';
  };
  const orderTxt = (tr.querySelector('td .MuiTypography-alignCenter') || tr.querySelector('td'))?.textContent || `${idx+1}`;
  const hold = get('holdName');
  const ownerName = hold ? hold.replace(/\s*\(\d+\)\s*$/, '') : '';

  // Görsel arama - çeşitli selector'lar deneyelim
  let imageSrc = null;
  const img1 = tr.querySelector('img'); if (img1?.src) imageSrc = img1.src;
  if (!imageSrc) { const img2 = tr.querySelector('td img'); if (img2?.src) imageSrc = img2.src; }
  if (!imageSrc) { const imgTd = tr.querySelector('td[role="img"] img, td[role="image"] img'); if (imgTd?.src) imageSrc = imgTd.src; }
  if (!imageSrc) {
    const allTds = tr.querySelectorAll('td');
    for (const td of allTds) {
      const bgImg = getComputedStyle(td).backgroundImage;
      if (bgImg && bgImg !== 'none') { const m = bgImg.match(/url\(["']?(.*?)["']?\)/); if (m) { imageSrc = m[1]; break; } }
    }
  }

  // Temel alanlar (önce role, yoksa index/regex)
  let applicationNumber = get('applicationNo') || '';
  let brandName = get('markName') || '';
  let applicationDate = get('applicationDate') || '';
  let registrationNumber = get('registrationNo') || '';
  let status = get('state') || '';
  let niceClasses = get('niceClasses') || '';

  try {
    const tds = Array.from(tr.querySelectorAll('td'));
    const texts = tds.map(td => (td.textContent || '').replace(/\s+/g,' ').trim());
    // Başvuru no: 2024/123456
    if (!applicationNumber) {
      const appPattern = /(^|\s)\d{4}\/\d{4,7}(\s|$)/;
      const idxApp = texts.findIndex(t => appPattern.test(t));
      if (idxApp >= 0) { applicationNumber = texts[idxApp]; if (!brandName && texts[idxApp+1]) brandName = texts[idxApp+1]; }
    }
    // Tarih DD.MM.YYYY
    if (!applicationDate) {
      const m = texts.find(t => /\b\d{2}\.\d{2}\.\d{4}\b/.test(t));
      if (m) applicationDate = (m.match(/\b\d{2}\.\d{2}\.\d{4}\b/) || [null])[0] || '';
    }
    // Nice sınıf listesi
    if (!niceClasses) {
      const nice = texts.find(t => /(^|\s)([1-9]|[1-3]\d|4[0-5])(\s*,\s*([1-9]|[1-3]\d|4[0-5]))*/.test(t));
      if (nice) niceClasses = nice;
    }
    // Durum
    if (!status) {
      const s = texts.find(t => /BAŞVURU|TESCİL|GEÇERSİZ|RED|RET|YAYIN|BÜLTEN/i.test(t));
      if (s) status = s;
    }
    // Tescil no
    if (!registrationNumber) {
      const reg = texts.find(t => /\b\d{4,}\b/.test(t) && t !== applicationNumber);
      if (reg) registrationNumber = reg;
    }
  } catch {}

  return {
    order: Number(orderTxt) || (idx+1),
    applicationNumber,
    brandName,
    ownerName,
    applicationDate,
    registrationNumber,
    status,
    niceClasses,
    imageSrc
  };
}

async function collectOwnerResultsWithDetails() {
  const rows = Array.from(document.querySelectorAll('tbody.MuiTableBody-root tr, tbody tr'));
  const items = [];
  for (const [idx, tr] of rows.entries()) {
    const base = parseOwnerRowBase(tr, idx);

    // Başvuru numarası yoksa atla
    if (!base.applicationNumber) {
      log(`Başvuru numarası olmayan satır atlandı: satır ${idx + 1}`);
      continue;
    }

    if (base.imageSrc) {
      base.brandImageDataUrl = base.imageSrc;
      base.brandImageUrl = base.imageSrc;
    }

    // Detayları modal üzerinden çek
    const detail = await openRowModalAndParse(tr, { timeout: 15000 });
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

    items.push(base);
  }

  // Fonksiyonun sonu düzeltildi
  return items;
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
function broadcastAutoQueryToFrames(value) {
  try {
    const payload = { source: 'EVREKA', type: 'EVREKA_AUTO_QUERY', queryType: 'sahip', value };
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
  }
}, false);

function captureUrlParams() {
  try {
    const url = new URL(window.location.href);
    const autoQuery = url.searchParams.get('auto_query');
    const queryType = url.searchParams.get('query_type');
    const src = url.searchParams.get('source');
    if (src) sourceOrigin = src;
    if (autoQuery && queryType === 'sahip') {
      log('URL üzerinden sahip no bulundu:', autoQuery, 'sourceOrigin:', sourceOrigin);
      broadcastAutoQueryToFrames(autoQuery);
      targetKisiNo = autoQuery;
      runOwnerFlow().catch(err);
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