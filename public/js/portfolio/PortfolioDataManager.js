// public/js/portfolio/PortfolioDataManager.js
import { ipRecordsService, transactionTypeService, personService, db } from '../../firebase-config.js';
import { doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Basit concurrency helper
async function pLimit(items, concurrency, fn) {
    const results = [];
    const queue = [...items];
    const workers = Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
        while (queue.length) {
            const item = queue.shift();
            try {
                const res = await fn(item);
                if (res) results.push(res);
            } catch (e) { console.error(e); }
        }
    });
    await Promise.all(workers);
    return results.flat();
}

export class PortfolioDataManager {
    constructor() {
        this.allRecords = [];
        this.objectionRows = []; // İşlenmiş itiraz satırları (Parent + Child düz liste)
        this.litigationRows = [];
        this.transactionTypesMap = new Map();
        this.allPersons = [];
        this.allCountries = [];
        this.taskCache = new Map();
        this.txCache = new Map(); // Transaction cache
    }

    async loadInitialData() {
        await Promise.all([
            this.loadTransactionTypes(),
            this.loadPersons(),
            this.loadCountries()
        ]);
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
            if (docSnap.exists()) this.allCountries = docSnap.data().list || [];
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
        try {
            const suitsRef = collection(db, 'suits');
            const snapshot = await getDocs(suitsRef);
            this.litigationRows = snapshot.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    ...data,
                    // Sıralama ve filtreleme kolaylığı için düzleştiriyoruz
                    suitType: data.transactionType?.alias || data.transactionType?.name || data.transactionType || '-',
                    caseNo: data.suitDetails?.caseNo || '-',
                    court: data.suitDetails?.court || '-',
                    client: data.client?.name || '-',
                    opposingParty: data.suitDetails?.opposingParty || '-',
                    openedDate: data.suitDetails?.openingDate ? this._fmtDate(data.suitDetails.openingDate) : '-'
                };
            });
            // Tarihe göre sırala (Yeniden eskiye)
            this.litigationRows.sort((a, b) => this._parseDate(b.openedDate) - this._parseDate(a.openedDate));
            return this.litigationRows;
        } catch (e) {
            console.error("Davalar yüklenirken hata:", e);
            return [];
        }
    }

    // --- KRİTİK: İTİRAZ VERİLERİNİ YÜKLEME ---
    async loadObjectionRows() {
        // Eğer zaten yüklendiyse tekrar yükleme (Cache)
        if (this.objectionRows.length > 0) return this.objectionRows;

        const PARENT_TYPES = ['7', '19', '20']; // İtiraz ana tipleri
        const processedRows = [];

        // 20'şerli paralellik ile kayıtların transactionlarını çek
        await pLimit(this.allRecords, 20, async (record) => {
            let transactions = [];
            
            // Cache kontrolü
            if (this.txCache.has(record.id)) {
                transactions = this.txCache.get(record.id);
            } else {
                const res = await ipRecordsService.getTransactionsForRecord(record.id);
                if (res.success && Array.isArray(res.transactions)) {
                    transactions = res.transactions;
                    this.txCache.set(record.id, transactions);
                }
            }

            if (!transactions.length) return;

            // Parent ve Child ayrımı
            const parents = transactions.filter(t => PARENT_TYPES.includes(String(t.type)) && (t.transactionHierarchy === 'parent' || !t.parentId));
            const childrenMap = {};
            transactions.forEach(t => {
                if (t.parentId) {
                    if (!childrenMap[t.parentId]) childrenMap[t.parentId] = [];
                    childrenMap[t.parentId].push(t);
                }
            });

            // Satırları oluştur
            for (const parent of parents) {
                const children = childrenMap[parent.id] || [];
                const typeInfo = this.transactionTypesMap.get(String(parent.type));
                
                // Parent Row
                const parentRow = this._createObjectionRowData(record, parent, typeInfo, true, children.length > 0);
                processedRows.push(parentRow);

                // Child Rows
                children.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                for (const child of children) {
                    const childTypeInfo = this.transactionTypesMap.get(String(child.type));
                    const childRow = this._createObjectionRowData(record, child, childTypeInfo, false, false, parent.id);
                    processedRows.push(childRow);
                }
            }
        });

        this.objectionRows = processedRows;
        return this.objectionRows;
    }

    _createObjectionRowData(record, tx, typeInfo, isParent, hasChildren, parentId = null) {
        // Belge toplama (Basit versiyon, detaylısı TransactionHelper'da)
        const docs = (tx.documents || []).map(d => ({
            fileName: d.name || 'Belge',
            fileUrl: d.url || d.downloadURL || d.path,
            type: d.type
        }));
        
        if (tx.relatedPdfUrl) docs.push({ fileName: 'Resmi Yazı', fileUrl: tx.relatedPdfUrl, type: 'official_document' });
        if (tx.oppositionPetitionFileUrl) docs.push({ fileName: 'İtiraz Dilekçesi', fileUrl: tx.oppositionPetitionFileUrl, type: 'opposition_petition' });
        if (tx.triggeringTaskId) { /* Task docs can be lazy loaded or handled in renderer if needed */ }

        return {
            id: tx.id,
            recordId: record.id,
            parentId: parentId, // Child ise parent ID'si
            isChild: !isParent,
            hasChildren: hasChildren,
            
            // Filtreleme ve Gösterim Alanları
            title: record.title || record.brandText || '',
            transactionTypeName: typeInfo?.alias || typeInfo?.name || `İşlem ${tx.type}`,
            applicationNumber: record.applicationNumber || '-',
            applicantName: this._getApplicantName(record),
            opponent: tx.oppositionOwner || tx.objectionOwners?.map(o=>o.name).join(', ') || '-',
            bulletinNo: tx.bulletinNo || record.details?.brandInfo?.opposedMarkBulletinNo || '-',
            statusText: this._formatObjectionStatus(tx.requestResult),
            timestamp: tx.timestamp,
            documents: docs
        };
    }

    // --- Helperlar ---
    _getApplicantName(r) {
        if (Array.isArray(r.applicants)) {
            return r.applicants.map(a => {
                const p = this.allPersons.find(x => x.id === a.id);
                return p ? p.name : a.name;
            }).join(', ');
        }
        return r.applicantName || '';
    }

    _formatObjectionStatus(code) {
        if (!code) return 'Karar Bekleniyor';
        // Basit map, utils'den de alınabilir
        const map = { '28': 'Kabul', '30': 'Ret', '29': 'Kısmi Kabul' }; 
        return map[String(code)] || 'Karar Bekleniyor';
    }

    _fmtDate(val) {
        try {
            if(!val) return '-';
            const d = val.toDate ? val.toDate() : new Date(val);
            return d.toLocaleDateString('tr-TR');
        } catch { return '-'; }
    }
    
    _parseDate(str) {
        if(!str || str === '-') return 0;
        const parts = str.split('.');
        if(parts.length === 3) return new Date(parts[2], parts[1]-1, parts[0]).getTime();
        return 0;
    }

    // --- Filtreleme ---
    filterRecords(typeFilter, searchTerm, columnFilters = {}) {
        let sourceData = [];

        if (typeFilter === 'litigation') {
            sourceData = this.litigationRows;
        } else if (typeFilter === 'objections') {
            sourceData = this.objectionRows;
        } else {
            sourceData = this.allRecords.filter(r => {
                if (typeFilter === 'all') return r.recordOwnerType !== 'third_party';
                if (typeFilter === 'trademark') return r.type === 'trademark' && r.recordOwnerType !== 'third_party';
                return r.type === typeFilter;
            });
        }

        return sourceData.filter(item => {
            // İtirazlarda child satırları aramadan bağımsız olarak (parent'ı eşleşiyorsa) göstermek isteyebiliriz
            // Ancak şimdilik basit filtreleme yapıyoruz.
            
            // Global Arama
            if (searchTerm) {
                const searchStr = Object.values(item).join(' ').toLowerCase();
                if (!searchStr.includes(searchTerm.toLowerCase())) return false;
            }
            // Kolon Filtreleri
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
            if (String(column).toLowerCase().includes('date') || String(column).includes('tarih')) {
               valA = this._parseDate(valA) || new Date(valA).getTime();
               valB = this._parseDate(valB) || new Date(valB).getTime();
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