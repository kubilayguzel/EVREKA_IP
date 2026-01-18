// content_script.js (Final + Queue + Backend Upload)
(() => {
  const TAG = "[TP-AUTO]";
  let isActionInProgress = false; 
  let searchPassCount = 0; // Tarama tur sayısı

  console.log("[TP-AUTO] content_script loaded on:", location.href);

  // Background'dan PDF URL yakalandı mesajı gelince işle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action === "PDF_URL_CAPTURED" && request?.url) {
    sendResponse({ ok: true }); // port kapanmasın

    (async () => {
      const state = await chrome.storage.local.get([
        "tp_waiting_pdf_url",
        "tp_download_clicked",
        "tp_queue_index",
        "tp_current_job_id",
        "tp_app_no"
      ]);

      console.log(TAG, "PDF_URL_CAPTURED state:", state, "url:", request.url);

      // ✅ Sadece gerçekten PDF bekliyorsak işleyelim
      if (!state.tp_waiting_pdf_url) {
        console.warn(TAG, "PDF geldi ama beklemiyorum -> IGNORE", request.url);
        return;
      }

      // ✅ Aynı işte ikinci kez geldiyse ignore
      if (state.tp_download_clicked) {
        console.warn(TAG, "PDF geldi ama zaten indirildi -> IGNORE", request.url);
        return;
      }

      await chrome.storage.local.set({
        tp_download_clicked: true,
        tp_waiting_pdf_url: false
      });

      await processDocument(request.url, null);
    })().catch(err => console.error(TAG, "PDF_URL_CAPTURED handler error:", err));

    return true;
  }
});

  if (window.top !== window) return; // Sadece ana frame çalışsın
  
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- AYARLAR ---
  // Cloud Function URL'nizi buraya yazın (Firebase Functions Console'dan alabilirsiniz)
  const UPLOAD_ENDPOINT = "https://europe-west1-ip-manager-production-aab4b.cloudfunctions.net/saveEpatsDocument";

  // ---------- KUYRUK VE RESET MANTIĞI ----------
  
  document.addEventListener("TP_RESET", async () => {
    try {
      await chrome.storage.local.clear();
      console.log(TAG, "RESET OK (storage cleared).");
    } catch (e) { console.log(TAG, "RESET FAILED:", e); }
  });

  // Kuyruktan sıradaki işi alıp tp_app_no'ya atar
  async function checkQueueAndSetAppNo() {
    const data = await chrome.storage.local.get(["tp_queue", "tp_is_queue_running", "tp_queue_index", "tp_app_no"]);
    
    // Kuyruk modu kapalıysa veya boşsa normal tekil moda devam et
    if (!data.tp_is_queue_running || !data.tp_queue || data.tp_queue.length === 0) {
      return true; 
    }

    const currentIndex = data.tp_queue_index || 0;
    
    // Kuyruk bitti mi?
    if (currentIndex >= data.tp_queue.length) {
      console.log(TAG, "🏁 Kuyruk tamamlandı!");
      await chrome.storage.local.set({ tp_is_queue_running: false, tp_queue: [] });
      alert("Toplu işlem tamamlandı!");
      return false; // Döngüyü durdur
    }

    // Sıradaki işi al
    const currentJob = data.tp_queue[currentIndex];
    
    // Eğer şu anki hafızadaki no farklıysa güncelle (Yeni işe başla)
    if (data.tp_app_no !== currentJob.appNo) {
      console.log(TAG, `🔄 Yeni İş Başlıyor: ${currentIndex + 1}/${data.tp_queue.length} - No: ${currentJob.appNo}`);
      
      // Önceki işlemin durum bayraklarını sıfırla
      await chrome.storage.local.set({
        tp_app_no: currentJob.appNo,
        tp_current_job_id: currentJob.ipId, // Backend'e IP ID'si lazım
        tp_current_doc_type: currentJob.docType, // Backend'e Belge Tipi lazım
        tp_clicked_ara: false,
        tp_download_clicked: false,
        tp_expanded_twice: false
      });
      
      // Arama kutusunu temizlemek için sayfayı yenilemek en garantisi (bazı durumlarda)
      // Ancak akışı hızlandırmak için sadece inputu değiştirmeyi deniyoruz.
      // Eğer takılırsa location.reload() eklenebilir.
      searchPassCount = 0; // Tur sayacını sıfırla
      console.log(TAG, "QUEUE STATE:", {
        idx: currentIndex,
        appNo: currentJob?.appNo,
        ipId: currentJob?.ipId,
        storedAppNo: data.tp_app_no
      });

      return true;
    }
    
    return true;
  }

  async function advanceQueue() {
    const data = await chrome.storage.local.get(["tp_queue_index"]);
    const nextIndex = (data.tp_queue_index || 0) + 1;
    
    console.log(TAG, "✅ İşlem tamam, kuyruk ilerletiliyor...");
    await chrome.storage.local.set({ 
      tp_queue_index: nextIndex,
      tp_app_no: null,
      tp_download_clicked: false,
      tp_clicked_ara: false,
      tp_waiting_pdf_url: false,  // ✅ EKLE
      tp_expanded_twice: false    // ✅ EKLE (temizlik)
    });
    location.reload();

  }

  // ---------- PDF İŞLEME VE BACKEND TRANSFERİ ----------

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onloadend = () => {
      try {
        const res = String(reader.result || "");
        resolve(res.split(",")[1] || "");
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsDataURL(blob);
  });
}

// PDF linkini alır, indirir ve sunucuya gönderir
async function processDocument(downloadUrl, element) {
  console.log(TAG, "📄 Belge bulundu, işleniyor:", downloadUrl);
  if (element) element.style.color = "orange";

  try {
    // 1) PDF'i çek
    const response = await fetch(downloadUrl, { credentials: "include" });
    console.log(TAG, "PDF fetch:", response.status, response.headers.get("content-type"));
    if (!response.ok) throw new Error("PDF fetch failed: " + response.status);

    const blob = await response.blob();
    console.log(TAG, "PDF size:", blob.size);
    if (!blob.size) throw new Error("PDF blob boş geldi");

    // 2) Base64
    const base64data = await blobToBase64(blob);
    if (!base64data || base64data.length < 1000) {
      throw new Error("Base64 çok kısa/boş: " + (base64data?.length || 0));
    }

    // 3) ipRecordId/docType al
    const storage = await chrome.storage.local.get(["tp_current_job_id", "tp_current_doc_type"]);

    const payload = {
      ipRecordId: storage.tp_current_job_id,
      fileBase64: base64data,
      fileName: "Tescil_Belgesi.pdf",
      mimeType: "application/pdf",
      docType: storage.tp_current_doc_type || "tescil_belgesi",
    };

    console.log(TAG, "📤 Sunucuya yükleniyor...", payload.ipRecordId);

    // 4) Upload
    const uploadRes = await fetch(UPLOAD_ENDPOINT, {
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
    // ✅ Hangi durumda olursa olsun kuyruk ilerlesin
    await advanceQueue();
  }
}


  // ---------- DOC HELPERS ----------
  function getAllDocs() {
    const docs = [document];
    const frames = Array.from(document.querySelectorAll("iframe"));
    for (const fr of frames) {
      try { const d = fr.contentDocument; if (d) docs.push(d); } catch {}
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

  function superClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch {}
    try {
      const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) =>
        el.dispatchEvent(new MouseEvent(t, opts))
      );
      return true;
    } catch {
      try { el.click(); return true; } catch {}
    }
    return false;
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

  // ---------- EPATS SPECIFIC ----------
  
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
  
  function isBelgelerimScreenOpen() {
    return (!!qAll("div.ui-select-container[name='selectbox550']") || !!qAll("#textbox551 input") || !!qAll("#button549"));
  }

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
    if (!(await throttle("tp_last_belgelerim_try", 2000))) return false;
    // ... (Aynen korundu: Frame ve main içinde ara)
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
    if (!container.classList.contains("open")) {
        superClick(toggle);
        await sleep(200);
    }
    
    // "Marka" seçeneğini bul ve tıkla
    const rows = qAllMany(".ui-select-choices-row, li[role='option']");
    const markaRow = rows.find(el => (el.textContent || "").toLowerCase().includes("marka"));
    if (markaRow) { superClick(markaRow); await sleep(300); return isMarkaSelectedNow(); }
    return false;
  }

  async function fillBasvuruNo(appNo) {
    const input = qAll("#textbox551 input");
    console.log(TAG, "fillBasvuruNo", { from: input.value, to: String(appNo) });
    if (!input) return false;
    if ((input.value || "").trim() !== String(appNo)) {
      fillInputAngularSafe(input, String(appNo));
      await sleep(200);
    }
    return true;
  }

  // --- AKORDEON & FİLTRELEME (GÜNCEL) ---
  function getAccordionHost() { return qAll("div.ui-grid-tree-base-row-header-buttons"); }
  
  function getAccordionClickable() {
    const host = getAccordionHost();
    return host ? (host.querySelector("i") || host) : null;
  }

  // plus / minus / unknown
  function readAccordionState() {
    const host = getAccordionHost();
    if (!host) return "none";
    const icon = host.querySelector("i");
    const cls = (icon?.className || host.className || "").toLowerCase();
    
    if (cls.includes("minus")) return "minus"; // Açık
    if (cls.includes("plus")) return "plus";   // Kapalı
    return "unknown";
  }

  async function ensureAccordionOpenAtStart() {
    // Sadece ilk seferde çalışır, akordeonu açar
    const state = readAccordionState();
    if (state === "minus") return true; // Zaten açık

    const clickable = getAccordionClickable();
    if(clickable) {
        superClick(clickable);
        await sleep(1500); // Açılmasını bekle
    }
    return readAccordionState() === "minus";
  }

  async function ensureAccordionExpandedAfterFilter() {
    // Filtrelemeden sonra tablo yenilenir, akordeon durumunu kontrol et
    await sleep(500);
    const state = readAccordionState();
    const clickable = getAccordionClickable();
    
    if (!clickable) return false;

    if (state === "plus") { // Kapalıysa aç (1 tık)
        superClick(clickable);
        await sleep(1000);
    } else if (state === "minus") { // Açıksa kapat-aç (tazele - 2 tık)
        superClick(clickable); // Kapat
        await sleep(500);
        superClick(clickable); // Aç
        await sleep(1000);
    }
    return true;
  }

  function findEvrakAdiFilterInput() {
    const headerCells = qAllMany(".ui-grid-header-cell");
    for (const cell of headerCells) {
      if ((cell.innerText || "").trim().toLowerCase() === "evrak adı") {
        return cell.querySelector("input.ui-grid-filter-input");
      }
    }
    return null;
  }

  async function setEvrakAdiFilter(term) {
    const input = findEvrakAdiFilterInput();
    if (!input) return false;
    if ((input.value || "").trim() !== term) {
      fillInputAngularSafe(input, term);
      await sleep(500);
    }
    return true;
  }

  function findDownloadIcon() {
    // Görünür olan ilk indirme ikonunu bul
    const icons = qAllMany("i.fa-download").filter(el => el.offsetParent !== null);
    return icons[1] || null;
  }

  // --- İNDİRME VE İŞLEME MANTIĞI ---
  async function downloadTescilBelge() {
    const { tp_download_clicked, tp_clicked_ara } = await chrome.storage.local.get(["tp_download_clicked", "tp_clicked_ara"]);
    
    // Güvenlik kontrolleri
    if (tp_download_clicked || isActionInProgress || !tp_clicked_ara) return true;
    if (!getAccordionHost()) return false; // Tablo henüz yok

    isActionInProgress = true;

    try {
        // 1. Akordeonu Aç (Sadece ilk girişte)
        await ensureAccordionOpenAtStart();

        // 2. Kriter Listesi
        const aramaListesi = ["Marka Yenileme Belges", "MYB", "TB", "Tescil_belgesi_us"];
        
        for (const terim of aramaListesi) {
            console.log(TAG, `🔍 Kriter: ${terim}`);
            
            // Filtreyi uygula
            await setEvrakAdiFilter(terim);
            await sleep(1000); // Filtreleme beklemesi

            // Akordeonu tazele (Kapat-Aç gerekebilir)
            await ensureAccordionExpandedAfterFilter();

            // İkon ara
            const targetIcon = findDownloadIcon();
            
            if (targetIcon) {
                // İndirme (İşleme) bulundu
                console.log(TAG, `✅ BULUNDU: ${terim}`);
                await chrome.storage.local.set({ tp_waiting_pdf_url: true });
                superClick(targetIcon);


                // PDF yakalama bekleniyor; sakın advanceQueue çağırma.
                await sleep(800);

                // Güvenlik: eğer background yakalayamazsa 10 sn sonra failover
                setTimeout(async () => {
                  const { tp_waiting_pdf_url, tp_download_clicked } =
                    await chrome.storage.local.get(["tp_waiting_pdf_url", "tp_download_clicked"]);

                if (tp_waiting_pdf_url && !tp_download_clicked) {
                  console.warn(TAG, "⏳ PDF URL yakalanamadı (timeout). Kuyruk ilerletiliyor.");
                  await chrome.storage.local.set({ tp_waiting_pdf_url: false });
                  await advanceQueue();
                }

                }, 12000);
                return true;

            }
        }
        
        // Hiçbir kriterle bulunamadı
        searchPassCount++;
        if (searchPassCount >= 2) {
            console.log(TAG, "⚠️ Belge bulunamadı, pas geçiliyor.");
            await advanceQueue(); // Bir sonrakine geç
        }

    } catch(e) {
        console.error(TAG, e);
        // Hata durumunda da kuyruğu tıkamamak için geç
        await advanceQueue(); 
    } finally {
        isActionInProgress = false;
    }
  }

  // --- ANA DÖNGÜ ---
  async function run() {
    // 1. Kuyruk Kontrolü
    const continueProcess = await checkQueueAndSetAppNo();
    if (!continueProcess) return;

    // 2. Hafızadaki Numarayı Al
    const { tp_app_no } = await chrome.storage.local.get(["tp_app_no"]);
    if (!tp_app_no) return;

    // 3. Giriş Sayfası mı?
    if (isGirisPage()) {
      const btn = findLoginButtonOnGiris();
      if (btn) superClick(btn);
      return;
    }

    // 4. Belgelerim Ekranı Açık mı?
    if (isBelgelerimScreenOpen()) {
      const okMarka = await ensureDosyaTuruMarka();
      if (!okMarka) return;

      const okNo = await fillBasvuruNo(tp_app_no);
      if (!okNo) return;

      const okAra = await clickAraButtonOnly();
      if (!okAra) return;

      // Ara tıklandıysa ve henüz işlenmediyse
      const { tp_clicked_ara, tp_download_clicked } = await chrome.storage.local.get(["tp_clicked_ara", "tp_download_clicked"]);
      if (tp_clicked_ara && !tp_download_clicked && !isActionInProgress) {
        await downloadTescilBelge();
      }
      return;
    }

    // 5. Belgelerim'e Tıkla
    await clickBelgelerim();
  }

  // Döngüyü Başlat
  setInterval(() => run().catch(() => {}), 1500);

})();