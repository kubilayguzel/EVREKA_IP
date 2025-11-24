// js/portfolio-detail.js
import { loadSharedLayout } from './layout-loader.js';
import { ipRecordsService, transactionTypeService, auth, db, storage } from '../firebase-config.js';
import { formatFileSize, STATUSES } from '../utils.js';
import { doc, getDoc, collection, query, where, getDocs, getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, uploadBytes, getDownloadURL, deleteObject, getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";


// URL
const params = new URLSearchParams(location.search);
const recordId = params.get('id');

// DOM
const loadingEl = document.getElementById('loading');
const rootEl = document.getElementById('detail-root');

// Fields
const applicantEl = document.getElementById('applicantName');
const applicantAddressEl = document.getElementById('applicantAddress');

// HERO
const heroCard = document.getElementById('heroCard');
const heroTitleEl = document.getElementById('heroTitle');
const brandImageEl = document.getElementById('brandImage');
const heroKv = document.getElementById('heroKv');

// Goods
const goodsContainer = document.getElementById('goodsContainer');

// Documents
const addDocToggleBtn = document.getElementById('addDocToggleBtn');
const addDocForm = document.getElementById('addDocForm');
const docNameEl = document.getElementById('docName');
const docFileEl = document.getElementById('docFile');
const docTypeEl = document.getElementById('docType');
const docTypeOtherWrap = document.getElementById('docTypeOtherWrap');
const docTypeOtherEl = document.getElementById('docTypeOther');
const docSaveBtn = document.getElementById('docSaveBtn');
const docCancelBtn = document.getElementById('docCancelBtn');
const docsTbody = document.getElementById('documentsTbody');
const docCount  = document.getElementById('docCount');

// Reflect chosen file name into disabled input next to 'Dosya Seç' button
document.getElementById('docFile')?.addEventListener('change', (e)=>{
  const f = e.target.files && e.target.files[0];
  const nameEl = document.getElementById('docFileName');
  if (nameEl) nameEl.value = f ? f.name : '';
});
// Transactions
const txAccordion = document.getElementById('txAccordion');
const txFilter = document.getElementById('txFilter');
const txCount   = document.getElementById('txCount');

let currentData = null;
let cachedTransactions = [];

// --- STİL EKLEME (35. Sınıf Alt Kırılımları İçin) ---
(function injectGoodsStyles() {
    const styleId = 'custom-goods-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = `
        .goods-sub-item {
            margin-left: 25px;          /* İçeri girinti */
            list-style-type: circle;    /* Farklı madde işareti (içi boş daire) */
            color: #495057;             /* Hafif farklı renk (opsiyonel) */
        }
        .goods-header-item {
            font-weight: 500;           /* Başlık kısmını biraz koyu yap */
            list-style-type: disc;      /* Ana başlık dolu daire */
        }
    `;
    document.head.appendChild(style);
})();

function fmtDate(d) {
  try {
    if (!d) return '-';
    let dt;
    if (typeof d === 'string') dt = new Date(d);
    else if (typeof d?.toDate === 'function') dt = d.toDate();
    else if ('seconds' in (d||{})) dt = new Date(d.seconds*1000);
    else if (d instanceof Date) dt = d;
    else return String(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString('tr-TR');
  } catch { return String(d); }
}
function getStatusText(ipType, statusValue) {
  const list = (STATUSES?.[ipType] || []);
  const m = list.find(s => s.value === statusValue);
  return m ? m.text : (statusValue ?? '-');
}
function fmtDateTime(ts){
  try{
    if(!ts) return {d:'-', t:'-'};
    let date;
    if (typeof ts === 'string') date = new Date(ts);
    else if (typeof ts?.toDate === 'function') date = ts.toDate();
    else if ('seconds' in (ts||{})) date = new Date(ts.seconds*1000);
    else if (ts instanceof Date) date = ts;
    else return {d:String(ts), t:'-'};
    if (isNaN(date.getTime())) return {d:String(ts), t:'-'};
    return {
      d: date.toLocaleDateString('tr-TR'),
      t: date.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})
    };
  }catch{ return {d:String(ts), t:'-'}; }
}

function extractNiceFromGsbc(gsbc) {
  if (!gsbc) return [];
  if (Array.isArray(gsbc)) return gsbc.map(x => String(x.classNo)).filter(Boolean);
  if (typeof gsbc === 'object') return Object.values(gsbc).map(x => String(x.classNo)).filter(Boolean);
  return [];
}

function renderHero(rec){
  const imgSrc = (rec.type === 'trademark') ? (rec.brandImageUrl || rec.details?.brandInfo?.brandImage) : null;
  const title = rec.title || rec.brandText || '—';
  if (heroTitleEl) heroTitleEl.textContent = title;

  const niceClasses = extractNiceFromGsbc(rec.goodsAndServicesByClass);
  const niceValue = niceClasses.length ? niceClasses.join(' / ') : '—';

  const kv = [
    ['Başvuru No', rec.applicationNumber],
    ['Tür', rec.type],
    ['Durum', getStatusText(rec.type, rec.status)],
    ['Başvuru Tarihi', fmtDate(rec.applicationDate)],
    ['Tescil No', rec.registrationNumber],
    ['Tescil Tarihi', fmtDate(rec.registrationDate)],
    ['Yenileme Tarihi', fmtDate(rec.renewalDate)],
    ['Nice', niceValue]
  ];

  if (heroKv){
    heroKv.innerHTML = kv.map(([label,val]) => `
      <div class="kv-item">
        <div class="label">${label}</div>
        <div class="value">${val ? String(val) : '-'}</div>
      </div>
    `).join('');
  }

  if (imgSrc && brandImageEl){
    brandImageEl.src = imgSrc;
    heroCard?.classList.remove('d-none');
  } else {
    heroCard?.classList.add('d-none');
  }
}

// Başvuru sahibi bilgileri
function extractApplicantNames(rec){
  const arr = Array.isArray(rec.applicants) ? rec.applicants : [];
  if (arr.length) return arr.map(a => a?.name).filter(Boolean).join(', ');
  return rec.ownerName || rec.applicantName || '';
}



function composeAddressTriple(address, province, countryName){
  const parts = [address, province, countryName]
    .map(p => (p == null ? '' : String(p).trim()))
    .filter(p => p.length > 0);
  if (!parts.length) return '';
  const s = parts.join(' - ').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim();
  return s;
}


// Applicant adresini persons koleksiyonundan çek
async function fetchApplicantAddress(applicantId){
  try {
    if (!applicantId) return '';
    const ref = doc(db, 'persons', applicantId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return '';
    const data = snap.data();
    const address = data.address || '';
    const province = data.province || '';
    const countryName = data.countryName || '';
    const parts = [address, province, countryName].filter(p => !!p && p.trim().length);
    return parts.join(' - ');
  } catch(e){
    console.error("Adres getirilemedi:", e);
    return '';
  }
}

function extractApplicantAddress(rec){
  const arr = Array.isArray(rec.applicants) ? rec.applicants : [];
  const a = arr[0] || {};
  const address     = a.address || a.addressLine1 || a.addr1 || rec.ownerAddress || rec.address || '';
  const province    = a.province || a.city || a.state || rec.ownerProvince || rec.province || '';
  const countryName = a.countryName || a.country || a.countryCode || rec.ownerCountryName || rec.countryName || '';
  return composeAddressTriple(address, province, countryName);
}

 // --- YARDIMCI FONKSİYON: 35. Sınıf Özelleştirilmiş Liste ---
function generateFormattedGoodsList(classNo, items) {
    // Sınıf 35 değilse standart liste döndür
    if (String(classNo) !== '35') {
        return items.map(t => `<li>${t}</li>`).join('');
    }

    let html = '';
    let isIndentedSection = false; // Girintili bölüme geçildi mi?
    const triggerPhrase = "satın alması için";
    const startPhrase = "müşterilerin malları";

    items.forEach(t => {
        const text = t || '';
        const lowerText = text.toLowerCase();

        // 1. Tetikleyici cümleyi (Başlığı) bul
        if (!isIndentedSection && lowerText.includes(startPhrase) && lowerText.includes(triggerPhrase)) {
            // Cümleyi "satın alması için" ibaresinden böl
            const regex = new RegExp(`(${triggerPhrase})`, 'i');
            const match = text.match(regex);

            if (match) {
                const splitIndex = match.index + match[1].length;
                const preText = text.substring(0, splitIndex); // Başlık kısmı
                const postText = text.substring(splitIndex);   // Aynı satırda devam eden kısım

                // Başlığı normal (veya vurgulu) ekle
                html += `<li class="goods-header-item">${preText}</li>`;

                // Eğer aynı satırda devam eden bir metin varsa (noktalama hariç), onu alt madde yap
                if (postText.replace(/[:\s\.\-]/g, '').length > 0) {
                    html += `<li class="goods-sub-item">${postText}</li>`;
                }

                isIndentedSection = true; // Bundan sonraki maddeler içeriden başlayacak
                return; // Sonraki maddeye geç
            }
        }

        // 2. Eğer girintili bölümdeysen, özel stil uygula
        if (isIndentedSection) {
            html += `<li class="goods-sub-item">${text}</li>`;
        } 
        // 3. Normal madde
        else {
            html += `<li>${text}</li>`;
        }
    });

    return html;
}

// Eşya listesi
function renderGoodsList(rec){
  if (!goodsContainer) return;

  const gsbc = rec?.goodsAndServicesByClass;
  let arr = [];

  if (Array.isArray(gsbc)) {
    arr = gsbc;
  } else if (typeof gsbc === 'object' && gsbc !== null) {
    arr = Object.values(gsbc);
  }

  if (!arr.length){
    goodsContainer.innerHTML = '<div class="text-muted">Eşya listesi yok.</div>';
    return;
  }

  goodsContainer.innerHTML = arr
    .sort((a,b)=> Number(a.classNo) - Number(b.classNo))
    .map(entry => {
      const classNo = entry.classNo || '—';
      const items = Array.isArray(entry.items) ? entry.items : [];
      return `
        <div class="goods-group">
          <div class="goods-class">Nice ${classNo}</div>
        ${items.length
            ? `<ul class="goods-items">${generateFormattedGoodsList(classNo, items)}</ul>`
            : `<div class="text-muted">Bu sınıf için tanım yok.</div>`}
        </div>
      `;
    }).join('');
}

function renderDocuments(docs){
  const arr = Array.isArray(docs) ? docs : [];
  if (docCount) docCount.textContent = String(arr.length);
  if (!docsTbody) return;
  if (!arr.length){
    docsTbody.innerHTML = '<tr><td colspan="4" class="text-muted">Henüz belge yok.</td></tr>';
    return;
  }
  const rows = arr.map((doc, i) => {
    const name = doc.name || 'Belge';
    const type = doc.documentDesignation || doc.type || 'Belge';
    const path = doc.path || '';
    const url  = doc.url || doc.content || '';
    const actionBtns = `
      ${url ? `<a class="btn btn-sm btn-outline-primary" href="${url}" target="_blank" download="${name}">İndir</a>` : ''}
      <button class="btn btn-sm btn-outline-danger btn-doc-remove" data-index="${i}">Kaldır</button>`;
    return `<tr>
      <td>${name}</td>
      <td>${type}</td>
      <td><code>${path || '-'}</code></td>
      <td class="docs-actions text-right">${actionBtns}</td>
    </tr>`;
  }).join('');
  docsTbody.innerHTML = rows;
}

// Transactions accordion
function organizeTransactions(txList){
  const parents = [];
  const childrenMap = {};
  txList.forEach(tx => {
    if (tx.transactionHierarchy === 'parent' || !tx.parentId){
      parents.push(tx);
      childrenMap[tx.id] = [];
    }
  });
  txList.forEach(tx => {
    if (tx.transactionHierarchy === 'child' && tx.parentId){
      if (childrenMap[tx.parentId]) childrenMap[tx.parentId].push(tx);
    }
  });
  // sort
  parents.sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp));
  Object.keys(childrenMap).forEach(pid => {
    childrenMap[pid].sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp));
  });
  return {parents, childrenMap};
}
// ✅ Transaction'lara ait PDF'leri getir
async function fetchPdfsForTransactions(transactionIds) {
  if (!transactionIds || transactionIds.length === 0) return {};
  
  try {
    const pdfMap = {};
    
    // unindexed_pdfs koleksiyonundan PDF'leri çek
    const pdfsQuery = query(
      collection(db, 'unindexed_pdfs'),
      where('associatedTransactionId', 'in', transactionIds),
      where('status', '==', 'indexed')
    );
    
    const pdfsSnapshot = await getDocs(pdfsQuery);
    
    pdfsSnapshot.forEach(doc => {
      const pdfData = doc.data();
      const txId = pdfData.associatedTransactionId;
      
      if (!pdfMap[txId]) {
        pdfMap[txId] = [];
      }
      
      pdfMap[txId].push({
        id: doc.id,
        fileName: pdfData.fileName || 'Belge',
        fileUrl: pdfData.fileUrl || pdfData.url,
        indexedAt: pdfData.indexedAt
      });
    });
    
    // Her transaction için PDF'leri tarihe göre sırala
    Object.keys(pdfMap).forEach(txId => {
      pdfMap[txId].sort((a, b) => {
        const dateA = a.indexedAt?.toDate?.() || new Date(a.indexedAt);
        const dateB = b.indexedAt?.toDate?.() || new Date(b.indexedAt);
        return dateB - dateA; // En yeni önce
      });
    });
    
    return pdfMap;
  } catch (error) {
    console.error('PDF\'ler getirilirken hata:', error);
    return {};
  }
}

// 🔥 YENİ EKLENEN FONKSİYON: Task'a bağlı belgeleri getiren yardımcı fonksiyon
async function fetchTaskDocuments(taskId) {
  if (!taskId) return [];
  try {
    const taskDoc = await getDoc(doc(db, 'tasks', taskId));
    if (!taskDoc.exists()) return [];
    
    const taskData = taskDoc.data();
    let docs = [];

    // 1. epatsDocument'i ekle (Zaten Storage URL'sini tutuyor)
    if (taskData.details?.epatsDocument) {
      docs.push({
        fileName: taskData.details.epatsDocument.name || 'ePats Belgesi',
        fileUrl: taskData.details.epatsDocument.downloadURL, // downloadURL
        evrakNo: taskData.details.epatsDocument.turkpatentEvrakNo,
        type: 'epats_document'
      });
    }

// 2. documents (Task'ın kendi documents array'ini ekle)
    if (Array.isArray(taskData.documents)) {
        taskData.documents.forEach(doc => {
            // 🔥 GÜNCELLEME: Veritabanındaki `downloadURL` alanını öncelikli olarak kullan.
            const fileUrl = doc.downloadURL || doc.url || doc.path; // <<< BU SATIR GÜNCELLENDİ
            
            if (fileUrl) { 
                docs.push({
                    fileName: doc.name || 'Task Belgesi',
                    fileUrl: fileUrl, 
                    type: doc.type || 'task_document',
                    isTaskDoc: true // Özel tip etiketi
                });
            } else {
                // Base64 içeriği geliyorsa, konsola uyarı basılarak task oluşturma/güncelleme mantığının düzeltilmesi gerektiği belirtiliyor.
                if (doc.content) {
                    console.warn(`⚠️ Task dokümanı Base64/Content içeriyor ancak URL/Path yok: ${doc.name}. Task oluşturma/güncelleme mantığı (dosya yükleme) düzeltilmelidir.`);
                }
            }
        });
    }
    
    return docs;
  } catch (error) {
    console.error('Task belgeleri getirilirken hata:', taskId, error);
    return [];
  }
}

// ✅ EKSİK OLAN FONKSİYON BURAYA EKLENDİ
function _createDocLinkHtml(pdf) {
    let iconClass = 'fas fa-file-pdf';
    let titleText = pdf.fileName || 'Belge';
    let btnClass = 'btn-danger';
    let badgeHtml = '';

    if (pdf.type === 'opposition_petition') {
        iconClass = 'fas fa-gavel';
        titleText = 'Karşı Taraf İtiraz Dilekçesi';
        btnClass = 'btn-warning';
    } else if (pdf.type === 'official_document') {
        iconClass = 'fas fa-file-signature';
        titleText = 'Resmi Yazı';
        btnClass = 'btn-success';
    } else if (pdf.type === 'epats_document') { // Task'tan gelen ePats
        iconClass = 'fas fa-file-invoice';
        titleText = `ePats: ${pdf.evrakNo || pdf.fileName}`;
        btnClass = 'btn-info';
        if (pdf.evrakNo) badgeHtml = `<small class="ml-1">${pdf.evrakNo}</small>`;
    } else if (pdf.type === 'task_document' || pdf.isTaskDoc) { // Task'ın documents array'inden gelen
        iconClass = 'fas fa-file-alt';
        titleText = 'Görev Belgesi: ' + pdf.fileName;
        btnClass = 'btn-primary';
    } else if (pdf.type === 'child_manual_document' || pdf.isManualDoc) { // Manuel/Child Belgesi
        iconClass = 'fas fa-file-export'; 
        titleText = 'Manuel Belge: ' + pdf.fileName;
        btnClass = 'btn-secondary';
    }
    
    // 🔥 Linkin indirmeyi tetiklemesi için 'download' niteliği ve 'onclick' ile açma yöntemi (güvenlik için)
    return `<a href="${pdf.fileUrl || pdf.path}" target="_blank" 
            title="${titleText}" class="btn btn-sm ${btnClass} mr-1 mb-1" style="cursor: pointer;">
        <i class="${iconClass}"></i>
        ${badgeHtml}
    </a>`;
}

async function renderTransactionsAccordion(recordId){
  try{
    const txRes = await ipRecordsService.getTransactionsForRecord(recordId);
    const list = (txRes?.success && Array.isArray(txRes.transactions)) ? txRes.transactions : [];
    cachedTransactions = list;
    if (txCount) txCount.textContent = String(list.length);

    const typesRes = await transactionTypeService.getTransactionTypes();
    const typeMap = new Map();
    if (typesRes?.success && Array.isArray(typesRes.data)){
      typesRes.data.forEach(t => {
        typeMap.set(String(t.id), t);
        if (t.code) typeMap.set(String(t.code), t);
      });
    }

    // ✅ PDF'leri transaction ID'sine göre grupla
    const pdfsByTransaction = await fetchPdfsForTransactions(list.map(tx => tx.id));

    const {parents, childrenMap} = organizeTransactions(list);
    if (!parents.length){
      if (txAccordion) txAccordion.innerHTML = '<div class="p-3 text-muted">Henüz işlem geçmişi yok.</div>';
      return;
    }

    // ✅ Parent transaction'lar için ePats bilgilerini topla
    const parentsWithEpats = await Promise.all(parents.map(async (p) => {
      // ✅ Parent transaction'ın triggeringTaskId'si varsa, task'tan ePats evraklarını al
      let epatsDocuments = [];
      if (p.triggeringTaskId) {
        try {
          const taskDoc = await getDoc(doc(db, 'tasks', p.triggeringTaskId));
          if (taskDoc.exists()) {
            const taskData = taskDoc.data();
            if (taskData.details?.epatsDocument) {
              epatsDocuments.push({
                fileName: taskData.details.epatsDocument.name || 'ePats Belgesi',
                fileUrl: taskData.details.epatsDocument.downloadURL,
                evrakNo: taskData.details.epatsDocument.turkpatentEvrakNo
              });
            }
          }
        } catch (err) {
          console.warn('⚠️ Task ePats bilgisi alınamadı:', p.triggeringTaskId, err);
        }
      }
      
      // 🔥 YENİ: Transaction'ın kendi documents array'ini de ekle
      const transactionDocs = p.documents || [];
      return { ...p, epatsDocuments, transactionDocs };
    }));

    // Alt işlemleri eşzamanlı olarak render etmek için Promise.all kullanıyoruz
    const parentTransactionRenderPromises = parentsWithEpats.map(async p => {
          const tmeta = typeMap.get(String(p.type));
          const tname = tmeta ? (tmeta.alias || tmeta.name) : `İşlem ${p.type}`;
          const {d,t} = fmtDateTime(p.timestamp);
          const children = childrenMap[p.id] || [];
          const hasChildren = children.length > 0;
          
          // 🔥 YENİ: İtiraz sahibi bilgisini ekle (varsa)
          const oppositionOwnerBadge = p.oppositionOwner 
            ? `<span class="badge badge-warning ml-2" style="font-size: 0.85em;">📋 ${p.oppositionOwner}</span>` 
            : '';

      // ✅ Parent transaction'a ait PDF'leri getir
      const parentPdfs = pdfsByTransaction[p.id] || [];
      // ePats evrakları zaten p.epatsDocuments içinde
      const epatsDocuments = p.epatsDocuments || [];


      const childrenHtmlContents = await Promise.all(children.map(async c => { // <<< ASENKRON MAP
            const cm = typeMap.get(String(c.type));
            const cn = cm ? (cm.alias || cm.name) : `İşlem ${c.type}`;
            const ct = fmtDateTime(c.timestamp);
            
            // ✅ Child transaction'a ait PDF'leri getir
            const childPdfs = pdfsByTransaction[c.id] || [];
            
            let allChildDocs = [...childPdfs];
            const existingFileNames = new Set(allChildDocs.map(d => d.fileName).filter(Boolean));
            
            // 🔥 GÜNCEL: İtiraza Karşı Görüş (ID: 38) veya İtiraz Bildirimi (ID: 27) ise Task belgelerini çek
            const IS_OPPOSITION_RESPONSE = String(c.type) === '38'; // İtiraza Karşı Görüş
            const IS_OPPOSITION_NOTICE = String(c.type) === '27'; // İtiraz Bildirimi
            
            if ((IS_OPPOSITION_RESPONSE || IS_OPPOSITION_NOTICE) && c.triggeringTaskId) {
                 console.log(`🔍 Child işlem (${cn}, ID:${c.type}) için task belgeleri çekiliyor:`, c.triggeringTaskId);
                 
                 const taskDocs = await fetchTaskDocuments(c.triggeringTaskId);
                 
                 // Task belgelerini, dosya adlarına göre benzersizleştirerek/kontrol ederek ekle
                 taskDocs.forEach(doc => {
                    if (doc.fileName && !existingFileNames.has(doc.fileName)) {
                        allChildDocs.push(doc);
                        existingFileNames.add(doc.fileName);
                    }
                 });
                 console.log(`✅ Task sonrası toplam belge sayısı: ${allChildDocs.length}`);
            }

            // İtiraz Bildirimi (ID: 27) ise, parent'ın belgelerini de ekle (eski mantık korunuyor)
            if (IS_OPPOSITION_NOTICE) {
                console.log('🔍 İtiraz Bildirimi tespit edildi, parent belgeleri ekleniyor...');
                
                // Parent'ın transaction.documents array'ini ekle
                const parentTransactionDocs = p.transactionDocs || [];
                
                // Parent'ın PDF'lerini ekle (unindexed_pdfs'ten gelenler)
                const parentPdfsForChild = pdfsByTransaction[p.id] || [];
                
                const parentDocsToAttach = [
                    ...parentPdfsForChild,
                    ...parentTransactionDocs.map(doc => ({
                      fileName: doc.name || 'Belge',
                      fileUrl: doc.path || doc.downloadURL, // Fix path/url
                      type: doc.type,
                      isParentDoc: true
                    }))
                ];
                
                parentDocsToAttach.forEach(doc => {
                    if (doc.fileName && !existingFileNames.has(doc.fileName)) {
                        allChildDocs.push(doc);
                        existingFileNames.add(doc.fileName);
                    }
                });
                
                console.log('✅ İtiraz Bildirimi için son toplam belge sayısı:', allChildDocs.length);
            }
            
            // Belge ikonlarını render et
            const pdfIcons = allChildDocs.map(pdf => _createDocLinkHtml(pdf)).join(' ');

            return `<div class="child-transaction-item">
              <div class="child-transaction-content">
                <div class="child-transaction-name-date">${cn} - ${ct.d} ${ct.t}</div>
              </div>
              ${pdfIcons ? `<div class="child-transaction-pdfs">${pdfIcons}</div>` : ''}
            </div>`;
          })); // <<< ASENKRON MAP SONU

      const childrenHtml = hasChildren ? `
        <div class="accordion-transaction-children" id="children-${p.id}">
          ${childrenHtmlContents.join('')}
        </div>` : '';


// 🔥 GÜNCEL: Parent'a ait tüm belgeler (PDF'ler + ePats + transaction.documents)
const transactionDocs = p.transactionDocs || [];

// 🔥 YENİ: Yayına İtiraz (ID: 20) veya Yayına İtirazın Yeniden İncelenmesi (ID: 19) ise PDF ikonlarını gizle
const isOppositionParent = String(p.type) === '20' || String(p.type) === '19';

console.log('🔍 Parent transaction kontrol:', {
  parentId: p.id,
  parentTypeId: p.type,
  parentTypeName: tname,
  isOppositionParent,
  transactionDocsCount: transactionDocs.length,
  parentPdfsCount: parentPdfs.length,
  epatsCount: epatsDocuments.length
});

let allParentDocs = [];
// Normal parent'lar için tüm belgeleri göster
// (İtiraz parentları için gizlemek istenirse buradaki if mantığı açılabilir, şu an hepsi açık)
  allParentDocs = [
    ...parentPdfs, 
    ...epatsDocuments,
    ...transactionDocs.map(doc => ({
      fileName: doc.name || 'Belge',
      fileUrl: doc.path || doc.downloadURL,
      type: doc.type,
      isTransactionDoc: true
    }))
  ];


const parentPdfIcons = allParentDocs.map(pdf => _createDocLinkHtml(pdf)).join(' ');

    return `<div class="accordion-transaction-item">
        <div class="accordion-transaction-header ${hasChildren ? 'has-children' : ''}" data-parent-id="${p.id}">
          <div class="transaction-main-info">
            <div class="${hasChildren ? 'accordion-icon' : 'accordion-icon-empty'}">${hasChildren ? '▶' : ''}</div>
            <div class="transaction-details">
              <div class="transaction-name-date">${tname} ${oppositionOwnerBadge} - ${d} ${t}</div>
            </div>
          </div>
          <div class="transaction-meta">
            ${parentPdfIcons ? `<div class="transaction-pdfs">${parentPdfIcons}</div>` : ''}
            ${hasChildren ? `<span class="child-count">${children.length} alt işlem</span>` : ''}
          </div>
        </div>
        ${childrenHtml}
      </div>`;
    }); // <<< AWAIT'LENEN PROMISE MAP'TEN ÇIKAN DİZİ

    const finalHtml = await Promise.all(parentTransactionRenderPromises).then(results => results.join(''));
    if (txAccordion) txAccordion.innerHTML = finalHtml;
    // Bind toggles
    txAccordion?.querySelectorAll('.accordion-transaction-header[data-parent-id]')
      .forEach(header => {
        header.addEventListener('click', function(){
          const pid = this.getAttribute('data-parent-id');
          const cont = document.getElementById(`children-${pid}`);
          const icon = this.querySelector('.accordion-icon');
          if (!cont) return;
          const isVisible = cont.style.display !== 'none';
          cont.style.display = isVisible ? 'none' : 'block';
          if (icon){
            icon.textContent = isVisible ? '▶' : '▼';
            icon.classList.toggle('expanded', !isVisible);
          }
        });
      });

  }catch(e){
    console.error('renderTransactionsAccordion error', e);
    if (txAccordion) txAccordion.innerHTML = '<div class="p-3 text-danger">İşlem geçmişi yüklenirken hata oluştu.</div>';
  }
}

// FILTER tx
txFilter?.addEventListener('input', () => {
  const q = (txFilter.value || '').toLowerCase();
  const items = Array.from(txAccordion.querySelectorAll('.accordion-transaction-item'));
  items.forEach(it => {
    const text = it.textContent.toLowerCase();
    it.style.display = text.includes(q) ? '' : 'none';
  });
});


// Type 'Diğer' alanını göster/gizle
docTypeEl?.addEventListener('change', () => {
  const isOther = (docTypeEl.value === 'other');
  if (docTypeOtherWrap){
    docTypeOtherWrap.classList.toggle('d-none', !isOther);
  }
});
// Documents actions
addDocToggleBtn?.addEventListener('click', () => {
  addDocForm.classList.toggle('d-none');
  if (!addDocForm.classList.contains('d-none')) docNameEl.focus();
});
docCancelBtn?.addEventListener('click', () => {
  addDocForm.classList.add('d-none');
  docNameEl.value = '';
  if (docFileEl) docFileEl.value = '';
  if (docTypeEl) docTypeEl.value = 'evidence';
  if (docTypeOtherEl) docTypeOtherEl.value = '';
});

docSaveBtn?.addEventListener('click', async () => {
  try {
    const name = (docNameEl.value || '').trim();
    const typeSel = (docTypeEl.value || 'evidence');
    const otherText = (docTypeOtherEl?.value || '').trim();
    const type = typeSel === 'other' ? (otherText || 'Diğer') : 'Kullanım Delili';
    const file = docFileEl?.files?.[0] || null;
    
    if (!name) { alert('Ad zorunludur.'); return; }
    if (!file) { alert('Bir dosya seçmelisiniz.'); return; }

    // ✅ DÜZELTME: Storage upload işlemi
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `ipRecordDocs/${recordId}/${Date.now()}_${safeName}`;
    
    // ✅ DOĞRU KULLANIM: ref fonksiyonu ile storage referansı oluştur
    const storageRef = ref(storage, path);
    
    // ✅ Dosyayı yükle
    await uploadBytes(storageRef, file);
    
    // ✅ Download URL'sini al
    const url = await getDownloadURL(storageRef);

    // Prepare new doc object
    const newDoc = {
      name,
      documentDesignation: type,
      path,
      url,
      uploadedAt: new Date().toISOString()
    };

    // Update record
    const docs = Array.isArray(currentData.documents) ? [currentData.documents] : [];
    docs.push(newDoc);
    const res = await ipRecordsService.updateRecord(recordId, { documents: docs, docPaths, updatedAt: new Date() });
    
    if (!res?.success) {
      throw new Error('Belge ekleme başarısız.');
    }
    
    currentData.documents = docs;
    renderDocuments(currentData.documents);

    // Reset form
    docNameEl.value = '';
    if (docFileEl) docFileEl.value = '';
    docTypeEl.value = 'evidence';
    if (docTypeOtherEl) docTypeOtherEl.value = '';
    addDocForm.classList.add('d-none');
    
    alert('Belge başarıyla eklendi!');
    
  } catch (err) {
    console.error('Belge eklenemedi (upload/update):', err);
    alert('Belge eklenemedi: ' + err.message);
  }
});
// Load record
async function loadRecord(){
  if (!recordId){
    if (loadingEl){ loadingEl.className='alert alert-danger'; loadingEl.textContent='Kayıt ID (id parametresi) bulunamadı.'; }
    return;
  }
  try{
    const res = await ipRecordsService.getRecordById(recordId);
    if (!res?.success || !res?.data){
      if (loadingEl){ loadingEl.className='alert alert-warning'; loadingEl.textContent='Kayıt bulunamadı.'; }
      return;
    }
    currentData = res.data;
    updateTpQueryBtnVisibility(currentData);
    // Bu kaydı butonun ulaşabileceği global alana da verelim:
    
    // --- Visibility control for "TÜRKPATENT’te Sorgula" button ---
    function _normalize(str){ return (str || '').toString().toUpperCase().replace('Ü','U').replace('İ','I'); }
    function _isTurkPatentOrigin(rec){
      const candidates = [
        rec?.origin,
        rec?.requestOrigin,
        rec?.source,
        rec?.sourceSystem,
        rec?.details?.origin,
        rec?.details?.requestOrigin
      ].map(_normalize);
      return candidates.some(v => v && (v.includes('TURKPATENT') || v.includes('TURK PATENT') || v.includes('TÜRKPATENT') || v.includes('TÜRKPATENT')));
    }
    function updateTpQueryBtnVisibility(rec){
      const btn = document.getElementById('tpQueryBtn');
      if (!btn) return;
      const show = _isTurkPatentOrigin(rec);
      btn.style.display = show ? '' : 'none';
    }
window.currentRecord = {
      applicationNumber: (currentData?.applicationNumber || '').trim(),
      ipType: currentData?.ipType || 'trademark'
    };

    // HERO
    renderHero(currentData);

    // Applicant + address
    // Applicant + address (Refactor: ID üzerinden güncel isim çekme)
    if (applicantEl) {
      applicantEl.value = 'Yükleniyor...';
      if (currentData.applicants && currentData.applicants.length > 0) {
        try {
          const names = await Promise.all(currentData.applicants.map(async (app) => {
            if (!app.id) return app.name || '';
            try {
              const snap = await getDoc(doc(db, 'persons', app.id));
              return snap.exists() ? (snap.data().name || app.name) : app.name;
            } catch { return app.name; }
          }));
          applicantEl.value = names.filter(Boolean).join(', ');
        } catch (err) {
          console.error(err);
          applicantEl.value = extractApplicantNames(currentData); // Hata olursa eski yöntem
        }
      } else {
        applicantEl.value = extractApplicantNames(currentData);
      }
    }
    if (applicantAddressEl){
    const firstApplicantId = currentData.applicants?.[0]?.id;
    if (firstApplicantId){
      fetchApplicantAddress(firstApplicantId).then(addr => {
        applicantAddressEl.value = addr || '-';
      });
    } else {
      applicantAddressEl.value = '-';
    }
  }

     // Eşya listesi
    renderGoodsList(currentData);

    // Documents
    renderDocuments(currentData.documents);

    // Transactions accordion
    await renderTransactionsAccordion(recordId);

    // UI
    if (loadingEl) loadingEl.classList.add('d-none');
    if (rootEl) rootEl.classList.remove('d-none');
  }catch(e){
    console.error('loadRecord error', e);
    if (loadingEl){ loadingEl.className='alert alert-danger'; loadingEl.textContent='Kayıt yüklenirken bir hata oluştu.'; }
  }
}

// Bootstrap
(async () => {
  await loadSharedLayout({ activeMenuLink: 'portfolio.html' });
  // Sadece olası sabit topbar yüksekliği kadar it (36..120px aralığı)
  const wrapper = document.querySelector('.page-wrapper');
  const candidates = ['.navbar.fixed-top','.app-header','.site-header','header .navbar','nav.navbar.fixed-top'];
  let h = 0;
  for (const sel of candidates){
    const el = document.querySelector(sel);
    if (el){
      const hh = el.getBoundingClientRect().height;
      if (hh > 36 && hh < 120){ h = hh; break; }
    }
  }
  if (wrapper) wrapper.style.paddingTop = (h ? (h+12) : 16) + 'px';

  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    await loadRecord();
  });
})();

// Initialize type other visibility
if (docTypeEl) docTypeEl.dispatchEvent(new Event('change'));


// Delegated handler for removing a document with cascade (ipRecords + Storage)
docsTbody?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('.btn-doc-remove');
  if (!btn) return;
  const row = btn.closest('tr');
  const idxAttr = btn.getAttribute('data-index');
  const idx = Number(idxAttr);
  if (Number.isNaN(idx)) return;

  const doc = Array.isArray(currentData?.documents) ? currentData.documents[idx] : null;
  if (!doc) return;

  if (!confirm('Bu belgeyi kaldırmak istiyor musunuz? Bu işlem storage ve diğer kayıtlardan da silecektir.')) return;

  try {
    // Remove from current record
    const docs = currentData.documents.filter((_,i) => i !== idx);
    const docPaths = Array.from(new Set(docs.map(d => d?.path).filter(Boolean)));
    await ipRecordsService.updateRecord(recordId, { documents: docs, docPaths, updatedAt: new Date() });
    currentData.documents = docs;
    renderDocuments(currentData.documents);

    const path = doc.path || '';
    if (path){
      // Remove from other ipRecords referencing the same path
      try {
        const q = query(collection(db, 'ipRecords'), where('docPaths', 'array-contains', path));
        const snaps = await getDocs(q);
        for (const s of snaps.docs){
          const rid = s.id;
          if (rid === recordId) continue;
          const rdata = s.data() || {};
          const rdocs = Array.isArray(rdata.documents) ? rdata.documents.filter(d => d?.path !== path) : [];
          const rdocPaths = Array.from(new Set(rdocs.map(d=>d?.path).filter(Boolean)));
          try{
            await ipRecordsService.updateRecord(rid, { documents: rdocs, docPaths: rdocPaths, updatedAt: new Date() });
          }catch(e){ console.warn('Diğer kayıttan kaldırma uyarısı', rid, e); }
        }
      } catch (e) {
        console.warn('Diğer kayıtlarda arama/silme uyarısı:', e?.message || e);
      }

      // Delete from storage (ignore if not found)
      try {
        const sref = ref((typeof storage !== 'undefined' && storage) ? storage : getStorage(), path);
        await deleteObject(sref);
      } catch (e) {
        console.warn('Storage silme uyarısı:', e?.message || e);
      }
    }
  } catch (err) {
    console.error('Belge kaldırma hatası:', err);
    alert('Belge kaldırılamadı.');
  }
});

// YALNIZCA tp-sorgu-eklentisi'ni hedefleyen, güvenli tek-sekme akışı
window.triggerTpQuery = function(applicationNo){
  const appNo = (applicationNo || '').toString().trim();
  if (!appNo){
    alert('Başvuru numarası bulunamadı.');
    return;
  }

  // Eklenti çalışmazsa kullanılacak yedek URL (tek sekme)
  const fallbackUrl =
   `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(appNo)}`;
  // SADECE v1 eklenti ID'si (tp-sorgu-eklentisi)
  const EXT_ID_TP_V1 = 'gkhmldkbjmnipikgjabmlilibllikapk';

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && EXT_ID_TP_V1) {
      chrome.runtime.sendMessage(
        EXT_ID_TP_V1,
        { type: 'SORGULA', data: appNo },
        (response) => {
          const hasErr = !!(chrome.runtime && chrome.runtime.lastError);
          const ok = response && (response.status === 'OK' || response.status === 'OK_WAIT');

          // Eklenti yok/cevap vermedi -> tek sekmelik yedek
          if (hasErr || !ok) {
            const win = window.open(fallbackUrl, '_blank');
            if (!win) alert('Pop-up engellendi. Lütfen bu site için pop-up izni verin.');
          }
          // Eklenti başarıyla sekmeyi kendi açacak; burada ekstra pencere açmıyoruz.
        }
      );
      return; // Mesaj denendi; burada bitiriyoruz.
    }
  } catch (e) {
    // Mesaj atılamadıysa yedeğe düş
  }

  // Eklenti ortamı yoksa (Safari/Firefox vs.) ya da bir şey ters gittiyse tek sekme aç
  const win = window.open(fallbackUrl, '_blank');
  if (!win) alert('Pop-up engellendi. Lütfen bu site için pop-up izni verin.');
};


// ===================================================================
// YENİ EKLENEN KOD: TÜRKPATENT SORGULAMA BUTONU İÇİN EKLENTİ İLETİŞİMİ
// ===================================================================

// Butonu DOM'dan seç
const tpQueryBtn = document.getElementById('tpQueryBtn');

// Buton varsa ve tıklandığında çalışacak fonksiyonu tanımla
if (tpQueryBtn) {
  tpQueryBtn.addEventListener('click', () => {
    const applicationNo = (window.currentRecord?.applicationNumber || '').trim();
    if (!applicationNo) {
      alert('Başvuru numarası bulunamadı.');
      return;
    }
    if (window.triggerTpQuery) {
      window.triggerTpQuery(applicationNo);
    } else {
      alert('Sorgu fonksiyonu yüklenemedi.');
    }
  });
}