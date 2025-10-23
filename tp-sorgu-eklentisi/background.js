// TP - Marka Dosya Sorgu (background / service worker)
// İZİN YOK: sadece sekme açıyoruz. bn bilgisini URL hash ile geçiyoruz.

// Dış kaynaktan çağrı örneği:
// chrome.runtime.sendMessage(EXT_ID, { type: "SORGULA", data: "2024/123456" })
chrome.runtime.onMessageExternal.addListener((req, sender, sendResponse) => {
  if (!req || req.type !== "SORGULA" || !req.data) return;
  const bn = String(req.data).trim();
  if (!bn) return;

  const url = "https://opts.turkpatent.gov.tr/trademark#bn=" + encodeURIComponent(bn);

  chrome.tabs.create({ url }, (tab) => {
    if (!tab) {
      sendResponse?.({ status: "ERR", reason: "Sekme açılamadı" });
      return;
    }
    sendResponse?.({ status: "OK" });
  });

  return true; // async response
});
