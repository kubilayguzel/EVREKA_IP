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

  let input =
    findInputByPlaceholder("Başvuru Numarası") ||
    qs('input[placeholder*="Başvuru"]') ||
    qs('input[type="text"]');

  if (!input) input = await waitFor(() => findInputByPlaceholder("Başvuru Numarası"));
  if (!input) return false;

  if (input.value !== bn) {
    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(50);
    input.value = bn;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  let btn =
    findClickableByText("SORGULA") ||
    findClickableByText("Sorgula") ||
    qs('button[type="submit"]');

  if (!btn) btn = await waitFor(() => findClickableByText("Sorgula"));
  if (btn) { await sleep(150); btn.click(); return true; }
  return false;
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
