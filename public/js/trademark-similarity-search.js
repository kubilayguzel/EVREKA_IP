// public/js/trademark-similarity-search.js

import { db, personService, searchRecordService, similarityService, ipRecordsService, firebaseServices, monitoringService } from '../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where, getFirestore, updateDoc, arrayUnion, onSnapshot, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { runTrademarkSearch } from './trademark-similarity/run-search.js';
import Pagination from './pagination.js';
import { loadSharedLayout } from './layout-loader.js';
import { showNotification } from '../utils.js';
import { getStorage, ref, getDownloadURL, uploadBytes } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
const SimpleLoading = window.SimpleLoadingController;

console.log("### trademark-similarity-search.js yüklendi (Stable Hover) ###");

// --- 1. GLOBAL DEĞİŞKENLER ---
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
let cachedGroupedData = null; // Gruplanmış veriyi hafızada tutmak için
const _storageUrlCache = new Map(); // Storage path -> Signed URL önbelleği

// --- 2. YARDIMCI FONKSİYONLAR ---
const tssLoadState = () => {
    try {
        return JSON.parse(localStorage.getItem(TSS_RESUME_KEY) || '{}');
    } catch {
        return {};
    }
};

const tssSaveState = (partial) => {
    try {
        const prev = tssLoadState();
        localStorage.setItem(TSS_RESUME_KEY, JSON.stringify({ ...prev, ...partial, updatedAt: new Date().toISOString() }));
    } catch (e) {}
};

const tssClearState = () => {
    try {
        localStorage.removeItem(TSS_RESUME_KEY);
    } catch (e) {}
};

const tssBuildStateFromUI = (extra = {}) => {
    const bulletinSelect = document.getElementById('bulletinSelect');
    return {
        bulletinValue: bulletinSelect?.value || '',
        bulletinText: bulletinSelect?.options?.[bulletinSelect.selectedIndex]?.text || '',
        ...extra
    };
};

const tssShowResumeBannerIfAny = () => {
    const state = tssLoadState();
    if (!state?.bulletinValue) return;

    let bar = document.getElementById('tssResumeBar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'tssResumeBar';
        bar.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;background:#1e3c72;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.2);display:flex;gap:8px;align-items:center;font-size:14px;';
        document.body.appendChild(bar);
    }
    bar.innerHTML = `<span>“${state.bulletinText || 'Seçili bülten'}” → Sayfa ${state.page || 1}</span><button id="tssResumeBtn" style="background:#fff;color:#1e3c72;border:none;padding:6px 10px;border-radius:8px;cursor:pointer">Devam Et</button><button id="tssClearBtn" style="background:#ff5a5f;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer">Sıfırla</button>`;

    document.getElementById('tssClearBtn').onclick = () => {
        tssClearState();
        bar.remove();
    };
    document.getElementById('tssResumeBtn').onclick = () => {
        const targetPage = tssLoadState().page || 1;
        window.__tssPendingResumeForBulletin = targetPage;
        const sel = document.getElementById('bulletinSelect');
        if (sel) {
            sel.value = tssLoadState().bulletinValue;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const startBtn = document.getElementById('startSearchBtn') || document.getElementById('researchBtn');
        if (startBtn) {
            startBtn.click();
            let tries = 0;
            const iv = setInterval(() => {
                tries++;
                const loadingIndicator = document.getElementById('loadingIndicator');
                if (loadingIndicator && loadingIndicator.style.display === 'none' && allSimilarResults.length > 0 && pagination) {
                    clearInterval(iv);
                    if (pagination.goToPage(targetPage)) {
                        bar.style.background = '#28a745';
                        bar.firstElementChild.textContent = `Devam edildi: Sayfa ${targetPage}`;
                        setTimeout(() => bar.remove(), 2000);
                        window.__tssPendingResumeForBulletin = null;
                    }
                } else if (tries > 300) {
                    clearInterval(iv);
                    window.__tssPendingResumeForBulletin = null;
                }
            }, 100);
        }
    };
};

window.addEventListener('beforeunload', () => tssSaveState(tssBuildStateFromUI({
    page: pagination?.getCurrentPage ? pagination.getCurrentPage() : undefined,
    itemsPerPage: pagination?.getItemsPerPage ? pagination.getItemsPerPage() : undefined,
    totalResults: Array.isArray(allSimilarResults) ? allSimilarResults.length : 0
})));

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
        if (bulletinDocId) {
            const snap = await getDocs(query(collection(db, 'monitoringTrademarkRecords', bulletinDocId, 'trademarks'), where('applicationNo', '==', appNo), limit(1)));
            if (!snap.empty && snap.docs[0].data().imagePath) url = await getDownloadURL(ref(getStorage(), snap.docs[0].data().imagePath));
        }
    } catch (e) {}
    if (!url) {
        try {
            const snap = await getDocs(query(collection(db, 'ipRecords'), where('applicationNumber', '==', appNo), limit(1)));
            if (!snap.empty) {
                const d = snap.docs[0].data();
                url = _normalizeImageSrc(d.brandImageUrl || d.brandImage || d.details?.brandInfo?.brandImage || '');
            }
        } catch (e) {}
    }
    _appNoImgCache.set(appNo, url);
    return url;
};

// Görseller sadece ekrana girdiğinde yüklenir
const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(async (entry) => {
        if (entry.isIntersecting) {
            const container = entry.target;
            const hitData = JSON.parse(container.dataset.hitData);
            
            observer.unobserve(container); // Artık izlemeyi bırak

            try {
                let imgUrl = '';

                // 1. Önce hit içindeki hazır URL var mı?
                if (hitData.brandImageUrl) {
                    imgUrl = hitData.brandImageUrl;
                } 
                // 2. Storage Path var mı? (Varsa cache kontrolü yap)
                else if (hitData.imagePath) {
                    if (_storageUrlCache.has(hitData.imagePath)) {
                        imgUrl = _storageUrlCache.get(hitData.imagePath);
                    } else {
                        try {
                            const storage = getStorage();
                            imgUrl = await getDownloadURL(ref(storage, hitData.imagePath));
                            _storageUrlCache.set(hitData.imagePath, imgUrl);
                        } catch (e) {
                            console.warn('Storage görsel hatası:', e);
                        }
                    }
                } 
                // 3. Fallback: Veritabanından App No ile bul
                else if (hitData.applicationNo) {
                    imgUrl = await _getBrandImageByAppNo(hitData.applicationNo);
                }

                // Görsel bulunduysa HTML'i güncelle
                if (imgUrl) {
                    const normalizedUrl = _normalizeImageSrc(imgUrl);
                    container.innerHTML = `<div class="tm-img-box tm-img-box-lg"><img src="${normalizedUrl}" loading="lazy" alt="Marka" class="trademark-image-thumbnail-large"></div>`;
                } else {
                    container.innerHTML = `<div class="tm-img-box tm-img-box-lg"><div class="tm-placeholder">-</div></div>`;
                }

            } catch (err) {
                console.warn(`Görsel yüklenemedi: ${hitData.applicationNo}`);
                container.innerHTML = `<div class="tm-img-box tm-img-box-lg"><div class="tm-placeholder">?</div></div>`;
            }
        }
    });
}, {
    rootMargin: '100px 0px', // Ekrana girmeden 100px önce yüklemeye başla
    threshold: 0.01
});

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
const _pickAppDate = (ip, tm) => {
    const v = ip?.applicationDate || tm?.applicationDate;
    if (!v) return '-';
    try {
        const d = (v && typeof v === 'object' && typeof v.toDate === 'function') ? v.toDate() : new Date(v);
        return isNaN(+d) ? '-' : d.toLocaleDateString('tr-TR');
    } catch {
        return '-';
    }
};

const getTotalCountForMonitoredId = (id) => {
    try {
        return id ? allSimilarResults.reduce((acc, r) => acc + (r.monitoredTrademarkId === id ? 1 : 0), 0) : 0;
    } catch {
        return 0;
    }
};

const _getOwnerKey = (ip, tm, persons = []) => {
    const f = ip?.applicants?.[0] || tm?.applicants?.[0] || null;
    if (f?.id) {
        const p = persons.find(p => p.id === f.id);
        const name = p?.name || f.name || f.title || 'Bilinmeyen Sahip';
        return { key: `${f.id}_${name}`, id: f.id, name };
    }
    const o = _pickOwners(ip, tm, persons);
    return { key: o || 'Bilinmeyen Sahip', id: (ip?.clientId || tm?.clientId || 'unknown_group'), name: o || 'Bilinmeyen Sahip' };
};

const _pickOwners = (ip, tm, persons = []) => {
    if (Array.isArray(ip?.applicants) && ip.applicants.length) return ip.applicants.map(a => a?.name).filter(Boolean).join(', ');
    if (Array.isArray(ip?.owners) && ip.owners.length) return ip.owners.map(o => (typeof o === 'object' ? (o.name || o.displayName || persons.find(p => p.id === o.id)?.name) : String(o))).filter(Boolean).join(', ');
    if (ip?.ownerName) return ip.ownerName;
    if (Array.isArray(tm?.applicants) && tm.applicants.length) return tm.applicants.map(a => a?.name).filter(Boolean).join(', ');
    if (Array.isArray(tm?.owners) && tm.owners.length) return tm.owners.map(o => (typeof o === 'object' ? (o.name || o.displayName || persons.find(p => p.id === o.id)?.name) : String(o))).filter(Boolean).join(', ');
    return typeof tm?.holders === 'string' ? tm.holders : '-';
};

const _uniqNice = (obj) => {
    const set = new Set();
    (obj?.goodsAndServicesByClass || []).forEach(c => c?.classNo != null && set.add(String(c.classNo)));
    (obj?.niceClasses || []).forEach(n => set.add(String(n)));
    if (obj?.niceClass) String(obj.niceClass).split(/[,\s]+/).forEach(n => n && set.add(n));
    return Array.from(set).sort((a, b) => Number(a) - Number(b)).join(', ');
};

const getNiceClassNumbers = (item) => {
    return (item.goodsAndServicesByClass && Array.isArray(item.goodsAndServicesByClass)) ? item.goodsAndServicesByClass.map(i => String(i.classNo)).filter(c => c) : [];
};

function normalizeNiceList(input) {
    const raw = Array.isArray(input) ? input.join(',') : String(input || '');
    return raw.split(/[^\d]+/).filter(Boolean).map(p => String(parseInt(p, 10))).filter(p => !isNaN(p) && ((Number(p) >= 1 && Number(p) <= 45) || Number(p) === 99));
}

// --- 3. EVENT LISTENERS ---
const attachMonitoringAccordionListeners = () => {
    const tbody = document.getElementById('monitoringListBody');
    if (!tbody || tbody._accordionSetup) return;
    tbody._accordionSetup = true;
    tbody.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn, button, a')) return;
        const row = e.target.closest('.owner-row');
        if (!row) return;
        const targetId = row.dataset.target || '#' + row.getAttribute('aria-controls');
        const contentRow = document.querySelector(targetId);
        if (!contentRow) return;
        const isExpanded = row.getAttribute('aria-expanded') === 'true';
        contentRow.style.display = isExpanded ? 'none' : 'table-row';
        row.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
        const icon = row.querySelector('.toggle-icon');
        if (icon) {
            icon.classList.toggle('fa-chevron-up', !isExpanded);
            icon.classList.toggle('fa-chevron-down', isExpanded);
        }
    });
};

const attachGenerateReportListener = () => {
    document.querySelectorAll('.generate-report-btn').forEach(btn => {
        btn.removeEventListener('click', handleOwnerReportGeneration);
        btn.addEventListener('click', handleOwnerReportGeneration);
    });
    document.querySelectorAll('.generate-report-and-notify-btn').forEach(btn => {
        btn.removeEventListener('click', handleOwnerReportAndNotifyGeneration);
        btn.addEventListener('click', handleOwnerReportAndNotifyGeneration);
    });
};

const attachTrademarkClickListener = () => {
    const tbody = document.getElementById('monitoringListBody');
    if (!tbody || tbody._trademarkClickSetup) return;
    tbody._trademarkClickSetup = true;
    tbody.addEventListener('click', (e) => {
        const row = e.target.closest('.trademark-detail-row');
        if (!row) return;
    });
};

const attachEventListeners = () => {
    const resultsTableBody = document.getElementById('resultsTableBody');
    if (!resultsTableBody) return;
    resultsTableBody.querySelectorAll('.action-btn').forEach(btn => btn.addEventListener('click', handleSimilarityToggle));
    resultsTableBody.querySelectorAll('.bs-select').forEach(select => select.addEventListener('change', handleBsChange));
    resultsTableBody.querySelectorAll('.note-cell').forEach(cell => cell.addEventListener('click', () => handleNoteCellClick(cell)));
};

// --- 4. DATA LOADER ---
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
    } catch (e) {
        console.error(e);
    }
};

// --- 5. RENDER FUNCTIONS (OPTİMİZE EDİLMİŞ) ---
const renderMonitoringList = async () => {
    const tbody = document.getElementById('monitoringListBody');
    
    // Veri yoksa hemen göster
    if (!filteredMonitoringTrademarks.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="no-records">Filtreye uygun izlenecek marka bulunamadı.</td></tr>';
        return;
    }

    // --- OPTİMİZASYON 1: Cache Kontrolü ---
    // Eğer veriyi daha önce grupladıysak ve filtre değişmediyse, tekrar hesaplama!
    if (!cachedGroupedData) {
        // Yükleniyor mesajı göster (İlk hesaplama biraz sürebilir)
        tbody.innerHTML = '<tr><td colspan="6" class="text-center p-3"><i class="fas fa-spinner fa-spin"></i> Veriler işleniyor...</td></tr>';
        
        // --- OPTİMİZASYON 2: Paralel İşleme (Promise.all) ---
        // for döngüsü yerine map kullanarak tüm işlemleri aynı anda başlatıyoruz
        const processPromises = filteredMonitoringTrademarks.map(async (tm) => {
            const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
            const ownerInfo = _getOwnerKey(ip, tm, allPersons);
            const nices = _uniqNice(ip || tm);
            
            return {
                tm,
                ip,
                ownerInfo,
                nices
            };
        });

        // Tüm verilerin hazırlanmasını bekle (Paralel olduğu için çok daha hızlı biter)
        const processedItems = await Promise.all(processPromises);

        // Şimdi gruplama yap (Senkron işlem, çok hızlıdır)
        const grouped = {};
        for (const item of processedItems) {
            const { tm, ip, ownerInfo, nices } = item;
            const ownerKey = ownerInfo.key;

            if (!grouped[ownerKey]) {
                grouped[ownerKey] = {
                    ownerName: ownerInfo.name,
                    ownerId: ownerInfo.id,
                    trademarks: [],
                    allNiceClasses: new Set()
                };
            }
            
            // Nice sınıflarını ekle
            if(nices) nices.split(', ').forEach(n => grouped[ownerKey].allNiceClasses.add(n));
            
            // Markayı gruba ekle
            grouped[ownerKey].trademarks.push({ tm, ip, ownerInfo });
        }

        // Cache'e kaydet
        cachedGroupedData = grouped;
    }

    // --- SIRALAMA VE SAYFALAMA ---
    // Artık elimizde hazır veri var, sadece sayfalamayı yapıyoruz.
    const groupedByOwner = cachedGroupedData;
    const sortedOwnerKeys = Object.keys(groupedByOwner).sort((a, b) => 
        groupedByOwner[a].ownerName.localeCompare(groupedByOwner[b].ownerName)
    );

    const itemsPerPage = monitoringPagination ? monitoringPagination.getItemsPerPage() : 5;
    const currentPage = monitoringPagination ? monitoringPagination.getCurrentPage() : 1;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedOwnerKeys = sortedOwnerKeys.slice(startIndex, endIndex);

    let allRowsHtml = [];

    // Sadece ekranda görülecek 5 kişi için döngüye gir
    for (const ownerKey of paginatedOwnerKeys) {
        const group = groupedByOwner[ownerKey];
        const groupUid = `owner-group-${group.ownerId}-${ownerKey.replace(/[^a-zA-Z0-9]/g, '').slice(-10)}`;
        const isTriggered = taskTriggeredStatus.get(group.ownerId) === 'Evet';
        const statusText = isTriggered ? 'Evet' : 'Hazır';
        const statusClass = isTriggered ? 'trigger-yes' : 'trigger-ready';

        // 1. BAŞLIK SATIRI
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

        // 2. İÇERİK SATIRI (Lazy Load Placeholder)
        // Veriyi data attribute'a eklemiyoruz, groupedByOwner üzerinden ID ile erişeceğiz.
        const contentRow = `
            <tr id="${groupUid}" class="accordion-content-row" style="display: none;">
                <td colspan="6">
                    <div class="nested-content-container" data-loaded="false" data-owner-key="${ownerKey}">
                        <div class="p-3 text-muted text-center"><i class="fas fa-spinner fa-spin"></i> Veriler hazırlanıyor...</div>
                    </div>
                </td>
            </tr>`;
        allRowsHtml.push(contentRow);
    }
    
    tbody.innerHTML = allRowsHtml.join('');

    attachGenerateReportListener();
    attachTrademarkClickListener();
    
    // Cachelenmiş veriyi lazy load fonksiyonuna gönder
    attachLazyLoadListeners(groupedByOwner);

    // Badge güncellemeleri
    setTimeout(() => {
        document.querySelectorAll('#monitoringListBody .owner-row').forEach(row => {
            const btn = row.querySelector('.generate-report-and-notify-btn');
            if (!btn) return;
            const ownerId = btn.dataset.ownerId;
            const badge = row.querySelector('.task-triggered-status, .trigger-status-badge');
            if (badge) {
                const hasTriggered = taskTriggeredStatus.get(ownerId) === 'Evet';
                badge.textContent = hasTriggered ? 'Evet' : 'Hazır';
                badge.classList.remove('trigger-yes', 'trigger-no', 'trigger-ready');
                badge.classList.add(hasTriggered ? 'trigger-yes' : 'trigger-ready');
            }
        });
    }, 50);
};

// --- YENİ HELPER FONKSİYON ---
const attachLazyLoadListeners = (groupedData) => {
    const tbody = document.getElementById('monitoringListBody');
    
    // Eski listener'ları temizlemek için klonlama yapabiliriz veya
    // jQuery kullanıyorsanız off() yapabilirsiniz. Vanilla JS'de üst üste binmemesi için kontrol:
    if (tbody._lazyLoadAttached) return;
    tbody._lazyLoadAttached = true;

    tbody.addEventListener('click', (e) => {
        // Butonlara tıklanırsa accordion'ı tetikleme
        if (e.target.closest('.action-btn, button, a')) return;

        const headerRow = e.target.closest('.owner-row');
        if (!headerRow) return;

        const targetId = headerRow.dataset.target || '#' + headerRow.getAttribute('aria-controls');
        const contentRow = document.querySelector(targetId);
        
        if (!contentRow) return;

        const isExpanded = headerRow.getAttribute('aria-expanded') === 'true';
        
        // Görünürlüğü değiştir
        contentRow.style.display = isExpanded ? 'none' : 'table-row';
        headerRow.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
        
        // İkonu değiştir
        const icon = headerRow.querySelector('.toggle-icon');
        if (icon) {
            icon.classList.toggle('fa-chevron-up', !isExpanded);
            icon.classList.toggle('fa-chevron-down', isExpanded);
        }

        // Eğer açılıyorsa (isExpanded false -> true olacaksa) ve veri yüklenmemişse YÜKLE
        if (!isExpanded) {
            const container = contentRow.querySelector('.nested-content-container');
            if (container && container.dataset.loaded === 'false') {
                const ownerKey = container.dataset.ownerKey;
                const group = groupedData[ownerKey];
                
                if (group && group.trademarks) {
                    // HTML OLUŞTURMA (Burada yapılıyor)
                    const detailRowsHtml = group.trademarks.map(({ tm, ip }) => {
                        const [markName, imgSrc, appNo, nices, appDate] = [_pickName(ip, tm), _pickImg(ip, tm), _pickAppNo(ip, tm), _uniqNice(ip || tm), _pickAppDate(ip, tm)];
                        
                        // loading="lazy" eklendi
                        return `
                            <tr class="trademark-detail-row">
                                <td class="td-nested-toggle"></td>
                                <td class="td-nested-img">
                                    ${imgSrc ? `<div class="tm-img-box tm-img-box-sm"><img class="trademark-image-thumbnail-large" src="${imgSrc}" loading="lazy" alt="Marka"></div>` : `<div class="tm-img-box tm-img-box-sm tm-placeholder">-</div>`}
                                </td>
                                <td class="td-nested-name"><strong>${markName}</strong></td>
                                <td class="td-nested-appno">${appNo}</td>
                                <td class="td-nested-nice">${nices || '-'}</td> 
                                <td class="td-nested-date">${appDate}</td>
                            </tr>`;
                    }).join('');

                    const tableHtml = `
                        <table class="table table-sm nested-table">
                            <thead><tr><th></th><th class="col-nest-img">Görsel</th><th class="col-nest-name">Marka Adı</th><th class="col-nest-appno">Başvuru No</th><th class="col-nest-nice">Nice Sınıfı</th><th class="col-nest-date">B. Tarihi</th></tr></thead>
                            <tbody>${detailRowsHtml}</tbody>
                        </table>`;

                    container.innerHTML = tableHtml;
                    container.dataset.loaded = 'true'; // Tekrar yüklemeyi engelle
                }
            }
        }
    });
};

const createResultRow = (hit, rowIndex) => {
    const holders = Array.isArray(hit.holders) ? hit.holders.map(h => h.name || h.id).filter(Boolean).join(', ') : (hit.holders || '');
    const monitoredTrademark = monitoringTrademarks.find(tm => tm.id === (hit.monitoredTrademarkId || hit.monitoredMarkId)) || {};
    const resultClasses = normalizeNiceList(hit.niceClasses);
    let goodsAndServicesClasses = normalizeNiceList(getNiceClassNumbers(monitoredTrademark));
    if (goodsAndServicesClasses.length === 0) goodsAndServicesClasses = normalizeNiceList(Array.isArray(monitoredTrademark?.niceClasses) && monitoredTrademark.niceClasses.length ? monitoredTrademark.niceClasses : _uniqNice(monitoredTrademark));
    const goodsAndServicesSet = new Set(goodsAndServicesClasses);
    const monitoredSet = new Set(normalizeNiceList(monitoredTrademark?.niceClassSearch || []));
    const niceClassHtml = [...new Set(resultClasses)].map(cls => `<span class="nice-class-badge ${goodsAndServicesSet.has(cls) ? 'match' : (monitoredSet.has(cls) ? 'partial-match' : '')}">${cls}</span>`).join('');

    const similarityScore = hit.similarityScore ? `${(hit.similarityScore * 100).toFixed(0)}%` : '-';
    const similarityBtnClass = hit.isSimilar === true ? 'similar' : 'not-similar';
    const similarityBtnText = hit.isSimilar === true ? 'Benzer' : 'Benzemez';
    const noteContent = hit.note ? `<span class="note-text">${hit.note}</span>` : `<span class="note-placeholder">Not ekle</span>`;
    
    // Placeholder HTML
    const imagePlaceholderHtml = `<div class="tm-img-box tm-img-box-lg"><div class="tm-placeholder"><i class="fas fa-spinner fa-spin text-muted"></i></div></div>`;
    const bulletinSelect = document.getElementById('bulletinSelect');

    const row = document.createElement('tr');
    
    // Gerekli verileri (imagePath, brandImageUrl, appNo) JSON string olarak dataset'e ekliyoruz
    // Bu sayede observer bunlara erişebilecek.
    const minimalHitData = JSON.stringify({
        imagePath: hit.imagePath,
        brandImageUrl: hit.brandImageUrl,
        applicationNo: hit.applicationNo
    });

    row.innerHTML = `
        <td>${rowIndex}</td>
        <td><button class="action-btn ${similarityBtnClass}" data-result-id="${hit.objectID || hit.applicationNo}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}">${similarityBtnText}</button></td>
        
        <td class="trademark-image-cell lazy-load-container" data-hit-data='${minimalHitData}'>
            ${imagePlaceholderHtml}
        </td>

        <td><strong>${hit.markName || '-'}</strong></td>
        <td>${holders}</td>
        <td>${niceClassHtml}</td>
        <td>${hit.applicationNo ? `<a href="#" class="tp-appno-link" data-tp-appno="${hit.applicationNo}" onclick="event.preventDefault(); window.queryApplicationNumberWithExtension('${hit.applicationNo}');">${hit.applicationNo}</a>` : '-'}</td>
        <td>${similarityScore}</td>
        <td><select class="bs-select" data-result-id="${hit.objectID || hit.applicationNo}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}"><option value="">B.Ş</option>${['%0', '%20', '%30', '%40', '%45', '%50', '%55', '%60', '%70', '%80'].map(val => `<option value="${val}" ${hit.bs === val ? 'selected' : ''}>${val}</option>`).join('')}</select></td>
        <td class="note-cell" data-result-id="${hit.objectID || hit.applicationNo}" data-monitored-trademark-id="${hit.monitoredTrademarkId}" data-bulletin-id="${bulletinSelect.value}"><div class="note-cell-content"><span class="note-icon">📝</span>${noteContent}</div></td>
    `;

    // Eski setTimeout kodunu SİLDİK.
    // Yerine Observer'ı başlatıyoruz:
    const imgContainer = row.querySelector('.lazy-load-container');
    if (imgContainer) {
        imageObserver.observe(imgContainer);
    }

    return row;
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

    // Sayaç: Sayfanın başlangıç numarasını al (Örn: 50)
    let globalRowIndex = pagination.getStartIndex();

    Object.keys(groupedByTrademark).sort((a, b) => (groupedByTrademark[a][0]?.monitoredTrademark || '').localeCompare(groupedByTrademark[b][0]?.monitoredTrademark || '')).forEach(trademarkKey => {
        const groupResults = groupedByTrademark[trademarkKey];
        const tmMeta = monitoringTrademarks.find(t => String(t.id) === String(trademarkKey)) || null;

        if (!tmMeta) {
            const fallbackName = groupResults[0]?.monitoredTrademark || 'Bilinmeyen Marka';
            const groupHeaderRow = document.createElement('tr');
            groupHeaderRow.classList.add('group-header');
            groupHeaderRow.innerHTML = `<td colspan="10"><div class="group-title"><span><strong>${fallbackName}</strong> sonuçları (${groupResults.length})</span></div></td>`;
            resultsTableBody.appendChild(groupHeaderRow);

            // Grup içi döngü (Global sayaç ile)
            groupResults.forEach((hit) => {
                globalRowIndex++;
                resultsTableBody.appendChild(createResultRow(hit, globalRowIndex));
            });
            return;
        }

        const headerName = _pickName(null, tmMeta);
        const headerImg = _pickImg(null, tmMeta);
        const appNo = _pickAppNo(null, tmMeta);
        const modalData = {
            id: tmMeta.id,
            ipRecordId: tmMeta.ipRecordId || tmMeta.sourceRecordId || tmMeta.id,
            markName: headerName,
            applicationNumber: appNo,
            owner: _pickOwners(null, tmMeta, allPersons),
            niceClasses: getNiceClassNumbers(tmMeta),
            brandImageUrl: headerImg,
            brandTextSearch: tmMeta.brandTextSearch || [],
            niceClassSearch: tmMeta.niceClassSearch || []
        };

        const groupHeaderRow = document.createElement('tr');
        groupHeaderRow.classList.add('group-header');
        groupHeaderRow.dataset.markData = JSON.stringify(modalData);
        const totalCount = getTotalCountForMonitoredId(trademarkKey);

        const imageHtml = headerImg ?
            `<div class="group-trademark-image"><div class="tm-img-box tm-img-box-sm"><img src="${headerImg}" class="group-header-img" alt="${headerName}"></div></div>` :
            `<div class="group-trademark-image" data-header-appno="${appNo}"><div class="tm-img-box tm-img-box-sm tm-placeholder">?</div></div>`;

        groupHeaderRow.innerHTML = `<td colspan="10"><div class="group-title">${imageHtml}<span><a href="#" class="edit-criteria-link" data-tmid="${tmMeta.id}"><strong>${headerName}</strong></a> markası için bulunan sonuçlar (${totalCount} adet)</span></div></td>`;
        resultsTableBody.appendChild(groupHeaderRow);

        // Grup içi döngü (Global sayaç ile)
        groupResults.forEach((hit) => {
            globalRowIndex++;
            resultsTableBody.appendChild(createResultRow(hit, globalRowIndex));
        });
    });

    // --- GÖRSELLERİ SONRADAN YÜKLEME (LAZY LOAD FIX) ---
    setTimeout(() => {
        document.querySelectorAll('.group-trademark-image[data-header-appno]').forEach(async (container) => {
            const appNo = container.dataset.headerAppno;
            if (appNo && appNo !== '-') {
                try {
                    const imgUrl = await _getBrandImageByAppNo(appNo);
                    if (imgUrl) {
                        container.innerHTML = `<div class="tm-img-box tm-img-box-sm"><img src="${imgUrl}" class="group-header-img" alt="Marka"></div>`;
                        container.removeAttribute('data-header-appno');
                    }
                } catch (e) {
                    console.log('Header görseli yüklenemedi:', appNo);
                }
            }
        });
    }, 100);

    attachEventListeners();
};

// --- 6. INITIALIZATION & LOGIC FUNCTIONS ---
const updateFilterInfo = (resultCount) => {
    const selectedTrademarkInfo = document.getElementById('selectedTrademarkInfo');
    const selectedTrademarkName = document.getElementById('selectedTrademarkName');
    const filteredResultCount = document.getElementById('filteredResultCount');
    if (filteredResultCount) filteredResultCount.textContent = resultCount;
    if (selectedMonitoredTrademarkId && selectedTrademarkInfo && selectedTrademarkName) {
        const selectedTrademark = monitoringTrademarks.find(tm => tm.id === selectedMonitoredTrademarkId);
        const selectedName = selectedTrademark?.title || selectedTrademark?.markName || 'Bilinmeyen Marka';
        selectedTrademarkName.textContent = `"${selectedName}"`;
        selectedTrademarkInfo.style.display = 'flex';
    } else if (selectedTrademarkInfo) selectedTrademarkInfo.style.display = 'none';
};

const initializePagination = () => {
    if (!pagination) pagination = new Pagination({
        containerId: 'paginationContainer',
        itemsPerPage: 10,
        onPageChange: (page, itemsPerPage) => {
            renderCurrentPageOfResults();
            tssSaveState(tssBuildStateFromUI({
                page,
                itemsPerPage,
                totalResults: allSimilarResults.length
            }));
        }
    });
};
const initializeMonitoringPagination = () => {
    if (!monitoringPagination) monitoringPagination = new Pagination({
        containerId: 'monitoringPaginationContainer',
        itemsPerPage: 5,
        onPageChange: () => renderMonitoringList()
    });
};
const updateMonitoringCount = async () => {
    const ownerGroups = {};
    for (const tm of filteredMonitoringTrademarks) {
        const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
        const ownerInfo = _getOwnerKey(ip, tm, allPersons);
        if (!ownerGroups[ownerInfo.key]) ownerGroups[ownerInfo.key] = true;
    }
    document.getElementById('monitoringCount').textContent = `${Object.keys(ownerGroups).length} Sahip (${filteredMonitoringTrademarks.length} Marka)`;
};
const updateOwnerBasedPagination = async () => {
    const ownerGroups = {};
    for (const tm of filteredMonitoringTrademarks) {
        const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
        const ownerInfo = _getOwnerKey(ip, tm, allPersons);
        if (!ownerGroups[ownerInfo.key]) ownerGroups[ownerInfo.key] = true;
    }
    monitoringPagination.update(Object.keys(ownerGroups).length);
    monitoringPagination.reset();
};
const applyMonitoringListFilters = async () => {
    const ownerSearchInput = document.getElementById('ownerSearch');
    const niceClassSearchInput = document.getElementById('niceClassSearch');
    const brandNameSearchInput = document.getElementById('brandNameSearch');
    const [ownerFilter, niceFilter, brandFilter] = [ownerSearchInput?.value || '', niceClassSearchInput?.value || '', brandNameSearchInput?.value || ''].map(s => s.toLowerCase());
    const filteredResults = [];
    for (const data of monitoringTrademarks) {
        const ip = await _getIp(data.ipRecordId || data.sourceRecordId || data.id);
        const ownerInfo = _getOwnerKey(ip, data, allPersons);
        const ownerName = ownerInfo.name.toLowerCase();
        const niceClasses = _uniqNice(ip || data);
        const markName = (data.title || data.markName || data.brandText || '').toLowerCase();
        const ownerMatch = !ownerFilter || ownerName.includes(ownerFilter);
        const niceMatch = !niceFilter || niceClasses.toLowerCase().includes(niceFilter);
        const brandMatch = !brandFilter || markName.includes(brandFilter);
        if (ownerMatch && niceMatch && brandMatch) filteredResults.push(data);
    }
    filteredMonitoringTrademarks = filteredResults;
    await updateOwnerBasedPagination();
    cachedGroupedData = null;
    await renderMonitoringList();
    updateMonitoringCount();
    checkCacheAndToggleButtonStates();
};

const loadInitialData = async () => {
    await loadSharedLayout({
        activeMenuLink: 'trademark-similarity-search.html'
    });
    const personsResult = await personService.getPersons();
    if (personsResult.success) allPersons = personsResult.data;
    await loadBulletinOptions();
    const snapshot = await getDocs(collection(db, 'monitoringTrademarks'));
    monitoringTrademarks = await Promise.all(snapshot.docs.map(async (docSnap) => {
        const tmData = {
            id: docSnap.id,
            ...docSnap.data()
        };
        if (tmData.ipRecordId || tmData.sourceRecordId) {
            try {
                const ipDoc = await getDoc(doc(db, 'ipRecords', tmData.ipRecordId || tmData.sourceRecordId));
                if (ipDoc.exists()) {
                    tmData.ipRecord = ipDoc.data();
                    tmData.goodsAndServicesByClass = ipDoc.data().goodsAndServicesByClass || [];
                }
            } catch (e) {}
        }
        return tmData;
    }));
    filteredMonitoringTrademarks = [...monitoringTrademarks];
    initializeMonitoringPagination();
    renderMonitoringList();
    updateMonitoringCount();
    monitoringPagination.update(filteredMonitoringTrademarks.length);
    const bs = document.getElementById('bulletinSelect');
    if (bs?.value) {
        const bNo = String(bs.value).split('_')[0];
        if (bNo) {
            await refreshTriggeredStatus(bNo);
            renderMonitoringList();
        }
    }
};

const loadBulletinOptions = async () => {
    try {
        const bulletinSelect = document.getElementById('bulletinSelect');
        bulletinSelect.innerHTML = '<option value="">Bülten seçin...</option>';
        const [registeredSnapshot, monitoringSnapshot] = await Promise.all([getDocs(collection(db, 'trademarkBulletins')), getDocs(collection(db, 'monitoringTrademarkRecords'))]);
        const allBulletins = new Map();
        registeredSnapshot.forEach(doc => {
            const data = doc.data();
            const bulletinKey = `${data.bulletinNo}_${(data.bulletinDate || '').replace(/\D/g, '')}`;
            allBulletins.set(bulletinKey, {
                ...data,
                bulletinKey,
                source: 'registered',
                hasOriginalBulletin: true,
                displayName: `${data.bulletinNo} - ${data.bulletinDate || ''} (Kayıtlı)`
            });
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
                        allBulletins.set(normalizedKey, {
                            bulletinNo: parts[0],
                            bulletinDate,
                            bulletinKey: normalizedKey,
                            source: 'searchOnly',
                            hasOriginalBulletin: false,
                            displayName: `${parts[0]} - ${bulletinDate} (Sadece Arama)`
                        });
                    }
                }
            } catch (e) {}
        }
        const sortedBulletins = Array.from(allBulletins.values()).sort((a, b) => parseInt(b.bulletinNo) - parseInt(a.bulletinNo));
        sortedBulletins.forEach(bulletin => {
            const option = document.createElement('option');
            Object.keys(bulletin).forEach(key => option.dataset[key] = bulletin[key]);
            option.value = bulletin.bulletinKey;
            option.textContent = bulletin.displayName;
            bulletinSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading bulletin options:', error);
    }
};

const loadDataFromCache = async (bulletinKey) => {
    const noRecordsMessage = document.getElementById('noRecordsMessage');
    const infoMessageContainer = document.getElementById('infoMessageContainer');
    try {
        const snapshot = await getDocs(collection(db, 'monitoringTrademarkRecords', bulletinKey, 'trademarks'));
        const cachedResults = snapshot.docs.flatMap(docSnap => {
            const data = docSnap.data();
            return (data.results || []).map(r => ({ ...r,
                source: 'cache',
                monitoredTrademarkId: docSnap.id
            }));
        });
        allSimilarResults = cachedResults;
        infoMessageContainer.innerHTML = cachedResults.length > 0 ? `<div class="info-message success">Önbellekten ${cachedResults.length} benzer sonuç yüklendi.</div>` : '';
        noRecordsMessage.style.display = cachedResults.length > 0 ? 'none' : 'block';
        groupAndSortResults();
        if (pagination) pagination.update(allSimilarResults.length);
        renderCurrentPageOfResults();
    } catch (error) {
        console.error("Error loading data from cache:", error);
    }
};

const checkCacheAndToggleButtonStates = async () => {
    const bulletinSelect = document.getElementById('bulletinSelect');
    const startSearchBtn = document.getElementById('startSearchBtn');
    const researchBtn = document.getElementById('researchBtn');
    const btnGenerateReportAndNotifyGlobal = document.getElementById('btnGenerateReportAndNotifyGlobal');
    const infoMessageContainer = document.getElementById('infoMessageContainer');

    const bulletinKey = bulletinSelect.value;
    if (!bulletinKey || filteredMonitoringTrademarks.length === 0) {
        startSearchBtn.disabled = true;
        researchBtn.disabled = true;
        infoMessageContainer.innerHTML = '';
        btnGenerateReportAndNotifyGlobal.disabled = true;
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
            btnGenerateReportAndNotifyGlobal.disabled = allSimilarResults.length === 0;
            const messageType = hasOriginalBulletin ? 'success' : 'warning';
            const messageText = hasOriginalBulletin ? 'Bu bülten sistemde kayıtlı. Önbellekten sonuçlar yüklendi.' : 'Bu bülten sistemde kayıtlı değil. Sadece eski arama sonuçları gösterilmektedir.';
            infoMessageContainer.innerHTML = `<div class="info-message ${messageType}"><strong>Bilgi:</strong> ${messageText}</div>`;
        } else {
            startSearchBtn.disabled = !hasOriginalBulletin;
            researchBtn.disabled = true;
            btnGenerateReportAndNotifyGlobal.disabled = true;
            const messageType = hasOriginalBulletin ? 'info' : 'error';
            const messageText = hasOriginalBulletin ? 'Önbellekte veri bulunamadı. "Arama Başlat" butonuna tıklayarak arama yapabilirsiniz.' : 'Bu bülten sistemde kayıtlı değil ve arama sonucu da bulunamadı.';
            infoMessageContainer.innerHTML = `<div class="info-message ${messageType}"><strong>Bilgi:</strong> ${messageText}</div>`;
            allSimilarResults = [];
            if (pagination) pagination.update(0);
            renderCurrentPageOfResults();
        }
    } catch (error) {
        console.error('Cache check error:', error);
        startSearchBtn.disabled = true;
        researchBtn.disabled = true;
        btnGenerateReportAndNotifyGlobal.disabled = true;
        infoMessageContainer.innerHTML = `<div class="info-message error"><strong>Hata:</strong> Bülten bilgileri kontrol edilirken bir hata oluştu.</div>`;
    }
};

// --- LOGIC FUNCTIONS (PerformSearch, vb.) ---
const performSearch = async () => {
    const bulletinSelect = document.getElementById('bulletinSelect');
    const startSearchBtn = document.getElementById('startSearchBtn');
    const researchBtn = document.getElementById('researchBtn');
    const btnGenerateReportAndNotifyGlobal = document.getElementById('btnGenerateReportAndNotifyGlobal');
    const noRecordsMessage = document.getElementById('noRecordsMessage');
    const infoMessageContainer = document.getElementById('infoMessageContainer');
    const resultsTableBody = document.getElementById('resultsTableBody');

    const bulletinKey = bulletinSelect.value;
    if (!bulletinKey || filteredMonitoringTrademarks.length === 0) return;
    SimpleLoading.show('Arama başlatılıyor...', 'Lütfen bekleyin...');

    // ✅ Loading panelini sağ üst köşeye taşı - Modern UX
    setTimeout(() => {
        const loadingOverlay = document.querySelector('.simple-loading-overlay');
        const loadingContent = document.querySelector('.simple-loading-content');
        
        if (loadingOverlay) {
            // Overlay'i transparan yap, tıklamaları engelleme
            loadingOverlay.style.background = 'transparent';
            loadingOverlay.style.pointerEvents = 'none';
            loadingOverlay.style.zIndex = '9998';
        }
        
        if (loadingContent) {
            // Loading panelini sağ üste taşı
            loadingContent.style.position = 'fixed';
            loadingContent.style.top = '80px';
            loadingContent.style.right = '20px';
            loadingContent.style.left = 'auto';
            loadingContent.style.transform = 'none';
            loadingContent.style.pointerEvents = 'auto';
            loadingContent.style.zIndex = '10001';
            loadingContent.style.maxWidth = '350px';
            loadingContent.style.minWidth = '300px';
            loadingContent.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
            loadingContent.style.borderRadius = '12px';
        }
    }, 100);

    if (noRecordsMessage) noRecordsMessage.style.display = 'none';
    infoMessageContainer.innerHTML = '';
    resultsTableBody.innerHTML = '';
    allSimilarResults = [];
    const monitoredMarksPayload = filteredMonitoringTrademarks.map(tm => ({
        id: tm.id,
        markName: (tm.title || tm.markName || '').trim() || 'BELİRSİZ_MARKA',
        brandTextSearch: tm.brandTextSearch || [], 
        niceClassSearch: tm.niceClassSearch || [],
        goodsAndServicesByClass: tm.goodsAndServicesByClass || []
    }));
    try {
        // GÜNCELLENEN KISIM BAŞLANGICI
        const onProgress = (pd) => {
            // 1. Loading ekranındaki yazıyı güncelle
            SimpleLoading.update(
                `Arama devam ediyor... %${pd.progress || 0}`, 
                `İşlenen: ${pd.processed || 0}/${pd.total || monitoredMarksPayload.length} - Bulunan: ${pd.currentResults || 0}`
            );

            // 2. Worker Grid'ini güncelle (run-search.js'den gelen veriyi kullanıyoruz)
            console.log('🎨 [DEBUG] pd.workers:', pd.workers); // ✅ EKLE
            if (pd.workers && Array.isArray(pd.workers)) {
                renderWorkersGrid(pd.workers);
            } else {
                console.warn('⚠️ [DEBUG] pd.workers yok veya array değil!'); // ✅ EKLE
            }
        };

        // startWorkerListeners çağrısını buradan SİLİYORUZ çünkü onProgress halledecek.
        const resultsFromCF = await runTrademarkSearch(monitoredMarksPayload, bulletinKey, onProgress);
        if (resultsFromCF?.length > 0) {
            allSimilarResults = resultsFromCF.map(hit => ({ ...hit,
                source: 'new',
                monitoredTrademark: filteredMonitoringTrademarks.find(tm => tm.id === hit.monitoredTrademarkId)?.title || hit.markName
            }));
            const groupedResults = allSimilarResults.reduce((acc, r) => {
                const key = r.monitoredTrademarkId;
                (acc[key] = acc[key] || []).push(r);
                return acc;
            }, {});
            for (const [monitoredTrademarkId, results] of Object.entries(groupedResults)) {
                await searchRecordService.saveRecord(bulletinKey, monitoredTrademarkId, {
                    results,
                    searchDate: new Date().toISOString()
                });
            }
        }
    } catch (error) {
        infoMessageContainer.innerHTML = `<div class="info-message error"><strong>Hata:</strong> Arama işlemi sırasında bir hata oluştu.</div>`;
    } finally {
        SimpleLoading.hide();
        groupAndSortResults();
        if (allSimilarResults.length > 0) {
            infoMessageContainer.innerHTML = `<div class="info-message success">Toplam ${allSimilarResults.length} benzer sonuç bulundu.</div>`;
            startSearchBtn.disabled = true;
            researchBtn.disabled = false;
            btnGenerateReportAndNotifyGlobal.disabled = false;
            if (noRecordsMessage) noRecordsMessage.style.display = 'none';
        } else {
            if (noRecordsMessage) {
                noRecordsMessage.textContent = 'Arama sonucu bulunamadı.';
                noRecordsMessage.style.display = 'block';
            }
            startSearchBtn.disabled = false;
            researchBtn.disabled = true;
            btnGenerateReportAndNotifyGlobal.disabled = true;
        }
        if (pagination) pagination.update(allSimilarResults.length);
        renderCurrentPageOfResults();
    }
};

const performResearch = async () => {
    const bulletinSelect = document.getElementById('bulletinSelect');
    const bulletinKey = bulletinSelect.value;
    if (!bulletinKey) return;
    SimpleLoading.show('Hazırlanıyor...', 'Önbellek temizleniyor...');
    const noRecordsMessage = document.getElementById('noRecordsMessage');
    const infoMessageContainer = document.getElementById('infoMessageContainer');
    if (noRecordsMessage) noRecordsMessage.style.display = 'none';
    try {
        const deletePromises = filteredMonitoringTrademarks.map(tm => searchRecordService.deleteRecord(bulletinKey, tm.id));
        await Promise.allSettled(deletePromises);
        await performSearch();
    } catch (error) {
        SimpleLoading.hide();
        infoMessageContainer.innerHTML = `<div class="info-message error"><strong>Hata:</strong> Yeniden arama sırasında bir hata oluştu.</div>`;
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
const handleSimilarityToggle = async (event) => {
    const {
        resultId,
        monitoredTrademarkId,
        bulletinId
    } = event.target.dataset;
    const currentHit = allSimilarResults.find(r => (r.objectID === resultId || r.applicationNo === resultId) && r.monitoredTrademarkId === monitoredTrademarkId);
    if (!currentHit) {
        alert('Sonuç bulunamadı.');
        return;
    }
    const newStatus = currentHit.isSimilar !== true;
    const updateResult = await similarityService.updateSimilarityFields(monitoredTrademarkId, bulletinId, resultId, {
        isSimilar: newStatus
    });
    if (updateResult.success) {
        currentHit.isSimilar = newStatus;
        event.target.textContent = newStatus ? 'Benzer' : 'Benzemez';
        event.target.classList.toggle('similar', newStatus);
        event.target.classList.toggle('not-similar', !newStatus);
    } else {
        alert('Hata oluştu.');
    }
};
const handleBsChange = async (event) => {
    const {
        resultId,
        monitoredTrademarkId,
        bulletinId
    } = event.target.dataset;
    const updateResult = await similarityService.updateSimilarityFields(monitoredTrademarkId, bulletinId, resultId, {
        bs: event.target.value
    });
    if (!updateResult.success) alert('Hata oluştu.');
};
const handleNoteCellClick = (cell) => {
    const {
        resultId,
        monitoredTrademarkId,
        bulletinId
    } = cell.dataset;
    const currentNote = cell.querySelector('.note-text')?.textContent || '';
    const modal = document.getElementById('noteModal');
    const noteInput = document.getElementById('noteInputModal');
    noteInput.value = currentNote;
    document.getElementById('saveNoteBtn').onclick = async () => {
        const updateResult = await similarityService.updateSimilarityFields(monitoredTrademarkId, bulletinId, resultId, {
            note: noteInput.value
        });
        if (updateResult.success) {
            const hit = allSimilarResults.find(r => (r.objectID === resultId || r.applicationNo === resultId) && r.monitoredTrademarkId === monitoredTrademarkId);
            if (hit) hit.note = noteInput.value;
            cell.querySelector('.note-cell-content').innerHTML = `<span class="note-icon">📝</span><span class="${noteInput.value ? 'note-text' : 'note-placeholder'}">${noteInput.value || 'Not ekle'}</span>`;
            modal.classList.remove('show');
        } else {
            alert('Hata oluştu.');
        }
    };
    modal.classList.add('show');
    noteInput.focus();
};

// ============================================================================
// RAPOR OLUŞTURMA - REFACTORED VERSİON
// ============================================================================

const buildReportData = async (results) => {
    const reportData = [];
    
    for (const r of results) {
        const monitoredTm = monitoringTrademarks.find(mt => mt.id === r.monitoredTrademarkId);
        let ipData = null;
        let bulletinDateValue = "-";

        // 1. İlişkili IP Kaydını Çek
        if (monitoredTm?.ipRecordId || monitoredTm?.sourceRecordId) {
            try {
                const targetId = monitoredTm.ipRecordId || monitoredTm.sourceRecordId;
                const ipDoc = await getDoc(doc(db, 'ipRecords', targetId));
                if (ipDoc.exists()) ipData = ipDoc.data();
            } catch (e) { console.error("IP Record fetch error:", e); }
        }

        // 2. Bülten Tarihini Çek
        if (r.bulletinId) {
            try {
                const bulletinDoc = await getDoc(doc(db, 'trademarkBulletins', r.bulletinId));
                if (bulletinDoc.exists()) {
                    const bulletinData = bulletinDoc.data();
                    bulletinDateValue = bulletinData.bulletinDate || r.bulletinDate || r.applicationDate || "-";
                } else {
                    bulletinDateValue = r.bulletinDate || r.applicationDate || "-";
                }
            } catch (e) { 
                console.error("Bulletin fetch error:", e);
                bulletinDateValue = r.bulletinDate || r.applicationDate || "-";
            }
        } else {
            bulletinDateValue = r.bulletinDate || r.applicationDate || "-";
        }

        // 3. Sahip Bilgisini Çözümle (Rapor içeriği için isimleri birleştirir)
        let ownerNameStr = "-";
        if (ipData?.applicants && Array.isArray(ipData.applicants) && ipData.applicants.length > 0) {
            const ownerNames = [];
            for (const applicant of ipData.applicants) {
                if (applicant.id) {
                    const person = allPersons.find(p => p.id === applicant.id);
                    if (person) {
                        ownerNames.push(person.name || person.companyName || applicant.id);
                    } else {
                        ownerNames.push(applicant.id);
                    }
                } else if (applicant.name) {
                    ownerNames.push(applicant.name);
                }
            }
            ownerNameStr = ownerNames.length > 0 ? ownerNames.join(", ") : "-";
        } else {
            ownerNameStr = _pickOwners(ipData, monitoredTm, allPersons) || "-";
        }

        // [KRİTİK GÜNCELLEME] 
        // Backend'in ihtiyacı olan gerçek clientId (UUID) bilgisini 
        // projenin standart fonksiyonu üzerinden güvenli bir şekilde alıyoruz.
        const ownerInfo = _getOwnerKey(ipData, monitoredTm, allPersons);
        const monitoredClientId = ownerInfo.id; // UUID burada yer alır

        // 4. Diğer Bilgiler (GÜNCELLENMİŞ KISIM)
        const monitoredName = ipData?.title || ipData?.brandText || monitoredTm?.title || monitoredTm?.markName || "Marka Adı Yok";
        const monitoredImg = monitoredTm?.image || monitoredTm?.brandImageUrl || ipData?.brandImageUrl || monitoredTm?.imagePath || null;
        const monitoredAppNo = ipData?.applicationNumber || ipData?.applicationNo || monitoredTm?.applicationNumber || "-";
        
        let monitoredAppDate = "-";
        const rawDate = ipData?.applicationDate || monitoredTm?.applicationDate;
        if (rawDate) {
            if (typeof rawDate === 'string') {
                monitoredAppDate = rawDate.split('-').reverse().join('.');
            } else {
                monitoredAppDate = _pickAppDate(ipData, monitoredTm);
            }
        }

        let monitoredClasses = [];
        if (ipData?.niceClasses) {
            monitoredClasses = ipData.niceClasses;
        } else if (ipData?.goodsAndServicesByClass) {
            monitoredClasses = ipData.goodsAndServicesByClass.map(g => g.classNo);
        } else {
            monitoredClasses = _uniqNice(monitoredTm);
        }

        // Log ekleyerek tarayıcı konsolundan doğruluğunu kontrol edebilirsiniz
        console.log(`✅ [FRONTEND] Raporlanıyor: ${monitoredName}, ClientId: ${monitoredClientId}`);

        reportData.push({
            monitoredMark: {
                clientId: monitoredClientId, // Artık null gelmeyecektir
                name: monitoredName,
                markName: monitoredName,
                imagePath: monitoredImg,
                ownerName: ownerNameStr,
                applicationNo: monitoredAppNo,
                applicationDate: monitoredAppDate,
                niceClasses: monitoredClasses
            },
            similarMark: {
                name: r.markName,
                markName: r.markName,
                imagePath: r.imagePath || null,
                niceClasses: r.niceClasses || [],
                applicationNo: r.applicationNo || "-",
                applicationDate: r.applicationDate || "-",
                bulletinDate: bulletinDateValue,
                similarity: r.similarityScore,
                holders: r.holders || [],
                ownerName: r.holders?.[0]?.name || "-",
                bs: r.bs || null,
                note: r.note || null
            }
        });
    }
    
    return reportData;
};

const createObjectionTasks = async (results, bulletinNo, ownerId = null) => {
    let createdTaskCount = 0;
    const callerEmail = firebaseServices.auth.currentUser?.email || 'anonim@evreka.com';
    const createObjectionTaskFn = httpsCallable(functions, 'createObjectionTask');

    for (const r of results) {
        try {
            // 1. Mevcut görev kontrolü (Mükerrer görev açmamak için)
            const existingTaskQuery = query(collection(db, 'tasks'), where('taskType', '==', '20'));
            const existingTaskSnap = await getDocs(existingTaskQuery);
            
            let targetOwnerId = ownerId;
            if (!targetOwnerId) {
                const monitoredTm = monitoringTrademarks.find(tm => tm.id === r.monitoredTrademarkId);
                if (monitoredTm) {
                    const ip = await _getIp(monitoredTm.ipRecordId || monitoredTm.sourceRecordId || monitoredTm.id);
                    const ownerInfo = _getOwnerKey(ip, monitoredTm, allPersons);
                    targetOwnerId = ownerInfo?.id || null;
                }
            }

            const duplicateTask = existingTaskSnap.docs.find(doc => {
                const data = doc.data();
                return (String(data?.details?.targetAppNo) === String(r.applicationNo) && 
                        targetOwnerId && String(data?.clientId) === String(targetOwnerId));
            });
            
            if (duplicateTask) continue;

            // 2. Görevi oluştur
            const taskResponse = await createObjectionTaskFn({
                monitoredMarkId: r.monitoredTrademarkId,
                similarMark: {
                    applicationNo: r.applicationNo,
                    markName: r.markName,
                    niceClasses: r.niceClasses,
                    similarityScore: r.similarityScore
                },
                similarMarkName: r.markName,
                bulletinNo,
                callerEmail,
                bulletinRecordData: {
                    bulletinId: r.bulletinId,
                    bulletinNo: bulletinNo,
                    markName: r.markName,
                    applicationNo: r.applicationNo,
                    applicationDate: r.applicationDate,
                    imagePath: r.imagePath,
                    niceClasses: r.niceClasses,
                    holders: r.holders || [],
                    classNumbers: r.niceClasses ? r.niceClasses.split(/[,\/\s]+/).filter(Boolean).map(n => parseInt(n.trim())) : []
                }
            });

            if (taskResponse?.data?.success) {
                createdTaskCount++;
                // Portföy kaydı oluşturma (Eklenti desteğiyle)
                const taskId = taskResponse?.data?.taskId;
                const bulletinRecordId = taskResponse?.data?.bulletinRecordId || r.bulletinRecordId || r.bulletinId;
                if (taskId && bulletinRecordId && window.portfolioByOppositionCreator) {
                    await window.portfolioByOppositionCreator.createThirdPartyPortfolioFromBulletin(bulletinRecordId, taskId);
                }
            }
        } catch (e) {
            console.error("Task creation error:", e);
        }
    }
    return createdTaskCount;
};

const handleReportGeneration = async (event, options = {}) => {
    event.stopPropagation();
    const btn = event.currentTarget;
    const { ownerId, ownerName, createTasks = false, isGlobal = false } = options;
    
    const bulletinKey = document.getElementById('bulletinSelect')?.value;
    if (!bulletinKey) {
        showNotification('Lütfen bülten seçin.', 'error');
        return;
    }
    const bulletinNo = String(bulletinKey).split('_')[0];

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> İşleniyor...';

        // Filtreleme
        let filteredResults;
        if (isGlobal) {
            filteredResults = allSimilarResults.filter(r => r.isSimilar === true && r?.monitoredTrademarkId && r?.applicationNo && r?.markName);
        } else {
            const ownerMonitoredIds = [];
            for (const tm of monitoringTrademarks) {
                const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
                const ownerInfo = _getOwnerKey(ip, tm, allPersons);
                if (ownerInfo.id === ownerId) ownerMonitoredIds.push(tm.id);
            }
            filteredResults = allSimilarResults.filter(r => ownerMonitoredIds.includes(r.monitoredTrademarkId) && r.isSimilar === true);
        }

        if (filteredResults.length === 0) {
            showNotification(isGlobal ? 'Benzer sonuç bulunamadı.' : `${ownerName} için benzer sonuç bulunamadı.`, 'warning');
            return;
        }

        // İtiraz görevleri oluştur (opsiyonel)
        let createdTaskCount = 0;
        if (createTasks) {
            createdTaskCount = await createObjectionTasks(filteredResults, bulletinNo, ownerId);
        }

        // Rapor verilerini hazırla
        const reportData = await buildReportData(filteredResults);

        // Rapor oluştur ve Bildirimleri Backend'de tetikle
        const generateReportFn = httpsCallable(functions, 'generateSimilarityReport');
        const response = await generateReportFn({ 
            results: reportData, 
            bulletinNo: bulletinNo,    // Loglarda '474' olarak görünen değer buradan gidiyor
            isGlobalRequest: isGlobal  // Toplu işlem olup olmadığını belirtir
        });

        if (response?.data?.success) {
            // Başarı bildirimi
            const message = createTasks 
                ? `Rapor oluşturuldu. ${createdTaskCount > 0 ? `Oluşturulan itiraz görevi: ${createdTaskCount} adet.` : ''}`
                : 'Rapor oluşturuldu.';
            showNotification(message, 'success');

            // Dosya indirme
            const blob = new Blob([Uint8Array.from(atob(response.data.file), c => c.charCodeAt(0))], { type: 'application/zip' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            
            const fileName = isGlobal 
                ? `Toplu_Rapor${createTasks ? '_Bildirim' : ''}_${new Date().toISOString().slice(0, 10)}.zip`
                : `${ownerName.replace(/[^a-zA-Z0-9\s]/g, '_')}_${createTasks ? 'Benzer_Markalar_Rapor_VE_Bildirim' : 'Benzerlik_Raporu'}.zip`;
            link.download = fileName;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Durum güncelleme
            if (createTasks && createdTaskCount > 0) {
                try {
                    await refreshTriggeredStatus(bulletinNo);
                    await new Promise(resolve => setTimeout(resolve, 150));
                    await renderMonitoringList();
                } catch (e) {
                    console.error("Status refresh error:", e);
                }
            }
        } else {
            showNotification('Rapor oluşturma hatası: ' + (response?.data?.error || 'Bilinmeyen hata'), 'error');
        }
    } catch (err) {
        console.error('Report generation error:', err);
        showNotification('Kritik hata oluştu!', 'error');
    } finally {
        btn.disabled = false;
        const originalIcon = createTasks ? '<i class="fas fa-paper-plane"></i>' : '<i class="fas fa-file-pdf"></i>';
        const originalText = createTasks ? 'Rapor + Bildir' : 'Rapor';
        btn.innerHTML = `${originalIcon} ${originalText}`;
    }
};

// ============================================================================
// WRAPPER FONKSİYONLAR (Geriye Uyumluluk İçin)
// ============================================================================

const handleOwnerReportGeneration = async (event) => {
    const btn = event.currentTarget;
    await handleReportGeneration(event, {
        ownerId: btn.dataset.ownerId,
        ownerName: btn.dataset.ownerName,
        createTasks: false,
        isGlobal: false
    });
};

const handleOwnerReportAndNotifyGeneration = async (event) => {
    const btn = event.currentTarget;
    await handleReportGeneration(event, {
        ownerId: btn.dataset.ownerId,
        ownerName: btn.dataset.ownerName,
        createTasks: true,
        isGlobal: false
    });
};

const handleGlobalReportAndNotifyGeneration = async (event) => {
    await handleReportGeneration(event, {
        createTasks: true,
        isGlobal: true
    });
};

const addGlobalOptionToBulletinSelect = () => {
    const select = document.getElementById('bulletinSelect');
    if (!select) return;
    if (!select.querySelector('option[value="' + MANUAL_COLLECTION_ID + '"]')) {
        const opt = document.createElement('option');
        opt.value = MANUAL_COLLECTION_ID;
        opt.textContent = "🌍 YURTDIŞI / SERBEST KAYITLAR (Tümü)";
        opt.style.fontWeight = "bold";
        opt.style.color = "#d63384";
        const firstOption = select.options[0];
        if (firstOption) firstOption.insertAdjacentElement('afterend', opt);
        else select.appendChild(opt);
    }
};
const openManualEntryModal = () => {
    const modal = $('#addManualResultModal');
    const niceGrid = document.getElementById('manualNiceGrid');
    document.getElementById('manualTargetSearchInput').value = '';
    document.getElementById('manualTargetId').value = '';
    document.getElementById('manualTargetSearchResults').style.display = 'none';
    document.getElementById('manualTargetSelectedInfo').style.display = 'none';
    const tpRadio = document.querySelector('input[name="manualSourceType"][value="tp"]');
    const manualRadio = document.querySelector('input[name="manualSourceType"][value="manual"]');
    if (tpRadio) {
        tpRadio.checked = true;
        tpRadio.parentElement.classList.add('active');
    }
    if (manualRadio) manualRadio.parentElement.classList.remove('active');
    document.getElementById('tpSourceForm').style.display = 'block';
    document.getElementById('manualSourceForm').style.display = 'none';
    niceGrid.innerHTML = '';
    for (let i = 1; i <= 45; i++) {
        const div = document.createElement('div');
        div.className = 'nice-class-box-item';
        div.textContent = i;
        div.dataset.classNo = i;
        div.onclick = function() {
            this.classList.toggle('selected');
        };
        niceGrid.appendChild(div);
    }
    document.getElementById('tpSearchBulletinNo').value = '';
    document.getElementById('tpSearchAppNo').value = '';
    const previewCard = document.getElementById('tpPreviewCard');
    if (previewCard) previewCard.style.display = 'none';
    tpSearchResultData = null;
    document.getElementById('btnSaveManualResult').disabled = true;
    ['manMarkName', 'manAppNo', 'manSourceInfo', 'manOwner', 'manAppDate', 'manObjectionDeadline'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    manualSelectedFile = null;
    const previewContainer = document.getElementById('manualImgPreviewContainer');
    const defaultContent = document.querySelector('#manualImgDropZone .default-content');
    if (previewContainer) previewContainer.style.display = 'none';
    if (defaultContent) defaultContent.style.display = 'block';
    if (document.getElementById('manualImgInput')) document.getElementById('manualImgInput').value = '';
    modal.modal('show');
};
const updateManualFormUI = (selectedValue) => {
    const tpForm = document.getElementById('tpSourceForm');
    const manForm = document.getElementById('manualSourceForm');
    const saveBtn = document.getElementById('btnSaveManualResult');
    if (selectedValue === 'tp') {
        if (tpForm) tpForm.style.display = 'block';
        if (manForm) manForm.style.display = 'none';
        if (saveBtn) saveBtn.disabled = !tpSearchResultData;
    } else {
        if (tpForm) tpForm.style.display = 'none';
        if (manForm) manForm.style.display = 'block';
        if (saveBtn) saveBtn.disabled = false;
    }
};
const queryTpRecordForManualAdd = async () => {
    const bNo = document.getElementById('tpSearchBulletinNo').value.trim();
    const appNo = document.getElementById('tpSearchAppNo').value.trim();
    if (!bNo || !appNo) {
        showNotification('Lütfen Kaynak Bülten No ve Başvuru No giriniz.', 'warning');
        return;
    }
    SimpleLoading.show('Sorgulanıyor...', 'Veritabanında kayıt aranıyor...');
    try {
        const q = query(collection(db, 'trademarkBulletinRecords'), where('bulletinNo', '==', bNo), where('applicationNo', '==', appNo), limit(1));
        const snap = await getDocs(q);
        if (snap.empty) {
            SimpleLoading.hide();
            showNotification('Kayıt bulunamadı.', 'error');
            document.getElementById('tpPreviewCard').style.display = 'none';
            document.getElementById('btnSaveManualResult').disabled = true;
            tpSearchResultData = null;
            return;
        }
        const data = snap.docs[0].data();
        tpSearchResultData = { ...data,
            id: snap.docs[0].id
        };
        document.getElementById('tpPreviewName').textContent = data.markName || '-';
        document.getElementById('tpPreviewAppNo').textContent = data.applicationNo || '-';
        document.getElementById('tpPreviewClasses').textContent = data.niceClasses || '-';
        const ownerName = Array.isArray(data.holders) ? data.holders.map(h => h.name).join(', ') : (data.holders || '-');
        document.getElementById('tpPreviewOwner').textContent = ownerName;
        let imgUrl = '/img/placeholder.png';
        if (data.imagePath) {
            try {
                const storageRef = ref(getStorage(), data.imagePath);
                imgUrl = await getDownloadURL(storageRef);
            } catch (e) {}
        }
        document.getElementById('tpPreviewImg').src = imgUrl;
        document.getElementById('tpPreviewCard').style.display = 'block';
        document.getElementById('btnSaveManualResult').disabled = false;
        SimpleLoading.hide();
    } catch (error) {
        SimpleLoading.hide();
        console.error("Sorgu hatası:", error);
        showNotification('Sorgulama sırasında hata oluştu.', 'error');
    }
};
const saveManualResultEntry = async () => {
    const monitoredId = document.getElementById('manualTargetId').value;
    if (!monitoredId) {
        showNotification('Lütfen izlenen marka seçiniz.', 'warning');
        return;
    }
    const sourceType = document.querySelector('input[name="manualSourceType"]:checked').value;
    const currentBulletinVal = document.getElementById('bulletinSelect').value;
    let targetDocRef;
    let newResultItem = {};
    if (sourceType === 'tp') {
        if (!tpSearchResultData) return;
        if (!currentBulletinVal || currentBulletinVal === MANUAL_COLLECTION_ID) {
            showNotification('TP kaydı eklemek için lütfen bülten seçiniz.', 'warning');
            return;
        }
        targetDocRef = doc(db, 'monitoringTrademarkRecords', currentBulletinVal, 'trademarks', monitoredId);
        newResultItem = { ...tpSearchResultData,
            source: 'manual_tp_lookup',
            isSimilar: true,
            similarityScore: 1.0,
            monitoredTrademarkId: monitoredId,
            addedAt: new Date().toISOString()
        };
    } else {
        const markName = document.getElementById('manMarkName').value.trim();
        const appNo = document.getElementById('manAppNo').value.trim();
        if (!markName || !appNo) {
            showNotification('Marka Adı ve Başvuru Numarası zorunludur.', 'warning');
            return;
        }
        let uploadedImageUrl = null;
        if (manualSelectedFile) {
            SimpleLoading.updateText('Görsel Yükleniyor...', 'Lütfen bekleyiniz.');
            try {
                const fileName = `manual_uploads/${Date.now()}_${manualSelectedFile.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
                const snapshot = await uploadBytes(ref(getStorage(), fileName), manualSelectedFile);
                uploadedImageUrl = await getDownloadURL(snapshot.ref);
            } catch (uploadError) {
                showNotification('Görsel yüklenirken hata oluştu.', 'warning');
            }
        }
        const selectedClasses = Array.from(document.querySelectorAll('.nice-class-box-item.selected')).map(el => el.dataset.classNo).join(', ');
        targetDocRef = doc(db, 'monitoringTrademarkRecords', MANUAL_COLLECTION_ID, 'trademarks', monitoredId);
        newResultItem = {
            markName: markName,
            applicationNo: appNo,
            bulletinNo: document.getElementById('manSourceInfo').value.trim() || 'Manual',
            applicationDate: document.getElementById('manAppDate').value || null,
            objectionDeadline: document.getElementById('manObjectionDeadline').value || null,
            niceClasses: selectedClasses,
            holders: [{
                name: document.getElementById('manOwner').value.trim()
            }],
            brandImageUrl: uploadedImageUrl,
            imagePath: uploadedImageUrl,
            source: 'manual_entry',
            isSimilar: true,
            similarityScore: 1.0,
            monitoredTrademarkId: monitoredId,
            addedAt: new Date().toISOString()
        };
    }
    SimpleLoading.show('Kaydediliyor...', 'Sonuç listeye ekleniyor...');
    try {
        const docSnap = await getDoc(targetDocRef);
        if (!docSnap.exists()) {
            await setDoc(targetDocRef, {
                results: [newResultItem],
                updatedAt: new Date().toISOString()
            });
        } else {
            await updateDoc(targetDocRef, {
                results: arrayUnion(newResultItem),
                updatedAt: new Date().toISOString()
            });
        }
        if ((sourceType === 'tp' && currentBulletinVal !== MANUAL_COLLECTION_ID) || (sourceType === 'manual' && currentBulletinVal === MANUAL_COLLECTION_ID)) {
            const monitoredTm = monitoringTrademarks.find(t => t.id === monitoredId);
            allSimilarResults.push({ ...newResultItem,
                monitoredTrademark: monitoredTm?.title || monitoredTm?.markName || 'Bilinmeyen'
            });
            groupAndSortResults();
            if (pagination) pagination.update(allSimilarResults.length);
            renderCurrentPageOfResults();
            infoMessageContainer.innerHTML = `<div class="info-message success">Yeni kayıt başarıyla eklendi.</div>`;
        } else {
            showNotification('Kayıt eklendi. Görüntülemek için ilgili listeye geçiniz.', 'success');
        }
        $('#addManualResultModal').modal('hide');
        SimpleLoading.hide();
    } catch (error) {
        SimpleLoading.hide();
        showNotification('Kaydetme sırasında hata: ' + error.message, 'error');
    }
};
const setupManualTargetSearch = () => {
    const input = document.getElementById('manualTargetSearchInput');
    const resultsContainer = document.getElementById('manualTargetSearchResults');
    const hiddenId = document.getElementById('manualTargetId');
    const infoBox = document.getElementById('manualTargetSelectedInfo');
    const infoText = document.getElementById('manualTargetSelectedText');
    if (!input || !resultsContainer) return;
    input.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        if (term.length === 0) {
            resultsContainer.style.display = 'none';
            hiddenId.value = '';
            infoBox.style.display = 'none';
            return;
        }
        const matches = monitoringTrademarks.filter(tm => {
            const name = (tm.title || tm.markName || '').toLowerCase();
            const appNo = (tm.applicationNumber || tm.applicationNo || '').toLowerCase();
            return name.includes(term) || appNo.includes(term);
        });
        resultsContainer.innerHTML = '';
        if (matches.length > 0) {
            matches.slice(0, 10).forEach(tm => {
                const name = tm.title || tm.markName || 'İsimsiz';
                const appNo = tm.applicationNumber || tm.applicationNo || '-';
                const item = document.createElement('a');
                item.href = "#";
                item.className = "list-group-item list-group-item-action";
                item.style.cursor = "pointer";
                item.innerHTML = `<div class="d-flex w-100 justify-content-between"><h6 class="mb-1 font-weight-bold" style="font-size:0.95rem;">${name}</h6><small>${appNo}</small></div>`;
                item.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    input.value = name;
                    hiddenId.value = tm.id;
                    infoText.textContent = `${name} (${appNo})`;
                    infoBox.style.display = 'block';
                    resultsContainer.style.display = 'none';
                });
                resultsContainer.appendChild(item);
            });
            resultsContainer.style.display = 'block';
        } else {
            resultsContainer.innerHTML = '<div class="list-group-item text-muted">Sonuç bulunamadı.</div>';
            resultsContainer.style.display = 'block';
        }
    });
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !resultsContainer.contains(e.target)) resultsContainer.style.display = 'none';
    });
};
const setupDragAndDrop = () => {
    const dropZone = document.getElementById('manualImgDropZone');
    const fileInput = document.getElementById('manualImgInput');
    const previewContainer = document.getElementById('manualImgPreviewContainer');
    const previewImg = document.getElementById('manualImgPreview');
    const removeBtn = document.getElementById('removeManualImgBtn');
    const defaultContent = dropZone.querySelector('.default-content');
    if (!dropZone) return;
    const handleFileSelect = (file) => {
        if (!file || !file.type.startsWith('image/')) {
            showNotification('Lütfen geçerli bir resim seçin.', 'warning');
            return;
        }
        manualSelectedFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            previewContainer.style.display = 'block';
            defaultContent.style.display = 'none';
        };
        reader.readAsDataURL(file);
    };
    dropZone.addEventListener('click', (e) => {
        if (e.target !== removeBtn && !removeBtn.contains(e.target)) fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
    });
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(n => dropZone.addEventListener(n, (e) => {
        e.preventDefault();
        e.stopPropagation();
    }));
    ['dragenter', 'dragover'].forEach(n => dropZone.addEventListener(n, () => dropZone.classList.add('drag-over')));
    ['dragleave', 'drop'].forEach(n => dropZone.addEventListener(n, () => dropZone.classList.remove('drag-over')));
    dropZone.addEventListener('drop', (e) => {
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });
    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        manualSelectedFile = null;
        fileInput.value = '';
        previewImg.src = '';
        previewContainer.style.display = 'none';
        defaultContent.style.display = 'block';
    });
};

// --- 7. MODAL HELPERS (Added Missing Functions) ---
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
    modalImage.src = '';
    try {
        let imgUrl = '';
        if (markData.brandImageUrl && /^(https?:|data:)/i.test(markData.brandImageUrl)) imgUrl = markData.brandImageUrl;
        if (!imgUrl && markData.ipRecordId) {
            const ip = await _getIp(markData.ipRecordId);
            imgUrl = _pickImg(ip, markData) || '';
        }
        if (!imgUrl && markData.applicationNumber) imgUrl = await _getBrandImageByAppNo(markData.applicationNumber);
        if (imgUrl) {
            if (!/^(https?:|data:|blob:)/i.test(imgUrl) && !/^data:image\//i.test(imgUrl)) {
                imgUrl = await getDownloadURL(ref(getStorage(), imgUrl));
            }
            modalImage.src = imgUrl;
        }
    } catch (e) {}
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

function setupEditCriteriaModal() {
    const brandTextSearchInput = document.getElementById('brandTextSearchInput');
    const addBrandTextBtn = document.getElementById('addBrandTextBtn');
    const brandTextSearchList = document.getElementById('brandTextSearchList');
    const niceClassSelectionContainer = document.getElementById('niceClassSelectionContainer');
    const niceClassSearchList = document.getElementById('niceClassSearchList');
    const saveCriteriaBtn = document.getElementById('saveCriteriaBtn');
    for (let i = 1; i <= 45; i++) {
        const box = document.createElement('div');
        box.className = 'nice-class-box';
        box.textContent = i;
        box.dataset.classNo = i;
        niceClassSelectionContainer.appendChild(box);
    }
    niceClassSelectionContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('nice-class-box')) {
            const classNo = e.target.dataset.classNo;
            const isPermanent = e.target.classList.contains('permanent-item');
            if (isPermanent) {
                showNotification('Bu sınıf orijinal marka sınıfı olduğu için kaldırılamaz.', 'warning');
                return;
            }
            e.target.classList.toggle('selected');
            if (e.target.classList.contains('selected')) addListItem(niceClassSearchList, classNo);
            else removeListItem(niceClassSearchList, classNo);
        }
    });
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
    document.querySelectorAll('.list-group').forEach(list => {
        list.addEventListener('click', (e) => {
            const listItem = e.target.closest('li');
            if (listItem && e.target.classList.contains('remove-item')) {
                if (listItem.classList.contains('permanent-item')) {
                    showNotification('Bu öğe kaldırılamaz.', 'warning');
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
    saveCriteriaBtn.addEventListener('click', async () => {
        const modal = document.getElementById('editCriteriaModal');
        const brandTextArray = Array.from(modal.querySelector('#brandTextSearchList').querySelectorAll('.list-item-text')).map(el => el.textContent);
        const niceClassArray = Array.from(modal.querySelector('#niceClassSearchList').querySelectorAll('.list-item-text')).map(el => parseInt(el.textContent)).filter(n => !isNaN(n));
        const originalMarkId = modal.dataset.markId;
        if (!originalMarkId) {
            showNotification('Orijinal marka kimliği bulunamadı.', 'error');
            return;
        }
        try {
            const res = await monitoringService.updateMonitoringItem(originalMarkId, {
                brandTextSearch: brandTextArray,
                niceClassSearch: niceClassArray
            });
            if (res.success) {
                showNotification('İzleme kriterleri güncellendi.', 'success');
                $('#editCriteriaModal').modal('hide');
            } else showNotification('Hata: ' + res.error, 'error');
        } catch (error) {
            console.error(error);
            showNotification('Beklenmeyen hata.', 'error');
        }
    });
}

function populateNiceClassBoxes(selectedClasses, permanentClasses = []) {
    document.querySelectorAll('.nice-class-box').forEach(box => {
        box.classList.remove('selected');
        box.classList.remove('permanent-item');
    });
    const selectedClassesString = (selectedClasses || []).map(cls => String(cls)).filter(cls => cls && cls !== 'null');
    const permanentClassesString = (permanentClasses || []).map(cls => String(cls)).filter(cls => cls && cls !== 'null');
    const allNiceClasses = new Set([...selectedClassesString, ...permanentClassesString]);
    const niceClassSearchList = document.getElementById('niceClassSearchList');
    if (niceClassSearchList) populateList(niceClassSearchList, [], permanentClassesString);
    allNiceClasses.forEach(cls => {
        const box = document.querySelector(`.nice-class-box[data-class-no="${cls}"]`);
        if (box) {
            box.classList.add('selected');
            if (permanentClassesString.includes(cls)) box.classList.add('permanent-item');
            if (niceClassSearchList) {
                const listItem = addListItem(niceClassSearchList, cls);
                if (listItem && permanentClassesString.includes(cls)) listItem.classList.add('permanent-item');
            }
        }
    });
}

function addListItem(listElement, text, isPermanent = false) {
    const emptyItem = listElement.querySelector('.list-group-item.text-muted');
    if (emptyItem) emptyItem.remove();
    const existingItems = Array.from(listElement.querySelectorAll('.list-item-text')).map(el => el.textContent);
    if (existingItems.includes(text)) return;
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    if (isPermanent) li.classList.add('permanent-item');
    li.innerHTML = `<span class="list-item-text">${text}</span><button type="button" class="btn btn-sm btn-danger remove-item">&times;</button>`;
    listElement.appendChild(li);
    return li;
}

function removeListItem(listElement, text) {}

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
window.queryApplicationNumberWithExtension = (applicationNo) => {
    const appNo = (applicationNo || '').toString().trim();
    if (!appNo) {
        alert('Başvuru numarası bulunamadı.');
        return;
    }
    const EXT_ID = 'gkhmldkbjmnipikgjabmlilibllikapk';
    const fallbackUrl = `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(appNo)}`;
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && EXT_ID) {
            chrome.runtime.sendMessage(EXT_ID, {
                type: 'SORGULA',
                data: appNo
            }, (response) => {
                const ok = response && (response.status === 'OK' || response.status === 'OK_WAIT');
                if (!ok) window.open(fallbackUrl, '_blank');
            });
        } else {
            window.open(fallbackUrl, '_blank');
        }
    } catch (e) {
        window.open(fallbackUrl, '_blank');
    }
};

// --- 8. MAIN ENTRY (DOM Loaded) ---
document.addEventListener('DOMContentLoaded', async () => {
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
    if (startSearchBtn) startSearchBtn.addEventListener('click', performSearch);
    if (researchBtn) researchBtn.addEventListener('click', performResearch);

    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            if (ownerSearchInput) ownerSearchInput.value = '';
            if (niceClassSearchInput) niceClassSearchInput.value = '';
            if (brandNameSearchInput) brandNameSearchInput.value = '';
            if (bulletinSelect) bulletinSelect.selectedIndex = 0;
            applyMonitoringListFilters();
            showNotification('İzleme listesi filtreleri temizlendi.', 'info');
        });
    }

    [ownerSearchInput, niceClassSearchInput, brandNameSearchInput].forEach(input => {
        if (input) input.addEventListener('input', debounce(applyMonitoringListFilters, 400));
    });

    if (bulletinSelect) {
        bulletinSelect.addEventListener('change', checkCacheAndToggleButtonStates);
        bulletinSelect.addEventListener('change', async () => {
            const bNo = String(bulletinSelect.value || '').split('_')[0];
            if (bNo) {
                await refreshTriggeredStatus(bNo);
                renderMonitoringList();
            }
        });
    }

    if (btnGenerateReportAndNotifyGlobal) btnGenerateReportAndNotifyGlobal.addEventListener('click', handleGlobalReportAndNotifyGeneration);

    // Manuel Modal
    if (openManualEntryBtn) openManualEntryBtn.addEventListener('click', openManualEntryModal);

    document.querySelectorAll('.btn-group-toggle label.btn').forEach(label => {
        label.addEventListener('click', function() {
            const input = this.querySelector('input');
            if (input) setTimeout(() => updateManualFormUI(input.value), 50);
        });
    });

    if (btnQueryTp) btnQueryTp.addEventListener('click', queryTpRecordForManualAdd);
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
// --- WORKER ARAYÜZ GÜNCELLEME FONKSİYONU ---
function renderWorkersGrid(workers) {
    const container = document.getElementById('workersGridContainer');
    const gridEl = document.getElementById('workersGrid');
    
    if (!container || !gridEl) {
        console.error('❌ Worker container bulunamadı!', { container, gridEl });
        return;
    }

    container.style.display = 'block';
    container.style.position = 'relative';
    container.style.zIndex = '10000';
    container.style.marginTop = '15px';
    container.style.marginBottom = '15px';
    
    console.log(`🎨 Worker container görünür yapıldı, ${workers.length} worker render ediliyor`);

    workers.forEach((worker) => {
    const workerId = worker.id;
    
    console.log(`🔨 Worker #${workerId} kartı oluşturuluyor/güncelleniyor`); // ✅ EKLE
    
    // Kart DOM elementi var mı?
    let card = document.getElementById(`worker-card-${workerId}`);
        
        // Yoksa oluştur
        if (!card) {
            card = document.createElement('div');
            card.id = `worker-card-${workerId}`;
            card.className = 'worker-card';
            // CSS styles (İsterseniz CSS dosyasına taşıyabilirsiniz)
            card.style.cssText = `
                background: #fff; 
                border: 1px solid #e0e0e0; 
                border-radius: 8px; 
                padding: 10px; 
                text-align: center; 
                font-size: 11px; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                transition: all 0.3s ease;
            `;
            gridEl.appendChild(card);
        }

        // Duruma göre renk ve ikon belirle
        let statusColor = '#f59e0b'; // Sarı (İşleniyor)
        let iconHtml = '<i class="fas fa-cog fa-spin"></i>';
        
        if (worker.status === 'completed') {
            statusColor = '#10b981'; // Yeşil
            iconHtml = '<i class="fas fa-check-circle"></i>';
        } else if (worker.status === 'error') {
            statusColor = '#ef4444'; // Kırmızı
            iconHtml = '<i class="fas fa-exclamation-circle"></i>';
        } else if (worker.status === 'paused') {
            statusColor = '#6366f1'; // Mor
            iconHtml = '<i class="fas fa-pause-circle"></i>';
        }

        const percent = worker.progress || 0;

        // Kart içeriğini güncelle
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <strong style="color:#333;">Worker #${workerId}</strong>
                <span style="color:${statusColor}; font-size:14px;">${iconHtml}</span>
            </div>
            <div class="progress" style="height: 6px; background-color: #f1f5f9; border-radius: 3px; overflow: hidden; margin-bottom: 4px;">
                <div class="progress-bar" style="width: ${percent}%; background-color: ${statusColor}; transition: width 0.5s;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; color:#64748b;">
                <span>${worker.processed || 0} / ${worker.total || '?'}</span>
                <strong>%${percent}</strong>
            </div>
        `;
    });
}