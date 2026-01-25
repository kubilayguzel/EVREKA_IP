// public/js/indexing/bulk-upload-manager.js

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
import { FilenameParser } from './filename-parser.js';
import { RecordMatcher } from './record-matcher.js';

const UNINDEXED_PDFS_COLLECTION = 'unindexed_pdfs';

export class BulkIndexingModule {
    constructor() {
        this.uploadedFiles = [];
        this.currentUser = null;
        
        this.activeTab = 'manual-indexing-pane'; // Varsayılan tab
        this.activeFileTab = 'all-files-pane';
        this.unsubscribe = null;
        
        this.allRecords = [];
        this.allTransactionTypes = [];
        this.uploadedFilesMap = new Map(); 
        this.selectedRecordManual = null;

        // Servisleri Başlat
        this.parser = new FilenameParser();
        this.matcher = new RecordMatcher();

        this.init();
    }

    async init() {
    try {
        this.currentUser = authService.getCurrentUser();
        if (!this.currentUser) return;

        // 1. Önce portföyü yükle ve bekle
        await this.loadAllData();
        
        // 2. Veriler hazır olduğunda dinleyiciyi başlat
        if (this.allRecords.length > 0) {
            this.setupRealtimeListener();
        }

        this.setupEventListeners();
        this.updateUI();
    } catch (error) {
        console.error('Init hatası:', error);
    }
}

    async loadAllData() {
    try {
        console.log('⏳ Portföy ve işlem tipleri yükleniyor...');
        
        // Matcher'ın tüm kayıtları tarayabilmesi için 'getAllRecords' kullanımı daha güvenlidir
        const [recordsResult, transactionTypesResult] = await Promise.all([
            ipRecordsService.getAllRecords ? ipRecordsService.getAllRecords() : ipRecordsService.getRecords(),
            transactionTypeService.getTransactionTypes()
        ]);

        // Portföy Kayıtlarını Yükle
        if (recordsResult && recordsResult.success) {
            this.allRecords = recordsResult.data || [];
            console.log(`📊 ${this.allRecords.length} adet portföy kaydı eşleşme için hazır.`);
        } else {
            this.allRecords = [];
            console.warn('⚠️ Portföy kayıtları yüklenemedi, eşleşme yapılamayacak.');
        }

        // İşlem Tiplerini Yükle
        if (transactionTypesResult && transactionTypesResult.success) {
            this.allTransactionTypes = transactionTypesResult.data || [];
        }

        // Eğer veriler boş geldiyse kullanıcıyı bilgilendir
        if (this.allRecords.length === 0) {
            showNotification('Sistemde eşleştirilecek portföy kaydı bulunamadı.', 'warning');
        }

    } catch (error) {
        console.error('loadAllData hatası:', error);
        showNotification('Veriler yüklenirken hata oluştu: ' + error.message, 'error');
        // Hatayı yukarı (init'e) fırlatıyoruz ki işlem akışı durması gerektiğini bilsin
        throw error; 
    }
}

    setupEventListeners() {
        this.setupBulkUploadListeners();
        this.setupMainTabListeners();

        // Manuel İşlem Kaydet Butonu
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
        // ETEBS Manuel Yükleme (Toplu) için listenerlar
        const uploadButton = document.getElementById('bulkFilesButton');
        const fileInput = document.getElementById('bulkFiles');

        if (uploadButton && fileInput) {
            uploadButton.addEventListener('click', () => fileInput.click());
            
            uploadButton.addEventListener('dragover', (e) => this.handleDragOver(e));
            uploadButton.addEventListener('dragleave', (e) => this.handleDragLeave(e));
            uploadButton.addEventListener('drop', (e) => this.handleDrop(e));
            
            fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        // Dosya listesi tab geçişleri
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('file-tab-btn')) {
                const targetPane = e.target.getAttribute('data-target');
                if (targetPane) this.switchFileTab(targetPane);
            }
        });
    }

    setupMainTabListeners() {
        // Ana tab geçişlerini dinle (HTML'deki data-tab attribute'una göre)
        const tabBtns = document.querySelectorAll('.tab-navigation .nav-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabId = e.currentTarget.getAttribute('data-tab');
                this.activateTab(tabId);
            });
        });
    }

    setupManualTransactionListeners() {
        const recordSearchInput = document.getElementById('recordSearchInputManual');
        const recordSearchContainer = document.getElementById('searchResultsContainerManual');
        
        if (recordSearchInput) {
            recordSearchInput.addEventListener('input', (e) => this.searchRecords(e.target.value, 'manual'));
            // Blur gecikmeli olsun ki tıklama algılansın
            recordSearchInput.addEventListener('blur', () => {
                setTimeout(() => { 
                    if (recordSearchContainer) recordSearchContainer.style.display = 'none'; 
                }, 200);
            });
        }

        // Manuel işlem dosya yükleme alanı
        const filesManual = document.getElementById('filesManual');
        const filesManualButton = document.getElementById('filesManualButton');
        
        if (filesManual) {
            filesManual.addEventListener('change', (e) => {
                this.handleFileChange(e, 'manual-indexing-pane');
                // Bilgi metni gösterimi (Opsiyonel, tasarımda kaldırıldıysa gerek yok)
                const info = document.getElementById('filesManualInfo');
                if (info) info.textContent = `${e.target.files.length} dosya seçildi.`;
            });
        }

        if (filesManualButton) {
            filesManualButton.addEventListener('click', () => filesManual?.click());
            
            // Drag & Drop desteği - Manuel Alan İçin
            filesManualButton.addEventListener('dragover', (e) => {
                e.preventDefault();
                filesManualButton.style.borderColor = '#1e3c72';
                filesManualButton.style.backgroundColor = '#f0f7ff';
            });
            
            filesManualButton.addEventListener('dragleave', (e) => {
                e.preventDefault();
                filesManualButton.style.borderColor = '#cbd5e1';
                filesManualButton.style.backgroundColor = '#fff';
            });
            
            filesManualButton.addEventListener('drop', (e) => {
                e.preventDefault();
                filesManualButton.style.borderColor = '#cbd5e1';
                filesManualButton.style.backgroundColor = '#fff';
                
                if(e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    if(filesManual) {
                        filesManual.files = e.dataTransfer.files;
                        // Change eventini manuel tetikle
                        const event = new Event('change');
                        filesManual.dispatchEvent(event);
                    }
                }
            });
        }
    }

    setupCommonFormListeners() {
        // Yüklenen dosyayı listeden silme butonu
        document.addEventListener('click', (e) => {
            if (e.target.closest('.remove-uploaded-file')) {
                const btn = e.target.closest('.remove-uploaded-file');
                const fileId = btn.dataset.fileId;
                const tabKey = btn.dataset.tabKey;
                
                let files = this.uploadedFilesMap.get(tabKey) || [];
                this.uploadedFilesMap.set(tabKey, files.filter(f => f.id !== fileId));
                
                this.renderUploadedFilesList(tabKey);
                this.checkFormCompleteness();
            }
        });
    }

    activateTab(tabName) {
        this.activeTab = tabName;
        // Tab değişince form kontrolü yap (buton durumu için)
        this.checkFormCompleteness();
    }

    searchRecords(query, tabContext) {
        const containerId = 'searchResultsContainerManual';
        const container = document.getElementById(containerId);

        if (!container) return;
        if (query.length < 2) {
            container.style.display = 'none';
            return;
        }

        container.innerHTML = '';
        const lowerQuery = query.toLowerCase();
        
        const filtered = this.allRecords.filter(r => 
            (r.title && r.title.toLowerCase().includes(lowerQuery)) ||
            (r.applicationNumber && r.applicationNumber.toLowerCase().includes(lowerQuery))
        );
        
        if (filtered.length === 0) {
            container.innerHTML = '<div style="padding:10px; color:#666;">Kayıt bulunamadı.</div>';
        } else {
            // İlk 10 kaydı göster
            filtered.slice(0, 10).forEach(record => {
                const item = document.createElement('div');
                item.style.padding = '10px 15px';
                item.style.borderBottom = '1px solid #eee';
                item.style.cursor = 'pointer';
                item.style.transition = 'background 0.2s';
                
                item.addEventListener('mouseenter', () => item.style.background = '#f8f9fa');
                item.addEventListener('mouseleave', () => item.style.background = 'white');

                const label = this.matcher.getDisplayLabel(record);
                
                item.innerHTML = `
                    <div style="font-weight: 600; color: #1e3c72;">${record.title || '(İsimsiz)'}</div>
                    <div style="font-size: 0.85em; color: #666;">${label} - ${record.applicationNumber}</div>
                `;
                
                item.addEventListener('click', (e) => {
                    this.selectRecord(record);
                    container.style.display = 'none';
                });
                container.appendChild(item);
            });
        }
        container.style.display = 'block';
    }

    selectRecord(record) {
        this.selectedRecordManual = record;
        
        const inputElement = document.getElementById('recordSearchInputManual');
        const displayElement = document.getElementById('selectedRecordDisplayManual');
        
        if (inputElement) inputElement.value = ''; // Arama kutusunu temizle
        if (displayElement) {
            const label = this.matcher.getDisplayLabel(record);
            displayElement.value = `${record.title} (${label}) - ${record.applicationNumber}`;
        }

        this.populateManualTransactionTypeSelect();
        this.checkFormCompleteness();
    }

    populateManualTransactionTypeSelect() {
        const select = document.getElementById('specificManualTransactionType');
        if (!select) return;

        select.innerHTML = '<option value="" disabled selected>İşlem türü seçin...</option>';
        // Sadece parent olabilen tipleri getir
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
        
        if (!this.uploadedFilesMap.has(tabKey)) {
            this.uploadedFilesMap.set(tabKey, []);
        }
        
        const currentFiles = this.uploadedFilesMap.get(tabKey);
        
        files.forEach(file => {
            currentFiles.push({
                id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                fileObject: file,
                documentDesignation: '' // Varsayılan designation
            });
        });
        
        this.renderUploadedFilesList(tabKey);
        this.checkFormCompleteness();
    }

    renderUploadedFilesList(tabKey) {
        const containerId = 'fileListManual';
        const container = document.getElementById(containerId);
        if (!container) return;

        const files = this.uploadedFilesMap.get(tabKey) || [];
        
        if (files.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = files.map(file => `
            <div class="file-item">
                <div class="file-item-name">
                    <i class="fas fa-file-pdf text-danger mr-2"></i>
                    ${file.fileObject.name}
                </div>
                <div class="file-item-controls">
                    <button type="button" class="remove-uploaded-file" 
                            data-file-id="${file.id}" data-tab-key="${tabKey}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    checkFormCompleteness() {
        // Sadece Manuel Tabı için kontrol
        if (this.activeTab === 'manual-indexing-pane') {
            const typeSelected = document.getElementById('specificManualTransactionType')?.value;
            // Kayıt seçili mi ve işlem türü seçili mi?
            const canSubmit = this.selectedRecordManual !== null && typeSelected && typeSelected !== "";
            
            const saveManualBtn = document.getElementById('saveManualTransactionBtn');
            if (saveManualBtn) {
                saveManualBtn.disabled = !canSubmit;
                // Butonun opaklığını da ayarla
                saveManualBtn.style.opacity = canSubmit ? '1' : '0.6';
            }
        }
    }

    // --- MANUEL İŞLEM KAYDETME (GÜNCELLENEN METOD) ---
    async handleManualTransactionSubmit() {
        const transactionTypeId = document.getElementById('specificManualTransactionType')?.value;
        const deliveryDateStr = document.getElementById('manualTransactionDeliveryDate')?.value;
        const notes = document.getElementById('manualTransactionNotes')?.value;
        
        if (!this.selectedRecordManual || !transactionTypeId) {
            showNotification('Lütfen işlem türü ve kayıt seçiniz.', 'warning');
            return;
        }

        const submitBtn = document.getElementById('saveManualTransactionBtn');
        if(submitBtn) submitBtn.disabled = true;
        showNotification('Dosyalar yükleniyor ve işlem kaydediliyor...', 'info');

        try {
            // 1. Dosyaları Firebase Storage'a Yükle
            const filesToUpload = this.uploadedFilesMap.get('manual-indexing-pane') || [];
            const uploadedDocuments = [];

            if (filesToUpload.length > 0) {
                for (const fileItem of filesToUpload) {
                    const file = fileItem.fileObject;
                    const timestamp = Date.now();
                    const uniqueFileName = `${timestamp}_${file.name}`;
                    const storagePath = `pdfs/${this.currentUser.uid}/${uniqueFileName}`;
                    const storageRef = ref(firebaseServices.storage, storagePath);
                    
                    // Upload
                    const uploadTask = await uploadBytesResumable(storageRef, file);
                    const downloadURL = await getDownloadURL(uploadTask.ref);

                    // Documents Array Yapısı
                    uploadedDocuments.push({
                        id: generateUUID(),
                        name: file.name,
                        type: file.type || 'application/pdf',
                        downloadURL: downloadURL,
                        uploadedAt: new Date().toISOString(),
                        documentDesignation: fileItem.documentDesignation || 'Resmi Yazı' // Varsayılan designation
                    });
                }
            }

            // 2. Transaction Objesini Hazırla
            const transactionData = {
                type: transactionTypeId,
                transactionHierarchy: 'parent',
                deliveryDate: deliveryDateStr ? new Date(deliveryDateStr).toISOString() : null,
                
                // Description ve Notes alanları
                description: notes || '', 
                notes: notes || '',
                
                timestamp: new Date().toISOString(),
                
                // Documents Alanı (Array)
                documents: uploadedDocuments,
                
                // Kullanıcı Meta Verisi
                userId: this.currentUser.uid,
                userName: this.currentUser.displayName || this.currentUser.email || 'Kullanıcı',
                userEmail: this.currentUser.email
            };

            // 3. Veritabanına Ekle
            const result = await ipRecordsService.addTransactionToRecord(
                this.selectedRecordManual.id, 
                transactionData
            );

            if (!result.success) throw new Error(result.error || 'İşlem oluşturulamadı');
            
            showNotification('İşlem başarıyla kaydedildi!', 'success');
            
            // 4. Formu Temizle
            this.resetForm();

        } catch (error) {
            console.error('Manuel işlem hatası:', error);
            showNotification('Hata: ' + error.message, 'error');
        } finally {
            if(submitBtn) {
                submitBtn.disabled = false;
                this.checkFormCompleteness(); // Buton durumunu güncelle
            }
        }
    }

    resetForm() {
        // Inputları Temizle
        const inputs = [
            'recordSearchInputManual', 
            'selectedRecordDisplayManual', 
            'manualTransactionDeliveryDate', 
            'manualTransactionNotes',
            'filesManual'
        ];
        
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        const select = document.getElementById('specificManualTransactionType');
        if (select) select.selectedIndex = 0;

        // Değişkenleri Sıfırla
        this.selectedRecordManual = null;
        this.uploadedFilesMap.set('manual-indexing-pane', []);
        
        // Listeyi Temizle
        this.renderUploadedFilesList('manual-indexing-pane');
        
        // Buton Durumunu Güncelle
        this.checkFormCompleteness();
    }

    // --- ETEBS / BULK YÜKLEME METODLARI (MEVCUT) ---
    
    handleDragOver(e) { e.preventDefault(); }
    handleDragLeave(e) { e.preventDefault(); }
    handleDrop(e) {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter(file => file.type === 'application/pdf');
        if (files.length > 0) this.processFiles(files);
    }

    handleFileSelect(e) {
        const files = Array.from(e.target.files);
        this.processFiles(files);
    }

    async processFiles(files) {
        if (this.allRecords.length === 0) await this.loadAllData();
        showNotification(`${files.length} PDF dosyası işleniyor...`, 'info');
        
        for (const file of files) {
            await this.uploadFileToFirebase(file);
        }
        
        const fileInput = document.getElementById('bulkFiles');
        if (fileInput) fileInput.value = '';
    }

    // ETEBS / Bulk için Upload (Collection'a kayıt atar)
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
                            
                            const extractedAppNumber = this.parser.extractApplicationNumber(file.name);
                            let matchedRecordId = null;
                            let matchedRecordDisplay = null;
                            let recordOwnerType = 'self';

                            if (extractedAppNumber) {
                                const matchResult = this.matcher.findMatch(extractedAppNumber, this.allRecords);
                                if (matchResult) {
                                    matchedRecordId = matchResult.record.id;
                                    matchedRecordDisplay = this.matcher.getDisplayLabel(matchResult.record) + ` - ${matchResult.record.title}`;
                                    recordOwnerType = matchResult.record.recordOwnerType || 'self';
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
            console.error(error);
        }
    }

    // public/js/indexing/bulk-upload-manager.js içindeki fonksiyon

setupRealtimeListener() {
    if (!this.currentUser) return;
    
    console.log("📡 Firestore dinleyicisi kuruluyor...");

    const q = query(
        collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION),
        where('userId', '==', this.currentUser.uid),
        orderBy('uploadedAt', 'desc')
    );

    this.unsubscribe = onSnapshot(q, (snapshot) => {
        // MATCHING İÇİN ALLRECORDS KONTROLÜ
        if (!this.allRecords || this.allRecords.length === 0) {
            console.warn("⚠️ Portföy kayıtları (allRecords) henüz yüklenmedi veya boş. Eşleşme denemesi atlanıyor.");
        }

        const files = snapshot.docs.map(doc => {
            const data = doc.data();
            let fileObj = {
                id: doc.id,
                ...data,
                uploadedAt: data.uploadedAt ? data.uploadedAt.toDate() : new Date()
            };

            // Eşleşme denemesi
            // unindexed_pdfs tablosundaki alan 'dosyaNo' veya 'applicationNo' olabilir
            const searchKey = fileObj.dosyaNo || fileObj.applicationNo;

            if (searchKey && this.allRecords.length > 0 && !fileObj.matchedRecordId) {
                console.log(`🔍 Eşleşme deneniyor: ${searchKey}`);
                const matchResult = this.matcher.findMatch(searchKey, this.allRecords);
                
                if (matchResult) {
                    console.log(`✅ EŞLEŞME BAŞARILI: ${searchKey} -> ${matchResult.record.title}`);
                    fileObj.matchedRecordId = matchResult.record.id;
                    fileObj.matchedRecordDisplay = this.matcher.getDisplayLabel(matchResult.record);
                    fileObj.recordOwnerType = matchResult.record.recordOwnerType || 'self';
                } else {
                    console.log(`❌ Eşleşme bulunamadı: ${searchKey}`);
                }
            } else if (!searchKey) {
                console.warn(`⚠️ Dosya ID ${fileObj.id} için 'dosyaNo' alanı boş!`, data);
            }

            return fileObj;
        });

        this.uploadedFiles = files;
        this.updateUI(); 
    });
}

    updateUI() {
    const allFiles = this.uploadedFiles.filter(f => f.status !== 'removed');
    
    // Anlık olarak matcher tarafından eşleştirilenleri de 'matched' say
    const matchedFiles = allFiles.filter(f => (f.matchedRecordId || f.autoMatched) && f.status !== 'indexed');
    const unmatchedFiles = allFiles.filter(f => (!f.matchedRecordId && !f.autoMatched) && f.status !== 'indexed');
    const indexedFiles = allFiles.filter(f => f.status === 'indexed');

    this.renderFileList('allFilesList', allFiles.filter(f => f.status !== 'indexed'));
    this.renderFileList('unmatchedFilesList', unmatchedFiles);
    this.renderFileList('indexedFilesList', indexedFiles);

    this.setBadge('allCount', matchedFiles.length + unmatchedFiles.length);
    this.setBadge('unmatchedCount', unmatchedFiles.length);
    this.setBadge('indexedCount', indexedFiles.length);
}

    setBadge(id, count) {
        const el = document.getElementById(id);
        if (el) el.textContent = count;
    }

    renderFileList(containerId, files) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (files.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">Liste boş</div>';
            return;
        }

        container.innerHTML = files.map(file => `
            <div class="pdf-list-item ${file.matchedRecordId ? 'matched' : 'unmatched'}">
                <div style="display:flex; align-items:center;">
                    <div class="pdf-icon"><i class="fas fa-file-pdf"></i></div>
                    <div class="pdf-details">
                        <div class="pdf-name">${file.fileName}</div>
                        <div class="pdf-meta">
                            ${file.extractedAppNumber ? `No: ${file.extractedAppNumber}` : 'No Bulunamadı'}
                        </div>
                    </div>
                </div>
                <div class="pdf-actions">
                <button class="btn btn-light btn-sm pdf-action-btn" title="Görüntüle"
                        onclick="window.open('${file.fileUrl}', '_blank')">
                    <i class="fas fa-eye"></i>
                </button>

                ${file.status === 'pending' ? `
                    <button class="btn btn-light btn-sm pdf-action-btn" 
                            title="İndeksle"
                            onclick="window.location.href='indexing-detail.html?pdfId=${file.id}'">
                        <i class="fas fa-check"></i>
                    </button>
                ` : ''}

                <button class="btn btn-light btn-sm pdf-action-btn pdf-action-danger" title="Sil"
                        onclick="window.indexingModule.deleteFilePermanently('${file.id}')">
                    <i class="fas fa-trash"></i>
                </button>
                </div>
            </div>
        `).join('');
    }

    switchFileTab(targetPane) {
        // Tab butonlarını güncelle
        document.querySelectorAll('.file-tab-btn').forEach(btn => {
            if(btn.dataset.target === targetPane) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        // Pane içeriğini güncelle (HTML'de class tab-pane ise)
        document.querySelectorAll('.file-tab-pane').forEach(pane => {
            pane.classList.remove('active');
            // !important kullandığımız için class toggle yeterli olmayabilir, JS ile display kontrolü de eklenebilir
            // Ancak CSS'te .active { display: block !important } tanımlıysa class yeterlidir.
        });
        
        const activePane = document.getElementById(targetPane);
        if(activePane) activePane.classList.add('active');
    }

    async deleteFilePermanently(fileId) {
        if (!confirm('Dosyayı silmek istiyor musunuz?')) return;
        try {
            const fileToDelete = this.uploadedFiles.find(f => f.id === fileId);
            if (!fileToDelete) return;

            if (fileToDelete.fileUrl) {
                try {
                    // URL'den path çıkarma veya ref oluşturma
                    const storageRef = ref(firebaseServices.storage, fileToDelete.fileUrl);
                    await deleteObject(storageRef);
                } catch (e) { console.warn('Storage silme hatası:', e); }
            }
            await deleteDoc(doc(collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION), fileId));
            showNotification('Dosya silindi.', 'success');
        } catch (error) {
            showNotification('Silme hatası.', 'error');
        }
    }
}