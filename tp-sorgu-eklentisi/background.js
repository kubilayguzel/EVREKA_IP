// Background: open /trademark and wait through e-Devlet if needed.
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request?.type === 'SORGULA' && request.data) {
    const basvuruNo = String(request.data);
    const targetUrl = "https://opts.turkpatent.gov.tr/trademark";

    const isTrademark = (url="") => /^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(url);
    const isLogin     = (url="") => /^https:\/\/opts\.turkpatent\.gov\.tr\/login\b/i.test(url);

    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      const listener = async (tabId, changeInfo, tab) => {
        if (tabId !== newTab.id) return;

        // React to either full load or URL change
        const statusComplete = changeInfo.status === 'complete';
        const url = (changeInfo.url || tab?.url || "");

        if (!statusComplete && !url) return;

        // If user is on login, do nothing; they'll come back here in the same tab
        if (isLogin(url)) return;

        // When we finally land on /trademark, inject message
        if (isTrademark(url) || (statusComplete && isTrademark((tab && tab.url) || ""))) {
          try {
            chrome.tabs.sendMessage(tabId, { type: 'AUTO_FILL', data: basvuruNo });
          } catch (e) {
            console.warn('[Evreka Eklenti] sendMessage hatası:', e);
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
