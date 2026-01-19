// content_script.js (Final: Dinamik URL Düzeltilmiş Tam Versiyon)
(() => {
  // 🔥 SCRIPT TEKİLLİK KONTROLÜ
  if (window.TP_SCRIPT_ALREADY_LOADED) {
      console.log("[TP-AUTO] ♻️ Script zaten yüklü.");
      return; 
  }
  window.TP_SCRIPT_ALREADY_LOADED = true;

  const TAG = "[TP-AUTO]";
  
  // --- GLOBAL STATE ---
  let isActionInProgress = false; 
  let searchPassCount = 0; 
  let globalProcessingLock = false; 
  let isAdvancing = false;          
  let lastProcessedUrl = null;      

  console.log("[TP-AUTO] Content script hazır:", location.href);

  // --- 1. MESAJ DİNLEYİCİSİ ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action === "PDF_URL_CAPTURED" && request?.url) {
      sendResponse({ ok: true }); 

      // Mükerrer URL Kontrolü
      if (request.url === lastProcessedUrl) {
        console.warn(TAG, "♻️ Bu URL zaten işlendi:", request.url);
        return;
      }

      // Kilit Kontrolü
      if (globalProcessingLock || isAdvancing) {
        console.warn(TAG, "⛔ Sistem meşgul, reddedildi:", request.url);
        return; 
      }

      // Kilitle
      globalProcessingLock = true;
      lastProcessedUrl = request.url;

      (async () => {
        try {
          const state = await chrome.storage.local.get(["tp_waiting_pdf_url", "tp_download_clicked"]);

          // Sistem PDF beklemiyorsa
          if (!state.tp_waiting_pdf_url) {
            console.warn(TAG, "⚠️ Beklenmeyen PDF isteği iptal.", request.url);
            globalProcessingLock = false; 
            return;
          }

          // Durumu güncelle
          await chrome.storage.local.set({ tp_download_clicked: true, tp_waiting_pdf_url: false });

          // İşleme başla
          await processDocument(request.url, null);

        } catch (err) {
          console.error(TAG, "Mesaj hatası:", err);
          globalProcessingLock = false;
        }
      })();

      return true;
    }
  });

  if (window.top !== window) return;
  
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  
  // ❌ UPLOAD_ENDPOINT SABİTİ KALDIRILDI (Dinamik olacak)

  // ---------- KUYRUK VE RESET MANTIĞI ----------
  
  document.addEventListener("TP_RESET", async () => {
    try { await chrome.storage.local.clear(); console.log(TAG, "RESET OK."); } catch (e) {}
  });

  async function checkQueueAndSetAppNo() {
    const data = await chrome.storage.local.get(["tp_queue", "tp_is_queue_running", "tp_queue_index", "tp_app_no"]);
    
    if (!data.tp_is_queue_running || !data.tp_queue || data.tp_queue.length === 0) return true; 

    const currentIndex = data.tp_queue_index || 0;
    
    if (currentIndex >= data.tp_queue.length) {
      console.log(TAG, "🏁 Kuyruk tamamlandı!");
      await chrome.storage.local.set({ tp_is_queue_running: false, tp_queue: [] });
      alert("Toplu işlem tamamlandı!");
      return false; 
    }

    const currentJob = data.tp_queue[currentIndex];
    
    if (data.tp_app_no !== currentJob.appNo) {
      console.log(TAG, `🔄 Yeni İş: ${currentIndex + 1}/${data.tp_queue.length} - No: ${currentJob.appNo}`);
      
      await chrome.storage.local.set({
        tp_app_no: currentJob.appNo,
        tp_current_job_id: currentJob.ipId,
        tp_current_doc_type: currentJob.docType,
        tp_clicked_ara: false,
        tp_download_clicked: false,
        tp_expanded_twice: false,
        tp_last_belgelerim_try: 0
      });
      
      searchPassCount = 0; 
      return true;
    }
    return true;
  }

  // --- ADVANCE QUEUE ---
  async function advanceQueue() {
    if (isAdvancing) return;
    isAdvancing = true;
    console.log(TAG, "✅ İşlem tamam, kuyruk ilerletiliyor...");

    try {
        const input = qAll("#textbox551 input");
        if (input) fillInputAngularSafe(input, ""); 

        const data = await chrome.storage.local.get(["tp_queue_index"]);
        const nextIndex = (data.tp_queue_index || 0) + 1;

        await chrome.storage.local.set({ 
          tp_queue_index: nextIndex,
          tp_app_no: null,            
          tp_download_clicked: false, 
          tp_clicked_ara: false,      
          tp_waiting_pdf_url: false,  
          tp_expanded_twice: false,
          tp_last_belgelerim_try: 0 
        });

        console.log(TAG, `🔓 Sıradaki: ${nextIndex}. Arayüz hazırlanıyor...`);
        globalProcessingLock = false; 
        isActionInProgress = false;
        await sleep(2000); 

    } catch (e) { console.error(TAG, "advanceQueue hatası:", e); } 
    finally { isAdvancing = false; }
  }

  // ---------- PDF İŞLEME (DİNAMİK URL) ----------

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onloadend = () => {
        try {
          const res = String(reader.result || "");
          resolve(res.split(",")[1] || "");
        } catch (e) { reject(e); }
      };
      reader.readAsDataURL(blob);
    });
  }

  async function processDocument(downloadUrl, element) {
    console.log(TAG, "📄 Belge işleniyor:", downloadUrl);
    if (element) element.style.color = "orange";

    try {
      const response = await fetch(downloadUrl, { credentials: "include" });
      if (!response.ok) throw new Error("PDF fetch failed: " + response.status);

      const blob = await response.blob();
      if (!blob.size) throw new Error("PDF blob boş");

      const base64data = await blobToBase64(blob);
      if (!base64data || base64data.length < 1000) throw new Error("Base64 geçersiz");

      // 🔥 URL'yi Storage'dan al (Dinamik)
      const storage = await chrome.storage.local.get(["tp_current_job_id", "tp_current_doc_type", "tp_upload_url"]);
      const dynamicEndpoint = storage.tp_upload_url;

      if (!dynamicEndpoint) {
          console.error(TAG, "❌ HATA: Hedef Upload URL (tp_upload_url) bulunamadı!");
          alert("Hata: Hedef adres bulunamadı. Lütfen işlemi yeniden başlatın.");
          throw new Error("Missing Upload URL");
      }

      const payload = {
        ipRecordId: storage.tp_current_job_id,
        fileBase64: base64data,
        fileName: "Tescil_Belgesi.pdf",
        mimeType: "application/pdf",
        docType: storage.tp_current_doc_type || "tescil_belgesi",
      };

      console.log(TAG, "📤 Upload ediliyor ->", dynamicEndpoint);

      const uploadRes = await fetch(dynamicEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload }),
      });

      const text = await uploadRes.text();
      if (uploadRes.ok) {
        console.log(TAG, "✅ Yükleme Başarılı!", text);
        if (element) element.style.color = "green";
      } else {
        console.error(TAG, "❌ Yükleme Hatası:", text);
        if (element) element.style.color = "red";
      }

    } catch (error) {
      console.error(TAG, "Process hatası:", error);
    } finally {
      await advanceQueue();
    }
  }

  // ---------- DOM HELPERS ----------
  function getAllDocs() {
    const docs = [document];
    const frames = Array.from(document.querySelectorAll("iframe"));
    for (const fr of frames) { try { const d = fr.contentDocument; if (d) docs.push(d); } catch {} }
    return docs;
  }
  function qAll(selector) { for (const d of getAllDocs()) { const el = d.querySelector(selector); if (el) return el; } return null; }
  function qAllMany(selector) { let out = []; for (const d of getAllDocs()) out = out.concat(Array.from(d.querySelectorAll(selector))); return out; }

  function superClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch {}
    try { el.click(); return true; } catch { return false; }
  }

  function fillInputAngularSafe(input, value) {
    if (!input) return false;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
    return true;
  }

  async function throttle(key, ms) {
    const now = Date.now();
    const obj = await chrome.storage.local.get([key]);
    if (now - (obj[key] || 0) < ms) return false;
    await chrome.storage.local.set({ [key]: now });
    return true;
  }

  // ---------- EPATS UI LOGIC ----------
  async function clickAraButtonOnly() {
    const { tp_clicked_ara } = await chrome.storage.local.get(["tp_clicked_ara"]);
    if (tp_clicked_ara) return true; 
    const root = qAll("#button549");
    if (!root) return false;
    const btn = root.querySelector("div.btn[ng-click]") || root.querySelector(".btn");
    if (!btn || btn.hasAttribute("disabled") || btn.classList.contains("disabled")) return false;
    console.log(TAG, "Ara butonuna basılıyor...");
    superClick(btn);
    await chrome.storage.local.set({ tp_clicked_ara: true });
    return true;
  }

  function isGirisPage() { return location.href.includes("/run/TP/EDEVLET/giris"); }
  function isBelgelerimScreenOpen() { return (!!qAll("div.ui-select-container[name='selectbox550']") || !!qAll("#textbox551 input") || !!qAll("#button549")); }
  
  function findLoginButtonOnGiris() {
    const direct = qAll('a[href*="turkiye.gov.tr"]');
    if (direct) return direct;
    return qAllMany("a,button,div").find((el) => {
      const t = (el.textContent || "").trim().toLowerCase();
      const href = (el.getAttribute && el.getAttribute("href")) || "";
      return href.includes("turkiye.gov.tr") || t === "giriş" || t.includes("e-devlet");
    });
  }

  async function clickBelgelerim() {
    if (!(await throttle("tp_last_belgelerim_try", 3000))) return false;
    const targets = qAllMany("div[ng-click]");
    const target = targets.find(x => (x.textContent || "").trim() === "Belgelerim");
    if(target) { superClick(target); return true; }
    return false;
  }

  function isMarkaSelectedNow() {
    const container = qAll("div.ui-select-container[name='selectbox550']");
    if (!container) return false;
    const txt = (container.querySelector(".ui-select-match-text")?.textContent || "").trim().toLowerCase();
    return txt.includes("marka");
  }

  async function ensureDosyaTuruMarka() {
    if (isMarkaSelectedNow()) return true;
    if (!(await throttle("tp_last_select_try", 1000))) return false;
    const container = qAll("div.ui-select-container[name='selectbox550']");
    if (!container) return false;
    const toggle = container.querySelector(".ui-select-toggle");
    if (!container.classList.contains("open")) { superClick(toggle); await sleep(200); }
    const rows = qAllMany(".ui-select-choices-row, li[role='option']");
    const markaRow = rows.find(el => (el.textContent || "").toLowerCase().includes("marka"));
    if (markaRow) { superClick(markaRow); await sleep(300); return isMarkaSelectedNow(); }
    return false;
  }

  async function fillBasvuruNo(appNo) {
    const input = qAll("#textbox551 input");
    if (!input) return false;
    const currentVal = (input.value || "").trim();
    if (currentVal !== String(appNo)) { fillInputAngularSafe(input, String(appNo)); await sleep(300); }
    return true;
  }

  function getAccordionHost() { return qAll("div.ui-grid-tree-base-row-header-buttons"); }
  function getAccordionClickable() { const host = getAccordionHost(); return host ? (host.querySelector("i") || host) : null; }
  function readAccordionState() { const host = getAccordionHost(); if (!host) return "none"; const icon = host.querySelector("i"); const cls = (icon?.className || host.className || "").toLowerCase(); if (cls.includes("minus")) return "minus"; if (cls.includes("plus")) return "plus"; return "unknown"; }
  async function ensureAccordionOpenAtStart() { const state = readAccordionState(); if (state === "minus") return true; const clickable = getAccordionClickable(); if(clickable) { superClick(clickable); await sleep(2000); } return readAccordionState() === "minus"; }
  async function ensureAccordionExpandedAfterFilter() { await sleep(800); const state = readAccordionState(); const clickable = getAccordionClickable(); if (!clickable) return false; if (state === "plus") { superClick(clickable); await sleep(1500); } else if (state === "minus") { superClick(clickable); await sleep(800); superClick(clickable); await sleep(1500); } return true; }
  async function setEvrakAdiFilter(term) { const headerCells = qAllMany(".ui-grid-header-cell"); for (const cell of headerCells) { if ((cell.innerText || "").trim().toLowerCase() === "evrak adı") { const input = cell.querySelector("input.ui-grid-filter-input"); if (!input) return false; if ((input.value || "").trim() !== term) { fillInputAngularSafe(input, term); await sleep(800); } return true; } } return null; }
  function findDownloadIcon() { const icons = qAllMany("i.fa-download").filter(el => el.offsetParent !== null); return icons[1] || null; }

  // --- DOWNLOAD MANTIĞI ---
  async function downloadTescilBelge() {
    const { tp_download_clicked, tp_clicked_ara } = await chrome.storage.local.get(["tp_download_clicked", "tp_clicked_ara"]);
    if (tp_download_clicked || isActionInProgress || !tp_clicked_ara) return true;
    if (isAdvancing) return true; 
    if (!getAccordionHost()) return false; 

    isActionInProgress = true;
    try {
        await ensureAccordionOpenAtStart();
        const aramaListesi = ["Marka Yenileme Belges", "MYB", "TB", "Tescil_belgesi_us"];
        for (const terim of aramaListesi) {
            console.log(TAG, `🔍 Kriter: ${terim}`);
            await setEvrakAdiFilter(terim);
            await sleep(1500);
            await ensureAccordionExpandedAfterFilter();
            const targetIcon = findDownloadIcon();
            
            if (targetIcon) {
                console.log(TAG, `✅ BULUNDU: ${terim}`);
                await chrome.storage.local.set({ tp_waiting_pdf_url: true });
                superClick(targetIcon);
                await sleep(1000);
                setTimeout(async () => {
                  const { tp_waiting_pdf_url, tp_download_clicked } = await chrome.storage.local.get(["tp_waiting_pdf_url", "tp_download_clicked"]);
                  if (tp_waiting_pdf_url && !tp_download_clicked) {
                    console.warn(TAG, "⏳ Timeout. İlerleniyor.");
                    await chrome.storage.local.set({ tp_waiting_pdf_url: false });
                    globalProcessingLock = false;
                    await advanceQueue();
                  }
                }, 12000);
                return true; 
            }
        }
        searchPassCount++;
        if (searchPassCount >= 2) { console.log(TAG, "⚠️ Belge bulunamadı."); await advanceQueue(); }
    } catch(e) { console.error(TAG, e); await advanceQueue(); } 
    finally { isActionInProgress = false; }
  }

  // --- ANA DÖNGÜ ---
  async function run() {
    if (isAdvancing) return;
    const continueProcess = await checkQueueAndSetAppNo();
    if (!continueProcess) return;
    const { tp_app_no, tp_clicked_ara, tp_download_clicked } = await chrome.storage.local.get(["tp_app_no", "tp_clicked_ara", "tp_download_clicked"]);
    if (!tp_app_no) return; 

    if (isGirisPage()) { const btn = findLoginButtonOnGiris(); if (btn) superClick(btn); return; }

    if (isBelgelerimScreenOpen()) {
      const okMarka = await ensureDosyaTuruMarka();
      if (!okMarka) return;
      const input = qAll("#textbox551 input");
      const currentVal = input ? (input.value || "").trim() : "";
      if (currentVal !== String(tp_app_no)) { await fillBasvuruNo(tp_app_no); return; }
      if (!tp_clicked_ara) { await clickAraButtonOnly(); return; }
      if (tp_clicked_ara && !tp_download_clicked && !isActionInProgress) { await downloadTescilBelge(); }
      return;
    }
    await clickBelgelerim();
  }

  setInterval(() => run().catch(() => {}), 2000);
})();