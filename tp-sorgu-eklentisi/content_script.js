// Content script: robust fill & submit on /trademark
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function waitFor(checkFn, {timeout=15000, interval=100} = {}) {
  const t0 = Date.now();
  return new Promise(async (resolve) => {
    while (Date.now() - t0 < timeout) {
      try {
        const el = typeof checkFn === 'string' ? document.querySelector(checkFn) : checkFn();
        if (el) return resolve(el);
      } catch {}
      await sleep(interval);
    }
    resolve(null);
  });
}

// Set value using native setter so React/MUI controlled inputs pick it up
function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) {
    desc.set.call(el, value);
  } else {
    el.value = value;
  }
}

function fillReactInput(input, value) {
  input.focus();
  setNativeValue(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur(); // some forms enable button on blur
}

function findButtonByText(...texts) {
  const norm = s => (s||'').trim().toLowerCase().replace(/\s+/g,' ');
  const want = new Set(texts.map(t => norm(t)));
  const nodes = Array.from(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]'));
  return nodes.find(n => want.has(norm(n.innerText) || norm(n.value)));
}

async function findAppNoInput() {
  // 1) Label -> for
  const labels = Array.from(document.querySelectorAll('label'));
  for (const lb of labels) {
    const t = (lb.textContent||'').toLowerCase();
    if (t.includes('başvuru')) {
      const id = lb.getAttribute('for');
      if (id) {
        const el = document.getElementById(id);
        if (el && el.tagName === 'INPUT') return el;
      }
      const direct = lb.querySelector('input');
      if (direct) return direct;
    }
  }
  // 2) placeholder/name
  const cand = Array.from(document.querySelectorAll('input'));
  const byPh = cand.find(i => (i.getAttribute('placeholder')||'').toLowerCase().includes('başvuru'));
  if (byPh) return byPh;
  const byName = cand.find(i => (i.getAttribute('name')||'').toLowerCase().includes('basvuru'));
  if (byName) return byName;

  // 3) visible first input fallback
  return cand.find(i => i.offsetParent !== null) || null;
}

async function doQuery(appNo) {
  const url = location.href;
  if (!/^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(url)) return;

  // Wait app shell mount
  await sleep(300);

  const input = await waitFor(findAppNoInput, { timeout: 20000, interval: 150 });
  if (!input) {
    console.warn('[Evreka] Başvuru Numarası alanı bulunamadı.');
    return;
  }

  // Write and make sure button becomes enabled
  fillReactInput(input, String(appNo||'').trim());

  // Find the SORGULA button (uppercase or title-case)
  let btn = await waitFor(() => findButtonByText('SORGULA','Sorgula','Ara','Sorgu'), { timeout: 8000 });
  if (!btn) btn = document.querySelector('button[type="submit"],input[type="submit"]');
  if (!btn) {
    console.warn('[Evreka] SORGULA butonu bulunamadı.');
    return;
  }

  if (btn.disabled) {
    await sleep(250);
  }
  try { btn.scrollIntoView({ block: 'center' }); } catch {}
  btn.click();
  console.log('[Evreka] Sorgu gönderildi.');
}

// Message from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'AUTO_FILL') {
    doQuery(msg.data);
  }
});
