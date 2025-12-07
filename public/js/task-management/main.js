// public/js/task-management/main.js

import { authService, taskService, ipRecordsService, accrualService, personService, transactionTypeService } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// TableManager Import (Dosya yolunun doğru olduğundan emin olun: public/js/table-manager.js)
import { TableManager } from '../table-manager.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'task-management.html' });

    class TaskManagementModule {
        constructor() {
            this.currentUser = null;
            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allUsers = [];
            this.allTransactionTypes = [];
            this.storage = getStorage();

            // Table Manager
            this.tableManager = null;

            // Seçim State'leri
            this.selectedTaskForAssignment = null;
            this.currentTaskForAccrual = null;
            this.createTaskSelectedTpInvoiceParty = null;
            this.createTaskSelectedServiceInvoiceParty = null;
            this.compSelectedTpInvoiceParty = null;
            this.compSelectedServiceInvoiceParty = null;

            this.statusDisplayMap = {
                'open': 'Açık',
                'in-progress': 'Devam Ediyor',
                'completed': 'Tamamlandı',
                'pending': 'Beklemede',
                'cancelled': 'İptal Edildi',
                'on-hold': 'Askıda',
                'awaiting-approval': 'Onay Bekliyor',
                'awaiting_client_approval': 'Müvekkil Onayı Bekliyor',
                'client_approval_opened': 'Müvekkil Onayı - Açıldı',
                'client_approval_closed': 'Müvekkil Onayı - Kapatıldı',
                'client_no_response_closed': 'Müvekkil Cevaplamadı - Kapatıldı'
            };
        }

        init() {
            // Tablo Yöneticisini Başlat
            this.initializeTableManager();

            authService.auth.onAuthStateChanged(async (user) => {
                if (user || authService.getCurrentUser()) {
                    this.currentUser = authService.getCurrentUser();
                    await this.loadAllData();
                    this.setupEventListeners();
                } else {
                    window.location.href = 'index.html';
                }
            });
        }

        // --- TableManager Yapılandırması ---
        initializeTableManager() {
            const columns = [
                { key: 'id', title: 'İş No', width: '80px' },
                { key: 'relatedRecord', title: 'İlgili Kayıt' },
                { key: 'taskTypeDisplay', title: 'Tip' },
                {
                    key: 'priority',
                    title: 'Öncelik',
                    render: (data) => {
                        const p = (data.priority || 'normal').toString();
                        return `<span class="priority-badge priority-${p.toLowerCase()}">${p}</span>`;
                    }
                },
                { key: 'assignedToDisplay', title: 'Atanan' },
                {
                    key: 'operationalDueDisplay',
                    title: 'Operasyonel Son Tarih',
                    // DeadlineHighlighter için data-field ve data-date ekliyoruz
                    render: (data) => `<span data-field="operationalDue" data-date="${data.operationalDueISO}">${data.operationalDueDisplay}</span>`
                },
                {
                    key: 'officialDueDisplay',
                    title: 'Resmi Son Tarih',
                    render: (data) => `<span data-field="officialDue" data-date="${data.officialDueISO}">${data.officialDueDisplay}</span>`
                },
                {
                    key: 'status',
                    title: 'Durum',
                    render: (data) => {
                        const s = (data.status || '').toString();
                        const text = this.statusDisplayMap[s] || s;
                        return `<span class="status-badge status-${s.replace(/ /g, '_').toLowerCase()}">${text}</span>`;
                    }
                },
                {
                    key: 'actions',
                    title: 'İşlemler',
                    render: (data) => this.getActionButtonsHtml(data)
                }
            ];

            // TableManager'ı başlatıyoruz
            // 'taskManagementTable': HTML'deki <table id="taskManagementTable">
            this.tableManager = new TableManager('taskManagementTable', columns, {
                itemsPerPage: 15,
                searchInputId: 'searchInput' // HTML'deki arama kutusunun ID'si
            });
        }

        async loadAllData() {
            const loading = document.getElementById('loadingIndicator');
            if (loading) loading.style.display = 'block';

            try {
                const [tasksResult, ipRecordsResult, personsResult, usersResult, accrualsResult, transactionTypesResult] = await Promise.all([
                    taskService.getAllTasks(),
                    ipRecordsService.getRecords(),
                    personService.getPersons(),
                    taskService.getAllUsers(),
                    accrualService.getAccruals(),
                    transactionTypeService.getTransactionTypes()
                ]);

                this.allTasks = tasksResult.success ? tasksResult.data : [];
                this.allIpRecords = ipRecordsResult.success ? ipRecordsResult.data : [];
                this.allPersons = personsResult.success ? personsResult.data : [];
                this.allUsers = usersResult.success ? usersResult.data : [];
                this.allAccruals = accrualsResult.success ? accrualsResult.data : [];
                this.allTransactionTypes = transactionTypesResult.success ? transactionTypesResult.data : [];

                // Verileri TableManager için işle
                this.processAndRenderTable();

            } catch (error) {
                console.error(error);
                showNotification('Veriler yüklenirken bir hata oluştu: ' + error.message, 'error');
            } finally {
                if (loading) loading.style.display = 'none';
            }
        }

        processAndRenderTable() {
            const processedData = this.allTasks.map(task => {
                // İlişkili Kayıt
                const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
                const relatedRecord = ipRecord ? (ipRecord.applicationNumber || ipRecord.title || 'Kayıt Bulunamadı') : 'N/A';

                // İş Tipi
                const transactionTypeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                const taskTypeDisplay = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || 'Bilinmiyor');

                // Atanan Kişi
                const assignedUser = this.allUsers.find(user => user.id === task.assignedTo_uid);
                const assignedToDisplay = assignedUser ? (assignedUser.displayName || assignedUser.email) : 'Atanmamış';

                // Tarihler
                const dueDateObj = task.dueDate ? (task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate)) : null;
                const operationalDueISO = dueDateObj ? dueDateObj.toISOString().slice(0, 10) : '';
                const operationalDueDisplay = dueDateObj ? dueDateObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                const officialDateObj = task.officialDueDate ? (task.officialDueDate.toDate ? task.officialDueDate.toDate() : (task.officialDueDate.seconds ? new Date(task.officialDueDate.seconds * 1000) : new Date(task.officialDueDate))) : null;
                const officialDueISO = officialDateObj ? officialDateObj.toISOString().slice(0, 10) : '';
                const officialDueDisplay = officialDateObj ? officialDateObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                // TableManager'ın kullanacağı düz obje
                return {
                    ...task, // Orijinal task verilerini de tut
                    relatedRecord,
                    taskTypeDisplay,
                    assignedToDisplay,
                    operationalDueISO,
                    operationalDueDisplay,
                    officialDueISO,
                    officialDueDisplay
                };
            });

            // TableManager'a veriyi ver
            if (this.tableManager) {
                this.tableManager.setTableData(processedData); // DÜZELTME: Metodun adı setTableData
            }

            // Deadline Highlighter'ı tetikle (Tablo render edildikten sonra)
            if (window.DeadlineHighlighter && typeof window.DeadlineHighlighter.refresh === 'function') {
                setTimeout(() => window.DeadlineHighlighter.refresh('taskManagement'), 100);
            }
        }

        getActionButtonsHtml(task) {
            const safeStatus = (task.status || '').toString();
            const isCompleted = safeStatus === 'completed';
            const isAccrualTask = (String(task.taskType) === '53' || task.taskType === 'accrual_creation');

            let html = `<div class="action-buttons-wrapper" style="display:flex; gap:5px;">`;
            html += `<button class="action-btn view-btn" data-id="${task.id}">Görüntüle</button>`;

            const hideModificationButtons = isAccrualTask && isCompleted;

            if (!hideModificationButtons) {
                html += `
                    <button class="action-btn edit-btn" data-id="${task.id}">Düzenle</button>
                    <button class="action-btn delete-btn" data-id="${task.id}">Sil</button>
                `;
            }

            if (safeStatus !== 'cancelled' && !hideModificationButtons) {
                html += `<button class="action-btn assign-btn" data-id="${task.id}">Ata</button>`;
            }

            if (!isAccrualTask) {
                html += `<button class="action-btn add-accrual-btn" data-id="${task.id}">Ek Tahakkuk</button>`;
            }
            html += `</div>`;
            return html;
        }

        setupEventListeners() {
            // TableManager arama inputunu kendi yönetir (initializeTableManager'da verdik).

            // Buton Delegasyonu (Tablo içindeki tıklamalar)
            const tbody = document.getElementById('tasksTableBody');
            if (tbody) {
                tbody.addEventListener('click', (e) => {
                    const btn = e.target.closest('.action-btn');
                    if (!btn) return;

                    e.preventDefault();
                    const taskId = btn.dataset.id;

                    if (btn.classList.contains('edit-btn')) {
                        const task = this.allTasks.find(t => t.id === taskId);
                        if (task && (String(task.taskType) === '53' || task.taskType === 'accrual_creation')) {
                            this.openCompleteAccrualModal(taskId);
                        } else {
                            window.location.href = `task-detail.html?id=${taskId}`;
                        }
                    } else if (btn.classList.contains('delete-btn')) {
                        this.deleteTask(taskId);
                    } else if (btn.classList.contains('view-btn')) {
                        this.showTaskDetailModal(taskId);
                    } else if (btn.classList.contains('assign-btn')) {
                        this.openAssignTaskModal(taskId);
                    } else if (btn.classList.contains('add-accrual-btn')) {
                        this.showCreateTaskAccrualModal(taskId);
                    }
                });
            }

            // Modal Kapatma Butonları
            document.querySelectorAll('.close-modal-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const modal = e.target.closest('.modal');
                    if (modal) this.closeModal(modal.id);
                });
            });

            // Atama Modalı
            document.getElementById('cancelAssignmentBtn')?.addEventListener('click', () => this.closeModal('assignTaskModal'));
            document.getElementById('saveNewAssignmentBtn')?.addEventListener('click', () => this.saveNewAssignment());

            // Ek Tahakkuk Modalı
            document.getElementById('cancelCreateTaskAccrualBtn')?.addEventListener('click', () => this.closeModal('createTaskAccrualModal'));
            document.getElementById('saveNewAccrualBtn')?.addEventListener('click', () => this.handleSaveNewAccrual());

            ['createTaskOfficialFee', 'createTaskServiceFee', 'createTaskVatRate', 'createTaskApplyVatToOfficialFee'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => this.calculateCreateTaskTotalAmount());
            });
            document.getElementById('createTaskTpInvoicePartySearch')?.addEventListener('input', e => this.searchPersonsForCreateTaskAccrual(e.target.value, 'createTaskTpInvoiceParty'));
            document.getElementById('createTaskServiceInvoicePartySearch')?.addEventListener('input', e => this.searchPersonsForCreateTaskAccrual(e.target.value, 'createTaskServiceInvoiceParty'));

            // Tahakkuk Tamamlama Modalı
            document.getElementById('cancelCompleteAccrualBtn')?.addEventListener('click', () => this.closeModal('completeAccrualTaskModal'));
            document.getElementById('submitCompleteAccrualBtn')?.addEventListener('click', () => this.handleCompleteAccrualSubmission());

            ['compOfficialFee', 'compServiceFee', 'compVatRate', 'compApplyVatToOfficial'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => this.calculateCompTotal());
            });

            document.getElementById('compTpInvoicePartySearch')?.addEventListener('input', e => this.searchPersonsForComp(e.target.value, 'compTpInvoiceParty'));
            document.getElementById('compServiceInvoicePartySearch')?.addEventListener('input', e => this.searchPersonsForComp(e.target.value, 'compServiceInvoiceParty'));

            // Dosya Inputları
            document.getElementById('createTaskForeignInvoiceFile')?.addEventListener('change', function() {
                const nameEl = document.getElementById('createTaskForeignInvoiceFileName');
                if (nameEl) nameEl.textContent = this.files[0] ? this.files[0].name : '';
            });
            document.getElementById('compForeignInvoiceFile')?.addEventListener('change', function() {
                const nameEl = document.getElementById('compForeignInvoiceFileName');
                if (nameEl) nameEl.textContent = this.files[0] ? this.files[0].name : '';
            });
        }

        // --- Modallar ve İşlemler ---
        
        openAssignTaskModal(taskId) {
            this.selectedTaskForAssignment = this.allTasks.find(t => t.id === taskId);
            if (!this.selectedTaskForAssignment) { showNotification('Atanacak iş bulunamadı.', 'error'); return; }
            
            const select = document.getElementById('newAssignedTo');
            if (select) {
                select.innerHTML = '<option value="">Seçiniz...</option>';
                this.allUsers.forEach(user => {
                    const opt = document.createElement('option');
                    opt.value = user.id;
                    opt.textContent = user.displayName || user.email;
                    if (this.selectedTaskForAssignment && user.id === this.selectedTaskForAssignment.assignedTo_uid) opt.selected = true;
                    select.appendChild(opt);
                });
            }
            const modal = document.getElementById('assignTaskModal');
            if(modal) modal.classList.add('show');
        }

        async saveNewAssignment() {
            const uid = document.getElementById('newAssignedTo')?.value;
            if (!uid) { showNotification('Lütfen kullanıcı seçin.', 'warning'); return; }
            const user = this.allUsers.find(u => u.id === uid);
            try {
                const updateData = { assignedTo_uid: uid, assignedTo_email: user.email };
                const historyEntry = { action: `İş yeniden atandı: ${this.selectedTaskForAssignment.assignedTo_email || 'Atanmamış'} -> ${user.email}`, timestamp: new Date().toISOString(), userEmail: this.currentUser.email };
                let history = this.selectedTaskForAssignment.history ? [...this.selectedTaskForAssignment.history] : [];
                history.push(historyEntry);
                updateData.history = history;
                const res = await taskService.updateTask(this.selectedTaskForAssignment.id, updateData);
                if (res.success) { showNotification('Atandı!', 'success'); this.closeModal('assignTaskModal'); await this.loadAllData(); } 
                else { showNotification('Hata: ' + res.error, 'error'); }
            } catch (e) { showNotification('Hata oluştu.', 'error'); }
        }

        async deleteTask(taskId) {
            if (confirm('Görevi silmek istediğinize emin misiniz?')) {
                const res = await taskService.deleteTask(taskId);
                if (res.success) { showNotification('Silindi.', 'success'); await this.loadAllData(); }
                else { showNotification('Hata: ' + res.error, 'error'); }
            }
        }

        showTaskDetailModal(taskId) {
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            const modalBody = document.getElementById('modalBody');
            const modalTitle = document.getElementById('modalTaskTitle');
            const modalElement = document.getElementById('taskDetailModal');

            if (!modalBody || !modalTitle || !modalElement) return;

            modalTitle.textContent = `${task.title || 'İş Detayı'} (${task.id})`;
            
            const formatDate = (dateVal) => {
                if (!dateVal) return 'Belirtilmemiş';
                try {
                    const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
                    return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('tr-TR');
                } catch(e) { return '-'; }
            };

            const assignedUser = this.allUsers.find(u => u.id === task.assignedTo_uid);
            const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : 'Atanmamış';

            let html = `
                <div class="modal-detail-grid">
                    <div class="modal-detail-item"><div class="modal-detail-label">İş Tipi</div><div class="modal-detail-value">${task.taskType || '-'}</div></div>
                    <div class="modal-detail-item"><div class="modal-detail-label">Durum</div><div class="modal-detail-value">${this.statusDisplayMap[task.status] || task.status}</div></div>
                    <div class="modal-detail-item"><div class="modal-detail-label">Öncelik</div><div class="modal-detail-value">${task.priority || '-'}</div></div>
                    <div class="modal-detail-item"><div class="modal-detail-label">Atanan</div><div class="modal-detail-value">${assignedName}</div></div>
                    <div class="modal-detail-item"><div class="modal-detail-label">Operasyonel Tarih</div><div class="modal-detail-value">${formatDate(task.dueDate)}</div></div>
                    <div class="modal-detail-item"><div class="modal-detail-label">Resmi Tarih</div><div class="modal-detail-value">${formatDate(task.officialDueDate)}</div></div>
                </div>
                <div class="modal-detail-section-title">Açıklama & Notlar</div>
                <div class="modal-detail-value long-text">${task.description || 'Açıklama girilmemiş.'}</div>
            `;

             // Geçmiş
             if (task.history && task.history.length > 0) {
                html += `<div class="task-history"><h5 style="color:#1e3c72; margin-bottom:15px;">İşlem Geçmişi</h5>`;
                const sortedHistory = [...task.history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                sortedHistory.forEach(h => {
                    const hDate = formatDate(h.timestamp);
                    html += `
                        <div class="task-history-item">
                            <div class="task-history-description">${h.action}</div>
                            <div class="task-history-meta"><i class="far fa-clock"></i> ${hDate} - ${h.userEmail || 'Sistem'}</div>
                        </div>`;
                });
                html += `</div>`;
            }

            modalBody.innerHTML = html;
            modalElement.classList.add('show');
        }

        // --- Tahakkuk Tamamlama Modalı (GÜVENLİ VE DOLU VERSİYON) ---
        openCompleteAccrualModal(taskId) {
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            const form = document.getElementById('completeAccrualForm');
            if (form) form.reset();

            const targetInput = document.getElementById('targetTaskIdForCompletion');
            if (targetInput) targetInput.value = taskId;

            const offCurr = document.getElementById('compOfficialFeeCurrency');
            if (offCurr) offCurr.value = 'TRY';
            const srvCurr = document.getElementById('compServiceFeeCurrency');
            if (srvCurr) srvCurr.value = 'TRY';
            const vatRateInput = document.getElementById('compVatRate');
            if (vatRateInput) vatRateInput.value = '20';
            const applyVatCheck = document.getElementById('compApplyVatToOfficial');
            if (applyVatCheck) applyVatCheck.checked = false;

            const fileInput = document.getElementById('compForeignInvoiceFile');
            if (fileInput) fileInput.value = '';
            const fileNameDisplay = document.getElementById('compForeignInvoiceFileName');
            if (fileNameDisplay) fileNameDisplay.textContent = '';
            const totalDisplay = document.getElementById('compTotalAmountDisplay');
            if (totalDisplay) totalDisplay.textContent = '0.00 ₺';

            // EPATS Belgesi
            const docContainer = document.getElementById('accrualEpatsDocumentContainer');
            const docNameEl = document.getElementById('accrualEpatsDocName');
            const docLinkEl = document.getElementById('accrualEpatsDocLink');
            
            let epatsDoc = null;
            if (task.details && task.details.epatsDocument) epatsDoc = task.details.epatsDocument;
            else if (task.relatedTaskId) {
                const parentTask = this.allTasks.find(t => t.id === task.relatedTaskId);
                if (parentTask && parentTask.details && parentTask.details.epatsDocument) epatsDoc = parentTask.details.epatsDocument;
            }

            if (docContainer && docNameEl && docLinkEl) {
                if (epatsDoc && (epatsDoc.downloadURL || epatsDoc.fileUrl)) {
                    docNameEl.textContent = epatsDoc.name || epatsDoc.fileName || 'EPATS Belgesi';
                    docLinkEl.href = epatsDoc.downloadURL || epatsDoc.fileUrl;
                    docContainer.className = "alert alert-secondary d-flex align-items-center justify-content-between mb-4"; 
                    docContainer.style.display = 'flex';
                } else {
                    docContainer.style.display = 'none';
                    docLinkEl.href = '#';
                }
            }

            // Sıfırla
            this.compSelectedTpInvoiceParty = null;
            this.compSelectedServiceInvoiceParty = null;
            const tpDisplay = document.getElementById('compSelectedTpInvoicePartyDisplay');
            if (tpDisplay) tpDisplay.style.display = 'none';
            const srvDisplay = document.getElementById('compSelectedServiceInvoicePartyDisplay');
            if (srvDisplay) srvDisplay.style.display = 'none';
            const tpResults = document.getElementById('compTpInvoicePartyResults');
            if (tpResults) tpResults.innerHTML = '';
            const srvResults = document.getElementById('compServiceInvoicePartyResults');
            if (srvResults) srvResults.innerHTML = '';

            const modal = document.getElementById('completeAccrualTaskModal');
            if (modal) modal.classList.add('show');
        }

        async handleCompleteAccrualSubmission() {
             const taskId = document.getElementById('targetTaskIdForCompletion')?.value;
             if(!taskId) return;
             const task = this.allTasks.find(t => t.id === taskId);
             
             const officialFee = parseFloat(document.getElementById('compOfficialFee').value) || 0;
             const serviceFee = parseFloat(document.getElementById('compServiceFee').value) || 0;
             if (officialFee <= 0 && serviceFee <= 0) { showNotification("En az bir ücret giriniz.", 'error'); return; }

             const vatRate = parseFloat(document.getElementById('compVatRate').value) || 0;
             const applyVat = document.getElementById('compApplyVatToOfficial').checked;
             let totalAmount = applyVat ? (officialFee + serviceFee) * (1 + vatRate / 100) : officialFee + (serviceFee * (1 + vatRate / 100));

             // Dosya
             let uploadedFiles = [];
             const fileInput = document.getElementById('compForeignInvoiceFile');
             if (fileInput.files.length > 0) {
                 try {
                     const file = fileInput.files[0];
                     const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                     const snapshot = await uploadBytes(storageRef, file);
                     const url = await getDownloadURL(snapshot.ref);
                     uploadedFiles.push({ name: file.name, url, type: 'foreign_invoice', documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() });
                 } catch(err) { showNotification("Dosya yükleme hatası.", "error"); return; }
             }

             const cleanTitle = task.title.replace('Tahakkuk Oluşturma: ', '');
             const accrualData = {
                 taskId: task.relatedTaskId || taskId, 
                 taskTitle: cleanTitle,
                 officialFee: { amount: officialFee, currency: document.getElementById('compOfficialFeeCurrency').value },
                 serviceFee: { amount: serviceFee, currency: document.getElementById('compServiceFeeCurrency').value },
                 vatRate, applyVatToOfficialFee: applyVat,
                 totalAmount, totalAmountCurrency: 'TRY', status: 'unpaid', remainingAmount: totalAmount,
                 tpInvoiceParty: this.compSelectedTpInvoiceParty ? { id: this.compSelectedTpInvoiceParty.id, name: this.compSelectedTpInvoiceParty.name } : null,
                 serviceInvoiceParty: this.compSelectedServiceInvoiceParty ? { id: this.compSelectedServiceInvoiceParty.id, name: this.compSelectedServiceInvoiceParty.name } : null,
                 createdAt: new Date().toISOString(),
                 files: uploadedFiles
             };

             try {
                 const accResult = await accrualService.addAccrual(accrualData);
                 if (!accResult.success) throw new Error(accResult.error);
                 
                 const updateData = {
                     status: 'completed',
                     updatedAt: new Date().toISOString(),
                     history: [...(task.history || []), { action: 'Tahakkuk oluşturularak görev tamamlandı.', timestamp: new Date().toISOString(), userEmail: this.currentUser.email }]
                 };
                 const taskResult = await taskService.updateTask(taskId, updateData);
                 if (taskResult.success) { 
                     showNotification('İşlem başarılı!', 'success'); 
                     this.closeModal('completeAccrualTaskModal'); 
                     await this.loadAllData(); 
                 } else throw new Error('Task güncellenemedi.');
             } catch(e) { showNotification('Hata: ' + e.message, 'error'); }
        }

        showCreateTaskAccrualModal(taskId) {
            this.currentTaskForAccrual = this.allTasks.find(t => t.id === taskId);
            if (!this.currentTaskForAccrual) { showNotification('İş bulunamadı.', 'error'); return; }
            const titleInput = document.getElementById('createTaskAccrualTaskTitleDisplay');
            if(titleInput) titleInput.value = `${this.currentTaskForAccrual.title} (${this.currentTaskForAccrual.id})`;
            
            const form = document.getElementById('createTaskAccrualForm');
            if(form) form.reset();
            
            const fName = document.getElementById('createTaskForeignInvoiceFileName');
            if(fName) fName.textContent = '';
            
            this.createTaskSelectedTpInvoiceParty = null;
            this.createTaskSelectedServiceInvoiceParty = null;
            const d1 = document.getElementById('createTaskSelectedTpInvoicePartyDisplay');
            if(d1) d1.style.display = 'none';
            const d2 = document.getElementById('createTaskSelectedServiceInvoicePartyDisplay');
            if(d2) d2.style.display = 'none';

            const modal = document.getElementById('createTaskAccrualModal');
            if(modal) modal.classList.add('show');
        }

        async handleSaveNewAccrual() {
            if (!this.currentTaskForAccrual) return;
            const officialFee = parseFloat(document.getElementById('createTaskOfficialFee').value) || 0;
            const serviceFee = parseFloat(document.getElementById('createTaskServiceFee').value) || 0;
            if (officialFee <= 0 && serviceFee <= 0) { showNotification("Ücret giriniz.", 'error'); return; }
            
            const vatRate = parseFloat(document.getElementById('createTaskVatRate').value) || 0;
            const applyVat = document.getElementById('createTaskApplyVatToOfficialFee').checked;
            let total = applyVat ? (officialFee + serviceFee) * (1 + vatRate / 100) : officialFee + (serviceFee * (1 + vatRate / 100));

            let uploadedFiles = [];
            const fileInput = document.getElementById('createTaskForeignInvoiceFile');
            if (fileInput.files.length > 0) {
                try {
                    const file = fileInput.files[0];
                    const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                    const snapshot = await uploadBytes(storageRef, file);
                    const url = await getDownloadURL(snapshot.ref);
                    uploadedFiles.push({ name: file.name, url, type: 'foreign_invoice', documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() });
                } catch(err) { showNotification("Dosya yüklenemedi.", "error"); return; }
            }

            const newAccrual = {
                taskId: this.currentTaskForAccrual.id,
                taskTitle: this.currentTaskForAccrual.title,
                officialFee: { amount: officialFee, currency: document.getElementById('createTaskOfficialFeeCurrency').value },
                serviceFee: { amount: serviceFee, currency: document.getElementById('createTaskServiceFeeCurrency').value },
                vatRate, applyVatToOfficialFee: applyVat,
                totalAmount: total, totalAmountCurrency: 'TRY', remainingAmount: total, status: 'unpaid',
                tpInvoiceParty: this.createTaskSelectedTpInvoiceParty,
                serviceInvoiceParty: this.createTaskSelectedServiceInvoiceParty,
                createdAt: new Date().toISOString(),
                files: uploadedFiles
            };

            const res = await accrualService.addAccrual(newAccrual);
            if (res.success) { showNotification('Ek tahakkuk oluşturuldu!', 'success'); this.closeModal('createTaskAccrualModal'); await this.loadAllData(); }
            else { showNotification('Hata: ' + res.error, 'error'); }
        }

        calculateCompTotal() {
            const off = parseFloat(document.getElementById('compOfficialFee').value) || 0;
            const srv = parseFloat(document.getElementById('compServiceFee').value) || 0;
            const vat = parseFloat(document.getElementById('compVatRate').value) || 0;
            const apply = document.getElementById('compApplyVatToOfficial').checked;
            let total = apply ? (off + srv) * (1 + vat / 100) : off + (srv * (1 + vat / 100));
            const el = document.getElementById('compTotalAmountDisplay');
            if(el) el.textContent = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(total);
        }

        calculateCreateTaskTotalAmount() {
            const off = parseFloat(document.getElementById('createTaskOfficialFee').value) || 0;
            const srv = parseFloat(document.getElementById('createTaskServiceFee').value) || 0;
            const vat = parseFloat(document.getElementById('createTaskVatRate').value) || 0;
            const apply = document.getElementById('createTaskApplyVatToOfficialFee').checked;
            let total = apply ? (off + srv) * (1 + vat / 100) : off + (srv * (1 + vat / 100));
            const el = document.getElementById('createTaskTotalAmountDisplay');
            if(el) el.textContent = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(total);
        }

        searchPersonsForComp(query, target) { /* ... Kişi arama mantığı (önceki kodunla aynı kalabilir) ... */ }
        searchPersonsForCreateTaskAccrual(query, target) { /* ... Kişi arama mantığı (önceki kodunla aynı kalabilir) ... */ }
        selectPersonForCreateTaskAccrual(person, target) { /* ... */ }

        cleanHistoryAction(action) { return action; }

        closeModal(modalId) {
            const m = document.getElementById(modalId);
            if(m) m.classList.remove('show');
            if (modalId === 'createTaskAccrualModal') {
                const f = document.getElementById('createTaskAccrualForm');
                if(f) f.reset();
                const fn = document.getElementById('createTaskForeignInvoiceFileName');
                if(fn) fn.textContent = '';
            }
            if (modalId === 'completeAccrualTaskModal') {
                const f = document.getElementById('completeAccrualForm');
                if(f) f.reset();
                const fn = document.getElementById('compForeignInvoiceFileName');
                if(fn) fn.textContent = '';
                const dc = document.getElementById('accrualEpatsDocumentContainer');
                if(dc) dc.style.display = 'none';
            }
        }
    }

    const module = new TaskManagementModule();
    module.init();

    // DeadlineHighlighter - Main'in en altı
    if (window.DeadlineHighlighter) {
        window.DeadlineHighlighter.init();
        window.DeadlineHighlighter.registerList('taskManagement', {
            container: '#taskManagementTable',
            rowSelector: '#tasksTableBody tr',
            dateFields: [
                { name: 'operationalDue', selector: '[data-field="operationalDue"]' },
                { name: 'officialDue',    selector: '[data-field="officialDue"]' }
            ],
            strategy: 'earliest',
            applyTo: 'row',
            showLegend: true
        });
    }
});