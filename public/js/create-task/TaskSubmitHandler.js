import { taskService, ipRecordsService, accrualService, db, authService } from '../../firebase-config.js';
import { doc, getDoc, updateDoc, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { TASK_IDS, RELATED_PARTY_REQUIRED, asId } from './TaskConstants.js';
import { getSelectedNiceClasses } from '../nice-classification.js';

export class TaskSubmitHandler {
    constructor(dataManager, uiManager) {
        this.dataManager = dataManager;
        this.uiManager = uiManager;
        
        // Geri çekme işlemi için seçilen parent ID'si (main.js tarafından set edilir)
        this.selectedParentTransactionId = null;
    }

    // --- ANA GÖNDERİM FONKSİYONU ---
    async handleFormSubmit(e, state) {
        e.preventDefault();
        const { 
            selectedTaskType, selectedIpRecord, selectedRelatedParties, selectedRelatedParty,
            selectedApplicants, priorities, selectedCountries, uploadedFiles,
            selectedTpInvoiceParty, selectedServiceInvoiceParty,
            isWithdrawalTask // main.js state'inden gelir
        } = state;

        if (!selectedTaskType) {
            alert('Geçerli bir işlem tipi seçmediniz.');
            return;
        }

        // Geri Çekme İşlemi Kontrolü
        if (isWithdrawalTask && !this.selectedParentTransactionId) {
            alert('Geri çekilecek işlem (itiraz) seçilmedi. Lütfen ilgili portföyü tekrar seçerek işlemi belirleyin.');
            return;
        }

        const submitBtn = document.getElementById('saveTaskBtn');
        if(submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'İşleniyor...';
        }

        try {
            // 1. Task Verisini Hazırla
            const taskData = await this._prepareTaskData(state);
            
            // 2. Dava veya IP Kaydı Oluşturma (Gerekirse)
            let newRecordResult = null;
            let newSuitRecordId = null;

            // A) Dava İşi (Suit)
            const isLawsuit = selectedTaskType.id === '49' || selectedTaskType.ipType === 'suit';
            if (isLawsuit) {
                newSuitRecordId = await this._createSuitRecord(state, taskData);
                if (!newSuitRecordId) throw new Error('Dava kaydı oluşturulamadı.');
                taskData.relatedSuitId = newSuitRecordId;
            } 
            // B) Marka Başvurusu (Yeni IP Kaydı)
            else if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                newRecordResult = await this._createTrademarkApplicationRecord(state, taskData);
                if (!newRecordResult?.success) throw new Error(newRecordResult?.error || 'IP kaydı oluşturulamadı.');
                
                taskData.relatedIpRecordId = newRecordResult.id;
                taskData.relatedIpRecordTitle = taskData.title;
            }
            
            // 3. Task'ı Oluştur
            const taskResult = await taskService.createTask(taskData);
            if (!taskResult.success) throw new Error(taskResult.error);

            const taskId = taskResult.id;

            // 4. Tahakkuk (Accrual) Oluştur
            await this._createAccrual(state, taskId, taskData.title);

            // 5. Yan Etkiler (Transactions, WIPO/ARIPO, Opposition, Withdrawal)
            
            // A) WIPO/ARIPO Alt Kayıtları ve İşlemleri
            if (this._isWipoAripoOrigin(state)) {
                await this._handleWipoAripoTransactions(state, taskId, selectedTaskType, newRecordResult);
            } 
            // B) Normal İşlem
            else if (!isLawsuit) {
                // 1. Geri Çekme İşlemi (Child Transaction) [EKSİK OLAN KISIM BURASIYDI]
                if (isWithdrawalTask) {
                     await this._addChildTransactionForWithdrawal(state, taskId, selectedTaskType);
                }
                // 2. Yayına itiraz değilse (Parent Transaction)
                else if (!this._isPublicationOpposition(selectedTaskType.id)) {
                     await this._addParentTransaction(state, taskId);
                }
            }

            // C) Yayına İtiraz Otomasyonu (3. Taraf Portföy)
            if (window.portfolioByOppositionCreator && this._isPublicationOpposition(selectedTaskType.id)) {
                await this._handleOppositionAutomation(taskId, selectedTaskType, selectedIpRecord);
            } else {
                const msg = newSuitRecordId ? `\n✅ Dava kaydı da oluşturuldu (ID: ${newSuitRecordId})` : '';
                alert('İş başarıyla oluşturuldu!' + msg);
            }

            // Yönlendir
            window.location.href = 'task-management.html';

        } catch (error) {
            console.error('Submit Error:', error);
            alert('Hata: ' + error.message);
            if(submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'İşi Oluştur ve Kaydet';
            }
        }
    }

    // --- YARDIMCI İŞLEMLER ---

    async _prepareTaskData(state) {
        const { selectedTaskType, selectedIpRecord, allUsers, selectedRelatedParties, selectedRelatedParty } = state;
        
        const assignedToUser = allUsers.find(u => u.id === document.getElementById('assignedTo')?.value);
        let taskTitle, taskDescription;

        if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
            const brandText = document.getElementById('brandExampleText')?.value || '';
            taskTitle = brandText || selectedTaskType.alias;
            taskDescription = document.getElementById('taskDescription')?.value || `'${brandText}' adlı marka için başvuru işlemi.`;
        } else {
            taskTitle = document.getElementById('taskTitle')?.value || selectedTaskType.alias;
            taskDescription = document.getElementById('taskDescription')?.value || `${selectedTaskType.alias} işlemi.`;
        }

        const taskData = {
            taskType: selectedTaskType.id,
            title: taskTitle,
            description: taskDescription,
            priority: document.getElementById('taskPriority')?.value || 'medium',
            assignedTo_uid: assignedToUser ? assignedToUser.id : null,
            assignedTo_email: assignedToUser ? assignedToUser.email : null,
            dueDate: document.getElementById('taskDueDate')?.value || null,
            status: 'open',
            relatedIpRecordId: selectedIpRecord ? selectedIpRecord.id : null,
            relatedIpRecordTitle: selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.brandText) : taskTitle,
            details: {}
        };

        const tIdStr = asId(selectedTaskType.id);
        if (RELATED_PARTY_REQUIRED.has(tIdStr)) {
            const owners = (Array.isArray(selectedRelatedParties) && selectedRelatedParties.length > 0) 
                           ? selectedRelatedParties 
                           : (selectedRelatedParty ? [selectedRelatedParty] : []);
                           
            taskData.taskOwner = owners.map(p => String(p.id));
            
            taskData.details.relatedParties = owners.map(p => ({
                id: p.id, name: p.name, email: p.email, phone: p.phone
            }));
            if (owners.length > 0) {
                taskData.details.relatedParty = taskData.details.relatedParties[0];
            }
        }

        const objectionIds = new Set([TASK_IDS.KARARA_ITIRAZ, TASK_IDS.YAYIMA_ITIRAZIN_YENIDEN_INCELENMESI, TASK_IDS.ITIRAZ_YAYIN]);
        if (objectionIds.has(tIdStr) && taskData.details.relatedParty) {
            taskData.opponent = taskData.details.relatedParty;
            taskData.details.opponent = taskData.details.relatedParty;
            taskData.details.objectionOwners = taskData.details.relatedParties;
        }

        return taskData;
    }

    async _createSuitRecord(state, taskData) {
        const { selectedTaskType, selectedRelatedParties, selectedIpRecord } = state;
        const clientPerson = (selectedRelatedParties && selectedRelatedParties.length > 0) ? selectedRelatedParties[0] : null;
        
        const newSuitData = {
            client: clientPerson ? { id: clientPerson.id, name: clientPerson.name, email: clientPerson.email } : null,
            clientRole: document.getElementById('clientRole')?.value || '',
            transactionType: { id: selectedTaskType.id, name: selectedTaskType.name, alias: selectedTaskType.alias, type: 'suit' },
            transactionTypeId: selectedTaskType.id,
            alias: selectedTaskType.alias,
            suitDetails: {
                caseNo: document.getElementById('caseNo')?.value || '',
                court: document.getElementById('courtName')?.value || '',
                description: document.getElementById('subjectOfLawsuit')?.value || taskData.description || '',
                openingDate: document.getElementById('lawsuitDate')?.value || null,
                opposingParty: document.getElementById('opposingParty')?.value || '',
                opposingCounsel: document.getElementById('opposingCounsel')?.value || ''
            },
            subjectAsset: selectedIpRecord ? {
                id: selectedIpRecord.id,
                title: selectedIpRecord.title || selectedIpRecord.brandText,
                number: selectedIpRecord.applicationNumber,
                type: selectedIpRecord.type
            } : null,
            suitStatus: 'continue',
            title: taskData.title,
            portfolioStatus: 'active',
            recordOwnerType: 'self',
            origin: document.getElementById('originSelect')?.value || 'TURKIYE_NATIONAL',
            country: document.getElementById('countrySelect')?.value || 'TR',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const suitsRef = collection(db, 'suits');
        const docRef = await addDoc(suitsRef, newSuitData);
        return docRef.id;
    }

    async _createTrademarkApplicationRecord(state, taskData) {
        const { selectedTaskType, selectedApplicants, priorities, uploadedFiles, selectedCountries } = state;
        
        let brandImageUrl = null;
        if (uploadedFiles && uploadedFiles.length > 0) {
            const path = `brand-examples/${Date.now()}_${uploadedFiles[0].name}`;
            brandImageUrl = await this.dataManager.uploadFileToStorage(uploadedFiles[0], path);
        }

        const goodsRaw = getSelectedNiceClasses();
        const origin = document.getElementById('originSelect')?.value || 'TÜRKPATENT';
        
        const newIpRecordData = {
            title: taskData.title,
            type: selectedTaskType.ipType,
            portfoyStatus: 'active',
            status: 'filed',
            recordOwnerType: 'self',
            origin: origin,
            country: (origin === 'Yurtdışı Ulusal') ? document.getElementById('countrySelect')?.value : null,
            countries: (['WIPO', 'ARIPO'].includes(origin)) ? selectedCountries.map(c => c.code) : [],
            transactionHierarchy: (['WIPO', 'ARIPO'].includes(origin)) ? 'parent' : null,
            wipoIR: origin === 'WIPO' ? this._generateTemporaryIR() : null,
            aripoIR: origin === 'ARIPO' ? this._generateTemporaryIR() : null,
            applicationDate: new Date().toISOString().split('T')[0],
            brandText: document.getElementById('brandExampleText')?.value || null,
            brandImageUrl: brandImageUrl,
            applicants: selectedApplicants.map(p => ({ id: p.id, name: p.name, email: p.email })),
            priorities: priorities,
            brandType: document.getElementById('brandType')?.value,
            brandCategory: document.getElementById('brandCategory')?.value,
            nonLatinAlphabet: document.getElementById('nonLatinAlphabet')?.value,
            coverLetterRequest: document.querySelector('input[name="coverLetterRequest"]:checked')?.value,
            consentRequest: document.querySelector('input[name="consentRequest"]:checked')?.value,
            goodsAndServicesByClass: [], // Basitleştirildi
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        return await ipRecordsService.createRecord(newIpRecordData);
    }

    async _createAccrual(state, taskId, taskTitle) {
        const { selectedTpInvoiceParty, selectedServiceInvoiceParty } = state;
        const officialFee = parseFloat(document.getElementById('officialFee')?.value) || 0;
        const serviceFee = parseFloat(document.getElementById('serviceFee')?.value) || 0;

        if (officialFee > 0 || serviceFee > 0) {
            const vatRate = parseFloat(document.getElementById('vatRate')?.value) || 0;
            const applyVat = document.getElementById('applyVatToOfficialFee')?.checked;
            let total = applyVat ? (officialFee + serviceFee) * (1 + vatRate/100) : officialFee + (serviceFee * (1 + vatRate/100));

            const accrualData = {
                taskId,
                taskTitle,
                officialFee: { amount: officialFee, currency: 'TRY' },
                serviceFee: { amount: serviceFee, currency: 'TRY' },
                vatRate,
                applyVatToOfficialFee: applyVat,
                totalAmount: total,
                totalAmountCurrency: 'TRY',
                tpInvoiceParty: selectedTpInvoiceParty ? { id: selectedTpInvoiceParty.id, name: selectedTpInvoiceParty.name } : null,
                serviceInvoiceParty: selectedServiceInvoiceParty ? { id: selectedServiceInvoiceParty.id, name: selectedServiceInvoiceParty.name } : null,
                status: 'unpaid',
                createdAt: new Date().toISOString()
            };

            await accrualService.addAccrual(accrualData);
        }
    }

    async _handleWipoAripoTransactions(state, taskId, selectedTaskType, newRecordResult) {
        const { selectedCountries, selectedIpRecord } = state;
        const parentRecord = selectedIpRecord || { id: newRecordResult.id, ...newRecordResult.data };
        
        await ipRecordsService.addTransactionToRecord(parentRecord.id, {
            type: selectedTaskType.id,
            description: `${selectedTaskType.name} işlemi.`,
            transactionHierarchy: 'parent',
            triggeringTaskId: String(taskId)
        });

        // Child logic... (Özetlendi)
        let childrenToProcess = state.selectedWipoAripoChildren; 
        for (const child of childrenToProcess) {
            await ipRecordsService.addTransactionToRecord(child.id, {
                type: selectedTaskType.id,
                description: `${selectedTaskType.name} işlemi.`,
                transactionHierarchy: 'child',
                triggeringTaskId: String(taskId)
            });
        }
    }
    
    // [DÜZELTİLEN METOD]: Geri Çekme için Child Transaction Oluşturma
    async _addChildTransactionForWithdrawal(state, taskId, selectedTaskType) {
        const { selectedIpRecord } = state;
        if (!selectedIpRecord || !this.selectedParentTransactionId) return;

        const childTransactionData = {
            type: selectedTaskType.id,
            description: 'İtiraz geri çekme işlemi',
            transactionHierarchy: 'child',
            triggeringTaskId: String(taskId),
            parentId: this.selectedParentTransactionId // Parent ID ile bağla
        };

        const result = await ipRecordsService.addTransactionToRecord(selectedIpRecord.id, childTransactionData);
        if (!result.success) {
            throw new Error('Geri çekme işlemi kaydedilemedi: ' + result.error);
        }
        console.log('✅ Geri çekme işlemi (child transaction) oluşturuldu.');
    }

    async _addParentTransaction(state, taskId) {
        const { selectedIpRecord, selectedTaskType } = state;
        if (!selectedIpRecord) return;

        const data = {
            type: selectedTaskType.id,
            description: `${selectedTaskType.name} işlemi.`,
            transactionHierarchy: "parent",
            triggeringTaskId: String(taskId)
        };
        
        await ipRecordsService.addTransactionToRecord(selectedIpRecord.id, data);
    }

    async _handleOppositionAutomation(taskId, taskType, ipRecord) {
        try {
            const result = await window.portfolioByOppositionCreator.handleTransactionCreated({
                id: taskId,
                specificTaskType: taskType.id,
                selectedIpRecord: ipRecord
            });
            if (result.success && result.recordId) {
                 alert('İş ve 3. taraf portföy kaydı başarıyla oluşturuldu.');
            }
        } catch (e) { console.error('Opposition automation error:', e); }
    }

    // --- Helpers ---
    _isWipoAripoOrigin(state) {
        const o = document.getElementById('originSelect')?.value;
        const recO = state.selectedIpRecord?.origin;
        return ['WIPO', 'ARIPO'].includes(o || recO);
    }
    
    _isPublicationOpposition(typeId) {
        return ['20', 'trademark_publication_objection'].includes(String(typeId));
    }

    _generateTemporaryIR() {
        return `Geçici - ${Math.floor(Math.random() * 999999) + 100000}`;
    }
}