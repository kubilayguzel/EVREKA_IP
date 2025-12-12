// public/js/task-management/my-tasks.js

import { authService, taskService, ipRecordsService, accrualService, personService, transactionTypeService } from '../firebase-config.js';
import { showNotification } from '../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../firebase-config.js';

// Modüller
import { TaskDetailManager } from '../components/TaskDetailManager.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'my-tasks.html' });

    class MyTasksModule {
        constructor() {
            this.currentUser = null;
            this.storage = getStorage();

            // Veri Havuzları
            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allAccruals = [];
            this.allTransactionTypes = [];

            // Yönetilen Task
            this.currentTaskForAccrual = null;

            // Managerlar
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
            // TaskDetailManager Başlat
            this.taskDetailManager = new TaskDetailManager('modalBody');
            
            // AccrualFormManager Başlat (Henüz kişi listesi boş, loadAllData'da güncellenecek)
            // 'createMyTaskAccrualFormContainer' ID'li div HTML'de yer alacak.
            this.accrualFormManager = new AccrualFormManager('createMyTaskAccrualFormContainer', 'myTaskAcc');
            
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

        async loadAllData() {
            const loader = document.getElementById('loadingIndicator');
            if(loader) loader.style.display = 'block';

            try {
                // Paralel Veri Çekme
                const [tasksResult, ipRecordsResult, personsResult, accrualsResult, transactionTypesResult] = await Promise.all([
                    taskService.getTasksForUser(this.currentUser.uid),
                    ipRecordsService.getRecords(),
                    personService.getPersons(),
                    accrualService.getAccruals(),
                    transactionTypeService.getTransactionTypes()
                ]);

                // Verileri Ata
                this.allTasks = tasksResult.success ? tasksResult.data.filter(t => 
                    !['awaiting_client_approval', 'client_approval_closed', 'client_no_response_closed'].includes(t.status)
                ) : [];
                this.allIpRecords = ipRecordsResult.success ? ipRecordsResult.data : [];
                this.allPersons = personsResult.success ? personsResult.data : [];
                this.allAccruals = accrualsResult.success ? accrualsResult.data : [];
                this.allTransactionTypes = transactionTypesResult.success ? transactionTypesResult.data : [];

                // Form Manager'a kişi listesini ver ve render et
                this.accrualFormManager.allPersons = this.allPersons;
                this.accrualFormManager.render();

                this.renderTasks();

            } catch (error) {
                console.error(error);
                showNotification('Veriler yüklenirken hata oluştu: ' + error.message, 'error');
            } finally {
                if(loader) loader.style.display = 'none';
            }
        }

        setupEventListeners() {
            // Filtreleme
            document.getElementById('statusFilter').addEventListener('change', (e) => this.renderTasks(e.target.value));
            
            // Tablo Butonları (Event Delegation)
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

            // Modal Kapatma Butonları
            const closeModal = (id) => this.closeModal(id);
            document.getElementById('closeTaskDetailModal')?.addEventListener('click', () => closeModal('taskDetailModal'));
            document.getElementById('closeMyTaskAccrualModal')?.addEventListener('click', () => closeModal('createMyTaskAccrualModal'));
            document.getElementById('cancelCreateMyTaskAccrualBtn')?.addEventListener('click', () => closeModal('createMyTaskAccrualModal'));

            // Tahakkuk Kaydet Butonu
            document.getElementById('saveNewMyTaskAccrualBtn')?.addEventListener('click', () => this.handleSaveNewAccrual());
        }

        renderTasks(filterStatus = 'all') {
            const tableBody = document.getElementById('myTasksTableBody');
            const noTasksMessage = document.getElementById('noTasksMessage');
            tableBody.innerHTML = '';

            const filteredTasks = this.allTasks.filter(task => (filterStatus === 'all' || task.status === filterStatus));
            
            if (filteredTasks.length === 0) {
                if(noTasksMessage) noTasksMessage.style.display = 'block';
                return;
            }
            if(noTasksMessage) noTasksMessage.style.display = 'none';

            // Tarih Güvenlik Fonksiyonu
            const safeDate = (val) => {
                if (!val) return null;
                try {
                    if (typeof val.toDate === 'function') return val.toDate();
                    if (val.seconds) return new Date(val.seconds * 1000);
                    const d = new Date(val);
                    return isNaN(d.getTime()) ? null : d;
                } catch { return null; }
            };

            filteredTasks.forEach(task => {
                const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
                const relatedRecordDisplay = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'N/A';
                
                const statusClass = `status-${(task.status || '').replace(/ /g, '_').toLowerCase()}`;
                const priorityClass = `priority-${(task.priority || 'normal').toLowerCase()}`;

                const dueDateObj = safeDate(task.dueDate);
                const officialDueObj = safeDate(task.officialDueDate);
                const createdAtObj = safeDate(task.createdAt);

                // Atanma Tarihi Bulma
                let assignedAtText = '-';
                if (Array.isArray(task.history)) {
                    const assigns = task.history.filter(h => h?.action?.includes('atandı'));
                    const lastAssign = assigns.length ? assigns[assigns.length - 1] : null;
                    if (lastAssign?.timestamp) {
                        const d = safeDate(lastAssign.timestamp);
                        if(d) assignedAtText = d.toLocaleString('tr-TR');
                    }
                }

                const transactionType = this.allTransactionTypes.find(t => t.id === task.taskType);
                const taskTypeDisplay = transactionType ? (transactionType.alias || transactionType.name) : 'Bilinmiyor';

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${task.id}</td>
                    <td>${relatedRecordDisplay}</td>
                    <td>${taskTypeDisplay}</td>
                    <td><span class="priority-badge ${priorityClass}">${task.priority}</span></td>
                    <td data-field="operationalDue" data-date="${dueDateObj ? dueDateObj.toISOString().slice(0,10) : ''}">
                        ${dueDateObj ? dueDateObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş'}
                    </td>
                    <td data-field="officialDue" data-date="${officialDueObj ? officialDueObj.toISOString().slice(0,10) : ''}">
                        ${officialDueObj ? officialDueObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş'}
                    </td>
                    <td>${createdAtObj ? createdAtObj.toLocaleString('tr-TR') : '-'}</td>
                    <td>${assignedAtText}</td>
                    <td><span class="status-badge ${statusClass}">${this.statusDisplayMap[task.status] || task.status}</span></td>
                    <td>
                        <button class="action-btn view-btn" data-id="${task.id}" data-action="view">Görüntüle</button>
                        <button class="action-btn edit-btn" data-id="${task.id}" data-action="edit">Düzenle</button>
                        <button class="action-btn add-accrual-btn" data-id="${task.id}">Ek Tahakkuk Oluştur</button>
                    </td>
                `;
                tableBody.appendChild(row);
            });

            // Renklendirme
            if (window.DeadlineHighlighter) DeadlineHighlighter.refresh('islerim');
        }

        populateStatusFilterDropdown() {
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

        // --- MODAL İŞLEMLERİ ---

        showTaskDetailModal(taskId) {
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task || !this.taskDetailManager) return;

            const modal = document.getElementById('taskDetailModal');
            const title = document.getElementById('modalTaskTitle');
            
            modal.classList.add('show');
            title.textContent = 'Yükleniyor...';
            this.taskDetailManager.showLoading();

            // İlişkili Veriler
            const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
            const transactionType = this.allTransactionTypes.find(t => t.id === task.taskType);
            const relatedAccruals = this.allAccruals.filter(acc => String(acc.taskId) === String(task.id));
            const assignedUser = { email: task.assignedTo_email, displayName: task.assignedTo_email }; 

            title.textContent = `İş Detayı (${task.id})`;
            this.taskDetailManager.render(task, {
                ipRecord,
                transactionType,
                assignedUser,
                accruals: relatedAccruals
            });
        }

        showCreateAccrualModal(taskId) {
            this.currentTaskForAccrual = this.allTasks.find(t => t.id === taskId);
            if (!this.currentTaskForAccrual) return;

            // Form Manager Sıfırla
            this.accrualFormManager.reset();
            
            // EPATS Belgesi varsa Manager'a göster
            let epatsDoc = null;
            if (this.currentTaskForAccrual.details?.epatsDocument) {
                epatsDoc = this.currentTaskForAccrual.details.epatsDocument;
            }
            this.accrualFormManager.showEpatsDoc(epatsDoc);

            document.getElementById('createMyTaskAccrualModal').classList.add('show');
        }

        async handleSaveNewAccrual() {
            if (!this.currentTaskForAccrual) return;

            // Manager'dan veriyi al
            const result = this.accrualFormManager.getData();
            if (!result.success) {
                showNotification(result.error, 'error');
                return;
            }
            const formData = result.data;

            let loader = window.showSimpleLoading ? window.showSimpleLoading('Kaydediliyor') : null;

            // Dosya Yükleme
            let uploadedFiles = [];
            if (formData.files && formData.files.length > 0) {
                try {
                    const file = formData.files[0];
                    const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                    const snapshot = await uploadBytes(storageRef, file);
                    const url = await getDownloadURL(snapshot.ref);
                    uploadedFiles.push({ 
                        name: file.name, url, type: 'foreign_invoice', 
                        documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() 
                    });
                } catch(err) { 
                    if(loader) loader.hide(); 
                    showNotification("Dosya yüklenemedi.", "error"); return; 
                }
            }

            // Alias Bulma (Opsiyonel)
            let taskTitle = this.currentTaskForAccrual.title;
            const tType = this.allTransactionTypes.find(t => t.id === this.currentTaskForAccrual.taskType);
            if(tType) taskTitle = tType.alias || tType.name || taskTitle;

            const newAccrual = {
                taskId: this.currentTaskForAccrual.id,
                taskTitle: taskTitle,
                officialFee: formData.officialFee,
                serviceFee: formData.serviceFee,
                vatRate: formData.vatRate,
                applyVatToOfficialFee: formData.applyVatToOfficialFee,
                totalAmount: formData.totalAmount, // Array geliyor
                totalAmountCurrency: 'TRY', // Geriye uyumluluk
                remainingAmount: formData.totalAmount,
                status: 'unpaid',
                tpInvoiceParty: formData.tpInvoiceParty,
                serviceInvoiceParty: formData.serviceInvoiceParty,
                isForeignTransaction: formData.isForeignTransaction,
                createdAt: new Date().toISOString(),
                files: uploadedFiles
            };

            try {
                const res = await accrualService.addAccrual(newAccrual);
                if(loader) loader.hide();

                if (res.success) {
                    showNotification('Ek tahakkuk oluşturuldu!', 'success');
                    this.closeModal('createMyTaskAccrualModal');
                    await this.loadAllData(); // Tabloyu yenile
                } else {
                    showNotification('Hata: ' + res.error, 'error');
                }
            } catch(e) {
                if(loader) loader.hide();
                showNotification('Beklenmeyen hata.', 'error');
            }
        }

        closeModal(modalId) {
            document.getElementById(modalId).classList.remove('show');
            if (modalId === 'createMyTaskAccrualModal') {
                this.accrualFormManager.reset();
                this.currentTaskForAccrual = null;
            }
        }
    }

    new MyTasksModule().init();

    // Deadline Highlighter Init
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