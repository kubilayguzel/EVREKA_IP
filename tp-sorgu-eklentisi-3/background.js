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
    console.log("[BG] Kuyruk alındı.");

    chrome.storage.local.set(
      {
        tp_queue: request.queue,
        tp_is_queue_running: true,
        tp_queue_index: 0,
        tp_app_no: null,
      },
      () => {
        chrome.tabs.create(
          { url: "https://epats.turkpatent.gov.tr/run/TP/EDEVLET/giris" },
          async (tab) => {
            activeJobTabId = tab.id;
            // Ana sekmede content_script garanti
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

  // Guvenlik: ana is sekmesini asla PDF diye yakalayıp kapatma.
  if (tabId === activeJobTabId) return;

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

// Alternatif yol: PDF yeni sekme olarak acilmiyorsa (direkt download / XHR),
// content_script iconun en yakin <a> href'ini gonderebilir. Bu durumda
// background cookie'lerle fetch eder ve base64 olarak geri yollar.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action !== "FETCH_PDF_BASE64" || !request?.url) return;

  (async () => {
    try {
      const res = await fetch(request.url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      // Chunk'layarak string'e donustur (cok buyuk dosyalarda performans icin)
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      sendResponse({ ok: true, base64 });
    } catch (e) {
      console.warn("[BG] FETCH_PDF_BASE64 error:", e?.message || e);
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();

  return true;
});

// Alternatif yol: PDF yeni sekmede acilmiyor / direkt download oluyor olabilir.
// Bu durumda content_script, download linkini (href) bulup bize gonderebilir.
// Biz de session cookie ile fetch edip URL'yi ana sekmeye iletmeden direk byte olarak donebiliriz.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action !== "FETCH_PDF_BYTES" || !request?.url) return;

  (async () => {
    try {
      const res = await fetch(request.url, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);

      // base64 encode (chunked)
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      const b64 = btoa(binary);
      sendResponse({ ok: true, base64: b64 });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();

  return true;
});
