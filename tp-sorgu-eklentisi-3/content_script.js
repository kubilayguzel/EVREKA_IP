const TAG = '[TP-V5.0]';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function superClick(el) {
  if (!el) return false;
  try {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
      el.dispatchEvent(new MouseEvent(t, opts))
    );
    console.log(TAG, 'Clicked:', (el.innerText || el.textContent || '').trim());
    return true;
  } catch (e) {
    console.error(TAG, 'Click error:', e);
    try { el.click(); return true; } catch {}
    return false;
  }
}

// Same-origin iframe’lerin document’larını da topla
function getAllDocs() {
  const docs = [document];
  const iframes = Array.from(document.querySelectorAll('iframe'));
  for (const fr of iframes) {
    try {
      const d = fr.contentDocument;
      if (d) docs.push(d);
    } catch (e) {
      // cross-origin ise erişemeyiz (e-devlet tarafında olabilir)
    }
  }
  return docs;
}

function qAll(selector) {
  const docs = getAllDocs();
  for (const d of docs) {
    const el = d.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function qAllMany(selector) {
  const docs = getAllDocs();
  let out = [];
  for (const d of docs) out = out.concat(Array.from(d.querySelectorAll(selector)));
  return out;
}

// Angular için daha sağlam doldurma
function angularFill(input, value) {
  if (!input) return false;
  input.focus();

  // Native value setter (Angular/React benzeri framework’ler için)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
  return true;
}

async function runAutomation() {
  const { tp_app_no, tp_step } = await chrome.storage.local.get(["tp_app_no", "tp_step"]);
  if (!tp_app_no) return;

  const url = location.href;

  // 1) /EDEVLET/giris sayfasında "GİRİŞ" tıkla
  if (url.includes("/EDEVLET/giris")) {
    const loginBtn = qAll('#text66 a, a[href*="turkiye.gov.tr"], a:has(img[alt*="turkiye"])');
    if (loginBtn) {
      console.log(TAG, "Step1: Login button found.");
      superClick(loginBtn);
      return;
    }
  }

  // 2) E-devlet sonrası açılan ekranda sol menü "Belgelerim" tıkla
  // Not: sayfa /belgelerim değilse, menüden geçiş yapacağız
  if (!url.includes("/belgelerim")) {
    // Birden fazla olasılık: metne göre bul (en sağlamı)
    const menuCandidates = qAllMany('a, button, div, span')
      .filter(el => (el.innerText || el.textContent || '').trim().toLowerCase() === 'belgelerim');

    if (menuCandidates.length) {
      console.log(TAG, "Step2: Belgelerim menu found by text.");
      superClick(menuCandidates[0]);
      return;
    }

    // Sizin eski id denemesi de kalsın (varsa hızlı yakalar)
    const legacy = qAll('#button528, #button528 *');
    if (legacy) {
      console.log(TAG, "Step2: Belgelerim found by #button528.");
      superClick(legacy);
      return;
    }
  }

  // 3) /belgelerim sayfasında: Dosya Türü=Marka, Başvuru No=tp_app_no, Ara
  if (url.includes("/belgelerim")) {
    // 3.1 Dosya Türü (ui-select container)
    const selectContainer = qAll('#selectbox550, [id*="selectbox"][id*="dosya"], .ui-select-container');
    if (selectContainer) {
      const matchTextEl =
        selectContainer.querySelector('.ui-select-match-text') ||
        selectContainer.querySelector('.ui-select-match');

      const current = (matchTextEl?.textContent || '').trim().toLowerCase();

      if (!current.includes('marka')) {
        console.log(TAG, "Step3: Opening Dosya Turu dropdown...");
        const toggle =
          selectContainer.querySelector('.ui-select-toggle') ||
          selectContainer.querySelector('button') ||
          selectContainer;

        superClick(toggle);
        await sleep(600);

        // ui-select seçenekleri bazen body’ye basılır, o yüzden tüm doc’larda ara
        const choices = qAllMany('.ui-select-choices-row, .ui-select-choices-row-inner, li[role="option"], [role="option"]');
        const marka = choices.find(el => (el.textContent || '').trim().toLowerCase().includes('marka'));

        if (marka) {
          console.log(TAG, "Step3: Selecting 'Marka'...");
          superClick(marka);
          await sleep(600);
        } else {
          console.log(TAG, "Step3: 'Marka' option not found yet.");
          return;
        }
      }
    }

    // 3.2 Başvuru Numarası
    const inputField =
      qAll('#textbox551 input') ||
      qAll('input[name*="basvuru"], input[placeholder*="Başvuru"], input');

    if (inputField && inputField.value !== tp_app_no) {
      console.log(TAG, "Step3: Filling application no...");
      angularFill(inputField, tp_app_no);
      await sleep(400);
    }

    // 3.3 Ara butonu
    const araBtn =
      qAll('#button549, #button549 *') ||
      qAll('button:has(i.fa-search), button:has(span:contains("Ara")), button');

    // Doğrulama: marka seçili + numara dolu
    const isMarkaOk =
      (qAll('#selectbox550 .ui-select-match-text')?.textContent || '').toLowerCase().includes('marka') ||
      (qAll('.ui-select-match-text')?.textContent || '').toLowerCase().includes('marka');

    const isNoOk = inputField && (inputField.value || '').trim().length >= tp_app_no.length;

    if (araBtn && isMarkaOk && isNoOk && tp_step !== "SEARCHED") {
      console.log(TAG, "Step3: Clicking Ara...");
      superClick(araBtn);
      await chrome.storage.local.set({ tp_step: "SEARCHED" });
      return;
    }
  }

  // (Opsiyonel) Arama sonrası sonuç açma (sizde vardı)
  const st = await chrome.storage.local.get("tp_step");
  if (st.tp_step === "SEARCHED") {
    await sleep(2000);
    const plus =
      qAll('.ui-row-toggler') ||
      qAll('.fa-plus') ||
      qAll('i.fa-search-plus');

    if (plus) {
      console.log(TAG, "Step5: Expanding accordion...");
      superClick(plus);
      await chrome.storage.local.remove(["tp_step"]);
    }
  }
}

// Daha sık ve ilk yüklemede de çalıştır
runAutomation().catch(()=>{});
setInterval(() => runAutomation().catch(()=>{}), 1200);
