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
function findButtonByTextFast(text) {
  const btns = document.querySelectorAll('button');
  for (const b of btns) {
    if ((b.textContent || '').trim().includes(text)) return b;
    const spanBtn = b.querySelector('span');
    if (spanBtn && (spanBtn.textContent || '').trim().includes(text)) return b;
  }
  return null;
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
  if (t.clickable) click(t.clickable);
  await new Promise(r => setTimeout(r, 150));
  if (isChecked()) { log('Sonsuz Liste AÇILDI (clickable).'); return true; }
  if (t.input) {
    click(t.input);
    await new Promise(r => setTimeout(r, 150));
    if (isChecked()) { log('Sonsuz Liste AÇILDI (input).'); return true; }
  }
  if (t.labelNode) {
    click(t.labelNode);
    await new Promise(r => setTimeout(r, 150));
    if (isChecked()) { log('Sonsuz Liste AÇILDI (label).'); return true; }
  }
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
  let expected = getExpectedTotalCount();
  if (typeof expected === 'number') return expected;
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
  if (!expectedTotal || lastCount < expectedTotal) {
    await sleep(800);
    scrollBottom();
  }
  while (true) {
    if (expectedTotal && lastCount >= expectedTotal) {
      await sleep(500);
      break;
    }
    if (performance.now() - start > overallTimeoutMs) {
      log('Uyarı: overall timeout aşıldı. Yüklenen:', lastCount, 'beklenen:', expectedTotal);
      break;
    }
    const increasedTo = await waitForRowIncrease(lastCount, 35000);
    if (increasedTo && increasedTo > lastCount) {
      lastCount = increasedTo;
      log('Yeni kayıtlar geldi →', lastCount, '/', expectedTotal || '?');
      await sleep(1000);
      scrollBottom();
      continue;
    }
    if (isLoading()) {
      log('Loader görünüyor, biraz daha bekleniyor...');
      await sleep(1500);
      scrollBottom();
      continue;
    }
    await sleep(1200);
    scrollBottom();
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

// Ortak parse fonksiyonu (hem modal hem de direkt sayfadan scraping için)
async function parseTrademarkDetails(root) {
  const data = {
    fields: {},
    goodsAndServices: [],
    transactions: [],
    owners: [],
    imageDataUrl: null
  };

  // Marka görselini yakala
  const imgElement = root.querySelector('img[src^="data:image"]');
  if (imgElement) {
    data.imageDataUrl = imgElement.src;
  }

  const fieldsets = root.querySelectorAll('fieldset');
  for (const fieldset of fieldsets) {
    const legend = fieldset.querySelector('legend')?.textContent.trim();

    if (legend === 'Marka Bilgileri') {
      const rows = fieldset.querySelectorAll('tr');
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length === 4) {
          const key1 = cells[0].textContent.trim();
          const val1 = cells[1].textContent.trim();
          const key2 = cells[2].textContent.trim();
          const val2 = cells[3].textContent.trim();
          if (key1) data.fields[key1] = val1;
          if (key2) data.fields[key2] = val2;
        } else if (cells.length === 2 && cells[0].textContent.trim() === 'Marka Adı') {
          data.fields['Marka Adı'] = cells[1].textContent.trim();
        } else if (cells.length === 2 && cells[0].textContent.trim() === 'Vekil Bilgileri') {
          // Vekil Bilgileri için özel parse
          const vekil = Array.from(cells[1].querySelectorAll('p')).map(p => p.textContent.trim()).filter(Boolean);
          data.fields['Vekil Bilgileri'] = vekil;
        }
      }
      // Sahip Bilgileri için özel parse
      const ownerCell = fieldset.querySelector('td.MuiTableCell-root[colspan="3"]');
      if (ownerCell) {
          const ownerInfoLines = Array.from(ownerCell.querySelectorAll('p')).map(p => p.textContent.trim()).filter(Boolean);
          if (ownerInfoLines.length >= 2) {
              const owner = {
                  id: ownerInfoLines[0],
                  name: ownerInfoLines[1],
                  address: ownerInfoLines.slice(2).join(' ')
              };
              data.owners.push(owner);
          }
      }

    } else if (legend === 'Mal ve Hizmet Bilgileri') {
      const rows = fieldset.querySelectorAll('tbody tr');
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length === 2) {
          const classNo = parseInt(cells[0].textContent.trim(), 10);
          const goodsText = cells[1].textContent.trim();
          if (!isNaN(classNo) && goodsText) {
            const items = goodsText.split(/\n+/).map(item => item.trim()).filter(Boolean);
            data.goodsAndServices.push({ classNo, items });
          }
        }
      }

    } else if (legend === 'Başvuru İşlem Bilgileri') {
      const rows = fieldset.querySelectorAll('tbody tr');
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length === 4) {
          const [date, notifyDate, operation, description] = cells.map(c => c.textContent.trim());
          if (date && operation && operation !== '-') {
            data.transactions.push({
              date,
              notifyDate: notifyDate === '-' ? null : notifyDate,
              operation,
              description: description === '-' ? null : description
            });
          }
        }
      }
    }
  }

  // Son olarak Başvuru No ve Tarihi ekle (kaynak HTML'e göre)
  if (data.fields['Başvuru Numarası']) {
    data.fields['Başvuru Numarası'] = normalizeAppNo(data.fields['Başvuru Numarası']);
  }
  
  return data;
}

// --------- Yeni: Tek Başvuru Sonucunu Topla ve Gönder ---------
async function scrapeAndSendSingleApplicationResult() {
  log('Tekil başvuru sonucu toplanıyor...');
  try {
    // Sonuç sayfasının yüklenmesini bekle
    await waitFor('fieldset legend', { timeout: 10000 });
    
    // Sayfadaki tüm veriyi kazı
    const scrapedData = await parseTrademarkDetails(document);
    
    if (scrapedData && scrapedData.fields['Başvuru Numarası']) {
      log('Başvuru verisi başarıyla kazındı.', scrapedData);
      
      // Veriyi direkt olarak ana uygulamaya gönder
      sendToOpener('VERI_GELDI_BASVURU', {
        applicationData: scrapedData
      });
      
    } else {
      err('Başvuru verisi kazınamadı.');
      sendToOpener('HATA_BASVURU', { message: 'Başvuru verisi sayfadan kazınamadı.' });
    }

  } catch (e) {
    err('Tekil başvuru sonucu toplama akışında hata:', e);
    sendToOpener('HATA_BASVURU', { message: 'Başvuru sonucu beklenirken bir hata oluştu.' });
  }
}

// --------- Sonsuz Liste & Scroll Yardımcıları (Sahip No akışı için) ---------
// ... bu kısım değişmeden kalıyor ...
async function collectOwnerResultsWithDetails() {
  console.log('🔍 collectOwnerResultsWithDetails başladı');
  const rows = Array.from(document.querySelectorAll('tbody.MuiTableBody-root tr, tbody tr'));
  console.log(`🔍 Toplam ${rows.length} satır bulundu`);
  const processedApplicationNumbers = new Set();
  const batchSize = 100;
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
    if (batchItems.length > 0) {
      console.log(`📤 Batch ${Math.floor(batchStart/batchSize) + 1} gönderiliyor: ${batchItems.length} kayıt`);
      sendToOpener('BATCH_VERI_GELDI_KISI', {
        batch: batchItems,
        batchNumber: Math.floor(batchStart/batchSize) + 1,
        totalBatches: Math.ceil(rows.length / batchSize),
        processedCount: batchEnd,
        totalCount: rows.length,
        isComplete: batchEnd >= rows.length
      });
      if (batchEnd < rows.length) {
        await sleep(1000);
      }
    }
  }
  console.log(`🎉 collectOwnerResultsWithDetails tamamlandı: Toplam ${processedApplicationNumbers.size} kayıt işlendi`);
  sendToOpener('VERI_GELDI_KISI_COMPLETE', {
    totalProcessed: processedApplicationNumbers.size,
    totalRows: rows.length
  });
}

async function waitAndSendOwnerResults() {
  let expected = await waitForTotalMetaAndParse(60000);
  if (typeof expected !== 'number' || !(expected > 0)) {
    try { await waitFor('tbody.MuiTableBody-root tr', { timeout: 20000 }); } catch {}
    expected = getExpectedTotalCount();
  }
  log('Beklenen toplam kayıt:', expected);
  try { await waitFor('tbody.MuiTableBody-root tr', { timeout: 30000 }); } catch {}
  try {
    const initialCount = document.querySelectorAll('tbody.MuiTableBody-root tr').length;
    const needInfinite = (typeof expected === 'number' ? expected >= 20 : initialCount >= 20);
    if (needInfinite) {
      const ok = await ensureInfiniteOn();
      if (ok && typeof expected === 'number' && expected > 0) {
        const loaded = await infiniteScrollAllRowsSTRICT(expected, { overallTimeoutMs: 360000 });
        if (typeof loaded === 'number' && loaded < expected) {
          log('Uyarı: beklenen sayıya ulaşılamadı. loaded:', loaded, 'expected:', expected);
        }
      }
    }
  } catch (e) { /* yoksay */ }
  const finalCount = document.querySelectorAll('tbody.MuiTableBody-root tr').length;
  if (typeof expected === 'number' && expected > 0 && finalCount < expected) {
    log('Beklenen sayıya ulaşılmadı, veri gönderilmeyecek. final:', finalCount, 'expected:', expected);
    sendToOpener('HATA_KISI', { message: 'Sonuçların tam listelemesi tamamlanmadı.', loaded: finalCount, expected });
    return;
  }
  const items = await collectOwnerResultsWithDetails();
  sendToOpener('VERI_GELDI_KISI', items);
}

// --------- Ana Akış ---------
async function runOwnerFlow() {
  log('Sahip No akışı başladı:', targetKisiNo);
  if (!targetKisiNo) { warn('targetKisiNo boş; çıkış.'); return; }
  try { await closeFraudModalIfAny(); } catch {}
  let kisiInput =
    document.querySelector('input.MuiInputBase-input.MuiInput-input[placeholder="Kişi Numarası"]') ||
    document.querySelector('input[placeholder="Kişi Numarası"]');
  if (!kisiInput) {
    kisiInput = await waitFor('input[placeholder="Kişi Numarası"]', { timeout: 6000 }).catch(()=>null);
  }
  if (!kisiInput) { err('Kişi Numarası alanı bulunamadı.'); sendToOpener('HATA_KISI', { message: 'Kişi Numarası alanı bulunamadı.' }); return; }
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


// Başvuru No akışı
async function runApplicationFlow() {
  log('Başvuru No akışı başladı:', targetAppNo);
  if (!targetAppNo) { warn('targetAppNo boş; çıkış.'); return; }

  try { await closeFraudModalIfAny(); } catch {}

  // 1) "Dosya Takibi" sekmesine geç
  let tabBtn = findButtonByTextFast('Dosya Takibi');
  if (!tabBtn) {
    tabBtn = await waitFor('button[role="tab"]', {
      timeout: 4000,
      test: (el) => (el.textContent || '').includes('Dosya Takibi')
    });
  }
  if (tabBtn && tabBtn.getAttribute('aria-selected') !== 'true') {
    click(tabBtn);
    log('Dosya Takibi sekmesine tıklandı.');
  } else if (tabBtn) {
    log('Dosya Takibi zaten aktif.');
  } else {
    err('Dosya Takibi sekmesi bulunamadı.');
    return;
  }
  
  // 2) Formu doldur + Sorgula
  const input = await waitFor('input[placeholder="Başvuru Numarası"]', { timeout: 4000 });
  
  let sorgulaBtn = findButtonByTextFast('Sorgula');
  if (!sorgulaBtn) {
    sorgulaBtn = await waitFor('button', {
      timeout: 3000,
      test: (el) => (el.textContent || '').includes('Sorgula')
    });
  }

  input.focus();
  setReactInputValue(input, String(targetAppNo));
  log('Başvuru No yazıldı:', targetAppNo);

  sendToOpener('SORGU_BASLADI');
  if (sorgulaBtn && click(sorgulaBtn)) {
    log('Sorgula tıklandı. ✔');
  } else {
    pressEnter(input);
    log('Sorgula butonu yok; Enter gönderildi. ✔');
  }
  
  // Yeni: Tekil başvuru sonuçlarını topla
  await scrapeAndSendSingleApplicationResult();
}

// --------- Dış Mesajlar ve URL Tetikleyicileri (Birleştirilmiş) ---------
chrome.runtime?.onMessage?.addListener?.((request, sender, sendResponse) => {
  if (request?.type === 'AUTO_FILL' || request?.type === 'AUTO_FILL_BASVURU') {
    targetAppNo = request.data;
    runApplicationFlow().catch(err);
    sendResponse?.({ status: 'OK' });
    return true;
  }
  if (request?.type === 'AUTO_FILL_KISI' && request?.data) {
    targetKisiNo = request.data;
    runOwnerFlow().catch(err);
    sendResponse?.({ status: 'OK' });
    return true;
  }
  return true;
});

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
    if (autoQuery && (queryType === 'sahip' || queryType === 'basvuru' || queryType === 'application')) {
      log('URL üzerinden auto_query alındı:', autoQuery, 'queryType:', queryType, 'sourceOrigin:', sourceOrigin);
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