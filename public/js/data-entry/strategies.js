// js/strategies.js
import { FormTemplates } from './form-templates.js'; // Az önce oluşturduğun dosya
import { getSelectedNiceClasses } from './nice-classification.js'; // Mevcut dosyan
import { STATUSES } from '../utils.js'; // Mevcut dosyan

// Ortak Yardımcı Fonksiyonlar
const getVal = (id) => document.getElementById(id)?.value?.trim() || null;

class BaseStrategy {
    render(container) {
        container.innerHTML = '';
    }
    
    // Validasyon mesajı döndürür, sorun yoksa null döner
    validate(data) {
        return null; 
    }
}

export class TrademarkStrategy extends BaseStrategy {
    render(container, isEditMode = false) {
        container.innerHTML = FormTemplates.getTrademarkForm();
        
        // Durum select'ini doldur
        const stSel = document.getElementById('trademarkStatus');
        if (stSel) {
            const emptyOpt = '<option value="">Durum Seçiniz...</option>';
            const statusOptions = STATUSES.trademark
                .map(s => `<option value="${s.value}">${s.text}</option>`)
                .join('');
            stSel.innerHTML = emptyOpt + statusOptions;
            if (!isEditMode) stSel.value = '';
        }
    }

    collectData(context) {
        // Context: Ana sınıftan gelen veriler (this.selectedApplicants, vb.)
        const origin = getVal('originSelect');
        const brandText = getVal('brandExampleText');
        
        // Nice Sınıflarını Formatla
        let goodsAndServicesByClass = [];
        try {
            const rawNiceClasses = getSelectedNiceClasses();
            if (Array.isArray(rawNiceClasses)) {
                goodsAndServicesByClass = rawNiceClasses.reduce((acc, item) => {
                    const match = item.match(/^\((\d+)(?:-\d+)?\)\s*([\s\S]*)$/);
                    if (match) {
                        const classNo = parseInt(match[1]);
                        const rawText = match[2].trim();
                        let classObj = acc.find(obj => obj.classNo === classNo);
                        if (!classObj) {
                            classObj = { classNo, items: [] };
                            acc.push(classObj);
                        }
                        if (rawText) {
                            const lines = rawText.split(/[\n.]/).map(l => l.trim()).filter(Boolean);
                            lines.forEach(line => {
                                if (!classObj.items.includes(line)) classObj.items.push(line);
                            });
                        }
                    }
                    return acc;
                }, []).sort((a, b) => a.classNo - b.classNo);
            }
        } catch (e) { console.warn('Nice classes hatası:', e); }

        return {
            ipType: 'trademark',
            title: brandText,
            brandText: brandText,
            applicationNumber: getVal('applicationNumber'), // Normal başvuru
            internationalRegNumber: getVal('registrationNumber'), // WIPO/ARIPO IR No buraya giriliyor
            applicationDate: getVal('applicationDate'),
            registrationDate: getVal('registrationDate'),
            renewalDate: getVal('renewalDate'),
            description: getVal('brandDescription'),
            status: getVal('trademarkStatus'),
            brandType: getVal('brandType'),
            brandCategory: getVal('brandCategory'),
            bulletins: (getVal('bulletinNo') || getVal('bulletinDate')) 
                ? [{ bulletinNo: getVal('bulletinNo'), bulletinDate: getVal('bulletinDate') }] 
                : [],
            
            // Context'ten gelenler
            origin: origin,
            applicants: context.selectedApplicants.map(p => ({ id: p.id, email: p.email || null })),
            priorities: context.priorities || [],
            goodsAndServicesByClass: goodsAndServicesByClass,
            // Dosya URL'i context'ten gelecek
            brandImageUrl: context.uploadedBrandImage
        };
    }

    validate(data, context) {
        if (!data.brandText) return 'Marka adı (Metni) zorunludur.';
        if (!data.applicants || data.applicants.length === 0) return 'En az bir başvuru sahibi seçmelisiniz.';
        
        // WIPO/ARIPO Kontrolü
        if ((data.origin === 'WIPO' || data.origin === 'ARIPO')) {
            if (!data.internationalRegNumber) return `${data.origin} için IR Numarası (Tescil No alanında) zorunludur.`;
            if (!context.selectedCountries || context.selectedCountries.length === 0) return 'En az bir ülke seçmelisiniz.';
        }
        
        if (!data.goodsAndServicesByClass || data.goodsAndServicesByClass.length === 0) return 'En az bir mal/hizmet sınıfı seçmelisiniz.';

        return null; // Validasyon geçti
    }
}

export class PatentStrategy extends BaseStrategy {
    render(container) {
        container.innerHTML = FormTemplates.getPatentForm();
    }

    collectData(context) {
        const title = getVal('patentTitle');
        return {
            ipType: 'patent',
            title: title,
            applicationNumber: getVal('patentApplicationNumber'),
            description: getVal('patentDescription'),
            status: 'başvuru', // Varsayılan
            
            origin: getVal('originSelect'),
            applicants: context.selectedApplicants.map(p => ({ id: p.id, email: p.email || null })),
            priorities: context.priorities || [],
            
            details: { patentInfo: { patentTitle: title, description: getVal('patentDescription') } }
        };
    }

    validate(data) {
        if (!data.title) return 'Patent başlığı zorunludur.';
        return null;
    }
}

export class DesignStrategy extends BaseStrategy {
    render(container) {
        container.innerHTML = FormTemplates.getDesignForm();
    }

    collectData(context) {
        const title = getVal('designTitle');
        return {
            ipType: 'design',
            title: title,
            applicationNumber: getVal('designApplicationNumber'),
            description: getVal('designDescription'),
            status: 'başvuru',
            
            origin: getVal('originSelect'),
            applicants: context.selectedApplicants.map(p => ({ id: p.id, email: p.email || null })),
            priorities: context.priorities || [],
            
            details: { designInfo: { designTitle: title, description: getVal('designDescription') } }
        };
    }

    validate(data) {
        if (!data.title) return 'Tasarım başlığı zorunludur.';
        return null;
    }
}

export class SuitStrategy extends BaseStrategy {
    render(container) {
        // Suit için alanlar dinamik eklendiği için burada sadece container temizlenip bırakılabilir
        // veya ana yapı kurulabilir. DataEntryModule içinde renderSuitFields kullanılıyor.
        // Şimdilik boş bırakıyoruz, çünkü Suit render mantığı biraz daha karmaşık (Task Type seçimine bağlı).
        container.innerHTML = '<div id="suitSpecificFieldsContainer"></div>';
    }
    
    // Suit için özel render helper
    renderSpecificFields(taskName) {
        return FormTemplates.getClientSection() + FormTemplates.getSubjectAssetSection() + FormTemplates.getSuitFields(taskName);
    }

    collectData(context) {
        const specificTaskType = context.suitSpecificTaskType;
        const clientPerson = context.suitClientPerson;
        const clientRole = getVal('clientRole');
        
        return {
            ipType: 'suit',
            title: specificTaskType ? `${specificTaskType.alias || specificTaskType.name} - ${clientPerson?.name}` : 'Yeni Dava',
            
            origin: getVal('originSelect') || 'TURKEY_NATIONAL',
            country: getVal('countrySelect'),
            
            client: clientPerson ? { id: clientPerson.id, name: clientPerson.name, role: clientRole } : null,
            clientRole: clientRole,
            
            transactionType: specificTaskType ? { id: specificTaskType.id, name: specificTaskType.name, alias: specificTaskType.alias } : null,
            transactionTypeId: specificTaskType?.id || null,
            
            suitDetails: {
                court: getVal('suitCourt'),
                description: getVal('suitDescription'),
                opposingParty: getVal('opposingParty'),
                opposingCounsel: getVal('opposingCounsel'),
                caseNo: getVal('suitCaseNo'),
                openingDate: getVal('suitOpeningDate'),
            },
            suitStatus: getVal('suitStatusSelect') || 'filed',
            subjectAsset: context.suitSubjectAsset || null
        };
    }

    validate(data) {
        if (!data.client) return 'Müvekkil seçimi zorunludur.';
        if (!data.clientRole) return 'Müvekkil rolü seçimi zorunludur.';
        if (!data.transactionTypeId) return 'İş Tipi (Dava Türü) seçilmelidir.';
        if (!data.suitDetails.court) return 'Mahkeme seçimi zorunludur.';
        if (!data.suitDetails.caseNo) return 'Esas No zorunludur.';
        if (!data.suitDetails.openingDate) return 'Dava Tarihi zorunludur.';
        return null;
    }
}