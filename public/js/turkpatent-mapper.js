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
 * TÜRKPATENT durumunu utils status değerleriyle mapping yapar
 * - "MARKA BAŞVURUSU/TESCİLİ GEÇERSİZ" -> rejected
 * - İçerikte "geçersiz", "ret", "redded" vb. -> rejected
 * - İçerikte "tescil" ve "iptal", "hükümsüz" yoksa -> registered
 * - İçerikte "başvuru" ve net sonuç yoksa -> pending
 * - Aksi durumda null (boş bırak)
 */
export function mapStatusToUtils(turkpatentStatus) {
  if (!turkpatentStatus) return null;
  const s = normalizeText(turkpatentStatus);

  if (s.includes('geçersiz') || s.includes('redd') || /\bret\b/.test(s)) {
    return 'rejected';
  }
  // "MARKA BAŞVURUSU/TESCİLİ GEÇERSİZ" özelini zaten yukarıdaki kapsıyor.
  if (s.includes('tescil') && !s.includes('iptal') && !s.includes('hükümsüz') && !s.includes('geçersiz')) {
    return 'registered';
  }
  if (s.includes('başvuru') || s.includes('başvurusu')) {
    return 'pending';
  }
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
  if (Array.isArray(inputGSC) && inputGSC.length) {
    return inputGSC.map(x => ({
      classNo: Number(x.classNo),
      items: Array.isArray(x.items) ? x.items : []
    }));
  }

  const niceNums =
    parseNiceClasses(niceClassesStr) ||
    parseNiceClasses(details?.['Nice Sınıfları']);

  // Detay metinlerinde olabilecek anahtarlar
  const goodsText =
    details?.['Mal/Hizmet Listesi'] ||
    details?.['Mal ve Hizmetler'] ||
    details?.['Mal ve Hizmetler Listesi'] ||
    details?.['Eşya Listesi'] ||
    '';

  if (!Array.isArray(niceNums) || niceNums.length === 0) return [];
  if (!goodsText) {
    // Sadece sınıfları ver, items boş kalabilir
    return niceNums.map(classNo => ({ classNo, items: [] }));
  }

  const rawItems = goodsText
    .split(/[\n,;]+/)
    .map(t => t.trim())
    .filter(Boolean);

  return niceNums.map(classNo => ({
    classNo,
    items: rawItems
  }));
}

/**
 * oldTransactions üretimi
 */
function createOldTransactions(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) return [];
  return transactions.map(tx => ({
    date: formatDate(tx?.date),
    description: tx?.description || null,
    note: tx?.note || null,
    source: 'turkpatent_scrape',
    createdAt: new Date().toISOString()
  }));
}

/**
 * TÜRKPATENT'ten gelen sahip numarası sorgu verilerini IPRecord formatına dönüştürür
 * @param {Object} turkpatentData - TÜRKPATENT'ten gelen ham veri
 * @param {Array} selectedApplicants - Arayüzden seçilen sahip bilgileri
 * @returns {Object} IPRecord formatında veri
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
    goodsAndServicesByClass, // Modal
    transactions // Modal
  } = turkpatentData || {};

  const brandImageUrl = await uploadBrandImage(applicationNumber, brandImageDataUrl, imageSrc);

  const ipRecord = {
    // Temel kimlik
    title: brandName || 'Başlıksız Marka',
    type: 'trademark',
    portfoyStatus: 'active',

    // Durum
    status: mapStatusToUtils(status),
    recordOwnerType: 'self',

    // Başvuru/Tescil
    applicationNumber: applicationNumber || null,
    applicationDate: formatDate(applicationDate),
    registrationNumber: registrationNumber || details?.['Tescil Numarası'] || null,
    registrationDate: formatDate(details?.['Tescil Tarihi']),
    renewalDate: formatDate(details?.['Yenileme Tarihi']),

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
    bulletins: createBulletins(details, transactions),

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
      ? selectedApplicants.map(a => ({ id: a.id, name: a.name, email: a.email || null }))
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

  // İSTEK: agentInfo alanını artık basmayalım
  // (bilerek eklenmedi)

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
