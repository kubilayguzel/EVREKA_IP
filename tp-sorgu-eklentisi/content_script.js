// TP - Marka Dosya Sorgu (content script) — opts.turkpatent.gov.tr için

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qs = (sel, root = document) => root.querySelector(sel);

console.log('[TP Eklenti] Content script yüklendi. URL:', window.location.href);

// React kontrollü inputlara güvenli değer yaz
function setReactInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// Metne göre buton bul
function findButtonByText(text) {
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    if ((btn.textContent || '').trim().includes(text)) {
      return btn;
    }
  }
  return null;
}

// Elementin DOM'da görünmesini bekle
async function waitFor(selector, timeout = 10000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const el = typeof selector === 'function' ? selector() : document.querySelector(selector);
    if (el) return el;
    await sleep(200);
  }
  
  throw new Error(`Timeout: ${selector}`);
}

// MUI buton enable olmasını bekle
async function waitForEnabled(btn, timeout = 10000) {
  const t0 = Date.now();
  let attempts = 0;
  
  while (Date.now() - t0 < timeout) {
    const disabledAttr = btn.hasAttribute('disabled');
    const hasMuiDisabled = (btn.className || '').includes('Mui-disabled');
    
    if (!disabledAttr && !hasMuiDisabled) {
      console.log('[TP Eklenti] Buton enable oldu ✓');
      return true;
    }
    
    if (attempts % 10 === 0) {
      const elapsed = Math.floor((Date.now() - t0) / 1000);
      console.log(`[TP Eklenti] Buton disabled, bekleniyor... (${elapsed}s)`);
    }
    
    attempts++;
    await sleep(200);
  }
  
  console.log('[TP Eklenti] Buton timeout (enable olmadı)');
  return false;
}

// URL hash'inden bn al
function getBNFromHash() {
  try {
    const raw = (location.hash || "").replace(/^#/, "");
    const m = raw.match(/(?:^|[&#;])bn=([^&#;]+)/i);
    return m ? decodeURIComponent(m[1]) : "";
  } catch { return ""; }
}

// Başvuru numarasını doldur ve sorgula
async function fillAndSearch(bn) {
  if (!bn) {
    console.error('[TP Eklenti] Başvuru numarası boş!');
    return false;
  }
  
  console.log('[TP Eklenti] Başvuru numarası dolduruluyor:', bn);

  // 1) Input alanını bul
  let input = null;
  
  try {
    // Önce bekle ki sayfa tam yüklensin
    await sleep(1500);
    
    console.log('[TP Eklenti] Input aranıyor...');
    
    // Placeholder ile bul
    input = await waitFor(() => {
      return document.querySelector('input[placeholder="Başvuru numarası"]')
        || document.querySelector('input[placeholder*="başvuru" i]');
    }, 8000);
    
  } catch (e) {
    console.error('[TP Eklenti] Input bulma hatası:', e);
    return false;
  }

  if (!input) {
    console.error('[TP Eklenti] Input bulunamadı!');
    return false;
  }

  console.log('[TP Eklenti] Input bulundu ✓');

  // 2) Değeri yaz
  try {
    input.focus();
    await sleep(200);
    
    setReactInputValue(input, '');
    await sleep(150);
    
    setReactInputValue(input, bn);
    console.log('[TP Eklenti] Değer yazıldı:', bn);
    await sleep(300);
    
    input.blur();
    await sleep(400);
    
  } catch (e) {
    console.error('[TP Eklenti] Değer yazma hatası:', e);
    return false;
  }

  // 3) Sorgula butonunu bul
  let btn = null;
  
  try {
    console.log('[TP Eklenti] Buton aranıyor...');
    
    btn = await waitFor(() => {
      // MUI contained primary button + "Sorgula" içeriği
      const buttons = document.querySelectorAll('button.MuiButton-contained.MuiButton-containedPrimary');
      for (const b of buttons) {
        const text = (b.textContent || '').trim();
        if (text === 'Sorgula' || text.includes('Sorgula')) {
          return b;
        }
      }
      
      // Alternatif: herhangi bir button içinde "Sorgula" ara
      return findButtonByText('Sorgula');
    }, 5000);
    
  } catch (e) {
    console.error('[TP Eklenti] Buton bulma hatası:', e);
    
    // Enter ile dene
    console.log('[TP Eklenti] Enter gönderiliyor...');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    return true;
  }

  if (!btn) {
    console.error('[TP Eklenti] Buton bulunamadı!');
    return false;
  }

  console.log('[TP Eklenti] Buton bulundu ✓');

  // 4) Butonun enable olmasını bekle
  const ready = await waitForEnabled(btn, 10000);
  
  if (!ready) {
    console.log('[TP Eklenti] Buton enable olmadı, Enter deneniyor...');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    return true;
  }

  await sleep(300);
  console.log('[TP Eklenti] Sorgula butonuna tıklanıyor...');
  btn.click();
  
  console.log('[TP Eklenti] İşlem tamamlandı ✓');
  return true;
}

// Ana otomasyon fonksiyonu
async function runAutomation() {
  const url = new URL(location.href);
  console.log('[TP Eklenti] Otomasyon başladı. URL:', url.href);

  // Hash'ten bn al
  const bn = getBNFromHash();
  
  if (!bn) {
    console.log('[TP Eklenti] Hash\'te bn yok, bekleniyor...');
    return;
  }

  console.log('[TP Eklenti] Hash\'ten bn alındı:', bn);

  // opts.turkpatent.gov.tr/trademark sayfasındayız, direkt doldur
  if (url.hostname === "opts.turkpatent.gov.tr" && url.pathname === "/trademark") {
    await fillAndSearch(bn);
  } else {
    console.log('[TP Eklenti] Beklenmeyen sayfa:', url.href);
  }
}

// Background'dan gelen mesajı dinle
chrome.runtime?.onMessage?.addListener((request, sender, sendResponse) => {
  console.log('[TP Eklenti] Mesaj alındı:', request);
  
  if (request?.type === 'AUTO_FILL_FROM_BACKGROUND' && request?.data) {
    const bn = request.data;
    console.log('[TP Eklenti] Background\'dan bn alındı:', bn);
    
    fillAndSearch(bn).then(success => {
      sendResponse({ status: success ? 'OK' : 'FAILED' });
    }).catch(err => {
      console.error('[TP Eklenti] Hata:', err);
      sendResponse({ status: 'ERROR', error: err.message });
    });
    
    return true; // async response
  }
});

// Sayfa yüklendiğinde otomatik çalıştır
(async () => {
  console.log('[TP Eklenti] Başlangıç bekleme...');
  await sleep(1500);
  runAutomation();
})();