// js/bulk-indexing-module.js - REFACTORED VERSION

import { 
    firebaseServices, 
    authService, 
    ipRecordsService, 
    transactionTypeService,
    generateUUID 
} from '../../firebase-config.js';

import { 
    collection, 
    doc, 
    setDoc,
    updateDoc, 
    deleteDoc, 
    query, 
    where, 
    orderBy, 
    onSnapshot 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { 
    ref, 
    uploadBytesResumable, 
    getDownloadURL,
    deleteObject 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

import { showNotification } from '../../utils.js';
import { FilenameParser } from './services/filename-parser.js';
import { RecordMatcher } from './services/record-matcher.js';

const UNINDEXED_PDFS_COLLECTION = 'unindexed_pdfs';

export class BulkIndexingModule {
    constructor() {
        this.uploadedFiles = [];
        this.currentUser = null;
        
        this.activeTab = 'bulk-indexing-pane';
        this.activeFileTab = 'all-files-pane';
        this.unsubscribe = null;
        
        this.allRecords = [];
        this.allTransactionTypes = [];
        this.uploadedFilesMap = new Map(); 
        this.selectedRecordManual = null;

        // ✅ Servisleri Başlat
        this.parser = new FilenameParser();
        this.matcher = new RecordMatcher();

        this.init();
    }

    async init() {
        try {
            this.currentUser = authService.getCurrentUser();
            if (!this.currentUser) {
                console.error('Kullanıcı oturum açmamış');
                return;
            }

            await this.loadAllData();
            
            this.setupEventListeners();
            this.setupRealtimeListener();
            this.updateUI();
            
            console.log('✅ Refactored BulkIndexingModule initialized');
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
            }

            if (transactionTypesResult.success) {
                this.allTransactionTypes = transactionTypesResult.data;
                console.log('✅ Tüm işlem tipleri yüklendi:', this.allTransactionTypes.length);
            }
        } catch (error) {
            showNotification('Veriler yüklenirken hata oluştu: ' + error.message, 'error');
        }
    }

    setupEventListeners() {
        this.setupBulkUploadListeners();
        this.setupMainTabListeners();

        // Manuel İşlem Listenerları
        const saveManualTransactionBtn = document.getElementById('saveManualTransactionBtn');
        if (saveManualTransactionBtn) {
            saveManualTransactionBtn.addEventListener('click', () => this.handleManualTransactionSubmit());
        }
        
        const manualTransactionType = document.getElementById('specificManualTransactionType');
        if (manualTransactionType) {
            manualTransactionType.addEventListener('change', () => this.checkFormCompleteness());
        }
                   
        this.setupManualTransactionListeners();
        this.setupCommonFormListeners();
    }

    setupBulkUploadListeners() {
        const uploadButton = document.getElementById('bulkFilesButton');
        const fileInput = document.getElementById('bulkFiles');

        if (!uploadButton || !fileInput) return;

        const newUploadButton = uploadButton.cloneNode(true);
        const newFileInput = fileInput.cloneNode(true);
        
        uploadButton.parentNode.replaceChild(newUploadButton, uploadButton);
        fileInput.parentNode.replaceChild(newFileInput, fileInput);

        newUploadButton.addEventListener('click', (e) => {
            e.preventDefault();
            newFileInput.click();
        });

        newUploadButton.addEventListener('dragover', (e) => this.handleDragOver(e));
        newUploadButton.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        newUploadButton.addEventListener('drop', (e) => this.handleDrop(e));
        newFileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-btn') && e.target.closest('#fileListSection')) {
                const targetPane = e.target.getAttribute('data-tab');
                if (['all-files-pane', 'matched-files-pane', 'unmatched-files-pane'].includes(targetPane)) {
                    this.switchFileTab(targetPane);
                }
            }
        });
    }

    setupMainTabListeners() {
        document.querySelectorAll('.tabs-container .tab-btn').forEach(btn => {
            if (!btn.closest('.tab-content-container')) {
                btn.addEventListener('click', (e) => this.activateTab(e.currentTarget.dataset.tab));
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
                if (info) info.textContent = `${e.target.files.length} dosya seçildi.`;
            });
        }

        if (filesManualButton) {
            filesManualButton.addEventListener('click', () => filesManual?.click());
        }
    }

    setupCommonFormListeners() {
        const submitBtn = document.getElementById('indexDocumentsBtn');
        if (submitBtn) submitBtn.addEventListener('click', () => this.handleSubmit());

        const resetBtn = document.getElementById('resetIndexingFormBtn');
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetForm());

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

    activateTab(tabName) {
        document.querySelectorAll('.tabs-container .tab-btn').forEach(btn => {
            if (!btn.closest('.tab-content-container')) btn.classList.remove('active');
        });
        document.querySelectorAll('.tab-content-container > .tab-pane').forEach(pane => pane.classList.remove('active'));
        
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

        if (this.activeTab === 'manual-indexing-pane') {
            ['recordSearchInputManual', 'specificManualTransactionType'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.setAttribute('required', 'required');
            });
        }
    }

    searchRecords(query, tabContext) {
        const containerId = tabContext === 'existing' ? 'searchResultsContainerExisting' : 'searchResultsContainerManual';
        const container = document.getElementById(containerId);

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
                
                const imageHtml = record.brandImageUrl ? 
                    `<img src="${record.brandImageUrl}" class="record-brand-image" style="width: 40px; height: 40px; object-fit: contain; margin-right: 10px; border-radius: 4px; border: 1px solid #ddd;">` : 
                    '<div style="width: 40px; height: 40px; margin-right: 10px; background: #f5f5f5; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 12px;">Logo</div>';

                // ✅ Matcher servisini kullanarak etiketi alıyoruz
                const displayLabel = this.matcher.getDisplayLabel(record);

                item.innerHTML = `
                    <div class="record-info" style="display: flex; align-items: center; padding: 10px; border-bottom: 1px solid #eee; cursor: pointer;">
                        ${imageHtml}
                        <div style="flex-grow: 1;"> 
                            <div style="font-weight: 500; margin-bottom: 2px;">${record.title}</div>
                            <small style="color: #666;">${displayLabel}</small>
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

        const inputId = tabContext === 'existing' ? 'recordSearchInputExisting' : 'recordSearchInputManual';
        const containerId = tabContext === 'existing' ? 'searchResultsContainerExisting' : 'searchResultsContainerManual';

        const inputElement = document.getElementById(inputId);
        const containerElement = document.getElementById(containerId);

        if (inputElement) inputElement.value = '';
        if (containerElement) containerElement.style.display = 'none';

        if (tabContext === 'manual') {
            this.selectedRecordManual = record;
            
            // Seçilen kaydı input'ta göster
            const displayId = 'selectedRecordDisplayManual';
            const displayEl = document.getElementById(displayId);
            if(displayEl) {
                const label = this.matcher.getDisplayLabel(record);
                displayEl.value = `${record.title} (${label})`;
            }

            this.populateManualTransactionTypeSelect();
        }
        this.checkFormCompleteness();
    }

    populateManualTransactionTypeSelect() {
        const select = document.getElementById('specificManualTransactionType');
        if (!select) return;

        select.innerHTML = '<option value="" disabled selected>İşlem türü seçin...</option>';
        const parentTypes = this.allTransactionTypes.filter(type => type.hierarchy === 'parent' || !type.hierarchy);
        parentTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.id;
            option.textContent = type.alias || type.name;
            select.appendChild(option);
        });
    }

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
        const containerId = tabKey === 'existing-transaction-pane' ? 'fileListExisting' : 'fileListManual';
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
                    <button type="button" class="remove-file remove-uploaded-file" 
                            data-file-id="${file.id}" data-tab-key="${tabKey}">×</button>
                </div>
            </div>
        `).join('');
    }

    checkFormCompleteness() {
        let canSubmit = false;
        if (this.activeTab === 'manual-indexing-pane') {
            const typeSelected = document.getElementById('specificManualTransactionType')?.value;
            canSubmit = this.selectedRecordManual !== null && typeSelected;
            
            const saveManualBtn = document.getElementById('saveManualTransactionBtn');
            if (saveManualBtn) saveManualBtn.disabled = !canSubmit;
        }
    }

    async handleSubmit() {
        const btn = document.getElementById('indexDocumentsBtn');
        if (btn) btn.disabled = true;
        showNotification('İşlem kaydediliyor...', 'info');

        try {
            if (this.activeTab === 'manual-indexing-pane') {
                await this.handleManualTransactionSubmit();
            }
        } catch (error) {
            console.error('Submit error:', error);
            showNotification('Hata: ' + error.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async handleManualTransactionSubmit() {
        const transactionTypeId = document.getElementById('specificManualTransactionType')?.value;
        const deliveryDateStr = document.getElementById('manualTransactionDeliveryDate')?.value;
        const notes = document.getElementById('manualTransactionNotes')?.value;
        
        // Dosyalar buraya eklenebilir (uploadedFilesMap kullanılarak)
        
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

        if (!result.success) throw new Error(result.error || 'Manuel işlem oluşturulamadı');
        showNotification('Manuel işlem başarıyla oluşturuldu!', 'success');
        this.resetForm();
    }

    resetForm() {
        ['filesExisting', 'filesManual', 'bulkFiles'].forEach(id => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });

        ['filesExistingInfo', 'filesManualInfo', 'bulkFilesInfo'].forEach(id => {
            const info = document.getElementById(id);
            if (info) info.textContent = 'Henüz dosya seçilmedi.';
        });

        ['selectedRecordDisplayExisting', 'selectedRecordDisplayManual'].forEach(id => {
            const display = document.getElementById(id);
            if (display) display.value = '';
        });

        this.selectedRecordManual = null;
        if (this.uploadedFilesMap) this.uploadedFilesMap.clear();
        this.checkFormCompleteness();
        showNotification('Form temizlendi.', 'info');
    }

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
        if (files.length > 0) this.processFiles(files);
    }

    handleFileSelect(e) {
        const files = Array.from(e.target.files);
        this.processFiles(files);
    }

    async processFiles(files) {
        console.log('Processing bulk files:', files);
        if (this.allRecords.length === 0) await this.loadAllData();
        
        showNotification(`${files.length} PDF dosyası yükleniyor...`, 'info');
        
        for (const file of files) {
            try {
                await this.uploadFileToFirebase(file);
            } catch (error) {
                console.error('Hata:', error);
                showNotification(`${file.name} yüklenemedi.`, 'error');
            }
        }
        
        const fileInput = document.getElementById('bulkFiles');
        if (fileInput) fileInput.value = '';
        showNotification('PDF dosyaları başarıyla yüklendi.', 'success');
    }

    /**
     * ✅ REFACTOR EDİLMİŞ UPLOAD
     * Servisler kullanılarak basitleştirildi.
     */
    async uploadFileToFirebase(file) {
        try {
            const storageRef = ref(firebaseServices.storage, `pdfs/${this.currentUser.uid}/${file.name}`);
            const uploadTask = uploadBytesResumable(storageRef, file);
            
            return new Promise((resolve, reject) => {
                uploadTask.on('state_changed', 
                    (snapshot) => {},
                    (error) => reject(error),
                    async () => {
                        try {
                            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                            
                            // 1. Parsing
                            const extractedAppNumber = this.parser.extractApplicationNumber(file.name);
                            
                            // 2. Matching
                            let matchedRecordId = null;
                            let matchedRecordDisplay = null;
                            let recordOwnerType = 'self';

                            if (extractedAppNumber) {
                                const matchResult = this.matcher.findMatch(extractedAppNumber, this.allRecords);
                                if (matchResult) {
                                    matchedRecordId = matchResult.record.id;
                                    matchedRecordDisplay = this.matcher.getDisplayLabel(matchResult.record) + ` - ${matchResult.record.title}`;
                                    recordOwnerType = matchResult.record.recordOwnerType || 'self';
                                    console.log('✅ Eşleşme bulundu:', matchedRecordDisplay);
                                }
                            }
                            
                            const pdfData = {
                                fileName: file.name,
                                fileUrl: downloadURL,
                                fileSize: file.size,
                                uploadedAt: new Date(),
                                userId: this.currentUser.uid,
                                status: 'pending',
                                extractedAppNumber: extractedAppNumber,
                                matchedRecordId: matchedRecordId,
                                matchedRecordDisplay: matchedRecordDisplay,
                                recordOwnerType: recordOwnerType
                            };
                            
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

    /**
     * ✅ REFACTOR EDİLMİŞ YENİDEN TARIYICI
     */
    async reprocessMatching() {
        console.log('Dosyalar yeniden eşleştiriliyor...');
        
        for (const file of this.uploadedFiles) {
            if (file.status === 'removed' || file.status === 'indexed') continue;
            
            const extractedAppNumber = this.parser.extractApplicationNumber(file.fileName);
            
            let matchedRecordId = null;
            let matchedRecordDisplay = null;

            if (extractedAppNumber) {
                const matchResult = this.matcher.findMatch(extractedAppNumber, this.allRecords);
                if (matchResult) {
                    matchedRecordId = matchResult.record.id;
                    matchedRecordDisplay = this.matcher.getDisplayLabel(matchResult.record) + ` - ${matchResult.record.title}`;
                }
            }
            
            const updates = {
                extractedAppNumber: extractedAppNumber,
                matchedRecordId: matchedRecordId,
                matchedRecordDisplay: matchedRecordDisplay
            };
            
            try {
                await updateDoc(doc(collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION), file.id), updates);
            } catch (error) {
                console.error('Dosya güncelleme hatası:', error);
            }
        }
        
        showNotification('Dosyalar yeniden eşleştirildi!', 'success');
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
            console.error("Realtime listener hatası:", error);
        });
    }

    updateUI() {
        const hasFiles = this.uploadedFiles.length > 0;
        const fileListSection = document.getElementById('fileListSection');
        
        if (fileListSection) fileListSection.style.display = hasFiles ? 'block' : 'none';

        const fileInfo = document.getElementById('bulkFilesInfo');
        if (fileInfo) {
            const activeFiles = this.uploadedFiles.filter(f => f.status !== 'removed');
            fileInfo.textContent = hasFiles ? `${activeFiles.length} PDF dosyası mevcut.` : 'PDF dosyası seçin veya sürükleyip bırakın.';
        }

        this.renderFileLists();
        this.updateTabBadges();
    }

    renderFileLists() {
        const allFiles = this.uploadedFiles.filter(f => f.status !== 'removed');
        const matchedFiles = allFiles.filter(f => f.matchedRecordId && f.status !== 'indexed');
        const unmatchedFiles = allFiles.filter(f => !f.matchedRecordId && f.status !== 'indexed');
        const indexedFiles = allFiles.filter(f => f.status === 'indexed');
        
        this.renderFileList('allFilesList', matchedFiles);
        this.renderFileList('unmatchedFilesList', unmatchedFiles);
        this.renderFileList('indexedFilesList', indexedFiles);
    }

    renderFileList(containerId, files) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (files.length === 0) {
            let msg = 'Dosya yok';
            if (containerId === 'allFilesList') msg = 'Portföy kaydıyla eşleşen dosya yok';
            else if (containerId === 'unmatchedFilesList') msg = 'Eşleşmeyen dosya yok';
            else if (containerId === 'indexedFilesList') msg = 'Henüz indekslenmiş dosya yok';
            
            container.innerHTML = `<div class="empty-message"><div class="empty-icon">📄</div><p>${msg}</p></div>`;
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
                        <strong>Çıkarılan No:</strong> ${file.extractedAppNumber || 'Bulunamadı'}
                    </div>
                    <div class="match-status ${file.matchedRecordId ? 'matched' : 'unmatched'}">
                        ${file.matchedRecordId ? `✅ Eşleşti: ${file.matchedRecordDisplay}` : '❌ Eşleşmedi'}
                    </div>
                </div>
                <div class="pdf-actions">
                    <button class="action-btn view-btn" onclick="window.open('${file.fileUrl}', '_blank')">👁️</button>
                    ${file.status === 'pending' ? `
                        <button class="action-btn complete-btn" onclick="window.location.href='indexing-detail.html?pdfId=${file.id}'">✨ İndeksle</button>
                    ` : ''}
                    <button class="action-btn danger-btn" onclick="window.indexingModule.deleteFilePermanently('${file.id}')">🗑️</button>
                </div>
            </div>
        `).join('');
    }

    updateTabBadges() {
        const allFiles = this.uploadedFiles.filter(f => f.status !== 'removed');
        const matched = allFiles.filter(f => f.matchedRecordId && f.status !== 'indexed').length;
        const unmatched = allFiles.filter(f => !f.matchedRecordId && f.status !== 'indexed').length;
        const indexed = allFiles.filter(f => f.status === 'indexed').length;
        
        const setBadge = (id, count) => { const el = document.getElementById(id); if(el) el.textContent = count; };
        setBadge('allCount', matched);
        setBadge('unmatchedCount', unmatched);
        setBadge('indexedCount', indexed);
    }

    switchFileTab(targetPane) {
        document.querySelectorAll('#fileListSection .tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('#fileListSection .tab-pane').forEach(pane => pane.classList.remove('active'));

        const selectedTab = document.querySelector(`#fileListSection [data-tab="${targetPane}"]`);
        if (selectedTab) selectedTab.classList.add('active');

        const selectedPane = document.getElementById(targetPane);
        if (selectedPane) selectedPane.classList.add('active');

        this.activeFileTab = targetPane;
    }

    async deleteFilePermanently(fileId) {
        if (!confirm('Dosyayı silmek istiyor musunuz?')) return;
        try {
            const fileToDelete = this.uploadedFiles.find(f => f.id === fileId);
            if (!fileToDelete) return;

            if (fileToDelete.fileUrl) {
                try {
                    await deleteObject(ref(firebaseServices.storage, `pdfs/${this.currentUser.uid}/${fileToDelete.fileName}`));
                } catch (e) { console.warn('Storage silme hatası:', e); }
            }
            await deleteDoc(doc(collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION), fileId));
            showNotification('Dosya silindi.', 'success');
        } catch (error) {
            showNotification('Silme hatası.', 'error');
        }
    }

    destroy() {
        if (this.unsubscribe) this.unsubscribe();
    }
}