import { RELATED_PARTY_REQUIRED, TASK_IDS, asId } from './TaskConstants.js';

export class TaskValidator {
    constructor() {
        this.saveBtn = document.getElementById('saveTaskBtn');
    }

    checkCompleteness(state) {
        // Butonu seç
        this.saveBtn = document.getElementById('saveTaskBtn');
        if (!this.saveBtn) return;

        // Form tipini anlamaya çalış
        const { selectedTaskType } = state || {};
        
        // Ekranda "Marka Adı" kutusu var mı? Varsa bu bir Marka Başvurusudur.
        // (State'e güvenmek yerine ekrana bakıyoruz)
        const brandInputExists = !!document.getElementById('brandExampleText');

        let isComplete = false;

        // --- SENARYO 1: MARKA BAŞVURUSU ---
        // (State 'Başvuru' diyorsa VEYA ekranda marka adı kutusu varsa)
        if ((selectedTaskType?.alias === 'Başvuru' && selectedTaskType?.ipType === 'trademark') || brandInputExists) {
            
            // 1. Marka Adı (DOM)
            const brandText = document.getElementById('brandExampleText')?.value?.trim();
            
            // 2. Sınıf Seçimi (DOM - Garanti Yöntem)
            // Listede kaç tane sınıf kutucuğu var?
            const domClassCount = document.querySelectorAll('#selectedNiceClasses .selected-class-item').length;
            const hasNiceClasses = domClassCount > 0;
            
            // 3. Başvuru Sahibi (DOM - Garanti Yöntem)
            // Listede kaç tane kişi kutucuğu var?
            const domApplicantCount = document.querySelectorAll('#selectedApplicantsList .selected-item').length;
            const hasApplicants = domApplicantCount > 0;
            
            // 4. Menşe/Ülke (DOM)
            const originType = document.getElementById('originSelect')?.value;
            let hasCountrySelection = true;
            if (originType === 'Yurtdışı Ulusal') {
                hasCountrySelection = !!document.getElementById('countrySelect')?.value;
            } else if (['WIPO', 'ARIPO'].includes(originType)) {
                // Çoklu ülke seçimi listesindeki elemanları say
                hasCountrySelection = document.querySelectorAll('#selectedCountriesList .selected-item').length > 0;
            }

            // 5. Atanan Kişi (DOM)
            const assignedTo = document.getElementById('assignedTo')?.value;
            
            // Konsola Durum Raporu Yaz (F12'de görebilmeniz için)
            console.log('--- VALIDATOR KONTROLÜ (DOM) ---');
            if (!assignedTo) console.warn('❌ Atanacak Kişi eksik');
            if (!brandText) console.warn('❌ Marka Adı eksik');
            if (!hasNiceClasses) console.warn(`❌ Sınıf Seçimi eksik (Ekranda: ${domClassCount})`);
            if (!hasApplicants) console.warn(`❌ Başvuru Sahibi eksik (Ekranda: ${domApplicantCount})`);
            if (!hasCountrySelection) console.warn('❌ Ülke Seçimi eksik');

            // Hepsini kontrol et
            isComplete = !!(assignedTo && brandText && hasNiceClasses && hasApplicants && hasCountrySelection);            
        } 
        // --- SENARYO 2: DİĞER İŞLEMLER ---
        else {
            const taskTitle = document.getElementById('taskTitle')?.value?.trim() || selectedTaskType?.alias;
            const hasIpRecord = !!state.selectedIpRecord; // Burası state'den kalabilir veya DOM'a çevrilebilir
            const assignedTo = document.getElementById('assignedTo')?.value;
            
            // DOM Kontrolü: İlgili Taraf Listesi
            const domRelatedCount = document.querySelectorAll('#relatedPartyList .selected-item').length;

            const tIdStr = asId(selectedTaskType?.id);
            const needsRelated = RELATED_PARTY_REQUIRED.has(tIdStr);
            
            // Dava işlemlerinde bazen ilgili taraf otomatik kilitli gelir, liste boş olabilir ama input doludur.
            // Bu yüzden detaylı kontrol gerekebilir ama şimdilik standart mantık:
            const hasRelated = domRelatedCount > 0;

            isComplete = !!assignedTo && !!taskTitle && !!hasIpRecord && (!needsRelated || hasRelated);
        }

        // Sonucu uygula
        this.saveBtn.disabled = !isComplete;
        
        if (isComplete) {
            console.log('✅ VALIDASYON BAŞARILI: Kaydet butonu açıldı.');
        } else {
            console.log('🔒 Buton kilitli kaldı.');
        }
    }
}