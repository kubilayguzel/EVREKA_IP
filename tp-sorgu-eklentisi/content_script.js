// =============================
// Evreka IP - Turkpatent Otomasyon (İZİNSİZ GÜNCELLENMİŞ SÜRÜM)
// =============================

let targetBasvuruNo = null; // Sayfa yenilendiğinde sıfırlanacaktır.

// Gerekli CSS Selector'ler (Bu selector'leri, ilgili sayfalardan F12 ile kontrol edip 
// DOM yapısına göre güncellemeniz gerekebilir. Text aramayı baz alıyorum.)
const SELECTORS = {
    // TÜRKPATENT ilk Dosya Takibi ekranında çıkan e-Devlet butonu metni
    E_DEVLET_GIRIS_TEXT: 'e-Devlet ile Giriş Yap',
    // Giriş sonrası çıkan sayfadaki Marka Dosya Takibi butonu/linki metni (2. görsel)
    MARKA_DOSYA_TAKIBI_TEXT: 'Marka Dosya Takibi',
    // Son sorgulama sayfasındaki Başvuru Numarası inputu (3. görsel)
    BASVURU_NO_INPUT: 'input[placeholder="Başvuru Numarası"]', 
    // Son sorgulama sayfasındaki Sorgula butonu metni
    SORGULA_TEXT: 'Sorgula'
};


// -------------- Yardımcılar (Mevcut kodunuzdan alındı) --------------
function waitFor(selector, { root = document, timeout = 7000, test = null } = {}) {
  return new Promise((resolve, reject) => {
    // Hemen var mı?
    let el = root.querySelector(selector);
    if (el && (!test || test(el))) return resolve(el);

    // Observer ile hızlı yakala
    const obs = new MutationObserver(() => {
      el = root.querySelector(selector);
      if (el && (!test || test(el))) {
        obs.disconnect();
        resolve(el);
      }
    });
    obs.observe(root, { childList: true, subtree: true, attributes: true });

    // Emniyet timeout
    const to = setTimeout(() => {
      obs.disconnect();
      reject(new Error(`waitFor timeout: ${selector}`));
    }, timeout);

    // Resolve olunca timeout temizlensin
    const _resolve = (v) => { clearTimeout(to); resolve(v); };
  });
}

function click(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    el.click();
    return true;
  }
  return false;
}

function findButtonByTextFast(text) {
  // Çok hızlı text yakalama (span->button da dahil)
  const allElements = document.querySelectorAll('button, a, span[role="button"]'); 
  for (const el of allElements) {
    if ((el.textContent || '').trim().includes(text)) {
        if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') {
            return el;
        }
    }
  }
  return null;
}

// -------------------- Ana Akış Fonksiyonları --------------------

// ADIM 1: TÜRKPATENT Başlangıç Sayfası -> e-Devlet'e yönlendirme
async function step1_InitialPage(basvuruNo) {
    // 1) "Dosya Takibi" sekmesine geç
    let tabBtn = findButtonByTextFast('Dosya Takibi');
    if (!tabBtn) {
        tabBtn = await waitFor('button[role="tab"]', {
            timeout: 4000,
            test: (el) => (el.textContent || '').includes('Dosya Takibi')
        });
    }
    
    if (tabBtn.getAttribute('aria-selected') !== 'true') {
        click(tabBtn);
        console.log('[Evreka Eklenti] "Dosya Takibi" sekmesine tıklandı.');
    }

    // 2) "e-Devlet ile Giriş Yap" butonunu bekle ve tıkla
    const edevletGirisBtn = await waitFor('button, a', {
        timeout: 4000,
        test: (el) => (el.textContent || '').includes(SELECTORS.E_DEVLET_GIRIS_TEXT)
    });

    if (edevletGirisBtn) {
        click(edevletGirisBtn);
        console.log('[Evreka Eklenti] "e-Devlet ile Giriş Yap" butonuna tıklandı. Kullanıcı girişi bekleniyor...');
    } else {
        throw new Error(`[ADIM 1 HATA] "${SELECTORS.E_DEVLET_GIRIS_TEXT}" butonu bulunamadı.`);
    }
    // NOT: Bu noktada sayfa e-Devlet'e yönlenir.
}

// ADIM 2: TÜRKPATENT İç Portalı -> Marka Dosya Takibi formuna yönlendirme
async function step2_InternalPortal(basvuruNo) {
    console.log('[Evreka Eklenti] E-Devlet girişi sonrası iç portaldeyiz.');
    
    // Marka Dosya Takibi butonuna tıkla
    const markaDosyaTakibiBtn = await waitFor('a, button, span[role="button"]', {
        timeout: 5000,
        test: (el) => (el.textContent || '').includes(SELECTORS.MARKA_DOSYA_TAKIBI_TEXT)
    });

    if (markaDosyaTakibiBtn) {
        click(markaDosyaTakibiBtn);
        console.log('[Evreka Eklenti] "Marka Dosya Takibi" butonuna tıklandı. Sorgulama sayfasına gidiliyor.');
    } else {
        throw new Error(`[ADIM 2 HATA] "${SELECTORS.MARKA_DOSYA_TAKIBI_TEXT}" butonu bulunamadı.`);
    }
    // NOT: Bu noktada sorgulama formu olan 3. sayfaya yönlenir.
}

// ADIM 3: Sorgulama Aşaması (Son sayfa) -> Numarayı gir ve tıkla
async function step3_PerformQuery(basvuruNo) {
    console.log('[Evreka Eklenti] Sorgulama sayfasındayız. Numarayı giriyoruz.');

    // 1. Formu doldur
    const input = await waitFor(SELECTORS.BASVURU_NO_INPUT, { timeout: 7000 });
    
    // 2. Sorgula butonu
    const sorgulaBtn = await waitFor('button', {
        timeout: 3000,
        test: (el) => (el.textContent || '').includes(SELECTORS.SORGULA_TEXT)
    });

    // Değer yaz (React controlled için event’ler)
    input.focus();
    input.value = basvuruNo;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[Evreka Eklenti] Başvuru No yazıldı:', basvuruNo);

    // Tıkla
    click(sorgulaBtn);
    console.log('[Evreka Eklenti] Sorgula butonuna tıklandı. ✔');
    
    // NOT: Akış tamamlandı. targetBasvuruNo otomatik sıfırlanacaktır.
}


// -------------- Ana akış --------------
async function runAutomation(basvuruNo) {
  console.log('[Evreka Eklenti] Otomasyon başladı. Başvuru No:', basvuruNo);

  // TÜM ADIMLARDAN ÖNCE POP-UP KAPATMA
  try {
    // a) Pop-up kapat (Mevcut kodunuzdaki gibi)
    const fraudClose = await waitFor('.jss84 .jss92, [data-testid="CloseIcon"], button[aria-label="Kapat"]', { timeout: 1500 });
    click(fraudClose);
    console.log('[Evreka Eklenti] Popup kapatıldı.');
  } catch { /* yoksa geç */ }

    const currentUrl = window.location.href;

    // URL'ye ve sayfa içeriğine göre hangi adımda olduğumuzu tespit etme
    try {
        if (currentUrl.includes("giris.turkiye.gov.tr")) {
            // ADIM 1.5: E-Devlet Giriş Sayfası (KULLANICI BEKLEME)
            console.warn('[Evreka Eklenti] E-Devlet giriş sayfası. Lütfen girişi manuel tamamlayın. Giriş sonrası dış uygulamadan tekrar tetikleme gereklidir.');
            return; // Dur ve kullanıcıyı bekle

        } else if (document.querySelector(SELECTORS.BASVURU_NO_INPUT)) {
            // ADIM 3: Sorgulama Aşaması (Sorgulama input alanı varsa)
            await step3_PerformQuery(basvuruNo);

        } else if (findButtonByTextFast(SELECTORS.MARKA_DOSYA_TAKIBI_TEXT)) {
            // ADIM 2: İç Portal Aşaması (Marka Dosya Takibi butonu varsa)
            await step2_InternalPortal(basvuruNo);

        } else if (findButtonByTextFast(SELECTORS.E_DEVLET_GIRIS_TEXT) || findButtonByTextFast('Dosya Takibi')) { 
            // ADIM 1: TÜRKPATENT Başlangıç Sayfası (e-Devlet butonu veya Dosya Takibi sekmesi varsa)
            await step1_InitialPage(basvuruNo);

        } else {
            console.log('[Evreka Eklenti] Tanımsız TÜRKPATENT sayfası. Dış uygulamadan gelen mesaj bekleniyor.');
        }

    } catch (err) {
        console.error('[Evreka Eklenti] Otomasyon Akışında Hata:', err.message);
    }
}


// -------------- Mesaj Dinleyici (Başlatıcı) --------------

// background.js'den komutu al
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AUTO_FILL' && request.data) {
    // Basvuru numarasını local değişkene ata
    targetBasvuruNo = request.data; 
    
    // Yeni akışı başlat (targetBasvuruNo'nun bu mesajla geldiği varsayılır)
    runAutomation(targetBasvuruNo).catch(err => console.error('[Evreka Eklenti] Hata:', err));
    sendResponse({ status: 'OK' });
  }
  return true;
});

// NOT: Dış uygulamanızın (kullanıcı arayüzü) her sayfa yüklendiğinde bu kodu tetiklemesi gereklidir.