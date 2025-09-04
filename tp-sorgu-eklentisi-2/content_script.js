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
const countRows = () => document.querySelectorAll('tbody.MuiTableBody-root tr, tbody tr').length;
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

  // ---- Goods & Services - "Mal ve Hizmet Bilgileri" fieldset'i ara ----
  try {
    const goodsFieldset = Array.from(dialogRoot.querySelectorAll('fieldset')).find(fs => {
      const legend = fs.querySelector('legend');
      return legend && legend.textContent.includes('Mal ve Hizmet');
    });

    if (goodsFieldset) {
      console.log('✅ Mal ve Hizmet Bilgileri fieldset bulundu');
      
      // MuiTable içindeki tbody'yi ara
      const tbody = goodsFieldset.querySelector('.MuiTable-root .MuiTableBody-root');
      if (tbody) {
        const trs = Array.from(tbody.querySelectorAll('.MuiTableRow-root'));
        console.log('🔍 Mal/Hizmet tablosunda', trs.length, 'satır bulundu');
        
        for (const tr of trs) {
          const tds = Array.from(tr.querySelectorAll('.MuiTableCell-body'));
          if (tds.length === 2) {
            const classNoRaw = (tds[0].textContent || '').trim();
            const maybeClassNo = parseInt(classNoRaw, 10);
            
            if (!Number.isNaN(maybeClassNo) && maybeClassNo >= 1 && maybeClassNo <= 45) {
              const text = (tds[1].textContent || '').replace(/\r/g, '').trim();
              
              // Metni satırlara böl ve temizle
              const items = text
                .split(/\n+/)
                .map(s => s.trim())
                .map(s => s.replace(/\s+/g, ' '))
                .filter(Boolean);
              
              console.log('✅ GoodsAndServices eklendi:', maybeClassNo, items);
              data.goodsAndServices.push({ classNo: maybeClassNo, items });
            }
          }
        }
      }
    } else {
      console.warn('⚠️ Mal ve Hizmet Bilgileri fieldset bulunamadı');
    }
    console.log('✅ Toplam goodsAndServices:', data.goodsAndServices.length);
  } catch (e) { 
    console.warn('❌ Goods&Services parse hatası:', e); 
  }

  // ---- Transactions - "Başvuru İşlem Bilgileri" fieldset'i ara ----
  try {
    const transactionFieldset = Array.from(dialogRoot.querySelectorAll('fieldset')).find(fs => {
      const legend = fs.querySelector('legend');
      return legend && legend.textContent.includes('İşlem Bilgileri');
    });

    if (transactionFieldset) {
      console.log('✅ Başvuru İşlem Bilgileri fieldset bulundu');
      
      // MuiTable içindeki tbody'yi ara
      const tbody = transactionFieldset.querySelector('.MuiTable-root .MuiTableBody-root');
      if (tbody) {
        const trs = Array.from(tbody.querySelectorAll('.MuiTableRow-root'));
        console.log('🔍 İşlem tablosunda', trs.length, 'satır bulundu');
        
        const isDate = (s) => /\b\d{2}\.\d{2}\.\d{4}\b/.test(s || '');
        
        for (const tr of trs) {
          const tds = Array.from(tr.querySelectorAll('.MuiTableCell-body'));
          
          // 4 sütunlu satırları kontrol et (Tarih, Tebliğ Tarihi, İşlem, Açıklama)
          if (tds.length === 4) {
            const firstTdText = (tds[0].textContent || '').trim();
            
            if (isDate(firstTdText)) {
              const date = firstTdText;
              const description = (tds[2].textContent || '').trim();
              const note = (tds[3].textContent || '').trim();
              
              // Boş değil ve "-" değilse ekle
              if (description && description !== '-') {
                console.log('✅ Transaction eklendi:', { date, description, note });
                data.transactions.push({ 
                  date, 
                  description, 
                  note: (note && note !== '-') ? note : null 
                });
              }
            }
          }
          // colspan="4" olan başlık satırlarını atla (strong içerik)
          else if (tds.length === 1 && tr.querySelector('strong')) {
            const strongText = tr.querySelector('strong').textContent.trim();
            console.log('🔍 Başlık satırı atlandı:', strongText);
          }
        }
      }
    } else {
      console.warn('⚠️ Başvuru İşlem Bilgileri fieldset bulunamadı');
    }
    console.log('✅ Toplam transactions:', data.transactions.length);
  } catch (e) { 
    console.warn('❌ Transactions parse hatası:', e); 
  }

  // ---- General field scraping - diğer bilgiler için ----
  try {
    const fieldsets = Array.from(dialogRoot.querySelectorAll('fieldset'));
    console.log('🔍 Toplam fieldset sayısı:', fieldsets.length);
    
    for (const fieldset of fieldsets) {
      const legend = fieldset.querySelector('legend');
      const legendText = legend ? legend.textContent.trim() : '';
      
      // Mal/Hizmet ve İşlem fieldset'lerini atla
      if (legendText.includes('Mal ve Hizmet') || legendText.includes('İşlem Bilgileri')) {
        continue;
      }
      
      // Diğer fieldset'lerdeki bilgileri topla
      if (legendText) {
        const content = fieldset.textContent.replace(legendText, '').trim();
        if (content && content.length > 0 && content.length < 1000) {
          data.fields[legendText] = content;
          console.log('✅ Genel alan eklendi:', legendText, '=', content.substring(0, 100) + '...');
        }
      }
    }
  } catch (e) { 
    console.warn('❌ Genel alan parse hatası:', e); 
  }

  console.log('✅ parseDetailsFromOpenDialog tamamlandı:', data);
  return data;
}

async function openRowModalAndParse(tr, { timeout = 9000 } = {}) {
  try {
    // Her ihtimale karşı önce açık bir modal varsa kapat
    closeAnyOpenDialog();

    const btn = findDetailButton(tr);
    if (!btn) return null;
    click(btn);

    // Dialogu bekle
    const dialog = await waitFor('[role="dialog"], .MuiDialog-root, .MuiModal-root, .modal', { timeout }).catch(() => null);
    if (!dialog) return null;

    // İçerik yüklenmesi için ufak bekleme
    await sleep(350);

    // Parse et
    const parsed = await parseDetailsFromOpenDialog(dialog);

    // Kapat
    closeAnyOpenDialog();

    return parsed; // { imageDataUrl, fields, goodsAndServices, transactions }
  } catch (e) {
    warn('openRowModalAndParse hata:', (e && e.message) || e);
    return null;
  }
}

// --------- Satır Parsleme (Base) ---------
function parseOwnerRowBase(tr, idx) {
  const getByRole = (role) => {
    const td = tr.querySelector(`td[role="${role}"]`);
    return td ? (td.textContent || '').trim() : '';
  };
  const orderTxt = (tr.querySelector('td .MuiTypography-alignCenter') || tr.querySelector('td'))?.textContent || `${idx+1}`;
  const hold = getByRole('holdName');
  const ownerName = hold ? hold.replace(/\s*\(\d+\)\s*$/, '') : '';

  // Görsel arama
  let imageSrc = null;
  const img1 = tr.querySelector('img');
  if (img1 && img1.src) imageSrc = img1.src;
  if (!imageSrc) {
    const img2 = tr.querySelector('td img');
    if (img2 && img2.src) imageSrc = img2.src;
  }
  if (!imageSrc) {
    const imgTd = tr.querySelector('td[role="img"] img, td[role="image"] img');
    if (imgTd && imgTd.src) imageSrc = imgTd.src;
  }
  if (!imageSrc) {
    const allTds = tr.querySelectorAll('td');
    for (const td of allTds) {
      const bgImg = getComputedStyle(td).backgroundImage;
      if (bgImg && bgImg !== 'none') {
        const match = bgImg.match(/url\(["']?(.*?)["']?\)/);
        if (match) { imageSrc = match[1]; break; }
      }
    }
  }

  const base = {
    order: Number(orderTxt) || (idx+1),
    applicationNumber: getByRole('applicationNo') || '',
    brandName: getByRole('markName') || '',
    ownerName,
    applicationDate: getByRole('applicationDate') || '',
    registrationNumber: getByRole('registrationNo') || '',
    status: getByRole('state') || '',
    niceClasses: getByRole('niceClasses') || '',
    imageSrc: imageSrc || null
  };

  // Fallback: sabit indeks & regex
  try {
    const tds = Array.from(tr.querySelectorAll('td'));
    const textAt = (i) => (tds[i]?.textContent || '').trim();

    if (!base.applicationNumber && tds.length >= 3) base.applicationNumber = textAt(2);
    if (!base.brandName && tds.length >= 4)        base.brandName        = textAt(3);
    if (!base.applicationDate && tds.length >= 5)  base.applicationDate  = textAt(4);
    if (!base.registrationNumber && tds.length>=6) base.registrationNumber = textAt(5);
    if (!base.status && tds.length >= 7)           base.status           = textAt(6);
    if (!base.niceClasses && tds.length >= 8)      base.niceClasses      = textAt(7);

    const txts = tds.map(td => (td.textContent || '').replace(/\s+/g,' ').trim());
    if (!base.applicationNumber) {
      const appPattern = /(^|\s)\d{4}\/\d{4,7}(\s|$)/;
      const appIdx = txts.findIndex(t => appPattern.test(t));
      if (appIdx >= 0) {
        base.applicationNumber = txts[appIdx];
        if (!base.brandName && txts[appIdx+1]) base.brandName = txts[appIdx+1];
      }
    }
    if (!base.applicationDate) {
      const datePattern = /\b\d{2}\.\d{2}\.\d{4}\b/;
      const dateCell = txts.find(t => datePattern.test(t));
      if (dateCell) base.applicationDate = (dateCell.match(datePattern) || [null])[0] || '';
    }
    if (!base.niceClasses) {
      const nc = txts.find(t => /(^|\s)([1-9]|[1-3]\d|4[0-5])(\s*,\s*([1-9]|[1-3]\d|4[0-5]))*/.test(t));
      if (nc) base.niceClasses = nc;
    }
    if (!base.status) {
      const sc = txts.find(t => /BAŞVURU|TESCİL|GEÇERSİZ|RED|RET|YAYIN|BÜLTEN/i.test(t));
      if (sc) base.status = sc;
    }
    if (!base.registrationNumber) {
      const rc = txts.find(t => /\b\d{4,}\b/.test(t) && t !== base.applicationNumber);
      if (rc) base.registrationNumber = rc;
    }
  } catch (e) {
    log('Fallback kolon parse hatası:', (e && e.message) || e);
  }

  return base;
}

// --------- Sonuç Toplama (Detay Dahil) ---------
async function collectOwnerResultsWithDetails() {
  const rows = Array.from(document.querySelectorAll('tbody.MuiTableBody-root tr, tbody tr'));
  const items = [];
  for (const [idx, tr] of rows.entries()) {
    const base = parseOwnerRowBase(tr, idx);

    if (!base.applicationNumber) {
      log(`Başvuru numarası olmayan satır atlandı: satır ${idx + 1}`);
      continue;
    }

    if (base.imageSrc) {
      base.brandImageDataUrl = base.imageSrc;
      base.brandImageUrl = base.imageSrc;
    }

    // Detay modalını aç ve verileri al
    const detail = await openRowModalAndParse(tr, { timeout: 12000 });
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
  return items;
}

// --------- Yükle & Gönder ---------
async function waitAndSendOwnerResults() {
  let expected = await waitForTotalMetaAndParse(60000); // meta varsa al
  try { await waitFor('tbody tr', { timeout: 30000 }); } catch {}

  try {
    const initialCount = document.querySelectorAll('tbody tr').length;
    const needInfinite = (typeof expected === 'number' ? expected >= 20 : initialCount >= 20);
    if (needInfinite) {
      const ok = await ensureInfiniteOn();
      if (ok && typeof expected === 'number' && expected > 0) {
        await infiniteScrollAllRowsSTRICT(expected, { overallTimeoutMs: 360000 });
      }
    }
  } catch (e) {
    log('Infinite scroll hatası:', (e && e.message) || e);
  }

  const items = await collectOwnerResultsWithDetails();
  sendToOpener('VERI_GELDI_KISI', Array.isArray(items) ? items : []);
}

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
