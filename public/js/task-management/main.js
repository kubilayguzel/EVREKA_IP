// public/js/task-management/main.js

import { authService, taskService, ipRecordsService, accrualService, personService, auth, transactionTypeService } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'task-management.html' });

    class TaskManagementModule {
        constructor() {
            this.currentUser = null;
            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allUsers = [];
            this.selectedTaskForAssignment = null;
            this.currentTaskForAccrual = null;
            
            // Kişi Seçimleri
            this.createTaskSelectedTpInvoiceParty = null;
            this.createTaskSelectedServiceInvoiceParty = null;
            this.compSelectedTpInvoiceParty = null;
            this.compSelectedServiceInvoiceParty = null;
            
            this.allTransactionTypes = []; 
            this.storage = getStorage();
            
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

        async loadAllData() {
            document.getElementById('loadingIndicator').style.display = 'block';
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
                this.renderTasks();
            } catch (error) {
                showNotification('Veriler yüklenirken bir hata oluştu: ' + error.message, 'error');
            } finally {
                document.getElementById('loadingIndicator').style.display = 'none';
            }
        }

        setupEventListeners() {
            document.getElementById('taskSearchInput').addEventListener('input', () => this.renderTasks());

            document.getElementById('tasksTableBody').addEventListener('click', (e) => {
                if (e.target.classList.contains('action-btn')) {
                    e.preventDefault();
                    const taskId = e.target.dataset.id;

                    if (e.target.classList.contains('edit-btn')) {
                        const task = this.allTasks.find(t => t.id === taskId);
                        // Eğer iş tipi "53" ise Özel Modal aç, değilse detay sayfasına git
                        if (task && (String(task.taskType) === '53' || task.taskType === 'accrual_creation')) {
                            this.openCompleteAccrualModal(taskId);
                        } else {
                            window.location.href = `task-detail.html?id=${taskId}`;
                        }
                    } else if (e.target.classList.contains('delete-btn')) {
                        this.deleteTask(taskId);
                    } else if (e.target.classList.contains('view-btn')) {
                        this.showTaskDetailModal(taskId);
                    } else if (e.target.classList.contains('assign-btn')) {
                        this.openAssignTaskModal(taskId);
                    } else if (e.target.classList.contains('add-accrual-btn')) {
                        this.showCreateTaskAccrualModal(taskId);
                    }
                }
            });

            // Modal Kapatma
            document.querySelectorAll('.close-modal-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    // Butonun ait olduğu modalı bul ve kapat
                    const modal = e.target.closest('.modal');
                    if (modal) this.closeModal(modal.id);
                });
            });

            // Atama Modalı
            document.getElementById('cancelAssignmentBtn').addEventListener('click', () => this.closeModal('assignTaskModal'));
            document.getElementById('saveNewAssignmentBtn').addEventListener('click', () => this.saveNewAssignment());

            // Ek Tahakkuk Modalı
            document.getElementById('cancelCreateTaskAccrualBtn').addEventListener('click', () => this.closeModal('createTaskAccrualModal'));
            document.getElementById('saveNewAccrualBtn').addEventListener('click', () => this.handleSaveNewAccrual());

            ['createTaskOfficialFee', 'createTaskServiceFee', 'createTaskVatRate', 'createTaskApplyVatToOfficialFee'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => this.calculateCreateTaskTotalAmount());
            });

            document.getElementById('createTaskTpInvoicePartySearch')?.addEventListener('input', e => this.searchPersonsForCreateTaskAccrual(e.target.value, 'createTaskTpInvoiceParty'));
            document.getElementById('createTaskServiceInvoicePartySearch')?.addEventListener('input', e => this.searchPersonsForCreateTaskAccrual(e.target.value, 'createTaskServiceInvoiceParty'));

            document.getElementById('compTpInvoicePartySearch')?.addEventListener('input', e => this.searchPersonsForComp(e.target.value, 'compTpInvoiceParty'));
            document.getElementById('compServiceInvoicePartySearch')?.addEventListener('input', e => this.searchPersonsForComp(e.target.value, 'compServiceInvoiceParty'));

            ['compOfficialFee', 'compServiceFee', 'compVatRate', 'compApplyVatToOfficial'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => this.calculateCompTotal());
            });

            document.getElementById('compTpInvoicePartySearch').addEventListener('input', e => this.searchPersonsForComp(e.target.value, 'compTpInvoiceParty'));
            document.getElementById('compServiceInvoicePartySearch').addEventListener('input', e => this.searchPersonsForComp(e.target.value, 'compServiceInvoiceParty'));

            // Dosya Inputları
            document.getElementById('createTaskForeignInvoiceFile').addEventListener('change', function() {
                document.getElementById('createTaskForeignInvoiceFileName').textContent = this.files[0] ? this.files[0].name : '';
            });
            document.getElementById('compForeignInvoiceFile').addEventListener('change', function() {
                document.getElementById('compForeignInvoiceFileName').textContent = this.files[0] ? this.files[0].name : '';
            });
        }

        // --- Tablo Render ---
        renderTasks() {
            const tableBody = document.getElementById('tasksTableBody');
            const noTasksMessage = document.getElementById('noTasksMessage');
            tableBody.innerHTML = '';
            const searchTerm = (document.getElementById('taskSearchInput').value || '').toLowerCase();
            
            const filteredTasks = this.allTasks.filter(task => {
                const title = (task.title || '').toLowerCase();
                const relatedTitle = (task.relatedIpRecordTitle || '').toLowerCase();
                const type = (task.taskType || '').toLowerCase();
                const status = (task.status || '').toLowerCase();
                return title.includes(searchTerm) || relatedTitle.includes(searchTerm) || type.includes(searchTerm) || status.includes(searchTerm);
            });

            if (filteredTasks.length === 0) { noTasksMessage.style.display = 'block'; return; }
            noTasksMessage.style.display = 'none';

            filteredTasks.forEach(task => {
                const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
                const relatedRecordDisplay = ipRecord ? (ipRecord.applicationNumber || ipRecord.title || 'Kayıt Bulunamadı') : 'N/A';
                const row = document.createElement('tr');
                const safeStatus = (task.status || '').toString();
                const statusClass = `status-${safeStatus.replace(/ /g, '_').toLowerCase()}`; 
                const statusText = this.statusDisplayMap[safeStatus] || safeStatus; 
                const safePriority = (task.priority || 'normal').toString();
                const priorityClass = `priority-${safePriority.toLowerCase()}`;
                
                const transactionTypeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                const taskTypeDisplayName = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || 'Bilinmiyor');

                const assignedUser = this.allUsers.find(user => user.id === task.assignedTo_uid);
                const assignedToDisplayName = assignedUser ? (assignedUser.displayName || assignedUser.email) : 'Atanmamış';
                
                // Tarihler
                const dueDateObj = task.dueDate ? (task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate)) : null;
                const dueISO = dueDateObj ? dueDateObj.toISOString().slice(0, 10) : '';
                const dueDisplay = dueDateObj ? dueDateObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                const officialDateObj = task.officialDueDate ? (task.officialDueDate.toDate ? task.officialDueDate.toDate() : (task.officialDueDate.seconds ? new Date(task.officialDueDate.seconds * 1000) : new Date(task.officialDueDate))) : null;
                const officialISO = officialDateObj ? officialDateObj.toISOString().slice(0, 10) : '';
                const officialDisplay = officialDateObj ? officialDateObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                // --- BUTON MANTIĞI ---
                const isCompleted = safeStatus === 'completed';
                const isAccrualTask = (String(task.taskType) === '53' || task.taskType === 'accrual_creation');

                let actionButtonsHtml = `<button class="action-btn view-btn" data-id="${task.id}">Görüntüle</button>`;

                // Tahakkuk İşi İSE ve Tamamlandıysa -> Butonları GİZLE
                const hideModificationButtons = isAccrualTask && isCompleted;

                if (!hideModificationButtons) {
                    actionButtonsHtml += `
                        <button class="action-btn edit-btn" data-id="${task.id}">Düzenle</button>
                        <button class="action-btn delete-btn" data-id="${task.id}">Sil</button>
                    `;
                }

                if (safeStatus !== 'cancelled' && !hideModificationButtons) {
                    actionButtonsHtml += `<button class="action-btn assign-btn" data-id="${task.id}">Ata</button>`;
                }
                
                if (!isAccrualTask) {
                    actionButtonsHtml += `<button class="action-btn add-accrual-btn" data-id="${task.id}">Ek Tahakkuk Oluştur</button>`;
                }

                row.innerHTML = `
                    <td>${task.id}</td>
                    <td>${relatedRecordDisplay}</td>
                    <td>${taskTypeDisplayName}</td>
                    <td><span class="priority-badge ${priorityClass}">${safePriority}</span></td>
                    <td>${assignedToDisplayName}</td>
                    <td data-field="operationalDue" data-date="${dueISO}">${dueDisplay}</td>
                    <td data-field="officialDue" data-date="${officialISO}">${officialDisplay}</td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td>${actionButtonsHtml}</td>
                `;
                tableBody.appendChild(row);
            });
            
            if (window.DeadlineHighlighter && typeof window.DeadlineHighlighter.refresh === 'function') {
                window.DeadlineHighlighter.refresh('taskManagement');
            }
        }

        // --- Modallar ve İşlemler ---
        openAssignTaskModal(taskId) {
            this.selectedTaskForAssignment = this.allTasks.find(t => t.id === taskId);
            if (!this.selectedTaskForAssignment) { showNotification('Atanacak iş bulunamadı.', 'error'); return; }
            const select = document.getElementById('newAssignedTo');
            select.innerHTML = '<option value="">Seçiniz...</option>';
            this.allUsers.forEach(user => {
                const opt = document.createElement('option');
                opt.value = user.id;
                opt.textContent = user.displayName || user.email;
                if (user.id === this.selectedTaskForAssignment.assignedTo_uid) opt.selected = true;
                select.appendChild(opt);
            });
            document.getElementById('assignTaskModal').classList.add('show');
        }

        async saveNewAssignment() {
            const uid = document.getElementById('newAssignedTo').value;
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

        // --- Tahakkuk Tamamlama Modalı (ÖZEL) ---
        openCompleteAccrualModal(taskId) {
            // 1. Görevi Bul
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) {
                console.error("Hata: İş bulunamadı (ID: " + taskId + ")");
                return;
            }

            // 2. Formu Sıfırla (Güvenli Yöntem)
            const form = document.getElementById('completeAccrualForm');
            if (form) form.reset();

            // 3. Hedef Task ID'yi Hidden Input'a Yaz
            const targetInput = document.getElementById('targetTaskIdForCompletion');
            if (targetInput) targetInput.value = taskId;

            // 4. Para Birimlerini ve Varsayılanları Ayarla
            const offCurr = document.getElementById('compOfficialFeeCurrency');
            if (offCurr) offCurr.value = 'TRY';

            const srvCurr = document.getElementById('compServiceFeeCurrency');
            if (srvCurr) srvCurr.value = 'TRY';

            const vatRateInput = document.getElementById('compVatRate');
            if (vatRateInput) vatRateInput.value = '20'; // Varsayılan KDV

            const applyVatCheck = document.getElementById('compApplyVatToOfficial');
            if (applyVatCheck) applyVatCheck.checked = false;

            // 5. Dosya Inputlarını Temizle
            const fileInput = document.getElementById('compForeignInvoiceFile');
            if (fileInput) fileInput.value = '';
            
            const fileNameDisplay = document.getElementById('compForeignInvoiceFileName');
            if (fileNameDisplay) fileNameDisplay.textContent = '';
            
            // 6. Toplam Tutar Göstergesini Sıfırla
            const totalDisplay = document.getElementById('compTotalAmountDisplay');
            if (totalDisplay) totalDisplay.textContent = '0.00 ₺';

            // 7. EPATS Belgesini Bul ve Göster (Varsa)
            const docContainer = document.getElementById('accrualEpatsDocumentContainer');
            const docNameEl = document.getElementById('accrualEpatsDocName');
            const docLinkEl = document.getElementById('accrualEpatsDocLink');
            
            let epatsDoc = null;
            
            // Önce mevcut task'in detaylarında var mı?
            if (task.details && task.details.epatsDocument) {
                epatsDoc = task.details.epatsDocument;
            } 
            // Yoksa ve bu bir alt görevse, ana görevin (parent) detaylarına bak
            else if (task.relatedTaskId) {
                const parentTask = this.allTasks.find(t => t.id === task.relatedTaskId);
                if (parentTask && parentTask.details && parentTask.details.epatsDocument) {
                    epatsDoc = parentTask.details.epatsDocument;
                }
            }

            // HTML elementleri varsa ve belge bulunduysa göster
            if (docContainer && docNameEl && docLinkEl) {
                if (epatsDoc && (epatsDoc.downloadURL || epatsDoc.fileUrl)) {
                    docNameEl.textContent = epatsDoc.name || epatsDoc.fileName || 'EPATS Belgesi';
                    docLinkEl.href = epatsDoc.downloadURL || epatsDoc.fileUrl;
                    
                    // Container stilini güncelle ve göster
                    docContainer.className = "alert alert-secondary d-flex align-items-center justify-content-between mb-4"; 
                    docContainer.style.display = 'flex';
                } else {
                    docContainer.style.display = 'none';
                    docLinkEl.href = '#';
                }
            }

            // 8. Kişi Seçim State'lerini ve Arayüzü Sıfırla
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

            // 9. Modalı Aç
            const modal = document.getElementById('completeAccrualTaskModal');
            if (modal) {
                modal.classList.add('show');
            } else {
                console.error("Hata: 'completeAccrualTaskModal' ID'li modal HTML'de bulunamadı!");
            }
        }

        async handleCompleteAccrualSubmission() {
            const taskId = document.getElementById('targetTaskIdForCompletion').value;
            const task = this.allTasks.find(t => t.id === taskId);
            
            const officialFee = parseFloat(document.getElementById('compOfficialFee').value) || 0;
            const serviceFee = parseFloat(document.getElementById('compServiceFee').value) || 0;

            if (officialFee <= 0 && serviceFee <= 0) { showNotification("Lütfen en az bir ücret girin.", 'error'); return; }

            const vatRate = parseFloat(document.getElementById('compVatRate').value) || 0;
            const applyVat = document.getElementById('compApplyVatToOfficial').checked;
            let totalAmount = applyVat ? (officialFee + serviceFee) * (1 + vatRate / 100) : officialFee + (serviceFee * (1 + vatRate / 100));

            const cleanTitle = task.title.replace('Tahakkuk Oluşturma: ', '');

            // Dosya Yükleme (Yurtdışı Fatura)
            let uploadedFiles = [];
            const fileInput = document.getElementById('compForeignInvoiceFile');
            if (fileInput.files.length > 0) {
                try {
                    const file = fileInput.files[0];
                    const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                    const snapshot = await uploadBytes(storageRef, file);
                    const url = await getDownloadURL(snapshot.ref);
                    uploadedFiles.push({
                        name: file.name,
                        url: url,
                        type: 'foreign_invoice',
                        documentDesignation: 'Yurtdışı Fatura/Debit',
                        uploadedAt: new Date().toISOString()
                    });
                } catch(err) {
                    showNotification("Dosya yüklenirken hata oluştu.", "error");
                    return;
                }
            }

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
                    showNotification('Tahakkuk oluşturuldu ve görev tamamlandı!', 'success'); 
                    this.closeModal('completeAccrualTaskModal'); 
                    await this.loadAllData(); 
                } else { throw new Error('Görev güncellenemedi.'); }
            } catch (error) { showNotification('İşlem hatası: ' + error.message, 'error'); }
        }

        // --- Ek Tahakkuk Modalı (Mevcut İşlere Ekleme) ---
        showCreateTaskAccrualModal(taskId) {
            this.currentTaskForAccrual = this.allTasks.find(t => t.id === taskId);
            if (!this.currentTaskForAccrual) { showNotification('İş bulunamadı.', 'error'); return; }
            document.getElementById('createTaskAccrualTaskTitleDisplay').value = `${this.currentTaskForAccrual.title} (${this.currentTaskForAccrual.id})`;
            document.getElementById('createTaskAccrualForm').reset();
            document.getElementById('createTaskForeignInvoiceFile').value = '';
            document.getElementById('createTaskForeignInvoiceFileName').textContent = '';
            
            this.createTaskSelectedTpInvoiceParty = null;
            this.createTaskSelectedServiceInvoiceParty = null;
            document.getElementById('createTaskSelectedTpInvoicePartyDisplay').style.display = 'none';
            document.getElementById('createTaskSelectedServiceInvoicePartyDisplay').style.display = 'none';
            document.getElementById('createTaskAccrualModal').classList.add('show');
        }

        async handleSaveNewAccrual() {
             if (!this.currentTaskForAccrual) return;
             const officialFee = parseFloat(document.getElementById('createTaskOfficialFee').value) || 0;
             const serviceFee = parseFloat(document.getElementById('createTaskServiceFee').value) || 0;
             if (officialFee <= 0 && serviceFee <= 0) { showNotification("Lütfen ücret girin.", 'error'); return; }
             
             const vatRate = parseFloat(document.getElementById('createTaskVatRate').value) || 0;
             const applyVat = document.getElementById('createTaskApplyVatToOfficialFee').checked;
             let total = applyVat ? (officialFee + serviceFee) * (1 + vatRate / 100) : officialFee + (serviceFee * (1 + vatRate / 100));

             // Dosya Yükleme
             let uploadedFiles = [];
             const fileInput = document.getElementById('createTaskForeignInvoiceFile');
             if (fileInput.files.length > 0) {
                 try {
                     const file = fileInput.files[0];
                     const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                     const snapshot = await uploadBytes(storageRef, file);
                     const url = await getDownloadURL(snapshot.ref);
                     uploadedFiles.push({ name: file.name, url: url, type: 'foreign_invoice', documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() });
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

        // --- Ortak Hesaplama ve Arama ---
        calculateCompTotal() {
            const off = parseFloat(document.getElementById('compOfficialFee').value) || 0;
            const srv = parseFloat(document.getElementById('compServiceFee').value) || 0;
            const vat = parseFloat(document.getElementById('compVatRate').value) || 0;
            const apply = document.getElementById('compApplyVatToOfficial').checked;
            let total = apply ? (off + srv) * (1 + vat / 100) : off + (srv * (1 + vat / 100));
            document.getElementById('compTotalAmountDisplay').textContent = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(total);
        }

        calculateCreateTaskTotalAmount() {
            const off = parseFloat(document.getElementById('createTaskOfficialFee').value) || 0;
            const srv = parseFloat(document.getElementById('createTaskServiceFee').value) || 0;
            const vat = parseFloat(document.getElementById('createTaskVatRate').value) || 0;
            const apply = document.getElementById('createTaskApplyVatToOfficialFee').checked;
            let total = apply ? (off + srv) * (1 + vat / 100) : off + (srv * (1 + vat / 100));
            document.getElementById('createTaskTotalAmountDisplay').textContent = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(total);
        }

        searchPersonsForComp(query, target) { /* ... Kişi arama kodları (öncekiyle aynı) ... */ }
        searchPersonsForCreateTaskAccrual(query, target) { /* ... Kişi arama kodları (öncekiyle aynı) ... */ }
        selectPersonForCreateTaskAccrual(person, target) { /* ... (öncekiyle aynı) ... */ }
        
        // --- Detay Modalı (Görüntüle) ---
        showTaskDetailModal(taskId) {
            const task = this.allTasks.find(t => t.id === taskId);
            // ... (Orijinal detay modalı kodları buraya) ...
            document.getElementById('taskDetailModal').classList.add('show');
        }

        cleanHistoryAction(action) { /* ... */ return action; }

        closeModal(modalId) {
            document.getElementById(modalId).classList.remove('show');
            if (modalId === 'createTaskAccrualModal') {
                document.getElementById('createTaskAccrualForm').reset();
                document.getElementById('createTaskForeignInvoiceFileName').textContent = '';
                // ... reset display logic
            }
            if (modalId === 'completeAccrualTaskModal') {
                document.getElementById('completeAccrualForm').reset();
                document.getElementById('compForeignInvoiceFileName').textContent = '';
                document.getElementById('accrualEpatsDocumentContainer').style.display = 'none';
                // ... reset display logic
            }
        }
    }

    const module = new TaskManagementModule();
    module.init();

    // DeadlineHighlighter
    if(window.DeadlineHighlighter) {
        DeadlineHighlighter.init();
        
        // HATA VEREN KISIM BURASIYDI, CONFIG OBJESINI DOLDURDUK:
        DeadlineHighlighter.registerList('taskManagement', {
            selector: '#tasksTableBody tr',  // Satırları nerede arayacak
            dateAttribute: 'data-date',      // Tarih hangi attribute'da yazılı
            warnThresholdDays: 3,            // Kaç gün kala uyarı versin
            containerId: 'taskManagementTable' // Tablo ID'si
        });
    }
});