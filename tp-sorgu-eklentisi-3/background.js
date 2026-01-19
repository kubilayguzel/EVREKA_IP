// background.js (Final Optimized Version) - MV3

let activeJobTabId = null;

// PDF URL'ini ana sekmeye gönder
function sendPdfUrlToMainTab(url) {
  if (!activeJobTabId) return;

  console.log("[BG] PDF URL gönderiliyor:", url);

  // Ana sekmeye (Content Script'e) mesaj at
  chrome.tabs.sendMessage(
    activeJobTabId,
    { action: "PDF_URL_CAPTURED", url: url },
    (response) => {
      if (chrome.runtime.lastError) {
        // Ana sekme henüz hazır olmayabilir veya meşgul olabilir, bu normaldir.
        console.warn("[BG] Mesaj iletilemedi (Retrying might be needed):", chrome.runtime.lastError.message);
      } else {
        console.log("[BG] Content script mesajı aldı.");
      }
    }
  );
}

// 1. KUYRUK BAŞLATMA EMRİ (Web Sitesinden Gelir)
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.action === "START_QUEUE") {
    console.log("[BG] Kuyruk başlatılıyor...", request.queue.length, "adet işlem.");
    console.log("[BG] Hedef Upload URL:", request.uploadUrl);

    // Verileri Local Storage'a kaydet
    chrome.storage.local.set(
      {
        tp_queue: request.queue,
        tp_upload_url: request.uploadUrl, // 🔥 KRİTİK: Test/Prod ayrımı için gerekli
        tp_is_queue_running: true,
        tp_queue_index: 0,
        tp_app_no: null,
        
        // Bayrakları sıfırla
        tp_clicked_ara: false,
        tp_download_clicked: false
      },
      () => {
        // EPATS Giriş sayfasını yeni sekmede aç
        chrome.tabs.create(
          { url: "https://epats.turkpatent.gov.tr/run/TP/EDEVLET/giris" },
          (tab) => {
            activeJobTabId = tab.id; // Ana sekme ID'sini hafızaya al
            console.log("[BG] Ana sekme ID:", activeJobTabId);
          }
        );
        sendResponse({ status: "started" });
      }
    );

    return true; // Asenkron yanıt için gerekli
  }
});

// 2. PDF YAKALAMA (Tab Sniffer)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Aktif bir iş yoksa veya değişen sekme bizim ana sekmemizse (bunu kapatmamalıyız) işlem yapma
  if (!activeJobTabId || tabId === activeJobTabId) return;

  // Sayfa yükleniyor (loading) veya tamamlandı (complete) durumunda URL kontrolü yap
  if (tab.url) {
    // EPATS PDF URL Kalıpları
    const isPdfLike =
      tab.url.includes("/project/downloadfile/") ||
      (tab.url.includes("/run/TP/") && tab.url.includes("pdf")) ||
      tab.url.endsWith(".pdf") ||
      tab.url.startsWith("blob:"); // Bazen PDF'ler blob olarak açılır

    if (isPdfLike) {
      console.log("[BG] PDF Sekmesi Yakalandı:", tab.url);

      // A. URL'i ana sekmeye postala
      sendPdfUrlToMainTab(tab.url);

      // B. PDF sekmesini kapat (Ekran kirliliğini önle)
      // Biraz gecikmeli kapatıyoruz ki content script URL'i alabilsin
      setTimeout(() => {
        chrome.tabs.remove(tabId).catch(() => { /* Zaten kapanmışsa hata verme */ });
      }, 800);
    }
  }
});

// 3. TEMİZLİK (Opsiyonel)
// Eğer ana sekme kullanıcı tarafından kapatılırsa takibi bırak
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeJobTabId) {
    console.log("[BG] Ana işlem sekmesi kapatıldı. Takip durduruluyor.");
    activeJobTabId = null;
    // İsteğe bağlı: Kuyruğu durdurmak için storage'ı güncelleyebiliriz
    chrome.storage.local.set({ tp_is_queue_running: false });
  }
});