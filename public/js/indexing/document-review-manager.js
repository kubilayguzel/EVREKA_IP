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
            // 1. Arama kutusunu ve listeyi güvenli şekilde temizle
            const searchInput = document.getElementById('manualSearchInput');
            const searchResults = document.getElementById('manualSearchResults');

            if (searchInput) searchInput.value = '';
            if (searchResults) searchResults.style.display = 'none';

            try {
                const result = await ipRecordsService.getRecordById(recordId);
                
                if (result.success) {
                    this.matchedRecord = result.data;
                    // Eğer header render fonksiyonunuz varsa çağırın
                    if (this.renderHeader) this.renderHeader();
                    // Eğer parent transactions yükleme fonksiyonunuz varsa çağırın
                    if (this.loadParentTransactions) await this.loadParentTransactions(recordId);
                    
                    showNotification('Kayıt seçildi: ' + this.matchedRecord.title, 'success');

                    // ✅ ETKİLEŞİM: Diğer yöneticiye (PortfolioManager) haber ver
                    console.log('📤 Event gönderiliyor: record-selected', recordId);
                    document.dispatchEvent(new CustomEvent('record-selected', { 
                        detail: { recordId: recordId } 
                    })); 
                } else {
                    console.error('Kayıt verisi alınamadı');
                }
            } catch (error) {
                console.error('Kayıt seçim hatası:', error);
            }
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
            
            // --- EKLENEN KISIM: Diğer yöneticiyi (PortfolioManager) uyandırmak için event fırlat ---
            selectElement.dispatchEvent(new Event('change'));
            // --------------------------------------------------------------------------------------
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

            // 1. İtiraz Bildirimi Özel Mantığı
            let newParentTxId = null;
            let oppositionFileUrl = null;
            let oppositionFileName = null;

            if (childTypeId === '27') {
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

            // Dosyaları Belge Olarak Ekle (De-duplication için önemli)
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
                const duePeriod = Number(childTypeObj.duePeriod || 0);
                let officialDueDate = addMonthsToDate(deliveryDate, duePeriod);
                officialDueDate = findNextWorkingDay(officialDueDate, TURKEY_HOLIDAYS);
                let taskDueDate = new Date(officialDueDate);
                taskDueDate.setDate(taskDueDate.getDate() - 3);
                while (isWeekend(taskDueDate) || isHoliday(taskDueDate, TURKEY_HOLIDAYS)) {
                    taskDueDate.setDate(taskDueDate.getDate() - 1);
                }

                let assignedUser = { uid: SELCAN_UID, email: SELCAN_EMAIL };
                try {
                    const assigneeData = await resolveApprovalStateAssignee();
                    if (assigneeData.uid) assignedUser = { uid: assigneeData.uid, email: assigneeData.email };
                } catch(e) { console.warn('Assignee error', e); }

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
                    status: 'awaiting_client_approval',
                    priority: 'normal',
                    assignedTo_uid: assignedUser.uid,
                    assignedTo_email: assignedUser.email,
                    createdBy: this.currentUser.uid,
                    createdAt: new Date().toISOString()
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

            // 🔥 6. REQUEST RESULT GÜNCELLEME (Ana İşleme Sonucu Yaz)
            // Bu kısım, indeksleme kararının (childTypeId) ana işleme (parent) yazılmasını sağlar.
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

            // 7. PDF Statüsü
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
    
    async runAnalysis() {
        const loadingEl = document.getElementById('analysisLoading');
        const resultsEl = document.getElementById('analysisResults');
        const pdfViewerEl = document.getElementById('pdfViewer');
        if(loadingEl) loadingEl.style.display = 'block';
        if(resultsEl) resultsEl.style.display = 'none';
        try {
            if (pdfViewerEl) pdfViewerEl.src = this.pdfData.fileUrl;
            const fullText = await this.pdfExtractor.extractTextFromUrl(this.pdfData.fileUrl);
            this.analysisResult = this.analyzer.analyze(fullText);
            this.renderAnalysisResults();
        } catch (error) { console.error(error); } 
        finally {
            if(loadingEl) loadingEl.style.display = 'none';
            if(resultsEl) resultsEl.style.display = 'block';
        }
    }
    renderHeader() {
        document.getElementById('fileNameDisplay').textContent = this.pdfData.fileName;
        const matchInfoEl = document.getElementById('matchInfoDisplay');
        if (this.matchedRecord) {
            matchInfoEl.innerHTML = `<div class="text-success"><strong>${this.matchedRecord.title}</strong> (${this.matchedRecord.applicationNumber})</div>`;
        } else {
            matchInfoEl.innerHTML = `<div class="text-warning">Eşleşme Yok</div>`;
        }
    }
    renderAnalysisResults() {
        const dateInput = document.getElementById('detectedDate');
        const summaryBox = document.getElementById('analysisSummary');
        if (dateInput && this.analysisResult.decisionDate) {
            const parts = this.analysisResult.decisionDate.split('.');
            if(parts.length === 3) dateInput.value = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        if (summaryBox) summaryBox.textContent = `Tip: ${this.analysisResult.detectedType.name}`;
    }
    async handleManualSearch(query) {
        const resultsContainer = document.getElementById('manualSearchResults');
        if (!query || query.length < 3) { resultsContainer.style.display = 'none'; return; }
        const result = await ipRecordsService.searchRecords(query);
        if (result.success) this.renderSearchResults(result.data);
    }
    renderSearchResults(results) {
        const container = document.getElementById('manualSearchResults');
        container.innerHTML = '';
        container.style.display = results.length ? 'block' : 'none';
        if (!results.length) { container.innerHTML = '<div class="p-2">Sonuç yok</div>'; return; }
        container.innerHTML = results.map(r => `
            <div class="search-result-item p-2 border-bottom" style="cursor:pointer" data-id="${r.id}">
                <strong>${r.title}</strong> <small>${r.applicationNumber}</small>
            </div>`).join('');
        container.querySelectorAll('.search-result-item').forEach(el => {
            el.onclick = () => {
                this.selectRecord(el.dataset.id);
                container.style.display = 'none';
            };
        });
    }
}

export async function resolveApprovalStateAssignee() {
  try {
    const ruleRef  = doc(db, 'taskAssignments', 'approval');
    const ruleSnap = await getDoc(ruleRef);
    if (!ruleSnap.exists()) return { uid: null, email: null, reason: 'rule_not_found' };
    const ids = ruleSnap.data()?.approvalStateAssigneeIds;
    const uid = Array.isArray(ids) ? ids.find(v => typeof v === 'string' && v.trim()) : null;
    if (!uid) return { uid: null, email: null, reason: 'empty_list' };
    const userSnap = await getDoc(doc(db, 'users', uid));
    const email = userSnap.exists() ? (userSnap.data().email || null) : null;
    return { uid, email, reason: 'ok' };
  } catch (err) {
    return { uid: null, email: null, reason: 'error' };
  }
}

document.addEventListener('DOMContentLoaded', () => {
    new DocumentReviewManager();
});