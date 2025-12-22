// js/data-entry/strategies.js

import { FormTemplates } from './form-templates.js';
import { getSelectedNiceClasses } from '../nice-classification.js';
import { STATUSES } from '../../utils.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { collection, addDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from '../../firebase-config.js';

// Yardımcı: ID'den değer al
const getVal = (id) => document.getElementById(id)?.value?.trim() || null;

// Yardımcı: Tarih formatını DD.MM.YYYY -> YYYY-MM-DD çevirir
const formatDate = (dateStr) => {
    if (!dateStr) return null;
    const parts = dateStr.split('.');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
};

class BaseStrategy {
    render(container) { container.innerHTML = ''; }
    validate(data) { return null; }
}

export class TrademarkStrategy extends BaseStrategy {
    render(container, isEditMode = false) {
        container.innerHTML = FormTemplates.getTrademarkForm();
        
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
        const origin = getVal('originSelect');
        const brandText = getVal('brandExampleText');
        
        // Nice Sınıflarını Daha Temiz Formatla
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
                            const lines = rawText.split(/[\n]/).map(l => l.trim()).filter(Boolean);
                            lines.forEach(line => {
                                const cleanLine = line.replace(/^\)+|\)+$/g, '').trim(); 
                                if (cleanLine && !classObj.items.includes(cleanLine)) {
                                    classObj.items.push(cleanLine);
                                }
                            });
                        }
                    }
                    return acc;
                }, []).sort((a, b) => a.classNo - b.classNo);
            }
        } catch (e) { console.warn('Nice classes hatası:', e); }

        const isInternational = (origin === 'WIPO' || origin === 'ARIPO');

        const bulletinNo = getVal('bulletinNo');
        const bulletinDate = getVal('bulletinDate');
        const bulletins = (bulletinNo || bulletinDate) 
            ? [{ bulletinNo, bulletinDate: formatDate(bulletinDate) }] 
            : [];

        return {
            ipType: 'trademark',
            type: 'trademark',
            portfoyStatus: 'active',

            title: brandText,
            brandText: brandText,
            
            applicationDate: formatDate(getVal('applicationDate')),
            registrationDate: formatDate(getVal('registrationDate')),
            renewalDate: formatDate(getVal('renewalDate')),
            
            applicationNumber: getVal('applicationNumber'),
            registrationNumber: !isInternational ? getVal('registrationNumber') : null,
            internationalRegNumber: isInternational ? getVal('registrationNumber') : null, 

            description: getVal('brandDescription'),
            status: getVal('trademarkStatus'),
            brandType: getVal('brandType'),
            brandCategory: getVal('brandCategory'),
            bulletins: bulletins,
            
            origin: origin,
            applicants: context.selectedApplicants.map(p => ({ id: p.id, email: p.email || null })),
            priorities: context.priorities || [],
            goodsAndServicesByClass: goodsAndServicesByClass,
            brandImageUrl: context.uploadedBrandImage
        };
    }

    validate(data, context) {
        if (!data.brandText) return 'Marka adı (Metni) zorunludur.';
        if (!data.applicants || data.applicants.length === 0) return 'En az bir başvuru sahibi seçmelisiniz.';
        
        if ((data.origin === 'WIPO' || data.origin === 'ARIPO')) {
            if (!data.internationalRegNumber) return `${data.origin} için IR Numarası (Tescil No alanında) zorunludur.`;
            if (!context.selectedCountries || context.selectedCountries.length === 0) return 'En az bir ülke seçmelisiniz.';
        }
        
        if (!data.goodsAndServicesByClass || data.goodsAndServicesByClass.length === 0) return 'En az bir mal/hizmet sınıfı seçmelisiniz.';

        return null;
    }
}

export class PatentStrategy extends BaseStrategy {
    render(container) { container.innerHTML = FormTemplates.getPatentForm(); }
    collectData(context) {
        const title = getVal('patentTitle');
        return {
            ipType: 'patent',
            type: 'patent',
            portfoyStatus: 'active',
            title: title,
            applicationNumber: getVal('patentApplicationNumber'),
            description: getVal('patentDescription'),
            status: 'başvuru',
            origin: getVal('originSelect'),
            applicants: context.selectedApplicants.map(p => ({ id: p.id, email: p.email || null })),
            priorities: context.priorities || [],
            details: { patentInfo: { patentTitle: title, description: getVal('patentDescription') } }
        };
    }
    validate(data) { if (!data.title) return 'Patent başlığı zorunludur.'; return null; }
}

export class DesignStrategy extends BaseStrategy {
    render(container) { container.innerHTML = FormTemplates.getDesignForm(); }
    collectData(context) {
        const title = getVal('designTitle');
        return {
            ipType: 'design',
            type: 'design',
            portfoyStatus: 'active',
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
    validate(data) { if (!data.title) return 'Tasarım başlığı zorunludur.'; return null; }
}

export class SuitStrategy extends BaseStrategy {
    render(container) { 
        // Ana container data-entry.js tarafından temizlenip hazırlandığı için
        // burada ekstra bir div oluşturmaya gerek yok, direkt container'ı kullanabiliriz
        // veya yapıyı korumak adına container içine basabiliriz.
        container.innerHTML = '<div id="suitSpecificFieldsContainer"></div>'; 
    }
    
    renderSpecificFields(taskName) { 
        return FormTemplates.getClientSection() + 
               FormTemplates.getSubjectAssetSection() + 
               FormTemplates.getSuitFields(taskName); 
    }

    validate(data) {
        if (!data.client) return 'Müvekkil seçimi zorunludur.';
        if (!data.clientRole) return 'Müvekkil rolü seçimi zorunludur.';
        if (!data.transactionTypeId) return 'İş Tipi (Dava Türü) seçilmelidir.';
        if (!data.suitDetails.court && !document.getElementById('customCourtInput')?.value) return 'Mahkeme seçimi zorunludur.';
        if (!data.suitDetails.caseNo) return 'Esas No zorunludur.';
        if (!data.suitDetails.openingDate) return 'Dava Tarihi zorunludur.';

        const PARENT_SUIT_IDS = ['49', '54', '55', '56', '57', '58']; 
        
        if (!PARENT_SUIT_IDS.includes(String(data.transactionTypeId))) {
            return `HATA: "Manuel Portföy Girişi" ekranından sadece yeni bir ana dava dosyası (Dava Açılış, Hükümsüzlük vb.) oluşturulabilir. Seçtiğiniz işlem tipi bir ara işlemdir. Lütfen İş Yönetimi modülünü kullanın.`;
        }

        return null;
    }

    collectData(context) {
        const specificTaskType = context.suitSpecificTaskType;
        const clientPerson = context.suitClientPerson;
        const clientRole = getVal('clientRole');
        
        const courtSelect = document.getElementById('suitCourt');
        const customCourt = document.getElementById('customCourtInput');
        let finalCourt = getVal('suitCourt');
        if (finalCourt === 'other' || finalCourt === 'Diğer (Manuel Giriş)') {
            finalCourt = customCourt?.value?.trim();
        }

        // --- SUBJECT ASSET SADELEŞTİRME ---
        let simplifiedAsset = null;
        if (context.suitSubjectAsset) {
            simplifiedAsset = {
                id: context.suitSubjectAsset.id,
                type: context.suitSubjectAsset._source === 'suit' ? 'suit' : 'ipRecord' 
            };
        }

        return {
            ipType: 'suit',
            type: 'suit',
            portfoyStatus: 'active',
            title: specificTaskType ? `${specificTaskType.alias || specificTaskType.name} - ${clientPerson?.name}` : 'Yeni Dava',
            origin: getVal('originSelect') || 'TURKEY_NATIONAL',
            country: getVal('countrySelect'),
            
            client: clientPerson ? { id: clientPerson.id, name: clientPerson.name, role: clientRole } : null,
            clientRole: clientRole,
            
            // --- TRANSACTION TYPE MAP KALDIRILDI ---
            // Sadece ID tutuluyor
            transactionTypeId: specificTaskType?.id || null,
            
            suitDetails: {
                court: finalCourt,
                description: getVal('suitDescription'),
                opposingParty: getVal('opposingParty'),
                opposingCounsel: getVal('opposingCounsel'),
                caseNo: getVal('suitCaseNo'),
                openingDate: formatDate(getVal('suitOpeningDate')),
                suitStatus: getVal('suitStatusSelect') || 'filed'
            },
            
            subjectAsset: simplifiedAsset,
            createdAt: new Date().toISOString()
        };
    }

    async save(data) {
        try {
            console.log('💾 Dava kaydı başlatılıyor...', data);

            // 1. DOSYA YÜKLEME (Storage)
            const fileInput = document.getElementById('suitDocument');
            let uploadedDocs = [];

            if (fileInput && fileInput.files.length > 0) {
                console.log(`📤 ${fileInput.files.length} adet belge yükleniyor...`);
                const storage = getStorage();
                
                for (const file of fileInput.files) {
                    const storagePath = `suit-documents/${Date.now()}_${file.name}`;
                    const storageRef = ref(storage, storagePath);
                    
                    try {
                        const snapshot = await uploadBytes(storageRef, file);
                        const downloadURL = await getDownloadURL(snapshot.ref);
                        
                        uploadedDocs.push({
                            name: file.name,
                            url: downloadURL,
                            type: file.type,
                            uploadedAt: new Date().toISOString(),
                            uploadedBy: 'manual_entry'
                        });
                    } catch (uplErr) {
                        console.error(`❌ Dosya yükleme hatası (${file.name}):`, uplErr);
                    }
                }
            }
            
            data.documents = uploadedDocs;

            // 2. SUITS KOLEKSİYONUNA KAYIT
            const docRef = await addDoc(collection(db, 'suits'), data);
            const newSuitId = docRef.id;
            console.log('✅ Dava kartı oluşturuldu ID:', newSuitId);

            // 3. İLK TRANSACTION (Zaman Çizelgesi Başlangıcı)
            const initialTransaction = {
                type: data.transactionTypeId,
                // transactionTypeName olmadığı için genel açıklama
                description: "Portföye manuel olarak eklendi.",
                transactionHierarchy: 'parent',
                triggeringTaskId: 'manual_entry', 
                createdAt: Timestamp.now(),
                creationDate: data.suitDetails.openingDate || new Date().toISOString()
            };

            await addDoc(collection(db, 'suits', newSuitId, 'transactions'), initialTransaction);
            console.log('✅ İlk transaction eklendi.');

            return newSuitId;

        } catch (error) {
            console.error('Dava Kayıt Hatası:', error);
            throw error;
        }
    }
}