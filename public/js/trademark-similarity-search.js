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

console.log("### trademark-similarity-search.js yüklendi (Fixed Buttons & UI) ###");

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
                        <thead>
                            <tr>
                                <th></th>
                                <th class="col-nest-img">Görsel</th>
                                <th class="col-nest-name">Marka Adı</th>
                                <th class="col-nest-appno">Başvuru No</th>
                                <th class="col-nest-nice">Nice Sınıfı</th>
                                <th class="col-nest-date">B. Tarihi</th>
                            </tr>
                        </thead>
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

const renderCurrentPageOfResults = () => {
    const resultsTableBody = document.getElementById('resultsTableBody');
    const noRecordsMessage = document.getElementById('noRecordsMessage');
    const bulletinSelect = document.getElementById('bulletinSelect');

    if (!pagination || !resultsTableBody) return;
    resultsTableBody.innerHTML = '';
    let filteredResults = allSimilarResults;
    if (selectedMonitoredTrademarkId) filteredResults = filteredResults.filter(r => r.monitoredTrademarkId === selectedMonitoredTrademarkId);
    if (similarityFilter === 'similar') filteredResults = filteredResults.filter(r => r.isSimilar === true);
    else if (similarityFilter === 'not-similar') filteredResults = filteredResults.filter(r => r.isSimilar !== true);
    
    updateFilterInfo(filteredResults.length);
    pagination.update(filteredResults.length);
    const currentPageData = pagination.getCurrentPageData(filteredResults);
    if (currentPageData.length === 0) { noRecordsMessage.textContent = 'Arama sonucu bulunamadı.'; noRecordsMessage.style.display = 'block'; return; }
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
            const groupHeaderRow = document.createElement('tr'); groupHeaderRow.classList.add('group-header');
            groupHeaderRow.innerHTML = `<td colspan="10"><div class="group-title"><span><strong>Bilinmeyen Marka</strong> sonuçları (${groupResults.length})</span></div></td>`;
            resultsTableBody.appendChild(groupHeaderRow);
            groupResults.forEach((hit, index) => resultsTableBody.appendChild(createResultRow(hit, pagination.getStartIndex() + index + 1)));
            return;
        }
        const headerName = _pickName(null, tmMeta);
        const headerImg = _pickImg(null, tmMeta);
        const appNo = _pickAppNo(null, tmMeta);
        const modalData = { id: tmMeta.id, ipRecordId: tmMeta.ipRecordId || tmMeta.sourceRecordId || tmMeta.id, markName: headerName, applicationNumber: appNo, owner: _pickOwners(null, tmMeta, allPersons), niceClasses: getNiceClassNumbers(tmMeta), brandImageUrl: headerImg, brandTextSearch: tmMeta.brandTextSearch || [], niceClassSearch: tmMeta.niceClassSearch || [] };
        
        const groupHeaderRow = document.createElement('tr');
        groupHeaderRow.classList.add('group-header');
        groupHeaderRow.dataset.markData = JSON.stringify(modalData);
        groupHeaderRow.innerHTML = `<td colspan="10"><div class="group-title"><div class="tm-img-box tm-img-box-sm">${headerImg ? `<img src="${headerImg}" class="group-header-img" alt="${headerName}">` : `<div class="tm-placeholder">?</div>`}</div><span><a href="#" class="edit-criteria-link" data-tmid="${tmMeta.id}"><strong>${headerName}</strong></a> sonuçları (${getTotalCountForMonitoredId(trademarkKey)} adet)</span></div></td>`;
        resultsTableBody.appendChild(groupHeaderRow);
        groupResults.forEach((hit, index) => resultsTableBody.appendChild(createResultRow(hit, pagination.getStartIndex() + index + 1)));
    });
    attachEventListeners();
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

// --- Main Entry Point (DOM Dependent Logic) ---
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
            ownerSearchInput.value = ''; niceClassSearchInput.value = ''; brandNameSearchInput.value = ''; 
            bulletinSelect.selectedIndex = 0; 
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