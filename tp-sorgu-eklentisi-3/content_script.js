const TAG = '[TP-V3]';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runAutomation() {
  const data = await chrome.storage.local.get(["tp_app_no", "tp_step"]);
  if (!data.tp_app_no) return;

  const url = window.location.href;
  log(`Mevcut Adım: ${data.tp_step} | URL: ${url}`);

  // ADIM 1: Giriş Sayfası (Görsel 1)
  if (url.includes("/EDEVLET/giris")) {
    const loginBtn = document.querySelector('a.btn-login, button.btn-success, [href*="edevletGiris"]');
    if (loginBtn) {
      log("Giriş butonuna basılıyor...");
      loginBtn.click();
      // E-devlet girişi kullanıcı tarafından manuel yapılacağı için burada bekleriz.
    }
  }

  // ADIM 2: Dashboard / Sol Menü (Görsel 2)
  // Kullanıcı e-devletten dönünce sol menüdeki 'Belgelerim' butonunu ararız.
  const sidebarLinks = Array.from(document.querySelectorAll('.sidebar-menu a, .nav-link, span'));
  const belgelerimBtn = sidebarLinks.find(el => el.textContent.trim() === 'Belgelerim');

  if (belgelerimBtn && url.includes("/dashboard") || !url.includes("/belgelerim")) {
    log("Belgelerim alanına tıklanıyor...");
    belgelerimBtn.click();
    return; 
  }

  // ADIM 3 & 4: Belgelerim Form Sayfası (Görsel 3 & 4)
  if (url.includes("/belgelerim") || document.querySelector('input[name*="basvuruNo"]')) {
    
    // a) Dosya Türü: Marka seçimi (Görsel 4)
    // EPATS genellikle PrimeFaces veya benzeri kütüphaneler kullanır, bu yüzden dropdown seçimi hassastır.
    const dropdown = document.querySelector('select[name*="dosyaTuru"], .ui-selectonemenu');
    if (dropdown) {
      log("Dosya türü 'Marka' olarak seçiliyor...");
      // Eğer standart select ise:
      dropdown.value = "Marka"; 
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // b) Başvuru Numarası girişi (Görsel 3)
    const inputField = document.querySelector('input[placeholder*="Numarası"], input[name*="basvuruNo"]');
    if (inputField) {
      log("Başvuru numarası yazılıyor: " + data.tp_app_no);
      inputField.value = data.tp_app_no;
      inputField.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // c) Ara Butonu
    const araBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Ara'));
    if (araBtn && inputField.value === data.tp_app_no) {
      log("Ara butonuna basılıyor...");
      await sleep(500);
      araBtn.click();
      await chrome.storage.local.set({ "tp_step": "SEARCH_CLICKED" });
    }
  }

  // ADIM 5 & 6: Sonuçlar ve Akordeon Açma (Görsel 5 & 6)
  const searchStatus = await chrome.storage.local.get("tp_step");
  if (searchStatus.tp_step === "SEARCH_CLICKED") {
    // Tablonun yüklenmesini bekle (Görsel 5)
    await sleep(2000);
    
    // + işaretine (Expand/Akordeon) bas (Görsel 6)
    // Genellikle 'ui-row-toggler' veya 'fa-plus' class'ına sahiptir.
    const plusBtn = document.querySelector('.ui-row-toggler, .fa-plus, [class*="plus-square"]');
    if (plusBtn) {
      log("Evrak akordeonu açılıyor (+)...");
      plusBtn.click();
      
      // İşlem tamamlandı, durumu temizle ki her sayfada sürekli çalışmasın.
      chrome.storage.local.remove(["tp_step"]);
      log("✅ Tüm adımlar başarıyla tamamlandı.");
    } else {
      log("Henüz sonuç yüklenmedi veya + butonu bulunamadı, bekleniyor...");
    }
  }
}

function log(msg) {
  console.log(`${TAG} ${msg}`);
}

// Sayfa her yüklendiğinde veya AJAX değişikliklerinde kontrol et
runAutomation();
// EPATS dinamik bir site olduğu için 2 saniyede bir kontrol mekanizması ekliyoruz
setInterval(runAutomation, 3000);