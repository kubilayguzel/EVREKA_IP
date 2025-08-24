// js/portfolio-detail.js
import { loadSharedLayout } from './layout-loader.js';
import { ipRecordsService, transactionTypeService, auth, db, storage } from '../firebase-config.js';
import { formatFileSize, STATUSES } from '../utils.js';
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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
            ? `<ul class="goods-items">${items.map(t => `<li>${t}</li>`).join('')}</ul>`
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

    const {parents, childrenMap} = organizeTransactions(list);
    if (!parents.length){
      if (txAccordion) txAccordion.innerHTML = '<div class="p-3 text-muted">Henüz işlem geçmişi yok.</div>';
      return;
    }

    if (txAccordion) txAccordion.innerHTML = parents.map(p => {
      const tmeta = typeMap.get(String(p.type));
      const tname = tmeta ? (tmeta.alias || tmeta.name) : `İşlem ${p.type}`;
      const {d,t} = fmtDateTime(p.timestamp);
      const children = childrenMap[p.id] || [];
      const hasChildren = children.length > 0;

      const childrenHtml = hasChildren ? `
        <div class="accordion-transaction-children" id="children-${p.id}">
          ${children.map(c => {
            const cm = typeMap.get(String(c.type));
            const cn = cm ? (cm.alias || cm.name) : `İşlem ${c.type}`;
            const ct = fmtDateTime(c.timestamp);
            return `<div class="child-transaction-item">
              <div class="child-transaction-content">
                <div class="child-transaction-name-date">${cn} - ${ct.d} ${ct.t}</div>
              </div>
            </div>`;
          }).join('')}
        </div>` : '';

      return `<div class="accordion-transaction-item">
        <div class="accordion-transaction-header ${hasChildren ? 'has-children' : ''}" data-parent-id="${p.id}">
          <div class="transaction-main-info">
            <div class="${hasChildren ? 'accordion-icon' : 'accordion-icon-empty'}">${hasChildren ? '▶' : ''}</div>
            <div class="transaction-details">
              <div class="transaction-name-date">${tname} - ${d} ${t}</div>
            </div>
          </div>
          <div class="transaction-meta">
            ${hasChildren ? `<span class="child-count">${children.length} alt işlem</span>` : ''}
          </div>
        </div>
        ${childrenHtml}
      </div>`;
    }).join('');

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
    const docs = Array.isArray(currentData.documents) ? [...currentData.documents] : [];
    docs.push(newDoc);
    const res = await ipRecordsService.updateRecord(recordId, { documents: docs, updatedAt: new Date() });
    
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
    // Bu kaydı butonun ulaşabileceği global alana da verelim:
    window.currentRecord = {
      applicationNumber: (currentData?.applicationNumber || '').trim(),
      ipType: currentData?.ipType || 'trademark'
    };

    // HERO
    renderHero(currentData);

    // Applicant + address
    if (applicantEl) applicantEl.value = extractApplicantNames(currentData);
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
// ========================================
// CROSS-ORIGIN SORUNUNU ÇÖZEN YENİ YAKLAŞIMLAR
// ========================================

class TurkpatentCrossOriginSolution {
    constructor() {
        this.popupWindow = null;
    }

    // ========================================
    // ÇÖZÜM 1: URL Parametreli + Kullanıcı Rehberi
    // ========================================
    
    async openWithGuidedApproach(applicationNumber) {
        // TÜRKPATENT'i özel parametrelerle aç
        const turkpatentUrl = `https://www.turkpatent.gov.tr/arastirma-yap?form=trademark&auto_fill=${applicationNumber}`;
        
        this.popupWindow = window.open(turkpatentUrl, 'turkpatent_query', 
            'width=1200,height=800,scrollbars=yes,resizable=yes,location=yes');

        if (!this.popupWindow) {
            alert('Popup engelleyici aktif! Lütfen bu site için popup\'ları etkinleştirin.');
            return;
        }

        // Kullanıcıya rehber göster
        this.showUserGuide(applicationNumber);
    }

    showUserGuide(applicationNumber) {
        const guide = this.createGuideModal();
        guide.querySelector('.app-number-display').textContent = applicationNumber;
        document.body.appendChild(guide);
        guide.style.display = 'flex';

        // Popup kapandığında rehberi kapat
        const checkClosed = setInterval(() => {
            if (this.popupWindow.closed) {
                clearInterval(checkClosed);
                guide.remove();
            }
        }, 1000);
    }

    createGuideModal() {
        const modal = document.createElement('div');
        modal.id = 'turkpatent-guide-modal';
        modal.style.cssText = `
            position: fixed; top: 20px; right: 20px; width: 350px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; border-radius: 12px; padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3); z-index: 10000;
            font-family: Arial, sans-serif;
        `;
        
        modal.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h4 style="margin: 0; color: white;">🤖 Otomatik Rehber</h4>
                <button onclick="this.closest('#turkpatent-guide-modal').remove()" 
                        style="background: rgba(255,255,255,0.2); border: none; color: white; 
                               border-radius: 50%; width: 25px; height: 25px; cursor: pointer;">×</button>
            </div>
            
            <div style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 15px; margin-bottom: 15px;">
                <div style="font-weight: bold; margin-bottom: 8px;">📋 Başvuru Numarası:</div>
                <div class="app-number-display" style="font-family: monospace; font-size: 16px; 
                     background: rgba(255,255,255,0.2); padding: 8px; border-radius: 4px; text-align: center;"></div>
            </div>
            
            <div style="font-size: 14px; line-height: 1.4;">
                <div style="margin-bottom: 10px; font-weight: bold;">👆 Lütfen şu adımları takip edin:</div>
                <div style="margin-bottom: 8px;">
                    <span style="background: #ff6b6b; padding: 2px 6px; border-radius: 3px; margin-right: 8px;">1</span>
                    Açılan penceredeki kırmızı DUYURU modalını kapatın
                </div>
                <div style="margin-bottom: 8px;">
                    <span style="background: #4ecdc4; padding: 2px 6px; border-radius: 3px; margin-right: 8px;">2</span>
                    "Dosya Takibi" sekmesini tıklayın
                </div>
                <div style="margin-bottom: 8px;">
                    <span style="background: #45b7d1; padding: 2px 6px; border-radius: 3px; margin-right: 8px;">3</span>
                    Başvuru numarasını yukarıdaki gibi girin
                </div>
                <div>
                    <span style="background: #96ceb4; padding: 2px 6px; border-radius: 3px; margin-right: 8px;">4</span>
                    "Sorgula" butonuna basın
                </div>
            </div>
            
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2);">
                <div style="font-size: 12px; opacity: 0.8;">
                    💡 İpucu: Başvuru numarasını kopyalamak için tıklayın
                </div>
            </div>
        `;

        // Başvuru numarasına tıklandığında kopyala
        const numberDisplay = modal.querySelector('.app-number-display');
        numberDisplay.style.cursor = 'pointer';
        numberDisplay.title = 'Kopyalamak için tıklayın';
        numberDisplay.onclick = () => {
            navigator.clipboard.writeText(numberDisplay.textContent).then(() => {
                const originalBg = numberDisplay.style.background;
                numberDisplay.style.background = 'rgba(76, 175, 80, 0.8)';
                setTimeout(() => {
                    numberDisplay.style.background = originalBg;
                }, 1000);
            });
        };

        return modal;
    }

    // ========================================
    // ÇÖZÜM 2: Bookmarklet Yaklaşımı
    // ========================================

    generateBookmarklet(applicationNumber) {
        const bookmarkletCode = `
javascript:(function(){
    // Modal kapatma
    setTimeout(function(){
        var closeBtn = Array.from(document.querySelectorAll('button, a, span, div')).find(btn => 
            /devam|tamam|kapat|anladım|kabul|close/i.test((btn.textContent || btn.innerText || '').trim()));
        if(closeBtn) closeBtn.click();
        
        setTimeout(function(){
            // Dosya takibi sekmesi
            var tab = Array.from(document.querySelectorAll('button')).find(b => 
                /Dosya Takibi/i.test(b.textContent));
            if(tab) tab.click();
            
            setTimeout(function(){
                // Input field
                var input = Array.from(document.querySelectorAll('input')).find(i => 
                    /Başvuru/i.test(i.placeholder || '')) || document.querySelector('input');
                if(input) {
                    input.value = '${applicationNumber}';
                    input.dispatchEvent(new Event('input', {bubbles: true}));
                    
                    setTimeout(function(){
                        // Sorgula butonu
                        var btn = Array.from(document.querySelectorAll('button')).find(b => 
                            /Sorgula/i.test(b.textContent));
                        if(btn) btn.click();
                    }, 1000);
                }
            }, 2000);
        }, 2000);
    }, 1000);
})();
        `.trim();

        return bookmarkletCode;
    }

    showBookmarkletInstructions(applicationNumber) {
        const bookmarklet = this.generateBookmarklet(applicationNumber);
        
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.7); display: flex; align-items: center;
            justify-content: center; z-index: 10000;
        `;

        modal.innerHTML = `
            <div style="background: white; border-radius: 12px; padding: 30px; max-width: 600px; width: 90%;">
                <h3 style="color: #1e3c72; margin-bottom: 20px;">🔖 Bookmarklet Çözümü</h3>
                
                <p style="margin-bottom: 20px; line-height: 1.5;">
                    Aşağıdaki kodu <strong>bookmark</strong> olarak tarayıcınıza ekleyin. 
                    TÜRKPATENT sayfasında bu bookmark'ı tıklamanız yeterli olacak.
                </p>
                
                <div style="margin-bottom: 20px;">
                    <label style="font-weight: bold; margin-bottom: 5px; display: block;">Bookmarklet Kodu:</label>
                    <textarea readonly style="width: 100%; height: 120px; font-family: monospace; 
                              font-size: 12px; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">${bookmarklet}</textarea>
                </div>
                
                <div style="margin-bottom: 20px; padding: 15px; background: #f0f8ff; border-radius: 8px; border-left: 4px solid #2196f3;">
                    <strong>📋 Nasıl Kullanılır:</strong>
                    <ol style="margin: 10px 0 0 20px; line-height: 1.6;">
                        <li>Yukarıdaki kodu kopyalayın</li>
                        <li>Tarayıcınızda yeni bir bookmark oluşturun</li>
                        <li>URL kısmına kodu yapıştırın</li>
                        <li>TÜRKPATENT sayfasında bookmark'ı tıklayın</li>
                    </ol>
                </div>
                
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button onclick="navigator.clipboard.writeText(\`${bookmarklet.replace(/`/g, '\\`')}\`)
                            .then(() => alert('Kopyalandı!'))" 
                            style="background: #4caf50; color: white; border: none; padding: 10px 20px; 
                                   border-radius: 6px; cursor: pointer;">
                        📋 Kopyala
                    </button>
                    <button onclick="this.closest('div[style*=\"position: fixed\"]').remove()"
                            style="background: #666; color: white; border: none; padding: 10px 20px; 
                                   border-radius: 6px; cursor: pointer;">
                        Kapat
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }

    // ========================================
    // ÇÖZÜM 3: PostMessage ile İletişim
    // ========================================

    openWithPostMessage(applicationNumber) {
        // Özel parametreli URL oluştur
        const params = new URLSearchParams({
            form: 'trademark',
            automate: 'true',
            appNumber: applicationNumber,
            source: window.location.hostname
        });
        
        const url = `https://www.turkpatent.gov.tr/arastirma-yap?${params.toString()}`;
        
        this.popupWindow = window.open(url, 'turkpatent_query',
            'width=1200,height=800,scrollbars=yes,resizable=yes');

        if (!this.popupWindow) {
            alert('Popup engelleyici aktif!');
            return;
        }

        // PostMessage listener kurma
        window.addEventListener('message', (event) => {
            if (event.origin !== 'https://www.turkpatent.gov.tr') return;
            
            if (event.data.type === 'automation_request') {
                // TÜRKPATENT sayfası bizden otomasyon istiyor
                this.popupWindow.postMessage({
                    type: 'automation_data',
                    applicationNumber: applicationNumber
                }, 'https://www.turkpatent.gov.tr');
            }
            
            if (event.data.type === 'automation_complete') {
                console.log('✅ Otomasyon tamamlandı!');
                this.showSuccess('TÜRKPATENT sorgusu başarıyla tamamlandı!');
            }
        });

        // Timeout için fallback
        setTimeout(() => {
            if (this.popupWindow && !this.popupWindow.closed) {
                this.showUserGuide(applicationNumber);
            }
        }, 5000);
    }

    showSuccess(message) {
        if (typeof showNotification === 'function') {
            showNotification(message, 'success');
        } else {
            console.log('✅', message);
        }
    }
}

// ========================================
// Ana entegrasyon güncellemesi
// ========================================

// Mevcut class'ı güncelle
PortfolioTurkpatentIntegration.prototype.openWithAutomation = async function(applicationNumber) {
    if (this.automationInProgress) {
        this.showInfo('Zaten bir sorgu devam ediyor...');
        return;
    }

    this.automationInProgress = true;

    // Cross-origin çözümü kullan
    const crossOriginSolution = new TurkpatentCrossOriginSolution();
    
    // Kullanıcıya seçim sun
    const method = await this.chooseCrossOriginMethod();
    
    try {
        switch (method) {
            case 'guided':
                await crossOriginSolution.openWithGuidedApproach(applicationNumber);
                break;
            case 'bookmarklet':
                crossOriginSolution.showBookmarkletInstructions(applicationNumber);
                break;
            case 'postmessage':
                await crossOriginSolution.openWithPostMessage(applicationNumber);
                break;
            case 'simple':
                // Sadece pencere aç, kullanıcı manuel yapsın
                const url = 'https://www.turkpatent.gov.tr/arastirma-yap?form=trademark';
                window.open(url, 'turkpatent_query', 'width=1200,height=800,scrollbars=yes,resizable=yes');
                alert(`TÜRKPATENT açıldı. Lütfen manuel olarak "${applicationNumber}" numarasını sorgulayın.`);
                break;
            default:
                await crossOriginSolution.openWithGuidedApproach(applicationNumber);
        }
    } catch (error) {
        this.showError('Sorgu açılırken hata: ' + error.message);
    } finally {
        this.automationInProgress = false;
    }
};

PortfolioTurkpatentIntegration.prototype.chooseCrossOriginMethod = function() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); display: flex; align-items: center;
            justify-content: center; z-index: 10000;
        `;
        
        modal.innerHTML = `
            <div style="background: white; border-radius: 12px; padding: 25px; max-width: 500px; width: 90%;">
                <h3 style="color: #1e3c72; margin-bottom: 20px; text-align: center;">
                    🔧 Otomasyon Yöntemi Seçin
                </h3>
                
                <p style="color: #666; margin-bottom: 20px; text-align: center; line-height: 1.5;">
                    Tarayıcı güvenlik kısıtlaması nedeniyle otomasyon yöntemi seçmeniz gerekiyor:
                </p>
                
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <button onclick="resolve('guided')" style="
                        background: #4caf50; color: white; border: none; padding: 12px 16px;
                        border-radius: 8px; cursor: pointer; text-align: left;
                    ">
                        <strong>🎯 Rehberli Otomasyon</strong><br>
                        <small>Pencere açılır, adım adım rehber gösterilir (Önerilen)</small>
                    </button>
                    
                    <button onclick="resolve('simple')" style="
                        background: #2196f3; color: white; border: none; padding: 12px 16px;
                        border-radius: 8px; cursor: pointer; text-align: left;
                    ">
                        <strong>🌐 Basit Açma</strong><br>
                        <small>Sadece TÜRKPATENT'i açar, manuel sorgulama</small>
                    </button>
                    
                    <button onclick="resolve('bookmarklet')" style="
                        background: #ff9800; color: white; border: none; padding: 12px 16px;
                        border-radius: 8px; cursor: pointer; text-align: left;
                    ">
                        <strong>🔖 Bookmarklet Çözümü</strong><br>
                        <small>Gelişmiş kullanıcılar için tam otomasyon</small>
                    </button>
                    
                    <button onclick="resolve(null)" style="
                        background: #666; color: white; border: none; padding: 10px 16px;
                        border-radius: 8px; cursor: pointer;
                    ">
                        İptal
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Button click handler'ı global yap
        window.resolve = (value) => {
            modal.remove();
            delete window.resolve;
            resolve(value);
        };
    });
};
