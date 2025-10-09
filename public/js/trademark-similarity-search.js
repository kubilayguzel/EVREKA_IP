// js/trademark-similarity-search.js

import { db, personService, searchRecordService, similarityService, ipRecordsService, firebaseServices } from '../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { runTrademarkSearch } from './trademark-similarity/run-search.js';
import Pagination from './pagination.js';
import { loadSharedLayout } from './layout-loader.js';
import { showNotification } from '../utils.js';
import { getStorage, ref, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

console.log("### trademark-similarity-search.js yüklendi ###");

// --- Global State Management (Durum Yönetimi) ---
let allSimilarResults = [];
let monitoringTrademarks = [];
let filteredMonitoringTrademarks = [];
let allPersons = [];
const taskTriggeredStatus = new Map(); // İş Tetiklendi durum haritası
const notificationStatus = new Map();
let pagination;
let monitoringPagination;

const functions = firebaseServices.functions;

const TSS_RESUME_KEY = 'TSS_LAST_STATE_V1';

const tssLoadState = () => {
    try { return JSON.parse(localStorage.getItem(TSS_RESUME_KEY) || '{}'); }
    catch { return {}; }
};

const tssSaveState = (partial) => {
    try {
        const prev = tssLoadState();
        const next = { ...prev, ...partial, updatedAt: new Date().toISOString() };
        localStorage.setItem(TSS_RESUME_KEY, JSON.stringify(next));
        try {
            const uid = firebaseServices?.auth?.currentUser?.uid;
            if (uid) {
                setDoc(doc(db, 'userPreferences', uid + '_tss_last_state'), next, { merge: true });
            }
        } catch (e) { /* silent */ }
    } catch (e) { /* silent */ }
};

const tssClearState = () => {
    try { localStorage.removeItem(TSS_RESUME_KEY); } catch (e) { /* silent */ }
};

const tssBuildStateFromUI = (extra = {}) => {
    const bulletinSelect = document.getElementById('bulletinSelect');
    const bulletinValue = bulletinSelect?.value || '';
    const bulletinText = bulletinSelect?.options?.[bulletinSelect.selectedIndex]?.text || '';
    return { bulletinValue, bulletinText, ...extra };
};

const tssShowResumeBannerIfAny = () => {
    const state = tssLoadState();
    if (!state?.bulletinValue) return;

    let bar = document.getElementById('tssResumeBar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'tssResumeBar';
        bar.style.cssText = [
            'position: fixed', 'right: 20px', 'bottom: 20px', 'z-index: 9999',
            'background: #1e3c72', 'color: #fff', 'padding: 12px 16px',
            'border-radius: 12px', 'box-shadow: 0 8px 20px rgba(0,0,0,0.2)',
            'display: flex', 'gap: 8px', 'align-items: center', 'font-size: 14px'
        ].join(';') + ';';
        document.body.appendChild(bar);
    }

    bar.innerHTML = `
        <span>“${state.bulletinText || 'Seçili bülten'}” → Sayfa ${state.page || 1}</span>
        <button id="tssResumeBtn" style="background:#fff;color:#1e3c72;border:none;padding:6px 10px;border-radius:8px;cursor:pointer">Devam Et</button>
        <button id="tssClearBtn"  style="background:#ff5a5f;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer">Sıfırla</button>
    `;

    document.getElementById('tssClearBtn').onclick = () => { tssClearState(); bar.remove(); };
    document.getElementById('tssResumeBtn').onclick = async () => {
        const resumeState = tssLoadState();
        const targetPage = resumeState.page || 1;
        window.__tssPendingResumeForBulletin = targetPage;
        
        const sel = document.getElementById('bulletinSelect');
        if (sel && sel.value !== resumeState.bulletinValue) {
            sel.value = resumeState.bulletinValue;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const startBtn = document.getElementById('startSearchBtn') || document.getElementById('researchBtn');
        if (startBtn) {
            startBtn.click();
            let tries = 0;
            const iv = setInterval(() => {
                tries++;
                const loadingIndicator = document.getElementById('loadingIndicator');
                const isSearchComplete = loadingIndicator && loadingIndicator.style.display === 'none' && allSimilarResults.length > 0 && pagination;
                
                if (isSearchComplete) {
                    clearInterval(iv);
                    if (pagination.goToPage(targetPage)) {
                        bar.style.background = '#28a745';
                        bar.firstElementChild.textContent = `Devam edildi: Sayfa ${targetPage}`;
                        setTimeout(() => bar.remove(), 2000);
                        window.__tssPendingResumeForBulletin = null;
                    }
                } else if (tries > 300) { // ~30s timeout
                    clearInterval(iv);
                    window.__tssPendingResumeForBulletin = null;
                    console.warn("⚠️ Sayfa geçişi timeout oldu");
                }
            }, 100);
        }
    };
};

window.addEventListener('beforeunload', () => {
    const page = (typeof pagination?.getCurrentPage === 'function') ? pagination.getCurrentPage() : undefined;
    const itemsPerPage = (typeof pagination?.getItemsPerPage === 'function') ? pagination.getItemsPerPage() : undefined;
    const totalResults = Array.isArray(allSimilarResults) ? allSimilarResults.length : 0;
    tssSaveState(tssBuildStateFromUI({ page, itemsPerPage, totalResults }));
});

// --- Element References (DOM Referansları) ---
const startSearchBtn = document.getElementById('startSearchBtn');
const researchBtn = document.getElementById('researchBtn');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const ownerSearchInput = document.getElementById('ownerSearch');
const niceClassSearchInput = document.getElementById('niceClassSearch');
const brandNameSearchInput = document.getElementById('brandNameSearch');
const bulletinSelect = document.getElementById('bulletinSelect');
const resultsTableBody = document.getElementById('resultsTableBody');
const loadingIndicator = document.getElementById('loadingIndicator');
const noRecordsMessage = document.getElementById('noRecordsMessage');
const infoMessageContainer = document.getElementById('infoMessageContainer');
const btnGenerateReport = document.getElementById('btnGenerateReport'); // Bu artık kullanılmayacak
const btnGenerateReportAndNotifyGlobal = document.getElementById('btnGenerateReportAndNotifyGlobal'); // Yeni global buton

// --- Utility Functions (Yardımcı Fonksiyonlar) ---
const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), delay);
    };
};

const _appNoImgCache = new Map();
const _normalizeImageSrc = (u) => {
    if (!u || typeof u !== 'string') return '';
    if (/^(https?:|data:|blob:)/i.test(u)) return u;
    if (/^[A-Za-z0-9+/=]+$/.test(u.slice(0, 100))) return 'data:image/png;base64,' + u;
    return u;
};

const _getBrandImageByAppNo = async (appNo) => {
    if (!appNo) return '';
    if (_appNoImgCache.has(appNo)) return _appNoImgCache.get(appNo) || '';
    
    let url = '';
    const bulletinDocId = document.getElementById('bulletinSelect')?.value;

    try {
        // 1. monitoringTrademarkRecords alt koleksiyonunda ara
        if (bulletinDocId) {
            const trademarksRef = collection(db, 'monitoringTrademarkRecords', bulletinDocId, 'trademarks');
            const q = query(trademarksRef, where('applicationNo', '==', appNo), limit(1));
            const snap = await getDocs(q);
            
            if (!snap.empty) {
                const data = snap.docs[0].data();
                if (data.imagePath) {
                    // Firebase Storage yolunu oluştur
                    const storageRef = ref(getStorage(), data.imagePath);
                    url = await getDownloadURL(storageRef);
                }
            }
        }
    } catch (err) {
            // Hata durumunda konsola uyarı basabilirsin
            console.error('[TSS] _getBrandImageByAppNo (monitoring) error:', err);
    }
    
    // 2. Eğer üstteki yol başarısız olursa, ipRecords koleksiyonunda ara
    if (!url) {
        try {
            const col = collection(db, 'ipRecords');
            const q = query(col, where('applicationNumber', '==', appNo), limit(1));
            const snap = await getDocs(q);
            if (!snap.empty) {
                const data = snap.docs[0].data();
                const candidate = data.brandImageUrl || data.brandImage || (data.details?.brandInfo?.brandImage) || (data.trademarkImage?.url || data.trademarkImage?.content) || '';
                url = _normalizeImageSrc(candidate);
            }
        } catch (err) {
            // Hata durumunda konsola uyarı basabilirsin
            console.error('[TSS] _getBrandImageByAppNo (ipRecords) error:', err);
        }
    }

    _appNoImgCache.set(appNo, url);
    return url;
};

const _ipCache = new Map();
const _getIp = async (recordId) => {
    if (!recordId) return null;
    if (_ipCache.has(recordId)) return _ipCache.get(recordId);
    try {
        const { success, data } = await ipRecordsService.getRecordById(recordId);
        _ipCache.set(recordId, success ? data : null);
        return success ? data : null;
    } catch {
        _ipCache.set(recordId, null);
        return null;
    }
};

const _pickName = (ip, tm) => ip?.markName || ip?.title || ip?.brandText || tm?.title || tm?.markName || tm?.brandText || '-';
const _pickImg = (ip, tm) => ip?.brandImageUrl || tm?.brandImageUrl || tm?.details?.brandInfo?.brandImage || '';
const _pickAppNo = (ip, tm) => ip?.applicationNumber || ip?.applicationNo || tm?.applicationNumber || tm?.applicationNo || '-';

// === Added Helpers: total count per monitored mark & header image resolver ===
const getTotalCountForMonitoredId = (monitoredTrademarkId) => {
    try {
        if (!monitoredTrademarkId) return 0;
        return allSimilarResults.reduce((acc, r) => acc + (r.monitoredTrademarkId === monitoredTrademarkId ? 1 : 0), 0);
    } catch (e) {
        console.warn('[TSS] getTotalCountForMonitoredId error:', e);
        return 0;
    }
};

const resolveGroupHeaderImage = async (tmMeta, rowEl) => {
    try {
        if (!tmMeta || !rowEl) return;
        let imgEl = rowEl.querySelector('.group-header-img');
        const placeholder = rowEl.querySelector('.group-header-placeholder');
        if (imgEl?.dataset.resolved === '1' || placeholder?.dataset.resolved == '1') return;

        let src = _pickImg(null, tmMeta);

        if (!src) {
            const ip = await _getIp(tmMeta.ipRecordId || tmMeta.sourceRecordId || tmMeta.id);
            src = _pickImg(ip, tmMeta);
            if (!src) {
                const appNo = _pickAppNo(ip, tmMeta);
                if (appNo && appNo !== '-') {
                    src = await _getBrandImageByAppNo(appNo);
                }
            }
        }
        if (src) {
            if (!imgEl) {
                const container = rowEl.querySelector('.group-trademark-image');
                const newImg = document.createElement('img');
                newImg.className = 'group-header-img';
                newImg.alt = _pickName(null, tmMeta) || 'Marka Görseli';
                newImg.dataset.resolved = '1';
                newImg.src = src;
                if (placeholder) container.replaceChild(newImg, placeholder);
                else container.appendChild(newImg);
            } else {
                imgEl.src = src;
                imgEl.dataset.resolved = '1';
                if (placeholder) placeholder.remove();
            }
        } else {
            if (placeholder) placeholder.dataset.resolved = '1';
            if (imgEl) imgEl.dataset.resolved = '1';
        }
    } catch (e) {
        console.warn('[TSS] resolveGroupHeaderImage error:', e);
    }
};


const _pickAppDate = (ip, tm) => {
    const v = ip?.applicationDate || tm?.applicationDate;
    if (!v) return '-';
    try {
        const d = (v && typeof v === 'object' && typeof v.toDate === 'function') ? v.toDate() : (v && typeof v === 'object' && 'seconds' in v) ? new Date(v.seconds * 1000) : new Date(v);
        return isNaN(+d) ? '-' : d.toLocaleDateString('tr-TR');
    } catch { return '-'; }
};

// Sahibi gruplamak için benzersiz bir anahtar ve adı döndürür
const _getOwnerKey = (ip, tm, persons = []) => {
  const firstApplicant = ip?.applicants?.[0] || tm?.applicants?.[0] || null;
  if (firstApplicant?.id) {
    const person = persons.find(p => p.id === firstApplicant.id);
    const name = person?.name || firstApplicant.name || firstApplicant.title || 'Bilinmeyen Sahip';
    return { key: `${firstApplicant.id}_${name}`, id: firstApplicant.id, name };
  }
  // 2) IP yoksa/ID yoksa:
  const ownerName = _pickOwners(ip, tm, persons);
  return {
    key: ownerName || 'Bilinmeyen Sahip',
    id: (ip?.clientId || tm?.clientId || 'unknown_group'),
    name: ownerName || 'Bilinmeyen Sahip'
  };
};

// --- İş Tetiklendi durumunu Firestore'dan okuyan yardımcı ---
const refreshTriggeredStatus = async (bulletinNo) => {
  try {
    taskTriggeredStatus.clear();
    if (!bulletinNo) {
      console.warn('[TSS] refreshTriggeredStatus: bulletinNo boş');
      return;
    }
    
    console.log('[TSS] refreshTriggeredStatus başladı:', { bulletinNo });
    
    // ✅ bulletinNo details.bulletinNo içinde, üst seviyede yok - tüm işleri çek ve filtrele
    const qTasks = query(
      collection(db, 'tasks'),
      where('taskType', '==', '20'),
      where('status', '==', 'awaiting_client_approval')
    );
    
    const snap = await getDocs(qTasks);
    console.log('[TSS] Query sonucu:', { totalTasks: snap.size });
    
    if (snap.empty) {
      console.warn('[TSS] Hiç iş bulunamadı');
      return;
    }

    // Client-side filtreleme: details.bulletinNo kontrolü
    const relevantTasks = snap.docs.filter(d => {
      const data = d.data();
      const taskBulletinNo = data?.details?.bulletinNo || data?.bulletinNo || '';
      const matches = String(taskBulletinNo) === String(bulletinNo);
      if (matches) {
        console.log('[TSS] Bülten eşleşti:', { 
          taskId: d.id, 
          bulletinNo: taskBulletinNo,
          monitoredMarkId: data?.details?.monitoredMarkId || data?.monitoredMarkId
        });
      }
      return matches;
    });
    
    console.log('[TSS] Bülten eşleşen işler:', { 
      relevantCount: relevantTasks.length,
      totalCount: snap.size 
    });

    if (relevantTasks.length === 0) {
      console.warn('[TSS] Bu bülten için hiç iş bulunamadı');
      return;
    }

    const tmById = new Map(monitoringTrademarks.map(tm => [tm.id, tm]));
    
    for (const docSnap of relevantTasks) {
      const t = docSnap.data();
      // monitoredMarkId de details içinde olabilir
      const monitoredMarkId = t?.details?.monitoredMarkId || t?.monitoredMarkId;
      
      if (!monitoredMarkId) {
        console.warn('[TSS] İş için monitoredMarkId bulunamadı:', { taskId: docSnap.id });
        continue;
      }
      
      const tm = tmById.get(monitoredMarkId);
      if (!tm) {
        console.warn('[TSS] Monitoring trademark bulunamadı:', { monitoredMarkId });
        continue;
      }
      
      const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
      const ownerInfo = _getOwnerKey(ip, tm, allPersons);
      
      if (ownerInfo?.id) {
        taskTriggeredStatus.set(ownerInfo.id, 'Evet');
        console.log('[TSS] ✅ Sahip için iş tetiklendi:', { 
          ownerId: ownerInfo.id, 
          ownerName: ownerInfo.name,
          taskId: docSnap.id 
        });
      }
    }
    
    console.log('[TSS] ✅ refreshTriggeredStatus tamamlandı:', { 
      mapSize: taskTriggeredStatus.size,
      owners: Array.from(taskTriggeredStatus.entries())
    });
    
  } catch (e) {
    console.error('[TSS] ❌ refreshTriggeredStatus error:', e);
  }
};

// Akordeon açma/kapama olay dinleyicisini ekler
const attachMonitoringAccordionListeners = () => {
    const ownerRows = document.querySelectorAll('#monitoringListBody .owner-row');
    ownerRows.forEach(row => {
        row.addEventListener('click', function(e) {
            // Eylem butonuna tıklanırsa akordeonu engelle
            if (e.target.closest('.action-btn')) {
                return;
            }
            
            const targetId = this.dataset.target;
            const targetRow = document.querySelector(targetId);
            const icon = this.querySelector('.toggle-icon');
            
            if (targetRow) {
                const isExpanded = this.getAttribute('aria-expanded') === 'true';
                
                if (isExpanded) {
                    targetRow.style.display = 'none';
                    this.setAttribute('aria-expanded', 'false');
                    icon.classList.remove('fa-chevron-up');
                    icon.classList.add('fa-chevron-down');
                } else {
                    targetRow.style.display = 'table-row'; // İçerik satırını göster
                    this.setAttribute('aria-expanded', 'true');
                    icon.classList.remove('fa-chevron-down');
                    icon.classList.add('fa-chevron-up');
                }
            }
        });
    });
};
const _pickOwners = (ip, tm, persons = []) => {
    if (Array.isArray(ip?.applicants) && ip.applicants.length) {
        return ip.applicants.map(a => a?.name).filter(Boolean).join(', ');
    }
    if (Array.isArray(ip?.owners) && ip.owners.length) {
        return ip.owners.map(o => (typeof o === 'object' ? (o.name || o.displayName || persons.find(p => p.id === o.id)?.name) : String(o))).filter(Boolean).join(', ');
    }
    if (ip?.ownerName) return ip.ownerName;
    if (Array.isArray(tm?.applicants) && tm.applicants.length) {
        return tm.applicants.map(a => a?.name).filter(Boolean).join(', ');
    }
    if (Array.isArray(tm?.owners) && tm.owners.length) {
        return tm.owners.map(o => (typeof o === 'object' ? (o.name || o.displayName || persons.find(p => p.id === o.id)?.name) : String(o))).filter(Boolean).join(', ');
    }
    if (typeof tm?.holders === 'string') return tm.holders;
    return '-';
};
const _uniqNice = (obj) => {
    const set = new Set();
    (obj?.goodsAndServicesByClass || []).forEach(c => c?.classNo != null && set.add(String(c.classNo)));
    (obj?.niceClasses || []).forEach(n => set.add(String(n)));
    if (obj?.niceClass) String(obj.niceClass).split(/[,\s]+/).forEach(n => n && set.add(n));
    return Array.from(set).sort((a, b) => Number(a) - Number(b)).join(', ');
};

const getNiceClassNumbers = (item) => {
    if (item.goodsAndServicesByClass && Array.isArray(item.goodsAndServicesByClass)) {
        return item.goodsAndServicesByClass.map(classItem => String(classItem.classNo)).filter(classNo => classNo !== null && classNo !== undefined && classNo !== 'null');
    }
    return [];
};
const getApplicationDateFormatted = (item) => {
    try {
        const date = (item.applicationDate?.toDate && typeof item.applicationDate.toDate === 'function') ? item.applicationDate.toDate() : new Date(item.applicationDate);
        return !isNaN(date.getTime()) ? date.toLocaleDateString('tr-TR') : '-';
    } catch {
        return '-';
    }
};

// --- MODAL İÇİN YARDIMCI FONKSİYONLAR - monitoring-trademarks.html'den kopyalandı ---
function setupEditCriteriaModal() {
    const brandTextSearchInput = document.getElementById('brandTextSearchInput');
    const addBrandTextBtn = document.getElementById('addBrandTextBtn');
    const brandTextSearchList = document.getElementById('brandTextSearchList');
    const niceClassSelectionContainer = document.getElementById('niceClassSelectionContainer');
    const niceClassSearchList = document.getElementById('niceClassSearchList');
    const saveCriteriaBtn = document.getElementById('saveCriteriaBtn');
    
    // Nice Sınıfı kutularını dinamik olarak oluştur
    for (let i = 1; i <= 45; i++) {
        const box = document.createElement('div');
        box.className = 'nice-class-box';
        box.textContent = i;
        box.dataset.classNo = i;
        niceClassSelectionContainer.appendChild(box);
    }
    
    // Nice Sınıfı kutularına tıklama olayı
    niceClassSelectionContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('nice-class-box')) {
            const classNo = e.target.dataset.classNo;
            const isPermanent = e.target.classList.contains('permanent-item'); // Kalıcı olup olmadığını kontrol et
            
            if (isPermanent) {
                showNotification('Bu sınıf orijinal marka sınıfı olduğu için kaldırılamaz.', 'warning');
                return;
            }
            
            e.target.classList.toggle('selected');
            
            if (e.target.classList.contains('selected')) {
                addListItem(niceClassSearchList, classNo);
            } else {
                removeListItem(niceClassSearchList, classNo);
            }
        }
    });

    // Marka Adı ekle
    const addBrandText = () => {
        const value = brandTextSearchInput.value.trim();
        if (value) {
            addListItem(brandTextSearchList, value);
            brandTextSearchInput.value = '';
        }
    };
    addBrandTextBtn.addEventListener('click', addBrandText);
    brandTextSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addBrandText();
        }
    });

    // Kayıtları silme (tüm listeler için genel)
    document.querySelectorAll('.list-group').forEach(list => {
        list.addEventListener('click', (e) => {
            const listItem = e.target.closest('li');
            if (listItem && e.target.classList.contains('remove-item')) {
                if (listItem.classList.contains('permanent-item')) {
                    showNotification('Bu öğe orijinal marka bilgisi olduğu için kaldırılamaz.', 'warning');
                    return;
                }
                const textContent = listItem.querySelector('.list-item-text').textContent;
                listItem.remove();
                if (list.id === 'niceClassSearchList') {
                    const box = document.querySelector(`.nice-class-box[data-class-no="${textContent}"]`);
                    if (box) box.classList.remove('selected');
                }
                if (list.children.length === 0) {
                    const emptyItem = document.createElement('li');
                    emptyItem.className = "list-group-item text-muted";
                    emptyItem.textContent = list.id === 'brandTextSearchList' ? 'Aranacak marka adı listesi.' : 'Aranacak Nice Sınıfı listesi.';
                    list.appendChild(emptyItem);
                }
            }
        });
    });
    
    // Kaydetme İşlemi
    saveCriteriaBtn.addEventListener('click', async () => {
        const modal = document.getElementById('editCriteriaModal');
        const brandTextArray = Array.from(modal.querySelector('#brandTextSearchList').querySelectorAll('.list-item-text')).map(el => el.textContent);
        const niceClassArray = Array.from(modal.querySelector('#niceClassSearchList').querySelectorAll('.list-item-text')).map(el => parseInt(el.textContent)).filter(n => !isNaN(n));
        const originalMarkId = modal.dataset.markId;

        if (!originalMarkId) {
            showNotification('Orijinal marka kimliği bulunamadı. İşlem iptal edildi.', 'error');
            return;
        }

        try {
            const res = await monitoringService.updateMonitoringItem(originalMarkId, {
                brandTextSearch: brandTextArray,
                niceClassSearch: niceClassArray
            });
            if (res.success) {
                showNotification('İzleme kriterleri başarıyla güncellendi.', 'success');
                $('#editCriteriaModal').modal('hide');
            } else {
                showNotification('Kriterler güncellenirken hata oluştu: ' + res.error, 'error');
            }
        } catch (error) {
            console.error('Kriter kaydetme hatası:', error);
            showNotification('Kriterler güncellenirken beklenmeyen bir hata oluştu.', 'error');
        }
    });
}

function populateNiceClassBoxes(selectedClasses, permanentClasses = []) {
    document.querySelectorAll('.nice-class-box').forEach(box => {
        if (box) {
            box.classList.remove('selected');
            box.classList.remove('permanent-item');
        }
    });

    const selectedClassesString = (selectedClasses || []).map(cls => String(cls)).filter(cls => cls !== 'null' && cls !== 'undefined' && cls.trim() !== '');
    const permanentClassesString = (permanentClasses || []).map(cls => String(cls)).filter(cls => cls !== 'null' && cls !== 'undefined' && cls.trim() !== '');
    const allNiceClasses = new Set([...selectedClassesString, ...permanentClassesString]);

    const niceClassSearchList = document.getElementById('niceClassSearchList');
    if (niceClassSearchList) {
        populateList(niceClassSearchList, [], permanentClassesString);
    }

    allNiceClasses.forEach(cls => {
        const classNum = parseInt(cls);
        if (isNaN(classNum) || (classNum < 1 || classNum > 45) && classNum !== 99) {
            console.warn(`Geçersiz sınıf numarası: ${cls}`);
            return;
        }

        const box = document.querySelector(`.nice-class-box[data-class-no="${cls}"]`);
        if (box) {
            box.classList.add('selected');
            
            if (permanentClassesString.includes(cls)) {
                box.classList.add('permanent-item');
            }
            
            if (niceClassSearchList) {
                const listItem = addListItem(niceClassSearchList, cls);
                if (listItem && permanentClassesString.includes(cls)) {
                    listItem.classList.add('permanent-item');
                }
            }
        } else {
            console.warn(`Nice class number ${cls} could not be found in the UI.`);
        }
    });
}

function addListItem(listElement, text, isPermanent = false) {
    const emptyItem = listElement.querySelector('.list-group-item.text-muted');
    if (emptyItem) {
        emptyItem.remove();
    }
    
    const existingItems = Array.from(listElement.querySelectorAll('.list-item-text')).map(el => el.textContent);
    if (existingItems.includes(text)) {
        return;
    }

    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    if (isPermanent) {
        li.classList.add('permanent-item');
    }
    li.innerHTML = `<span class="list-item-text">${text}</span><button type="button" class="btn btn-sm btn-danger remove-item">&times;</button>`;
    listElement.appendChild(li);
    return li;
}

function removeListItem(listElement, text) {
    const items = listElement.querySelectorAll('li');
    for (let item of items) {
        if (item.querySelector('.list-item-text').textContent === text) {
            if (item.classList.contains('permanent-item')) {
                 showNotification('Bu öğe orijinal marka bilgisi olduğu için kaldırılamaz.', 'warning');
                 return;
            }
            item.remove();
            break;
        }
    }
    if (listElement.children.length === 0) {
         const emptyItem = document.createElement('li');
         emptyItem.className = "list-group-item text-muted";
         emptyItem.textContent = listElement.id === 'brandTextSearchList' ? 'Aranacak marka adı listesi.' : 'Aranacak Nice Sınıfı listesi.';
         listElement.appendChild(emptyItem);
    }
}

function populateList(listElement, items, permanentItems = []) {
    listElement.innerHTML = '';
    const allItems = new Set([...items.map(String), ...permanentItems.map(String)]);
    if (allItems.size > 0) {
        allItems.forEach(item => {
            const isPermanent = permanentItems.includes(item);
            addListItem(listElement, item, isPermanent);
        });
    } else {
        const emptyItem = document.createElement('li');
        emptyItem.className = "list-group-item text-muted";
        emptyItem.textContent = listElement.id === 'brandTextSearchList' ? 'Aranacak marka adı listesi.' : 'Aranacak Nice Sınıfı listesi.';
        listElement.appendChild(emptyItem);
    }
}
// --- MODAL İÇİN YARDIMCI FONKSİYONLARIN SONU ---

// --- Hover Efektleri (DOM) ---
function setupImageHoverEffect(tbodyId = 'monitoringListBody') {
  const tbody = document.getElementById(tbodyId);
  if (!tbody || tbody._imageHoverSetup) return;
  tbody._imageHoverSetup = true;

  let popup = null;

  function removeLegacyPopups() {
    document.querySelectorAll('.trademark-image-hover-full').forEach(el => el.remove());
  }

  function cleanup() {
    if (popup) { popup.remove(); popup = null; }
    removeLegacyPopups();
  }

  function showPopup(thumbnail) {
    cleanup();
    const rect = thumbnail.getBoundingClientRect();
    const scale = 1.5;

    const p = document.createElement('div');
    p.className = 'tm-hover-popup';

    const img = document.createElement('img');
    img.src = thumbnail.src;
    img.alt = thumbnail.alt || '';
    img.draggable = false;
    img.style.width  = Math.round(rect.width * scale) + 'px';
    img.style.height = 'auto';

    p.appendChild(img);
    document.body.appendChild(p);
    popup = p;

    const gap = 12;
    let left = rect.right + gap;
    let top  = rect.top;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pr = popup.getBoundingClientRect();

    if (left + pr.width > vw - 8) {
      left = rect.left - gap - pr.width;
    }
    if (top + pr.height > vh - 8) {
      top = Math.max(8, vh - 8 - pr.height);
    }
    if (top < 8) top = 8;

    popup.style.position = 'fixed';
    popup.style.left = String(Math.round(left)) + 'px';
    popup.style.top  = String(Math.round(top)) + 'px';
    popup.style.pointerEvents = 'none';
    popup.style.zIndex = '99999';
  }

  function handleEnter(e) {
    const thumbnail = e.target.closest('.trademark-image-thumbnail-large');
    if (!thumbnail) return;
    showPopup(thumbnail);
  }
  function handleLeave() { cleanup(); }

  tbody.addEventListener('mouseenter', handleEnter, true);
  tbody.addEventListener('mouseleave', handleLeave, true);
}

// js/trademark-similarity-search.js (renderMonitoringList fonksiyonunun güncellenmiş hali)

const renderMonitoringList = async () => {
    const tbody = document.getElementById('monitoringListBody');
    const list = monitoringPagination ? monitoringPagination.getCurrentPageData(filteredMonitoringTrademarks) : filteredMonitoringTrademarks;
    
    if (!list.length) {
        // Colspan'ı 5'e ayarlayın (Toggle, Sahip, Sayı, Bildirim Durumu, Eylemler)
        tbody.innerHTML = '<tr><td colspan="6" class="no-records">Filtreye uygun izlenecek marka bulunamadı.</td></tr>';
        return;
    }

    // 1. Markaları Sahip Bazında Grupla (Mantık aynı kalır)
    const groupedByOwner = {};
    for (const tm of list) {
        const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
        const ownerInfo = _getOwnerKey(ip, tm, allPersons);
        const ownerKey = ownerInfo.key;

        if (!groupedByOwner[ownerKey]) {
            groupedByOwner[ownerKey] = {
                ownerName: ownerInfo.name,
                ownerId: ownerInfo.id,
                trademarks: [],
                allNiceClasses: new Set()
            };
        }
        
        const nices = _uniqNice(ip || tm).split(', ').map(s => s.trim()).filter(Boolean);
        nices.forEach(n => groupedByOwner[ownerKey].allNiceClasses.add(n));

        groupedByOwner[ownerKey].trademarks.push({ tm, ip, ownerInfo });
    }

    let allRowsHtml = [];

    // Yeni varsayılan bildirim durumu
    const initialNotificationStatus = 'Gönderilmedi';

    for (const ownerKey in groupedByOwner) {
        const group = groupedByOwner[ownerKey];
        const groupUid = `owner-group-${group.ownerId}-${ownerKey.replace(/[^a-zA-Z0-9]/g, '').slice(-10)}`;
        
// ✅ 6 kolona çıktı: İş Tetiklendi eklendi
    const headerRow = `
    <tr class="owner-row" data-toggle="collapse" data-target="#${groupUid}" aria-expanded="false" aria-controls="${groupUid}" style="cursor: pointer;">
    <td style="width:5%;text-align:center;color:#1e3c72;"><i class="fas fa-chevron-down toggle-icon"></i></td>
    <td style="width:35%;text-align:left;">${group.ownerName}</td>
    <td style="width:10%;text-align:center;">${group.trademarks.length}</td>

    <!-- İŞ TETİKLENDİ -->
    <td style="width:15%;text-align:center;">
        <span class="task-triggered-status trigger-status-badge ${taskTriggeredStatus.get(group.ownerId)==='Evet' ? 'trigger-yes' : 'trigger-no'}"
            data-owner-id="${group.ownerId}">
        ${taskTriggeredStatus.get(group.ownerId)==='Evet' ? 'Evet' : 'Hayır'}
        </span>
    </td>

    <!-- BİLDİRİM DURUMU -->
    <td style="width:15%;text-align:center;">
        <span class="notification-status-badge ${notificationStatus.get(group.ownerId) === 'Gönderildi' ? 'sent-status' : 'initial-status'}" 
              data-owner-id="${group.ownerId}">
        ${notificationStatus.get(group.ownerId) || 'Gönderilmedi'}
        </span>
    </td>

    <!-- EYLEMLER -->
    <td style="width:20%;text-align:center;">
        <div class="btn-group">
        <button class="action-btn btn-success generate-report-and-notify-btn"
                data-owner-id="${group.ownerId}"
                data-owner-name="${group.ownerName}"
                title="Rapor Oluştur ve Müşteriye Bildir">
            <i class="fas fa-paper-plane"></i> Rapor Oluştur ve Bildir
        </button>
        <button class="action-btn btn-primary generate-report-btn"
                data-owner-id="${group.ownerId}"
                data-owner-name="${group.ownerName}"
                title="${group.ownerName} için benzerlik raporu oluştur (Sadece İndir)">
            <i class="fas fa-file-pdf"></i> Rapor Oluştur
        </button>
        </div>
    </td>
    </tr>
    `;
        allRowsHtml.push(headerRow);

        // Akordeon İçeriği (İç Tablo Satırları) - DETAY yapısı (6 kolonlu) KORUNDU
        const detailRowsHtml = group.trademarks.map(({ tm, ip }) => {
            const [markName, imgSrc, appNo, nices, appDate] = [
                _pickName(ip, tm), 
                _pickImg(ip, tm), 
                _pickAppNo(ip, tm), 
                _uniqNice(ip || tm), 
                _pickAppDate(ip, tm)
            ];
            
            // Görsel boyutu 100px
            const imgStyle = 'width: 100px; height: 100px;';
            
            return `
                <tr class="trademark-detail-row" style="background-color: #ffffff;">
                    <td></td> <td style="text-align: left;">${markName}</td>
                    <td style="text-align: center;">${imgSrc ? `<div class="trademark-image-wrapper-large" style="${imgStyle}"><img class="trademark-image-thumbnail-large" src="${imgSrc}" alt="Marka Görseli" style="${imgStyle}"></div>` : `<div class="no-image-placeholder-large" style="${imgStyle}">-</div>`}</td>
                    <td style="text-align: center;">${appNo}</td>
                    <td style="text-align: left;">${nices || '-'}</td> <td style="text-align: center;">${appDate}</td>
                </tr>
            `;
        }).join('');

        // Gizli İçerik Satırı (colspan'ı 5'e ayarlayın, ana tabloya uyması için)
        const contentRow = `
            <tr id="${groupUid}" class="accordion-content-row" style="display: none;">
                <td colspan="6" style="padding: 0;">
                    <table class="table table-sm" style="margin: 0; background-color: transparent;">
                        <thead>
                            <tr>
                                <th style="width: 5%;"></th>
                                <th style="width: 30%; text-align: left;">Marka Adı</th>
                                <th style="width: 15%; text-align: center;">Görsel</th>
                                <th style="width: 15%; text-align: center;">Başvuru No</th>
                                <th style="width: 25%; text-align: left;">Nice Sınıfı</th>
                                <th style="width: 10%; text-align: center;">Başvuru Tarihi</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${detailRowsHtml}
                        </tbody>
                    </table>
                </td>
            </tr>
        `;
        allRowsHtml.push(contentRow);
    }
    
    tbody.innerHTML = allRowsHtml.join('');
    
    attachMonitoringAccordionListeners();
    attachGenerateReportListener();
    setupImageHoverEffect('monitoringListBody');

    // YENİ: Badge'leri kalıcı durumdan güncelle (render sonrası double-check)
    setTimeout(() => {
        console.log('🔄 Badge güncelleme başladı...', { 
            mapSize: taskTriggeredStatus.size,
            mapContent: Array.from(taskTriggeredStatus.entries())
        });
        
        document.querySelectorAll('#monitoringListBody .owner-row').forEach(row => {
            const btn = row.querySelector('.generate-report-and-notify-btn');
            if (!btn || !btn.dataset.ownerId) return;
            
            const ownerId = btn.dataset.ownerId;
            const badge = row.querySelector('.task-triggered-status, .trigger-status-badge');
            if (!badge) {
                console.warn('⚠️ Badge bulunamadı:', { ownerId });
                return;
            }
            
            const hasTriggered = taskTriggeredStatus.get(ownerId) === 'Evet';
            badge.textContent = hasTriggered ? 'Evet' : 'Hayır';
            badge.classList.toggle('trigger-yes', hasTriggered);
            badge.classList.toggle('trigger-no', !hasTriggered);
            badge.classList.toggle('text-success', hasTriggered);
            badge.classList.toggle('font-weight-bold', hasTriggered);
            badge.classList.toggle('text-danger', !hasTriggered);
            
            console.log('✅ Badge güncellendi:', { 
                ownerId, 
                hasTriggered,
                badgeText: badge.textContent 
            });
        });
    }, 100); // Render tamamlandıktan sonra
};


// --- YENİ RAPOR OLUŞTURMA İŞLEYİCİSİ ---

const attachGenerateReportListener = () => {
    console.log('🔧 Event listener bağlanıyor...');
    
    // SADECE İNDİR (generate-report-btn) - Sadece rapor indirir
    const downloadBtns = document.querySelectorAll('.generate-report-btn');
    console.log('📥 İndirme butonları bulundu:', downloadBtns.length);
    downloadBtns.forEach((btn, index) => {
        btn.removeEventListener('click', handleOwnerReportGeneration);
        btn.addEventListener('click', handleOwnerReportGeneration);
        console.log(`✅ İndirme butonu [${index}] bağlandı:`, btn.dataset);
    });

    // OLUŞTUR VE BİLDİR (generate-report-and-notify-btn) - İş oluşturur + rapor indirir
    const notifyBtns = document.querySelectorAll('.generate-report-and-notify-btn');
    console.log('📧 Bildirim butonları bulundu:', notifyBtns.length);
    notifyBtns.forEach((btn, index) => {
        btn.removeEventListener('click', handleOwnerReportAndNotifyGeneration);
        btn.addEventListener('click', handleOwnerReportAndNotifyGeneration);
        console.log(`✅ Bildirim butonu [${index}] bağlandı:`, btn.dataset);
    });
};

// trademark-similarity-search.js (handleOwnerReportAndNotifyGeneration fonksiyonunun YENİ HALİ)

const handleOwnerReportAndNotifyGeneration = async (event) => {
  event.stopPropagation();

  const btn = event.currentTarget;
  const ownerId = btn.dataset.ownerId;
  const ownerName = btn.dataset.ownerName;
  const bulletinKey = document.getElementById('bulletinSelect')?.value;

  console.log('🔵 [1] Fonksiyon başladı', { ownerId, ownerName, bulletinKey });

  if (!bulletinKey) {
    console.log('❌ [1.1] Bülten seçilmemiş');
    showNotification('Lütfen rapor oluşturmak için bir bülten seçin.', 'error');
    return;
  }
  const bulletinNo = String(bulletinKey).split('_')[0];

  // 1) SAHİBE AİT İZLENEN MARKALARI TOPLA
  console.log('🔵 [2] Filtreleme başlıyor...', { totalMonitoringTrademarks: monitoringTrademarks.length });
  const ownerMonitoredIds = [];
  for (const tm of monitoringTrademarks) {
    const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
    const ownerInfo = _getOwnerKey(ip, tm, allPersons);
    if (ownerInfo.id === ownerId) ownerMonitoredIds.push(tm.id);
  }

  console.log('🔵 [3] Filtreleme tamamlandı', { ownerMonitoredIds, count: ownerMonitoredIds.length });

  const filteredResults = allSimilarResults.filter(
    (r) => ownerMonitoredIds.includes(r.monitoredTrademarkId) && r.isSimilar === true
  );

  console.log('🔵 [4] Benzer sonuçlar filtrelendi', {
    totalResults: allSimilarResults.length,
    filteredCount: filteredResults.length,
    sample: filteredResults.slice(0, 2).map((r) => ({
      markName: r.markName,
      isSimilar: r.isSimilar,
      monitoredTrademarkId: r.monitoredTrademarkId,
    })),
  });

  if (filteredResults.length === 0) {
    console.log('⚠️ [4.1] Benzer sonuç bulunamadı');
    showNotification(`${ownerName} için seçili bültende benzer (isSimilar=true) marka sonucu bulunamadı.`, 'warning');
    return;
  }

  // 2) İŞ OLUŞTURMA + RAPOR
  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> İşleniyor...';

    let createdTaskCount = 0;
    const callerEmail = firebaseServices.auth.currentUser?.email || 'anonim@evreka.com';
    const createObjectionTaskFn = httpsCallable(functions, 'createObjectionTask');

    console.log('🔵 [5] İtiraz işleri oluşturuluyor...', {
      totalResults: filteredResults.length,
      callerEmail,
      bulletinNo,
    });

    // Her benzer sonuç için bir yayına itiraz işi oluştur
    for (let i = 0; i < filteredResults.length; i++) {
      const r = filteredResults[i];
      
      // ✅ KONTROL: Bu benzer marka için daha önce iş oluşturulmuş mu?
      try {
        console.log(`🔍 [6.${i + 1}] İş kontrolü yapılıyor...`, {
          applicationNo: r.applicationNo,
          monitoredMarkId: r.monitoredTrademarkId
        });
        
        // Firestore'da aynı benzer marka (applicationNo) ve aynı müvekkil (clientId) için iş var mı?
        // Status önemli değil - herhangi bir durumda olsa bile tekrar oluşturma
        const existingTaskQuery = query(
          collection(db, 'tasks'),
          where('taskType', '==', '20')
        );
        
        const existingTaskSnap = await getDocs(existingTaskQuery);
        
        console.log(`🔍 [6.${i + 1}] İş kontrolü yapılıyor...`, {
          applicationNo: r.applicationNo,
          ownerId: ownerId
        });
        
        // Client-side filtreleme: applicationNo + ownerId kontrolü
        // Firestore'daki işlerde clientId saklanıyor, biz de ownerId ile karşılaştırıyoruz
        const duplicateTask = existingTaskSnap.docs.find(doc => {
          const data = doc.data();
          const targetAppNo = data?.details?.targetAppNo || '';
          const taskClientId = data?.clientId || '';
          
          // Aynı benzer marka + aynı sahip = duplikasyon
          const matches = (
            String(targetAppNo) === String(r.applicationNo) &&
            String(taskClientId) === String(ownerId)
          );
          
          if (matches) {
            console.log(`🔍 [6.${i + 1}] Eşleşme bulundu:`, {
              taskId: doc.id,
              targetAppNo,
              taskClientId,
              searchOwnerId: ownerId,
              taskStatus: data?.status
            });
          }
          
          return matches;
        });
        
        if (duplicateTask) {
          console.warn(`⚠️ [6.${i + 1}] Bu marka için zaten iş mevcut, atlanıyor`, {
            existingTaskId: duplicateTask.id,
            applicationNo: r.applicationNo,
            markName: r.markName,
            status: duplicateTask.data()?.status
          });
          continue; // Bu markayı atla, bir sonrakine geç
        }
        
        console.log(`✅ [6.${i + 1}] Yeni iş oluşturulacak`, {
          applicationNo: r.applicationNo,
          markName: r.markName
        });
        
        // İş oluştur
        const taskResponse = await createObjectionTaskFn({
          monitoredMarkId: r.monitoredTrademarkId,
          similarMark: {
            applicationNo: r.applicationNo,
            markName: r.markName,
            niceClasses: r.niceClasses,
            similarityScore: r.similarityScore,
          },
          similarMarkName: r.markName,
          bulletinNo,
          callerEmail,
        });

        console.log(`✅ [6.${i + 1}] CF yanıtı`, {
          index: i + 1,
          taskId: taskResponse?.data?.taskId,
          success: taskResponse?.data?.success,
          message: taskResponse?.data?.message,
        });

        if (taskResponse?.data?.success) createdTaskCount++;
        
      } catch (e) {
        console.error(`❌ [6.${i + 1}] İtiraz işi oluşturma hatası`, {
          index: i + 1,
          markName: r.markName,
          errorMessage: e?.message,
          errorCode: e?.code,
          errorDetails: e?.details,
        });
      }
    }

    console.log('🔵 [7] İş oluşturma tamamlandı', {
      successCount: createdTaskCount,
      failureCount: filteredResults.length - createdTaskCount,
    });

    // Raporu hazırla/indir (işten bağımsız)
    console.log('🔵 [8] Rapor oluşturuluyor...');
    const reportData = filteredResults.map((r) => {
      const monitoredTm = monitoringTrademarks.find((mt) => mt.id === r.monitoredTrademarkId);
      const _ownerName = _pickOwners(monitoredTm, monitoredTm, allPersons);
      return {
        monitoredMark: {
          name: monitoredTm?.title || r.monitoredTrademark,
          ownerName: _ownerName || 'Tüm Sahipler',
          niceClasses: _uniqNice(monitoredTm),
        },
        similarMark: {
          name: r.markName,
          niceClasses: r.niceClasses,
          applicationNo: r.applicationNo,
          similarity: r.similarityScore,
        },
      };
    });

    const generateReportFn = httpsCallable(functions, 'generateSimilarityReport');
    const response = await generateReportFn({ results: reportData });

    console.log('🔵 [9] Rapor yanıtı', {
      success: response?.data?.success,
      hasFile: !!response?.data?.file,
      error: response?.data?.error,
    });

    if (response?.data?.success) {

    // ✅ İş Tetiklendi: sadece iş oluştuysa "Evet" yap
      if (createdTaskCount > 0) {
        console.log('🔵 [10.1] İş tetiklendi, durum güncelleniyor...', { ownerId, bulletinNo });
        
        // ÖNCE Firestore'dan yükle
        try {
          await refreshTriggeredStatus(bulletinNo);
          console.log('🔵 [10.2] refreshTriggeredStatus tamamlandı', { 
            mapSize: taskTriggeredStatus.size,
            hasOwner: taskTriggeredStatus.has(ownerId),
            ownerValue: taskTriggeredStatus.get(ownerId)
          });
          
          // Kısa gecikme - Map güncellensin
          await new Promise(resolve => setTimeout(resolve, 150));
          
          // SONRA render et (async olduğu için await)
          await renderMonitoringList();
          console.log('🔵 [10.3] renderMonitoringList tamamlandı');
          
          // Ekstra kontrol - 200ms sonra badge'i tekrar kontrol et
          setTimeout(() => {
            const taskBadge =
              document.querySelector(`.task-triggered-status[data-owner-id="${ownerId}"]`) ||
              document.querySelector(`.trigger-status-badge[data-owner-id="${ownerId}"]`);
            if (taskBadge) {
              const shouldBeYes = taskTriggeredStatus.get(ownerId) === 'Evet';
              if (taskBadge.textContent !== (shouldBeYes ? 'Evet' : 'Hayır')) {
                console.warn('⚠️ [10.4] Badge yanlış, düzeltiliyor...', { 
                  current: taskBadge.textContent, 
                  shouldBe: shouldBeYes ? 'Evet' : 'Hayır' 
                });
                taskBadge.textContent = shouldBeYes ? 'Evet' : 'Hayır';
                taskBadge.classList.toggle('trigger-yes', shouldBeYes);
                taskBadge.classList.toggle('trigger-no', !shouldBeYes);
                taskBadge.classList.toggle('text-success', shouldBeYes);
                taskBadge.classList.toggle('font-weight-bold', shouldBeYes);
                taskBadge.classList.toggle('text-danger', !shouldBeYes);
              }
              console.log('✅ [10.4] Badge doğru:', { text: taskBadge.textContent });
            } else {
              console.error('❌ [10.4] Badge bulunamadı:', { ownerId });
            }
          }, 200);
        } catch (e) {
          console.error('❌ [10.2] refreshTriggeredStatus/renderMonitoringList hatası:', e);
        }
      }

      showNotification(
        `Rapor oluşturuldu ve müvekkile bildirim taslağı kaydedildi. Oluşturulan itiraz görevi: ${createdTaskCount} adet.`,
        'success'
      );

      // Dosyayı indir
      const blob = new Blob([Uint8Array.from(atob(response.data.file), (c) => c.charCodeAt(0))], {
        type: 'application/zip',
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const safeOwnerName = ownerName.replace(/[^a-zA-Z0-9\s]/g, '_');
      link.download = `${safeOwnerName}_Benzer_Markalar_Rapor_VE_Bildirim.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      console.log('✅ [10] İşlem bitti', { createdTaskCount, fileName: link.download });
    } else {
      // Rapor başarısız - Bildirim Durumu değişmez
      showNotification('Rapor oluşturma hatası: ' + (response?.data?.error || 'Bilinmeyen hata'), 'error');
      console.error('❌ [10] Rapor başarısız', { error: response?.data?.error });
    }
    } catch (err) {
    // Kritik hata - Bildirim Durumu değişmez
    showNotification('İşlem sırasında kritik hata oluştu!', 'error');
    console.error('❌ [X] Kritik hata', {
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
    });
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Rapor Oluştur ve Bildir';
    console.log('🔵 [Son] Fonksiyon sonlandı');
  }
};


// Sadece rapor indirme (iş oluşturmadan)
const handleOwnerReportGeneration = async (event) => {
    event.stopPropagation();
    
    const btn = event.currentTarget;
    const ownerId = btn.dataset.ownerId;
    const ownerName = btn.dataset.ownerName;
    const bulletinKey = document.getElementById('bulletinSelect')?.value;
    
    console.log('📥 Sadece rapor indirme başladı', { ownerId, ownerName });
    
    if (!bulletinKey) {
        showNotification('Lütfen rapor oluşturmak için bir bülten seçin.', 'error');
        return;
    }

    // Filtreleme (iş oluşturma mantığıyla aynı)
    const ownerMonitoredIds = [];
    for (const tm of monitoringTrademarks) {
        const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
        const ownerInfo = _getOwnerKey(ip, tm, allPersons);
        if (ownerInfo.id === ownerId) {
            ownerMonitoredIds.push(tm.id);
        }
    }
    
    const filteredResults = allSimilarResults.filter(r => 
        ownerMonitoredIds.includes(r.monitoredTrademarkId) && r.isSimilar === true
    );
    
    if (filteredResults.length === 0) {
        showNotification(`${ownerName} için benzer sonuç bulunamadı.`, 'warning');
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rapor hazırlanıyor...';

        const reportData = filteredResults.map(r => {
            const monitoredTm = monitoringTrademarks.find(mt => mt.id === r.monitoredTrademarkId);
            const ownerName = _pickOwners(monitoredTm, monitoredTm, allPersons);
            
            return { 
                monitoredMark: { 
                    name: monitoredTm?.title || r.monitoredTrademark, 
                    ownerName: ownerName || 'Tüm Sahipler', 
                    niceClasses: _uniqNice(monitoredTm) 
                }, 
                similarMark: { 
                    name: r.markName, 
                    niceClasses: r.niceClasses, 
                    applicationNo: r.applicationNo, 
                    similarity: r.similarityScore 
                } 
            };
        });

        const generateReportFn = httpsCallable(functions, 'generateSimilarityReport');
        const response = await generateReportFn({ results: reportData });
        
        if (response.data.success) {
            showNotification('Rapor başarıyla oluşturuldu.', 'success');

            const blob = new Blob([Uint8Array.from(atob(response.data.file), c => c.charCodeAt(0))], { type: 'application/zip' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            const safeOwnerName = ownerName.replace(/[^a-zA-Z0-9\s]/g, '_');
            link.download = `${safeOwnerName}_Benzerlik_Raporu.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            showNotification("Rapor oluşturma hatası: " + (response.data.error || 'Bilinmeyen hata'), 'error');
        }
    } catch (err) {
        console.error('Rapor oluşturma hatası:', err);
        showNotification("Rapor oluşturulurken hata oluştu!", 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-file-pdf"></i> Rapor Oluştur';
    }
};

const handleGlobalReportAndNotifyGeneration = async (event) => {
  const btn = event.currentTarget;
  const bulletinKey = document.getElementById('bulletinSelect')?.value;
  const bNo = String(bulletinKey || '').split('_')[0];

  if (!bNo) {
    showNotification('Lütfen rapor oluşturmak için bir bülten seçin.', 'error');
    return;
  }

  // Tüm benzerler
  const allFilteredSimilarResults = allSimilarResults.filter(r => r.isSimilar === true);

  if (allFilteredSimilarResults.length === 0) {
    showNotification('Seçili bülten ve filtrelere göre benzer (isSimilar=true) marka sonucu bulunamadı.', 'warning');
    return;
  }

  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> İşleniyor...';

    const callerEmail = firebaseServices.auth.currentUser?.email || 'anonim@evreka.com';
    const createObjectionTaskFn = httpsCallable(functions, 'createObjectionTask');

    let createdTaskCount = 0;

    // Güvenli: zorunlu alanları olmayan hit’leri atla
    const candidates = allFilteredSimilarResults.filter(r =>
      r?.monitoredTrademarkId && r?.applicationNo && r?.markName
    );

    for (let i = 0; i < candidates.length; i++) {
      const r = candidates[i];
      
      // ✅ KONTROL: Bu benzer marka için daha önce iş oluşturulmuş mu?
      try {
        console.log(`🔍 [Global ${i + 1}] İş kontrolü yapılıyor...`, {
          applicationNo: r.applicationNo,
          monitoredMarkId: r.monitoredTrademarkId
        });
        
        const existingTaskQuery = query(
          collection(db, 'tasks'),
          where('taskType', '==', '20')
        );
        
        const existingTaskSnap = await getDocs(existingTaskQuery);
        
        // Sahip ID'sini bul (ownerId)
        let ownerId = null;
        const monitoredTm = monitoringTrademarks.find(tm => tm.id === r.monitoredTrademarkId);
        if (monitoredTm) {
          const ip = await _getIp(monitoredTm.ipRecordId || monitoredTm.sourceRecordId || monitoredTm.id);
          const ownerInfo = _getOwnerKey(ip, monitoredTm, allPersons);
          ownerId = ownerInfo?.id || null;
        }
        
        console.log(`🔍 [Global ${i + 1}] İş kontrolü:`, {
          applicationNo: r.applicationNo,
          ownerId
        });
        
        const duplicateTask = existingTaskSnap.docs.find(doc => {
          const data = doc.data();
          const targetAppNo = data?.details?.targetAppNo || '';
          const taskClientId = data?.clientId || '';
          
          // Aynı benzer marka + aynı sahip = duplikasyon
          return (
            String(targetAppNo) === String(r.applicationNo) &&
            ownerId && String(taskClientId) === String(ownerId)
          );
        });
        
        if (duplicateTask) {
          console.warn(`⚠️ [Global ${i + 1}] Bu marka için zaten iş mevcut, atlanıyor`, {
            existingTaskId: duplicateTask.id,
            applicationNo: r.applicationNo,
            markName: r.markName
          });
          continue;
        }
        
        const resp = await createObjectionTaskFn({
          monitoredMarkId: r.monitoredTrademarkId,
          similarMark: {
            applicationNo: r.applicationNo,
            markName: r.markName,
            niceClasses: r.niceClasses,
            similarityScore: r.similarityScore
          },
          similarMarkName: r.markName,
          bulletinNo: bNo,
          callerEmail
        });
        
        if (resp?.data?.success) createdTaskCount++;
        
      } catch (e) {
        console.error('[Global] createObjectionTask error:', {
          message: e?.message,
          code: e?.code,
          details: e?.details,
        });
      }
    }

    // Rapor oluştur (varsa mevcut kodundaki gibi)
    const reportData = candidates.map(r => {
      const monitoredTm = monitoringTrademarks.find(mt => mt.id === r.monitoredTrademarkId);
      const ownerName = _pickOwners(monitoredTm, monitoredTm, allPersons);
      return {
        monitoredMark: {
          name: monitoredTm?.title || r.monitoredTrademark,
          ownerName: ownerName || 'Tüm Sahipler',
          niceClasses: _uniqNice(monitoredTm),
        },
        similarMark: {
          name: r.markName,
          niceClasses: r.niceClasses,
          applicationNo: r.applicationNo,
          similarity: r.similarityScore,
        },
      };
    });

    const generateReportFn = httpsCallable(functions, 'generateSimilarityReport');
    const response = await generateReportFn({ results: reportData });

    if (response?.data?.success) {
      showNotification(`Toplu rapor oluşturuldu. ${createdTaskCount} adet yayına itiraz görevi oluşturuldu.`, 'success');

      // Dosya indir
      const blob = new Blob([Uint8Array.from(atob(response.data.file), c => c.charCodeAt(0))], { type: 'application/zip' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `Toplu_Rapor_Bildirim_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);

    // KALICILIK: Firestore'dan durum oku ve tabloyu senkronize et
      if (createdTaskCount > 0 && typeof refreshTriggeredStatus === 'function') {
        console.log('🔵 [Global] refreshTriggeredStatus başladı...', { bNo });
        await refreshTriggeredStatus(bNo);
        console.log('🔵 [Global] refreshTriggeredStatus tamamlandı', { mapSize: taskTriggeredStatus.size });
        
        await new Promise(resolve => setTimeout(resolve, 150));
        
        if (typeof renderMonitoringList === 'function') {
          await renderMonitoringList();
          console.log('🔵 [Global] renderMonitoringList tamamlandı');
        }
      }
    } else {
      showNotification('Toplu rapor oluşturulamadı.', 'error');
      console.error('Global report error:', response?.data?.error);
    }
  } catch (err) {
    console.error('Global handler critical error:', {
      message: err?.message,
      code: err?.code,
      details: err?.details,
    });
    showNotification('İşlem sırasında kritik hata oluştu!', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Rapor Oluştur ve Bildir';
  }
};


// --- Geri kalan kodlar (önceden tanımlı olanlar) ---

const initializePagination = () => {
    if (!pagination) {
        pagination = new Pagination({
            containerId: 'paginationContainer',
            itemsPerPage: 10,
            onPageChange: (page, itemsPerPage) => {
                renderCurrentPageOfResults();
                tssSaveState(tssBuildStateFromUI({ page, itemsPerPage, totalResults: allSimilarResults.length }));
            }
        });
    }
};

const initializeMonitoringPagination = () => {
    if (!monitoringPagination) {
        monitoringPagination = new Pagination({
            containerId: 'monitoringPaginationContainer',
            itemsPerPage: 5,
            onPageChange: () => renderMonitoringList()
        });
    }
};

const loadInitialData = async () => {
    await loadSharedLayout({ activeMenuLink: 'trademark-similarity-search.html' });
    
    const personsResult = await personService.getPersons();
    if (personsResult.success) allPersons = personsResult.data;

    await loadBulletinOptions();
    
    const snapshot = await getDocs(collection(db, 'monitoringTrademarks'));
    monitoringTrademarks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    filteredMonitoringTrademarks = [...monitoringTrademarks];
    
    initializeMonitoringPagination();
    renderMonitoringList();
    updateMonitoringCount();
    monitoringPagination.update(filteredMonitoringTrademarks.length);
     
    startSearchBtn.disabled = true;
    researchBtn.disabled = true;

    // Sayfa ilk yüklendiğinde mevcut bülteni kontrol et ve işleri yükle
    const bulletinSelect = document.getElementById('bulletinSelect');
    if (bulletinSelect?.value) {
        const bNo = String(bulletinSelect.value).split('_')[0];
        if (bNo && typeof refreshTriggeredStatus === 'function') {
            await refreshTriggeredStatus(bNo);
            renderMonitoringList(); // Tabloyu güncelle
        }
    }
  }
console.log("✅ Initial data loaded.");

const loadBulletinOptions = async () => {
    try {
        const bulletinSelect = document.getElementById('bulletinSelect');
        bulletinSelect.innerHTML = '<option value="">Bülten seçin...</option>';
        const [registeredSnapshot, monitoringSnapshot] = await Promise.all([
            getDocs(collection(db, 'trademarkBulletins')),
            getDocs(collection(db, 'monitoringTrademarkRecords'))
        ]);

        const allBulletins = new Map();
        registeredSnapshot.forEach(doc => {
            const data = doc.data();
            const bulletinKey = `${data.bulletinNo}_${(data.bulletinDate || '').replace(/\D/g, '')}`;
            allBulletins.set(bulletinKey, { ...data, bulletinKey, source: 'registered', hasOriginalBulletin: true, displayName: `${data.bulletinNo} - ${data.bulletinDate || ''} (Kayıtlı)` });
        });

        for (const bulletinDoc of monitoringSnapshot.docs) {
            const bulletinKeyRaw = bulletinDoc.id;
            try {
                const trademarksRef = collection(db, 'monitoringTrademarkRecords', bulletinKeyRaw, 'trademarks');
                const trademarksSnapshot = await getDocs(trademarksRef);
                if (!trademarksSnapshot.empty) {
                    const parts = bulletinKeyRaw.split('_');
                    const normalizedKey = `${parts[0]}_${(parts[1] || '').replace(/\D/g, '')}`;
                    if (!allBulletins.has(normalizedKey)) {
                        const bulletinDate = (parts[1] || '').length === 8 ? parts[1].replace(/(\d{2})(\d{2})(\d{4})/, '$1.$2.$3') : (parts[1] || 'Tarih Yok');
                        allBulletins.set(normalizedKey, { bulletinNo: parts[0], bulletinDate, bulletinKey: normalizedKey, source: 'searchOnly', hasOriginalBulletin: false, displayName: `${parts[0]} - ${bulletinDate} (Sadece Arama)` });
                    }
                }
            } catch (e) { /* silent */ }
        }

        const sortedBulletins = Array.from(allBulletins.values()).sort((a, b) => parseInt(b.bulletinNo) - parseInt(a.bulletinNo));
        sortedBulletins.forEach(bulletin => {
            const option = document.createElement('option');
            Object.keys(bulletin).forEach(key => option.dataset[key] = bulletin[key]);
            option.value = bulletin.bulletinKey;
            option.textContent = bulletin.displayName;
            bulletinSelect.appendChild(option);
        });
        console.log('✅ Bulletin options loaded.');
    } catch (error) {
        console.error('❌ Error loading bulletin options:', error);
    }
};

const loadDataFromCache = async (bulletinKey) => {
    try {
        const snapshot = await getDocs(collection(db, 'monitoringTrademarkRecords', bulletinKey, 'trademarks'));
        const cachedResults = snapshot.docs.flatMap(docSnap => {
            const data = docSnap.data();
            return (data.results || []).map(r => ({ ...r, source: 'cache', monitoredTrademarkId: docSnap.id }));
        });
        allSimilarResults = cachedResults;
        infoMessageContainer.innerHTML = cachedResults.length > 0 ? `<div class="info-message success">Önbellekten ${cachedResults.length} benzer sonuç yüklendi.</div>` : '';
        noRecordsMessage.style.display = cachedResults.length > 0 ? 'none' : 'block';
        if (pagination) pagination.update(allSimilarResults.length);
        renderCurrentPageOfResults();
        
    } catch (error) {
        console.error("❌ Error loading data from cache:", error);
    }
};


const renderCurrentPageOfResults = () => {
    if (!pagination || !resultsTableBody) return;
    resultsTableBody.innerHTML = '';
    const currentPageData = pagination.getCurrentPageData(allSimilarResults);
    if (currentPageData.length === 0) {
        noRecordsMessage.textContent = 'Arama sonucu bulunamadı.';
        noRecordsMessage.style.display = 'block';
        return;
    }
    noRecordsMessage.style.display = 'none';

    const groupedByTrademark = currentPageData.reduce((acc, hit) => {
        const key = hit.monitoredTrademarkId || 'unknown';
        (acc[key] = acc[key] || []).push(hit);
        return acc;
    }, {});

    Object.keys(groupedByTrademark).sort((a, b) => (groupedByTrademark[a][0]?.monitoredTrademark || '').localeCompare(groupedByTrademark[b][0]?.monitoredTrademark || '')).forEach(trademarkKey => {
        const groupResults = groupedByTrademark[trademarkKey];
        const tmMeta = monitoringTrademarks.find(t => String(t.id) === String(trademarkKey)) || null;

        if (!tmMeta) {
            // Monitored trademark cannot be found, handle gracefully
            const fallbackName = groupResults[0]?.monitoredTrademark || 'Bilinmeyen Marka';
            const groupHeaderRow = document.createElement('tr');
            groupHeaderRow.classList.add('group-header');
            groupHeaderRow.innerHTML = `<td colspan="10"><div class="group-title"><span><strong>${fallbackName}</strong> markası için bulunan benzer sonuçlar (${groupResults.length} adet)</span></div></td>`;
            resultsTableBody.appendChild(groupHeaderRow);
            groupResults.forEach((hit, index) => resultsTableBody.appendChild(createResultRow(hit, pagination.getStartIndex() + index + 1)));
            return; // Skip to next iteration
        }

        const headerName = _pickName(null, tmMeta);
        const headerImg = _pickImg(null, tmMeta);
        const applicationNumber = _pickAppNo(null, tmMeta);
        const groupHeaderRow = document.createElement('tr');
        groupHeaderRow.classList.add('group-header');
        
        // Modal için veriyi hazırlama
        const modalData = {
            id: tmMeta.id,
            ipRecordId: tmMeta.ipRecordId || tmMeta.sourceRecordId || tmMeta.id, // ✅ eklendi
            markName: headerName,
            applicationNumber: applicationNumber,
            owner: _pickOwners(null, tmMeta, allPersons),
            niceClasses: getNiceClassNumbers(tmMeta),
            brandImageUrl: headerImg,
            brandTextSearch: tmMeta.brandTextSearch || [],
            niceClassSearch: tmMeta.niceClassSearch || []
        };

        groupHeaderRow.dataset.markData = JSON.stringify(modalData);
        
        // ✅ Konsol debug - veri yapısını göster
        if (groupedByTrademark[Object.keys(groupedByTrademark)[0]]) {
        console.log('📊 İlk grup örneği:', {
            key: Object.keys(groupedByTrademark)[0],
            firstHit: groupedByTrademark[Object.keys(groupedByTrademark)[0]][0],
            totalGroups: Object.keys(groupedByTrademark).length
        });
        }
        const totalCount = getTotalCountForMonitoredId(trademarkKey);

        groupHeaderRow.innerHTML = `
            <td colspan="10">
                <div class="group-title">
                    <div class="group-trademark-image">
                        ${headerImg ? `<img src="${headerImg}" alt="${headerName}" class="group-header-img">` : `<div class="group-header-placeholder"><strong>${headerName.charAt(0).toUpperCase()}</strong></div>`}
                    </div>
                    <span>
                        <a href="#" class="edit-criteria-link" data-tmid="${tmMeta.id}"><strong>${headerName}</strong></a>
                        markası için bulunan benzer sonuçlar (${totalCount} adet)
                    </span>
                </div>
            </td>
        `;
        resultsTableBody.appendChild(groupHeaderRow);
        try { resolveGroupHeaderImage(tmMeta, groupHeaderRow); } catch(e) { console.warn(e); }
        groupResults.forEach((hit, index) => resultsTableBody.appendChild(createResultRow(hit, pagination.getStartIndex() + index + 1)));
    });
    attachEventListeners();
  try { setupImageHoverEffect('resultsTableBody'); } catch(e) {}

};

    const createResultRow = (hit, rowIndex) => {
    const holders = Array.isArray(hit.holders) ? hit.holders.map(h => h.name || h.id).filter(Boolean).join(', ') : (hit.holders || '');
    // ✅ Her iki alanı da kontrol et (backward compatibility)
    const monitoredTrademark = monitoringTrademarks.find(tm => 
    tm.id === (hit.monitoredTrademarkId || hit.monitoredMarkId)
    ) || {};
    
    const niceClassesArray = (Array.isArray(hit.niceClasses) ? hit.niceClasses : (hit.niceClasses?.split('/')?.map(c => c.trim()) || [])).filter(Boolean);
    const monitoredNiceClassNumbers = (monitoredTrademark?.niceClassSearch || []).map(String);
    const goodsAndServicesByClassNumbers = getNiceClassNumbers(monitoredTrademark).map(String);
    
    const niceClassHtml = niceClassesArray.map(cls => {
        const clsString = String(cls).trim();
        let cssClass = '';
        if (goodsAndServicesByClassNumbers.includes(clsString)) {
            cssClass = 'match';
        } else if (monitoredNiceClassNumbers.includes(clsString)) {
            cssClass = 'partial-match';
        }
        return `<span class="nice-class-badge ${cssClass}">${cls}</span>`;
    }).join('');

    const similarityScore = hit.similarityScore ? `${(hit.similarityScore * 100).toFixed(0)}%` : '-';
    const similarityBtnClass = hit.isSimilar === true ? 'similar' : 'not-similar';
    const similarityBtnText = hit.isSimilar === true ? 'Benzer' : 'Benzemez';
    const resultId = hit.objectID || hit.applicationNo;
    const noteContent = hit.note ? `<span class="note-text">${hit.note}</span>` : `<span class="note-placeholder">Not ekle</span>`;
    
// Görsel için placeholder HTML
    const imagePlaceholderHtml = `
      <div class="trademark-image-wrapper-large">
        <div class="no-image-placeholder-large">
          Görsel<br>Yok
        </div>
      </div>
    `;

    // Başlangıçta her zaman placeholder göster, sonra asenkron yükleme yap
    let imageCellContent = imagePlaceholderHtml;

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${rowIndex}</td>
        <td><button class="action-btn ${similarityBtnClass}" data-result-id="${resultId}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}">${similarityBtnText}</button></td>
        <td data-appno="${hit.applicationNo}" class="trademark-image-cell">
            ${imageCellContent}
        </td>
        <td><strong>${hit.markName || '-'}</strong></td>
        <td>${holders}</td>
        <td>${niceClassHtml}</td>
        <td>${hit.applicationNo ? `<a href="#" class="tp-appno-link" data-tp-appno="${hit.applicationNo}" onclick="event.preventDefault(); window.queryApplicationNumberWithExtension('${hit.applicationNo}');">${hit.applicationNo}</a>` : '-'}</td>
        <td>${similarityScore}</td>
        <td>
            <select class="bs-select" data-result-id="${resultId}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}">
                <option value="">B.Ş</option>
                ${['%0', '%20', '%30', '%40', '%45', '%50', '%55', '%60', '%70', '%80'].map(val => `<option value="${val}" ${hit.bs === val ? 'selected' : ''}>${val}</option>`).join('')}
            </select>
        </td>
        <td class="note-cell" data-result-id="${resultId}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}">
            <div class="note-cell-content">
                <span class="note-icon">📝</span>
                ${noteContent}
            </div>
        </td>
    `;

// Basit asenkron görsel yükleme
    setTimeout(async () => {
        const imageCell = row.querySelector('.trademark-image-cell');
        if (!imageCell || !imageCell.isConnected) return;

        try {
            let imgUrl = '';
            
            // 1. imagePath varsa Firebase Storage'dan al
            if (hit.imagePath) {
                console.log(`[TSS] imagePath ile görsel alınıyor: ${hit.imagePath}`);
                const storage = getStorage();
                const storageRef = ref(storage, hit.imagePath);
                imgUrl = await getDownloadURL(storageRef);
                console.log(`[TSS] Firebase Storage URL alındı: ${imgUrl.substring(0, 80)}...`);
            }
            // 2. brandImageUrl varsa direkt kullan
            else if (hit.brandImageUrl) {
                console.log(`[TSS] brandImageUrl kullanılıyor: ${hit.brandImageUrl.substring(0, 80)}...`);
                imgUrl = hit.brandImageUrl;
            }
            // 3. Son çare: applicationNo ile ara
            else if (hit.applicationNo) {
                console.log(`[TSS] applicationNo ile arama yapılıyor: ${hit.applicationNo}`);
                imgUrl = await _getBrandImageByAppNo(hit.applicationNo);
            }

            // Görsel bulunduysa yükle
            if (imgUrl) {
                imageCell.innerHTML = `
                  <div class="trademark-image-wrapper-large">
                    <img src="${imgUrl}" alt="Marka Görseli" class="trademark-image-thumbnail-large"
                         onload="console.log('[TSS] ✅ Görsel yüklendi: ${hit.applicationNo || hit.markName}'); this.style.display='block';"
                         onerror="console.warn('[TSS] ❌ Görsel yüklenemedi, gizleniyor: ${hit.applicationNo || hit.markName}'); this.style.display='none';"
                         style="display:none;">
                  </div>
                `;
                console.log(`[TSS] HTML güncellendi: ${hit.applicationNo || hit.markName}`);
            } else {
                console.log(`[TSS] Hiç görsel bulunamadı: ${hit.applicationNo || hit.markName}`);
            }

        } catch (err) {
            console.error(`[TSS] Görsel yükleme hatası: ${hit.applicationNo || hit.markName}`, err);
            if (imageCell && imageCell.isConnected) {
                imageCell.innerHTML = `
                  <div class="trademark-image-wrapper-large">
                    <div class="no-image-placeholder-large">
                      Görsel<br>Hata
                    </div>
                  </div>
                `;
            }
        }
    }, 50);
// Satır görsellerine hover efekti ekle
    setTimeout(() => {
        const img = row.querySelector('.trademark-image-thumbnail-large');
        if (img) {
            // Hover event listeners ekle
            img.addEventListener('mouseenter', function() {
                this.style.transform = 'scale(4) translateZ(0)';
                this.style.zIndex = '99999';
                this.style.position = 'relative';
                this.style.boxShadow = '0 15px 40px rgba(0, 0, 0, 0.5)';
                this.style.borderColor = '#1e3c72';
                this.style.borderWidth = '2px';
                console.log('[TSS] Hover IN:', hit.applicationNo || hit.markName);
            });
            
            img.addEventListener('mouseleave', function() {
                this.style.transform = 'scale(1) translateZ(0)';
                this.style.zIndex = '1';
                this.style.position = 'static';
                this.style.boxShadow = 'none';
                this.style.borderColor = '#ddd';
                this.style.borderWidth = '1px';
                console.log('[TSS] Hover OUT:', hit.applicationNo || hit.markName);
            });
        }
    }, 200);
    return row;
};

// --- Core Logic (Temel Uygulama Mantığı) ---
const updateMonitoringCount = () => {
    document.getElementById('monitoringCount').textContent = filteredMonitoringTrademarks.length;
};

const applyMonitoringListFilters = () => {
    const [ownerFilter, niceFilter, brandFilter] = [ownerSearchInput.value, niceClassSearchInput.value, brandNameSearchInput.value].map(s => s.toLowerCase());
    filteredMonitoringTrademarks = monitoringTrademarks.filter(data =>
        _pickOwners(data).toLowerCase().includes(ownerFilter) &&
        _uniqNice(data).includes(niceFilter) &&
        (data.title || data.markName || data.brandText || '').toLowerCase().includes(brandFilter)
    );
    monitoringPagination.update(filteredMonitoringTrademarks.length);
    monitoringPagination.reset();
    renderMonitoringList();
    updateMonitoringCount();
    checkCacheAndToggleButtonStates();
};

const checkCacheAndToggleButtonStates = async () => {
    const bulletinKey = bulletinSelect.value;
    if (!bulletinKey || filteredMonitoringTrademarks.length === 0) {
        startSearchBtn.disabled = true;
        researchBtn.disabled = true;
        infoMessageContainer.innerHTML = '';
        btnGenerateReportAndNotifyGlobal.disabled = true; // Pasif kalması gereken durum
        return;
    }
    
    try {
        const selectedOption = bulletinSelect.options[bulletinSelect.selectedIndex];
        const hasOriginalBulletin = selectedOption?.dataset?.hasOriginalBulletin === 'true';
        const snapshot = await getDocs(collection(db, 'monitoringTrademarkRecords', bulletinKey, 'trademarks'));
        const hasCache = snapshot.docs.some(doc => doc.data().results?.length > 0);
        
        if (hasCache) {
            await loadDataFromCache(bulletinKey);
            startSearchBtn.disabled = true;
            researchBtn.disabled = !hasOriginalBulletin;
            
            // YENİ KONTROL: Cache'ten sonuç varsa butonu etkinleştir
            btnGenerateReportAndNotifyGlobal.disabled = allSimilarResults.length === 0;

            const messageType = hasOriginalBulletin ? 'success' : 'warning';
            const messageText = hasOriginalBulletin ? 'Bu bülten sistemde kayıtlı. Önbellekten sonuçlar yüklendi.' : 'Bu bülten sistemde kayıtlı değil. Sadece eski arama sonuçları gösterilmektedir.';
            infoMessageContainer.innerHTML = `<div class="info-message ${messageType}"><strong>Bilgi:</strong> ${messageText}</div>`;
        } else {
            startSearchBtn.disabled = !hasOriginalBulletin;
            researchBtn.disabled = true;
            
            btnGenerateReportAndNotifyGlobal.disabled = true; // Sonuç yoksa devre dışı bırak

            const messageType = hasOriginalBulletin ? 'info' : 'error';
            const messageText = hasOriginalBulletin ? 'Önbellekte veri bulunamadı. "Arama Başlat" butonuna tıklayarak arama yapabilirsiniz.' : 'Bu bülten sistemde kayıtlı değil ve arama sonucu da bulunamadı.';
            infoMessageContainer.innerHTML = `<div class="info-message ${messageType}"><strong>Bilgi:</strong> ${messageText}</div>`;
            allSimilarResults = [];
            if (pagination) pagination.update(0);
            renderCurrentPageOfResults();
        }
    } catch (error) {
        console.error('❌ Cache check error:', error);
        startSearchBtn.disabled = true;
        researchBtn.disabled = true;
        btnGenerateReportAndNotifyGlobal.disabled = true; // Hata durumunda devre dışı bırak
        infoMessageContainer.innerHTML = `<div class="info-message error"><strong>Hata:</strong> Bülten bilgileri kontrol edilirken bir hata oluştu.</div>`;
    }
};

const performSearch = async () => {
    const bulletinKey = bulletinSelect.value;
    if (!bulletinKey || filteredMonitoringTrademarks.length === 0) return;
    
    loadingIndicator.textContent = 'Arama başlatılıyor...';
    loadingIndicator.style.display = 'block';
    infoMessageContainer.innerHTML = '';
    resultsTableBody.innerHTML = '';
    allSimilarResults = [];
    
    const monitoredMarksPayload = filteredMonitoringTrademarks.map(tm => ({
        id: tm.id,
        markName: (tm.title || tm.markName || '').trim() || 'BELİRSİZ_MARKA',
        niceClassSearch: tm.niceClassSearch || [],
        goodsAndServicesByClass: tm.goodsAndServicesByClass || [],
    }));
    
    try {
        // ✅ Progress callback - Loading indicator'ı güncelle
        const onProgress = (progressData) => {
            const percentage = progressData.progress || 0;
            const processed = progressData.processed || 0;
            const total = progressData.total || monitoredMarksPayload.length;
            const currentResults = progressData.currentResults || 0;
            
            loadingIndicator.textContent = 
                `Arama devam ediyor... ${percentage}% ` +
                `(${processed}/${total} marka işlendi, ` +
                `${currentResults} sonuç bulundu)`;
        };
        
        const resultsFromCF = await runTrademarkSearch(
            monitoredMarksPayload, 
            bulletinKey,
            onProgress  // ✅ Progress callback eklendi
        );
        
        if (resultsFromCF?.length > 0) {
            allSimilarResults = resultsFromCF.map(hit => ({
                ...hit,
                source: 'new',
                monitoredTrademark: filteredMonitoringTrademarks.find(tm => tm.id === hit.monitoredTrademarkId)?.title || hit.markName
            }));
            
            const groupedResults = allSimilarResults.reduce((acc, r) => {
                const key = r.monitoredTrademarkId;
                (acc[key] = acc[key] || []).push(r);
                return acc;
            }, {});
            
            for (const [monitoredTrademarkId, results] of Object.entries(groupedResults)) {
                await searchRecordService.saveRecord(bulletinKey, monitoredTrademarkId, { results, searchDate: new Date().toISOString() });
            }
        }
    } catch (error) {
        console.error("❌ Search operation error:", error);
        infoMessageContainer.innerHTML = `<div class="info-message error"><strong>Hata:</strong> Arama işlemi sırasında bir hata oluştu.</div>`;
    } finally {
            loadingIndicator.style.display = 'none';
            groupAndSortResults();
            if (allSimilarResults.length > 0) {
                infoMessageContainer.innerHTML = `<div class="info-message success">Toplam ${allSimilarResults.length} benzer sonuç bulundu.</div>`;
                startSearchBtn.disabled = true;
                researchBtn.disabled = false;
                btnGenerateReportAndNotifyGlobal.disabled = false; // YENİ: Butonu etkinleştir
            } else {
                noRecordsMessage.textContent = 'Arama sonucu bulunamadı.';
                noRecordsMessage.style.display = 'block';
                startSearchBtn.disabled = false;
                researchBtn.disabled = true;
                btnGenerateReportAndNotifyGlobal.disabled = true; // YENİ: Butonu devre dışı bırak
            }
            if (pagination) pagination.update(allSimilarResults.length);
            renderCurrentPageOfResults();
    }
};

const performResearch = async () => {
    const bulletinKey = bulletinSelect.value;
    if (!bulletinKey) return;
    
    loadingIndicator.textContent = 'Cache temizleniyor ve yeniden arama başlatılıyor...';
    loadingIndicator.style.display = 'block';
    
    try {
        await Promise.all(filteredMonitoringTrademarks.map(tm => searchRecordService.deleteRecord(bulletinKey, tm.id)));
        await performSearch();
    } catch (error) {
        console.error("❌ Research error:", error);
        infoMessageContainer.innerHTML = `<div class="info-message error"><strong>Hata:</strong> Yeniden arama sırasında bir hata oluştu.</div>`;
    } finally {
        loadingIndicator.style.display = 'none';
    }
};

const groupAndSortResults = () => {
    const groupedByTrademark = allSimilarResults.reduce((acc, result) => {
        const id = result.monitoredTrademarkId || 'unknown';
        (acc[id] = acc[id] || []).push(result);
        return acc;
    }, {});
    const sortedIds = Object.keys(groupedByTrademark).sort((a, b) => {
        const nameA = groupedByTrademark[a][0]?.monitoredTrademark || '';
        const nameB = groupedByTrademark[b][0]?.monitoredTrademark || '';
        return nameA.localeCompare(nameB);
    });
    allSimilarResults = sortedIds.flatMap(id => groupedByTrademark[id].sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0)));
};

// --- Event Handlers (Olay İşleyicileri) ---
const handleSimilarityToggle = async (event) => {
    const { resultId, monitoredTrademarkId, bulletinId } = event.target.dataset;
    const currentHit = allSimilarResults.find(r => (r.objectID === resultId || r.applicationNo === resultId) && r.monitoredTrademarkId === monitoredTrademarkId);
    if (!currentHit) { alert('Sonuç bulunamadı.'); return; }
    const newStatus = currentHit.isSimilar !== true;
    const updateResult = await similarityService.updateSimilarityFields(monitoredTrademarkId, bulletinId, resultId, { isSimilar: newStatus });
    if (updateResult.success) {
        currentHit.isSimilar = newStatus;
        event.target.textContent = newStatus ? 'Benzer' : 'Benzemez';
        event.target.classList.toggle('similar', newStatus);
        event.target.classList.toggle('not-similar', !newStatus);
    } else {
        alert('Benzerlik durumu güncellenirken hata oluştu.');
    }
};

const handleBsChange = async (event) => {
    const { resultId, monitoredTrademarkId, bulletinId } = event.target.dataset;
    const updateResult = await similarityService.updateSimilarityFields(monitoredTrademarkId, bulletinId, resultId, { bs: event.target.value });
    if (!updateResult.success) alert('B.Ş. güncellenirken hata oluştu.');
};

const handleNoteCellClick = (cell) => {
    const { resultId, monitoredTrademarkId, bulletinId } = cell.dataset;
    const currentNote = cell.querySelector('.note-text')?.textContent || '';
    const modal = document.getElementById('noteModal');
    const noteInput = document.getElementById('noteInputModal');
    
    noteInput.value = currentNote;
    document.getElementById('saveNoteBtn').onclick = async () => {
        const updateResult = await similarityService.updateSimilarityFields(monitoredTrademarkId, bulletinId, resultId, { note: noteInput.value });
        if (updateResult.success) {
            const hit = allSimilarResults.find(r => (r.objectID === resultId || r.applicationNo === resultId) && r.monitoredTrademarkId === monitoredTrademarkId);
            if (hit) hit.note = noteInput.value;
            const contentDiv = cell.querySelector('.note-cell-content');
            contentDiv.innerHTML = `<span class="note-icon">📝</span><span class="${noteInput.value ? 'note-text' : 'note-placeholder'}">${noteInput.value || 'Not ekle'}</span>`;
            modal.classList.remove('show');
        } else {
            alert('Not güncellenirken hata oluştu.');
        }
    };
    modal.classList.add('show');
    noteInput.focus();
};

const attachEventListeners = () => {
    resultsTableBody.querySelectorAll('.action-btn').forEach(btn => btn.addEventListener('click', handleSimilarityToggle));
    resultsTableBody.querySelectorAll('.bs-select').forEach(select => select.addEventListener('change', handleBsChange));
    resultsTableBody.querySelectorAll('.note-cell').forEach(cell => cell.addEventListener('click', () => handleNoteCellClick(cell)));
};

// --- External API Integrations (Harici API Entegrasyonları) ---
window.queryApplicationNumberWithExtension = (applicationNo) => {
    const eklentiID = 'bbcpnpgglakoagjakgigmgjpdpiigpah';
    if (!applicationNo) return;
    const url = `https://www.turkpatent.gov.tr/arastirma-yap?form=trademark&auto_query=${encodeURIComponent(applicationNo)}&query_type=basvuru&source=${encodeURIComponent(window.location.origin)}`;
    const newTab = window.open(url, '_blank');
    if (!newTab) { alert('Pop-up engellendi. Lütfen bu site için izin verin.'); }
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && eklentiID) {
            chrome.runtime.sendMessage(eklentiID, { type: 'SORGULA', data: applicationNo });
        }
    } catch (e) { console.warn('Extension message failed:', e); }
};


// --- Main Entry Point (Ana Giriş Noktası) ---
document.addEventListener('DOMContentLoaded', async () => {
    initializePagination();
    await loadInitialData();
    tssShowResumeBannerIfAny();

    // Attach core listeners
    startSearchBtn.addEventListener('click', performSearch);
    researchBtn.addEventListener('click', performResearch);
    clearFiltersBtn.addEventListener('click', () => {
        ownerSearchInput.value = '';
        niceClassSearchInput.value = '';
        brandNameSearchInput.value = '';
        bulletinSelect.selectedIndex = 0;
        applyMonitoringListFilters();
    });

    // Attach filters and bulletin change listener
    [ownerSearchInput, niceClassSearchInput, brandNameSearchInput].forEach(input => input.addEventListener('input', debounce(applyMonitoringListFilters, 400)));
    bulletinSelect.addEventListener('change', checkCacheAndToggleButtonStates);
    bulletinSelect.addEventListener('change', async () => {
        const bNo = String(bulletinSelect.value || '').split('_')[0];
        if (bNo && typeof refreshTriggeredStatus === 'function') {
            await refreshTriggeredStatus(bNo);
            if (typeof renderMonitoringList === 'function') renderMonitoringList();
        }
    });
    
    // YENİ DİNLEYİCİ BAĞLANTISI: Global Toplu Rapor
    btnGenerateReportAndNotifyGlobal.addEventListener('click', handleGlobalReportAndNotifyGeneration);

    // Modal close listener
    document.getElementById('closeNoteModal')?.addEventListener('click', () => document.getElementById('noteModal').classList.remove('show'));
    document.getElementById('cancelNoteBtn')?.addEventListener('click', () => document.getElementById('noteModal').classList.remove('show'));
    
    // Kriterleri Düzenle modalı için listener
    document.getElementById('resultsTableBody')?.addEventListener('click', (e) => {
        const editButton = e.target.closest('.edit-criteria-link');
        if (editButton) {
            e.preventDefault(); // Varsayılan link davranışını engelle
            const row = editButton.closest('tr.group-header');
            if (row && row.dataset.markData) {
                const markData = JSON.parse(row.dataset.markData);
                openEditCriteriaModal(markData);
            }
        }
    });

    setupEditCriteriaModal(); // Modal'ı başlat
});

/**
 * Modalı açmak ve verileri yüklemek için yeni fonksiyon.
 */
async function openEditCriteriaModal(markData) {
    const modal = document.getElementById('editCriteriaModal');
    const modalTitle = document.getElementById('editCriteriaModalLabel');
    const trademarkNameEl = document.getElementById('modalTrademarkName');
    const applicationNoEl = document.getElementById('modalApplicationNo');
    const ownerEl = document.getElementById('modalOwner');
    const niceClassEl = document.getElementById('modalNiceClass');
    const brandTextList = document.getElementById('brandTextSearchList');
    const niceClassSelectionContainer = document.getElementById('niceClassSelectionContainer');
    const modalImage = document.getElementById('modalTrademarkImage');

    modalTitle.textContent = `Kriterleri Düzenle: ${markData.markName}`;
    trademarkNameEl.textContent = markData.markName || '-';
    applicationNoEl.textContent = markData.applicationNumber || '-';
    ownerEl.textContent = markData.owner || '-';
    niceClassEl.textContent = Array.isArray(markData.niceClasses) ? markData.niceClasses.join(', ') : '-';
    modalImage.alt = markData.markName || 'Marka Görseli';
    modalImage.src = ''; // başlangıç
    try {
        let imgUrl = '';

        // (1) markData.brandImageUrl tam URL ise direkt kullan
        if (markData.brandImageUrl && /^(https?:|data:)/i.test(markData.brandImageUrl)) {
            imgUrl = markData.brandImageUrl;
        }

        // (2) ipRecordId üzerinden ipRecords doc çek → brandImageUrl varsa onu al
        if (!imgUrl && markData.ipRecordId) {
            const ip = await _getIp(markData.ipRecordId);
            imgUrl = _pickImg(ip, markData) || '';
        }

        // (3) hâlâ yoksa applicationNumber ile monitoring/ipRecords üzerinden ara
        if (!imgUrl && markData.applicationNumber) {
            imgUrl = await _getBrandImageByAppNo(markData.applicationNumber);
        }

        if (imgUrl) {
            // Eğer bir Storage path geldiyse downloadURL'e çevir
            if (!/^(https?:|data:|blob:)/i.test(imgUrl) && !/^data:image\//i.test(imgUrl)) {
                const storage = getStorage();
                imgUrl = await getDownloadURL(ref(storage, imgUrl));
            }
            modalImage.src = imgUrl;
        } else {
            // İsterseniz placeholder koyabilirsiniz
            // modalImage.src = '/img/placeholder-logo.svg';
        }
    } catch (e) {
        console.warn('Görsel yüklenemedi:', e);
        // modalImage.src = '/img/placeholder-logo.svg';
    }
    modal.dataset.markId = markData.id;

    const permanentBrandText = [markData.markName].filter(Boolean);
    const permanentNiceClasses = markData.niceClasses.map(String);

    const existingBrandTextSearch = markData.brandTextSearch || [];
    const existingNiceClassSearch = markData.niceClassSearch || [];

    populateList(brandTextList, existingBrandTextSearch, permanentBrandText);
    
    niceClassSelectionContainer.innerHTML = '';
    for (let i = 1; i <= 45; i++) {
        const box = document.createElement('div');
        box.className = 'nice-class-box';
        box.textContent = i;
        box.dataset.classNo = i;
        niceClassSelectionContainer.appendChild(box);
    }
    
    populateNiceClassBoxes(existingNiceClassSearch, permanentNiceClasses);
    
    $('#editCriteriaModal').modal('show');
}