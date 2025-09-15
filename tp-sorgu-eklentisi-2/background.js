// Web sitenizden gelen mesajları dinle
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  // Başvuru No için SORGULA veya SORGULA_BASVURU mesajlarını dinle
  if ((request.type === 'SORGULA' || request.type === 'SORGULA_BASVURU') && request.data) {
    const appNo = request.data;
    const targetUrl = "https://www.turkpatent.gov.tr/arastirma-yap?form=trademark";

    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          // Başvuru numarası sorgusu için 'AUTO_FILL_BASVURU' mesajını gönder
          chrome.tabs.sendMessage(tabId, { type: 'AUTO_FILL_BASVURU', data: appNo });
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    sendResponse({ status: 'OK', message: 'Başvuru No sekmesi açıldı.' });
    return true;
  }

  // Sahip No için SORGULA_KISI mesajını dinle
  if (request.type === 'SORGULA_KISI' && request.data) {
    const ownerId = request.data;
    const targetUrl = "https://www.turkpatent.gov.tr/arastirma-yap?form=trademark";

    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          // Sahip numarası sorgusu için 'AUTO_FILL_KISI' mesajını gönder
          chrome.tabs.sendMessage(tabId, { type: 'AUTO_FILL_KISI', data: ownerId });
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    sendResponse({ status: 'OK', message: 'Sahip No sekmesi açıldı.' });
    return true;
  }
  
  return true;
});