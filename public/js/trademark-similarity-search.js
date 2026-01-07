// public/js/trademark-similarity-search.js

import { db, personService, searchRecordService, similarityService, ipRecordsService, firebaseServices, monitoringService } from '../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where, getFirestore, updateDoc, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { runTrademarkSearch } from './trademark-similarity/run-search.js';
import Pagination from './pagination.js';
import { loadSharedLayout } from './layout-loader.js';
import { showNotification } from '../utils.js';
import { getStorage, ref, getDownloadURL, uploadBytes} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import SimpleLoading from './simple-loading.js';

console.log("### trademark-similarity-search.js yüklendi (Fixed Order) ###");

// --- Global State ---
let allSimilarResults = [];
let monitoringTrademarks = [];
let filteredMonitoringTrademarks = [];
let allPersons = [];
const taskTriggeredStatus = new Map();
const notificationStatus = new Map();
let pagination;
let monitoringPagination;
let selectedMonitoredTrademarkId = null;
let similarityFilter = 'all';
let manualSelectedFile = null;

const functions = firebaseServices.functions;
const TSS_RESUME_KEY = 'TSS_LAST_STATE_V1';
const MANUAL_COLLECTION_ID = 'GLOBAL_MANUAL_RECORDS';
let tpSearchResultData = null;

// --- Helper Functions ---
const tssLoadState = () => { try { return JSON.parse(localStorage.getItem(TSS_RESUME_KEY) || '{}'); } catch { return {}; } };
const tssSaveState = (partial) => { try { const prev = tssLoadState(); localStorage.setItem(TSS_RESUME_KEY, JSON.stringify({ ...prev, ...partial, updatedAt: new Date().toISOString() })); } catch (e) { } };
const tssClearState = () => { try { localStorage.removeItem(TSS_RESUME_KEY); } catch (e) { } };
const tssBuildStateFromUI = (extra = {}) => { const bulletinSelect = document.getElementById('bulletinSelect'); return { bulletinValue: bulletinSelect?.value || '', bulletinText: bulletinSelect?.options?.[bulletinSelect.selectedIndex]?.text || '', ...extra }; };

const tssShowResumeBannerIfAny = () => {
    const state = tssLoadState(); if (!state?.bulletinValue) return;
    let bar = document.getElementById('tssResumeBar'); if (!bar) { bar = document.createElement('div'); bar.id = 'tssResumeBar'; bar.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;background:#1e3c72;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.2);display:flex;gap:8px;align-items:center;font-size:14px;'; document.body.appendChild(bar); }
    bar.innerHTML = `<span>“${state.bulletinText || 'Seçili bülten'}” → Sayfa ${state.page || 1}</span><button id="tssResumeBtn" style="background:#fff;color:#1e3c72;border:none;padding:6px 10px;border-radius:8px;cursor:pointer">Devam Et</button><button id="tssClearBtn" style="background:#ff5a5f;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer">Sıfırla</button>`;
    document.getElementById('tssClearBtn').onclick = () => { tssClearState(); bar.remove(); };
    document.getElementById('tssResumeBtn').onclick = () => {
        const targetPage = tssLoadState().page || 1; window.__tssPendingResumeForBulletin = targetPage;
        const sel = document.getElementById('bulletinSelect'); if (sel) { sel.value = tssLoadState().bulletinValue; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        const startBtn = document.getElementById('startSearchBtn') || document.getElementById('researchBtn'); if (startBtn) { startBtn.click(); let tries = 0; const iv = setInterval(() => { tries++; const loadingIndicator = document.getElementById('loadingIndicator'); if (loadingIndicator && loadingIndicator.style.display === 'none' && allSimilarResults.length > 0 && pagination) { clearInterval(iv); if (pagination.goToPage(targetPage)) { bar.style.background = '#28a745'; bar.firstElementChild.textContent = `Devam edildi: Sayfa ${targetPage}`; setTimeout(() => bar.remove(), 2000); window.__tssPendingResumeForBulletin = null; } } else if (tries > 300) { clearInterval(iv); window.__tssPendingResumeForBulletin = null; } }, 100); }
    };
};
window.addEventListener('beforeunload', () => tssSaveState(tssBuildStateFromUI({ page: pagination?.getCurrentPage ? pagination.getCurrentPage() : undefined, itemsPerPage: pagination?.getItemsPerPage ? pagination.getItemsPerPage() : undefined, totalResults: Array.isArray(allSimilarResults) ? allSimilarResults.length : 0 })));

const debounce = (func, delay) => { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func(...args), delay); }; };
const _appNoImgCache = new Map();
const _normalizeImageSrc = (u) => { if (!u || typeof u !== 'string') return ''; if (/^(https?:|data:|blob:)/i.test(u)) return u; if (/^[A-Za-z0-9+/=]+$/.test(u.slice(0, 100))) return 'data:image/png;base64,' + u; return u; };
const _getBrandImageByAppNo = async (appNo) => {
    if (!appNo) return ''; if (_appNoImgCache.has(appNo)) return _appNoImgCache.get(appNo) || '';
    let url = ''; const bulletinDocId = document.getElementById('bulletinSelect')?.value;
    try { if (bulletinDocId) { const snap = await getDocs(query(collection(db, 'monitoringTrademarkRecords', bulletinDocId, 'trademarks'), where('applicationNo', '==', appNo), limit(1))); if (!snap.empty && snap.docs[0].data().imagePath) url = await getDownloadURL(ref(getStorage(), snap.docs[0].data().imagePath)); } } catch (e) {}
    if (!url) { try { const snap = await getDocs(query(collection(db, 'ipRecords'), where('applicationNumber', '==', appNo), limit(1))); if (!snap.empty) { const d = snap.docs[0].data(); url = _normalizeImageSrc(d.brandImageUrl || d.brandImage || d.details?.brandInfo?.brandImage || ''); } } catch (e) {} }
    _appNoImgCache.set(appNo, url); return url;
};
const _ipCache = new Map();
const _getIp = async (recordId) => { if (!recordId) return null; if (_ipCache.has(recordId)) return _ipCache.get(recordId); try { const { success, data } = await ipRecordsService.getRecordById(recordId); _ipCache.set(recordId, success ? data : null); return success ? data : null; } catch { _ipCache.set(recordId, null); return null; } };
const _pickName = (ip, tm) => ip?.markName || ip?.title || ip?.brandText || tm?.title || tm?.markName || tm?.brandText || '-';
const _pickImg = (ip, tm) => ip?.brandImageUrl || tm?.brandImageUrl || tm?.details?.brandInfo?.brandImage || '';
const _pickAppNo = (ip, tm) => ip?.applicationNumber || ip?.applicationNo || tm?.applicationNumber || tm?.applicationNo || '-';
const _pickAppDate = (ip, tm) => { const v = ip?.applicationDate || tm?.applicationDate; if (!v) return '-'; try { const d = (v && typeof v === 'object' && typeof v.toDate === 'function') ? v.toDate() : new Date(v); return isNaN(+d) ? '-' : d.toLocaleDateString('tr-TR'); } catch { return '-'; } };
const getTotalCountForMonitoredId = (id) => { try { return id ? allSimilarResults.reduce((acc, r) => acc + (r.monitoredTrademarkId === id ? 1 : 0), 0) : 0; } catch { return 0; } };
const _getOwnerKey = (ip, tm, persons = []) => { const f = ip?.applicants?.[0] || tm?.applicants?.[0] || null; if (f?.id) { const p = persons.find(p => p.id === f.id); const name = p?.name || f.name || f.title || 'Bilinmeyen Sahip'; return { key: `${f.id}_${name}`, id: f.id, name }; } const o = _pickOwners(ip, tm, persons); return { key: o || 'Bilinmeyen Sahip', id: (ip?.clientId || tm?.clientId || 'unknown_group'), name: o || 'Bilinmeyen Sahip' }; };
const _pickOwners = (ip, tm, persons = []) => { if (Array.isArray(ip?.applicants) && ip.applicants.length) return ip.applicants.map(a => a?.name).filter(Boolean).join(', '); if (Array.isArray(ip?.owners) && ip.owners.length) return ip.owners.map(o => (typeof o === 'object' ? (o.name || o.displayName || persons.find(p => p.id === o.id)?.name) : String(o))).filter(Boolean).join(', '); if (ip?.ownerName) return ip.ownerName; if (Array.isArray(tm?.applicants) && tm.applicants.length) return tm.applicants.map(a => a?.name).filter(Boolean).join(', '); if (Array.isArray(tm?.owners) && tm.owners.length) return tm.owners.map(o => (typeof o === 'object' ? (o.name || o.displayName || persons.find(p => p.id === o.id)?.name) : String(o))).filter(Boolean).join(', '); return typeof tm?.holders === 'string' ? tm.holders : '-'; };
const _uniqNice = (obj) => { const set = new Set(); (obj?.goodsAndServicesByClass || []).forEach(c => c?.classNo != null && set.add(String(c.classNo))); (obj?.niceClasses || []).forEach(n => set.add(String(n))); if (obj?.niceClass) String(obj.niceClass).split(/[,\s]+/).forEach(n => n && set.add(n)); return Array.from(set).sort((a, b) => Number(a) - Number(b)).join(', '); };
const getNiceClassNumbers = (item) => { return (item.goodsAndServicesByClass && Array.isArray(item.goodsAndServicesByClass)) ? item.goodsAndServicesByClass.map(i => String(i.classNo)).filter(c => c) : []; };
function normalizeNiceList(input) { const raw = Array.isArray(input) ? input.join(',') : String(input || ''); return raw.split(/[^\d]+/).filter(Boolean).map(p => String(parseInt(p, 10))).filter(p => !isNaN(p) && ((Number(p) >= 1 && Number(p) <= 45) || Number(p) === 99)); }

const refreshTriggeredStatus = async (bulletinNo) => {
    try {
        taskTriggeredStatus.clear();
        if (!bulletinNo) return;
        const qTasks = query(collection(db, 'tasks'), where('taskType', '==', '20'), where('status', '==', 'awaiting_client_approval'));
        const snap = await getDocs(qTasks);
        if (snap.empty) return;
        const relevantTasks = snap.docs.filter(d => String(d.data()?.details?.bulletinNo || d.data()?.bulletinNo || '') === String(bulletinNo));
        if (relevantTasks.length === 0) return;
        const tmById = new Map(monitoringTrademarks.map(tm => [tm.id, tm]));
        for (const docSnap of relevantTasks) {
            const t = docSnap.data();
            const monitoredMarkId = t?.details?.monitoredMarkId || t?.monitoredMarkId;
            if (!monitoredMarkId) continue;
            const tm = tmById.get(monitoredMarkId);
            if (!tm) continue;
            const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
            const ownerInfo = _getOwnerKey(ip, tm, allPersons);
            if (ownerInfo?.id) taskTriggeredStatus.set(ownerInfo.id, 'Evet');
        }
    } catch (e) { console.error(e); }
};

// --- RENDER FUNCTIONS ---

const renderMonitoringList = async () => {
    const tbody = document.getElementById('monitoringListBody');
    if (!filteredMonitoringTrademarks.length) { tbody.innerHTML = '<tr><td colspan="6" class="no-records">Filtreye uygun izlenecek marka bulunamadı.</td></tr>'; return; }

    const groupedByOwner = {};
    for (const tm of filteredMonitoringTrademarks) {
        const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
        const ownerInfo = _getOwnerKey(ip, tm, allPersons);
        const ownerKey = ownerInfo.key;
        if (!groupedByOwner[ownerKey]) groupedByOwner[ownerKey] = { ownerName: ownerInfo.name, ownerId: ownerInfo.id, trademarks: [], allNiceClasses: new Set() };
        _uniqNice(ip || tm).split(', ').forEach(n => groupedByOwner[ownerKey].allNiceClasses.add(n));
        groupedByOwner[ownerKey].trademarks.push({ tm, ip, ownerInfo });
    }

    const sortedOwnerKeys = Object.keys(groupedByOwner).sort((a, b) => groupedByOwner[a].ownerName.localeCompare(groupedByOwner[b].ownerName));
    const itemsPerPage = monitoringPagination ? monitoringPagination.getItemsPerPage() : 5;
    const currentPage = monitoringPagination ? monitoringPagination.getCurrentPage() : 1;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedOwnerKeys = sortedOwnerKeys.slice(startIndex, endIndex);

    let allRowsHtml = [];

    for (const ownerKey of paginatedOwnerKeys) {
        const group = groupedByOwner[ownerKey];
        const groupUid = `owner-group-${group.ownerId}-${ownerKey.replace(/[^a-zA-Z0-9]/g, '').slice(-10)}`;
        const isTriggered = taskTriggeredStatus.get(group.ownerId) === 'Evet';
        const statusText = isTriggered ? 'Evet' : 'Hazır';
        const statusClass = isTriggered ? 'trigger-yes' : 'trigger-ready';

        const headerRow = `
        <tr class="owner-row" data-toggle="collapse" data-target="#${groupUid}" aria-expanded="false" aria-controls="${groupUid}">
            <td><i class="fas fa-chevron-down toggle-icon"></i></td>
            <td>${group.ownerName}</td>
            <td>${group.trademarks.length}</td>
            <td><span class="task-triggered-status trigger-status-badge ${statusClass}" data-owner-id="${group.ownerId}">${statusText}</span></td>
            <td><span class="notification-status-badge ${notificationStatus.get(group.ownerId) === 'Gönderildi' ? 'sent-status' : 'initial-status'}" data-owner-id="${group.ownerId}">${notificationStatus.get(group.ownerId) || 'Gönderilmedi'}</span></td>
            <td>
                <div class="action-btn-group">
                    <button class="action-btn btn-success generate-report-and-notify-btn" data-owner-id="${group.ownerId}" data-owner-name="${group.ownerName}" title="Rapor + Bildir"><i class="fas fa-paper-plane"></i></button>
                    <button class="action-btn btn-primary generate-report-btn" data-owner-id="${group.ownerId}" data-owner-name="${group.ownerName}" title="Rapor İndir"><i class="fas fa-file-pdf"></i></button>
                </div>
            </td>
        </tr>`;
        allRowsHtml.push(headerRow);

        const detailRowsHtml = group.trademarks.map(({ tm, ip }) => {
            const [markName, imgSrc, appNo, nices, appDate] = [_pickName(ip, tm), _pickImg(ip, tm), _pickAppNo(ip, tm), _uniqNice(ip || tm), _pickAppDate(ip, tm)];
            return `
                <tr class="trademark-detail-row">
                    <td></td>
                    <td>${imgSrc ? `<div class="tm-img-box tm-img-box-sm"><img class="trademark-image-thumbnail-large" src="${imgSrc}" alt="Marka"></div>` : `<div class="tm-img-box tm-img-box-sm tm-placeholder">-</div>`}</td>
                    <td><strong>${markName}</strong></td>
                    <td>${appNo}</td>
                    <td>${nices || '-'}</td> 
                    <td>${appDate}</td>
                </tr>`;
        }).join('');

        const contentRow = `
            <tr id="${groupUid}" class="accordion-content-row" style="display: none;">
                <td colspan="6">
                    <table class="table table-sm nested-table">
                        <thead><tr><th></th><th class="col-nest-img">Görsel</th><th class="col-nest-name">Marka Adı</th><th class="col-nest-appno">Başvuru No</th><th class="col-nest-nice">Nice Sınıfı</th><th class="col-nest-date">B. Tarihi</th></tr></thead>
                        <tbody>${detailRowsHtml}</tbody>
                    </table>
                </td>
            </tr>`;
        allRowsHtml.push(contentRow);
    }
    tbody.innerHTML = allRowsHtml.join('');
    attachMonitoringAccordionListeners(); attachGenerateReportListener(); attachTrademarkClickListener();

    setTimeout(() => {
        document.querySelectorAll('#monitoringListBody .owner-row').forEach(row => {
            const btn = row.querySelector('.generate-report-and-notify-btn'); if (!btn) return;
            const ownerId = btn.dataset.ownerId; const badge = row.querySelector('.task-triggered-status, .trigger-status-badge');
            if (badge) {
                const hasTriggered = taskTriggeredStatus.get(ownerId) === 'Evet';
                badge.textContent = hasTriggered ? 'Evet' : 'Hazır';
                badge.classList.remove('trigger-yes', 'trigger-no', 'trigger-ready');
                badge.classList.add(hasTriggered ? 'trigger-yes' : 'trigger-ready');
            }
        });
    }, 300);
};

const createResultRow = (hit, rowIndex) => {
    const holders = Array.isArray(hit.holders) ? hit.holders.map(h => h.name || h.id).filter(Boolean).join(', ') : (hit.holders || '');
    const monitoredTrademark = monitoringTrademarks.find(tm => tm.id === (hit.monitoredTrademarkId || hit.monitoredMarkId)) || {};
    const resultClasses = normalizeNiceList(hit.niceClasses); let goodsAndServicesClasses = normalizeNiceList(getNiceClassNumbers(monitoredTrademark));
    if (goodsAndServicesClasses.length === 0) goodsAndServicesClasses = normalizeNiceList(Array.isArray(monitoredTrademark?.niceClasses) && monitoredTrademark.niceClasses.length ? monitoredTrademark.niceClasses : _uniqNice(monitoredTrademark));
    const goodsAndServicesSet = new Set(goodsAndServicesClasses); const monitoredSet = new Set(normalizeNiceList(monitoredTrademark?.niceClassSearch || []));
    const niceClassHtml = [...new Set(resultClasses)].map(cls => `<span class="nice-class-badge ${goodsAndServicesSet.has(cls) ? 'match' : (monitoredSet.has(cls) ? 'partial-match' : '')}">${cls}</span>`).join('');
    
    const similarityScore = hit.similarityScore ? `${(hit.similarityScore * 100).toFixed(0)}%` : '-';
    const similarityBtnClass = hit.isSimilar === true ? 'similar' : 'not-similar';
    const similarityBtnText = hit.isSimilar === true ? 'Benzer' : 'Benzemez';
    const noteContent = hit.note ? `<span class="note-text">${hit.note}</span>` : `<span class="note-placeholder">Not ekle</span>`;
    const imagePlaceholderHtml = `<div class="tm-img-box tm-img-box-lg"><div class="tm-placeholder">-</div></div>`;
    const bulletinSelect = document.getElementById('bulletinSelect');

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${rowIndex}</td>
        <td><button class="action-btn ${similarityBtnClass}" data-result-id="${hit.objectID || hit.applicationNo}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}">${similarityBtnText}</button></td>
        <td data-appno="${hit.applicationNo}" class="trademark-image-cell">${imagePlaceholderHtml}</td>
        <td><strong>${hit.markName || '-'}</strong></td>
        <td>${holders}</td>
        <td>${niceClassHtml}</td>
        <td>${hit.applicationNo ? `<a href="#" class="tp-appno-link" data-tp-appno="${hit.applicationNo}" onclick="event.preventDefault(); window.queryApplicationNumberWithExtension('${hit.applicationNo}');">${hit.applicationNo}</a>` : '-'}</td>
        <td>${similarityScore}</td>
        <td><select class="bs-select" data-result-id="${hit.objectID || hit.applicationNo}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}"><option value="">B.Ş</option>${['%0', '%20', '%30', '%40', '%45', '%50', '%55', '%60', '%70', '%80'].map(val => `<option value="${val}" ${hit.bs === val ? 'selected' : ''}>${val}</option>`).join('')}</select></td>
        <td class="note-cell" data-result-id="${hit.objectID || hit.applicationNo}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}"><div class="note-cell-content"><span class="note-icon">📝</span>${noteContent}</div></td>
    `;

    setTimeout(async () => {
        const imageCell = row.querySelector('.trademark-image-cell'); if (!imageCell || !imageCell.isConnected) return;
        try {
            let imgUrl = '';
            if (hit.imagePath) { const storage = getStorage(); imgUrl = await getDownloadURL(ref(storage, hit.imagePath)); } 
            else if (hit.brandImageUrl) { imgUrl = hit.brandImageUrl; } 
            else if (hit.applicationNo) { imgUrl = await _getBrandImageByAppNo(hit.applicationNo); }
            if (imgUrl) imageCell.innerHTML = `<div class="tm-img-box tm-img-box-lg"><img src="${imgUrl}" alt="Marka" class="trademark-image-thumbnail-large"></div>`;
        } catch (err) { console.warn(`Görsel yüklenemedi: ${hit.applicationNo}`); }
    }, 50);
    return row;
};

// --- INITIALIZATION FUNCTIONS (Bu fonksiyonların ÖNCE tanımlanması şart) ---

const initializePagination = () => { if (!pagination) pagination = new Pagination({ containerId: 'paginationContainer', itemsPerPage: 10, onPageChange: (page, itemsPerPage) => { renderCurrentPageOfResults(); tssSaveState(tssBuildStateFromUI({ page, itemsPerPage, totalResults: allSimilarResults.length })); } }); };
const initializeMonitoringPagination = () => { if (!monitoringPagination) monitoringPagination = new Pagination({ containerId: 'monitoringPaginationContainer', itemsPerPage: 5, onPageChange: () => renderMonitoringList() }); };
const updateMonitoringCount = async () => {
    const ownerGroups = {}; for (const tm of filteredMonitoringTrademarks) { const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id); const ownerInfo = _getOwnerKey(ip, tm, allPersons); if (!ownerGroups[ownerInfo.key]) ownerGroups[ownerInfo.key] = true; }
    document.getElementById('monitoringCount').textContent = `${Object.keys(ownerGroups).length} Sahip (${filteredMonitoringTrademarks.length} Marka)`;
};
const updateOwnerBasedPagination = async () => {
    const ownerGroups = {}; for (const tm of filteredMonitoringTrademarks) { const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id); const ownerInfo = _getOwnerKey(ip, tm, allPersons); if (!ownerGroups[ownerInfo.key]) ownerGroups[ownerInfo.key] = true; }
    monitoringPagination.update(Object.keys(ownerGroups).length); monitoringPagination.reset();
};
const applyMonitoringListFilters = async () => {
    const ownerSearchInput = document.getElementById('ownerSearch');
    const niceClassSearchInput = document.getElementById('niceClassSearch');
    const brandNameSearchInput = document.getElementById('brandNameSearch');
    
    const [ownerFilter, niceFilter, brandFilter] = [ownerSearchInput?.value || '', niceClassSearchInput?.value || '', brandNameSearchInput?.value || ''].map(s => s.toLowerCase());
    const filteredResults = []; for (const data of monitoringTrademarks) { const ip = await _getIp(data.ipRecordId || data.sourceRecordId || data.id); const ownerInfo = _getOwnerKey(ip, data, allPersons); const ownerName = ownerInfo.name.toLowerCase(); const niceClasses = _uniqNice(ip || data); const markName = (data.title || data.markName || data.brandText || '').toLowerCase(); const ownerMatch = !ownerFilter || ownerName.includes(ownerFilter); const niceMatch = !niceFilter || niceClasses.toLowerCase().includes(niceFilter); const brandMatch = !brandFilter || markName.includes(brandFilter); if (ownerMatch && niceMatch && brandMatch) filteredResults.push(data); }
    filteredMonitoringTrademarks = filteredResults; await updateOwnerBasedPagination(); renderMonitoringList(); updateMonitoringCount(); checkCacheAndToggleButtonStates();
};

const loadInitialData = async () => {
    await loadSharedLayout({ activeMenuLink: 'trademark-similarity-search.html' }); const personsResult = await personService.getPersons(); if (personsResult.success) allPersons = personsResult.data; await loadBulletinOptions();
    const snapshot = await getDocs(collection(db, 'monitoringTrademarks')); monitoringTrademarks = await Promise.all(snapshot.docs.map(async (docSnap) => { const tmData = { id: docSnap.id, ...docSnap.data() }; if (tmData.ipRecordId || tmData.sourceRecordId) { try { const ipDoc = await getDoc(doc(db, 'ipRecords', tmData.ipRecordId || tmData.sourceRecordId)); if (ipDoc.exists()) { tmData.ipRecord = ipDoc.data(); tmData.goodsAndServicesByClass = ipDoc.data().goodsAndServicesByClass || []; } } catch (e) {} } return tmData; }));
    filteredMonitoringTrademarks = [...monitoringTrademarks]; initializeMonitoringPagination(); renderMonitoringList(); updateMonitoringCount(); monitoringPagination.update(filteredMonitoringTrademarks.length);
    const bs = document.getElementById('bulletinSelect'); if (bs?.value) { const bNo = String(bs.value).split('_')[0]; if (bNo) { await refreshTriggeredStatus(bNo); renderMonitoringList(); } }
};

const loadBulletinOptions = async () => {
    try {
        const bulletinSelect = document.getElementById('bulletinSelect'); bulletinSelect.innerHTML = '<option value="">Bülten seçin...</option>';
        const [registeredSnapshot, monitoringSnapshot] = await Promise.all([getDocs(collection(db, 'trademarkBulletins')), getDocs(collection(db, 'monitoringTrademarkRecords'))]);
        const allBulletins = new Map(); registeredSnapshot.forEach(doc => { const data = doc.data(); const bulletinKey = `${data.bulletinNo}_${(data.bulletinDate || '').replace(/\D/g, '')}`; allBulletins.set(bulletinKey, { ...data, bulletinKey, source: 'registered', hasOriginalBulletin: true, displayName: `${data.bulletinNo} - ${data.bulletinDate || ''} (Kayıtlı)` }); });
        for (const bulletinDoc of monitoringSnapshot.docs) {
            const bulletinKeyRaw = bulletinDoc.id; try { const trademarksRef = collection(db, 'monitoringTrademarkRecords', bulletinKeyRaw, 'trademarks'); const trademarksSnapshot = await getDocs(trademarksRef); if (!trademarksSnapshot.empty) { const parts = bulletinKeyRaw.split('_'); const normalizedKey = `${parts[0]}_${(parts[1] || '').replace(/\D/g, '')}`; if (!allBulletins.has(normalizedKey)) { const bulletinDate = (parts[1] || '').length === 8 ? parts[1].replace(/(\d{2})(\d{2})(\d{4})/, '$1.$2.$3') : (parts[1] || 'Tarih Yok'); allBulletins.set(normalizedKey, { bulletinNo: parts[0], bulletinDate, bulletinKey: normalizedKey, source: 'searchOnly', hasOriginalBulletin: false, displayName: `${parts[0]} - ${bulletinDate} (Sadece Arama)` }); } } } catch (e) { }
        }
        const sortedBulletins = Array.from(allBulletins.values()).sort((a, b) => parseInt(b.bulletinNo) - parseInt(a.bulletinNo)); sortedBulletins.forEach(bulletin => { const option = document.createElement('option'); Object.keys(bulletin).forEach(key => option.dataset[key] = bulletin[key]); option.value = bulletin.bulletinKey; option.textContent = bulletin.displayName; bulletinSelect.appendChild(option); });
    } catch (error) { console.error('Error loading bulletin options:', error); }
};

const checkCacheAndToggleButtonStates = async () => {
    const bulletinSelect = document.getElementById('bulletinSelect');
    const startSearchBtn = document.getElementById('startSearchBtn');
    const researchBtn = document.getElementById('researchBtn');
    const btnGenerateReportAndNotifyGlobal = document.getElementById('btnGenerateReportAndNotifyGlobal');
    const infoMessageContainer = document.getElementById('infoMessageContainer');

    const bulletinKey = bulletinSelect.value; if (!bulletinKey || filteredMonitoringTrademarks.length === 0) { startSearchBtn.disabled = true; researchBtn.disabled = true; infoMessageContainer.innerHTML = ''; btnGenerateReportAndNotifyGlobal.disabled = true; return; }
    try {
        const selectedOption = bulletinSelect.options[bulletinSelect.selectedIndex]; const hasOriginalBulletin = selectedOption?.dataset?.hasOriginalBulletin === 'true'; const snapshot = await getDocs(collection(db, 'monitoringTrademarkRecords', bulletinKey, 'trademarks')); const hasCache = snapshot.docs.some(doc => doc.data().results?.length > 0);
        if (hasCache) { await loadDataFromCache(bulletinKey); startSearchBtn.disabled = true; researchBtn.disabled = !hasOriginalBulletin; btnGenerateReportAndNotifyGlobal.disabled = allSimilarResults.length === 0; const messageType = hasOriginalBulletin ? 'success' : 'warning'; const messageText = hasOriginalBulletin ? 'Bu bülten sistemde kayıtlı. Önbellekten sonuçlar yüklendi.' : 'Bu bülten sistemde kayıtlı değil. Sadece eski arama sonuçları gösterilmektedir.'; infoMessageContainer.innerHTML = `<div class="info-message ${messageType}"><strong>Bilgi:</strong> ${messageText}</div>`; } 
        else { startSearchBtn.disabled = !hasOriginalBulletin; researchBtn.disabled = true; btnGenerateReportAndNotifyGlobal.disabled = true; const messageType = hasOriginalBulletin ? 'info' : 'error'; const messageText = hasOriginalBulletin ? 'Önbellekte veri bulunamadı. "Arama Başlat" butonuna tıklayarak arama yapabilirsiniz.' : 'Bu bülten sistemde kayıtlı değil ve arama sonucu da bulunamadı.'; infoMessageContainer.innerHTML = `<div class="info-message ${messageType}"><strong>Bilgi:</strong> ${messageText}</div>`; allSimilarResults = []; if (pagination) pagination.update(0); renderCurrentPageOfResults(); }
    } catch (error) { console.error('Cache check error:', error); startSearchBtn.disabled = true; researchBtn.disabled = true; btnGenerateReportAndNotifyGlobal.disabled = true; infoMessageContainer.innerHTML = `<div class="info-message error"><strong>Hata:</strong> Bülten bilgileri kontrol edilirken bir hata oluştu.</div>`; }
};

const loadDataFromCache = async (bulletinKey) => {
    const noRecordsMessage = document.getElementById('noRecordsMessage');
    const infoMessageContainer = document.getElementById('infoMessageContainer');
    try { const snapshot = await getDocs(collection(db, 'monitoringTrademarkRecords', bulletinKey, 'trademarks')); const cachedResults = snapshot.docs.flatMap(docSnap => { const data = docSnap.data(); return (data.results || []).map(r => ({ ...r, source: 'cache', monitoredTrademarkId: docSnap.id })); }); allSimilarResults = cachedResults; infoMessageContainer.innerHTML = cachedResults.length > 0 ? `<div class="info-message success">Önbellekten ${cachedResults.length} benzer sonuç yüklendi.</div>` : ''; noRecordsMessage.style.display = cachedResults.length > 0 ? 'none' : 'block'; if (pagination) pagination.update(allSimilarResults.length); renderCurrentPageOfResults(); } catch (error) { console.error("Error loading data from cache:", error); }
};

// --- Modal Helpers ---
async function openEditCriteriaModal(markData) { const modal = document.getElementById('editCriteriaModal'); const modalTitle = document.getElementById('editCriteriaModalLabel'); const trademarkNameEl = document.getElementById('modalTrademarkName'); const applicationNoEl = document.getElementById('modalApplicationNo'); const ownerEl = document.getElementById('modalOwner'); const niceClassEl = document.getElementById('modalNiceClass'); const brandTextList = document.getElementById('brandTextSearchList'); const niceClassSelectionContainer = document.getElementById('niceClassSelectionContainer'); const modalImage = document.getElementById('modalTrademarkImage'); modalTitle.textContent = `Kriterleri Düzenle: ${markData.markName}`; trademarkNameEl.textContent = markData.markName || '-'; applicationNoEl.textContent = markData.applicationNumber || '-'; ownerEl.textContent = markData.owner || '-'; niceClassEl.textContent = Array.isArray(markData.niceClasses) ? markData.niceClasses.join(', ') : '-'; modalImage.alt = markData.markName || 'Marka Görseli'; modalImage.src = ''; try { let imgUrl = ''; if (markData.brandImageUrl && /^(https?:|data:)/i.test(markData.brandImageUrl)) imgUrl = markData.brandImageUrl; if (!imgUrl && markData.ipRecordId) { const ip = await _getIp(markData.ipRecordId); imgUrl = _pickImg(ip, markData) || ''; } if (!imgUrl && markData.applicationNumber) imgUrl = await _getBrandImageByAppNo(markData.applicationNumber); if (imgUrl) { if (!/^(https?:|data:|blob:)/i.test(imgUrl) && !/^data:image\//i.test(imgUrl)) { imgUrl = await getDownloadURL(ref(getStorage(), imgUrl)); } modalImage.src = imgUrl; } } catch (e) { } modal.dataset.markId = markData.id; const permanentBrandText = [markData.markName].filter(Boolean); const permanentNiceClasses = markData.niceClasses.map(String); const existingBrandTextSearch = markData.brandTextSearch || []; const existingNiceClassSearch = markData.niceClassSearch || []; populateList(brandTextList, existingBrandTextSearch, permanentBrandText); niceClassSelectionContainer.innerHTML = ''; for (let i = 1; i <= 45; i++) { const box = document.createElement('div'); box.className = 'nice-class-box'; box.textContent = i; box.dataset.classNo = i; niceClassSelectionContainer.appendChild(box); } populateNiceClassBoxes(existingNiceClassSearch, permanentNiceClasses); $('#editCriteriaModal').modal('show'); }
function setupEditCriteriaModal() { const brandTextSearchInput = document.getElementById('brandTextSearchInput'); const addBrandTextBtn = document.getElementById('addBrandTextBtn'); const brandTextSearchList = document.getElementById('brandTextSearchList'); const niceClassSelectionContainer = document.getElementById('niceClassSelectionContainer'); const niceClassSearchList = document.getElementById('niceClassSearchList'); const saveCriteriaBtn = document.getElementById('saveCriteriaBtn'); for (let i = 1; i <= 45; i++) { const box = document.createElement('div'); box.className = 'nice-class-box'; box.textContent = i; box.dataset.classNo = i; niceClassSelectionContainer.appendChild(box); } niceClassSelectionContainer.addEventListener('click', (e) => { if (e.target.classList.contains('nice-class-box')) { const classNo = e.target.dataset.classNo; const isPermanent = e.target.classList.contains('permanent-item'); if (isPermanent) { showNotification('Bu sınıf orijinal marka sınıfı olduğu için kaldırılamaz.', 'warning'); return; } e.target.classList.toggle('selected'); if (e.target.classList.contains('selected')) addListItem(niceClassSearchList, classNo); else removeListItem(niceClassSearchList, classNo); } }); const addBrandText = () => { const value = brandTextSearchInput.value.trim(); if (value) { addListItem(brandTextSearchList, value); brandTextSearchInput.value = ''; } }; addBrandTextBtn.addEventListener('click', addBrandText); brandTextSearchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBrandText(); } }); document.querySelectorAll('.list-group').forEach(list => { list.addEventListener('click', (e) => { const listItem = e.target.closest('li'); if (listItem && e.target.classList.contains('remove-item')) { if (listItem.classList.contains('permanent-item')) { showNotification('Bu öğe kaldırılamaz.', 'warning'); return; } const textContent = listItem.querySelector('.list-item-text').textContent; listItem.remove(); if (list.id === 'niceClassSearchList') { const box = document.querySelector(`.nice-class-box[data-class-no="${textContent}"]`); if (box) box.classList.remove('selected'); } if (list.children.length === 0) { const emptyItem = document.createElement('li'); emptyItem.className = "list-group-item text-muted"; emptyItem.textContent = list.id === 'brandTextSearchList' ? 'Aranacak marka adı listesi.' : 'Aranacak Nice Sınıfı listesi.'; list.appendChild(emptyItem); } } }); }); saveCriteriaBtn.addEventListener('click', async () => { const modal = document.getElementById('editCriteriaModal'); const brandTextArray = Array.from(modal.querySelector('#brandTextSearchList').querySelectorAll('.list-item-text')).map(el => el.textContent); const niceClassArray = Array.from(modal.querySelector('#niceClassSearchList').querySelectorAll('.list-item-text')).map(el => parseInt(el.textContent)).filter(n => !isNaN(n)); const originalMarkId = modal.dataset.markId; if (!originalMarkId) { showNotification('Orijinal marka kimliği bulunamadı.', 'error'); return; } try { const res = await monitoringService.updateMonitoringItem(originalMarkId, { brandTextSearch: brandTextArray, niceClassSearch: niceClassArray }); if (res.success) { showNotification('İzleme kriterleri güncellendi.', 'success'); $('#editCriteriaModal').modal('hide'); } else showNotification('Hata: ' + res.error, 'error'); } catch (error) { console.error(error); showNotification('Beklenmeyen hata.', 'error'); } }); }
function populateNiceClassBoxes(selectedClasses, permanentClasses = []) { document.querySelectorAll('.nice-class-box').forEach(box => { box.classList.remove('selected'); box.classList.remove('permanent-item'); }); const selectedClassesString = (selectedClasses || []).map(cls => String(cls)).filter(cls => cls && cls !== 'null'); const permanentClassesString = (permanentClasses || []).map(cls => String(cls)).filter(cls => cls && cls !== 'null'); const allNiceClasses = new Set([...selectedClassesString, ...permanentClassesString]); const niceClassSearchList = document.getElementById('niceClassSearchList'); if (niceClassSearchList) populateList(niceClassSearchList, [], permanentClassesString); allNiceClasses.forEach(cls => { const box = document.querySelector(`.nice-class-box[data-class-no="${cls}"]`); if (box) { box.classList.add('selected'); if (permanentClassesString.includes(cls)) box.classList.add('permanent-item'); if (niceClassSearchList) { const listItem = addListItem(niceClassSearchList, cls); if (listItem && permanentClassesString.includes(cls)) listItem.classList.add('permanent-item'); } } }); }
function addListItem(listElement, text, isPermanent = false) { const emptyItem = listElement.querySelector('.list-group-item.text-muted'); if (emptyItem) emptyItem.remove(); const existingItems = Array.from(listElement.querySelectorAll('.list-item-text')).map(el => el.textContent); if (existingItems.includes(text)) return; const li = document.createElement('li'); li.className = 'list-group-item d-flex justify-content-between align-items-center'; if (isPermanent) li.classList.add('permanent-item'); li.innerHTML = `<span class="list-item-text">${text}</span><button type="button" class="btn btn-sm btn-danger remove-item">&times;</button>`; listElement.appendChild(li); return li; }
function removeListItem(listElement, text) { }
function populateList(listElement, items, permanentItems = []) { listElement.innerHTML = ''; const allItems = new Set([...items.map(String), ...permanentItems.map(String)]); if (allItems.size > 0) { allItems.forEach(item => { const isPermanent = permanentItems.includes(item); addListItem(listElement, item, isPermanent); }); } else { const emptyItem = document.createElement('li'); emptyItem.className = "list-group-item text-muted"; emptyItem.textContent = listElement.id === 'brandTextSearchList' ? 'Aranacak marka adı listesi.' : 'Aranacak Nice Sınıfı listesi.'; listElement.appendChild(emptyItem); } }
window.queryApplicationNumberWithExtension = (applicationNo) => { const appNo = (applicationNo || '').toString().trim(); if (!appNo) { alert('Başvuru numarası bulunamadı.'); return; } const EXT_ID = 'gkhmldkbjmnipikgjabmlilibllikapk'; const fallbackUrl = `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(appNo)}`; try { if (typeof chrome !== 'undefined' && chrome.runtime && EXT_ID) { chrome.runtime.sendMessage(EXT_ID, { type: 'SORGULA', data: appNo }, (response) => { const ok = response && (response.status === 'OK' || response.status === 'OK_WAIT'); if (!ok) window.open(fallbackUrl, '_blank'); }); } else { window.open(fallbackUrl, '_blank'); } } catch (e) { window.open(fallbackUrl, '_blank'); } };

// --- Main Entry ---
document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elementlerini BURADA alıyoruz (En önemli düzeltme)
    const startSearchBtn = document.getElementById('startSearchBtn');
    const researchBtn = document.getElementById('researchBtn');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    const ownerSearchInput = document.getElementById('ownerSearch');
    const niceClassSearchInput = document.getElementById('niceClassSearch');
    const brandNameSearchInput = document.getElementById('brandNameSearch');
    const bulletinSelect = document.getElementById('bulletinSelect');
    const btnGenerateReportAndNotifyGlobal = document.getElementById('btnGenerateReportAndNotifyGlobal');
    const openManualEntryBtn = document.getElementById('openManualEntryBtn');
    const btnQueryTp = document.getElementById('btnQueryTpRecord');
    const btnSaveManual = document.getElementById('btnSaveManualResult');
    const similarityFilterSelect = document.getElementById('similarityFilterSelect');
    const clearTrademarkFilterBtn = document.getElementById('clearTrademarkFilterBtn');
    const resultsTableBody = document.getElementById('resultsTableBody');

    // Başlangıç Yüklemeleri
    initializePagination(); 
    await loadInitialData(); 
    tssShowResumeBannerIfAny();

    // Event Listener'lar
    if(startSearchBtn) startSearchBtn.addEventListener('click', performSearch);
    if(researchBtn) researchBtn.addEventListener('click', performResearch);
    
    if(clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => { 
            if(ownerSearchInput) ownerSearchInput.value = ''; 
            if(niceClassSearchInput) niceClassSearchInput.value = ''; 
            if(brandNameSearchInput) brandNameSearchInput.value = ''; 
            if(bulletinSelect) bulletinSelect.selectedIndex = 0; 
            applyMonitoringListFilters(); 
            showNotification('İzleme listesi filtreleri temizlendi.', 'info'); 
        });
    }

    [ownerSearchInput, niceClassSearchInput, brandNameSearchInput].forEach(input => {
        if(input) input.addEventListener('input', debounce(applyMonitoringListFilters, 400));
    });

    if(bulletinSelect) {
        bulletinSelect.addEventListener('change', checkCacheAndToggleButtonStates);
        bulletinSelect.addEventListener('change', async () => { 
            const bNo = String(bulletinSelect.value || '').split('_')[0]; 
            if (bNo) { 
                await refreshTriggeredStatus(bNo); 
                renderMonitoringList(); 
            } 
        });
    }

    if(btnGenerateReportAndNotifyGlobal) btnGenerateReportAndNotifyGlobal.addEventListener('click', handleGlobalReportAndNotifyGeneration);
    
    // Manuel Modal
    if(openManualEntryBtn) openManualEntryBtn.addEventListener('click', openManualEntryModal);
    
    document.querySelectorAll('.btn-group-toggle label.btn').forEach(label => { 
        label.addEventListener('click', function() { 
            const input = this.querySelector('input'); 
            if (input) setTimeout(() => updateManualFormUI(input.value), 50); 
        }); 
    });

    if(btnQueryTp) btnQueryTp.addEventListener('click', queryTpRecordForManualAdd);
    if(btnSaveManual) btnSaveManual.addEventListener('click', saveManualResultEntry);

    // Diğer Butonlar
    document.getElementById('closeNoteModal')?.addEventListener('click', () => document.getElementById('noteModal').classList.remove('show'));
    document.getElementById('cancelNoteBtn')?.addEventListener('click', () => document.getElementById('noteModal').classList.remove('show'));
    
    if(resultsTableBody) {
        resultsTableBody.addEventListener('click', (e) => { 
            const editButton = e.target.closest('.edit-criteria-link'); 
            if (editButton) { 
                e.preventDefault(); 
                const row = editButton.closest('tr.group-header'); 
                if (row && row.dataset.markData) { openEditCriteriaModal(JSON.parse(row.dataset.markData)); } 
            } 
        });
    }

    if(similarityFilterSelect) {
        similarityFilterSelect.addEventListener('change', () => { 
            similarityFilter = similarityFilterSelect.value; 
            renderCurrentPageOfResults(); 
        });
    }

    if(clearTrademarkFilterBtn) {
        clearTrademarkFilterBtn.addEventListener('click', () => { 
            selectedMonitoredTrademarkId = null; 
            renderCurrentPageOfResults(); 
            showNotification('Marka filtresi kaldırıldı.', 'info'); 
        });
    }

    setupEditCriteriaModal(); 
    setupManualTargetSearch(); 
    setupDragAndDrop();
    
    setTimeout(addGlobalOptionToBulletinSelect, 1000);
});