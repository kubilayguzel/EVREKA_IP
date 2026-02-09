// public/js/portfolio/PortfolioDataManager.js
import { ipRecordsService, transactionTypeService, personService, db } from '../../firebase-config.js';
// GÜNCEL IMPORT: collectionGroup, query, where EKLENDİ
import { doc, getDoc, collection, getDocs, collectionGroup, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { STATUSES } from '../../utils.js';

export class PortfolioDataManager {
    constructor() {
        this.allRecords = [];
        this.objectionRows = [];
        this.litigationRows = [];
        
        // --- PERFORMANS İÇİN HARİTALAR (MAPS) ---
        // O(1) erişim hızı sağlar, binlerce kayıtta döngüye girmeyi engeller.
        this.transactionTypesMap = new Map();
        this.personsMap = new Map(); 
        this.statusMap = new Map();  
        
        this.allCountries = [];
        this.taskCache = new Map(); 
        this.wipoGroups = { parents: new Map(), children: new Map() };

        // Durumları Haritala
        this._buildStatusMap();
    }

    async loadInitialData() {
        await Promise.all([
            this.loadTransactionTypes(),
            this.loadPersons(), // Kişileri çek ve haritala
            this.loadCountries()
        ]);
                // Sıralama için ülke adlarını ekle
        console.log('🌍 Ülke adları ekleniyor...');
        this.allRecords.forEach((record, idx) => {
            if (record.country) {
                record.formattedCountryName = this.getCountryName(record.country);
                
                // İlk 5 kayıt için debug
                if (idx < 5) {
                    console.log(`🔍 Kayıt ${idx}:`, {
                        country: record.country,
                        formatted: record.formattedCountryName,
                        allCountriesSize: this.allCountries?.length
                    });
                }
            }
        });
        console.log('✅ Ülke adları eklendi, toplam kayıt:', this.allRecords.length);
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
        if (result.success) {
            const persons = result.data || [];
            // Array'i Map'e çevir (HIZ OPTİMİZASYONU)
            // Bu sayede 1000 kişiyi aramak için döngüye girmeyiz, direkt ID ile buluruz.
            this.personsMap.clear();
            persons.forEach(p => {
                if(p.id) this.personsMap.set(p.id, p);
            });
        }
    }

    async loadCountries() {
        try {
            const docRef = doc(db, 'common', 'countries');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) this.allCountries = docSnap.data().list || [];
        } catch (e) { console.error("Ülke listesi hatası:", e); }
    }

    // Durum listesini Map'e çevirir (HIZ OPTİMİZASYONU)
    _buildStatusMap() {
        this.statusMap.clear();
        for (const type in STATUSES) {
            if (Array.isArray(STATUSES[type])) {
                STATUSES[type].forEach(s => {
                    // Her durumu map'e ekle. Örn: 'filed' -> 'Başvuru Yapıldı'
                    this.statusMap.set(s.value, s.text);
                });
            }
        }
    }

    // --- MAIN RECORDS ---
    async loadRecords() {
        const result = await ipRecordsService.getRecords();
        if (result.success) {
            const rawData = Array.isArray(result.data) ? result.data : [];
            
            // Veriyi işlerken optimize edilmiş (Map kullanan) metodları kullanıyoruz
            this.allRecords = rawData.map(record => ({
                ...record,
                formattedApplicantName: this._resolveApplicantName(record), // Artık çok hızlı
                formattedApplicationDate: this._fmtDate(record.applicationDate),
                formattedNiceClasses: this._formatNiceClasses(record),
                statusText: this._resolveStatusText(record) // Artık çok hızlı
            }));
            
            this._buildWipoGroups();
        }
        return this.allRecords;
    }

    startListening(onDataReceived) {
        return ipRecordsService.subscribeToRecords((result) => {
            if (result.success) {
                this.allRecords = result.data.map(record => ({
                    ...record,
                    formattedApplicantName: this._resolveApplicantName(record),
                    formattedApplicationDate: this._fmtDate(record.applicationDate),
                    formattedNiceClasses: this._formatNiceClasses(record),
                    statusText: this._resolveStatusText(record)
                }));
                this._buildWipoGroups();
                onDataReceived(this.allRecords);
            }
        });
    }

    // OPTİMİZE EDİLDİ: Artık .find() yerine .get() kullanıyor
    _resolveApplicantName(record) {
        if (Array.isArray(record.applicants) && record.applicants.length > 0) {
            return record.applicants.map(app => {
                if (app.id) {
                    // Map üzerinden O(1) erişim (Anında bulur)
                    const person = this.personsMap.get(app.id);
                    if (person) return person.name;
                }
                return app.name || '';
            }).filter(Boolean).join(', ');
        }
        return record.applicantName || '-';
    }

    // OPTİMİZE EDİLDİ: Artık döngü yerine Map kullanıyor
    _resolveStatusText(record) {
        const rawStatus = record.status;
        if (!rawStatus) return '-';
        
        // Önce Map'ten bak (Hızlı)
        if (this.statusMap.has(rawStatus)) {
            return this.statusMap.get(rawStatus);
        }
        
        return rawStatus;
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
                    type: 'litigation',
                    status: data.suitDetails?.suitStatus || 'continue', 
                    suitType: data.suitType || data.transactionType?.alias || data.transactionType?.name || '-',
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

    // --- OBJECTIONS (HIZLANDIRILMIŞ & OPTİMİZE EDİLMİŞ) ---
    async loadObjectionRows() {
        if (this.objectionRows.length > 0) return this.objectionRows;

        const PARENT_TYPES = ['7', '19', '20'];

        try {
            // HIZLI SORGULAMA: collectionGroup
            // Tüm veritabanındaki "transactions" koleksiyonlarını tek seferde tarar.
            const q = query(
                collectionGroup(db, 'transactions'), 
                where('type', 'in', PARENT_TYPES)
            );
            
            const snapshot = await getDocs(q);
            
            if (snapshot.empty) {
                this.objectionRows = [];
                return [];
            }

            const allTransactions = [];
            
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                // Subcollection olduğu için parent'ın parent'ı ana kayıttır (ipRecord)
                const parentRecordId = docSnap.ref.parent.parent ? docSnap.ref.parent.parent.id : null;
                
                if (parentRecordId) {
                    allTransactions.push({
                        ...data,
                        id: docSnap.id,
                        recordId: parentRecordId 
                    });
                }
            });

            // Sadece parent işlemleri al
            const parents = allTransactions.filter(t => t.transactionHierarchy === 'parent' || !t.parentId);
            const childrenMap = {};
            
            // Varsa alt işlemleri eşleştir
            allTransactions.forEach(t => {
                if (t.parentId && t.transactionHierarchy === 'child') {
                    if (!childrenMap[t.parentId]) childrenMap[t.parentId] = [];
                    childrenMap[t.parentId].push(t);
                }
            });

            const localRows = [];

            for (const parent of parents) {
                // Ana kaydı hafızadan bul
                const record = this.allRecords.find(r => r.id === parent.recordId);
                if (!record) continue;

                const children = childrenMap[parent.id] || [];
                const typeInfo = this.transactionTypesMap.get(String(parent.type));

                // Satır verisini oluştur (HIZLI VERSİYON)
                const parentRow = await this._createObjectionRowDataFast(record, parent, typeInfo, true, children.length > 0);
                localRows.push(parentRow);

                children.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                for (const child of children) {
                    const childTypeInfo = this.transactionTypesMap.get(String(child.type));
                    const childRow = await this._createObjectionRowDataFast(record, child, childTypeInfo, false, false, parent.id);
                    localRows.push(childRow);
                }
            }

            this.objectionRows = localRows;
            return this.objectionRows;

        } catch (error) {
            console.error("İtirazlar yüklenirken hata:", error);
            return [];
        }
    }

    // Task belgesi çekmeyen HIZLI fonksiyon
    // Eski versiyondaki _fetchTaskDocuments kaldırıldı.
    async _createObjectionRowDataFast(record, tx, typeInfo, isParent, hasChildren, parentId = null) {
        const docs = (tx.documents || []).map(d => ({
            fileName: d.name || 'Belge',
            fileUrl: d.url || d.downloadURL || d.path,
            type: d.type
        }));
        
        if (tx.relatedPdfUrl) docs.push({ fileName: 'Resmi Yazı', fileUrl: tx.relatedPdfUrl, type: 'official_document' });
        if (tx.oppositionPetitionFileUrl) docs.push({ fileName: 'İtiraz Dilekçesi', fileUrl: tx.oppositionPetitionFileUrl, type: 'opposition_petition' });
        if (tx.oppositionEpatsPetitionFileUrl) docs.push({ fileName: 'Karşı ePATS Dilekçesi', fileUrl: tx.oppositionEpatsPetitionFileUrl, type: 'opposition_epats_petition' });
       
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

    /**
     * İzleme modülü (Monitoring) için veriyi hazırlar.
     * @param {Object} record - Seçili kayıt objesi
     */
    prepareMonitoringData(record) {
        if (!record) return null;

        // 1. Başvuru sahibini belirle
        let ownerName = record.formattedApplicantName || '';
        if (!ownerName) {
            if (Array.isArray(record.applicants) && record.applicants.length > 0) {
                const app = record.applicants[0];
                ownerName = (typeof app === 'object') ? (app.name || app.companyName || '') : app;
            } else if (record.ownerName) {
                ownerName = record.ownerName;
            }
        }

        // 2. Sınıf Mantığını Kur (1-34 varsa 35 ekle)
        let originalClasses = [];
        if (record.niceClasses && Array.isArray(record.niceClasses)) {
            originalClasses = [...record.niceClasses];
        }
        if (record.goodsAndServicesByClass && Array.isArray(record.goodsAndServicesByClass)) {
            record.goodsAndServicesByClass.forEach(g => {
                if (g.classNo) originalClasses.push(g.classNo);
            });
        }
        
        let distinctClasses = [...new Set(originalClasses.map(c => parseInt(c)).filter(n => !isNaN(n)))];
        distinctClasses.sort((a, b) => a - b);

        let searchClasses = [...distinctClasses];
        const hasGoodsClass = searchClasses.some(c => c >= 1 && c <= 34);
        if (hasGoodsClass && !searchClasses.includes(35)) {
            searchClasses.push(35);
            searchClasses.sort((a, b) => a - b);
        }

        // 3. İzleme servisine gönderilecek standart obje yapısı
        return {
            id: record.id,                   
            relatedRecordId: record.id,      
            markName: record.title || record.brandText,
            applicationNumber: record.applicationNumber,
            status: record.status,              // <--- [EKLENDİ] Filtreleme için gerekli
            
            niceClasses: distinctClasses,       
            niceClassSearch: searchClasses,     
            
            ownerName: ownerName,
            image: record.brandImageUrl || record.trademarkImage || null,
            source: 'portfolio',
            createdAt: new Date().toISOString()
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

    _formatNiceClasses(record) {
        const classes = new Set();
        if (Array.isArray(record.niceClasses)) {
            record.niceClasses.forEach(c => classes.add(parseInt(c)));
        }
        if (Array.isArray(record.goodsAndServicesByClass)) {
            record.goodsAndServicesByClass.forEach(item => {
                if (item.classNo) classes.add(parseInt(item.classNo));
            });
        }
        if (classes.size === 0) return '-';
        return Array.from(classes).sort((a, b) => a - b).map(c => c < 10 ? `0${c}` : c).join(', ');
    }

    _fmtDate(val) {
        try {
            if(!val) return '-';
            const d = val.toDate ? val.toDate() : new Date(val);
            if(isNaN(d.getTime())) return '-';
            return d.toLocaleDateString('tr-TR');
        } catch { return '-'; }
    }
    _parseDate(val) {
        if (!val || val === '-') return 0;

        // 1. Eğer zaten Date objesiyse (Excel'den gelenler gibi)
        if (val instanceof Date) return val.getTime();

        // 2. Eğer Firestore Timestamp objesiyse (toDate fonksiyonu varsa)
        if (val && typeof val.toDate === 'function') {
            return val.toDate().getTime();
        }

        // 3. Eğer metin (String) değilse, güvenli bir şekilde sayıya çevirmeyi dene
        if (typeof val !== 'string') return 0;

        // 4. "25.10.2023" gibi noktalı metin formatı (Eski kayıtlar için)
        if (val.includes('.')) {
            const parts = val.split('.');
            if (parts.length === 3) {
                // Ay bilgisini 0-11 arasına çekmek için parts[1]-1 yapıyoruz
                return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
            }
        }

        // 5. ISO formatı veya diğer metin formatları
        const parsed = new Date(val).getTime();
        return isNaN(parsed) ? 0 : parsed;
    }
    getCountryName(code) {
        return this.allCountries.find(c => c.code === code)?.name || code || '-';
    }

    // --- FILTERS ---
    filterRecords(typeFilter, searchTerm, columnFilters = {}, subTab = null) {
        let sourceData = [];

        if (typeFilter === 'litigation') {
            sourceData = this.litigationRows;
        } else if (typeFilter === 'objections') {
            sourceData = this.objectionRows;
        } else {
            // ANA LİSTE FİLTRESİ
            sourceData = this.allRecords.filter(r => {
                // 1. Temel Kontroller (Child kayıtları ve 3. şahıs kayıtlarını gizle)
                if ((r.origin === 'WIPO' || r.origin === 'ARIPO') && r.transactionHierarchy === 'child') return false;
                
                // 2. Sekme Kontrolü
                if (typeFilter === 'all') {
                    return r.recordOwnerType !== 'third_party';
                }
                
                // 3. MARKA SEKMESİ ÖZEL FİLTRESİ (TÜRKPATENT vs YURTDIŞI)
                if (typeFilter === 'trademark') {
                    if (r.type !== 'trademark' || r.recordOwnerType === 'third_party') return false;

                    // YENİ: Alt Sekme (SubTab) Kontrolü
                    if (subTab === 'turkpatent') {
                        // Menşei TÜRKPATENT olanlar VEYA (Boşsa ve TR ise)
                        return r.origin === 'TÜRKPATENT' || r.origin === 'TR' || (!r.origin && r.country === 'TR');
                    } 
                    if (subTab === 'foreign') {
                        // Menşei TÜRKPATENT OLMAYANLAR
                        const isTP = r.origin === 'TÜRKPATENT' || r.origin === 'TR' || (!r.origin && r.country === 'TR');
                        return !isTP;
                    }
                    return true;
                }

                // Diğer türler (Patent, Tasarım vb.)
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
                let filterVal = val.toLowerCase();
                let itemVal = String(item[key] || '').toLowerCase();
                if (key === 'formattedApplicationDate' && val.includes('-')) {
                    const parts = val.split('-'); 
                    if (parts.length === 3) filterVal = `${parts[2]}.${parts[1]}.${parts[0]}`;
                }
                if (!itemVal.includes(filterVal)) return false;
            }
            return true;
        });
    }

    sortRecords(data, column, direction) {
    return [...data].sort((a, b) => {
        // Ülke kolonunda kod yerine ad ile sırala
        let valA = column === 'country' ? (a.formattedCountryName || a[column]) : a[column];
        let valB = column === 'country' ? (b.formattedCountryName || b[column]) : b[column];
        
        // DEBUG: İlk 5 kayıt için log
        if (column === 'country' && Math.random() < 0.01) {
            console.log('🔍 Sıralama:', {
                codeA: a.country,
                nameA: valA,
                codeB: b.country,
                nameB: valB
            });
        }
        
        // Boş değerleri kontrol et
        const isEmptyA = (valA === null || valA === undefined || valA === '');
        const isEmptyB = (valB === null || valB === undefined || valB === '');
        
        if (isEmptyA && isEmptyB) return 0;
        if (isEmptyA) return direction === 'asc' ? 1 : -1; // Boşlar sona
        if (isEmptyB) return direction === 'asc' ? -1 : 1; // Boşlar sona
        
        // Tarih sütunları
        if (String(column).toLowerCase().includes('date') || String(column).toLowerCase().includes('tarih')) {
           valA = this._parseDate(valA) || new Date(valA).getTime();
           valB = this._parseDate(valB) || new Date(valB).getTime();
           return direction === 'asc' ? valA - valB : valB - valA;
        }
        
        // String karşılaştırması (TÜRKÇE DESTEK)
        const strA = String(valA);
        const strB = String(valB);
        const comparison = strA.localeCompare(strB, 'tr-TR', { sensitivity: 'base' });
        
        return direction === 'asc' ? comparison : -comparison;
    });
}
}