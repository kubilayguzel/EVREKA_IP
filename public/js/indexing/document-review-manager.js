// public/js/indexing/document-review-manager.js

// 1. İki üst klasöre çıkarak config ve utils dosyalarını alıyoruz
import { 
    authService, 
    ipRecordsService, 
    db 
} from '../../firebase-config.js';

import { 
    doc, getDoc, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { showNotification, debounce } from '../../utils.js';

// 2. Servisler aynı klasörde olduğu için ./ ile alıyoruz
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
        this.recordTransactions = []; // Kayda ait geçmiş işlemler
        
        // Servisleri başlat
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
        this.setupEventListeners(); // Listenerları ekle
        await this.loadData();
    }

    setupEventListeners() {
        // Manuel Arama Listener (Debounce ile)
        const searchInput = document.getElementById('manualSearchInput');
        const searchResults = document.getElementById('manualSearchResults');

        if (searchInput) {
            searchInput.addEventListener('input', debounce((e) => {
                this.handleManualSearch(e.target.value);
            }, 300));
            
            // Dışarı tıklayınca sonuçları kapat
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
            // 1. PDF Verisini Getir
            const docRef = doc(db, UNINDEXED_PDFS_COLLECTION, this.pdfId);
            const docSnap = await getDoc(docRef);
            
            if (!docSnap.exists()) throw new Error('PDF kaydı bulunamadı.');
            this.pdfData = { id: docSnap.id, ...docSnap.data() };

            // 2. Eşleşen Kayıt Varsa Getir ve Transactionları Yükle
            if (this.pdfData.matchedRecordId) {
                await this.selectRecord(this.pdfData.matchedRecordId);
            } else {
                this.renderHeader(); // Eşleşme yoksa boş header göster
            }

            // 3. Analizi Başlat
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
            } else {
                console.error("Arama hatası:", result.error);
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
            container.style.display = 'block'; // "Bulunamadı" mesajını göster
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

        // Tıklama olaylarını ekle
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
                
                // Kayıt değiştiğinde parent transactionları yükle
                await this.loadParentTransactions(recordId);
                
                showNotification('Kayıt seçildi: ' + this.matchedRecord.title, 'success');
            }
        } catch (error) {
            console.error('Kayıt seçim hatası:', error);
            showNotification('Kayıt seçilemedi.', 'error');
        }
    }

    // --- Parent Transaction Yükleme ---

    async loadParentTransactions(recordId) {
        const selectEl = document.getElementById('parentTransactionSelect');
        if (!selectEl) return;

        selectEl.innerHTML = '<option value="">Yükleniyor...</option>';

        try {
            // Transactionları çek (firebase-config.js içindeki doğru metod adı: getRecordTransactions)
            const transactionsResult = await ipRecordsService.getRecordTransactions(recordId);
            const transactions = transactionsResult.success ? transactionsResult.data : [];
            this.recordTransactions = transactions;

            // Select'i doldur
            selectEl.innerHTML = '<option value="">-- Bağımsız İşlem --</option>';
            
            // Parent olabilecek işlemleri filtrele (İsteğe bağlı, şimdilik hepsini gösteriyoruz)
            // Tarihe göre sırala
            transactions.sort((a, b) => new Date(b.timestamp || b.date || 0) - new Date(a.timestamp || a.date || 0));

            transactions.forEach(t => {
                const dateStr = (t.timestamp || t.date) ? new Date(t.timestamp || t.date).toLocaleDateString('tr-TR') : '-';
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${t.description || t.type} (${dateStr})`;
                selectEl.appendChild(opt);
            });

        } catch (error) {
            console.error('Transaction yükleme hatası:', error);
            selectEl.innerHTML = '<option value="">Hata oluştu</option>';
        }
    }

    // --- Analiz ve Kaydetme ---

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

        if (typeSelect && this.analysisResult.detectedType.code !== 'general') {
             Array.from(typeSelect.options).forEach(opt => {
                 if (opt.text.includes(this.analysisResult.detectedType.name)) opt.selected = true;
             });
        }
        
        const saveBtn = document.getElementById('saveTransactionBtn');
        if(saveBtn) saveBtn.onclick = () => this.handleSave();
    }

    async handleSave() {
        if (!this.matchedRecord) {
            alert('Lütfen önce bir kayıt ile eşleştirin.');
            return;
        }

        const dateVal = document.getElementById('detectedDate').value;
        const typeVal = document.getElementById('detectedType').value;
        const notes = document.getElementById('transactionNotes').value;
        const parentSelect = document.getElementById('parentTransactionSelect');
        const parentId = parentSelect ? parentSelect.value : null;

        showNotification('Kaydediliyor...', 'info');

        try {
            // 1. Transaction Oluştur
            const transactionData = {
                type: typeVal,
                // Eğer bir parent seçildiyse 'child', seçilmediyse 'parent' veya duruma göre 'independent'
                transactionHierarchy: parentId ? 'child' : 'parent',
                parentTransactionId: parentId || null,
                description: notes || `İndeksleme: ${this.analysisResult.detectedType.name}`,
                date: dateVal ? new Date(dateVal).toISOString() : new Date().toISOString(),
                relatedPdfUrl: this.pdfData.fileUrl,
                relatedPdfId: this.pdfData.id
            };

            await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, transactionData);

            // 2. PDF Statüsünü Güncelle
            await updateDoc(doc(db, UNINDEXED_PDFS_COLLECTION, this.pdfId), {
                status: 'indexed',
                indexedAt: new Date(),
                finalTransactionId: typeVal,
                matchedRecordId: this.matchedRecord.id
            });

            showNotification('İşlem tamamlandı!', 'success');
            setTimeout(() => window.location.href = 'bulk-indexing-page.html', 1500);

        } catch (error) {
            console.error('Hata:', error);
            showNotification('Hata: ' + error.message, 'error');
        }
    }
}

// Başlat
document.addEventListener('DOMContentLoaded', () => {
    new DocumentReviewManager();
});