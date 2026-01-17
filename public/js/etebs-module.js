// js/etebs-module.js
// ETEBS Tebligatları Yönetim Modülü
import { etebsService, etebsAutoProcessor, firebaseServices, authService } from '../firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc, addDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ref, getDownloadURL, uploadBytes, getStorage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

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
    this.isInitialized = false;
    this.bindEvents();
    this.bindTabEvents();
}

async uploadDocumentsToFirebase(documents, userId, evrakNo) {
    const uploadResults = [];
    
    // Storage'ı initialize et
    await initializeStorage();

    for (const doc of documents) {
        try {
            console.log('📁 Upload ediliyor:', doc.fileName, 'Evrak:', doc.evrakNo);

            // Firebase Storage'a yükle
            const storagePath = `etebs_documents/${userId}/${doc.evrakNo || evrakNo}/${doc.fileName}`;
            console.log('📂 Storage path:', storagePath);
            
            const storageRef = ref(storage, storagePath);
            
            if (!doc.file) {
                throw new Error('File objesi bulunamadı');
            }

            console.log('⬆️ Storage\'a yükleniyor...');
            await uploadBytes(storageRef, doc.file);
            
            console.log('🔗 Download URL alınıyor...');
            const downloadURL = await getDownloadURL(storageRef);
            console.log('✅ Download URL:', downloadURL);

            // Firestore metadata hazırla
            const docData = {
                evrakNo: doc.evrakNo || evrakNo,
                belgeAciklamasi: doc.belgeAciklamasi || 'ETEBS Belgesi',
                fileName: doc.fileName,
                fileUrl: downloadURL,
                filePath: storagePath,
                fileSize: doc.file.size,
                uploadedAt: new Date(),
                userId: userId,
                source: 'etebs',
                status: 'pending',
                extractedAppNumber: doc.evrakNo || evrakNo,
                matchedRecordId: null,
                matchedRecordDisplay: null
            };

            // Portfolio eşleştirmesi yap
            console.log('🔍 Portfolio eşleştirmesi yapılıyor...');
            try {
                const matchResult = await etebsService.matchWithPortfolio(doc.evrakNo || evrakNo);
                if (matchResult && matchResult.matched) {
                    docData.matchedRecordId = matchResult.record.id;
                    docData.matchedRecordDisplay = `${matchResult.record.title} - ${matchResult.record.applicationNumber}`;
                    console.log('✅ ETEBS Eşleştirme başarılı:', doc.fileName, '→', docData.matchedRecordDisplay);
                } else {
                    console.log('❌ ETEBS Eşleştirme başarısız:', doc.fileName, 'Evrak No:', doc.evrakNo);
                }
            } catch (matchError) {
                console.error('Eşleştirme hatası:', matchError);
            }

            // Firestore'a kaydet - HEM etebs_documents HEM DE unindexed_pdfs'e
            console.log('💾 Firestore\'a kaydediliyor...');
            
            // etebs_documents koleksiyonuna kaydet
            const etebsDocRef = await addDoc(collection(firebaseServices.db, 'etebs_documents'), docData);
            console.log('✅ etebs_documents\'a kaydedildi:', etebsDocRef.id);

            // unindexed_pdfs koleksiyonuna da kaydet (indeksleme için)
            const unindexedDocRef = await addDoc(collection(firebaseServices.db, 'unindexed_pdfs'), docData);
            console.log('✅ unindexed_pdfs\'e kaydedildi:', unindexedDocRef.id);

            uploadResults.push({
                ...docData,
                id: etebsDocRef.id,
                unindexedPdfId: unindexedDocRef.id,
                success: true
            });

            console.log('✅ Upload tamamlandı:', doc.fileName);

        } catch (error) {
            console.error(`❌ Upload failed for ${doc.fileName}:`, error);
            uploadResults.push({
                fileName: doc.fileName,
                evrakNo: doc.evrakNo || evrakNo,
                success: false,
                error: error.message
            });
        }
    }

    console.log('📤 uploadDocumentsToFirebase tamamlandı. Sonuçlar:', uploadResults);
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
            setTimeout(() => window.open(`indexing-detail.html?pdfId=${pdfId}`, '_blank'), 500);
            return;
        } else {
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

    // 2. YENİ: Tab event binding fonksiyonu ekleyin
bindTabEvents() {
    try {
        // Notifications tab switching
        document.querySelectorAll('.notifications-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchNotificationsTab(btn.getAttribute('data-notifications-tab'));
            });
        });
        console.log("✅ Tab events bound successfully");
    } catch (error) {
        console.error('❌ Error binding tab events:', error);
    }
}

    // 3. YENİ: Tab switching fonksiyonu ekleyin
switchNotificationsTab(tabName) {
    try {
        // Update tab buttons
        document.querySelectorAll('.notifications-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-notifications-tab') === tabName);
        });

        // Update tab content
        document.querySelectorAll('.notifications-tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === `${tabName}-notifications-tab`);
        });
        
        console.log(`✅ Switched to ${tabName} tab`);
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
                fetchBtn.addEventListener('click', this.fetchNotifications.bind(this));
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
        const etebsMode = document.getElementById('etebs-mode');
        const uploadMode = document.getElementById('upload-mode');
        
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
activateUploadMode() {
    try {
        // BulkIndexingModule'ün dosya yükleme event listener'larını aktif et
        if (window.indexingModule && typeof window.indexingModule.setupBulkUploadListeners === 'function') {
            // File input'u görünür yap
            const bulkFilesInput = document.getElementById('bulkFiles');
            const bulkFilesButton = document.getElementById('bulkFilesButton');
            const bulkFilesInfo = document.getElementById('bulkFilesInfo');
            if (bulkFilesInput) bulkFilesInput.style.display = 'none';
            const fileListSection = document.getElementById('fileListSection');
            if (fileListSection) fileListSection.style.display = 'block';
                        
            if (bulkFilesButton) {
                bulkFilesButton.style.display = 'block';
                // Event listener'ı yeniden bağla
                const newButton = bulkFilesButton.cloneNode(true);
                bulkFilesButton.parentNode.replaceChild(newButton, bulkFilesButton);
                
                newButton.addEventListener('click', () => {
                    if (bulkFilesInput) bulkFilesInput.click();
                });
                
                newButton.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    newButton.classList.add('drag-over');
                });
                
                newButton.addEventListener('dragleave', () => {
                    newButton.classList.remove('drag-over');
                });
                
                newButton.addEventListener('drop', (e) => {
                    e.preventDefault();
                    newButton.classList.remove('drag-over');
                    if (e.dataTransfer.files.length > 0) {
                        bulkFilesInput.files = e.dataTransfer.files;
                        bulkFilesInput.dispatchEvent(new Event('change'));
                    }
                });
            }
            
            if (bulkFilesInput) {
                // File change event listener'ı yeniden bağla
                const newInput = bulkFilesInput.cloneNode(true);
                bulkFilesInput.parentNode.replaceChild(newInput, bulkFilesInput);
                
                newInput.addEventListener('change', (e) => {
                    if (window.indexingModule && typeof window.indexingModule.handleFileSelect === 'function') {
                        window.indexingModule.handleFileSelect(e);
                    }
                    
                    // Info text'i güncelle
                    if (bulkFilesInfo) {
                        const fileCount = e.target.files.length;
                        bulkFilesInfo.textContent = fileCount > 0 ? 
                            `${fileCount} PDF dosyası seçildi.` : 
                            'Henüz PDF dosyası seçilmedi. Birden fazla PDF dosyası seçebilirsiniz.';
                    }
                });
            }
            
            console.log('✅ Upload mode aktif edildi');
        }
    } catch (error) {
        console.error('Upload mode aktif edilirken hata:', error);
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
updateTabBadge() {
    try {
        console.log("🔄 updateTabBadge başladı");
        
        const badge = document.querySelector('.tab-badge');
        if (!badge) {
            console.log("⚠️ Tab badge elementi bulunamadı");
            return;
        }

        if (this.currentMode === 'etebs') {
            badge.textContent = this.notifications.length || '0';
            console.log(`✅ ETEBS badge güncellendi: ${this.notifications.length}`);
        } else {
            // Get uploaded files count from existing bulk upload logic
            const uploadedFiles = document.querySelectorAll('#allFilesList .pdf-list-item');
            badge.textContent = uploadedFiles.length || '0';
            console.log(`✅ Upload badge güncellendi: ${uploadedFiles.length}`);
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

// etebs-module.js içindeki fetchNotifications fonksiyonunu güncelleyin
async fetchNotifications() {
    console.log("✅ fetchNotifications başladı");
    const tokenInput = document.getElementById('etebsTokenInput');
    if (!tokenInput) return;

    const token = tokenInput.value.trim();
    if (!token) {
        this.showTokenStatus('error', 'Token giriniz');
        return;
    }

    const fetchBtn = document.getElementById('fetchNotificationsBtn');
    const originalText = fetchBtn.innerHTML;
    
    try {
        fetchBtn.innerHTML = '<span class="loading-spinner"></span><span>Sorgulanıyor...</span>';
        fetchBtn.disabled = true;
        this.showTokenStatus('loading', 'Tebligat listesi alınıyor...');

        // ÖNEMLİ: getDailyNotifications fonksiyonuna "sadece liste" parametresi 
        // eklenmiş bir mod varsa onu kullanın veya timeout'u yönetin.
        const result = await etebsService.getDailyNotifications(token);

        if (result.success) {
            // Veri geldiğinde işlemleri yap
            this.notifications = result.data.map(n => {
                const records = window.indexingModule?.allRecords || [];
                const isMatched = records.some(r => r.applicationNumber === n.dosyaNo);
                return { ...n, matched: isMatched };
            });

            this.filteredNotifications = [...this.notifications];
            this.displayNotifications();
            this.updateStatistics();
            this.showNotificationsSection();
            this.updateTabBadge();
            
            showNotification(`${result.totalCount} tebligat bulundu.`, 'success');
        } else {
            // 504 veya Fetch hatası durumunda özel mesaj
            if (result.error?.includes('Failed to fetch') || result.error?.includes('timeout')) {
                this.showTokenStatus('error', 'Sunucu yanıt vermiyor (Zaman aşımı). Lütfen biraz bekleyip tekrar deneyin.');
                showNotification('İşlem çok uzun sürdüğü için kesildi. Liste kısmi olarak yüklenmiş olabilir.', 'warning');
            } else {
                this.showTokenStatus('error', result.error || 'Veri alınamadı');
            }
        }
    } catch (error) {
        console.error('❌ Fetch notifications error:', error);
        this.showTokenStatus('error', 'Bağlantı hatası oluştu');
    } finally {
        fetchBtn.innerHTML = originalText;
        fetchBtn.disabled = false;
    }
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
    // 5. YENİ: Otomatik tab switching fonksiyonu
autoSwitchTab(matchedCount, unmatchedCount) {
    try {
        console.log(`🔄 autoSwitchTab başladı: matched=${matchedCount}, unmatched=${unmatchedCount}`);
        
        const activeTab = document.querySelector('.notifications-tab-btn.active');
        if (!activeTab) {
            console.log("⚠️ Aktif tab bulunamadı");
            return;
        }

        const currentTab = activeTab.getAttribute('data-notifications-tab');
        console.log(`📋 Şu anki tab: ${currentTab}`);
        
        // If current tab is empty but other tab has items, switch automatically
        if (currentTab === 'matched' && matchedCount === 0 && unmatchedCount > 0) {
            console.log("🔄 Matched tab boş, unmatched'e geçiliyor");
            this.switchNotificationsTab('unmatched');
        } else if (currentTab === 'unmatched' && unmatchedCount === 0 && matchedCount > 0) {
            console.log("🔄 Unmatched tab boş, matched'e geçiliyor");
            this.switchNotificationsTab('matched');
        }
        
        console.log("✅ autoSwitchTab tamamlandı");
    } catch (error) {
        console.error('❌ Error in auto tab switch:', error);
    }
}

 displayNotifications() {
    try {
        const matchedList = document.getElementById('matchedNotificationsList');
        const unmatchedList = document.getElementById('unmatchedNotificationsList');
        
        if (!matchedList || !unmatchedList) {
            console.log("Liste DOM elementleri bulunamadı.");
            return;
        }

        const matchedNotifications = this.filteredNotifications.filter(n => n.matched);
        const unmatchedNotifications = this.filteredNotifications.filter(n => !n.matched);

        console.log("📋 matchedNotifications:", matchedNotifications);
        console.log("📋 unmatchedNotifications:", unmatchedNotifications);

        matchedList.setAttribute('data-type', 'matched');
        unmatchedList.setAttribute('data-type', 'unmatched');

        // Display matched notifications
        this.renderNotificationsList(matchedList, matchedNotifications, true);
        
        // Display unmatched notifications  
        this.renderNotificationsList(unmatchedList, unmatchedNotifications, false);

        const matchedTabBadge = document.getElementById('matchedTabBadge');
        const unmatchedTabBadge = document.getElementById('unmatchedTabBadge');

        if (matchedTabBadge) matchedTabBadge.textContent = matchedNotifications.length;
        if (unmatchedTabBadge) unmatchedTabBadge.textContent = unmatchedNotifications.length;

        this.autoSwitchTab(matchedNotifications.length, unmatchedNotifications.length);

    } catch (error) {
        console.error('Error displaying notifications:', error);
    }
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

createNotificationHTML(notification, isMatched) {
    try {
        const date = new Date(notification.belgeTarihi).toLocaleDateString('tr-TR');
        const konmaTarihi = new Date(notification.uygulamaKonmaTarihi).toLocaleDateString('tr-TR');

        return `
            <div class="notification-block" data-evrak="${notification.evrakNo}">
                <div><strong>Evrak No:</strong> ${notification.evrakNo}</div>
                <div><strong>Dosya No:</strong> ${notification.dosyaNo}</div>
                <div><strong>Tür:</strong> ${notification.dosyaTuru}</div>
                <div><strong>Belge Tarihi:</strong> ${date}</div>
                <div><strong>Konma Tarihi:</strong> ${konmaTarihi}</div>
                <div><strong>Açıklama:</strong> ${notification.belgeAciklamasi}</div>
                <div><strong>Durum:</strong> 
                    ${isMatched ? '<span class="status-matched">✔ Eşleşti</span>' : '<span class="status-unmatched">⚠ Eşleşmedi</span>'}
                </div>
                <div class="actions">
                    <button class="btn btn-primary btn-sm notification-action-btn"
                        data-action="index"
                        data-evrak-no="${notification.evrakNo}">
                        📝 İndeksle
                    </button>
                    <button class="btn btn-success btn-sm notification-action-btn"
                        data-action="show"
                        data-evrak-no="${notification.evrakNo}">
                        👁️ Göster
                    </button>
                    <button class="btn btn-secondary btn-sm notification-action-btn"
                        data-action="preview"
                        data-evrak-no="${notification.evrakNo}">
                        📋 Önizle
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error creating notification HTML:', error);
        return `
            <div class="notification-block error">
                <div><strong>Hata:</strong> Tebligat gösterilemiyor: ${error.message}</div>
            </div>
        `;
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
    try {
        console.log("📊 updateStatistics başladı");
        
        const total = this.filteredNotifications.length;
        const matched = this.filteredNotifications.filter(n => n.matched).length;
        const unmatched = total - matched;

        const totalCountEl = document.getElementById('totalCount');
        const matchedCountEl = document.getElementById('matchedCount');
        const unmatchedCountEl = document.getElementById('unmatchedCount');

        if (totalCountEl) {
            totalCountEl.textContent = total;
            console.log(`✅ Total count güncellendi: ${total}`);
        } else {
            console.log("⚠️ totalCountEl bulunamadı");
        }
        
        if (matchedCountEl) {
            matchedCountEl.textContent = matched;
            console.log(`✅ Matched count güncellendi: ${matched}`);
        } else {
            console.log("⚠️ matchedCountEl bulunamadı");
        }
        
        if (unmatchedCountEl) {
            unmatchedCountEl.textContent = unmatched;
            console.log(`✅ Unmatched count güncellendi: ${unmatched}`);
        } else {
            console.log("⚠️ unmatchedCountEl bulunamadı");
        }

        // Update tab badge
        this.updateTabBadge();
        
        console.log("✅ updateStatistics tamamlandı");
        
    } catch (error) {
        console.error('❌ Error updating statistics:', error);
    }
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

    // Method to integrate with existing bulk indexing module
  integrateWithBulkIndexing(bulkIndexingModule) {
    try {
        // BulkIndexingModule referansını sakla
        this.bulkIndexingModule = bulkIndexingModule;
        
        // Mode değiştiğinde upload işlevselliğini aktif/deaktif et
        if (this.currentMode === 'upload') {
            this.activateUploadMode();
        }
        
        // Dosya listesi değişikliklerini izle
        if (this.currentMode === 'upload' && bulkIndexingModule) {
            const observer = new MutationObserver(() => {
                if (this.currentMode === 'upload') {
                    this.updateTabBadge();
                }
            });

            const targetNode = document.getElementById('allFilesList');
            if (targetNode) {
                observer.observe(targetNode, { 
                    childList: true, 
                    subtree: true 
                });
            }
        }
    } catch (error) {
        console.error('Error integrating with bulk indexing:', error);
    }
}
}

// Export for global access
window.ETEBSManager = ETEBSManager;

console.log('📁 ETEBS Module loaded successfully');