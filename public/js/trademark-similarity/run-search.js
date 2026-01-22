// js/trademark-similarity/run-search.js

import { firebaseServices } from '../../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { getFirestore, doc, onSnapshot,collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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

    // İlk başlatma: startIndex 0
    const response = await performSearchCallable({
      monitoredMarks,
      selectedBulletinId,
      startIndex: 0, // Başlangıç noktası
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
      
      // Güvenlik timeout'unu yönetmek için değişken
      let safetyTimeout;
      const resetSafetyTimeout = () => {
          if (safetyTimeout) clearTimeout(safetyTimeout);
          safetyTimeout = setTimeout(() => {
              unsubscribe();
              reject(new Error('İşlem zaman aşımına uğradı (Uzun süre işlem yapılmadı)'));
          }, 15 * 60 * 1000); // 15 dakika hareketsizlik süresi
      };

      resetSafetyTimeout(); // İlk başlatma

      const unsubscribe = onSnapshot(progressRef, async (snapshot) => {
        // Her veri geldiğinde timeout süresini uzat (işlem canlı demek)
        resetSafetyTimeout();

        if (!snapshot.exists()) {
          unsubscribe();
          reject(new Error('Job bulunamadı'));
          return;
        }

        const progressData = snapshot.data();
        
        // Logu biraz temizledik, sadece değişimde basabiliriz ama şimdilik kalsın
        console.log(`📊 Durum: ${progressData.status} | Progress: ${progressData.progress}% (${progressData.processed || 0}/${progressData.totalMarks || monitoredMarks.length})`);

        // Progress callback
        if (onProgress) {
          onProgress({
            progress: progressData.progress,
            processed: progressData.processed,
            total: progressData.totalMarks || monitoredMarks.length,
            currentResults: progressData.currentResults || 0,
            status: progressData.status,
            message: progressData.status === 'paused' ? 'Zaman aşımı önleniyor, işlem devam ettiriliyor...' : null
          });
        }

        // --- YENİ: PAUSED DURUMU (OTO-DEVAM) ---
        if (progressData.status === 'paused') {
            console.warn(`⚠️ Backend mola verdi (Timeout Koruması). Kaldığı yerden (${progressData.nextIndex}. kayıt) tekrar tetikleniyor...`);
            
            // Backend'i tekrar çağır (Resume)
            try {
                await performSearchCallable({
                    jobId: jobId, // AYNI JOB ID İLE DEVAM ET
                    monitoredMarks, // Veriyi tekrar gönderiyoruz (Backend state tutmuyorsa)
                    selectedBulletinId,
                    startIndex: progressData.nextIndex, // Kaldığı yer
                    async: true
                });
                console.log("🔄 Tetikleme başarılı, işlem devam ediyor...");
            } catch (retryError) {
                console.error("❌ Tekrar tetikleme başarısız:", retryError);
                // Burada reject etmiyoruz, belki bir sonraki snapshot'ta düzelir veya manuel müdahale gerekir.
            }
            return; // Loop'tan çıkma, dinlemeye devam et
        }
      
        // Tamamlandı Durumu
        if (progressData.status === 'completed') {
          if (safetyTimeout) clearTimeout(safetyTimeout);
          unsubscribe(); // Dinlemeyi bırak
          
          console.log(`✅ İşlem tamamlandı. Veritabanından ${progressData.currentResults || 0} sonuç indiriliyor...`);

          // 1MB Limiti Çözümü: Veriyi ana dökümandan değil, 'foundResults' alt koleksiyonundan çekiyoruz.
          const resultsRef = collection(db, 'searchProgress', jobId, 'foundResults');
          
          getDocs(resultsRef)
            .then((snapshot) => {
                const allResults = snapshot.docs.map(doc => doc.data());
                console.log(`📥 ${allResults.length} adet sonuç başarıyla indirildi.`);
                resolve(allResults); // Frontend'e veriyi teslim et
            })
            .catch((err) => {
                console.error("Sonuçları indirirken hata oluştu:", err);
                reject(new Error("Sonuçlar veritabanından çekilemedi."));
            });
        }

        // Hata Durumu
        if (progressData.status === 'error') {
          if (safetyTimeout) clearTimeout(safetyTimeout);
          unsubscribe();
          console.error('❌ Arama hatası:', progressData.error);
          reject(new Error(progressData.error || 'Arama sırasında hata oluştu'));
        }
      }, (error) => {
        console.error('❌ Snapshot hatası:', error);
        if (safetyTimeout) clearTimeout(safetyTimeout);
        reject(error);
      });

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