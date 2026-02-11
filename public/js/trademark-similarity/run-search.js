import { firebaseServices } from '../../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { getFirestore, doc, onSnapshot, collection, getDocs, query, limit, startAfter, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log(">>> run-search.js modülü yüklendi (Writer-Aware Versiyon) <<<");

const functions = getFunctions(firebaseServices.app, "europe-west1");
const db = getFirestore(firebaseServices.app);
const performSearchCallable = httpsCallable(functions, 'performTrademarkSimilaritySearch');

export async function runTrademarkSearch(monitoredMarks, selectedBulletinId, onProgress) {
  try {
    console.log('🚀 Cloud Function çağrılıyor (ASYNC mode)...');

    // 1. İşlemi Başlat
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

    // 2. Takip Etme Mantığı
    return new Promise((resolve, reject) => {
      const progressRef = doc(db, 'searchProgress', jobId);
      const workersRef = collection(db, 'searchProgress', jobId, 'workers'); 
      
      let safetyTimeout;
      // Ana dökümandan gelen verileri tutacağımız yer
      let mainState = { 
          status: 'queued', 
          currentResults: 0, // YAZICI WORKER'IN GÜNCELLEDİĞİ GERÇEK SAYI
          total: monitoredMarks.length 
      };
      
      let workersState = {}; 
      const WORKER_COUNT = 10; // Sabit worker sayısı
      let isJobFinished = false;

      let unsubscribeMain = null;
      let unsubscribeWorkers = null;

      const cleanup = () => {
        if (safetyTimeout) clearTimeout(safetyTimeout);
        if (unsubscribeMain) unsubscribeMain();
        if (unsubscribeWorkers) unsubscribeWorkers();
      };

      // Güvenlik zaman aşımı (30 dakika hiç hareket olmazsa)
      const resetSafetyTimeout = () => {
          if (safetyTimeout) clearTimeout(safetyTimeout);
          safetyTimeout = setTimeout(() => {
              if (!isJobFinished) {
                  cleanup();
                  reject(new Error('İşlem zaman aşımına uğradı (Uzun süre işlem yapılmadı)'));
              }
          }, 30 * 60 * 1000); 
      };

      resetSafetyTimeout();

      // --- BİTİŞ KONTROLÜ ---
      const checkCompletion = async () => {
          if (isJobFinished) return;

          const workerKeys = Object.keys(workersState);
          
          // 1. Tüm workerlar raporda görünüyor mu?
          if (workerKeys.length < WORKER_COUNT) return;

          // 2. Hepsi "completed" durumunda mı?
          const allCompleted = workerKeys.every(key => workersState[key].status === 'completed');

          if (allCompleted) {
              isJobFinished = true;
              console.log(`✅ Tüm workerlar tamamlandı. İndirme başlıyor...`);
              
              // Yazma işlemlerinin (Writer Worker) son paketleri bitirmesi için biraz bekle
              if (onProgress) onProgress({ status: 'finalizing', message: 'Son veriler yazılıyor...' });
              await new Promise(r => setTimeout(r, 5000));
              
              cleanup(); 

              try {
                // Sonuçları İndir
                const finalCount = mainState.currentResults || 0;
                
                // Kullanıcıya bilgi ver
                if (onProgress) {
                    onProgress({
                       status: 'downloading',
                       progress: 100,
                       currentResults: finalCount,
                       message: `Sonuçlar indiriliyor... (Toplam: ${finalCount})`
                    });
                }

                const allResults = await getAllResultsInBatches(jobId, (downloadedCount) => {
                     // İndirme sırasında ilerleme çubuğu
                     if (onProgress) {
                         const dlPercent = Math.min(100, Math.floor((downloadedCount / (finalCount || 1)) * 100));
                         onProgress({
                            status: 'downloading',
                            progress: 100, // Arama bitti, indirme progress'i
                            currentResults: finalCount,
                            message: `Veriler alınıyor... ${downloadedCount} / ${finalCount}`
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

      // 1. ANA DÖKÜMANI DİNLEME (SAYAÇ İÇİN)
      // Burası Writer Worker'ın yazdığı "KESİN" sayıyı takip eder.
      unsubscribeMain = onSnapshot(progressRef, (snapshot) => {
        if (!snapshot.exists()) return;
        
        const data = snapshot.data();
        // Sadece gerekli alanları güncelle
        mainState.status = data.status || mainState.status;
        mainState.currentResults = data.currentResults || 0; 
        
        if (mainState.status === 'error') {
          cleanup();
          reject(new Error(data.error || 'Arama sırasında hata oluştu'));
        }
        
        updateGlobalProgress(); // Arayüzü güncelle
      });

      // 2. WORKERLARI DİNLEME (YÜZDE İLERLEME VE BİTİŞ İÇİN)
      unsubscribeWorkers = onSnapshot(workersRef, (snapshot) => {
        resetSafetyTimeout();
        snapshot.forEach(doc => {
            workersState[doc.id] = doc.data();
        });
        updateGlobalProgress();
        checkCompletion(); 
      });

      // Arayüz Güncelleme Fonksiyonu
      function updateGlobalProgress() {
          if (isJobFinished) return;

          const workerKeys = Object.keys(workersState);
          let sumProgress = 0;
          let activeWorkerCount = 0;

          // Sadece workerların YÜZDESİNİ alıyoruz (Sayacı mainState'den alacağız)
          workerKeys.forEach(key => {
              const w = workersState[key];
              sumProgress += (w.progress || 0);
              activeWorkerCount++;
          });

          // Ortalama İlerleme (0-100%)
          // Henüz başlamayan workerları da hesaba katmak için toplam beklenen worker sayısına bölüyoruz
          const globalProgress = Math.floor(sumProgress / WORKER_COUNT);

          if (onProgress) {
              onProgress({
                  status: mainState.status === 'queued' ? 'processing' : mainState.status,
                  progress: globalProgress,
                  currentResults: mainState.currentResults, // <-- ARTIK DOĞRU SAYI BURADAN GELİYOR
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
// Büyük veriyi (70.000+) tarayıcıyı dondurmadan indirmek için
async function getAllResultsInBatches(jobId, onBatchLoaded) {
    const resultsRef = collection(db, 'searchProgress', jobId, 'foundResults');
    let allData = [];
    let lastVisible = null;
    const BATCH_SIZE = 2000; 
    let keepFetching = true;

    while (keepFetching) {
        try {
            let q;
            // Firestore'da 'orderBy' olmadan 'startAfter' kullanmak için document ID (__name__) kullanıyoruz
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

            // Eğer gelen veri limiti doldurmadıysa, daha fazla veri yok demektir
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