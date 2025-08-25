// js/indexing-detail-module.js

// Firebase servisleri ve yardımcı fonksiyonları import et
import {
    authService,
    ipRecordsService,
    transactionTypeService,
    taskService,
    generateUUID,
    db,
    firebaseServices
} from '../firebase-config.js';

import { 
    collection, query, where, doc, getDoc, getDocs, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// utils.js'den yardımcı fonksiyonları import et
import {
    showNotification,
    addMonthsToDate,
    isWeekend,
    isHoliday,
    findNextWorkingDay,
    TURKEY_HOLIDAYS
} from '../utils.js';

// Constants
const UNINDEXED_PDFS_COLLECTION = 'unindexed_pdfs';

// Selcan'ın bilgileri
const SELCAN_UID = 'NLEZpWsYlKUCeq2bZlbHNV8XypL2';
const SELCAN_EMAIL = 'selcanakoglu@evrekapatent.com';

export class IndexingDetailModule {
    constructor() {
        this.currentUser = authService.getCurrentUser();
        if (!this.currentUser) {
            window.location.href = 'index.html';
            return;
        }

        this.pdfData = null;
        this.matchedRecord = null;
        this.allRecords = [];
        this.allTransactionTypes = [];
        this.currentTransactions = [];
        this.selectedTransactionId = null;

        // init() fonksiyonunu constructor'dan çağırıyoruz
        this.init();
    }

    async init() {
        // URL parametrelerinden PDF ID'sini ve ETEBS evrakNo'yu al
        const urlParams = new URLSearchParams(window.location.search);
        const pdfId = urlParams.get('pdfId');
        const evrakNo = urlParams.get('evrakNo'); // ETEBS evrakNo'yu da kontrol et

        if (pdfId) {
            // Öncelik 1: pdfId varsa, unindexed_pdfs koleksiyonundan yüklemeyi dene
            await this.loadPdfData(pdfId);
        } else if (evrakNo) {
            // Öncelik 2: Eğer pdfId yoksa ve evrakNo varsa, ETEBS parametreleriyle yüklemeyi dene
            // Bu fonksiyon, başarılı olursa this.pdfData'yı dolduracaktır.
            await this.loadETEBSData(urlParams);
        }

        // Eğer pdfData hala null ise (yani ne pdfId ne de ETEBS parametreleriyle PDF yüklenememişse)
        if (!this.pdfData) {
            showNotification('PDF ID veya ETEBS parametreleri bulunamadı. Lütfen geçerli bir belge seçin veya indirin.', 'error', 5000);
            console.error('URL parametrelerine göre yüklenecek bir PDF verisi bulunamadı.');
            // Kullanıcıyı otomatik olarak belge yükleme sayfasına geri yönlendir
            setTimeout(() => {
                window.location.href = 'bulk-indexing-page.html';
            }, 3000); // 3 saniye sonra yönlendir
            return; // Daha fazla işlem yapmadan fonksiyonu sonlandır
        }

        // Eğer pdfData başarıyla yüklendiyse (pdfId veya ETEBS parametreleri ile)
        this.setupEventListeners();
        await this.loadRecordsAndTransactionTypes();
        this.displayPdf();
        this.findMatchingRecord();
    }

    async loadPdfData(pdfId) {
        try {
            const docRef = doc(collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION), pdfId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                this.pdfData = { id: docSnap.id, ...docSnap.data() };
                console.log('PDF verisi yüklendi:', this.pdfData);
            } else {
                showNotification('PDF bulunamadı.', 'error');
                window.close();
            }
        } catch (error) {
            console.error('PDF verisi yüklenirken hata:', error);
            showNotification('PDF verisi yüklenirken hata oluştu.', 'error');
        }
    }
async loadETEBSData(urlParams) {
    try {
        const evrakNo = urlParams.get('evrakNo');
        const dosyaNo = urlParams.get('dosyaNo');
        const description = urlParams.get('description');
        const dosyaTuru = urlParams.get('dosyaTuru');

        console.log('ETEBS parametreleri:', { evrakNo, dosyaNo, description, dosyaTuru });

        // ETEBS'ten gelen verilerle sahte pdfData oluştur
        this.pdfData = {
            id: 'etebs-' + evrakNo,
            fileName: `${evrakNo}_${description || 'ETEBS_Document'}.pdf`,
            fileUrl: null, // PDF URL'si yoksa iframe'de hata gösterir
            source: 'etebs',
            evrakNo: evrakNo,
            dosyaNo: dosyaNo,
            description: description,
            dosyaTuru: dosyaTuru,
            uploadedAt: new Date(),
            extractedAppNumber: evrakNo // Eşleştirme için
        };

        // Gerçek PDF'i etebs_documents koleksiyonundan bul
        console.log('ETEBS PDF aranıyor, evrakNo:', evrakNo, 'userId:', this.currentUser.uid);
        
        const etebsDocsQuery = query(
            collection(firebaseServices.db, 'etebs_documents'),
            where('evrakNo', '==', evrakNo),
            where('userId', '==', this.currentUser.uid)
        );
        
        const etebsDocsSnapshot = await getDocs(etebsDocsQuery);
        
        if (!etebsDocsSnapshot.empty) {
            const etebsDoc = etebsDocsSnapshot.docs[0];
            const etebsData = etebsDoc.data();
            
            // PDF URL'sini güncelle
            this.pdfData.fileUrl = etebsData.fileUrl;
            this.pdfData.id = etebsDoc.id;
            this.pdfData.matchedRecordId = etebsData.matchedRecordId;
            this.pdfData.matchedRecordDisplay = etebsData.matchedRecordDisplay;
            
            console.log('✅ ETEBS PDF verisi bulundu:', this.pdfData);
        } else {
            console.log('❌ ETEBS PDF bulunamadı, unindexed_pdfs koleksiyonunda aranıyor...');
            
            // unindexed_pdfs koleksiyonunda da ara
            const unindexedQuery = query(
                collection(firebaseServices.db, 'unindexed_pdfs'),
                where('evrakNo', '==', evrakNo),
                where('userId', '==', this.currentUser.uid),
                where('source', '==', 'etebs')
            );
            
            const unindexedSnapshot = await getDocs(unindexedQuery);
            
            if (!unindexedSnapshot.empty) {
                const unindexedDoc = unindexedSnapshot.docs[0];
                const unindexedData = unindexedDoc.data();
                
                // PDF URL'sini güncelle
                this.pdfData.fileUrl = unindexedData.fileUrl;
                this.pdfData.id = unindexedDoc.id;
                this.pdfData.matchedRecordId = unindexedData.matchedRecordId;
                this.pdfData.matchedRecordDisplay = unindexedData.matchedRecordDisplay;
                
                console.log('✅ ETEBS PDF unindexed_pdfs\'te bulundu:', this.pdfData);
            } else {
                console.log('❌ ETEBS PDF hiçbir koleksiyonda bulunamadı');
                showNotification('PDF dosyası bulunamadı. Lütfen önce dosyayı indirin.', 'warning');
            }
        }
        
    } catch (error) {
        console.error('ETEBS verisi yüklenirken hata:', error);
        showNotification('ETEBS verisi yüklenirken hata oluştu: ' + error.message, 'error');
    }
}
    async loadRecordsAndTransactionTypes() {
        try {
            // IP kayıtlarını yükle
            const recordsResult = await ipRecordsService.getRecords();
            if (recordsResult.success) {
                this.allRecords = recordsResult.data;
            }

            // Transaction türlerini yükle
            const transactionTypesResult = await transactionTypeService.getTransactionTypes();
            if (transactionTypesResult.success) {
                this.allTransactionTypes = transactionTypesResult.data;
            } else {
                console.error('Transaction türleri yüklenemedi:', transactionTypesResult.error);
            }

        } catch (error) {
            console.error('Veriler yüklenirken hata:', error);
            showNotification('Veriler yüklenirken hata oluştu.', 'error');
        }
    }

    displayPdf() {
        // PDF başlığını güncelle
        const pdfTitle = document.getElementById('pdfTitle');
        if (pdfTitle) {
            pdfTitle.textContent = this.pdfData.fileName;
        }
        
        // PDF'i iframe'e yükle
        const pdfViewerIframe = document.getElementById('pdfViewer');
        if (pdfViewerIframe) {
            pdfViewerIframe.src = this.pdfData.fileUrl;
            
            // Hata durumunda alternatif göster
            pdfViewerIframe.onerror = () => {
                console.log('PDF yükleme hatası, alternatif gösteriliyor...');
                pdfViewerIframe.style.display = 'none';
                
                const altDiv = document.createElement('div');
                altDiv.style.cssText = 'padding: 40px; text-align: center; background: #f8f9fa; border-radius: 8px;';
                altDiv.innerHTML = `
                    <h4 style="color: #666; margin-bottom: 15px;">📄 PDF Görüntüleyici</h4>
                    <p style="color: #999; margin-bottom: 20px;">PDF dosyası güvenlik nedeniyle burada açılamıyor.</p>
                    <button class="btn btn-primary" onclick="window.open('${this.pdfData.fileUrl}', '_blank')" style="margin-right: 10px;">
                        🔗 Yeni Sekmede Aç
                    </button>
                    <button class="btn btn-secondary" onclick="window.indexingDetailModule.downloadPdf()">
                        📥 İndir
                    </button>
                `;
                pdfViewerIframe.parentNode.appendChild(altDiv);
            };
        }
        
        // Header butonlarını ayarla
        this.setupPdfViewerButtons();
    }

    setupPdfViewerButtons() {
    // PDF yükleme hatası varsa alternatif yöntem
    const pdfViewerIframe = document.getElementById('pdfViewer');
    if (pdfViewerIframe) {
        pdfViewerIframe.onerror = () => {
            console.log('PDF iframe hatası, alternatif yöntem deneniyor...');
            pdfViewerIframe.style.display = 'none';
            
            // Alternatif PDF görüntüleyici
            const altDiv = document.createElement('div');
            altDiv.style.cssText = 'padding: 20px; text-align: center; background: #f8f9fa;';
            altDiv.innerHTML = `
                <h4>PDF Görüntüleyici</h4>
                <p>PDF dosyası güvenlik nedeniyle iframe'de açılamıyor.</p>
                <button class="btn btn-primary" onclick="window.open('${this.pdfData.fileUrl}', '_blank')">
                    📄 PDF'yi Yeni Sekmede Aç
                </button>
            `;
            pdfViewerIframe.parentNode.insertBefore(altDiv, pdfViewerIframe);
        };
    }
    
    // İndir butonu
    const downloadBtn = document.getElementById('downloadPdfBtn');
    if (downloadBtn) {
        downloadBtn.onclick = () => this.downloadPdf();
    }
    
    // Yeni sekmede aç butonu
    const newTabBtn = document.getElementById('openNewTabBtn');
    if (newTabBtn) {
        newTabBtn.onclick = () => window.open(this.pdfData.fileUrl, '_blank');
    }
}

    downloadPdf() {
        if (!this.pdfData || !this.pdfData.fileUrl) return;
        
        const a = document.createElement('a');
        a.href = this.pdfData.fileUrl;
        a.download = this.pdfData.fileName;
        a.click();
    }

    findMatchingRecord() {
        // Otomatik eşleşme kontrolü
        if (this.pdfData.matchedRecordId) {
            this.matchedRecord = this.allRecords.find(r => r.id === this.pdfData.matchedRecordId);
            if (this.matchedRecord) {
                this.showMatchedRecord();
                return;
            }
        }

        // Eşleşme yoksa manuel arama göster
        this.showManualRecordSearch();
    }

    showMatchedRecord() {
        const matchedDiv = document.getElementById('matchedRecordDisplay');
        const manualDiv = document.getElementById('manualRecordSearch');
        
        matchedDiv.style.display = 'block';
        manualDiv.style.display = 'none';
        
        matchedDiv.innerHTML = `
            <div class="matched-record-card" style="border: 2px solid #28a745; border-radius: 10px; padding: 15px; background: #f8fff9;">
                <h4 style="color: #28a745; margin: 0 0 10px 0;">✅ Otomatik Eşleşen Kayıt</h4>
                <p><strong>Başlık:</strong> ${this.matchedRecord.title}</p>
                <p><strong>Uygulama No:</strong> ${this.matchedRecord.applicationNumber}</p>
                <p><strong>Müvekkil:</strong> ${this.matchedRecord.client || 'Belirtilmemiş'}</p>
                <button type="button" class="btn btn-secondary" onclick="window.indexingDetailModule.showManualRecordSearch()">
                    🔄 Farklı Kayıt Seç
                </button>
            </div>
        `;
        
        // Ana işlemleri yükle
        this.loadTransactionsForRecord();
    }

showManualRecordSearch() {
    const recordSearchInput = document.getElementById('recordSearchInput');
    if (recordSearchInput) recordSearchInput.style.display = 'block';
} // ✅ Bu kapanış parantezi eksikti

setupEventListeners() {
    // Manuel kayıt arama
    this.setupRecordSearch();
    
    // İndeksleme butonu
    const indexBtn = document.getElementById('indexPdfBtn') || document.getElementById('indexBtn');
    if (indexBtn) {
    indexBtn.addEventListener('click', () => this.handleIndexing());
    }
    }

setupRecordSearch() {
    const searchInput = document.getElementById('recordSearchInput');
    const resultsContainer = document.getElementById('searchResultsContainer');
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length < 2) {
                resultsContainer.style.display = 'none';
                return;
            }
            this.searchRecords(query);
        });

        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                resultsContainer.style.display = 'none';
            }, 200);
        });

        searchInput.addEventListener('focus', () => {
            if (searchInput.value.trim().length >= 2) {
                resultsContainer.style.display = 'block';
            }
        });
    }
}

searchRecords(query) {
    const resultsContainer = document.getElementById('searchResultsContainer');
    
    const filteredRecords = this.allRecords.filter(record => {
        // Null/undefined check for each property before calling toLowerCase()
        const title = record.title || '';
        const applicationNumber = record.applicationNumber || '';
        const client = record.client || '';
        
        return title.toLowerCase().includes(query.toLowerCase()) ||
               applicationNumber.toLowerCase().includes(query.toLowerCase()) ||
               client.toLowerCase().includes(query.toLowerCase());
    }).slice(0, 10);

    if (filteredRecords.length === 0) {
        resultsContainer.innerHTML = '<div class="search-result-item">Hiç sonuç bulunamadı</div>';
    } else {
        resultsContainer.innerHTML = filteredRecords.map(record => {
            // Brand image with null check
            const imageHtml = record.brandImageUrl ? 
                `<img src="${record.brandImageUrl}" class="record-brand-image" style="width: 35px; height: 35px; object-fit: contain; margin-right: 10px; border-radius: 4px; border: 1px solid #ddd; flex-shrink: 0;">` : 
                '<div style="width: 35px; height: 35px; margin-right: 10px; background: #f5f5f5; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 10px; flex-shrink: 0;">Logo</div>';

            // Safe property access with fallback values
            const title = record.title || 'Başlık yok';
            const applicationNumber = record.applicationNumber || 'Numara yok';
            const client = record.client || '';

            return `
                <div class="search-result-item" onclick="window.indexingDetailModule.selectRecord('${record.id}')" style="display: flex; align-items: center; padding: 12px; border-bottom: 1px solid #eee; cursor: pointer; transition: background-color 0.2s ease;">
                    ${imageHtml}
                    <div style="flex: 1; min-width: 0;">
                        <div class="search-result-title" style="font-weight: 500; margin-bottom: 4px; color: #333;">${title}</div>
                        <div class="search-result-details" style="font-size: 12px; color: #666;">
                            <span>${applicationNumber}</span>
                            ${client ? ` • <span>${client}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    resultsContainer.style.display = 'block';
}
    
    async selectRecord(recordId) {
        this.matchedRecord = this.allRecords.find(r => r.id === recordId);
        if (this.matchedRecord) {
            document.getElementById('searchResultsContainer').style.display = 'none';
            document.getElementById('recordSearchInput').value = '';
            await this.loadTransactionsForRecord();
        }
    }

    clearSelectedRecord() {
        this.matchedRecord = null;
        this.selectedTransactionId = null;
        this.currentTransactions = [];
        // selectedRecordDisplay ile ilgili kod kaldırıldı
        document.getElementById('transactionSection').style.display = 'none';
        document.getElementById('childTransactionInputs').style.display = 'none';
        this.checkFormCompleteness();
    }

    async loadTransactionsForRecord() {
        if (!this.matchedRecord) return;
        
        const transactionSection = document.getElementById('transactionSection');
        const transactionsList = document.getElementById('transactionsList');
        
        transactionSection.style.display = 'block';
        
        try {
            const transactionsResult = await ipRecordsService.getRecordTransactions(this.matchedRecord.id);
            
            if (!transactionsResult.success) {
                transactionsList.innerHTML = '<p class="text-muted">İşlemler yüklenirken hata oluştu.</p>';
                return;
            }
            
            this.currentTransactions = transactionsResult.data;
            
            if (!this.currentTransactions || this.currentTransactions.length === 0) {
                transactionsList.innerHTML = '<p class="text-muted">Bu kayıtta henüz işlem bulunmuyor.</p>';
                return;
            }

            // Sadece parent transaction'ları göster
            const parentTransactions = this.currentTransactions
                .filter(tx => tx.transactionHierarchy === 'parent' || !tx.transactionHierarchy)
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            if (parentTransactions.length === 0) {
                transactionsList.innerHTML = '<p class="text-muted">Bu kayıtta ana işlem bulunmuyor.</p>';
                return;
            }

            const transactionsHtml = parentTransactions.map(transaction => {
                const transactionType = this.allTransactionTypes.find(t => t.id === transaction.type);
                const typeName = transactionType ? (transactionType.alias || transactionType.name) : 'Bilinmeyen Tür';
                
                return `
                    <div class="transaction-item" onclick="window.indexingDetailModule.selectTransaction('${transaction.id}')">
                        <div class="transaction-main">${typeName}</div>
                        <div class="transaction-details">
                            ${transaction.description || 'Açıklama yok'}
                            ${transaction.deliveryDate ? ` • Tebliğ: ${transaction.deliveryDate}` : ''}
                        </div>
                        <div class="transaction-date">${new Date(transaction.timestamp).toLocaleDateString('tr-TR')}</div>
                    </div>
                `;
            }).join('');

            transactionsList.innerHTML = transactionsHtml;
            
        } catch (error) {
            console.error('Transactions yüklenirken hata:', error);
            transactionsList.innerHTML = '<p class="text-muted">İşlemler yüklenirken hata oluştu.</p>';
        }
    }

    selectTransaction(transactionId) {
        this.selectedTransactionId = transactionId;
        
        // Seçili işlemi görsel olarak vurgula
        document.querySelectorAll('.transaction-item').forEach(item => {
            item.classList.remove('selected');
        });
        event.target.closest('.transaction-item').classList.add('selected');
        
        // Alt işlem türlerini yükle
        this.loadChildTransactionTypes();
        
        // Alt işlem bölümünü göster
        document.getElementById('childTransactionInputs').style.display = 'block';
        
        this.checkFormCompleteness();
    }

    loadChildTransactionTypes() {
        if (!this.currentTransactions || !this.selectedTransactionId) return;

        const selectedTransaction = this.currentTransactions.find(t => t.id === this.selectedTransactionId);
        if (!selectedTransaction) return;

        const transactionType = this.allTransactionTypes.find(t => t.id === selectedTransaction.type);
        if (!transactionType || !transactionType.indexFile) {
            document.getElementById('childTransactionInputs').style.display = 'none';
            return;
        }

        const selectElement = document.getElementById('childTransactionType');
        selectElement.innerHTML = '<option value="" disabled selected>Alt işlem türü seçin...</option>';

        const childTypes = this.allTransactionTypes.filter(type => 
            type.hierarchy === 'child' &&  
            transactionType.indexFile && 
            Array.isArray(transactionType.indexFile) && 
            transactionType.indexFile.includes(type.id)
        ).sort((a, b) => (a.order || 999) - (b.order || 999));

        if (childTypes.length === 0) {
            const noOption = document.createElement('option');
            noOption.value = '';
            noOption.textContent = 'Bu ana işlem için alt işlem bulunamadı';
            noOption.disabled = true;
            selectElement.appendChild(noOption);
            document.getElementById('childTransactionInputs').style.display = 'none';
            return;
        }

        childTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.id;
            option.textContent = type.alias || type.name;
            selectElement.appendChild(option);
        });

        // ALT İŞLEM SEÇİM EVENT LISTENER'INI EKLE
        selectElement.addEventListener('change', () => {
            console.log('Alt işlem seçildi:', selectElement.value);
            this.checkFormCompleteness();
        });

        // Alt işlem bölümünü göster
        document.getElementById('childTransactionInputs').style.display = 'block';
    }

    // checkFormCompleteness() fonksiyonunu güncelle
    checkFormCompleteness() {
        const hasMatchedRecord = this.matchedRecord !== null;
        const hasSelectedTransaction = this.selectedTransactionId !== null;
        
        const childTransactionInputs = document.getElementById('childTransactionInputs');
        const childTransactionInputsVisible = childTransactionInputs && childTransactionInputs.style.display !== 'none';
        
        let hasSelectedChildType = true;
        if (childTransactionInputsVisible) {
            const childTypeSelect = document.getElementById('childTransactionType');
            if (childTypeSelect) {
                hasSelectedChildType = childTypeSelect.value !== '';
                console.log('Child type select value:', childTypeSelect.value);
            }
        }

        const deliveryInput = document.getElementById('deliveryDate');
        const hasDeliveryDate = !!(deliveryInput && deliveryInput.value && deliveryInput.value.trim() !== '');

        const canSubmit = hasMatchedRecord 
        && hasSelectedTransaction 
        && hasSelectedChildType 
        && hasDeliveryDate;
        
        const indexBtn      = document.getElementById('indexPdfBtn') || document.getElementById('indexBtn');
        const saveUpdateBtn = document.getElementById('saveUpdatePdfBtn');
        const globalSaveBtn = document.getElementById('btn-save-all');

        [indexBtn, saveUpdateBtn, globalSaveBtn].forEach(btn => {
            if (btn) {
                btn.disabled = !canSubmit;
                btn.classList.toggle('btn-disabled', !canSubmit);
            }
        });

        console.log('Buton durumları:', {
            indexBtn: !indexBtn?.disabled,
            saveUpdateBtn: !saveUpdateBtn?.disabled,
            globalSaveBtn: !globalSaveBtn?.disabled
        });

        console.log('Form completeness check:', {
            hasMatchedRecord,
            hasSelectedTransaction,
            childTransactionInputsVisible,
            hasSelectedChildType,
            canSubmit
        });
    }

// js/indexing-detail-module.js dosyasındaki handleIndexing fonksiyonunun tamamını bununla değiştirin.

async handleIndexing(opts = {}) { try {

    const noRedirect = !!opts.noRedirect;

    if (!this.matchedRecord || !this.selectedTransactionId) {
        showNotification('Gerekli seçimler yapılmadı.', 'error');
        return;
    }

    const indexBtn = document.getElementById('indexPdfBtn') || document.getElementById('indexBtn');
    if (indexBtn) indexBtn.disabled = true;
    showNotification('İndeksleme işlemi yapılıyor...', 'info');

    // Yeni tetikleme matrisi
    const taskTriggerMatrix = {
        "Yayına İtiraz": {
            "Portföy": ["50", "51"],
            "3. Taraf": ["51", "52"]
        },
        "Yayıma İtirazin Yeniden Incelenmesi": {
            "Portföy": ["32", "33", "34", "35"],
            "3. Taraf": ["31", "32", "35", "36"]
        }
    };

    try {
        const childTypeId = document.getElementById('childTransactionType').value;
        const deliveryDateStr = document.getElementById('deliveryDate').value;
        const deliveryDate = deliveryDateStr ? new Date(deliveryDateStr + 'T00:00:00') : null;

        let transactionIdToAssociateFiles = this.selectedTransactionId;
        let createdTaskId = null;

        // 1. Alt işlem varsa oluştur
        if (childTypeId) {
            console.log('Alt işlem oluşturuluyor...');

            const childTransactionType = this.allTransactionTypes.find(type => type.id === childTypeId);
            if (!childTransactionType) {
                throw new Error('Alt işlem türü bulunamadı: ' + childTypeId);
            }

            const childTransactionData = {
                type: childTypeId,
                description: childTransactionType.alias || childTransactionType.name,
                deliveryDate: deliveryDateStr || null,
                timestamp: deliveryDateStr ? new Date(deliveryDateStr) : new Date(),
                transactionHierarchy: 'child',
                parentId: this.selectedTransactionId
            };

            const childResult = await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, childTransactionData);
            if (!childResult.success) {
                throw new Error('Alt işlem kaydedilemedi: ' + childResult.error);
            }

            const childTransactionId = childResult.data?.id || childResult.id || childResult.data;
            if (!childTransactionId) {
                throw new Error('Alt işlem ID\'si alınamadı');
            }

            transactionIdToAssociateFiles = childTransactionId;
            console.log('Alt işlem başarıyla oluşturuldu, ID:', childTransactionId);

            // 2. İş tetikleme koşulunu belirle
            let shouldTriggerTask = false;

            // DEBUG: matchedRecord yapısını incele
            console.log('🔍 DEBUG - matchedRecord tüm yapısı:', this.matchedRecord);
            console.log('🔍 DEBUG - matchedRecord.recordOwnerType:', this.matchedRecord.recordOwnerType);
            console.log('🔍 DEBUG - Tüm anahtar/değer çiftleri:', Object.keys(this.matchedRecord).map(key => `${key}: ${this.matchedRecord[key]}`));

            // recordOwnerType'dan recordType'a mapping
            const recordOwnerType = this.matchedRecord.recordOwnerType;
            let recordType;

            if (recordOwnerType === 'self') {
                recordType = 'Portföy';
            } else if (recordOwnerType === 'third_party') {
                recordType = '3. Taraf';
            } else {
                // Fallback - bilinmeyen durumlar için varsayılan
                recordType = 'Portföy';
                console.warn('⚠️ Bilinmeyen recordOwnerType:', recordOwnerType, '- Varsayılan olarak Portföy kullanılıyor');
            }

            const parentTransaction = this.currentTransactions.find(t => t.id === this.selectedTransactionId);
            const parentTransactionTypeId = parentTransaction?.type; // ID'yi alıyoruz

            // ID bazlı tetikleme matrisi
            const taskTriggerMatrix = {
                "20": {  // Ana işlem tipi ID 20
                    "Portföy": ["50", "51"],
                    "3. Taraf": ["51", "52"]
                },
                "19": {  // Ana işlem tipi ID 19
                    "Portföy": ["32", "33", "34", "35"],
                    "3. Taraf": ["31", "32", "35", "36"]
                }
            };

            console.log('🔍 İş tetikleme kontrolü:', {
                parentTransactionTypeId,
                recordType,
                childTypeId,
                availableMatrixIds: Object.keys(taskTriggerMatrix)
            });

            // Ana işlem tipi ID'si matrise dahil mi kontrol et
            if (parentTransactionTypeId && taskTriggerMatrix[parentTransactionTypeId]) {
                // MATRIS KONTROLÜ VAR
                const allowedTriggers = taskTriggerMatrix[parentTransactionTypeId][recordType];
                console.log('🟢 allowedTriggers (matris):', allowedTriggers);
                
                // Matrisin kapsadığı tüm alt işlemleri topla
                const allMatrixChildTypes = Object.values(taskTriggerMatrix[parentTransactionTypeId]).flat();
                console.log('🔍 Matrisin kapsadığı tüm alt işlemler:', allMatrixChildTypes);
                
                // Bu alt işlem matrisin kapsamında mı?
                if (allMatrixChildTypes.includes(childTypeId)) {
                    // MATRİS KAPSIYORSA, SADECE MATRİS KONTROLÜ YAP
                    if (allowedTriggers && allowedTriggers.includes(childTypeId)) {
                        shouldTriggerTask = true;
                        console.log(`✅ Matris tetikleme koşulu sağlandı: Ana İşlem ID ${parentTransactionTypeId} - ${recordType} - Alt işlem ID ${childTypeId}`);
                    } else {
                        shouldTriggerTask = false;
                        console.log(`❌ Matris tetikleme koşulu başarısız: Ana İşlem ID ${parentTransactionTypeId} - ${recordType} - Alt işlem ID ${childTypeId} (Matris nihai karar)`);
                    }
                } else {
                    // MATRİS KAPSAMINDA DEĞİLSE, allowedChildTypes KONTROLÜ YAP
                    console.log(`🔍 Alt işlem ${childTypeId} matris kapsamında değil, allowedChildTypes kontrolüne geçiliyor`);
                    const parentTransactionType = this.allTransactionTypes.find(t => t.id === parentTransactionTypeId);
                    if (parentTransactionType && parentTransactionType.allowedChildTypes && parentTransactionType.allowedChildTypes.includes(childTypeId)) {
                        shouldTriggerTask = true;
                        console.log(`✅ allowedChildTypes tetikleme koşulu sağlandı: Ana İşlem ID ${parentTransactionTypeId} - Alt işlem ID ${childTypeId}`);
                    } else {
                        console.log(`ℹ️ allowedChildTypes tetikleme koşulu da yok: Ana İşlem ID ${parentTransactionTypeId} - Alt işlem ID ${childTypeId}`);
                    }
                }
            } else {
                // MATRİS YOKSA, allowedChildTypes KONTROLÜ YAP
                const parentTransactionType = this.allTransactionTypes.find(t => t.id === parentTransactionTypeId);
                if (parentTransactionType && parentTransactionType.allowedChildTypes && parentTransactionType.allowedChildTypes.includes(childTypeId)) {
                    shouldTriggerTask = true;
                    console.log(`✅ Ana İşlem ID '${parentTransactionTypeId}' için allowedChildTypes kontrolü geçti: ${childTypeId}`);
                } else {
                    shouldTriggerTask = true; // Varsayılan davranış
                    console.log(`✅ Ana İşlem ID '${parentTransactionTypeId}' için hiçbir kontrol yok, tetikleme serbest.`);
                }
            }
            // 3. İşi tetikle
            if (childTransactionType.taskTriggered && shouldTriggerTask) {
                console.log('İş tetikleme bloğuna girildi...');

                let taskDueDate = null;
                let officialDueDate = null;
                let officialDueDateDetails = null;

                if (deliveryDate instanceof Date && !isNaN(deliveryDate)) {
                    deliveryDate.setHours(0, 0, 0, 0);

                    const duePeriodMonths = Number(childTransactionType.duePeriod ?? 0);

                    const rawOfficialDueDate = addMonthsToDate(deliveryDate, duePeriodMonths);
                    officialDueDate = findNextWorkingDay(rawOfficialDueDate, TURKEY_HOLIDAYS);

                    const operationalDueDate = new Date(officialDueDate);
                    operationalDueDate.setDate(operationalDueDate.getDate() - 3);

                    let tempOperationalDueDate = new Date(operationalDueDate);
                    tempOperationalDueDate.setHours(0,0,0,0);
                    while (isWeekend(tempOperationalDueDate) || isHoliday(tempOperationalDueDate, TURKEY_HOLIDAYS)) {
                        tempOperationalDueDate.setDate(tempOperationalDueDate.getDate() - 1);
                    }
                    taskDueDate = tempOperationalDueDate.toISOString().split('T')[0];

                    officialDueDateDetails = {
                        initialDeliveryDate: deliveryDateStr,
                        periodMonths: duePeriodMonths,
                        originalCalculatedDate: rawOfficialDueDate.toISOString().split('T')[0],
                        finalOfficialDueDate: officialDueDate.toISOString().split('T')[0],
                        finalOperationalDueDate: taskDueDate,
                        adjustments: []
                    };
                } else {
                    console.warn("⚠️ deliveryDate geçersiz, son tarihler hesaplanmayacak.", deliveryDate);
                }

                const taskData = {
                    title: `${childTransactionType.alias || childTransactionType.name} - ${this.matchedRecord.title}`,
                    description: `${this.matchedRecord.title} için ${childTransactionType.alias || childTransactionType.name} işlemi`,
                    relatedIpRecordId: this.matchedRecord.id,
                    relatedIpRecordTitle: this.matchedRecord.title,
                    transactionId: transactionIdToAssociateFiles,
                    triggeringTransactionType: childTypeId,
                    deliveryDate: deliveryDateStr || null,
                    dueDate: taskDueDate,
                    officialDueDate: officialDueDate,
                    officialDueDateDetails: officialDueDateDetails,
                    assignedTo_uid: SELCAN_UID,
                    assignedTo_email: SELCAN_EMAIL,
                    priority: 'normal',
                    status: 'awaiting_client_approval',
                    createdAt: new Date(),
                    createdBy: this.currentUser.uid,
                    taskType: childTransactionType.taskTriggered
                };

                const taskResult = await taskService.createTask(taskData);
                if (taskResult.success) {
                    createdTaskId = taskResult.id || taskResult.data?.id;
                    console.log('İş başarıyla tetiklendi, ID:', createdTaskId);
                    showNotification('Alt işlem oluşturuldu ve iş tetiklendi!', 'success');
                    if (childTransactionType && childTransactionType.hierarchy === "child" && childTransactionType.isTopLevelSelectable) {
    console.log("📤 Tetiklenen işlem sonrası transaction yaratma başladı.");
    console.log("📌 Tetiklenen işlem bir child ve top-level selectable.");

    const recordTransactionsResult = await ipRecordsService.getRecordTransactions(this.matchedRecord.id);
    if (!recordTransactionsResult.success) {
        console.error("Portföy geçmişi alınamadı:", recordTransactionsResult.error);
        showNotification("İşlem geçmişi yüklenemedi.", "error");
    } else {
        const existingTransactions = recordTransactionsResult.data || [];
        console.log("🟢 Portföydeki mevcut işlemler:", existingTransactions);

        // Tüm transactionları yazdır
        existingTransactions.forEach(tx => {
            console.log(`--> TX id=${tx.id}, type=${tx.type}, hierarchy=${tx.transactionHierarchy}`);
        });
            console.log("🟢 Mevcut işlemler detaylı listesi:");
            existingTransactions.forEach(tx => {
            const txType = this.allTransactionTypes.find(t => t.id === tx.type);
            console.log({
                id: tx.id,
                type: tx.type,
                transactionHierarchy: tx.transactionHierarchy,
                txTypeName: txType?.name,
                allowedChildTypes: txType?.allowedChildTypes
            });
            });
            console.log("🔵 Seçilen alt işlem:", {
            id: childTransactionType.id,
            name: childTransactionType.name
            });

        // Filtreleme işlemi forEach dışında olacak
        const suitableParents = existingTransactions.filter(parentTransaction => {
            if (parentTransaction.transactionHierarchy !== "parent") return false;
            const parentTransactionType = this.allTransactionTypes.find(t => t.id === parentTransaction.type);
            console.log(
                `Kontrol -> ParentTransaction.id: ${parentTransaction.id}, ParentTransaction.type: ${parentTransaction.type}`,
                `ParentTransactionType.id: ${parentTransactionType?.id}`,
                `ParentTransactionType.allowedChildTypes:`,
                parentTransactionType?.allowedChildTypes
            );
            return parentTransactionType?.allowedChildTypes?.includes(childTransactionType.id);
        });

        console.log("🟢 Uygun parent işlemler:", suitableParents);

        if (suitableParents.length === 0) {
            showNotification(`Bu alt işlem (${childTransactionType.name}) için portföyde uygun bir ana işlem bulunamadı. Lütfen önce ilgili ana işlemi oluşturun.`, "warning");
        } else {
            const parent = suitableParents[0];
            const childTransactionData = {
                type: childTransactionType.id,
                description: `${childTransactionType.name} alt işlemi.`,
                parentId: parent.id,
                transactionHierarchy: "child"
            };

            console.log("📤 Firestore'a child transaction ekleniyor:", childTransactionData);
            const addResult = await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, childTransactionData);

            if (addResult.success) {
                console.log("✅ Child transaction başarıyla kaydedildi:", addResult.data);
                showNotification("İş ve ilgili işlem başarıyla kaydedildi!", "success");
            } else {
                console.error("❌ Child transaction kaydedilemedi:", addResult.error);
                showNotification("Alt işlem kaydedilemedi.", "error");
            }
        }
    }
}
                } else {
                    console.error('İş tetiklenemedi:', taskResult.error);
                    showNotification('Alt işlem oluşturuldu ama iş tetiklenemedi.', 'warning');
                }
            } else {
                console.log('İş tetikleme koşulları sağlanmadı. İş tetiklenmeyecek.');
                showNotification('Alt işlem başarıyla oluşturuldu. (Kurallar gereği iş tetiklenmedi)', 'info');
            }
        }

        // 4. PDF dosyasını transaction'a bağla
        await updateDoc(
            doc(collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION), this.pdfData.id),
            {
                status: 'indexed',
                indexedAt: new Date(),
                associatedTransactionId: transactionIdToAssociateFiles,
                mainProcessType: this.matchedRecord?.type || 'unknown',
                subProcessType: childTypeId || null
                // clientId satırını tamamen kaldırın
            }
        );

        // 5. Parent transaction'a requestResult = childTypeId yaz (son indekse göre güncellenir)
        if (this.selectedTransactionId && childTypeId) {
        try {
            await updateDoc(
            doc(
                collection(firebaseServices.db, 'ipRecords', this.matchedRecord.id, 'transactions'),
                this.selectedTransactionId
            ),
            {
                requestResult: childTypeId,
                requestResultUpdatedAt: new Date()
            }
            );
            console.log('Parent requestResult güncellendi:', this.selectedTransactionId, childTypeId);
        } catch (err) {
            console.error('requestResult güncellenemedi:', err);
            // burada hatayı kullanıcıya göstermek istemezsen sadece log bırakmak yeterli
        }
        }

        const successMessage = createdTaskId ? 
            'PDF indekslendi ve ilgili iş tetiklendi!' : 
            'PDF başarıyla indekslendi!';
        
        showNotification(successMessage, 'success');

            // 🔻 SADECE noRedirect false ise yönlendir
            if (!noRedirect) {
                setTimeout(() => { window.location.href = 'bulk-indexing-page.html'; }, 2000);
            }

        } catch (error) {
            console.error('İndeksleme hatası:', error);
            showNotification('İndeksleme hatası: ' + error.message, 'error');
        } finally {
            const indexBtn = document.getElementById('indexPdfBtn') || document.getElementById('indexBtn');
            if (indexBtn) indexBtn.disabled = false;
        }
    } catch (error) {
    console.error('indexing-detail.handleIndexing failed:', error);
    try { showNotification('İndeksleme sırasında hata: ' + (error?.message || error), 'error'); } catch(e) {}
    }
}
}