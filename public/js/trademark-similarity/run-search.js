import { firebaseServices } from '../../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { getFirestore, doc, onSnapshot, collection, getDocs, query, limit, startAfter, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log(">>> run-search.js modülü yüklendi (Akıllı Worker Takip Versiyonu) <<<");

const functions = getFunctions(firebaseServices.app, "europe-west1");
const db = getFirestore(firebaseServices.app);
const performSearchCallable = httpsCallable(functions, 'performTrademarkSimilaritySearch');

export async function runTrademarkSearch(monitoredMarks, selectedBulletinId, onProgress) {
  try {
    console.log('🚀 Cloud Function çağrılıyor (ASYNC mode):', {
      monitoredMarksCount: monitoredMarks.length,
      selectedBulletinId
    });

    // 1. İşlemi Başlat
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

    // 2. Takip Etme Mantığı
    return new Promise((resolve, reject) => {
      const progressRef = doc(db, 'searchProgress', jobId);
      const workersRef = collection(db, 'searchProgress', jobId, 'workers'); 
      
      let safetyTimeout;
      let mainState = { status: 'starting', totalMarks: monitoredMarks.length };
      let workersState = {}; 
      
      // Toplam kaç worker olmalı? (Her worker 200 marka işler)
      const CHUNK_SIZE = 200;
      const expectedWorkerCount = Math.ceil(monitoredMarks.length / CHUNK_SIZE);
      let isJobFinished = false;

      let unsubscribeMain = null;
      let unsubscribeWorkers = null;

      const cleanup = () => {
        if (safetyTimeout) clearTimeout(safetyTimeout);
        if (unsubscribeMain) unsubscribeMain();
        if (unsubscribeWorkers) unsubscribeWorkers();
      };

      const resetSafetyTimeout = () => {
          if (safetyTimeout) clearTimeout(safetyTimeout);
          // 30 Dakika süre (Veri çok büyükse beklesin)
          safetyTimeout = setTimeout(() => {
              if (!isJobFinished) {
                  cleanup();
                  reject(new Error('İşlem zaman aşımına uğradı (Uzun süre yanıt alınamadı)'));
              }
          }, 30 * 60 * 1000); 
      };

      resetSafetyTimeout();

      // --- EKSİK PARÇA: İŞİN BİTTİĞİNİ KONTROL ET ---
      const checkCompletion = async () => {
          if (isJobFinished) return;

          const workerKeys = Object.keys(workersState);
          const activeWorkers = workerKeys.length;
          
          // 1. Tüm workerlar oluştu mu?
          if (activeWorkers < expectedWorkerCount) return;

          // 2. Hepsi "completed" durumunda mı?
          const allCompleted = workerKeys.every(key => workersState[key].status === 'completed');

          if (allCompleted) {
              isJobFinished = true; // Tekrar çalışmasını engelle
              console.log(`✅ Tüm workerlar (${activeWorkers}/${expectedWorkerCount}) tamamlandı. İndirme başlıyor...`);
              
              // Hafif bir bekleme (Backend'in son yazma işlemleri için)
              await new Promise(r => setTimeout(r, 2000));
              
              cleanup(); // Dinlemeyi durdur

              try {
                // Batch Download Fonksiyonunu Çağır
                const totalFoundResults = Object.values(workersState).reduce((sum, w) => sum + (w.found || 0), 0);

                const allResults = await getAllResultsInBatches(jobId, (downloadedCount) => {
                     if (onProgress) {
                         onProgress({
                            status: 'downloading',
                            progress: 100,
                            currentResults: totalFoundResults,
                            message: `Sonuçlar indiriliyor... (${downloadedCount} / ${totalFoundResults})`
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
      };

      // 1. WORKERLARI DİNLEME
      unsubscribeWorkers = onSnapshot(workersRef, (snapshot) => {
        resetSafetyTimeout();
        snapshot.forEach(doc => {
            workersState[doc.id] = doc.data();
        });
        updateGlobalProgress();
        checkCompletion(); // Her worker güncellemesinde bitip bitmediğini kontrol et
      });

      // 2. ANA DÖKÜMANI DİNLEME (Sadece Hata Takibi İçin)
      unsubscribeMain = onSnapshot(progressRef, (snapshot) => {
        if (!snapshot.exists()) return;
        mainState = snapshot.data();
        
        if (mainState.status === 'error') {
          cleanup();
          reject(new Error(mainState.error || 'Arama sırasında hata oluştu'));
        }
      }, (error) => {
        console.error('Snapshot hatası:', error);
      });

      // İlerleme Güncelleme
      function updateGlobalProgress() {
          const workerKeys = Object.keys(workersState);
          let sumProgress = 0;
          let totalFound = 0;
          let activeWorkerCount = 0;

          workerKeys.forEach(key => {
              const w = workersState[key];
              sumProgress += (w.progress || 0);
              totalFound += (w.found || 0);
              activeWorkerCount++;
          });

          // Tüm workerların ortalaması
          const globalProgress = activeWorkerCount > 0 ? Math.floor(sumProgress / activeWorkerCount) : 0;

          if (onProgress && !isJobFinished) {
              onProgress({
                  status: mainState.status,
                  progress: globalProgress,
                  currentResults: totalFound,
                  message: null
              });
          }
      }
    });

  } catch (error) {
    console.error('Cloud Function çağrılırken hata:', error);
    throw error;
  }
}

// --- YARDIMCI FONKSİYON: Batch (Parçalı) İndirme ---
async function getAllResultsInBatches(jobId, onBatchLoaded) {
    const resultsRef = collection(db, 'searchProgress', jobId, 'foundResults');
    let allData = [];
    let lastVisible = null;
    const BATCH_SIZE = 2000; 
    let keepFetching = true;

    while (keepFetching) {
        try {
            let q;
            // Sıralama similarityScore'a göre yapılırsa daha mantıklı olur
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
            
            if (onBatchLoaded) {
                onBatchLoaded(allData.length);
            }

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