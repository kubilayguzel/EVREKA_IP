// Firebase imports for image upload
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { app } from '../firebase-config.js';

// Initialize Firebase Storage
const storage = getStorage(app);

/**
 * TÜRKPATENT'ten gelen sahip numarası sorgu verilerini IPRecord formatına dönüştürür
 * @param {Object} turkpatentData - TÜRKPATENT'ten gelen ham veri
 * @param {Array} selectedApplicants - Arayüzden seçilen sahip bilgileri
 * @returns {Object} IPRecord formatında veri
 */
async function mapTurkpatentToIPRecord(turkpatentData, selectedApplicants = []) {
    // Tablo verilerinden gelen temel alanlar
    const {
        order,
        applicationNumber,
        brandName,
        ownerName,
        applicationDate,
        registrationNumber,
        status,
        niceClasses,
        brandImageDataUrl,
        imageSrc,
        details = {},
        goodsAndServicesByClass, // Modal'dan gelen
        transactions // Modal'dan gelen
    } = turkpatentData;

    // Modal'dan gelen detay alanları
    const getDetailValue = (key) => {
        return details[key] || null;
    };

    // Tarih formatını düzenle (DD.MM.YYYY -> YYYY-MM-DD)
    const formatDate = (dateStr) => {
        if (!dateStr) return null;
        
        // Eğer zaten YYYY-MM-DD formatındaysa
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return dateStr;
        }
        
        // DD.MM.YYYY formatını çevir
        const dateMatch = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
        if (dateMatch) {
            const [, day, month, year] = dateMatch;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        
        return null;
    };

    // Görsel upload işlemi
    const uploadBrandImage = async () => {
        const imageUrl = brandImageDataUrl || imageSrc;
        if (!imageUrl || !applicationNumber) return null;

        try {
            // Resmi fetch et
            const response = await fetch(imageUrl);
            if (!response.ok) return null;
            
            const blob = await response.blob();
            const fileName = `${applicationNumber}_${Date.now()}.${blob.type.split('/')[1] || 'jpg'}`;
            
            // Firebase Storage'a yükle
            const storageRef = ref(storage, `brand-examples/${fileName}`);
            const snapshot = await uploadBytes(storageRef, blob);
            const downloadURL = await getDownloadURL(snapshot.ref);
            
            return downloadURL;
        } catch (error) {
            console.error('Görsel upload hatası:', error);
            return null;
        }
    };

    // Nice sınıflarını parse et
    const parseNiceClasses = (niceClassesStr) => {
        if (!niceClassesStr) return [];
        
        const numbers = niceClassesStr.toString()
            .split(/[,;\s]+/)
            .map(n => parseInt(n.trim()))
            .filter(n => !isNaN(n) && n > 0 && n <= 45);
            
        return [...new Set(numbers)];
    };

    // Mal ve hizmetleri sınıflara göre grupla
    const createGoodsAndServicesByClass = () => {
        // Modal'dan gelen detaylı listeyi önce kontrol et
        if (goodsAndServicesByClass && Array.isArray(goodsAndServicesByClass) && goodsAndServicesByClass.length > 0) {
            return goodsAndServicesByClass.map(item => ({
                classNo: item.classNo,
                items: Array.isArray(item.items) ? item.items : []
            }));
        }
        
        // Fallback: niceClasses string'inden parse et
        const niceClassNumbers = parseNiceClasses(niceClasses);
        const goodsText = getDetailValue('Mal/Hizmet Listesi') || 
                         getDetailValue('Mal ve Hizmetler') ||
                         '';

        if (niceClassNumbers.length === 0) {
            return [];
        }

        let goodsItems = [];
        if (goodsText) {
            goodsItems = goodsText.split(/[,;]+/)
                                  .map(item => item.trim())
                                  .filter(Boolean);
        }

        return niceClassNumbers.map(classNo => ({
            classNo,
            items: goodsItems
        }));
    };

    // Bülten bilgilerini oluştur (sadece normal bülten)
    const createBulletins = () => {
        const bulletins = [];
        
        const bulletinNo = getDetailValue('Bülten Numarası') || getDetailValue('Bulletin Number');
        const bulletinDate = getDetailValue('Bülten Tarihi') || getDetailValue('Bulletin Date');

        if (bulletinNo || bulletinDate) {
            bulletins.push({
                bulletinNo: bulletinNo || null,
                bulletinDate: formatDate(bulletinDate)
            });
        }

        return bulletins;
    };

    // Rüçhan bilgilerini oluştur
    const createPriorities = () => {
        const priorities = [];
        
        const priorityDate = getDetailValue('Öncelik Tarihi');
        const priorityNumber = getDetailValue('Öncelik Numarası');
        const priorityCountry = getDetailValue('Öncelik Ülkesi');

        if (priorityDate || priorityNumber) {
            priorities.push({
                priorityDate: formatDate(priorityDate),
                priorityNumber: priorityNumber || null,
                priorityCountry: priorityCountry || null
            });
        }

        return priorities;
    };

    // Görsel upload et
    const brandImageUrl = await uploadBrandImage();

    // IPRecord formatına dönüştür
    const ipRecord = {
        // Temel kimlik bilgileri
        title: brandName || 'Başlıksız Marka',
        type: 'trademark',
        portfoyStatus: 'active',
        
        // Durum bilgileri - utils status mapping ile
        status: mapStatusToUtils(status),
        recordOwnerType: 'self',
        
        // Başvuru bilgileri
        applicationNumber: applicationNumber || null,
        applicationDate: formatDate(applicationDate),
        registrationNumber: registrationNumber || getDetailValue('Tescil Numarası') || null,
        registrationDate: formatDate(getDetailValue('Tescil Tarihi')),
        renewalDate: formatDate(getDetailValue('Yenileme Tarihi')),
        
        // Marka özel bilgileri
        brandText: brandName || '',
        brandImageUrl: brandImageUrl, // Upload edilmiş URL
        description: getDetailValue('Açıklama') || null,
        
        // Marka türü ve kategorisi
        brandType: getDetailValue('Marka Türü') || 'Şekil + Kelime',
        brandCategory: getDetailValue('Marka Kategorisi') || 'Ticaret/Hizmet Markası',
        nonLatinAlphabet: getDetailValue('Latin Olmayan Alfabe') || null,
        
        // Sınıf ve mal/hizmet bilgileri
        goodsAndServicesByClass: createGoodsAndServicesByClass(),
        
        // Bülten bilgileri
        bulletins: createBulletins(),
        
        // Rüçhan bilgileri
        priorities: createPriorities(),
        
        // Başvuru sahipleri
        applicants: selectedApplicants.map(applicant => ({
            id: applicant.id,
            name: applicant.name,
            email: applicant.email || null
        })),
        
        // Ek bilgiler
        agentInfo: getDetailValue('Vekil Bilgileri') || null,
        
        // İşlem geçmişi -> oldTransactions olarak kaydet
        oldTransactions: transactions && Array.isArray(transactions) && transactions.length > 0 
            ? transactions.map(tx => ({
                date: formatDate(tx.date),
                description: tx.description,
                note: tx.note,
                source: 'turkpatent_scrape',
                createdAt: new Date().toISOString()
            })) 
            : [],
        
        // Diğer alanlar
        consentRequest: null,
        coverLetterRequest: null,
        
        // Zaman damgaları
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    return ipRecord;
}

/**
 * TÜRKPATENT durumunu utils status değerleriyle mapping yapar
 */
function mapStatusToUtils(turkpatentStatus) {
    if (!turkpatentStatus) return null;
    
    const normalizedStatus = turkpatentStatus.toLowerCase().trim();
    
    // Sadece "MARKA BAŞVURUSU/TESCİLİ GEÇERSİZ" durumu için mapping
    if (normalizedStatus === 'marka başvurusu/tescili geçersiz') {
        return 'rejected';
    }
    
    // Diğer tüm durumlar için null (boş)
    return null;
}


/**
 * Sahip numarası sorgusundan gelen tüm kayıtları IPRecord formatına dönüştürür
 * @param {Array} turkpatentResults - TÜRKPATENT'ten gelen kayıt listesi
 * @param {Array} selectedApplicants - Seçilen sahipler
 * @returns {Array} IPRecord formatındaki kayıtlar
 */
async function mapTurkpatentResultsToIPRecords(turkpatentResults, selectedApplicants) {
    if (!Array.isArray(turkpatentResults)) {
        console.error('turkpatentResults array olmalı');
        return [];
    }
    
    const results = [];
    
    // Her kayıt için sırayla işle (paralel upload sorunları için)
    for (let index = 0; index < turkpatentResults.length; index++) {
        const result = turkpatentResults[index];
        try {
            const ipRecord = await mapTurkpatentToIPRecord(result, selectedApplicants);
            
            // Her kayıt için benzersiz ID oluştur
            ipRecord.tempId = `turkpatent_${Date.now()}_${index}`;
            
            results.push(ipRecord);
        } catch (error) {
            console.error(`Kayıt ${index} için mapping hatası:`, error, result);
            // Hatalı kayıtları null olarak ekle, sonra filtrele
            results.push(null);
        }
    }
    
    return results.filter(Boolean); // null kayıtları filtrele
}

// Export fonksiyonları
export {
    mapTurkpatentToIPRecord,
    mapTurkpatentResultsToIPRecords,
    mapStatusToUtils
};