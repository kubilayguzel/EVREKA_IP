// js/create-portfolio-by-opposition.js
// Yayına İtiraz işi oluşturulduğunda otomatik 3.taraf portföy kaydı oluşturma

import { getFirestore, doc, getDoc, addDoc, collection, query, where, getDocs, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

class PortfolioByOppositionCreator {
    constructor() {
        this.db = null;
        this.initFirebase();
    }

    initFirebase() {
        try {
            if (typeof getFirestore === 'function') {
                this.db = getFirestore();
                console.log('✅ PortfolioByOpposition: Firebase initialized');
            } else {
                console.error('❌ PortfolioByOpposition: Firebase not available');
            }
        } catch (error) {
            console.error('❌ PortfolioByOpposition Firebase init error:', error);
        }
    }

    /**
     * Bulletin kaydından 3.taraf portföy kaydı oluşturur ve task'ı günceller
     * @param {string} bulletinRecordId - Seçilen bulletin kaydının ID'si
     * @param {string} transactionId - İtiraz işinin ID'si
     * @returns {Object} Oluşturulan portföy kaydı bilgisi
     */
    async createThirdPartyPortfolioFromBulletin(bulletinRecordId, transactionId) {
        try {
            console.log('🔄 3.taraf portföy kaydı oluşturuluyor...', { bulletinRecordId, transactionId });

            // 1. Bulletin kaydını al
            const bulletinData = await this.getBulletinRecord(bulletinRecordId);
            if (!bulletinData.success) {
                return { success: false, error: bulletinData.error };
            }

        let bulletinDate = null;
        try {
            if (bulletinData.data.bulletinId) {
                const bulletinRef = doc(this.db, 'trademarkBulletins', bulletinData.data.bulletinId);
                const bulletinSnap = await getDoc(bulletinRef);
                if (bulletinSnap.exists()) {
                    bulletinDate = bulletinSnap.data().bulletinDate || null;
                }
            }
        } catch (err) {
            console.warn('⚠️ Bulletin tarihi alınamadı:', err);
        }

        // 2. Bulletin verisini portföy formatına dönüştür
        const portfolioData = this.mapBulletinToPortfolio(bulletinData.data, transactionId, bulletinDate);

            // 3. Portföy kaydını oluştur
            const result = await this.createPortfolioRecord(portfolioData);

            if (!result.success) {
                return { success: false, error: result.error };
            }

            // 4. ✅ Task'ın relatedIpRecordId'sini yeni oluşturulan 3.taraf portföy ID'si ile güncelle
            const taskUpdateResult = await this.updateTaskWithNewPortfolioRecord(transactionId, result.recordId, portfolioData.title);

            if (!taskUpdateResult.success) {
                console.warn('⚠️ Task güncellenirken hata oluştu:', taskUpdateResult.error);
                // Portföy kaydı oluşturuldu ama task güncellenemedi - bu durumu kullanıcıya bildir
                return {
                    success: true,
                    recordId: result.recordId,
                    message: '3.taraf portföy kaydı oluşturuldu ancak iş relatedIpRecordId güncellenirken hata oluştu',
                    warning: taskUpdateResult.error
                };
            }

            console.log('✅ 3.taraf portföy kaydı başarıyla oluşturuldu ve task relatedIpRecordId güncellendi:', result.recordId);
            return {
                success: true,
                recordId: result.recordId,
                message: '3.taraf portföy kaydı başarıyla oluşturuldu ve iş relatedIpRecordId güncellendi'
            };

        } catch (error) {
            console.error('❌ 3.taraf portföy kaydı oluşturma hatası:', error);
            return { 
                success: false, 
                error: `Portföy kaydı oluşturulamadı: ${error.message}` 
            };
        }
    }

    /**
     * ✅ YENİ METOD: Task'ın relatedIpRecordId'sini yeni oluşturulan 3.taraf portföy ID'si ile günceller
     * @param {string} taskId - Güncellenecek task'ın ID'si
     * @param {string} newPortfolioId - Yeni oluşturulan portföy kaydının ID'si
     * @param {string} portfolioTitle - Portföy kaydının başlığı
     * @returns {Object} Güncelleme sonucu
     */
    async updateTaskWithNewPortfolioRecord(taskId, newPortfolioId, portfolioTitle) {
        try {
            if (!this.db) {
                return { success: false, error: 'Firebase bağlantısı bulunamadı' };
            }

            const taskRef = doc(this.db, 'tasks', taskId);
            
            const updateData = {
                relatedIpRecordId: newPortfolioId, // Yeni 3.taraf portföy ID'sini task'a yaz
                relatedIpRecordTitle: portfolioTitle,
                updatedAt: new Date().toISOString()
            };

            await updateDoc(taskRef, updateData);
            
            console.log('✅ Task relatedIpRecordId güncellendi:', {
                taskId,
                oldRelatedIpRecordId: 'bulletin_record_id',
                newRelatedIpRecordId: newPortfolioId
            });

            return { success: true };

        } catch (error) {
            console.error('❌ Task güncelleme hatası:', error);
            return { 
                success: false, 
                error: `Task güncellenemedi: ${error.message}` 
            };
        }
    }

    /**
     * İş oluşturulduğunda otomatik tetikleme kontrolü
     * @param {Object} transactionData - İş verisi
     * @returns {Promise<Object>} İşlem sonucu
     */
    async handleTransactionCreated(transactionData) {
        try {
            console.log('🔍 İş oluşturuldu, yayına itiraz kontrolü yapılıyor...');

            // Yayına itiraz işi mi kontrol et
            if (!this.isPublicationOpposition(transactionData.specificTaskType)) {
                console.log('ℹ️ Bu iş yayına itiraz değil, portföy oluşturulmayacak');
                return { success: true, message: 'Yayına itiraz işi değil' };
            }

            // Seçilen bulletin kaydı var mı kontrol et
            if (!transactionData.selectedIpRecord || !transactionData.selectedIpRecord.id) {
                console.warn('⚠️ Seçilen bulletin kaydı bulunamadı');
                return { 
                    success: false, 
                    error: 'Yayına itiraz için bulletin kaydı seçilmeli' 
                };
            }

            // 3.taraf portföy kaydı oluştur ve task'ı güncelle
            const result = await this.createThirdPartyPortfolioFromBulletin(
                transactionData.selectedIpRecord.id,
                transactionData.id
            );

            return result;

        } catch (error) {
            console.error('❌ İş oluşturulma sonrası işlem hatası:', error);
            return { 
                success: false, 
                error: `Otomatik portföy oluşturma hatası: ${error.message}` 
            };
        }
    }

    /**
     * Bulletin kaydını Firestore'dan alır
     * @param {string} bulletinRecordId - Bulletin kayıt ID'si
     * @returns {Object} Bulletin verisi
     */
    async getBulletinRecord(bulletinRecordId) {
        try {
            if (!this.db) {
                return { success: false, error: 'Firebase bağlantısı bulunamadı' };
            }

            const docRef = doc(this.db, 'trademarkBulletinRecords', bulletinRecordId);
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists()) {
                return { success: false, error: 'Bulletin kaydı bulunamadı' };
            }

            const data = docSnap.data();
            console.log('📄 Bulletin kaydı alındı:', data.markName || data.applicationNo);

            return {
                success: true,
                data: {
                    id: docSnap.id,
                    ...data
                }
            };

        } catch (error) {
            console.error('❌ Bulletin kaydı alma hatası:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Bulletin verisini ipRecords portföy formatına dönüştürür
     * @param {Object} bulletinData - Bulletin verisi
     * @param {string} transactionId - İlgili işlem ID'si
     * @returns {Object} Portföy kayıt verisi
     */
    mapBulletinToPortfolio(bulletinData, transactionId,bulletinDate = null) {
        const now = new Date().toISOString();
        
    const applicants = Array.isArray(bulletinData.holders)
        ? bulletinData.holders.map(holder => ({
            id: `bulletin_holder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: holder.name || holder.holderName || holder.title || holder, // string veya obje olabilir
            address: holder.address || holder.addressText || null,
            country: holder.country || holder.countryCode || null,
        }))
        : [];

        // Mal ve hizmet sınıflarını düzenle
        const goodsAndServices = bulletinData.classNumbers?.map(classNum => ({
            niceClass: classNum.toString(),
            description: `Sınıf ${classNum} - Bulletin kaydından alınan`,
            status: 'active'
        })) || [];

        const portfolioData = {
            // Temel bilgiler
            title: bulletinData.markName || `Başvuru No: ${bulletinData.applicationNo}`,
            type: 'trademark',
            portfoyStatus: 'active',
            status: 'published_in_bulletin',
            recordOwnerType: 'third_party',
            
            // Başvuru/Tescil bilgileri
            applicationNumber: bulletinData.applicationNo || null,
            applicationDate: bulletinData.applicationDate || null,
            registrationNumber: null,
            registrationDate: null,
            renewalDate: null,
            
            // Marka bilgileri
            brandText: bulletinData.markName || null,
            brandImageUrl: bulletinData.imagePath || null,
            description: `Yayına itiraz (İş ID: ${transactionId}) için oluşturulan 3.taraf portföy kaydı`,
            
            // İlişkili veriler
            applicants: applicants,
            priorities: [],
            goodsAndServices: goodsAndServices,
            
            // Detay bilgileri
            details: {
                originalBulletinRecordId: null, // Bu daha sonra portföy ID'si ile güncellenecek
                sourceBulletinRecordId: bulletinData.id, // Kaynak bulletin kaydının ID'si
                relatedTransactionId: transactionId,
                brandInfo: {
                    brandType: bulletinData.markType || null,
                    brandCategory: null,
                    brandExampleText: bulletinData.markName || null,
                    nonLatinAlphabet: null,
                    coverLetterRequest: null,
                    consentRequest: null,
                    brandImage: bulletinData.imagePath || null,
                    brandImageName: null,
                    goodsAndServices: goodsAndServices,
                    opposedMarkBulletinNo: bulletinData.bulletinNo || null,
                    opposedMarkBulletinDate: bulletinDate || null
                }
            },
            
            // Sistem bilgileri
            createdAt: now,
            updatedAt: now,
            createdBy: 'opposition_automation',
            createdFrom: 'bulletin_record'
        };

        console.log('📋 Bulletin → Portföy mapping tamamlandı:', {
            markName: bulletinData.markName,
            applicationNo: bulletinData.applicationNo,
            applicantsCount: applicants.length,
            goodsServicesCount: goodsAndServices.length
        });

        return portfolioData;
    }

    /**
     * Portföy kaydını ipRecords koleksiyonuna kaydet
     * @param {Object} portfolioData - Portföy kayıt verisi
     * @returns {Object} Kayıt sonucu
     */
    async createPortfolioRecord(portfolioData) {
        try {
            if (!this.db) {
                return { success: false, error: 'Firebase bağlantısı bulunamadı' };
            }

            // ipRecords koleksiyonuna yeni kayıt ekle
            const docRef = await addDoc(collection(this.db, 'ipRecords'), portfolioData);
            
            console.log('✅ Portföy kaydı oluşturuldu:', docRef.id);
            
            return {
                success: true,
                recordId: docRef.id,
                data: portfolioData
            };

        } catch (error) {
            console.error('❌ Portföy kaydı kaydetme hatası:', error);
            return { 
                success: false, 
                error: `Kayıt oluşturulamadı: ${error.message}` 
            };
        }
    }

    /**
     * Yayına itiraz işi türü kontrolü - Hem ID hem de alias'a göre kontrol
     * @param {string} transactionTypeId - İşlem türü ID'si
     * @returns {boolean} Yayına itiraz işi mi?
     */
    isPublicationOpposition(transactionTypeId) {
        // Hem string ID'ler hem de numeric ID'ler için kontrol
        const PUBLICATION_OPPOSITION_IDS = [
            'trademark_publication_objection',  // JSON'daki ID
            '20',                               // Sistemdeki numeric ID
            20                                  // Number olarak da olabilir
        ];
        
        return PUBLICATION_OPPOSITION_IDS.includes(transactionTypeId) || 
               PUBLICATION_OPPOSITION_IDS.includes(String(transactionTypeId)) ||
               PUBLICATION_OPPOSITION_IDS.includes(Number(transactionTypeId));
    }

    /**
     * Manuel portföy oluşturma (test amaçlı)
     * @param {string} bulletinRecordId - Bulletin kayıt ID'si
     * @returns {Promise<Object>} İşlem sonucu
     */
    async createManualPortfolio(bulletinRecordId) {
        const transactionId = `manual_${Date.now()}`;
        return await this.createThirdPartyPortfolioFromBulletin(bulletinRecordId, transactionId);
    }

    /**
     * Mevcut portföy kaydı var mı kontrol et
     * @param {string} applicationNo - Başvuru numarası
     * @param {string} markName - Marka adı
     * @returns {Promise<Object>} Kontrol sonucu
     */
    async checkExistingPortfolio(applicationNo, markName) {
        try {
            if (!this.db) {
                return { success: false, error: 'Firebase bağlantısı bulunamadı' };
            }

            // Başvuru numarası ile kontrol
            let querySnapshot = null;
            if (applicationNo) {
                const q = query(
                    collection(this.db, 'ipRecords'),
                    where('applicationNumber', '==', applicationNo)
                );
                querySnapshot = await getDocs(q);
            }

            if (querySnapshot && !querySnapshot.empty) {
                const existingRecord = querySnapshot.docs[0];
                return {
                    success: true,
                    exists: true,
                    recordId: existingRecord.id,
                    data: existingRecord.data()
                };
            }

            return { success: true, exists: false };

        } catch (error) {
            console.error('❌ Mevcut portföy kontrolü hatası:', error);
            return { success: false, error: error.message };
        }
    }
}

// Global erişim için window objesine ekle
if (typeof window !== 'undefined') {
    window.PortfolioByOppositionCreator = PortfolioByOppositionCreator;
    window.portfolioByOppositionCreator = new PortfolioByOppositionCreator();
}

export default PortfolioByOppositionCreator;