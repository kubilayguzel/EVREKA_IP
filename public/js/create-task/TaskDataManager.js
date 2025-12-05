import { ipRecordsService, personService, taskService, transactionTypeService, db, storage } from '../../firebase-config.js';
import { doc, getDoc, collection, getDocs, query, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

export class TaskDataManager {
    constructor() {
        this.bulletinDataCache = {};
    }

    // --- BAŞLANGIÇ VERİLERİNİ ÇEKME ---
    async loadInitialData() {
        // Promise.all ile tüm gerekli verileri paralel ve hızlıca çekiyoruz
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

    // --- ARAMA İŞLEMLERİ ---
    
    // Bülten Araması (Firestore üzerinde gelişmiş sorgu)
    async searchBulletinRecords(term) {
        if (!term || term.length < 2) return [];
        
        const bulletinRef = collection(db, 'trademarkBulletinRecords');
        const searchLower = term.toLowerCase();
        const searchUpper = term.toUpperCase();

        // Firestore kısıtlamaları nedeniyle paralel sorgular atıyoruz (Büyük/Küçük harf duyarlılığı için)
        const queries = [
            query(bulletinRef, where('markName', '>=', searchLower), where('markName', '<=', searchLower + '\uf8ff'), limit(50)),
            query(bulletinRef, where('markName', '>=', searchUpper), where('markName', '<=', searchUpper + '\uf8ff'), limit(50)),
            query(bulletinRef, where('applicationNo', '>=', searchLower), where('applicationNo', '<=', searchLower + '\uf8ff'), limit(50)),
            query(bulletinRef, where('applicationNo', '>=', searchUpper), where('applicationNo', '<=', searchUpper + '\uf8ff'), limit(50))
        ];

        try {
            const snapshots = await Promise.all(queries.map(q => getDocs(q)));
            const resultsMap = new Map();
            
            // Sonuçları birleştir (ID bazlı unique yaparak tekrarları önle)
            snapshots.forEach(snap => {
                snap.forEach(d => resultsMap.set(d.id, { id: d.id, ...d.data() }));
            });

            return Array.from(resultsMap.values());
        } catch (err) {
            console.error('Bulletin arama hatası:', err);
            return [];
        }
    }

    // Bülten Detayını Çekme ve Cache'leme (Performans için)
    async fetchAndStoreBulletinData(bulletinId) {
        if (!bulletinId) return null;
        // Eğer hafızada varsa direkt oradan dön (Network tasarrufu)
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
            // Cache'e kaydet
            this.bulletinDataCache[bulletinId] = cacheObj;
            return cacheObj;
        } catch (e) {
            console.error('Bulletin fetch error:', e);
            return null;
        }
    }

    // Görev Atama Kuralını Çekme
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

    // Helper: Farklı servislerden dönen veri yapılarını (array/data/items) standart diziye çevirir
    _normalizeData(result) {
        if (!result) return [];
        return Array.isArray(result.data) ? result.data :
               Array.isArray(result.items) ? result.items :
               (Array.isArray(result) ? result : []);
    }
}