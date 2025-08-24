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
// portfolio-detail.js dosyasının sonuna eklenecek kod

// ========================================
// Mevcut TÜRKPATENT butonuna entegrasyon
// ========================================

// Sayfa yüklendiğinde buton event'ini bağla
document.addEventListener('DOMContentLoaded', function() {
    setupTurkpatentButton();
});

function setupTurkpatentButton() {
    const tpQueryBtn = document.getElementById('tpQueryBtn');
    
    if (!tpQueryBtn) {
        console.log('TÜRKPATENT butonu bulunamadı');
        return;
    }

    // Mevcut onclick event'lerini temizle
    tpQueryBtn.onclick = null;
    
    // Yeni event listener ekle
    tpQueryBtn.addEventListener('click', handleTurkpatentButtonClick);
    
    // Buton metnini güncelle (opsiyonel)
    if (tpQueryBtn.textContent.includes('TÜRKPATENT')) {
        tpQueryBtn.innerHTML = '<i class="fas fa-search"></i> TÜRKPATENT\'te Sorgula';
    }
    
    console.log('TÜRKPATENT butonu hazırlandı');
}

async function handleTurkpatentButtonClick(event) {
    event.preventDefault();
    
    // Portfolio verisini al (global değişken veya DOM'dan)
    const applicationNumber = getApplicationNumberFromPage();
    
    if (!applicationNumber) {
        alert('Başvuru numarası bulunamadı! Bu kayıt için TÜRKPATENT sorgusu yapılamaz.');
        return;
    }
    
    // Kullanıcıya sorgu yöntemi seçeneği sun
    const userChoice = await showQueryMethodDialog();
    
    if (userChoice) {
        turkpatentIntegration.queryTurkpatent(applicationNumber, userChoice);
    }
}

function getApplicationNumberFromPage() {
    // Öncelik sırasına göre başvuru numarasını bul
    
    // 1. Global portfolioData değişkeninden
    if (typeof portfolioData !== 'undefined' && portfolioData.applicationNumber) {
        return portfolioData.applicationNumber;
    }
    
    // 2. currentRecord global değişkeninden
    if (typeof currentRecord !== 'undefined' && currentRecord.applicationNumber) {
        return currentRecord.applicationNumber;
    }
    
    // 3. URL parametresinden
    const urlParams = new URLSearchParams(window.location.search);
    const recordId = urlParams.get('id');
    
    // 4. DOM'dan input alanlarından
    const appNumberInput = document.getElementById('applicationNumber');
    if (appNumberInput && appNumberInput.value) {
        return appNumberInput.value;
    }
    
    // 5. Hero kartından veri çek
    const heroKv = document.getElementById('heroKv');
    if (heroKv) {
        const kvItems = heroKv.querySelectorAll('.kv-item');
        for (let item of kvItems) {
            const label = item.querySelector('.kv-label');
            const value = item.querySelector('.kv-value');
            
            if (label && value && 
                /başvuru.*numarası|application.*number/i.test(label.textContent)) {
                return value.textContent.trim();
            }
        }
    }
    
    // 6. Tablolardan veya diğer DOM elementlerinden
    const potentialSelectors = [
        'input[name="applicationNumber"]',
        'input[id*="application"]',
        '[data-field="applicationNumber"]',
        '.application-number',
        '.app-number'
    ];
    
    for (let selector of potentialSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            const value = element.value || element.textContent || element.innerText;
            if (value && value.trim()) {
                return value.trim();
            }
        }
    }
    
    return null;
}

function showQueryMethodDialog() {
    return new Promise((resolve) => {
        // Modern modal dialog oluştur
        const modal = createQueryMethodModal();
        document.body.appendChild(modal);
        
        // Modal'ı göster
        modal.style.display = 'flex';
        
        // Buton event'lerini bağla
        modal.querySelector('#queryMethodPopup').onclick = () => {
            resolve('popup');
            closeModal(modal);
        };
        
        modal.querySelector('#queryMethodAPI').onclick = () => {
            resolve('api');
            closeModal(modal);
        };
        
        modal.querySelector('#queryMethodCancel').onclick = () => {
            resolve(null);
            closeModal(modal);
        };
        
        // ESC tuşu ile kapama
        document.addEventListener('keydown', function escListener(e) {
            if (e.key === 'Escape') {
                resolve(null);
                closeModal(modal);
                document.removeEventListener('keydown', escListener);
            }
        });
    });
}

function createQueryMethodModal() {
    const modal = document.createElement('div');
    modal.id = 'turkpatent-method-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); display: none; align-items: center;
        justify-content: center; z-index: 10000; backdrop-filter: blur(2px);
    `;
    
    modal.innerHTML = `
        <div style="
            background: white; border-radius: 12px; padding: 30px; max-width: 500px;
            width: 90%; box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            transform: scale(0.9); transition: transform 0.3s ease;
        " class="modal-content-inner">
            <h3 style="color: #1e3c72; margin-bottom: 20px; text-align: center;">
                <i class="fas fa-search" style="margin-right: 10px;"></i>
                TÜRKPATENT Sorgu Yöntemi
            </h3>
            
            <p style="color: #666; margin-bottom: 25px; text-align: center; line-height: 1.5;">
                Sorgulamayı nasıl gerçekleştirmek istiyorsunuz?
            </p>
            
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <button id="queryMethodPopup" class="method-button" style="
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white; border: none; padding: 15px 20px; border-radius: 10px;
                    cursor: pointer; font-size: 16px; font-weight: 500;
                    transition: all 0.3s ease; display: flex; align-items: center; gap: 12px;
                ">
                    <i class="fas fa-window-restore" style="font-size: 18px;"></i>
                    <div style="text-align: left;">
                        <div><strong>Yeni Pencerede Otomatik Sorgu</strong></div>
                        <div style="font-size: 13px; opacity: 0.9;">Hızlı, interaktif, sonuçları canlı görün (Önerilen)</div>
                    </div>
                </button>
                
                <button id="queryMethodAPI" class="method-button" style="
                    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                    color: white; border: none; padding: 15px 20px; border-radius: 10px;
                    cursor: pointer; font-size: 16px; font-weight: 500;
                    transition: all 0.3s ease; display: flex; align-items: center; gap: 12px;
                ">
                    <i class="fas fa-robot" style="font-size: 18px;"></i>
                    <div style="text-align: left;">
                        <div><strong>Robot ile Arka Plan Sorgulama</strong></div>
                        <div style="font-size: 13px; opacity: 0.9;">Güvenilir, sonuçları bu sayfada göster</div>
                    </div>
                </button>
                
                <button id="queryMethodCancel" style="
                    background: transparent; color: #666; border: 1px solid #ddd;
                    padding: 12px 20px; border-radius: 8px; cursor: pointer;
                    font-size: 14px; transition: all 0.3s ease;
                ">
                    İptal
                </button>
            </div>
        </div>
    `;
    
    // Hover efektleri
    const style = document.createElement('style');
    style.textContent = `
        #turkpatent-method-modal .method-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.2);
        }
        #turkpatent-method-modal #queryMethodCancel:hover {
            background: #f8f9fa;
            border-color: #999;
        }
        #turkpatent-method-modal.show .modal-content-inner {
            transform: scale(1);
        }
    `;
    document.head.appendChild(style);
    
    // Modal açılma animasyonu
    setTimeout(() => modal.classList.add('show'), 10);
    
    return modal;
}

function closeModal(modal) {
    modal.style.transform = 'scale(0.95)';
    modal.style.opacity = '0';
    
    setTimeout(() => {
        modal.remove();
    }, 300);
}

// ========================================
// Portfolio verisi değiştiğinde buton durumunu güncelle
// ========================================

// Mevcut loadPortfolioDetails fonksiyonunu genişlet
const originalLoadPortfolioDetails = window.loadPortfolioDetails;
if (typeof originalLoadPortfolioDetails === 'function') {
    window.loadPortfolioDetails = async function(...args) {
        const result = await originalLoadPortfolioDetails.apply(this, args);
        updateTurkpatentButtonState();
        return result;
    };
}

function updateTurkpatentButtonState() {
    const tpQueryBtn = document.getElementById('tpQueryBtn');
    if (!tpQueryBtn) return;
    
    const applicationNumber = getApplicationNumberFromPage();
    
    if (applicationNumber) {
        tpQueryBtn.disabled = false;
        tpQueryBtn.title = `${applicationNumber} numaralı başvuru için TÜRKPATENT sorgusu yap`;
        tpQueryBtn.style.opacity = '1';
    } else {
        tpQueryBtn.disabled = true;
        tpQueryBtn.title = 'Başvuru numarası bulunamadı';
        tpQueryBtn.style.opacity = '0.6';
    }
}

// ========================================
// Debug ve test fonksiyonları
// ========================================

// Konsol'dan test etmek için
window.testTurkpatentButton = function() {
    const appNumber = getApplicationNumberFromPage();
    console.log('Bulunan başvuru numarası:', appNumber);
    
    if (appNumber) {
        turkpatentIntegration.queryTurkpatent(appNumber, 'popup');
    } else {
        console.log('Başvuru numarası bulunamadı');
    }
};

// Sayfa yüklendiğinde otomatik setup
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTurkpatentButton);
} else {
    setupTurkpatentButton();
}
