// [Evreka BG] Wide-match debug SW with session storage backup
const TAG='[Evreka BG]';
console.log(TAG, 'Service worker loaded.');

// Başvuru numaralarını sakla (session timeout için)
const pendingQueries = new Map(); // tabId -> applicationNumber

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  console.log(TAG, 'onMessageExternal received:', request, 'from:', sender?.origin);
  
  if (request?.type === 'SORGULA' && request.data) {
    const basvuruNo = String(request.data);
    console.log(TAG, 'Processing SORGULA request for:', basvuruNo);
    
    // Hash parametresi ile URL oluştur (login sonrası da korunur)
    const targetUrl = `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(basvuruNo)}`;

    const isTrademark = (url="") => /^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(url);
    const isLogin = (url="") => /login|auth|giris/i.test(url);
    const isHome = (url="") => /\/home\b/i.test(url);

    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      console.log(TAG, 'New tab created:', newTab.id, 'with URL:', targetUrl);
      
      // Bu sekme için başvuru numarasını sakla
      pendingQueries.set(newTab.id, basvuruNo);
      
      let messageAttempts = 0;
      const maxAttempts = 20; // Login süresi için daha fazla deneme
      let isWaitingForLogin = false;
      let hasSeenHome = false; // Home sayfasını gördük mü?
      
      const tryToSendMessage = (tabId) => {
        messageAttempts++;
        console.log(TAG, `Attempting to send message (${messageAttempts}/${maxAttempts})`);
        
        chrome.tabs.sendMessage(tabId, { 
          type: 'AUTO_FILL', 
          data: basvuruNo 
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn(TAG, 'Message send error:', chrome.runtime.lastError.message);
            
            if (messageAttempts < maxAttempts) {
              // Login bekliyorsa daha uzun interval
              const retryDelay = isWaitingForLogin ? 2000 : 400;
              setTimeout(() => tryToSendMessage(tabId), retryDelay);
            } else {
              console.error(TAG, 'Failed to send message after', maxAttempts, 'attempts');
              // Temizlik
              pendingQueries.delete(tabId);
            }
          } else {
            console.log(TAG, '✅ Message sent successfully, response:', response);
            isWaitingForLogin = false;
            // Başarılı olunca temizle
            pendingQueries.delete(tabId);
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
          messageAttempts = 0; // Reset counter
          return;
        }

        // Home sayfası tespit edildi (login sonrası ilk durak)
        if (isHome(url)) {
          console.log(TAG, '🏠 Home page detected after login');
          hasSeenHome = true;
          isWaitingForLogin = false;
          return;
        }

        // Trademark sayfasına ulaşıldı
        if (isTrademark(url) || (statusComplete && isTrademark((tab && tab.url) || ""))) {
          console.log(TAG, '✅ At /trademark page');
          
          if (isWaitingForLogin || hasSeenHome) {
            console.log(TAG, '🎉 Login successful! User returned to trademark page');
            isWaitingForLogin = false;
          }
          
          // Hash kontrol et
          const currentHash = (tab.url || '').split('#')[1] || '';
          const expectedHash = `bn=${encodeURIComponent(basvuruNo)}`;
          
          if (!currentHash.includes(expectedHash)) {
            console.log(TAG, '⚠️ Hash lost after login, reapplying...');
            
            // Hash'i yeniden ekle
            chrome.tabs.update(tabId, { 
              url: `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(basvuruNo)}` 
            });
            
            // URL güncellendikten sonra tekrar listener tetiklenecek
            return;
          }
          
          console.log(TAG, '✅ Hash intact:', currentHash);
          
          // Mesaj göndermeye başla
          console.log(TAG, 'Preparing to send AUTO_FILL message');
          setTimeout(() => {
            tryToSendMessage(tabId);
          }, 800); // Biraz daha uzun bekle
          
          // Listener'ı kaldır
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      
      chrome.tabs.onUpdated.addListener(listener);
      
      // Tab kapatılırsa temizlik yap
      chrome.tabs.onRemoved.addListener((closedTabId) => {
        if (closedTabId === newTab.id) {
          console.log(TAG, 'Tab closed, cleaning up');
          pendingQueries.delete(closedTabId);
          chrome.tabs.onUpdated.removeListener(listener);
        }
      });
    });

    sendResponse({ status: 'OK', message: 'Sorgu sekmesi açıldı.' });
  }
  
  return true;
});

console.log(TAG, 'Background script ready and listening for external messages');