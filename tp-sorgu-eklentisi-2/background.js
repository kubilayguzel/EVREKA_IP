const resultCache = new Map();
const processedAppNos = new Set();
// Web sitenizden gelen mesajları dinle
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
// Başvuru No (geriye uyum): SORGULA veya SORGULA_BASVURU
  if ((request.type === 'SORGULA' || request.type === 'SORGULA_BASVURU') && request.data) {
    const appNo = request.data;
    // YENİ: opts.turkpatent.gov.tr'ye yönlendir
    const targetUrl = `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(appNo)}`;
    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.sendMessage(tabId, { type: 'AUTO_FILL_OPTS', data: appNo });
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    sendResponse({ status: 'OK', message: 'Başvuru No sekmesi açıldı.' });
    return true;
  }

  // Sahip No: SORGULA_KISI
  if (request.type === 'SORGULA_KISI' && request.data) {
    const ownerId = request.data;
    const targetUrl = "https://www.turkpatent.gov.tr/arastirma-yap?form=trademark";
    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.sendMessage(tabId, { type: 'AUTO_FILL_KISI', data: ownerId });
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    sendResponse({ status: 'OK', message: 'Sahip No sekmesi açıldı.' });
    return true;
  }

  // Geriye uyumluluk için eski SORGULA mesajı
  if (request.type === 'SORGULA' && request.data) {
    const basvuruNo = request.data;
    const targetUrl = "https://www.turkpatent.gov.tr/arastirma-yap?form=trademark";

    // Yeni bir sekme oluştur
    chrome.tabs.create({ url: targetUrl }, (newTab) => {
      // Bu yeni sekmenin yüklenmesini dinlemek için bir olay dinleyici ekle
      const listener = (tabId, changeInfo, tab) => {
        // Eğer güncellenen sekme bizim oluşturduğumuz sekme ise VE yüklenmesi tamamlandıysa
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          // Mesajı şimdi, yani sayfa tamamen hazır olduğunda gönder
          chrome.tabs.sendMessage(tabId, {
            type: 'AUTO_FILL',
            data: basvuruNo
          });
          // İşi bittiği için bu dinleyiciyi bellekten kaldır
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      
      // Sekme güncelleme olaylarını dinlemeye başla
      chrome.tabs.onUpdated.addListener(listener);
    });

    sendResponse({ status: 'OK', message: 'Sorgulama sekmesi oluşturuldu ve yüklenmesi bekleniyor.' });
  }
  return true; 
});

// Content script'ten gelen verileri ana uygulamaya ilet
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'FORWARD_TO_APP') {
    const { messageType, data } = request;
    
    console.log('[Background] Content script\'ten veri alındı:', messageType);
    
    // Tüm sekmelere broadcast et (ana uygulama dinleyecek)
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        // Sadece allowed domain'lere gönder
        const allowedOrigins = [
          'http://localhost',
          'https://ip-manager-production-aab4b.web.app',
          'https://kubilayguzel.github.io'
        ];
        
        const tabUrl = tab.url || '';
        const isAllowed = allowedOrigins.some(origin => tabUrl.startsWith(origin));
        
        if (isAllowed) {
          chrome.tabs.sendMessage(tab.id, {
            type: messageType,
            source: 'tp-sorgu-eklentisi-2',
            data: data
          }).catch(() => {
            // Tab mesaj dinlemiyorsa sessizce geç
          });
        }
      });
    });
    
    sendResponse({ status: 'OK' });
  }

  // ============================================
  // RESULT CACHE SYSTEM
  // ============================================
  // Content script'ten veri geldiğinde cache'e kaydet
  if (request.type === 'FORWARD_TO_APP') {
    const { messageType, data } = request;
    
    console.log('[Background] Veri cache\'e kaydediliyor:', messageType);
    
    // Başvuru numarasını bul
    let appNo = null;
    if (Array.isArray(data) && data[0]?.applicationNumber) {
      appNo = data[0].applicationNumber;
    } else if (data?.applicationNumber) {
      appNo = data.applicationNumber;
    }
    
    if (appNo) {
      resultCache.set(appNo, {
        type: messageType,
        data: data,
        timestamp: Date.now()
      });
      
      console.log('[Background] ✅ Cache\'e kaydedildi:', appNo);
      
      // 5 dakika sonra otomatik sil
      setTimeout(() => {
        resultCache.delete(appNo);
        console.log('[Background] Cache temizlendi:', appNo);
      }, 300000);
    }
    
    // ACK: içerik scriptine "veri alındı" mesajı gönder
    try {
      // Hata düzeltildi: 'and' yerine '&&' kullanıldı ve gerekli kontroller eklendi
      const appNoForAck = appNo; // appNo'yu kullanıyoruz
      if (sender && sender.tab && sender.tab.id && appNoForAck) {
        chrome.tabs.sendMessage(sender.tab.id, { type: 'VERI_ALINDI_OK', appNo: appNoForAck });
      }
    } catch (e) { 
      /* ignore */ 
      console.error("[Background] ACK gönderilirken hata oluştu:", e);
    }
    
    sendResponse({ status: 'OK' });
    return true;
  }
  
  // Ana uygulamadan polling sorgusu
  if (request.type === 'GET_RESULT' && request.applicationNumber) {
    const appNo = request.applicationNumber;
    const cached = resultCache.get(appNo);
    
    if (cached) {
      console.log('[Background] ✅ Cache\'ten döndürülüyor:', appNo);
      resultCache.delete(appNo); // Bir kez kullan
      
      sendResponse({
        status: 'READY',
        data: cached.data,
        messageType: cached.type
      });
    } else {
      sendResponse({ status: 'WAITING' });
    }
    return true;
  }
  
  return true;
});
