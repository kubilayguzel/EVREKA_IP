// public/js/accrual-management/AccrualDataManager.js

import { 
    authService, accrualService, taskService, personService, 
    generateUUID, db, transactionTypeService 
} from '../../firebase-config.js';

import { 
    doc, getDoc, collection, getDocs, query, where, writeBatch 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { 
    getStorage, ref, uploadBytes, getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

export class AccrualDataManager {
    constructor() {
        this.storage = getStorage();
        
        // Veri Havuzu
        this.allAccruals = [];
        this.allTasks = {};         // ID bazlı erişim için obje: { "taskID": { ... } }
        this.allIpRecords = [];     // Dosya/Başvuru no eşleşmesi için
        this.allPersons = [];
        this.allUsers = [];
        this.allTransactionTypes = [];
        
        // Filtrelenmiş ve İşlenmiş Veri
        this.processedData = [];
    }

    /**
     * Tüm verileri yükler, ilişkileri kurar ve arama dizinini oluşturur.
     */
    async fetchAllData() {
        try {
            console.log("📥 Veri çekme işlemi başladı...");

            // 1. IP KAYITLARINI DOĞRUDAN ÇEK (Servis hatasını bypass etmek için)
            const ipSnapshot = await getDocs(collection(db, 'ipRecords'));
            this.allIpRecords = ipSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // 2. DİĞER VERİLERİ SERVİSLERDEN ÇEK
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

            // 3. TASK'LERİ BATCH (Yığın) HALİNDE ÇEK
            await this._fetchTasksInBatches();

            // 4. ARAMA METİNLERİNİ OLUŞTUR (Search Indexing)
            this._buildSearchStrings();

            // İlk işlem: Veriyi olduğu gibi processedData'ya aktar
            this.processedData = [...this.allAccruals];
            
            console.log("✅ Tüm veriler başarıyla yüklendi.");
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
            // 30'arlı gruplara böl (Firestore 'in' sorgusu limiti)
            const chunkSize = 30;
            for (let i = 0; i < taskIds.length; i += chunkSize) {
                const chunk = taskIds.slice(i, i + chunkSize);
                try {
                    const q = query(collection(db, 'tasks'), where('__name__', 'in', chunk));
                    const snapshot = await getDocs(q);
                    snapshot.forEach(doc => {
                        this.allTasks[doc.id] = { id: doc.id, ...doc.data() };
                    });
                } catch (err) {
                    console.error(`Task chunk hatası (${i}-${i+chunkSize}):`, err);
                }
            }
        }
    }

    /**
     * Her bir tahakkuk için aranabilir metin (searchString) oluşturur.
     * ID, Tutar, Dosya No, İş Tipi Alias, Taraf İsimleri vb. içerir.
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
                    const ipRec = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
                    if(ipRec) searchTerms.push(ipRec.applicationNumber);
                }
            } else {
                searchTerms.push(acc.taskTitle);
            }

            acc.searchString = searchTerms.filter(Boolean).join(' ').toLowerCase();
        });
    }

    /**
     * Verileri filtreler ve sıralar.
     * @param {Object} criteria - { tab: 'main'|'foreign', status: 'all'|..., search: '...' }
     * @param {Object} sort - { column: '...', direction: 'asc'|'desc' }
     */
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
        const dir = direction === 'asc' ? 1 : -1;

        data.sort((a, b) => {
            let valA, valB;
            switch (column) {
                case 'id': valA = (a.id || '').toLowerCase(); valB = (b.id || '').toLowerCase(); break;
                case 'status': valA = (a.status || '').toLowerCase(); valB = (b.status || '').toLowerCase(); break;
                case 'taskTitle':
                    // Task başlığına veya Alias'a göre sıralama mantığı eklenebilir
                    const tA = this.allTasks[String(a.taskId)];
                    const tB = this.allTasks[String(b.taskId)];
                    valA = (tA ? tA.title : (a.taskTitle || '')).toLowerCase();
                    valB = (tB ? tB.title : (b.taskTitle || '')).toLowerCase();
                    break;
                case 'officialFee': valA = Number(a.officialFee?.amount) || 0; valB = Number(b.officialFee?.amount) || 0; break;
                case 'serviceFee': valA = Number(a.serviceFee?.amount) || 0; valB = Number(b.serviceFee?.amount) || 0; break;
                case 'totalAmount': valA = Number(a.totalAmount) || 0; valB = Number(b.totalAmount) || 0; break;
                case 'createdAt': valA = a.createdAt; valB = b.createdAt; break;
                // Kalan tutar sıralaması karmaşık olduğu için totalAmount baz alındı
                default: valA = 0; valB = 0;
            }
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });

        this.processedData = data;
        return this.processedData;
    }

    /**
     * Edit Modal'ı açarken Task detayının taze olduğundan emin olur.
     * Özellikle EPATS belgesi için anlık sorgu atar.
     */
    async getFreshTaskDetail(taskId) {
        if (!taskId) return null;
        
        try {
            // Önbellekteki task'in detayları eksikse veritabanından çek
            let task = this.allTasks[String(taskId)];
            if (!task || (!task.details && !task.relatedTaskId)) {
                const snap = await getDoc(doc(db, 'tasks', String(taskId)));
                if (snap.exists()) {
                    task = { id: snap.id, ...snap.data() };
                    this.allTasks[String(taskId)] = task; // Cache güncelle
                }
            }
            return task;
        } catch (e) {
            console.warn('Task fetch error:', e);
            return null;
        }
    }

    /**
     * Tahakkuk Güncelleme ve Kalan Tutar Hesaplama Mantığı
     */
    async updateAccrual(accrualId, formData, fileToUpload) {
        const currentAccrual = this.allAccruals.find(a => a.id === accrualId);
        if (!currentAccrual) throw new Error("Tahakkuk bulunamadı.");

        // 1. Dosya Yükleme (Varsa)
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

        // 2. Kalan Tutar Hesaplama (HESAPLAMA MANTIĞI)
        const vatMultiplier = 1 + (formData.vatRate / 100);
        
        const targetOff = formData.applyVatToOfficialFee 
            ? formData.officialFee.amount * vatMultiplier 
            : formData.officialFee.amount;
        const targetSrv = formData.serviceFee.amount * vatMultiplier;

        // Veritabanındaki mevcut ödenen tutarlar
        const paidOff = currentAccrual.paidOfficialAmount || 0;
        const paidSrv = currentAccrual.paidServiceAmount || 0;

        // Kalan (Math.max ile negatif engellenir)
        const remOff = Math.max(0, targetOff - paidOff);
        const remSrv = Math.max(0, targetSrv - paidSrv);

        // Kalan tutarı diziye çevir (Multi-currency support)
        const remMap = {};
        if (remOff > 0.01) remMap[formData.officialFee.currency] = (remMap[formData.officialFee.currency] || 0) + remOff;
        if (remSrv > 0.01) remMap[formData.serviceFee.currency] = (remMap[formData.serviceFee.currency] || 0) + remSrv;

        const newRemainingAmount = Object.entries(remMap).map(([curr, amt]) => ({ amount: amt, currency: curr }));

        // 3. Status Hesaplama
        let newStatus = 'unpaid';
        if (newRemainingAmount.length === 0) newStatus = 'paid';
        else if (paidOff > 0 || paidSrv > 0) newStatus = 'partially_paid';

        // 4. Update Objesi
        const updates = {
            ...formData,
            remainingAmount: newRemainingAmount,
            status: newStatus,
            files: finalFiles,
            // Formdan gelmeyen ama korunması gereken alanları buraya eklemiyoruz, merge edilecek
        };
        // Form data içinde gelmeyen ama hesaplananlar:
        delete updates.files; // files'ı ayrıca işledik, formData içindekini eziyoruz
        updates.files = finalFiles;

        await accrualService.updateAccrual(accrualId, updates);
        
        // Belleği güncelle
        await this.fetchAllData(); 
    }

/**
     * Ödeme Kaydetme (Dosya Yüklemeli Versiyon)
     */
    async savePayment(selectedIds, paymentData) {
        const { date, receiptFiles, singlePaymentDetails } = paymentData;
        const ids = Array.from(selectedIds);

        // 1. DOSYALARI FIREBASE STORAGE'A YÜKLE VE URL AL
        let uploadedFileRecords = [];
        
        if (receiptFiles && receiptFiles.length > 0) {
            // Promise.all ile tüm dosyaları paralel yükle
            const uploadPromises = receiptFiles.map(async (fileObj) => {
                // Eğer dosya zaten bir URL ise (önceden yüklenmişse) pas geç
                if (!fileObj.file) return fileObj;

                try {
                    const storage = getStorage();
                    // Dosya yolu: receipts/timestamp_dosyaadi
                    const storageRef = ref(storage, `receipts/${Date.now()}_${fileObj.file.name}`);
                    
                    // Yükleme işlemi
                    const snapshot = await uploadBytes(storageRef, fileObj.file);
                    const downloadURL = await getDownloadURL(snapshot.ref);

                    // Veritabanına kaydedilecek temiz obje
                    return {
                        name: fileObj.name,
                        url: downloadURL, // Artık URL kaydediyoruz
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

            // Dosyaları mevcutların üzerine ekle
            let updates = {
                files: [...(acc.files || []), ...uploadedFileRecords]
            };

            // --- SENARYO 1: YURT DIŞI ÖDEMESİ ---
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
            
            // --- SENARYO 2: TAHAKKUK TAHSİLATI ---
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
            
            // --- SENARYO 3: ÇOKLU İŞLEM ---
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
     * Toplu Durum Güncelleme (Örn: Ödenmedi Yap)
     */
    async batchUpdateStatus(selectedIds, newStatus) {
        const ids = Array.from(selectedIds);
        const promises = ids.map(async (id) => {
            const acc = this.allAccruals.find(a => a.id === id);
            if (!acc) return;

            const updates = { status: newStatus };
            
            // Eğer "Ödenmedi" yapılıyorsa, ödeme geçmişini sil
            if (newStatus === 'unpaid') {
                updates.paymentDate = null;
                updates.paidOfficialAmount = 0;
                updates.paidServiceAmount = 0;
                // Kalan tutarı tekrar toplama eşitle
                // Not: Burada basitçe totalAmount'u diziye çevirmek gerekebilir, 
                // ancak totalAmount array ise direkt kopyalanır.
                // Basitlik adına UI'da totalAmount gösteriliyor, burada veri tutarlılığı için:
                // İdeal çözüm: calculateRemainingAmount mantığını burada da çalıştırmak.
                // Şimdilik null/undefined bırakıp görüntülemede totalAmount'a fallback yapıyoruz.
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