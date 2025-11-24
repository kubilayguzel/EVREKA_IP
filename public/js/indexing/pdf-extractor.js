// public/js/services/pdf-extractor.js

export class PdfExtractor {
    constructor() {
        // PDF.js kütüphanesinin yüklü olduğundan emin olalım
        if (!window.pdfjsLib) {
            console.error('PDF.js kütüphanesi bulunamadı!');
        } else {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
        }
    }

    /**
     * PDF URL'inden metin içeriğini çıkarır.
     * @param {string} pdfUrl 
     * @returns {Promise<string>} Tüm metin
     */
    async extractTextFromUrl(pdfUrl) {
        try {
            const loadingTask = window.pdfjsLib.getDocument(pdfUrl);
            const pdf = await loadingTask.promise;
            
            let fullText = '';
            
            // Tüm sayfaları dön
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                
                // Sayfadaki metin parçalarını birleştir
                const pageText = textContent.items
                    .map(item => item.str)
                    .join(' ');
                
                fullText += pageText + '\n';
            }
            
            return fullText;
        } catch (error) {
            console.error('PDF metin çıkarma hatası:', error);
            throw error;
        }
    }
}