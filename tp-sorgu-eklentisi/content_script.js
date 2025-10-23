// TP - Marka Dosya Sorgu (content script) — opts.turkpatent.gov.tr için
// v2.0 - Daha güvenilir ve debug friendly

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('[TP Eklenti] Content script yüklendi');
console.log('[TP Eklenti] URL:', window.location.href);
console.log('[TP Eklenti] Zaman:', new Date().toLocaleTimeString());

// React kontrollü inputlara güvenli değer yaz
function setReactInputValue(input, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  
  // React event'lerini tetikle
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// Elementin DOM'da görünmesini bekle
async function waitFor(selectorOrFn, timeout = 12000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      const el = typeof selectorOrFn === 'function' 
        ? selectorOrFn() 
        : document.querySelector(selectorOrFn);
      
      if (el) return el;
    } catch (e) {
      console.warn('[TP Eklenti] waitFor hata:', e);
    }
    
    await sleep(250);
  }
  
  throw new Error(`Timeout: ${selectorOrFn}`);
}

// MUI buton enable olmasını bekle
async function waitForEnabled(btn, timeout = 12000) {
  const t0 = Date.now();
  let attempts = 0;
  
  while (Date.now() - t0 < timeout) {
    const disabledAttr = btn.hasAttribute('disabled');
    const hasMuiDisabled = (btn.className || '').includes('Mui-disabled');
    
    if (!disabledAttr && !hasMuiDisabled) {
      console.log('[TP Eklenti] ✓ Buton enable oldu');
      return true;
    }
    
    if (attempts % 5 === 0) {
      const elapsed = Math.floor((Date.now() - t0) / 1000);
      console.log(`[TP Eklenti] ⏳ Buton disabled... (${elapsed}s)`);
    }
    
    attempts++;
    await sleep(300);
  }
  
  console.log('[TP Eklenti] ✗ Buton timeout');
  return false;
}

// URL hash'inden bn al
function getBNFromHash() {
  try {
    const raw = (location.hash || "").replace(/^#/, "");
    const m = raw.match(/(?:^|[&#;])bn=([^&#;]+)/i);
    return m ? decodeURIComponent(m[1]) : "";
  } catch { 
    return ""; 
  }
}

// Başvuru numarasını doldur ve sorgula - ANA FONKSİYON
async function fillAndSearch(bn) {
  if (!bn) {
    console.error('[TP Eklenti] ✗ Başvuru numarası boş!');
    return false;
  }
  
  console.log('[TP Eklenti] ========================================');
  console.log('[TP Eklenti] İŞLEM BAŞLIYOR');
  console.log('[TP Eklenti] Başvuru No:', bn);
  console.log('[TP Eklenti] ========================================');

  try {
    // 1) Sayfa yüklensin diye bekle
    console.log('[TP Eklenti] 1️⃣ Sayfa yükleme bekleniyor...');
    await sleep(2000);
    
    // 2) Input alanını bul
    console.log('[TP Eklenti] 2️⃣ Input alanı aranıyor...');
    
    let input = null;
    
    try {
      input = await waitFor(() => {
        // Yöntem 1: Placeholder
        let inp = document.querySelector('input[placeholder="Başvuru numarası"]');
        if (inp) return inp;
        
        // Yöntem 2: Placeholder (case insensitive)
        inp = document.querySelector('input[placeholder*="başvuru" i]');
        if (inp) return inp;
        
        // Yöntem 3: MUI input class + placeholder kontrolü
        const muiInputs = document.querySelectorAll('input.MuiInputBase-input');
        for (const i of muiInputs) {
          const ph = (i.getAttribute('placeholder') || '').toLowerCase();
          if (ph.includes('başvuru')) {
            return i;
          }
        }
        
        return null;
      }, 10000);
    } catch (e) {
      console.error('[TP Eklenti] ✗ Input bulma timeout:', e);
      return false;
    }

    if (!input) {
      console.error('[TP Eklenti] ✗ Input bulunamadı!');
      return false;
    }

    console.log('[TP Eklenti] ✓ Input bulundu');

    // 3) Değeri yaz
    console.log('[TP Eklenti] 3️⃣ Değer yazılıyor...');
    
    input.focus();
    await sleep(200);
    
    setReactInputValue(input, '');
    await sleep(150);
    
    setReactInputValue(input, bn);
    console.log('[TP Eklenti] ✓ Değer yazıldı:', input.value);
    await sleep(300);
    
    // Validation için blur
    input.blur();
    await sleep(500);
    
    console.log('[TP Eklenti] ✓ Input değeri:', input.value);

    // 4) Sorgula butonunu bul
    console.log('[TP Eklenti] 4️⃣ Sorgula butonu aranıyor...');
    
    let btn = null;
    
    try {
      btn = await waitFor(() => {
        // MUI contained primary button + "Sorgula" içeriği
        const buttons = document.querySelectorAll('button.MuiButton-contained');
        for (const b of buttons) {
          const text = (b.textContent || '').trim();
          if (text.includes('Sorgula')) {
            return b;
          }
        }
        return null;
      }, 8000);
    } catch (e) {
      console.error('[TP Eklenti] ✗ Buton bulma timeout:', e);
      
      // Enter ile dene
      console.log('[TP Eklenti] 💡 Enter tuşu gönderiliyor...');
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
      return true;
    }

    if (!btn) {
      console.error('[TP Eklenti] ✗ Buton bulunamadı!');
      return false;
    }

    console.log('[TP Eklenti] ✓ Buton bulundu');

    // 5) Butonun enable olmasını bekle
    console.log('[TP Eklenti] 5️⃣ Butonun enable olması bekleniyor...');
    
    const ready = await waitForEnabled(btn, 12000);
    
    if (!ready) {
      console.log('[TP Eklenti] 💡 Buton enable olmadı, Enter deneniyor...');
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
      return true;
    }

    // 6) Butona tıkla
    console.log('[TP Eklenti] 6️⃣ Butona tıklanıyor...');
    await sleep(300);
    
    btn.click();
    
    console.log('[TP Eklenti] ========================================');
    console.log('[TP Eklenti] ✓✓✓ İŞLEM TAMAMLANDI ✓✓✓');
    console.log('[TP Eklenti] ========================================');
    
    return true;
    
  } catch (error) {
    console.error('[TP Eklenti] ✗✗✗ HATA:', error);
    return false;
  }
}

// Ana otomasyon fonksiyonu
async function runAutomation() {
  console.log('[TP Eklenti] 🚀 Otomasyon başladı');
  
  const url = new URL(location.href);
  console.log('[TP Eklenti] Domain:', url.hostname);
  console.log('[TP Eklenti] Path:', url.pathname);

  // Hash'ten bn al
  const bn = getBNFromHash();
  
  if (!bn) {
    console.log('[TP Eklenti] ⚠️ Hash\'te başvuru numarası yok');
    return;
  }

  console.log('[TP Eklenti] ✓ Hash\'ten alındı:', bn);

  // opts.turkpatent.gov.tr/trademark sayfasındayız
  if (url.hostname === "opts.turkpatent.gov.tr" && url.pathname === "/trademark") {
    await fillAndSearch(bn);
  } else {
    console.log('[TP Eklenti] ⚠️ Beklenmeyen sayfa');
  }
}

// Sayfa yüklendiğinde otomatik çalıştır
(async () => {
  console.log('[TP Eklenti] ⏳ Başlangıç bekleme... (2 saniye)');
  await sleep(2000);
  runAutomation();
})();