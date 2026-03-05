// public/js/indexing/document-review-manager.js

import { 
    authService, 
    ipRecordsService, 
    transactionTypeService, 
    taskService,
    firebaseServices,
    db 
} from '../../firebase-config.js';

import { 
    doc, getDoc, updateDoc, collection, arrayUnion, Timestamp, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { 
    ref, uploadBytes, getDownloadURL 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

import { 
    showNotification, 
    debounce, 
    addMonthsToDate, 
    findNextWorkingDay, 
    isWeekend, 
    isHoliday, 
    TURKEY_HOLIDAYS,
    generateUUID,
    formatToTRDate
} from '../../utils.js';
import '../simple-loading.js';

const UNINDEXED_PDFS_COLLECTION = 'unindexed_pdfs';
const SELCAN_UID = 'dqk6yRN7Kwgf6HIJldLt9Uz77RU2'; 
const SELCAN_EMAIL = 'selcanakoglu@evrekapatent.com';

export class DocumentReviewManager {
    constructor() {
        this.pdfId = new URLSearchParams(window.location.search).get('pdfId');
        const params = new URLSearchParams(window.location.search);
        this.prefillRecordId = params.get('recordId');     // seçili kayıt
        this.prefillQuery = params.get('q');               // kayıt ara
        this.prefillDeliveryDate = params.get('deliveryDate'); // tebliğ tarihi (yyyy-MM-dd)
        this.currentUser = null;
        this.pdfData = null;
        this.matchedRecord = null;
        this.analysisResult = null;
        this.currentTransactions = []; 
        this.allTransactionTypes = []; 
        this.countryMap = new Map();
        this.init();
    }

    toYMD(raw) {
        if (!raw) return '';
        let d = raw;

        // 1. EĞER VERİ METİN (STRING) İSE
        if (typeof d === 'string') {
            
            // YENİ EKLENEN KISIM: ISO formatındaysa (Örn: "2026-02-18T11:05:05.000Z")
            // 'T' harfinden böl ve sadece ilk kısmı (tarihi) al
            if (d.includes('T')) {
                d = d.split('T')[0]; // "2026-02-18" elde edilir
            }
            
            // Zaten veritabanında YYYY-MM-DD formatındaysa doğrudan döndür
            if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
            
            // Eğer DD.MM.YYYY veya DD/MM/YYYY formatındaysa parçala ve YYYY-MM-DD'ye çevir
            const parts = d.split(/[\.\/]/);
            if (parts.length === 3) {
                return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }

        // 2. EĞER VERİ FIRESTORE TIMESTAMP VEYA DATE NESNESİ İSE
        if (d && typeof d.toDate === 'function') d = d.toDate();
        else if (d && d.seconds) d = new Date(d.seconds * 1000);

        if (!(d instanceof Date)) d = new Date(d);
        if (isNaN(d.getTime())) return '';

        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    async init() {
        // [KRİTİK DÜZELTME] 1. Her açılışta URL parametrelerini taze olarak al
        const params = new URLSearchParams(window.location.search);
        this.pdfId = params.get('pdfId');
        this.prefillRecordId = params.get('recordId');
        this.prefillQuery = params.get('q');
        this.prefillDeliveryDate = params.get('deliveryDate');

        // [KRİTİK DÜZELTME] 2. Önceki işlemden kalan verileri RAM'den sil (Reset State)
        this.matchedRecord = null;
        this.pdfData = null;
        this.currentTransactions = [];
        this.analysisResult = null;

        // [KRİTİK DÜZELTME] 3. Arama kutusunu fiziksel olarak temizle
        const searchInput = document.getElementById('manualSearchInput');
        if (searchInput) {
            searchInput.value = '';
            searchInput.removeAttribute('data-temp'); // Varsa kalıntıları sil
        }

        if (!this.pdfId) {
            console.error("PDF ID bulunamadı.");
            return;
        }

        this.currentUser = authService.getCurrentUser();
        this.setupEventListeners();
        if (window.EvrekaDatePicker) window.EvrekaDatePicker.refresh();
        await this.loadCountriesOnly();
        await this.loadTransactionTypes();
        await this.loadData();
    }

    async loadCountriesOnly() {
        try {
            const countriesSnap = await getDoc(doc(db, 'common', 'countries'));
            if (countriesSnap.exists()) {
                countriesSnap.data().list.forEach(c => this.countryMap.set(c.code, c.name));
            }
        } catch (e) { console.error("Ülke listesi yüklenemedi:", e); }
    }

    async loadTransactionTypes() {
        try {
            const result = await transactionTypeService.getTransactionTypes();
            if (result.success) this.allTransactionTypes = result.data;
        } catch (error) { console.error('İşlem tipleri yüklenemedi:', error); }
    }

    async extractTextFromPDF(url) {
        try {
            // pdfjsLib global nesnesi kontrol edilir
            if (!window.pdfjsLib) {
                console.warn('PDF.js kütüphanesi bulunamadı.');
                return null;
            }

            // Worker ayarı (CDN kullanıldığı için)
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

            const loadingTask = pdfjsLib.getDocument(url);
            const pdf = await loadingTask.promise;
            let fullText = '';

            // Performans için sadece ilk 3 sayfayı tarıyoruz
            const maxPages = Math.min(pdf.numPages, 3);

            for (let i = 1; i <= maxPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                fullText += pageText + ' ';
            }

            return fullText;
        } catch (error) {
            console.error('PDF metin okuma hatası:', error);
            return null;
        }
    }

    findRegistrationDate(text) {
        if (!text) return null;
        
        // Örnek: "22.01.2026 tarihinde tescil edilmiştir"
        // Esnek regex: Tarih formatı ve aradaki boşlukları toleranslı yakalar
        const regex = /(\d{1,2}[\.\/]\d{1,2}[\.\/]\d{4})\s+tarihinde\s+tescil\s+edilmiştir/i;
        
        const match = text.match(regex);
        if (match && match[1]) {
            return match[1]; // Sadece tarihi (örn: 22.01.2026) döndürür
        }
        return null;
    }

    // findRegistrationDate metodundan hemen sonra ekleyebilirsiniz
    findRegistrationNumber(text) {
        if (!text) return null;
        // Regex: "No" kelimesi, opsiyonel iki nokta/boşluk ve ardından gelen sayı gruplarını yakalar
        // Örnek: "No: 2023 124038" -> "2023 124038"
        const regex = /No\s*[:.]?\s*(\d{4}[\s\d]+)/i;
        
        const match = text.match(regex);
        if (match && match[1]) {
            return match[1].trim(); 
        }
        return null;
    }

    setupEventListeners() {
            // --- Mevcut Kaydet Butonu Mantığı ---
            const saveBtn = document.getElementById('saveTransactionBtn');
            if (saveBtn) {
                const newSaveBtn = saveBtn.cloneNode(true);
                saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
                newSaveBtn.addEventListener('click', (e) => { e.preventDefault(); this.handleSave(); });
            }

            // --- Mevcut Arama Girişi Mantığı ---
            const searchInput = document.getElementById('manualSearchInput');
            if (searchInput) {
                searchInput.addEventListener('input', debounce((e) => this.handleManualSearch(e.target.value), 300));
                document.addEventListener('click', (e) => {
                    const searchResults = document.getElementById('manualSearchResults');
                    if (searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                        searchResults.style.display = 'none';
                    }
                });
            }

            // --- Mevcut Seçim Kutusu Mantığı ---
            const parentSelect = document.getElementById('parentTransactionSelect');
            if (parentSelect) parentSelect.addEventListener('change', () => this.updateChildTransactionOptions());

            // ==========================================================
            // GÜNCELLEME: Tarih ve İşlem Türü Değişim Dinleyicileri
            // ==========================================================
            const childSelect = document.getElementById('detectedType');
            const dateInput = document.getElementById('detectedDate');
            
            if (childSelect) {
                childSelect.addEventListener('change', () => {
                    this.checkSpecialFields();      // Mevcut itiraz alanı kontrolü
                    this.updateCalculatedDeadline(); // YENİ: Tarih hesaplamayı tetikle
                });
            }
            
            if (dateInput) {
                dateInput.addEventListener('change', () => {
                    this.updateCalculatedDeadline(); // YENİ: Tarih hesaplamayı tetikle
                });
            }

            // --- PDF Drag & Drop (İtiraz Dilekçeleri) ---
            this._setupPdfDropzone('oppositionPetitionDropzone', 'oppositionPetitionFile', 'oppositionPetitionFileName');
            this._setupPdfDropzone('oppositionEpatsDropzone', 'oppositionEpatsPetitionFile', 'oppositionEpatsFileName');
        }

        _setupPdfDropzone(dropzoneId, inputId, filenameLabelId) {
            const dz = document.getElementById(dropzoneId);
            const input = document.getElementById(inputId);
            const fileLabel = document.getElementById(filenameLabelId);
            if (!dz || !input) return;

            const setFilename = (name) => {
                if (fileLabel) fileLabel.textContent = name || 'Dosya seçilmedi';
            };

            // Click/keyboard -> open file picker
            dz.addEventListener('click', () => input.click());
            dz.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    input.click();
                }
            });

            input.addEventListener('change', () => {
                const f = input.files && input.files[0];
                setFilename(f ? f.name : 'Dosya seçilmedi');
            });

            const prevent = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            ['dragenter', 'dragover'].forEach(evt => {
                dz.addEventListener(evt, (e) => {
                    prevent(e);
                    dz.classList.add('drag-over');
                });
            });
            ['dragleave', 'drop'].forEach(evt => {
                dz.addEventListener(evt, (e) => {
                    prevent(e);
                    dz.classList.remove('drag-over');
                });
            });

            dz.addEventListener('drop', (e) => {
                const files = e.dataTransfer?.files;
                if (!files || !files.length) return;
                const file = files[0];
                if (files.length > 1) {
                    showNotification('Birden fazla dosya bırakıldı. İlk dosya seçildi.', 'warning');
                }
                if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                    showNotification('Lütfen sadece PDF dosyası yükleyin.', 'error');
                    return;
                }
                // Programmatically set input.files (Chrome supports via DataTransfer)
                try {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    input.files = dt.files;
                } catch (err) {
                    // Fallback: keep file in memory (not used elsewhere)
                }
                setFilename(file.name);
            });
        }

        // YENİ METOT: Resmi Son Tarihi Hesapla ve Ekrana Yazdır
        updateCalculatedDeadline() {
            const dateVal = document.getElementById('detectedDate').value;
            const typeId = document.getElementById('detectedType').value;
            const displayInput = document.getElementById('calculatedDeadlineDisplay');
            
            // Alanlar eksikse kutuyu temizle ve çık
            if (!dateVal || !typeId || !displayInput) {
                if(displayInput) displayInput.value = "";
                return;
            }

            // Seçilen işlem tipinin süresini (duePeriod) bul
            const typeObj = this.allTransactionTypes.find(t => String(t.id) === String(typeId));
            
            if (!typeObj || typeObj.duePeriod === undefined) {
                displayInput.value = "Süre tanımlanmamış";
                return;
            }

            // Hesaplama Başlangıcı
            const deliveryDate = new Date(dateVal);
            let duePeriod = Number(typeObj.duePeriod || 0);
            
            // utils.js'deki merkezi fonksiyonları kullanıyoruz
            // 1. Belirtilen ay kadar ekle
            let officialDate = addMonthsToDate(deliveryDate, duePeriod);
            
            // 2. Hafta sonu ve resmi tatilleri kontrol ederek bir sonraki iş gününü bul
            officialDate = findNextWorkingDay(officialDate, TURKEY_HOLIDAYS);
            
            // 3. Ekranda kullanıcıya göster (Örn: 20.03.2026)
            displayInput.value = officialDate.toLocaleDateString('tr-TR');
        }

        // public/js/indexing/document-review-manager.js dosyasındaki loadData metodunu bu şekilde güncelleyin:

async loadData() {
    if (window.SimpleLoadingController && typeof window.SimpleLoadingController.show === 'function') {
        window.SimpleLoadingController.show({
            text: 'PDF yükleniyor',
            subtext: 'Belge hazırlanıyor, lütfen bekleyin...'
        });
        }

    try {
        const docRef = doc(db, UNINDEXED_PDFS_COLLECTION, this.pdfId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) throw new Error('PDF kaydı bulunamadı.');
        
        this.pdfData = { id: docSnap.id, ...docSnap.data() };
        console.log("📄 PDF Verisi Yüklendi:", this.pdfData); // Debug için

        if (this.pdfData.fileUrl || this.pdfData.downloadURL) {
            const pdfUrl = this.pdfData.fileUrl || this.pdfData.downloadURL;
            
            // Run extraction in background
            this.extractTextFromPDF(pdfUrl).then(text => {
                if (text) {
                    // 1. Tescil Numarasını Bul (YENİ KOD)
                    const regNo = this.findRegistrationNumber(text);
                    if (regNo) {
                        console.log("✅ PDF Tescil No Bulundu:", regNo);
                        this.extractedRegNo = regNo; // Hafızaya al

                        // Eğer input şu an ekranda varsa doldur
                        const regNoInput = document.getElementById('registry-registration-no');
                        if (regNoInput && regNoInput.offsetParent !== null) {
                            regNoInput.value = regNo;
                            // Input'un dolu olduğunu UI'a bildirmek için event tetikle
                            regNoInput.dispatchEvent(new Event('input'));
                        }
                    }

                    // 2. Tescil Tarihini Bul (MEVCUT KODUNUZ)
                    const regDate = this.findRegistrationDate(text);
                    if (regDate) {
                        console.log("✅ PDF Tescil Tarihi Bulundu:", regDate);
                        this.extractedRegDate = regDate;

                        const regDateInput = document.getElementById('registry-registration-date');
                        if (regDateInput && regDateInput.offsetParent !== null) { 
                            regDateInput.value = regDate;
                            if(regDateInput._flatpickr) regDateInput._flatpickr.setDate(regDate, true);
                            showNotification(`Tescil tarihi ve numarası belgeden okundu.`, 'info');
                        }
                    }
                }
            });
        } 

        // 1) Tebliğ tarihi alanını yyyy-MM-dd formatında doldur
        const dateInput = document.getElementById('detectedDate');
        if (dateInput) {
            // Sadece URL'den gelen zorunlu tarih veya veritabanındaki tebligTarihi alınır
            const ymd = this.prefillDeliveryDate || this.toYMD(this.pdfData?.tebligTarihi);

            if (ymd) {
                dateInput.value = ymd;
                // Datepicker görselini güncelle:
                if (dateInput._flatpickr) dateInput._flatpickr.setDate(ymd, true);
            } else {
                // Herhangi bir tebliğ tarihi yoksa kutuyu kesinlikle boş bırak (kullanıcı elle girsin)
                dateInput.value = '';
                if (dateInput._flatpickr) dateInput._flatpickr.clear();
            }
        }

        // 2) "Kayıt Ara" input'unu doldurup arat
        const searchInput = document.getElementById('manualSearchInput');
        if (searchInput && this.prefillQuery) {
            searchInput.value = this.prefillQuery;

            // gerçekten "aranmış" olsun istiyorsan:
            await this.handleManualSearch(this.prefillQuery);
        }


        // 1. PDF Görüntüleyiciyi Set Et
        const pdfViewerEl = document.getElementById('pdfViewer');
        if (pdfViewerEl) {
        const onLoaded = () => {
            if (window.SimpleLoadingController && typeof window.SimpleLoadingController.hide === 'function') {
            window.SimpleLoadingController.hide();
            }
            pdfViewerEl.removeEventListener('load', onLoaded);
        };

        pdfViewerEl.addEventListener('load', onLoaded);

        const pdfUrl = this.pdfData.fileUrl || this.pdfData.downloadURL;
        if (pdfUrl) {
            pdfViewerEl.src = pdfUrl;
        } else {
            if (window.SimpleLoadingController && typeof window.SimpleLoadingController.hide === 'function') {
            window.SimpleLoadingController.hide();
            }
        }
        } else {
        if (window.SimpleLoadingController && typeof window.SimpleLoadingController.hide === 'function') {
            window.SimpleLoadingController.hide();
        }
        }
 
        // 2. Eşleşen Kayıt Varsa Seçimi Yap
    if (this.prefillRecordId) {
        await this.selectRecord(this.prefillRecordId);
    } else if (this.pdfData.matchedRecordId) {
        await this.selectRecord(this.pdfData.matchedRecordId);
    } else {
        this.renderHeader();
    }

    if (this.pdfData.status === 'indexed') {
                showNotification('⚠️ DİKKAT: Bu belge daha önce indekslenmiş!', 'warning');
    }

    } catch (error) {
        console.error('Veri yükleme hatası:', error);
        showNotification('Veri yükleme hatası: ' + error.message, 'error');
    }
}

    async selectRecord(recordId) {
        try {
            const result = await ipRecordsService.getRecordById(recordId);
            if (result.success) {
                this.matchedRecord = result.data;

            const manualSearchInput = document.getElementById('manualSearchInput');
            if (manualSearchInput) {
                manualSearchInput.value = this.matchedRecord.applicationNumber || this.matchedRecord.applicationNo || '';
            }

                // ==========================================================
                // HİBRİT SAHİP BİLGİSİ ÇÖZÜMLEME (DOĞRUDAN İSİM VEYA ID)
                // ==========================================================
                let namesList = [];
                const rawApps = this.matchedRecord.applicants || this.matchedRecord.owners || [];
                
                for (const app of rawApps) {
                    // Durum A: Başvuru sahibi doğrudan bir metin ise
                    if (typeof app === 'string') {
                        namesList.push(app);
                    } 
                    // Durum B: Başvuru sahibi bir nesne ise
                    else if (app && typeof app === 'object') {
                        // 1. Nesne içinde doğrudan isim alanı varsa (Sizin paylaştığınız durum)
                        if (app.name || app.applicantName) {
                            namesList.push(app.name || app.applicantName);
                        } 
                        // 2. İsim yok ama ID varsa, persons koleksiyonundan çek
                        else if (app.id) {
                            try {
                                const pDoc = await getDoc(doc(db, 'persons', app.id));
                                if (pDoc.exists()) {
                                    const pData = pDoc.data();
                                    namesList.push(pData.name || pData.companyName || '-');
                                }
                            } catch (e) {
                                console.error("Kişi bilgisi sorgulanırken hata:", e);
                            }
                        }
                    }
                }
                
                // Elde edilen isimleri virgülle birleştirip geçici alana yazıyoruz
                this.matchedRecord.resolvedNames = namesList.length > 0 ? namesList.join(', ') : '-';

                this.renderHeader(); // Görseli güncelle
                await this.loadParentTransactions(recordId);
                showNotification('Kayıt seçildi: ' + this.matchedRecord.title, 'success');

                document.dispatchEvent(new CustomEvent('record-selected', { 
                    detail: { recordId: recordId } 
                }));
            }
        } catch (error) { console.error('Kayıt seçim hatası:', error); }
    }

    async loadParentTransactions(recordId) {
        const parentSelect = document.getElementById('parentTransactionSelect');
        if (!parentSelect) return;
        
        parentSelect.innerHTML = '<option value="">Yükleniyor...</option>';
        
        try {
            const transactionsResult = await ipRecordsService.getRecordTransactions(recordId);
            this.currentTransactions = transactionsResult.success ? transactionsResult.data : [];
            
            parentSelect.innerHTML = '<option value="">-- Ana İşlem Seçiniz --</option>';
            
            // Veri yoksa uyar
            if (this.currentTransactions.length === 0) {
                const opt = document.createElement('option');
                opt.textContent = "(Kayıtlı işlem geçmişi yok)";
                opt.disabled = true;
                parentSelect.appendChild(opt);
                return;
            }

            // --- TARİH ÇÖZÜMLEME YARDIMCISI ---
            const resolveDate = (item) => {
                try {
                    if (item.timestamp) return new Date(item.timestamp);
                    if (item.creationDate) return new Date(item.creationDate);
                    // Firestore Timestamp nesnesi kontrolü
                    if (item.createdAt && typeof item.createdAt.toDate === 'function') {
                        return item.createdAt.toDate();
                    }
                    if (item.createdAt) return new Date(item.createdAt);
                } catch (e) { return null; }
                return null;
            };

            const parentTransactions = this.currentTransactions
                .filter(t => t.transactionHierarchy === 'parent' || !t.transactionHierarchy)
                .sort((a, b) => {
                    const dateA = resolveDate(a);
                    const dateB = resolveDate(b);
                    // Tarih yoksa en sona at (0 kabul et)
                    const timeA = dateA ? dateA.getTime() : 0;
                    const timeB = dateB ? dateB.getTime() : 0;
                    return timeB - timeA; // Yeniden eskiye sırala
                });

            // Asenkron işlemler (Task ve Person çekme) yapacağımız için for...of kullanıyoruz
            for (const t of parentTransactions) {
                // Type ID kontrolü (String çevrimi yaparak güvenli eşleştirme)
                const typeObj = this.allTransactionTypes.find(type => String(type.id) === String(t.type));
                let label = typeObj ? (typeObj.alias || typeObj.name) : (t.description || 'İşlem');
                
                // ==========================================================
                // YENİ: İTİRAZ EDEN BİLGİSİNİ BULMA (Yayına İtiraz & İtirazın İncelenmesi)
                // ==========================================================
                const typeIdStr = String(t.type);
                if (typeIdStr === '20' || typeIdStr === '19' || t.oppositionOwner) {
                    let opponentName = null;

                    // 1. Öncelik: Doğrudan İşlem üzerinde kayıtlı oppositionOwner var mı? (Self portföyler)
                    if (t.oppositionOwner) {
                        opponentName = t.oppositionOwner;
                    } 
                    // 2. Öncelik: taskId üzerinden Task'a ve oradan Person'a git (3. Taraf veya gelişmiş Self portföyler)
                    else if (t.taskId || t.triggeringTaskId) {
                        const targetTaskId = t.taskId || t.triggeringTaskId;
                        try {
                            const taskResult = await taskService.getTaskById(targetTaskId);
                            if (taskResult.success && taskResult.data) {
                                const taskOwner = taskResult.data.taskOwner;
                                // Task owner genelde bir dizi (array) veya string olarak tutulur
                                const ownerId = Array.isArray(taskOwner) ? taskOwner[0] : taskOwner;
                                
                                if (ownerId) {
                                    // personID ile persons koleksiyonundan unvanı bul
                                    const pDoc = await getDoc(doc(db, 'persons', ownerId));
                                    if (pDoc.exists()) {
                                        const pData = pDoc.data();
                                        opponentName = pData.name || pData.companyName || null;
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn(`İtiraz eden bilgisi çekilemedi (Task ID: ${targetTaskId}):`, err);
                        }
                    }

                    // Eğer itiraz edeni bulduysak, Option etiketine ekle
                    if (opponentName) {
                        label += ` [İtiraz Eden: ${opponentName}]`;
                    }
                }
                // ==========================================================

                // Tarihi formatla
                const dateObj = resolveDate(t);
                const dateStr = formatToTRDate(dateObj);
                
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${label} (${dateStr})`;
                parentSelect.appendChild(opt);
            }
            
        } catch (error) {
            console.error('Transaction yükleme hatası:', error);
            parentSelect.innerHTML = '<option value="">Hata: İşlemler yüklenemedi</option>';
        }
    }


    updateChildTransactionOptions() {
        const parentSelect = document.getElementById('parentTransactionSelect');
        const childSelect = document.getElementById('detectedType');
        const selectedParentTxId = parentSelect.value;
        
        childSelect.innerHTML = '<option value="">-- İşlem Türü Seçiniz --</option>';
        childSelect.disabled = true;
        
        if (!selectedParentTxId) return;
        
        const selectedParentTx = this.currentTransactions.find(t => t.id === selectedParentTxId);
        const parentTypeId = selectedParentTx?.type;
        
        const parentTypeObj = this.allTransactionTypes.find(t => String(t.id) === String(parentTypeId));
        
        if (!parentTypeObj || !parentTypeObj.indexFile) {
            console.warn('Bu ana işlem için tanımlı alt işlem bulunamadı.');
            return;
        }
        
        const allowedChildIds = Array.isArray(parentTypeObj.indexFile) ? parentTypeObj.indexFile.map(String) : [];
        
        const allowedChildTypes = this.allTransactionTypes
            .filter(t => allowedChildIds.includes(String(t.id)))
            .sort((a, b) => (a.order || 999) - (b.order || 999));
            
        allowedChildTypes.forEach(type => {
            const opt = document.createElement('option');
            opt.value = type.id;
            opt.textContent = type.alias || type.name;
            childSelect.appendChild(opt);
        });
        
        childSelect.disabled = false;
        
        // Eğer analiz sonucu varsa otomatik seç (Metot varsa)
        if (this.analysisResult && this.analysisResult.detectedType && typeof this.autoSelectChildType === 'function') {
            this.autoSelectChildType(childSelect);
        }
    }

    checkSpecialFields() {
        const childSelect = document.getElementById('detectedType');
        const parentSelect = document.getElementById('parentTransactionSelect');
        
        if (!childSelect || !parentSelect) return;

        const childTypeId = String(childSelect.value);
        const parentTxId = String(parentSelect.value);

        // 1. İtiraz Bölümü Kontrolü
        const oppositionSection = document.getElementById('oppositionSection');
        if (oppositionSection) {
            oppositionSection.style.display = (childTypeId === '27') ? 'block' : 'none';
        }

        // 2. Tescil ve Eşya Listesi Formu Kontrolü
        const registrationSection = document.getElementById('registry-editor-section'); 
        
        if (registrationSection) {
            let showRegistration = false;
            
            const selectedOption = childSelect.options[childSelect.selectedIndex];
            const childText = selectedOption ? selectedOption.text.toLowerCase() : '';

            // Görünürlük Mantığı
            if (childTypeId === '45' || childText.includes('tescil belgesi')) {
                showRegistration = true;
            }
            else if (childTypeId === '40') {
                if (this.currentTransactions && parentTxId) {
                    const parentTx = this.currentTransactions.find(t => String(t.id) === parentTxId);
                    if (parentTx) {
                        const parentType = String(parentTx.type);
                        if (parentType === '6' || parentType === '17') {
                            showRegistration = true;
                        }
                    }
                }
            }
            
            registrationSection.style.display = showRegistration ? 'block' : 'none';
            
            // --- BUTON VE INPUT YÖNETİMİ ---
            const savePortfolioBtn = document.getElementById('save-portfolio-btn'); // Portföy kaydet butonu (Varsa ID'sini kontrol edin)
            const indexBtn = document.getElementById('saveTransactionBtn'); // İndeksle butonu

            if (showRegistration) {
                // A) PDF'ten okunan verileri doldur
                if (this.extractedRegNo) {
                    const regNoInput = document.getElementById('registry-registration-no');
                    if (regNoInput && !regNoInput.value) {
                        regNoInput.value = this.extractedRegNo;
                        regNoInput.dispatchEvent(new Event('input'));
                    }
                }
                if (this.extractedRegDate) {
                    const regDateInput = document.getElementById('registry-registration-date');
                if (regDateInput && !regDateInput.value) {
                    regDateInput.value = this.extractedRegDate;
                    // Merkezi yapıdaki instance'ı güncelle:
                    if (regDateInput._flatpickr) {
                        regDateInput._flatpickr.setDate(this.extractedRegDate, true);
                    }
                }
                }
                // Marka durumu "Tescilli"
                const statusSelect = document.getElementById('registry-status') || document.getElementById('status');
                if (statusSelect) {
                    statusSelect.value = 'registered'; 
                    if (statusSelect.selectedIndex === -1) {
                        for (let i = 0; i < statusSelect.options.length; i++) {
                            if (statusSelect.options[i].text.toLowerCase().includes('tescilli')) {
                                statusSelect.selectedIndex = i;
                                break;
                            }
                        }
                    }
                    statusSelect.dispatchEvent(new Event('change'));
                }

                // B) Butonları Düzenle (Tek Buton Deneyimi)
                if (savePortfolioBtn && indexBtn) {
                    savePortfolioBtn.style.display = 'none'; // Kaydet butonunu gizle
                    indexBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Kaydet ve İndeksle';
                    indexBtn.classList.remove('btn-primary');
                    indexBtn.classList.add('btn-success'); // Yeşil yap
                }

            } else {
                // Form kapalıysa butonları eski haline getir
                if (savePortfolioBtn && indexBtn) {
                    savePortfolioBtn.style.display = 'inline-block'; 
                    indexBtn.innerHTML = '<i class="fas fa-check mr-2"></i>İndeksle';
                    indexBtn.classList.remove('btn-success');
                    indexBtn.classList.add('btn-primary');
                }
            }
        }
    }

    async handleSave() {
        if (!this.matchedRecord) { alert('Lütfen önce bir kayıt ile eşleştirin.'); return; }
        const parentTxId = document.getElementById('parentTransactionSelect').value;
        const childTypeId = document.getElementById('detectedType').value;
        const deliveryDateStr = document.getElementById('detectedDate').value;
        const notes = document.getElementById('transactionNotes').value;

        if (!parentTxId || !childTypeId || !deliveryDateStr) {
            showNotification('Lütfen tüm zorunlu alanları doldurun.', 'error');
            return;
        }

        // Tescil Belgesi için Zorunlu Alan Kontrolü
        try {
            const childSelect = document.getElementById('detectedType');
            const selectedText = childSelect?.options?.[childSelect.selectedIndex]?.text || '';
            const typeText = String(selectedText).toLowerCase();
            const parentTx = this.currentTransactions?.find(t => String(t.id) === String(parentTxId));
            const parentTypeId = String(parentTx?.type || '');

            const isRegistryIndexing =
                String(childTypeId) === '45' ||
                typeText.includes('tescil belgesi') ||
                (String(childTypeId) === '40' && (parentTypeId === '6' || parentTypeId === '17'));

            if (isRegistryIndexing) {
                const regNoEl = document.getElementById('registry-registration-no');
                const regDateEl = document.getElementById('registry-registration-date');
                const regNo = String(regNoEl?.value || '').trim();
                const regDate = String(regDateEl?.value || '').trim();

                if (!regNo || !regDate) {
                    showNotification('Tescil Belgesi için Tescil No ve Tarih zorunludur.', 'error');
                    if (!regNo && regNoEl) regNoEl.focus();
                    else if (!regDate && regDateEl) regDateEl.focus();
                    return;
                }
            }
        } catch (e) { /* validation ignore */ }

        // --- DOĞRUDAN VERİ GÜNCELLEME (DÜZELTİLMİŞ BLOK) ---
        const regSection = document.getElementById('registry-editor-section');
        if (regSection && regSection.style.display !== 'none' && this.matchedRecord) {
            try {
                // 1. Formdaki Güncel Değerleri Oku
                const regNoVal = document.getElementById('registry-registration-no')?.value;
                const regDateVal = document.getElementById('registry-registration-date')?.value;
                const statusVal = document.getElementById('registry-status')?.value || document.getElementById('status')?.value;

                // 2. Güncellenecek Objeyi Hazırla
                const updates = {};
                
                // [DÜZELTME]: Sadece Tescil Numarasını güncelliyoruz. Başvuru numarasına dokunmuyoruz.
                if (regNoVal) {
                    updates.registrationNumber = regNoVal;
                }
                
                if (regDateVal) {
                    updates.registrationDate = regDateVal;
                }

                if (statusVal) {
                    updates.status = statusVal;
                }

                // 3. Veritabanını Güncelle
                if (Object.keys(updates).length > 0) {
                    console.log("💾 Veriler doğrudan kaydediliyor:", updates);
                    const recordRef = doc(db, 'ipRecords', this.matchedRecord.id);
                    await updateDoc(recordRef, updates);
                    showNotification('Kayıt bilgileri güncellendi.', 'success');
                }

            } catch (err) {
                console.error("Kayıt güncelleme hatası:", err);
                showNotification('Veriler güncellenirken hata oluştu ancak indeksleme devam ediyor.', 'warning');
            }
        }
        // --- DOĞRUDAN GÜNCELLEME SONU ---

        const saveBtn = document.getElementById('saveTransactionBtn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> İşleniyor...';

        try {
            const childTypeObj = this.allTransactionTypes.find(t => t.id === childTypeId);
            const parentTx = this.currentTransactions.find(t => t.id === parentTxId);
            const parentTypeObj = this.allTransactionTypes.find(t => t.id === parentTx?.type);

            // 1. İtiraz Bildirimi & Dosya Yükleme
            let newParentTxId = null;
            let oppositionFileUrl = null;
            let oppositionFileName = null;
            let oppositionEpatsFileUrl = null;
            let oppositionEpatsFileName = null;

            if (String(childTypeId) === '27') { 
                const ownerInput = document.getElementById('oppositionOwnerInput').value;
                const fileInput = document.getElementById('oppositionPetitionFile').files[0];
                const epatsFileInput = document.getElementById('oppositionEpatsPetitionFile')?.files?.[0] || null;
                if (!ownerInput || !fileInput) throw new Error('İtiraz Sahibi ve PDF zorunludur.');

                const storageRef = ref(firebaseServices.storage, `opposition-petitions/${this.matchedRecord.id}/${Date.now()}_${fileInput.name}`);
                await uploadBytes(storageRef, fileInput);
                oppositionFileUrl = await getDownloadURL(storageRef);
                oppositionFileName = fileInput.name;

                if (epatsFileInput) {
                    const epatsRef = ref(firebaseServices.storage, `opposition-epats-petitions/${this.matchedRecord.id}/${Date.now()}_${epatsFileInput.name}`);
                    await uploadBytes(epatsRef, epatsFileInput);
                    oppositionEpatsFileUrl = await getDownloadURL(epatsRef);
                    oppositionEpatsFileName = epatsFileInput.name;
                }

                let newParentTypeId = '20'; 
                let newParentDesc = 'Yayına İtiraz (Otomatik)';
                const parentAlias = parentTypeObj?.alias || parentTypeObj?.name || '';
                if (parentAlias.includes('İtiraz') || String(parentTypeObj?.id) === '20') {
                    newParentTypeId = '19'; 
                    newParentDesc = 'Yayına İtirazın Yeniden İncelenmesi (Otomatik)';
                }

                const newParentData = {
                    type: newParentTypeId,
                    description: newParentDesc,
                    transactionHierarchy: 'parent',
                    oppositionOwner: ownerInput,
                    oppositionPetitionFileUrl: oppositionFileUrl,
                    oppositionEpatsPetitionFileUrl: oppositionEpatsFileUrl,
                    timestamp: new Date().toISOString()
                };
                const newParentResult = await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, newParentData);
                if (newParentResult.success) newParentTxId = newParentResult.id;
            }

            const finalParentId = newParentTxId || parentTxId;

            // 2. Child Transaction Oluştur
            const transactionData = {
                type: childTypeId,
                transactionHierarchy: 'child',
                parentId: finalParentId,
                description: childTypeObj.alias || childTypeObj.name,
                date: deliveryDateStr ? new Date(deliveryDateStr).toISOString() : new Date().toISOString(),
            };

            const txResult = await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, transactionData);
            const childTransactionId = txResult.id;

            // Dosyaları Belge Olarak Ekle
            if (this.pdfData.fileUrl && txResult.success) {
                const mainDocPayload = {
                    id: generateUUID(),
                    name: this.pdfData.fileName || 'Resmi Yazı.pdf',
                    downloadURL: this.pdfData.fileUrl,
                    type: 'application/pdf',
                    documentDesignation: 'Resmi Yazı',
                    uploadedAt: new Date().toISOString()
                };
                const txRef = doc(collection(db, 'ipRecords', this.matchedRecord.id, 'transactions'), childTransactionId);
                await updateDoc(txRef, { documents: arrayUnion(mainDocPayload) });
            }

            if (String(childTypeId) === '27' && oppositionFileUrl && txResult.success) {
                const docsToAdd = [];
                const oppDocPayload = {
                    id: generateUUID(),
                    name: oppositionFileName || 'opposition_petition.pdf',
                    downloadURL: oppositionFileUrl,
                    type: 'application/pdf',
                    documentDesignation: 'İtiraz Dilekçesi',
                    uploadedAt: new Date().toISOString()
                };
                docsToAdd.push(oppDocPayload);

                if (oppositionEpatsFileUrl) {
                    const oppEpatsDocPayload = {
                        id: generateUUID(),
                        name: oppositionEpatsFileName || 'opposition_epats_petition.pdf',
                        downloadURL: oppositionEpatsFileUrl,
                        type: 'application/pdf',
                        documentDesignation: 'Karşı ePATS Dilekçesi',
                        uploadedAt: new Date().toISOString()
                    };
                    docsToAdd.push(oppEpatsDocPayload);
                }
                const txRef = doc(collection(db, 'ipRecords', this.matchedRecord.id, 'transactions'), childTransactionId);
                await updateDoc(txRef, { documents: arrayUnion(...docsToAdd) });
            }

            // 3. İş Tetikleme (Task) - [DÜZELTİLDİ: SIRALI KONTROL]
            let shouldTriggerTask = false;
            const recordType = (this.matchedRecord.recordOwnerType === 'self') ? 'Portföy' : '3. Taraf';
            
            const parentTypeId = String(parentTx.type); 
            const childTypeIdStr = String(childTypeId);
            
            const taskTriggerMatrix = {
                "20": { "Portföy": ["50", "51"], "3. Taraf": ["51", "52"] },
                "19": { "Portföy": ["32", "33", "34", "35"], "3. Taraf": ["31", "32", "35", "36"] }
            };
            let skipFallback = false;

            if (taskTriggerMatrix[parentTypeId]) {
                const allGovernedChildren = [
                    ...(taskTriggerMatrix[parentTypeId]["Portföy"] || []),
                    ...(taskTriggerMatrix[parentTypeId]["3. Taraf"] || [])
                ];

                if (allGovernedChildren.includes(childTypeIdStr)) {
                    skipFallback = true; 
                    if (taskTriggerMatrix[parentTypeId][recordType] && taskTriggerMatrix[parentTypeId][recordType].includes(childTypeIdStr)) {
                        shouldTriggerTask = true;
                    } else {
                        shouldTriggerTask = false;
                    }
                }
            }

            if (!shouldTriggerTask && !skipFallback) {
                if (childTypeObj.taskTriggered) {
                    shouldTriggerTask = true;
                }
            }

            // --- GÖREV VE OTOMATİK İŞLEM OLUŞTURMA BLOĞU (ÇOKLU GÖREV DESTEĞİ) ---
            if (shouldTriggerTask) {
                const deliveryDate = new Date(deliveryDateStr);
                let duePeriod = Number(childTypeObj.duePeriod || 0);
                
                let officialDueDate = addMonthsToDate(deliveryDate, duePeriod);
                officialDueDate = findNextWorkingDay(officialDueDate, TURKEY_HOLIDAYS);
                let taskDueDate = new Date(officialDueDate);
                taskDueDate.setDate(taskDueDate.getDate() - 3);
                while (isWeekend(taskDueDate) || isHoliday(taskDueDate, TURKEY_HOLIDAYS)) {
                    taskDueDate.setDate(taskDueDate.getDate() - 1);
                }

                let assignedUser = { uid: SELCAN_UID, email: SELCAN_EMAIL };
                let relatedPartyData = null;
                let taskOwner = []; 

                if (this.matchedRecord.recordOwnerType === 'self') {
                    if (Array.isArray(this.matchedRecord.applicants) && this.matchedRecord.applicants.length > 0) {
                        taskOwner = this.matchedRecord.applicants
                            .map(app => String(app.id || app.personId))
                            .filter(Boolean);
                        
                        const app = this.matchedRecord.applicants[0];
                        if (app && (app.id || app.personId)) {
                            relatedPartyData = { id: app.id || app.personId, name: app.name || 'İsimsiz' };
                        }
                    }
                } 
                else if (this.matchedRecord.recordOwnerType === 'third_party') {
                    const triggeringTaskId = parentTx?.triggeringTaskId || parentTx?.taskId;
                    if (triggeringTaskId) {
                        try {
                            const prevTaskResult = await taskService.getTaskById(triggeringTaskId);
                            if (prevTaskResult.success && prevTaskResult.data) {
                                const prevTask = prevTaskResult.data;
                                if (prevTask.taskOwner) {
                                    taskOwner = Array.isArray(prevTask.taskOwner) ? prevTask.taskOwner : [prevTask.taskOwner];
                                }
                                if (prevTask.details && prevTask.details.relatedParty) {
                                    relatedPartyData = prevTask.details.relatedParty;
                                }
                            }
                        } catch (e) { console.warn('Parent task fetch error:', e); }
                    }

                    if ((!taskOwner || taskOwner.length === 0) && this.matchedRecord.client) {
                        const clientId = this.matchedRecord.client.id || this.matchedRecord.client.personId;
                        if (clientId) {
                            taskOwner = [String(clientId)];
                            relatedPartyData = { id: clientId, name: this.matchedRecord.client.name || 'Müvekkil' };
                        }
                    }
                }

                // 🔥 1. Tetiklenecek Görevleri Bir Dizide Topla
                let tasksToCreate = [];
                
                // Normalde tetiklenmesi gereken standart işlemi (Örn: 19) ekle
                if (childTypeObj.taskTriggered) {
                    tasksToCreate.push(String(childTypeObj.taskTriggered));
                }

                // --- KİŞİ BAZLI TOGGLE KONTROLÜ (ID 66) VE MÜVEKKİL İSMİ TESPİTİ ---
                let fetchedPersonName = null;
                if (taskOwner && taskOwner.length > 0) {
                    try {
                        const personDoc = await getDoc(doc(db, 'persons', taskOwner[0]));
                        if (personDoc.exists()) {
                            const personData = personDoc.data();
                            
                            // Değerlendirme toggle'ı aktifse, listeye 66 nolu işi İLAVE ET
                            if (personData.is_evaluation_required === true) {
                                console.log("🔍 Müvekkil için Değerlendirme İşlemi (66) diziye eklendi.");
                                if (!tasksToCreate.includes("66")) {
                                    tasksToCreate.push("66");
                                }
                            }
                            
                            fetchedPersonName = personData.name || personData.companyName || null;
                        }
                    } catch (e) { 
                        console.warn("Kişi bilgisi okunamadı:", e); 
                    }
                }

                // Denormalize alanların hesaplanması (Rakip Adı Engellendi)
                let ipAppNo = this.matchedRecord.applicationNumber || this.matchedRecord.applicationNo || "-";
                let ipTitle = this.matchedRecord.title || this.matchedRecord.markName || "-";
                let ipAppName = "-";

                const isSelfPortfolio = (this.matchedRecord.recordOwnerType === 'self');

                if (!isSelfPortfolio) {
                    if (fetchedPersonName) {
                        ipAppName = fetchedPersonName;
                        if (relatedPartyData) relatedPartyData.name = fetchedPersonName;
                    }
                    else if (relatedPartyData && relatedPartyData.name) {
                        ipAppName = relatedPartyData.name;
                    } 
                    else if (parentTx && parentTx.oppositionOwner) {
                        ipAppName = parentTx.oppositionOwner;
                    } 
                    else if (this.matchedRecord.client && this.matchedRecord.client.name) {
                        ipAppName = this.matchedRecord.client.name;
                    } 
                    else {
                        ipAppName = "Müvekkil (Belirtilmemiş)";
                    }
                } else {
                    ipAppName = this.matchedRecord.resolvedNames || "-";

                    if (ipAppName === "-" || !ipAppName) {
                        if (Array.isArray(this.matchedRecord.applicants) && this.matchedRecord.applicants.length > 0) {
                            ipAppName = this.matchedRecord.applicants[0].name || "-";
                        } else if (this.matchedRecord.client && this.matchedRecord.client.name) {
                            ipAppName = this.matchedRecord.client.name;
                        }
                    }
                }

                // 🔥 2. Listedeki HER BİR Görev İçin Döngü Kur
                for (const tType of tasksToCreate) {
                    
                    let taskDesc = notes || `Otomatik oluşturulan görev.`;
                    if (tType === "66") {
                        taskDesc = "Müvekkil değerlendirme ayarı açık olduğu için ek olarak tetiklendi.";
                    }

                    const taskData = {
                        title: `${childTypeObj.alias || childTypeObj.name} - ${this.matchedRecord.title}`,
                        description: taskDesc,
                        taskType: tType, // <-- "19" ve "66" sırayla oluşturulacak
                        relatedRecordId: this.matchedRecord.id,
                        relatedIpRecordId: this.matchedRecord.id,
                        relatedIpRecordTitle: this.matchedRecord.title,
                        
                        iprecordApplicationNo: ipAppNo,
                        iprecordTitle: ipTitle,
                        iprecordApplicantName: ipAppName,

                        transactionId: childTransactionId, 
                        triggeringTransactionType: childTypeId,
                        deliveryDate: deliveryDateStr,
                        dueDate: Timestamp.fromDate(taskDueDate),
                        officialDueDate: Timestamp.fromDate(officialDueDate),
                        createdAt: Timestamp.now(),
                        updatedAt: Timestamp.now(),
                        status: 'awaiting_client_approval',
                        priority: 'medium',
                        assignedTo_uid: assignedUser.uid,
                        assignedTo_email: assignedUser.email,
                        createdBy: {
                            uid: this.currentUser.uid,
                            email: this.currentUser.email
                        },
                        taskOwner: taskOwner.length > 0 ? taskOwner : null,
                        details: {
                            relatedParty: relatedPartyData 
                        },
                        history: [{
                            action: 'İndeksleme işlemi ile otomatik oluşturuldu.',
                            timestamp: new Date().toISOString(),
                            userEmail: this.currentUser.email
                        }]
                    };

                    const taskResult = await taskService.createTask(taskData);
                    
                    if (taskResult.success) {
                        const createdTaskId = taskResult.id;
                        
                        // Alt işlemi taskID ile güncelle
                        const txRef = doc(collection(db, 'ipRecords', this.matchedRecord.id, 'transactions'), childTransactionId);
                        await updateDoc(txRef, { taskId: String(createdTaskId) });

                        // Otomatik İşlem Kaydını Oluştur
                        const triggeredTypeObj = this.allTransactionTypes.find(t => String(t.id) === String(tType));
                        const triggeredTypeName = triggeredTypeObj ? (triggeredTypeObj.alias || triggeredTypeObj.name) : 'Otomatik İşlem';
                        const targetHierarchy = triggeredTypeObj?.hierarchy || 'child'; 

                        const triggeredTransactionData = {
                            type: tType,
                            description: `${triggeredTypeName} (Otomatik)`,
                            transactionHierarchy: targetHierarchy,
                            taskId: String(createdTaskId),
                            timestamp: new Date().toISOString()
                        };

                        if (targetHierarchy === 'child') {
                            triggeredTransactionData.parentId = finalParentId;
                        }
                        await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, triggeredTransactionData);
                    }
                } // Döngü sonu
            }

            // REQUEST RESULT GÜNCELLEME
            if (finalParentId && childTypeId) {
                try {
                    const parentTxRef = doc(db, 'ipRecords', this.matchedRecord.id, 'transactions', finalParentId);
                    await updateDoc(parentTxRef, { 
                        requestResult: childTypeId, 
                        requestResultUpdatedAt: new Date().toISOString() 
                    });
                } catch (err) { console.error('requestResult error:', err); }
            }

            // PDF Statüsü
            await updateDoc(doc(db, UNINDEXED_PDFS_COLLECTION, this.pdfId), {
                status: 'indexed',
                indexedAt: new Date(),
                finalTransactionId: childTransactionId,
                matchedRecordId: this.matchedRecord.id
            });

            showNotification('İşlem başarıyla tamamlandı!', 'success');
            setTimeout(() => window.location.href = 'bulk-indexing-page.html', 1500);

        } catch (error) {
            console.error('Kaydetme hatası:', error);
            showNotification('Hata: ' + error.message, 'error');
            saveBtn.disabled = false;
        }
    }

    renderHeader() {
        if (document.getElementById('fileNameDisplay')) {
            document.getElementById('fileNameDisplay').textContent = this.pdfData?.fileName || 'Dosya yükleniyor...';
        }
        
        const matchInfoEl = document.getElementById('matchInfoDisplay');
        if (!matchInfoEl) return;

        if (this.matchedRecord) {
            const imgUrl = this.matchedRecord.brandImageUrl || 
                        this.matchedRecord.trademarkImage || 
                        this.matchedRecord.publicImageUrl || 
                        './img/no-image.png';

            // selectRecord'da hazırladığımız akıllı listeyi kullanıyoruz
            const applicantNames = this.matchedRecord.resolvedNames || '-';

            matchInfoEl.innerHTML = `
                <div class="d-flex align-items-center">
                    <div class="mr-3 border rounded bg-white p-1 shadow-sm" style="width: 70px; height: 70px; overflow: hidden;">
                        <img src="${imgUrl}" class="img-fluid w-100 h-100" style="object-fit: contain;" 
                            onerror="this.src='./img/no-image.png'">
                    </div>
                    <div class="flex-grow-1 overflow-hidden">
                        <h6 class="mb-1 text-primary font-weight-bold text-truncate" title="${this.matchedRecord.title}">
                            ${this.matchedRecord.title}
                        </h6>
                        <div class="d-flex small text-dark mb-1">
                            <span class="mr-3"><strong>No:</strong> ${this.matchedRecord.applicationNumber || '-'}</span>
                        </div>
                        <div class="small text-muted text-truncate" title="${applicantNames}">
                            <i class="fas fa-user-tie mr-1"></i>${applicantNames}
                        </div>
                    </div>
                    <div class="ml-2">
                        <span class="badge badge-success badge-pill px-3 py-2"><i class="fas fa-check mr-1"></i>Bağlandı</span>
                    </div>
                </div>`;
        } else {
            matchInfoEl.innerHTML = `
                <div class="d-flex align-items-center justify-content-center h-100 py-3">
                    <div class="text-warning font-weight-bold"><i class="fas fa-exclamation-circle mr-2"></i>Eşleşen Kayıt Bulunmuyor</div>
                </div>`;
        }
    }

    async handleManualSearch(queryText) {
        const resultsContainer = document.getElementById('manualSearchResults');
        if (!queryText || queryText.length < 3) { resultsContainer.style.display = 'none'; return; }
        
        // 1. Standart Arama (Servis üzerinden)
        const result = await ipRecordsService.searchRecords(queryText);
        let resultsData = result.success ? result.data : [];

        // 🔥 WIPO PARENT EKSİKLİĞİNİ GİDEREN ÖZEL SORGUSU
        // Standart servis araması WIPO numaralarını ('internationalRegNumber') atlayabiliyor.
        const cleanQuery = queryText.trim();
        if (cleanQuery.length >= 4) {
            try {
                const recordsRef = collection(db, 'ipRecords');
                
                // Paralel sorgular ile WIPO numaralarını Firestore'da direkt arıyoruz
                const extraQueries = [
                    getDocs(query(recordsRef, where('internationalRegNumber', '==', cleanQuery))),
                    getDocs(query(recordsRef, where('wipoIR', '==', cleanQuery))),
                    getDocs(query(recordsRef, where('aripoIR', '==', cleanQuery)))
                ];

                const snapshots = await Promise.all(extraQueries);
                
                snapshots.forEach(snap => {
                    snap.forEach(docSnap => {
                        const data = { id: docSnap.id, ...docSnap.data() };
                        // Zaten listede yoksa EN BAŞA ekle ki ilk sırada 'ANA KAYIT' olarak görünsün
                        if (!resultsData.some(r => r.id === data.id)) {
                            resultsData.unshift(data);
                        }
                    });
                });
            } catch (err) {
                console.warn("WIPO parent ek sorgu hatası:", err);
            }
        }

        this.renderSearchResults(resultsData);
    }

    renderSearchResults(results) {
        const container = document.getElementById('manualSearchResults');
        if (!container) return;
        
        container.innerHTML = '';
        container.style.display = results.length ? 'block' : 'none';
        
        if (!results.length) { 
            container.innerHTML = '<div class="p-2 text-muted italic">Sonuç bulunamadı.</div>'; 
            return; 
        }

        container.innerHTML = results.map(r => {
            const countryName = this.countryMap.get(r.country) || r.country || '-';
            const detailText = `${r.applicationNumber || r.internationalRegNumber || r.wipoIR || '-'} • ${r.origin || 'WIPO'} • ${countryName}`;
            
            return `
                <div class="search-result-item p-2 border-bottom" style="cursor:pointer" data-id="${r.id}">
                    <div class="font-weight-bold text-primary" style="font-size:0.9rem;">${r.title || r.markName || '(İsimsiz)'}</div>
                    <div class="small text-muted" style="font-size:0.75rem;">${detailText}</div>
                </div>`;
        }).join('');

        container.querySelectorAll('.search-result-item').forEach(el => {
            el.onclick = () => {
                const selected = results.find(rec => rec.id === el.dataset.id);
                if (selected) {
                    this.selectRecordWithHierarchy(selected); // <-- selectRecord yerine bu çalışacak
                }
                container.style.display = 'none';
            };
        });
    }

    async selectRecordWithHierarchy(record) {
        console.group("🔍 WIPO Hiyerarşi Kontrolü");
        console.log("Seçilen Kayıt:", record);

        if (!record) {
            console.error("Hata: Kayıt verisi boş!");
            console.groupEnd();
            return;
        }

        // 1. WIPO/ARIPO Parent Tespiti
        const origin = (record.origin || '').toUpperCase();
        const hierarchy = (record.transactionHierarchy || 'parent').toLowerCase();
        
        const isInternational = ['WIPO', 'ARIPO', 'WO', 'AP'].some(o => origin.includes(o));
        const isParent = hierarchy === 'parent';

        console.log(`Analiz: Origin=${origin}, Hierarchy=${hierarchy} -> International: ${isInternational}, IsParent: ${isParent}`);

        if (isInternational && isParent) {
            if (window.SimpleLoadingController) {
                window.SimpleLoadingController.show({ text: 'Alt dosyalar ve ulusal kayıtlar aranıyor...' });
            }
            
            try {
                const parentId = record.id;
                // Numarayı atomik hale getir (Sadece rakamlar)
                const parentIR = String(record.internationalRegNumber || record.wipoIR || '').replace(/\D/g, '');
                
                console.log(`Sorgu Hazırlanıyor: parentId=${parentId}, parentIR=${parentIR}`);

                const recordsRef = collection(db, 'ipRecords');
                
                // Firestore sorgusu: Sadece bu parent'a bağlı child kayıtları iste
                const q = query(recordsRef, where('transactionHierarchy', '==', 'child'));
                const querySnapshot = await getDocs(q);
                
                console.log(`Firestore'dan ${querySnapshot.docs.length} adet child aday kayıt geldi. Filtreleniyor...`);

                const children = querySnapshot.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(child => {
                        const childIR = String(child.wipoIR || child.internationalRegNumber || '').replace(/\D/g, '');
                        // Eşleşme Şartı: parentId UUID eşleşmesi VEYA IR Numarası eşleşmesi
                        const isMatch = (child.parentId === parentId) || (parentIR !== "" && childIR === parentIR);
                        
                        if (isMatch) console.log("✅ Eşleşen Child:", child.country, child.id);
                        return isMatch;
                    });

                if (window.SimpleLoadingController) window.SimpleLoadingController.hide();

                if (children.length > 0) {
                    console.log(`Toplam ${children.length} adet alt kayıt bulundu. Modal açılıyor.`);
                    console.groupEnd();
                    this._openWipoSelectionModal(record, children);
                    return;
                } else {
                    console.warn("Hiç alt kayıt (child) bulunamadı. Doğrudan ana kayıt seçiliyor.");
                }
            } catch (err) {
                console.error("Alt kayıt sorgulama sırasında kritik hata:", err);
                if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
            }
        }

        console.log("Standart seçim akışına devam ediliyor...");
        console.groupEnd();
        await this.selectRecord(record.id);
    }

    _openWipoSelectionModal(parent, children) {
        const listEl = document.getElementById('wipoSelectionList');
        if (!listEl) return;

        listEl.innerHTML = '';
        [parent, ...children].forEach(rec => {
            const isParent = rec.id === parent.id;
            const country = isParent ? 'Uluslararası' : (this.countryMap.get(rec.country) || rec.country || '-');
            
            const item = document.createElement('button');
            item.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center mb-2 border rounded shadow-sm";
            item.innerHTML = `
                <div class="d-flex align-items-center">
                    <i class="fas ${isParent ? 'fa-globe-americas text-primary' : 'fa-flag text-danger'} fa-lg mr-3"></i>
                    <div>
                        <div class="font-weight-bold">${rec.title}</div>
                        <div class="small text-muted">${rec.wipoIR || rec.internationalRegNumber || '-'} • ${rec.origin} • ${country}</div>
                    </div>
                </div>
                <span class="badge ${isParent ? 'badge-primary' : 'badge-light border'} px-2 py-1">${isParent ? 'ANA KAYIT' : 'ULUSAL'}</span>
            `;
            item.onclick = () => {
                this.selectRecord(rec.id);
                if (typeof $ !== 'undefined') $('#wipoSelectionModal').modal('hide');
            };
            listEl.appendChild(item);
        });
        if (typeof $ !== 'undefined') $('#wipoSelectionModal').modal('show');
    }
}

export async function resolveApprovalStateAssignee() {
  // Fonksiyon artık kullanılmıyor ama hata vermemesi için boş bırakıldı.
  return { uid: null, email: null };
}

document.addEventListener('DOMContentLoaded', () => {
    new DocumentReviewManager();
});

