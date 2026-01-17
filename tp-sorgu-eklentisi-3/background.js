// background.js (PDF Sekme Yakalayıcı)

let activeJobTabId = null;

// Kuyruk başlatıldığında ana sekmenin ID'sini kaydet
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.action === "START_QUEUE") {
    console.log("[BG] Kuyruk alındı.");
    chrome.storage.local.set({
      tp_queue: request.queue,
      tp_is_queue_running: true,
      tp_queue_index: 0,
      tp_app_no: null
    }, () => {
      chrome.tabs.create({ url: "https://epats.turkpatent.gov.tr/run/TP/EDEVLET/giris" }, (tab) => {
        activeJobTabId = tab.id; // Ana sekmeyi takip et
      });
      sendResponse({ status: "started" });
    });
    return true;
  }
});

// Yeni açılan sekmeleri izle (PDF Yakalama)
chrome.tabs.onCreated.addListener((tab) => {
    // Sadece işlem sırasındaysak ve tab yeni açıldıysa
    if (!activeJobTabId) return;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Eğer işlemde değilsek çık
    if (!activeJobTabId) return;

    // URL değiştiyse veya sayfa yüklendiyse kontrol et
    if (changeInfo.status === 'loading' && tab.url) {
        // PDF mi veya Belge Görüntüleme URL'i mi?
        // Genelde: /run/TP/EDEVLET/pdf?id=... veya .pdf uzantısı
            if (
            tab.url.includes('/project/downloadfile/') ||   // ✅ EPATS gerçek download endpoint
            (tab.url.includes('/run/TP/') && tab.url.includes('pdf')) ||
            tab.url.endsWith('.pdf')
            // blob: istersen kalsın ama bu senaryoda gereksiz
            ) {
            console.log("[BG] PDF Sekmesi Yakalandı:", tab.url);

            // Ana sekmeye (Content Script'e) URL'i gönder
            chrome.tabs.sendMessage(
            activeJobTabId,
            { action: "PDF_URL_CAPTURED", url: tab.url },
            () => {
                if (chrome.runtime.lastError) {
                console.warn("[BG] sendMessage FAIL:", chrome.runtime.lastError.message);
                } else {
                console.log("[BG] sendMessage OK -> content_script");
                }
            }
            );

            // PDF sekmesini kapat (Ekran kirliliğini önle)
            // Biraz bekleyip kapatalım ki çakışma olmasın
            setTimeout(() => {
                chrome.tabs.remove(tabId).catch(() => {});
            }, 1000);
        }
    }
});