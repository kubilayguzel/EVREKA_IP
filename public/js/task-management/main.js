// public/js/task-management/main.js

import { authService, taskService, ipRecordsService, accrualService, personService, transactionTypeService } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'task-management.html' });

    class TaskManagementModule {
        constructor() {
            this.currentUser = null;
            this.storage = getStorage();

            // Ham Veriler
            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allUsers = [];
            this.allTransactionTypes = [];

            // İşlenmiş ve Filtrelenmiş Veriler (Tablo için)
            this.processedData = []; 
            this.filteredData = [];

            // Tablo Durumu
            this.sortState = { key: 'id', direction: 'desc' }; // Varsayılan: ID'ye göre azalan

            // Seçim State'leri (Modallar için)
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
            // Statik Event Listener'ları kur
            this.setupStaticEventListeners();

            authService.auth.onAuthStateChanged(async (user) => {
                if (user || authService.getCurrentUser()) {
                    this.currentUser = authService.getCurrentUser();
                    await this.loadAllData();
                } else {
                    window.location.href = 'index.html';
                }
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
                this.allTransactionTypes = transactionTypesResult.success ? transactionTypesResult.data : [];

                // Veriyi İşle ve Hazırla
                this.processData();
                
                // İlk Render
                this.renderTable();

            } catch (error) {
                console.error(error);
                showNotification('Veriler yüklenirken bir hata oluştu: ' + error.message, 'error');
            } finally {
                if (loading) loading.style.display = 'none';
            }
        }

        // Ham veriyi tablo için hazırlar (Formatlama vb.)
        processData() {
            this.processedData = this.allTasks.map(task => {
                const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
                const relatedRecord = ipRecord ? (ipRecord.applicationNumber || ipRecord.title || 'Kayıt Bulunamadı') : 'N/A';

                const transactionTypeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                const taskTypeDisplay = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || 'Bilinmiyor');

                const assignedUser = this.allUsers.find(user => user.id === task.assignedTo_uid);
                const assignedToDisplay = assignedUser ? (assignedUser.displayName || assignedUser.email) : 'Atanmamış';

                // Tarihler (Sorting için ISO, Display için TR formatı)
                const dueDateObj = task.dueDate ? (task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate)) : null;
                const operationalDueISO = dueDateObj ? dueDateObj.toISOString().slice(0, 10) : ''; 
                const operationalDueDisplay = dueDateObj ? dueDateObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                const officialDateObj = task.officialDueDate ? (task.officialDueDate.toDate ? task.officialDueDate.toDate() : (task.officialDueDate.seconds ? new Date(task.officialDueDate.seconds * 1000) : new Date(task.officialDueDate))) : null;
                const officialDueISO = officialDateObj ? officialDateObj.toISOString().slice(0, 10) : '';
                const officialDueDisplay = officialDateObj ? officialDateObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                // Arama yapılabilmesi için tüm metinleri birleştirip 'searchString' oluşturuyoruz
                const searchString = `${task.id} ${task.title || ''} ${relatedRecord} ${taskTypeDisplay} ${assignedToDisplay} ${this.statusDisplayMap[task.status] || task.status}`.toLowerCase();

                return {
                    ...task,
                    relatedRecord,
                    taskTypeDisplay,
                    assignedToDisplay,
                    operationalDue: operationalDueISO, // Sıralama için
                    officialDue: officialDueISO,       // Sıralama için
                    operationalDueDisplay,
                    officialDueDisplay,
                    searchString
                };
            });

            // Başlangıçta filtrelenmiş veri = tüm veri
            this.filteredData = [...this.processedData];
            
            // Varsayılan sıralamayı uygula
            this.sortData();
        }

        // --- TABLO RENDER ve YÖNETİMİ ---

        renderTable() {
            const tbody = document.getElementById('tasksTableBody');
            const noRecordsMsg = document.getElementById('noTasksMessage');
            
            if (!tbody) return;
            tbody.innerHTML = '';

            if (this.filteredData.length === 0) {
                if (noRecordsMsg) noRecordsMsg.style.display = 'block';
                return;
            } else {
                if (noRecordsMsg) noRecordsMsg.style.display = 'none';
            }

            let html = '';
            this.filteredData.forEach(task => {
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

            // İkonları Güncelle
            this.updateSortIcons();

            // Deadline Highlighter Yenile
            if (window.DeadlineHighlighter && typeof window.DeadlineHighlighter.refresh === 'function') {
                setTimeout(() => window.DeadlineHighlighter.refresh('taskManagement'), 50);
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

        // --- SIRALAMA (SORTING) ---

        handleSort(key) {
            if (this.sortState.key === key) {
                // Aynı kolona tıklandıysa yönü değiştir
                this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                // Yeni kolon
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

                // Sayısal kontrol
                if (!isNaN(parseFloat(valA)) && isFinite(valA) && !isNaN(parseFloat(valB)) && isFinite(valB)) {
                    return (parseFloat(valA) - parseFloat(valB)) * multiplier;
                }

                // String kontrol (Türkçe karakter uyumlu)
                valA = valA.toString().toLowerCase();
                valB = valB.toString().toLowerCase();
                return valA.localeCompare(valB, 'tr') * multiplier;
            });
        }

        updateSortIcons() {
            document.querySelectorAll('#tasksTableHeaderRow th[data-sort]').forEach(th => {
                const icon = th.querySelector('i');
                if(!icon) return;
                
                // Hepsini pasif yap
                icon.className = 'fas fa-sort';
                icon.style.opacity = '0.3';

                // Aktif olanı güncelle
                if (th.dataset.sort === this.sortState.key) {
                    icon.className = this.sortState.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                    icon.style.opacity = '1';
                }
            });
        }

        // --- ARAMA (SEARCH) ---

        handleSearch(query) {
            if (!query) {
                this.filteredData = [...this.processedData];
            } else {
                const lowerQuery = query.toLowerCase();
                this.filteredData = this.processedData.filter(item => 
                    item.searchString.includes(lowerQuery)
                );
            }
            // Arama sonrası mevcut sıralamayı koru
            this.sortData();
            this.renderTable();
        }

        // --- EVENT LISTENERS ---

        setupStaticEventListeners() {
            // 1. Arama Inputu
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
            }

            // 2. Sıralama Başlıkları
            const headers = document.querySelectorAll('#tasksTableHeaderRow th[data-sort]');
            headers.forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    this.handleSort(th.dataset.sort);
                });
            });

            // 3. Tablo Buton Delegasyonu
            const tbody = document.getElementById('tasksTableBody');
            if (tbody) {
                tbody.addEventListener('click', (e) => {
                    const btn = e.target.closest('.action-btn');
                    if (!btn) return;

                    e.preventDefault();
                    e.stopPropagation(); // Satır tıklamasını engelle
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

            // 4. Modal Kapatma Butonları
            document.querySelectorAll('.close-modal-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const modal = e.target.closest('.modal');
                    if (modal) this.closeModal(modal.id);
                });
            });

            // --- Modal Form Listenerları ---

            // Atama
            document.getElementById('cancelAssignmentBtn')?.addEventListener('click', () => this.closeModal('assignTaskModal'));
            document.getElementById('saveNewAssignmentBtn')?.addEventListener('click', () => this.saveNewAssignment());

            // Ek Tahakkuk
            document.getElementById('cancelCreateTaskAccrualBtn')?.addEventListener('click', () => this.closeModal('createTaskAccrualModal'));
            document.getElementById('saveNewAccrualBtn')?.addEventListener('click', () => this.handleSaveNewAccrual());
            ['createTaskOfficialFee', 'createTaskServiceFee', 'createTaskVatRate', 'createTaskApplyVatToOfficialFee'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => this.calculateCreateTaskTotalAmount());
            });

            // Ek Tahakkuk - Kişi Arama
            document.getElementById('createTaskTpInvoicePartySearch')?.addEventListener('input', (e) => {
                this.searchPersonsGeneric(e.target.value, 'createTaskTpInvoiceParty', (person) => {
                    this.createTaskSelectedTpInvoiceParty = person;
                });
            });
            document.getElementById('createTaskServiceInvoicePartySearch')?.addEventListener('input', (e) => {
                this.searchPersonsGeneric(e.target.value, 'createTaskServiceInvoiceParty', (person) => {
                    this.createTaskSelectedServiceInvoiceParty = person;
                });
            });

            // Tamamlama (Complete Accrual)
            document.getElementById('cancelCompleteAccrualBtn')?.addEventListener('click', () => this.closeModal('completeAccrualTaskModal'));
            document.getElementById('submitCompleteAccrualBtn')?.addEventListener('click', () => this.handleCompleteAccrualSubmission());
            ['compOfficialFee', 'compServiceFee', 'compVatRate', 'compApplyVatToOfficial'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => this.calculateCompTotal());
            });

            // Tamamlama - Kişi Arama
            document.getElementById('compTpInvoicePartySearch')?.addEventListener('input', (e) => {
                this.searchPersonsGeneric(e.target.value, 'compTpInvoiceParty', (person) => {
                    this.compSelectedTpInvoiceParty = person;
                });
            });
            document.getElementById('compServiceInvoicePartySearch')?.addEventListener('input', (e) => {
                this.searchPersonsGeneric(e.target.value, 'compServiceInvoiceParty', (person) => {
                    this.compSelectedServiceInvoiceParty = person;
                });
            });

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

        // --- YARDIMCI FONKSİYONLAR ---

        searchPersonsGeneric(query, elementPrefix, onSelectCallback) {
            const resultsList = document.getElementById(`${elementPrefix}Results`);
            const searchInput = document.getElementById(`${elementPrefix}Search`);
            
            if (!query || query.length < 2) {
                resultsList.style.display = 'none';
                return;
            }

            const lowerQuery = query.toLowerCase();
            const filteredPersons = this.allPersons.filter(person => {
                const nameMatch = person.name && person.name.toLowerCase().includes(lowerQuery);
                const emailMatch = person.email && person.email.toLowerCase().includes(lowerQuery);
                return nameMatch || emailMatch;
            }).slice(0, 10);

            if (filteredPersons.length === 0) {
                resultsList.innerHTML = '<div class="search-result-item">Sonuç bulunamadı</div>';
                resultsList.style.display = 'block';
                return;
            }

            resultsList.innerHTML = '';
            filteredPersons.forEach(person => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.innerHTML = `<strong>${person.name || 'İsimsiz'}</strong><br><small>${person.email || ''}</small>`;
                
                div.addEventListener('click', () => {
                    searchInput.value = '';
                    resultsList.style.display = 'none';
                    
                    const displayDiv = document.getElementById(`${elementPrefix}Display`);
                    if (displayDiv) {
                        displayDiv.innerHTML = `
                            <span>${person.name} (${person.email || '-'})</span>
                            <span class="remove-result" style="cursor:pointer; color:red; margin-left:10px;">&times;</span>
                        `;
                        displayDiv.style.display = 'block';
                        
                        displayDiv.querySelector('.remove-result').addEventListener('click', () => {
                            displayDiv.style.display = 'none';
                            displayDiv.innerHTML = '';
                            onSelectCallback(null);
                        });
                    }
                    onSelectCallback(person);
                });
                
                resultsList.appendChild(div);
            });
            resultsList.style.display = 'block';
        }

        // --- MODAL İŞLEMLERİ (ATAMA, SİLME, DETAY VB.) ---
        
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

            // Modal Başlığı
            modalTitle.textContent = `İş Detayı (${task.id})`;
            
            // Veri Hazırlığı (Formatlama)
            const formatDate = (dateVal) => {
                if (!dateVal) return 'Belirtilmemiş';
                try {
                    const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
                    return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('tr-TR');
                } catch(e) { return '-'; }
            };

            const assignedUser = this.allUsers.find(u => u.id === task.assignedTo_uid);
            const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : 'Atanmamış';

            const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
            const relatedRecordTxt = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'İlgili kayıt bulunamadı';

            const transactionTypeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
            const taskTypeDisplay = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || '-');

            const statusText = this.statusDisplayMap[task.status] || task.status;

            // HTML Oluşturma (Düzenle Formuna Benzer Yapı)
            // Bootstrap form yapısı kullanılarak "read-only" görünüm sağlandı.
            let html = `
                <div class="container-fluid p-0">
                    <div class="form-group mb-3">
                        <label class="text-muted font-weight-bold small text-uppercase" style="letter-spacing:0.5px;">İş Konusu</label>
                        <div class="p-2 bg-light border rounded text-dark">${task.title || '-'}</div>
                    </div>

                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <label class="text-muted font-weight-bold small text-uppercase">İlgili Dosya</label>
                            <div class="p-2 border rounded">${relatedRecordTxt}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label class="text-muted font-weight-bold small text-uppercase">İş Tipi</label>
                            <div class="p-2 border rounded">${taskTypeDisplay}</div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <label class="text-muted font-weight-bold small text-uppercase">Atanan Kişi</label>
                            <div class="p-2 border rounded">${assignedName}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label class="text-muted font-weight-bold small text-uppercase">Öncelik</label>
                            <div class="p-2 border rounded">
                                <span class="badge badge-${task.priority === 'high' ? 'danger' : (task.priority === 'medium' ? 'warning' : 'success')} px-2 py-1">
                                    ${task.priority ? task.priority.toUpperCase() : 'NORMAL'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="form-group mb-3">
                        <label class="text-muted font-weight-bold small text-uppercase">Güncel Durum</label>
                        <div class="p-2 border rounded bg-white">
                             <span class="font-weight-bold text-primary">${statusText}</span>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <label class="text-muted font-weight-bold small text-uppercase">Operasyonel Son Tarih</label>
                            <div class="p-2 border rounded bg-light">
                                <i class="far fa-calendar-alt text-secondary mr-2"></i>${formatDate(task.dueDate)}
                            </div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label class="text-muted font-weight-bold small text-uppercase">Resmi Son Tarih</label>
                            <div class="p-2 border rounded bg-light">
                                <i class="fas fa-calendar-check text-danger mr-2"></i>${formatDate(task.officialDueDate)}
                            </div>
                        </div>
                    </div>

                    <div class="form-group mt-2">
                        <label class="text-muted font-weight-bold small text-uppercase">Açıklama & Notlar</label>
                        <div class="p-3 border rounded bg-light text-break" style="min-height: 80px; white-space: pre-wrap;">${task.description || '<span class="text-muted font-italic">Açıklama girilmemiş.</span>'}</div>
                    </div>
                </div>
            `;

            modalBody.innerHTML = html;
            modalElement.classList.add('show');
        }

        openCompleteAccrualModal(taskId) {
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            const form = document.getElementById('completeAccrualForm');
            if (form) form.reset();

            const targetInput = document.getElementById('targetTaskIdForCompletion');
            if (targetInput) targetInput.value = taskId;

            // Para birimi varsayılanları
            document.getElementById('compOfficialFeeCurrency').value = 'TRY';
            document.getElementById('compServiceFeeCurrency').value = 'TRY';
            document.getElementById('compVatRate').value = '20';
            document.getElementById('compApplyVatToOfficial').checked = false;

            const fileNameDisplay = document.getElementById('compForeignInvoiceFileName');
            if (fileNameDisplay) fileNameDisplay.textContent = '';
            document.getElementById('compTotalAmountDisplay').textContent = '0.00 ₺';

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

            // Seçimleri Sıfırla
            this.compSelectedTpInvoiceParty = null;
            this.compSelectedServiceInvoiceParty = null;
            
            ['compSelectedTpInvoicePartyDisplay', 'compSelectedServiceInvoicePartyDisplay'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.style.display = 'none'; el.innerHTML = ''; }
            });
            ['compTpInvoicePartyResults', 'compServiceInvoicePartyResults'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = '';
            });

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

             const cleanTitle = task.title ? task.title.replace('Tahakkuk Oluşturma: ', '') : 'Tahakkuk';
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
            
            document.getElementById('createTaskForeignInvoiceFileName').textContent = '';
            
            this.createTaskSelectedTpInvoiceParty = null;
            this.createTaskSelectedServiceInvoiceParty = null;
            
            ['createTaskSelectedTpInvoicePartyDisplay', 'createTaskSelectedServiceInvoicePartyDisplay'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.style.display = 'none'; el.innerHTML = ''; }
            });
            ['createTaskTpInvoicePartyResults', 'createTaskServiceInvoicePartyResults'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = '';
            });

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
                tpInvoiceParty: this.createTaskSelectedTpInvoiceParty ? { id: this.createTaskSelectedTpInvoiceParty.id, name: this.createTaskSelectedTpInvoiceParty.name } : null,
                serviceInvoiceParty: this.createTaskSelectedServiceInvoiceParty ? { id: this.createTaskSelectedServiceInvoiceParty.id, name: this.createTaskSelectedServiceInvoiceParty.name } : null,
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

        closeModal(modalId) {
            const m = document.getElementById(modalId);
            if(m) m.classList.remove('show');
            if (modalId === 'createTaskAccrualModal') {
                const f = document.getElementById('createTaskAccrualForm');
                if(f) f.reset();
                document.getElementById('createTaskForeignInvoiceFileName').textContent = '';
                document.getElementById('createTaskTpInvoicePartyResults').innerHTML = '';
            }
            if (modalId === 'completeAccrualTaskModal') {
                const f = document.getElementById('completeAccrualForm');
                if(f) f.reset();
                document.getElementById('compForeignInvoiceFileName').textContent = '';
                const dc = document.getElementById('accrualEpatsDocumentContainer');
                if(dc) dc.style.display = 'none';
                document.getElementById('compTpInvoicePartyResults').innerHTML = '';
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