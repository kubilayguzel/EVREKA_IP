const TAG = '[TP-V3]';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runAutomation() {
  const data = await chrome.storage.local.get(["tp_app_no", "tp_step"]);
  if (!data.tp_app_no) return;

  const url = window.location.href;

  // ADIM 1: Giriş Sayfası
  if (url.includes("/EDEVLET/giris")) {
    // Paylaştığın img içeren linki hedef alıyoruz
    const loginBtn = document.querySelector('a[href*="turkiye.gov.tr"], a > img[src*="EPATS_GIRIS"]')?.parentElement || 
                     document.querySelector('a[href*="check_login"]');
    
    if (loginBtn) {
      console.log(TAG, "Giriş butonuna basılıyor...");
      loginBtn.click();
    }
    return;
  }

  // ADIM 2: Belgelerim Butonuna Tıklama (Görsel 2)
  // Paylaştığın DIV yapısına göre tüm butonları ve divleri tarıyoruz
  const allElements = Array.from(document.querySelectorAll('div.btn, a, span, .nav-link'));
  const belgelerimBtn = allElements.find(el => el.textContent.trim() === 'Belgelerim');

  // Eğer zaten belgelerim sayfasındaysak bu adımı geç
  if (belgelerimBtn && !url.includes("/belgelerim")) {
    console.log(TAG, "Belgelerim div'ine tıklanıyor...");
    belgelerimBtn.click();
    return;
  }

  // ADIM 3 & 4: Form Doldurma
  if (url.includes("/belgelerim")) {
    // Dosya Türü Seçimi (Marka)
    // Angular (ng-click) yapısı olduğu için direkt click tetiklemek gerekebilir
    const dropdowns = Array.from(document.querySelectorAll('div, select'));
    const markaSecenek = dropdowns.find(el => el.textContent.trim() === 'Marka');
    
    // Başvuru Numarası Input
    const inputField = document.querySelector('input[ng-model*="basvuruNo"], input[placeholder*="Numarası"]');
    
    if (inputField && inputField.value !== data.tp_app_no) {
      inputField.value = data.tp_app_no;
      inputField.dispatchEvent(new Event('input', { bubbles: true }));
      inputField.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(TAG, "Numara yazıldı.");
    }

    // Ara Butonu
    const araBtn = Array.from(document.querySelectorAll('div.btn, button')).find(el => el.textContent.includes('Ara'));
    if (araBtn) {
      await sleep(500);
      araBtn.click();
      await chrome.storage.local.set({ "tp_step": "SEARCH_CLICKED" });
    }
  }

  // ADIM 5 & 6: Akordeon (+) Açma
  const statusData = await chrome.storage.local.get("tp_step");
  if (statusData.tp_step === "SEARCH_CLICKED") {
    await sleep(2000);
    // Angular tabanlı tablolarda + işareti genelde bir div veya i etiketidir
    const plusBtn = document.querySelector('.ui-row-toggler, .fa-plus, [class*="plus"]');
    if (plusBtn) {
      plusBtn.click();
      chrome.storage.local.remove(["tp_step"]);
      console.log(TAG, "Süreç tamamlandı.");
    }
  }
}

// Hata almamak için periyodik kontrol
setInterval(() => {
  runAutomation().catch(err => console.debug("Bekleniyor..."));
}, 3000);