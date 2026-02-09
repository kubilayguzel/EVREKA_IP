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

    /**
     * Gelişmiş Filtreleme ve Sıralama
     */
    filterAndSort(criteria, sort) {
        // Parametrelerden değerleri al (main.js'den gelen yapı)
        const { tab, filters } = criteria;
        
        // Veri yoksa boş dön
        if (!this.allAccruals || this.allAccruals.length === 0) {
            return [];
        }

        // Ana veri kaynağı (Gerekirse foreign/main ayrımı yapılabilir ama şimdilik hepsi)
        let data = this.allAccruals;

        // --- KÜMÜLATİF FİLTRELEME MANTIĞI ---

        // 1. TARİH FİLTRESİ (Başlangıç ve Bitiş)
        if (filters.startDate) {
            const start = new Date(filters.startDate).getTime();
            data = data.filter(item => {
                const itemDate = item.createdAt ? new Date(item.createdAt).getTime() : 0;
                return itemDate >= start;
            });
        }
        if (filters.endDate) {
            // Bitiş tarihinin gün sonunu (23:59:59) kapsamasını sağla
            const end = new Date(filters.endDate);
            end.setHours(23, 59, 59, 999);
            const endTime = end.getTime();
            
            data = data.filter(item => {
                const itemDate = item.createdAt ? new Date(item.createdAt).getTime() : 0;
                return itemDate <= endTime;
            });
        }

        // 2. DURUM (Status)
        if (filters.status && filters.status !== 'all') {
            if (tab === 'foreign') {
                // Yurt dışı tabında foreignStatus'e bak (varsayılan 'unpaid')
                data = data.filter(item => (item.foreignStatus || 'unpaid') === filters.status);
            } else {
                data = data.filter(item => item.status === filters.status);
            }
        }

        // 3. ALAN (Field - Marka, Patent vb.)
        if (filters.field) {
            const searchVal = filters.field.toLowerCase();
            data = data.filter(item => {
                const task = this.allTasks[String(item.taskId)];
                const typeObj = task ? this.allTransactionTypes.find(t => t.id === task.taskType) : null;
                
                let itemField = '';
                if (typeObj && typeObj.ipType) {
                    const ipTypeMap = { 'trademark': 'Marka', 'patent': 'Patent', 'design': 'Tasarım', 'suit': 'Dava' };
                    itemField = ipTypeMap[typeObj.ipType] || typeObj.ipType;
                }
                return itemField.toLowerCase().includes(searchVal);
            });
        }

        // 4. TARAF (Party)
        if (filters.party) {
            const searchVal = filters.party.toLowerCase();
            data = data.filter(item => {
                // Hem TPE hem Hizmet faturasındaki taraflara bak
                const p1 = (item.paymentParty || '').toLowerCase();
                const p2 = (item.tpInvoiceParty?.name || '').toLowerCase();
                const p3 = (item.serviceInvoiceParty?.name || '').toLowerCase();
                return p1.includes(searchVal) || p2.includes(searchVal) || p3.includes(searchVal);
            });
        }

        // 5. İLGİLİ DOSYA NO (File No)
        if (filters.fileNo) {
            const searchVal = filters.fileNo.toLowerCase();
            data = data.filter(item => {
                const task = this.allTasks[String(item.taskId)];
                if (task && task.relatedIpRecordId) {
                    const ipRec = this.ipRecordsMap[task.relatedIpRecordId]; // Map'ten hızlı çekim
                    const appNo = ipRec ? (ipRec.applicationNumber || ipRec.applicationNo || '') : '';
                    return appNo.toLowerCase().includes(searchVal);
                }
                return false;
            });
        }

        // 6. KONU (Subject - Marka Adı vb.)
        if (filters.subject) {
            const searchVal = filters.subject.toLowerCase();
            data = data.filter(item => {
                const task = this.allTasks[String(item.taskId)];
                if (task && task.relatedIpRecordId) {
                    const ipRec = this.ipRecordsMap[task.relatedIpRecordId];
                    const subject = ipRec ? (ipRec.markName || ipRec.title || ipRec.name || '') : '';
                    return subject.toLowerCase().includes(searchVal);
                }
                return false;
            });
        }

        // 7. İLGİLİ İŞ (Task)
        if (filters.task) {
            const searchVal = filters.task.toLowerCase();
            data = data.filter(item => {
                const task = this.allTasks[String(item.taskId)];
                if (task) {
                    const typeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                    const taskName = typeObj ? (typeObj.alias || typeObj.name) : (task.title || '');
                    return taskName.toLowerCase().includes(searchVal);
                }
                return (item.taskTitle || '').toLowerCase().includes(searchVal);
            });
        }

        // --- SIRALAMA ---
        if (sort && sort.column) {
            data.sort((a, b) => {
                let valA = a[sort.column];
                let valB = b[sort.column];

                // Özel Kolonlar için Değer Atama
                if (sort.column === 'taskTitle') {
                    valA = a.taskTitle || ''; valB = b.taskTitle || '';
                } 
                else if (sort.column === 'subject') {
                    // Bu sıralama DataManager'da önbelleklenmediği için burada anlık çekmek maliyetli olabilir
                    // Basit string karşılaştırması yapıyoruz, gelişmiş sıralama için map kullanılabilir.
                    valA = String(valA || ''); valB = String(valB || '');
                }

                if (valA < valB) return sort.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sort.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        // --- EXCEL HELPER ---
        // (Bu metodun sınıf içinde tanımlı olduğundan emin olun, yoksa ayrıca eklenmeli)
        this.lastFilteredData = data; // Export için son filtreli veriyi sakla
        return data;
    }

    // Excel Export Helper Metodu (Data Manager içine ekleyin)
    async exportToExcelManual(data, tab) {
         // Burada ExcelJS işlemleri yapılabilir. 
         // Ancak proje yapısında bu işlemler genelde main.js içinde UI logic ile karışık.
         // Eğer main.js'deki exportToExcel'i kullanacaksanız bu metoda gerek yok.
         // Main.js'deki yapı dataManager.filterAndSort'tan dönen veriyi kullandığı için otomatik çalışacaktır.
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