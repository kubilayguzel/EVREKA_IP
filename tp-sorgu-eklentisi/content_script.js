// background.js'den gelecek mesajları dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AUTO_FILL' && request.data) {
    const basvuruNo = request.data;
    console.log(`Otomasyon komutu alındı: ${basvuruNo}. Sayfa elementleri bekleniyor...`);
    
    // "Dosya Takibi" sekmesi ortaya çıktığında otomasyonu başlatacak olan gözlemciyi kur.
    waitForElement('a[data-toggle="tab"][href="#dosyaTakip"]', () => {
      runAutomation(basvuruNo);
    });

    sendResponse({ status: 'OK', message: 'Veri alındı ve otomasyon başlatıldı.' });
  }
  return true;
});

/**
 * Belirtilen seçiciye sahip bir element DOM'a eklenene kadar bekler,
 * ardından bir callback fonksiyonu çalıştırır.
 * @param {string} selector - Beklenecek elementin CSS seçicisi.
 * @param {function} callback - Element bulunduğunda çalıştırılacak fonksiyon.
 */
function waitForElement(selector, callback) {
  // Önce elementin zaten var olup olmadığını kontrol et.
  if (document.querySelector(selector)) {
    callback();
    return;
  }

  // Element henüz yoksa, DOM değişikliklerini izlemek için bir gözlemci oluştur.
  const observer = new MutationObserver((mutations, obs) => {
    if (document.querySelector(selector)) {
      // Element bulundu, gözlemciyi durdur ve callback'i çalıştır.
      obs.disconnect(); 
      callback();
    }
  });

  // Gözlemciyi tüm sayfa (document.body) üzerinde,
  // alt elementlerdeki değişiklikleri de izleyecek şekilde başlat.
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}


function runAutomation(basvuruNo) {
  if (!basvuruNo) {
    console.log('Başvuru no bulunamadı.');
    return;
  }

  // --- 1. ADIM: "DOSYA TAKİBİ" SEKMESİNE TIKLAMA ---
  const dosyaTakibiTab = document.querySelector('a[data-toggle="tab"][href="#dosyaTakip"]');
  
  if (dosyaTakibiTab) {
    console.log('"Dosya Takibi" sekmesi başarıyla bulundu ve tıklanıyor...');
    dosyaTakibiTab.click();
  } else {
    // Bu kodun çalışmaması gerekir çünkü waitForElement onu bulana kadar beklemiş olmalı.
    console.error('"Dosya Takibi" sekmesi bulunamadı.');
    return;
  }

  // --- 2. ADIM: FORMU DOLDURMA VE GÖNDERME ---
  // Sekme içeriğinin yüklenmesi için kısa bir bekleme hala gereklidir.
  setTimeout(() => {
    const applicationNoInput = document.querySelector('#dosyaTakip input[name="fileNumber"]');
    const searchButton = document.querySelector('#dosyaTakip button.btn-primary[type="submit"]');

    if (applicationNoInput && searchButton) {
      console.log(`Form elemanları bulundu. Değer yazılıyor: ${basvuruNo}`);
      applicationNoInput.value = basvuruNo;
      console.log('Sorgula butonuna tıklanıyor...');
      searchButton.click();
    } else {
      console.error('Dosya Takibi sekmesinde form elemanları bulunamadı.');
    }
  }, 500); // Sekme değiştikten sonra 0.5 saniye bekle.
}