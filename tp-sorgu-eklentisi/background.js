// TP - Marka Dosya Sorgu (background / service worker)
// Başvuru numarasını sekme açtıktan sonra content script'e gönderiyoruz

chrome.runtime.onMessageExternal.addListener((req, sender, sendResponse) => {
  if (!req || req.type !== "SORGULA" || !req.data) return;
  const bn = String(req.data).trim();
  if (!bn) return;

  console.log('[TP Background] Başvuru numarası alındı:', bn);

  // Direkt opts.turkpatent.gov.tr/trademark sayfasını hash ile aç
  const url = "https://opts.turkpatent.gov.tr/trademark#bn=" + encodeURIComponent(bn);

  chrome.tabs.create({ url }, (tab) => {
    if (!tab) {
      sendResponse?.({ status: "ERR", reason: "Sekme açılamadı" });
      return;
    }
    
    console.log('[TP Background] Sekme açıldı, content script mesajı bekleniyor...');
    
    // Sekmenin yüklenmesini izle
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        console.log('[TP Background] Sayfa yüklendi, content script\'e mesaj gönderiliyor...');
        
        // Birkaç saniye bekle, sonra mesaj gönder
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, {
            type: 'AUTO_FILL_FROM_BACKGROUND',
            data: bn
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.log('[TP Background] Content script henüz hazır değil:', chrome.runtime.lastError.message);
            } else {
              console.log('[TP Background] Content script yanıtı:', response);
            }
          });
        }, 1500);
        
        chrome.tabs.onUpdated.removeListener(listener);
      }
    };
    
    chrome.tabs.onUpdated.addListener(listener);
    sendResponse?.({ status: "OK" });
  });

  return true; // async response
});