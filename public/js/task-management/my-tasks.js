// public/js/task-management/my-tasks.js

import { authService, taskService, ipRecordsService, accrualService, personService, transactionTypeService, db } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import Pagination from '../pagination.js'; 
import { TaskDetailManager } from '../components/TaskDetailManager.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'my-tasks.html' });

    class MyTasksModule {
        constructor() {
            this.currentUser = null;
            this.storage = getStorage();

            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allUsers = []; // Kullanıcı listesi eklendi (Atamalar için)
            this.allAccruals = [];
            this.allTransactionTypes = [];

            this.processedData = [];
            this.filteredData = [];
            this.activeTab = 'active';

            // Varsayılan Sıralama: Oluşturulma Tarihi (Yeniden eskiye)
            this.sortState = { key: 'createdAtObj', direction: 'desc' };

            this.pagination = null;
            this.currentTaskForAccrual = null;

            this.taskDetailManager = null;
            
            // İki farklı form yöneticisi kullanıyoruz:
            this.accrualFormManager = null; // Ek Tahakkuk için
            this.completeTaskFormManager = null; // Tahakkuk İşini Tamamlamak için

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
            
            // 1. Ek Tahakkuk Formu Yöneticisi
            this.accrualFormManager = new AccrualFormManager('createMyTaskAccrualFormContainer', 'myTaskAcc');
            
            // 2. [YENİ] Tahakkuk Tamamlama Formu Yöneticisi
            this.completeTaskFormManager = new AccrualFormManager('completeAccrualFormContainer', 'comp');
            
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
                // Not: ipRecords koleksiyonu büyük olabildiği için (ve cache bazen bayat kalabildiği için)
                // artık tüm ipRecords'ları çekmek yerine yalnızca görevlerin işaret ettiği kayıtları getiriyoruz.
                const [tasksResult, personsResult, accrualsResult, transactionTypesResult, usersResult] = await Promise.all([
                    taskService.getTasksForUser(this.currentUser.uid),
                    personService.getPersons(),
                    accrualService.getAccruals(),
                    transactionTypeService.getTransactionTypes(),
                    taskService.getAllUsers()
                ]);

                this.allTasks = tasksResult.success ? tasksResult.data.filter(t => 
                    !['awaiting_client_approval', 'client_approval_closed', 'client_no_response_closed'].includes(t.status)
                ) : [];

                // Görevlerin bağlı olduğu ipRecord'ları çek (cache-first) ve eksik kalanları server'dan tamamla.
                const relatedIds = [...new Set(this.allTasks.map(t => t.relatedIpRecordId).filter(Boolean).map(id => String(id)))];
                let ipRecords = [];
                if (relatedIds.length) {
                    const ipRes = await ipRecordsService.getRecordsByIds(relatedIds, { source: 'server' });
                    ipRecords = ipRes.success ? ipRes.data : [];
                }
                this.allIpRecords = ipRecords;

                this.allIpRecords = ipRecords;
                this.allPersons = personsResult.success ? personsResult.data : [];
                this.allAccruals = accrualsResult.success ? accrualsResult.data : [];
                this.allTransactionTypes = transactionTypesResult.success ? transactionTypesResult.data : [];
                this.allUsers = usersResult.success ? usersResult.data : [];

                // Formlara kişi listelerini gönder ve çiz
                this.accrualFormManager.allPersons = this.allPersons;
                this.accrualFormManager.render();

                if (this.completeTaskFormManager) {
                    this.completeTaskFormManager.allPersons = this.allPersons;
                    this.completeTaskFormManager.render();
                }

                this.processData();

            } catch (error) {
                console.error(error);
                showNotification('Veriler yüklenirken hata oluştu: ' + error.message, 'error');
            } finally {
                if(loader) loader.style.display = 'none';
            }
        }

        // public/js/task-management/my-tasks.js dosyasındaki processData metodu

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
                // [GÜNCELLEME BURADA] ID'leri String'e çevirerek karşılaştır
                // Bu sayede "123" (string) ile 123 (number) gelirse de eşleşir.
                const ipRecord = this.allIpRecords.find(r => String(r.id) === String(task.relatedIpRecordId));
                
                const relatedRecordDisplay = ipRecord
                    ? (ipRecord.applicationNumber || ipRecord.applicationNo || ipRecord.title)
                    : 'N/A';
                
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

            const currentQuery = document.getElementById('taskSearchInput')?.value || '';
            this.handleSearch(currentQuery);
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

                if (valA == null) valA = '';
                if (valB == null) valB = '';

                if (valA instanceof Date && valB instanceof Date) {
                    return (valA - valB) * multiplier;
                }
                if (valA instanceof Date) return -1 * multiplier; 
                if (valB instanceof Date) return 1 * multiplier;

                if (key === 'id') {
                    const numA = parseFloat(valA.replace(/[^0-9]/g, ''));
                    const numB = parseFloat(valB.replace(/[^0-9]/g, ''));
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return (numA - numB) * multiplier;
                    }
                }

                valA = valA.toString().toLowerCase();
                valB = valB.toString().toLowerCase();
                return valA.localeCompare(valB, 'tr') * multiplier;
            });
        }

        updateSortIcons() {
            document.querySelectorAll('#myTasksTable thead th[data-sort]').forEach(th => {
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

        // my-tasks.js içindeki handleSearch metodunu bununla değiştirin:

        handleSearch(query) {
            const statusFilter = document.getElementById('statusFilter').value;
            const lowerQuery = (query || '').toLowerCase();

            // Aktif Kullanıcı Bilgileri
            const currentUserId = this.currentUser.uid;
            const currentUserEmail = this.currentUser.email;

            this.filteredData = this.processedData.filter(item => {
                // 1. Arama Metni Filtresi
                const matchesSearch = !lowerQuery || item.searchString.includes(lowerQuery);
                
                // 2. Dropdown Statü Filtresi
                const matchesStatusFilter = (statusFilter === 'all' || item.status === statusFilter);

                // 3. TAB FİLTRESİ
                let matchesTab = false;
                const isFinished = item.status === 'completed' || item.status === 'cancelled';

                if (this.activeTab === 'active') {
                    matchesTab = !isFinished;
                } else {
                    matchesTab = isFinished;
                }

                // [DÜZELTME] Kullanıcı Filtresi Güncellendi
                // Artık assignedTo_uid alanını da kontrol ediyor.
                const assigneeId = item.assignedTo?.id || item.assignedTo;
                
                const isMyTask = (assigneeId === currentUserId) || 
                                 (item.assignedTo_uid === currentUserId) || // <-- EKLENEN KRİTİK SATIR
                                 (item.assignedToEmail === currentUserEmail) ||
                                 (item.assignedTo_email === currentUserEmail);

                return matchesSearch && matchesStatusFilter && matchesTab && isMyTask;
            });

            this.sortData();

            if (this.pagination) {
                this.pagination.reset();
                this.pagination.update(this.filteredData.length);
            }

            this.renderTasks();
        }

        setupEventListeners() {
            // 👇 TAB DEĞİŞTİRME OLAYLARI 👇
            document.querySelectorAll('#taskTabs .nav-link').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.preventDefault();
                    
                    // Görsel Güncelleme (Active sınıfını değiştir)
                    document.querySelectorAll('#taskTabs .nav-link').forEach(t => {
                        t.classList.remove('active');
                        t.style.color = '#6c757d'; // Pasif renk
                    });
                    e.target.classList.add('active');
                    e.target.style.color = '#495057'; // Aktif renk

                    // Mantıksal Güncelleme
                    this.activeTab = e.target.dataset.tab;
                    
                    // Mevcut arama kriteriyle listeyi yenile
                    const currentQuery = document.getElementById('taskSearchInput').value;
                    this.handleSearch(currentQuery);
                });
            });

            document.getElementById('taskSearchInput').addEventListener('input', (e) => this.handleSearch(e.target.value));
            document.getElementById('statusFilter').addEventListener('change', () => {
                const query = document.getElementById('taskSearchInput').value;
                this.handleSearch(query);
            });
            
            const headers = document.querySelectorAll('#myTasksTable thead th[data-sort]');
            headers.forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    this.handleSort(th.dataset.sort);
                });
            });

            document.getElementById('myTasksTableBody').addEventListener('click', (e) => {
                const btn = e.target.closest('.action-btn');
                if (!btn) return;
                e.preventDefault();
                const taskId = btn.dataset.id;
                
                if (btn.classList.contains('view-btn') || btn.dataset.action === 'view') {
                    // 1. Tıklanan işi bul
                    const task = this.allTasks.find(t => t.id === taskId);
                    
                    // 2. İş tipi "Marka Başvurusu" (ID: 2) ise Özet Modalı aç
                    if (task && String(task.taskType) === '2') {
                        this.taskDetailManager.showApplicationSummary(task);
                    } 
                    // 3. Değilse standart Detay Modalı aç (Eski yöntem)
                    else {
                        this.showTaskDetailModal(taskId);
                    }
                } 
                else if (btn.classList.contains('edit-btn') || btn.dataset.action === 'edit') {
                    // [DÜZELTİLDİ] Görev tipine göre yönlendirme
                    const task = this.allTasks.find(t => t.id === taskId);
                    
                    // İş tipi '53' (Tahakkuk Oluşturma) ise merkezi modalı aç
                    if (task && (String(task.taskType) === '53' || task.taskType === 'accrual_creation')) {
                        console.log('💰 Tahakkuk düzenleme modalı açılıyor:', taskId);
                        this.openCompleteAccrualModal(taskId);
                    } else {
                        // Diğer tüm işler için standart güncelleme sayfasına git
                        window.location.href = `task-update.html?id=${taskId}`;
                    }
                } 
                else if (btn.classList.contains('add-accrual-btn')) {
                    this.showCreateAccrualModal(taskId);
                }
            });

            const closeModal = (id) => this.closeModal(id);
            
            document.getElementById('closeTaskDetailModal')?.addEventListener('click', () => closeModal('taskDetailModal'));
            document.getElementById('closeMyTaskAccrualModal')?.addEventListener('click', () => closeModal('createMyTaskAccrualModal'));
            document.getElementById('cancelCreateMyTaskAccrualBtn')?.addEventListener('click', () => closeModal('createMyTaskAccrualModal'));
            document.getElementById('saveNewMyTaskAccrualBtn')?.addEventListener('click', () => this.handleSaveNewAccrual());

            // [YENİ] Tahakkuk Tamamlama Modalı Butonları
            document.getElementById('cancelCompleteAccrualBtn')?.addEventListener('click', () => closeModal('completeAccrualTaskModal'));
            document.getElementById('submitCompleteAccrualBtn')?.addEventListener('click', () => this.handleCompleteAccrualSubmission());
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

            this.updateSortIcons();

            if (window.DeadlineHighlighter) {
                setTimeout(() => window.DeadlineHighlighter.refresh('islerim'), 50);
            }
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

        showTaskDetailModal(taskId) {
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

        showCreateAccrualModal(taskId) {
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

        async handleSaveNewAccrual() { 
        if (!this.currentTaskForAccrual) return;

        // ✅ çift submit engeli (buton id'niz farklıysa düzenleyin)
        const btn = document.getElementById('saveNewAccrualBtn') || document.getElementById('submitNewAccrualBtn');
        if (btn) btn.disabled = true;

        const result = this.createTaskFormManager.getData();
        if (!result.success) { 
            showNotification(result.error, 'error'); 
            if (btn) btn.disabled = false;
            return; 
        }

        const formData = result.data;

        let loader = window.showSimpleLoading ? window.showSimpleLoading('Tahakkuk Kaydediliyor') : null;

        // ✅ FileList'i DB'ye yazmıyoruz; upload sonrası metadata yazıyoruz
        const { files, ...formDataNoFiles } = formData;

        let uploadedFiles = [];
        if (files && files.length > 0) {
            try {
                const file = files[0];
                const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                const snapshot = await uploadBytes(storageRef, file);
                const url = await getDownloadURL(snapshot.ref);

                uploadedFiles.push({ 
                    name: file.name, 
                    url, 
                    type: 'foreign_invoice', 
                    documentDesignation: 'Yurtdışı Fatura/Debit', 
                    uploadedAt: new Date().toISOString() 
                });
            } catch(err) { 
                if (loader) loader.hide(); 
                showNotification("Dosya yüklenemedi.", "error"); 
                if (btn) btn.disabled = false;
                return; 
            }
        }

        // ✅ En geniş payload: formDataNoFiles bazlı
        // Not: taskId / taskTitle ve status/remainingAmount gibi sistem alanlarını biz belirliyoruz.
        const newAccrual = {
            taskId: this.currentTaskForAccrual.id,
            taskTitle: this.currentTaskForAccrual.title,

            ...formDataNoFiles,

            // ✅ normalize: boş string -> null
            tpeInvoiceNo: formDataNoFiles.tpeInvoiceNo?.trim() || null,
            evrekaInvoiceNo: formDataNoFiles.evrekaInvoiceNo?.trim() || null,

            // ✅ currency: formdan gelmiyorsa TRY fallback (istersen kaldır)
            totalAmountCurrency: formDataNoFiles.totalAmountCurrency || 'TRY',

            // ✅ kalan tutar ilk oluşturma anında total ile başlar
            remainingAmount: formDataNoFiles.totalAmount,

            status: 'unpaid',
            createdAt: new Date().toISOString(),

            files: uploadedFiles
        };

        try {
            const res = await accrualService.addAccrual(newAccrual);
            if (loader) loader.hide();

            if (res.success) { 
                showNotification('Ek tahakkuk başarıyla oluşturuldu!', 'success'); 
                this.closeModal('createTaskAccrualModal'); 
                await this.loadAllData(); 
            } else { 
                showNotification('Hata: ' + res.error, 'error'); 
            }
        } catch (e) {
            if (loader) loader.hide();
            showNotification('Hata: ' + (e?.message || e), 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }


        // --- [GÜNCELLENDİ] Tahakkuk Tamamlama Mantığı ---
        // Bu fonksiyonu async yaptık ki parent task veritabanından çekilebilsin
        async openCompleteAccrualModal(taskId) {
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            const taskIdInput = document.getElementById('targetTaskIdForCompletion');
            if(taskIdInput) taskIdInput.value = taskId;

            if(this.completeTaskFormManager) {
                this.completeTaskFormManager.reset();
                
                let epatsDoc = null;

                // 1. Önce kendi üzerindeki belgeye bak
                if (task.details?.epatsDocument) {
                    epatsDoc = task.details.epatsDocument;
                } 
                // 2. Yoksa ve bir üst işe bağlıysa (Parent Task)
                else if (task.relatedTaskId) {
                    // A) Önce eldeki listede ara
                    let parent = this.allTasks.find(t => t.id === task.relatedTaskId);
                    
                    // B) Listede yoksa (başkasına atanmış olabilir), veritabanından tekil olarak çek
                    if (!parent) {
                        try {
                            const parentRef = doc(db, 'tasks', String(task.relatedTaskId));
                            const parentSnap = await getDoc(parentRef);
                            if (parentSnap.exists()) {
                                parent = parentSnap.data();
                            }
                        } catch (e) {
                            console.warn('Parent task fetch error:', e);
                        }
                    }
                    
                    // Parent bulunduysa belgesini al
                    if (parent?.details?.epatsDocument) {
                        epatsDoc = parent.details.epatsDocument;
                    }
                }
                
                // Form yöneticisine belgeyi gönder
                this.completeTaskFormManager.showEpatsDoc(epatsDoc);
                // ✅ targetAccrualId varsa hedef tahakkuku çekip forma bas
                const targetAccrualId = task.details?.targetAccrualId;
                if (targetAccrualId) {
                    try {
                        const accRef = doc(db, 'accruals', String(targetAccrualId));
                        const accSnap = await getDoc(accRef);
                        if (accSnap.exists()) {
                            this.completeTaskFormManager.setData(accSnap.data());
                        }
                    } catch (e) {
                        console.warn('Target accrual fetch error:', e);
                    }
                }

            }

            const modal = document.getElementById('completeAccrualTaskModal');
            if(modal) modal.classList.add('show');
        }

        async handleCompleteAccrualSubmission() {
            const taskId = document.getElementById('targetTaskIdForCompletion')?.value;
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            // ✅ çift submit engeli
            const btn = document.getElementById('submitCompleteAccrualBtn');
            if (btn) btn.disabled = true;

            const result = this.completeTaskFormManager.getData();
            if (!result.success) {
                showNotification(result.error, 'error');
                if (btn) btn.disabled = false;
                return;
            }

            const formData = result.data;
            const { files, ...formDataNoFiles } = formData; // FileList DB'ye gitmesin

            let loader = window.showSimpleLoading ? window.showSimpleLoading('İşlem Tamamlanıyor') : null;

            // Dosya upload
            let uploadedFiles = [];
            if (files && files.length > 0) {
                try {
                    const file = files[0];
                    const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                    const snapshot = await uploadBytes(storageRef, file);
                    const url = await getDownloadURL(snapshot.ref);
                    uploadedFiles.push({
                        name: file.name,
                        url,
                        type: 'foreign_invoice',
                        documentDesignation: 'Yurtdışı Fatura/Debit',
                        uploadedAt: new Date().toISOString()
                    });
                } catch (err) {
                    if (loader) loader.hide();
                    showNotification("Dosya yükleme hatası.", "error");
                    if (btn) btn.disabled = false;
                    return;
                }
            }

            const cleanTitle = task.title ? task.title.replace('Tahakkuk Oluşturma: ', '') : 'Tahakkuk';

            // ✅ En geniş payload: AccrualFormManager çıktısını baz al
            const basePayload = {
                taskId: task.relatedTaskId || taskId,
                taskTitle: cleanTitle,
                ...formDataNoFiles,

                // normalize: boş string yerine null
                tpeInvoiceNo: formDataNoFiles.tpeInvoiceNo?.trim() || null,
                evrekaInvoiceNo: formDataNoFiles.evrekaInvoiceNo?.trim() || null
            };

            const targetAccrualId = task.details?.targetAccrualId;

            try {
                // 1) UPDATE yolu: targetAccrualId varsa yeni tahakkuk açma!
                if (targetAccrualId) {
                    const accRef = doc(db, 'accruals', String(targetAccrualId));
                    const accSnap = await getDoc(accRef);
                    if (!accSnap.exists()) throw new Error('Güncellenecek tahakkuk bulunamadı.');

                    const existing = accSnap.data();
                    const mergedFiles = uploadedFiles.length > 0
                        ? [ ...(existing.files || []), ...uploadedFiles ]
                        : (existing.files || []);

                    // remainingAmount’ı güvenli güncelle (eski remainingAmount = eski totalAmount ise yeni total’a eşitle)
                    let remainingAmountUpdate = {};
                    try {
                        const sameRemaining =
                            JSON.stringify(existing.remainingAmount || null) === JSON.stringify(existing.totalAmount || null);
                        if (sameRemaining) remainingAmountUpdate = { remainingAmount: basePayload.totalAmount };
                    } catch (_) {}

                    const updates = {
                        ...basePayload,
                        files: mergedFiles,
                        ...remainingAmountUpdate
                        // createdAt/createdBy/status gibi alanları bilerek set etmiyoruz
                    };

                    const updRes = await accrualService.updateAccrual(String(targetAccrualId), updates);
                    if (!updRes.success) throw new Error(updRes.error);

                } else {
                    // 2) ADD yolu: targetAccrualId yoksa yeni tahakkuk oluştur
                    const newAccrual = {
                        ...basePayload,
                        status: 'unpaid',
                        remainingAmount: basePayload.totalAmount,
                        files: uploadedFiles
                    };

                    const addRes = await accrualService.addAccrual(newAccrual);
                    if (!addRes.success) throw new Error(addRes.error);

                    // ✅ yeni oluşan tahakkuk id’sini task.details.targetAccrualId olarak yaz
                    await taskService.updateTask(taskId, {
                        details: { ...(task.details || {}), targetAccrualId: addRes.data.id }
                    });
                }

                // Görevi kapat
                const updateData = {
                    status: 'completed',
                    updatedAt: new Date().toISOString(),
                    history: [
                        ...(task.history || []),
                        {
                            action: targetAccrualId ? 'Tahakkuk güncellenerek görev tamamlandı.' : 'Tahakkuk oluşturularak görev tamamlandı.',
                            timestamp: new Date().toISOString(),
                            userEmail: this.currentUser.email
                        }
                    ]
                };

                const taskResult = await taskService.updateTask(taskId, updateData);
                if (!taskResult.success) throw new Error('Görev güncellenemedi.');

                if (loader) loader.hide();
                showNotification(targetAccrualId ? 'Tahakkuk güncellendi ve görev tamamlandı.' : 'Tahakkuk oluşturuldu ve görev tamamlandı.', 'success');
                this.closeModal('completeAccrualTaskModal');
                await this.loadAllData();

            } catch (e) {
                if (loader) loader.hide();
                showNotification('Hata: ' + e.message, 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        }


        closeModal(modalId) {
            const m = document.getElementById(modalId);
            if(m) m.classList.remove('show');
            
            // Modallar kapanırken formları sıfırla
            if (modalId === 'createMyTaskAccrualModal' && this.accrualFormManager) {
                this.accrualFormManager.reset();
                this.currentTaskForAccrual = null;
            }
            if (modalId === 'completeAccrualTaskModal' && this.completeTaskFormManager) {
                this.completeTaskFormManager.reset();
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