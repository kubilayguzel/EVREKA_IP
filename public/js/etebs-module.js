// public/js/etebs-module.js

import { firebaseServices, authService, ipRecordsService } from '../firebase-config.js';
import { ref, getDownloadURL, uploadBytes, getStorage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { collection, query, where, getDocs, addDoc, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// --- Modüller ---
import { RecordMatcher } from './indexing/record-matcher.js';
import Pagination from './pagination.js';

// Notification Helper
function showNotification(message, type = 'info') {
    if (window.showNotification) window.showNotification(message, type);
    else console.log(`[${type}] ${message}`);
}

export class ETEBSManager {
    constructor() {
        this.currentMode = 'etebs'; // 'etebs' | 'upload'
        this.matcher = new RecordMatcher(); 
        
        // Veri Havuzları
        this.matchedDocs = [];
        this.unmatchedDocs = [];
        this.indexedDocs = [];

        // Pagination Referansları
        this.paginations = { matched: null, unmatched: null, indexed: null };

        // Başlat
        this.init();
    }

    async init() {
        // 1. Badge'i güncelle (Sayfa açılışında)
        await this.updateMainBadgeCount();
        
        // 2. Token yükle (Varsa inputa doldur)
        this.loadSavedToken();

        // 3. Event Listener'ları kur
        this.bindEvents();

        // 4. Upload modunu hazırla
        this.setupUploadMode();
    }

    // ============================================================
    // 1. BADGE YÖNETİMİ
    // ============================================================
    
    async updateMainBadgeCount() {
        try {
            // Sadece 'pending' olanları say
            const q = query(
                collection(firebaseServices.db, 'unindexed_pdfs'),
                where('status', '==', 'pending')
            );
            
            const snapshot = await getDocs(q);
            const count = snapshot.size;

            // UI Güncelle
            const badge = document.querySelector('.tab-badge') || document.getElementById('totalBadge');
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? 'inline-block' : 'none';
            }
        } catch (error) {
            console.warn('Badge güncelleme hatası:', error);
        }
    }

    // ============================================================
    // 2. SUNUCU SENKRONİZASYONU (SYNC)
    // ============================================================

    loadSavedToken() {
        const token = localStorage.getItem('etebs_token');
        const input = document.getElementById('etebsTokenInput');
        if (token && input) {
            input.value = token;
        }
    }

    async triggerServerSync() {
        const input = document.getElementById('etebsTokenInput');
        const token = input ? input.value.trim() : null;
        const user = authService.auth.currentUser;

        if (!token || !user) return;

        // Token'ı kaydet
        localStorage.setItem('etebs_token', token);

        try {
            // Ortam Belirleme
            const hostname = window.location.hostname;
            const isTestEnv = (hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes("ip-manager-production-aab4b"));
            const projectId = isTestEnv ? "ip-manager-production-aab4b" : "ipgate-31bd2";
            const region = 'europe-west1';
            const functionUrl = `https://${region}-${projectId}.cloudfunctions.net/etebsProxyV2`;

            console.log(`🚀 Sync Başlatılıyor... (${isTestEnv ? 'TEST' : 'PROD'})`);

            // Fire-and-forget (Cevabı beklemeden devam et)
            fetch(functionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'CHECK_LIST_ONLY',
                    token: token,
                    userId: user.uid
                })
            }).catch(e => console.warn("Sync tetikleme hatası (önemsiz):", e));

        } catch (e) {
            console.warn("Sync hatası:", e);
        }
    }

    // ============================================================
    // 3. VERİ ÇEKME VE EŞLEŞTİRME (CORE LOGIC)
    // ============================================================

    async handleFetchButton() {
        // 1. Önce Sunucuyu Tetikle (Yeni evrak varsa çeksin)
        await this.triggerServerSync();

        // 2. Hemen Mevcut Veriyi Göster
        await this.loadAndProcessDocuments();

        // 3. (Opsiyonel) 2 saniye sonra tekrar çek (Sunucudan yeni gelenler düşmüş olabilir)
        setTimeout(() => this.loadAndProcessDocuments(true), 2500);
    }

    async loadAndProcessDocuments(isBackgroundRefresh = false) {
        if (!isBackgroundRefresh && window.SimpleLoadingController) {
            window.SimpleLoadingController.show({ 
                text: 'Evraklar taranıyor...', 
                subtext: 'Portföy eşleştirmesi yapılıyor' 
            });
        }

        try {
            // A. Portföy Kayıtlarını Getir (Eşleştirme Referansı)
            const recordsResult = await ipRecordsService.getAllRecords({ source: 'server' });
            const portfolioRecords = recordsResult.success ? recordsResult.data : [];

            // B. Veritabanı Sorguları
            const colRef = collection(firebaseServices.db, 'unindexed_pdfs');
            
            // Bekleyenler (Hepsi)
            const qPending = query(colRef, where('status', '==', 'pending'));
            
            // İndekslenenler (Son 50)
            const qIndexed = query(colRef, where('status', '==', 'indexed'), orderBy('uploadedAt', 'desc'), limit(50));

            const [snapPending, snapIndexed] = await Promise.all([
                getDocs(qPending),
                getDocs(qIndexed)
            ]);

            // C. Listeleri Temizle
            this.matchedDocs = [];
            this.unmatchedDocs = [];
            this.indexedDocs = [];

            // D. Pending Kayıtları İşle ve Eşleştir
            snapPending.forEach(doc => {
                const data = doc.data();
                const docObj = this._normalizeDocData(doc.id, data);

                // Eşleştirme Yap
                this._processMatching(docObj, portfolioRecords);
            });

            // E. Indexed Kayıtları İşle
            snapIndexed.forEach(doc => {
                const data = doc.data();
                this.indexedDocs.push(this._normalizeDocData(doc.id, data));
            });

            // F. Ekrana Bas
            this.renderAllTabs();
            
            // Badge'i tazele
            this.updateMainBadgeCount(); 

            if (!isBackgroundRefresh) {
                showNotification(`Toplam ${this.matchedDocs.length + this.unmatchedDocs.length} bekleyen evrak listelendi.`, 'success');
            }

        } catch (error) {
            console.error('Veri yükleme hatası:', error);
            if (!isBackgroundRefresh) showNotification('Evrak listesi alınamadı: ' + error.message, 'error');
        } finally {
            if (!isBackgroundRefresh && window.SimpleLoadingController) window.SimpleLoadingController.hide();
        }
    }

    _processMatching(doc, portfolioRecords) {
        // Arama Anahtarı Önceliği: Dosya No -> App No -> Extracted -> Evrak No
        const searchKey = doc.dosyaNo || doc.applicationNo || doc.extractedAppNumber || doc.evrakNo;

        if (searchKey && portfolioRecords.length > 0) {
            const match = this.matcher.findMatch(searchKey, portfolioRecords);
            
            if (match) {
                doc.matched = true;
                doc.matchedRecordId = match.record.id;
                doc.matchedRecordDisplay = this.matcher.getDisplayLabel(match.record);
                doc.recordOwnerType = match.record.recordOwnerType || 'self';
                
                this.matchedDocs.push(doc);
            } else {
                doc.matched = false;
                this.unmatchedDocs.push(doc);
            }
        } else {
            doc.matched = false;
            this.unmatchedDocs.push(doc);
        }
    }

    _normalizeDocData(id, data) {
        return {
            id: id,
            ...data,
            uploadedAt: this._toDate(data.uploadedAt),
            belgeTarihi: this._toDate(data.belgeTarihi || data.uploadedAt)
        };
    }

    _toDate(timestamp) {
        if (!timestamp) return null;
        if (typeof timestamp.toDate === 'function') return timestamp.toDate();
        if (timestamp instanceof Date) return timestamp;
        const d = new Date(timestamp);
        return isNaN(d.getTime()) ? null : d;
    }

    // ============================================================
    // 4. UI RENDER VE PAGINATION
    // ============================================================

    renderAllTabs() {
        // Tab Rozetleri
        this._updateTabBadge('matchedTabBadge', this.matchedDocs.length);
        this._updateTabBadge('unmatchedTabBadge', this.unmatchedDocs.length);
        this._updateTabBadge('indexedTabBadge', this.indexedDocs.length);

        // Sıralama (Yeniden Eskiye)
        const sortFn = (a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0);

        // Pagination Kurulumu
        this.setupPagination('matched', this.matchedDocs.sort(sortFn), 'matchedNotificationsList');
        this.setupPagination('unmatched', this.unmatchedDocs.sort(sortFn), 'unmatchedNotificationsList');
        this.setupPagination('indexed', this.indexedDocs.sort(sortFn), 'indexedNotificationsList');

        // Otomatik Tab Geçişi
        this._autoSwitchTab();
    }

    _updateTabBadge(id, count) {
        const el = document.getElementById(id);
        if (el) el.textContent = count;
    }

    _autoSwitchTab() {
        const activeBtn = document.querySelector('.notification-tab-btn.active');
        if (!activeBtn) return;

        const currentTarget = activeBtn.getAttribute('data-target');
        
        // Matched boşsa Unmatched'e geç
        if (currentTarget === 'matched-notifications-tab' && this.matchedDocs.length === 0 && this.unmatchedDocs.length > 0) {
            this.switchNotificationsTab('unmatched-notifications-tab');
        } 
        // Unmatched boşsa Matched'e geç
        else if (currentTarget === 'unmatched-notifications-tab' && this.unmatchedDocs.length === 0 && this.matchedDocs.length > 0) {
            this.switchNotificationsTab('matched-notifications-tab');
        }
    }

    setupPagination(type, dataList, containerId) {
        const paginationId = `${type}Pagination`;
        
        // Pagination instance yönetimi
        if (this.paginations[type]) {
             // Gerekirse destroy edilebilir
        }

        this.paginations[type] = new Pagination({
            containerId: paginationId,
            itemsPerPage: 10,
            showItemsPerPageSelector: true,
            onPageChange: (currentPage, itemsPerPage) => {
                const start = (currentPage - 1) * itemsPerPage;
                const pageItems = dataList.slice(start, start + itemsPerPage);
                this.renderListItems(containerId, pageItems, type);
            }
        });

        this.paginations[type].update(dataList.length);
        // İlk sayfa render
        this.renderListItems(containerId, dataList.slice(0, 10), type);
    }

    renderListItems(containerId, items, type) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (items.length === 0) {
            container.innerHTML = `<div class="empty-state" style="padding:20px; text-align:center; color:#999;">
                <i class="fas fa-folder-open fa-2x mb-2"></i><br>Kayıt bulunamadı
            </div>`;
            return;
        }

        container.innerHTML = items.map(item => this._createItemHTML(item, type)).join('');

        // Buton Eventlerini Bağla
        container.querySelectorAll('.notification-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this._handleItemAction(e, items));
        });
    }

    _createItemHTML(doc, type) {
        const dateStr = doc.uploadedAt ? doc.uploadedAt.toLocaleDateString('tr-TR') : '-';
        const isManual = (doc.source === 'manual' || doc.source === 'MANUEL');
        
        const sourceBadge = isManual 
            ? '<span class="badge badge-warning text-white mr-2" style="font-size:0.7em;">MANUEL</span>' 
            : '<span class="badge badge-info mr-2" style="font-size:0.7em;">ETEBS</span>';

        let statusHtml = '';
        let actionBtn = '';

        if (type === 'matched') {
            statusHtml = `<span class="text-success font-weight-bold"><i class="fas fa-link"></i> ${doc.matchedRecordDisplay || 'Eşleşti'}</span>`;
            actionBtn = `<button class="btn btn-primary btn-sm notification-action-btn" data-action="index" data-id="${doc.id}" title="İndeksle">
                            <i class="fas fa-edit"></i>
                         </button>`;
        } else if (type === 'unmatched') {
            statusHtml = `<span class="text-danger"><i class="fas fa-times"></i> Eşleşmedi</span>`;
            actionBtn = `<button class="btn btn-outline-primary btn-sm notification-action-btn" data-action="index" data-id="${doc.id}" title="Manuel İndeksle">
                            <i class="fas fa-edit"></i>
                         </button>`;
        } else {
            statusHtml = `<span class="text-muted"><i class="fas fa-check-double"></i> İndekslendi</span>`;
            actionBtn = `<button class="btn btn-light btn-sm" disabled style="opacity:0.5"><i class="fas fa-check"></i></button>`;
        }

        return `
            <div class="pdf-list-item ${type} p-3 mb-2 bg-white rounded border shadow-sm" style="border-left: 4px solid ${type==='matched'?'#28a745':type==='unmatched'?'#dc3545':'#6c757d'} !important;">
                <div class="d-flex align-items-center w-100">
                    <div class="pdf-icon mr-3">
                        <i class="fas fa-file-pdf fa-2x text-danger"></i>
                    </div>
                    <div style="flex:1">
                        <div class="mb-1 d-flex align-items-center">
                            ${sourceBadge} 
                            <strong class="text-dark">${doc.fileName || doc.belgeAciklamasi || 'İsimsiz Belge'}</strong>
                        </div>
                        <div class="small text-muted">
                            <i class="far fa-calendar-alt"></i> ${dateStr} • 
                            <strong>Evrak No:</strong> ${doc.evrakNo || '-'} • 
                            <strong>Dosya:</strong> ${doc.dosyaNo || '-'}
                        </div>
                        <div class="small mt-1">${statusHtml}</div>
                    </div>
                    <div class="ml-2 d-flex flex-column align-items-end">
                        <button class="btn btn-success btn-sm notification-action-btn mb-1" data-action="show" data-id="${doc.id}" title="Görüntüle">
                            <i class="fas fa-eye"></i>
                        </button>
                        ${actionBtn}
                    </div>
                </div>
            </div>
        `;
    }

    _handleItemAction(e, items) {
        const btn = e.target.closest('.notification-action-btn');
        if (!btn) return;
        e.stopPropagation();

        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const doc = items.find(i => i.id === id);

        if (!doc) return;

        if (action === 'show') {
            if (doc.fileUrl) window.open(doc.fileUrl, '_blank');
            else showNotification('Dosya URL\'i bulunamadı', 'error');
        } else if (action === 'index') {
            const q = doc.dosyaNo || doc.evrakNo || '';
            const recordId = doc.matchedRecordId || '';
            const date = doc.belgeTarihi ? doc.belgeTarihi.toISOString().split('T')[0] : '';
            
            window.location.href = `indexing-detail.html?pdfId=${encodeURIComponent(doc.id)}&q=${encodeURIComponent(q)}&recordId=${encodeURIComponent(recordId)}&deliveryDate=${encodeURIComponent(date)}`;
        }
    }

    // ============================================================
    // 5. TAB, MOD VE UPLOAD YÖNETİMİ
    // ============================================================

    bindEvents() {
        // "Listele" Butonu
        const fetchBtn = document.getElementById('fetchNotificationsBtn');
        if (fetchBtn) {
            fetchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleFetchButton(); // Sync + Load
            });
        }

        // Tab Değişimi
        document.querySelectorAll('.notification-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchNotificationsTab(btn.getAttribute('data-target'));
            });
        });

        // Mod Değişimi (ETEBS / Upload)
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchMode(e.target.dataset.mode);
            });
        });
    }

    switchNotificationsTab(targetId) {
        document.querySelectorAll('.notification-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-target') === targetId);
        });
        document.querySelectorAll('.notification-tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === targetId);
        });
    }

    switchMode(mode) {
        this.currentMode = mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        
        const etebsContent = document.getElementById('etebs-content');
        const uploadContent = document.getElementById('upload-content');

        if(etebsContent) etebsContent.style.display = mode === 'etebs' ? 'block' : 'none';
        if(uploadContent) uploadContent.style.display = mode === 'upload' ? 'block' : 'none';
    }

    // --- MANUEL UPLOAD MODU ---
    
    setupUploadMode() {
        const input = document.getElementById('bulkFiles');
        const btn = document.getElementById('bulkFilesButton');
        const info = document.getElementById('bulkFilesInfo');

        if (!input || input.dataset.bound) return;

        if (btn) {
            btn.addEventListener('click', () => input.click());
            // Drag & Drop
            btn.addEventListener('dragover', (e) => { e.preventDefault(); btn.style.backgroundColor = '#f0f7ff'; });
            btn.addEventListener('dragleave', (e) => { e.preventDefault(); btn.style.backgroundColor = ''; });
            btn.addEventListener('drop', (e) => {
                e.preventDefault();
                btn.style.backgroundColor = '';
                if(e.dataTransfer.files.length) {
                    input.files = e.dataTransfer.files;
                    input.dispatchEvent(new Event('change'));
                }
            });
        }

        input.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;

            if(info) {
                info.textContent = `${files.length} dosya yükleniyor...`;
                info.style.display = 'block';
            }
            
            const user = authService.auth.currentUser;
            if(!user) {
                showNotification('Oturum açmanız gerekiyor.', 'error');
                return;
            }

            for (const file of files) {
                await this._uploadSingleFile(file, user.uid);
            }

            if(info) info.textContent = 'Yükleme tamamlandı. Listeyi yenileyebilirsiniz.';
            input.value = '';
            showNotification('Dosyalar yüklendi. ETEBS sekmesinden listeyi yenileyin.', 'success');
        });

        input.dataset.bound = "true";
    }

    async _uploadSingleFile(file, userId) {
        try {
            const timestamp = Date.now();
            const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const path = `users/${userId}/unindexed_pdfs/${timestamp}_${cleanName}`;
            
            const storage = getStorage();
            const storageRef = ref(storage, path);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);

            const evrakNo = file.name.split('.')[0].replace(/[^a-zA-Z0-9]/g, '');

            await addDoc(collection(firebaseServices.db, 'unindexed_pdfs'), {
                evrakNo: evrakNo,
                fileName: file.name,
                belgeAciklamasi: 'Manuel Yükleme',
                fileUrl: url,
                filePath: path,
                fileSize: file.size,
                uploadedAt: new Date(),
                belgeTarihi: new Date(),
                userId: userId,
                source: 'manual',
                status: 'pending',
                matched: false
            });

        } catch (e) {
            console.error('Dosya yükleme hatası:', e);
            showNotification(`${file.name} yüklenemedi.`, 'error');
        }
    }
}

// Global Erişim
window.ETEBSManager = ETEBSManager;