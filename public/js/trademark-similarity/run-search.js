// js/trademark-similarity/run-search.js

import { firebaseServices } from '../../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { getFirestore, doc, onSnapshot, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log(">>> run-search.js modülü yüklendi (Worker Destekli Versiyon) <<<");

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
      // --- ÖNEMLİ EKLENTİ: Workerları Dinleme ---
      const workersRef = collection(db, 'searchProgress', jobId, 'workers'); 
      
      let safetyTimeout;
      // Durumları hafızada tutuyoruz
      let mainState = { status: 'starting', totalMarks: monitoredMarks.length };
      let workersState = {}; // { 'workerId': { progress: 50, status: 'processing', ... } }

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
          }, 15 * 60 * 1000); // 15 dakika
      };

      resetSafetyTimeout();

      // --- 1. WORKERLARI DİNLEME (Detaylı İlerleme Çubukları İçin) ---
      unsubscribeWorkers = onSnapshot(workersRef, (snapshot) => {
        resetSafetyTimeout();
        
        snapshot.forEach(doc => {
            workersState[doc.id] = doc.data();
        });

        // Worker verileri her değiştiğinde genel durumu güncelle
        updateGlobalProgress();
      });

      // --- 2. ANA DÖKÜMANI DİNLEME (Tamamlandı/Hata durumu için) ---
      unsubscribeMain = onSnapshot(progressRef, async (snapshot) => {
        if (!snapshot.exists()) {
          cleanup();
          reject(new Error('Job bulunamadı'));
          return;
        }

        mainState = snapshot.data();
        updateGlobalProgress(); // Durum değişirse tetikle

        // Hata Durumu
        if (mainState.status === 'error') {
          cleanup();
          console.error('❌ Arama hatası:', mainState.error);
          reject(new Error(mainState.error || 'Arama sırasında hata oluştu'));
        }

        // Tamamlandı Durumu
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

      // --- YARDIMCI FONKSİYON: İlerlemeyi Hesapla ve UI'a Gönder ---
      function updateGlobalProgress() {
          // Tüm workerların işlediği toplam sayıyı bul
          const workerKeys = Object.keys(workersState);
          let totalProcessed = 0;
          let activeWorkersList = [];

          workerKeys.forEach(key => {
              const w = workersState[key];
              totalProcessed += (w.processed || 0);
              
              // Frontend'e worker listesi gönder (UI'da ayrı barlar çizmek için)
              activeWorkersList.push({
                  id: key,
                  status: w.status,
                  progress: w.progress,
                  processed: w.processed,
                  total: w.total || 0,
                  error: w.error
              });
          });

          // Ana toplam sayı
          const totalMarks = mainState.totalMarks || monitoredMarks.length;
          
          // Ana yüzde hesabı (Bültenin toplam satır sayısı başta bilinmediği için tahmini hesaplanır veya işlenen satır sayısı gösterilir)
          // Burada işlenen satır sayısını baz alarak sembolik bir progress gösterebiliriz veya sadece sayacı güncelleriz.
          const globalProgress = totalMarks > 0 ? Math.min(100, Math.floor((totalProcessed / 5000) * 100)) : 0; // 5000 tahmini satır sayısı

          if (onProgress) {
              onProgress({
                  status: mainState.status,
                  progress: globalProgress,
                  processed: totalProcessed, // <--- İşte ekranda "0" yerine sayının artmasını sağlayacak değer
                  total: totalMarks,
                  currentResults: mainState.currentResults || 0,
                  workers: activeWorkersList,
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