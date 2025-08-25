// background.js'den gelecek mesajları dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Gelen mesajın bizim beklediğimiz 'AUTO_FILL' tipinde olup olmadığını kontrol et.
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

  // Bu sayfadaki 'Başvuru Numarası' alanı farklı bir yapıya sahip olabilir.
  // Geliştirici araçları ile doğru seçiciyi bulmak gerekebilir.
  // Varsayılan olarak bir ID veya name attribute'u arayalım.
  const applicationNoInput = document.querySelector('#basvuruNo'); // Örnek ID, gerekirse değiştirilmeli
  const searchButton = document.querySelector('#sorgula'); // Örnek ID, gerekirse değiştirilmeli

  if (applicationNoInput && searchButton) {
    console.log(`Başvuru Numarası bulundu: ${basvuruNo}. Forma yazılıyor...`);
    applicationNoInput.value = basvuruNo;

    console.log('Sorgula butonuna tıklanıyor...');
    searchButton.click();
  } else {
    console.error('TÜRKPATENT sayfasında başvuru numarası alanı veya sorgula butonu bulunamadı.');
    if(!applicationNoInput) console.error("Input alanı bulunamadı. Seçici: '#basvuruNo'");
    if(!searchButton) console.error("Buton bulunamadı. Seçici: '#sorgula'");
  }
}