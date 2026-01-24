// public/js/services/record-matcher.js

export class RecordMatcher {
    /**
     * Verilen numarayı kayıt listesinde arar.
     */
    findMatch(searchNumber, allRecords) {
        // TEST LOGLARI
        console.log("🔍 RecordMatcher -> Aranan No:", searchNumber);

        if (!searchNumber || !allRecords || allRecords.length === 0) {
            return null;
        }

        // Arama numarasını "Atomik" hale getir (Sembolleri ve baştaki sıfırları temizle)
        const cleanSearch = this._normalize(searchNumber);
        
        for (const record of allRecords) {
            // Kontrol edilecek olası alanlar
            const fieldsToCheck = [
                record.applicationNumber,
                record.applicationNo,
                record.wipoIR,
                record.aripoIR
            ];

            for (const fieldValue of fieldsToCheck) {
                if (fieldValue && this._checkMatch(cleanSearch, fieldValue)) {
                    return { 
                        record, 
                        matchType: 'standard', 
                        matchedNumber: fieldValue 
                    };
                }
            }
        }
        
        return null;
    }

    /**
     * İki numarayı mantıksal olarak kıyaslar.
     * @private
     */
    _checkMatch(normalizedSearch, originalValue) {
        if (!normalizedSearch || !originalValue) return false;

        const normalizedRecord = this._normalize(originalValue);

        // 1. Tam Eşleşme (Örn: 201799562 === 201799562)
        if (normalizedRecord === normalizedSearch) return true;

        // 2. Kapsama Kontrolü (Minimum 5 karakter güvenlik sınırı ile)
        if (normalizedSearch.length >= 5) {
            if (normalizedRecord.includes(normalizedSearch) || normalizedSearch.includes(normalizedRecord)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Numarayı temizler: Rakam dışı karakterleri ve sayı başındaki sıfırları kaldırır.
     * @private
     */
    _normalize(val) {
    if (!val) return '';
    // Sadece rakamları bırakır, hiçbir parçayı bölmez veya sıfır silmez.
    // "2017/099562" -> "2017099562"
    // "2017/99562"  -> "201799562" (Padding farkı varsa yine de bulur)
    return String(val).replace(/\D/g, '').trim();
}

    /**
     * UI'da gösterilecek formatı hazırlar
     */
    getDisplayLabel(record) {
        if (!record) return '';
        
        let displayNum = record.applicationNumber || record.applicationNo || 'Numara Yok';

        if (record.recordOwnerType === 'wipo' && record.wipoIR) displayNum = record.wipoIR;
        else if (record.recordOwnerType === 'aripo' && record.aripoIR) displayNum = record.aripoIR;

        const markName = record.title || record.markName || '';
        return markName ? `${displayNum} - ${markName}` : displayNum;
    }
}