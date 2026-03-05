// export_firestore_sample.js
const admin = require('firebase-admin');
const fs = require('fs');

// 🔴 DİKKAT: Kendi Firebase Service Account JSON dosyanızın yolunu buraya yazın
const serviceAccount = require('./serviceAccountKey.json'); // Örnek isim

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Dışa aktarılacak verinin tutulacağı ana obje
const exportData = {};

async function fetchCollectionData(collectionRef, maxDocs = 50) {
  const collectionData = {
    collectionId: collectionRef.id,
    documents: []
  };

  try {
    const snapshot = await collectionRef.limit(maxDocs).get();
    
    for (const doc of snapshot.docs) {
      const docData = {
        id: doc.id,
        data: doc.data(),
        subcollections: {}
      };

      // Bu belgenin alt koleksiyonları (subcollections) var mı diye kontrol et
      const subcollections = await doc.ref.listCollections();
      
      for (const subColl of subcollections) {
        // Alt koleksiyonları da aynı mantıkla (recursive) tara
        docData.subcollections[subColl.id] = await fetchCollectionData(subColl, maxDocs);
      }

      collectionData.documents.push(docData);
    }
  } catch (error) {
    console.error(`Koleksiyon okunurken hata oluştu (${collectionRef.id}):`, error);
  }

  return collectionData;
}

async function main() {
  console.log("🚀 Firestore analiz ve dışa aktarma işlemi başlıyor...");
  
  try {
    // Kök (Top-level) koleksiyonları al
    const topLevelCollections = await db.listCollections();
    
    for (const collection of topLevelCollections) {
      console.log(`📂 Taranıyor: /${collection.id}`);
      exportData[collection.id] = await fetchCollectionData(collection, 50);
    }

    // Sonucu JSON dosyası olarak kaydet
    const outputPath = './firestore_schema_and_sample.json';
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
    
    console.log(`\n✅ İşlem tamamlandı! Veriler '${outputPath}' dosyasına kaydedildi.`);
    console.log("Lütfen bu dosyanın içeriğini kopyalayarak (veya dosya olarak) benimle paylaşın.");
    
  } catch (error) {
    console.error("💥 Genel Hata:", error);
  }
}

main();