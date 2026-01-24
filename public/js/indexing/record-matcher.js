// public/js/indexing/record-matcher.js

export class RecordMatcher {
    /**
     * Verilen numarayı kayıt listesinde arar.
     */
    findMatch(searchNumber, allRecords) {
        // TEST LOGU (İstediğiniz satır):
        console.log("🔍 RecordMatcher -> Aranan:", searchNumber);

        if (!searchNumber || !allRecords) {
            console.warn("⚠️ RecordMatcher -> Parametreler eksik!");
            return null;
        }

        // Numarayı atomik hale getir (Sembolleri ve baştaki sıfırları temizle)
        const cleanSearch = this._normalize(searchNumber);
        console.log("🛠️ RecordMatcher -> Normalize Edilmiş Arama:", cleanSearch);

        for (const record of allRecords) {
            // Kontrol edilecek tüm olası alanlar
            const fieldsToCheck = [
                { val: record.applicationNumber, label: 'applicationNumber' },
                { val: record.applicationNo, label: 'applicationNo' },
                { val: record.wipoIR, label: 'wipoIR' },
                { val: record.aripoIR, label: 'aripoIR' }
            ];

            for (const field of fieldsToCheck) {
                if (field.val && this._checkMatch(cleanSearch, field.val)) {
                    console.log(`✅ RecordMatcher -> EŞLEŞME BULUNDU!`, {
                        aranan: searchNumber,
                        bulunan: field.val,
                        alan: field.label,
                        dosya: record.title
                    });
                    return { record, matchType: 'standard', matchedNumber: field.val };
                }
            }
        }
        
        console.log("❌ RecordMatcher -> Eşleşme bulunamadı:", searchNumber);
        return null;
    }

    _checkMatch(normalizedSearch, originalValue) {
        if (!normalizedSearch || !originalValue) return false;
        const normalizedRecord = this._normalize(originalValue);

        // Tam eşleşme veya kapsama (en az 5 karakter)
        if (normalizedRecord === normalizedSearch) return true;
        if (normalizedSearch.length >= 5) {
            if (normalizedRecord.includes(normalizedSearch) || normalizedSearch.includes(normalizedRecord)) {
                return true;
            }
        }
        return false;
    }

    /**
     * "2017/099562" -> "201799562" yapar (Padding sorununu çözer)
     */
    _normalize(val) {
        if (!val) return '';
        return String(val)
            .split(/[^\d]+/) // Rakam dışı her şeyden böl
            .map(part => part.replace(/^0+/, '')) // Her parçanın başındaki sıfırı at
            .filter(part => part.length > 0)
            .join('');
    }

    getDisplayLabel(record) {
        if (!record) return '';
        const displayNum = record.applicationNumber || record.applicationNo || 'Numara Yok';
        return `${record.title} (${displayNum})`;
    }
}