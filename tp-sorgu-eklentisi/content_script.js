// TP - Marka Dosya Sorgu (content script) — minimum izin

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qs = (sel, root = document) => root.querySelector(sel);

function findClickableByText(text) {
  const xp = `//button[contains(normalize-space(.), "${text}")]
              | //a[contains(normalize-space(.), "${text}")]
              | //div[@role="button" and contains(normalize-space(.), "${text}")]`;
  return document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
}

function findInputByPlaceholder(ph) {
  const xp = `//input[@placeholder and contains(normalize-space(@placeholder), "${ph}")]`;
  return document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
}

// YENİ YARDIMCI FONKSİYON: Label metninden input'un for ID'sini bulur.
function findInputIdByLabel(labelText) {
  // Label'ı metnine göre bul ve 'for' attribute değerini döndür
  const xp = `//label[contains(normalize-space(.), "${labelText}")]`;
  const label = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  return label ? label.getAttribute('for') : null;
}

// React kontrollü inputlara güvenli değer yaz
function setReactInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// Metne göre buton bul (case-insensitive)
function findButtonByTextCI(text) {
  const xp = `//button[descendant-or-self::*[contains(translate(normalize-space(.),
              'abcdefghijklmnopqrstuvwxyzçğıöşü',
              'ABCDEFGHIJKLMNOPQRSTUVWXYZÇĞİÖŞÜ'), "${text.toUpperCase()}")]]`;
  return document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
}

// MUI buton gerçekten enable oldu mu?
async function waitForEnabled(btn, timeout = 4000) {
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
      console.log(`[TP Eklenti] Buton henüz disabled, bekleniyor... (${elapsed}s/${Math.floor(timeout/1000)}s)`);
    }
    
    attempts++;
    await sleep(200);
  }
  
  console.log('[TP Eklenti] Buton timeout ✗ (enable olmadı)');
  return false;
}

function getBNFromHash() {
  try {
    const raw = (location.hash || "").replace(/^#/, "");
    const m = raw.match(/(?:^|[&#;])bn=([^&#;]+)/i);
    return m ? decodeURIComponent(m[1]) : "";
  } catch { return ""; }
}

function setWindowNameBN(bn) {
  try { window.name = JSON.stringify({ bn }); }
  catch { try { window.name = bn; } catch(_){} }
}

function getWindowNameBN() {
  try {
    if (!window.name) return "";
    try { const o = JSON.parse(window.name); return o && o.bn ? String(o.bn) : String(window.name); }
    catch { return String(window.name); }
  } catch { return ""; }
}

async function waitFor(getter, timeout = 12000, step = 200) {
  const st = Date.now();
  while (Date.now() - st < timeout) {
    const el = await getter();
    if (el) return el;
    await sleep(step);
  }
  return null;
}

async function fillAndSearch(bn) {
  if (!bn) return false;
  
  console.log('[TP Eklenti] Başvuru numarası dolduruluyor:', bn);

  // 1) Başvuru Numarası input alanını bul
  let input = null;
  
  // Önce placeholder ile dene (en güvenilir)
  input = document.querySelector('input[placeholder="Başvuru numarası"]');
  
  // Bulunamazsa label'a göre ara
  if (!input) {
    const label = Array.from(document.querySelectorAll('label')).find(
      l => l.textContent.trim() === 'Başvuru Numarası'
    );
    if (label) {
      const inputId = label.getAttribute('for');
      if (inputId) {
        input = document.getElementById(inputId);
      }
    }
  }
  
  // Hala bulunamadıysa class kombinasyonu ile ara
  if (!input) {
    const inputs = document.querySelectorAll('input.MuiInputBase-input.MuiOutlinedInput-input');
    for (const inp of inputs) {
      const placeholder = (inp.getAttribute('placeholder') || '').toLowerCase();
      if (placeholder.includes('başvuru')) {
        input = inp;
        break;
      }
    }
  }

  // Hala bulunamadıysa bekle
  if (!input) {
    console.log('[TP Eklenti] Input bulunamadı, bekleniyor...');
    try {
      input = await waitFor(() => {
        return document.querySelector('input[placeholder="Başvuru numarası"]')
          || document.querySelector('input[placeholder*="başvuru" i]');
      }, 8000);
    } catch (e) {
      console.error('[TP Eklenti] Input bulma timeout:', e);
    }
  }

  if (!input) {
    console.error('[TP Eklenti] Başvuru numarası input alanı bulunamadı!');
    return false;
  }

  console.log('[TP Eklenti] Input bulundu');

  // 2) Input değerini React uyumlu şekilde yaz
  input.focus();
  await sleep(150);
  
  // Önce temizle
  setReactInputValue(input, '');
  await sleep(100);
  
  // Değeri yaz
  setReactInputValue(input, bn);
  console.log('[TP Eklenti] Değer yazıldı:', bn);
  await sleep(250);
  
  // MUI validation için blur
  input.blur();
  await sleep(300);

  // 3) Sorgula butonunu bul
  let btn = null;
  
  // MUI contained primary button + "Sorgula" metni ile bul
  const buttons = document.querySelectorAll('button.MuiButton-contained.MuiButton-containedPrimary');
  for (const b of buttons) {
    const text = (b.textContent || '').trim();
    if (text === 'Sorgula' || text.includes('Sorgula')) {
      btn = b;
      break;
    }
  }
  
  // Bulunamadıysa genel aramaya geç
  if (!btn) {
    btn = findButtonByTextCI("Sorgula") || findClickableByText("Sorgula");
  }
  
  // Hala bulunamadıysa bekle
  if (!btn) {
    console.log('[TP Eklenti] Buton bulunamadı, bekleniyor...');
    try {
      btn = await waitFor(() => {
        const btns = document.querySelectorAll('button.MuiButton-contained');
        for (const b of btns) {
          const text = (b.textContent || '').trim();
          if (text === 'Sorgula' || text.includes('Sorgula')) {
            return b;
          }
        }
        return null;
      }, 5000);
    } catch (e) {
      console.error('[TP Eklenti] Buton bulma timeout:', e);
    }
  }

  if (!btn) {
    console.log('[TP Eklenti] Buton bulunamadı, Enter gönderiliyor...');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    return true;
  }

  console.log('[TP Eklenti] Buton bulundu');

  // 4) Butonun Mui-disabled class'ının kalkmasını bekle
  const ready = await waitForEnabled(btn, 8000);
  
  if (!ready) {
    console.log('[TP Eklenti] Buton enable olmadı, Enter gönderiliyor...');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    return true;
  }

  await sleep(250);
  console.log('[TP Eklenti] Sorgula butonuna tıklanıyor...');
  btn.click();
  
  return true;
}

async function runAutomation() {
  const url = new URL(location.href);

  // Eski domain görülürse yeni uygulamaya geç
  if (url.hostname === "www.turkpatent.gov.tr") {
    location.href = "https://opts.turkpatent.gov.tr/trademark";
    return;
  }

  // Hash'teki bn'i window.name'e koy (redirectlerde korunur)
  const bnFromHash = getBNFromHash();
  if (bnFromHash) setWindowNameBN(bnFromHash);

  const bn = bnFromHash || getWindowNameBN();
  if (!bn) return; // dış tetik yoksa dur

  // /login: "e-Devlet ile Giriş Yap" tıkla (kullanıcı şifresini girer)
  if (url.hostname === "opts.turkpatent.gov.tr" && url.pathname.startsWith("/login")) {
    const btn = await waitFor(() => findClickableByText("e-Devlet ile Giriş Yap"));
    if (btn) btn.click();
    return;
  }

  // /home: bn hash'iyle /trademark'a geç
  if (url.hostname === "opts.turkpatent.gov.tr" && url.pathname === "/home") {
    location.href = "https://opts.turkpatent.gov.tr/trademark#bn=" + encodeURIComponent(bn);
    return;
  }

  // /trademark (veya marka-dosya-takibi): doldur & sorgula
  const isTrademark =
    url.hostname === "opts.turkpatent.gov.tr" &&
    (url.pathname === "/trademark" || url.pathname.includes("marka-dosya-takibi"));

  if (isTrademark) {
    const ok = await fillAndSearch(bn);
    if (!ok) {
      // DOM geç yüklenirse tekrar dene
      const mo = new MutationObserver(async () => {
        const done = await fillAndSearch(bn);
        if (done) mo.disconnect();
      });
      mo.observe(document.documentElement, { subtree: true, childList: true });
    }
  }
}

// İlk yüklemede çalıştır (her eşleşen sayfada otomatik enjekte edilir)
(async () => {
  console.log('[TP Eklenti] Content script yüklendi');
  await sleep(1000); // Sayfa ve React bileşenlerinin tam yüklenmesi için bekle
  console.log('[TP Eklenti] Otomasyon başlatılıyor...');
  runAutomation();
})();