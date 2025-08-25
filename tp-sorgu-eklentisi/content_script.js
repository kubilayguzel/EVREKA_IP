// background.js'den gelecek mesajları dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AUTO_FILL' && request.data) {
    const basvuruNo = request.data;
    console.log(`Otomatik doldurma komutu alındı: ${basvuruNo}`);
    
    // Sayfanın tamamen hazır olduğundan emin olmak için küçük bir gecikme ekleyelim
    // Bu, modal gibi elementlerin yüklenmesine zaman tanır.
    setTimeout(() => {
      runAutomation(basvuruNo);
    }, 1000); // 1 saniye bekle

    sendResponse({ status: 'OK', message: 'Veri alındı ve otomasyon başlatıldı.' });
  }
  return true;
});

function runAutomation(basvuruNo) {
  if (!basvuruNo) {
    console.log('Otomatik sorgulama için başvuru no bulunamadı.');
    return;
  }

  // --- YENİ ADIM 1: DUYURU MODALINI KAPATMA ---
  // Modal'daki "Devam" butonunu bulup tıklayalım.
  const modalButton = document.querySelector('button.btn.btn-primary.w-100');
  if (modalButton && modalButton.textContent.trim() === 'Devam') {
    console.log('Duyuru modalı bulundu ve "Devam" butonuna tıklanıyor...');
    modalButton.click();
  } else {
    console.log('Duyuru modalı bulunamadı veya zaten kapalı.');
  }

  // Modal kapandıktan sonra diğer işlemlerin yapılması için kısa bir bekleme süresi daha ekleyelim.
  setTimeout(() => {
    // --- YENİ ADIM 2: "DOSYA TAKİBİ" SEKMESİNE TIKLAMA ---
    const dosyaTakibiTab = document.querySelector('a[data-toggle="tab"][href="#dosyaTakip"]');
    if (dosyaTakibiTab) {
      console.log('"Dosya Takibi" sekmesine tıklanıyor...');
      dosyaTakibiTab.click();
    } else {
      console.error('"Dosya Takibi" sekmesi bulunamadı.');
      return; // Sekme bulunamazsa devam etmenin anlamı yok.
    }

    // Sekme değiştikten sonra içeriğin yüklenmesi için bir bekleme daha...
    setTimeout(() => {
      // --- YENİ ADIM 3: FORMU DOLDURMA VE GÖNDERME ---
      // "Dosya Takibi" sekmesindeki doğru input ve butonu bulalım.
      const applicationNoInput = document.querySelector('#dosyaTakip input[name="fileNumber"]');
      const searchButton = document.querySelector('#dosyaTakip button.btn-primary[type="submit"]');

      if (applicationNoInput && searchButton) {
        console.log(`Başvuru Numarası alanı bulundu. Değer yazılıyor: ${basvuruNo}`);
        applicationNoInput.value = basvuruNo;

        console.log('Sorgula butonuna tıklanıyor...');
        searchButton.click();
      } else {
        console.error('Dosya Takibi sekmesinde form elemanları bulunamadı.');
        if (!applicationNoInput) console.error("Input alanı bulunamadı. Seçici: '#dosyaTakip input[name=\"fileNumber\"]'");
        if (!searchButton) console.error("Buton bulunamadı. Seçici: '#dosyaTakip button.btn-primary[type=\"submit\"]'");
      }
    }, 500); // 0.5 saniye bekle
  }, 500); // 0.5 saniye bekle
}