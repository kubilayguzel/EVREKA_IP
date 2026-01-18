// background.js (Final Optimized Version) - MV3

let activeJobTabId = null;

// Sadece ilk başlatmada scripti yükle
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content_script.js"],
    });
    console.log("[BG] content_script injected initially on tab:", tabId);
  } catch (e) {
    console.warn("[BG] inject warning:", e?.message || e);
  }
}

// PDF URL'ini ana sekmeye gönder (Tekrar inject ETMEDEN)
function sendPdfUrlToMainTab(url) {
  if (!activeJobTabId) return;

  console.log("[BG] PDF URL gönderiliyor:", url);

  chrome.tabs.sendMessage(
    activeJobTabId,
    { action: "PDF_URL_CAPTURED", url },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[BG] Mesaj gönderilemedi (Script hazır olmayabilir):", chrome.runtime.lastError.message);
      } else {
        console.log("[BG] Mesaj başarıyla iletildi:", response);
      }
    }
  );
}

// Kuyruk başlatıldığında
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.action === "START_QUEUE") {
    console.log("[BG] Kuyruk başlatılıyor...");

    chrome.storage.local.set(
      {
        tp_queue: request.queue,
        tp_is_queue_running: true,
        tp_queue_index: 0,
        tp_app_no: null,
        // Temiz başlangıç için diğer flagleri de sıfırla
        tp_clicked_ara: false,
        tp_download_clicked: false,
        tp_waiting_pdf_url: false
      },
      () => {
        chrome.tabs.create(
          { url: "https://epats.turkpatent.gov.tr/run/TP/EDEVLET/giris" },
          async (tab) => {
            activeJobTabId = tab.id;
            // Scripti SADECE BURADA bir kez inject ediyoruz
            await ensureContentScript(activeJobTabId);
          }
        );
        sendResponse({ status: "started" });
      }
    );

    return true;
  }
});

// PDF Yakalama (Sniffer)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Aktif bir iş yoksa veya kendi ana sekmemizse işlem yapma
  if (!activeJobTabId || tabId === activeJobTabId) return;

  if (changeInfo.status === "complete" && tab.url) {
    const isPdfLike =
      tab.url.includes("/project/downloadfile/") ||
      (tab.url.includes("/run/TP/") && tab.url.includes("pdf")) ||
      tab.url.endsWith(".pdf");

    if (isPdfLike) {
      console.log("[BG] PDF Sekmesi Yakalandı:", tab.url);

      // 1. URL'i ana sekmeye gönder
      sendPdfUrlToMainTab(tab.url);

      // 2. PDF sekmesini kapat (Kullanıcı görmeden)
      setTimeout(() => {
        chrome.tabs.remove(tabId).catch(() => {});
      }, 500);
    }
  }
});