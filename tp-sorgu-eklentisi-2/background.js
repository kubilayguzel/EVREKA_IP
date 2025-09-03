
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request && request.type === 'SORGULA_KISI' && request.data) {
    // Artık burada tabs API kullanılmıyor. Web sayfanız yeni sekmeyi kendisi açmalı:
    // window.open('https://www.turkpatent.gov.tr/arastirma-yap?form=trademark&kisiNo=XXX&return=ENCODED_URL', '_blank')
    sendResponse({ status: 'OK', message: 'Lütfen sorgu sekmesini web sayfanızda window.open ile açın.' });
  }
  return true;
});