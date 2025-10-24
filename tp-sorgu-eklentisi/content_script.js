// [Evreka CS] Wide-match debug content script
const TAG='[Evreka CS]';
console.log(TAG, 'content_script loaded at', location.href);
// ============================================
// HASH'İ HEMEN YAKALA (Modal açılmadan önce!)
// ============================================
(function() {
  const currentHash = window.location.hash;
  if (currentHash && currentHash.includes('#bn=')) {
    const match = currentHash.match(/#bn=([^&]+)/);
    if (match && match[1]) {
      const appNo = decodeURIComponent(match[1]);
      console.log(TAG, '⚡ IMMEDIATE hash capture on load:', appNo);
      
      try {
        sessionStorage.setItem('evreka_pending_query', appNo);
        sessionStorage.setItem('evreka_hash_timestamp', Date.now().toString());
        console.log(TAG, '✅ Saved to sessionStorage immediately');
      } catch(e) {
        console.error(TAG, 'Failed to save to sessionStorage:', e);
      }
    }
  }
})();

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
  
  // Login sayfası kontrolü
  if (/login|auth|giris|e-devlet/i.test(url)) {
    console.log(TAG, '🔐 On login page, waiting for authentication to complete...');
    return; // Login bitene kadar bekle, hash korunacak
  }
  
  if (!/^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(url)) {
    console.log(TAG, 'Not on /trademark page; skipping automation.');
    return;
  }

  console.log(TAG, 'Waiting for page to stabilize...');
  await sleep(300);

  console.log(TAG, 'Looking for input field...');
  const input = await waitFor(findAppNoInput, { timeout: 10000, interval: 150, label: 'Başvuru Numarası Input' });
  
  if (!input) { 
    console.error(TAG, '❌ Başvuru Numarası input alanı bulunamadı!');
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
    btn.scrollIntoView({ block: 'center', behavior: 'instant' }); 
    await sleep(100);
  } catch(e) {
    console.warn(TAG, 'scrollIntoView failed:', e);
  }
  
  console.log(TAG, '🖱️ Clicking SORGULA button...');
  btn.click();
  
  await sleep(500);
  console.log(TAG, '✅ Query submitted successfully!');
}

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
    return true;
  }
  
  sendResponse({ status: 'unknown_message_type' });
  return true;
});


// ========================================
// HASH CHANGE HANDLER (Login sonrası korumalı)
// ========================================

let lastProcessedHash = '';
let hashCheckInterval = null;

function checkHashAndFill() {
  const hash = window.location.hash;
  
  // Aynı hash'i tekrar işleme
  if (hash === lastProcessedHash) {
    return;
  }
  
  console.log(TAG, 'Checking hash:', hash);
  
  // #bn=2025/093581 formatını yakala
  const match = hash.match(/#bn=([^&]+)/);
  if (match && match[1]) {
    const appNo = decodeURIComponent(match[1]);
    console.log(TAG, '📍 Hash contains application number:', appNo);
    
    // sessionStorage'a yedekle (login sonrası kurtarmak için)
    try {
      sessionStorage.setItem('evreka_pending_query', appNo);
      sessionStorage.setItem('evreka_hash_timestamp', Date.now().toString());
      console.log(TAG, '💾 Saved to sessionStorage with timestamp');
    } catch(e) {
      console.warn(TAG, 'sessionStorage save failed:', e);
    }
    
    // Login sayfasında değilsek işle
    if (!/login|auth|giris|e-devlet/i.test(window.location.href)) {
      console.log(TAG, 'Not on login page, auto-filling after 500ms...');
      lastProcessedHash = hash;
      
      setTimeout(() => {
        doQuery(appNo);
        // İşlem tamamlandıktan sonra yedekleri temizle
        try {
          sessionStorage.removeItem('evreka_pending_query');
        } catch(e) {}
      }, 500);
      
      // Hash kontrolünü durdur
      if (hashCheckInterval) {
        clearInterval(hashCheckInterval);
        hashCheckInterval = null;
      }
    } else {
      console.log(TAG, '🔐 On login page, hash will be processed after login');
    }
  }
}

// Sayfa yüklenince sessionStorage'dan kurtarma dene
function tryRestoreFromSessionStorage() {
  const pendingQuery = sessionStorage.getItem('evreka_pending_query');
  const timestamp = sessionStorage.getItem('evreka_hash_timestamp');
  const currentUrl = window.location.href;
  const currentHash = window.location.hash;
  
  if (!pendingQuery) {
    console.log(TAG, 'No pending query in sessionStorage');
    return;
  }
  
  // Zaman aşımı kontrolü (5 dakika)
  const age = Date.now() - parseInt(timestamp || '0');
  if (age > 5 * 60 * 1000) {
    console.log(TAG, 'SessionStorage data too old, cleaning up');
    sessionStorage.removeItem('evreka_pending_query');
    sessionStorage.removeItem('evreka_hash_timestamp');
    return;
  }
  
  console.log(TAG, '📦 Found pending query in sessionStorage:', pendingQuery, 'age:', Math.round(age/1000), 'seconds');
  
  // Trademark sayfasındayız VE hash yoksa
  if (/^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(currentUrl)) {
    if (!currentHash || !currentHash.includes('bn=')) {
      console.log(TAG, '🔄 Restoring hash from sessionStorage');
      
      // Hash'i ekle
      window.location.hash = `#bn=${encodeURIComponent(pendingQuery)}`;
      
      // Hash eklendikten sonra sorguyu çalıştır
      setTimeout(() => {
        console.log(TAG, '✅ Hash restored, triggering query...');
        doQuery(pendingQuery);
        // Başarılı olduktan sonra temizle
        setTimeout(() => {
          sessionStorage.removeItem('evreka_pending_query');
          sessionStorage.removeItem('evreka_hash_timestamp');
        }, 2000);
      }, 800);
    } else {
      console.log(TAG, 'Hash already present, cleaning sessionStorage');
      sessionStorage.removeItem('evreka_pending_query');
      sessionStorage.removeItem('evreka_hash_timestamp');
    }
  }
}

// Hemen dene
tryRestoreFromSessionStorage();

// Sayfa yüklendiğinde kontrol et
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkHashAndFill);
} else {
  setTimeout(checkHashAndFill, 100);
}

// Hash değiştiğinde kontrol et
window.addEventListener('hashchange', () => {
  console.log(TAG, 'Hash changed event triggered');
  checkHashAndFill();
}, false);

// Periyodik kontrol (login sonrası hash kaybolursa)
hashCheckInterval = setInterval(() => {
  const hash = window.location.hash;
  if (hash && hash !== lastProcessedHash && hash.includes('#bn=')) {
    console.log(TAG, 'Periodic check found hash:', hash);
    checkHashAndFill();
  }
}, 1000);

// 30 saniye sonra periyodik kontrolü durdur
setTimeout(() => {
  if (hashCheckInterval) {
    clearInterval(hashCheckInterval);
    console.log(TAG, 'Stopped periodic hash checking after 30s');
  }
}, 30000);

console.log(TAG, '🔄 Hash monitoring active');

// ========================================
// URL MONITORING: Trademark sayfasına dönünce otomatik tetikle
// ========================================

let lastProcessedUrl = '';
let urlCheckInterval = null;

function checkUrlAndTrigger() {
  const currentUrl = window.location.href;
  
  // Aynı URL'i tekrar işleme
  if (currentUrl === lastProcessedUrl) {
    return;
  }
  
  console.log(TAG, '🔍 URL changed to:', currentUrl);
  
  // Trademark sayfasına döndük mü?
  if (/^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(currentUrl)) {
    console.log(TAG, '✅ Trademark page detected');
    lastProcessedUrl = currentUrl;
    
    // Hash var mı kontrol et
    const currentHash = window.location.hash;
    const hashMatch = currentHash.match(/#bn=([^&]+)/);
    
    if (hashMatch && hashMatch[1]) {
      const appNo = decodeURIComponent(hashMatch[1]);
      console.log(TAG, '📍 Hash found in URL:', appNo);
      
      // Direkt sorguyu tetikle
      setTimeout(() => {
        console.log(TAG, '🚀 Auto-triggering query from URL monitoring');
        doQuery(appNo);
      }, 1500);
      
      return;
    }
    
    // Hash yok ama sessionStorage'da var mı?
    const pendingQuery = sessionStorage.getItem('evreka_pending_query');
    if (pendingQuery) {
      console.log(TAG, '📦 No hash but found in sessionStorage:', pendingQuery);
      
      // Hash'i ekle
      window.location.hash = `#bn=${encodeURIComponent(pendingQuery)}`;
      
      setTimeout(() => {
        console.log(TAG, '🚀 Auto-triggering query after hash restore');
        doQuery(pendingQuery);
        sessionStorage.removeItem('evreka_pending_query');
        sessionStorage.removeItem('evreka_hash_timestamp');
      }, 1500);
      
      return;
    }
    
    console.log(TAG, '⚠️ Trademark page but no hash or sessionStorage data');
    console.log(TAG, '🔍 Asking background for stored query...');
    
    // Background'a sor
    chrome.runtime.sendMessage({ type: 'GET_PENDING_QUERY' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn(TAG, 'Failed to get query from background:', chrome.runtime.lastError.message);
        return;
      }
      
      if (response && response.query) {
        console.log(TAG, '💾 Background provided query:', response.query);
        
        // Hash'i ekle
        window.location.hash = `#bn=${encodeURIComponent(response.query)}`;
        
        // Sorguyu çalıştır
        setTimeout(() => {
          console.log(TAG, '🚀 Auto-triggering query from background storage');
          doQuery(response.query);
        }, 1500);
      } else {
        console.log(TAG, '❌ Background has no query for this tab');
      }
    });
  }
}

// URL değişikliklerini izle (her 500ms)
urlCheckInterval = setInterval(() => {
  checkUrlAndTrigger();
}, 500);

// İlk kontrolü hemen yap
setTimeout(checkUrlAndTrigger, 300);

// 2 dakika sonra interval'i durdur (gereksiz CPU kullanımı için)
setTimeout(() => {
  if (urlCheckInterval) {
    clearInterval(urlCheckInterval);
    console.log(TAG, '⏹️ URL monitoring stopped after 2 minutes');
  }
}, 120000);

console.log(TAG, '👀 URL monitoring active');