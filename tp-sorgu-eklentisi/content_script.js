// Global değişkenler
let IS_AUTOMATION_RUNNING = false;
let TARGET_BASVURU_NO = null;

// background.js'den gelecek ana komut
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AUTO_FILL' && request.data) {
    console.log(`[Evreka Eklenti] Otomasyon komutu alındı: ${request.data}`);
    IS_AUTOMATION_RUNNING = true;
    TARGET_BASVURU_NO = request.data;
    // Otomasyonu başlatmak için sayfayı gözlemlemeye başla
    observePageForAutomation();
    sendResponse({ status: 'OK', message: 'Komut alındı, otomasyon başlıyor.' });
  }
  return true;
});

/**
 * Sayfayı gözlemleyip doğru zamanda doğru adımları tetikleyecek ana fonksiyon.
 */
function observePageForAutomation() {
  if (!IS_AUTOMATION_RUNNING) return;

  const observer = new MutationObserver((mutations, obs) => {
    // 1. ADIM: MODALI ARA VE KAPAT
    // Bootstrap modalının close (X) butonu
    const modalCloseButton = document.querySelector('.modal.show .close, .modal.in .close');
    if (modalCloseButton) {
      console.log('[Evreka Eklenti] Modal bulundu, kapatılıyor...');
      modalCloseButton.click();
    }

    // 2. ADIM: "DOSYA TAKİBİ" SEKMESİNİ ARA VE TIKLA
    const dosyaTakibiTab = document.querySelector('a[data-toggle="tab"][href="#dosyaTakip"]');
    if (dosyaTakibiTab) {
      // Sekmenin zaten aktif olup olmadığını kontrol et
      if (!dosyaTakibiTab.classList.contains('active')) {
        console.log('[Evreka Eklenti] "Dosya Takibi" sekmesi bulundu, tıklanıyor...');
        dosyaTakibiTab.click();
      }

      // 3. ADIM: FORMU ARA, DOLDUR VE GÖNDER
      const applicationNoInput = document.querySelector('#dosyaTakip input[name="fileNumber"]');
      if (applicationNoInput) {
        // Input alanının görünür olduğunu varsayabiliriz çünkü sekme aktif.
        // Eğer input boşsa, doldur ve butona bas.
        if (applicationNoInput.value === '') {
          console.log(`[Evreka Eklenti] Form alanı bulundu. Değer yazılıyor: ${TARGET_BASVURU_NO}`);
          applicationNoInput.value = TARGET_BASVURU_NO;
          
          const searchButton = document.querySelector('#dosyaTakip button.btn-primary[type="submit"]');
          if (searchButton) {
            console.log('[Evreka Eklenti] Sorgula butonuna tıklanıyor...');
            searchButton.click();
            
            // İşlem bitti, gözlemciyi durdur ve durumu sıfırla.
            console.log('[Evreka Eklenti] Otomasyon tamamlandı.');
            obs.disconnect();
            IS_AUTOMATION_RUNNING = false;
            TARGET_BASVURU_NO = null;
          }
        }
      }
    }
  });

  // Gözlemciyi tüm sayfa üzerinde, tüm değişiklikleri izleyecek şekilde başlat.
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true // class değişikliklerini de (örneğin 'active' class'ı) yakalamak için
  });
}