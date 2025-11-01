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

import { 
    ref, uploadBytes, getDownloadURL 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

// Constants
const UNINDEXED_PDFS_COLLECTION = 'unindexed_pdfs';

// Selcan'ın bilgileri
const SELCAN_UID = 'Mkmq2sc0T6XTIg1weZyp5AGZ0YG3';
const SELCAN_EMAIL = 'selcanakoglu@evrekapatent.com';

// --- Onay bekleyen iş için atanacak kullanıcıyı kuraldan çöz ---
export async function resolveApprovalStateAssignee() {
  try {
    // taskAssignments/approval dokümanı: { approvalStateAssigneeIds: ["uid1","uid2", ...] }
    const ruleRef  = doc(firebaseServices.db, 'taskAssignments', 'approval');
    const ruleSnap = await getDoc(ruleRef);
    if (!ruleSnap.exists()) return { uid: null, email: null, reason: 'rule_not_found' };

    const ids = ruleSnap.data()?.approvalStateAssigneeIds;
    const uid = Array.isArray(ids) ? ids.find(v => typeof v === 'string' && v.trim()) : null;
    if (!uid) return { uid: null, email: null, reason: 'empty_list' };

    // users/{uid} içinden email oku (koleksiyon ismi sende farklıysa burayı uyarlay)
    const userSnap = await getDoc(doc(firebaseServices.db, 'users', uid));
    const email = userSnap.exists() ? (userSnap.data().email || null) : null;

    return { uid, email, reason: 'ok' };
  } catch (err) {
    console.warn('[resolveApprovalStateAssignee] failed:', err?.message || err);
    return { uid: null, email: null, reason: 'error' };
  }
}

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
        // init() fonksiyonunu manuel çağırmak için bekle
        console.log('🔧 IndexingDetailModule oluşturuldu, init() manuel çağrılacak');
    }

async init() {
    console.log('🚀 IndexingDetailModule init() başlatılıyor...');
    
    // URL parametrelerinden PDF ID'sini ve ETEBS evrakNo'yu al
    const urlParams = new URLSearchParams(window.location.search);
    const pdfId = urlParams.get('pdfId');
    const evrakNo = urlParams.get('evrakNo'); // ETEBS evrakNo'yu da kontrol et

    // Sadece URL parametresi varsa PDF yükle
    if (pdfId) {
        console.log('📄 PDF ID bulundu:', pdfId);
        await this.loadPdfData(pdfId);
    } else if (evrakNo) {
        console.log('📄 ETEBS evrakNo bulundu:', evrakNo);
        await this.loadETEBSData(urlParams);
    } else {
        console.log('⚠️ Hiç URL parametresi yok, PDF yüklenmeyecek');
        // Temel event listener'ları kur ama modal açma
        this.setupEventListeners();
        await this.loadRecordsAndTransactionTypes();
        return; // PDF yok, modal açma
    }

    // Eğer pdfData hala null ise 
    if (!this.pdfData) {
        console.log('❌ PDF verisi yüklenemedi');
        showNotification('PDF ID veya ETEBS parametreleri bulunamadı. Lütfen geçerli bir belge seçin veya indirin.', 'error', 5000);
        console.error('URL parametrelerine göre yüklenecek bir PDF verisi bulunamadı.');
        
        // Event listener'ları kur ama modal açma
        this.setupEventListeners();
        await this.loadRecordsAndTransactionTypes();
        
        // Kullanıcıyı otomatik olarak belge yükleme sayfasına geri yönlendir
        setTimeout(() => {
            window.location.href = 'bulk-indexing-page.html';
        }, 3000); // 3 saniye sonra yönlendir
        return; // Daha fazla işlem yapmadan fonksiyonu sonlandır
    }

    console.log('✅ PDF verisi başarıyla yüklendi, tam init yapılıyor');
    
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
    
    // ⭐ TÜM İNDEKSLEME BUTONLARINA EVENT LISTENER EKLE
    const indexBtn = document.getElementById('indexPdfBtn') || document.getElementById('indexBtn');
    const saveUpdateBtn = document.getElementById('saveUpdatePdfBtn');
    const globalSaveBtn = document.getElementById('btn-save-all');

    if (indexBtn) {
        // Mevcut listener'ları temizle
        const newIndexBtn = indexBtn.cloneNode(true);
        indexBtn.parentNode.replaceChild(newIndexBtn, indexBtn);
        
        newIndexBtn.addEventListener('click', () => {
            console.log('🖱️ İndeksleme butonu tıklandı');
            this.handleIndexing();
        });
    }

    if (saveUpdateBtn) {
        // Mevcut listener'ları temizle
        const newSaveUpdateBtn = saveUpdateBtn.cloneNode(true);
        saveUpdateBtn.parentNode.replaceChild(newSaveUpdateBtn, saveUpdateBtn);
        
        newSaveUpdateBtn.addEventListener('click', () => {
            console.log('🖱️ Kaydet/Güncelle butonu tıklandı');
            this.handleIndexing();
        });
    }

    // Global save butonu için de listener ekle
    if (globalSaveBtn) {
        const newGlobalSaveBtn = globalSaveBtn.cloneNode(true);
        globalSaveBtn.parentNode.replaceChild(newGlobalSaveBtn, globalSaveBtn);
        
        newGlobalSaveBtn.addEventListener('click', () => {
            console.log('🖱️ Global kaydet butonu tıklandı');
            this.handleIndexing();
        });
    }

    const deliveryDateInput = document.getElementById('deliveryDate');
    if (deliveryDateInput) {
    const onDateChange = () => {
        const alt = deliveryDateInput.nextElementSibling;
        console.log('📅 Tebliğ tarihi değişti:',
        deliveryDateInput.value,
        alt && alt.classList && alt.classList.contains('flatpickr-alt-input') ? alt.value : ''
        );
        this.checkFormCompleteness();
    };

    // Asıl (gizli) input’u dinle
    ['change','input'].forEach(evt =>
        deliveryDateInput.addEventListener(evt, onDateChange)
    );

    // Varsa alt input’u da dinle (flatpickr’ın görünür kutusu)
    const alt = deliveryDateInput.nextElementSibling;
    if (alt && alt.classList && alt.classList.contains('flatpickr-alt-input')) {
        ['change','input'].forEach(evt =>
        alt.addEventListener(evt, onDateChange)
        );
    }
    }

    // ⭐ TRANSACTION SEÇİMİ EVENT LISTENER'I
    const transactionsList = document.getElementById('transactionsList');
    if (transactionsList) {
        const newTransactionsList = transactionsList.cloneNode(true);
        transactionsList.parentNode.replaceChild(newTransactionsList, transactionsList);
        
        newTransactionsList.addEventListener('click', (event) => {
            const transactionItem = event.target.closest('.transaction-item');
            if (transactionItem) {
                // Tüm seçimleri temizle
                newTransactionsList.querySelectorAll('.transaction-item').forEach(item => {
                    item.classList.remove('selected');
                });
                
                // Tıklanan öğeyi seçili yap
                transactionItem.classList.add('selected');
                
                // Transaction ID'sini onclick attribute'undan al
                const onClickAttr = transactionItem.getAttribute('onclick');
                if (onClickAttr) {
                    const match = onClickAttr.match(/'([^']+)'/);
                    if (match) {
                        const transactionId = match[1];
                        this.selectTransaction(transactionId);
                    }
                }
            }
        });
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

            // ✅ YENİ: Eğer seçilen kayıt bir WIPO/ARIPO parent kaydıysa, modal aç
            if (this.matchedRecord.transactionHierarchy === 'parent' && (this.matchedRecord.wipoIR || this.matchedRecord.aripoIR)) {
                this.showWipoAripoSelectModal(this.matchedRecord);
            } else {
                // Değilse normal akışa devam et
                this.handleWipoAripoSelection(recordId);
            }
        }
    }
    
    // ✅ YENİ FONKSİYON: WIPO/ARIPO kayıtları için modal göster
    showWipoAripoSelectModal(parentRecord) {
        const modal = document.getElementById('wipoAripoSelectModal');
        const list = document.getElementById('wipoAripoRecordList');
        if (!modal || !list) return;

        const irNumber = parentRecord.wipoIR || parentRecord.aripoIR;
        const matchingRecords = this.allRecords.filter(r => (r.wipoIR === irNumber || r.aripoIR === irNumber));
        
        list.innerHTML = '';
        matchingRecords.forEach(record => {
            const isParent = record.transactionHierarchy === 'parent';
            const countryName = isParent ? record.origin : record.country;
            const item = document.createElement('li');
            item.className = 'list-group-item list-group-item-action';
            item.dataset.id = record.id;
            item.innerHTML = `
                <div>
                    <strong>${record.title}</strong>
                    <span class="badge badge-secondary ml-2">${countryName}</span>
                </div>
                <small>${record.applicationNumber || record.wipoIR || record.aripoIR}</small>
            `;
            item.onclick = () => this.handleWipoAripoSelection(record.id);
            list.appendChild(item);
        });

        // Modalı göster
        $('#wipoAripoSelectModal').modal('show');
    }

    // ✅ YENİ FONKSİYON: WIPO/ARIPO modalından seçim yapıldığında çalışır
    async handleWipoAripoSelection(recordId) {
        // Modalı kapat
        $('#wipoAripoSelectModal').modal('hide');

        this.matchedRecord = this.allRecords.find(r => r.id === recordId);
        if (this.matchedRecord) {
            const recordDisplay = document.getElementById('selectedRecordDisplay');
            recordDisplay.innerHTML = `
                <div class="selected-item d-flex justify-content-between align-items-center">
                    <span>
                        <strong>${this.matchedRecord.title}</strong>
                        (${this.matchedRecord.applicationNumber || this.matchedRecord.wipoIR || this.matchedRecord.aripoIR})
                        <span class="badge badge-primary ml-2">${this.matchedRecord.country || this.matchedRecord.origin}</span>
                    </span>
                    <button type="button" class="remove-selected-item-btn" onclick="window.indexingDetailModule.clearSelectedRecord()">
                        &times;
                    </button>
                </div>
            `;
            recordDisplay.style.display = 'block';
            await this.loadTransactionsForRecord();
        }
    }

    clearSelectedRecord() {
    // state’i sıfırla
    this.matchedRecord = null;
    this.selectedTransactionId = null;
    this.currentTransactions = [];

    // seçili kartı tamamen kaldır
    const selected = document.getElementById('selectedRecordDisplay');
    if (selected) {
        selected.innerHTML = '';
        selected.style.display = 'none';
    }

    // ana işlem bölümü gizle ve içeriğini sıfırla
    const txSection = document.getElementById('transactionSection');
    const txList    = document.getElementById('transactionsList');
    if (txSection) txSection.style.display = 'none';
    if (txList)    txList.innerHTML = '<p class="text-muted">Lütfen önce bir kayıt seçin.</p>';

    // alt işlem alanını gizle ve alanları sıfırla
    const childWrap = document.getElementById('childTransactionInputs');
    const childSel  = document.getElementById('childTransactionType');
    const delInput  = document.getElementById('deliveryDate');
    if (childWrap) childWrap.style.display = 'none';
    if (childSel) {
        childSel.innerHTML = '<option value="" disabled selected>Alt işlem türü seçin...</option>';
        childSel.value = '';
    }
    if (delInput) delInput.value = '';

    // arama kutusunu hazırla
    const search = document.getElementById('recordSearchInput');
    if (search) {
        search.value = '';
        search.focus();
        search.style.display = 'block';
    }

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

            // ePats bilgilerini task'lardan al
            const transactionsWithEpats = await Promise.all(parentTransactions.map(async (transaction) => {
                let epatsNumber = null;
                
                // Eğer transaction'da triggeringTaskId varsa, task'ı sorgula
                if (transaction.triggeringTaskId) {
                    try {
                        const taskResult = await taskService.getTaskById(transaction.triggeringTaskId);
                        if (taskResult.success && taskResult.data?.details?.epatsDocument?.turkpatentEvrakNo) {
                            epatsNumber = taskResult.data.details.epatsDocument.turkpatentEvrakNo;
                        }
                    } catch (err) {
                        console.warn('⚠️ Task sorgulanamadı (ePats için):', transaction.triggeringTaskId, err);
                    }
                }
                
                return { ...transaction, epatsNumber };
            }));

            const transactionsHtml = transactionsWithEpats.map(transaction => {
                const transactionType = this.allTransactionTypes.find(t => t.id === transaction.type);
                const typeName = transactionType ? (transactionType.alias || transactionType.name) : 'Bilinmeyen Tür';
                
                return `
                    <div class="transaction-item" onclick="window.indexingDetailModule.selectTransaction('${transaction.id}')">
                        <div class="transaction-main">${typeName}</div>
                        <div class="transaction-details">
                            ${transaction.epatsNumber ? `EPATS Evrak No: ${transaction.epatsNumber}` : ''}
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

    // ⭐ MEVCUT EVENT LISTENER'LARI TEMİZLE
    const newSelectElement = selectElement.cloneNode(true);
    selectElement.parentNode.replaceChild(newSelectElement, selectElement);

    // ⭐ YENİ EVENT LISTENER EKLE
    newSelectElement.addEventListener('change', (event) => {
        const selectedValue = event.target.value;
        console.log('Alt işlem seçildi:', selectedValue);
        
        // 🔥 YENİ: İtiraz bildirimi seçildiyse PDF yükleme alanını göster
        const oppositionSection = document.getElementById('oppositionPetitionSection');
        if (oppositionSection) {
            if (selectedValue === '27') { // İtiraz Bildirimi
                oppositionSection.style.display = 'block';
                const fileInput = document.getElementById('oppositionPetitionFile');
                if (fileInput) fileInput.required = true;
            } else {
                oppositionSection.style.display = 'none';
                const fileInput = document.getElementById('oppositionPetitionFile');
                if (fileInput) {
                    fileInput.required = false;
                    fileInput.value = ''; // Temizle
                }
            }
        }
        
        // Biraz gecikme ekleyerek DOM güncellemesini bekle
        setTimeout(() => {
            this.checkFormCompleteness();
        }, 50);
    });

    // Alt işlem bölümünü göster
    document.getElementById('childTransactionInputs').style.display = 'block';
    
    // ⭐ İLK YÜKLEME SONRASI FORM DURUMUNU KONTROL ET
    setTimeout(() => {
        this.checkFormCompleteness();
    }, 100);
}

checkFormCompleteness() {
    const hasMatchedRecord = this.matchedRecord !== null;
    const hasSelectedTransaction = this.selectedTransactionId !== null;
    
    const childTransactionInputs = document.getElementById('childTransactionInputs');
    const childTransactionInputsVisible = childTransactionInputs && childTransactionInputs.style.display !== 'none';
    
    let hasSelectedChildType = true;
    if (childTransactionInputsVisible) {
        const childTypeSelect = document.getElementById('childTransactionType');
        if (childTypeSelect) {
            const selectedValue = childTypeSelect.value;
            hasSelectedChildType = selectedValue !== '' && selectedValue !== null && selectedValue !== undefined;
            console.log('Child type select value:', selectedValue, 'hasSelectedChildType:', hasSelectedChildType);
        }
    }

    const deliveryInput = document.getElementById('deliveryDate');
    let hasDeliveryDate = false;
    if (deliveryInput) {
    const raw = (deliveryInput.value || '').trim();
    const alt = deliveryInput.nextElementSibling;
    const altVal = (alt && alt.classList && alt.classList.contains('flatpickr-alt-input'))
        ? (alt.value || '').trim()
        : '';
    hasDeliveryDate = !!(raw || altVal);
    }

    // 🔥 YENİ: İtiraz bildirimi seçildiyse PDF kontrolü yap
    let hasOppositionPdf = true;
    const childTypeSelect = document.getElementById('childTransactionType');
    if (childTypeSelect && childTypeSelect.value === '27') {
        const pdfInput = document.getElementById('oppositionPetitionFile');
        hasOppositionPdf = !!(pdfInput && pdfInput.files && pdfInput.files.length > 0);
        console.log('Opposition petition PDF check:', hasOppositionPdf);
    }

    const canSubmit = hasMatchedRecord 
    && hasSelectedTransaction 
    && hasSelectedChildType 
    && hasDeliveryDate
    && hasOppositionPdf; // 🔥 YENİ ŞART
    
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
        hasDeliveryDate,
        canSubmit
    });
}

// js/indexing-detail-module.js dosyasındaki handleIndexing fonksiyonunun tamamını bununla değiştirin.

async handleIndexing(opts = {}) {
    try {
        const noRedirect = !!opts.noRedirect;

        // GÜÇLÜ FORM VALİDASYONU
        if (!this.matchedRecord || !this.selectedTransactionId) {
            showNotification('Gerekli seçimler yapılmadı.', 'error');
            return;
        }

        const childTypeId = document.getElementById('childTransactionType')?.value;
        const deliveryEl = document.getElementById('deliveryDate');
        let deliveryDateStr = deliveryEl?.value?.trim() || '';

        if (!deliveryDateStr && deliveryEl?.nextElementSibling?.classList?.contains('flatpickr-alt-input')) {
        const v = (deliveryEl.nextElementSibling.value || '').trim(); // dd.mm.yyyy
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) {
            const [dd, mm, yyyy] = v.split('.');
            deliveryDateStr = `${yyyy}-${mm}-${dd}`;
        }
        }


        if (!childTypeId || !deliveryDateStr) {
            showNotification('Alt işlem türü ve tebliğ tarihi seçilmeli.', 'error');
            return;
        }

        console.log('Form validasyonu geçti:', {
            matchedRecord: this.matchedRecord.id,
            selectedTransaction: this.selectedTransactionId,
            childType: childTypeId,
            deliveryDate: deliveryDateStr
        });

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

    // 🔥 İTİRAZ BİLDİRİMİ İÇİN DEĞİŞKENLERİ BAŞTA TANIMLA (scope için)
    let newParentTransactionId = null;
    let oppositionPetitionFileUrl = null;

    // 1. Alt işlem varsa oluştur
    if (childTypeId) {
        console.log('Alt işlem oluşturuluyor...');

        const childTransactionType = this.allTransactionTypes.find(type => type.id === childTypeId);
        if (!childTransactionType) {
            throw new Error('Alt işlem türü bulunamadı: ' + childTypeId);
        }

        if (childTypeId === '27') { // İtiraz Bildirimi
            console.log('🔍 İtiraz Bildirimi tespit edildi, özel işlem başlatılıyor...');
            
            // PDF yükleme alanından dosyayı al
            const oppositionPdfFile = document.getElementById('oppositionPetitionFile')?.files[0];
            
            if (!oppositionPdfFile) {
                throw new Error('İtiraz bildirimi için "Karşı Taraf İtiraz Dilekçesi" PDF dosyası yüklenmelidir.');
            }
            
            // PDF'i storage'a yükle
            console.log('📤 Karşı taraf itiraz dilekçesi yükleniyor...');
            const timestamp = Date.now();
            const storagePath = `opposition-petitions/${this.matchedRecord.id}/${timestamp}_${oppositionPdfFile.name}`;
            const storageRef = ref(firebaseServices.storage, storagePath);
            
            await uploadBytes(storageRef, oppositionPdfFile);
            oppositionPetitionFileUrl = await getDownloadURL(storageRef);
            console.log('✅ Karşı taraf itiraz dilekçesi yüklendi:', oppositionPetitionFileUrl);
            
            // ✅ Seçili parent'ı ve tipini DOĞRU al
            const selectedParent = this.currentTransactions.find(t => t.id === this.selectedTransactionId);
            const selectedParentType = this.allTransactionTypes.find(t => String(t.id) === String(selectedParent?.type));
            const parentIdStr = String(selectedParentType?.id || '');
            const parentAlias = (selectedParentType?.alias || selectedParentType?.name || '').trim();

            let newParentType = null;
            let newParentDescription = '';

            // ✅ Başvuru altına indekslendiyse -> Yayına İtiraz (ID: 20)
            if (parentAlias === 'Başvuru') {
            newParentType = '20';
            newParentDescription = 'Yayına İtiraz (Otomatik oluşturuldu)';
            }
            // ✅ Zaten Yayına İtiraz altına indekslendiyse -> Yeniden İnceleme (ID: 19)
            // (alias'a ek olarak ID kontrolü de yap)
            else if (parentAlias === 'Yayına İtiraz' || parentIdStr === '20') {
            newParentType = '19';
            newParentDescription = 'Yayına İtirazın Yeniden İncelenmesi (Otomatik oluşturuldu)';
            }
            
            if (newParentType) {
                console.log(`✅ Yeni parent transaction oluşturuluyor: ${newParentDescription}`);
                
                const newParentData = {
                    type: newParentType,
                    description: newParentDescription,
                    transactionHierarchy: 'parent',
                    oppositionPetitionFileUrl: oppositionPetitionFileUrl, // PDF linkini ekle
                    oppositionPetitionFileName: oppositionPdfFile.name,
                    timestamp: new Date().toISOString()
                };
                
                const addParentResult = await ipRecordsService.addTransactionToRecord(
                    this.matchedRecord.id,
                    newParentData
                );
                
                if (addParentResult.success) {
                    newParentTransactionId = addParentResult.data?.id || addParentResult.id;
                    console.log('✅ Yeni parent transaction oluşturuldu, ID:', newParentTransactionId);
                    console.log('🔍 DEBUG - newParentTransactionId set edildi:', newParentTransactionId);
                    showNotification(`${newParentDescription} otomatik olarak oluşturuldu!`, 'success');
                    
                    // 🔥 KRİTİK: selectedTransactionId'yi güncelle ki iş tetikleme doğru parent'a baksın
                    this.selectedTransactionId = newParentTransactionId;
                } 
                // 🔥 KRİTİK: Yeni parent oluşturuldu, transaction listesini güncelle
                const updatedTxResult = await ipRecordsService.getRecordTransactions(this.matchedRecord.id);
                if (updatedTxResult.success) {
                    this.currentTransactions = updatedTxResult.data || [];
                    console.log('✅ Transaction listesi güncellendi, yeni parent dahil edildi');
                }else {
                    throw new Error('Yeni parent transaction oluşturulamadı: ' + addParentResult.error);
                }
            }
        }

            // 🔥 KRİTİK: İtiraz Bildirimi için yeni parent kullan
            const finalParentId = newParentTransactionId || this.selectedTransactionId;
            console.log('🔍 DEBUG - Child transaction için parent ID:', {
                newParentTransactionId,
                oldSelectedTransactionId: this.selectedTransactionId,
                finalParentId
            });

            const childTransactionData = {
                type: childTypeId,
                description: childTransactionType.alias || childTransactionType.name,
                deliveryDate: deliveryDateStr || null,
                timestamp: deliveryDateStr ? new Date(deliveryDateStr).toISOString() : new Date().toISOString(),
                transactionHierarchy: 'child',
                parentId: finalParentId // 🔥 Yeni parent ID kullanılacak
            };

            const childResult = await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, childTransactionData);
            if (!childResult.success) {
                throw new Error('Alt işlem kaydedilemedi: ' + childResult.error);
            }

            const childTransactionId = childResult.data?.id || childResult.id || childResult.data;
            if (!childTransactionId) {
                throw new Error('Alt işlem ID\'si alınamadı');
            }

            // 🔥 İTİRAZ BİLDİRİMİ: PDF'ler child değil parent transaction'a bağlanmalı
            if (childTypeId === '27' && newParentTransactionId) {
                transactionIdToAssociateFiles = newParentTransactionId;
                console.log('✅ İtiraz bildirimi: PDF\'ler yeni parent transaction\'a bağlanacak:', newParentTransactionId);
            } else {
                transactionIdToAssociateFiles = childTransactionId;
            }
            console.log('Alt işlem başarıyla oluşturuldu, ID:', childTransactionId);
            console.log('🔍 PDF\'ler şu transaction\'a bağlanacak:', transactionIdToAssociateFiles);

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
                // indexing-detail-module.js dosyasında düzeltilmesi gereken bölüm

                // ✅ YENİ DOĞRU KOD:
                let assigned = { uid: SELCAN_UID, email: SELCAN_EMAIL };
                try {
                    // childTransactionType.taskTriggered kullan - bu taskType'ı temsil ediyor
                    const taskTypeId = childTransactionType.taskTriggered;
                    console.log('🔍 taskAssignments araması: taskTypeId =', taskTypeId);
                    
                    if (taskTypeId) {
                        const ruleSnap = await getDoc(doc(firebaseServices.db, 'taskAssignments', String(taskTypeId)));
                        if (ruleSnap.exists()) {
                            const rule = ruleSnap.data() || {};
                            console.log('📋 taskAssignments kuralı bulundu:', rule);
                            
                            // ⭐ ONAY DURUMU İÇİN approvalStateAssigneeIds KULLAN
                            const approvalAssigneeIds = Array.isArray(rule.approvalStateAssigneeIds) ? rule.approvalStateAssigneeIds : [];
                            
                            if (approvalAssigneeIds.length > 0) {
                                const uid = String(approvalAssigneeIds[0]); // İlk kişiye ata
                                console.log('👤 Onay durumu için atanan UID:', uid);
                                
                                // users koleksiyonundan email bilgisini al
                                const userSnap = await getDoc(doc(firebaseServices.db, 'users', uid));
                                if (userSnap.exists()) {
                                    const userData = userSnap.data() || {};
                                    const email = userData.email || null;
                                    assigned = { uid, email };
                                    console.log('✅ Onay durumu ataması başarılı:', assigned);
                                } else {
                                    console.warn('⚠️ Kullanıcı bulunamadı, varsayılana dönülüyor');
                                }
                            } else {
                                console.warn('⚠️ approvalStateAssigneeIds listesi boş, varsayılana dönülüyor');
                            }
                        } else {
                            console.warn('⚠️ taskAssignments kuralı bulunamadı, varsayılana dönülüyor. Aranan ID:', taskTypeId);
                        }
                    } else {
                        console.warn('⚠️ taskTypeId boş, varsayılana dönülüyor');
                    }
                } catch (err) {
                    console.warn('❌ Atama kuralı çözümlenirken hata, varsayılana dönülüyor:', err?.message || err);
                }

                // taskData oluştururken taskType doğru şekilde ayarlanıyor
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
                    assignedTo_uid: assigned.uid,
                    assignedTo_email: assigned.email,
                    priority: 'normal',
                    status: 'awaiting_client_approval',
                    createdAt: new Date(),
                    createdBy: this.currentUser.uid,
                    taskType: childTransactionType.taskTriggered // ✅ Bu doğru - taskAssignments ID'si olacak
                };
                
    const taskResult = await taskService.createTask(taskData);
            if (taskResult.success) {
                    createdTaskId = taskResult.id || taskResult.data?.id;
                    console.log('İş başarıyla tetiklendi, ID:', createdTaskId);
                    showNotification('Alt işlem oluşturuldu ve iş tetiklendi!', 'success');
                    
                    // ✅ YENİ: Tetiklenen işin hierarchy değerine göre parent transaction oluştur
                    if (childTransactionType.taskTriggered) {
                        console.log('🔍 Tetiklenen iş var, parent transaction kontrolü yapılacak. TaskTriggered:', childTransactionType.taskTriggered);
                        await this.createParentTransactionForTriggeredTask(
                            childTransactionType.taskTriggered,
                            createdTaskId,
                            deliveryDateStr
                        );
                        
                    }

    // 🔥 KRİTİK: Yeni parent oluşturulduysa, transaction listesini güncelle
        if (newParentTransactionId) {
            console.log('🔄 Yeni parent oluşturuldu, transaction listesi güncelleniyor...');
            const updatedTxResult = await ipRecordsService.getRecordTransactions(this.matchedRecord.id);
            if (updatedTxResult.success) {
                this.currentTransactions = updatedTxResult.data || [];
                console.log('✅ Transaction listesi güncellendi, yeni parent dahil:', {
                    toplamTransaction: this.currentTransactions.length,
                    yeniParentVar: this.currentTransactions.some(tx => tx.id === newParentTransactionId)
                });
            }
        }

    // MEVCUT: isTopLevelSelectable mantığı devam ediyor (değişmedi)
        if (childTransactionType && childTransactionType.hierarchy === "child" && childTransactionType.isTopLevelSelectable) {
        console.log("📤 Tetiklenen işlem sonrası transaction yaratma başladı.");
        console.log("📌 Tetiklenen işlem bir child ve top-level selectable.");

        // 🔥 Güncellenmiş listeyi kullan
        const existingTransactions = this.currentTransactions || [];
        if (existingTransactions.length > 0) {

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
            // 🔥 İTİRAZ BİLDİRİMİ ÖZEL DURUMU: Yeni parent varsa onu kullan
            let targetParentId = suitableParents[0].id;
            
            // Eğer itiraz bildirimi sonucu yeni parent oluşturulduysa, onu kullan
            if (newParentTransactionId && childTypeId === '27') {
                // Yeni parent transaction'ın bu child'ı kabul edip etmediğini kontrol et
                const newParentTx = existingTransactions.find(tx => tx.id === newParentTransactionId);
                if (newParentTx) {
                    const newParentType = this.allTransactionTypes.find(t => t.id === newParentTx.type);
                    if (newParentType?.allowedChildTypes?.includes(childTransactionType.id)) {
                        targetParentId = newParentTransactionId;
                        console.log('✅ İtiraza Karşı Görüş işi yeni parent transaction\'a bağlanacak:', newParentTransactionId);
                    }
                }
            }
            
            const childTransactionData = {
                type: childTransactionType.id,
                description: `${childTransactionType.name} alt işlemi.`,
                parentId: targetParentId, // 🔥 Doğru parent ID kullan
                transactionHierarchy: "child",
                triggeringTaskId: String(createdTaskId)
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
    } else {
        console.error("Portföy geçmişi alınamadı:", recordTransactionsResult.error);
        showNotification("İşlem geçmişi yüklenemedi.", "error");
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

        // 🔥 YENİ: İtiraz bildirimi için karşı taraf dilekçesini de transaction'a belge olarak ekle
        if (childTypeId === '27' && oppositionPetitionFileUrl && newParentTransactionId) {
            console.log('📎 Karşı taraf itiraz dilekçesi parent transaction\'a belge olarak ekleniyor...');
            
            try {
                const oppositionDocument = {
                    name: 'Karşı Taraf İtiraz Dilekçesi',
                    type: 'opposition_petition',
                    path: oppositionPetitionFileUrl,
                    uploadedAt: new Date().toISOString(),
                    uploadedBy: this.currentUser?.uid || 'unknown'
                };
                
                // Transaction'a belge ekle
                const transactionRef = doc(
                    collection(firebaseServices.db, 'ipRecords', this.matchedRecord.id, 'transactions'),
                    newParentTransactionId
                );
                
                // Mevcut belgeleri al ve yenisini ekle
                const transactionSnap = await getDoc(transactionRef);
                const existingDocs = transactionSnap.data()?.documents || [];
                
                await updateDoc(transactionRef, {
                    documents: [...existingDocs, oppositionDocument]
                });
                
                console.log('✅ Karşı taraf itiraz dilekçesi başarıyla eklendi');
            } catch (error) {
                console.error('❌ Karşı taraf dilekçesi eklenirken hata:', error);
                showNotification('Karşı taraf dilekçesi kaydedilemedi: ' + error.message, 'warning');
            }
        }

        // 🔥 YENİ: İndesklenen PDF'i de transaction belgelerine ekle (İtiraz bildirimi için)
        if (childTypeId === '27' && newParentTransactionId && this.pdfData) {
            console.log('📎 İndekslenen PDF parent transaction\'a belge olarak ekleniyor...');
            
            try {
                const indexedDocument = {
                    name: this.pdfData.fileName || 'Resmi Yazı',
                    type: 'official_document',
                    path: this.pdfData.fileUrl,
                    uploadedAt: new Date().toISOString(),
                    uploadedBy: this.currentUser?.uid || 'unknown',
                    pdfId: this.pdfData.id
                };
                
                // Transaction'a belge ekle
                const transactionRef = doc(
                    collection(firebaseServices.db, 'ipRecords', this.matchedRecord.id, 'transactions'),
                    newParentTransactionId
                );
                
                // Mevcut belgeleri al ve yenisini ekle
                const transactionSnap = await getDoc(transactionRef);
                const existingDocs = transactionSnap.data()?.documents || [];
                
                await updateDoc(transactionRef, {
                    documents: [...existingDocs, indexedDocument]
                });
                
                console.log('✅ İndekslenen PDF başarıyla transaction belgelerine eklendi');
            } catch (error) {
                console.error('❌ İndekslenen PDF eklenirken hata:', error);
                showNotification('Resmi yazı belge olarak kaydedilemedi: ' + error.message, 'warning');
            }
        }

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

async createParentTransactionForTriggeredTask(triggeredTaskTypeId, createdTaskId, deliveryDateStr) {
    if (!triggeredTaskTypeId) {
        console.log('ℹ️ Tetiklenen iş yok, parent transaction kontrolü yapılmayacak');
        return;
    }
    
    console.log('🔍 Tetiklenen iş için parent transaction kontrolü başlatıldı. TaskTypeId:', triggeredTaskTypeId);
    
    try {
        // 1. TransactionType'ı direkt triggered task ID'si ile bul (transactionTypes/7 gibi)
        const triggeredTransactionType = this.allTransactionTypes.find(t => t.id === String(triggeredTaskTypeId));
        
        if (!triggeredTransactionType) {
            console.warn('⚠️ TransactionType bulunamadı. TaskTypeId:', triggeredTaskTypeId);
            return;
        }
        
        console.log('🔍 Tetiklenen işin transaction type bilgisi:', {
            id: triggeredTransactionType.id,
            name: triggeredTransactionType.name,
            alias: triggeredTransactionType.alias,
            hierarchy: triggeredTransactionType.hierarchy
        });
        
        // 2. Hierarchy parent değilse çık
        if (triggeredTransactionType.hierarchy !== 'parent') {
            console.log('ℹ️ Tetiklenen işin hierarchy değeri parent değil (' + triggeredTransactionType.hierarchy + '), parent transaction oluşturulmayacak');
            return;
        }
        

        
        // 4. Parent transaction oluştur
        console.log('✅ Parent transaction oluşturuluyor:', {
            type: triggeredTaskTypeId,
            name: triggeredTransactionType.alias || triggeredTransactionType.name
        });
        
        const parentTransactionData = {
            type: String(triggeredTaskTypeId),
            description: `${triggeredTransactionType.alias || triggeredTransactionType.name} işlemi (Otomatik oluşturuldu)`,
            transactionHierarchy: 'parent',
            triggeringTaskId: String(createdTaskId),
            deliveryDate: deliveryDateStr || null,
            timestamp: deliveryDateStr ? new Date(deliveryDateStr).toISOString() : new Date().toISOString()
        };
        
        console.log('📤 Parent transaction verisi:', parentTransactionData);
        
        const addParentResult = await ipRecordsService.addTransactionToRecord(
            this.matchedRecord.id, 
            parentTransactionData
        );
        
        if (addParentResult.success) {
            console.log('✅ Parent transaction başarıyla oluşturuldu! ID:', addParentResult.data?.id || addParentResult.id);
            showNotification('Ana işlem (' + (triggeredTransactionType.alias || triggeredTransactionType.name) + ') otomatik olarak portföye eklendi!', 'success');
        } else {
            console.error('❌ Parent transaction oluşturulamadı:', addParentResult.error);
            showNotification('Ana işlem oluşturulamadı: ' + addParentResult.error, 'error');
        }
        
    } catch (error) {
        console.error('❌ Parent transaction oluşturma hatası:', error);
        showNotification('Parent transaction oluşturma hatası: ' + error.message, 'error');
    }
}


}
