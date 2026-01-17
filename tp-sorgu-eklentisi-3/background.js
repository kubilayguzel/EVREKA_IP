// background.js

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.action === "START_QUEUE") {
    console.log("[BG] Kuyruk alındı:", request.queue);
    
    // Kuyruğu ve başlangıç durumunu kaydet
    chrome.storage.local.set({
      tp_queue: request.queue,
      tp_is_queue_running: true,
      tp_queue_index: 0,
      tp_app_no: null // Mevcut aramayı sıfırla
    }, () => {
      // EPATS Giriş sayfasını aç (Zaten açıksa refresh edebilir veya yeni sekme açabilir)
      chrome.tabs.create({ url: "https://epats.turkpatent.gov.tr/run/TP/EDEVLET/giris" });
      sendResponse({ status: "started", count: request.queue.length });
    });
    
    return true; // Asenkron yanıt için
  }
});