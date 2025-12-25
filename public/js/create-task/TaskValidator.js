import { RELATED_PARTY_REQUIRED, TASK_IDS, asId } from './TaskConstants.js';
import { getSelectedNiceClasses } from '../nice-classification.js';

export class TaskValidator {
    constructor() {
        this.saveBtn = document.getElementById('saveTaskBtn');
    }

    /**
     * Formun doluluk durumunu kontrol eder ve Kaydet butonunu açar/kapatır.
     * @param {Object} state - Uygulamanın anlık durum nesnesi (seçili kayıtlar vb.)
     */
    checkCompleteness(state) {
        // State'den gerekli verileri al
        const { 
            selectedTaskType, 
            selectedIpRecord, 
            selectedApplicants, 
            selectedRelatedParties, 
            selectedCountries 
        } = state;

        // Butonu her seferinde yeniden seç (DOM değişmiş olabilir)
        this.saveBtn = document.getElementById('saveTaskBtn');

        if (!selectedTaskType || !this.saveBtn) {
            if (this.saveBtn) this.saveBtn.disabled = true;
            return;
        }

        let isComplete = false;
        
        // Konsolu temizle ki sadece güncel hataları görelim (İsteğe bağlı, kafa karıştırırsa silebilirsiniz)
        // console.clear(); 

        // --- SENARYO 1: MARKA BAŞVURUSU ---
        if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
            const brandText = document.getElementById('brandExampleText')?.value?.trim();
            
            // Nice sınıfları (Global fonksiyondan kontrol)
            const niceClasses = typeof getSelectedNiceClasses === 'function' ? getSelectedNiceClasses() : [];
            const hasNiceClasses = niceClasses.length > 0;
            
            // Başvuru sahipleri
            const hasApplicants = selectedApplicants && selectedApplicants.length > 0;
            
            // Menşe/Ülke seçimi kontrolü
            const originType = document.getElementById('originSelect')?.value;
            let hasCountrySelection = false;
            
            if (originType === 'Yurtdışı Ulusal') {
                hasCountrySelection = !!document.getElementById('countrySelect')?.value;
            } else if (originType === 'WIPO' || originType === 'ARIPO') {
                hasCountrySelection = selectedCountries && selectedCountries.length > 0;
            } else {
                hasCountrySelection = true; // TÜRKPATENT için ülke seçimi gerekmez
            }

            const assignedTo = document.getElementById('assignedTo')?.value;
            
            // --- DETAYLI KONTROL VE LOGLAMA ---
            if (!assignedTo) console.warn('❌ EKSİK: Atanacak Kişi (assignedTo) seçilmedi.');
            if (!brandText) console.warn('❌ EKSİK: Marka Adı/Yazılı İfadesi (brandExampleText) girilmedi.');
            if (!hasNiceClasses) console.warn('❌ EKSİK: En az 1 tane Mal/Hizmet Sınıfı seçilmedi.');
            if (!hasApplicants) console.warn('❌ EKSİK: Başvuru Sahibi seçilmedi.');
            if (!hasCountrySelection) console.warn(`❌ EKSİK: Ülke seçimi yapılmadı (${originType}).`);

            // Hepsini kontrol et
            isComplete = !!(assignedTo && brandText && hasNiceClasses && hasApplicants && hasCountrySelection);
            
        } 
        // --- SENARYO 2: DİĞER İŞLEMLER (Standart) ---
        else {
            const taskTitle = document.getElementById('taskTitle')?.value?.trim() || selectedTaskType?.alias || selectedTaskType?.name;
            const hasIpRecord = !!selectedIpRecord;
            const assignedTo = document.getElementById('assignedTo')?.value;

            const tIdStr = asId(selectedTaskType.id);
            
            // İlgili taraf zorunluluğu
            const needsRelatedParty = RELATED_PARTY_REQUIRED.has(tIdStr);
            
            // İtiraz sahibi zorunluluğu (Bazı itiraz tipleri için)
            const needsObjectionOwner = (tIdStr === TASK_IDS.ITIRAZ_YAYIN) || (tIdStr === '19') || (tIdStr === '7');
            
            const hasRelated = Array.isArray(selectedRelatedParties) && selectedRelatedParties.length > 0;
            
            // --- DETAYLI KONTROL VE LOGLAMA ---
            if (!assignedTo) console.warn('❌ EKSİK: Atanacak Kişi seçilmedi.');
            if (!hasIpRecord) console.warn('❌ EKSİK: Varlık (Dava veya Marka/Patent) seçilmedi.');
            if (needsRelatedParty && !hasRelated) console.warn('❌ EKSİK: İlgili Taraf/Müvekkil seçilmedi.');
            
            isComplete = !!assignedTo && !!taskTitle && !!hasIpRecord && (!needsRelatedParty || hasRelated) && (!needsObjectionOwner || hasRelated);
        }

        // Sonucu uygula
        this.saveBtn.disabled = !isComplete;
        
        // Eğer her şey tamsa yeşil mesaj ver
        if (isComplete) {
            console.log('✅ VALIDASYON BAŞARILI: Kaydet butonu aktif.');
        }
    }
}