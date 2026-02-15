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
    onSnapshot,
    getDocs,
    limit
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { 
    ref, 
    uploadBytesResumable, 
    getDownloadURL,
    deleteObject 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

import { showNotification, debounce } from '../../utils.js';
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
        this.currentRecordTransactions = []; // Seçili markanın işlem geçmişini tutacak

        // Manuel aramada async sonuçların birbiriyle yarışmasını engellemek için
        this._manualSearchSeq = 0;

        // UI'daki inline onclick'ler (örn. dosya sil) bu referansa bakıyor
        if (typeof window !== 'undefined') {
            window.indexingModule = this;
        }

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
            
            const [recordsResult, transactionTypesResult] = await Promise.all([
                ipRecordsService.getRecords(), 
                transactionTypeService.getTransactionTypes()
            ]);

            let recordsArray = [];
            if (recordsResult) {
                if (Array.isArray(recordsResult.data)) {
                    recordsArray = recordsResult.data;
                } else if (Array.isArray(recordsResult.items)) {
                    recordsArray = recordsResult.items;
                } else if (Array.isArray(recordsResult)) {
                    recordsArray = recordsResult;
                }
            }

            this.allRecords = recordsArray;
            this._isDataLoaded = true; // 🔥 YENİ: Veri çekme işleminin bittiğini işaretle

            if (this.allRecords.length > 0) {
                console.log(`📊 ${this.allRecords.length} adet portföy kaydı eşleşme için hazır.`);
            } else {
                // 🔥 DÜZELTME: Uyarı mesajı kaldırıldı. Sadece konsola bilgi geçiyoruz.
                console.info('ℹ️ Portföy şu an boş. Aramalar doğrudan bülten üzerinden yapılacak.');
            }

            if (transactionTypesResult && transactionTypesResult.success) {
                this.allTransactionTypes = transactionTypesResult.data || [];
            }

        } catch (error) {
            console.error('loadAllData hatası:', error);
            showNotification('Veriler yüklenirken hata oluştu: ' + error.message, 'error');
            this._isDataLoaded = true; // Hata olsa bile kilidi aç
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
        
        // 🔥 1. Ana İşlem (Parent) değiştiğinde Alt İşlemleri (Child) getir ve butonu kontrol et
        const manualTransactionType = document.getElementById('specificManualTransactionType');
        if (manualTransactionType) {
            manualTransactionType.addEventListener('change', () => {
                this.updateManualChildOptions();
                this.checkFormCompleteness();
            });
        }

        // 🔥 2. Alt İşlem (Child) değiştiğinde bağlanabilecek mevcut Ana İşlemleri (Parent) getir
        const manualChildType = document.getElementById('manualChildTransactionType');
        if (manualChildType) {
            manualChildType.addEventListener('change', () => {
                this.updateManualParentOptions();
                this.checkFormCompleteness();
            });
        }

        // 🔥 3. Mevcut Parent seçici değiştiğinde Kaydet butonunun durumunu (canSubmit) kontrol et
        const manualParentSelect = document.getElementById('manualExistingParentSelect');
        if (manualParentSelect) {
            manualParentSelect.addEventListener('change', () => this.checkFormCompleteness());
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
        const clearSelectedBtn = document.getElementById('clearSelectedRecordManual');
        
        if (recordSearchInput) {
            recordSearchInput.addEventListener(
                'input',
                debounce((e) => this.searchRecords(e.target.value, 'manual'), 100)
            );
            // Blur gecikmeli olsun ki tıklama algılansın
            recordSearchInput.addEventListener('blur', () => {
                setTimeout(() => { 
                    if (recordSearchContainer) recordSearchContainer.style.display = 'none'; 
                }, 200);
            });
        }

        // Seçili kaydı kaldır (Create Task > İşleme Konu Varlık davranışı)
        if (clearSelectedBtn) {
            clearSelectedBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.clearSelectedRecordManual();
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
        this.checkFormCompleteness();

        // 🔥 ETEBS Tebligatları sekmesine geçildiğinde loader ile veriyi tazele
        if (tabName === 'etebs-notifications-pane') {
            // ETEBSManager nesnesine window üzerinden ulaşıyoruz (etebs-module.js tarafından set edilir)
            if (window.etebsManager) {
                // loadAndProcessDocuments metodu SimpleLoadingController'ı otomatik kullanır
                window.etebsManager.loadAndProcessDocuments(false);
            }
        }
    }

    async searchRecords(queryText, tabContext) {
        const containerId = 'searchResultsContainerManual';
        const container = document.getElementById(containerId);
        if (!container) return;

        const rawQuery = (queryText || '').trim();
        if (rawQuery.length < 3) {
            container.style.display = 'none';
            return;
        }

        // Sadece yükleme işlemi henüz bitmediyse beklet, bittiyse (portföy sıfır olsa bile) devam et.
        if (this._isDataLoaded !== true) {
            container.innerHTML = '<div style="padding:10px; color:#e67e22;"><i class="fas fa-spinner fa-spin"></i> Veriler hazırlanıyor...</div>';
            container.style.display = 'block';
            return;
        }

        const seq = ++this._manualSearchSeq;
        const lowerQuery = rawQuery.toLowerCase();
        const upperQuery = rawQuery.toUpperCase();

        // 1. Portföy Araması (allRecords içinden)
        let filteredPortfolio = this.allRecords.filter(r => {
            const title = (r.title || r.markName || '').toLowerCase();
            const appNo = String(r.applicationNumber || r.applicationNo || r.wipoIR || r.aripoIR || '').toLowerCase();
            return title.includes(lowerQuery) || appNo.includes(lowerQuery);
        }).map(r => ({ ...r, _isPortfolio: true }));

        // 2. Bülten Araması (trademarkBulletinRecords koleksiyonundan - Doğru alanlarla)
        let filteredBulletins = [];
        try {
            const bulletinsRef = collection(firebaseServices.db, 'trademarkBulletinRecords');

            // TaskDataManager.js'deki orijinal arama mantığının aynısı
            const bQueries = [
                query(bulletinsRef, where('markName', '>=', lowerQuery), where('markName', '<=', lowerQuery + '\uf8ff'), limit(15)),
                query(bulletinsRef, where('markName', '>=', upperQuery), where('markName', '<=', upperQuery + '\uf8ff'), limit(15)),
                query(bulletinsRef, where('applicationNo', '>=', lowerQuery), where('applicationNo', '<=', lowerQuery + '\uf8ff'), limit(15)),
                query(bulletinsRef, where('applicationNo', '>=', upperQuery), where('applicationNo', '<=', upperQuery + '\uf8ff'), limit(15))
            ];

            const bSnapshots = await Promise.all(bQueries.map(q => getDocs(q)));
            
            bSnapshots.forEach(snap => {
                snap.forEach(d => {
                    const data = d.data();
                    
                    // Tekilleştirme: Bu başvuru numarası zaten portföy sonuçlarında (filteredPortfolio) var mı?
                    const safeAppNo = String(data.applicationNo || data.applicationNumber || '').replace(/[\s\/]/g, '');
                    const alreadyInPortfolio = filteredPortfolio.some(p => {
                        const pNo = String(p.applicationNumber || p.applicationNo || '').replace(/[\s\/]/g, '');
                        return pNo === safeAppNo;
                    });

                    // Çifte Kayıt Kontrolü: 4 farklı sorgudan aynı bülten kaydı iki kez gelebilir
                    const alreadyInBulletins = filteredBulletins.some(b => b.id === d.id);

                    if (!alreadyInPortfolio && !alreadyInBulletins) {
                        filteredBulletins.push({ id: d.id, ...data, _isBulletin: true });
                    }
                });
            });
        } catch (err) {
            console.warn("Bülten araması hatası:", err);
        }

        if (seq !== this._manualSearchSeq) return; // Yarış koşulu önlemi

        const finalResults = [...filteredPortfolio.slice(0, 15), ...filteredBulletins];

        container.innerHTML = '';
        container.style.display = 'block';
        
        if (finalResults.length === 0) {
            container.innerHTML = '<div style="padding:10px; color:#666;">Kayıt bulunamadı.</div>';
            return;
        }

        finalResults.forEach(record => {
            const item = document.createElement('div');
            item.className = "search-result-item";
            item.style.cssText = `display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid #eee; cursor: pointer; transition: background 0.1s;`;
            item.onmouseenter = () => item.style.backgroundColor = '#f0f7ff';
            item.onmouseleave = () => item.style.backgroundColor = 'white';

            // Verileri yakalamak için güvenli property fallback'leri
            const title = record.markName || record.title || record.brandName || '(İsimsiz)';
            const appNo = record.applicationNo || record.applicationNumber || record.wipoIR || record.aripoIR || '-';
            
            const badge = record._isBulletin 
                ? '<span class="badge badge-warning mr-2" style="font-size: 0.7em;">BÜLTEN</span>' 
                : '<span class="badge badge-primary mr-2" style="font-size: 0.7em;">PORTFÖY</span>';

            item.innerHTML = `
                <div class="result-img-wrapper" style="width: 45px; height: 45px; margin-right: 12px; flex-shrink: 0; display:flex; align-items:center; justify-content:center; background:#f8f9fa; border:1px solid #dee2e6; border-radius:4px;">
                    <i class="fas fa-image text-muted"></i>
                </div>
                <div style="flex-grow: 1; min-width: 0;">
                    <div style="font-weight: 600; color: #1e3c72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${badge}${this._highlightText(title, rawQuery)}
                    </div>
                    <div style="font-size: 0.85em; color: #666;">${this._highlightText(appNo, rawQuery)}</div>
                </div>
            `;

            item.addEventListener('click', () => {
                this.selectRecord(record);
                container.style.display = 'none';
            });

            this._loadResultImage(record, item.querySelector('.result-img-wrapper'));
            container.appendChild(item);
        });
    }

    // YENİ: Metin Vurgulama Yardımcısı
    _highlightText(text, query) {
        if (!text) return '';
        if (!query) return text;
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<span style="background-color:#fff3cd; color:#333;">$1</span>');
    }

    // YENİ: Liste Resmi Yükleyicisi
    async _loadResultImage(record, wrapperEl) {
        try {
            const url = await this._resolveRecordImageUrl(record);
            if (url) {
                wrapperEl.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:contain; border-radius:3px;">`;
                wrapperEl.style.backgroundColor = 'white';
            }
        } catch (e) {
            // Hata olursa ikon kalır
        }
    }

    selectRecord(record) {
        this.selectedRecordManual = record;
        
        const inputElement = document.getElementById('recordSearchInputManual');
        
        if (inputElement) inputElement.value = ''; // Arama kutusunu temizle

        // Seçili kayıt kartını göster
        this.renderSelectedRecordCardManual(record);

        this.populateManualTransactionTypeSelect();
        // Markanın mevcut işlem geçmişini (Parent tespiti için) sunucudan çek
        this.currentRecordTransactions = [];
        ipRecordsService.getRecordTransactions(record.id).then(res => {
            if(res.success) this.currentRecordTransactions = res.data || [];
        });
        this.checkFormCompleteness();
    }

    async renderSelectedRecordCardManual(record) {
        const emptyEl = document.getElementById('selectedRecordEmptyManual');
        const containerEl = document.getElementById('selectedRecordContainerManual');
        const labelEl = document.getElementById('selectedRecordLabelManual');
        const numberEl = document.getElementById('selectedRecordNumberManual');
        const imgEl = document.getElementById('selectedRecordImageManual');
        const phEl = document.getElementById('selectedRecordPlaceholderManual');

        if (emptyEl) emptyEl.style.display = 'none';
        if (containerEl) containerEl.style.display = 'block';

        const title = record.title || record.markName || record.name || '(İsimsiz)';
        const appNo = record.applicationNumber || record.applicationNo || record.wipoIR || record.aripoIR || record.dosyaNo || record.fileNo || '-';

        if (labelEl) labelEl.textContent = title;
        if (numberEl) numberEl.textContent = appNo;

        // Görsel sıfırla
        if (imgEl) { imgEl.style.display = 'none'; imgEl.src = ''; }
        if (phEl) {
            phEl.style.display = 'flex';
            phEl.innerHTML = '<i class="fas fa-image" style="font-size: 24px;"></i>';
        }

        try {
            const imageUrl = await this._resolveRecordImageUrl(record);
            if (imageUrl && imgEl) {
                imgEl.src = imageUrl;
                imgEl.style.display = 'block';
                if (phEl) phEl.style.display = 'none';
            }
        } catch (err) {
            console.warn('Manuel kayıt görseli çözümlenemedi:', err);
        }
    }

    // Metin Vurgulama Yardımcısı
    _highlightText(text, query) {
        if (!text) return '';
        if (!query) return text;
        try {
            const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            return text.replace(regex, '<span style="background-color:#fff3cd; color:#333;">$1</span>');
        } catch(e) { return text; }
    }

    // Liste Resmi Yükleyicisi (Listenin donmasını engeller)
    async _loadResultImage(record, wrapperEl) {
        try {
            const url = await this._resolveRecordImageUrl(record);
            if (url) {
                wrapperEl.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:contain; border-radius:3px;">`;
                wrapperEl.style.backgroundColor = 'white';
            }
        } catch (e) {
            // Hata olursa ikon kalır, sorun yok
        }
    }

    async _resolveRecordImageUrl(record) {
        const potentialPath = record.imagePath || record.brandImageUrl || record.image || record.logo || record.imageUrl;
        if (!potentialPath) return null;

        if (typeof potentialPath === 'string' && (potentialPath.startsWith('http') || potentialPath.startsWith('data:'))) {
            return potentialPath;
        }

        // Storage path ise çöz (örn: "images/..." veya "logos/..." gibi)
        try {
            const storageRef = ref(firebaseServices.storage, potentialPath);
            return await getDownloadURL(storageRef);
        } catch (e) {
            return null;
        }
    }

    clearSelectedRecordManual() {
        this.selectedRecordManual = null;

        const emptyEl = document.getElementById('selectedRecordEmptyManual');
        const containerEl = document.getElementById('selectedRecordContainerManual');
        const labelEl = document.getElementById('selectedRecordLabelManual');
        const numberEl = document.getElementById('selectedRecordNumberManual');
        const imgEl = document.getElementById('selectedRecordImageManual');
        const phEl = document.getElementById('selectedRecordPlaceholderManual');

        if (containerEl) containerEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'block';

        if (labelEl) labelEl.textContent = '';
        if (numberEl) numberEl.textContent = '';
        if (imgEl) { imgEl.style.display = 'none'; imgEl.src = ''; }
        if (phEl) {
            phEl.style.display = 'flex';
            phEl.innerHTML = '<i class="fas fa-image" style="font-size: 24px;"></i>';
        }

        // İşlem türü seçiminde kullanıcı isterse aynı kalsın; ama submit butonu kapanmalı
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

    updateManualChildOptions() {
        const parentTypeSelect = document.getElementById('specificManualTransactionType');
        const childTypeSelect = document.getElementById('manualChildTransactionType');
        const parentContainer = document.getElementById('manualParentSelectContainer');

        if (!parentTypeSelect || !childTypeSelect) return;

        // Reset
        childTypeSelect.innerHTML = '<option value="">-- Sadece Ana İşlem Oluştur --</option>';
        childTypeSelect.disabled = true;
        if(parentContainer) parentContainer.style.display = 'none';

        const selectedParentTypeId = parentTypeSelect.value;
        if (!selectedParentTypeId) return;

        const parentTypeObj = this.allTransactionTypes.find(t => String(t.id) === String(selectedParentTypeId));
        if (!parentTypeObj || !parentTypeObj.indexFile) return; // Alt işlemi yoksa çık

        // Alt işlemleri filtrele
        const allowedChildIds = Array.isArray(parentTypeObj.indexFile) ? parentTypeObj.indexFile.map(String) : [];
        const allowedChildTypes = this.allTransactionTypes
            .filter(t => allowedChildIds.includes(String(t.id)))
            .sort((a, b) => (a.order || 999) - (b.order || 999));

        if (allowedChildTypes.length > 0) {
            allowedChildTypes.forEach(type => {
                const opt = document.createElement('option');
                opt.value = type.id;
                opt.textContent = type.alias || type.name;
                childTypeSelect.appendChild(opt);
            });
            childTypeSelect.disabled = false;
        }
    }

    updateManualParentOptions() {
        const parentTypeSelect = document.getElementById('specificManualTransactionType');
        const childTypeSelect = document.getElementById('manualChildTransactionType');
        const parentContainer = document.getElementById('manualParentSelectContainer');
        const parentSelect = document.getElementById('manualExistingParentSelect');

        if (!parentContainer || !parentSelect) return;

        const childTypeId = childTypeSelect.value;
        const parentTypeId = parentTypeSelect.value;

        // Eğer alt işlem seçilmediyse parent sorusunu gizle
        if (!childTypeId) {
            parentContainer.style.display = 'none';
            parentSelect.innerHTML = '<option value="">-- Ana İşlem Seçin --</option>';
            return;
        }

        // Alt işlem seçildi, kutuyu göster
        parentContainer.style.display = 'block';
        parentSelect.innerHTML = '<option value="">-- Ana İşlem Seçin --</option>';

        // Markanın geçmişinde, seçilen Parent Tipi ile eşleşen 'parent' hiyerarşili kayıtları bul
        const existingParents = this.currentRecordTransactions.filter(t => 
            String(t.type) === String(parentTypeId) && 
            (t.transactionHierarchy === 'parent' || !t.transactionHierarchy)
        );

        if (existingParents.length === 0) {
            // Hiç yoksa kullanıcıyı bilgilendirip sanal oluşturma opsiyonu verelim
            const opt = document.createElement('option');
            opt.value = "CREATE_NEW";
            opt.textContent = "⚠️ Mevcut İşlem Yok - Önce Yeni Ana İşlem Yaratıp Bağla";
            parentSelect.appendChild(opt);
            parentSelect.value = "CREATE_NEW";
        } else {
            // Varsa listele (En yeniden en eskiye)
            existingParents.sort((a,b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)).forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                const dateStr = t.timestamp ? new Date(t.timestamp).toLocaleDateString('tr-TR') : 'Tarihsiz';
                opt.textContent = `${t.description || 'İşlem'} (${dateStr})`;
                parentSelect.appendChild(opt);
            });
            // Sadece 1 tane varsa kullanıcıyı yormamak için otomatik seç
            if (existingParents.length === 1) {
                parentSelect.value = existingParents[0].id;
            }
        }
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
        if (this.activeTab === 'manual-indexing-pane') {
            const parentType = document.getElementById('specificManualTransactionType')?.value;
            const childType = document.getElementById('manualChildTransactionType')?.value;
            const existingParent = document.getElementById('manualExistingParentSelect')?.value;

            let canSubmit = this.selectedRecordManual !== null && parentType && parentType !== "";

            // Eğer alt işlem seçildiyse, bağlanacak parent da seçilmiş olmak ZORUNDA
            if (childType && !existingParent) {
                canSubmit = false;
            }
            
            const saveManualBtn = document.getElementById('saveManualTransactionBtn');
            if (saveManualBtn) {
                saveManualBtn.disabled = !canSubmit;
                saveManualBtn.style.opacity = canSubmit ? '1' : '0.6';
            }
        }
    }

    // --- MANUEL İŞLEM KAYDETME (GÜNCELLENEN METOD) ---
    async handleManualTransactionSubmit() {
        const parentTypeId = document.getElementById('specificManualTransactionType')?.value;
        const childTypeId = document.getElementById('manualChildTransactionType')?.value;
        const existingParentId = document.getElementById('manualExistingParentSelect')?.value;
        const deliveryDateStr = document.getElementById('manualTransactionDeliveryDate')?.value;
        const notes = document.getElementById('manualTransactionNotes')?.value;
        
        if (!this.selectedRecordManual || !parentTypeId) {
            showNotification('Lütfen işlem türü ve kayıt seçiniz.', 'warning');
            return;
        }

        const submitBtn = document.getElementById('saveManualTransactionBtn');
        if(submitBtn) submitBtn.disabled = true;
        showNotification('Dosyalar yükleniyor ve işlem kaydediliyor...', 'info');

        try {

// ==========================================
            // 🔥 EĞER BÜLTEN SEÇİLDİYSE ÖNCE KAYIT OLUŞTUR (DOĞRU ALAN ADLARIYLA)
            // ==========================================
            if (this.selectedRecordManual._isBulletin) {
                showNotification('Bülten kaydı 3. Taraf olarak portföye ekleniyor...', 'info');
                
                const newRecordData = {
                    title: this.selectedRecordManual.markName || this.selectedRecordManual.title || 'İsimsiz Marka',
                    applicationNumber: this.selectedRecordManual.applicationNo || this.selectedRecordManual.applicationNumber || '',
                    niceClasses: this.selectedRecordManual.classes || this.selectedRecordManual.niceClasses || [],
                    recordOwnerType: 'third_party',
                    origin: 'TÜRKPATENT',
                    status: 'published',
                    bulletinNo: this.selectedRecordManual.bulletinNo || '',
                    applicationDate: this.selectedRecordManual.applicationDate || '',
                    brandImageUrl: this.selectedRecordManual.imagePath || this.selectedRecordManual.imageUrl || null,
                    createdAt: new Date().toISOString()
                };
                
                // Bülten sahibi (Applicant) alanını yakala
                const ownerName = this.selectedRecordManual.applicantName || this.selectedRecordManual.owner || this.selectedRecordManual.applicant;
                if (ownerName) {
                    newRecordData.applicants = [{
                        name: ownerName,
                        id: 'temp_' + Date.now()
                    }];
                }

                // 1. ipRecords tablosuna yeni belgeyi kaydet
                const newRecordRef = doc(collection(firebaseServices.db, 'ipRecords'));
                await setDoc(newRecordRef, newRecordData);
                const newRecordId = newRecordRef.id;

                // 2. "Marka Başvurusu" (ID: 6) kök işlemini (Transaction) otomatik bağla
                const rootTxData = {
                    type: "2", // Sisteminizdeki Marka Başvurusu ID'si
                    transactionHierarchy: 'parent',
                    description: 'Başvuru',
                    date: this.selectedRecordManual.applicationDate || new Date().toISOString(),
                    timestamp: new Date().toISOString(),
                    userId: this.currentUser.uid,
                    userName: this.currentUser.displayName || this.currentUser.email || 'Kullanıcı',
                    userEmail: this.currentUser.email
                };
                await ipRecordsService.addTransactionToRecord(newRecordId, rootTxData);

                // 3. Referansı Güncelle (Artık sıradan bir Portföy kaydı oldu)
                this.selectedRecordManual.id = newRecordId;
                this.selectedRecordManual._isBulletin = false; 
                
                // Aramada bir daha bülten olarak çıkmasın diye belleğe ekle
                this.allRecords.push({ id: newRecordId, ...newRecordData });
            }
            // ==========================================
            // 1. BİREBİR AYNI KALAN KISIM: PDF YÜKLEME
            // ==========================================
            const filesToUpload = this.uploadedFilesMap.get('manual-indexing-pane') || [];
            const uploadedDocuments = [];

            if (filesToUpload.length > 0) {
                for (const fileItem of filesToUpload) {
                    const file = fileItem.fileObject;
                    const timestamp = Date.now();
                    const uniqueFileName = `${timestamp}_${file.name}`;
                    const storagePath = `pdfs/${this.currentUser.uid}/${uniqueFileName}`;
                    const storageRef = ref(firebaseServices.storage, storagePath);
                    
                    const uploadTask = await uploadBytesResumable(storageRef, file);
                    const downloadURL = await getDownloadURL(uploadTask.ref);

                    uploadedDocuments.push({
                        id: generateUUID(),
                        name: file.name,
                        type: file.type || 'application/pdf',
                        downloadURL: downloadURL,
                        uploadedAt: new Date().toISOString(),
                        documentDesignation: fileItem.documentDesignation || 'Resmi Yazı'
                    });
                }
            }

            // ==========================================
            // 2. YENİ KISIM: HİYERARŞİ TESPİTİ VE İTİRAZ İŞ KURALI
            // ==========================================
            let finalParentId = null;
            const isChild = !!childTypeId;

            // 🔥 MÜKEMMEL DOMAIN KURALI: Eğer Başvuru (2 veya 6) işleminin altına İtiraz Bildirimi (27) eklenmeye çalışılıyorsa:
            if (isChild && String(childTypeId) === '27' && (String(parentTypeId) === '2' || String(parentTypeId) === '6')) {
                showNotification('İtiraz işlemi için "Yayına İtiraz" kök işlemi otomatik oluşturuluyor...', 'info');
                
                // Araya girecek 20 numaralı Parent'ı (Yayına İtiraz) oluştur
                const parent20Obj = this.allTransactionTypes.find(t => String(t.id) === '20');
                const newParentData = {
                    type: '20',
                    transactionHierarchy: 'parent',
                    description: parent20Obj ? (parent20Obj.alias || parent20Obj.name) : 'Yayına İtiraz (Otomatik)',
                    timestamp: new Date().toISOString(),
                    userId: this.currentUser.uid,
                    userEmail: this.currentUser.email
                };
                
                const pResult = await ipRecordsService.addTransactionToRecord(this.selectedRecordManual.id, newParentData);
                if (pResult.success) finalParentId = pResult.id;
            } 
            // NORMAL AKIŞ (Eğer yukarıdaki özel kurala takılmadıysa)
            else {
                if (isChild && existingParentId === "CREATE_NEW") {
                    const parentTypeObj = this.allTransactionTypes.find(t => String(t.id) === String(parentTypeId));
                    const newParentData = {
                        type: parentTypeId,
                        transactionHierarchy: 'parent',
                        description: parentTypeObj ? (parentTypeObj.alias || parentTypeObj.name) : 'Ana İşlem',
                        timestamp: new Date().toISOString(),
                        userId: this.currentUser.uid,
                        userEmail: this.currentUser.email
                    };
                    const pResult = await ipRecordsService.addTransactionToRecord(this.selectedRecordManual.id, newParentData);
                    if (pResult.success) finalParentId = pResult.id;
                } else if (isChild && existingParentId) {
                    finalParentId = existingParentId;
                }
            }
            
            // ==========================================
            // 3. BİREBİR AYNI KALAN KISIM: PAYLOAD YAPISI
            // ==========================================
            const targetTypeId = isChild ? childTypeId : parentTypeId;
            const typeObj = this.allTransactionTypes.find(t => String(t.id) === String(targetTypeId));

            const transactionData = {
                type: targetTypeId,
                transactionHierarchy: isChild ? 'child' : 'parent', // Sadece burası dinamik oldu
                deliveryDate: deliveryDateStr ? new Date(deliveryDateStr).toISOString() : null,
                description: typeObj ? (typeObj.alias || typeObj.name) : (notes || ''),
                notes: notes || '',
                timestamp: new Date().toISOString(),
                
                // ORİJİNAL BELGE EKLEME MANTIĞI KORUNDU
                documents: uploadedDocuments,
                
                userId: this.currentUser.uid,
                userName: this.currentUser.displayName || this.currentUser.email || 'Kullanıcı',
                userEmail: this.currentUser.email
            };

            // Eğer child ise ParentID'yi pakete dahil et
            if (isChild && finalParentId) {
                transactionData.parentId = finalParentId;
            }

            // 4. Veritabanına Ekle
            const result = await ipRecordsService.addTransactionToRecord(
                this.selectedRecordManual.id, 
                transactionData
            );

            if (!result.success) throw new Error(result.error || 'İşlem oluşturulamadı');
            
            showNotification('İşlem başarıyla kaydedildi!', 'success');
            
            // 5. Formu Temizle ve Kapat
            this.resetForm();
            if (document.getElementById('manualParentSelectContainer')) {
                document.getElementById('manualParentSelectContainer').style.display = 'none';
            }
            if (document.getElementById('manualChildTransactionType')) {
                document.getElementById('manualChildTransactionType').disabled = true;
                document.getElementById('manualChildTransactionType').innerHTML = '<option value="">-- Sadece Ana İşlem Oluştur --</option>';
            }

        } catch (error) {
            console.error('Manuel işlem hatası:', error);
            showNotification('Hata: ' + error.message, 'error');
        } finally {
            if(submitBtn) {
                submitBtn.disabled = false;
                this.checkFormCompleteness();
            }
        }
    }

    resetForm() {
        // Inputları Temizle
        const inputs = [
            'recordSearchInputManual', 
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

        // Seçili kaydı temizle (kartı da kapatır)
        this.clearSelectedRecordManual();
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

    // public/js/indexing/bulk-upload-manager.js

    async processFiles(files) {
        // 1. Önce verileri yükle (eğer boşsa)
        if (this.allRecords.length === 0) await this.loadAllData();
        
        // 2. 🚀 LOADER'I DERHAL GÖSTER
        if (window.SimpleLoadingController) {
            window.SimpleLoadingController.show({
                text: 'Dosyalar Yükleniyor',
                subtext: `${files.length} adet PDF hazırlanıyor, lütfen beklemeye devam edin...`
            });
        }

        // 🔥 KRİTİK: Tarayıcının loader'ı ekrana basması için 250ms bekleme (Paint Delay)
        await new Promise(resolve => setTimeout(resolve, 250));

        try {
            for (const file of files) {
                // Yükleme durumunu loader metninde anlık güncelle
                if (window.SimpleLoadingController) {
                    window.SimpleLoadingController.updateText('Dosyalar Yükleniyor', `${file.name} aktarılıyor...`);
                }
                await this.uploadFileToFirebase(file);
            }
            
            if (window.SimpleLoadingController) {
                window.SimpleLoadingController.showSuccess(`${files.length} dosya başarıyla yüklendi.`);
            }

            // --- 🔄 DOĞRU SEKME İLE YENİLE ---
            setTimeout(() => {
                window.location.href = 'bulk-indexing-page.html?tab=bulk';
            }, 1500);

        } catch (error) {
            console.error("Yükleme hatası:", error);
            if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
            showNotification('Yükleme sırasında bir hata oluştu.', 'error');
        }
    }

    async uploadFileToFirebase(file) {
        // Mükerrer tetiklenmeyi engellemek için kontrol
        if (file._isProcessing) return;
        file._isProcessing = true;

        try {
            const id = generateUUID();
            const timestamp = Date.now();
            // Manuel yüklemeleri ayrı bir klasöre alıyoruz
            const storagePath = `manual_uploads/${this.currentUser.uid}/${timestamp}_${file.name}`;
            const storageRef = ref(firebaseServices.storage, storagePath);
            const uploadTask = uploadBytesResumable(storageRef, file);
            
            return new Promise((resolve, reject) => {
                uploadTask.on('state_changed', null, (error) => reject(error), async () => {
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
                            filePath: storagePath,
                            fileSize: file.size,
                            uploadedAt: new Date(),
                            userId: this.currentUser.uid,
                            status: 'pending',
                            source: 'manual', // 🔥 Kaynak 'manual' olarak set edildi
                            isEtebs: false,
                            extractedAppNumber: extractedAppNumber || null,
                            matchedRecordId: matchedRecordId,
                            matchedRecordDisplay: matchedRecordDisplay,
                            recordOwnerType: recordOwnerType
                        };
                        
                        await setDoc(doc(collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION), id), pdfData);
                        resolve(pdfData);
                    } catch (error) { reject(error); }
                });
            });
        } catch (error) { 
            console.error(error); 
            throw error;
        }
    }

    setupRealtimeListener() {
    if (!this.currentUser) return;
    
    console.log("📡 Firestore dinleyicisi kuruluyor...");

    const q = query(
        collection(firebaseServices.db, UNINDEXED_PDFS_COLLECTION),
        where('userId', '==', this.currentUser.uid),
        orderBy('uploadedAt', 'desc')
    );

    this.unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.metadata.fromCache) {
            console.log("🧠 Cache snapshot alındı, server verisi bekleniyor...");
            return;
        }

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