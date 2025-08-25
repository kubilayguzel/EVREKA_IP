// background.js'den gelecek mesajları dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AUTO_FILL' && request.data) {
    const basvuruNo = request.data;
    console.log(`Otomatik doldurma komutu alındı: ${basvuruNo}`);
    runAutomation(basvuruNo);
    sendResponse({ status: 'OK', message: 'Veri alındı ve forma yazıldı.' });
  }
  return true;
});

function runAutomation(basvuruNo) {
  if (!basvuruNo) {
    console.log('Otomatik sorgulama için başvuru no bulunamadı.');
    return;
  }

  // DOĞRU SEÇİCİLER:
  // TÜRKPATENT'in "Marka Araştırma" formundaki "Başvuru Numarası" alanının seçicisi
  const applicationNoInput = document.querySelector('input[name="trademark.applicationNumber"]');
  
  // Formun içindeki "Ara" butonunun seçicisi
  const searchButton = document.querySelector('button.btn-primary[type="submit"]');

  if (applicationNoInput && searchButton) {
    console.log(`Başvuru Numarası alanı bulundu. Değer yazılıyor: ${basvuruNo}`);
    
    // Değeri alana yaz
    applicationNoInput.value = basvuruNo;

    console.log('Ara butonuna tıklanıyor...');

    // Arama butonuna tıkla
    searchButton.click();

  } else {
    // Eğer elemanlar bulunamazsa, bu hata ayıklama için çok önemlidir.
    console.error('TÜRKPATENT sayfasında form elemanları bulunamadı. Sitenin yapısı değişmiş olabilir.');
    if (!applicationNoInput) {
      console.error("Başvuru Numarası alanı bulunamadı. Kontrol edilen seçici: 'input[name=\"trademark.applicationNumber\"]'");
    }
    if (!searchButton) {
      console.error("Ara butonu bulunamadı. Kontrol edilen seçici: 'button.btn-primary[type=\"submit\"]'");
    }
  }
}