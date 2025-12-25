import { RELATED_PARTY_REQUIRED, TASK_IDS, asId } from './TaskConstants.js';

export class TaskValidator {
    constructor() {
        this.saveBtn = document.getElementById('saveTaskBtn');
    }

    checkCompleteness(state) {
        // Butonu her seferinde taze seçelim
        this.saveBtn = document.getElementById('saveTaskBtn');
        if (!this.saveBtn) return;

        const { selectedTaskType } = state || {};
        
        // Marka Başvurusu olup olmadığını anla
        const brandInputExists = !!document.getElementById('brandExampleText');
        const isTrademarkApp = (selectedTaskType?.alias === 'Başvuru' && selectedTaskType?.ipType === 'trademark') || brandInputExists;

        let isComplete = false;
        let checks = {}; // Konsol raporu için

        // --- SENARYO 1: MARKA BAŞVURUSU ---
        if (isTrademarkApp) {
            
            // 1. Marka Adı
            const brandText = document.getElementById('brandExampleText')?.value?.trim();
            
            // 2. Sınıf Seçimi (Genişletilmiş Seçici)
            // Hem .selected-class-item hem de .selected-item sınıflarını sayar
            const niceContainer = document.getElementById('selectedNiceClasses');
            const domClassCount = niceContainer 
                ? niceContainer.querySelectorAll('.selected-class-item, .selected-item').length 
                : 0;
            
            // 3. Başvuru Sahibi
            const applicantContainer = document.getElementById('selectedApplicantsList');
            const domApplicantCount = applicantContainer 
                ? applicantContainer.querySelectorAll('.selected-item, .search-result-item, .list-group-item').length 
                : 0;
            
            // 4. Menşe/Ülke Kontrolü
            const originType = document.getElementById('originSelect')?.value;
            let hasCountrySelection = true;
            
            // Eğer Yurtdışı Ulusal seçili ise ülke seçilmiş mi?
            if (originType === 'Yurtdışı Ulusal' || originType === 'FOREIGN_NATIONAL') {
                hasCountrySelection = !!document.getElementById('countrySelect')?.value;
            } 
            // Eğer WIPO/ARIPO seçili ise çoklu seçim listesi dolu mu?
            else if (['WIPO', 'ARIPO'].includes(originType)) {
                const countryList = document.getElementById('selectedCountriesList');
                const cnt = countryList ? countryList.querySelectorAll('.selected-item').length : 0;
                hasCountrySelection = cnt > 0;
            }

            // 5. Atanan Kişi
            const assignedTo = document.getElementById('assignedTo')?.value;

            // Kontrol Listesi
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
            
            // İlgili Taraf Zorunluluğu
            const tIdStr = asId(selectedTaskType?.id);
            const needsRelated = RELATED_PARTY_REQUIRED.has(tIdStr);
            
            const partyContainer = document.getElementById('relatedPartyList');
            const domRelatedCount = partyContainer ? partyContainer.querySelectorAll('.selected-item').length : 0;
            const hasRelated = domRelatedCount > 0;

            checks = {
                'Atanan Kişi': !!assignedTo,
                'İş Başlığı': !!taskTitle,
                'Varlık Seçimi': hasIpRecord,
                'İlgili Taraf': !needsRelated || hasRelated
            };

            isComplete = Object.values(checks).every(val => val === true);
        }

        // Sonucu uygula
        this.saveBtn.disabled = !isComplete;

        // --- DEBUG RAPORU ---
        // Sadece bir şeyler eksikse veya geliştirme aşamasında konsola basar
        if (!isComplete) {
            console.warn('🔒 BUTON KİLİTLİ - Eksik Alanlar:');
            console.table(checks);
        } else {
            // Buton açıldığında bir kere bilgi verelim (spam olmaması için)
            if (this.saveBtn.getAttribute('data-log-sent') !== 'true') {
                console.log('✅ TÜM KOŞULLAR SAĞLANDI. BUTON AÇIK.');
                this.saveBtn.setAttribute('data-log-sent', 'true');
            }
        }
    }
}