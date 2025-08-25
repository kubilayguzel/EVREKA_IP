// =============================
// Evreka IP - Turkpatent Otomasyon Content Script
// =============================

// Durum yönetimi
let automationState = 'IDLE'; // IDLE, WAITING_FOR_MODAL, WAITING_FOR_TAB, WAITING_FOR_FORM, DONE
let targetBasvuruNo = null;
let mainInterval = null;

// background.js'den mesaj dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AUTO_FILL' && request.data) {
    console.log('[Evreka Eklenti] BAŞLAT -> Başvuru No:', request.data);
    targetBasvuruNo = request.data;
    automationState = 'WAITING_FOR_MODAL';

    if (mainInterval) clearInterval(mainInterval);
    mainInterval = setInterval(runAutomationSequence, 1000);

    sendResponse({ status: 'OK' });
  }
  return true;
});

// Yardımcılar
function clickIfVisible(el) {
  try {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      el.click();
      return true;
    }
  } catch (e) {}
  return false;
}

function findButtonByText(text) {
  const xpath = `//button[normalize-space()="${text}"] | //*/span[normalize-space()="${text}"]/ancestor::button[1]`;
  const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
  return r.singleNodeValue;
}

// Ana akış
function runAutomationSequence() {
  console.log('[STEP]', automationState);

  // 1) MODAL KAPATMA
  if (automationState === 'WAITING_FOR_MODAL') {
    // Klasik Material-UI modal
    const modal = document.querySelector('[role="dialog"], .MuiDialog-root, .MuiModal-root');
    const closeBtn = modal?.querySelector('button, .close');

    // Dolandırıcılık popup (senin verdiğin HTML: .jss84 + .jss92)
    const fraudPopup = document.querySelector('.jss84');
    const fraudClose = fraudPopup?.querySelector('.jss92');

    console.log('Modal:', modal, 'CloseBtn:', closeBtn, 'FraudClose:', fraudClose);

    if (closeBtn) {
      closeBtn.click();
      console.log('[Evreka Eklenti] Klasik modal kapatıldı.');
    } else if (fraudClose) {
      fraudClose.click();
      console.log('[Evreka Eklenti] Dolandırıcılık popup kapatıldı.');
    } else {
      console.log('[Evreka Eklenti] Modal bulunamadı, devam ediliyor.');
    }

    automationState = 'WAITING_FOR_TAB';
  }

  // 2) "Dosya Takibi" sekmesine geçiş
  else if (automationState === 'WAITING_FOR_TAB') {
    const tabBtn = Array.from(document.querySelectorAll('button[role="tab"]'))
      .find(btn => btn.textContent.includes('Dosya Takibi'));
    console.log('Tab button:', tabBtn);

    if (tabBtn) {
      if (tabBtn.getAttribute('aria-selected') !== 'true') {
        tabBtn.click();
        console.log('[Evreka Eklenti] "Dosya Takibi" sekmesine tıklandı.');
      } else {
        console.log('[Evreka Eklenti] "Dosya Takibi" sekmesi zaten aktif.');
      }
      automationState = 'WAITING_FOR_FORM';
    } else {
      console.log('[Evreka Eklenti] Sekme bulunamadı, bekleniyor...');
    }
  }

  // 3) Form doldurma ve sorgulama
  else if (automationState === 'WAITING_FOR_FORM') {
    const input = document.querySelector('input[placeholder="Başvuru Numarası"]');
    const sorgulaBtn = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent.includes('Sorgula'));
    console.log('Input:', input, 'Button:', sorgulaBtn);

    if (input && sorgulaBtn) {
      input.focus();
      input.value = targetBasvuruNo;

      // React controlled input'larda gerekli
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      console.log('[Evreka Eklenti] Başvuru No yazıldı:', targetBasvuruNo);
      clickIfVisible(sorgulaBtn);
      console.log('[Evreka Eklenti] Sorgula butonuna tıklandı.');

      automationState = 'DONE';
      clearInterval(mainInterval);
      console.log('[Evreka Eklenti] OTOMASYON TAMAMLANDI.');
    } else {
      console.log('[Evreka Eklenti] Form bekleniyor...');
    }
  }
}
