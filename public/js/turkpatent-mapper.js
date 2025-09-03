/**
 * TÜRKPATENT'ten gelen sahip numarası sorgu verilerini IPRecord formatına dönüştürür
 * @param {Object} turkpatentData - TÜRKPATENT'ten gelen ham veri
 * @param {Array} selectedApplicants - Arayüzden seçilen sahip bilgileri
 * @returns {Object} IPRecord formatında veri
 */
function mapTurkpatentToIPRecord(turkpatentData, selectedApplicants = []) {
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
        details = {}
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

    // Nice sınıflarını parse et
    const parseNiceClasses = (niceClassesStr) => {
        if (!niceClassesStr) return [];
        
        // Virgül, noktalı virgül veya boşlukla ayrılmış sayıları bul
        const numbers = niceClassesStr.toString()
            .split(/[,;\s]+/)
            .map(n => parseInt(n.trim()))
            .filter(n => !isNaN(n) && n > 0 && n <= 45);
            
        return [...new Set(numbers)]; // Tekrarları kaldır
    };

// Mal ve hizmetleri sınıflara göre grupla
const createGoodsAndServicesByClass = () => {
    // Önce modal'dan gelen detaylı listeyi kontrol et
    if (turkpatentData.goodsAndServicesByClass && turkpatentData.goodsAndServicesByClass.length > 0) {
        return turkpatentData.goodsAndServicesByClass;
    }
    
    // Fallback: niceClasses string'inden parse et
    const niceClassNumbers = parseNiceClasses(niceClasses);
    const goodsText = getDetailValue('Mal/Hizmet Listesi') || 
                     getDetailValue('Mal ve Hizmetler') ||
                     '';

    if (!goodsText && niceClassNumbers.length === 0) {
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
        
        const bulletinNo = getDetailValue('Bülten Numarası');
        const bulletinDate = getDetailValue('Bülten Tarihi');

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

    // IPRecord formatına dönüştür
    const ipRecord = {
        // Temel kimlik bilgileri
        title: brandName || 'Başlıksız Marka',
        type: 'trademark',
        portfoyStatus: 'active',
        
        // Durum bilgileri
        status: mapStatus(status),
        recordOwnerType: 'self', // Varsayılan - handleSaveToPortfolio'da ayarlanacak
        
        // Başvuru bilgileri
        applicationNumber: applicationNumber || null,
        applicationDate: formatDate(applicationDate),
        registrationNumber: registrationNumber || getDetailValue('Tescil Numarası') || null,
        registrationDate: formatDate(getDetailValue('Tescil Tarihi')),
        renewalDate: formatDate(getDetailValue('Yenileme Tarihi')),
        
        // Marka özel bilgileri
        brandText: brandName || '',
        brandImageUrl: brandImageDataUrl || null,
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
        
        // Başvuru sahipleri - arayüzden gelen seçili sahipler
        applicants: selectedApplicants.map(applicant => ({
            id: applicant.id,
            name: applicant.name,
            email: applicant.email || null
        })),
        
        // Ek bilgiler
        agentInfo: getDetailValue('Vekil Bilgileri') || null,
        
        // Diğer alanlar
        consentRequest: null,
        coverLetterRequest: null,
        
        // Zaman damgaları
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        
        // Metadata
        _metadata: {
            source: 'turkpatent_scrape',
            originalData: turkpatentData,
            scrapedAt: new Date().toISOString()
        }
    };

    return ipRecord;
}

/**
 * TÜRKPATENT durumunu standart durum kodlarına çevirir
 */
function mapStatus(turkpatentStatus) {
    if (!turkpatentStatus) return 'filed';
    
    const statusMap = {
        'tescilli': 'registered',
        'tescil edildi': 'registered', 
        'registered': 'registered',
        'başvuru yapıldı': 'filed',
        'başvuru': 'filed',
        'filed': 'filed',
        'reddedildi': 'rejected',
        'rejected': 'rejected',
        'ret': 'rejected',
        'itiraz': 'opposition',
        'opposition': 'opposition',
        'iptal': 'cancelled',
        'cancelled': 'cancelled',
        'sona erdi': 'expired',
        'expired': 'expired',
        'askıya alındı': 'suspended',
        'suspended': 'suspended'
    };
    
    const normalizedStatus = turkpatentStatus.toLowerCase().trim();
    return statusMap[normalizedStatus] || 'filed';
}

/**
 * Sahip numarası sorgusundan gelen tüm kayıtları IPRecord formatına dönüştürür
 * @param {Array} turkpatentResults - TÜRKPATENT'ten gelen kayıt listesi
 * @param {Array} selectedApplicants - Seçilen sahipler
 * @returns {Array} IPRecord formatındaki kayıtlar
 */
function mapTurkpatentResultsToIPRecords(turkpatentResults, selectedApplicants) {
    if (!Array.isArray(turkpatentResults)) {
        console.error('turkpatentResults array olmalı');
        return [];
    }
    
    return turkpatentResults.map((result, index) => {
        try {
            const ipRecord = mapTurkpatentToIPRecord(result, selectedApplicants);
            
            // Her kayıt için benzersiz ID oluştur
            ipRecord.tempId = `turkpatent_${Date.now()}_${index}`;
            
            return ipRecord;
        } catch (error) {
            console.error(`Kayıt ${index} için mapping hatası:`, error, result);
            return null;
        }
    }).filter(Boolean); // null kayıtları filtrele
}

// Export fonksiyonları
export {
    mapTurkpatentToIPRecord,
    mapTurkpatentResultsToIPRecords,
    mapStatus
};
// İşlem geçmişini ekle (eğer varsa)
if (turkpatentData.transactions && turkpatentData.transactions.length > 0) {
    ipRecord.transactions = turkpatentData.transactions.map(tx => ({
        date: formatDate(tx.date),
        description: tx.description,
        note: tx.note,
        type: 'system', // TÜRKPATENT'ten gelen
        createdAt: new Date().toISOString()
    }));
}