// public/js/etebs-module.js

import { firebaseServices, authService, ipRecordsService } from '../firebase-config.js';
import { ref, getDownloadURL, uploadBytes, getStorage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { collection, query, where, getDocs, addDoc, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// --- Modüller ---
import { RecordMatcher } from './indexing/record-matcher.js';
import Pagination from './pagination.js';

// Notification Helper (Mevcut yapıya uyumlu)
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

        this.init();
    }

    async init() {
        // 1. Sayfa yüklendiğinde Badge sayısını güncelle
        await this.updateMainBadgeCount();
        
        // 2. Event Listener'ları kur
        this.bindEvents();

        // 3. Upload modunu hazırla (Sayfa yüklendiğinde elementler varsa bağla)
        this.setupUploadMode();
    }

    // ============================================================
    // 1. BADGE YÖNETİMİ
    // ============================================================
    
    async updateMainBadgeCount() {
        try {
            // Unindexed_pdfs tablosundaki TÜM 'pending' kayıtları say (User ID filtresi yok)
            const q = query(
                collection(firebaseServices.db, 'unindexed_pdfs'),
                where('status', '==', 'pending')
            );
            
            // Not: getCountFromServer daha performanslıdır ama SDK v9 gerektirir, 
            // garanti olsun diye getDocs kullanıyoruz (cache destekli).
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
    // 2. VERİ ÇEKME VE EŞLEŞTİRME (CORE LOGIC)
    // ============================================================

    async loadAndProcessDocuments() {
        // Loading Göster
        if (window.SimpleLoadingController) {
            window.SimpleLoadingController.show({ 
                text: 'Evraklar taranıyor...', 
                subtext: 'Portföy eşleştirmesi yapılıyor' 
            });
        }

        try {
            // A. Portföy Kayıtlarını Getir (Eşleştirme Referansı)
            const recordsResult = await ipRecordsService.getAllRecords({ source: 'server' });
            const portfolioRecords = recordsResult.success ? recordsResult.data : [];

            if (portfolioRecords.length === 0) {
                console.warn("Portföy boş veya çekilemedi.");
            }

            // B. Unindexed PDFs Verilerini Çek
            const colRef = collection(firebaseServices.db, 'unindexed_pdfs');
            
            // 1. Bekleyenler (Pending) - Hepsini çek
            const qPending = query(colRef, where('status', '==', 'pending'));
            
            // 2. İndekslenenler (Indexed) - Son 50 kayıt (Performans için limitli)
            const qIndexed = query(colRef, where('status', '==', 'indexed'), orderBy('uploadedAt', 'desc'), limit(50));

            const [snapPending, snapIndexed] = await Promise.all([
                getDocs(qPending),
                getDocs(qIndexed)
            ]);

            // C. Verileri Sıfırla ve İşle
            this.matchedDocs = [];
            this.unmatchedDocs = [];
            this.indexedDocs = [];

            // -- Pending Kayıtları İşle ve Eşleştir --
            snapPending.forEach(doc => {
                const data = doc.data();
                const docObj = this._normalizeDocData(doc.id, data);

                // Eşleştirme Mantığı
                this._processMatching(docObj, portfolioRecords);
            });

            // -- Indexed Kayıtları İşle --
            snapIndexed.forEach(doc => {
                const data = doc.data();
                this.indexedDocs.push(this._normalizeDocData(doc.id, data));
            });

            // D. UI Render
            this.renderAllTabs();
            
            // Badge'i tazele (Bekleyen sayısı değişmiş olabilir)
            this.updateMainBadgeCount(); 

        } catch (error) {
            console.error('Veri yükleme hatası:', error);
            showNotification('Evrak listesi alınamadı: ' + error.message, 'error');
        } finally {
            if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
        }
    }

    // Veriyi standart formata getir (Tarih düzeltme vb.)
    _normalizeDocData(id, data) {
        return {
            id: id,
            ...data,
            // Tarihleri JS Date objesine çevir
            uploadedAt: this._toDate(data.uploadedAt),
            belgeTarihi: this._toDate(data.belgeTarihi || data.uploadedAt)
        };
    }

    // Portföy ile Eşleştirme
    _processMatching(doc, portfolioRecords) {
        // Öncelik sırasına göre arama anahtarı belirle
        // ETEBS'ten 'dosyaNo' gelir, Bulk Upload'dan 'extractedAppNumber' gelebilir.
        const searchKey = doc.dosyaNo || doc.applicationNo || doc.extractedAppNumber || doc.evrakNo;

        if (searchKey && portfolioRecords.length > 0) {
            const match = this.matcher.findMatch(searchKey, portfolioRecords);
            
            if (match) {
                // EŞLEŞTİ
                doc.matched = true;
                doc.matchedRecordId = match.record.id;
                doc.matchedRecordDisplay = this.matcher.getDisplayLabel(match.record);
                doc.recordOwnerType = match.record.recordOwnerType || 'self';
                
                this.matchedDocs.push(doc);
            } else {
                // EŞLEŞMEDİ
                doc.matched = false;
                this.unmatchedDocs.push(doc);
            }
        } else {
            // Anahtar yoksa eşleşemez
            doc.matched = false;
            this.unmatchedDocs.push(doc);
        }
    }

    // Güvenli Tarih Çevirici
    _toDate(timestamp) {
        if (!timestamp) return null;
        if (typeof timestamp.toDate === 'function') return timestamp.toDate(); // Firestore Timestamp
        if (timestamp instanceof Date) return timestamp; // Zaten Date
        // String veya Number ise
        const d = new Date(timestamp);
        return isNaN(d.getTime()) ? null : d;
    }

    // ============================================================
    // 3. UI RENDER VE PAGINATION
    // ============================================================

    renderAllTabs() {
        // Tab Rozetlerini Güncelle
        this._updateTabBadge('matchedTabBadge', this.matchedDocs.length);
        this._updateTabBadge('unmatchedTabBadge', this.unmatchedDocs.length);
        this._updateTabBadge('indexedTabBadge', this.indexedDocs.length);

        // Listeleri Render Et (Pagination Kullanarak)
        // Sıralama: Yeniden eskiye
        const sortFn = (a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0);

        this.setupPagination('matched', this.matchedDocs.sort(sortFn), 'matchedNotificationsList');
        this.setupPagination('unmatched', this.unmatchedDocs.sort(sortFn), 'unmatchedNotificationsList');
        this.setupPagination('indexed', this.indexedDocs.sort(sortFn), 'indexedNotificationsList');

        // Akıllı Tab Geçişi
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
        
        // Eğer Eşleşenler tabındaysak ama veri yoksa, Eşleşmeyenler doluysa oraya geç
        if (currentTarget === 'matched-notifications-tab' && this.matchedDocs.length === 0 && this.unmatchedDocs.length > 0) {
            this.switchNotificationsTab('unmatched-notifications-tab');
        } 
        // Tam tersi
        else if (currentTarget === 'unmatched-notifications-tab' && this.unmatchedDocs.length === 0 && this.matchedDocs.length > 0) {
            this.switchNotificationsTab('matched-notifications-tab');
        }
    }

    setupPagination(type, dataList, containerId) {
        const paginationId = `${type}Pagination`;
        
        // Eski pagination varsa temizle (Basitçe yeniden oluşturuyoruz)
        if (this.paginations[type]) {
             // Pagination kütüphanesine göre destroy gerekebilir ama 
             // container ID aynı olduğu için üzerine yazacaktır.
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
        
        // İlk sayfa render (Pagination otomatik tetiklemiyorsa)
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

        // Buton Eventlerini Bağla (Inline onclick yerine)
        container.querySelectorAll('.notification-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this._handleItemAction(e, items));
        });
    }

    _createItemHTML(doc, type) {
        const dateStr = doc.uploadedAt ? doc.uploadedAt.toLocaleDateString('tr-TR') : '-';
        const isManual = (doc.source === 'manual' || doc.source === 'MANUEL');
        
        // Rozetler
        const sourceBadge = isManual 
            ? '<span class="badge badge-warning text-white mr-2">MANUEL</span>' 
            : '<span class="badge badge-info mr-2">ETEBS</span>';

        let statusHtml = '';
        let actionBtn = '';
        let itemClass = '';

        if (type === 'matched') {
            itemClass = 'matched';
            statusHtml = `<span class="text-success font-weight-bold"><i class="fas fa-link"></i> ${doc.matchedRecordDisplay || 'Eşleşti'}</span>`;
            // İndeksle Butonu (Aktif)
            actionBtn = `<button class="btn btn-primary btn-sm notification-action-btn" data-action="index" data-id="${doc.id}" title="İndeksle">
                            <i class="fas fa-edit"></i> İndeksle
                         </button>`;
        } else if (type === 'unmatched') {
            itemClass = 'unmatched';
            statusHtml = `<span class="text-danger"><i class="fas fa-times"></i> Eşleşmedi</span>`;
            // İndeksle Butonu (Aktif - Manuel seçim için)
            actionBtn = `<button class="btn btn-outline-primary btn-sm notification-action-btn" data-action="index" data-id="${doc.id}" title="Manuel İndeksle">
                            <i class="fas fa-edit"></i>
                         </button>`;
        } else {
            // Indexed
            statusHtml = `<span class="text-muted"><i class="fas fa-check-double"></i> İndekslendi</span>`;
            actionBtn = `<button class="btn btn-light btn-sm" disabled style="opacity:0.5"><i class="fas fa-check"></i></button>`;
        }

        return `
            <div class="pdf-list-item ${itemClass} p-3 mb-2 bg-white rounded border shadow-sm">
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
                            <strong>Dosya No:</strong> ${doc.dosyaNo || '-'}
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
        
        // Event bubbling durdur
        e.stopPropagation();

        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const doc = items.find(i => i.id === id);

        if (!doc) return;

        if (action === 'show') {
            if (doc.fileUrl) {
                window.open(doc.fileUrl, '_blank');
            } else {
                showNotification('Dosya URL\'i bulunamadı', 'error');
            }
        } else if (action === 'index') {
            // Parametreleri hazırla
            const q = doc.dosyaNo || doc.evrakNo || '';
            const recordId = doc.matchedRecordId || '';
            // Tebliğ tarihini (YYYY-MM-DD) formatında gönder
            let deliveryDate = '';
            if (doc.belgeTarihi) {
                deliveryDate = doc.belgeTarihi.toISOString().split('T')[0];
            } else if (doc.uploadedAt) {
                deliveryDate = doc.uploadedAt.toISOString().split('T')[0];
            }
            
            // Yönlendirme
            const url = `indexing-detail.html?pdfId=${encodeURIComponent(doc.id)}&q=${encodeURIComponent(q)}&recordId=${encodeURIComponent(recordId)}&deliveryDate=${encodeURIComponent(deliveryDate)}`;
            window.location.href = url;
        }
    }

    // ============================================================
    // 4. TAB, MOD VE UPLOAD YÖNETİMİ
    // ============================================================

    bindEvents() {
        // "Fetch / Yenile" butonu (Eğer varsa)
        const fetchBtn = document.getElementById('fetchNotificationsBtn');
        if (fetchBtn) {
            fetchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.loadAndProcessDocuments();
            });
        }

        // Tab Değişimi
        document.querySelectorAll('.notification-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = btn.getAttribute('data-target');
                this.switchNotificationsTab(targetId);
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
        
        // ETEBS moduna geçilince listeyi otomatik yenilemek isterseniz:
        // if (mode === 'etebs' && this.matchedDocs.length === 0) this.loadAndProcessDocuments();
    }

    // --- MANUEL UPLOAD MODU ---
    
    setupUploadMode() {
        const input = document.getElementById('bulkFiles');
        const btn = document.getElementById('bulkFilesButton');
        const info = document.getElementById('bulkFilesInfo');

        // Daha önce event listener eklendiyse tekrar ekleme
        if (!input || input.dataset.bound) return;

        // Buton Tıklaması -> Input Trigger
        if (btn) {
            btn.addEventListener('click', () => input.click());
            
            // Basit Drag & Drop Efekti
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

        // Dosya Seçimi
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

            // Döngü ile yükle
            for (const file of files) {
                await this._uploadSingleFile(file, user.uid);
            }

            if(info) info.textContent = 'Yükleme tamamlandı. Listeyi yenileyebilirsiniz.';
            input.value = ''; // Inputu temizle
            
            // Kullanıcıya bilgi ver
            showNotification('Dosyalar yüklendi. ETEBS sekmesinden listeyi yenileyin.', 'success');
        });

        // Flag koyarak tekrar bind edilmesini engelle
        input.dataset.bound = "true";
    }

    async _uploadSingleFile(file, userId) {
        try {
            const timestamp = Date.now();
            // Dosya adını güvenli hale getir
            const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const path = `users/${userId}/unindexed_pdfs/${timestamp}_${cleanName}`;
            
            // Storage Upload
            const storage = getStorage(); // firebase-config içinden de alınabilir
            const storageRef = ref(storage, path);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);

            // Firestore Record
            await addDoc(collection(firebaseServices.db, 'unindexed_pdfs'), {
                evrakNo: cleanName.split('.')[0], // Basitçe dosya adının uzantısız hali
                fileName: file.name,
                fileUrl: url,
                filePath: path,
                uploadedAt: new Date(),
                userId: userId,
                source: 'manual', // Kaynak: Manuel
                status: 'pending'
            });

        } catch (e) {
            console.error('Dosya yükleme hatası:', e);
            showNotification(`${file.name} yüklenemedi.`, 'error');
        }
    }
}

// Global Erişim (HTML onclick vb. için gerekirse)
window.ETEBSManager = ETEBSManager;

// Eğer modül olarak yükleniyorsa, sayfa açılışında otomatik başlatmak için:
// document.addEventListener('DOMContentLoaded', () => { new ETEBSManager(); });