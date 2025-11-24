// public/js/services/pdf-analyzer.js

export class PdfAnalyzer {
    constructor(transactionTypes) {
        this.transactionTypes = transactionTypes || [];
    }

    /**
     * Ham metni analiz eder ve anlamlı veriler çıkarır.
     * @param {string} fullText 
     * @returns {Object} Analiz sonucu (tarih, tip, özet vb.)
     */
    analyze(fullText) {
        if (!fullText) return null;
        
        // Metni normalize et (büyük harf ve gereksiz boşlukları temizle)
        const normalizedText = fullText.toUpperCase().replace(/\s+/g, ' ');
        
        return {
            decisionDate: this.extractDate(normalizedText),
            notificationDate: this.extractNotificationDate(normalizedText),
            detectedType: this.determineTransactionType(normalizedText),
            keywords: this.extractKeywords(normalizedText),
            summary: this.generateSummary(normalizedText)
        };
    }

    extractDate(text) {
        // Örn: "KARAR TARİHİ: 12.05.2025" veya sadece tarih formatı
        const datePatterns = [
            /KARAR TARİHİ\s*[:]\s*(\d{2}[./]\d{2}[./]\d{4})/i,
            /TARİH\s*[:]\s*(\d{2}[./]\d{2}[./]\d{4})/i,
            /(\d{2}\.\d{2}\.\d{4})/ // Sadece tarih formatı (son çare)
        ];

        for (const pattern of datePatterns) {
            const match = text.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    extractNotificationDate(text) {
        const match = text.match(/TEBLİĞ TARİHİ\s*[:]\s*(\d{2}[./]\d{2}[./]\d{4})/i);
        return match ? match[1] : null;
    }

    determineTransactionType(text) {
        // Öncelik sırasına göre anahtar kelimeler
        if (text.includes("YAYINLAMA") || text.includes("BÜLTEN")) {
            return { code: 'publish', name: 'Marka Yayını', confidence: 'high' };
        }
        if (text.includes("KISMEN YAYINLAMA")) {
            return { code: 'partial_publish', name: 'Kısmi Yayın', confidence: 'high' };
        }
        if (text.includes("RED") || text.includes("BAŞVURUNUN REDDİ")) {
            return { code: 'rejection', name: 'Başvuru Reddi', confidence: 'high' };
        }
        if (text.includes("İTİRAZ") && text.includes("YAYINA")) {
            return { code: 'opposition', name: 'Yayına İtiraz', confidence: 'medium' };
        }
        if (text.includes("TESCİL BELGESİ") || text.includes("TESCİL EDİLMİŞTİR")) {
            return { code: 'registration', name: 'Tescil Belgesi', confidence: 'high' };
        }
        if (text.includes("EKSİKLİK") || text.includes("ŞEKLİ EKSİKLİK")) {
            return { code: 'deficiency', name: 'Şekli Eksiklik', confidence: 'medium' };
        }

        return { code: 'general', name: 'Genel Evrak', confidence: 'low' };
    }

    extractKeywords(text) {
        const keywords = [];
        const targets = ['YAYIN', 'RED', 'İTİRAZ', 'TESCİL', 'EKSİK', 'KARAR', 'TEBLİĞ'];
        targets.forEach(k => {
            if (text.includes(k)) keywords.push(k);
        });
        return keywords;
    }

    generateSummary(text) {
        // İlk 250 karakteri alıp özet göster
        return text.substring(0, 250) + "...";
    }
}