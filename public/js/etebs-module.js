// js/etebs-module.js
// ETEBS Tebligatları Yönetim Modülü

import { etebsService, etebsAutoProcessor, firebaseServices, authService } from '../firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ref, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';


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

    for (const doc of documents) {
        try {
            // Upload to Firebase Storage
            const storagePath = `etebs_documents/${userId}/${evrakNo}/${doc.fileName}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytesResumable(storageRef, doc.file);
            const downloadURL = await getDownloadURL(storageRef);

            // Save metadata to Firestore - HEM etebs_documents HEM DE unindexed_pdfs'e kaydet
            const docData = {
                evrakNo: doc.evrakNo,
                belgeAciklamasi: doc.belgeAciklamasi,
                fileName: doc.fileName,
                fileUrl: downloadURL,
                storagePath: storagePath,
                fileSize: doc.file.size,
                uploadedAt: serverTimestamp(),
                userId: userId,
                source: 'etebs',
                status: 'pending', // İndeksleme için
                extractedAppNumber: doc.evrakNo, // Evrak numarasını da uygulama numarası olarak kullan
                matchedRecordId: null,
                matchedRecordDisplay: null
            };

            // Eşleşme kontrolü yap
            try {
                const matchResult = await this.matchWithPortfolio(doc.evrakNo);
                if (matchResult.matched) {
                    docData.matchedRecordId = matchResult.record.id;
                    docData.matchedRecordDisplay = `${matchResult.record.title} - ${matchResult.record.applicationNumber}`;
                    console.log('✅ ETEBS Eşleştirme başarılı:', doc.fileName, '→', docData.matchedRecordDisplay);
                } else {
                    console.log('❌ ETEBS Eşleştirme başarısız:', doc.fileName, 'Evrak No:', doc.evrakNo);
                }
            } catch (matchError) {
                console.error('Eşleştirme hatası:', matchError);
            }

            // 1. etebs_documents koleksiyonuna kaydet (mevcut)
            const etebsDocRef = await addDoc(collection(db, 'etebs_documents'), docData);

            // 2. unindexed_pdfs koleksiyonuna da kaydet (YENİ - indeksleme sayfası için)
            const unindexedDocRef = await addDoc(collection(db, 'unindexed_pdfs'), docData);

            uploadResults.push({
                ...docData,
                id: etebsDocRef.id,
                unindexedPdfId: unindexedDocRef.id, // İndeksleme sayfası için
                success: true
            });

            console.log('📄 ETEBS Document uploaded:', {
                fileName: doc.fileName,
                etebsId: etebsDocRef.id,
                unindexedId: unindexedDocRef.id,
                matched: !!docData.matchedRecordId
            });

        } catch (error) {
            console.error(`Upload failed for ${doc.fileName}:`, error);
            uploadResults.push({
                fileName: doc.fileName,
                evrakNo: doc.evrakNo,
                success: false,
                error: error.message
            });
        }
    }

    return uploadResults;
}

// ===== 3. js/etebs-module.js'deki indexNotification fonksiyonunu güncelleyin =====

async indexNotification(token, notification) {
    try {
        showNotification('Evrak indiriliyor ve indeksleme sayfasına yönlendiriliyor...', 'info');
        // 🔎 Önce yerel kopya var mı kontrol et (unindexed_pdfs → yoksa etebs_documents)
            let unindexedDoc = await this.findUnindexedDocument(notification.evrakNo);
            if (unindexedDoc) {
            showNotification('Yerel kopya bulundu. İndeksleme sayfasına yönlendiriliyor...', 'success');
            setTimeout(() => window.open(`indexing-detail.html?pdfId=${unindexedDoc.id}`, '_blank'), 500);
            return;
            }

            let etebsDoc = await this.findETEBSDocument(notification.evrakNo);
            if (etebsDoc) {
            const newUnindexed = await this.copyToUnindexedPdfs(etebsDoc.data);
            if (newUnindexed) {
                showNotification('Yerel kopya indeksleme listesine eklendi. Yönlendiriliyor...', 'success');
                setTimeout(() => window.open(`indexing-detail.html?pdfId=${newUnindexed.id}`, '_blank'), 500);
                return;
            }
            }
        const downloadResult = await etebsService.downloadDocument(token, notification.evrakNo);

        if (downloadResult.success) {
            // Yeni indirilen dosya varsa unindexed_pdfs kaydından yönlendir
            if (downloadResult.data && downloadResult.data.length > 0 && downloadResult.data[0].unindexedPdfId) {
                const pdfId = downloadResult.data[0].unindexedPdfId;
                
                showNotification('Evrak indirildi. İndeksleme sayfasına yönlendiriliyor...', 'success');
                
                setTimeout(() => {
                    window.open(`indexing-detail.html?pdfId=${pdfId}`, '_blank');
                }, 1000);
                return;
            } else {
                showNotification('Evrak indirildi ancak indeksleme kaydı bulunamadı.', 'error');
                return;
            }
        }

        // ETEBS download başarısız olduysa ve sebep daha önce indirilmişse Firestore'dan bul
        if (
            downloadResult.success === false &&
            (
            downloadResult.errorCode === '005' || 
            (downloadResult.error && /daha önce indir(ilmiş|ildi)/i.test(downloadResult.error))
            )
        ) {
            console.log("📂 Daha önce indirilen evrak Firestore'dan bulunuyor...");

            const q = query(
                collection(db, "unindexed_pdfs"),
                where("evrakNo", "==", notification.evrakNo)
            );
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                showNotification('Bu evrak daha önce indirildi ama kaydı bulunamadı.', 'error');
                return;
            }

            const doc = querySnapshot.docs[0];
            const pdfId = doc.id;

            showNotification('Daha önce indirilen evrak bulundu. İndeksleme sayfasına yönlendiriliyor...', 'success');
            
            setTimeout(() => {
                window.open(`indexing-detail.html?pdfId=${pdfId}`, '_blank');
            }, 1000);
            return;
        }

        // Beklenmeyen durum
        showNotification(`İndirme hatası: ${downloadResult.error || 'Bilinmeyen hata'}`, 'error');
        
    } catch (error) {
        console.error('Index error:', error);
        showNotification('İndeksleme sırasında hata oluştu.', 'error');
    }
}

// ===== 4. js/etebs-module.js'deki showNotificationPDF fonksiyonunu güncelleyin =====
async showNotificationPDF(token, notification) {
    try {
        showNotification("📄 PDF aranıyor...", "info");

        const currentUser = authService.getCurrentUser();
        if (!currentUser) {
            showNotification("Kullanıcı girişi yapılmamış.", "error");
            return;
        }

        // 1️⃣ ETEBS'ten download etmeyi dene
        const downloadResult = await etebsService.downloadDocument(token, notification.evrakNo);
        console.log("Download result:", downloadResult);

        // 2️⃣ Eğer blob geldiyse göster
        if (downloadResult.success && downloadResult.pdfBlob) {
            const pdfUrl = URL.createObjectURL(downloadResult.pdfBlob);
            window.open(pdfUrl, "_blank");
            showNotification("PDF başarıyla açıldı", "success");
            return;
        }

        // 3️⃣ Eğer base64 geldiyse göster
        if (downloadResult.success && downloadResult.pdfData) {
            try {
                const binaryString = atob(downloadResult.pdfData);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const pdfBlob = new Blob([bytes], { type: "application/pdf" });
                const pdfUrl = URL.createObjectURL(pdfBlob);
                window.open(pdfUrl, "_blank");
                showNotification("PDF başarıyla açıldı", "success");
                return;
            } catch (conversionError) {
                console.error('PDF conversion error:', conversionError);
                showNotification('PDF dönüştürülemedi', 'error');
            }
        }

        // 4️⃣ Eğer "daha önce indirildi" cevabı döndüyse Firestore'dan bul
        if (
            downloadResult.success === false &&
            (
            downloadResult.errorCode === '005' || 
            (downloadResult.error && /daha önce indir(ilmiş|ildi)/i.test(downloadResult.error))
            )
        ) {
            console.log("📂 Evrak daha önce indirilmiş, Firestore'dan kontrol ediliyor...");

            // Önce etebs_documents koleksiyonundan ara
            let docData = await this.findETEBSDocument(notification.evrakNo);
            
            // Eğer etebs_documents'ta bulunamazsa unindexed_pdfs'te ara
            if (!docData) {
                docData = await this.findUnindexedDocument(notification.evrakNo);
            }

            if (!docData) {
                showNotification("Daha önce indirilen PDF kaydı bulunamadı.", "error");
                return;
            }

            // PDF'i aç
            await this.openPDFFromFirestore(docData);
            return;
        }

        // 5️⃣ Beklenmeyen durum
        showNotification("PDF açılamadı. Veri yapısı beklenmeyen formatta.", "error");
        console.error("Beklenmeyen download result:", downloadResult);

    } catch (error) {
        console.error("Show PDF error:", error);
        showNotification("PDF açılırken hata oluştu.", "error");
    }
}

// ===== 5. js/indexing-detail-module.js'i ETEBS parametrelerini destekleyecek şekilde güncelleyin =====
// init fonksiyonunu güncelleyin:
async init() {
    // URL parametrelerini kontrol et
    const urlParams = new URLSearchParams(window.location.search);
    const pdfId = urlParams.get('pdfId');
    const source = urlParams.get('source');
    const evrakNo = urlParams.get('evrakNo');

    if (pdfId) {
        // Normal PDF ID yöntemi
        this.setupEventListeners();
        await this.loadPdfData(pdfId);
        await this.loadRecordsAndTransactionTypes();
        this.displayPdf();
        this.findMatchingRecord();
    } else if (source === 'etebs' && evrakNo) {
        // ETEBS'ten gelen parametreler
        this.setupEventListeners();
        await this.loadETEBSData(urlParams);
        await this.loadRecordsAndTransactionTypes();
        this.displayPdf();
        this.findMatchingRecord();
    } else {
        showNotification('PDF ID veya ETEBS parametreleri bulunamadı.', 'error');
        window.close();
        return;
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
            
            if (bulkFilesInput) {
                bulkFilesInput.style.display = 'block';
            }
            
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

 async fetchNotifications() {
    console.log("✅ fetchNotifications başladı");
    const tokenInput = document.getElementById('etebsTokenInput');
    if (!tokenInput) return;

    const token = tokenInput.value.trim();
    console.log("🔑 Token:", token);

    if (!token) {
        this.showTokenStatus('error', 'Token giriniz');
        return;
    }

    const fetchBtn = document.getElementById('fetchNotificationsBtn');
    if (!fetchBtn) return;

    const originalText = fetchBtn.innerHTML;
    
    try {
        fetchBtn.innerHTML = '<span class="loading-spinner"></span><span>Yükleniyor...</span>';
        fetchBtn.disabled = true;
        
        this.showTokenStatus('loading', 'Tebligatlar çekiliyor...');

        const result = await etebsService.getDailyNotifications(token);
        console.log("📡 getDailyNotifications sonucu:", result);
        console.log("📋 Gelen Data Array:", result.data);

        const records = window.indexingModule && Array.isArray(window.indexingModule.allRecords)
            ? window.indexingModule.allRecords
            : [];

        // ✅ Tek seferde eşleştirme yap ve ata
        this.notifications = result.data.map(n => {
            const isMatched = records.some(r => r.applicationNumber === n.dosyaNo);
            return {
                ...n,
                matched: isMatched
            };
        });

        this.filteredNotifications = [...this.notifications];

        if (result.success) {
            console.log("📊 İşleme başlanıyor...");
            
            // 1. Token kaydetme
            try {
                const currentUser = authService.getCurrentUser();
                if (currentUser) {
                    await etebsService.saveToken(token, currentUser.uid);
                    console.log("✅ Token kaydedildi");
                }
            } catch (tokenError) {
                console.error("❌ Token kaydetme hatası:", tokenError);
            }
            
            // 2. Status gösterme
            try {
                this.showTokenStatus(
                    'success',
                    `${result.totalCount} tebligat alındı (${result.matchedCount} eşleşen, ${result.unmatchedCount} eşleşmeyen)`
                );
                console.log("✅ Token status gösterildi");
            } catch (statusError) {
                console.error("❌ Token status hatası:", statusError);
            }

            // 3. Notifications gösterme
            try {
                this.displayNotifications();
                console.log("✅ Notifications gösterildi");
            } catch (displayError) {
                console.error("❌ Display notifications hatası:", displayError);
            }

            // 4. İstatistikleri güncelleme
            try {
                this.updateStatistics();
                console.log("✅ İstatistikler güncellendi");
            } catch (statsError) {
                console.error("❌ İstatistik güncelleme hatası:", statsError);
            }

            // 5. Section'ı gösterme
            try {
                this.showNotificationsSection();
                console.log("✅ Notifications section gösterildi");
            } catch (sectionError) {
                console.error("❌ Show section hatası:", sectionError);
            }

            // 6. Tab badge güncelleme
            try {
                this.updateTabBadge();
                console.log("✅ Tab badge güncellendi");
            } catch (badgeError) {
                console.error("❌ Tab badge hatası:", badgeError);
            }

            // 7. Başarı notifikasyonu
            try {
                showNotification(`${result.totalCount} ETEBS tebligatı başarıyla alındı`, 'success');
                console.log("✅ Başarı notifikasyonu gösterildi");
            } catch (notifError) {
                console.error("❌ Notification hatası:", notifError);
            }

        } else {
            this.showTokenStatus('error', result.error);
            showNotification(`ETEBS Hatası: ${result.error}`, 'error');
        }

    } catch (error) {
        console.error('❌ Fetch notifications error:', error);
        console.error('❌ Error stack:', error.stack);
        this.showTokenStatus('error', 'Beklenmeyen bir hata oluştu');
        showNotification('ETEBS bağlantısında hata oluştu', 'error');
    } finally {
        if (fetchBtn) {
            fetchBtn.innerHTML = originalText;
            fetchBtn.disabled = false;
        }
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

async indexNotification(token, notification) {
    try {
        showNotification('Evrak indiriliyor ve indeksleme sayfasına yönlendiriliyor...', 'info');

        const downloadResult = await etebsService.downloadDocument(token, notification.evrakNo);

        if (downloadResult.success) {
            // Yeni indirilen dosya varsa unindexed_pdfs kaydından yönlendir
            if (downloadResult.data && downloadResult.data.length > 0 && downloadResult.data[0].unindexedPdfId) {
                const pdfId = downloadResult.data[0].unindexedPdfId;
                
                showNotification('Evrak indirildi. İndeksleme sayfasına yönlendiriliyor...', 'success');
                
                setTimeout(() => {
                    window.open(`indexing-detail.html?pdfId=${pdfId}`, '_blank');
                }, 1000);
                return;
            } else {
                showNotification('Evrak indirildi ancak indeksleme kaydı bulunamadı.', 'error');
                return;
            }
        }

        // ETEBS download başarısız olduysa ve sebep daha önce indirilmişse Firestore'dan bul
        if (
            downloadResult.success === false &&
            (
            downloadResult.errorCode === '005' || 
            (downloadResult.error && /daha önce indir(ilmiş|ildi)/i.test(downloadResult.error))
            )
        ) {
            console.log("📂 Daha önce indirilen evrak Firestore'dan bulunuyor...");

            // Önce unindexed_pdfs'te ara
            let unindexedDoc = await this.findUnindexedDocument(notification.evrakNo);
            
            if (unindexedDoc) {
                const pdfId = unindexedDoc.id;
                showNotification('Daha önce indirilen evrak bulundu. İndeksleme sayfasına yönlendiriliyor...', 'success');
                
                setTimeout(() => {
                    window.open(`indexing-detail.html?pdfId=${pdfId}`, '_blank');
                }, 1000);
                return;
            }

            // Eğer unindexed_pdfs'te yoksa etebs_documents'ta ara
            let etebsDoc = await this.findETEBSDocument(notification.evrakNo);
            
            if (etebsDoc) {
                // etebs_documents'ta bulundu, unindexed_pdfs'e kopyala
                const newUnindexedDoc = await this.copyToUnindexedPdfs(etebsDoc.data);
                
                if (newUnindexedDoc) {
                    showNotification('Evrak indeksleme listesine eklendi. İndeksleme sayfasına yönlendiriliyor...', 'success');
                    
                    setTimeout(() => {
                        window.open(`indexing-detail.html?pdfId=${newUnindexedDoc.id}`, '_blank');
                    }, 1000);
                    return;
                }
            }

            showNotification('Bu evrak daha önce indirildi ama kaydı bulunamadı.', 'error');
            return;
        }

        // Beklenmeyen durum
        showNotification(`İndirme hatası: ${downloadResult.error || 'Bilinmeyen hata'}`, 'error');
        
    } catch (error) {
        console.error('Index error:', error);
        showNotification('İndeksleme sırasında hata oluştu.', 'error');
    }
}

async showNotificationPDF(token, notification) {
    try {
        showNotification('PDF açılıyor...', 'info');
        
        const downloadResult = await etebsService.downloadDocument(token, notification.evrakNo);
        
        if (downloadResult.success) {
            console.log('Download result:', downloadResult); // Debug için
            
            // PDF'i yeni pencerede aç
            if (downloadResult.pdfBlob) {
                // Blob'dan URL oluştur
                const pdfUrl = URL.createObjectURL(downloadResult.pdfBlob);
                
                // Yeni pencerede aç
                const newWindow = window.open(pdfUrl, '_blank');
                if (newWindow) {
                    showNotification('PDF başarıyla açıldı', 'success');
                    
                    // Temizlik için bir süre sonra URL'yi iptal et
                    setTimeout(() => {
                        URL.revokeObjectURL(pdfUrl);
                    }, 60000); // 1 dakika sonra temizle
                } else {
                    showNotification('Popup engellenmiş olabilir. Tarayıcı ayarlarınızı kontrol edin.', 'warning');
                }
                
            } else if (downloadResult.pdfData) {
                // Base64 data ise Blob'a çevir
                try {
                    const binaryString = atob(downloadResult.pdfData);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
                    const pdfUrl = URL.createObjectURL(pdfBlob);
                    
                    const newWindow = window.open(pdfUrl, '_blank');
                    if (newWindow) {
                        showNotification('PDF başarıyla açıldı', 'success');
                        
                        setTimeout(() => {
                            URL.revokeObjectURL(pdfUrl);
                        }, 60000);
                    } else {
                        showNotification('Popup engellenmiş olabilir. Tarayıcı ayarlarınızı kontrol edin.', 'warning');
                    }
                } catch (conversionError) {
                    console.error('PDF conversion error:', conversionError);
                    showNotification('PDF dönüştürülemedi', 'error');
                }
                
            } else if (downloadResult.data && downloadResult.data.length > 0 && downloadResult.data[0].fileUrl) {
                // Firebase Storage URL'si varsa direkt aç
                const fileUrl = downloadResult.data[0].fileUrl;
                const newWindow = window.open(fileUrl, '_blank');
                if (newWindow) {
                    showNotification('PDF başarıyla açıldı', 'success');
                } else {
                    showNotification('Popup engellenmiş olabilir. Tarayıcı ayarlarınızı kontrol edin.', 'warning');
                }
                
            } else {
                showNotification('PDF açılamadı. Veri yapısı beklenen formatta değil.', 'error');
                console.error('Unexpected download result structure:', downloadResult);
            }
            
        } else {
            showNotification(`PDF açma hatası: ${downloadResult.error}`, 'error');
        }
        
    } catch (error) {
        console.error('Show PDF error:', error);
        showNotification('PDF açılırken hata oluştu', 'error');
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
        // Eski fonksiyonları da koruyoruz geriye dönük uyumluluk için
        case 'downloadAndIndex':
            await this.downloadAndIndexNotification(token, notification);
            break;
        case 'download':
            await this.downloadNotification(token, notification);
            break;
    }
}

    async downloadAndIndexNotification(token, notification) {
        try {
            showNotification('Evrak indiriliyor ve indeksleniyor...', 'info');
            
            // Download document
            const downloadResult = await etebsService.downloadDocument(token, notification.evrakNo);
            
            if (downloadResult.success) {
                // Auto-process the matched notification
                const currentUser = authService.getCurrentUser();
                if (!currentUser) {
                    showNotification('Kullanıcı girişi gerekli', 'error');
                    return;
                }

                const processResult = await etebsAutoProcessor.autoProcessMatched([notification], currentUser.uid);
                
                if (processResult[0]?.success) {
                    showNotification('Evrak başarıyla indekslendi!', 'success');
                    
                    // Update notification status
                    notification.processStatus = 'completed';
                    this.displayNotifications();
                } else {
                    showNotification(`İndeksleme hatası: ${processResult[0]?.error || 'Bilinmeyen hata'}`, 'error');
                }
            } else {
                showNotification(`İndirme hatası: ${downloadResult.error}`, 'error');
            }
            
        } catch (error) {
            console.error('Download and index error:', error);
            showNotification('Beklenmeyen bir hata oluştu', 'error');
        }
    }

    async downloadNotification(token, notification) {
        try {
            showNotification('Evrak indiriliyor...', 'info');
            
            const downloadResult = await etebsService.downloadDocument(token, notification.evrakNo);
            
            if (downloadResult.success) {
                // Redirect to indexing detail page for manual processing
                const queryParams = new URLSearchParams({
                    source: 'etebs',
                    evrakNo: notification.evrakNo,
                    dosyaNo: notification.dosyaNo,
                    description: notification.belgeAciklamasi,
                    dosyaTuru: notification.dosyaTuru
                });
                
                showNotification('Evrak indirildi. İndeksleme sayfasına yönlendiriliyor...', 'success');
                
                // Open in new tab
                setTimeout(() => {
                    window.open(`indexing-detail.html?${queryParams.toString()}`, '_blank');
                }, 1000);
                
            } else {
                showNotification(`İndirme hatası: ${downloadResult.error}`, 'error');
            }
            
        } catch (error) {
            console.error('Download error:', error);
            showNotification('İndirme sırasında hata oluştu', 'error');
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