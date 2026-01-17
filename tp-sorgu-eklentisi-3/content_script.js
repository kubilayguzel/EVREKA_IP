// content_script.js
(() => {
  const TAG = "[TP-AUTO]";
  let isActionInProgress = false; // Aynı anda birden fazla işlemin çalışmasını engeller
  if (window.top !== window) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- RESET: page console'dan tetiklemek için ----------
  // Sayfa console'undan çalıştır:
  // document.dispatchEvent(new CustomEvent("TP_RESET"))
  document.addEventListener("TP_RESET", async () => {
    try {
      await chrome.storage.local.clear();
      console.log(TAG, "RESET OK (storage cleared).");
    } catch (e) {
      console.log(TAG, "RESET FAILED:", e);
    }
  });

  // ---------- DOC HELPERS (ALL FRAMES) ----------
  function getAllDocs() {
    const docs = [document];
    const frames = Array.from(document.querySelectorAll("iframe"));
    for (const fr of frames) {
      try {
        const d = fr.contentDocument;
        if (d) docs.push(d);
      } catch {}
    }
    return docs;
  }

  function qAll(selector) {
    for (const d of getAllDocs()) {
      const el = d.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function qAllMany(selector) {
    let out = [];
    for (const d of getAllDocs()) out = out.concat(Array.from(d.querySelectorAll(selector)));
    return out;
  }

  // ---------- CLICK / INPUT ----------
  function superClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch {}
    try {
      const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) =>
        el.dispatchEvent(new MouseEvent(t, opts))
      );
      console.log(TAG, "Clicked:", (el.textContent || "").trim());
      return true;
    } catch {
      try { el.click(); return true; } catch {}
    }
    return false;
  }

  function getTreeToggleClickable() {
  const host = qAll("div.ui-grid-tree-base-row-header-buttons");
  if (!host) return null;

  // Filtre sonrası handler bazen iç elemanda oluyor
  return (
    host.querySelector("button") ||
    host.querySelector("[role='button']") ||
    host.querySelector("a") ||
    host.querySelector("i") ||
    host
  );
}

function readPlusMinusState() {
  const host = qAll("div.ui-grid-tree-base-row-header-buttons");
  if (!host) return "none";
  const icon = host.querySelector("i");
  const cls = (icon?.className || host.className || "").toLowerCase();

  const plus  = cls.includes("plus")  || cls.includes("fa-plus")  || cls.includes("ui-grid-icon-plus");
  const minus = cls.includes("minus") || cls.includes("fa-minus") || cls.includes("ui-grid-icon-minus");

  if (plus && !minus) return "plus";
  if (minus && !plus) return "minus";
  return "unknown";
}


  function fillInputAngularSafe(input, value) {
    if (!input) return false;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
    return true;
  }

  async function throttle(key, ms) {
    const now = Date.now();
    const obj = await chrome.storage.local.get([key]);
    const last = obj[key] || 0;
    if (now - last < ms) return false;
    await chrome.storage.local.set({ [key]: now });
    return true;
  }

  // =======================
  //  ARA BUTONU FIX (YENİ)
  // =======================
  // ng-click ifadesini Angular scope içinde $eval ile çalıştırır
  function runNgClickExpression(el) {
    try {
      const doc = el.ownerDocument || document;
      const win = doc.defaultView || window;
      const angular = win.angular;
      if (!angular?.element) return false;

      const expr = el.getAttribute("ng-click");
      if (!expr) return false;

      let scope = angular.element(el).scope?.() || angular.element(el).isolateScope?.();
      // Parent scope zinciri boyunca $eval ara
      for (let i = 0; i < 20 && scope; i++) {
        if (typeof scope.$eval === "function") {
          scope.$apply(() => scope.$eval(expr));
          return true;
        }
        scope = scope.$parent;
      }
      return false;
    } catch (e) {
      console.log(TAG, "runNgClickExpression error:", e);
      return false;
    }
  }

// Ara butonunu tetiklemek için geliştirilmiş fonksiyon
async function clickAraButtonOnly() {
  const { tp_clicked_ara } = await chrome.storage.local.get(["tp_clicked_ara"]);
  if (tp_clicked_ara) return true; // Zaten basıldıysa tekrar basma

  const root = qAll("#button549");
  if (!root) {
    console.log(TAG, "Ara root (#button549) bulunamadı.");
    return false;
  }

  const btn = root.querySelector("div.btn[ng-click]") || root.querySelector(".btn");
  if (!btn) return false;

  const isDisabled = btn.hasAttribute("disabled") || btn.classList.contains("disabled");
  if (isDisabled) {
    console.log(TAG, "Ara butonu henüz aktif değil (disabled), bekleniyor...");
    return false;
  }

  // (İstersen buraya bir throttle da ekleyebilirsin)
  console.log(TAG, "Ara butonuna basılıyor...");
  superClick(btn);

  await chrome.storage.local.set({ tp_clicked_ara: true });
  return true;
}


  // ---------- PAGE STATE ----------
  function isGirisPage() {
    return location.href.includes("/run/TP/EDEVLET/giris");
  }

  // Çok önemli: yanlış “true” vermesin diye SADECE form elemanlarıyla anla
  function isBelgelerimScreenOpen() {
    return (
      !!qAll("div.ui-select-container[name='selectbox550']") ||
      !!qAll("#textbox551 input") ||
      !!qAll("#button549") // ara butonu wrapperı gelince de bu ekran açık say
    );
  }

  function isGridLoaded() {
    return !!qAll(".ui-grid-row") || !!qAll(".ui-grid-canvas") || !!qAll("i.fa-download");
  }

  // ---------- STEP 1: LOGIN ----------
  function findLoginButtonOnGiris() {
    const direct = qAll('a[href*="turkiye.gov.tr"]');
    if (direct) return direct;

    const cand = qAllMany("a,button,div").find((el) => {
      const t = (el.textContent || "").trim().toLowerCase();
      const href = (el.getAttribute && el.getAttribute("href")) || "";
      return href.includes("turkiye.gov.tr") || t === "giriş" || t.includes("e-devlet");
    });
    return cand || null;
  }

  // ---------- STEP 2: BELGELERIM (ÇALIŞAN) ----------
  async function clickBelgelerim() {
    if (!(await throttle("tp_last_belgelerim_try", 2000))) return false;

    // önce main document (senin testin burada 1 buluyordu)
    const direct = [...document.querySelectorAll("div[ng-click]")].find(
      (x) => (x.textContent || "").trim() === "Belgelerim"
    );
    if (direct) {
      console.log(TAG, "Step2: Belgelerim found (direct). Clicking...");
      superClick(direct);
      return true;
    }

    // frame taraması
    for (const d of getAllDocs()) {
      const target = [...d.querySelectorAll("div[ng-click]")].find(
        (x) => (x.textContent || "").trim() === "Belgelerim"
      );
      if (target) {
        console.log(TAG, "Step2: Belgelerim found (frame). Clicking...");
        superClick(target);
        return true;
      }
    }

    console.log(TAG, "Step2: Belgelerim not found.");
    return false;
  }

  // ---------- STEP 3A: DOSYA TURU = MARKA (ÇALIŞAN) ----------
  function isMarkaSelectedNow() {
    const container = qAll("div.ui-select-container[name='selectbox550']");
    if (!container) return false;
    const txt = (
      container.querySelector(".ui-select-match-text span")?.textContent ||
      container.querySelector(".ui-select-match-text")?.textContent ||
      ""
    ).trim().toLowerCase();
    return txt.includes("marka");
  }

  async function ensureDosyaTuruMarka() {
    if (isMarkaSelectedNow()) return true;

    if (!(await throttle("tp_last_select_try", 1000))) return false;

    const container = qAll("div.ui-select-container[name='selectbox550']");
    if (!container) return false;

    const toggle = container.querySelector(".ui-select-toggle") || container;
    const caret = container.querySelector("i.caret");

    if (!container.classList.contains("open")) {
      superClick(toggle);
      await sleep(150);
      if (caret) superClick(caret);
      for (let i = 0; i < 20; i++) {
        if (container.classList.contains("open")) break;
        await sleep(100);
      }
    }

    const search = container.querySelector("input.ui-select-search");
    if (search && !search.classList.contains("ng-hide")) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(search, "marka");
      else search.value = "marka";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      search.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(250);
    } else {
      await sleep(200);
    }

    for (let i = 0; i < 25; i++) {
      const rows = [];
      for (const d of getAllDocs()) {
        rows.push(...Array.from(d.querySelectorAll(".ui-select-choices-row, .ui-select-choices-row-inner")));
        rows.push(...Array.from(d.querySelectorAll("li[role='option'], [role='option']")));
      }
      const markaRow = rows.find((el) => (el.textContent || "").trim().toLowerCase().includes("marka"));
      if (markaRow) {
        superClick(markaRow);
        await sleep(300);
        return isMarkaSelectedNow();
      }
      await sleep(120);
    }

    return false;
  }

  // ---------- STEP 3B: BASVURU NO (ÇALIŞAN) + ARA (YENİ FIX) ----------
  async function fillBasvuruNo(appNo) {
    const input = qAll("#textbox551 input");
    if (!input) return false;

    if ((input.value || "").trim() !== String(appNo)) {
      fillInputAngularSafe(input, String(appNo));
      await sleep(200);
    }
    return true;
  }

  // ---------- STEP 4: EXPAND (+/-) TWICE ----------
async function expandAllSmart() {
  const { tp_expanded_twice } = await chrome.storage.local.get(["tp_expanded_twice"]);
  if (tp_expanded_twice) return true;

  const btn = qAll("div.ui-grid-tree-base-row-header-buttons");
  if (!btn) return false;

  const icon = btn.querySelector("i");
  const cls = (icon?.className || "").toLowerCase();

  const isMinus = cls.includes("minus") || cls.includes("fa-minus");
  const isPlus  = cls.includes("plus")  || cls.includes("fa-plus");

  if (isMinus) {
    console.log(TAG, "Expand: '-' görüldü. Kapat -> aç yapılıyor...");
    superClick(btn);
    await sleep(500);
    superClick(btn);
    await sleep(700);
  } else {
    console.log(TAG, "Expand: '+' tık (1 kere)...");
    superClick(btn);
    await sleep(700);
  }

  await chrome.storage.local.set({ tp_expanded_twice: true });
  return true;
}

function findEvrakAdiFilterInput() {
  const headerCells = qAllMany(".ui-grid-header-cell");

  for (const cell of headerCells) {
    const title = (cell.innerText || "").trim().toLowerCase();

    // 🔴 SADECE "Evrak Adı"
    if (title === "evrak adı" || title === "evrak adi") {
      const input = cell.querySelector("input.ui-grid-filter-input");
      if (input) return input;
    }
  }

  return null;
}


async function setEvrakAdiFilter(term) {
  const input = findEvrakAdiFilterInput();
  if (!input) return false;

  if ((input.value || "").trim() !== term) {
    fillInputAngularSafe(input, term);
    console.log(TAG, `Evrak Adı filtresine yazıldı: ${term}`);
    await sleep(400);
  }
  return true;
}

function findFirstRowDownloadIconByTerm(term) {
  const t = String(term).toLowerCase();
  const rows = qAllMany(".ui-grid-row");
  for (const r of rows) {
    const txt = (r.textContent || "").toLowerCase();
    if (txt.includes(t)) {
      const icon = r.querySelector("i.fa.fa-download, i.fa-download");
      if (icon) return icon;
    }
  }
  return null;
}

function findSecondVisibleDownloadIcon() {
  const icons = qAllMany("i.fa.fa-download, i.fa-download")
    .filter((el) => el && el.offsetParent !== null); // görünür olanlar
  return icons[1] || null; // 2. ikon
}

// Dosyanın en üstüne (isActionInProgress yanına) ekleyin
let searchPassCount = 0; // Tüm listenin kaç kez tarandığını tutar

// -----------------------------
// AKORDEON HELPERS (GÜNCEL)
// -----------------------------
function getAccordionHost() {
  return qAll("div.ui-grid-tree-base-row-header-buttons");
}

function getAccordionClickable() {
  const host = getAccordionHost();
  if (!host) return null;

  // Filtre sonrası click handler bazen iç elemanda oluyor
  return (
    host.querySelector("button") ||
    host.querySelector("[role='button']") ||
    host.querySelector("a") ||
    host.querySelector("i") ||
    host
  );
}

// plus / minus / unknown
function readAccordionState() {
  const host = getAccordionHost();
  if (!host) return "none";

  const icon = host.querySelector("i");
  const cls = (icon?.className || host.className || "").toLowerCase();

  const plusHints = ["plus", "fa-plus", "ui-grid-icon-plus", "plus-squared", "icon-plus"];
  const minusHints = ["minus", "fa-minus", "ui-grid-icon-minus", "minus-squared", "icon-minus"];

  const isPlus = plusHints.some((h) => cls.includes(h));
  const isMinus = minusHints.some((h) => cls.includes(h));

  if (isPlus && !isMinus) return "plus";
  if (isMinus && !isPlus) return "minus";
  return "unknown";
}

// KURAL: + => 1 click, - => 2 click (kapat-aç), unknown => toggle dene
async function ensureAccordionExpandedAfterFilter() {
  const host = getAccordionHost();
  if (!host) return false;

  // DOM otursun
  await sleep(250);

  const stateBefore = readAccordionState();
  let clickable = getAccordionClickable();
  if (!clickable) return false;

  if (stateBefore === "plus") {
    console.log(TAG, "Akordeon '+' (kapalı). 1 kez açılıyor...");
    superClick(clickable);
    await sleep(1100);
    return true;
  }

  if (stateBefore === "minus") {
    console.log(TAG, "Akordeon '-' (açık görünüyor). 2 kez (kapat-aç) tazeleniyor...");
    superClick(clickable);          // kapat
    await sleep(650);

    // re-render ihtimali: yeniden yakala
    clickable = getAccordionClickable();
    if (clickable) superClick(clickable); // tekrar aç
    await sleep(1100);
    return true;
  }

  // unknown: en az 1 kez toggle dene, değişmezse bir daha dene
  console.log(TAG, "Akordeon durumu 'unknown'. Toggle zorlanıyor...");
  superClick(clickable);
  await sleep(900);

  const stateAfter = readAccordionState();
  if (stateAfter === stateBefore) {
    clickable = getAccordionClickable();
    if (clickable) {
      console.log(TAG, "Toggle sonrası state değişmedi. 1 kez daha deneniyor...");
      superClick(clickable);
      await sleep(900);
    }
  }
  return true;
}

// Sadece AŞAMA 1'de: kapalıysa açmayı garantile (unknown dahil)
async function ensureAccordionOpenAtStart() {
  const host = getAccordionHost();
  if (!host) return false;

  await sleep(250);

  const state = readAccordionState();
  let clickable = getAccordionClickable();
  if (!clickable) return false;

  if (state === "minus") {
    console.log(TAG, "Akordeon başlangıçta açık (-).");
    return true;
  }

  console.log(TAG, "Akordeon başlangıçta kapalı/unknown. Açmak için tıklanıyor...");
  superClick(clickable);
  await sleep(1400);

  // Hala minus değilse bir kez daha dene (filtre öncesi de bazen boşa düşebiliyor)
  const state2 = readAccordionState();
  if (state2 !== "minus") {
    clickable = getAccordionClickable();
    if (clickable) {
      console.log(TAG, "İlk açma denemesi yetmedi. 1 kez daha deneniyor...");
      superClick(clickable);
      await sleep(1400);
    }
  }

  return readAccordionState() === "minus" || readAccordionState() === "unknown";
}

// -----------------------------
// GÜNCEL downloadTescilBelge()
// -----------------------------
async function downloadTescilBelge() {
  // 1) Durum Kontrolleri
  const { tp_download_clicked, tp_clicked_ara } = await chrome.storage.local.get([
    "tp_download_clicked",
    "tp_clicked_ara",
  ]);

  if (tp_download_clicked || searchPassCount >= 2 || isActionInProgress || !tp_clicked_ara) {
    return true;
  }

  // 2) Akordeon var mı?
  const accordionHost = getAccordionHost();
  if (!accordionHost) {
    console.log(TAG, "Tablo henüz hazır değil, akordeon butonu bekleniyor...");
    return false;
  }

  isActionInProgress = true;

  try {
    // ========================================================
    // AŞAMA 1: AKORDEONU KESİN OLARAK AÇ (İlk yükleme)
    // ========================================================
    const okOpen = await ensureAccordionOpenAtStart();
    if (!okOpen) {
      console.log(TAG, "⚠️ Akordeon açılamadı. Filtreleme erteleniyor.");
      return false;
    }

    // ========================================================
    // AŞAMA 2: SIRALI FİLTRELEME
    // ========================================================
    const aramaListesi = ["Marka Yenileme Belges", "MYB", "TB", "Tescil_belgesi_us"];

    for (const terim of aramaListesi) {
      console.log(TAG, `🔍 Kriter Deneniyor: ${terim}`);

      const okFilter = await setEvrakAdiFilter(terim);
      if (!okFilter) continue;

      // Filtre sonrası Angular render beklemesi
      await sleep(1500);

      // ========================================================
      // KRİTİK: Filtre sonrası akordeonu senin kuralınla tazele
      // + => 1 tık, - => 2 tık
      // ========================================================
      await ensureAccordionExpandedAfterFilter();

      // İndirme ikonunu ara
      let targetIcon = findFirstRowDownloadIconByTerm(terim) || findSecondVisibleDownloadIcon();

      if (targetIcon) {
        console.log(TAG, `✅ EŞLEŞME: ${terim} bulundu.`);
        await chrome.storage.local.set({ tp_download_clicked: true });
        superClick(targetIcon);
        return true;
      }

      console.log(TAG, `❌ ${terim} için kayıt bulunamadı.`);

      // Sonraki kriter için filtreyi temizle
      const filterInput = findEvrakAdiFilterInput();
      if (filterInput) {
        fillInputAngularSafe(filterInput, "");
        await sleep(500);
      }
    }

    searchPassCount++;
    if (searchPassCount >= 2) {
      console.log(TAG, "⚠️ 2 tur deneme sonunda sonuç yok.");
      await chrome.storage.local.set({ tp_download_clicked: true });
    }
  } catch (e) {
    console.error(TAG, "Hata:", e);
  } finally {
    isActionInProgress = false;
  }

  return false;
}


  // ---------- MAIN LOOP ----------
  async function run() {
    const { tp_app_no } = await chrome.storage.local.get(["tp_app_no"]);
    if (!tp_app_no) return;

    // Step1
    if (isGirisPage()) {
      const btn = findLoginButtonOnGiris();
      if (btn) superClick(btn);
      return;
    }

    // Step3/4
  if (isBelgelerimScreenOpen()) {
    const okMarka = await ensureDosyaTuruMarka();
    if (!okMarka) return;

    const okNo = await fillBasvuruNo(tp_app_no);
    if (!okNo) return;

    const okAra = await clickAraButtonOnly();
    if (!okAra) return;

    // Sadece ara tıklandıysa ve indirme henüz yapılmadıysa indirme fonksiyonuna gir
    const { tp_clicked_ara, tp_download_clicked } = await chrome.storage.local.get(["tp_clicked_ara", "tp_download_clicked"]);
    
    if (tp_clicked_ara && !tp_download_clicked && !isActionInProgress) {
      await downloadTescilBelge();
    }
    return;
  }

    // Step2
    await clickBelgelerim();
  }

  run().catch(() => {});
  setInterval(() => run().catch(() => {}), 1200);
})();
