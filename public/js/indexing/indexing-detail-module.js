// public/js/indexing-detail-module.js - REFACTORED

import { 
    firebaseServices, 
    authService, 
    ipRecordsService, 
    transactionTypeService, 
    db 
} from '../firebase-config.js';

import { 
    doc, getDoc, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { showNotification } from '../utils.js';

// ✅ YENİ SERVİSLER
import { PdfExtractor } from './services/pdf-extractor.js';
import { PdfAnalyzer } from './services/pdf-analyzer.js'; // İsim güncellendi

const UNINDEXED_PDFS_COLLECTION = 'unindexed_pdfs';

export class IndexingDetailModule {
    constructor() {
        this.pdfId = new URLSearchParams(window.location.search).get('pdfId');
        this.currentUser = null;
        this.pdfData = null;
        this.matchedRecord = null;
        this.analysisResult = null;
        
        // Servisleri başlat
        this.pdfExtractor = new PdfExtractor();
        this.analyzer = new PdfAnalyzer(); // Class kullanımı güncellendi

        this.init();
    }

    async init() {
        if (!this.pdfId) {
            alert('PDF ID bulunamadı!');
            window.location.href = 'bulk-indexing-page.html';
            return;
        }

        this.currentUser = authService.getCurrentUser();
        await this.loadData();
    }

    async loadData() {
        try {
            // 1. PDF Verisini Çek
            const docRef = doc(db, UNINDEXED_PDFS_COLLECTION, this.pdfId);
            const docSnap = await getDoc(docRef);
            
            if (!docSnap.exists()) throw new Error('PDF kaydı bulunamadı.');
            this.pdfData = { id: docSnap.id, ...docSnap.data() };

            // 2. Eşleşen Kaydı Çek (Varsa)
            if (this.pdfData.matchedRecordId) {
                const recordResult = await ipRecordsService.getRecordById(this.pdfData.matchedRecordId);
                if (recordResult.success) {
                    this.matchedRecord = recordResult.data;
                }
            }

            // 3. UI Başlangıç
            this.renderHeader();
            
            // 4. Analizi Başlat
            await this.runAnalysis();

        } catch (error) {
            console.error('Veri yükleme hatası:', error);
            showNotification('Hata: ' + error.message, 'error');
        }
    }

    async runAnalysis() {
        const loadingEl = document.getElementById('analysisLoading');
        const resultsEl = document.getElementById('analysisResults');
        const pdfViewerEl = document.getElementById('pdfViewer');

        if(loadingEl) loadingEl.style.display = 'block';
        if(resultsEl) resultsEl.style.display = 'none';

        try {
            // A. PDF Görüntüleyiciyi Ayarla
            if (pdfViewerEl) {
                pdfViewerEl.src = this.pdfData.fileUrl;
            }

            // B. Metni Çıkar (PdfExtractor Servisi)
            const fullText = await this.pdfExtractor.extractTextFromUrl(this.pdfData.fileUrl);
            
            // C. Metni Analiz Et (PdfAnalyzer Servisi)
            this.analysisResult = this.analyzer.analyze(fullText);
            
            console.log('Analiz Sonucu:', this.analysisResult);

            // D. Sonuçları Göster
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
        // Başlık ve Eşleşme Bilgisi
        document.getElementById('fileNameDisplay').textContent = this.pdfData.fileName;
        
        const matchInfoEl = document.getElementById('matchInfoDisplay');
        if (this.matchedRecord) {
            matchInfoEl.innerHTML = `
                <div class="alert alert-success">
                    <strong>Eşleşen Kayıt:</strong> ${this.matchedRecord.title} 
                    (${this.matchedRecord.applicationNumber || this.matchedRecord.wipoIR})
                </div>`;
        } else {
            matchInfoEl.innerHTML = `<div class="alert alert-warning">Eşleşen kayıt bulunamadı. Manuel seçim yapınız.</div>`;
        }
    }

    renderAnalysisResults() {
        // Form alanlarını doldur
        const dateInput = document.getElementById('detectedDate');
        const typeSelect = document.getElementById('detectedType');
        const summaryBox = document.getElementById('analysisSummary');

        if (dateInput && this.analysisResult.decisionDate) {
            // DD.MM.YYYY -> YYYY-MM-DD (Input date formatı için)
            const parts = this.analysisResult.decisionDate.split('.');
            if(parts.length === 3) dateInput.value = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }

        if (summaryBox) {
            summaryBox.textContent = `Tespit Edilen Tip: ${this.analysisResult.detectedType.name}\n` +
                                     `Anahtar Kelimeler: ${this.analysisResult.keywords.join(', ')}`;
        }

        // Dropdown'da uygun tipi seçmeye çalış
        if (typeSelect && this.analysisResult.detectedType.code !== 'general') {
             Array.from(typeSelect.options).forEach(opt => {
                 if (opt.text.includes(this.analysisResult.detectedType.name)) {
                     opt.selected = true;
                 }
             });
        }
        
        const saveBtn = document.getElementById('saveTransactionBtn');
        if(saveBtn) {
            saveBtn.onclick = () => this.handleSave();
        }
    }

    async handleSave() {
        if (!this.matchedRecord) {
            alert('Lütfen önce bir kayıt ile eşleştirin.');
            return;
        }

        const dateVal = document.getElementById('detectedDate').value;
        const typeVal = document.getElementById('detectedType').value;
        const notes = document.getElementById('transactionNotes').value;

        showNotification('İşleniyor...', 'info');

        try {
            // 1. Transaction Oluştur
            const transactionData = {
                type: typeVal,
                transactionHierarchy: 'parent',
                description: notes || `Otomatik indeksleme: ${this.analysisResult.detectedType.name}`,
                date: dateVal ? new Date(dateVal).toISOString() : new Date().toISOString(),
                relatedPdfUrl: this.pdfData.fileUrl,
                relatedPdfId: this.pdfData.id
            };

            await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, transactionData);

            // 2. PDF Durumunu Güncelle (Indexed)
            await updateDoc(doc(db, UNINDEXED_PDFS_COLLECTION, this.pdfId), {
                status: 'indexed',
                indexedAt: new Date(),
                finalTransactionId: typeVal
            });

            showNotification('Başarıyla kaydedildi!', 'success');
            setTimeout(() => window.location.href = 'bulk-indexing-page.html', 1500);

        } catch (error) {
            console.error('Kaydetme hatası:', error);
            showNotification('Kaydedilemedi: ' + error.message, 'error');
        }
    }
}

// Sayfa yüklendiğinde başlat
document.addEventListener('DOMContentLoaded', () => {
    new IndexingDetailModule();
});