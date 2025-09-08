// js/trademark-similarity-search.js

import { db, personService, searchRecordService, similarityService, ipRecordsService, firebaseServices } from '../firebase-config.js';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { runTrademarkSearch } from './trademark-similarity/run-search.js';
import Pagination from './pagination.js';
import { loadSharedLayout } from './layout-loader.js';

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
        console.error('[TSS] _getBrandImageByAppNo error:', err);
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
        const headerName = _pickName(null, tmMeta);
        const headerImg = _pickImg(null, tmMeta);
        const applicationNumber = _pickAppNo(null, tmMeta);
        const groupHeaderRow = document.createElement('tr');
        groupHeaderRow.classList.add('group-header');
        groupHeaderRow.innerHTML = `
            <td colspan="9">
                <div class="group-title">
                    <div class="group-trademark-image">
                        ${headerImg ? `<img src="${headerImg}" alt="${headerName}" class="group-header-img">` : `<div class="group-header-placeholder"><strong>${headerName.charAt(0).toUpperCase()}</strong></div>`}
                    </div>
                    <span><strong>${headerName}</strong> markası için bulunan benzer sonuçlar (${groupResults.length} adet)</span>
                </div>
            </td>
        `;
        resultsTableBody.appendChild(groupHeaderRow);
        // Ensure header image is resolved from the most reliable source
        try { resolveGroupHeaderImage(tmMeta, groupHeaderRow); } catch(e) { console.warn(e); }
        groupResults.forEach((hit, index) => resultsTableBody.appendChild(createResultRow(hit, pagination.getStartIndex() + index + 1)));
    });
    attachEventListeners();
};

const createResultRow = (hit, rowIndex) => {
    const holders = Array.isArray(hit.holders) ? hit.holders.map(h => h.name || h.id).filter(Boolean).join(', ') : (hit.holders || '');
    const monitoredTrademark = monitoringTrademarks.find(tm => tm.id === hit.monitoredTrademarkId) || {};
    
    // Nice Sınıfı Renklendirme Mantığı
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

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${rowIndex}</td>
        <td><button class="action-btn ${similarityBtnClass}" data-result-id="${resultId}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}">${similarityBtnText}</button></td>
        <td><strong>${hit.markName || '-'}</strong></td>
        <td>${holders}</td>
        <td>${niceClassHtml}</td>
        <td>${hit.applicationNo ? `<a href="#" class="tp-appno-link" data-appno="${hit.applicationNo}">${hit.applicationNo}</a>` : '-'}</td>
        <td>${similarityScore}</td>
        <td>
            <select class="bs-select" data-result-id="${resultId}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}">
                <option value="">B.Ş</option>
                ${['%0', '%20', '%30', '%40', '%45', '%50', '%55', '%60', '%70', '%80'].map(val => `<option value="${val}" ${hit.bs === val ? 'selected' : ''}>${val}</option>`).join('')}
            </select>
        </td>
        <td class="note-cell" data-result-id="${resultId}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}">
            <div class="note-cell-content"><span class="note-icon">📝</span>${noteContent}</div>
        </td>
    `;
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
    // Tek sekme: Başvuru No bağlantısı
    resultsTableBody.querySelectorAll('.tp-appno-link').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const appNo = a.getAttribute('data-appno');
            if (appNo) { window.queryApplicationNumberWithExtension(appNo); }
        });
    });
    
    // Kriterleri Düzenle bağlantıları
    resultsTableBody.querySelectorAll('.edit-criteria-link').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const tmId = a.dataset.tmid;
            if (typeof window.openCriteriaEditorFor === 'function') {
                window.openCriteriaEditorFor(tmId);
            } else {
                try { localStorage.setItem('OPEN_CRITERIA_FOR_TM_ID', tmId); } catch {}
                window.location.href = 'monitoring-trademarks.html#openCriteria';
            }
        });
    });
    
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
    
    // Inject highlight style for high similarity rows (>= 0.7)
    (function(){
        if (!document.getElementById('tss-high-sim-style')) {
            const st = document.createElement('style');
            st.id = 'tss-high-sim-style';
            st.textContent = '.tss-high-sim { background-color: #fff7cc !important; }';
            document.head.appendChild(st);
        }
    })();initializePagination();
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
    
    if (bulletinSelect.value) {
        checkCacheAndToggleButtonStates();
    }
});