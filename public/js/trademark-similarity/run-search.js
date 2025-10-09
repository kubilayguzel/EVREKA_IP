// js/trademark-similarity/run-search.js

import { firebaseServices } from '../../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log(">>> run-search.js modülü yüklendi ve Firebase servisleri kullanılıyor <<<");

const functions = getFunctions(firebaseServices.app, "europe-west1");
const db = getFirestore(firebaseServices.app);
const performSearchCallable = httpsCallable(functions, 'performTrademarkSimilaritySearch');

export async function runTrademarkSearch(monitoredMarks, selectedBulletinId, onProgress) {
  try {
    console.log('🚀 Cloud Function çağrılıyor (ASYNC mode):', {
      monitoredMarksCount: monitoredMarks.length,
      selectedBulletinId
    });

    // Async mode ile başlat
    const response = await performSearchCallable({
      monitoredMarks,
      selectedBulletinId,
      async: true
    });

    const data = response.data;
    
    if (!data.success || !data.jobId) {
      throw new Error('Job başlatılamadı');
    }

    const jobId = data.jobId;
    console.log('✅ Job başlatıldı:', jobId);

    // Progress tracking
    return new Promise((resolve, reject) => {
      const progressRef = doc(db, 'searchProgress', jobId);
      
      const unsubscribe = onSnapshot(progressRef, (snapshot) => {
        if (!snapshot.exists()) {
          unsubscribe();
          reject(new Error('Job bulunamadı'));
          return;
        }

        const progressData = snapshot.data();
        console.log('📊 Progress:', progressData.progress + '%', 
                    `(${progressData.processed}/${progressData.total})`);

        // Progress callback
        if (onProgress) {
          onProgress({
            progress: progressData.progress,
            processed: progressData.processed,
            total: progressData.total,
            currentResults: progressData.currentResults || 0,
            status: progressData.status
          });
        }

        // Tamamlandı
        if (progressData.status === 'completed') {
          unsubscribe();
          console.log('✅ Arama tamamlandı:', progressData.results.length, 'sonuç');
          resolve(progressData.results || []);
        }

        // Hata
        if (progressData.status === 'error') {
          unsubscribe();
          console.error('❌ Arama hatası:', progressData.error);
          reject(new Error(progressData.error || 'Arama sırasında hata oluştu'));
        }
      }, (error) => {
        console.error('❌ Snapshot hatası:', error);
        reject(error);
      });

      // 15 dakika timeout (güvenlik için)
      setTimeout(() => {
        unsubscribe();
        reject(new Error('İşlem zaman aşımına uğradı (15 dk)'));
      }, 15 * 60 * 1000);
    });

  } catch (error) {
    console.error('❌ Cloud Function çağrılırken hata:', error);
    console.error('Hata detayları:', {
      code: error.code,
      message: error.message,
      details: error.details
    });
    throw error;
  }
}