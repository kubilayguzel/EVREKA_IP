// =============================
// Evreka IP - Turkpatent Otomasyon (hızlı sürüm)
// =============================

let targetBasvuruNo = null;

// background.js'den komutu al
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AUTO_FILL' && request.data) {
    targetBasvuruNo = request.data;
    runAutomation().catch(err => console.error('[Evreka Eklenti] Hata:', err));
    sendResponse({ status: 'OK' });
  }
  return true;
});

// -------------- Yardımcılar --------------
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
  const btns = document.querySelectorAll('button');
  for (const b of btns) {
    if ((b.textContent || '').trim().includes(text)) return b;
    const spanBtn = b.querySelector('span');
    if (spanBtn && (spanBtn.textContent || '').trim().includes(text)) return b;
  }
  return null;
}

// -------------- Ana akış --------------
async function runAutomation() {
  console.log('[Evreka Eklenti] Otomasyon başladı. Başvuru No:', targetBasvuruNo);

  // 1) Modal/popup kapat (anında yakala)
  try {
    // a) “Dolandırıcılık Hakkında” popup
    const fraudClose = await waitFor('.jss84 .jss92', { timeout: 1500 });
    click(fraudClose);
    console.log('[Evreka Eklenti] Dolandırıcılık popup kapatıldı.');
  } catch { /* görünmediyse sorun değil */ }

  try {
    // b) Klasik MUI dialog/overlay (varsa)
    const anyDialog = await waitFor('[role="dialog"], .MuiDialog-root, .MuiModal-root, .modal', { timeout: 800 });
    const closeCandidate = anyDialog.querySelector('button[aria-label="Close"], button[aria-label="Kapat"], .close') || anyDialog.querySelector('button');
    if (closeCandidate) {
      click(closeCandidate);
      console.log('[Evreka Eklenti] MUI modal kapatıldı.');
    }
  } catch { /* yoksa geç */ }

  // 2) “Dosya Takibi” sekmesine geç
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
  } else {
    console.log('[Evreka Eklenti] "Dosya Takibi" zaten aktif.');
  }

  // 3) Formu doldur + Sorgula
  const input = await waitFor('input[placeholder="Başvuru Numarası"]', { timeout: 4000 });
  // Sorgula butonu çok hızlı değişebildiği için önce hızlı tara, yoksa bekle
  let sorgulaBtn = findButtonByTextFast('Sorgula');
  if (!sorgulaBtn) {
    sorgulaBtn = await waitFor('button', {
      timeout: 3000,
      test: (el) => (el.textContent || '').includes('Sorgula')
    });
  }

  // Değer yaz (React controlled için event’ler)
  input.focus();
  input.value = targetBasvuruNo;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  console.log('[Evreka Eklenti] Başvuru No yazıldı:', targetBasvuruNo);

  // Tıkla
  click(sorgulaBtn);
  console.log('[Evreka Eklenti] Sorgula butonuna tıklandı. ✔');
}
