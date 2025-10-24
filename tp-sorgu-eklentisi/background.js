// [Evreka BG] Wide-match debug SW with session storage backup
const TAG='[Evreka BG]';
console.log(TAG, 'Service worker loaded.');

// Başvuru numaralarını sakla (tab bazlı)
const pendingQueries = new Map(); // tabId -> applicationNumber

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  console.log(TAG, 'onMessageExternal received:', request, 'from:', sender?.origin);
  
  if (request?.type === 'SORGULA' && request.data) {
    const basvuruNo = String(request.data);
    console.log(TAG, 'Processing SORGULA request for:', basvuruNo);
    
    const targetUrl = `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(basvuruNo)}`;

    const isTrademark = (url="") => /^https:\/\/opts\.turkpatent\.gov\.tr\/trademark\b/i.test(url);
    const isLogin = (url="") => /login|auth|giris/i.test(url);
    const isHome = (url="") => /\/home\b/i.test(url);

    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      console.log(TAG, 'New tab created:', newTab.id, 'with URL:', targetUrl);
      
      // Bu sekme için başvuru numarasını sakla
      pendingQueries.set(newTab.id, basvuruNo);
      console.log(TAG, '💾 Stored query for tab:', newTab.id, '→', basvuruNo);
      
      let messageAttempts = 0;
      const maxAttempts = 25;
      let isWaitingForLogin = false;
      let hasSeenHome = false;
      let hasProcessedTrademark = false;
      
      const tryToSendMessage = (tabId) => {
        messageAttempts++;
        console.log(TAG, `Attempting to send message (${messageAttempts}/${maxAttempts})`);
        
        const storedAppNo = pendingQueries.get(tabId);
        if (!storedAppNo) {
          console.warn(TAG, '⚠️ No stored query for tab:', tabId);
          return;
        }
        
        chrome.tabs.sendMessage(tabId, { 
          type: 'AUTO_FILL', 
          data: storedAppNo 
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn(TAG, 'Message send error:', chrome.runtime.lastError.message);
            
            if (messageAttempts < maxAttempts) {
              const retryDelay = isWaitingForLogin ? 2000 : 500;
              setTimeout(() => tryToSendMessage(tabId), retryDelay);
            } else {
              console.error(TAG, 'Failed to send message after', maxAttempts, 'attempts');
              pendingQueries.delete(tabId);
            }
          } else {
            console.log(TAG, '✅ Message sent successfully, response:', response);
            isWaitingForLogin = false;
            // Başarılı olduktan sonra birkaç saniye tut (tekrar gerekirse)
            setTimeout(() => {
              pendingQueries.delete(tabId);
              console.log(TAG, '🧹 Cleaned up query for tab:', tabId);
            }, 10000);
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
        
        // Login sayfası
        if (isLogin(url)) { 
          console.log(TAG, '🔐 Login page detected, waiting...');
          isWaitingForLogin = true;
          messageAttempts = 0;
          return;
        }

        // Home sayfası
        if (isHome(url)) {
          console.log(TAG, '🏠 Home page after login');
          hasSeenHome = true;
          isWaitingForLogin = false;
          return;
        }

        // Trademark sayfası
        if (isTrademark(url) || (statusComplete && isTrademark((tab && tab.url) || ""))) {
          console.log(TAG, '✅ At /trademark page');
          
          // Zaten işlendiyse tekrar işleme
          if (hasProcessedTrademark && !isWaitingForLogin && !hasSeenHome) {
            console.log(TAG, '⏭️ Already processed trademark, skipping');
            return;
          }
          
          hasProcessedTrademark = true;
          
          if (isWaitingForLogin || hasSeenHome) {
            console.log(TAG, '🎉 Login successful! User returned to trademark');
            isWaitingForLogin = false;
            hasSeenHome = false;
          }
          
          const storedAppNo = pendingQueries.get(tabId);
          if (!storedAppNo) {
            console.warn(TAG, '⚠️ No stored query found for this tab');
            return;
          }
          
          // Hash kontrol
          const currentHash = (tab.url || '').split('#')[1] || '';
          const expectedHash = `bn=${encodeURIComponent(storedAppNo)}`;
          
          if (!currentHash.includes(expectedHash)) {
            console.log(TAG, '⚠️ Hash lost, reapplying...');
            chrome.tabs.update(tabId, { 
              url: `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(storedAppNo)}` 
            });
            return;
          }
          
          console.log(TAG, '✅ Hash intact:', currentHash);
          
          // Mesaj gönder
          console.log(TAG, 'Preparing to send AUTO_FILL message');
          setTimeout(() => {
            tryToSendMessage(tabId);
          }, 1000);
          
          // Listener'ı 10 saniye sonra kaldır (tekrar login olursa diye)
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            console.log(TAG, 'Listener removed after delay');
          }, 10000);
        }
      };
      
      chrome.tabs.onUpdated.addListener(listener);
      
      // Tab kapanırsa temizle
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

// API: Content script'ten query sorma
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === 'GET_PENDING_QUERY' && sender.tab?.id) {
    const tabId = sender.tab.id;
    const query = pendingQueries.get(tabId);
    console.log(TAG, 'Content script requested query for tab:', tabId, '→', query || 'none');
    sendResponse({ query: query || null });
    return true;
  }
});

console.log(TAG, 'Background script ready and listening for external messages');