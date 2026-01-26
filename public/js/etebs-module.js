// js/etebs-module.js
// ETEBS Tebligatları Yönetim Modülü
import { etebsService, etebsAutoProcessor, firebaseServices, authService, ipRecordsService } from '../firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc, addDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ref, getDownloadURL, uploadBytes, getStorage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import './simple-loading.js';


// EKLENECEK KISIM (import'ların hemen altına):
// Storage referansını initialize et
let storage = null;

// Firebase storage'ı initialize et
async function initializeStorage() {
    if (!storage) {
        const { app } = await import('../firebase-config.js');
        storage = getStorage(app);
    }
    return storage;
}
// Notification helper - mevcut sisteminizi kullanır
function showNotification(message, type = 'info') {
    // Önce mevcut showNotification fonksiyonunu kontrol et
    if (window.showNotification && typeof window.showNotification === 'function') {
        window.showNotification(message, type);
    } else {
        // Fallback: basit console log veya alert
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        // Alternatif: basit DOM notification
        const notificationContainer = document.querySelector('.notification-container');
        if (notificationContainer) {
            const notification = document.createElement('div');
            notification.className = `notification notification-${type}`;
            notification.textContent = message;
            notification.style.cssText = `
                background: ${type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#d1ecf1'};
                color: ${type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#0c5460'};
                padding: 12px 20px;
                margin: 5px 0;
                border-radius: 8px;
                border: 1px solid ${type === 'success' ? '#c3e6cb' : type === 'error' ? '#f5c6cb' : '#bee5eb'};
            `;
            notificationContainer.appendChild(notification);
            
            // 5 saniye sonra kaldır
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 5000);
        } else {
            // Son çare: alert
            alert(`${type.toUpperCase()}: ${message}`);
        }
    }
}

export class ETEBSManager {
constructor() {
    this.currentMode = 'etebs';
    this.notifications = [];
    this.filteredNotifications = [];
    this.isLoading = false;
    this.isInitialized = false;
    this._listLoadingShownAt = 0;
    this.bindEvents();
    this.bindTabEvents();
}

// Tarihi input[type="date"] için yyyy-MM-dd formatına çevirir
toYMD(raw) {
    if (!raw) return '';
    let d = raw;

    // Firestore Timestamp
    if (d && typeof d.toDate === 'function') d = d.toDate();
    // {seconds: ...} gibi objeler
    else if (d && d.seconds) d = new Date(d.seconds * 1000);

    if (!(d instanceof Date)) d = new Date(d);
    if (isNaN(d.getTime())) return '';

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}


// public/js/etebs-module.js

async uploadDocumentsToFirebase(documents, userId, evrakNo, sourceType = 'etebs') {
    const uploadResults = [];
    
    // Storage servisini başlat
    await initializeStorage();

    for (const doc of documents) {
        try {
            const timestamp = Date.now();
            // Dosya ismini temizle
            const cleanFileName = doc.fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
            const storagePath = `users/${userId}/unindexed_pdfs/${timestamp}_${cleanFileName}`;
            
            // Storage Referansı (DÜZELTİLDİ)
            // 'storage' değişkeni initializeStorage() ile set edilen değişkendir.
            const storageRef = ref(storage, storagePath);
            
            // Dosyayı Yükle (DÜZELTİLDİ)
            const snapshot = await uploadBytes(storageRef, doc.file);
            
            // URL Al (DÜZELTİLDİ)
            const downloadURL = await getDownloadURL(storageRef);

            // Firestore için veri hazırla
            const docData = {
                evrakNo: doc.evrakNo || evrakNo,
                belgeAciklamasi: doc.belgeAciklamasi || 'Manuel Yükleme',
                fileName: doc.fileName,
                fileUrl: downloadURL,
                filePath: storagePath,
                fileSize: doc.file.size,
                
                // Tarih Bilgileri
                uploadedAt: new Date(), // Timestamp olarak kaydedilir
                belgeTarihi: new Date(), // Manuel yüklemede belge tarihi şimdiki zaman olsun
                
                userId: userId,
                
                // ✅ ÖNEMLİ: Kaynak bilgisi (manual veya etebs)
                source: sourceType,
                
                status: 'pending',
                matched: false,
                downloadSuccess: true
            };

            // Firestore'a kaydet (DÜZELTİLDİ)
            const docRef = await addDoc(collection(firebaseServices.db, 'unindexed_pdfs'), docData);
            
            uploadResults.push({
                success: true,
                id: docRef.id,
                ...docData
            });

        } catch (error) {
            console.error('Yükleme hatası:', error);
            uploadResults.push({
                success: false,
                fileName: doc.fileName,
                error: error.message
            });
        }
    }

    console.log('📤 Yükleme bitti, liste yenileniyor...');
    
    // Listeyi yenile (Sessiz mod olmadan, yani loading göstererek)
    await this.fetchNotifications(false); 
    
    showNotification(`${documents.length} belge havuza eklendi.`, 'success');

    return uploadResults;
}

// ===== indexNotification fonksiyonu (Sadece Firebase'e bakar) =====
async indexNotification(token, notification) {
    try {
        showNotification('Evrak indeksleme sayfasına yönlendiriliyor...', 'info');
        
        // 1. Kayıtlı (unindexed_pdfs) var mı?
        let unindexedDoc = await this.findUnindexedDocument(notification.evrakNo);
        
        if (!unindexedDoc) {
             // 2. etebs_documents (yedek) var mı?
             let etebsDoc = await this.findETEBSDocument(notification.evrakNo);
             if (etebsDoc) {
                // Kopyala ve yönlendir
                unindexedDoc = await this.copyToUnindexedPdfs(etebsDoc.data);
             }
        }
        
        if (unindexedDoc) {
            showNotification('Evrak bulundu. İndeksleme sayfasına yönlendiriliyor...', 'success');
            const pdfId = unindexedDoc.id;

            // Dosya no (Kayıt Ara’da otomatik yazılacak)
            const q = notification.dosyaNo || notification.evrakNo || '';

            // Eşleşen kayıt id (seçili kayıt otomatik set edilecek)
            const recordId = notification.matchedRecordId || '';

            // Tebliğ tarihi (date input için yyyy-MM-dd)
            const deliveryDate = this.toYMD(notification.tebligTarihi || notification.belgeTarihi || notification.uploadedAt);

            setTimeout(() => {
                window.location.href =
                    `indexing-detail.html?pdfId=${encodeURIComponent(pdfId)}` +
                    `&q=${encodeURIComponent(q)}` +
                    `&recordId=${encodeURIComponent(recordId)}` +
                    `&deliveryDate=${encodeURIComponent(deliveryDate)}`;
            }, 500);

            return;
        }
        else {
             // 3. Hiçbir yerde yoksa, BATCH işleminde indirilemediğini varsay.
            showNotification('Bu evrak sistemde kayıtlı değil. Batch işleminde indirme başarısız olmuş olabilir.', 'error');
            return;
        }

    } catch (error) {
        console.error('Index error:', error);
        showNotification('İndeksleme sırasında hata oluştu.', 'error');
    }
}

// ===== showNotificationPDF fonksiyonu (Sadece Firebase'e bakar) =====
async showNotificationPDF(token, notification) {
    try {
        showNotification("📄 PDF aranıyor...", "info");

        // 1. Unindexed_pdfs koleksiyonunda kaydı ara
        let docData = await this.findUnindexedDocument(notification.evrakNo);
        if (!docData) {
            // 2. etebs_documents koleksiyonunda kaydı ara
            docData = await this.findETEBSDocument(notification.evrakNo);
        }

        if (docData && docData.data.fileUrl) {
             // 3. Yerel kopya bulunduysa doğrudan URL'den aç
            await this.openPDFFromFirestore(docData);
            return;
        }
        
        // 4. Kayıt bulunamadıysa, BATCH işleminin başarısız olduğunu varsay.
        showNotification("PDF bulunamadı. Belge indirme hakkı tek seferlik olduğu için tekrar indirme yapılamaz.", "error");

    } catch (error) {
        console.error("Show PDF error:", error);
        showNotification("PDF açılırken hata oluştu.", "error");
    }
}

async handleNotificationAction(action, notification) {
    const tokenInput = document.getElementById('etebsTokenInput');
    if (!tokenInput) return;

    const token = tokenInput.value.trim();
    
    switch (action) {
        case 'index':
            await this.indexNotification(token, notification);
            break;
        case 'show':
            await this.showNotificationPDF(token, notification);
            break;
        case 'preview':
            await this.previewNotification(token, notification);
            break;
    }
}

bindTabEvents() {
    try {
        // Notifications tab switching (bulk-indexing-page.html ile uyumlu)
        document.querySelectorAll('.notification-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = btn.getAttribute('data-target');
                if (targetId) this.switchNotificationsTab(targetId);
            });
        });
        console.log("✅ Tab events bound successfully");
    } catch (error) {
        console.error('❌ Error binding tab events:', error);
    }
}

// 3. Tab switching
switchNotificationsTab(targetId) {
    try {
        // Update tab buttons
        document.querySelectorAll('.notification-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-target') === targetId);
        });

        // Update tab panes
        document.querySelectorAll('.notification-tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === targetId);
        });

        console.log(`✅ Switched to ${targetId}`);
    } catch (error) {
        console.error('❌ Error switching notifications tab:', error);
    }
}

bindEvents() {
        try {
            // Mode switching
            document.querySelectorAll('.mode-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.switchMode(e.target.closest('.mode-btn').dataset.mode);
                });
            });

            // Token fetch
            const fetchBtn = document.getElementById('fetchNotificationsBtn');
            if (fetchBtn) {
                // DÜZELTME: Event objesinin isSilent yerine geçmesini engellemek için arrow function kullanıyoruz
                fetchBtn.addEventListener('click', async (e) => {
                e.preventDefault();

                const tokenInput = document.getElementById('etebsTokenInput');
                if (tokenInput && tokenInput.value.trim()) {
                    localStorage.setItem('etebs_token', tokenInput.value.trim());
                }

                // ✅ 1) HEMEN göster (daha fetch başlamadan)
                if (window.SimpleLoadingController?.show) {
                    window.SimpleLoadingController.show({
                    text: 'ETEBS evrakları yükleniyor',
                    subtext: 'Listeler hazırlanıyor...'
                    });

                    // ✅ 2) Tarayıcıya 1 frame “paint” şansı ver
                    await new Promise(requestAnimationFrame);
                }

                await this.fetchNotifications(false, true);
                });

            }

            // Refresh notifications
            const refreshBtn = document.getElementById('refreshNotificationsBtn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.refreshNotifications());
            }

            // Filter change
            const filterSelect = document.getElementById('dosyaTuruFilter');
            if (filterSelect) {
                filterSelect.addEventListener('change', (e) => this.filterNotifications(e.target.value));
            }

            // Token input validation
            const tokenInput = document.getElementById('etebsTokenInput');
            if (tokenInput) {
                tokenInput.addEventListener('input', (e) => this.validateTokenInput(e.target.value));
            }

            // Tab switching integration with existing system
            document.querySelectorAll('[data-tab="bulk-indexing-pane"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    // Update badge when ETEBS tab is opened
                    this.updateTabBadge();
                });
            });

        } catch (error) {
            console.error('Error binding ETEBS events:', error);
        }
    }

switchMode(mode) {
    this.currentMode = mode;
    
    try {
        // Update button states
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Show/hide content
        const etebsMode = document.getElementById('etebs-content');
        const uploadMode = document.getElementById('upload-content');
        
        if (etebsMode && uploadMode) {
            etebsMode.style.display = mode === 'etebs' ? 'block' : 'none';
            uploadMode.style.display = mode === 'upload' ? 'block' : 'none';
        }

        // Yeni ekleme: Upload mode aktif olduğunda BulkIndexingModule'ü aktive et
        if (mode === 'upload') {
            this.activateUploadMode();
        } else {
            this.deactivateUploadMode();
        }

        // Update tab badge based on mode
        this.updateTabBadge();

    } catch (error) {
        console.error('Error switching mode:', error);
    }
}

// public/js/etebs-module.js

activateUploadMode() {
    try {
        const bulkFilesInput = document.getElementById('bulkFiles');
        const bulkFilesButton = document.getElementById('bulkFilesButton'); // ✅ Görsel Alan
        const bulkFilesInfo = document.getElementById('bulkFilesInfo');
        
        // 1. GİZLİ INPUT ELEMENTİNİ HAZIRLA
        if (bulkFilesInput) {
            // Eski event listener'ları temizlemek için klonluyoruz
            const newInput = bulkFilesInput.cloneNode(true);
            bulkFilesInput.parentNode.replaceChild(newInput, bulkFilesInput);
            
            // Dosya seçilince çalışacak kod
            newInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files);
                if (files.length === 0) return;

                // Bilgi metnini güncelle
                if (bulkFilesInfo) {
                    bulkFilesInfo.textContent = `${files.length} dosya işleniyor...`;
                    bulkFilesInfo.style.display = 'block';
                }

                const userId = authService.auth.currentUser?.uid;
                if (!userId) {
                    showNotification('Oturum açmanız gerekiyor.', 'error');
                    return;
                }

                // Dosyaları hazırlama
                const documents = files.map(file => ({
                    file: file,
                    fileName: file.name,
                    evrakNo: file.name.split('.')[0].replace(/[^a-zA-Z0-9]/g, ''),
                    belgeAciklamasi: 'Manuel Yükleme'
                }));

                // Yüklemeyi başlat
                showNotification('Yükleme başladı, lütfen bekleyin...', 'info');
                
                // Butonu geçici olarak pasif yapalım
                const currentButton = document.getElementById('bulkFilesButton');
                if(currentButton) currentButton.style.opacity = '0.5';

                // ✅ TEK VE DOĞRU ÇAĞRI:
                await this.uploadDocumentsToFirebase(documents, userId, 'MANUEL_NO', 'manual');
                
                // Temizlik
                newInput.value = '';
                if(currentButton) currentButton.style.opacity = '1';
                if (bulkFilesInfo) bulkFilesInfo.textContent = 'Yükleme tamamlandı.';
            });
        }

        // 2. GÖRSEL ALAN (BUTTON) TIKLAMASINI VE SÜRÜKLE-BIRAK'I BAĞLA
        if (bulkFilesButton) {
            // Eski event listener'ları temizlemek için klonluyoruz
            const newButton = bulkFilesButton.cloneNode(true);
            bulkFilesButton.parentNode.replaceChild(newButton, bulkFilesButton);

            // ✅ TIKLAMA OLAYI: Görsele tıklanınca gizli inputu aç
            newButton.addEventListener('click', () => {
                const input = document.getElementById('bulkFiles');
                if (input) input.click();
            });

            // ✅ SÜRÜKLE-BIRAK (DRAG & DROP) OLAYLARI
            newButton.addEventListener('dragover', (e) => {
                e.preventDefault();
                newButton.style.borderColor = '#1e3c72'; // Sürüklerken kenarlık rengi değişsin
                newButton.style.backgroundColor = '#f0f7ff';
            });

            newButton.addEventListener('dragleave', () => {
                newButton.style.borderColor = ''; // Eski haline dön
                newButton.style.backgroundColor = '';
            });

            newButton.addEventListener('drop', (e) => {
                e.preventDefault();
                newButton.style.borderColor = '';
                newButton.style.backgroundColor = '';

                if (e.dataTransfer.files.length > 0) {
                    const input = document.getElementById('bulkFiles');
                    if (input) {
                        input.files = e.dataTransfer.files;
                        // Dosyalar atılınca 'change' olayını manuel tetikle
                        input.dispatchEvent(new Event('change'));
                    }
                }
            });
        }
        
        console.log('✅ Upload mode (Entegre) aktif edildi');
    } catch (error) {
        console.error('Upload mode hatası:', error);
    }
}

deactivateUploadMode() {
    try {
        // Upload mode'u deaktif et, ama dosyaları silme
        console.log('Upload mode deaktif edildi');
    } catch (error) {
        console.error('Upload mode deaktif edilirken hata:', error);
    }
}
// 🔄 GÜNCELLENECEK FONKSİYON (public/js/etebs-module.js)

updateTabBadge() {
  try {
    const badge = document.querySelector('.tab-badge') || document.getElementById('totalBadge');

    if (badge) {
      const list = Array.isArray(this.notifications) ? this.notifications : [];
      const count = list.filter(n => String(n?.status || '').toLowerCase() !== 'indexed').length;

      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  } catch (error) {
    console.error('❌ Error updating tab badge:', error);
  }
}


    async loadSavedToken() {
        try {
            const currentUser = authService.getCurrentUser();
            if (!currentUser) return;

            const tokenResult = await etebsService.getToken(currentUser.uid);
            if (tokenResult.success) {
                const tokenInput = document.getElementById('etebsTokenInput');
                if (tokenInput) {
                    tokenInput.value = tokenResult.data.token;
                    this.showTokenStatus('success', 'Kaydedilmiş token yüklendi');
                }
            }
        } catch (error) {
            console.log('No saved token found or error loading token:', error);
        }
    }

    validateTokenInput(token) {
        try {
            const validation = etebsService.validateToken(token);
            const input = document.getElementById('etebsTokenInput');
            
            if (!input) return;
            
            if (token.length === 0) {
                input.style.borderColor = '#e1e8ed';
                return;
            }
            
            if (validation.valid) {
                input.style.borderColor = '#27ae60';
            } else {
                input.style.borderColor = '#e74c3c';
            }
        } catch (error) {
            console.error('Error validating token:', error);
        }
    }

    async fetchNotifications(isSilent = false, triggerServerSync = false) {

        if (this.isLoading) return;

        const token = localStorage.getItem('etebs_token');
        const user = authService?.auth?.currentUser;

        this.setLoading(true);
        if (!isSilent && window.SimpleLoadingController?.show) {
        window.SimpleLoadingController.show({
            text: 'ETEBS evrakları yükleniyor',
            subtext: 'Lütfen bekleyin...'
        });
        await new Promise(requestAnimationFrame);
        }

        if (!isSilent) this.updateStatusMessage('Veriler yükleniyor...');
        // ✅ Hemen göster (liste/DB beklemeden)
        if (!isSilent && window.SimpleLoadingController?.show) {
        this._listLoadingShownAt = performance.now();
        window.SimpleLoadingController.show({
            text: 'ETEBS evrakları yükleniyor',
            subtext: 'Listeler hazırlanıyor, lütfen bekleyin...'
        });

        // ✅ Tarayıcıya 1 frame paint şansı ver ki animasyon hemen görünsün
        await new Promise(requestAnimationFrame);
        }

        // UI Temizliği
        this.notifications = [];
        this.filteredNotifications = [];
        this.displayNotifications();

        try {
        // ADIM 1: Token varsa backend tetikle (fire-and-forget)
            if (triggerServerSync && token && user) {
                if (!isSilent) this.updateStatusMessage('Sunucu ile senkronize ediliyor...');
                try {
                    // --- ORTAM BELİRLEME (DİNAMİK) ---
                    // firebase-config.js dosyasındaki mantığı buraya uyguluyoruz
                    const hostname = window.location.hostname;
                    const isTestEnv = (
                        hostname === "localhost" || 
                        hostname === "127.0.0.1" || 
                        hostname.includes("ip-manager-production-aab4b") ||
                        hostname.includes("github.io")
                    );

                    // Ortama göre Proje ID seç
                    const projectId = isTestEnv ? "ip-manager-production-aab4b" : "ipgate-31bd2";
                    const region = 'europe-west1';
                    
                    // URL oluştur
                    const functionUrl = `https://${region}-${projectId}.cloudfunctions.net/etebsProxyV2`;

                    console.log(`🚀 Algılanan Ortam: ${isTestEnv ? 'TEST' : 'CANLI (PROD)'}`);
                    console.log(`🔗 Hedef URL: ${functionUrl}`);

                    // İstek at (Fetch)
                    fetch(functionUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            action: 'CHECK_LIST_ONLY',
                            token: token,
                            userId: user.uid
                        })
                    })
                    .then(response => {
                         if (!response.ok) {
                            console.warn(`Arka plan sync sunucu hatası: ${response.status}`);
                        } else {
                            console.log("Arka plan sync isteği başarıyla gönderildi.");
                        }
                    })
                    .catch(e => console.warn("Arka plan sync ağ hatası:", e));

                } catch (e) { console.warn("Backend tetikleme atlandı:", e); }
            }

            // ADIM 2: Veritabanından son durumu çek ve göster
            if (!isSilent) this.updateStatusMessage('Listeleniyor...');
            
            await new Promise((r) => setTimeout(r, 200));

            const dbRecords = await etebsService.getRecentUnindexedDocuments(50);

            // ✅ GÜNCELLEME: Kayıt olsun veya olmasın listeyi her zaman güncelle
            this.notifications = dbRecords || [];
            this.filteredNotifications = dbRecords || [];

            // Marka eşleştirmelerini çalıştır
            if (this.notifications.length > 0) {
                try {
                    if (typeof this.runBrandMatchingIfAvailable === 'function') {
                        await this.runBrandMatchingIfAvailable();
                    } else if (typeof this.matchWithIPRecords === 'function') {
                        await this.matchWithIPRecords();
                    }
                } catch (e) { console.warn('Brand matching hatası:', e); }
            }

            // İstatistikleri ve Görünümü Güncelle
            this.updateStatistics();
            this.displayNotifications();
            
            // ✅ ÖNEMLİ: Bölümü her zaman göster (Boş olsa bile)
            this.showNotificationsSection();

            if (dbRecords && dbRecords.length > 0) {
                if (!isSilent) this.showSuccess(`Veritabanından ${dbRecords.length} evrak listelendi.`);
            } else {
                if (!isSilent) this.showInfo("Henüz listelenecek evrak bulunamadı.");
                // hideNotificationsSection() ARTIK ÇAĞRILMIYOR
            }

        } catch (error) {
            console.error('Liste Hatası:', error);
            if (!isSilent) this.showError('Liste alınırken hata oluştu: ' + (error?.message || error));
            } finally {
            this.setLoading(false);

            // ✅ En az 250ms görünsün (çok hızlı işlemlerde “gözükmedi” hissini engeller)
            if (!isSilent && window.SimpleLoadingController?.hide) {
                const elapsed = performance.now() - (this._listLoadingShownAt || 0);
                const delay = Math.max(0, 250 - elapsed);
                setTimeout(() => window.SimpleLoadingController.hide(), delay);
            }
        }

    }

    async matchWithIPRecords() {
    console.log("🔍 ETEBS Eşleştirme Motoru Başlatılıyor...");
    
    // 1. Portföy verilerinin yüklü olduğundan emin ol
    // Eğer PortfolioDataManager yüklü değilse yükle veya bulk-upload-manager'dan al
    const allRecords = await ipRecordsService.getAllRecords();
    const records = allRecords.success ? allRecords.data : [];

    if (records.length === 0) {
        console.warn("⚠️ Eşleştirme için portföy kaydı bulunamadı.");
        return;
    }

    // 2. Mevcut bildirimleri tara ve eşleştir
    this.notifications = this.notifications.map(notification => {
        // Zaten eşleşmişse atla
        if (notification.matched) return notification;

        // dosyaNo veya applicationNo üzerinden ara
        const searchKey = notification.dosyaNo || notification.evrakNo;
        if (!searchKey) return notification;

        // RecordMatcher'ı kullan (Sınıfın global veya import edildiğini varsayıyoruz)
        const matcher = new RecordMatcher();
        const matchResult = matcher.findMatch(searchKey, records);

        if (matchResult) {
            console.log(`✅ ETEBS Anlık Eşleşme: ${searchKey} -> ${matchResult.record.title}`);
            return {
                ...notification,
                matched: true,
                matchedRecordId: matchResult.record.id,
                matchedRecordDisplay: matcher.getDisplayLabel(matchResult.record)
            };
        }

        return notification;
    });

    console.log("✅ Eşleştirme işlemi tamamlandı.");
}

    async refreshNotifications() {
        const tokenInput = document.getElementById('etebsTokenInput');
        if (tokenInput && tokenInput.value.trim()) {
            await this.fetchNotifications();
        }
    }

    filterNotifications(dosyaTuru) {
        try {
            if (dosyaTuru) {
                this.filteredNotifications = this.notifications.filter(n => n.dosyaTuru === dosyaTuru);
            } else {
                this.filteredNotifications = [...this.notifications];
            }
            
            this.displayNotifications();
            this.updateStatistics();
        } catch (error) {
            console.error('Error filtering notifications:', error);
        }
    }
// 5. GÜNCEL: Otomatik tab switching fonksiyonu (bulk-indexing-page.html ile uyumlu)
// Beklenen HTML:
// - buton:  .notification-tab-btn  + data-target="matched-notifications-tab" / "unmatched-notifications-tab"
// - panel:  .notification-tab-pane + id="matched-notifications-tab" / "unmatched-notifications-tab"
autoSwitchTab(matchedCount, unmatchedCount) {
    try {
        console.log(`🔄 autoSwitchTab başladı: matched=${matchedCount}, unmatched=${unmatchedCount}`);

        const activeTab = document.querySelector('.notification-tab-btn.active');
        if (!activeTab) {
            console.log("⚠️ Aktif tab bulunamadı");
            return;
        }

        const currentTarget = activeTab.getAttribute('data-target');
        console.log(`📋 Şu anki tab (data-target): ${currentTarget}`);

        // Eğer aktif tab boş ama diğer tab doluysa otomatik geçir
        if (currentTarget === 'matched-notifications-tab' && matchedCount === 0 && unmatchedCount > 0) {
            console.log("🔄 Matched tab boş, unmatched'e geçiliyor");
            this.switchNotificationsTab('unmatched-notifications-tab');
        } else if (currentTarget === 'unmatched-notifications-tab' && unmatchedCount === 0 && matchedCount > 0) {
            console.log("🔄 Unmatched tab boş, matched'e geçiliyor");
            this.switchNotificationsTab('matched-notifications-tab');
        }

        console.log("✅ autoSwitchTab tamamlandı");
    } catch (error) {
        console.error('❌ Error in auto tab switch:', error);
    }
}

    displayNotifications() {
    // peş peşe çağrılınca timer çakışmasın
    if (this._displayNotificationsTimer) {
        clearTimeout(this._displayNotificationsTimer);
        this._displayNotificationsTimer = null;
    }

    const total = Array.isArray(this.filteredNotifications) ? this.filteredNotifications.length : 0;
    const canUseLoader = !!window.SimpleLoadingController?.show;

    if (canUseLoader && total > 0) {
        this._listLoadingShownAt = performance.now();
        window.SimpleLoadingController.show({
        text: 'Listeler hazırlanıyor',
        subtext: 'Eşleşen / Eşleşmeyen / İndekslenen listeleri güncelleniyor...'
        });
    }

    // Loader'ın show class'ı (10ms) eklenebilsin diye 30ms sonra render
    this._displayNotificationsTimer = setTimeout(() => {
        try {
        const matchedList = document.getElementById('matchedNotificationsList');
        const unmatchedList = document.getElementById('unmatchedNotificationsList');
        const indexedList = document.getElementById('indexedNotificationsList');

        if (!matchedList || !unmatchedList || !indexedList) return;

        const indexedNotifications = this.filteredNotifications.filter(n => n.status === 'indexed');
        const remainingNotifications = this.filteredNotifications.filter(n => n.status !== 'indexed');

        const matchedNotifications = remainingNotifications.filter(n =>
            n.matched === true || (n.matchedRecordId && n.matchedRecordId !== "")
        );

        const unmatchedNotifications = remainingNotifications.filter(n =>
            !n.matched && (!n.matchedRecordId || n.matchedRecordId === "")
        );

        this.renderNotificationsList(matchedList, matchedNotifications, 'matched');
        this.renderNotificationsList(unmatchedList, unmatchedNotifications, 'unmatched');
        this.renderNotificationsList(indexedList, indexedNotifications, 'indexed');

        const updateBadge = (id, count) => {
            const el = document.getElementById(id);
            if (el) el.textContent = count;
        };
        updateBadge('matchedTabBadge', matchedNotifications.length);
        updateBadge('unmatchedTabBadge', unmatchedNotifications.length);
        updateBadge('indexedTabBadge', indexedNotifications.length);

        this.autoSwitchTab(matchedNotifications.length, unmatchedNotifications.length);

        } catch (e) {
        console.error('Error displaying notifications:', e);
        } finally {
        this._displayNotificationsTimer = null;

        // en az 250ms görünsün ki kullanıcı fark etsin
        if (canUseLoader && window.SimpleLoadingController?.hide) {
            const elapsed = performance.now() - (this._listLoadingShownAt || 0);
            const delay = Math.max(0, 250 - elapsed);
            setTimeout(() => window.SimpleLoadingController.hide(), delay);
        }
        }
    }, 30);
    }


    // 6. renderNotificationsList fonksiyonunu güncelleyin (değişiklik yok ama kontrol için)
    renderNotificationsList(container, notifications, isMatched) {
        if (!container) return;

        if (notifications.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span>📋</span>
                    <p>Henüz ${isMatched ? 'eşleşen' : 'eşleşmeyen'} tebligat yok</p>
                </div>
            `;
            return;
        }

        container.innerHTML = notifications.map(notification => 
            this.createNotificationHTML(notification, isMatched)
        ).join('');

        // Bind action buttons
        container.querySelectorAll('.notification-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const action = e.target.closest('.notification-action-btn').dataset.action;
                const evrakNo = e.target.closest('.notification-action-btn').dataset.evrakNo;
                const notification = notifications.find(n => n.evrakNo === evrakNo);
                
                if (notification) {
                    this.handleNotificationAction(action, notification);
                }
            });
        });
    }

createNotificationHTML(notification, listType) {
    try {
        // 1. TARİH FORMATLAMA (DÜZELTİLMİŞ)
        let date = '-';
        const rawDate = notification.belgeTarihi || notification.uploadedAt;

        if (rawDate) {
            // Firebase Timestamp Nesnesi ise
            if (typeof rawDate.toDate === 'function') {
                date = rawDate.toDate().toLocaleDateString('tr-TR');
            } 
            // Saniyeli Obje ise
            else if (rawDate.seconds) {
                date = new Date(rawDate.seconds * 1000).toLocaleDateString('tr-TR');
            } 
            // String veya Date objesi ise
            else {
                const d = new Date(rawDate);
                if (!isNaN(d.getTime())) {
                    date = d.toLocaleDateString('tr-TR');
                }
            }
        }

        // 2. KAYNAK ROZETİ (MANUEL / ETEBS)
        const isManual = (notification.source === 'manual' || notification.source === 'MANUEL');
        
        const sourceBadge = isManual 
            ? '<span class="badge badge-warning mr-2" style="color:#fff; background-color: #f39c12; font-size: 0.75rem;">MANUEL</span>' 
            : '<span class="badge badge-info mr-2" style="background-color: #17a2b8; font-size: 0.75rem;">ETEBS</span>';


        // 3. LİSTE TİPİNE GÖRE STİL VE İÇERİK AYARLARI
        let cardClass = '';
        let iconClass = '';
        let statusBadge = '';
        let indexButton = '';

        // İndekslenenler
        if (listType === 'indexed') {
            cardClass = 'pdf-list-item matched'; // Yeşil stil
            iconClass = 'fas fa-check-double text-success';
            statusBadge = '<span class="match-status matched"><i class="fas fa-check"></i> İndekslendi</span>';
            
            // İndekslenenlerde düzenleme butonu pasif
            indexButton = `<button class="pdf-action-btn" disabled style="opacity:0.5; cursor:not-allowed;" title="Zaten İndekslendi"><i class="fas fa-check"></i></button>`;
        } 
        // Eşleşenler
        else if (listType === 'matched') {
            cardClass = 'pdf-list-item matched'; 
            iconClass = 'fas fa-file-contract text-success';
            
            const recordName = notification.matchedRecordDisplay || notification.matchedRecord?.title || 'Eşleşen Kayıt';
            statusBadge = `<span class="match-status matched" title="${recordName}"><i class="fas fa-link"></i> ${recordName}</span>`;
            
            // İndeksle butonu aktif
            indexButton = `<button class="pdf-action-btn btn-primary notification-action-btn" data-action="index" data-evrak-no="${notification.evrakNo}" title="İndeksle"><i class="fas fa-edit"></i></button>`;
        } 
        // Eşleşmeyenler
        else {
            cardClass = 'pdf-list-item unmatched'; // Kırmızı stil
            iconClass = 'fas fa-exclamation-circle text-danger';
            statusBadge = '<span class="match-status unmatched"><i class="fas fa-times"></i> Eşleşmedi</span>';
            
            // İndeksle butonu aktif
            indexButton = `<button class="pdf-action-btn btn-primary notification-action-btn" data-action="index" data-evrak-no="${notification.evrakNo}" title="İndeksle"><i class="fas fa-edit"></i></button>`;
        }

        // 4. HTML ÇIKTISI (KART TASARIMI)
        return `
            <div class="${cardClass}" data-evrak="${notification.evrakNo}">
                <div class="d-flex align-items-center" style="flex: 1;">
                    <div class="pdf-icon mr-3" style="font-size: 1.8rem; width: 40px; text-align: center;">
                        <i class="${iconClass}"></i>
                    </div>
                    
                    <div style="flex: 1;">
                        <div class="d-flex align-items-center mb-1">
                            ${sourceBadge}
                            <h6 class="pdf-name mb-0 text-dark font-weight-bold" style="font-size: 1rem;">
                                ${notification.belgeAciklamasi || notification.fileName || 'İsimsiz Belge'}
                            </h6>
                        </div>
                        <div class="text-muted small mb-1">
                            <i class="far fa-calendar-alt"></i> ${date} 
                            <span class="mx-1">•</span>
                            <strong>Evrak No:</strong> ${notification.evrakNo}
                            ${notification.dosyaNo ? `<span class="mx-1">•</span> <strong>Dosya:</strong> ${notification.dosyaNo}` : ''}
                        </div>
                        <div>${statusBadge}</div>
                    </div>
                </div>
                
                <div class="pdf-actions ml-3">
                    ${indexButton}
                    <button class="pdf-action-btn btn-success notification-action-btn" 
                        data-action="show" 
                        data-evrak-no="${notification.evrakNo}" 
                        title="Önizle / İndir">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('HTML oluşturma hatası:', error);
        return `<div class="alert alert-danger p-2 m-2">Hata: ${error.message}</div>`;
    }
}

async previewNotification(token, notification) {
    try {
        // Create a detailed preview modal or alert
        const details = `
📄 ETEBS Tebligat Detayları

🆔 Evrak No: ${notification.evrakNo}
📁 Dosya No: ${notification.dosyaNo}  
📋 Dosya Türü: ${notification.dosyaTuru}
📅 Tarih: ${new Date(notification.belgeTarihi).toLocaleDateString('tr-TR')}
📝 Açıklama: ${notification.belgeAciklamasi}

${notification.matched ? 
    `✅ Eşleşen Kayıt: ${notification.matchedRecord?.title || notification.matchedRecord?.applicationNumber}
🎯 Güven Oranı: ${notification.matchConfidence || 100}%` : 
    '❌ Eşleşen kayıt bulunamadı'
}

${notification.ilgiliVekil ? `👤 İlgili Vekil: ${notification.ilgiliVekil}` : ''}
${notification.tebellugeden ? `📨 Tebellüğ Eden: ${notification.tebellugeden}` : ''}
        `;
        
        alert(details.trim());
        
    } catch (error) {
        console.error('Preview error:', error);
        showNotification('Önizleme hatası', 'error');
    }
}

updateStatistics() {
    // Sayılar displayNotifications içinde güncelleniyor.
    // Sadece Tab Badge'i (Ana menüdeki kırmızı sayı) güncellemek yeterli.
    this.updateTabBadge();
}

showNotificationsSection() {
    try {
        console.log("👁️ showNotificationsSection başladı");
        
        const section = document.getElementById('notificationsSection');
        if (section) {
            section.style.display = 'block';
            console.log("✅ Notifications section gösterildi");
        } else {
            console.log("⚠️ notificationsSection elementi bulunamadı");
        }
    } catch (error) {
        console.error('❌ Error showing notifications section:', error);
    }
}

hideNotificationsSection() {
    try {
        console.log("🙈 hideNotificationsSection başladı");

        const section = document.getElementById('notificationsSection');
        if (section) {
            section.style.display = 'none';
            console.log("✅ Notifications section gizlendi");
        } else {
            console.log("⚠️ notificationsSection elementi bulunamadı");
        }
    } catch (error) {
        console.error('❌ Error hiding notifications section:', error);
    }
}


// --- UI helpers (bulk-indexing-page.html ile uyumlu) ---
setLoading(isLoading) {
    this.isLoading = !!isLoading;

    const fetchBtn = document.getElementById('fetchNotificationsBtn');
    const refreshBtn = document.getElementById('refreshNotificationsBtn');

    if (fetchBtn) fetchBtn.disabled = this.isLoading;
    if (refreshBtn) refreshBtn.disabled = this.isLoading;
}

updateStatusMessage(message) {
    // Eğer sayfada ayrı bir status alanı yoksa info toast göster
    this.showToast(message, 'info');
}

showToast(message, type = 'info') {
    try {
        showNotification(message, type);
    } catch (e) {
        console.log(`${type.toUpperCase()}: ${message}`);
    }
}

showSuccess(message) {
    this.showToast(message, 'success');
}

showInfo(message) {
    this.showToast(message, 'info');
}

showError(message) {
    this.showToast(message, 'error');
}

    showTokenStatus(type, message) {
        try {
            const statusEl = document.getElementById('tokenStatus');
            if (!statusEl) return;

            statusEl.className = `status-indicator status-${type}`;
            statusEl.style.display = 'flex';
            
            const icon = type === 'success' ? '✅' : 
                        type === 'error' ? '❌' : 
                        type === 'loading' ? '🔄' : 'ℹ️';
            
            statusEl.innerHTML = `<span>${icon}</span><span>${message}</span>`;
        } catch (error) {
            console.error('Error showing token status:', error);
        }
    }
async findETEBSDocument(evrakNo) {
    try {
        console.log("🔍 ETEBS documents'ta aranıyor:", evrakNo);
        
        const q = query(
            collection(firebaseServices.db, "etebs_documents"),
            where("evrakNo", "==", evrakNo)
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const docData = querySnapshot.docs[0].data();
            const docId = querySnapshot.docs[0].id;
            console.log("✅ ETEBS documents'ta bulundu:", docId);
            return { id: docId, data: docData };
        }
        
        console.log("❌ ETEBS documents'ta bulunamadı");
        return null;
    } catch (error) {
        console.error("ETEBS document arama hatası:", error);
        return null;
    }
}

async findUnindexedDocument(evrakNo) {
    try {
        console.log("🔍 Unindexed PDFs'te aranıyor:", evrakNo);
        
        const q = query(
            collection(firebaseServices.db, "unindexed_pdfs"),
            where("evrakNo", "==", evrakNo)
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const docData = querySnapshot.docs[0].data();
            const docId = querySnapshot.docs[0].id;
            console.log("✅ Unindexed PDFs'te bulundu:", docId);
            return { id: docId, data: docData };
        }
        
        console.log("❌ Unindexed PDFs'te bulunamadı");
        return null;
    } catch (error) {
        console.error("Unindexed document arama hatası:", error);
        return null;
    }
}

async openPDFFromFirestore(docInfo) {
    try {
        const docData = docInfo.data;
        
        // Önce fileUrl'i dene
        if (docData.fileUrl) {
            console.log("📂 File URL kullanılıyor:", docData.fileUrl);
            window.open(docData.fileUrl, "_blank");
            showNotification("PDF başarıyla açıldı", "success");
            return;
        }

        // Eğer fileUrl yoksa storage path'i dene
        if (docData.storagePath || docData.filePath) {
            const storagePath = docData.storagePath || docData.filePath;
            console.log("📂 Storage path kullanılıyor:", storagePath);
            
            const storageRef = ref(firebaseServices.storage, storagePath);
            const downloadURL = await getDownloadURL(storageRef);
            window.open(downloadURL, "_blank");
            showNotification("PDF başarıyla açıldı", "success");
            return;
        }

        showNotification("PDF dosya yolu bulunamadı.", "error");
    } catch (error) {
        console.error("PDF açma hatası:", error);
        showNotification("PDF açılırken hata oluştu.", "error");
    }
}

async copyToUnindexedPdfs(etebsDocData) {
    try {
        console.log("📋 ETEBS dokümanı unindexed_pdfs'e kopyalanıyor...");
        
        const newDocData = {
            ...etebsDocData,
            status: 'pending',
            copiedFromEtebs: true,
            copiedAt: new Date()
        };

        const docRef = await addDoc(collection(firebaseServices.db, 'unindexed_pdfs'), newDocData);
        
        console.log("✅ ETEBS dokümanı kopyalandı:", docRef.id);
        return { id: docRef.id, data: newDocData };
        
    } catch (error) {
        console.error("Kopyalama hatası:", error);
        showNotification("Doküman kopyalanamadı.", "error");
        return null;
    }
}
    // Public methods for external access
    getNotifications() {
        return this.notifications;
    }

    getFilteredNotifications() {
        return this.filteredNotifications;
    }

    getCurrentMode() {
        return this.currentMode;
    }

}

// Export for global access
window.ETEBSManager = ETEBSManager;

console.log('📁 ETEBS Module loaded successfully');