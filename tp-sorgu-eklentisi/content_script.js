// Content script: robust fill & submit on /trademark with detailed logs
const TAG='[Evreka CS]';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function waitFor(checkFn, {timeout=20000, interval=120, label=''} = {}) {
  const t0 = Date.now();
  return new Promise(async (resolve) => {
    let iter = 0;
    while (Date.now() - t0 < timeout) {
      try {
        const el = typeof checkFn === 'string' ? document.querySelector(checkFn) : checkFn();
        if (el) {
          console.log(TAG, 'waitFor OK:', label || checkFn, 'in', Date.now()-t0,'ms');
          return resolve(el);
        }
      } catch(e) {
        console.warn(TAG, 'waitFor error:', label, e);
      }
      if (++iter % 10 === 0) console.log(TAG, 'waitFor polling...', label, 'elapsed', Date.now()-t0,'ms');
      await sleep(interval);
    }
    console.warn(TAG, 'waitFor TIMEOUT:', label);
    resolve(null);
  });
}

// Native setter so React/MUI controlled inputs pick it up
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
  console.log(TAG, 'fillReactInput ->', value);
  input.focus();
  setNativeValue(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
}

function findButtonByText(...texts) {
  const norm = s => (s||'').trim().toLowerCase().replace(/\s+/g,' ');
  const want = new Set(texts.map(t => norm(t)));
  const nodes = Array.from(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]'));
  const hit = nodes.find(n => want.has(norm(n.innerText) || norm(n.value)));
  if (hit) console.log(TAG, 'Button found by text:', hit.innerText || hit.value);
  return hit;
}

function highlight(el) {
  try {
    const orig = el.style.outline;
    el.style.outline = '3px solid #ff9800';
    setTimeout(()=>{ el.style.outline = orig; }, 1200);
  } catch {}
}

async function findAppNoInput() {
  console.log(TAG, 'Searching for Başvuru Numarası input...');
  // 1) Label -> for (exact text contains)
  const labels = Array.from(document.querySelectorAll('label'));
  for (const lb of labels) {
    const text = (lb.textContent||'').trim().toLowerCase();
    if (text.includes('başvuru numarası')) {
      const id = lb.getAttribute('for');
      if (id) {
        const el = document.getElementById(id);
        if (el && el.tagName === 'INPUT') { console.log(TAG,'Found by label[for]:', id); return el; }
      }
      const direct = lb.querySelector('input');
      if (direct) { console.log(TAG,'Found input inside label'); return direct; }
    }
  }
  // 2) placeholder (case-insensitive)
  let el = document.querySelector('input[placeholder*="Başvuru" i], input[placeholder*="başvuru" i]');
  if (el) { console.log(TAG,'Found by placeholder contains Başvuru'); return el; }
  // 3) name/id includes
  el = document.querySelector('input[name*="basvuru" i], input[id*="basvuru" i]');
  if (el) { console.log(TAG,'Found by name/id contains basvuru'); return el; }
  // 4) visible first input (fallback)
  el = Array.from(document.querySelectorAll('input')).find(i => i.offsetParent !== null);
  if (el) { console.log(TAG,'Fallback first visible input'); return el; }
  return null;
}

async function doQuery(appNo) {
  const url = location.href;
  console.log(TAG, 'doQuery url=', url, 'appNo=', appNo);
  if (!/^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(url)) {
    console.log(TAG, 'Not on /trademark yet; skipping.');
    return;
  }

  // Wait app shell mount & inputs
  await sleep(300);
  const input = await waitFor(findAppNoInput, { timeout: 20000, interval: 150, label: 'appNoInput' });
  if (!input) { console.warn(TAG,'Başvuru Numarası alanı bulunamadı.'); return; }
  highlight(input);

  fillReactInput(input, String(appNo||'').trim());

  // Button
  let btn = await waitFor(() => findButtonByText('SORGULA','Sorgula','Ara','Sorgu'), { timeout: 8000, label: 'SORGULA button' });
  if (!btn) btn = document.querySelector('button[type="submit"],input[type="submit"]');
  if (!btn) { console.warn(TAG,'SORGULA butonu bulunamadı.'); return; }
  highlight(btn);

  if (btn.disabled) {
    console.log(TAG, 'Button disabled; waiting enable...');
    await sleep(300);
  }

  try { btn.scrollIntoView({ block: 'center' }); } catch {}
  console.log(TAG, 'Clicking SORGULA...');
  btn.click();
  console.log(TAG, 'Sorgu gönderildi.');
}

// Re-trigger on hash changes too (e.g., /trademark#bn=...)
window.addEventListener('hashchange', () => {
  console.log(TAG, 'hashchange ->', location.hash);
}, false);

// Message from background
chrome.runtime.onMessage.addListener((msg) => {
  console.log(TAG, 'onMessage', msg);
  if (msg?.type === 'AUTO_FILL') {
    doQuery(msg.data);
  }
});

// Helpful: manual trigger for debugging from DevTools console
// window.__evrekaFill = (no) => doQuery(no);
