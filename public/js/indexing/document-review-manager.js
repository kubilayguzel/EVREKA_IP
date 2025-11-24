// public/js/indexing/document-review-manager.js

import { 
    authService, 
    ipRecordsService, 
    transactionTypeService, // İşlem tiplerini ve kurallarını çekmek için
    taskService,            // Görev oluşturmak için
    db 
} from '../../firebase-config.js';

import { 
    doc, getDoc, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { showNotification, debounce } from '../../utils.js';

// Servisler
import { PdfExtractor } from './pdf-extractor.js';
import { PdfAnalyzer } from './pdf-analyzer.js';

const UNINDEXED_PDFS_COLLECTION = 'unindexed_pdfs';

export class DocumentReviewManager {
    constructor() {
        this.pdfId = new URLSearchParams(window.location.search).get('pdfId');
        this.currentUser = null;
        this.pdfData = null;
        this.matchedRecord = null;
        this.analysisResult = null;
        this.recordTransactions = []; 
        this.allTransactionTypes = []; // Tüm işlem tiplerini (kurallarıyla beraber) burada tutacağız
        
        // Servisler
        this.pdfExtractor = new PdfExtractor();
        this.analyzer = new PdfAnalyzer();

        this.init();
    }

    async init() {
        if (!this.pdfId) {
            alert('PDF ID bulunamadı!');
            window.location.href = 'bulk-indexing-page.html';
            return;
        }

        this.currentUser = authService.getCurrentUser();
        this.setupEventListeners();
        
        // Kritik Verileri Paralel Yükle
        await Promise.all([
            this.loadTransactionTypes(), // Kuralları çek
            this.loadData()              // PDF verisini çek
        ]);
    }

    // --- 1. İşlem Tiplerini ve Kurallarını Yükle ---
    async loadTransactionTypes() {
        try {
            const result = await transactionTypeService.getTransactionTypes();
            if (result.success) {
                this.allTransactionTypes = result.data;
                this.populateTransactionTypesDropdown();
            }
        } catch (error) {
            console.error('İşlem tipleri yüklenemedi:', error);
        }
    }

    populateTransactionTypesDropdown() {
        const selectEl = document.getElementById('detectedType');
        if (!selectEl) return;

        selectEl.innerHTML = '<option value="">-- İşlem Türü Seçiniz --</option>';
        
        // Alfabetik sırala
        this.allTransactionTypes.sort((a, b) => a.name.localeCompare(b.name));

        this.allTransactionTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.id; // Bu ID veritabanındaki gerçek ID'dir
            option.textContent = type.alias || type.name;
            
            // UI'da kullanıcıya ipucu vermek için attribute ekleyebiliriz
            if(type.triggersTask) {
                option.textContent += ' (İş Tetikler ⚡)';
            }
            
            selectEl.appendChild(option);
        });
    }

    setupEventListeners() {
        // Manuel Arama Listener
        const searchInput = document.getElementById('manualSearchInput');
        const searchResults = document.getElementById('manualSearchResults');

        if (searchInput) {
            searchInput.addEventListener('input', debounce((e) => {
                this.handleManualSearch(e.target.value);
            }, 300));
            
            document.addEventListener('click', (e) => {
                if (searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                    searchResults.style.display = 'none';
                }
            });
        }

        // Parent Transaction Seçim Listener
        const parentSelect = document.getElementById('parentTransactionSelect');
        if (parentSelect) {
            parentSelect.addEventListener('change', (e) => {
                const info = document.getElementById('parentTransactionInfo');
                if (info) info.style.display = e.target.value ? 'block' : 'none';
            });
        }
    }

    async loadData() {
        try {
            const docRef = doc(db, UNINDEXED_PDFS_COLLECTION, this.pdfId);
            const docSnap = await getDoc(docRef);
            
            if (!docSnap.exists()) throw new Error('PDF kaydı bulunamadı.');
            this.pdfData = { id: docSnap.id, ...docSnap.data() };

            if (this.pdfData.matchedRecordId) {
                await this.selectRecord(this.pdfData.matchedRecordId);
            } else {
                this.renderHeader(); 
            }

            this.renderHeader();
            await this.runAnalysis();

        } catch (error) {
            console.error('Veri yükleme hatası:', error);
            showNotification('Hata: ' + error.message, 'error');
        }
    }

    // --- Manuel Arama ve Kayıt Seçimi ---

    async handleManualSearch(query) {
        const resultsContainer = document.getElementById('manualSearchResults');
        if (!resultsContainer) return;

        if (!query || query.length < 3) {
            resultsContainer.style.display = 'none';
            return;
        }

        try {
            const result = await ipRecordsService.searchRecords(query);
            if (result.success) {
                this.renderSearchResults(result.data);
            }
        } catch (error) {
            console.error('Arama hatası:', error);
        }
    }

    renderSearchResults(results) {
        const container = document.getElementById('manualSearchResults');
        if (!container) return;

        container.innerHTML = '';
        container.style.display = results.length ? 'block' : 'none';

        if (!results.length) {
            container.innerHTML = '<div class="p-2 text-muted small">Sonuç bulunamadı.</div>';
            container.style.display = 'block';
            return;
        }

        container.innerHTML = results.map(r => `
            <div class="search-result-item" data-id="${r.id}">
                <div class="d-flex align-items-center">
                    ${r.brandImageUrl ? `<img src="${r.brandImageUrl}" style="width:30px; height:30px; margin-right:10px; object-fit:contain;">` : ''}
                    <div>
                        <div class="font-weight-bold">${r.title}</div>
                        <small class="text-muted">${r.applicationNumber || r.wipoIR || 'Numara Yok'}</small>
                    </div>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectRecord(item.dataset.id);
                container.style.display = 'none';
                const searchInput = document.getElementById('manualSearchInput');
                if (searchInput) searchInput.value = '';
            });
        });
    }

    async selectRecord(recordId) {
        try {
            const result = await ipRecordsService.getRecordById(recordId);
            if (result.success) {
                this.matchedRecord = result.data;
                this.renderHeader();
                await this.loadParentTransactions(recordId);
                showNotification('Kayıt seçildi: ' + this.matchedRecord.title, 'success');
            }
        } catch (error) {
            console.error('Kayıt seçim hatası:', error);
            showNotification('Kayıt seçilemedi.', 'error');
        }
    }

    async loadParentTransactions(recordId) {
        const selectEl = document.getElementById('parentTransactionSelect');
        if (!selectEl) return;

        selectEl.innerHTML = '<option value="">Yükleniyor...</option>';

        try {
            const transactionsResult = await ipRecordsService.getRecordTransactions(recordId);
            const transactions = transactionsResult.success ? transactionsResult.data : [];
            this.recordTransactions = transactions;

            selectEl.innerHTML = '<option value="">-- Bağımsız İşlem --</option>';
            
            transactions.sort((a, b) => new Date(b.timestamp || b.date || 0) - new Date(a.timestamp || a.date || 0));

            transactions.forEach(t => {
                const dateStr = (t.timestamp || t.date) ? new Date(t.timestamp || t.date).toLocaleDateString('tr-TR') : '-';
                
                // DB'deki type ID'sine göre adını bulmaya çalış, yoksa description kullan
                let label = t.description || 'İşlem';
                const typeObj = this.allTransactionTypes.find(type => type.id === t.type);
                if (typeObj) label = typeObj.alias || typeObj.name;

                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${label} (${dateStr})`;
                selectEl.appendChild(opt);
            });

        } catch (error) {
            console.error('Transaction yükleme hatası:', error);
            selectEl.innerHTML = '<option value="">Hata oluştu</option>';
        }
    }

    // --- Analiz ve Otomatik Eşleştirme ---

    async runAnalysis() {
        const loadingEl = document.getElementById('analysisLoading');
        const resultsEl = document.getElementById('analysisResults');
        const pdfViewerEl = document.getElementById('pdfViewer');

        if(loadingEl) loadingEl.style.display = 'block';
        if(resultsEl) resultsEl.style.display = 'none';

        try {
            if (pdfViewerEl) pdfViewerEl.src = this.pdfData.fileUrl;

            const fullText = await this.pdfExtractor.extractTextFromUrl(this.pdfData.fileUrl);
            this.analysisResult = this.analyzer.analyze(fullText);
            
            this.renderAnalysisResults();

        } catch (error) {
            console.error('Analiz hatası:', error);
            showNotification('PDF analiz edilemedi.', 'error');
        } finally {
            if(loadingEl) loadingEl.style.display = 'none';
            if(resultsEl) resultsEl.style.display = 'block';
        }
    }

    renderHeader() {
        const fileDisplay = document.getElementById('fileNameDisplay');
        if (fileDisplay) fileDisplay.textContent = this.pdfData.fileName;
        
        const matchInfoEl = document.getElementById('matchInfoDisplay');
        if (!matchInfoEl) return;

        if (this.matchedRecord) {
            matchInfoEl.innerHTML = `
                <div class="d-flex align-items-center text-success">
                    <i class="fas fa-check-circle fa-2x mr-3"></i>
                    <div>
                        <h5 class="mb-0 font-weight-bold">${this.matchedRecord.title}</h5>
                        <small>${this.matchedRecord.applicationNumber || this.matchedRecord.wipoIR || 'Numara Yok'}</small>
                    </div>
                </div>`;
        } else {
            matchInfoEl.innerHTML = `
                <div class="d-flex align-items-center text-warning">
                    <i class="fas fa-exclamation-triangle fa-2x mr-3"></i>
                    <div>
                        <h5 class="mb-0">Eşleşme Yok</h5>
                        <small>Lütfen sağdaki kutudan kayıt arayın.</small>
                    </div>
                </div>`;
        }
    }

    renderAnalysisResults() {
        const dateInput = document.getElementById('detectedDate');
        const typeSelect = document.getElementById('detectedType');
        const summaryBox = document.getElementById('analysisSummary');

        if (dateInput && this.analysisResult.decisionDate) {
            const parts = this.analysisResult.decisionDate.split('.');
            if(parts.length === 3) dateInput.value = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }

        if (summaryBox) {
            summaryBox.textContent = `Tip: ${this.analysisResult.detectedType.name}, Kelimeler: ${this.analysisResult.keywords.join(', ')}`;
        }

        // Akıllı Eşleştirme: Analizden gelen isim ile DB'deki isimleri karşılaştır
        if (typeSelect && this.analysisResult.detectedType.code !== 'general') {
             const detectedName = this.analysisResult.detectedType.name.toLowerCase();
             
             // Dropdown seçeneklerini gez ve en iyi eşleşmeyi bul
             let matchedOption = Array.from(typeSelect.options).find(opt => 
                 opt.text.toLowerCase().includes(detectedName) || 
                 (opt.text.toLowerCase().includes('yayın') && detectedName.includes('yayın'))
             );

             if (matchedOption) {
                 matchedOption.selected = true;
             }
        }
        
        const saveBtn = document.getElementById('saveTransactionBtn');
        if(saveBtn) saveBtn.onclick = () => this.handleSave();
    }

    // --- KAYDETME ve GÖREV TETİKLEME MANTIĞI ---

    async handleSave() {
        if (!this.matchedRecord) {
            alert('Lütfen önce bir kayıt ile eşleştirin.');
            return;
        }

        const dateVal = document.getElementById('detectedDate').value;
        const typeId = document.getElementById('detectedType').value; // Seçilen Transaction Type ID
        const notes = document.getElementById('transactionNotes').value;
        const parentId = document.getElementById('parentTransactionSelect').value;

        if (!typeId) {
            alert('Lütfen bir işlem türü seçiniz.');
            return;
        }

        showNotification('Kaydediliyor...', 'info');

        try {
            // 1. Seçilen İşlem Tipinin Özelliklerini Bul
            const selectedTypeObj = this.allTransactionTypes.find(t => t.id === typeId);
            let createdTaskId = null;

            // 2. GÖREV TETİKLEME KONTROLÜ
            // Veritabanında 'triggersTask' (bool) ve 'triggeredTaskTypeId' (string) alanları olmalı
            if (selectedTypeObj && selectedTypeObj.triggersTask) {
                console.log(`🔔 Görev Tetikleniyor: ${selectedTypeObj.name}`);
                
                // Vade Tarihi Hesaplama
                let dueDate = new Date();
                const daysToAdd = selectedTypeObj.deadlineDays || 30; // Varsayılan 30 gün
                dueDate.setDate(dueDate.getDate() + parseInt(daysToAdd));

                const taskData = {
                    title: `${selectedTypeObj.alias || selectedTypeObj.name} - ${this.matchedRecord.title}`,
                    description: notes || `Otomatik oluşturulan görev. Kaynak: ${this.pdfData.fileName}`,
                    // Eğer DB'de tetiklenecek özel bir task tipi ID'si varsa onu kullan, yoksa 'general'
                    specificTaskType: selectedTypeObj.triggeredTaskTypeId || null, 
                    status: 'pending',
                    priority: 'medium',
                    relatedRecordId: this.matchedRecord.id,
                    assignedTo_uid: this.currentUser.uid,
                    assignedTo_email: this.currentUser.email,
                    officialDueDate: dueDate.toISOString()
                };

                const taskResult = await taskService.createTask(taskData);
                if (taskResult.success) {
                    createdTaskId = taskResult.id;
                    console.log('✅ Görev başarıyla oluşturuldu, ID:', createdTaskId);
                } else {
                    console.error('❌ Görev oluşturulamadı:', taskResult.error);
                }
            }

            // 3. TRANSACTION OLUŞTURMA (İşlem Geçmişine Ekle)
            const transactionData = {
                type: typeId, // DB'deki gerçek ID
                transactionHierarchy: parentId ? 'child' : 'parent',
                parentTransactionId: parentId || null,
                triggeringTaskId: createdTaskId || null, // Oluşturulan görevi bağla
                description: notes || `İndeksleme: ${selectedTypeObj?.name || 'Belge'}`,
                date: dateVal ? new Date(dateVal).toISOString() : new Date().toISOString(),
                relatedPdfUrl: this.pdfData.fileUrl,
                relatedPdfId: this.pdfData.id
            };

            await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, transactionData);

            // 4. PDF STATÜSÜNÜ GÜNCELLE
            await updateDoc(doc(db, UNINDEXED_PDFS_COLLECTION, this.pdfId), {
                status: 'indexed',
                indexedAt: new Date(),
                finalTransactionId: typeId,
                matchedRecordId: this.matchedRecord.id
            });

            showNotification('İşlem başarıyla kaydedildi!', 'success');
            
            // 1.5 saniye sonra listeye dön
            setTimeout(() => window.location.href = 'bulk-indexing-page.html', 1500);

        } catch (error) {
            console.error('Kaydetme hatası:', error);
            showNotification('Hata oluştu: ' + error.message, 'error');
        }
    }
}

// Başlat
document.addEventListener('DOMContentLoaded', () => {
    new DocumentReviewManager();
});