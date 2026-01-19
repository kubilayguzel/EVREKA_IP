// content_script.js (Düzeltilmiş Versiyon: PDF Kaydetme Sorunu Giderildi)
(() => {
  // --- SINGLETON CHECK ---
  if (window.TP_SCRIPT_ALREADY_LOADED) {
      console.log("[TP-AUTO] ♻️ Script zaten yüklü.");
      return; 
  }
  window.TP_SCRIPT_ALREADY_LOADED = true;

  const TAG = "[TP-AUTO]";
  
  // --- STATE ---
  let isActionInProgress = false; 
  let searchPassCount = 0; 
  let globalProcessingLock = false; 
  let isAdvancing = false;          
  let lastProcessedUrl = null;      

  console.log("[TP-AUTO] Content script loaded:", location.href);

  // --- 1. MESAJ DİNLEYİCİSİ ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action === "PDF_URL_CAPTURED" && request?.url) {
      sendResponse({ ok: true }); 

      if (request.url === lastProcessedUrl) return; 
      if (globalProcessingLock || isAdvancing) return; 

      globalProcessingLock = true;
      lastProcessedUrl = request.url;

      (async () => {
        try {
          const state = await chrome.storage.local.get(["tp_waiting_pdf_url", "tp_download_clicked"]);
          
          // Eğer sistem PDF beklemiyorsa reddet
          if (!state.tp_waiting_pdf_url) {
            console.warn(TAG, "⚠️ Beklenmeyen PDF isteği reddedildi.", request.url);
            globalProcessingLock = false; 
            return;
          }

          // İndirildi olarak işaretle
          await chrome.storage.local.set({ tp_download_clicked: true, tp_waiting_pdf_url: false });
          
          // İşlemeyi başlat
          await processDocument(request.url, null);
        } catch (err) {
          console.error(TAG, "Hata:", err);
          globalProcessingLock = false; 
        }
      })();
      return true;
    }
  });

  if (window.top !== window) return;
  
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


  // --- KUYRUK KONTROL ---
  document.addEventListener("TP_RESET", async () => {
    try { await chrome.storage.local.clear(); } catch {}
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
        tp_waiting_pdf_url: false // Yeni işe başlarken bekleme modunu sıfırla
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
    console.log(TAG, "✅ İşlem bitti, ilerleniyor...");

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
          tp_grid_ready: false,
          tp_prev_grid_sig: null,
          tp_expanded_twice: false,
          tp_last_belgelerim_try: 0,
          tp_last_search_ts: 0
        });

        console.log(TAG, `🔓 Sıradaki İndeks: ${nextIndex}`);
        globalProcessingLock = false; 
        isActionInProgress = false;
        await sleep(2000); 
    } catch (e) { console.error(TAG, e); } 
    finally { isAdvancing = false; }
  }

  // --- PDF PROCESS ---
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onloadend = () => resolve((reader.result || "").split(",")[1] || "");
      reader.readAsDataURL(blob);
    });
  }

// PDF linkini alır, indirir ve sunucuya gönderir
  async function processDocument(downloadUrl, element) {
     console.log(TAG, "📄 Belge işleniyor (Fetch)...", downloadUrl);
     if(element) element.style.color = "orange";

     try {
        const response = await fetch(downloadUrl);
        const blob = await response.blob();
        
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        
        reader.onloadend = async () => {
            const base64data = reader.result.split(',')[1];
            
            // 🔥 DEĞİŞİKLİK BURADA: 'tp_upload_url' parametresini de istiyoruz
            const storage = await chrome.storage.local.get(["tp_current_job_id", "tp_current_doc_type", "tp_upload_url"]);
            
            // Dinamik URL kontrolü
            const dynamicEndpoint = storage.tp_upload_url;
            if (!dynamicEndpoint) {
                console.error(TAG, "❌ HATA: Hedef Upload URL (tp_upload_url) bulunamadı!");
                alert("Hata: Sistem hedef adresi bulamadı. Sayfayı yenileyip tekrar deneyin.");
                return;
            }

            const payload = {
                ipId: storage.tp_current_job_id,
                fileContent: base64data,
                fileName: "Tescil_Belgesi.pdf",
                mimeType: "application/pdf",
                docType: storage.tp_current_doc_type || "tescil_belgesi"
            };

            console.log(TAG, "📤 Sunucuya yükleniyor ->", dynamicEndpoint);
            
            // 🔥 DEĞİŞİKLİK BURADA: Sabit değişken yerine 'dynamicEndpoint' kullanıyoruz
            const uploadRes = await fetch(dynamicEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: payload }) 
            });

            if (uploadRes.ok) {
                console.log(TAG, "✅ Yükleme Başarılı!");
                if(element) element.style.color = "green";
                await advanceQueue();
            } else {
                console.error(TAG, "❌ Yükleme Hatası:", await uploadRes.text());
                if(element) element.style.color = "red";
                await advanceQueue(); 
            }
        };

     } catch (error) {
         console.error(TAG, "Process hatası:", error);
         await advanceQueue();
     }
  }

  // --- DOM HELPERS ---
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
  function superClick(el) {
    if (!el) return false;
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

  // --- GRID HELPERS ---
  function getGridHost() {
    return (
      qAll(".ui-grid-render-container-body") ||
      qAll(".ui-grid-viewport") ||
      qAll(".ui-grid-canvas")
    );
  }

  function getFirstRowText() {
    const row = qAllMany(".ui-grid-row").find(r => r.offsetParent !== null);
    return (row?.innerText || "").trim();
  }

  function getGridSignature() {
    const host = getGridHost();
    const hostText = (host?.innerText || "").trim();
    const firstRow = getFirstRowText();
    const compact = (firstRow || hostText).replace(/\s+/g, " ").slice(0, 200);
    const rowCount = qAllMany(".ui-grid-row").filter(r => r.offsetParent !== null).length;
    return `${rowCount}|${compact}`;
  }

  async function waitForGridToRefresh(prevSig, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isPageBusy()) { await sleep(400); continue; }
      const sig = getGridSignature();
      if (sig && sig !== prevSig && !sig.startsWith("0|")) return true;
      await sleep(400);
    }
    console.warn(TAG, "⚠️ Grid yenilenmesi zaman aşımı.");
    return false;
  }

  async function clearEvrakAdiFilter() {
    const cells = qAllMany(".ui-grid-header-cell");
    for (const cell of cells) {
      if (cell.innerText.toLowerCase().includes("evrak adı")) {
        const input = cell.querySelector("input");
        if (input && (input.value || "").trim() !== "") {
          fillInputAngularSafe(input, "");
          await sleep(300);
        }
        return true;
      }
    }
    return false;
  }

  function isPageBusy() {
    const busySelectors = [
        ".modal-backdrop", ".block-ui-overlay", ".block-ui-message-container",
        ".loading-spinner", ".fa-spinner", ".fa-refresh.fa-spin",
        "div[ng-show='isLoading']", ".ui-grid-icon-spin"
    ];
    const els = qAllMany(busySelectors.join(","));
    if (els.some(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    })) return true;

    const messageContainers = qAllMany(".modal-content, .alert, .growl-message, .block-ui-message");
    if (messageContainers.some(el => {
        const text = (el.innerText || "").toLowerCase();
        const style = window.getComputedStyle(el);
        return (style.display !== 'none' && style.visibility !== 'hidden') && 
               (text.includes("bekleyiniz") || text.includes("yükleniyor") || text.includes("aranıyor"));
    })) return true;

    return false;
  }

  // --- EPATS UI ---
  async function clickAraButtonOnly() {
    const { tp_clicked_ara } = await chrome.storage.local.get(["tp_clicked_ara"]);
    if (tp_clicked_ara) return true; 

    const prevSig = getGridSignature();
    const root = qAll("#button549");
    if (!root) return false;
    const btn = root.querySelector("div.btn[ng-click]") || root.querySelector(".btn");
    
    if (!btn || btn.hasAttribute("disabled") || btn.classList.contains("disabled")) {
        console.log(TAG, "⏳ Ara butonu pasif, bekleniyor...");
        return false;
    }

    console.log(TAG, "🔎 Ara butonuna basılıyor...");
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

  // --- ACCORDION & DOWNLOAD ---
  function getAccordionHost() { return qAll("div.ui-grid-tree-base-row-header-buttons"); }
  
  function getAccordionClickable() {
    const host = getAccordionHost();
    if (!host || host.offsetParent === null) return null; 
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
        superClick(clickable); await sleep(800);
        superClick(clickable); await sleep(1500);
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
      "tp_download_clicked",
      "tp_clicked_ara",
      "tp_waiting_pdf_url"
    ]);

    if (tp_waiting_pdf_url) return true; // Zaten bekliyorsak işlem yapma
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
            const targetIcon = icons[1] || icons[0]; 

            if (targetIcon) {
                console.log(TAG, `✅ Dosya Bulundu: ${terim}`);
                
                // 1) Önce durumu güncelle: PDF bekleniyor
                await chrome.storage.local.set({ tp_waiting_pdf_url: true });

                // 2) Sadece tıklama yap, href yakalamaya çalışma
                superClick(targetIcon);
                
                // 3) Timeout koruması (12 saniye sonra gelmezse atla)
                setTimeout(async () => {
                  const s = await chrome.storage.local.get(["tp_waiting_pdf_url", "tp_download_clicked"]);
                  if (s.tp_waiting_pdf_url && !s.tp_download_clicked) {
                    console.warn(TAG, "⏳ PDF Timeout. Geçiliyor.");
                    await chrome.storage.local.set({ tp_waiting_pdf_url: false });
                    globalProcessingLock = false;
                    await advanceQueue();
                  }
                }, 12000);
                
                return true;
            }
        }
        
        searchPassCount++;
        if (searchPassCount >= 2) {
            console.log(TAG, "⚠️ Belge yok, geçiliyor.");
            await advanceQueue(); 
        }
    } catch(e) { console.error(TAG, e); await advanceQueue(); } 
    finally { isActionInProgress = false; }
  }

  // --- ANA DÖNGÜ ---
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

      if (isPageBusy()) {
        console.log(TAG, "⏳ Sayfa meşgul, bekleniyor...");
        return;
      }

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