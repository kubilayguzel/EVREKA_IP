// js/trademark-similarity/run-search.js

import { firebaseServices } from '../../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { getFirestore, doc, onSnapshot, collection, getDocs, query, limit, startAfter, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log(">>> run-search.js modülü yüklendi (Batch Download Versiyonu) <<<");

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
          }, 20 * 60 * 1000); // Süreyi 20 dakikaya çıkardık (Büyük veri indirme payı)
      };

      resetSafetyTimeout();

      // 1. WORKERLARI DİNLEME
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

        // --- DEĞİŞİKLİK: TAMAMLANDIĞINDA PARÇA PARÇA İNDİRME ---
        if (mainState.status === 'completed') {
          cleanup(); 
          console.log(`✅ İşlem tamamlandı. ${mainState.currentResults || 0} sonuç parça parça indiriliyor...`);

          try {
            // Batch Download Fonksiyonunu Çağır
            const allResults = await getAllResultsInBatches(jobId, (downloadedCount) => {
                 // İndirme sırasında kullanıcıya bilgi verelim
                 if (onProgress) {
                     onProgress({
                        status: 'downloading',
                        progress: 100,
                        currentResults: mainState.currentResults,
                        message: `Sonuçlar indiriliyor... (${downloadedCount} / ${mainState.currentResults})`
                     });
                 }
            });
            
            console.log(`📥 ${allResults.length} adet sonuç başarıyla indirildi.`);
            resolve(allResults);
          } catch (err) {
            console.error("Sonuçları indirirken hata oluştu:", err);
            reject(new Error("Sonuçlar veritabanından çekilemedi: " + err.message));
          }
        }
      }, (error) => {
        console.error('❌ Snapshot hatası:', error);
        cleanup();
        reject(error);
      });

      // İlerleme Güncelleme
      function updateGlobalProgress() {
          const workerKeys = Object.keys(workersState);
          let sumProgress = 0;
          let activeWorkerCount = 0;

          workerKeys.forEach(key => {
              const w = workersState[key];
              sumProgress += (w.progress || 0);
              activeWorkerCount++;
          });

          const globalProgress = activeWorkerCount > 0 ? Math.floor(sumProgress / activeWorkerCount) : 0;

          if (onProgress) {
              onProgress({
                  status: mainState.status,
                  progress: globalProgress,
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

// --- YENİ YARDIMCI FONKSİYON: Batch (Parçalı) İndirme ---
async function getAllResultsInBatches(jobId, onBatchLoaded) {
    const resultsRef = collection(db, 'searchProgress', jobId, 'foundResults');
    let allData = [];
    let lastVisible = null;
    const BATCH_SIZE = 2000; // Her seferinde 2000 kayıt indir (Browser'ı yormaz)
    let keepFetching = true;

    while (keepFetching) {
        try {
            let q;
            // Sıralama olmadan pagination çalışmaz, similarityScore'a göre sıralayıp çekelim
            // (Veya documentID'ye göre de olabilir ama sıralama tutarlı olmalı)
            if (lastVisible) {
                q = query(resultsRef, orderBy('__name__'), startAfter(lastVisible), limit(BATCH_SIZE));
            } else {
                q = query(resultsRef, orderBy('__name__'), limit(BATCH_SIZE));
            }

            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                keepFetching = false;
                break;
            }

            const batchData = snapshot.docs.map(doc => doc.data());
            allData = allData.concat(batchData);
            
            lastVisible = snapshot.docs[snapshot.docs.length - 1];
            
            console.log(`📦 Batch indirildi: ${batchData.length} kayıt (Toplam: ${allData.length})`);
            
            if (onBatchLoaded) {
                onBatchLoaded(allData.length);
            }

            // Eğer çekilen paket limitten azsa, veri bitmiş demektir
            if (batchData.length < BATCH_SIZE) {
                keepFetching = false;
            }

        } catch (error) {
            console.error("Batch indirme hatası:", error);
            throw error;
        }
    }

    return allData;
}