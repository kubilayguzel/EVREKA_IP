// [Evreka BG] Wide-match debug SW
const TAG='[Evreka BG]';
console.log(TAG, 'Service worker loaded.');

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  console.log(TAG, 'onMessageExternal received:', request, 'from:', sender?.origin);
  
  if (request?.type === 'SORGULA' && request.data) {
    const basvuruNo = String(request.data);
    console.log(TAG, 'Processing SORGULA request for:', basvuruNo);
    
    // Hash parametresi ile URL oluştur (login sonrası da korunur)
    const targetUrl = `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(basvuruNo)}`;

    const isTrademark = (url="") => /^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(url);
    const isLogin = (url="") => /login|auth|giris|e-devlet/i.test(url);

    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      console.log(TAG, 'New tab created:', newTab.id, 'with URL:', targetUrl);
      
      let messageAttempts = 0;
      const maxAttempts = 15; // Login süresi için daha fazla deneme
      let isWaitingForLogin = false;
      
      const tryToSendMessage = (tabId) => {
        console.log(TAG, 'Attempting to send message, attempt:', messageAttempts + 1);
        
        chrome.tabs.sendMessage(tabId, { type: 'AUTO_FILL', data: basvuruNo }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn(TAG, 'Message send error:', chrome.runtime.lastError.message);
            
            if (messageAttempts < maxAttempts) {
              messageAttempts++;
              // Login bekliyorsa daha uzun interval
              const retryDelay = isWaitingForLogin ? 2000 : 300;
              setTimeout(() => tryToSendMessage(tabId), retryDelay);
            } else {
              console.error(TAG, 'Failed to send message after', maxAttempts, 'attempts');
            }
          } else {
            console.log(TAG, '✅ Message sent successfully, response:', response);
            isWaitingForLogin = false;
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
        
        // Login sayfası tespit edildi
        if (isLogin(url)) { 
          console.log(TAG, '🔐 Login page detected, waiting for user authentication...');
          isWaitingForLogin = true;
          return; // Kullanıcı giriş yapana kadar bekle
        }

        // Trademark sayfasına ulaşıldı
        if (isTrademark(url) || (statusComplete && isTrademark((tab && tab.url) || ""))) {
          console.log(TAG, '✅ At /trademark page');
          
          if (isWaitingForLogin) {
            console.log(TAG, '🎉 Login successful! User returned to trademark page');
            isWaitingForLogin = false;
          }
          
          // Hash korundu mu kontrol et
          const currentHash = (tab.url || '').split('#')[1] || '';
          if (!currentHash.includes(`bn=${encodeURIComponent(basvuruNo)}`)) {
            console.log(TAG, '⚠️ Hash lost after login, reapplying...');
            // Hash'i yeniden ekle
            chrome.tabs.update(tabId, { 
              url: `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(basvuruNo)}` 
            });
            return;
          }
          
          // Mesaj göndermeye başla
          console.log(TAG, 'Preparing to send AUTO_FILL message');
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