// public/js/portfolio/PortfolioDataManager.js
import { ipRecordsService, transactionTypeService, personService, db } from '../../firebase-config.js';
import { doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Basit concurrency helper (Aynı anda çok fazla istek atmamak için)
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

    // --- LOOKUPS ---
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

    // --- MAIN RECORDS ---
    async loadRecords() {
        const result = await ipRecordsService.getRecords();
        if (result.success) {
            this.allRecords = Array.isArray(result.data) ? result.data : [];
        }
        return this.allRecords;
    }

    getRecordById(id) {
        return this.allRecords.find(r => r.id === id);
    }

    // --- LITIGATION (DAVALAR) ---
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

    // --- OBJECTIONS (İTİRAZLAR) ---
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
        // Belge toplama
        const docs = (tx.documents || []).map(d => ({
            fileName: d.name || 'Belge',
            fileUrl: d.url || d.downloadURL || d.path,
            type: d.type
        }));
        
        if (tx.relatedPdfUrl) docs.push({ fileName: 'Resmi Yazı', fileUrl: tx.relatedPdfUrl, type: 'official_document' });
        if (tx.oppositionPetitionFileUrl) docs.push({ fileName: 'İtiraz Dilekçesi', fileUrl: tx.oppositionPetitionFileUrl, type: 'opposition_petition' });
       
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
            opponent: tx.oppositionOwner || (tx.objectionOwners || []).map(o=>o.name).join(', ') || '-',
            bulletinNo: tx.bulletinNo || record.details?.brandInfo?.opposedMarkBulletinNo || '-',
            statusText: this._formatObjectionStatus(tx.requestResult),
            timestamp: tx.timestamp,
            documents: docs
        };
    }

    // --- ACTIONS (SİLME, GÜNCELLEME, İZLEME) ---
    async deleteRecord(id) {
        return await ipRecordsService.deleteParentWithChildren(id);
    }

    async toggleRecordsStatus(ids) {
        const records = ids.map(id => this.getRecordById(id)).filter(Boolean);
        if(!records.length) return;

        // İlk kaydın tersini baz alarak hepsini aynı duruma getir
        const targetStatus = records[0].portfoyStatus === 'active' ? 'inactive' : 'active';
        
        await Promise.all(records.map(r => 
            ipRecordsService.updateRecord(r.id, { portfoyStatus: targetStatus })
        ));
    }

    prepareMonitoringData(record) {
        // Nice sınıflarını güvenli bir şekilde ayıkla
        const niceClasses = new Set();
        if (Array.isArray(record.goodsAndServicesByClass)) {
            record.goodsAndServicesByClass.forEach(c => niceClasses.add(Number(c.classNo)));
        }
        if (Array.isArray(record.niceClasses)) {
            record.niceClasses.forEach(n => niceClasses.add(Number(n)));
        }
        
        const classes = Array.from(niceClasses).sort((a,b)=>a-b);
        
        // Otomatik 35. sınıf ekleme mantığı
        if (classes.some(n => n >= 1 && n <= 34) && !classes.includes(35)) {
            classes.push(35);
        }

        return {
            id: record.id,
            ipRecordId: record.id,
            applicationNumber: record.applicationNumber,
            markName: record.title || record.brandText,
            niceClassSearch: classes,
            createdAt: new Date().toISOString()
        };
    }

    // --- EXPORT (DIŞA AKTARMA) ---
    async exportToExcel(data, ExcelJS, saveAs) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Portföy');
        
        worksheet.columns = [
            { header: 'Başvuru No', key: 'appNo', width: 20 },
            { header: 'Başlık/Marka', key: 'title', width: 30 },
            { header: 'Tür', key: 'type', width: 15 },
            { header: 'Durum', key: 'status', width: 20 },
            { header: 'Başvuru Tarihi', key: 'date', width: 15 },
            { header: 'Başvuru Sahibi', key: 'applicant', width: 30 }
        ];

        data.forEach(r => {
            worksheet.addRow({
                appNo: r.applicationNumber || '-',
                title: r.title || r.brandText || '-',
                type: r.type || '-',
                status: r.status || '-',
                date: this._fmtDate(r.applicationDate),
                applicant: this._getApplicantName(r)
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, `portfoy_export_${new Date().toISOString().slice(0,10)}.xlsx`);
    }

    async exportToPdf(data, html2pdf) {
        const content = document.createElement('div');
        content.innerHTML = `
            <h2 style="text-align:center; font-family:sans-serif;">Portföy Listesi</h2>
            <table border="1" style="width:100%; border-collapse:collapse; font-size:10px; font-family:sans-serif;">
                <thead>
                    <tr style="background:#eee;">
                        <th style="padding:4px;">No</th>
                        <th style="padding:4px;">Başlık</th>
                        <th style="padding:4px;">Tür</th>
                        <th style="padding:4px;">Durum</th>
                        <th style="padding:4px;">Tarih</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.map(r => `
                        <tr>
                            <td style="padding:4px;">${r.applicationNumber || '-'}</td>
                            <td style="padding:4px;">${r.title || r.brandText || '-'}</td>
                            <td style="padding:4px;">${r.type || '-'}</td>
                            <td style="padding:4px;">${r.status || '-'}</td>
                            <td style="padding:4px;">${this._fmtDate(r.applicationDate)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        
        const opt = {
            margin: 10,
            filename: 'portfoy_listesi.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        
        html2pdf().set(opt).from(content).save();
    }

    // --- HELPER METODLAR ---
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
        const map = { '28': 'Kabul', '30': 'Ret', '29': 'Kısmi Kabul', '24': 'Eksiklik' }; 
        return map[String(code)] || 'Karar Bekleniyor';
    }

    _fmtDate(val) {
        try {
            if(!val) return '-';
            const d = val.toDate ? val.toDate() : new Date(val);
            if(isNaN(d.getTime())) return '-';
            return d.toLocaleDateString('tr-TR');
        } catch { return '-'; }
    }
    
    _parseDate(str) {
        if(!str || str === '-') return 0;
        // DD.MM.YYYY formatı için
        const parts = str.split('.');
        if(parts.length === 3) return new Date(parts[2], parts[1]-1, parts[0]).getTime();
        return new Date(str).getTime() || 0;
    }

    getCountryName(code) {
        return this.allCountries.find(c => c.code === code)?.name || code || '-';
    }

    // --- FİLTRELEME & SIRALAMA ---
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
            if (String(column).toLowerCase().includes('date') || String(column).toLowerCase().includes('tarih')) {
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
}