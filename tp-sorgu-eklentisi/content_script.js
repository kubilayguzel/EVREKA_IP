// [Evreka CS] Wide-match debug content script
const TAG='[Evreka CS]';
console.log(TAG, 'content_script loaded at', location.href);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function waitFor(checkFn, {timeout=20000, interval=120, label=''} = {}) {
  const t0 = Date.now();
  return new Promise(async (resolve) => {
    let iter = 0;
    while (Date.now() - t0 < timeout) {
      try {
        const el = typeof checkFn === 'string' ? document.querySelector(checkFn) : checkFn();
        if (el) {
          console.log(TAG, 'waitFor OK:', label || checkFn, 'in', Date.now()-t0,'ms');
          return resolve(el);
        }
      } catch(e) {
        console.warn(TAG, 'waitFor error:', label, e);
      }
      if (++iter % 10 === 0) console.log(TAG, 'waitFor polling...', label, 'elapsed', Date.now()-t0,'ms');
      await sleep(interval);
    }
    console.warn(TAG, 'waitFor TIMEOUT:', label);
    resolve(null);
  });
}

// Native setter for React/MUI
function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
}

function fillReactInput(input, value) {
  console.log(TAG, 'fillReactInput (MUI optimized) ->', value);
  
  if (!input) {
    console.error(TAG, 'Input element is null/undefined');
    return;
  }
  
  // MUI input'u focus et
  input.focus();
  
  // Direkt değeri yaz (temizleme adımı gereksiz)
  setNativeValue(input, value);
  
  // MUI için gerekli event'leri tetikle
  input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  
  console.log(TAG, 'Input filled, final value:', input.value);
}

function findButtonByText(...texts) {
  const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const want = new Set(texts.map(t => norm(t)));
  
  // Tüm button elementleri (MUI dahil)
  const nodes = Array.from(document.querySelectorAll(
    'button, [role="button"], input[type="button"], input[type="submit"], .MuiButton-root'
  ));
  
  for (const node of nodes) {
    // innerText ve value kontrolü
    const text = norm(node.innerText || node.textContent || node.value || '');
    if (want.has(text)) {
      console.log(TAG, '✅ Button found by text:', node.innerText || node.value);
      return node;
    }
    
    // Span içinde text olabilir (MUI pattern)
    const span = node.querySelector('span');
    if (span) {
      const spanText = norm(span.innerText || span.textContent || '');
      if (want.has(spanText)) {
        console.log(TAG, '✅ Button found by span text:', spanText);
        return node;
      }
    }
  }
  
  console.warn(TAG, 'Button not found for texts:', texts);
  return null;
}

function highlight(el) { 
  try { 
    const o = el.style.outline; 
    el.style.outline = '3px solid #ff9800'; 
    setTimeout(() => el.style.outline = o, 1200);
  } catch {} 
}

async function findAppNoInput() {
  console.log(TAG, 'Searching for Başvuru Numarası input (MUI specific)...');
  
  // 1) Placeholder ile direkt arama (en güvenilir)
  let el = document.querySelector('input[placeholder="Başvuru numarası"]');
  if (el) { 
    console.log(TAG, '✅ Found by exact placeholder match'); 
    return el; 
  }
  
  // 2) Placeholder case-insensitive arama
  el = document.querySelector('input[placeholder*="başvuru" i][placeholder*="numarası" i]');
  if (el) { 
    console.log(TAG, '✅ Found by placeholder (case-insensitive)'); 
    return el; 
  }
  
  // 3) MUI Label text'i ile arama
  const labels = Array.from(document.querySelectorAll('label.MuiFormLabel-root, label.MuiInputLabel-root'));
  for (const label of labels) {
    const text = (label.textContent || '').trim();
    if (text === 'Başvuru Numarası' || text.toLowerCase().includes('başvuru numarası')) {
      // Label'ın for attribute'ünden ID'yi al
      const inputId = label.getAttribute('for');
      if (inputId) {
        const input = document.getElementById(inputId);
        if (input && input.tagName === 'INPUT') {
          console.log(TAG, '✅ Found by MUI label for attribute, id:', inputId);
          return input;
        }
      }
      
      // Label'ın parent container'ında input ara
      const container = label.closest('.MuiFormControl-root, .MuiTextField-root');
      if (container) {
        const input = container.querySelector('input.MuiInputBase-input, input.MuiOutlinedInput-input');
        if (input) {
          console.log(TAG, '✅ Found input in same MUI container as label');
          return input;
        }
      }
    }
  }
  
  // 4) Class yapısı ile arama (MUI TextField içindeki ilk input)
  const textFields = document.querySelectorAll('.MuiTextField-root');
  for (const field of textFields) {
    const label = field.querySelector('label');
    if (label && (label.textContent || '').includes('Başvuru Numarası')) {
      const input = field.querySelector('input.MuiInputBase-input, input.MuiOutlinedInput-input');
      if (input) {
        console.log(TAG, '✅ Found by traversing MUI TextField structure');
        return input;
      }
    }
  }
  
  // 5) Tüm MUI input'ları tara ve placeholder kontrol et
  const allMuiInputs = Array.from(document.querySelectorAll('input.MuiInputBase-input, input.MuiOutlinedInput-input'));
  for (const inp of allMuiInputs) {
    const ph = (inp.placeholder || '').toLowerCase();
    if (ph.includes('başvuru') && ph.includes('numarası')) {
      console.log(TAG, '✅ Found by scanning all MUI inputs, placeholder:', inp.placeholder);
      return inp;
    }
  }
  
  // 6) Fallback: İlk görünür MUI input
  const firstVisible = allMuiInputs.find(i => i.offsetParent !== null);
  if (firstVisible) {
    console.log(TAG, '⚠️ FALLBACK: Using first visible MUI input');
    return firstVisible;
  }
  
  console.error(TAG, '❌ NO INPUT FOUND');
  console.log(TAG, 'Debug: Available MUI inputs:', allMuiInputs.map(i => ({
    id: i.id,
    placeholder: i.placeholder,
    value: i.value,
    visible: i.offsetParent !== null
  })));
  return null;
}

async function doQuery(appNo) {
  const url = location.href;
  console.log(TAG, 'doQuery started - url:', url, 'appNo:', appNo);
  
  if (!/^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(url)) {
    console.log(TAG, 'Not on /trademark page; skipping automation.');
    return;
  }

  console.log(TAG, 'Waiting for page to stabilize...');
  await sleep(300); // Sayfanın tamamen yüklenmesi için biraz daha uzun bekle

  console.log(TAG, 'Looking for input field...');
  const input = await waitFor(findAppNoInput, { timeout: 10000, interval: 150, label: 'Başvuru Numarası Input' });
  
  if (!input) { 
    console.error(TAG, '❌ Başvuru Numarası input alanı bulunamadı!');
    // Sayfadaki tüm input'ları logla (debug için)
    console.log(TAG, 'Available inputs:', Array.from(document.querySelectorAll('input')).map(i => ({
      id: i.id,
      name: i.name,
      placeholder: i.placeholder,
      type: i.type,
      class: i.className
    })));
    return;
  }
  
  console.log(TAG, '✅ Input found:', input);
  highlight(input);

  console.log(TAG, 'Filling input with value:', appNo);
  fillReactInput(input, String(appNo || '').trim());
  
  // MUI input'un doldurulması için biraz daha bekle
  await sleep(200);
  console.log(TAG, 'Input value after fill:', input.value);

  console.log(TAG, 'Looking for SORGULA button...');
  let btn = await waitFor(() => findButtonByText('SORGULA','Sorgula','sorgula','Ara','Search'), { timeout: 5000, label: 'SORGULA Button' });
  
  if (!btn) {
    console.log(TAG, 'Button not found by text, trying submit buttons...');
    btn = document.querySelector('button[type="submit"]') || document.querySelector('input[type="submit"]');
  }
  
  if (!btn) { 
    console.error(TAG, '❌ SORGULA butonu bulunamadı!');
    // Sayfadaki tüm butonları logla (debug için)
    console.log(TAG, 'Available buttons:', Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.textContent?.trim(),
      type: b.type,
      disabled: b.disabled,
      class: b.className
    })));
    return;
  }
  
  console.log(TAG, '✅ Button found:', btn.textContent || btn.value);
  highlight(btn);

  if (btn.disabled) { 
    console.log(TAG, 'Button is disabled, waiting 500ms...'); 
    await sleep(500); 
  }
  
  try { 
    btn.scrollIntoView({ block: 'center', behavior: 'smooth' }); 
    await sleep(100);
  } catch(e) {
    console.warn(TAG, 'scrollIntoView failed:', e);
  }
  
  console.log(TAG, '🖱️ Clicking SORGULA button...');
  btn.click();
  
  await sleep(500);
  console.log(TAG, '✅ Query submitted successfully!');
}

// Hash-change logger
window.addEventListener('hashchange', () => { 
  console.log(TAG, 'hashchange', location.hash); 
}, false);

// Message from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log(TAG, '📨 onMessage received:', msg, 'from:', sender);
  
  if (msg?.type === 'AUTO_FILL') {
    console.log(TAG, '✅ AUTO_FILL message received, starting query for:', msg.data);
    
    // Async olarak çalıştır ama hemen response dön
    setTimeout(() => {
      doQuery(msg.data).catch(err => {
        console.error(TAG, 'doQuery error:', err);
      });
    }, 100);
    
    sendResponse({ status: 'received' });
    return true; // Async response için gerekli
  }
  
  sendResponse({ status: 'unknown_message_type' });
  return true;
});

// Manual helper - window ve unsafeWindow'a da ekle
const manualFill = (no) => {
  console.log(TAG, '🔧 Manual __evrekaFill called with:', no);
  doQuery(no).catch(err => {
    console.error(TAG, 'Manual fill error:', err);
  });
};

window.__evrekaFill = manualFill;

// Bazı durumlarda window.wrappedJSObject gerekebilir
if (typeof unsafeWindow !== 'undefined') {
  unsafeWindow.__evrekaFill = manualFill;
}

console.log(TAG, '✅ Ready! Manual test: __evrekaFill("2023/12345")');
console.log(TAG, 'Functions available:', {
  __evrekaFill: typeof window.__evrekaFill,
  doQuery: typeof doQuery
});

// Hızlı hash kontrolü - DOM tamamen yüklenmeden önce
if (window.location.hash.includes('#bn=')) {
  console.log(TAG, '⚡ Early hash detection, preparing...');
  const match = window.location.hash.match(/#bn=([^&]+)/);
  if (match && match[1]) {
    const appNo = decodeURIComponent(match[1]);
    // DOM hazır olunca hemen çalıştır
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => doQuery(appNo), 100);
      });
    } else {
      setTimeout(() => doQuery(appNo), 100);
    }
  }
}