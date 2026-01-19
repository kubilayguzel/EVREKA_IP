// background.js (Final + Robust Capture)

let activeJobTabId = null;

// PDF URL'ini ana sekmeye gönder
function sendPdfUrlToMainTab(url) {
  if (!activeJobTabId) return;
  console.log("[BG] PDF URL Tespit Edildi:", url);

  chrome.tabs.sendMessage(
    activeJobTabId,
    { action: "PDF_URL_CAPTURED", url: url },
    () => { if (chrome.runtime.lastError) { /* Ana sekme meşgul olabilir, sorun yok */ } }
  );
}

// URL Kontrolü
function checkForPdf(url, tabId) {
    if (!url) return;
    const isPdfLike =
      url.includes("/project/downloadfile/") ||
      (url.includes("/run/TP/") && url.includes("pdf")) ||
      url.endsWith(".pdf") ||
      url.startsWith("blob:");

    if (isPdfLike) {
      sendPdfUrlToMainTab(url);
      // Sekmeyi biraz bekleyip kapat
      setTimeout(() => { chrome.tabs.remove(tabId).catch(() => {}); }, 1500);
    }
}

// 1. KUYRUK BAŞLATMA
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.action === "START_QUEUE") {
    console.log("[BG] Kuyruk başlatılıyor...", request.queue.length);
    chrome.storage.local.set({
        tp_queue: request.queue,
        tp_upload_url: request.uploadUrl,
        tp_is_queue_running: true,
        tp_queue_index: 0,
        tp_app_no: null,
        tp_clicked_ara: false,
        tp_download_clicked: false,
        tp_waiting_pdf_url: false,
        tp_grid_ready: false
      }, () => {
        chrome.tabs.create({ url: "https://epats.turkpatent.gov.tr/run/TP/EDEVLET/giris" }, (tab) => {
            activeJobTabId = tab.id;
        });
        sendResponse({ status: "started" });
      });
    return true; 
  }
});

// 2. SEKME GÜNCELLENDİĞİNDE
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!activeJobTabId || tabId === activeJobTabId) return;
  if (tab.url) checkForPdf(tab.url, tabId);
});

// 3. YENİ SEKME OLUŞTURULDUĞUNDA (Hızlı yakalama)
chrome.tabs.onCreated.addListener((tab) => {
    if (!activeJobTabId) return;
    if (tab.url) checkForPdf(tab.url, tab.id);
});

// 4. TEMİZLİK
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeJobTabId) {
    activeJobTabId = null;
    chrome.storage.local.set({ tp_is_queue_running: false });
  }
});