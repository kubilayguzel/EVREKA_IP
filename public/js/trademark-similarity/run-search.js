// js/trademark-similarity/run-search.js

import { firebaseServices } from '../../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { getFirestore, doc, onSnapshot, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log(">>> run-search.js modülü yüklendi (Sadeleştirilmiş Worker Versiyonu) <<<");

const functions = getFunctions(firebaseServices.app, "europe-west1");
const db = getFirestore(firebaseServices.app);
const performSearchCallable = httpsCallable(functions, 'performTrademarkSimilaritySearch');

export async function runTrademarkSearch(monitoredMarks, selectedBulletinId, onProgress) {
  try {
    console.log('🚀 Cloud Function çağrılıyor (ASYNC mode):', {
      monitoredMarksCount: monitoredMarks.length,
      selectedBulletinId
    });

    // İlk başlatma
    const response = await performSearchCallable({
      monitoredMarks,
      selectedBulletinId,
      startIndex: 0, 
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
      // Workerları dinlemeye devam ediyoruz (Çünkü ana yüzdeyi burası hesaplıyor)
      const workersRef = collection(db, 'searchProgress', jobId, 'workers'); 
      
      let safetyTimeout;
      let mainState = { status: 'starting', totalMarks: monitoredMarks.length };
      let workersState = {}; 

      let unsubscribeMain = null;
      let unsubscribeWorkers = null;

      const cleanup = () => {
        if (safetyTimeout) clearTimeout(safetyTimeout);
        if (unsubscribeMain) unsubscribeMain();
        if (unsubscribeWorkers) unsubscribeWorkers();
      };

      const resetSafetyTimeout = () => {
          if (safetyTimeout) clearTimeout(safetyTimeout);
          safetyTimeout = setTimeout(() => {
              cleanup();
              reject(new Error('İşlem zaman aşımına uğradı (Uzun süre işlem yapılmadı)'));
          }, 15 * 60 * 1000); 
      };

      resetSafetyTimeout();

      // 1. WORKERLARI DİNLEME (Sadece toplam sayı için)
      unsubscribeWorkers = onSnapshot(workersRef, (snapshot) => {
        resetSafetyTimeout();
        
        snapshot.forEach(doc => {
            workersState[doc.id] = doc.data();
        });

        updateGlobalProgress();
      });

      // 2. ANA DÖKÜMANI DİNLEME
      unsubscribeMain = onSnapshot(progressRef, async (snapshot) => {
        if (!snapshot.exists()) {
          cleanup();
          reject(new Error('Job bulunamadı'));
          return;
        }

        mainState = snapshot.data();
        updateGlobalProgress(); 

        if (mainState.status === 'error') {
          cleanup();
          console.error('❌ Arama hatası:', mainState.error);
          reject(new Error(mainState.error || 'Arama sırasında hata oluştu'));
        }

        if (mainState.status === 'completed') {
          cleanup(); 
          console.log(`✅ İşlem tamamlandı. Veritabanından sonuçlar indiriliyor...`);

          const resultsRef = collection(db, 'searchProgress', jobId, 'foundResults');
          
          try {
            const snapshot = await getDocs(resultsRef);
            const allResults = snapshot.docs.map(doc => doc.data());
            console.log(`📥 ${allResults.length} adet sonuç başarıyla indirildi.`);
            resolve(allResults);
          } catch (err) {
            console.error("Sonuçları indirirken hata oluştu:", err);
            reject(new Error("Sonuçlar veritabanından çekilemedi."));
          }
        }
      }, (error) => {
        console.error('❌ Snapshot hatası:', error);
        cleanup();
        reject(error);
      });

      // --- YARDIMCI FONKSİYON: Sadece Global İlerlemeyi Hesapla ---
      function updateGlobalProgress() {
          const workerKeys = Object.keys(workersState);
          let totalProcessed = 0;

          // Worker'ların işlediği toplam sayıyı topla
          workerKeys.forEach(key => {
              const w = workersState[key];
              totalProcessed += (w.processed || 0);
          });

          // Ana toplam sayı
          const totalMarks = mainState.totalMarks || monitoredMarks.length;
          
          // Yüzde hesabı (Tahmini 5000 satır üzerinden veya backend'den gelen bilgiyle)
          const globalProgress = totalMarks > 0 ? Math.min(100, Math.floor((totalProcessed / 5000) * 100)) : 0; 

          if (onProgress) {
              // ARTIK 'workers' ARRAY'İ GÖNDERİLMİYOR
              onProgress({
                  status: mainState.status,
                  progress: globalProgress,
                  processed: totalProcessed, 
                  total: totalMarks,
                  currentResults: mainState.currentResults || 0,
                  message: mainState.status === 'resuming' ? 'İşlem devrediliyor...' : null
              });
          }
      }

    });

  } catch (error) {
    console.error('❌ Cloud Function çağrılırken hata:', error);
    throw error;
  }
}