// background.js (PDF Sekme Yakalayıcı) - MV3 önerilen

let activeJobTabId = null;

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content_script.js"],
    });
    console.log("[BG] content_script injected/ensured on tab:", tabId);
  } catch (e) {
    // Script zaten yüklüyse bazen hata atabilir; yine de mesaj deneyeceğiz
    console.warn("[BG] inject warning:", e?.message || e);
  }
}

async function sendPdfUrlToMainTab(url) {
  if (!activeJobTabId) return;

  // 1) content_script var mı garanti et
  await ensureContentScript(activeJobTabId);

  // 2) Mesajı gönder (1 kez retry ile)
  chrome.tabs.sendMessage(
    activeJobTabId,
    { action: "PDF_URL_CAPTURED", url },
    async (resp) => {
      if (chrome.runtime.lastError) {
        console.warn("[BG] sendMessage FAIL:", chrome.runtime.lastError.message);

        // Retry: bir kez daha inject + send
        await ensureContentScript(activeJobTabId);

        chrome.tabs.sendMessage(
          activeJobTabId,
          { action: "PDF_URL_CAPTURED", url },
          (resp2) => {
            if (chrome.runtime.lastError) {
              console.warn("[BG] sendMessage RETRY FAIL:", chrome.runtime.lastError.message);
            } else {
              console.log("[BG] sendMessage RETRY OK:", resp2);
            }
          }
        );

      } else {
        console.log("[BG] sendMessage OK:", resp);
      }
    }
  );
}

// Kuyruk başlatıldığında ana sekmenin ID'sini kaydet
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.action === "START_QUEUE") {

    const fallbackUrl =
      "https://europe-west1-ip-manager-production-aab4b.cloudfunctions.net/saveEpatsDocument";

    chrome.storage.local.set(
      {
        tp_queue: request.queue,
        tp_is_queue_running: true,
        tp_queue_index: 0,
        tp_app_no: null,

        // ✅ EKLE: UI’dan gelen url’yi sakla (yoksa fallback)
        tp_upload_url: request.uploadUrl || fallbackUrl,
      },
      () => {
        chrome.tabs.create(
          { url: "https://epats.turkpatent.gov.tr/run/TP/EDEVLET/giris" },
          async (tab) => {
            activeJobTabId = tab.id;
            await ensureContentScript(activeJobTabId);
          }
        );
        sendResponse({ status: "started" });
      }
    );

    return true;
  }
});


// PDF Yakalama
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!activeJobTabId) return;

  if (changeInfo.status === "complete" && tab.url) {
    const isPdfLike =
      tab.url.includes("/project/downloadfile/") ||
      (tab.url.includes("/run/TP/") && tab.url.includes("pdf")) ||
      tab.url.endsWith(".pdf");

    if (isPdfLike) {
      console.log("[BG] PDF Sekmesi Yakalandı:", tab.url);

      // Ana sekmeye URL'i gönder
      sendPdfUrlToMainTab(tab.url);

      // PDF sekmesini kapat
      setTimeout(() => {
        chrome.tabs.remove(tabId).catch(() => {});
      }, 800);
    }
  }
});
