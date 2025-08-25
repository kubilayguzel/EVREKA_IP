// Bu fonksiyon, sayfa yüklendiğinde ve otomasyonu çalıştırmaya hazır olduğunda tetiklenir.
function runAutomation() {
  // 1. URL'den 'autoQuery' parametresini oku.
  const params = new URLSearchParams(window.location.search);
  const basvuruNo = params.get('autoQuery');

  // Eğer URL'de bizim gönderdiğimiz parametre yoksa, hiçbir şey yapma.
  if (!basvuruNo) {
    console.log('Otomatik sorgulama için parametre bulunamadı.');
    return;
  }

  // 2. TÜRKPATENT sayfasındaki ilgili form elemanlarını bul.
  // ÖNEMLİ: Bu ID'ler ve seçiciler TÜRKPATENT sitesi değiştikçe güncellenmelidir.
  // Şu anki (Ağustos 2025) yapıya göre bu seçiciler doğrudur.
  const applicationNoInput = document.querySelector('input[name="applicationNumber"]');
  const searchButton = document.querySelector('button[type="submit"].search-button');

  // 3. Elemanların sayfada bulunduğundan emin ol.
  if (applicationNoInput && searchButton) {
    console.log(`Başvuru Numarası bulundu: ${basvuruNo}. Forma yazılıyor...`);
    
    // 4. Başvuru numarasını ilgili alana yaz.
    applicationNoInput.value = basvuruNo;

    console.log('Sorgula butonuna tıklanıyor...');
    
    // 5. "Ara" butonuna tıkla.
    searchButton.click();
  } else {
    // Eğer elemanlar bulunamazsa, bu bir hatadır. Konsola bilgi yazdır.
    console.error('TÜRKPATENT sayfasında başvuru numarası alanı veya arama butonu bulunamadı. Sitenin yapısı değişmiş olabilir.');
  }
}

// Sayfanın tamamen yüklenmesini beklemek her zaman daha güvenilirdir.
// 'DOMContentLoaded' genellikle yeterlidir, ancak bazen tüm script'lerin yüklenmesi için 'load' daha garantidir.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runAutomation);
} else {
  // Sayfa zaten yüklenmişse doğrudan çalıştır.
  runAutomation();
}