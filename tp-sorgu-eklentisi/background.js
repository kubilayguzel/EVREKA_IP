// Web sitenizden (externally_connectable ile izin verilen) bir mesaj geldiğinde bu fonksiyon çalışır.
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  // Gelen mesajın bizim beklediğimiz 'SORGULA' tipinde olup olmadığını kontrol et.
  if (request.type === 'SORGULA' && request.data) {
    const basvuruNo = request.data;
    
    // YENİ VE DOĞRU URL HEDEFİ
    const targetUrl = "https://www.turkpatent.gov.tr/arastirma-yap?form=trademark";

    // Yeni bir sekmede hedef URL'yi aç.
    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      // Sekme oluşturulduktan sonra, content script'e veriyi göndermek için bir mesaj yolluyoruz.
      // Bu yöntem, URL'ye parametre eklemekten daha güvenilirdir.
      setTimeout(() => { // Sayfanın yüklenmeye başlaması için küçük bir gecikme
        chrome.tabs.sendMessage(newTab.id, {
          type: 'AUTO_FILL',
          data: basvuruNo
        });
      }, 1000); // 1 saniye bekle
    });

    // Web sitenize işlemin başladığına dair bir yanıt gönder.
    sendResponse({ status: 'OK', message: 'Sorgulama sekmesi açıldı ve veri gönderildi.' });
  }
  
  // Asenkron bir yanıt gönderileceğini belirtmek için true döndür.
  return true; 
});