// public/js/indexing/document-review-manager.js

import { 
    authService, 
    ipRecordsService, 
    transactionTypeService, 
    taskService,
    firebaseServices,
    db 
} from '../../firebase-config.js';

import { 
    doc, getDoc, updateDoc, collection, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { 
    ref, uploadBytes, getDownloadURL 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

import { 
    showNotification, 
    debounce, 
    addMonthsToDate, 
    findNextWorkingDay, 
    isWeekend, 
    isHoliday, 
    TURKEY_HOLIDAYS,
    generateUUID 
} from '../../utils.js';

// Servisler
import { PdfExtractor } from './pdf-extractor.js';
import { PdfAnalyzer } from './pdf-analyzer.js';

const UNINDEXED_PDFS_COLLECTION = 'unindexed_pdfs';
// 🔥 SABİT ATAMA: Selcan Hanım
const SELCAN_UID = 'Mkmq2sc0T6XTIg1weZyp5AGZ0YG3'; 
const SELCAN_EMAIL = 'selcanakoglu@evrekapatent.com';

export class DocumentReviewManager {
    constructor() {
        this.pdfId = new URLSearchParams(window.location.search).get('pdfId');
        this.currentUser = null;
        this.pdfData = null;
        this.matchedRecord = null;
        this.analysisResult = null;
        this.currentTransactions = []; 
        this.allTransactionTypes = []; 
        this.pdfExtractor = new PdfExtractor();
        this.analyzer = new PdfAnalyzer();
        this.init();
    }

    async init() {
        if (!this.pdfId) return;
        this.currentUser = authService.getCurrentUser();
        this.setupEventListeners();
        await this.loadTransactionTypes();
        await this.loadData();
    }

    async loadTransactionTypes() {
        try {
            const result = await transactionTypeService.getTransactionTypes();
            if (result.success) this.allTransactionTypes = result.data;
        } catch (error) { console.error('İşlem tipleri yüklenemedi:', error); }
    }

    setupEventListeners() {
        const saveBtn = document.getElementById('saveTransactionBtn');
        if (saveBtn) {
            const newSaveBtn = saveBtn.cloneNode(true);
            saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
            newSaveBtn.addEventListener('click', (e) => { e.preventDefault(); this.handleSave(); });
        }
        const searchInput = document.getElementById('manualSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', debounce((e) => this.handleManualSearch(e.target.value), 300));
            document.addEventListener('click', (e) => {
                const searchResults = document.getElementById('manualSearchResults');
                if (searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                    searchResults.style.display = 'none';
                }
            });
        }
        const parentSelect = document.getElementById('parentTransactionSelect');
        if (parentSelect) parentSelect.addEventListener('change', () => this.updateChildTransactionOptions());
        const childSelect = document.getElementById('detectedType');
        if (childSelect) childSelect.addEventListener('change', () => this.checkSpecialFields());
    }

    async loadData() {
        try {
            const docRef = doc(db, UNINDEXED_PDFS_COLLECTION, this.pdfId);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) throw new Error('PDF kaydı bulunamadı.');
            this.pdfData = { id: docSnap.id, ...docSnap.data() };
            if (this.pdfData.matchedRecordId) await this.selectRecord(this.pdfData.matchedRecordId);
            else this.renderHeader();
            this.renderHeader();
            await this.runAnalysis();
        } catch (error) {
            console.error('Veri yükleme hatası:', error);
            showNotification('Veri yükleme hatası: ' + error.message, 'error');
        }
    }

    async selectRecord(recordId) {
        try {
            const result = await ipRecordsService.getRecordById(recordId);
            if (result.success) {
                this.matchedRecord = result.data;
                this.renderHeader();
                await this.loadParentTransactions(recordId);
                showNotification('Kayıt seçildi: ' + this.matchedRecord.title, 'success');

                // Diğer yöneticiye (PortfolioManager) haber ver
                console.log('📤 Event gönderiliyor: record-selected', recordId);
                document.dispatchEvent(new CustomEvent('record-selected', { 
                    detail: { recordId: recordId } 
                }));
            }
        } catch (error) { console.error('Kayıt seçim hatası:', error); }
    }

    async loadParentTransactions(recordId) {
        const parentSelect = document.getElementById('parentTransactionSelect');
        if (!parentSelect) return;
        parentSelect.innerHTML = '<option value="">Yükleniyor...</option>';
        try {
            const transactionsResult = await ipRecordsService.getRecordTransactions(recordId);
            this.currentTransactions = transactionsResult.success ? transactionsResult.data : [];
            parentSelect.innerHTML = '<option value="">-- Ana İşlem Seçiniz --</option>';
            const parentTransactions = this.currentTransactions
                .filter(t => t.transactionHierarchy === 'parent' || !t.transactionHierarchy)
                .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            parentTransactions.forEach(t => {
                const typeObj = this.allTransactionTypes.find(type => type.id === t.type);
                const label = typeObj ? (typeObj.alias || typeObj.name) : (t.description || 'Bilinmeyen İşlem');
                const dateStr = (t.timestamp) ? new Date(t.timestamp).toLocaleDateString('tr-TR') : '-';
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${label} (${dateStr})`;
                parentSelect.appendChild(opt);
            });
        } catch (error) {
            console.error('Transaction yükleme hatası:', error);
            parentSelect.innerHTML = '<option value="">Hata oluştu</option>';
        }
    }

    updateChildTransactionOptions() {
        const parentSelect = document.getElementById('parentTransactionSelect');
        const childSelect = document.getElementById('detectedType');
        const selectedParentTxId = parentSelect.value;
        childSelect.innerHTML = '<option value="">-- İşlem Türü Seçiniz --</option>';
        childSelect.disabled = true;
        if (!selectedParentTxId) return;
        const selectedParentTx = this.currentTransactions.find(t => t.id === selectedParentTxId);
        const parentTypeId = selectedParentTx?.type;
        const parentTypeObj = this.allTransactionTypes.find(t => t.id === parentTypeId);
        if (!parentTypeObj || !parentTypeObj.indexFile) {
            console.warn('Bu ana işlem için tanımlı alt işlem (indexFile) bulunamadı.');
            return;
        }
        const allowedChildIds = Array.isArray(parentTypeObj.indexFile) ? parentTypeObj.indexFile : [];
        const allowedChildTypes = this.allTransactionTypes
            .filter(t => allowedChildIds.includes(t.id))
            .sort((a, b) => (a.order || 999) - (b.order || 999));
        allowedChildTypes.forEach(type => {
            const opt = document.createElement('option');
            opt.value = type.id;
            opt.textContent = type.alias || type.name;
            childSelect.appendChild(opt);
        });
        childSelect.disabled = false;
        if (this.analysisResult && this.analysisResult.detectedType) this.autoSelectChildType(childSelect);
    }

    autoSelectChildType(selectElement) {
        const detectedName = this.analysisResult.detectedType.name.toLowerCase();
        const options = Array.from(selectElement.options);
        const matchedOption = options.find(opt => opt.text.toLowerCase().includes(detectedName));
        if (matchedOption) { 
            matchedOption.selected = true; 
            this.checkSpecialFields();
            // Otomatik seçimde diğer modülü (Portfolio) tetikle
            selectElement.dispatchEvent(new Event('change'));
        }
    }

    checkSpecialFields() {
        const childTypeId = document.getElementById('detectedType').value;
        const oppositionSection = document.getElementById('oppositionSection');
        if (childTypeId === '27') oppositionSection.style.display = 'block';
        else oppositionSection.style.display = 'none';
    }

    async handleSave() {
        if (!this.matchedRecord) { alert('Lütfen önce bir kayıt ile eşleştirin.'); return; }
        const parentTxId = document.getElementById('parentTransactionSelect').value;
        const childTypeId = document.getElementById('detectedType').value;
        const deliveryDateStr = document.getElementById('detectedDate').value;
        const notes = document.getElementById('transactionNotes').value;

        if (!parentTxId || !childTypeId || !deliveryDateStr) {
            showNotification('Lütfen tüm zorunlu alanları doldurun.', 'error');
            return;
        }

        const saveBtn = document.getElementById('saveTransactionBtn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> İşleniyor...';

        try {
            const childTypeObj = this.allTransactionTypes.find(t => t.id === childTypeId);
            const parentTx = this.currentTransactions.find(t => t.id === parentTxId);
            const parentTypeObj = this.allTransactionTypes.find(t => t.id === parentTx?.type);

            // 1. İtiraz Bildirimi Özel Mantığı (Yeni Parent Oluşturma)
            let newParentTxId = null;
            let oppositionFileUrl = null;
            let oppositionFileName = null;

            if (childTypeId === '27') { // Yayına İtiraz
                const ownerInput = document.getElementById('oppositionOwnerInput').value;
                const fileInput = document.getElementById('oppositionPetitionFile').files[0];
                if (!ownerInput || !fileInput) throw new Error('İtiraz Sahibi ve PDF zorunludur.');

                const storageRef = ref(firebaseServices.storage, `opposition-petitions/${this.matchedRecord.id}/${Date.now()}_${fileInput.name}`);
                await uploadBytes(storageRef, fileInput);
                oppositionFileUrl = await getDownloadURL(storageRef);
                oppositionFileName = fileInput.name;

                let newParentTypeId = '20'; 
                let newParentDesc = 'Yayına İtiraz (Otomatik)';
                const parentAlias = parentTypeObj?.alias || parentTypeObj?.name || '';
                if (parentAlias.includes('İtiraz') || parentTypeObj?.id === '20') {
                    newParentTypeId = '19'; 
                    newParentDesc = 'Yayına İtirazın Yeniden İncelenmesi (Otomatik)';
                }

                const newParentData = {
                    type: newParentTypeId,
                    description: newParentDesc,
                    transactionHierarchy: 'parent',
                    oppositionOwner: ownerInput,
                    oppositionPetitionFileUrl: oppositionFileUrl,
                    timestamp: new Date().toISOString()
                };
                const newParentResult = await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, newParentData);
                if (newParentResult.success) newParentTxId = newParentResult.id;
            }

            const finalParentId = newParentTxId || parentTxId;

            // 2. Child Transaction Oluştur
            const transactionData = {
                type: childTypeId,
                transactionHierarchy: 'child',
                parentId: finalParentId,
                description: childTypeObj.alias || childTypeObj.name,
                date: deliveryDateStr ? new Date(deliveryDateStr).toISOString() : new Date().toISOString(),
            };

            const txResult = await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, transactionData);
            const childTransactionId = txResult.id;

            // Dosyaları Belge Olarak Ekle
            if (this.pdfData.fileUrl && txResult.success) {
                const mainDocPayload = {
                    id: generateUUID(),
                    name: this.pdfData.fileName || 'Resmi Yazı.pdf',
                    downloadURL: this.pdfData.fileUrl,
                    type: 'application/pdf',
                    documentDesignation: 'Resmi Yazı',
                    uploadedAt: new Date().toISOString()
                };
                const txRef = doc(collection(db, 'ipRecords', this.matchedRecord.id, 'transactions'), childTransactionId);
                await updateDoc(txRef, { documents: arrayUnion(mainDocPayload) });
            }

            if (childTypeId === '27' && oppositionFileUrl && txResult.success) {
                const oppDocPayload = {
                    id: generateUUID(),
                    name: oppositionFileName || 'opposition_petition.pdf',
                    downloadURL: oppositionFileUrl,
                    type: 'application/pdf',
                    documentDesignation: 'İtiraz Dilekçesi',
                    uploadedAt: new Date().toISOString()
                };
                const txRef = doc(collection(db, 'ipRecords', this.matchedRecord.id, 'transactions'), childTransactionId);
                await updateDoc(txRef, { documents: arrayUnion(oppDocPayload) });
            }

            // 3. İş Tetikleme (Task)
            let createdTaskId = null;
            let shouldTriggerTask = false;
            const recordType = (this.matchedRecord.recordOwnerType === 'self') ? 'Portföy' : '3. Taraf';
            const parentTypeId = parentTx.type;
            
            // Task Matrix Kontrolü
            const taskTriggerMatrix = {
                "20": { "Portföy": ["50", "51"], "3. Taraf": ["51", "52"] },
                "19": { "Portföy": ["32", "33", "34", "35"], "3. Taraf": ["31", "32", "35", "36"] }
            };

            if (taskTriggerMatrix[parentTypeId] && taskTriggerMatrix[parentTypeId][recordType]) {
                if (taskTriggerMatrix[parentTypeId][recordType].includes(childTypeId)) shouldTriggerTask = true;
            } else {
                if (childTypeObj.taskTriggered) shouldTriggerTask = true;
            }

            if (shouldTriggerTask && childTypeObj.taskTriggered) {
                const deliveryDate = new Date(deliveryDateStr);
                
                // Süre Hesaplama - Hardcoded kısım kaldırıldı, veritabanından gelen duePeriod kullanılır
                let duePeriod = Number(childTypeObj.duePeriod || 0);
                
                let officialDueDate = addMonthsToDate(deliveryDate, duePeriod);
                officialDueDate = findNextWorkingDay(officialDueDate, TURKEY_HOLIDAYS);
                let taskDueDate = new Date(officialDueDate);
                taskDueDate.setDate(taskDueDate.getDate() - 3);
                while (isWeekend(taskDueDate) || isHoliday(taskDueDate, TURKEY_HOLIDAYS)) {
                    taskDueDate.setDate(taskDueDate.getDate() - 1);
                }

                // 🔥 KESİN ÇÖZÜM: Atanan Kişiyi Sabitle
                // Veritabanı kuralı sorgusu (resolveApprovalStateAssignee) iptal edildi.
                // Artık her zaman Selcan Hanım atanacak.
                let assignedUser = { uid: SELCAN_UID, email: SELCAN_EMAIL };
                
                console.log(`✅ Tetiklenen iş doğrudan Selcan'a atanıyor (${SELCAN_EMAIL})`);

                // 🔥 İLGİLİ TARAF VE TASK OWNER MANTIĞI
                let relatedPartyData = null;
                let taskOwner = []; // Array olarak başlat

                console.log('🔍 İlgili Taraf Analizi:', {
                    ownerType: this.matchedRecord.recordOwnerType,
                    applicants: this.matchedRecord.applicants,
                    parentTxId: parentTxId,
                    triggeringTaskId: parentTx?.triggeringTaskId
                });

                // KURAL 1: Kayıt tipi 'self' ise -> applicants listesi
                if (this.matchedRecord.recordOwnerType === 'self') {
                    if (Array.isArray(this.matchedRecord.applicants) && this.matchedRecord.applicants.length > 0) {
                        // 1. taskOwner için tüm ID'leri al
                        taskOwner = this.matchedRecord.applicants
                            .map(app => app.id)
                            .filter(id => id); // Boş olanları temizle

                        // 2. relatedParty (Detaylarda görünen tekil kişi) için ilkini al
                        const app = this.matchedRecord.applicants[0];
                        if (app && app.id) {
                            relatedPartyData = { id: app.id, name: app.name || 'İsimsiz' };
                            console.log('✅ Self kayıt için ilgili taraf ayarlandı:', relatedPartyData);
                        }
                    }
                } 
                // KURAL 2: Kayıt tipi 'third_party' ise -> Parent Task'tan kopyala
                else if (this.matchedRecord.recordOwnerType === 'third_party') {
                    const triggeringTaskId = parentTx?.triggeringTaskId;
                    
                    if (triggeringTaskId) {
                        try {
                            const prevTaskResult = await taskService.getTaskById(triggeringTaskId);
                            if (prevTaskResult.success && prevTaskResult.data) {
                                const prevTask = prevTaskResult.data;
                                
                                // 1. Task Owner'ı Kopyala (Array olmalı)
                                if (prevTask.taskOwner) {
                                    taskOwner = Array.isArray(prevTask.taskOwner) ? prevTask.taskOwner : [prevTask.taskOwner];
                                    console.log('✅ Parent görevden taskOwner kopyalandı:', taskOwner);
                                } else {
                                    console.warn('⚠️ Parent görevde taskOwner bulunamadı.');
                                }

                                // 2. Related Party'yi Kopyala
                                if (prevTask.details && prevTask.details.relatedParty) {
                                    relatedPartyData = prevTask.details.relatedParty;
                                    console.log('✅ Parent görevden relatedParty kopyalandı:', relatedPartyData);
                                }
                            }
                        } catch (e) {
                            console.warn('❌ Parent task fetch error:', e);
                        }
                    } else {
                        console.warn('⚠️ Parent işlemde triggeringTaskId yok.');
                    }
                }

                const taskData = {
                    title: `${childTypeObj.alias || childTypeObj.name} - ${this.matchedRecord.title}`,
                    description: notes || `Otomatik oluşturulan görev.`,
                    taskType: childTypeObj.taskTriggered,
                    relatedRecordId: this.matchedRecord.id,
                    relatedIpRecordId: this.matchedRecord.id,
                    relatedIpRecordTitle: this.matchedRecord.title,
                    transactionId: childTransactionId, 
                    triggeringTransactionType: childTypeId,
                    deliveryDate: deliveryDateStr,
                    dueDate: taskDueDate.toISOString(),
                    officialDueDate: officialDueDate.toISOString(),
                    status: 'awaiting_client_approval', // Müvekkil Onayı Bekliyor
                    priority: 'normal',
                    assignedTo_uid: assignedUser.uid,
                    assignedTo_email: assignedUser.email,
                    createdBy: this.currentUser.uid,
                    createdAt: new Date().toISOString(),
                    
                    // 🔥 Düzeltilmiş Alanlar
                    taskOwner: taskOwner.length > 0 ? taskOwner : null, // Array olarak gönder
                    details: {
                        relatedParty: relatedPartyData // Obje olarak gönder {id, name}
                    }
                };

                const taskResult = await taskService.createTask(taskData);
                if (taskResult.success) {
                    createdTaskId = taskResult.id;
                    const txRef = doc(collection(db, 'ipRecords', this.matchedRecord.id, 'transactions'), childTransactionId);
                    await updateDoc(txRef, { triggeringTaskId: createdTaskId });
                }
            }

            // Tetiklenen işin hiyerarşisini dinamik belirleme
            if (createdTaskId && childTypeObj.taskTriggered) {
                const triggeredTypeObj = this.allTransactionTypes.find(t => t.id === childTypeObj.taskTriggered);
                const triggeredTypeName = triggeredTypeObj ? (triggeredTypeObj.alias || triggeredTypeObj.name) : 'Otomatik İşlem';
                const targetHierarchy = triggeredTypeObj?.hierarchy || 'child'; 

                const triggeredTransactionData = {
                    type: childTypeObj.taskTriggered,
                    description: `${triggeredTypeName} (Otomatik)`,
                    transactionHierarchy: targetHierarchy,
                    triggeringTaskId: String(createdTaskId),
                    timestamp: new Date().toISOString()
                };

                if (targetHierarchy === 'child') {
                    triggeredTransactionData.parentId = finalParentId;
                }

                await ipRecordsService.addTransactionToRecord(this.matchedRecord.id, triggeredTransactionData);
            }

            // REQUEST RESULT GÜNCELLEME
            if (finalParentId && childTypeId) {
                try {
                    const parentTxRef = doc(db, 'ipRecords', this.matchedRecord.id, 'transactions', finalParentId);
                    await updateDoc(parentTxRef, { 
                        requestResult: childTypeId, 
                        requestResultUpdatedAt: new Date().toISOString() 
                    });
                    console.log('✅ Parent requestResult güncellendi:', finalParentId, childTypeId);
                } catch (err) {
                    console.error('requestResult güncellenemedi:', err);
                }
            }

            // PDF Statüsü
            await updateDoc(doc(db, UNINDEXED_PDFS_COLLECTION, this.pdfId), {
                status: 'indexed',
                indexedAt: new Date(),
                finalTransactionId: childTransactionId,
                matchedRecordId: this.matchedRecord.id
            });

            showNotification('İşlem başarıyla tamamlandı!', 'success');
            setTimeout(() => window.location.href = 'bulk-indexing-page.html', 1500);

        } catch (error) {
            console.error('Kaydetme hatası:', error);
            showNotification('Hata: ' + error.message, 'error');
            saveBtn.disabled = false;
        }
    }
}

export async function resolveApprovalStateAssignee() {
    // Bu fonksiyon artık kullanılmıyor ama referans hatası olmaması için boş bırakıldı.
    return { uid: null, email: null };
}

document.addEventListener('DOMContentLoaded', () => {
    new DocumentReviewManager();
});