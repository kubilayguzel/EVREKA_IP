// public/js/portfolio/PortfolioDataManager.js
import { ipRecordsService, transactionTypeService, personService, db } from '../../firebase-config.js';
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Concurrency Helper
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
    return results.flat(); // Sonuçları düz bir liste olarak döndürür
}

export class PortfolioDataManager {
    constructor() {
        this.allRecords = [];
        this.objectionRows = [];
        this.litigationRows = [];
        this.transactionTypesMap = new Map();
        this.allPersons = [];
        this.allCountries = [];
        this.taskCache = new Map();
        this.txCache = new Map();
        this.wipoGroups = { parents: new Map(), children: new Map() };
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
        if (result.success) this.allPersons = result.data || [];
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
            const rawData = Array.isArray(result.data) ? result.data : [];
            this.allRecords = rawData.map(record => ({
                ...record,
                formattedApplicantName: this._resolveApplicantName(record)
            }));
            this._buildWipoGroups();
        }
        return this.allRecords;
    }

    _resolveApplicantName(record) {
        if (Array.isArray(record.applicants) && record.applicants.length > 0) {
            return record.applicants.map(app => {
                if (app.id) {
                    const person = this.allPersons.find(p => p.id === app.id);
                    if (person) return person.name;
                }
                return app.name || '';
            }).filter(Boolean).join(', ');
        }
        return record.applicantName || '-';
    }

    getRecordById(id) {
        return this.allRecords.find(r => r.id === id);
    }

    // --- WIPO MANTIĞI ---
    _buildWipoGroups() {
        this.wipoGroups = { parents: new Map(), children: new Map() };
        this.allRecords.forEach(r => {
            if (r.origin === 'WIPO' || r.origin === 'ARIPO') {
                const irNo = r.wipoIR || r.aripoIR;
                if (!irNo) return;
                if (r.transactionHierarchy === 'parent') {
                    this.wipoGroups.parents.set(irNo, r);
                } else if (r.transactionHierarchy === 'child') {
                    if (!this.wipoGroups.children.has(irNo)) this.wipoGroups.children.set(irNo, []);
                    this.wipoGroups.children.get(irNo).push(r);
                }
            }
        });
    }

    getWipoChildren(irNo) {
        return this.wipoGroups.children.get(irNo) || [];
    }

    // --- TASK DOCUMENT FETCHING ---
    async _fetchTaskDocuments(taskId) {
        if (!taskId) return [];
        if (this.taskCache.has(taskId)) return this.taskCache.get(taskId);

        try {
            const taskDoc = await getDoc(doc(db, 'tasks', taskId));
            if (!taskDoc.exists()) return [];
            
            const taskData = taskDoc.data();
            const docs = [];

            if (taskData.details?.epatsDocument?.downloadURL) {
                docs.push({
                    fileName: taskData.details.epatsDocument.name || 'ePats Belgesi',
                    fileUrl: taskData.details.epatsDocument.downloadURL,
                    evrakNo: taskData.details.epatsDocument.turkpatentEvrakNo,
                    type: 'epats_document'
                });
            }

            if (Array.isArray(taskData.documents)) {
                taskData.documents.forEach(d => {
                    const url = d.downloadURL || d.url || d.path;
                    if (url) {
                        docs.push({
                            fileName: d.name || 'Task Belgesi',
                            fileUrl: url,
                            type: d.type || 'task_document'
                        });
                    }
                });
            }
            
            this.taskCache.set(taskId, docs);
            return docs;
        } catch (e) {
            console.warn('Task doc fetch error:', e);
            return [];
        }
    }

    // --- LITIGATION ---
    async loadLitigationData() {
        try {
            const suitsRef = collection(db, 'suits');
            const snapshot = await getDocs(suitsRef);
            this.litigationRows = snapshot.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    ...data,
                    suitType: data.transactionType?.alias || data.transactionType?.name || '-',
                    caseNo: data.suitDetails?.caseNo || '-',
                    court: data.suitDetails?.court || '-',
                    client: data.client?.name || '-',
                    opposingParty: data.suitDetails?.opposingParty || '-',
                    openedDate: data.suitDetails?.openingDate ? this._fmtDate(data.suitDetails.openingDate) : '-'
                };
            });
            this.litigationRows.sort((a, b) => this._parseDate(b.openedDate) - this._parseDate(a.openedDate));
            return this.litigationRows;
        } catch (e) {
            console.error("Davalar hatası:", e);
            return [];
        }
    }

    // --- OBJECTIONS (SIRALAMA HATASI DÜZELTİLDİ) ---
    async loadObjectionRows() {
        if (this.objectionRows.length > 0) return this.objectionRows;
        const PARENT_TYPES = ['7', '19', '20'];

        // pLimit sonuçlarını bir değişkene atıyoruz (Flat array dönecek)
        const flatResults = await pLimit(this.allRecords, 20, async (record) => {
            let transactions = [];
            if (this.txCache.has(record.id)) {
                transactions = this.txCache.get(record.id);
            } else {
                const res = await ipRecordsService.getTransactionsForRecord(record.id);
                if (res.success && Array.isArray(res.transactions)) {
                    transactions = res.transactions;
                    this.txCache.set(record.id, transactions);
                }
            }
            if (!transactions.length) return []; // Boş array dön

            const parents = transactions.filter(t => PARENT_TYPES.includes(String(t.type)) && (t.transactionHierarchy === 'parent' || !t.parentId));
            const childrenMap = {};
            transactions.forEach(t => {
                if (t.parentId) {
                    if (!childrenMap[t.parentId]) childrenMap[t.parentId] = [];
                    childrenMap[t.parentId].push(t);
                }
            });

            // BU KAYIT İÇİN YEREL LİSTE OLUŞTUR (Sıralamayı korumak için)
            const localRows = [];

            for (const parent of parents) {
                const children = childrenMap[parent.id] || [];
                const typeInfo = this.transactionTypesMap.get(String(parent.type));
                
                // Parent Row (Async)
                const parentRow = await this._createObjectionRowData(record, parent, typeInfo, true, children.length > 0);
                localRows.push(parentRow);

                // Child Rows
                children.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                for (const child of children) {
                    const childTypeInfo = this.transactionTypesMap.get(String(child.type));
                    // Child Row (Async)
                    const childRow = await this._createObjectionRowData(record, child, childTypeInfo, false, false, parent.id);
                    localRows.push(childRow);
                }
            }
            
            return localRows; // Bu kaydın sıralı satırlarını döndür
        });

        // Tüm kayıtların sonuçlarını tek bir listeye at
        this.objectionRows = flatResults; 
        return this.objectionRows;
    }

    async _createObjectionRowData(record, tx, typeInfo, isParent, hasChildren, parentId = null) {
        // 1. Transaction Belgeleri
        const docs = (tx.documents || []).map(d => ({
            fileName: d.name || 'Belge',
            fileUrl: d.url || d.downloadURL || d.path,
            type: d.type
        }));
        
        if (tx.relatedPdfUrl) docs.push({ fileName: 'Resmi Yazı', fileUrl: tx.relatedPdfUrl, type: 'official_document' });
        if (tx.oppositionPetitionFileUrl) docs.push({ fileName: 'İtiraz Dilekçesi', fileUrl: tx.oppositionPetitionFileUrl, type: 'opposition_petition' });
       
        // 2. Task Belgeleri
        if (tx.triggeringTaskId) {
            const taskDocs = await this._fetchTaskDocuments(tx.triggeringTaskId);
            docs.push(...taskDocs);
        }

        return {
            id: tx.id,
            recordId: record.id,
            parentId: parentId,
            isChild: !isParent,
            hasChildren: hasChildren,
            title: record.title || record.brandText || '',
            transactionTypeName: typeInfo?.alias || typeInfo?.name || `İşlem ${tx.type}`,
            applicationNumber: record.applicationNumber || '-',
            applicantName: record.formattedApplicantName || '-',
            opponent: tx.oppositionOwner || (tx.objectionOwners || []).map(o=>o.name).join(', ') || '-',
            bulletinNo: tx.bulletinNo || record.details?.brandInfo?.opposedMarkBulletinNo || '-',
            bulletinDate: this._fmtDate(record.details?.brandInfo?.opposedMarkBulletinDate || tx.bulletinDate),
            epatsDate: this._fmtDate(tx.epatsDocument?.documentDate),
            statusText: this._formatObjectionStatus(tx.requestResult),
            timestamp: tx.timestamp,
            documents: docs
        };
    }

    // --- ACTIONS ---
    async deleteRecord(id) { return await ipRecordsService.deleteParentWithChildren(id); }

    async toggleRecordsStatus(ids) {
        const records = ids.map(id => this.getRecordById(id)).filter(Boolean);
        if(!records.length) return;
        const targetStatus = records[0].portfoyStatus === 'active' ? 'inactive' : 'active';
        await Promise.all(records.map(r => ipRecordsService.updateRecord(r.id, { portfoyStatus: targetStatus })));
    }

    prepareMonitoringData(record) {
        const niceClasses = new Set();
        if (Array.isArray(record.goodsAndServicesByClass)) record.goodsAndServicesByClass.forEach(c => niceClasses.add(Number(c.classNo)));
        if (Array.isArray(record.niceClasses)) record.niceClasses.forEach(n => niceClasses.add(Number(n)));
        const classes = Array.from(niceClasses).sort((a,b)=>a-b);
        if (classes.some(n => n >= 1 && n <= 34) && !classes.includes(35)) classes.push(35);
        return {
            id: record.id, ipRecordId: record.id, applicationNumber: record.applicationNumber,
            markName: record.title || record.brandText, niceClassSearch: classes, createdAt: new Date().toISOString()
        };
    }

    // --- EXPORT ---
    async exportToExcel(data, ExcelJS, saveAs) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Portföy');
        worksheet.columns = [
            { header: 'Başvuru No', key: 'appNo', width: 25 },
            { header: 'Başlık/Marka', key: 'title', width: 40 },
            { header: 'Tür', key: 'type', width: 15 },
            { header: 'Durum', key: 'status', width: 20 },
            { header: 'Başvuru Tarihi', key: 'date', width: 15 },
            { header: 'Başvuru Sahibi', key: 'applicant', width: 40 }
        ];
        data.forEach(r => {
            worksheet.addRow({
                appNo: r.applicationNumber || '-',
                title: r.title || r.brandText || '-',
                type: r.type || '-',
                status: r.status || '-',
                date: this._fmtDate(r.applicationDate),
                applicant: r.formattedApplicantName || '-'
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
                        <th style="padding:4px;">No</th><th style="padding:4px;">Başlık</th><th style="padding:4px;">Tür</th><th style="padding:4px;">Durum</th><th style="padding:4px;">Sahibi</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.map(r => `<tr><td style="padding:4px;">${r.applicationNumber||'-'}</td><td style="padding:4px;">${r.title||'-'}</td><td style="padding:4px;">${r.type||'-'}</td><td style="padding:4px;">${r.status||'-'}</td><td style="padding:4px;">${r.formattedApplicantName||'-'}</td></tr>`).join('')}
                </tbody>
            </table>`;
        html2pdf().set({ margin: 10, filename: 'portfoy_listesi.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(content).save();
    }

    // --- HELPERS ---
    _formatObjectionStatus(code) {
        if (!code) return 'Karar Bekleniyor';
        const typeInfo = this.transactionTypesMap.get(String(code));
        return typeInfo ? (typeInfo.alias || typeInfo.name) : 'Karar Bekleniyor';
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
        const parts = str.split('.');
        if(parts.length === 3) return new Date(parts[2], parts[1]-1, parts[0]).getTime();
        return new Date(str).getTime() || 0;
    }
    getCountryName(code) {
        return this.allCountries.find(c => c.code === code)?.name || code || '-';
    }

    filterRecords(typeFilter, searchTerm, columnFilters = {}) {
        let sourceData = [];
        if (typeFilter === 'litigation') sourceData = this.litigationRows;
        else if (typeFilter === 'objections') sourceData = this.objectionRows;
        else {
            sourceData = this.allRecords.filter(r => {
                if ((r.origin === 'WIPO' || r.origin === 'ARIPO') && r.transactionHierarchy === 'child') return false;
                if (typeFilter === 'all') return r.recordOwnerType !== 'third_party';
                if (typeFilter === 'trademark') return r.type === 'trademark' && r.recordOwnerType !== 'third_party';
                return r.type === typeFilter;
            });
        }
        return sourceData.filter(item => {
            if (searchTerm) {
                const s = searchTerm.toLowerCase();
                if (typeFilter === 'objections') {
                    return (
                        (item.transactionTypeName && item.transactionTypeName.toLowerCase().includes(s)) ||
                        (item.title && item.title.toLowerCase().includes(s)) ||
                        (item.opponent && item.opponent.toLowerCase().includes(s)) ||
                        (item.bulletinNo && item.bulletinNo.toString().includes(s)) ||
                        (item.applicantName && item.applicantName.toLowerCase().includes(s)) ||
                        (item.applicationNumber && item.applicationNumber.toString().includes(s)) ||
                        (item.statusText && item.statusText.toLowerCase().includes(s))
                    );
                } else {
                    const searchStr = Object.values(item).join(' ').toLowerCase();
                    if (!searchStr.includes(s)) return false;
                }
            }
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