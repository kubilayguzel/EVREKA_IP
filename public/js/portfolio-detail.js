// js/portfolio-detail.js
import { loadSharedLayout } from './layout-loader.js';
import { ipRecordsService, transactionTypeService, auth, db, storage, waitForAuthUser, redirectOnLogout } from '../firebase-config.js';
import { formatFileSize, STATUSES } from '../utils.js';
import { doc, getDoc, collection, query, where, getDocs, getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, uploadBytes, getDownloadURL, deleteObject, getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// URL Params
const params = new URLSearchParams(location.search);
const recordId = params.get('id');

// DOM Elements
const loadingEl = document.getElementById('loading');
const rootEl = document.getElementById('detail-root');
const applicantEl = document.getElementById('applicantName');
const applicantAddressEl = document.getElementById('applicantAddress');
const heroCard = document.getElementById('heroCard');
const heroTitleEl = document.getElementById('heroTitle');
const brandImageEl = document.getElementById('brandImage');
const heroKv = document.getElementById('heroKv');
const goodsContainer = document.getElementById('goodsContainer');
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
const txAccordion = document.getElementById('txAccordion');
const txFilter = document.getElementById('txFilter');
const txCount   = document.getElementById('txCount');

let currentData = null;
let cachedTransactions = [];

// Dosya seçimi input listener
document.getElementById('docFile')?.addEventListener('change', (e)=>{
  const f = e.target.files && e.target.files[0];
  const nameEl = document.getElementById('docFileName');
  if (nameEl) nameEl.value = f ? f.name : '';
});

// --- STİL EKLEME ---
(function injectGoodsStyles() {
    const styleId = 'custom-goods-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = `
        .goods-sub-item { margin-left: 25px; list-style-type: circle; color: #495057; }
        .goods-header-item { font-weight: 500; list-style-type: disc; }
        .doc-link-item {
            display: inline-flex; align-items: center; justify-content: center;
            text-decoration: none !important; margin-right: 8px; margin-bottom: 4px;
            padding: 6px; border-radius: 6px; background-color: #f8f9fa;
            transition: all 0.2s ease; border: 1px solid transparent;
            width: 32px; height: 32px; cursor: pointer;
        }
        .doc-link-item:hover { transform: translateY(-1px); box-shadow: 0 2px 5px rgba(0,0,0,0.1); background-color: #fff; }
        .doc-link-item i { font-size: 1.2em; }
        .doc-color-blue i { color: #0d6efd; }
        .doc-color-orange i { color: #fd7e14; }
        .doc-link-item:hover.doc-color-blue { border-color: #0d6efd; }
        .doc-link-item:hover.doc-color-orange { border-color: #fd7e14; }
    `;
    document.head.appendChild(style);
})();

// --- Yardımcı Fonksiyonlar ---
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

// --- Render Fonksiyonları ---
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

function extractApplicantNames(rec){
  const arr = Array.isArray(rec.applicants) ? rec.applicants : [];
  if (arr.length) return arr.map(a => a?.name).filter(Boolean).join(', ');
  return rec.ownerName || rec.applicantName || '';
}

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

function generateFormattedGoodsList(classNo, items) {
    if (String(classNo) !== '35') {
        return items.map(t => `<li>${t}</li>`).join('');
    }
    let html = '';
    let isIndentedSection = false;
    const triggerPhrase = "satın alması için";
    const startPhrase = "müşterilerin malları";

    items.forEach(t => {
        const text = t || '';
        const lowerText = text.toLowerCase();
        if (!isIndentedSection && lowerText.includes(startPhrase) && lowerText.includes(triggerPhrase)) {
            const regex = new RegExp(`(${triggerPhrase})`, 'i');
            const match = text.match(regex);
            if (match) {
                const splitIndex = match.index + match[1].length;
                const preText = text.substring(0, splitIndex);
                const postText = text.substring(splitIndex);
                html += `<li class="goods-header-item">${preText}</li>`;
                if (postText.replace(/[:\s\.\-]/g, '').length > 0) {
                    html += `<li class="goods-sub-item">${postText}</li>`;
                }
                isIndentedSection = true;
                return;
            }
        }
        if (isIndentedSection) {
            html += `<li class="goods-sub-item">${text}</li>`;
        } else {
            html += `<li>${text}</li>`;
        }
    });
    return html;
}

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

// Transaction Helpers
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
  parents.sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp));
  Object.keys(childrenMap).forEach(pid => {
    childrenMap[pid].sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp));
  });
  return {parents, childrenMap};
}

// Task Dokümanları Helper
async function fetchTaskDocuments(taskId) {
  if (!taskId) return [];
  try {
    const taskDoc = await getDoc(doc(db, 'tasks', taskId));
    if (!taskDoc.exists()) return [];
    const taskData = taskDoc.data();
    let docs = [];
    
    // 1. ePats Belgesi
    if (taskData.details?.epatsDocument) {
      docs.push({
        fileName: taskData.details.epatsDocument.name || 'ePats Belgesi',
        fileUrl: taskData.details.epatsDocument.downloadURL,
        evrakNo: taskData.details.epatsDocument.turkpatentEvrakNo,
        type: 'epats_document'
      });
    }

    // 2. Task'ın "documents" dizisi
    if (Array.isArray(taskData.documents)) {
        taskData.documents.forEach(doc => {
            const fileUrl = doc.downloadURL || doc.url || doc.path;
            if (fileUrl) { 
                docs.push({
                    fileName: doc.name || 'Task Belgesi',
                    fileUrl: fileUrl, 
                    type: doc.type || 'task_document'
                });
            }
        });
    }
    return docs;
  } catch (error) {
    console.error('Task belgeleri getirilirken hata:', taskId, error);
    return [];
  }
}

// --- ANA DÜZENLEME: Transaction > Task Fallback Mantığı ---
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

    // unindexed_pdfs çağrısı KALDIRILDI.

    const {parents, childrenMap} = organizeTransactions(list);

    if (!parents.length){
      if (txAccordion) txAccordion.innerHTML = '<div class="p-3 text-muted">Henüz işlem geçmişi yok.</div>';
      return;
    }

    // RENDER PARENTS
    const parentTransactionRenderPromises = parents.map(async p => {
          const tmeta = typeMap.get(String(p.type));
          const tname = tmeta ? (tmeta.alias || tmeta.name) : `İşlem ${p.type}`;
          const {d,t} = fmtDateTime(p.timestamp);
          const children = childrenMap[p.id] || [];
          const hasChildren = children.length > 0;
          
          const oppositionOwnerBadge = p.oppositionOwner 
            ? `<span class="badge badge-warning ml-2" style="font-size: 0.85em;">📋 ${p.oppositionOwner}</span>` 
            : '';

      // --- CHILD RENDER ---
      const childrenHtmlContents = await Promise.all(children.map(async c => {
            const cm = typeMap.get(String(c.type));
            const cn = cm ? (cm.alias || cm.name) : `İşlem ${c.type}`;
            const ct = fmtDateTime(c.timestamp);
            
            // 1. Transaction Belgelerini Topla
            const txDocs = [];
            const seenUrls = new Set();
            
            const addDoc = (d) => {
                const url = d.fileUrl || d.url || d.path || d.downloadURL;
                const name = d.fileName || d.name || 'Belge';
                if(url && !seenUrls.has(url)){
                    seenUrls.add(url);
                    txDocs.push({ fileName: name, fileUrl: url, type: d.type || 'child_doc' });
                }
            };

            if (Array.isArray(c.documents)) {
                c.documents.forEach(addDoc);
            }

            // 2. FALLBACK: Eğer Transaction belgesi YOKSA ve Task varsa, Task'tan çek.
            if (txDocs.length === 0 && c.triggeringTaskId) {
                 try {
                     const taskDocs = await fetchTaskDocuments(c.triggeringTaskId);
                     taskDocs.forEach(addDoc);
                 } catch (e) { console.error('Child task docs error:', e); }
            }

            // İKONLAR (Mavi/Turuncu)
            const pdfIcons = txDocs.map((pdf, idx) => {
                const colorClass = (idx === 0) ? 'doc-color-blue' : 'doc-color-orange';
                return `<a onclick="window.open('${pdf.fileUrl}', '_blank')" 
                           title="${pdf.fileName}" 
                           class="doc-link-item ${colorClass}">
                    <i class="fas fa-file-pdf"></i>
                </a>`;
            }).join(' ');

            return `<div class="child-transaction-item">
              <div class="child-transaction-content">
                <div class="child-transaction-name-date">${cn} - ${ct.d} ${ct.t}</div>
              </div>
              ${pdfIcons ? `<div class="child-transaction-pdfs d-flex align-items-center flex-wrap">${pdfIcons}</div>` : ''}
            </div>`;
      }));

      const childrenHtml = hasChildren ? `
        <div class="accordion-transaction-children" id="children-${p.id}" style="display: none;">
             ${childrenHtmlContents.join('')}
        </div>` : '';

      // --- PARENT BELGELERİ ---
      const parentTxDocs = [];
      const parentSeen = new Set();
      
      const addParentDoc = (d) => {
          const url = d.fileUrl || d.url || d.path || d.downloadURL;
          const name = d.fileName || d.name || 'Belge';
          if(url && !parentSeen.has(url)){
              parentSeen.add(url);
              parentTxDocs.push({ fileName: name, fileUrl: url, type: d.type || 'parent_doc' });
          }
      };

      // 1. Transaction Belgeleri
      (p.documents || []).forEach(addParentDoc);
      // Özel alanlar da Transaction belgesi sayılır
      if(p.relatedPdfUrl) addParentDoc({fileName: 'Resmi Yazı', fileUrl: p.relatedPdfUrl});
      if(p.oppositionPetitionFileUrl) addParentDoc({fileName: 'İtiraz Dilekçesi', fileUrl: p.oppositionPetitionFileUrl});

      // 2. FALLBACK: Eğer hiç belge yoksa ve Task varsa
      if (parentTxDocs.length === 0 && p.triggeringTaskId) {
           try {
               const taskDocs = await fetchTaskDocuments(p.triggeringTaskId);
               taskDocs.forEach(addParentDoc);
           } catch(e) { console.warn('Parent task doc fetch err', e); }
      }

      const parentPdfIcons = parentTxDocs.map((pdf, idx) => {
          const colorClass = (idx === 0) ? 'doc-color-blue' : 'doc-color-orange';
          return `<a onclick="window.open('${pdf.fileUrl}', '_blank')" 
                     class="doc-link-item ${colorClass}" 
                     title="${pdf.fileName}">
             <i class="fas fa-file-pdf"></i>
          </a>`;
      }).join(' ');

      return `<div class="accordion-transaction-item">
        <div class="accordion-transaction-header ${hasChildren ? 'has-children' : ''}" data-parent-id="${p.id}">
          <div class="transaction-main-info">
            <div class="${hasChildren ? 'accordion-icon expanded' : 'accordion-icon-empty'}">${hasChildren ? '▶' : ''}</div>
            <div class="transaction-details">
              <div class="transaction-name-date">${tname} ${oppositionOwnerBadge} - ${d} ${t}</div>
            </div>
          </div>
          <div class="transaction-meta">
            ${parentPdfIcons ? `<div class="transaction-pdfs">${parentPdfIcons}</div>` : ''}
          </div>
        </div>
        ${childrenHtml}
      </div>`;
    });

    const finalHtml = await Promise.all(parentTransactionRenderPromises).then(results => results.join(''));
    if (txAccordion) txAccordion.innerHTML = finalHtml;
    
    // Tıklama Olayları
    txAccordion?.querySelectorAll('.accordion-transaction-header[data-parent-id]').forEach(header => {
        const icon = header.querySelector('.accordion-icon');
        if (icon && header.classList.contains('has-children')) {
            icon.textContent = '▶';
            icon.classList.remove('expanded');
        }
        header.addEventListener('click', function(e){
          if (e.target.closest('a') || e.target.closest('button')) return;
          const pid = this.getAttribute('data-parent-id');
          const cont = document.getElementById(`children-${pid}`);
          const icn = this.querySelector('.accordion-icon');
          if (!cont) return;
          const isVisible = cont.style.display !== 'none';
          cont.style.display = isVisible ? 'none' : 'block';
          if (icn){
            icn.textContent = isVisible ? '▶' : '▼'; 
            icn.classList.toggle('expanded', !isVisible);
          }
        });
    });

  } catch(e){
    console.error('renderTransactionsAccordion error', e);
    if (txAccordion) txAccordion.innerHTML = '<div class="p-3 text-danger">İşlem geçmişi yüklenirken hata oluştu.</div>';
  }
}

// ... Kalan Kodlar Aynen Devam Eder ...

txFilter?.addEventListener('input', () => {
  const q = (txFilter.value || '').toLowerCase();
  const items = Array.from(txAccordion.querySelectorAll('.accordion-transaction-item'));
  items.forEach(it => {
    const text = it.textContent.toLowerCase();
    it.style.display = text.includes(q) ? '' : 'none';
  });
});

if (docTypeEl) docTypeEl.dispatchEvent(new Event('change'));

docTypeEl?.addEventListener('change', () => {
  const isOther = (docTypeEl.value === 'other');
  if (docTypeOtherWrap){
    docTypeOtherWrap.classList.toggle('d-none', !isOther);
  }
});

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

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `ipRecordDocs/${recordId}/${Date.now()}_${safeName}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    const newDoc = {
      name,
      documentDesignation: type,
      path,
      url,
      uploadedAt: new Date().toISOString()
    };

    const docs = Array.isArray(currentData.documents) ? [currentData.documents] : [];
    docs.push(newDoc);
    const res = await ipRecordsService.updateRecord(recordId, { documents: docs, docPaths: [], updatedAt: new Date() });
    
    if (!res?.success) throw new Error('Belge ekleme başarısız.');
    
    currentData.documents = docs;
    renderDocuments(currentData.documents);

    docNameEl.value = '';
    if (docFileEl) docFileEl.value = '';
    docTypeEl.value = 'evidence';
    if (docTypeOtherEl) docTypeOtherEl.value = '';
    addDocForm.classList.add('d-none');
    
    alert('Belge başarıyla eklendi!');
  } catch (err) {
    console.error('Belge eklenemedi:', err);
    alert('Belge eklenemedi: ' + err.message);
  }
});

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
    
    function _normalize(str){ return (str || '').toString().toUpperCase().replace('Ü','U').replace('İ','I'); }
    function _isTurkPatentOrigin(rec){
      const candidates = [
        rec?.origin, rec?.requestOrigin, rec?.source, rec?.sourceSystem, rec?.details?.origin, rec?.details?.requestOrigin
      ].map(_normalize);
      return candidates.some(v => v && (v.includes('TURKPATENT') || v.includes('TURK PATENT') || v.includes('TÜRKPATENT')));
    }
    const btn = document.getElementById('tpQueryBtn');
    if(btn) btn.style.display = _isTurkPatentOrigin(currentData) ? '' : 'none';

    window.currentRecord = {
      applicationNumber: (currentData?.applicationNumber || '').trim(),
      ipType: currentData?.ipType || 'trademark'
    };

    renderHero(currentData);
    
    if (applicantEl) {
      applicantEl.value = 'Yükleniyor...';
      if (currentData.applicants && currentData.applicants.length > 0) {
        try {
          const names = await Promise.all(currentData.applicants.map(async (app) => {
            if (app.id) {
                try {
                    const personRef = doc(db, 'persons', app.id);
                    const snap = await getDoc(personRef);
                    if (snap.exists()) {
                        return snap.data().name || app.name;
                    }
                } catch(e) { console.warn('Applicant fetch error:', e); }
            }
            return app.name || '';
          }));
          applicantEl.value = names.filter(Boolean).join(', ');
        } catch (err) {
          console.error(err);
          applicantEl.value = extractApplicantNames(currentData);
        }
      } else {
        applicantEl.value = extractApplicantNames(currentData);
      }
    }

    if (applicantAddressEl){
        const firstApplicantId = currentData.applicants?.[0]?.id;
        if (firstApplicantId){
          fetchApplicantAddress(firstApplicantId).then(addr => { applicantAddressEl.value = addr || '-'; });
        } else {
          applicantAddressEl.value = '-';
        }
    }

    renderGoodsList(currentData);
    renderDocuments(currentData.documents);
    await renderTransactionsAccordion(recordId);

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

  // layout padding hesapları (senin mevcut kodun)
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

  // 🔑 Ortak helper ile auth kontrolü
  const user = await waitForAuthUser({ requireAuth: true, redirectTo: 'index.html' });
  if (!user) return; // redirect oldu zaten

  // Logout olursa her zaman login sayfasına dön
  redirectOnLogout('index.html');

  // Kullanıcı kesin olarak var, artık kaydı rahatça yükleyebilirsin
  await loadRecord();

})();


docsTbody?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('.btn-doc-remove');
  if (!btn) return;
  const idx = Number(btn.getAttribute('data-index'));
  if (Number.isNaN(idx)) return;
  if (!confirm('Silmek istediğinize emin misiniz?')) return;
  
  const docs = currentData.documents.filter((_,i) => i !== idx);
  await ipRecordsService.updateRecord(recordId, { documents: docs, docPaths: [], updatedAt: new Date() });
  currentData.documents = docs;
  renderDocuments(currentData.documents);
});

const tpQueryBtn = document.getElementById('tpQueryBtn');
if (tpQueryBtn) {
  tpQueryBtn.addEventListener('click', () => {
    const applicationNo = (window.currentRecord?.applicationNumber || '').trim();
    if (!applicationNo) { alert('Başvuru numarası bulunamadı.'); return; }
    if (window.triggerTpQuery) { window.triggerTpQuery(applicationNo); }
    else { 
        const url = `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(applicationNo)}`;
        window.open(url, '_blank');
    }
  });
}

window.triggerTpQuery = function(applicationNo){
  const appNo = (applicationNo || '').toString().trim();
  const fallbackUrl = `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(appNo)}`;
  const EXT_ID = 'gkhmldkbjmnipikgjabmlilibllikapk';
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage(EXT_ID, { type: 'SORGULA', data: appNo }, (res) => {
          if (chrome.runtime.lastError || !res) window.open(fallbackUrl, '_blank');
      });
      return;
    }
  } catch (e) {}
  window.open(fallbackUrl, '_blank');
};