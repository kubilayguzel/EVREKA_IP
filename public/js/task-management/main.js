// public/js/task-management/main.js

import { authService, taskService, ipRecordsService, accrualService, personService, transactionTypeService } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../firebase-config.js'; // db importu eklendi

// Pagination modülü
import Pagination from '../pagination.js'; 

// YENİ: Ortak Form Yöneticisi Modülü
import { AccrualFormManager } from '../components/AccrualFormManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'task-management.html' });

    class TaskManagementModule {
        constructor() {
            this.currentUser = null;
            this.storage = getStorage();

            // Veri Havuzu
            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allUsers = [];
            this.allTransactionTypes = [];
            this.allAccruals = [];

            // İşlenmiş Veriler
            this.processedData = []; 
            this.filteredData = [];

            // Tablo Durumu
            this.sortState = { key: 'id', direction: 'desc' };

            // Pagination Instance
            this.pagination = null;

            // Seçim State'leri
            this.selectedTaskForAssignment = null;
            this.currentTaskForAccrual = null;

            // Form Yöneticileri (Managers)
            this.createTaskFormManager = null;
            this.completeTaskFormManager = null;

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
            this.setupStaticEventListeners();
            this.initializePagination();

            authService.auth.onAuthStateChanged(async (user) => {
                if (user || authService.getCurrentUser()) {
                    this.currentUser = authService.getCurrentUser();
                    await this.loadAllData();
                } else {
                    window.location.href = 'index.html';
                }
            });
        }

        initializePagination() {
            if (typeof Pagination === 'undefined') {
                console.error("Pagination sınıfı yüklenemedi. Import yolunu kontrol edin.");
                return;
            }

            this.pagination = new Pagination({
                containerId: 'paginationContainer',
                itemsPerPage: 10,
                itemsPerPageOptions: [10, 25, 50, 100],
                onPageChange: (page, itemsPerPage) => {
                    this.renderTable();
                }
            });
        }

        async loadAllData() {
            let loader = null;
            if (window.showSimpleLoading) {
                loader = window.showSimpleLoading('Veriler Yükleniyor', 'Lütfen bekleyiniz...');
            } else {
                const oldLoader = document.getElementById('loadingIndicator');
                if(oldLoader) oldLoader.style.display = 'block';
            }

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

                // YENİ: Veriler yüklendikten sonra formları başlatıyoruz (Kişi listesi gerekli)
                this.initForms();

                this.processData();
                
                if (this.pagination) {
                    this.pagination.update(this.filteredData.length);
                }
                
                this.renderTable();

            } catch (error) {
                console.error(error);
                if (loader) loader.hide(); 
                showNotification('Veriler yüklenirken bir hata oluştu: ' + error.message, 'error');
            } finally {
                if (loader) loader.hide();
                const oldLoader = document.getElementById('loadingIndicator');
                if(oldLoader) oldLoader.style.display = 'none';
            }
        }

        // --- YENİ: Form Yöneticilerini Başlatma ---
        initForms() {
            // 1. Ek Tahakkuk Formu (Prefix: 'createTask')
            // Bu, 'createTaskAccrualFormContainer' içine render edilecek
            this.createTaskFormManager = new AccrualFormManager(
                'createTaskAccrualFormContainer', 
                'createTask', 
                this.allPersons
            );
            this.createTaskFormManager.render();

            // 2. Tamamlama Formu (Prefix: 'comp')
            // Bu, 'completeAccrualFormContainer' içine render edilecek
            this.completeTaskFormManager = new AccrualFormManager(
                'completeAccrualFormContainer', 
                'comp', 
                this.allPersons
            );
            this.completeTaskFormManager.render();
        }

        processData() {
            this.processedData = this.allTasks.map(task => {
                const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
                const relatedRecord = ipRecord ? (ipRecord.applicationNumber || ipRecord.title || 'Kayıt Bulunamadı') : 'N/A';

                const transactionTypeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                const taskTypeDisplay = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || 'Bilinmiyor');

                const assignedUser = this.allUsers.find(user => user.id === task.assignedTo_uid);
                const assignedToDisplay = assignedUser ? (assignedUser.displayName || assignedUser.email) : 'Atanmamış';

                const dueDateObj = task.dueDate ? (task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate)) : null;
                const operationalDueISO = dueDateObj ? dueDateObj.toISOString().slice(0, 10) : ''; 
                const operationalDueDisplay = dueDateObj ? dueDateObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                const officialDateObj = task.officialDueDate ? (task.officialDueDate.toDate ? task.officialDueDate.toDate() : (task.officialDueDate.seconds ? new Date(task.officialDueDate.seconds * 1000) : new Date(task.officialDueDate))) : null;
                const officialDueISO = officialDateObj ? officialDateObj.toISOString().slice(0, 10) : '';
                const officialDueDisplay = officialDateObj ? officialDateObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                const searchString = `${task.id} ${task.title || ''} ${relatedRecord} ${taskTypeDisplay} ${assignedToDisplay} ${this.statusDisplayMap[task.status] || task.status}`.toLowerCase();

                return {
                    ...task,
                    relatedRecord,
                    taskTypeDisplay,
                    assignedToDisplay,
                    operationalDue: operationalDueISO,
                    officialDue: officialDueISO,
                    operationalDueDisplay,
                    officialDueDisplay,
                    searchString
                };
            });

            this.filteredData = [...this.processedData];
            this.sortData();
        }

        renderTable() {
            const tbody = document.getElementById('tasksTableBody');
            const noRecordsMsg = document.getElementById('noTasksMessage');
            
            if (!tbody) return;
            tbody.innerHTML = '';

            if (this.filteredData.length === 0) {
                if (noRecordsMsg) noRecordsMsg.style.display = 'block';
                if (this.pagination) this.pagination.update(0);
                return;
            } else {
                if (noRecordsMsg) noRecordsMsg.style.display = 'none';
            }

            let currentData = this.filteredData;
            
            if (this.pagination) {
                currentData = this.pagination.getCurrentPageData(this.filteredData);
            }

            let html = '';
            currentData.forEach(task => {
                const safeStatus = (task.status || '').toString();
                const statusClass = `status-${safeStatus.replace(/ /g, '_').toLowerCase()}`;
                const statusText = this.statusDisplayMap[safeStatus] || safeStatus;
                
                const safePriority = (task.priority || 'normal').toString();
                const priorityClass = `priority-${safePriority.toLowerCase()}`;

                html += `
                    <tr>
                        <td>${task.id}</td>
                        <td>${task.relatedRecord}</td>
                        <td>${task.taskTypeDisplay}</td>
                        <td><span class="priority-badge ${priorityClass}">${safePriority}</span></td>
                        <td>${task.assignedToDisplay}</td>
                        <td data-field="operationalDue" data-date="${task.operationalDue}">${task.operationalDueDisplay}</td>
                        <td data-field="officialDue" data-date="${task.officialDue}">${task.officialDueDisplay}</td>
                        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                        <td>${this.getActionButtonsHtml(task)}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;

            this.updateSortIcons();

            if (window.DeadlineHighlighter && typeof window.DeadlineHighlighter.refresh === 'function') {
                setTimeout(() => window.DeadlineHighlighter.refresh('taskManagement'), 50);
            }
        }

        handleSearch(query) {
            if (!query) {
                this.filteredData = [...this.processedData];
            } else {
                const lowerQuery = query.toLowerCase();
                this.filteredData = this.processedData.filter(item => 
                    item.searchString.includes(lowerQuery)
                );
            }
            
            this.sortData();
            
            if (this.pagination) {
                this.pagination.reset();
                this.pagination.update(this.filteredData.length);
            } else {
                this.renderTable();
            }
        }

        handleSort(key) {
            if (this.sortState.key === key) {
                this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortState.key = key;
                this.sortState.direction = 'asc';
            }
            this.sortData();
            this.renderTable();
        }

        sortData() {
            const { key, direction } = this.sortState;
            const multiplier = direction === 'asc' ? 1 : -1;
            this.filteredData.sort((a, b) => {
                let valA = a[key] || '';
                let valB = b[key] || '';
                if (!isNaN(parseFloat(valA)) && isFinite(valA) && !isNaN(parseFloat(valB)) && isFinite(valB)) {
                    return (parseFloat(valA) - parseFloat(valB)) * multiplier;
                }
                valA = valA.toString().toLowerCase();
                valB = valB.toString().toLowerCase();
                return valA.localeCompare(valB, 'tr') * multiplier;
            });
        }

        updateSortIcons() {
            document.querySelectorAll('#tasksTableHeaderRow th[data-sort]').forEach(th => {
                const icon = th.querySelector('i');
                if(!icon) return;
                icon.className = 'fas fa-sort';
                icon.style.opacity = '0.3';
                if (th.dataset.sort === this.sortState.key) {
                    icon.className = this.sortState.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                    icon.style.opacity = '1';
                }
            });
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

        showTaskDetailModal(taskId) {
            // Task Detail Modalı (Değişmedi)
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            const modalBody = document.getElementById('modalBody');
            const modalTitle = document.getElementById('modalTaskTitle');
            const modalElement = document.getElementById('taskDetailModal');

            if (!modalBody || !modalTitle || !modalElement) return;

            modalTitle.textContent = `İş Detayı Yükleniyor...`;
            modalElement.classList.add('show');
            modalBody.innerHTML = '<div class="text-center p-4"><i class="fas fa-circle-notch fa-spin fa-2x text-primary"></i><br><br>Veriler getiriliyor...</div>';

            this.renderTaskDetailContent(taskId, modalBody, modalTitle);
        }

        // Task Detail İçerik Render (Daha önce yaptığımız güncel hali)
        async renderTaskDetailContent(taskId, body, titleElement) {
            try {
                const taskRef = doc(db, 'tasks', String(taskId));
                const taskSnap = await getDoc(taskRef);

                if (!taskSnap.exists()) {
                    body.innerHTML = '<div class="alert alert-danger">Bu iş kaydı bulunamadı.</div>';
                    titleElement.textContent = 'Hata';
                    return;
                }
                const task = { id: taskSnap.id, ...taskSnap.data() };
                titleElement.textContent = `İş Detayı (${task.id})`;

                // Yardımcı veriler
                let ipRecord = null;
                if (task.relatedIpRecordId) {
                    try {
                        const ipRef = doc(db, 'ipRecords', String(task.relatedIpRecordId));
                        const ipSnap = await getDoc(ipRef);
                        if(ipSnap.exists()) ipRecord = { id: ipSnap.id, ...ipSnap.data() };
                    } catch(e) {}
                }

                let transactionTypeObj = null;
                if (task.taskType) {
                    transactionTypeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                }

                const statusDisplayMap = {
                    'open': 'Açık', 'in-progress': 'Devam Ediyor', 'completed': 'Tamamlandı',
                    'pending': 'Beklemede', 'cancelled': 'İptal Edildi', 'on-hold': 'Askıda',
                    'awaiting-approval': 'Onay Bekliyor', 'awaiting_client_approval': 'Müvekkil Onayı Bekliyor',
                    'client_approval_opened': 'Müvekkil Onayı - Açıldı', 'client_approval_closed': 'Müvekkil Onayı - Kapatıldı',
                    'client_no_response_closed': 'Müvekkil Cevaplamadı - Kapatıldı'
                };

                const formatDate = (dateVal) => {
                    if (!dateVal) return '-';
                    try {
                        const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
                        return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('tr-TR');
                    } catch(e) { return '-'; }
                };

                const formatCurrency = (amount, currency) => {
                    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency || 'TRY' }).format(amount || 0);
                };

                const assignedUser = this.allUsers.find(u => u.id === task.assignedTo_uid);
                const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : (task.assignedTo_email || 'Atanmamış');
                const relatedRecordTxt = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'İlgili kayıt bulunamadı';
                const taskTypeDisplay = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || '-');
                const statusText = statusDisplayMap[task.status] || task.status;

                const relatedAccruals = this.allAccruals.filter(acc => String(acc.taskId) === String(task.id));
                let accrualsHtml = '';
                if (relatedAccruals.length > 0) {
                    let rows = relatedAccruals.map(acc => {
                        const accStatusBadge = acc.status === 'paid' 
                            ? '<span style="color:green; font-weight:bold;">Ödendi</span>' 
                            : '<span style="color:orange; font-weight:bold;">Ödenmedi</span>';
                        return `
                            <tr style="border-bottom: 1px solid #eee;">
                                <td style="padding:8px;">#${acc.id || '-'}</td>
                                <td style="padding:8px; font-weight:bold;">${formatCurrency(acc.totalAmount, acc.totalAmountCurrency)}</td>
                                <td style="padding:8px;">${accStatusBadge}</td>
                                <td style="padding:8px; color:#666;">${formatDate(acc.createdAt)}</td>
                            </tr>`;
                    }).join('');
                    
                    accrualsHtml = `
                        <div class="view-box" style="display:block; padding:0; overflow:hidden;">
                            <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                                <thead style="background:#f8f9fa; border-bottom:2px solid #e9ecef;">
                                    <tr>
                                        <th style="padding:10px; text-align:left;">ID</th>
                                        <th style="padding:10px; text-align:left;">Tutar</th>
                                        <th style="padding:10px; text-align:left;">Durum</th>
                                        <th style="padding:10px; text-align:left;">Tarih</th>
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>`;
                } else {
                    accrualsHtml = `<div class="view-box text-muted font-italic small"><i class="fas fa-info-circle mr-2"></i>Bu işe bağlı tahakkuk kaydı bulunmamaktadır.</div>`;
                }

                let docsContent = '';
                if (task.details && task.details.epatsDocument && (task.details.epatsDocument.url || task.details.epatsDocument.downloadURL)) {
                    const doc = task.details.epatsDocument;
                    const url = doc.url || doc.downloadURL;
                    docsContent += `
                    <div class="col-12 mb-2">
                        <div class="view-box d-flex justify-content-between align-items-center" style="border-left: 4px solid #007bff; background:#f0f7ff;">
                            <div class="d-flex align-items-center">
                                <i class="fas fa-file-contract text-primary fa-lg mr-3" style="margin-right:10px;"></i>
                                <div>
                                    <strong class="d-block text-dark" style="font-size:0.9rem;">EPATS Belgesi</strong>
                                    <small class="text-muted">${doc.name || 'Dosya'}</small>
                                </div>
                            </div>
                            <a href="${url}" target="_blank" class="btn btn-sm btn-primary">Aç</a>
                        </div>
                    </div>`;
                }

                const files = task.files || (task.details ? task.details.files : []) || [];
                if (files.length > 0) {
                    files.forEach(file => {
                        const epatsUrl = (task.details && task.details.epatsDocument) ? (task.details.epatsDocument.url || task.details.epatsDocument.downloadURL) : null;
                        const fileUrl = file.url || file.content;
                        if (epatsUrl && (fileUrl === epatsUrl)) return;

                        docsContent += `
                        <div class="col-md-6 mb-2">
                            <div class="view-box d-flex justify-content-between align-items-center">
                                <div class="d-flex align-items-center text-truncate" style="max-width: 80%;">
                                    <i class="fas fa-paperclip text-secondary mr-2" style="margin-right:8px;"></i>
                                    <span class="text-truncate small" title="${file.name}">${file.name}</span>
                                </div>
                                <a href="${fileUrl}" target="_blank" class="btn btn-sm btn-light border"><i class="fas fa-download"></i></a>
                            </div>
                        </div>`;
                    });
                }
                
                if (docsContent === '') {
                    docsContent = `<div class="col-12"><div class="view-box text-muted font-italic small">Ekli belge bulunmamaktadır.</div></div>`;
                } else {
                    docsContent = `<div class="row" style="margin:0 -5px;">${docsContent}</div>`;
                }

                let html = `
                    <div class="container-fluid p-0">
                        <div class="section-header mt-0"><i class="fas fa-info-circle mr-2"></i> GENEL BİLGİLER</div>
                        
                        <div class="mb-3">
                            <label class="view-label">İş Konusu</label>
                            <div class="view-box font-weight-bold text-dark" style="background-color: #f8f9fa;">${task.title || '-'}</div>
                        </div>

                        <div class="form-grid">
                            <div class="form-group">
                                <label class="view-label">İlgili Dosya</label>
                                <div class="view-box">${relatedRecordTxt}</div>
                            </div>
                            <div class="form-group">
                                <label class="view-label">İş Tipi</label>
                                <div class="view-box">${taskTypeDisplay}</div>
                            </div>
                            <div class="form-group">
                                <label class="view-label">Atanan Kişi</label>
                                <div class="view-box"><i class="fas fa-user-circle mr-2 text-muted" style="margin-right:5px;"></i> ${assignedName}</div>
                            </div>
                            <div class="form-group">
                                <label class="view-label">Güncel Durum</label>
                                <div class="view-box font-weight-bold" style="color:#1e3c72;">${statusText}</div>
                            </div>
                        </div>

                        <div class="section-header"><i class="far fa-calendar-alt mr-2"></i> TARİHLER</div>
                        <div class="form-grid">
                            <div class="form-group">
                                <label class="view-label">Operasyonel Son Tarih</label>
                                <div class="view-box"><i class="far fa-clock mr-2 text-warning" style="margin-right:5px;"></i> ${formatDate(task.dueDate)}</div>
                            </div>
                            <div class="form-group">
                                <label class="view-label">Resmi Son Tarih</label>
                                <div class="view-box"><i class="far fa-calendar-check mr-2 text-danger" style="margin-right:5px;"></i> ${formatDate(task.officialDueDate)}</div>
                            </div>
                        </div>

                        <div class="section-header"><i class="fas fa-folder-open mr-2"></i> BELGELER</div>
                        <div class="mb-3">
                            ${docsContent}
                        </div>

                        <div class="section-header"><i class="fas fa-coins mr-2"></i> BAĞLI TAHAKKUKLAR</div>
                        <div class="mb-3">
                            ${accrualsHtml}
                        </div>

                        <div class="section-header"><i class="fas fa-align-left mr-2"></i> AÇIKLAMA & NOTLAR</div>
                        <div class="view-box" style="min-height: 80px; white-space: pre-wrap; background:#fff;">${task.description || '<span class="text-muted font-italic">Açıklama girilmemiş.</span>'}</div>
                    </div>`;

                body.innerHTML = html;

            } catch (error) {
                console.error(error);
                body.innerHTML = '<div class="alert alert-danger">Veri yüklenirken hata oluştu: ' + error.message + '</div>';
            }
        }

        setupStaticEventListeners() {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
            }

            const headers = document.querySelectorAll('#tasksTableHeaderRow th[data-sort]');
            headers.forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    this.handleSort(th.dataset.sort);
                });
            });

            const tbody = document.getElementById('tasksTableBody');
            if (tbody) {
                tbody.addEventListener('click', (e) => {
                    const btn = e.target.closest('.action-btn');
                    if (!btn) return;
                    e.preventDefault();
                    e.stopPropagation();
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

            document.querySelectorAll('.close-modal-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const modal = e.target.closest('.modal');
                    if (modal) this.closeModal(modal.id);
                });
            });

            document.getElementById('cancelAssignmentBtn')?.addEventListener('click', () => this.closeModal('assignTaskModal'));
            document.getElementById('saveNewAssignmentBtn')?.addEventListener('click', () => this.saveNewAssignment());

            // YENİ: Modal Butonları
            document.getElementById('cancelCreateTaskAccrualBtn')?.addEventListener('click', () => this.closeModal('createTaskAccrualModal'));
            document.getElementById('saveNewAccrualBtn')?.addEventListener('click', () => this.handleSaveNewAccrual());

            document.getElementById('cancelCompleteAccrualBtn')?.addEventListener('click', () => this.closeModal('completeAccrualTaskModal'));
            document.getElementById('submitCompleteAccrualBtn')?.addEventListener('click', () => this.handleCompleteAccrualSubmission());
        }

        // --- YENİ: Ek Tahakkuk Modal Yönetimi ---
        showCreateTaskAccrualModal(taskId) {
            this.currentTaskForAccrual = this.allTasks.find(t => t.id === taskId);
            if (!this.currentTaskForAccrual) { showNotification('İş bulunamadı.', 'error'); return; }
            
            document.getElementById('createTaskAccrualTaskTitleDisplay').value = `${this.currentTaskForAccrual.title} (${this.currentTaskForAccrual.id})`;
            
            if(this.createTaskFormManager) {
                this.createTaskFormManager.reset();

                // --- YENİ EKLENEN KISIM: EPATS Belgesini Bul ve Göster ---
                let epatsDoc = null;
                // 1. Direkt task üzerinde var mı?
                if (this.currentTaskForAccrual.details && this.currentTaskForAccrual.details.epatsDocument) {
                    epatsDoc = this.currentTaskForAccrual.details.epatsDocument;
                } 
                // 2. Yoksa ve bu bir alt task ise, ana task'a bak
                else if (this.currentTaskForAccrual.relatedTaskId) {
                    const parent = this.allTasks.find(t => t.id === this.currentTaskForAccrual.relatedTaskId);
                    if (parent && parent.details) epatsDoc = parent.details.epatsDocument;
                }
                // Belgeyi Manager'a gönder
                this.createTaskFormManager.showEpatsDoc(epatsDoc);
                // --------------------------------------------------------
            }
            
            document.getElementById('createTaskAccrualModal').classList.add('show');
        }

        async handleSaveNewAccrual() {
            if (!this.currentTaskForAccrual) return;

            // 1. Manager'dan verileri al
            const result = this.createTaskFormManager.getData();
            if (!result.success) {
                showNotification(result.error, 'error');
                return;
            }
            const formData = result.data;

            let loader = null;
            if(window.showSimpleLoading) loader = window.showSimpleLoading('Ek Tahakkuk Oluşturuluyor');

            // 2. Dosya Yükleme
            let uploadedFiles = [];
            if (formData.files && formData.files.length > 0) {
                try {
                    const file = formData.files[0];
                    const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                    const snapshot = await uploadBytes(storageRef, file);
                    const url = await getDownloadURL(snapshot.ref);
                    uploadedFiles.push({ name: file.name, url, type: 'foreign_invoice', documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() });
                } catch(err) { 
                    if(loader) loader.hide(); showNotification("Dosya yüklenemedi.", "error"); return; 
                }
            }

            // 3. Veri Objesi
            const newAccrual = {
                taskId: this.currentTaskForAccrual.id,
                taskTitle: this.currentTaskForAccrual.title,
                officialFee: formData.officialFee,
                serviceFee: formData.serviceFee,
                vatRate: formData.vatRate, 
                applyVatToOfficialFee: formData.applyVatToOfficialFee,
                totalAmount: formData.totalAmount, 
                totalAmountCurrency: 'TRY', 
                remainingAmount: formData.totalAmount, 
                status: 'unpaid',
                tpInvoiceParty: formData.tpInvoiceParty,
                serviceInvoiceParty: formData.serviceInvoiceParty,
                isForeignTransaction: formData.isForeignTransaction, 
                createdAt: new Date().toISOString(),
                files: uploadedFiles
            };

            const res = await accrualService.addAccrual(newAccrual);
            if(loader) loader.hide();

            if (res.success) { 
                showNotification('Ek tahakkuk oluşturuldu!', 'success'); 
                this.closeModal('createTaskAccrualModal'); 
                await this.loadAllData(); 
            } else { showNotification('Hata: ' + res.error, 'error'); }
        }

        // --- YENİ: Tahakkuk Tamamlama Modal Yönetimi ---
        openCompleteAccrualModal(taskId) {
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            document.getElementById('targetTaskIdForCompletion').value = taskId;

            // 1. Manager'ı Sıfırla
            if(this.completeTaskFormManager) {
                this.completeTaskFormManager.reset();
                
                // 2. EPATS Belgesi Varsa Manager'a Gönder
                let epatsDoc = null;
                if (task.details && task.details.epatsDocument) epatsDoc = task.details.epatsDocument;
                else if (task.relatedTaskId) {
                    const parent = this.allTasks.find(t => t.id === task.relatedTaskId);
                    if (parent && parent.details) epatsDoc = parent.details.epatsDocument;
                }
                this.completeTaskFormManager.showEpatsDoc(epatsDoc);
            }

            document.getElementById('completeAccrualTaskModal').classList.add('show');
        }

        async handleCompleteAccrualSubmission() {
             const taskId = document.getElementById('targetTaskIdForCompletion')?.value;
             const task = this.allTasks.find(t => t.id === taskId);
             if(!task) return;

             // 1. Manager'dan verileri al
             const result = this.completeTaskFormManager.getData();
             if(!result.success) { showNotification(result.error, 'error'); return; }
             const formData = result.data;

             let loader = null;
             if(window.showSimpleLoading) loader = window.showSimpleLoading('Tahakkuk Oluşturuluyor');

             // 2. Dosya Yükleme
             let uploadedFiles = [];
             if (formData.files && formData.files.length > 0) {
                 try {
                     const file = formData.files[0];
                     const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                     const snapshot = await uploadBytes(storageRef, file);
                     const url = await getDownloadURL(snapshot.ref);
                     uploadedFiles.push({ name: file.name, url, type: 'foreign_invoice', documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() });
                 } catch(err) { if(loader) loader.hide(); showNotification("Dosya yükleme hatası.", "error"); return; }
             }

             const cleanTitle = task.title ? task.title.replace('Tahakkuk Oluşturma: ', '') : 'Tahakkuk';
             
             const accrualData = {
                 taskId: task.relatedTaskId || taskId, 
                 taskTitle: cleanTitle,
                 officialFee: formData.officialFee,
                 serviceFee: formData.serviceFee,
                 vatRate: formData.vatRate, 
                 applyVatToOfficialFee: formData.applyVatToOfficialFee,
                 totalAmount: formData.totalAmount, 
                 totalAmountCurrency: 'TRY', 
                 status: 'unpaid', 
                 remainingAmount: formData.totalAmount,
                 tpInvoiceParty: formData.tpInvoiceParty,
                 serviceInvoiceParty: formData.serviceInvoiceParty,
                 isForeignTransaction: formData.isForeignTransaction,
                 createdAt: new Date().toISOString(),
                 files: uploadedFiles
             };

             try {
                 const accResult = await accrualService.addAccrual(accrualData);
                 if (!accResult.success) throw new Error(accResult.error);
                 
                 const updateData = {
                     status: 'completed', updatedAt: new Date().toISOString(),
                     history: [...(task.history || []), { action: 'Tahakkuk oluşturularak görev tamamlandı.', timestamp: new Date().toISOString(), userEmail: this.currentUser.email }]
                 };
                 const taskResult = await taskService.updateTask(taskId, updateData);
                 
                 if(loader) loader.hide();
                 if (taskResult.success) { showNotification('İşlem başarılı!', 'success'); this.closeModal('completeAccrualTaskModal'); await this.loadAllData(); } 
                 else throw new Error('Task güncellenemedi.');
             } catch(e) { if(loader) loader.hide(); showNotification('Hata: ' + e.message, 'error'); }
        }

        // Helper: Modal Kapatma
        closeModal(modalId) {
            const m = document.getElementById(modalId);
            if(m) m.classList.remove('show');
            if(modalId === 'createTaskAccrualModal' && this.createTaskFormManager) this.createTaskFormManager.reset();
            if(modalId === 'completeAccrualTaskModal' && this.completeTaskFormManager) this.completeTaskFormManager.reset();
        }

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
            
            let loader = null;
            if(window.showSimpleLoading) loader = window.showSimpleLoading('Atama Yapılıyor');

            const user = this.allUsers.find(u => u.id === uid);
            try {
                const updateData = { assignedTo_uid: uid, assignedTo_email: user.email };
                const historyEntry = { action: `İş yeniden atandı: ${this.selectedTaskForAssignment.assignedTo_email || 'Atanmamış'} -> ${user.email}`, timestamp: new Date().toISOString(), userEmail: this.currentUser.email };
                let history = this.selectedTaskForAssignment.history ? [...this.selectedTaskForAssignment.history] : [];
                history.push(historyEntry);
                updateData.history = history;
                const res = await taskService.updateTask(this.selectedTaskForAssignment.id, updateData);
                
                if (loader) loader.hide();
                
                if (res.success) { showNotification('Atandı!', 'success'); this.closeModal('assignTaskModal'); await this.loadAllData(); } 
                else { showNotification('Hata: ' + res.error, 'error'); }
            } catch (e) { 
                if (loader) loader.hide();
                showNotification('Hata oluştu.', 'error'); 
            }
        }

        async deleteTask(taskId) {
            if (confirm('Görevi silmek istediğinize emin misiniz?')) {
                let loader = null;
                if(window.showSimpleLoading) loader = window.showSimpleLoading('Siliniyor');
                
                const res = await taskService.deleteTask(taskId);
                
                if (loader) loader.hide();
                
                if (res.success) { showNotification('Silindi.', 'success'); await this.loadAllData(); }
                else { showNotification('Hata: ' + res.error, 'error'); }
            }
        }
    }

    const module = new TaskManagementModule();
    module.init();

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