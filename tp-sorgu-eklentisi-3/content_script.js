// content_script.js (Final Fix: Gentle Click)

(() => {
  // --- SINGLETON ---
  if (window.TP_SCRIPT_ALREADY_LOADED) return;
  window.TP_SCRIPT_ALREADY_LOADED = true;

  const TAG = "[TP-AUTO]";
  let isActionInProgress = false; 
  let searchPassCount = 0; 
  let globalProcessingLock = false; 
  let isAdvancing = false;          
  let lastProcessedUrl = null;      

  console.log(TAG, "Content script active.");

  // --- MESAJ DİNLEYİCİSİ ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action === "PDF_URL_CAPTURED" && request?.url) {
      sendResponse({ ok: true }); 

      if (request.url === lastProcessedUrl) return; 
      if (globalProcessingLock || isAdvancing) return; 

      globalProcessingLock = true;
      lastProcessedUrl = request.url;

      (async () => {
        try {
          const state = await chrome.storage.local.get(["tp_waiting_pdf_url"]);
          if (!state.tp_waiting_pdf_url) {
            console.warn(TAG, "⚠️ Beklenmeyen PDF, reddedildi.");
            globalProcessingLock = false; return;
          }

          // İndirildi işaretle
          await chrome.storage.local.set({ tp_download_clicked: true, tp_waiting_pdf_url: false });
          await processDocument(request.url, null);
        } catch (err) {
          console.error(TAG, err);
          globalProcessingLock = false; 
        }
      })();
    }
  });

  if (window.top !== window) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- KUYRUK ---
  document.addEventListener("TP_RESET", async () => { try { await chrome.storage.local.clear(); } catch {} });

  async function checkQueueAndSetAppNo() {
    const data = await chrome.storage.local.get(["tp_queue", "tp_is_queue_running", "tp_queue_index", "tp_app_no"]);
    if (!data.tp_is_queue_running || !data.tp_queue || data.tp_queue.length === 0) return true; 

    const currentIndex = data.tp_queue_index || 0;
    if (currentIndex >= data.tp_queue.length) {
      console.log(TAG, "🏁 Kuyruk Bitti.");
      await chrome.storage.local.set({ tp_is_queue_running: false, tp_queue: [] });
      alert("İşlemler tamamlandı.");
      return false; 
    }

    const currentJob = data.tp_queue[currentIndex];
    if (data.tp_app_no !== currentJob.appNo) {
      console.log(TAG, `🔄 Yeni İş: ${currentIndex + 1}/${data.tp_queue.length} - ${currentJob.appNo}`);
      await chrome.storage.local.set({
        tp_app_no: currentJob.appNo,
        tp_current_job_id: currentJob.ipId,
        tp_current_doc_type: currentJob.docType,
        tp_clicked_ara: false,
        tp_download_clicked: false,
        tp_grid_ready: false,
        tp_prev_grid_sig: null,
        tp_expanded_twice: false,
        tp_last_belgelerim_try: 0,
        tp_last_search_ts: 0,
        tp_waiting_pdf_url: false
      });
      searchPassCount = 0; 
      return true;
    }
    return true;
  }

  async function advanceQueue() {
    if (isAdvancing) return;
    isAdvancing = true;
    console.log(TAG, "✅ İlerleniyor...");

    try {
        const input = qAll("#textbox551 input");
        if (input) fillInputAngularSafe(input, ""); 

        const data = await chrome.storage.local.get(["tp_queue_index"]);
        await chrome.storage.local.set({ 
          tp_queue_index: (data.tp_queue_index || 0) + 1,
          tp_app_no: null,            
          tp_download_clicked: false, 
          tp_clicked_ara: false,      
          tp_waiting_pdf_url: false,  
          tp_grid_ready: false,
          tp_prev_grid_sig: null,
          tp_expanded_twice: false,
          tp_last_belgelerim_try: 0,
          tp_last_search_ts: 0
        });
        
        globalProcessingLock = false; 
        isActionInProgress = false;
        await sleep(1500); 
    } catch (e) {} 
    finally { isAdvancing = false; }
  }

  // --- PDF UPLOAD ---
  async function processDocument(downloadUrl, element) {
     console.log(TAG, "📄 İşleniyor...", downloadUrl);
     if(element) element.style.color = "orange";

     try {
        const response = await fetch(downloadUrl);
        const blob = await response.blob();
        
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        
        reader.onloadend = async () => {
            const base64data = reader.result.split(',')[1];
            const storage = await chrome.storage.local.get(["tp_current_job_id", "tp_current_doc_type", "tp_upload_url"]);
            
            const dynamicEndpoint = storage.tp_upload_url;
            if (!dynamicEndpoint) {
                console.error(TAG, "❌ HATA: URL Yok.");
                await advanceQueue(); return;
            }

            const payload = {
                ipId: storage.tp_current_job_id,
                fileContent: base64data,
                fileName: "Tescil_Belgesi.pdf",
                mimeType: "application/pdf",
                docType: storage.tp_current_doc_type || "tescil_belgesi"
            };

            console.log(TAG, "📤 Upload ->", dynamicEndpoint);
            const uploadRes = await fetch(dynamicEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: payload }) 
            });

            if (uploadRes.ok) {
                console.log(TAG, "✅ Başarılı!");
                if(element) element.style.color = "green";
                await advanceQueue();
            } else {
                console.error(TAG, "❌ Hata:", await uploadRes.text());
                if(element) element.style.color = "red";
                await advanceQueue(); 
            }
        };
     } catch (error) {
         console.error(TAG, "Process hatası:", error);
         await advanceQueue();
     }
  }

  // --- HELPERS ---
  function qAll(selector) {
    const docs = [document];
    document.querySelectorAll("iframe").forEach(fr => { try { if(fr.contentDocument) docs.push(fr.contentDocument); } catch{} });
    for (const d of docs) { const el = d.querySelector(selector); if (el) return el; }
    return null;
  }
  function qAllMany(selector) {
    let out = [];
    const docs = [document];
    document.querySelectorAll("iframe").forEach(fr => { try { if(fr.contentDocument) docs.push(fr.contentDocument); } catch{} });
    for (const d of docs) out = out.concat(Array.from(d.querySelectorAll(selector)));
    return out;
  }

  // 🔥 DÜZELTİLEN YER: Sadece basit click, Ctrl yok!
  function superClick(el) {
    if (!el) return false;
    try { 
        el.click(); // En basit, en güvenli yöntem
        return true; 
    } catch { return false; }
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

  // --- GRID & UI ---
  function getGridHost() { return qAll(".ui-grid-viewport"); }

  function getGridSignature() {
    const rows = qAllMany(".ui-grid-row");
    return rows.length > 0 ? rows[0].innerText.slice(0,50) + rows.length : "empty";
  }

  async function waitForGridToRefresh(prevSig, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isPageBusy()) { await sleep(400); continue; }
      const sig = getGridSignature();
      if (sig !== "empty" && sig !== prevSig) return true;
      await sleep(400);
    }
    return false;
  }

  async function clearEvrakAdiFilter() {
    const cells = qAllMany(".ui-grid-header-cell");
    for (const cell of cells) {
      if (cell.innerText.toLowerCase().includes("evrak adı")) {
        const input = cell.querySelector("input");
        if (input && (input.value || "").trim() !== "") {
          fillInputAngularSafe(input, "");
          await sleep(500);
        }
        return true;
      }
    }
    return false;
  }

  function isPageBusy() {
    const busyEls = qAllMany(".loading-spinner, .fa-spinner, .block-ui-overlay");
    return busyEls.some(el => {
       const style = window.getComputedStyle(el);
       return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  // --- ACTIONS ---
  async function clickAraButtonOnly() {
    const { tp_clicked_ara } = await chrome.storage.local.get(["tp_clicked_ara"]);
    if (tp_clicked_ara) return true; 

    const prevSig = getGridSignature();
    const root = qAll("#button549");
    if (!root) return false;
    const btn = root.querySelector("div.btn[ng-click]") || root.querySelector(".btn");
    
    if (!btn || btn.classList.contains("disabled")) return false;

    console.log(TAG, "🔎 Ara");
    superClick(btn);
    
    await chrome.storage.local.set({ 
        tp_clicked_ara: true,
        tp_last_search_ts: Date.now(),
        tp_prev_grid_sig: prevSig
    });
    return true;
  }

  function isGirisPage() { return location.href.includes("/run/TP/EDEVLET/giris"); }
  function isBelgelerimScreenOpen() { return (!!qAll("div.ui-select-container[name='selectbox550']") || !!qAll("#textbox551 input")); }
  
  function findLoginButtonOnGiris() {
    const direct = qAll('a[href*="turkiye.gov.tr"]');
    if(direct) return direct;
    return qAllMany("a,button").find(el => (el.textContent||"").toLowerCase().includes("giriş"));
  }

  async function clickBelgelerim() {
    if (!(await throttle("tp_last_belgelerim_try", 3000))) return false;
    const targets = qAllMany("div[ng-click]");
    const target = targets.find(x => (x.textContent || "").trim() === "Belgelerim");
    if(target) { superClick(target); return true; }
    return false;
  }

  async function ensureDosyaTuruMarka() {
    const container = qAll("div.ui-select-container[name='selectbox550']");
    if (!container) return false;
    if (container.innerText.toLowerCase().includes("marka")) return true;
    
    if (!(await throttle("tp_last_select_try", 1000))) return false;
    const toggle = container.querySelector(".ui-select-toggle");
    if (!container.classList.contains("open")) { superClick(toggle); await sleep(200); }
    const rows = qAllMany(".ui-select-choices-row");
    const markaRow = rows.find(el => el.innerText.toLowerCase().includes("marka"));
    if (markaRow) { superClick(markaRow); await sleep(300); }
    return false;
  }

  async function fillBasvuruNo(appNo) {
    const input = qAll("#textbox551 input");
    if (!input) return false;
    if ((input.value || "").trim() !== String(appNo)) {
      fillInputAngularSafe(input, String(appNo));
      await sleep(300);
    }
    return true;
  }

  function getAccordionHost() { return qAll("div.ui-grid-tree-base-row-header-buttons"); }
  
  function getAccordionClickable() {
    const host = getAccordionHost();
    if (!host) return null; 
    return host.querySelector("i") || host;
  }

  function readAccordionState() {
    const host = getAccordionHost();
    if (!host) return "none";
    const cls = (host.querySelector("i")?.className || host.className || "").toLowerCase();
    if (cls.includes("minus")) return "minus"; 
    if (cls.includes("plus")) return "plus";   
    return "unknown";
  }

  async function ensureAccordionOpenAtStart() {
    const state = readAccordionState();
    if (state === "minus") return true; 
    const clickable = getAccordionClickable();
    if(clickable) { superClick(clickable); await sleep(2000); }
    return readAccordionState() === "minus";
  }

  async function ensureAccordionExpandedAfterFilter() {
    await sleep(800);
    const clickable = getAccordionClickable();
    if (!clickable) return false;
    const state = readAccordionState();
    
    if (state === "plus") { superClick(clickable); await sleep(1500); }
    else if (state === "minus") { 
        superClick(clickable); await sleep(800); // Kapat
        superClick(clickable); await sleep(1500); // Aç
    }
    return true;
  }

  async function setEvrakAdiFilter(term) {
    const cells = qAllMany(".ui-grid-header-cell");
    for (const cell of cells) {
      if (cell.innerText.toLowerCase().includes("evrak adı")) {
        const input = cell.querySelector("input");
        if(input) { fillInputAngularSafe(input, term); await sleep(800); return true; }
      }
    }
    return false;
  }

  async function downloadTescilBelge() {
    const { tp_download_clicked, tp_clicked_ara, tp_waiting_pdf_url } = await chrome.storage.local.get([
      "tp_download_clicked", "tp_clicked_ara", "tp_waiting_pdf_url"
    ]);

    if (tp_waiting_pdf_url) return true; 
    if (tp_download_clicked || isActionInProgress || !tp_clicked_ara) return true;
    if (isAdvancing) return true;
    if (!getAccordionClickable()) return false; 

    isActionInProgress = true;
    try {
        await ensureAccordionOpenAtStart();
        const aramaListesi = ["Marka Yenileme Belges", "MYB", "TB", "Tescil_belgesi_us"];
        
        for (const terim of aramaListesi) {
            console.log(TAG, `🔍 Filtre: ${terim}`);
            await setEvrakAdiFilter(terim);
            await sleep(1500);
            await ensureAccordionExpandedAfterFilter();

            const icons = qAllMany("i.fa-download").filter(el => el.offsetParent !== null);
            // Varsa 2. ikon, yoksa 1. ikon
            const targetIcon = icons.length >= 2 ? icons[1] : icons[0]; 

            if (targetIcon) {
                console.log(TAG, `✅ Dosya Bulundu: ${terim}`);
                
                // Durumu PDF Bekliyor olarak ayarla
                await chrome.storage.local.set({ tp_waiting_pdf_url: true });

                // 🔥 NAZİK TIKLAMA (Ctrl yok)
                superClick(targetIcon);
                
                // Timeout koruması (15 saniye)
                setTimeout(async () => {
                  const s = await chrome.storage.local.get(["tp_waiting_pdf_url", "tp_download_clicked"]);
                  if (s.tp_waiting_pdf_url && !s.tp_download_clicked) {
                    console.warn(TAG, "⏳ PDF Timeout. İlerle.");
                    await chrome.storage.local.set({ tp_waiting_pdf_url: false });
                    globalProcessingLock = false;
                    await advanceQueue();
                  }
                }, 15000);
                
                return true;
            }
        }
        
        searchPassCount++;
        if (searchPassCount >= 2) {
            console.log(TAG, "⚠️ Belge yok.");
            await advanceQueue(); 
        }
    } catch(e) { console.error(TAG, e); await advanceQueue(); } 
    finally { isActionInProgress = false; }
  }

  async function run() {
    if (isAdvancing) return;
    const continueProcess = await checkQueueAndSetAppNo();
    if (!continueProcess) return;

    const { tp_app_no, tp_clicked_ara, tp_download_clicked, tp_last_search_ts } = 
        await chrome.storage.local.get(["tp_app_no", "tp_clicked_ara", "tp_download_clicked", "tp_last_search_ts"]);
    if (!tp_app_no) return;

    if (isGirisPage()) {
      const btn = findLoginButtonOnGiris();
      if (btn) superClick(btn);
      return;
    }

    if (isBelgelerimScreenOpen()) {
      const okMarka = await ensureDosyaTuruMarka();
      if (!okMarka) return;

      const input = qAll("#textbox551 input");
      const currentVal = input ? (input.value || "").trim() : "";
      
      if (currentVal !== String(tp_app_no)) {
          await clearEvrakAdiFilter();
          await chrome.storage.local.set({
            tp_clicked_ara: false,
            tp_download_clicked: false,
            tp_waiting_pdf_url: false,
            tp_grid_ready: false
          });
          await fillBasvuruNo(tp_app_no);
          return; 
      }

      if (!tp_clicked_ara) {
          await clickAraButtonOnly();
          return;
      }

      if (tp_clicked_ara && (Date.now() - (tp_last_search_ts || 0) < 1500)) return;

      if (isPageBusy()) { console.log(TAG, "⏳ Sayfa meşgul..."); return; }

      const { tp_grid_ready, tp_prev_grid_sig } = await chrome.storage.local.get(["tp_grid_ready", "tp_prev_grid_sig"]);
      if (tp_clicked_ara && !tp_grid_ready) {
        await waitForGridToRefresh(tp_prev_grid_sig || "", 20000);
        await chrome.storage.local.set({ tp_grid_ready: true });
        return; 
      }

      if (tp_clicked_ara && tp_grid_ready && !tp_download_clicked && !isActionInProgress) {
        await downloadTescilBelge();
      }
      return;
    }

    await clickBelgelerim();
  }

  setInterval(() => run().catch(() => {}), 2000);
})();