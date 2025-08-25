// Web sitenizden gelen mesajları dinle
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.type === 'SORGULA' && request.data) {
    const basvuruNo = request.data;
    const targetUrl = "https://www.turkpatent.gov.tr/arastirma-yap?form=trademark";

    // Yeni bir sekme oluştur
    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      // Bu yeni sekmenin yüklenmesini dinlemek için bir olay dinleyici ekle
      const listener = (tabId, changeInfo, tab) => {
        // Eğer güncellenen sekme bizim oluşturduğumuz sekme ise VE yüklenmesi tamamlandıysa
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          // Mesajı şimdi, yani sayfa tamamen hazır olduğunda gönder
          chrome.tabs.sendMessage(tabId, {
            type: 'AUTO_FILL',
            data: basvuruNo
          });
          // İşi bittiği için bu dinleyiciyi bellekten kaldır
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      
      // Sekme güncelleme olaylarını dinlemeye başla
      chrome.tabs.onUpdated.addListener(listener);
    });

    sendResponse({ status: 'OK', message: 'Sorgulama sekmesi oluşturuldu ve yüklenmesi bekleniyor.' });
  }
  return true; 
});