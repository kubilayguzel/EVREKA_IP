// add_missing_transaction_types.js içeriği
import { transactionTypeService } from '../firebase-config.js'; // firebase-config.js dosyanızın yolu bu dosyaya göre doğru olmalı

async function addMissingChildTransactionTypes() {
    const missingChildTypes = [
  {
    "id": "50",
    "name": "İtiraz Kabul",
    "alias": "İtiraz Kabul",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "19"
  },
  {
    "id": "51",
    "name": "İtiraz Kısmen Kabul",
    "alias": "İtiraz Kısmen Kabul",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "19"
  },
  {
    "id": "52",
    "name": "İtiraz Ret",
    "alias": "İtiraz Ret",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "19"
  },
  
  {
    "id": "31",
    "name": "Başvuru Sahibi - İtiraz Kabul",
    "alias": "Başvuru Sahibi - İtiraz Kabul",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "49"
  },
  {
    "id": "32",
    "name": "Başvuru Sahibi - İtiraz Kısmen Kabul",
    "alias": "Başvuru Sahibi - İtiraz Kısmen Kabul",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "49"
  },
  {
    "id": "33",
    "name": "Başvuru Sahibi - İtiraz Ret",
    "alias": "Başvuru Sahibi - İtiraz Ret",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "49"
  },
  {
    "id": "34",
    "name": "İtiraz Sahibi - İtiraz Kabul",
    "alias": "İtiraz Sahibi - İtiraz Kabul",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "49"
  },
  {
    "id": "35",
    "name": "İtiraz Sahibi - İtiraz Kısmen Kabul",
    "alias": "İtiraz Sahibi - İtiraz Kısmen Kabul",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "49"
  },
  {
    "id": "36",
    "name": "İtiraz Sahibi - İtiraz Ret",
    "alias": "İtiraz Sahibi - İtiraz Ret",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "49"
  },
  {
    "id": "37",
    "name": "İtiraza Ek Belge",
    "alias": "İtiraza Ek Belge",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": true,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": null
  },
  {
    "id": "38",
    "name": "İtiraza Karşı Görüş",
    "alias": "İtiraza Karşı Görüş",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": true,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": null
  },
  {
    "id": "39",
    "name": "Kullanım İspatı Delili Sunma",
    "alias": "Kullanım İspatı Delili Sunma",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": true,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": null
  },
  {
    "id": "40",
    "name": "Kabul Kararı",
    "alias": "Kabul Kararı",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": null
  },
  {
    "id": "41",
    "name": "Yayın Kararı",
    "alias": "Yayın Kararı",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": null
  },
  {
    "id": "42",
    "name": "Kısmi Yayın Kararı",
    "alias": "Kısmi Yayın Kararı",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "7"
  },
  {
    "id": "43",
    "name": "Ret Kararı",
    "alias": "Ret Kararı",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "7"
  },
  {
    "id": "44",
    "name": "Muvaffakat Sunumu",
    "alias": "Muvaffakat Sunumu",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": true,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": null
  },
  {
    "id": "45",
    "name": "Tescil Belgesi",
    "alias": "Tescil Belgesi",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": null
  },
  {
    "id": "46",
    "name": "Tescil Ücreti Bildirimi",
    "alias": "Tescil Ücreti Bildirimi",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "23"
  },
  {
    "id": "47",
    "name": "Karar Düzeltme",
    "alias": "Karar Düzeltme",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "7"
  },
  {
    "id": "48",
    "name": "Kullanım Delili Talebi",
    "alias": "Kullanım Delili Talebi",
    "ipType": "trademark",
    "hierarchy": "child",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": false,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": "39"
  },
  {
    "id": "49",
    "name": "YİDK Kararının İptali",
    "alias": "YİDK Kararının İptali",
    "ipType": "suit",
    "hierarchy": "parent",
    "applicableToMainType": [
      "trademark"
    ],
    "documentDesignationDefault": null,
    "order": null,
    "isTopLevelSelectable": true,
    "allowedChildTypes": [],
    "indexFile": [],
    "indexBulk": [],
    "indexManuel": [],
    "taskTriggered": null
  }
];

    console.log("Eksik alt işlem tipleri Firestore'a ekleniyor/güncelleniyor...");

    for (const typeData of missingChildTypes) {
        const result = await transactionTypeService.addTransactionType(typeData);
        if (result.success) {
            console.log(`✅ İşlem tipi başarıyla eklendi/güncellendi: ${typeData.id} (${typeData.alias || typeData.name})`);
        } else {
            console.error(`❌ İşlem tipi eklenirken/güncellenirken hata oluştu ${typeData.id}:`, result.error);
        }
    }
    console.log("Tüm eksik alt işlem tipleri için işlem tamamlandı.");
}

// Fonksiyonu başlat
addMissingChildTransactionTypes();

        <script type="module" src="./js/add_missing_transaction_types.js"></script>