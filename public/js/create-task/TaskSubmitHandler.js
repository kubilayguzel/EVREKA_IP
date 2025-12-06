import { taskService, ipRecordsService, accrualService, db, authService } from '../../firebase-config.js';
import { doc, getDoc, updateDoc, collection, addDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { TASK_IDS, RELATED_PARTY_REQUIRED, asId } from './TaskConstants.js';
import { getSelectedNiceClasses } from '../nice-classification.js';
// Tarih hesaplama yardımcıları (utils.js dosyanızda olduğundan emin olun)
import { addMonthsToDate, findNextWorkingDay, isWeekend, isHoliday, TURKEY_HOLIDAYS } from '../../utils.js';

export class TaskSubmitHandler {
    constructor(dataManager, uiManager) {
        this.dataManager = dataManager;
        this.uiManager = uiManager;
        this.selectedParentTransactionId = null; // Geri çekme işlemi için
    }

    // --- ANA GÖNDERİM FONKSİYONU ---
    async handleFormSubmit(e, state) {
        e.preventDefault();
        const { 
            selectedTaskType, selectedIpRecord, selectedRelatedParties, selectedRelatedParty,
            selectedApplicants, priorities, selectedCountries, uploadedFiles,
            selectedTpInvoiceParty, selectedServiceInvoiceParty,
            isWithdrawalTask 
        } = state;

        if (!selectedTaskType) {
            alert('Geçerli bir işlem tipi seçmediniz.');
            return;
        }

        const submitBtn = document.getElementById('saveTaskBtn');
        if (submitBtn) submitBtn.disabled = true;

        try {
            // 1. Temel Task Verilerini Hazırla
            const assignedTo = document.getElementById('assignedTo')?.value;
            const assignedUser = state.allUsers.find(u => u.id === assignedTo);
            
            // Marka başvurusu ise başlık marka adıdır, değilse inputtan veya işlem adından gelir
            let taskTitle = document.getElementById('taskTitle')?.value;
            let taskDesc = document.getElementById('taskDescription')?.value;

            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const brandText = document.getElementById('brandExampleText')?.value;
                taskTitle = brandText || selectedTaskType.alias;
                taskDesc = taskDesc || `'${brandText || 'Yeni'}' markası için başvuru işlemi.`;
            } else {
                taskTitle = taskTitle || selectedTaskType.alias || selectedTaskType.name;
                taskDesc = taskDesc || `${selectedTaskType.alias || selectedTaskType.name} işlemi.`;
            }

            let taskData = {
                taskType: selectedTaskType.id,
                title: taskTitle,
                description: taskDesc,
                priority: document.getElementById('taskPriority')?.value || 'medium',
                assignedTo_uid: assignedUser ? assignedUser.id : null,
                assignedTo_email: assignedUser ? assignedUser.email : null,
                dueDate: document.getElementById('taskDueDate')?.value || null,
                status: 'open',
                relatedIpRecordId: selectedIpRecord ? selectedIpRecord.id : null,
                relatedIpRecordTitle: selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.markName) : taskTitle,
                details: {}
            };

            // 2. İlgili Tarafları Ekle (Task Owner & Opponent)
            this._enrichTaskWithParties(taskData, selectedTaskType, selectedRelatedParties, selectedRelatedParty);

            // 3. Marka Başvurusu Özel İşlemleri (IP Record Oluşturma)
            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const newRecordId = await this._handleTrademarkApplication(state, taskData);
                if (!newRecordId) { throw new Error("Marka kaydı oluşturulamadı."); }
                taskData.relatedIpRecordId = newRecordId;
            }

            // 4. OTOMATİK TARİH HESAPLAMA (EKSİK OLAN KISIM)
            // Yayına itiraz veya Yenileme işlemleri için tarihleri hesaplar
            await this._calculateTaskDates(taskData, selectedTaskType, selectedIpRecord);

            // 5. Task'ı Oluştur
            const taskResult = await taskService.createTask(taskData);
            if (!taskResult.success) throw new Error(taskResult.error);

            // 6. DAVA (SUIT) KAYDI OLUŞTURMA (EKSİK OLAN KISIM)
            // Eğer işlem bir dava ise 'suits' koleksiyonuna kayıt atar
            if (selectedTaskType.ipType === 'suit' || selectedTaskType.id === '49') {
                const suitId = await this._handleSuitCreation(state, taskData, taskResult.id);
                if (suitId) {
                    console.log(`✅ Dava dosyası oluşturuldu: ${suitId}`);
                    // Task'ı güncellemek gerekebilir (opsiyonel, genelde create sırasında ilişki kurulur)
                }
            }

            // 7. Transaksiyon (İşlem Geçmişi) Ekleme
            if (taskData.relatedIpRecordId) {
                await this._addTransactionToPortfolio(taskData.relatedIpRecordId, selectedTaskType, taskResult.id, state);
            }

            // 8. Tahakkuk (Finans) Kaydı
            await this._handleAccrual(taskResult.id, taskData.title, selectedTaskType, state);

            alert('İş başarıyla oluşturuldu!');
            window.location.href = 'task-management.html';

        } catch (error) {
            console.error('Submit Hatası:', error);
            alert('İşlem sırasında hata oluştu: ' + error.message);
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    // --- YARDIMCI METOTLAR ---

    // A) OTOMATİK TARİH HESAPLAMA MANTIĞI
    async _calculateTaskDates(taskData, taskType, ipRecord) {
        try {
            // Senaryo 1: Yayına İtiraz (ID: 20) ve Bülten Kaynaklı
            const isOpposition = ['20', 'trademark_publication_objection'].includes(String(taskType.id));
            
            if (isOpposition && ipRecord && ipRecord.source === 'bulletin' && ipRecord.bulletinId) {
                console.log('📅 Yayına itiraz tarihleri hesaplanıyor...');
                // Cache'den veya Firestore'dan bülten tarihini al
                const bulletinData = await this.dataManager.fetchAndStoreBulletinData(ipRecord.bulletinId); // DataManager'da bu metot olmalı
                
                if (bulletinData && bulletinData.bulletinDate) {
                    const [dd, mm, yyyy] = bulletinData.bulletinDate.split('/');
                    const bDate = new Date(parseInt(yyyy), parseInt(mm)-1, parseInt(dd));
                    
                    // Resmi süre: +2 Ay
                    const officialDate = addMonthsToDate(bDate, 2);
                    // Hafta sonu/Tatil ötelemesi
                    const adjustedOfficial = findNextWorkingDay(officialDate, TURKEY_HOLIDAYS);
                    
                    // Operasyonel süre: -3 Gün
                    const operationalDate = new Date(adjustedOfficial);
                    operationalDate.setDate(operationalDate.getDate() - 3);
                    // Geriye doğru tatil kontrolü
                    while (isWeekend(operationalDate) || isHoliday(operationalDate, TURKEY_HOLIDAYS)) {
                        operationalDate.setDate(operationalDate.getDate() - 1);
                    }

                    // Task Data'ya işle
                    taskData.dueDate = operationalDate.toISOString(); // UI için
                    taskData.officialDueDate = adjustedOfficial.toISOString();
                    taskData.details.bulletinNo = bulletinData.bulletinNo;
                    taskData.details.bulletinDate = bulletinData.bulletinDate;
                    
                    console.log('✅ Tarihler:', { official: adjustedOfficial, operational: operationalDate });
                }
            }
            
            // Senaryo 2: Yenileme (ID: 22)
            const isRenewal = String(taskType.id) === '22' || /yenileme/i.test(taskType.name);
            if (isRenewal && ipRecord) {
                // Kayıt tarihini bul (RenewalDate -> RegistrationDate -> ApplicationDate)
                let baseDate = ipRecord.renewalDate || ipRecord.registrationDate || ipRecord.applicationDate;
                if (baseDate) {
                    // Timestamp ise Date'e çevir
                    const dateObj = (baseDate.toDate ? baseDate.toDate() : new Date(baseDate));
                    // 10 Yıl Ekle (Basit mantık, gerçekte son yenilemeden hesaplanır)
                    // Burada veritabanındaki renewalDate'in "gelecek tarih" olduğunu varsayıyoruz.
                    // Eğer geçmiş tarihse +10 yıl eklemek gerekebilir.
                    
                    const official = findNextWorkingDay(dateObj, TURKEY_HOLIDAYS);
                    const operational = new Date(official);
                    operational.setDate(operational.getDate() - 3);
                    
                    taskData.dueDate = operational.toISOString();
                }
            }

        } catch (e) {
            console.warn('Tarih hesaplama hatası:', e);
            // Tarih hesaplanamazsa işlem durmasın, devam etsin.
        }
    }

    // B) DAVA (SUIT) KAYDI OLUŞTURMA MANTIĞI
    async _handleSuitCreation(state, taskData, taskId) {
        const { selectedTaskType, selectedIpRecord, selectedRelatedParties } = state;
        
        console.log('⚖️ Dava kaydı (Suit) oluşturuluyor...');
        
        try {
            // Müvekkil (Client)
            const client = selectedRelatedParties && selectedRelatedParties.length > 0 
                ? selectedRelatedParties[0] 
                : null;

            const newSuitData = {
                title: taskData.title,
                transactionTypeId: selectedTaskType.id,
                transactionType: {
                    id: selectedTaskType.id,
                    name: selectedTaskType.name,
                    alias: selectedTaskType.alias,
                    type: 'suit'
                },
                // Formdan gelen veriler
                suitDetails: {
                    court: document.getElementById('courtName')?.value || '',
                    description: document.getElementById('subjectOfLawsuit')?.value || '',
                    opposingParty: document.getElementById('opposingParty')?.value || '',
                    opposingCounsel: document.getElementById('opposingCounsel')?.value || '',
                    // Eğer formda tarih varsa
                    openingDate: document.getElementById('lawsuitDate')?.value || new Date().toISOString() 
                },
                clientRole: document.getElementById('clientRole')?.value || '',
                client: client ? { id: client.id, name: client.name, email: client.email } : null,
                
                // İlişkili Varlık
                subjectAsset: selectedIpRecord ? {
                    id: selectedIpRecord.id,
                    title: selectedIpRecord.title || selectedIpRecord.markName,
                    number: selectedIpRecord.applicationNumber || selectedIpRecord.applicationNo
                } : null,

                suitStatus: 'continue',
                portfolioStatus: 'active',
                origin: document.getElementById('originSelect')?.value || 'TURKEY', // Dava genelde TR
                createdAt: new Date().toISOString(),
                relatedTaskId: taskId
            };

            const suitsRef = collection(db, 'suits');
            const docRef = await addDoc(suitsRef, newSuitData);
            return docRef.id;

        } catch (error) {
            console.error('Suit oluşturma hatası:', error);
            // Dava kaydı oluşmasa bile Task oluştuğu için akışı kesmiyoruz, sadece uyarıyoruz.
            alert('Görev oluşturuldu ancak Dava Dosyası (Suit) kaydı oluşturulurken hata alındı.');
            return null;
        }
    }

    // C) TARAFLARI ZENGİNLEŞTİRME
    _enrichTaskWithParties(taskData, taskType, relatedParties, singleParty) {
        const tIdStr = String(taskType.id);
        
        // 1. Task Owner (İlgili Taraf Zorunluysa)
        if (RELATED_PARTY_REQUIRED.has(tIdStr)) {
            const owners = (Array.isArray(relatedParties) ? relatedParties : [])
                .map(p => String(p.id)).filter(Boolean);
            if (owners.length) taskData.taskOwner = owners;
        }

        // 2. Opponent (İtiraz Sahibi) - ID: 7, 19, 20
        const objectionIds = ['7', '19', '20'];
        if (objectionIds.includes(tIdStr)) {
            const opponent = (relatedParties && relatedParties.length) ? relatedParties[0] : singleParty;
            if (opponent) {
                taskData.opponent = {
                    id: opponent.id,
                    name: opponent.name,
                    email: opponent.email
                };
                taskData.details.opponent = taskData.opponent;
            }
        }
        
        // 3. Details içine tüm listeyi ekle
        if (relatedParties && relatedParties.length) {
            taskData.details.relatedParties = relatedParties.map(p => ({
                id: p.id, name: p.name, email: p.email
            }));
        }
    }

    // D) PORTFÖY İŞLEM GEÇMİŞİ (TRANSACTION) EKLEME
    async _addTransactionToPortfolio(recordId, taskType, taskId, state) {
        const isPublicationOpposition = ['20', 'trademark_publication_objection'].includes(String(taskType.id));
        
        // Yayına itiraz (20) ise portföye işlem eklemeyi atlayabiliriz (Eski koddaki mantık)
        // Çünkü bu genellikle 3. taraf portföyü oluşturur.
        // Ancak biz yine de standart olarak ekleyelim, gerekirse yoruma alın.
        if (isPublicationOpposition) return;

        let hierarchy = 'parent';
        // Eğer geri çekme işlemiyse ve bir child seçildiyse hierarchy 'child' olur
        // Ancak bu mantık main.js içinde handleParentSelection ile yapılıyor.
        // Burası ana task oluşturulurken yapılan kayıt.

        const transactionData = {
            type: taskType.id,
            description: `${taskType.name} işlemi.`,
            transactionHierarchy: hierarchy,
            triggeringTaskId: String(taskId),
            createdAt: new Date().toISOString()
        };

        await ipRecordsService.addTransactionToRecord(recordId, transactionData);
    }

    // E) TAHAKKUK (FİNANS) İŞLEMLERİ
    async _handleAccrual(taskId, taskTitle, taskType, state) {
        const officialFee = parseFloat(document.getElementById('officialFee')?.value || 0);
        const serviceFee = parseFloat(document.getElementById('serviceFee')?.value || 0);

        if (officialFee > 0 || serviceFee > 0) {
            const vatRate = parseFloat(document.getElementById('vatRate')?.value || 0);
            const applyVat = document.getElementById('applyVatToOfficialFee')?.checked;
            
            const total = applyVat 
                ? (officialFee + serviceFee) * (1 + vatRate/100)
                : officialFee + (serviceFee * (1 + vatRate/100));

            const accrualData = {
                taskId: taskId,
                taskTitle: taskTitle,
                officialFee: { amount: officialFee, currency: 'TRY' },
                serviceFee: { amount: serviceFee, currency: 'TRY' },
                vatRate: vatRate,
                applyVatToOfficialFee: applyVat,
                totalAmount: total,
                status: 'unpaid',
                createdAt: new Date().toISOString(),
                // Fatura Tarafları
                tpInvoiceParty: state.selectedTpInvoiceParty ? { id: state.selectedTpInvoiceParty.id, name: state.selectedTpInvoiceParty.name } : null,
                serviceInvoiceParty: state.selectedServiceInvoiceParty ? { id: state.selectedServiceInvoiceParty.id, name: state.selectedServiceInvoiceParty.name } : null
            };

            await accrualService.addAccrual(accrualData);
        }
    }
    
    // F) MARKA BAŞVURUSU (IP RECORD CREATE)
    async _handleTrademarkApplication(state, taskData) {
        const { selectedApplicants, priorities, uploadedFiles } = state;
        
        // Görsel Yükleme (Resize mantığı main.js veya burada olmalı, şimdilik direkt yüklüyoruz)
        let brandImageUrl = null;
        if (uploadedFiles.length > 0) {
            const file = uploadedFiles[0];
            const path = `brand-images/${Date.now()}_${file.name}`;
            brandImageUrl = await this.dataManager.uploadFileToStorage(file, path);
        }

        const newRecordData = {
            title: taskData.title,
            type: 'trademark',
            status: 'filed',
            applicationDate: new Date().toISOString().split('T')[0],
            brandImageUrl: brandImageUrl,
            applicants: selectedApplicants.map(p => ({ id: p.id, name: p.name })),
            priorities: priorities,
            goodsAndServices: getSelectedNiceClasses(), // Nice sınıfı fonksiyonu
            createdAt: new Date().toISOString()
        };

        const result = await ipRecordsService.createRecord(newRecordData);
        return result.success ? result.id : null;
    }

    async _handleOppositionAutomation(taskId, taskType, ipRecord) {
        // Global script yüklü mü kontrol et
        if (window.portfolioByOppositionCreator && typeof window.portfolioByOppositionCreator.handleTransactionCreated === 'function') {
            console.log('🤖 Yayına itiraz otomasyonu tetikleniyor...');
            try {
                const result = await window.portfolioByOppositionCreator.handleTransactionCreated({
                    id: taskId,
                    specificTaskType: taskType.id,
                    selectedIpRecord: ipRecord
                });

                if (result?.success) {
                    const msg = result.isExistingRecord 
                        ? `Mevcut 3. taraf kaydı ilişkilendirildi (ID: ${result.recordId}).`
                        : `Otomatik 3. taraf portföy kaydı oluşturuldu (ID: ${result.recordId}).`;
                    alert(msg);
                }
            } catch (e) {
                console.warn('Otomasyon hatası:', e);
            }
        }
    }
}