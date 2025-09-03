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

    // Modal'dan gelen detay alanları (dinamik)
    const getDetailValue = (key) => {
        // Türkçe ve İngilizce anahtar kelimeleri dene
        const possibleKeys = [
            key,
            key.toLowerCase(),
            key.toUpperCase(),
            ...getPossibleTranslations(key)
        ];
        
        for (const possibleKey of possibleKeys) {
            if (details[possibleKey]) {
                return details[possibleKey];
            }
        }
        return null;
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
        const niceClassNumbers = parseNiceClasses(niceClasses);
        const goodsText = getDetailValue('Mal/Hizmet Listesi') || 
                         getDetailValue('Mal ve Hizmetler') ||
                         getDetailValue('Goods and Services') ||
                         '';

        if (!goodsText && niceClassNumbers.length === 0) {
            return [];
        }

        // Eğer mal/hizmet metni varsa sınıflara böl
        if (goodsText) {
            const goodsItems = goodsText.split(/[,;]+/).map(item => item.trim()).filter(Boolean);
            
            return niceClassNumbers.map(classNo => ({
                classNo,
                items: goodsItems // Tüm mal/hizmetleri her sınıfa ata (detaylı ayrım için ek parsing gerekebilir)
            }));
        }

        // Sadece sınıf numaraları varsa boş items ile oluştur
        return niceClassNumbers.map(classNo => ({
            classNo,
            items: []
        }));
    };

    // Bülten bilgilerini oluştur
    const createBulletins = () => {
        const bulletins = [];
        
        const bulletinNo = getDetailValue('Bülten Numarası') || getDetailValue('Bulletin Number');
        const bulletinDate = getDetailValue('Bülten Tarihi') || getDetailValue('Bulletin Date');
        const regBulletinNo = getDetailValue('Tescil Bülten Numarası') || getDetailValue('Registration Bulletin Number');
        const regBulletinDate = getDetailValue('Tescil Bülten Tarihi') || getDetailValue('Registration Bulletin Date');

        if (bulletinNo || bulletinDate) {
            bulletins.push({
                bulletinNo: bulletinNo || null,
                bulletinDate: formatDate(bulletinDate)
            });
        }

        if (regBulletinNo || regBulletinDate) {
            bulletins.push({
                bulletinNo: regBulletinNo || null,
                bulletinDate: formatDate(regBulletinDate)
            });
        }

        return bulletins;
    };

    // Rüçhan bilgilerini oluştur
    const createPriorities = () => {
        const priorities = [];
        
        const priorityDate = getDetailValue('Öncelik Tarihi') || getDetailValue('Priority Date');
        const priorityNumber = getDetailValue('Öncelik Numarası') || getDetailValue('Priority Number');
        const priorityCountry = getDetailValue('Öncelik Ülkesi') || getDetailValue('Priority Country');

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
        title: brandName || getDetailValue('Marka Adı') || 'Başlıksız Marka',
        type: 'trademark',
        portfoyStatus: 'active',
        
        // Durum bilgileri
        status: mapStatus(status),
        recordOwnerType: 'own', // Varsayılan - arayüzden güncellenecek
        
        // Başvuru bilgileri
        applicationNumber: applicationNumber || null,
        applicationDate: formatDate(applicationDate || getDetailValue('Başvuru Tarihi')),
        registrationNumber: registrationNumber || getDetailValue('Tescil Numarası') || null,
        registrationDate: formatDate(getDetailValue('Tescil Tarihi')),
        renewalDate: formatDate(getDetailValue('Yenileme Tarihi')),
        
        // Marka özel bilgileri
        brandText: brandName || getDetailValue('Marka Adı') || '',
        brandImageUrl: brandImageDataUrl || null,
        description: getDetailValue('Açıklama') || getDetailValue('Description') || null,
        
        // Marka türü ve kategorisi
        brandType: getDetailValue('Marka Türü') || getDetailValue('Trademark Type') || 'Şekil + Kelime',
        brandCategory: getDetailValue('Marka Kategorisi') || getDetailValue('Trademark Category') || 'Ticaret/Hizmet Markası',
        nonLatinAlphabet: getDetailValue('Latin Olmayan Alfabe') || getDetailValue('Non-Latin Alphabet') || null,
        
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
        agentInfo: getDetailValue('Vekil Bilgileri') || getDetailValue('Agent Info') || null,
        decision: getDetailValue('Karar') || getDetailValue('Decision') || null,
        decisionReason: getDetailValue('Karar Gerekçesi') || getDetailValue('Decision Reason') || null,
        
        // Diğer alanlar
        consentRequest: null, // Arayüzden ayarlanacak
        coverLetterRequest: null, // Arayüzden ayarlanacak
        
        // Zaman damgaları
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        
        // Metadata - orijinal TÜRKPATENT verisi referans için
        _metadata: {
            source: 'turkpatent_scrape',
            originalData: turkpatentData,
            scrapedAt: new Date().toISOString(),
            ownerSearchQuery: ownerName
        }
    };

    return ipRecord;
}

/**
 * Anahtar kelimelerin olası çevirilerini döndürür
 */
function getPossibleTranslations(key) {
    const translations = {
        'Tescil Numarası': ['Registration Number', 'Reg Number', 'Reg No'],
        'Tescil Tarihi': ['Registration Date', 'Reg Date'],
        'Bülten Numarası': ['Bulletin Number', 'Bull No'],
        'Bülten Tarihi': ['Bulletin Date', 'Bull Date'],
        'Marka Türü': ['Trademark Type', 'Brand Type', 'Mark Type'],
        'Nice Sınıf': ['Nice Class', 'Class', 'Classification'],
        'Mal ve Hizmetler': ['Goods and Services', 'Products Services'],
        'Başvuru Tarihi': ['Application Date', 'App Date'],
        'Öncelik Tarihi': ['Priority Date'],
        'Vekil Bilgileri': ['Agent Information', 'Representative Info'],
        'Sahip': ['Owner', 'Holder', 'Proprietor']
    };
    
    return translations[key] || [];
}

/**
 * TÜRKPATENT durumunu standart durum kodlarına çevirir
 */
function mapStatus(turkpatentStatus) {
    if (!turkpatentStatus) return 'filed'; // Varsayılan
    
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
    return statusMap[normalizedStatus] || 'filed'; // Varsayılan 'filed'
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
    mapStatus,
    getPossibleTranslations
};