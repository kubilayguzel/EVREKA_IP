import { taskService, ipRecordsService, accrualService, db, authService } from '../../firebase-config.js';
import { doc, getDoc, updateDoc, collection, addDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { TASK_IDS, RELATED_PARTY_REQUIRED, asId } from './TaskConstants.js';
// Importu koruyoruz:
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
        
        // State'ten gelen verileri alıyoruz.
        // DİKKAT: main.js üzerinden gelen accrualData ve isFreeTransaction burada alınıyor.
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
            
            // Başlık ve Açıklama
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
            this._enrichTaskWithParties(taskData, selectedTaskType, selectedRelatedParties, selectedRelatedParty);

            // 3. Marka Başvurusu Kaydı
            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const newRecordId = await this._handleTrademarkApplication(state, taskData);
                if (!newRecordId) throw new Error("Marka kaydı oluşturulamadı.");
                taskData.relatedIpRecordId = newRecordId;
            }

            // 4. Otomatik Tarih Hesaplama
            await this._calculateTaskDates(taskData, selectedTaskType, selectedIpRecord);

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

            // 8. TAHAKKUK VE FİNANSAL İŞLEMLER (YENİ MANTIK)
            // Parametreleri main.js'ten gelen state verisiyle besliyoruz
            await this._handleAccrualLogic(taskResult.id, taskData.title, selectedTaskType, state, accrualData, isFreeTransaction);

            // 9. Otomasyon (Yayına İtiraz)
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
     * TAHAKKUK MANTIĞI (GÜNCELLENDİ)
     * 3 Senaryo:
     * 1. Ücretsiz -> Hiçbir şey yapma.
     * 2. Veri Var -> Accrual oluştur.
     * 3. Veri Yok -> Task 53 oluştur.
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
            
            const finalAccrual = {
                taskId: taskId,
                taskTitle: taskTitle,
                officialFee: accrualData.officialFee,
                serviceFee: accrualData.serviceFee,
                vatRate: accrualData.vatRate,
                applyVatToOfficialFee: accrualData.applyVatToOfficialFee,
                totalAmount: accrualData.totalAmount, // Array
                totalAmountCurrency: accrualData.totalAmountCurrency || 'TRY',
                remainingAmount: accrualData.totalAmount,
                status: 'unpaid',
                tpInvoiceParty: accrualData.tpInvoiceParty,
                serviceInvoiceParty: accrualData.serviceInvoiceParty,
                isForeignTransaction: accrualData.isForeignTransaction,
                createdAt: new Date().toISOString(),
                files: accrualData.files || [] 
            };

            await accrualService.addAccrual(finalAccrual);
            return; 
        }

        // SENARYO 3: Ertelenmiş Tahakkuk (Veri Yok/Form Kapalı)
        console.log('⏳ Tahakkuk verisi girilmedi. "Tahakkuk Oluşturma" görevi açılıyor...');

        // 1. Atanacak kişiyi belirle
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

        // 2. Görevi Hazırla
        const accrualTaskData = {
            taskType: "53", // Tahakkuk Oluşturma ID
            title: `Tahakkuk Oluşturma: ${taskTitle}`,
            description: `"${taskTitle}" işi oluşturuldu ancak tahakkuk verisi girilmedi. Lütfen finansal kaydı oluşturun.`,
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

        const result = await taskService.createTask(accrualTaskData);
        if (result?.success) {
            console.log(`✅ "Tahakkuk Oluşturma" görevi açıldı: ${result.id}`);
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
                    if (rawDate.toDate && typeof rawDate.toDate === 'function') {
                        baseDate = rawDate.toDate();
                    } else if (typeof rawDate === 'string') {
                        baseDate = new Date(rawDate);
                    } else if (rawDate instanceof Date) {
                        baseDate = rawDate;
                    }
                }

                if (!baseDate || isNaN(baseDate.getTime())) {
                    baseDate = new Date();
                }

                if (baseDate < new Date()) {
                    baseDate.setFullYear(baseDate.getFullYear() + 10);
                }

                const official = findNextWorkingDay(baseDate, TURKEY_HOLIDAYS);
                const operational = new Date(official);
                operational.setDate(operational.getDate() - 3);
                
                while (isWeekend(operational) || isHoliday(operational, TURKEY_HOLIDAYS)) {
                    operational.setDate(operational.getDate() - 1);
                }

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

            // Yayına İtiraz
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

    // B) TARAFLAR
    _enrichTaskWithParties(taskData, taskType, relatedParties, singleParty) {
        const tIdStr = String(taskType.id);
        if (RELATED_PARTY_REQUIRED.has(tIdStr)) {
            const owners = (Array.isArray(relatedParties) ? relatedParties : []).map(p => String(p.id)).filter(Boolean);
            if (owners.length) taskData.taskOwner = owners;
        }
        const objectionIds = ['7', '19', '20'];
        if (objectionIds.includes(tIdStr)) {
            const opponent = (relatedParties && relatedParties.length) ? relatedParties[0] : singleParty;
            if (opponent) {
                taskData.opponent = { id: opponent.id, name: opponent.name, email: opponent.email };
                taskData.details.opponent = taskData.opponent;
            }
        }
        if (relatedParties && relatedParties.length) {
            taskData.details.relatedParties = relatedParties.map(p => ({ id: p.id, name: p.name, email: p.email }));
        }
    }

    // C) MARKA BAŞVURUSU
    async _handleTrademarkApplication(state, taskData) {
        const { selectedApplicants, priorities, uploadedFiles } = state;
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
            goodsAndServices: getSelectedNiceClasses(), // Import ettiğimiz fonksiyonu kullanıyoruz
            createdAt: new Date().toISOString()
        };
        const result = await ipRecordsService.createRecord(newRecordData);
        return result.success ? result.id : null;
    }

    // D) DAVA KAYDI
    async _handleSuitCreation(state, taskData, taskId) {
        const { selectedTaskType, selectedIpRecord, selectedRelatedParties } = state;
        try {
            const client = selectedRelatedParties && selectedRelatedParties.length > 0 ? selectedRelatedParties[0] : null;
            const newSuitData = {
                title: taskData.title,
                transactionTypeId: selectedTaskType.id,
                transactionType: {
                    id: selectedTaskType.id,
                    name: selectedTaskType.name,
                    alias: selectedTaskType.alias,
                    type: 'suit'
                },
                suitDetails: {
                    court: document.getElementById('courtName')?.value || '',
                    description: document.getElementById('subjectOfLawsuit')?.value || '',
                    opposingParty: document.getElementById('opposingParty')?.value || '',
                    opposingCounsel: document.getElementById('opposingCounsel')?.value || '',
                    openingDate: document.getElementById('lawsuitDate')?.value || new Date().toISOString() 
                },
                clientRole: document.getElementById('clientRole')?.value || '',
                client: client ? { id: client.id, name: client.name, email: client.email } : null,
                subjectAsset: selectedIpRecord ? {
                    id: selectedIpRecord.id,
                    title: selectedIpRecord.title || selectedIpRecord.markName,
                    number: selectedIpRecord.applicationNumber || selectedIpRecord.applicationNo
                } : null,
                suitStatus: 'continue',
                portfolioStatus: 'active',
                origin: document.getElementById('originSelect')?.value || 'TURKEY',
                createdAt: new Date().toISOString(),
                relatedTaskId: taskId
            };
            const suitsRef = collection(db, 'suits');
            await addDoc(suitsRef, newSuitData);
        } catch (error) { console.error('Suit hatası:', error); }
    }

    // E) PORTFOLYO GEÇMİŞİ
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
            createdAt: Timestamp.now(),
            ...extraData
        };
        
        await ipRecordsService.addTransactionToRecord(recordId, transactionData);
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