import { ipRecordsService, personService, taskService, transactionTypeService, db, storage } from '../../firebase-config.js';
// DÜZELTME: 'limit' fonksiyonu import listesine eklendi
import { doc, getDoc, collection, getDocs, query, where, limit, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

export class TaskDataManager {
    constructor() {
        this.bulletinDataCache = {};
    }

    // --- BAŞLANGIÇ VERİLERİNİ ÇEKME ---
    async loadInitialData() {
        try {
            const [ipRecords, persons, users, transactionTypes, countries] = await Promise.all([
                this.fetchAllIpRecords(),
                personService.getPersons(),
                taskService.getAllUsers(),
                transactionTypeService.getTransactionTypes(),
                this.getCountries()
            ]);

            return {
                allIpRecords: this._normalizeData(ipRecords),
                allPersons: this._normalizeData(persons),
                allUsers: this._normalizeData(users),
                allTransactionTypes: this._normalizeData(transactionTypes),
                allCountries: this._normalizeData(countries)
            };
        } catch (error) {
            console.error("Veri yükleme hatası:", error);
            throw error;
        }
    }

    async fetchAllIpRecords() {
        try {
            return await ipRecordsService.getRecords();
        } catch (e) {
            console.error("IP Records fetch error:", e);
            return [];
        }
    }

    async getCountries() {
        try {
            const docRef = doc(db, 'common', 'countries');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                return data.list || [];
            }
            return [];
        } catch (error) {
            console.error("Ülke listesi hatası:", error);
            return [];
        }
    }

    async getCities() {
        try {
            const docRef = doc(db, 'common', 'cities');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                // Firestore'da { list: [{name:'Adana'}, {name:'Ankara'}...] } formatında olduğunu varsayıyoruz
                return data.list || []; 
            }
            return [];
        } catch (error) {
            console.error("Şehir listesi hatası:", error);
            return [];
        }
    }

    // --- ARAMA İŞLEMLERİ ---
    
    async searchBulletinRecords(term) {
        if (!term || term.length < 2) return [];
        
        const bulletinRef = collection(db, 'trademarkBulletinRecords');
        const searchLower = term.toLowerCase();
        const searchUpper = term.toUpperCase();

        // Buradaki 'limit' kullanımı için yukarıya import ekledik
        const queries = [
            query(bulletinRef, where('markName', '>=', searchLower), where('markName', '<=', searchLower + '\uf8ff'), limit(50)),
            query(bulletinRef, where('markName', '>=', searchUpper), where('markName', '<=', searchUpper + '\uf8ff'), limit(50)),
            query(bulletinRef, where('applicationNo', '>=', searchLower), where('applicationNo', '<=', searchLower + '\uf8ff'), limit(50)),
            query(bulletinRef, where('applicationNo', '>=', searchUpper), where('applicationNo', '<=', searchUpper + '\uf8ff'), limit(50))
        ];

        try {
            const snapshots = await Promise.all(queries.map(q => getDocs(q)));
            const resultsMap = new Map();
            snapshots.forEach(snap => {
                snap.forEach(d => resultsMap.set(d.id, { id: d.id, ...d.data() }));
            });
            return Array.from(resultsMap.values());
        } catch (err) {
            console.error('Bulletin arama hatası:', err);
            return [];
        }
    }

    /**
     * Dava dosyalarını arar (GÜNCELLENMİŞ VERSİYON 2)
     */
    async searchSuits(searchText, allowedTypeIds = []) {
        if (!searchText || searchText.length < 2) return [];

        try {
            const suitsRef = collection(db, 'suits');
            let q = query(suitsRef);

            // Filtreleme
            if (allowedTypeIds && allowedTypeIds.length > 0 && allowedTypeIds.length <= 10) {
                q = query(q, where('transactionTypeId', 'in', allowedTypeIds));
            }

            const snapshot = await getDocs(q);
            const results = [];
            const lowerSearch = searchText.toLocaleLowerCase('tr-TR');

            snapshot.forEach(doc => {
                const data = doc.data();
                const details = data.suitDetails || {};
                
                // Aranacak metinler
                const fileNo = (details.caseNo || data.caseNo || data.fileNumber || '').toLocaleLowerCase('tr-TR');
                const court = (details.court || data.court || '').toLocaleLowerCase('tr-TR');
                
                // Müvekkil İsmini Güvenli Alma
                // data.client bir obje olabilir ({name: "..."}) veya direkt string olabilir.
                const clientNameRaw = data.client?.name || data.client || ''; 
                const clientName = String(clientNameRaw).toLocaleLowerCase('tr-TR');
                
                const opposingParty = (details.opposingParty || data.opposingParty || '').toLocaleLowerCase('tr-TR');

                // Arama Mantığı
                if (fileNo.includes(lowerSearch) || 
                    court.includes(lowerSearch) || 
                    clientName.includes(lowerSearch) || 
                    opposingParty.includes(lowerSearch)) {
                    
                    results.push({
                        id: doc.id,
                        ...data,
                        // UI için standart alanlar
                        displayFileNumber: details.caseNo || data.caseNo || data.fileNumber || '-', 
                        displayCourt: details.court || data.court || 'Mahkeme Yok',
                        displayClient: clientNameRaw, // <--- YENİ: Müvekkil ismini UI'a taşıyoruz
                        opposingParty: details.opposingParty || data.opposingParty || '-',
                        _source: 'suit' 
                    });
                }
            });

            return results;
        } catch (error) {
            console.error('Dava arama hatası:', error);
            return [];
        }
    }

    async fetchAndStoreBulletinData(bulletinId) {
        if (!bulletinId) return null;
        if (this.bulletinDataCache[bulletinId]) return this.bulletinDataCache[bulletinId];

        try {
            const docRef = doc(db, 'trademarkBulletins', bulletinId);
            const snap = await getDoc(docRef);
            if (!snap.exists()) return null;

            const data = snap.data();
            const cacheObj = {
                id: bulletinId,
                bulletinNo: data.bulletinNo,
                bulletinDate: data.bulletinDate,
                type: data.type
            };
            this.bulletinDataCache[bulletinId] = cacheObj;
            return cacheObj;
        } catch (e) {
            console.error('Bulletin fetch error:', e);
            return null;
        }
    }

    async getAssignmentRule(taskTypeId) {
        if (!taskTypeId) return null;
        try {
            const snap = await getDoc(doc(db, 'taskAssignments', taskTypeId));
            return snap.exists() ? snap.data() : null;
        } catch (e) {
            console.error('Assignment rule error:', e);
            return null;
        }
    }

    // --- DOSYA VE RESİM İŞLEMLERİ ---
    async uploadFileToStorage(file, path) {
        if (!file || !path) return null;
        try {
            const storageRef = ref(storage, path);
            const result = await uploadBytes(storageRef, file);
            return await getDownloadURL(result.ref);
        } catch (error) {
            console.error("Dosya yükleme hatası:", error);
            return null;
        }
    }

    async resolveImageUrl(path) {
        if (!path) return '';
        if (typeof path === 'string' && path.startsWith('http')) return path;
        try {
            return await getDownloadURL(ref(storage, path));
        } catch {
            return '';
        }
    }

    _normalizeData(result) {
        if (!result) return [];
        return Array.isArray(result.data) ? result.data :
               Array.isArray(result.items) ? result.items :
               (Array.isArray(result) ? result : []);
    }

// --- TRANSAKSİYONLARI ÇEKME (GÜNCELLENDİ) ---
    /**
     * @param {string} recordId - Kayıt ID'si
     * @param {string} collectionName - 'ipRecords' veya 'suits' (Varsayılan: ipRecords)
     */
    async getRecordTransactions(recordId, collectionName = 'ipRecords') {
        if (!recordId) return { success: false, message: 'Kayıt ID yok.' };

        console.log(`[TaskDataManager] ${collectionName}/${recordId} için transactions çekiliyor...`);

        try {
            // Dinamik koleksiyon adı
            const transactionsRef = collection(db, collectionName, recordId, 'transactions');
            
            const snapshot = await getDocs(transactionsRef);
            
            let data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Yeniden eskiye sırala
            data.sort((a, b) => {
                const dateA = a.creationDate ? new Date(a.creationDate).getTime() : 0;
                const dateB = b.creationDate ? new Date(b.creationDate).getTime() : 0;
                return dateB - dateA; 
            });

            // Veri Tipi Garantisi
            data = data.map(t => ({
                ...t,
                type: String(t.type || t.transactionType || '') 
            }));

            console.log(`[TaskDataManager] ${data.length} adet işlem bulundu.`);
            return { success: true, data: data };

        } catch (error) {
            console.error("[TaskDataManager] Transaksiyonlar çekilemedi:", error);
            return { success: false, error: error };
        }
    }
}