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
  while (Date.now() - t0 < timeout) {
    const disabledAttr = btn.hasAttribute('disabled');
    const hasMuiDisabled = (btn.className || '').includes('Mui-disabled');
    if (!disabledAttr && !hasMuiDisabled) return true;
    await sleep(100);
  }
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

  // 0) Önce "Başvuru Numarası" sekmesini aktif et (butonlardan biri)
  try {
    const basvuruTab = findButtonByTextCI("Başvuru Numarası") || findClickableByText("Başvuru Numarası");
    if (basvuruTab) { basvuruTab.click(); await sleep(150); }
  } catch {}

  // 1) Input’u BUL — EN GÜVENİLİR YÖNTEM: Label'dan ID al ve Input'u bul
  let input = null;
  const targetLabelText = "Başvuru Numarası";
  
  // Önce label ID'sini bulmayı dene
  let reliableInputId = findInputIdByLabel(targetLabelText); 

  if (reliableInputId) {
      // Bulunan ID ile input'u DOM'da bekle ve bul
      input = await waitFor(() => document.getElementById(reliableInputId));
  }

  // Eğer label üzerinden bulunamazsa, eski fallback yöntemleri dene
  if (!input) {
    input = document.querySelector('input[placeholder*="başvuru" i]') 
      || findInputByPlaceholder("Başvuru") 
      || qs('input[type="text"]');
  }

  // Hala bulunamazsa, daha uzun bekleme süresiyle tekrar dene
  if (!input) {
    input = await waitFor(() => {
      // Bu tekrar denemede de ID'yi almayı dene
      reliableInputId = findInputIdByLabel(targetLabelText); 
      return reliableInputId 
          ? document.getElementById(reliableInputId) 
          : document.querySelector('input[placeholder*="başvuru" i]') || findInputByPlaceholder("Başvuru");
    });
  }

  if (!input) return false;

  // 2) Değeri React/MUI uyumlu yaz + blur/validation tetikle
  // Bu işlem, sorgula butonunun "disabled" durumdan çıkmasını sağlar.
  const current = (input.value || '').trim();
  if (current !== bn) {
    input.focus();
    setReactInputValue(input, '');
    await sleep(60);
    setReactInputValue(input, bn);
    await sleep(120);
    input.blur();               // MUI doğrulama
    await sleep(150);
  }

  // 3) "Sorgula" butonunu bul
  let btn =
    findButtonByTextCI("Sorgula") ||
    findClickableByText("Sorgula") ||
    qs('button[aria-label*="sorgula" i]') ||
    // Sayfadaki buton kümesi için extra fallback:
    document.querySelector('button.MuiButton-contained') || 
    qs('button[type="submit"]') ||
    qs('button[type="button"]');

  if (!btn) {
    btn = await waitFor(() =>
      findButtonByTextCI("Sorgula")
      || document.querySelector('button.MuiButton-contained')
      || qs('button[type="submit"]')
      || qs('button[type="button"]')
    );
  }

  if (!btn) {
    // Son çare: Enter ile submit et
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup',   {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    return true;
  }

  // 4) Butonun enable olmasını bekle (Mui-disabled kalkmalı) ve tıkla; enable olmazsa Enter dene
  const ready = await waitForEnabled(btn, 4000);
  if (!ready) {
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup',   {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
    return true;
  }

  await sleep(120);
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
  await sleep(150);
  runAutomation();
})();