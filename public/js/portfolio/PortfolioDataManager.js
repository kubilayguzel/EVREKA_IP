// public/js/portfolio/PortfolioDataManager.js
import { ipRecordsService, transactionTypeService, personService, db } from '../../firebase-config.js';
import { doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class PortfolioDataManager {
    constructor() {
        this.allRecords = [];
        this.objectionRows = [];
        this.litigationRows = [];
        this.transactionTypesMap = new Map();
        this.allPersons = [];
        this.allCountries = [];
        this.taskCache = new Map(); // Task belgeleri için cache
    }

    async loadInitialData() {
        // Paralel olarak lookupları yükle
        await Promise.all([
            this.loadTransactionTypes(),
            this.loadPersons(),
            this.loadCountries()
        ]);
        // Ana kayıtları çek
        return await this.loadRecords();
    }

    async loadTransactionTypes() {
        const result = await transactionTypeService.getTransactionTypes();
        if (result.success) {
            result.data.forEach(type => {
                this.transactionTypesMap.set(String(type.id), type);
                if (type.code) this.transactionTypesMap.set(String(type.code), type);
            });
        }
    }

    async loadPersons() {
        const result = await personService.getPersons();
        if (result.success) this.allPersons = result.data;
    }

    async loadCountries() {
        try {
            const docRef = doc(db, 'common', 'countries');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                this.allCountries = docSnap.data().list || [];
            }
        } catch (e) { console.error("Ülke listesi hatası:", e); }
    }

    async loadRecords() {
        const result = await ipRecordsService.getRecords();
        if (result.success) {
            this.allRecords = Array.isArray(result.data) ? result.data : [];
        }
        return this.allRecords;
    }

    async loadLitigationData() {
        const suitsRef = collection(db, 'suits');
        const snapshot = await getDocs(suitsRef);
        this.litigationRows = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        return this.litigationRows;
    }

    // --- Önemli: İtiraz Task Dokümanlarını Getiren Helper ---
    async fetchTaskDocuments(taskId) {
        if (!taskId) return [];
        if (this.taskCache.has(taskId)) return this.taskCache.get(taskId);

        try {
            const taskDoc = await getDoc(doc(db, 'tasks', taskId));
            if (!taskDoc.exists()) return [];
            
            const taskData = taskDoc.data();
            const docs = [];

            // ePats Belgesi
            if (taskData.details?.epatsDocument?.downloadURL) {
                docs.push({
                    fileName: taskData.details.epatsDocument.name || 'ePats Belgesi',
                    fileUrl: taskData.details.epatsDocument.downloadURL,
                    evrakNo: taskData.details.epatsDocument.turkpatentEvrakNo,
                    type: 'epats_document'
                });
            }

            // Task Documents
            if (Array.isArray(taskData.documents)) {
                taskData.documents.forEach(d => {
                    const url = d.downloadURL || d.url || d.path;
                    if (url) docs.push({ fileName: d.name || 'Belge', fileUrl: url, type: d.type || 'task_document' });
                });
            }
            
            this.taskCache.set(taskId, docs);
            return docs;
        } catch (e) {
            console.error('Task docs error:', e);
            return [];
        }
    }

    // --- Filtreleme Mantığı ---
    filterRecords(typeFilter, searchTerm, columnFilters = {}) {
        let sourceData = [];

        // Hangi veri kümesi üzerinde çalışacağız?
        if (typeFilter === 'litigation') {
            sourceData = this.litigationRows;
        } else if (typeFilter === 'objections') {
            // Objectionları UI tarafında on-demand yükleyip DataManager'a set etmemiz gerekebilir
            // ya da burada transactionları parse edip row oluşturabiliriz.
            // *Performans için objection satırlarını önceden oluşturup saklamak iyidir.*
            sourceData = this.objectionRows; 
        } else {
            // Standart kayıtlar
            sourceData = this.allRecords.filter(r => {
                if (typeFilter === 'all') return r.recordOwnerType !== 'third_party';
                if (typeFilter === 'trademark') return r.type === 'trademark' && r.recordOwnerType !== 'third_party';
                return r.type === typeFilter;
            });
        }

        // Global Arama ve Kolon Filtreleri
        return sourceData.filter(item => {
            // 1. Global Search
            if (searchTerm) {
                const searchStr = JSON.stringify(Object.values(item)).toLowerCase();
                if (!searchStr.includes(searchTerm.toLowerCase())) return false;
            }
            // 2. Column Filters
            for (const [key, val] of Object.entries(columnFilters)) {
                if (!val) continue;
                const itemVal = String(item[key] || '').toLowerCase();
                if (!itemVal.includes(val.toLowerCase())) return false;
            }
            return true;
        });
    }

    sortRecords(data, column, direction) {
        return [...data].sort((a, b) => {
            let valA = a[column] || '';
            let valB = b[column] || '';

            // Tarih kontrolü
            if (column.toLowerCase().includes('date') || column.includes('tarih')) {
                valA = new Date(valA || 0).getTime();
                valB = new Date(valB || 0).getTime();
            } else {
                valA = String(valA).toLowerCase();
                valB = String(valB).toLowerCase();
            }

            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    getCountryName(code) {
        return this.allCountries.find(c => c.code === code)?.name || code || '-';
    }
}