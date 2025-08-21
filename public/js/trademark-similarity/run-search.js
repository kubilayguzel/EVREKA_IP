// js/trademark-similarity/run-search.js

// Firebase Firestore servislerini ve Cloud Function'ları çağırmak için gerekli modülleri import et
import { firebaseServices } from '../../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';

console.log(">>> run-search.js modülü yüklendi ve Firebase servisleri kullanılıyor <<<");

// Firebase Functions instance'ı oluştur
const functions = getFunctions(firebaseServices.app, "europe-west1"); // firebaseServices.app, Firebase app objenizi temsil etmeli

// performTrademarkSimilaritySearch Cloud Function'ını çağırılabilir yap
const performSearchCallable = httpsCallable(functions, 'performTrademarkSimilaritySearch');

/**
 * Marka benzerliği aramasını çalıştıran ana fonksiyon.
 * Artık tüm hesaplama bir Firebase Cloud Function üzerinde gerçekleşir.
 *
 * @param {Array} monitoredMarks - İzlenen markalar array'i (her biri markName, applicationDate, niceClasses içerir).
 * @param {string} selectedBulletinId - Seçilen bültenin Firestore doküman ID'si.
 * @returns {Array} Benzerlik skorlarına göre sıralanmış eşleşen markalar listesi.
 */
export async function runTrademarkSearch(monitoredMarks, selectedBulletinId) {
  try {
    console.log('🚀 Cloud Function çağrılıyor:', {
      monitoredMarksCount: monitoredMarks.length,
      selectedBulletinId,
      firstMark: monitoredMarks[0] // İlk markayı debug için logla
    });

    const response = await performSearchCallable({
      monitoredMarks: monitoredMarks, // Array olarak gönder
      selectedBulletinId
    });

    const data = response.data;
    console.log('✅ Cloud Function yanıtı alındı:', {
      success: data.success,
      resultsCount: data.results?.length || 0
    });
    
    return data.results || [];
  } catch (error) {
    console.error('❌ Cloud Function çağrılırken hata:', error);
    console.error('Hata detayları:', {
      code: error.code,
      message: error.message,
      details: error.details
    });
    return [];
  }
}

// Artık client tarafında tüm kayıtları önbelleğe almaya gerek kalmadı.
// loadAllTrademarkBulletinRecords() kaldırıldı.