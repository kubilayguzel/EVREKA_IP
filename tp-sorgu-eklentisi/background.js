// [Evreka BG] Wide-match debug SW
const TAG='[Evreka BG]';
console.log(TAG, 'Service worker loaded.');

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  console.log(TAG, 'onMessageExternal', request, 'from', sender?.origin);
  if (request?.type === 'SORGULA' && request.data) {
    const basvuruNo = String(request.data);
    const targetUrl = "https://opts.turkpatent.gov.tr/trademark";

    const isTrademark = (url="") => /^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(url);
    const isLogin     = (url="") => /^https:\/\/opts\.turkpatent\.gov\.tr\/login\b/i.test(url);

    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      console.log(TAG, 'Tab created', newTab);
      const listener = async (tabId, changeInfo, tab) => {
        if (tabId !== newTab.id) return;

        const statusComplete = changeInfo.status === 'complete';
        const url = (changeInfo.url || tab?.url || "");
        if (changeInfo.url) console.log(TAG, 'URL changed:', changeInfo.url);
        if (statusComplete) console.log(TAG, 'Status complete for tab', tabId);

        if (!statusComplete && !url) return;
        if (isLogin(url)) { console.log(TAG,'At login, waiting user to auth...'); return; }

        if (isTrademark(url) || (statusComplete && isTrademark((tab && tab.url) || ""))) {
          console.log(TAG, 'At /trademark, sending AUTO_FILL with', basvuruNo);
          try {
            chrome.tabs.sendMessage(tabId, { type: 'AUTO_FILL', data: basvuruNo });
          } catch (e) {
            console.warn(TAG, 'sendMessage error:', e);
          }
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    sendResponse({ status: 'OK', message: 'Sorgu sekmesi açıldı.' });
  }
  return true;
});
