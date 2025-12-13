import { authService, taskService, ipRecordsService, accrualService, personService, transactionTypeService, db } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Modüller
import Pagination from '../pagination.js'; 
import { AccrualFormManager } from '../components/AccrualFormManager.js';
import { TaskDetailManager } from '../components/TaskDetailManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Ortak Layout Yüklemesi
    await loadSharedLayout({ activeMenuLink: 'task-management.html' });

    class TaskManagementModule {
        constructor() {
            this.currentUser = null;
            this.storage = getStorage();

            // Veri Havuzları
            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allUsers = [];
            this.allTransactionTypes = [];
            this.allAccruals = [];

            // İşlenmiş ve Filtrelenmiş Veriler
            this.processedData = []; 
            this.filteredData = [];

            // Sıralama ve Sayfalama Durumu
            this.sortState = { key: 'id', direction: 'desc' }; // Varsayılan: En yeni ID en üstte
            this.pagination = null;

            // Seçili İşlem Durumları
            this.selectedTaskForAssignment = null;
            this.currentTaskForAccrual = null;

            // Component Yöneticileri
            this.createTaskFormManager = null;
            this.completeTaskFormManager = null;
            this.taskDetailManager = null;

            // Statü Çevirileri
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
                console.error("Pagination sınıfı yüklenemedi.");
                return;
            }
            this.pagination = new Pagination({
                containerId: 'paginationContainer',
                itemsPerPage: 10,
                itemsPerPageOptions: [10, 25, 50, 100],
                onPageChange: () => {
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
                // Tüm verileri paralel çek
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

                // Veriler geldikten sonra form yöneticilerini başlat
                this.initForms();

                // Verileri işleme ve tabloya hazırlama
                this.processData();
                
                // Pagination güncelle ve tabloyu çiz
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

        initForms() {
            // 1. Ek Tahakkuk Formu
            this.createTaskFormManager = new AccrualFormManager(
                'createTaskAccrualFormContainer', 
                'createTask', 
                this.allPersons // Kişi listesini aktar
            );
            this.createTaskFormManager.render();

            // 2. Tahakkuk Tamamlama Formu
            this.completeTaskFormManager = new AccrualFormManager(
                'completeAccrualFormContainer', 
                'comp', 
                this.allPersons
            );
            this.completeTaskFormManager.render();
            
            // 3. Detay Modal Yöneticisi
            this.taskDetailManager = new TaskDetailManager('modalBody');
        }

        processData() {
            this.processedData = this.allTasks.map(task => {
                // İlişkili Kayıt Bilgisi
                const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
                const relatedRecord = ipRecord ? (ipRecord.applicationNumber || ipRecord.title || 'Kayıt Bulunamadı') : 'N/A';

                // İşlem Tipi Bilgisi
                const transactionTypeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                const taskTypeDisplay = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || 'Bilinmiyor');

                // Atanan Kişi Bilgisi
                const assignedUser = this.allUsers.find(user => user.id === task.assignedTo_uid);
                const assignedToDisplay = assignedUser ? (assignedUser.displayName || assignedUser.email) : 'Atanmamış';

                // Tarih İşlemleri (Helper)
                const parseDate = (d) => {
                    if (!d) return null;
                    if (d.toDate) return d.toDate(); // Firestore Timestamp
                    if (d.seconds) return new Date(d.seconds * 1000);
                    return new Date(d); // String veya Date object
                };

                // Operasyonel Son Tarih
                const operationalDueObj = parseDate(task.dueDate); // Sıralama için obje
                const operationalDueISO = operationalDueObj ? operationalDueObj.toISOString().slice(0, 10) : ''; 
                const operationalDueDisplay = operationalDueObj ? operationalDueObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                // Resmi Son Tarih
                const officialDueObj = parseDate(task.officialDueDate); // Sıralama için obje
                const officialDueISO = officialDueObj ? officialDueObj.toISOString().slice(0, 10) : '';
                const officialDueDisplay = officialDueObj ? officialDueObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                // Arama Metni (Search String) - Tüm aranabilir alanları birleştir
                const statusText = this.statusDisplayMap[task.status] || task.status;
                const searchString = `${task.id} ${task.title || ''} ${relatedRecord} ${taskTypeDisplay} ${assignedToDisplay} ${statusText} ${task.priority || ''}`.toLowerCase();

                return {
                    ...task,
                    relatedRecord,
                    taskTypeDisplay,
                    assignedToDisplay,
                    // Gösterim (Display) Alanları
                    operationalDue: operationalDueISO,
                    officialDue: officialDueISO,
                    operationalDueDisplay,
                    officialDueDisplay,
                    // Sıralama (Sort) Alanları
                    operationalDueObj,
                    officialDueObj,
                    statusText,
                    // Arama Alanı
                    searchString
                };
            });

            // İlk yüklemede tüm veriyi göster ve varsayılan sıralamayı uygula
            this.handleSearch(document.getElementById('searchInput')?.value || '');
        }

        // --- ARAMA ve FİLTRELEME ---
        handleSearch(query) {
            if (!query) {
                this.filteredData = [...this.processedData];
            } else {
                const lowerQuery = query.toLowerCase();
                this.filteredData = this.processedData.filter(item => 
                    item.searchString.includes(lowerQuery)
                );
            }
            
            // Aramadan sonra sıralamayı tekrar uygula (sıra bozulmasın)
            this.sortData();
            
            // Pagination'ı sıfırla ve güncelle
            if (this.pagination) {
                this.pagination.reset();
                this.pagination.update(this.filteredData.length);
            } else {
                this.renderTable();
            }
        }

        // --- SIRALAMA (SORTING) ---
        handleSort(key) {
            // Aynı kolona tıklandıysa yönü değiştir, farklıysa 'asc' yap
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
                let valA = a[key];
                let valB = b[key];

                // Null/Undefined kontrolü (Boş değerler en sona gitsin mantığı eklenebilir)
                if (valA == null) valA = '';
                if (valB == null) valB = '';

                // Tarih Sıralaması (Date objeleri üzerinden)
                if (valA instanceof Date && valB instanceof Date) return (valA - valB) * multiplier;
                if (valA instanceof Date) return -1 * multiplier; // Tarih olan öne gelsin
                if (valB instanceof Date) return 1 * multiplier;

                // ID Sıralaması (Hem T-15 gibi string hem sayı olabilir)
                if (key === 'id') {
                    // Sadece sayıları çekip karşılaştır
                    const numA = parseFloat(String(valA).replace(/[^0-9]/g, ''));
                    const numB = parseFloat(String(valB).replace(/[^0-9]/g, ''));
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return (numA - numB) * multiplier;
                    }
                }

                // Standart Metin Sıralaması (Türkçe karakter uyumlu)
                return String(valA).localeCompare(String(valB), 'tr') * multiplier;
            });
        }

        updateSortIcons() {
            document.querySelectorAll('#tasksTableHeaderRow th[data-sort]').forEach(th => {
                const icon = th.querySelector('i');
                if(!icon) return;
                
                // Hepsini varsayılan (gri) yap
                icon.className = 'fas fa-sort';
                icon.style.opacity = '0.3';
                
                // Aktif olanı güncelle
                if (th.dataset.sort === this.sortState.key) {
                    icon.className = this.sortState.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                    icon.style.opacity = '1';
                }
            });
        }

        // --- RENDER (ÇİZİM) ---
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

            // Sayfalama uygula
            let currentData = this.filteredData;
            if (this.pagination) {
                currentData = this.pagination.getCurrentPageData(this.filteredData);
            }

            let html = '';
            currentData.forEach(task => {
                const safeStatus = (task.status || '').toString();
                const statusClass = `status-${safeStatus.replace(/ /g, '_').toLowerCase()}`;
                
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
                        <td><span class="status-badge ${statusClass}">${task.statusText}</span></td>
                        <td>${this.getActionButtonsHtml(task)}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;

            this.updateSortIcons();

            // Deadline Highlighter Tetikle (Varsa)
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

            // Tamamlanmış tahakkuk görevlerinde düzenle/sil butonlarını gizle
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

        // --- EVENT LISTENERS ---
        setupStaticEventListeners() {
        // Arama Kutusu Bağlantısı
            const searchInput = document.getElementById('searchInput');
            
            if (searchInput) {
                console.log("Arama kutusu bulundu, dinleniyor..."); // Kontrol için log
                searchInput.addEventListener('input', (e) => {
                    console.log("Aranıyor:", e.target.value); // Yazdığınızı konsolda görmek için
                    this.handleSearch(e.target.value);
                });
            } else {
                console.error("HATA: 'searchInput' ID'li element bulunamadı! HTML'i kontrol edin.");
            }

            // Sıralama Başlıkları
            const headers = document.querySelectorAll('#tasksTableHeaderRow th[data-sort]');
            headers.forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    this.handleSort(th.dataset.sort);
                });
            });

            // Tablo İçi Butonlar (Delegation)
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
                        // Tahakkuk görevi kontrolü
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

            // Atama Modalı Butonları
            document.getElementById('cancelAssignmentBtn')?.addEventListener('click', () => this.closeModal('assignTaskModal'));
            document.getElementById('saveNewAssignmentBtn')?.addEventListener('click', () => this.saveNewAssignment());

            // Ek Tahakkuk Modalı Butonları
            document.getElementById('cancelCreateTaskAccrualBtn')?.addEventListener('click', () => this.closeModal('createTaskAccrualModal'));
            document.getElementById('saveNewAccrualBtn')?.addEventListener('click', () => this.handleSaveNewAccrual());

            // Tahakkuk Tamamlama Modalı Butonları
            document.getElementById('cancelCompleteAccrualBtn')?.addEventListener('click', () => this.closeModal('completeAccrualTaskModal'));
            document.getElementById('submitCompleteAccrualBtn')?.addEventListener('click', () => this.handleCompleteAccrualSubmission());
        }

        // --- İŞLEMLER ve MODALLAR ---

        async showTaskDetailModal(taskId) {
            const modalElement = document.getElementById('taskDetailModal');
            const modalTitle = document.getElementById('modalTaskTitle');
            if (!modalElement || !this.taskDetailManager) return;

            modalElement.classList.add('show');
            modalTitle.textContent = 'Yükleniyor...';
            this.taskDetailManager.showLoading();

            try {
                // Taze veri çek (Detayda güncel durumu görmek için)
                const taskRef = doc(db, 'tasks', String(taskId));
                const taskSnap = await getDoc(taskRef);

                if (!taskSnap.exists()) {
                    this.taskDetailManager.showError('Bu iş kaydı bulunamadı.');
                    return;
                }

                const task = { id: taskSnap.id, ...taskSnap.data() };
                modalTitle.textContent = `İş Detayı (${task.id})`;

                // İlişkili verileri bul
                const ipRecord = task.relatedIpRecordId ? this.allIpRecords.find(r => r.id === task.relatedIpRecordId) : null;
                const transactionType = this.allTransactionTypes.find(t => t.id === task.taskType);
                const assignedUser = this.allUsers.find(u => u.id === task.assignedTo_uid);
                const relatedAccruals = this.allAccruals.filter(acc => String(acc.taskId) === String(task.id));

                this.taskDetailManager.render(task, {
                    ipRecord: ipRecord,
                    transactionType: transactionType,
                    assignedUser: assignedUser,
                    accruals: relatedAccruals
                });

            } catch (error) {
                console.error(error);
                this.taskDetailManager.showError('Hata: ' + error.message);
            }
        }

        openAssignTaskModal(taskId) {
            this.selectedTaskForAssignment = this.allTasks.find(t => t.id === taskId);
            if (!this.selectedTaskForAssignment) { showNotification('İş bulunamadı.', 'error'); return; }

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
            document.getElementById('assignTaskModal').classList.add('show');
        }

        async saveNewAssignment() {
            const uid = document.getElementById('newAssignedTo')?.value;
            if (!uid) { showNotification('Lütfen kullanıcı seçin.', 'warning'); return; }
            
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Atama Yapılıyor') : null;

            const user = this.allUsers.find(u => u.id === uid);
            try {
                const updateData = { assignedTo_uid: uid, assignedTo_email: user.email };
                const historyEntry = { 
                    action: `İş yeniden atandı: ${this.selectedTaskForAssignment.assignedTo_email || 'Atanmamış'} -> ${user.email}`, 
                    timestamp: new Date().toISOString(), 
                    userEmail: this.currentUser.email 
                };
                
                // Mevcut tarihçeyi koru
                let history = this.selectedTaskForAssignment.history ? [...this.selectedTaskForAssignment.history] : [];
                history.push(historyEntry);
                updateData.history = history;

                const res = await taskService.updateTask(this.selectedTaskForAssignment.id, updateData);
                
                if (loader) loader.hide();
                
                if (res.success) { 
                    showNotification('Başarıyla atandı!', 'success'); 
                    this.closeModal('assignTaskModal'); 
                    await this.loadAllData(); 
                } else { 
                    showNotification('Hata: ' + res.error, 'error'); 
                }
            } catch (e) { 
                if (loader) loader.hide();
                showNotification('Beklenmeyen hata.', 'error'); 
            }
        }

        async deleteTask(taskId) {
            if (confirm('Bu görevi ve ilişkili verileri silmek istediğinize emin misiniz?')) {
                let loader = window.showSimpleLoading ? window.showSimpleLoading('Siliniyor') : null;
                
                const res = await taskService.deleteTask(taskId);
                
                if (loader) loader.hide();
                
                if (res.success) { 
                    showNotification('Silindi.', 'success'); 
                    await this.loadAllData(); 
                } else { 
                    showNotification('Hata: ' + res.error, 'error'); 
                }
            }
        }

        // --- Ek Tahakkuk Mantığı ---
        showCreateTaskAccrualModal(taskId) {
            this.currentTaskForAccrual = this.allTasks.find(t => t.id === taskId);
            if (!this.currentTaskForAccrual) { showNotification('İş bulunamadı.', 'error'); return; }
            
            document.getElementById('createTaskAccrualTaskTitleDisplay').value = `${this.currentTaskForAccrual.title} (${this.currentTaskForAccrual.id})`;
            
            if(this.createTaskFormManager) {
                this.createTaskFormManager.reset();

                // EPATS Belgesi Bulma Mantığı
                let epatsDoc = null;
                if (this.currentTaskForAccrual.details?.epatsDocument) {
                    epatsDoc = this.currentTaskForAccrual.details.epatsDocument;
                } else if (this.currentTaskForAccrual.relatedTaskId) {
                    const parent = this.allTasks.find(t => t.id === this.currentTaskForAccrual.relatedTaskId);
                    if (parent?.details?.epatsDocument) epatsDoc = parent.details.epatsDocument;
                }
                this.createTaskFormManager.showEpatsDoc(epatsDoc);
            }
            
            document.getElementById('createTaskAccrualModal').classList.add('show');
        }

        async handleSaveNewAccrual() {
            if (!this.currentTaskForAccrual) return;

            const result = this.createTaskFormManager.getData();
            if (!result.success) { showNotification(result.error, 'error'); return; }
            const formData = result.data;

            let loader = window.showSimpleLoading ? window.showSimpleLoading('Tahakkuk Kaydediliyor') : null;

            // Dosya Yükleme
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
                showNotification('Ek tahakkuk başarıyla oluşturuldu!', 'success'); 
                this.closeModal('createTaskAccrualModal'); 
                await this.loadAllData(); 
            } else { 
                showNotification('Hata: ' + res.error, 'error'); 
            }
        }

        // --- Tahakkuk Tamamlama Mantığı ---
        openCompleteAccrualModal(taskId) {
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            document.getElementById('targetTaskIdForCompletion').value = taskId;

            if(this.completeTaskFormManager) {
                this.completeTaskFormManager.reset();
                
                let epatsDoc = null;
                if (task.details?.epatsDocument) epatsDoc = task.details.epatsDocument;
                else if (task.relatedTaskId) {
                    const parent = this.allTasks.find(t => t.id === task.relatedTaskId);
                    if (parent?.details?.epatsDocument) epatsDoc = parent.details.epatsDocument;
                }
                this.completeTaskFormManager.showEpatsDoc(epatsDoc);
            }

            document.getElementById('completeAccrualTaskModal').classList.add('show');
        }

        async handleCompleteAccrualSubmission() {
             const taskId = document.getElementById('targetTaskIdForCompletion')?.value;
             const task = this.allTasks.find(t => t.id === taskId);
             if(!task) return;

             const result = this.completeTaskFormManager.getData();
             if(!result.success) { showNotification(result.error, 'error'); return; }
             const formData = result.data;

             let loader = window.showSimpleLoading ? window.showSimpleLoading('İşlem Tamamlanıyor') : null;

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
                 if (taskResult.success) { 
                     showNotification('Tahakkuk oluşturuldu ve görev tamamlandı.', 'success'); 
                     this.closeModal('completeAccrualTaskModal'); 
                     await this.loadAllData(); 
                 } 
                 else throw new Error('Görev güncellenemedi.');
             } catch(e) { 
                 if(loader) loader.hide(); 
                 showNotification('Hata: ' + e.message, 'error'); 
             }
        }

        closeModal(modalId) {
            const m = document.getElementById(modalId);
            if(m) m.classList.remove('show');
            
            // Modallar kapanırken formları sıfırla
            if(modalId === 'createTaskAccrualModal' && this.createTaskFormManager) this.createTaskFormManager.reset();
            if(modalId === 'completeAccrualTaskModal' && this.completeTaskFormManager) this.completeTaskFormManager.reset();
        }
    }

    const module = new TaskManagementModule();
    module.init();

    // Deadline Highlighter Entegrasyonu
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