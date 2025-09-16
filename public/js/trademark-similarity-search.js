// js/trademark-similarity-search.js

import { db, personService, searchRecordService, similarityService, ipRecordsService, firebaseServices } from '../firebase-config.js';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { runTrademarkSearch } from './trademark-similarity/run-search.js';
import Pagination from './pagination.js';
import { loadSharedLayout } from './layout-loader.js';
import { showNotification } from '../utils.js';

console.log("### trademark-similarity-search.js yüklendi ###");

// --- Global State Management (Durum Yönetimi) ---
let allSimilarResults = [];
let monitoringTrademarks = [];
let filteredMonitoringTrademarks = [];
let allPersons = [];
let pagination;
let monitoringPagination;

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
const btnGenerateReport = document.getElementById('btnGenerateReport');

const functions = getFunctions(undefined, "europe-west1");

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
                    const storageRef = ref(storage, data.imagePath);
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
const setupImageHoverEffect = () => {
    const tbody = document.getElementById('monitoringListBody');
    if (tbody._imageHoverSetup) return;
    tbody._imageHoverSetup = true;

    const style = document.createElement('style');
    style.textContent = `
        .trademark-image-thumbnail-large:hover {
            transform: none !important;
            z-index: initial !important;
            position: static !important;
        }
    `;
    document.head.appendChild(style);

    let hoverElement = null;
    const handleMouseEnter = (e) => {
        const thumbnail = e.target.closest('.trademark-image-thumbnail-large');
        if (!thumbnail) return;
        if (hoverElement) hoverElement.remove();
        hoverElement = document.createElement('img');
        hoverElement.src = thumbnail.src;
        hoverElement.alt = thumbnail.alt;
        hoverElement.classList.add('trademark-image-hover-full');
        hoverElement.style.display = 'block';
        document.body.appendChild(hoverElement);
    };
    const handleMouseLeave = (e) => {
        const thumbnail = e.target.closest('.trademark-image-thumbnail-large');
        if (!thumbnail) return;
        if (hoverElement) {
            hoverElement.remove();
            hoverElement = null;
        }
    };

    tbody.addEventListener('mouseenter', handleMouseEnter, true);
    tbody.addEventListener('mouseleave', handleMouseLeave, true);
};

// --- Initialization and Data Loading (Başlangıç ve Veri Yükleme) ---
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

    console.log("✅ Initial data loaded.");
};

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

// --- UI Rendering (Kullanıcı Arayüzü Oluşturma) ---
const renderMonitoringList = async () => {
    const tbody = document.getElementById('monitoringListBody');
    const list = monitoringPagination ? monitoringPagination.getCurrentPageData(filteredMonitoringTrademarks) : filteredMonitoringTrademarks;
    if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="no-records">Filtreye uygun izlenecek marka bulunamadı.</td></tr>';
        return;
    }
    const rows = await Promise.all(list.map(async tm => {
        const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
        const [markName, imgSrc, appNo, owners, nices, appDate] = [_pickName(ip, tm), _pickImg(ip, tm), _pickAppNo(ip, tm), _pickOwners(ip, tm, allPersons), _uniqNice(ip || tm), _pickAppDate(ip, tm)];
        return `
            <tr>
                <td style="text-align:left;">${markName}</td>
                <td>${imgSrc ? `<div class="trademark-image-wrapper-large"><img class="trademark-image-thumbnail-large" src="${imgSrc}" alt="Marka Görseli"></div>` : '<div class="no-image-placeholder-large">Resim Yok</div>'}</td>
                <td>${appNo}</td>
                <td title="${owners}">${owners}</td>
                <td>${nices || '-'}</td>
                <td>${appDate}</td>
            </tr>
        `;
    }));
    tbody.innerHTML = rows.join('');
    setupImageHoverEffect();
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
            markName: headerName,
            applicationNumber: applicationNumber,
            owner: _pickOwners(null, tmMeta, allPersons),
            niceClasses: getNiceClassNumbers(tmMeta),
            brandImageUrl: headerImg,
            brandTextSearch: tmMeta.brandTextSearch || [],
            niceClassSearch: tmMeta.niceClassSearch || []
        };
        groupHeaderRow.dataset.markData = JSON.stringify(modalData);
        
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
};

const createResultRow = (hit, rowIndex) => {
    const holders = Array.isArray(hit.holders) ? hit.holders.map(h => h.name || h.id).filter(Boolean).join(', ') : (hit.holders || '');
    const monitoredTrademark = monitoringTrademarks.find(tm => tm.id === hit.monitoredTrademarkId) || {};
    
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

    // Hit objesinden görsel URL'sini al ve düzgün görsel HTML'i oluştur
    let imageCellContent = imagePlaceholderHtml;
    
    // Önce hit.imagePath kontrolü
    if (hit.imagePath) {
        const imgSrc = `https://firebasestorage.googleapis.com/v0/b/ip-manager-production-aab4b.appspot.com/o/${encodeURIComponent(hit.imagePath)}?alt=media`;
        imageCellContent = `
          <div class="trademark-image-wrapper-large">
            <img src="${imgSrc}" alt="Marka Görseli" class="trademark-image-thumbnail-large" 
                 onerror="this.parentElement.innerHTML='${imagePlaceholderHtml.replace(/'/g, '&apos;')}'">
          </div>
        `;
    }
    // Sonra diğer görsel alanları kontrol et
    else if (hit.brandImageUrl) {
        imageCellContent = `
          <div class="trademark-image-wrapper-large">
            <img src="${hit.brandImageUrl}" alt="Marka Görseli" class="trademark-image-thumbnail-large"
                 onerror="this.parentElement.innerHTML='${imagePlaceholderHtml.replace(/'/g, '&apos;')}'">
          </div>
        `;
    }

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

    // Eğer görsel yok ve applicationNo varsa, asenkron olarak yükle
    if (!hit.imagePath && !hit.brandImageUrl && hit.applicationNo) {
        _getBrandImageByAppNo(hit.applicationNo).then(imgUrl => {
            if (imgUrl) {
                const imageCell = row.querySelector('.trademark-image-cell');
                if (imageCell) {
                    imageCell.innerHTML = `
                      <div class="trademark-image-wrapper-large">
                        <img src="${imgUrl}" alt="Marka Görseli" class="trademark-image-thumbnail-large"
                             onerror="this.parentElement.innerHTML='${imagePlaceholderHtml.replace(/'/g, '&apos;')}'">
                      </div>
                    `;
                }
            }
        }).catch(err => {
            console.warn('[TSS] Görsel yüklenirken hata:', err);
        });
    }

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
            const messageType = hasOriginalBulletin ? 'success' : 'warning';
            const messageText = hasOriginalBulletin ? 'Bu bülten sistemde kayıtlı. Önbellekten sonuçlar yüklendi.' : 'Bu bülten sistemde kayıtlı değil. Sadece eski arama sonuçları gösterilmektedir.';
            infoMessageContainer.innerHTML = `<div class="info-message ${messageType}"><strong>Bilgi:</strong> ${messageText}</div>`;
        } else {
            startSearchBtn.disabled = !hasOriginalBulletin;
            researchBtn.disabled = true;
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
        infoMessageContainer.innerHTML = `<div class="info-message error"><strong>Hata:</strong> Bülten bilgileri kontrol edilirken bir hata oluştu.</div>`;
    }
};

const performSearch = async () => {
    const bulletinKey = bulletinSelect.value;
    if (!bulletinKey || filteredMonitoringTrademarks.length === 0) return;
    
    loadingIndicator.textContent = 'Arama yapılıyor...';
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
        const resultsFromCF = await runTrademarkSearch(monitoredMarksPayload, bulletinKey);
        
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
        } else {
            noRecordsMessage.textContent = 'Arama sonucu bulunamadı.';
            noRecordsMessage.style.display = 'block';
            startSearchBtn.disabled = false;
            researchBtn.disabled = true;
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

    // Report generation listener
    if (btnGenerateReport) {
        btnGenerateReport.addEventListener('click', async () => {
            if (!allSimilarResults.some(r => r.isSimilar)) {
                alert("Rapor oluşturmak için en az bir benzer marka işaretlemelisiniz.");
                return;
            }
            try {
                const reportData = allSimilarResults.filter(r => r.isSimilar).map(r => {
                    const monitoredTm = monitoringTrademarks.find(mt => mt.id === r.monitoredTrademarkId);
                    return { monitoredMark: { name: monitoredTm?.title || r.monitoredTrademark, niceClasses: _uniqNice(monitoredTm) }, similarMark: { name: r.markName, niceClasses: r.niceClasses, applicationNo: r.applicationNo, similarity: r.similarityScore } };
                });
                const generateReportFn = httpsCallable(functions, 'generateSimilarityReport');
                const response = await generateReportFn({ results: reportData });
                if (response.data.success) {
                    const blob = new Blob([Uint8Array.from(atob(response.data.file), c => c.charCodeAt(0))], { type: 'application/zip' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = "Benzer_Markalar_Raporu.zip";
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                } else {
                    alert("Rapor oluşturulamadı: " + (response.data.error || 'Bilinmeyen hata'));
                }
            } catch (err) {
                console.error("Report generation error:", err);
                alert("Rapor oluşturulurken bir hata oluştu!");
            }
        });
    }

    // Modal close listener
    document.getElementById('closeNoteModal').addEventListener('click', () => document.getElementById('noteModal').classList.remove('show'));
    document.getElementById('cancelNoteBtn').addEventListener('click', () => document.getElementById('noteModal').classList.remove('show'));
    
    // Kriterleri Düzenle modalı için listener
    document.getElementById('resultsTableBody').addEventListener('click', (e) => {
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

    if (bulletinSelect.value) {
        checkCacheAndToggleButtonStates();
    }

    setupEditCriteriaModal(); // Modal'ı başlat
});

/**
 * Modalı açmak ve verileri yüklemek için yeni fonksiyon.
 */
function openEditCriteriaModal(markData) {
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
    
    const imageUrl = markData.brandImageUrl && markData.brandImageUrl.startsWith('http')
        ? markData.brandImageUrl
        : `https://firebasestorage.googleapis.com/v0/b/ip-manager-production-aab4b.appspot.com/o/${encodeURIComponent(markData.brandImageUrl)}?alt=media`;
    modalImage.src = imageUrl;
    modalImage.alt = markData.markName;

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