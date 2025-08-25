// OTOMASYON DURUM YÖNETİCİSİ
let automationState = 'IDLE'; // Durumlar: IDLE, WAITING_FOR_MODAL, WAITING_FOR_TAB, WAITING_FOR_FORM, DONE
let targetBasvuruNo = null;
let mainInterval = null; // Ana otomasyon döngümüzü tutacak değişken
let retryCount = 0; // Bir adımda takılıp kalmasını önlemek için sayaç

// background.js'den gelen ana komutu dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'AUTO_FILL' && request.data) {
        console.log('[Evreka Eklenti] BAŞLAT: Otomasyon komutu alındı. Başvuru No:', request.data);
        targetBasvuruNo = request.data;
        automationState = 'WAITING_FOR_MODAL'; // Otomasyonu ilk adımla başlat
        retryCount = 0;
        
        // Olası eski bir döngüyü temizle
        if (mainInterval) clearInterval(mainInterval);
        
        // Ana otomasyon döngüsünü başlat (yarım saniyede bir kontrol et)
        mainInterval = setInterval(runAutomationSequence, 500);
        
        sendResponse({ status: 'OK', message: 'Komut alındı, otomasyon döngüsü başlatıldı.' });
    }
    return true;
});

// Her yarım saniyede bir çalışarak doğru adımı tetikleyecek ana fonksiyon
function runAutomationSequence() {
    // 30 denemeden sonra (15 saniye) hala bir adımda takılıysa, dur.
    retryCount++;
    if (retryCount > 30) {
        console.error('[Evreka Eklenti] HATA: Otomasyon 15 saniye içinde bir adımı tamamlayamadı ve durduruldu. Sayfa yapısı değişmiş olabilir.');
        automationState = 'DONE';
    }
    
    if (automationState === 'IDLE' || automationState === 'DONE') {
        if (mainInterval) clearInterval(mainInterval);
        return;
    }

    // --- 1. ADIM: MODALI BEKLE VE "X" İLE KAPAT ---
    if (automationState === 'WAITING_FOR_MODAL') {
        // Bootstrap modalının standart "X" kapatma butonu
        const modalCloseButton = document.querySelector('button.close[data-dismiss="modal"]');
        if (modalCloseButton) {
            console.log('[Evreka Eklenti] 1. ADIM BAŞARILI: Modal bulundu, "X" ile kapatılıyor.');
            modalCloseButton.click();
            automationState = 'WAITING_FOR_TAB'; // Sonraki adıma geç
            retryCount = 0; // Sayacı sıfırla
        } else {
            console.log('[Evreka Eklenti] 1. ADIM BEKLEMEDE: Modal bekleniyor veya zaten kapalı...');
            // Eğer belirli bir süre sonra modal hiç görünmezse, bu adımı atla
             if (retryCount > 4) { // 2 saniye sonra modal yoksa, olmadığını varsay
                console.log('[Evreka Eklenti] 1. ADIM BİLGİ: Modal bulunamadı, bu adım atlanıyor.');
                automationState = 'WAITING_FOR_TAB';
                retryCount = 0;
            }
        }
    }

    // --- 2. ADIM: "DOSYA TAKİBİ" SEKMESİNİ BEKLE VE TIKLA ---
    if (automationState === 'WAITING_FOR_TAB') {
        const dosyaTakibiTab = document.querySelector('a[data-toggle="tab"][href="#dosyaTakip"]');
        if (dosyaTakibiTab) {
            if (dosyaTakibiTab.classList.contains('active')) {
                console.log('[Evreka Eklenti] 2. ADIM BİLGİ: "Dosya Takibi" sekmesi zaten aktif.');
                automationState = 'WAITING_FOR_FORM';
                retryCount = 0;
            } else {
                console.log('[Evreka Eklenti] 2. ADIM BAŞARILI: "Dosya Takibi" sekmesi bulundu, tıklanıyor.');
                dosyaTakibiTab.click();
                automationState = 'WAITING_FOR_FORM';
                retryCount = 0;
            }
        } else {
             console.log('[Evreka Eklenti] 2. ADIM BEKLEMEDE: "Dosya Takibi" sekmesi bekleniyor...');
        }
    }

    // --- 3. ADIM: FORMU BEKLE, DOLDUR VE GÖNDER ---
    if (automationState === 'WAITING_FOR_FORM') {
        const applicationNoInput = document.querySelector('#dosyaTakip input[name="fileNumber"]');
        const searchButton = document.querySelector('#dosyaTakip button.btn-primary[type="submit"]');

        if (applicationNoInput && searchButton) {
            console.log(`[Evreka Eklenti] 3. ADIM BAŞARILI: Form bulundu. Değer yazılıyor: ${targetBasvuruNo}`);
            applicationNoInput.value = targetBasvuruNo;

            console.log('[Evreka Eklenti] SON ADIM: Sorgula butonuna tıklanıyor.');
            searchButton.click();

            // --- OTOMASYONU BİTİR ---
            console.log('[Evreka Eklenti] TAMAMLANDI: Otomasyon başarıyla bitti.');
            automationState = 'DONE';
            if (mainInterval) clearInterval(mainInterval);
        } else {
             console.log('[Evreka Eklenti] 3. ADIM BEKLEMEDE: Form elemanları bekleniyor...');
        }
    }
}