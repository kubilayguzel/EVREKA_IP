// [Evreka BG] Wide-match debug SW
const TAG='[Evreka BG]';
console.log(TAG, 'Service worker loaded.');

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  console.log(TAG, 'onMessageExternal received:', request, 'from:', sender?.origin);
  
  if (request?.type === 'SORGULA' && request.data) {
    const basvuruNo = String(request.data);
    console.log(TAG, 'Processing SORGULA request for:', basvuruNo);
    
    const targetUrl = "https://opts.turkpatent.gov.tr/trademark";

    const isTrademark = (url="") => /^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(url);
    const isLogin     = (url="") => /^https:\/\/opts\.turkpatent\.gov\.tr\/login\b/i.test(url);

    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      console.log(TAG, 'New tab created:', newTab.id);
      
      let messageAttempts = 0;
      const maxAttempts = 10;
      
      const tryToSendMessage = (tabId) => {
        console.log(TAG, 'Attempting to send message, attempt:', messageAttempts + 1);
        
        chrome.tabs.sendMessage(tabId, { type: 'AUTO_FILL', data: basvuruNo }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn(TAG, 'Message send error:', chrome.runtime.lastError.message);
            
            if (messageAttempts < maxAttempts) {
              messageAttempts++;
              setTimeout(() => tryToSendMessage(tabId), 200);
            } else {
              console.error(TAG, 'Failed to send message after', maxAttempts, 'attempts');
            }
          } else {
            console.log(TAG, '✅ Message sent successfully, response:', response);
          }
        });
      };
      
      const listener = async (tabId, changeInfo, tab) => {
        if (tabId !== newTab.id) return;

        const statusComplete = changeInfo.status === 'complete';
        const url = (changeInfo.url || tab?.url || "");
        
        if (changeInfo.url) console.log(TAG, 'URL changed:', changeInfo.url);
        if (statusComplete) console.log(TAG, 'Status complete for tab', tabId);

        if (!statusComplete && !url) return;
        if (isLogin(url)) { 
          console.log(TAG, 'At login page, waiting for user authentication...'); 
          return; 
        }

        if (isTrademark(url) || (statusComplete && isTrademark((tab && tab.url) || ""))) {
          console.log(TAG, 'At /trademark page, preparing to send AUTO_FILL message');
          
          // Biraz bekle, sonra mesaj göndermeye başla
          setTimeout(() => {
            tryToSendMessage(tabId);
          }, 500);
          
          // Listener'ı kaldır
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      
      chrome.tabs.onUpdated.addListener(listener);
    });

    sendResponse({ status: 'OK', message: 'Sorgu sekmesi açıldı.' });
  }
  
  return true;
});

console.log(TAG, 'Background script ready and listening for external messages');