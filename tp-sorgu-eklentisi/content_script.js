// OTOMASYON DURUM YÖNETİCİSİ
let automationState = 'IDLE'; // Durumlar: IDLE, WAITING_FOR_MODAL, WAITING_FOR_TAB, WAITING_FOR_FORM, DONE
let targetBasvuruNo = null;
let mainInterval = null; // Ana otomasyon döngümüzü tutacak değişken

// background.js'den gelen ana komutu dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'AUTO_FILL' && request.data) {
        console.log('[Evreka Eklenti] BAŞLAT: Otomasyon komutu alındı. Başvuru No:', request.data);
        targetBasvuruNo = request.data;
        automationState = 'WAITING_FOR_MODAL'; // Otomasyonu ilk adımla başlat
        
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
    if (automationState === 'IDLE' || automationState === 'DONE') {
        if (mainInterval) clearInterval(mainInterval);
        return;
    }

    // --- 1. ADIM: MODALI BEKLE VE "X" İLE KAPAT ---
    if (automationState === 'WAITING_FOR_MODAL') {
        // Bootstrap modalının close (X) butonu
        const modalCloseButton = document.querySelector('.modal.show .close, .modal.in .close');
        if (modalCloseButton) {
            console.log('[Evreka Eklenti] 1. ADIM BAŞARILI: Modal bulundu, "X" ile kapatılıyor.');
            modalCloseButton.click();
            automationState = 'WAITING_FOR_TAB'; // Sonraki adıma geç
        } else {
            // Eğer modal hiç görünmezse, bu adımı atla
            console.log('[Evreka Eklenti] 1. ADIM BİLGİ: Modal bulunamadı, bu adım atlanıyor.');
            automationState = 'WAITING_FOR_TAB'; // Sonraki adıma geç
        }
    }

    // --- 2. ADIM: "DOSYA TAKİBİ" SEKMESİNİ BEKLE VE TIKLA ---
    if (automationState === 'WAITING_FOR_TAB') {
        const dosyaTakibiTab = document.querySelector('a[data-toggle="tab"][href="#dosyaTakip"]');
        if (dosyaTakibiTab) {
             // Sekmenin zaten aktif olup olmadığını kontrol et
            if (dosyaTakibiTab.classList.contains('active')) {
                console.log('[Evreka Eklenti] 2. ADIM BİLGİ: "Dosya Takibi" sekmesi zaten aktif.');
                automationState = 'WAITING_FOR_FORM'; // Sonraki adıma geç
            } else {
                console.log('[Evreka Eklenti] 2. ADIM BAŞARILI: "Dosya Takibi" sekmesi bulundu, tıklanıyor.');
                dosyaTakibiTab.click();
                automationState = 'WAITING_FOR_FORM'; // Sonraki adıma geçtikten sonra formun yüklenmesini bekleyeceğiz
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
            if (mainInterval) clearInterval(mainInterval); // Döngüyü durdur
        } else {
             console.log('[Evreka Eklenti] 3. ADIM BEKLEMEDE: Form elemanları bekleniyor...');
        }
    }
}