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
        
        // --- SENARYO 1: MARKA BAŞVURUSU ---
        if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
            const brandText = document.getElementById('brandExampleText')?.value?.trim();
            
            // 1. YÖNTEM: Global fonksiyondan kontrol (Hafıza)
            const memoryClasses = typeof getSelectedNiceClasses === 'function' ? getSelectedNiceClasses() : [];
            
            // 2. YÖNTEM: DOM'dan Doğrudan Kontrol (Görsel - GARANTİ YÖNTEM)
            // Listede fiziksel olarak bulunan sınıf kutucuklarını sayar
            const domClassCount = document.querySelectorAll('#selectedNiceClasses .selected-class-item').length;
            
            // İkisinden birinde veri varsa kabul et
            const hasNiceClasses = memoryClasses.length > 0 || domClassCount > 0;
            
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
            
            // Hata Ayıklama (Konsolda eksik olanı görmek için)
            if (!assignedTo) console.warn('❌ EKSİK: Atanacak Kişi (assignedTo) seçilmedi.');
            if (!brandText) console.warn('❌ EKSİK: Marka Adı (brandExampleText) girilmedi.');
            if (!hasNiceClasses) console.warn('❌ EKSİK: Mal/Hizmet Sınıfı seçilmedi (Ekranda görünmüyor).');
            if (!hasApplicants) console.warn('❌ EKSİK: Başvuru Sahibi seçilmedi.');

            // Hepsini kontrol et
            isComplete = !!(assignedTo && brandText && hasNiceClasses && hasApplicants && hasCountrySelection);
            
        } 
        // --- SENARYO 2: DİĞER İŞLEMLER (Standart) ---
        else {
            const taskTitle = document.getElementById('taskTitle')?.value?.trim() || selectedTaskType?.alias || selectedTaskType?.name;
            const hasIpRecord = !!selectedIpRecord;
            const assignedTo = document.getElementById('assignedTo')?.value;

            const tIdStr = asId(selectedTaskType.id);
            const needsRelatedParty = RELATED_PARTY_REQUIRED.has(tIdStr);
            const needsObjectionOwner = (tIdStr === TASK_IDS.ITIRAZ_YAYIN) || (tIdStr === '19') || (tIdStr === '7');
            const hasRelated = Array.isArray(selectedRelatedParties) && selectedRelatedParties.length > 0;
            
            if (!assignedTo) console.warn('❌ EKSİK: Atanacak Kişi seçilmedi.');
            if (!hasIpRecord) console.warn('❌ EKSİK: Varlık seçilmedi.');

            isComplete = !!assignedTo && !!taskTitle && !!hasIpRecord && (!needsRelatedParty || hasRelated) && (!needsObjectionOwner || hasRelated);
        }

        // Sonucu uygula
        this.saveBtn.disabled = !isComplete;
        
        if (isComplete) {
            console.log('✅ VALIDASYON BAŞARILI: Buton aktifleşti.');
        }
    }
}