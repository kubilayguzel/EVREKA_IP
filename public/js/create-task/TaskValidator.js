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
            
            // Nice sınıfları (Global fonksiyondan kontrol)
            const hasNiceClasses = typeof getSelectedNiceClasses === 'function' && getSelectedNiceClasses().length > 0;
            
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
            
            // Hepsini kontrol et
            isComplete = !!(assignedTo && brandText && hasNiceClasses && hasApplicants && hasCountrySelection);
            
            // Debug
            /*
            console.log('🔍 Validator (Başvuru):', {
                assignedTo, brandText, hasNiceClasses, hasApplicants, hasCountrySelection, isComplete
            });
            */
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
            
            isComplete = !!assignedTo && !!taskTitle && !!hasIpRecord && (!needsRelatedParty || hasRelated) && (!needsObjectionOwner || hasRelated);

            // Debug
            /*
            console.log('🔍 Validator (Standart):', {
                taskTitle, hasIpRecord, assignedTo, needsRelatedParty, hasRelated, isComplete
            });
            */
        }

        this.saveBtn.disabled = !isComplete;
    }
}