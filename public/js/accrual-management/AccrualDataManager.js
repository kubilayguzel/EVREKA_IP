// public/js/accrual-management/AccrualDataManager.js

import { 
    authService, accrualService, taskService, personService, 
    generateUUID, db, transactionTypeService 
} from '../../firebase-config.js';

import { 
    doc, getDoc, collection, getDocs, query, where, writeBatch, documentId
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { 
    getStorage, ref, uploadBytes, getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

export class AccrualDataManager {
    constructor() {
        this.storage = getStorage();
        
        // Veri Havuzu
        this.allAccruals = [];
        this.allTasks = {};         // ID bazlı erişim: { "taskID": { ... } }
        this.allIpRecords = [];     // Array olarak tutuyoruz (Filtreleme için)
        this.ipRecordsMap = {};     // ID bazlı hızlı erişim için: { "recordID": { ... } }
        this.allPersons = [];
        this.allUsers = [];
        this.allTransactionTypes = [];
        
        // Filtrelenmiş ve İşlenmiş Veri
        this.processedData = [];
    }

    /**
     * Tüm verileri optimize edilmiş şekilde yükler.
     */
    async fetchAllData() {
        try {
            console.time("Veri Yükleme Süresi");
            console.log("📥 Veri çekme işlemi başladı...");

            // 1. ANA VERİLERİ ÇEK (IP Records HARİÇ)
            // IP Records'u burada çekmiyoruz çünkü çok büyük olabilir.
            const [accRes, personsRes, usersRes, typesRes] = await Promise.all([
                accrualService.getAccruals(),
                personService.getPersons(),
                taskService.getAllUsers(),
                transactionTypeService.getTransactionTypes()
            ]);

            this.allAccruals = accRes?.success ? (accRes.data || []) : [];
            this.allPersons = personsRes?.success ? (personsRes.data || []) : [];
            this.allUsers = usersRes?.success ? (usersRes.data || []) : [];
            this.allTransactionTypes = typesRes?.success ? (typesRes.data || []) : [];

            // Tarihleri Date objesine çevir
            this.allAccruals.forEach(a => { 
                a.createdAt = a.createdAt ? new Date(a.createdAt) : new Date(0); 
            });

            // 2. İLİŞKİLİ TASK'LERİ BATCH HALİNDE ÇEK
            // Sadece tahakkuklarda kullanılan Task'leri çekiyoruz.
            await this._fetchTasksInBatches();

            // 3. İLİŞKİLİ IP KAYITLARINI BATCH HALİNDE ÇEK (YENİ OPTİMİZASYON)
            // Sadece çekilen Task'lerde geçen IP Record ID'lerini çekiyoruz.
            await this._fetchIpRecordsInBatches();

            // 4. ARAMA METİNLERİNİ OLUŞTUR
            this._buildSearchStrings();

            // Veriyi processedData'ya aktar
            this.processedData = [...this.allAccruals];
            
            console.timeEnd("Veri Yükleme Süresi");
            console.log(`✅ Yüklenen: ${this.allAccruals.length} Tahakkuk, ${Object.keys(this.allTasks).length} İş, ${this.allIpRecords.length} Dosya.`);
            return true;

        } catch (error) {
            console.error("❌ Veri yükleme hatası:", error);
            throw error;
        }
    }

    /**
     * Firestore limitlerine takılmamak için Task ID'lerini 30'arlı gruplar halinde çeker.
     */
    async _fetchTasksInBatches() {
        if (this.allAccruals.length === 0) return;

        // Benzersiz Task ID'lerini topla
        const taskIds = [...new Set(this.allAccruals.map(a => a.taskId ? String(a.taskId) : null).filter(Boolean))];
        
        this.allTasks = {}; // Sıfırla

        if (taskIds.length > 0) {
            const chunkSize = 30; // Firestore 'in' sorgusu limiti
            const promises = [];

            for (let i = 0; i < taskIds.length; i += chunkSize) {
                const chunk = taskIds.slice(i, i + chunkSize);
                // Paralel sorgu başlat
                promises.push(this._fetchBatch(collection(db, 'tasks'), chunk, 'task'));
            }
            
            await Promise.all(promises);
        }
    }

    /**
     * YENİ: Sadece ilgili IP kayıtlarını (Dosyaları) çeker.
     * Tüm veritabanını indirmeyi engeller.
     */
    async _fetchIpRecordsInBatches() {
        // Çekilmiş olan Task'lerin içindeki relatedIpRecordId'leri topla
        const recordIds = new Set();
        
        Object.values(this.allTasks).forEach(task => {
            if (task.relatedIpRecordId) {
                recordIds.add(String(task.relatedIpRecordId));
            }
        });

        const uniqueRecordIds = Array.from(recordIds);
        this.allIpRecords = [];
        this.ipRecordsMap = {};

        if (uniqueRecordIds.length > 0) {
            const chunkSize = 30;
            const promises = [];

            for (let i = 0; i < uniqueRecordIds.length; i += chunkSize) {
                const chunk = uniqueRecordIds.slice(i, i + chunkSize);
                promises.push(this._fetchBatch(collection(db, 'ipRecords'), chunk, 'ipRecord'));
            }

            await Promise.all(promises);
        }
    }

    /**
     * Helper: Firestore'dan ID listesine göre batch veri çeker
     */
    async _fetchBatch(collectionRef, ids, type) {
        try {
            // documentId() kullanımı __name__ ile aynıdır, daha okunaklıdır
            const q = query(collectionRef, where(documentId(), 'in', ids));
            const snapshot = await getDocs(q);
            
            snapshot.forEach(doc => {
                const data = { id: doc.id, ...doc.data() };
                
                if (type === 'task') {
                    this.allTasks[doc.id] = data;
                } else if (type === 'ipRecord') {
                    this.allIpRecords.push(data);
                    this.ipRecordsMap[doc.id] = data; // Hızlı erişim için map de tut
                }
            });
        } catch (err) {
            console.error(`${type} chunk hatası:`, err);
        }
    }

    /**
     * Her bir tahakkuk için aranabilir metin (searchString) oluşturur.
     */
    _buildSearchStrings() {
        this.allAccruals.forEach(acc => {
            let searchTerms = [
                acc.id,
                acc.status === 'paid' ? 'ödendi' : (acc.status === 'unpaid' ? 'ödenmedi' : 'kısmen'),
                acc.tpInvoiceParty?.name,
                acc.serviceInvoiceParty?.name,
                acc.officialFee?.amount,
                acc.totalAmount
            ];

            const task = this.allTasks[String(acc.taskId)];
            if (task) {
                searchTerms.push(task.title); // İş Başlığı
                
                // İş Tipi (Alias)
                const typeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                if(typeObj) searchTerms.push(typeObj.alias || typeObj.name);

                // Dosya Numarası (App Number)
                if (task.relatedIpRecordId) {
                    // Map üzerinden hızlı erişim (Array find yerine)
                    const ipRec = this.ipRecordsMap[task.relatedIpRecordId]; 
                    if(ipRec) searchTerms.push(ipRec.applicationNumber);
                }
            } else {
                searchTerms.push(acc.taskTitle);
            }

            acc.searchString = searchTerms.filter(Boolean).join(' ').toLowerCase();
        });
    }

    filterAndSort(criteria, sort) {
    let data = [...this.allAccruals];

    // 1. Tab Filtresi
    if (criteria.tab === 'foreign') {
        data = data.filter(a => a.isForeignTransaction === true);
    }

    // 2. Durum Filtresi
    if (criteria.status && criteria.status !== 'all') {
        data = data.filter(a => a.status === criteria.status);
    }

    // 3. Arama Filtresi
    if (criteria.search) {
        const query = criteria.search.toLocaleLowerCase('tr');
        data = data.filter(item => item.searchString.includes(query));
    }

    // 4. Sıralama
    const { column, direction } = sort;

    data.sort((a, b) => {
        let valA, valB;

        // --- Yardımcı Fonksiyonlar ---
        const getPartyName = (item) =>
            item.tpInvoiceParty?.name || item.serviceInvoiceParty?.name || '';

        const getRemainingTotal = (item) => {
            if (Array.isArray(item.remainingAmount)) {
                return item.remainingAmount.reduce(
                    (sum, curr) => sum + (Number(curr.amount) || 0),
                    0
                );
            }
            return 0;
        };

        // UI'daki "Konu" sütunu ipRecords'tan geliyor; sıralama da aynı kaynağı kullanmalı.
        const getSubjectText = (item) => {
            const task = this.allTasks[String(item.taskId)];
            const recId = task?.relatedIpRecordId ? String(task.relatedIpRecordId) : null;
            const ipRec = recId ? this.ipRecordsMap[recId] : null;

            return (
                ipRec?.markName ||
                ipRec?.title ||
                ipRec?.name ||
                ipRec?.applicationNumber ||
                ipRec?.applicationNo ||
                item.subject ||
                item.description ||
                ''
            ).toString();
        };

        // --- ID Sıralaması (Sayısal Öncelikli) ---
        if (column === 'id') {
            const numA = parseFloat(a.id);
            const numB = parseFloat(b.id);
            if (!isNaN(numA) && !isNaN(numB)) {
                return direction === 'asc' ? numA - numB : numB - numA;
            }
            // Sayı değilse metin olarak sırala
            valA = (a.id || '').toString();
            valB = (b.id || '').toString();
            return direction === 'asc'
                ? valA.localeCompare(valB, 'tr', { numeric: true })
                : valB.localeCompare(valA, 'tr', { numeric: true });
        }

        // --- Diğer Kolonlar ---
        switch (column) {
            case 'status':
                valA = (a.status || '').toLowerCase();
                valB = (b.status || '').toLowerCase();
                break;

            case 'subject': // ✅ GÜNCELLENDİ: Konu sıralaması artık UI ile aynı kaynaktan
                valA = getSubjectText(a).toLocaleLowerCase('tr');
                valB = getSubjectText(b).toLocaleLowerCase('tr');
                break;

            case 'party':
                valA = getPartyName(a).toLocaleLowerCase('tr');
                valB = getPartyName(b).toLocaleLowerCase('tr');
                break;

            case 'taskTitle': {
                const tA = this.allTasks[String(a.taskId)];
                const tB = this.allTasks[String(b.taskId)];
                valA = (tA ? tA.title : (a.taskTitle || '')).toLocaleLowerCase('tr');
                valB = (tB ? tB.title : (b.taskTitle || '')).toLocaleLowerCase('tr');
                break;
            }

            case 'officialFee':
                valA = Number(a.officialFee?.amount) || 0;
                valB = Number(b.officialFee?.amount) || 0;
                break;

            case 'serviceFee':
                valA = Number(a.serviceFee?.amount) || 0;
                valB = Number(b.serviceFee?.amount) || 0;
                break;

            case 'totalAmount':
                valA = Number(a.totalAmount) || 0;
                valB = Number(b.totalAmount) || 0;
                break;

            case 'remainingAmount':
                valA = getRemainingTotal(a);
                valB = getRemainingTotal(b);
                break;

            case 'createdAt':
                valA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
                valB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
                return direction === 'asc' ? valA - valB : valB - valA;

            default:
                valA = (a[column] || '').toString().toLocaleLowerCase('tr');
                valB = (b[column] || '').toString().toLocaleLowerCase('tr');
        }

        // --- Karşılaştırma (Türkçe Karakter Uyumlu) ---
        if (typeof valA === 'string' && typeof valB === 'string') {
            return direction === 'asc'
                ? valA.localeCompare(valB, 'tr', { sensitivity: 'base' })
                : valB.localeCompare(valA, 'tr', { sensitivity: 'base' });
        }

        // Sayısal Karşılaştırma
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    this.processedData = data;
    return this.processedData;
}


    /**
     * Edit Modal'ı açarken Task detayının taze olduğundan emin olur.
     */
    async getFreshTaskDetail(taskId) {
        if (!taskId) return null;
        
        try {
            let task = this.allTasks[String(taskId)];
            // Eğer task zaten hafızada varsa ve detayları doluysa tekrar çekme
            if (!task || (!task.details && !task.relatedTaskId)) {
                const snap = await getDoc(doc(db, 'tasks', String(taskId)));
                if (snap.exists()) {
                    task = { id: snap.id, ...snap.data() };
                    this.allTasks[String(taskId)] = task; 
                }
            }
            return task;
        } catch (e) {
            console.warn('Task fetch error:', e);
            return null;
        }
    }

    /**
     * Tahakkuk Güncelleme
     */
    async updateAccrual(accrualId, formData, fileToUpload) {
        const currentAccrual = this.allAccruals.find(a => a.id === accrualId);
        if (!currentAccrual) throw new Error("Tahakkuk bulunamadı.");

        let newFiles = [];
        if (fileToUpload) {
            const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${fileToUpload.name}`);
            const snapshot = await uploadBytes(storageRef, fileToUpload);
            const url = await getDownloadURL(snapshot.ref);
            newFiles.push({ 
                name: fileToUpload.name, url, 
                type: 'foreign_invoice', 
                documentDesignation: 'Yurtdışı Fatura/Debit', 
                uploadedAt: new Date().toISOString() 
            });
        }
        const finalFiles = [...(currentAccrual.files || []), ...newFiles];

        const vatMultiplier = 1 + (formData.vatRate / 100);
        const targetOff = formData.applyVatToOfficialFee 
            ? formData.officialFee.amount * vatMultiplier 
            : formData.officialFee.amount;
        const targetSrv = formData.serviceFee.amount * vatMultiplier;

        const paidOff = currentAccrual.paidOfficialAmount || 0;
        const paidSrv = currentAccrual.paidServiceAmount || 0;

        const remOff = Math.max(0, targetOff - paidOff);
        const remSrv = Math.max(0, targetSrv - paidSrv);

        const remMap = {};
        if (remOff > 0.01) remMap[formData.officialFee.currency] = (remMap[formData.officialFee.currency] || 0) + remOff;
        if (remSrv > 0.01) remMap[formData.serviceFee.currency] = (remMap[formData.serviceFee.currency] || 0) + remSrv;

        const newRemainingAmount = Object.entries(remMap).map(([curr, amt]) => ({ amount: amt, currency: curr }));

        let newStatus = 'unpaid';
        if (newRemainingAmount.length === 0) newStatus = 'paid';
        else if (paidOff > 0 || paidSrv > 0) newStatus = 'partially_paid';

        const updates = {
            ...formData,
            remainingAmount: newRemainingAmount,
            status: newStatus,
            files: finalFiles,
        };
        delete updates.files; 
        updates.files = finalFiles;

        await accrualService.updateAccrual(accrualId, updates);
        await this.fetchAllData(); 
    }

    /**
     * Ödeme Kaydetme
     */
    async savePayment(selectedIds, paymentData) {
        const { date, receiptFiles, singlePaymentDetails } = paymentData;
        const ids = Array.from(selectedIds);

        let uploadedFileRecords = [];
        
        if (receiptFiles && receiptFiles.length > 0) {
            const uploadPromises = receiptFiles.map(async (fileObj) => {
                if (!fileObj.file) return fileObj;
                try {
                    const storageRef = ref(this.storage, `receipts/${Date.now()}_${fileObj.file.name}`);
                    const snapshot = await uploadBytes(storageRef, fileObj.file);
                    const downloadURL = await getDownloadURL(snapshot.ref);
                    return {
                        name: fileObj.name,
                        url: downloadURL,
                        type: fileObj.type || 'application/pdf',
                        uploadedAt: new Date().toISOString()
                    };
                } catch (error) {
                    console.error("Dosya yükleme hatası:", error);
                    return null;
                }
            });
            const results = await Promise.all(uploadPromises);
            uploadedFileRecords = results.filter(f => f !== null);
        }

        const promises = ids.map(async (id) => {
            const acc = this.allAccruals.find(a => a.id === id);
            if (!acc) return;

            let updates = {
                files: [...(acc.files || []), ...uploadedFileRecords]
            };

            if (ids.length === 1 && singlePaymentDetails && singlePaymentDetails.isForeignMode) {
                updates.foreignPaymentDate = date;
                const inputOfficial = parseFloat(singlePaymentDetails.manualOfficial) || 0;
                const inputService = parseFloat(singlePaymentDetails.manualService) || 0;
                const totalPaidOut = inputOfficial + inputService;
                const targetDebt = acc.officialFee?.amount || 0;
                const currency = acc.officialFee?.currency || 'EUR';

                updates.foreignPaidOfficialAmount = inputOfficial;
                updates.foreignPaidServiceAmount = inputService;

                const remainingDebt = Math.max(0, targetDebt - totalPaidOut);
                updates.foreignRemainingAmount = [{ amount: remainingDebt, currency: currency }];

                if (remainingDebt <= 0.01) updates.foreignStatus = 'paid';
                else if (totalPaidOut > 0) updates.foreignStatus = 'partially_paid';
                else updates.foreignStatus = 'unpaid';
            } 
            else if (ids.length === 1 && singlePaymentDetails) {
                updates.paymentDate = date;
                const { payFullOfficial, payFullService, manualOfficial, manualService } = singlePaymentDetails;
                const vatMultiplier = 1 + ((acc.vatRate || 0) / 100);

                const offTarget = acc.applyVatToOfficialFee ? (acc.officialFee?.amount || 0) * vatMultiplier : (acc.officialFee?.amount || 0);
                const newPaidOff = payFullOfficial ? offTarget : (parseFloat(manualOfficial) || 0);

                const srvTarget = (acc.serviceFee?.amount || 0) * vatMultiplier;
                const newPaidSrv = payFullService ? srvTarget : (parseFloat(manualService) || 0);

                updates.paidOfficialAmount = newPaidOff;
                updates.paidServiceAmount = newPaidSrv;

                const remOff = Math.max(0, offTarget - newPaidOff);
                const remSrv = Math.max(0, srvTarget - newPaidSrv);

                const remMap = {};
                if (remOff > 0.01) remMap[acc.officialFee?.currency || 'TRY'] = (remMap[acc.officialFee?.currency] || 0) + remOff;
                if (remSrv > 0.01) remMap[acc.serviceFee?.currency || 'TRY'] = (remMap[acc.serviceFee?.currency] || 0) + remSrv;
                updates.remainingAmount = Object.entries(remMap).map(([c, a]) => ({ amount: a, currency: c }));

                if (updates.remainingAmount.length === 0) updates.status = 'paid';
                else if (newPaidOff > 0 || newPaidSrv > 0) updates.status = 'partially_paid';
                else updates.status = 'unpaid';
            }
            else {
                updates.status = 'paid';
                updates.remainingAmount = [];
                const vatMultiplier = 1 + ((acc.vatRate || 0) / 100);
                updates.paidOfficialAmount = acc.applyVatToOfficialFee ? (acc.officialFee?.amount || 0) * vatMultiplier : (acc.officialFee?.amount || 0);
                updates.paidServiceAmount = (acc.serviceFee?.amount || 0) * vatMultiplier;
            }

            return accrualService.updateAccrual(id, updates);
        });

        await Promise.all(promises);
        await this.fetchAllData();
    }

    /**
     * Toplu Durum Güncelleme
     */
    async batchUpdateStatus(selectedIds, newStatus) {
        const ids = Array.from(selectedIds);
        const promises = ids.map(async (id) => {
            const acc = this.allAccruals.find(a => a.id === id);
            if (!acc) return;

            const updates = { status: newStatus };
            
            if (newStatus === 'unpaid') {
                updates.paymentDate = null;
                updates.paidOfficialAmount = 0;
                updates.paidServiceAmount = 0;
                updates.remainingAmount = acc.totalAmount; 
            }

            return accrualService.updateAccrual(id, updates);
        });

        await Promise.all(promises);
        await this.fetchAllData();
    }

    async deleteAccrual(id) {
        await accrualService.deleteAccrual(id);
        await this.fetchAllData();
    }
}