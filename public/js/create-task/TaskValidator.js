import { RELATED_PARTY_REQUIRED, TASK_IDS, asId } from './TaskConstants.js';

export class TaskValidator {
    constructor() {
        this.saveBtn = document.getElementById('saveTaskBtn');
    }

    checkCompleteness(state) {
        // Butonu her seferinde taze seçelim
        this.saveBtn = document.getElementById('saveTaskBtn');
        if (!this.saveBtn) return;

        // state içinden selectedOwners'ı da alıyoruz
        const { selectedTaskType, selectedOwners } = state || {};
        
        // Marka Başvurusu olup olmadığını anla
        const brandInputExists = !!document.getElementById('brandExampleText');
        const isTrademarkApp = (selectedTaskType?.alias === 'Başvuru' && selectedTaskType?.ipType === 'trademark') || brandInputExists;

        let isComplete = false;
        let checks = {}; // Konsol raporu için

            // --- SENARYO 1: MARKA BAŞVURUSU ---
            if (isTrademarkApp) {
                
                // 1. Marka Adı
                const brandText = document.getElementById('brandExampleText')?.value?.trim();
            
                // 2. Sınıf Seçimi
                const niceContainer = document.getElementById('selectedNiceClasses');
                const domClassCount = niceContainer 
                    ? niceContainer.querySelectorAll('.selected-class-item, .selected-item, .selected-item-row').length 
                    : 0;
                
                // 3. Başvuru Sahibi
                const applicantContainer = document.getElementById('selectedApplicantsList');
                const domApplicantCount = applicantContainer 
                    ? applicantContainer.querySelectorAll('.selected-item, .search-result-item, .list-group-item').length 
                    : 0;
                
                // 4. Menşe/Ülke Kontrolü
                const originType = document.getElementById('originSelect')?.value;
                let hasCountrySelection = true;
                
                if (originType === 'Yurtdışı Ulusal' || originType === 'FOREIGN_NATIONAL') {
                    hasCountrySelection = !!document.getElementById('countrySelect')?.value;
                } 
                else if (['WIPO', 'ARIPO'].includes(originType)) {
                    const countryList = document.getElementById('selectedCountriesList');
                    const cnt = countryList ? countryList.querySelectorAll('.selected-item').length : 0;
                    hasCountrySelection = cnt > 0;
                }

                // 5. Atanan Kişi
                const assignedTo = document.getElementById('assignedTo')?.value;

                checks = {
                    'Atanan Kişi': !!assignedTo,
                    'Marka Adı': !!brandText,
                    'Sınıf Seçimi': domClassCount > 0,
                    'Başvuru Sahibi': domApplicantCount > 0,
                    'Menşe/Ülke': hasCountrySelection
                };

                isComplete = Object.values(checks).every(val => val === true);
            
            } 
            // --- SENARYO 2: DİĞER İŞLEMLER ---
            else {
                const taskTitle = document.getElementById('taskTitle')?.value?.trim() || selectedTaskType?.alias;
                const hasIpRecord = !!state.selectedIpRecord;
                const assignedTo = document.getElementById('assignedTo')?.value;
                
                // --- GÜNCELLEME BAŞLANGICI ---
                // Unvan (79), Nevi (80) ve Adres (82) değişikliği işlemleri için özel kural
                const tIdStr = asId(selectedTaskType?.id);
                const isSpecialTask = ['79', '80', '82'].includes(tIdStr);
                
                // Sahip seçilmiş mi?
                const hasOwner = selectedOwners && selectedOwners.length > 0;

                // Eğer özel işlemse: Varlık VEYA Sahip seçimi yeterli. 
                // Diğer işlemlerde: Varlık seçimi zorunlu.
                const isAssetOrOwnerValid = isSpecialTask ? (hasIpRecord || hasOwner) : hasIpRecord;
                // --- GÜNCELLEME SONU ---
                
                // İlgili Taraf Zorunluluğu
                const needsRelated = RELATED_PARTY_REQUIRED.has(tIdStr);
                
                const partyContainer = document.getElementById('relatedPartyList');
                const domRelatedCount = partyContainer ? partyContainer.querySelectorAll('.selected-item').length : 0;
                const hasRelated = domRelatedCount > 0;

                checks = {
                    'Atanan Kişi': !!assignedTo,
                    'İş Başlığı': !!taskTitle,
                    'Varlık/Sahip Seçimi': isAssetOrOwnerValid, // Güncellendi
                    'İlgili Taraf': !needsRelated || hasRelated
                };

                isComplete = Object.values(checks).every(val => val === true);
            }

        // Sonucu uygula
        this.saveBtn.disabled = !isComplete;

        // --- DEBUG RAPORU ---
        if (!isComplete) {
            console.warn('🔒 BUTON KİLİTLİ - Eksik Alanlar:', checks); // checks objesini direkt bastıralım
        } else {
            if (this.saveBtn.getAttribute('data-log-sent') !== 'true') {
                console.log('✅ TÜM KOŞULLAR SAĞLANDI. BUTON AÇIK.');
                this.saveBtn.setAttribute('data-log-sent', 'true');
            }
        }
    }
}