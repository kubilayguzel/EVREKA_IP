// background.js'den gelecek mesajları dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AUTO_FILL' && request.data) {
    const basvuruNo = request.data;
    console.log(`Otomatik doldurma komutu alındı: ${basvuruNo}`);
    
    // Sayfanın ve sekmelerin tam olarak yüklenmesi için biraz bekleyelim.
    setTimeout(() => {
      runAutomation(basvuruNo);
    }, 1500); // Bekleme süresini 1.5 saniyeye çıkardım, modalın animasyonunu atlatmak için daha güvenli.

    sendResponse({ status: 'OK', message: 'Veri alındı ve otomasyon başlatıldı.' });
  }
  return true;
});

function runAutomation(basvuruNo) {
  if (!basvuruNo) {
    console.log('Otomatik sorgulama için başvuru no bulunamadı.');
    return;
  }

  // --- 1. ADIM: "DOSYA TAKİBİ" SEKMESİNE TIKLAMA ---
  // Modalı tamamen görmezden gelip doğrudan doğru sekmeyi hedefliyoruz.
  const dosyaTakibiTab = document.querySelector('a[data-toggle="tab"][href="#dosyaTakip"]');
  
  if (dosyaTakibiTab) {
    console.log('"Dosya Takibi" sekmesine tıklanıyor...');
    dosyaTakibiTab.click();
  } else {
    console.error('"Dosya Takibi" sekmesi bulunamadı. Sayfa yapısı değişmiş olabilir.');
    return; // Sekme bulunamazsa devam etme.
  }

  // --- 2. ADIM: FORMU DOLDURMA VE GÖNDERME ---
  // Sekme içeriğinin yüklenmesi için kısa bir bekleme süresi çok önemlidir.
  setTimeout(() => {
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
  }, 500); // Sekme değiştikten sonra 0.5 saniye bekle.
}