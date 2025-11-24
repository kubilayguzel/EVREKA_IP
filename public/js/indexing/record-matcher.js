// public/js/services/record-matcher.js

export class RecordMatcher {
    /**
     * Verilen numarayı kayıt listesinde arar.
     * @param {string} searchNumber Dosya adından çıkan numara
     * @param {Array} allRecords Tüm kayıtlar listesi
     * @returns {Object|null} Eşleşen kayıt objesi veya null
     */
    findMatch(searchNumber, allRecords) {
        if (!searchNumber || !allRecords) return null;

        // Performans: For-of döngüsü büyük listelerde daha hızlıdır
        for (const record of allRecords) {
            // 1. Standart Başvuru Numarası Kontrolü
            if (record.applicationNumber && this._checkMatch(searchNumber, record.applicationNumber)) {
                return { record, matchType: 'standard', matchedNumber: record.applicationNumber };
            }

            // 2. WIPO Kontrolü
            if (record.recordOwnerType === 'wipo' && record.wipoIR) {
                if (this._checkMatch(searchNumber, record.wipoIR)) {
                    return { record, matchType: 'wipo', matchedNumber: record.wipoIR };
                }
            }
            
            // 3. ARIPO Kontrolü
            if (record.recordOwnerType === 'aripo' && record.aripoIR) {
                if (this._checkMatch(searchNumber, record.aripoIR)) {
                    return { record, matchType: 'aripo', matchedNumber: record.aripoIR };
                }
            }
        }
        
        return null;
    }

    /**
     * İki numarayı normalize edip karşılaştırır (Özel mantık)
     */
    _checkMatch(extracted, original) {
        if (!extracted || !original) return false;

        // A. Tam Eşleşme
        if (original === extracted) return true;

        // B. Normalize Eşleşme (tire, boşluk, slash kaldır)
        const normExtracted = extracted.replace(/[-\/\s]/g, '');
        const normOriginal = original.replace(/[-\/\s]/g, '');
        if (normOriginal === normExtracted) return true;

        // C. Kapsama (Contains)
        // Dikkat: "123" ararken "12345"i bulmamalı, ama "2023/123" içinde "123" aranabilir.
        // Mevcut mantığınızı korudum ama burası false positive verebilir.
        if (original.includes(extracted) || extracted.includes(original)) {
            return true;
        }

        return false;
    }

    /**
     * UI'da gösterilecek formatı hazırlar
     */
    getDisplayLabel(record) {
        if (!record) return '';
        
        let displayNum = record.applicationNumber || 'Numara Yok';
        let suffix = '';

        if (record.recordOwnerType === 'wipo' && record.wipoIR) displayNum = record.wipoIR;
        else if (record.recordOwnerType === 'aripo' && record.aripoIR) displayNum = record.aripoIR;

        if (record.transactionHierarchy === 'child' && record.country) suffix = ` - ${record.country}`;
        else if (record.transactionHierarchy === 'parent' && record.origin) suffix = ` - ${record.origin}`;

        return `${record.title} (${displayNum}${suffix})`;
    }
}