// Web sitenizden gelen mesajları dinle
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.type === 'SORGULA_KISI' && request.data) {
    const ownerId = request.data;
    const targetUrl = "https://www.turkpatent.gov.tr/arastirma-yap?form=trademark";

    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      const listener = (tabId, changeInfo, tab) => {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.sendMessage(tabId, {
            type: 'AUTO_FILL_KISI',
            data: ownerId
          });
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      
      chrome.tabs.onUpdated.addListener(listener);
    });

    sendResponse({ status: 'OK', message: 'Sorgulama sekmesi oluşturuldu ve yüklenmesi bekleniyor.' });
  }
  return true; 
});
// Tab kapanma durumunda cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
    console.log('[TP Eklenti] Tab kapatıldı:', tabId);
});

// Extension hatası durumunda loglama
chrome.runtime.onSuspend.addListener(() => {
    console.log('[TP Eklenti] Extension suspend oldu.');
});