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
// PORTFOLIO-DETAIL.JS - TÜRKPATENT ENTEGRASYONU (KOMPLE ÇÖZÜM)
// ========================================

// Global değişken tanımla
let turkpatentIntegration = null;

// ========================================
// 1. TÜRKPATENT AUTOMATION CLASS
// ========================================

class PortfolioTurkpatentIntegration {
    constructor() {
        this.popupWindow = null;
        this.automationInProgress = false;
    }

    // Ana entegrasyon fonksiyonu
    async queryTurkpatent(applicationNumber, method = 'popup') {
        if (!applicationNumber) {
            this.showError('Başvuru numarası bulunamadı!');
            return;
        }

        switch (method) {
            case 'popup':
                return this.openWithAutomation(applicationNumber);
            case 'api':
                return this.queryWithCloudFunction(applicationNumber);
            case 'both':
                return this.queryBothMethods(applicationNumber);
            default:
                return this.openWithAutomation(applicationNumber);
        }
    }

    // Yöntem 1: Popup + JavaScript Otomasyonu
    async openWithAutomation(applicationNumber) {
        if (this.automationInProgress) {
            this.showInfo('Zaten bir sorgu devam ediyor...');
            return;
        }

        this.automationInProgress = true;
        this.showLoadingIndicator('TÜRKPATENT açılıyor...');

        try {
            const turkpatentUrl = 'https://www.turkpatent.gov.tr/arastirma-yap?form=trademark';
            this.popupWindow = window.open(
                turkpatentUrl, 
                'turkpatent_query', 
                'width=1200,height=800,scrollbars=yes,resizable=yes,location=yes'
            );

            if (!this.popupWindow) {
                throw new Error('Popup engelleyici aktif! Lütfen bu site için popup\'ları etkinleştirin.');
            }

            // Popup kapandığında temizlik yap
            const checkClosed = setInterval(() => {
                if (this.popupWindow.closed) {
                    clearInterval(checkClosed);
                    this.automationInProgress = false;
                    this.hideLoadingIndicator();
                }
            }, 1000);

            // Sayfa yüklenme kontrolü
            let loadAttempts = 0;
            const maxAttempts = 30;

            const waitForLoad = () => {
                loadAttempts++;
                
                if (loadAttempts > maxAttempts) {
                    this.hideLoadingIndicator();
                    this.showError('Sayfa yükleme timeout. Lütfen manuel olarak doldurun.');
                    return;
                }

                try {
                    if (this.popupWindow.document.readyState === 'complete') {
                        this.showLoadingIndicator('Modallar kapatılıyor...');
                        setTimeout(() => {
                            this.startAutomation(applicationNumber);
                        }, 3000); // 3 saniye bekle - modal için daha uzun süre
                    } else {
                        setTimeout(waitForLoad, 1000);
                    }
                } catch (error) {
                    setTimeout(waitForLoad, 1000);
                }
            };

            waitForLoad();

        } catch (error) {
            this.automationInProgress = false;
            this.hideLoadingIndicator();
            this.showError(error.message);
        }
    }

    // Otomatik form doldurma
    async startAutomation(applicationNumber) {
        if (!this.popupWindow || this.popupWindow.closed) {
            this.hideLoadingIndicator();
            return;
        }

        try {
            const doc = this.popupWindow.document;
            
            // ÖNEMLİ: İlk önce modalları kapat
            console.log('🔄 Modallar kapatılıyor...');
            await this.closeAnnounceModals(doc);
            
            console.log('🔄 Dosya Takibi sekmesi açılıyor...');
            await this.activateFileTrackingTab(doc);
            
            console.log('🔄 Başvuru numarası dolduruluyor...');
            await this.fillApplicationNumber(doc, applicationNumber);
            
            console.log('🔄 Sorgula butonu tıklanıyor...');
            await this.clickSearchButton(doc);
            
            this.hideLoadingIndicator();
            this.showSuccess('Form başarıyla dolduruldu! Sonuçlar yükleniyor...');
            
        } catch (error) {
            this.hideLoadingIndicator();
            this.showError('Otomatik form doldurma başarısız: ' + error.message);
            console.error('Automation error:', error);
        }
    }

    // Modal kapatma fonksiyonu
    async closeAnnounceModals(doc) {
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 10;

            const tryCloseModals = () => {
                attempts++;
                
                try {
                    // 1) "Devam" butonunu ara ve tıkla
                    const continueButtons = doc.querySelectorAll('button, a, span, div');
                    const continueBtn = Array.from(continueButtons).find(btn => {
                        const text = (btn.textContent || btn.innerText || '').trim();
                        return /devam|tamam|kapat|anladım|kabul|close/i.test(text);
                    });
                    
                    if (continueBtn && continueBtn.click) {
                        console.log('✅ Modal kapatma butonu bulundu ve tıklandı:', continueBtn.textContent);
                        continueBtn.click();
                        setTimeout(resolve, 1500); // Modal kapanması için bekle
                        return;
                    }

                    // 2) X butonunu ara
                    const closeButtons = doc.querySelectorAll('[aria-label="close"], [aria-label="Close"], .close, .modal-close, button[title*="kapat"], button[title*="Close"]');
                    if (closeButtons.length > 0) {
                        console.log('✅ X butonu bulundu:', closeButtons[0]);
                        closeButtons[0].click();
                        setTimeout(resolve, 1500);
                        return;
                    }

                    // 3) Overlay/backdrop'e tıkla
                    const overlays = doc.querySelectorAll('.MuiBackdrop-root, .modal-backdrop, .overlay, [role="presentation"]');
                    if (overlays.length > 0) {
                        console.log('✅ Overlay bulundu, tıklanıyor');
                        overlays[0].click();
                        setTimeout(resolve, 1500);
                        return;
                    }

                    // 4) ESC tuşu gönder
                    const event = new KeyboardEvent('keydown', {
                        key: 'Escape',
                        code: 'Escape',
                        keyCode: 27,
                        which: 27,
                        bubbles: true
                    });
                    doc.dispatchEvent(event);
                    console.log('⌨️ ESC tuşu gönderildi');

                    // 5) Modal/dialog elementlerini zorla kaldır
                    const modals = doc.querySelectorAll('.MuiDialog-root, .modal, .dialog, [role="dialog"], [role="alertdialog"]');
                    if (modals.length > 0) {
                        console.log('🗑️ Modallar zorla kaldırılıyor:', modals.length);
                        modals.forEach(modal => {
                            if (modal.remove) modal.remove();
                        });
                    }

                } catch (error) {
                    console.log('⚠️ Modal kapatma hatası:', error.message);
                }

                // Maksimum deneme sayısına ulaştık
                if (attempts >= maxAttempts) {
                    console.log('⏰ Modal kapatma timeout, devam ediliyor...');
                    resolve();
                } else {
                    // Tekrar dene
                    setTimeout(tryCloseModals, 800);
                }
            };

            tryCloseModals();
        });
    }

    async activateFileTrackingTab(doc) {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 20;

            const findAndClickTab = () => {
                attempts++;
                
                if (attempts > maxAttempts) {
                    reject(new Error('Dosya Takibi sekmesi bulunamadı'));
                    return;
                }

                const tabs = doc.querySelectorAll('button[role="tab"], .MuiTab-root, button');
                const fileTrackingTab = Array.from(tabs).find(tab => 
                    /Dosya\s*Takibi/i.test(tab.textContent || tab.innerText || '')
                );
                
                if (fileTrackingTab && fileTrackingTab.click) {
                    fileTrackingTab.click();
                    console.log('Dosya Takibi sekmesi tıklandı');
                    setTimeout(resolve, 1500);
                } else {
                    setTimeout(findAndClickTab, 500);
                }
            };

            findAndClickTab();
        });
    }

    async fillApplicationNumber(doc, applicationNumber) {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 20;

            const findAndFillInput = () => {
                attempts++;
                
                if (attempts > maxAttempts) {
                    reject(new Error('Başvuru numarası alanı bulunamadı'));
                    return;
                }

                const inputs = doc.querySelectorAll('input');
                let targetInput = Array.from(inputs).find(input => {
                    const placeholder = input.getAttribute('placeholder') || '';
                    const label = input.getAttribute('aria-label') || '';
                    return /Başvuru.*Numarası/i.test(placeholder + ' ' + label);
                });

                if (!targetInput) {
                    targetInput = Array.from(inputs).find(input => 
                        input.type === 'text' && input.offsetParent !== null
                    );
                }
                
                if (targetInput) {
                    targetInput.focus();
                    targetInput.value = '';
                    targetInput.value = applicationNumber;
                    
                    const events = ['input', 'change', 'keyup'];
                    events.forEach(eventType => {
                        const event = new Event(eventType, { bubbles: true });
                        targetInput.dispatchEvent(event);
                    });
                    
                    console.log('Başvuru numarası dolduruldu:', applicationNumber);
                    setTimeout(resolve, 800);
                } else {
                    setTimeout(findAndFillInput, 500);
                }
            };

            findAndFillInput();
        });
    }

    async clickSearchButton(doc) {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 15;

            const findAndClickButton = () => {
                attempts++;
                
                if (attempts > maxAttempts) {
                    reject(new Error('Sorgula butonu bulunamadı'));
                    return;
                }

                const buttons = doc.querySelectorAll('button, input[type="submit"], input[type="button"]');
                const searchButton = Array.from(buttons).find(btn => {
                    const text = btn.textContent || btn.innerText || btn.value || '';
                    return /Sorgula|Ara|Search/i.test(text) && !btn.disabled;
                });
                
                if (searchButton) {
                    searchButton.click();
                    console.log('Sorgula butonu tıklandı');
                    resolve();
                } else {
                    setTimeout(findAndClickButton, 500);
                }
            };

            findAndClickButton();
        });
    }

    // Yöntem 2: Cloud Function ile sorgu
    async queryWithCloudFunction(applicationNumber) {
        this.showLoadingIndicator('TÜRKPATENT sorgulanıyor...');

        try {
            const response = await fetch('https://europe-west1-ip-manager-production-aab4b.cloudfunctions.net/tpQueryV2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicationNumber })
            });

            const data = await response.json();
            
            if (data.ok) {
                this.showResults(data.html, data.screenshot, applicationNumber);
            } else {
                throw new Error(data.error || 'Sorgu başarısız');
            }
        } catch (error) {
            this.showError('Sorgu hatası: ' + error.message);
        } finally {
            this.hideLoadingIndicator();
        }
    }

    // UI Helper fonksiyonları
    showLoadingIndicator(message) {
        const indicator = document.getElementById('turkpatent-loading') || 
                         this.createLoadingIndicator();
        indicator.querySelector('.loading-message').textContent = message;
        indicator.style.display = 'flex';
    }

    hideLoadingIndicator() {
        const indicator = document.getElementById('turkpatent-loading');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    createLoadingIndicator() {
        const div = document.createElement('div');
        div.id = 'turkpatent-loading';
        div.innerHTML = `
            <div style="
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.5); display: flex; align-items: center;
                justify-content: center; z-index: 10000;
            ">
                <div style="
                    background: white; padding: 30px; border-radius: 10px;
                    text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                ">
                    <div class="loading-spinner" style="
                        width: 40px; height: 40px; border: 4px solid #f3f3f3;
                        border-top: 4px solid #3498db; border-radius: 50%;
                        animation: spin 1s linear infinite; margin: 0 auto 20px auto;
                    "></div>
                    <div class="loading-message">Yükleniyor...</div>
                </div>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;
        document.body.appendChild(div);
        return div;
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showInfo(message) {
        this.showNotification(message, 'info');
    }

    showNotification(message, type) {
        if (typeof showNotification === 'function') {
            showNotification(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
            if (type === 'error') {
                alert(message);
            }
        }
    }

    showResults(html, screenshot, applicationNumber) {
        const modal = this.createResultModal();
        modal.querySelector('.modal-title').textContent = `TÜRKPATENT Sorgu Sonuçları - ${applicationNumber}`;
        modal.querySelector('.modal-body').innerHTML = html;
        modal.style.display = 'block';
    }

    createResultModal() {
        let modal = document.getElementById('turkpatent-result-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'turkpatent-result-modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 90vw; max-height: 90vh; overflow: auto;">
                    <div class="modal-header">
                        <h5 class="modal-title">TÜRKPATENT Sorgu Sonuçları</h5>
                        <button class="close" onclick="this.closest('.modal').style.display='none'">&times;</button>
                    </div>
                    <div class="modal-body"></div>
                </div>
            `;
            modal.className = 'modal';
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.5); display: none; align-items: center;
                justify-content: center; z-index: 10001;
            `;
            document.body.appendChild(modal);
        }
        return modal;
    }
}

// ========================================
// 2. BUTON ENTEGRASYONU
// ========================================

// Global instance oluştur
turkpatentIntegration = new PortfolioTurkpatentIntegration();

// Sayfa yüklendiğinde buton event'ini bağla
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        setupTurkpatentButton();
    }, 1000); // Sayfa tamamen yüklendikten sonra
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
    
    // Buton metnini güncelle
    if (tpQueryBtn.textContent.includes('TÜRKPATENT')) {
        tpQueryBtn.innerHTML = '<i class="fas fa-search"></i> TÜRKPATENT\'te Sorgula';
    }
    
    console.log('✅ TÜRKPATENT butonu hazırlandı');
    updateTurkpatentButtonState();
}

async function handleTurkpatentButtonClick(event) {
    event.preventDefault();
    
    const applicationNumber = getApplicationNumberFromPage();
    
    if (!applicationNumber) {
        alert('Başvuru numarası bulunamadı! Bu kayıt için TÜRKPATENT sorgusu yapılamaz.');
        return;
    }
    
    console.log('🔍 Başvuru numarası bulundu:', applicationNumber);
    
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
    
    // 3. DOM'dan input alanlarından
    const appNumberInput = document.getElementById('applicationNumber');
    if (appNumberInput && appNumberInput.value) {
        return appNumberInput.value.trim();
    }
    
    // 4. Hero kartından veri çek
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
    
    // 5. Diğer potansiyel alanlar
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
    
    console.log('⚠️ Başvuru numarası bulunamadı');
    return null;
}

function showQueryMethodDialog() {
    return new Promise((resolve) => {
        const modal = createQueryMethodModal();
        document.body.appendChild(modal);
        
        modal.style.display = 'flex';
        
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

function updateTurkpatentButtonState() {
    const tpQueryBtn = document.getElementById('tpQueryBtn');
    if (!tpQueryBtn) return;
    
    const applicationNumber = getApplicationNumberFromPage();
    
    if (applicationNumber) {
        tpQueryBtn.disabled = false;
        tpQueryBtn.title = `${applicationNumber} numaralı başvuru için TÜRKPATENT sorgusu yap`;
        tpQueryBtn.style.opacity = '1';
        console.log('✅ Buton aktif - Başvuru No:', applicationNumber);
    } else {
        tpQueryBtn.disabled = true;
        tpQueryBtn.title = 'Başvuru numarası bulunamadı';
        tpQueryBtn.style.opacity = '0.6';
        console.log('⚠️ Buton pasif - Başvuru numarası yok');
    }
}

// ========================================
// 3. TEST VE DEBUG FONKSIYONLARI
// ========================================

window.testTurkpatentButton = function() {
    const appNumber = getApplicationNumberFromPage();
    console.log('🔍 Test - Bulunan başvuru numarası:', appNumber);
    
    if (appNumber) {
        console.log('✅ Test başarılı - Popup açılıyor...');
        turkpatentIntegration.queryTurkpatent(appNumber, 'popup');
    } else {
        console.log('❌ Test başarısız - Başvuru numarası bulunamadı');
        console.log('Mevcut veriler:', {
            portfolioData: typeof portfolioData !== 'undefined' ? portfolioData : 'undefined',
            currentRecord: typeof currentRecord !== 'undefined' ? currentRecord : 'undefined',
            inputValue: document.getElementById('applicationNumber')?.value || 'yok'
        });
    }
};

// Sayfa yüklendiğinde otomatik çalıştır
setTimeout(() => {
    if (document.readyState === 'complete') {
        setupTurkpatentButton();
    }
}, 2000);
