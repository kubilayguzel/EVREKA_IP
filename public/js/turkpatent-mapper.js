// Firebase imports for image upload
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { app } from '../firebase-config.js';

// Initialize Firebase Storage
const storage = getStorage(app);

/**
 * Normalize helpers
 */
function normalizeText(v) {
  return (v || '')
    .toString()
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseDDMMYYYYToISO(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // already ISO
  const m = (s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const y = m[3];
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function formatDate(dateStr) {
  return parseDDMMYYYYToISO(dateStr);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

/**
 * Transactions'tan durum türetme: öncelik sırası -> rejected > registered > pending > null
 */
function deriveStatusFromTransactions(transactions) {
  if (!Array.isArray(transactions)) return null;
  const txt = transactions.map(t => (t?.description || '') + ' ' + (t?.note || '')).join(' ').toLowerCase();
  if (!txt) return null;
  if (/(geçersiz|başvuru\/tescil\s*geçersiz|iptal|hükümsüz|red|redded)/i.test(txt)) return 'rejected';
  if (/tescil edildi|tescil\b/i.test(txt) && !/(iptal|hükümsüz|geçersiz)/i.test(txt)) return 'registered';
  if (/başvuru|yayın/i.test(txt)) return 'pending';
  return null;
}

/**
 * TÜRKPATENT durumunu utils status değerleriyle mapping yapar
 * - "MARKA BAŞVURUSU/TESCİLİ GEÇERSİZ" -> rejected
 * - İçerikte "geçersiz", "ret", "redded" vb. -> rejected
 * - İçerikte "tescil" ve "iptal", "hükümsüz" yoksa -> registered
 * - İçerikte "başvuru" ve net sonuç yoksa -> pending
 * - Aksi durumda null (boş bırak)
 */

export function mapStatusToUtils(turkpatentStatus) {
  console.log('🔍 mapStatusToUtils çağrıldı:', turkpatentStatus);
  
  if (!turkpatentStatus) {
    console.log('❌ turkpatentStatus boş');
    return null;
  }

  const s = turkpatentStatus.toString().trim();
  console.log('🔍 İşlenecek string:', s);

  // Sadece geçersiz durumu kontrol et
  if (/GEÇERSİZ/i.test(s)) {
    console.log('✅ REJECTED dönülüyor (geçersiz bulundu)');
    return 'rejected';
  }
  
  console.log('❌ Geçersiz bulunamadı, null dönülüyor');
  return null;
}

/**
 * Görseli Firebase Storage'a yükler, URL döner
 */
async function uploadBrandImage(applicationNumber, brandImageDataUrl, imageSrc) {
  const imageUrl = brandImageDataUrl || imageSrc;
  if (!imageUrl || !applicationNumber) return null;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;

    const blob = await response.blob();
    const ext = (blob.type && blob.type.split('/')[1]) || 'jpg';
    const fileName = `${applicationNumber}_${Date.now()}.${ext}`;

    const storageRef = ref(storage, `brand-examples/${fileName}`);
    const snapshot = await uploadBytes(storageRef, blob);
    const downloadURL = await getDownloadURL(snapshot.ref);
    return downloadURL;
  } catch (error) {
    console.error('Görsel upload hatası:', error);
    return null;
  }
}

/**
 * Nice sınıflarını string'ten parse eder
 */
function parseNiceClasses(niceClassesStr) {
  if (!niceClassesStr) return [];
  const nums = niceClassesStr
    .toString()
    .split(/[,;\s]+/)
    .map(n => parseInt(String(n).trim(), 10))
    .filter(n => !Number.isNaN(n) && n > 0 && n <= 45);
  return uniq(nums);
}

/**
 * Bulletins üretimi — hem detail alanlarından hem de transaction açıklamalarından çıkarım
 */
function createBulletins(details, transactions) {
  const out = [];

  const get = (k) => details?.[k] ?? null;
  const bNo =
    get('Bülten Numarası') || get('Bülten No') || get('Bülten') ||
    get('Bulletin Number') || get('Bulletin No') || null;
  const bDate =
    get('Bülten Tarihi') || get('Yayım Tarihi') ||
    get('Bulletin Date') || null;

  if (bNo || bDate) {
    out.push({
      bulletinNo: bNo || null,
      bulletinDate: formatDate(bDate)
    });
  }

  // Transactions içinden de yakalamayı dene (ör. "Bülten No: 2024/34")
  if (Array.isArray(transactions)) {
    for (const tx of transactions) {
      const d = normalizeText(tx?.description);
      const m = (tx?.description || '').match(/bülten\s*(?:no|numarası)?\s*[:\-]?\s*([0-9/]+)/i);
      if (m) {
        out.push({
          bulletinNo: m[1],
          bulletinDate: formatDate(tx?.date) || null
        });
      }
    }
  }

  // Aynı numaraları tekille
  const byKey = new Map();
  for (const b of out) {
    const key = `${b.bulletinNo || ''}#${b.bulletinDate || ''}`;
    byKey.set(key, b);
  }
  return Array.from(byKey.values());
}

/**
 * goodsAndServicesByClass üretimi
 * - Modal'dan gelen liste varsa önceliklidir
 * - Yoksa details içindeki metinlerden fallback
 */

function createGoodsAndServicesByClass(inputGSC, niceClassesStr, details) {
  console.log('🔍 createGoodsAndServicesByClass çağrıldı:', { 
    inputGSC, 
    niceClassesStr, 
    details,
    inputGSCLength: Array.isArray(inputGSC) ? inputGSC.length : 'not array'
  });

  // Önce modal'dan gelen goodsAndServicesByClass'ı kontrol et
  if (Array.isArray(inputGSC) && inputGSC.length > 0) {
    console.log('✅ Modal\'dan gelen goodsAndServicesByClass kullanılıyor');
    
    // Modal'dan gelen veriyi sınıflara göre grupla
    const groupedByClass = new Map();
    
    inputGSC.forEach(entry => {
      const classNo = Number(entry.classNo);
      const items = Array.isArray(entry.items) ? entry.items : [];
      
      if (!groupedByClass.has(classNo)) {
        groupedByClass.set(classNo, []);
      }
      
      // [GÜNCELLEME] Gelen maddeleri nokta (.) veya yeni satıra göre parçala
      // Nokta işaretini ayırıcı olarak kullanır ve boşlukları temizler.
      const splitItems = items.flatMap(item => item.split(/[\n.]/).map(s => s.trim()).filter(Boolean));
      
      // Bu sınıfa ait items'ları ekle
      groupedByClass.get(classNo).push(...splitItems);
    });
    
    // Map'i array'e çevir ve sırala
    const result = Array.from(groupedByClass.entries())
      .map(([classNo, items]) => ({
        classNo,
        items: [...new Set(items)] // Tekrar eden items'ları temizle
      }))
      .sort((a, b) => a.classNo - b.classNo);
    
    console.log('✅ Gruplandırılmış goodsAndServicesByClass:', result);
    return result;
  }

  console.log('⚠️ Modal\'dan veri yok, alternatif kaynaklardan deneniyor...');

  const niceNums =
    parseNiceClasses(niceClassesStr) ||
    parseNiceClasses(details?.['Nice Sınıfları']);

  console.log('🔍 Nice sınıfları:', niceNums);

  // Detay metinlerinde olabilecek anahtarlar
  const goodsText =
    details?.['Mal/Hizmet Listesi'] ||
    details?.['Mal ve Hizmetler'] ||
    details?.['Mal ve Hizmetler Listesi'] ||
    details?.['Eşya Listesi'] ||
    '';

  console.log('🔍 Eşya metni:', goodsText);

  if (!Array.isArray(niceNums) || niceNums.length === 0) {
    console.log('❌ Nice sınıfları bulunamadı, boş array dönülüyor');
    return [];
  }
  
  if (!goodsText) {
    console.log('⚠️ Eşya metni yok, sadece sınıf numaraları ile boş items dönülüyor');
    return niceNums.map(classNo => ({ classNo, items: [] }));
  }

  // Eğer details'tan geliyorsa, sınıf bilgisi olmadan tüm sınıflara aynı items'ı vermek yerine
  // sadece boş items ile döndür (çünkü hangi eşyanın hangi sınıfa ait olduğunu bilemiyoruz)
  console.log('⚠️ Details\'tan gelen genel eşya metni, sınıf bazlı ayrıştırma yapılamıyor');
  
  return niceNums.map(classNo => ({
    classNo,
    items: [] // Modal'dan gelmeyen verilerde sınıf-eşya eşleştirmesi yapamıyoruz
  }));
}

/**
 * oldTransactions üretimi
 */

function createOldTransactions(transactions) {
  console.log('🔍 createOldTransactions çağrıldı:', { 
    transactions, 
    isArray: Array.isArray(transactions),
    length: Array.isArray(transactions) ? transactions.length : 'not array'
  });

  if (!Array.isArray(transactions) || transactions.length === 0) {
    console.log('❌ Transactions boş veya array değil, boş array dönülüyor');
    return [];
  }

  const result = transactions.map(tx => {
    const formattedTx = {
      date: formatDate(tx?.date),
      description: tx?.description || null,
      note: tx?.note || null,
      source: 'turkpatent_scrape',
      createdAt: new Date().toISOString()
    };
    console.log('✅ Transaction formatlandı:', formattedTx);
    return formattedTx;
  });

  console.log('✅ Final oldTransactions:', result);
  return result;
}

/**
 * TÜRKPATENT'ten gelen sahip numarası sorgu verilerini IPRecord formatına dönüştürür
 * @param {Object} turkpatentData - TÜRKPATENT'ten gelen ham veri
 * @param {Array} selectedApplicants - Arayüzden seçilen sahip bilgileri
 * @returns {Object} IPRecord formatında veri
 */
/**
 * TÜRKPATENT'ten gelen sahip numarası sorgu verilerini IPRecord formatına dönüştürür
 */
export async function mapTurkpatentToIPRecord(turkpatentData, selectedApplicants = []) {
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
    goodsAndServicesByClass,
    transactions
  } = turkpatentData || {};

  const brandImageUrl = await uploadBrandImage(applicationNumber, brandImageDataUrl, imageSrc);

  // ---------------------------------------------------------
  // ADIM 1: TESCİL TARİHİNİ BUL
  // ---------------------------------------------------------
  let registrationDate = null;
  // Önce details'tan dene
  if (details?.['Tescil Tarihi']) {
    registrationDate = formatDate(details['Tescil Tarihi']);
  }
  // Details'ta yoksa transactions'tan "TESCİL EDİLDİ" işleminin tarihini al
  if (!registrationDate && Array.isArray(transactions)) {
    const registrationTx = transactions.find(tx => 
      tx?.description && tx.description.toUpperCase().includes('TESCİL EDİLDİ')
    );
    if (registrationTx?.date) {
      registrationDate = formatDate(registrationTx.date);
    }
  }

  // ---------------------------------------------------------
  // ADIM 2: YENİLEME TARİHİNİ HESAPLA (Statüden ÖNCE yapılmalı)
  // ---------------------------------------------------------
  let calculatedRenewalDate = null;
  
  // (A) Doğrudan veri varsa
  try {
    const topLevelRenewal = turkpatentData?.renewalDate || details?.['Yenileme Tarihi'] || details?.['Renewal Date'];
    if (topLevelRenewal) {
      const d = new Date(formatDate(topLevelRenewal) || topLevelRenewal);
      if (!isNaN(d.getTime())) calculatedRenewalDate = d.toISOString().split('T')[0];
    }
  } catch (e) { console.warn('renewalDate parse error:', e); }

  // (B) Yoksa Koruma Tarihi + 10 Yıl
  if (!calculatedRenewalDate && details?.['Koruma Tarihi']) {
    const kd = formatDate(details['Koruma Tarihi']);
    if (kd) {
      const d = new Date(kd);
      if (!isNaN(d.getTime())) {
        d.setFullYear(d.getFullYear() + 10);
        calculatedRenewalDate = d.toISOString().split('T')[0];
      }
    }
  }

// (C) Yoksa Tescil Tarihi + 10 Yıl
  if (!calculatedRenewalDate && registrationDate) {
    const d = new Date(registrationDate);
    if (!isNaN(d.getTime())) {
      d.setFullYear(d.getFullYear() + 10);
      calculatedRenewalDate = d.toISOString().split('T')[0];
    }
  }

  // (D) Yoksa Başvuru Tarihi + 10 Yıl
  if (!calculatedRenewalDate && applicationDate) {
    const ad = new Date(formatDate(applicationDate) || applicationDate);
    if (!isNaN(ad.getTime())) {
      ad.setFullYear(ad.getFullYear() + 10);
      
      // HATA BURADAYDI: 'd' yerine 'ad' kullanılmalı
      calculatedRenewalDate = ad.toISOString().split('T')[0]; 
    }
  }

  // ---------------------------------------------------------
  // ADIM 3: STATÜ BELİRLEME (YENİ MANTIK)
  // ---------------------------------------------------------
  let turkpatentStatusText = details?.['Durumu'] || details?.['Status'] || details?.['Durum'] || status;

  // Eğer metin yoksa son işlemden tahmin et
  if (!turkpatentStatusText && Array.isArray(transactions)) {
    const lastTransaction = transactions[transactions.length - 1];
    if (lastTransaction?.description) {
      const desc = lastTransaction.description.toUpperCase();
      if (desc.includes('BAŞVURU/TESCİL GEÇERSİZ') || desc.includes('GEÇERSİZ')) {
        turkpatentStatusText = 'MARKA BAŞVURUSU/TESCİLİ GEÇERSİZ';
      }
    }
  }

  // A) Önce GEÇERSİZ (rejected) kontrolü
  let finalStatus = mapStatusToUtils(turkpatentStatusText); // Bu fonksiyon "Geçersiz" veya "rejected" döner

  // B) Eğer geçersiz değilse TESCİLLİ (registered) kontrolü
  if (!finalStatus && registrationDate && calculatedRenewalDate) {
    const renewalDateObj = new Date(calculatedRenewalDate);
    
    // Yenileme tarihine 6 ay ekle (Koruma süresi sonu + 6 ay ek süre)
    const gracePeriodEnd = new Date(renewalDateObj);
    gracePeriodEnd.setMonth(gracePeriodEnd.getMonth() + 6); 
    
    const today = new Date();
    
    // Bugün tarihi, ek sürenin bitiminden önceyse "Tescilli"dir
    if (today < gracePeriodEnd) {
      finalStatus = 'registered'; 
    }
  }

  // C) Hiçbiri değilse BAŞVURU (filed)
  if (!finalStatus) {
    finalStatus = 'filed';
  }

  console.log(`[STATUS LOGIC] App: ${applicationNumber}, Final Status: ${finalStatus}`);

  // ---------------------------------------------------------
  // ADIM 4: KAYIT OBJESİNİ OLUŞTUR
  // ---------------------------------------------------------
  
  // Bültenler
  const bulletins = [];
  if (details?.['Marka İlan Bülten No'] || details?.['Marka İlan Bülten Tarihi']) {
    bulletins.push({
      bulletinNo: details['Marka İlan Bülten No'] || null,
      bulletinDate: formatDate(details['Marka İlan Bülten Tarihi']) || null
    });
  }

  const ipRecord = {
    // Temel kimlik
    title: brandName || 'Başlıksız Marka',
    type: 'trademark',
    portfoyStatus: 'active',
    origin: 'TÜRKPATENT',

    // Durum (Yeni hesaplanan statü)
    status: finalStatus,
    recordOwnerType: 'self',

    // Başvuru/Tescil
    applicationNumber: applicationNumber || null,
    applicationDate: formatDate(applicationDate),
    registrationNumber: registrationNumber || details?.['Tescil Numarası'] || null,
    registrationDate: registrationDate,
    
    // Yenileme Tarihi (Yukarıda hesapladığımız değer)
    renewalDate: calculatedRenewalDate,

    // Marka bilgileri
    brandText: brandName || '',
    brandImageUrl: brandImageUrl,
    description: details?.['Açıklama'] || null,
    brandType: details?.['Marka Türü'] || 'Şekil + Kelime',
    brandCategory: details?.['Marka Kategorisi'] || 'Ticaret/Hizmet Markası',
    nonLatinAlphabet: details?.['Latin Olmayan Alfabe'] || null,

    // Sınıflar ve MH listesi
    goodsAndServicesByClass: createGoodsAndServicesByClass(
      goodsAndServicesByClass,
      niceClasses,
      details
    ),

    // Bültenler
    bulletins: bulletins,

    // Rüçhan (varsa)
    priorities: (() => {
      const p = [];
      const pd = details?.['Öncelik Tarihi'];
      const pn = details?.['Öncelik Numarası'];
      const pc = details?.['Öncelik Ülkesi'];
      if (pd || pn) {
        p.push({
          priorityDate: formatDate(pd),
          priorityNumber: pn || null,
          priorityCountry: pc || null
        });
      }
      return p;
    })(),

    // Başvuru sahipleri
    applicants: Array.isArray(selectedApplicants)
      ? selectedApplicants.map(a => ({ id: a.id, email: a.email || null }))
      : [],

    // İşlem geçmişi
    oldTransactions: createOldTransactions(transactions),

    // Diğer
    consentRequest: null,
    coverLetterRequest: null,

    // Zaman damgaları
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return ipRecord;
}

/**
 * Liste mapper
 */
export async function mapTurkpatentResultsToIPRecords(turkpatentResults, selectedApplicants) {
  if (!Array.isArray(turkpatentResults)) {
    console.error('turkpatentResults array olmalı');
    return [];
  }
  const out = [];
  for (let i = 0; i < turkpatentResults.length; i++) {
    const row = turkpatentResults[i];
    try {
      const rec = await mapTurkpatentToIPRecord(row, selectedApplicants);
      rec.tempId = `turkpatent_${Date.now()}_${i}`;
      out.push(rec);
    } catch (e) {
      console.error(`Kayıt ${i} mapping hatası:`, e);
    }
  }
  return out;
}
