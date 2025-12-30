import { taskService, ipRecordsService, accrualService, db, authService } from '../../firebase-config.js';
import { doc, getDoc, updateDoc, collection, addDoc, setDoc, runTransaction, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { TASK_IDS, RELATED_PARTY_REQUIRED, asId } from './TaskConstants.js';
import { getSelectedNiceClasses } from '../nice-classification.js'; 
import { addMonthsToDate, findNextWorkingDay, isWeekend, isHoliday, TURKEY_HOLIDAYS } from '../../utils.js';

export class TaskSubmitHandler {
    constructor(dataManager, uiManager) {
        this.dataManager = dataManager;
        this.uiManager = uiManager;
        this.selectedParentTransactionId = null;
    }

    // --- ANA GÖNDERİM FONKSİYONU ---
    async handleFormSubmit(e, state) {
        e.preventDefault();
        
        const { 
            selectedTaskType, selectedIpRecord, selectedRelatedParties, selectedRelatedParty,
            selectedApplicants, priorities, selectedCountries, uploadedFiles,
            accrualData, isFreeTransaction 
        } = state;

        if (!selectedTaskType) {
            alert('Geçerli bir işlem tipi seçmediniz.');
            return;
        }

        const submitBtn = document.getElementById('saveTaskBtn');
        if (submitBtn) submitBtn.disabled = true;

        try {
            // 1. Temel Veriler
            const assignedTo = document.getElementById('assignedTo')?.value;
            const assignedUser = state.allUsers.find(u => u.id === assignedTo);
            
            let taskTitle = document.getElementById('taskTitle')?.value;
            let taskDesc = document.getElementById('taskDescription')?.value;

            // Marka Başvurusu Özel Başlık
            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const brandText = document.getElementById('brandExampleText')?.value;
                taskTitle = brandText ? `${brandText} Marka Başvurusu` : selectedTaskType.alias;
                taskDesc = taskDesc || `'${brandText || 'Yeni'}' markası için başvuru işlemi.`;
            } else {
                const recordTitle = selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.markName) : '';
                taskTitle = taskTitle || (recordTitle ? `${recordTitle} ${selectedTaskType.alias || selectedTaskType.name}` : (selectedTaskType.alias || selectedTaskType.name));
                
                if (!taskDesc) {
                    if (String(selectedTaskType.id) === '22') {
                        taskDesc = `${recordTitle} adlı markanın yenileme süreci için müvekkil onayı bekleniyor.`;
                    } else {
                        taskDesc = `${selectedTaskType.alias || selectedTaskType.name} işlemi.`;
                    }
                }
            }

            let taskData = {
                taskType: selectedTaskType.id,
                title: taskTitle,
                description: taskDesc,
                priority: document.getElementById('taskPriority')?.value || 'medium',
                assignedTo_uid: assignedUser ? assignedUser.id : null,
                assignedTo_email: assignedUser ? assignedUser.email : null,
                status: 'open',
                relatedIpRecordId: selectedIpRecord ? selectedIpRecord.id : null,
                relatedIpRecordTitle: selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.markName) : taskTitle,
                details: {},
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            };

            const manualDueDate = document.getElementById('taskDueDate')?.value;
            if (manualDueDate) {
                taskData.dueDate = Timestamp.fromDate(new Date(manualDueDate));
            }

            // 2. İlgili Taraflar
            this._enrichTaskWithParties(taskData, selectedTaskType, selectedRelatedParties, selectedRelatedParty, selectedIpRecord);
            // 3. Marka Başvurusu Kaydı
            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const newRecordId = await this._handleTrademarkApplication(state, taskData);
                if (!newRecordId) throw new Error("Marka kaydı oluşturulamadı.");
                taskData.relatedIpRecordId = newRecordId;
            }

            // 4. Otomatik Tarih Hesaplama
            await this._calculateTaskDates(taskData, selectedTaskType, selectedIpRecord);

            // ---------------------------------------------------------
            // 4.5. DOSYA YÜKLEME İŞLEMİ (YENİ EKLENDİ)
            // ---------------------------------------------------------
            // Eğer Marka Başvurusu değilse (onun kendi yükleyicisi var) ve dosya seçildiyse:
            if (!(selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark')) {
                if (uploadedFiles && uploadedFiles.length > 0) {
                    console.log('📤 Dokümanlar storage\'a yükleniyor...');
                    const docs = [];
                    
                    for (const file of uploadedFiles) {
                        const path = `task-documents/${Date.now()}_${file.name}`;
                        try {
                            // DataManager üzerinden yükle
                            const url = await this.dataManager.uploadFileToStorage(file, path);
                            docs.push({
                                name: file.name,
                                url: url,
                                type: file.type,
                                uploadedAt: new Date().toISOString()
                            });
                        } catch (err) {
                            console.error('Dosya yüklenirken hata:', err);
                        }
                    }
                    
                    // İş (Task) verisine belgeleri ekle
                    taskData.documents = docs;
                }
            }

            // 5. Task Oluştur
            console.log('📤 Task oluşturuluyor:', taskData);
            const taskResult = await taskService.createTask(taskData);
            if (!taskResult.success) throw new Error(taskResult.error);

            // 6. Dava Kaydı
            if (selectedTaskType.ipType === 'suit' || selectedTaskType.id === '49') {
                await this._handleSuitCreation(state, taskData, taskResult.id);
            }

            // 7. Transaksiyon Ekleme
            if (taskData.relatedIpRecordId) {
                await this._addTransactionToPortfolio(taskData.relatedIpRecordId, selectedTaskType, taskResult.id, state);
            }

            // 8. TAHAKKUK VE FİNANSAL İŞLEMLER (DÜZELTİLDİ)
            await this._handleAccrualLogic(taskResult.id, taskData.title, selectedTaskType, state, accrualData, isFreeTransaction);

            // 9. Otomasyon
            if (['20', 'trademark_publication_objection'].includes(String(selectedTaskType.id))) {
                await this._handleOppositionAutomation(taskResult.id, selectedTaskType, selectedIpRecord);
            }

            alert('İş başarıyla oluşturuldu!');
            window.location.href = 'task-management.html';

        } catch (error) {
            console.error('Submit Hatası:', error);
            alert('İşlem sırasında hata oluştu: ' + error.message);
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    // ============================================================
    // YARDIMCI METOTLAR
    // ============================================================

    /**
     * TAHAKKUK MANTIĞI (DÜZELTİLDİ)
     */
    async _handleAccrualLogic(taskId, taskTitle, taskType, state, accrualData, isFree) {
        // SENARYO 1: Ücretsiz İşlem
        if (isFree) {
            console.log('🆓 "Ücretsiz İşlem" seçildi. Tahakkuk atlanıyor.');
            return; 
        }

        // SENARYO 2: Anlık Tahakkuk (Veri Dolu)
        const hasValidAccrualData = accrualData && (
            (accrualData.officialFee?.amount > 0) || 
            (accrualData.serviceFee?.amount > 0)
        );

        if (hasValidAccrualData) {
            console.log('💰 Veri girildiği için anlık tahakkuk oluşturuluyor...');
            
            // --- DOSYA YÜKLEME İŞLEMİ (FileList -> Array -> Upload) ---
            let uploadedFileMetadata = [];
            
            // FileList'i Array'e çevir ve kontrol et
            if (accrualData.files && accrualData.files.length > 0) {
                const filesArray = Array.from(accrualData.files); // FileList'i diziye çevir
                
                for (const file of filesArray) {
                    const path = `accrual-docs/${Date.now()}_${file.name}`;
                    try {
                        const url = await this.dataManager.uploadFileToStorage(file, path);
                        uploadedFileMetadata.push({
                            name: file.name,
                            url: url,
                            storagePath: path,
                            type: file.type,
                            id: Date.now().toString() // Geçici ID
                        });
                        console.log(`📎 Dosya yüklendi: ${file.name}`);
                    } catch (uploadErr) {
                        console.error('Dosya yükleme hatası:', uploadErr);
                    }
                }
            }

            const finalAccrual = {
                taskId: taskId,
                taskTitle: taskTitle,
                officialFee: accrualData.officialFee,
                serviceFee: accrualData.serviceFee,
                vatRate: accrualData.vatRate,
                applyVatToOfficialFee: accrualData.applyVatToOfficialFee,
                
                // Firestore'a kaydedilecek veriler
                totalAmount: accrualData.totalAmount, // Array
                totalAmountCurrency: accrualData.totalAmountCurrency || 'TRY',
                
                // DB yapısına uygun olarak Array (Dizi) olarak bırakıyoruz
                remainingAmount: accrualData.totalAmount, 
                
                status: 'unpaid',
                tpInvoiceParty: accrualData.tpInvoiceParty,
                serviceInvoiceParty: accrualData.serviceInvoiceParty,
                isForeignTransaction: accrualData.isForeignTransaction,
                createdAt: new Date().toISOString(),
                
                // Yüklenen dosyaların metadata'sını ekle (FileList DEĞİL, Array)
                files: uploadedFileMetadata 
            };

            // Hata yakalama ekliyoruz
            const accrualResult = await accrualService.addAccrual(finalAccrual);
            if (!accrualResult.success) {
                console.error('❌ Tahakkuk ekleme hatası:', accrualResult.error);
                alert('İş oluşturuldu ancak tahakkuk kaydedilemedi: ' + accrualResult.error);
            } else {
                console.log('✅ Tahakkuk başarıyla kaydedildi.');
            }
            return; 
        }

        // SENARYO 3: Ertelenmiş Tahakkuk (Veri Yok/Form Kapalı)
        console.log('⏳ Tahakkuk verisi girilmedi. Özel ID (T-XX) ile görev açılıyor...');

        let assignedUid = "8A9HHfdKKNR3WKl6tCtJH5Khjkx1"; 
        let assignedEmail = "selcanakoglu@evrekapatent.com";

        try {
            const rule = await this.dataManager.getAssignmentRule("53");
            if (rule && rule.assigneeIds && rule.assigneeIds.length > 0) {
                const targetUid = rule.assigneeIds[0];
                const user = state.allUsers.find(u => u.id === targetUid);
                if (user) {
                    assignedUid = user.id;
                    assignedEmail = user.email;
                }
            }
        } catch (e) { console.warn('Atama kuralı hatası (Task 53)', e); }

        try {
            const counterRef = doc(db, 'counters', 'tasks_accruals');

            await runTransaction(db, async (transaction) => {
                const counterDoc = await transaction.get(counterRef);
                const currentCount = counterDoc.exists() ? (counterDoc.data().count || 0) : 0;
                const newCount = currentCount + 1;
                const newCustomId = `T-${newCount}`;

                transaction.set(counterRef, { count: newCount }, { merge: true });

                const accrualTaskData = {
                    id: newCustomId, 
                    taskType: "53",
                    title: `Tahakkuk Oluşturma: ${taskTitle}`,
                    description: `"${taskTitle}" işi oluşturuldu ancak tahakkuk girilmedi. Lütfen finansal kaydı oluşturun.`,
                    priority: 'high',
                    status: 'pending',
                    assignedTo_uid: assignedUid,
                    assignedTo_email: assignedEmail,
                    relatedTaskId: taskId, 
                    relatedIpRecordId: state.selectedIpRecord ? state.selectedIpRecord.id : null,
                    relatedIpRecordTitle: state.selectedIpRecord ? (state.selectedIpRecord.title || state.selectedIpRecord.markName) : taskTitle,
                    details: {
                        source: 'automatic_accrual_assignment',
                        originalTaskType: taskType.alias || taskType.name
                    },
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now()
                };

                const newTaskRef = doc(db, 'tasks', newCustomId);
                transaction.set(newTaskRef, accrualTaskData);
            });
            console.log('✅ Tahakkuk görevi özel ID ile oluşturuldu.');

        } catch (e) {
            console.error('❌ Özel ID oluşturma hatası:', e);
            alert('Tahakkuk görevi oluşturulurken bir hata meydana geldi.');
        }
    }

    // A) TARİH HESAPLAMA
    async _calculateTaskDates(taskData, taskType, ipRecord) {
        try {
            const isRenewal = String(taskType.id) === '22' || /yenileme/i.test(taskType.name);
            if (isRenewal && ipRecord) {
                let baseDate = null;
                const rawDate = ipRecord.renewalDate || ipRecord.registrationDate || ipRecord.applicationDate;
                if (rawDate) {
                    if (rawDate.toDate) baseDate = rawDate.toDate();
                    else if (typeof rawDate === 'string') baseDate = new Date(rawDate);
                    else baseDate = rawDate;
                }
                if (!baseDate || isNaN(baseDate.getTime())) baseDate = new Date();
                if (baseDate < new Date()) baseDate.setFullYear(baseDate.getFullYear() + 10);

                const official = findNextWorkingDay(baseDate, TURKEY_HOLIDAYS);
                const operational = new Date(official);
                operational.setDate(operational.getDate() - 3);
                while (isWeekend(operational) || isHoliday(operational, TURKEY_HOLIDAYS)) operational.setDate(operational.getDate() - 1);

                taskData.officialDueDate = Timestamp.fromDate(official);
                taskData.operationalDueDate = Timestamp.fromDate(operational);
                taskData.dueDate = Timestamp.fromDate(operational);
                taskData.officialDueDateDetails = {
                    finalOfficialDueDate: official.toISOString().split('T')[0],
                    renewalDate: baseDate.toISOString().split('T')[0],
                    adjustments: []
                };
                const dateStr = baseDate.toLocaleDateString('tr-TR');
                if (taskData.description && !taskData.description.includes('Yenileme tarihi:')) {
                    const separator = taskData.description.endsWith('.') ? ' ' : '. ';
                    taskData.description += `${separator}Yenileme tarihi: ${dateStr}.`;
                }
            }
            const isOpposition = ['20', 'trademark_publication_objection'].includes(String(taskType.id));
            if (isOpposition && ipRecord && ipRecord.source === 'bulletin' && ipRecord.bulletinId) {
                const bulletinData = await this.dataManager.fetchAndStoreBulletinData(ipRecord.bulletinId);
                if (bulletinData && bulletinData.bulletinDate) {
                    const [dd, mm, yyyy] = bulletinData.bulletinDate.split('/');
                    const bDate = new Date(parseInt(yyyy), parseInt(mm)-1, parseInt(dd));
                    const officialDate = addMonthsToDate(bDate, 2);
                    const adjustedOfficial = findNextWorkingDay(officialDate, TURKEY_HOLIDAYS);
                    const operationalDate = new Date(adjustedOfficial);
                    operationalDate.setDate(operationalDate.getDate() - 3);
                    while (isWeekend(operationalDate) || isHoliday(operationalDate, TURKEY_HOLIDAYS)) {
                        operationalDate.setDate(operationalDate.getDate() - 1);
                    }
                    taskData.dueDate = Timestamp.fromDate(operationalDate); 
                    taskData.officialDueDate = Timestamp.fromDate(adjustedOfficial);
                    taskData.operationalDueDate = Timestamp.fromDate(operationalDate);
                    taskData.details.bulletinNo = bulletinData.bulletinNo;
                    taskData.details.bulletinDate = bulletinData.bulletinDate;
                }
            }
        } catch (e) { console.warn('Tarih hesaplama hatası:', e); }
    }

    // B) TARAFLAR VE İŞ SAHİBİ (TASK OWNER) BELİRLEME
    _enrichTaskWithParties(taskData, taskType, relatedParties, singleParty, ipRecord) {
        const tIdStr = String(taskType.id);

        // KURAL 1: İlgili Taraf Seçimi Zorunlu Olan İşler (Devir, Lisans vb.)
        if (RELATED_PARTY_REQUIRED.has(tIdStr)) {
            // Seçilen ilgili tarafları iş sahibi yap
            const owners = (Array.isArray(relatedParties) ? relatedParties : []).map(p => String(p.id)).filter(Boolean);
            if (owners.length) taskData.taskOwner = owners;
            
            // Detaylara da ekle (Eski yapı uyumluluğu için)
            if (relatedParties && relatedParties.length) {
                taskData.details.relatedParties = relatedParties.map(p => ({ id: p.id, name: p.name, email: p.email }));
            }
        } 
        // KURAL 2: İlgili Taraf Seçimi OLMAYAN İşler (Yenileme, Tescil Ücreti vb.)
        // Bu durumda işin sahibi, dosyanın (Marka/Patent) sahibidir.
        else {
            if (ipRecord && Array.isArray(ipRecord.applicants) && ipRecord.applicants.length > 0) {
                taskData.taskOwner = ipRecord.applicants.map(a => String(a.id)).filter(Boolean);
                console.log('✅ Otomatik Atama: Dosya sahipleri taskOwner olarak ayarlandı:', taskData.taskOwner);
            }
        }

        // KURAL 3: Karşı Taraf / Rakip (İtiraz İşlemleri İçin)
        const objectionIds = ['7', '19', '20'];
        if (objectionIds.includes(tIdStr)) {
            const opponent = (relatedParties && relatedParties.length) ? relatedParties[0] : singleParty;
            if (opponent) {
                taskData.opponent = { id: opponent.id, name: opponent.name, email: opponent.email };
                taskData.details.opponent = taskData.opponent;
            }
        }
    }

// C) MARKA BAŞVURUSU (DÜZELTİLDİ: Yalın Marka Adı Kullanımı)

async _handleTrademarkApplication(state, taskData) {
    const { selectedApplicants, priorities, uploadedFiles, selectedTaskType } = state;
    
    // 1. Görsel Yükleme (Aynı kalıyor)
    let brandImageUrl = null;
    if (uploadedFiles.length > 0) {
        const file = uploadedFiles[0];
        const path = `brand-images/${Date.now()}_${file.name}`;
        try {
            brandImageUrl = await this.dataManager.uploadFileToStorage(file, path);
        } catch (e) { console.error('Görsel yükleme hatası:', e); }
    }

    // 2. DOM'dan Verileri Çek (Aynı kalıyor)
    const brandType = document.getElementById('brandType')?.value || '';
    const brandCategory = document.getElementById('brandCategory')?.value || '';
    const visualDescription = document.getElementById('brandExampleText')?.value?.trim() || ''; 
    const nonLatin = document.getElementById('nonLatinAlphabet')?.value || '';
    
    // İsim Düzeltme (Aynı kalıyor)
    let cleanBrandName = visualDescription;
    if (!cleanBrandName && taskData.title) {
            cleanBrandName = taskData.title.replace(/ Marka Başvurusu$/i, '').trim();
    }

    // Menşe Bilgisi (Aynı kalıyor)
    let origin = document.getElementById('originSelect')?.value || 'TÜRKPATENT';
    let originCountry = 'TR'; 
    if (origin === 'Yurtdışı Ulusal' || origin === 'FOREIGN_NATIONAL') {
        origin = 'FOREIGN_NATIONAL';
        originCountry = document.getElementById('countrySelect')?.value || '';
    }

    // ✅ YENİ: Sınıflandırma Verisini Standartlaştırma (Parsing Logic)
    // Manuel Giriş (Strategies.js) içindeki mantığı buraya taşıdık.
    let goodsAndServicesByClass = [];
    let niceClassesSimple = [];

    try {
        const rawNiceClasses = getSelectedNiceClasses(); // Örn: ["(5) İlaçlar...", "(35) Mağazacılık..."]
        
        if (Array.isArray(rawNiceClasses)) {
            // A) Detaylı Obje Yapısını Oluştur (goodsAndServicesByClass)
            goodsAndServicesByClass = rawNiceClasses.reduce((acc, item) => {
                // "(5) Metin" formatını yakala
                const match = item.match(/^\((\d+)(?:-\d+)?\)\s*([\s\S]*)$/);
                if (match) {
                    const classNo = parseInt(match[1]);
                    const rawText = match[2].trim();
                    
                    let classObj = acc.find(obj => obj.classNo === classNo);
                    if (!classObj) {
                        classObj = { classNo, items: [] };
                        acc.push(classObj);
                    }
                    // Metni satırlara böl ve temizle
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

            // B) Basit Sayı Dizisini Oluştur (niceClasses)
            niceClassesSimple = goodsAndServicesByClass.map(g => g.classNo);
        }
    } catch (e) { console.warn('Nice classes parsing hatası:', e); }

    const recordOwnerType = 'self'; 

    // Başvuru Sahipleri
    const applicantsData = selectedApplicants.map(p => ({
        id: p.id,
        name: p.name,
        address: p.address || '',
        country: p.country || '',
        role: 'applicant'
    }));

    // YENİ PORTFÖY KAYDI (Güncellenmiş Yapı)
    const newRecordData = {
        // -- Kimlik Bilgileri --
        title: cleanBrandName,
        brandText: cleanBrandName,   // ✅ EKLENDİ
        // markName: cleanBrandName, // 🗑️ SİLİNDİ
        
        type: 'trademark',
        recordOwnerType: recordOwnerType,
        
        // -- Statü ve Tarihler --
        portfoyStatus: 'active',     // ✅ EKLENDİ
        status: 'filed',
        // currentStatus: 'Başvuru Yapıldı', // 🗑️ SİLİNDİ
        
        applicationDate: new Date().toISOString().split('T')[0],
        applicationNumber: null,
        registrationDate: null,      // ✅ Standart olması için null set edildi
        registrationNumber: null,    // ✅ Standart olması için null set edildi
        
        // -- Marka Detayları --
        brandType: brandType,
        brandCategory: brandCategory,
        visualDescription: visualDescription,
        nonLatinAlphabet: nonLatin,
        
        // -- Görsel --
        brandImageUrl: brandImageUrl,
        // imagePath: brandImageUrl, // 🗑️ SİLİNDİ
        
        // -- Sınıflar --
        niceClasses: niceClassesSimple,             // ✅ DÜZELTİLDİ: Sadece sayılar [1, 35]
        goodsAndServicesByClass: goodsAndServicesByClass, // ✅ DÜZELTİLDİ: Detaylı obje
        // goodsAndServices: ...,                   // 🗑️ SİLİNDİ
        
        // -- Kişiler --
        applicants: applicantsData,
        holder: applicantsData,      // 🗑️ SİLİNDİ (Ama kodunuzda applicantsData kullanılıyor, holder'ı kaldırdık)
        
        // -- Rüçhan --
        priorities: priorities || [],
        
        // -- Menşe --
        origin: origin,
        countryCode: originCountry,

        // -- Sistem --
        source: 'task_creation',
        createdViaTaskId: taskData.id || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    // holder alanını gerçekten siliyoruz (yukarıdaki objede yorum satırı yaptım ama temizlik için):
    delete newRecordData.holder;

    const result = await ipRecordsService.createRecord(newRecordData);
    return result.success ? result.id : null;
}
    
// D) DAVA KAYDI VE İLK TRANSACTION (GÜVENLİ VERSİYON)

    async _handleSuitCreation(state, taskData, taskId) {
        const { selectedTaskType, selectedIpRecord, selectedRelatedParties } = state;
        
        // 1. PARENT (ANA DAVA) KONTROLÜ
        const PARENT_SUIT_IDS = ['49', '54', '55', '56', '57', '58']; 
        const isParentCreation = PARENT_SUIT_IDS.includes(String(selectedTaskType.id));

        if (!isParentCreation) {
            console.log('ℹ️ Bu bir alt işlem (Child), yeni dava kartı oluşturulmuyor.');
            return; 
        }

        try {
            const client = selectedRelatedParties && selectedRelatedParties.length > 0 ? selectedRelatedParties[0] : null;
            
            // 2. Mahkeme İsmini Belirle
            const courtSelect = document.getElementById('courtName');
            const customInput = document.getElementById('customCourtInput');
            let finalCourtName = '';

            if (courtSelect) {
                if (courtSelect.value === 'other' && customInput) {
                    finalCourtName = customInput.value.trim();
                } else {
                    finalCourtName = courtSelect.value;
                }
            }

            // 3. İlgili Varlık Bilgilerini Hazırla
            let subjectAssetData = null;
            if (selectedIpRecord) {
                subjectAssetData = {
                    id: selectedIpRecord.id,
                    type: selectedIpRecord._source === 'suit' ? 'suit' : 'ipRecord'
                };
            }

            // --- YENİ BAŞLIK (TITLE) MANTIĞI ---
            // Title artık "İşin Adı" değil, "Konu Varlığın Kendisi" olacak.
            let suitTitle = taskData.title; // Varsayılan olarak task başlığı kalsın (ne olur ne olmaz)

            if (selectedIpRecord) {
                if (selectedIpRecord._source === 'suit') {
                    // Eğer seçilen varlık bir Dava ise -> Dosya No'yu (Esas No) başlık yap
                    // Veri yapısına göre caseNo, fileNumber veya displayFileNumber alanlarını kontrol et
                    suitTitle = selectedIpRecord.suitDetails?.caseNo || 
                                selectedIpRecord.fileNumber || 
                                selectedIpRecord.displayFileNumber || 
                                selectedIpRecord.caseNo ||
                                selectedIpRecord.title; // En kötü ihtimalle eski başlığı kullan
                } else {
                    // Eğer seçilen varlık Marka/Patent ise -> Marka Adını başlık yap
                    suitTitle = selectedIpRecord.title || selectedIpRecord.markName;
                }
            }
            // ------------------------------------

            // 4. Dava Objesini Hazırla
            const newSuitData = {
                title: suitTitle, // <--- GÜNCELLENDİ (Artık varlık adı)
                transactionTypeId: selectedTaskType.id,
                suitType: selectedTaskType.alias || selectedTaskType.name, // Bu alan "Dava Türü" kolonunda görünecek
                
                documents: taskData.documents || [],

                suitDetails: {
                    court: finalCourtName,
                    description: document.getElementById('suitDescription')?.value || '',
                    opposingParty: document.getElementById('opposingParty')?.value || '',
                    opposingCounsel: document.getElementById('opposingCounsel')?.value || '',
                    openingDate: document.getElementById('suitOpeningDate')?.value || new Date().toISOString(),
                    // Eğer esas no formdan girildiyse onu da alalım, yoksa varlıktan geleni kullanalım mı? 
                    // Genelde yeni dava açarken formdan girilen esas no en doğrusudur.
                    caseNo: document.getElementById('suitCaseNo')?.value || '' 
                },
                clientRole: document.getElementById('clientRole')?.value || '',
                client: client ? { id: client.id, name: client.name, email: client.email } : null,
                subjectAsset: subjectAssetData,
                
                suitStatus: 'continue',
                portfolioStatus: 'active',
                origin: document.getElementById('originSelect')?.value || 'TURKEY',
                createdAt: new Date().toISOString(),
                relatedTaskId: taskId
            };

            // 5. Davayı 'suits' Koleksiyonuna Ekle
            const suitsRef = collection(db, 'suits');
            const suitDocRef = await addDoc(suitsRef, newSuitData);
            const newSuitId = suitDocRef.id;

            console.log('✅ Yeni Dava Kartı Oluşturuldu ID:', newSuitId);

            // ... (Transaction ekleme kodları aynı kalacak) ...
            
            // 6. İLK TRANSACTION'I EKLE
            const initialTransaction = {
                type: selectedTaskType.id,
                description: 'Dava Açıldı',
                transactionHierarchy: 'parent',
                triggeringTaskId: String(taskId),
                createdAt: Timestamp.now(),
                creationDate: new Date().toISOString()
            };

            const transactionsRef = collection(db, 'suits', newSuitId, 'transactions');
            await addDoc(transactionsRef, initialTransaction);

        } catch (error) { 
            console.error('Suit oluşturma hatası:', error); 
            alert('Dava kartı oluşturulurken hata meydana geldi: ' + error.message);
        }
    }


// E) PORTFOLYO GEÇMİŞİ (GÜNCELLENDİ: Hem Dava Hem Marka İçin)
    async _addTransactionToPortfolio(recordId, taskType, taskId, state) {
        let hierarchy = 'parent';
        let extraData = {};
        const tId = String(taskType.id);
        const isWithdrawal = ['8', '21'].includes(tId);

        if (isWithdrawal) {
            if (this.selectedParentTransactionId) {
                hierarchy = 'child';
                extraData.parentId = this.selectedParentTransactionId;
            }
        }

        const transactionData = {
            type: taskType.id,
            description: `${taskType.name} işlemi.`,
            transactionHierarchy: hierarchy,
            triggeringTaskId: String(taskId),
            createdAt: Timestamp.now(), // Firestore Timestamp kullanıyoruz
            timestamp: new Date().toISOString(),
            ...extraData
        };

        // --- DEĞİŞİKLİK BURADA BAŞLIYOR ---
        // Seçilen kaydın kaynağına bakıyoruz: 'suit' mi?
        const isSuit = state.selectedIpRecord && state.selectedIpRecord._source === 'suit';
        const collectionName = isSuit ? 'suits' : 'ipRecords';

        try {
            // Dinamik olarak doğru koleksiyonun altına ekliyoruz
            const transactionsRef = collection(db, collectionName, recordId, 'transactions');
            await addDoc(transactionsRef, transactionData);
            
            console.log(`✅ Transaction eklendi: ${collectionName}/${recordId}/transactions`);
        } catch (error) {
            console.error(`Transaction ekleme hatası (${collectionName}):`, error);
        }
    }

    // F) OTOMASYON
    async _handleOppositionAutomation(taskId, taskType, ipRecord) {
        if (window.portfolioByOppositionCreator && typeof window.portfolioByOppositionCreator.handleTransactionCreated === 'function') {
            try {
                const result = await window.portfolioByOppositionCreator.handleTransactionCreated({
                    id: taskId,
                    specificTaskType: taskType.id,
                    selectedIpRecord: ipRecord
                });
                if (result?.success) console.log('Otomasyon sonucu:', result);
            } catch (e) { console.warn('Otomasyon hatası:', e); }
        }
    }
}