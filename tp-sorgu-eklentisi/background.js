// Web sitenizden (externally_connectable ile izin verilen) bir mesaj geldiğinde bu fonksiyon çalışır.
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  // Gelen mesajın bizim beklediğimiz 'SORGULA' tipinde olup olmadığını kontrol et.
  if (request.type === 'SORGULA' && request.data) {
    const basvuruNo = request.data;
    
    // TÜRKPATENT'in arama sayfasının URL'si
    const baseUrl = "https://arastirma.turkpatent.gov.tr/tr/marka/arama";

    // Content script'imizin okuyabilmesi için başvuru numarasını URL'ye bir parametre olarak ekliyoruz.
    // Örn: .../arama?autoQuery=2012-14517&source=EvrekaIP
    const targetUrl = `${baseUrl}?autoQuery=${encodeURIComponent(basvuruNo)}&source=EvrekaIP`;

    // Yeni bir sekmede hedef URL'yi aç.
    chrome.tabs.create({ url: targetUrl });

    // Web sitenize işlemin başladığına dair bir yanıt gönder. (Bu isteğe bağlıdır ama iyi bir pratiktir)
    sendResponse({ status: 'OK', message: 'Sorgulama sekmesi açıldı.' });
  }
  
  // Asenkron bir yanıt gönderileceğini belirtmek için true döndür.
  return true; 
});