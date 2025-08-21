// js/bulk-indexing-module.js - Genişletilmiş BulkIndexingModule

import { 
    firebaseServices, 
    authService, 
    ipRecordsService, 
    transactionTypeService,
    generateUUID 
} from '../firebase-config.js';

// Firestore fonksiyonlarını doğrudan Firebase'den import et
import { 
    collection, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    doc, 
    query, 
    where, 
    orderBy, 
    onSnapshot, 
    deleteField,
    getDocs,
    setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Storage fonksiyonlarını da import et
import { 
    ref, 
    uploadBytesResumable, 
    getDownloadURL,
    deleteObject 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

import { showNotification, formatFileSize } from '../utils.js';

const UNINDEXED_PDFS_COLLECTION = 'unindexed_pdfs';

export class BulkIndexingModule {
    constructor() {
        this.uploadedFiles = [];
        this.currentUser = null;
        // Set active tab to bulk-indexing-pane initially
        this.activeTab = 'bulk-indexing-pane';
        this.activeFileTab = 'all-files-pane';
        this.unsubscribe = null;
        
        // Data stores for indexing functionality  
        this.allRecords = [];
        this.allTransactionTypes = [];
        this.uploadedFilesMap = new Map(); // For file management per tab (indexing tabs)
        //this.selectedRecordExisting = null;
        this.selectedRecordManual = null;
        //this.selectedTransactionId = null;

        this.init();
    }

    async init() {
        try {
            this.currentUser = authService.getCurrentUser();
            if (!this.currentUser) {
                console.error('Kullanıcı oturum açmamış');
                return;
            }

            // Load data for indexing functionality
            await this.loadAllData();
            
            this.setupEventListeners();
            this.setupRealtimeListener();
            this.updateUI();
            
            console.log('✅ Enhanced BulkIndexingModule initialized');
        } catch (error) {
            console.error('BulkIndexingModule initialization error:', error);
            showNotification('Modül başlatılamadı: ' + error.message, 'error');
        }
    }

    async loadAllData() {
        try {
            const [recordsResult, transactionTypesResult] = await Promise.all([
                ipRecordsService.getRecords(),
                transactionTypeService.getTransactionTypes()
            ]);

            if (recordsResult.success) {
                this.allRecords = recordsResult.data;
                console.log('✅ Tüm kayıtlar yüklendi:', this.allRecords.length);
            } else {
                showNotification('Kayıtlar yüklenemedi: ' + recordsResult.error, 'error');
            }

            if (transactionTypesResult.success) {
                this.allTransactionTypes = transactionTypesResult.data;
                console.log('✅ Tüm işlem tipleri yüklendi:', this.allTransactionTypes.length);
            } else {
                showNotification('İşlem tipleri yüklenemedi: ' + transactionTypesResult.error, 'error');
            }
        } catch (error) {
            showNotification('Veriler yüklenirken hata oluştu: ' + error.message, 'error');
        }
    }

    setupEventListeners() {
        // Bulk upload tab listeners
        this.setupBulkUploadListeners();
        
        // Main tab switching listeners
        this.setupMainTabListeners();

        // Manuel işlem kaydet butonu
        const saveManualTransactionBtn = document.getElementById('saveManualTransactionBtn');
        if (saveManualTransactionBtn) {
            saveManualTransactionBtn.addEventListener('click', () => this.handleManualTransactionSubmit());
        }
        
        // Manuel işlem form validation
        const manualTransactionType = document.getElementById('specificManualTransactionType');
        if (manualTransactionType) {
            manualTransactionType.addEventListener('change', () => this.checkFormCompleteness());
        }
                   
        // Search and form listeners for manual transaction tab
        this.setupManualTransactionListeners();
        
        // Common form listeners
        this.setupCommonFormListeners();
    }

setupBulkUploadListeners() {
    
    const uploadButton = document.getElementById('bulkFilesButton');
    const fileInput = document.getElementById('bulkFiles');

    if (!uploadButton || !fileInput) {
        console.warn('⚠️ BulkIndexingModule: Upload elementleri bulunamadı', {
            uploadButton: !!uploadButton,
            fileInput: !!fileInput
        });
        return;
    }

    // Mevcut listener'ları kaldırmak için elementleri klonla (çakışmaları önler)
    const newUploadButton = uploadButton.cloneNode(true);
    const newFileInput = fileInput.cloneNode(true);
    
    uploadButton.parentNode.replaceChild(newUploadButton, uploadButton);
    fileInput.parentNode.replaceChild(newFileInput, fileInput);

    // Event listener'ları yeni elementlere ekle
    newUploadButton.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('🖱️ BulkIndexingModule: Upload button tıklandı');
        newFileInput.click();
    });

    newUploadButton.addEventListener('dragover', (e) => {
        e.preventDefault();
        this.handleDragOver(e);
    });

    newUploadButton.addEventListener('dragleave', (e) => {
        e.preventDefault();
        this.handleDragLeave(e);
    });

    newUploadButton.addEventListener('drop', (e) => {
        e.preventDefault();
        this.handleDrop(e);
    });

    newFileInput.addEventListener('change', (e) => {
        console.log('📂 BulkIndexingModule: Dosya input değişti');
        this.handleFileSelect(e);
    });

    // File tab switching within bulk upload
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn') && 
            e.target.closest('#fileListSection')) {
            const targetPane = e.target.getAttribute('data-tab');
            if (targetPane === 'all-files-pane' || targetPane === 'matched-files-pane' || targetPane === 'unmatched-files-pane') {
                this.switchFileTab(targetPane);
            }
        }
    });

}

    setupMainTabListeners() {
        document.querySelectorAll('.tabs-container .tab-btn').forEach(btn => {
            if (!btn.closest('.tab-content-container')) { // Only main tabs, not nested tabs
                btn.addEventListener('click', (e) => {
                    const targetTab = e.currentTarget.dataset.tab;
                    this.activateTab(targetTab);
                });
            }
        });
    }

    setupManualTransactionListeners() {
        const recordSearchInput = document.getElementById('recordSearchInputManual');
        const recordSearchContainer = document.getElementById('searchResultsContainerManual');
        
        if (recordSearchInput) {
            recordSearchInput.addEventListener('input', (e) => this.searchRecords(e.target.value, 'manual'));
            recordSearchInput.addEventListener('blur', () => {
                setTimeout(() => { 
                    if (recordSearchContainer) recordSearchContainer.style.display = 'none'; 
                }, 200);
            });
        }

        const filesManual = document.getElementById('filesManual');
        const filesManualButton = document.getElementById('filesManualButton');
        
        if (filesManual) {
            filesManual.addEventListener('change', (e) => {
                this.handleFileChange(e, 'manual-indexing-pane');
                const info = document.getElementById('filesManualInfo');
                if (info) {
                    info.textContent = e.target.files.length > 0 ? 
                        `${e.target.files.length} dosya seçildi.` : 'Henüz dosya seçilmedi.';
                }
            });
        }

        if (filesManualButton) {
            filesManualButton.addEventListener('click', () => filesManual?.click());
        }

        // Manual transaction type listeners
        const manualTransactionType = document.getElementById('specificManualTransactionType');
        const manualDeliveryDate = document.getElementById('manualTransactionDeliveryDate');
        
        if (manualTransactionType) {
            manualTransactionType.addEventListener('change', () => this.checkFormCompleteness());
        }
        if (manualDeliveryDate) {
            manualDeliveryDate.addEventListener('change', () => this.checkFormCompleteness());
        }
    }

    setupCommonFormListeners() {
        // Form submission
        const submitBtn = document.getElementById('indexDocumentsBtn');
        if (submitBtn) {
            submitBtn.addEventListener('click', () => this.handleSubmit());
        }

        // Form reset
        const resetBtn = document.getElementById('resetIndexingFormBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetForm());
        }

        // File removal listeners
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-uploaded-file')) {
                const fileId = e.target.dataset.fileId;
                const tabKey = e.target.dataset.tabKey;
                let files = this.uploadedFilesMap.get(tabKey) || [];
                this.uploadedFilesMap.set(tabKey, files.filter(f => f.id !== fileId));
                this.renderUploadedFilesList(tabKey);
                this.checkFormCompleteness();
            }
        });
    }

    // Tab Management
    activateTab(tabName) {
        // Remove active class from all main tabs
        document.querySelectorAll('.tabs-container .tab-btn').forEach(btn => {
            if (!btn.closest('.tab-content-container')) {
                btn.classList.remove('active');
            }
        });
        
        // Remove active class from all tab panes
        document.querySelectorAll('.tab-content-container > .tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        
        // Add active class to selected tab and pane
        const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]:not(.tab-content-container .tab-btn)`);
        if (activeBtn) activeBtn.classList.add('active');
        
        const activePane = document.getElementById(tabName);
        if (activePane) activePane.classList.add('active');

        this.activeTab = tabName;
        this.setRequiredFieldsForActiveTab();
        this.checkFormCompleteness();
    }

    setRequiredFieldsForActiveTab() {
    document.querySelectorAll('[required]').forEach(el => el.removeAttribute('required'));

        if (this.activeTab === 'existing-transaction-pane') {
            const elements = [
                'recordSearchInputExisting',
                'specificChildTransactionType', 
                'filesExisting'
            ];
            elements.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.setAttribute('required', 'required');
            });
        } else if (this.activeTab === 'manual-indexing-pane') {
            const elements = [
                'recordSearchInputManual',
                'specificManualTransactionType'
            ];
            elements.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.setAttribute('required', 'required');
            });
        }
    }

    // Search functionality
searchRecords(query, tabContext) {
    const searchResultsContainerId = tabContext === 'existing' ? 
        'searchResultsContainerExisting' : 'searchResultsContainerManual';
    const container = document.getElementById(searchResultsContainerId);

    if (!container) return;

    if (query.length < 3) {
        container.innerHTML = '<p class="no-results-message p-2">Arama yapmak için en az 3 karakter girin.</p>';
        container.style.display = 'block';
        return;
    }

    container.innerHTML = '';
    const filtered = this.allRecords.filter(r => 
        (r.title && r.title.toLowerCase().includes(query.toLowerCase())) ||
        (r.applicationNumber && r.applicationNumber.toLowerCase().includes(query.toLowerCase()))
    );
    
    if (filtered.length === 0) {
        container.innerHTML = '<p class="no-results-message p-2">Kayıt bulunamadı.</p>';
    } else {
        filtered.forEach(record => {
            const item = document.createElement('div');
            item.className = 'record-search-item';
            item.dataset.id = record.id;
            
            // ✅ MARKA GÖRSELİNİ EKLE
            const imageHtml = record.brandImageUrl ? 
                `<img src="${record.brandImageUrl}" class="record-brand-image" style="width: 40px; height: 40px; object-fit: contain; margin-right: 10px; border-radius: 4px; border: 1px solid #ddd;">` : 
                '<div style="width: 40px; height: 40px; margin-right: 10px; background: #f5f5f5; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 12px;">Logo</div>';

            item.innerHTML = `
                <div class="record-info" style="display: flex; align-items: center; padding: 10px; border-bottom: 1px solid #eee; cursor: pointer;">
                    ${imageHtml}
                    <div>
                        <div style="font-weight: 500; margin-bottom: 2px;">${record.title}</div>
                        <small style="color: #666;">${record.applicationNumber}</small>
                    </div>
                </div>
            `;
            
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.selectRecordBasedOnTab(record.id, tabContext);
            });
            container.appendChild(item);
        });
    }
    container.style.display = 'block';
}

    async selectRecordBasedOnTab(recordId, tabContext) {
        const record = this.allRecords.find(r => r.id === recordId);
        if (!record) return;

        const recordSearchInputId = tabContext === 'existing' ? 
            'recordSearchInputExisting' : 'recordSearchInputManual';
        const searchResultsContainerId = tabContext === 'existing' ?
            'searchResultsContainerExisting' : 'searchResultsContainerManual';

        // Sadece arama kutusunu temizle ve sonuçları gizle
        const inputElement = document.getElementById(recordSearchInputId);
        const containerElement = document.getElementById(searchResultsContainerId);

        if (inputElement) inputElement.value = '';
        if (containerElement) containerElement.style.display = 'none';

        // Set selected record
        if (tabContext === 'existing') {
            this.selectedRecordExisting = record;
            await this.loadTransactionsForRecord(record.id);
        } else {
            this.selectedRecordManual = record;
            this.populateManualTransactionTypeSelect();
        }

        this.checkFormCompleteness();
    }
    populateManualTransactionTypeSelect() {
        const select = document.getElementById('specificManualTransactionType');
        if (!select) return;

        select.innerHTML = '<option value="" disabled selected>İşlem türü seçin...</option>';
        
        const parentTypes = this.allTransactionTypes.filter(type => 
            type.hierarchy === 'parent' || !type.hierarchy
        );

        parentTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.id;
            option.textContent = type.alias || type.name;
            select.appendChild(option);
        });
    }

    // File handling
    handleFileChange(event, tabKey) {
        const fileInput = event.target;
        const files = Array.from(fileInput.files);
        
        this.uploadedFilesMap.set(tabKey, []);
        
        files.forEach(file => {
            this.uploadedFilesMap.get(tabKey).push({
                id: `temp_${Date.now()}_${generateUUID()}`,
                fileObject: file,
                documentDesignation: ''
            });
        });
        
        this.renderUploadedFilesList(tabKey);
        this.checkFormCompleteness();
    }

    renderUploadedFilesList(tabKey) {
        const containerId = tabKey === 'existing-transaction-pane' ? 
            'fileListExisting' : 'fileListManual';
        const container = document.getElementById(containerId);
        if (!container) return;

        const files = this.uploadedFilesMap.get(tabKey) || [];
        if (files.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = files.map(file => `
            <div class="file-item" data-file-id="${file.id}">
                <div class="file-item-name">${file.fileObject.name}</div>
                <div class="file-item-controls">
                    <select class="file-item-select" data-file-id="${file.id}">
                        <option value="">Belge türü seçin...</option>
                        <option value="general">Genel Belge</option>
                        <option value="decision">Karar</option>
                        <option value="notice">Tebliğ</option>
                        <option value="application">Başvuru</option>
                    </select>
                    <button type="button" class="remove-file remove-uploaded-file" 
                            data-file-id="${file.id}" data-tab-key="${tabKey}">×</button>
                </div>
            </div>
        `).join('');
    }

    // Form validation
    checkFormCompleteness() {
        let canSubmit = false;
        
        if (this.activeTab === 'manual-indexing-pane') {
            const specificManualTransactionTypeSelected = document.getElementById('specificManualTransactionType')?.value;
            canSubmit = this.selectedRecordManual !== null && specificManualTransactionTypeSelected;
            
            // Manuel işlem butonu için
            const saveManualBtn = document.getElementById('saveManualTransactionBtn');
            if (saveManualBtn) {
                saveManualBtn.disabled = !canSubmit;
            }
        }
        // bulk-indexing-pane için form validation gerekmez
    }
    // Form submission
    async handleSubmit() {
        const btn = document.getElementById('indexDocumentsBtn');
        if (btn) btn.disabled = true;
        
        showNotification('İşlem kaydediliyor...', 'info');

        try {
            if (this.activeTab === 'manual-indexing-pane') {
                await this.handleManualTransactionSubmit();
            }
            // existing-transaction-pane kısmını kaldırın
        } catch (error) {
            console.error('Submit error:', error);
            showNotification('İşlem kaydedilirken hata oluştu: ' + error.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

     async handleManualTransactionSubmit() {
        // Implementation for manual transaction submission
        const transactionTypeId = document.getElementById('specificManualTransactionType')?.value;
        const deliveryDateStr = document.getElementById('manualTransactionDeliveryDate')?.value;
        const notes = document.getElementById('manualTransactionNotes')?.value;
        const files = this.uploadedFilesMap.get('manual-indexing-pane') || [];

        const transactionData = {
            type: transactionTypeId,
            transactionHierarchy: 'parent',
            deliveryDate: deliveryDateStr ? new Date(deliveryDateStr).toISOString() : null,
            notes: notes || '',
            timestamp: new Date().toISOString()
        };

        const result = await ipRecordsService.addTransactionToRecord(
            this.selectedRecordManual.id, 
            transactionData
        );

        if (!result.success) {
            throw new Error(result.error || 'Manuel işlem oluşturulamadı');
        }

        // Process file uploads here
        showNotification('Manuel işlem başarıyla oluşturuldu!', 'success');
        this.resetForm();
    }

    // Form reset
    resetForm() {
        // Clear file inputs
        const fileInputs = ['filesExisting', 'filesManual', 'bulkFiles'];
        fileInputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });

        // Clear file info texts
        const fileInfos = ['filesExistingInfo', 'filesManualInfo', 'bulkFilesInfo'];
        fileInfos.forEach(id => {
            const info = document.getElementById(id);
            if (info) info.textContent = 'Henüz dosya seçilmedi.';
        });

        // Clear record displays
        const recordDisplays = ['selectedRecordDisplayExisting', 'selectedRecordDisplayManual'];
        recordDisplays.forEach(id => {
            const display = document.getElementById(id);
            if (display) display.value = '';
        });

        // Clear transaction list
        const transactionsList = document.getElementById('transactions-list-for-selection');
        if (transactionsList) {
            transactionsList.innerHTML = '<p class="text-muted p-2">Lütfen bir kayıt seçin.</p>';
        }

        // Hide child transaction inputs
        const childInputs = document.getElementById('existingChildTransactionInputs');
        if (childInputs) childInputs.style.display = 'none';

        // Reset selections
        this.resetSelections();
        this.uploadedFiles.clear();

        // Activate first tab
        this.activateTab('existing-transaction-pane');
        this.checkFormCompleteness();

        showNotification('Form temizlendi.', 'info');
    }

    resetSelections() {
        this.selectedRecordExisting = null;
        this.selectedRecordManual = null;
        this.selectedTransactionId = null;
    }

    // Bulk upload specific methods
    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files).filter(file => file.type === 'application/pdf');
        if (files.length > 0) {
            this.processFiles(files);
        }
    }

    handleFileSelect(e) {
        const files = Array.from(e.target.files);
        this.processFiles(files);
    }

    async processFiles(files) {
        console.log('Processing bulk files:', files);
        
        // Önce records'ın yüklendiğinden emin ol
        if (this.allRecords.length === 0) {
            console.log('Records henüz yüklenmemiş, yeniden yükleniyor...');
            await this.loadAllData();
        }
        
        showNotification(`${files.length} PDF dosyası yükleniyor...`, 'info');
        
        for (const file of files) {
            try {
                await this.uploadFileToFirebase(file);
            } catch (error) {
                console.error('Dosya yüklenirken hata:', error);
                showNotification(`${file.name} yüklenirken hata oluştu.`, 'error');
            }
        }
        
        // Input'u temizle
        const fileInput = document.getElementById('bulkFiles');
        if (fileInput) fileInput.value = '';
        
        showNotification('PDF dosyaları başarıyla yüklendi.', 'success');
    }

    async uploadFileToFirebase(file) {
        try {
            // Dosyayı Firebase Storage'a yükle
            const storageRef = ref(firebaseServices.storage, `pdfs/${this.currentUser.uid}/${file.name}`);
            const uploadTask = uploadBytesResumable(storageRef, file);
            
            return new Promise((resolve, reject) => {
                uploadTask.on('state_changed', 
                    (snapshot) => {
                        // Progress tracking (isteğe bağlı)
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                        console.log('Upload progress:', progress);
                    },
                    (error) => {
                        reject(error);
                    },
                    async () => {
                        try {
                            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                            
                            // Dosya bilgilerini Firestore'a kaydet
                            const pdfData = {
                                fileName: file.name,
                                fileUrl: downloadURL,
                                fileSize: file.size,
                                uploadedAt: new Date(),
                                userId: this.currentUser.uid,
                                status: 'pending',
                                extractedAppNumber: this.extractApplicationNumber(file),
                                matchedRecordId: null,
                                matchedRecordDisplay: null
                            };
                            
                            // Eşleşme kontrolü yap
                            if (pdfData.extractedAppNumber) {
    const matchedRecord = this.findMatchingRecord(pdfData.extractedAppNumber);
    if (matchedRecord) {
        pdfData.matchedRecordId = matchedRecord.id;
        pdfData.matchedRecordDisplay = `${matchedRecord.title} - ${matchedRecord.applicationNumber}`;
        pdfData.recordOwnerType = matchedRecord.recordOwnerType || 'self';
        console.log('✅ Eşleştirme başarılı:', pdfData.fileName, '→', pdfData.matchedRecordDisplay);
    } else {

                                    console.log('❌ Eşleştirme başarısız:', pdfData.fileName, 'Çıkarılan numara:', pdfData.extractedAppNumber);
                                }
                            }
                            
                            await setDoc(doc(collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION), generateUUID()), pdfData);
                            resolve(pdfData);
                        } catch (error) {
                            reject(error);
                        }
                    }
                );
            });
        } catch (error) {
            throw error;
        }
    }

    extractApplicationNumber(file) {
        // Gelişmiş dosya adından uygulama numarası çıkarma
        const fileName = file.name;
        
        // Çeşitli formatları yakala:
        // - "2025-1", "2025/1", "2025 1" 
        // - "250369056" (uzun numaralar)
        // - "TR2024/123", "TR2025-1"
        
        const patterns = [
            /(\d{4}[-\/\s]\d+)/g,          // 2025-1, 2025/1, 2025 1
            /TR(\d{4}[-\/]\d+)/gi,         // TR2025-1, TR2025/1
            /(\d{6,})/g                    // 250369056 (6+ rakam)
        ];
        
        const extractedNumbers = [];
        
        patterns.forEach(pattern => {
            const matches = fileName.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    // TR prefix'ini temizle
                    let cleaned = match.replace(/^TR/i, '');
                    extractedNumbers.push(cleaned);
                });
            }
        });
        
        console.log('Dosya adı:', fileName, 'Çıkarılan numaralar:', extractedNumbers);
        
        // İlk bulunan numarayı döndür (en olası eşleşme)
        return extractedNumbers.length > 0 ? extractedNumbers[0] : null;
    }

    findMatchingRecord(applicationNumber) {
        if (!applicationNumber) return null;
        
        console.log('Eşleşme aranıyor:', applicationNumber, 'Portföy kayıtları:', this.allRecords.length);
        
        // Çeşitli eşleşme stratejileri dene
        for (const record of this.allRecords) {
            if (!record.applicationNumber) continue;
            
            const recordAppNum = record.applicationNumber;
            console.log('Karşılaştırma:', applicationNumber, 'vs', recordAppNum);
            
            // 1. Tam eşleşme
            if (recordAppNum === applicationNumber) {
                console.log('✅ Tam eşleşme bulundu:', record.title);
                return record;
            }
            
            // 2. Normalize edilmiş eşleşme (-, /, space'leri kaldır)
            const normalizedExtracted = applicationNumber.replace(/[-\/\s]/g, '');
            const normalizedRecord = recordAppNum.replace(/[-\/\s]/g, '');
            
            if (normalizedRecord === normalizedExtracted) {
                console.log('✅ Normalize edilmiş eşleşme bulundu:', record.title);
                return record;
            }
            
            // 3. Partial eşleşme - bir taraf diğerini içeriyor
            if (recordAppNum.includes(applicationNumber) || applicationNumber.includes(recordAppNum)) {
                console.log('✅ Partial eşleşme bulundu:', record.title);
                return record;
            }
            
            // 4. Flexible pattern matching
            // "2025-1" ile "2025/1" gibi formatlar
            const flexPattern1 = applicationNumber.replace(/[-\/\s]/g, '[-\/\\s]?');
            const flexPattern2 = recordAppNum.replace(/[-\/\s]/g, '[-\/\\s]?');
            
            const regex1 = new RegExp(flexPattern1, 'i');
            const regex2 = new RegExp(flexPattern2, 'i');
            
            if (regex1.test(recordAppNum) || regex2.test(applicationNumber)) {
                console.log('✅ Flexible pattern eşleşme bulundu:', record.title);
                return record;
            }
        }
        
        console.log('❌ Eşleşme bulunamadı');
        return null;
    }

    switchFileTab(targetPane) {
        document.querySelectorAll('#fileListSection .tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        document.querySelectorAll('#fileListSection .tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });

        const selectedTab = document.querySelector(`#fileListSection [data-tab="${targetPane}"]`);
        if (selectedTab) selectedTab.classList.add('active');

        const selectedPane = document.getElementById(targetPane);
        if (selectedPane) selectedPane.classList.add('active');

        this.activeFileTab = targetPane;
    }

    resetForm() {
        // Bulk indexing reset
        const fileInput = document.getElementById('bulkFiles');
        if (fileInput) {
            fileInput.value = '';
        }
        
        const fileInfo = document.getElementById('bulkFilesInfo');
        if (fileInfo) {
            fileInfo.textContent = 'PDF dosyası seçin veya sürükleyip bırakın.';
        }

        // Reset indexing tab forms if they exist
        if (this.uploadedFilesMap && typeof this.uploadedFilesMap.clear === 'function') {
            this.uploadedFilesMap.clear();
        }

        // Clear record displays if they exist
        const recordDisplays = ['selectedRecordDisplayExisting', 'selectedRecordDisplayManual'];
        recordDisplays.forEach(id => {
            const display = document.getElementById(id);
            if (display) display.value = '';
        });

        // Reset selections
        this.resetSelections();

        // Stay on current tab (don't switch)
        this.checkFormCompleteness();

        showNotification('Form temizlendi.', 'info');
    }

    setupRealtimeListener() {
        const q = query(
            collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION),
            where('userId', '==', this.currentUser.uid),
            orderBy('uploadedAt', 'desc')
        );

        this.unsubscribe = onSnapshot(q, (snapshot) => {
            this.uploadedFiles = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                uploadedAt: doc.data().uploadedAt ? doc.data().uploadedAt.toDate() : new Date()
            }));
            this.updateUI();
        }, error => {
            console.error("Gerçek zamanlı dinleyici hatası:", error);
        });
    }

    updateUI() {
        this.updateSections();
        this.renderFileLists();
        this.updateTabBadges();
    }

updateSections() {
        // Mevcut dosyalar varsa hep göster (yükleme olmasa da)
        const hasFiles = this.uploadedFiles.length > 0;
        const fileListSection = document.getElementById('fileListSection');
        
        if (fileListSection) {
            fileListSection.style.display = hasFiles ? 'block' : 'none';
        }

        const fileInfo = document.getElementById('bulkFilesInfo');
        if (fileInfo) {
            if (hasFiles) {
                const activeFiles = this.uploadedFiles.filter(f => f.status !== 'removed');
                fileInfo.textContent = `${activeFiles.length} PDF dosyası mevcut.`;
            } else {
                fileInfo.textContent = 'PDF dosyası seçin veya sürükleyip bırakın.';
            }
        }
    }

    renderFileLists() {
        const allFiles = this.uploadedFiles.filter(f => f.status !== 'removed');
        const matchedFiles = allFiles.filter(f => f.matchedRecordId && f.status !== 'indexed');
        const unmatchedFiles = allFiles.filter(f => !f.matchedRecordId && f.status !== 'indexed');
        const indexedFiles = allFiles.filter(f => f.status === 'indexed');
        
        console.log('Dosya filtreleme:', {
            total: allFiles.length,
            matched: matchedFiles.length, 
            unmatched: unmatchedFiles.length,
            indexed: indexedFiles.length
        });
        
        this.renderFileList('allFilesList', matchedFiles);
        this.renderFileList('unmatchedFilesList', unmatchedFiles);
        this.renderFileList('indexedFilesList', indexedFiles);
    }

    renderFileList(containerId, files) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (files.length === 0) {
            let emptyMessage = '';
            if (containerId === 'allFilesList') {
                emptyMessage = 'Portföy kaydıyla eşleşen dosya yok';
            } else if (containerId === 'unmatchedFilesList') {
                emptyMessage = 'Portföy kaydıyla eşleşmeyen dosya yok';
            } else if (containerId === 'indexedFilesList') {
                emptyMessage = 'Henüz indekslenmiş dosya yok';
            }
            container.innerHTML = `<div class="empty-message"><div class="empty-icon">📄</div><p>${emptyMessage}</p></div>`;
            return;
        }

        container.innerHTML = files.map(file => `
            <div class="pdf-list-item ${file.matchedRecordId ? 'matched' : 'unmatched'}">
                <div class="pdf-icon">📄</div>
                <div class="pdf-details">
                    <div class="pdf-name">${file.fileName}</div>
                    <div class="pdf-meta">
                        <span>Yükleme: ${file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString('tr-TR') : 'Bilinmiyor'}</span>
                    </div>
                    <div class="pdf-meta">
                        <strong>Çıkarılan Uygulama No:</strong> ${file.extractedAppNumber || 'Bulunamadı'}
                    </div>
                    <div class="match-status ${file.matchedRecordId ? 'matched' : 'unmatched'}">
                        ${file.matchedRecordId ? 
                            `✅ Eşleşti: ${file.matchedRecordDisplay}` : 
                            '❌ Portföy kaydı ile eşleşmedi'
                        }
                    </div>
                    ${file.status === 'indexed' && file.indexedAt ? `
                        <div class="pdf-meta">
                            <strong>İndekslenme:</strong> ${new Date(file.indexedAt.seconds * 1000).toLocaleDateString('tr-TR')}
                        </div>
                    ` : ''}
                </div>
                <div class="pdf-actions">
                    <button class="action-btn view-btn" onclick="window.open('${file.fileUrl}', '_blank')">
                        👁️ Görüntüle
                    </button>
                    
                    ${file.status === 'pending' ? `
                        <button class="action-btn complete-btn" onclick="window.location.href='indexing-detail.html?pdfId=${file.id}'">
                            ✨ İndeksle
                        </button>
                    ` : file.status === 'indexed' ? `
                        <button class="action-btn complete-btn" disabled style="background: #28a745;">
                            ✅ İndekslendi
                        </button>
                    ` : ''}
                    
                    <button class="action-btn danger-btn" onclick="window.indexingModule.deleteFilePermanently('${file.id}')">
                        🚫 Kaydı Sil
                    </button>
                </div>
            </div>
        `).join('');
    }
    updateTabBadges() {
        const allFiles = this.uploadedFiles.filter(f => f.status !== 'removed');
        const matchedCount = allFiles.filter(f => f.matchedRecordId && f.status !== 'indexed').length;
        const unmatchedCount = allFiles.filter(f => !f.matchedRecordId && f.status !== 'indexed').length;
        const indexedCount = allFiles.filter(f => f.status === 'indexed').length;
        
        const allCountEl = document.getElementById('allCount');
        const unmatchedCountEl = document.getElementById('unmatchedCount');
        const indexedCountEl = document.getElementById('indexedCount');
        
        if (allCountEl) allCountEl.textContent = matchedCount;
        if (unmatchedCountEl) unmatchedCountEl.textContent = unmatchedCount;
        if (indexedCountEl) indexedCountEl.textContent = indexedCount;
    }

   async reprocessMatching() {
        console.log('Mevcut dosyalar yeniden eşleştiriliyor...');
        
        for (const file of this.uploadedFiles) {
            if (file.status === 'removed') continue;
            
            const extractedAppNumber = this.extractApplicationNumber({name: file.fileName});
            const matchedRecord = extractedAppNumber ? this.findMatchingRecord(extractedAppNumber) : null;
            
            const updates = {
                extractedAppNumber: extractedAppNumber,
                matchedRecordId: matchedRecord ? matchedRecord.id : null,
                matchedRecordDisplay: matchedRecord ? `${matchedRecord.title} - ${matchedRecord.applicationNumber}` : null
            };
            
            try {
                await updateDoc(doc(collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION), file.id), updates);
                console.log('Dosya güncellendi:', file.fileName, updates);
            } catch (error) {
                console.error('Dosya güncellenirken hata:', error);
            }
        }
        
        showNotification('Dosyalar yeniden eşleştirildi!', 'success');
    }

    async deleteFilePermanently(fileId) {
        if (!confirm('Bu dosyayı kalıcı olarak silmek istediğinizden emin misiniz?')) return;
        
        try {
            const fileToDelete = this.uploadedFiles.find(f => f.id === fileId);
            if (!fileToDelete) {
                showNotification('Dosya bulunamadı.', 'error');
                return;
            }

            // Firebase Storage'dan dosyayı sil
            if (fileToDelete.fileUrl) {
                try {
                    const storageRef = ref(firebaseServices.storage, `pdfs/${this.currentUser.uid}/${fileToDelete.fileName}`);
                    await deleteObject(storageRef);
                } catch (storageError) {
                    console.warn('Storage\'dan silinirken hata:', storageError);
                }
            }

            // Firestore'dan kaydı sil
            await deleteDoc(doc(collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION), fileId));

            showNotification(`${fileToDelete.fileName} kalıcı olarak silindi.`, 'success');
        } catch (error) {
            console.error('Dosya silinirken hata:', error);
            showNotification('Dosya silinirken hata oluştu.', 'error');
        }
    }

    // Cleanup
    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }
}