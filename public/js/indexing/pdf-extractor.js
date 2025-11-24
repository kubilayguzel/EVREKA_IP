// public/js/indexing/pdf-extractor.js

export class PdfExtractor {
    constructor() {
        // Kütüphane ve Worker URL'leri
        this.libUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js';
        this.workerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    }

    /**
     * Kütüphanenin yüklü olduğundan emin olur, yoksa yükler.
     */
    async ensureLibraryLoaded() {
        if (window.pdfjsLib) {
            // Zaten yüklüyse worker ayarını yap ve çık
            if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = this.workerUrl;
            }
            return;
        }

        console.warn('⚠️ PDF.js bulunamadı, dinamik olarak yükleniyor...');
        
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = this.libUrl;
            script.onload = () => {
                console.log('✅ PDF.js başarıyla yüklendi.');
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = this.workerUrl;
                resolve();
            };
            script.onerror = () => {
                reject(new Error('PDF.js kütüphanesi yüklenemedi! İnternet bağlantınızı veya CDN erişimini kontrol edin.'));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * PDF URL'inden metin içeriğini çıkarır.
     * @param {string} pdfUrl 
     * @returns {Promise<string>} Tüm metin
     */
    async extractTextFromUrl(pdfUrl) {
        try {
            // Önce kütüphaneyi garantiye al
            await this.ensureLibraryLoaded();

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