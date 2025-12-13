// public/js/task-management/my-tasks.js

import { authService, taskService, ipRecordsService, accrualService, personService, transactionTypeService } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import Pagination from '../pagination.js'; 
import { TaskDetailManager } from '../components/TaskDetailManager.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'my-tasks.html' });

    class MyTasksModule {
        constructor() {
            this.currentUser = null;
            this.storage = getStorage();

            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allAccruals = [];
            this.allTransactionTypes = [];

            this.processedData = [];
            this.filteredData = [];

            // Varsayılan Sıralama: Oluşturulma Tarihi (Yeniden eskiye)
            this.sortState = { key: 'createdAtObj', direction: 'desc' };

            this.pagination = null;
            this.currentTaskForAccrual = null;

            this.taskDetailManager = null;
            this.accrualFormManager = null;

            this.statusDisplayMap = {
                'open': 'Açık', 'in-progress': 'Devam Ediyor', 'completed': 'Tamamlandı',
                'pending': 'Beklemede', 'cancelled': 'İptal Edildi', 'on-hold': 'Askıda',
                'awaiting-approval': 'Onay Bekliyor', 'awaiting_client_approval': 'Müvekkil Onayı Bekliyor',
                'client_approval_opened': 'Müvekkil Onayı - Açıldı', 'client_approval_closed': 'Müvekkil Onayı - Kapatıldı',
                'client_no_response_closed': 'Müvekkil Cevaplamadı - Kapatıldı'
            };
        }

        init() {
            this.taskDetailManager = new TaskDetailManager('modalBody');
            this.accrualFormManager = new AccrualFormManager('createMyTaskAccrualFormContainer', 'myTaskAcc');
            
            this.initializePagination();

            authService.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    this.currentUser = user;
                    await this.loadAllData();
                    this.setupEventListeners();
                    this.populateStatusFilterDropdown();
                } else {
                    window.location.href = 'index.html';
                }
            });
        }

        initializePagination() {
            if (typeof Pagination === 'undefined') {
                console.error("Pagination sınıfı yüklenemedi.");
                return;
            }
            this.pagination = new Pagination({
                containerId: 'paginationControls',
                itemsPerPage: 10,
                itemsPerPageOptions: [10, 25, 50, 100],
                onPageChange: () => {
                    this.renderTasks();
                }
            });
        }

        async loadAllData() {
            const loader = document.getElementById('loadingIndicator');
            if(loader) loader.style.display = 'block';

            try {
                const [tasksResult, ipRecordsResult, personsResult, accrualsResult, transactionTypesResult] = await Promise.all([
                    taskService.getTasksForUser(this.currentUser.uid),
                    ipRecordsService.getRecords(),
                    personService.getPersons(),
                    accrualService.getAccruals(),
                    transactionTypeService.getTransactionTypes()
                ]);

                this.allTasks = tasksResult.success ? tasksResult.data.filter(t => 
                    !['awaiting_client_approval', 'client_approval_closed', 'client_no_response_closed'].includes(t.status)
                ) : [];
                this.allIpRecords = ipRecordsResult.success ? ipRecordsResult.data : [];
                this.allPersons = personsResult.success ? personsResult.data : [];
                this.allAccruals = accrualsResult.success ? accrualsResult.data : [];
                this.allTransactionTypes = transactionTypesResult.success ? transactionTypesResult.data : [];

                this.accrualFormManager.allPersons = this.allPersons;
                this.accrualFormManager.render();

                this.processData();

            } catch (error) {
                console.error(error);
                showNotification('Veriler yüklenirken hata oluştu: ' + error.message, 'error');
            } finally {
                if(loader) loader.style.display = 'none';
            }
        }

        processData() {
            const safeDate = (val) => {
                if (!val) return null;
                try {
                    if (typeof val.toDate === 'function') return val.toDate();
                    if (val.seconds) return new Date(val.seconds * 1000);
                    const d = new Date(val);
                    return isNaN(d.getTime()) ? null : d;
                } catch { return null; }
            };

            this.processedData = this.allTasks.map(task => {
                const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
                const relatedRecordDisplay = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'N/A';
                
                const transactionType = this.allTransactionTypes.find(t => t.id === task.taskType);
                const taskTypeDisplay = transactionType ? (transactionType.alias || transactionType.name) : 'Bilinmiyor';
                
                const statusText = this.statusDisplayMap[task.status] || task.status;

                const searchString = `${task.id} ${task.title || ''} ${relatedRecordDisplay} ${taskTypeDisplay} ${statusText} ${task.priority}`.toLowerCase();

                // Atama Tarihi Verisini Hazırla
                let assignedDateObj = null;
                let assignedAtText = '-';
                if (Array.isArray(task.history)) {
                    const assignEntry = task.history.find(h => h?.action?.includes('atandı'));
                    if (assignEntry?.timestamp) {
                        assignedDateObj = safeDate(assignEntry.timestamp);
                        if (assignedDateObj) assignedAtText = assignedDateObj.toLocaleString('tr-TR');
                    }
                }

                return {
                    ...task,
                    relatedRecordDisplay,
                    taskTypeDisplay,
                    statusText,
                    searchString,
                    dueDateObj: safeDate(task.dueDate),
                    officialDueObj: safeDate(task.officialDueDate),
                    createdAtObj: safeDate(task.createdAt),
                    assignedDateObj: assignedDateObj,
                    assignedAtText: assignedAtText
                };
            });

            this.filteredData = [...this.processedData];
            
            // İlk açılışta sırala
            this.sortData();

            if (this.pagination) {
                this.pagination.update(this.filteredData.length);
            }

            this.renderTasks();
        }

        // --- SIRALAMA (SORTING) FONKSİYONLARI ---
        handleSort(key) {
            if (this.sortState.key === key) {
                this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortState.key = key;
                this.sortState.direction = 'asc';
            }
            this.sortData();
            this.renderTasks();
        }

        sortData() {
            const { key, direction } = this.sortState;
            const multiplier = direction === 'asc' ? 1 : -1;

            this.filteredData.sort((a, b) => {
                let valA = a[key];
                let valB = b[key];

                // Null/Undefined kontrolü
                if (valA == null) valA = '';
                if (valB == null) valB = '';

                // Tarih Sıralaması
                if (valA instanceof Date && valB instanceof Date) {
                    return (valA - valB) * multiplier;
                }
                // Boş tarihler en sona gitsin
                if (valA instanceof Date) return -1 * multiplier; 
                if (valB instanceof Date) return 1 * multiplier;

                // Sayısal ID Sıralaması (Eğer 'id' ise)
                if (key === 'id') {
                    const numA = parseFloat(valA.replace(/[^0-9]/g, ''));
                    const numB = parseFloat(valB.replace(/[^0-9]/g, ''));
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return (numA - numB) * multiplier;
                    }
                }

                // Metin Sıralaması (Türkçe karakter uyumlu)
                valA = valA.toString().toLowerCase();
                valB = valB.toString().toLowerCase();
                return valA.localeCompare(valB, 'tr') * multiplier;
            });
        }

        updateSortIcons() {
            document.querySelectorAll('#myTasksTable thead th[data-sort]').forEach(th => {
                const icon = th.querySelector('i');
                if(!icon) return;
                
                // Hepsini varsayılan yap
                icon.className = 'fas fa-sort';
                icon.style.opacity = '0.3';
                
                // Aktif olanı güncelle
                if (th.dataset.sort === this.sortState.key) {
                    icon.className = this.sortState.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                    icon.style.opacity = '1';
                }
            });
        }
        // ----------------------------------------

        handleSearch(query) {
            const statusFilter = document.getElementById('statusFilter').value;
            const lowerQuery = query.toLowerCase();

            this.filteredData = this.processedData.filter(item => {
                const matchesSearch = !lowerQuery || item.searchString.includes(lowerQuery);
                const matchesStatus = (statusFilter === 'all' || item.status === statusFilter);
                return matchesSearch && matchesStatus;
            });

            this.sortData(); // Aramadan sonra da sıralamayı koru

            if (this.pagination) {
                this.pagination.reset();
                this.pagination.update(this.filteredData.length);
            }

            this.renderTasks();
        }

        setupEventListeners() {
            document.getElementById('taskSearchInput').addEventListener('input', (e) => this.handleSearch(e.target.value));
            document.getElementById('statusFilter').addEventListener('change', () => {
                const query = document.getElementById('taskSearchInput').value;
                this.handleSearch(query);
            });
            
            // --- TABLO BAŞLIKLARI İÇİN EVENT LISTENER (Sıralama) ---
            const headers = document.querySelectorAll('#myTasksTable thead th[data-sort]');
            headers.forEach(th => {
                th.style.cursor = 'pointer'; // Tıklanabilir olduğunu göster
                th.addEventListener('click', () => {
                    this.handleSort(th.dataset.sort);
                });
            });
            // -------------------------------------------------------

            document.getElementById('myTasksTableBody').addEventListener('click', (e) => {
                const btn = e.target.closest('.action-btn');
                if (!btn) return;
                e.preventDefault();
                const taskId = btn.dataset.id;
                
                if (btn.classList.contains('view-btn') || btn.dataset.action === 'view') {
                    this.showTaskDetailModal(taskId);
                } else if (btn.classList.contains('edit-btn') || btn.dataset.action === 'edit') {
                    window.location.href = `task-detail.html?id=${taskId}`;
                } else if (btn.classList.contains('add-accrual-btn')) {
                    this.showCreateAccrualModal(taskId);
                }
            });

            const closeModal = (id) => this.closeModal(id);
            document.getElementById('closeTaskDetailModal')?.addEventListener('click', () => closeModal('taskDetailModal'));
            document.getElementById('closeMyTaskAccrualModal')?.addEventListener('click', () => closeModal('createMyTaskAccrualModal'));
            document.getElementById('cancelCreateMyTaskAccrualBtn')?.addEventListener('click', () => closeModal('createMyTaskAccrualModal'));
            document.getElementById('saveNewMyTaskAccrualBtn')?.addEventListener('click', () => this.handleSaveNewAccrual());
        }

        renderTasks() {
            const tableBody = document.getElementById('myTasksTableBody');
            const noTasksMessage = document.getElementById('noTasksMessage');
            tableBody.innerHTML = '';

            if (this.filteredData.length === 0) {
                if(noTasksMessage) noTasksMessage.style.display = 'block';
                return;
            }
            if(noTasksMessage) noTasksMessage.style.display = 'none';

            let displayData = this.filteredData;
            if (this.pagination) {
                displayData = this.pagination.getCurrentPageData(this.filteredData);
            }

            displayData.forEach(task => {
                const statusClass = `status-${(task.status || '').replace(/ /g, '_').toLowerCase()}`;
                const priorityClass = `priority-${(task.priority || 'normal').toLowerCase()}`;

                const dueDateISO = task.dueDateObj ? task.dueDateObj.toISOString().slice(0,10) : '';
                const officialDueISO = task.officialDueObj ? task.officialDueObj.toISOString().slice(0,10) : '';

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${task.id}</td>
                    <td>${task.relatedRecordDisplay}</td>
                    <td>${task.taskTypeDisplay}</td>
                    <td><span class="priority-badge ${priorityClass}">${task.priority}</span></td>
                    <td data-field="operationalDue" data-date="${dueDateISO}">
                        ${task.dueDateObj ? task.dueDateObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş'}
                    </td>
                    <td data-field="officialDue" data-date="${officialDueISO}">
                        ${task.officialDueObj ? task.officialDueObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş'}
                    </td>
                    <td>${task.createdAtObj ? task.createdAtObj.toLocaleString('tr-TR') : '-'}</td>
                    <td>${task.assignedAtText}</td>
                    <td><span class="status-badge ${statusClass}">${task.statusText}</span></td>
                    <td>
                        <button class="action-btn view-btn" data-id="${task.id}" data-action="view"><i class="fas fa-eye"></i></button>
                        <button class="action-btn edit-btn" data-id="${task.id}" data-action="edit"><i class="fas fa-edit"></i></button>
                        <button class="action-btn add-accrual-btn" data-id="${task.id}">Ek Tahakkuk</button>
                    </td>
                `;
                tableBody.appendChild(row);
            });

            this.updateSortIcons(); // İkonları güncelle

            if (window.DeadlineHighlighter) {
                setTimeout(() => window.DeadlineHighlighter.refresh('islerim'), 50);
            }
        }

        populateStatusFilterDropdown() { /* ... aynı ... */
            const select = document.getElementById('statusFilter');
            if(!select) return;
            select.innerHTML = '<option value="all">Tümü</option>';
            ['open', 'in-progress', 'completed', 'pending', 'cancelled', 'on-hold', 'awaiting-approval'].forEach(st => {
                const opt = document.createElement('option');
                opt.value = st;
                opt.textContent = this.statusDisplayMap[st] || st;
                select.appendChild(opt);
            });
        }

        showTaskDetailModal(taskId) { /* ... aynı ... */
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task || !this.taskDetailManager) return;

            const modal = document.getElementById('taskDetailModal');
            const title = document.getElementById('modalTaskTitle');
            
            modal.classList.add('show');
            title.textContent = 'Yükleniyor...';
            this.taskDetailManager.showLoading();

            const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
            const transactionType = this.allTransactionTypes.find(t => t.id === task.taskType);
            const relatedAccruals = this.allAccruals.filter(acc => String(acc.taskId) === String(task.id));
            const assignedUser = { email: task.assignedTo_email, displayName: task.assignedTo_email };

            title.textContent = `İş Detayı (${task.id})`;
            this.taskDetailManager.render(task, {
                ipRecord, transactionType, assignedUser, accruals: relatedAccruals
            });
        }

        showCreateAccrualModal(taskId) { /* ... aynı ... */
            this.currentTaskForAccrual = this.allTasks.find(t => t.id === taskId);
            if (!this.currentTaskForAccrual) return;
            this.accrualFormManager.reset();
            let epatsDoc = null;
            if (this.currentTaskForAccrual.details?.epatsDocument) {
                epatsDoc = this.currentTaskForAccrual.details.epatsDocument;
            }
            this.accrualFormManager.showEpatsDoc(epatsDoc);
            document.getElementById('createMyTaskAccrualModal').classList.add('show');
        }

        async handleSaveNewAccrual() { /* ... aynı ... */
            if (!this.currentTaskForAccrual) return;
            const result = this.accrualFormManager.getData();
            if (!result.success) { showNotification(result.error, 'error'); return; }
            const formData = result.data;
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Kaydediliyor') : null;

            let uploadedFiles = [];
            if (formData.files && formData.files.length > 0) {
                try {
                    const file = formData.files[0];
                    const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                    const snapshot = await uploadBytes(storageRef, file);
                    const url = await getDownloadURL(snapshot.ref);
                    uploadedFiles.push({ name: file.name, url, type: 'foreign_invoice', documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() });
                } catch(err) { if(loader) loader.hide(); showNotification("Dosya yüklenemedi.", "error"); return; }
            }

            let taskTitle = this.currentTaskForAccrual.title;
            const tType = this.allTransactionTypes.find(t => t.id === this.currentTaskForAccrual.taskType);
            if(tType) taskTitle = tType.alias || tType.name || taskTitle;

            const newAccrual = {
                taskId: this.currentTaskForAccrual.id,
                taskTitle: taskTitle,
                officialFee: formData.officialFee, serviceFee: formData.serviceFee,
                vatRate: formData.vatRate, applyVatToOfficialFee: formData.applyVatToOfficialFee,
                totalAmount: formData.totalAmount, totalAmountCurrency: 'TRY', remainingAmount: formData.totalAmount,
                status: 'unpaid', tpInvoiceParty: formData.tpInvoiceParty, serviceInvoiceParty: formData.serviceInvoiceParty,
                isForeignTransaction: formData.isForeignTransaction, createdAt: new Date().toISOString(), files: uploadedFiles
            };

            try {
                const res = await accrualService.addAccrual(newAccrual);
                if(loader) loader.hide();
                if (res.success) {
                    showNotification('Ek tahakkuk oluşturuldu!', 'success');
                    this.closeModal('createMyTaskAccrualModal');
                } else { showNotification('Hata: ' + res.error, 'error'); }
            } catch(e) { if(loader) loader.hide(); showNotification('Beklenmeyen hata.', 'error'); }
        }

        closeModal(modalId) { /* ... aynı ... */
            document.getElementById(modalId).classList.remove('show');
            if (modalId === 'createMyTaskAccrualModal') {
                this.accrualFormManager.reset();
                this.currentTaskForAccrual = null;
            }
        }
    }

    new MyTasksModule().init();

    if (window.DeadlineHighlighter) {
        window.DeadlineHighlighter.init();
        window.DeadlineHighlighter.registerList('islerim', {
            container: '#myTasksTable',
            rowSelector: 'tbody tr',
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