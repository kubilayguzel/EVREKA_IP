// public/js/task-management/main.js

import { authService, taskService, ipRecordsService, accrualService, personService, transactionTypeService, db } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { doc, getDoc, collection, query, where, getDocs, documentId } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
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

            // Veri Havuzları (Arrays)
            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allUsers = [];
            this.allTransactionTypes = [];
            this.allAccruals = [];

            // --- PERFORMANS HARİTALARI (MAPS) ---
            // Bu yapılar sayesinde binlerce kayıt arasında "find" yapmak yerine
            // direkt ID ile ışık hızında veriyi çekeceğiz.
            this.ipRecordsMap = new Map();
            this.usersMap = new Map();
            this.transactionTypesMap = new Map();

            // İşlenmiş ve Filtrelenmiş Veriler
            this.processedData = []; 
            this.filteredData = [];

            // Sıralama ve Sayfalama Durumu
            this.sortState = { key: 'id', direction: 'desc' }; // Varsayılan: En yeni ID en üstte
            this.pagination = null;

            // Seçili İşlem Durumları
            this.selectedTaskForAssignment = null;
            this.currentTaskForAccrual = null;
            this.selectedTaskIds = new Set(); // YENİ: Seçili görevlerin ID'leri
            this.tasksToAssign = []; // YENİ: Atanacak görevler listesi

            // Component Yöneticileri
            this.createTaskFormManager = null;
            this.completeTaskFormManager = null;
            this.taskDetailManager = null;

            this.activeMainTab = 'active'; // Varsayılan ana sekme
            this.activeSubTab = 'active';  // Varsayılan alt sekme

            // Statü Çevirileri (Object lookup map'ten daha hızlıdır veya denktir)
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
                loader = window.showSimpleLoading('İş Listesi Yükleniyor', 'Lütfen bekleyiniz...');
            } else {
                const oldLoader = document.getElementById('loadingIndicator');
                if(oldLoader) oldLoader.style.display = 'block';
            }

            try {
                // SADECE Gerekli Verileri Çekiyoruz (Ağır IP ve Accrual listelerini kaldırdık)
                const [tasksResult, personsResult, usersResult, transactionTypesResult] = await Promise.all([
                    taskService.getAllTasks(),
                    personService.getPersons(),
                    taskService.getAllUsers(),
                    transactionTypeService.getTransactionTypes()
                ]);

                this.allTasks = tasksResult.success ? tasksResult.data : [];
                this.allPersons = personsResult.success ? personsResult.data : [];
                this.allUsers = usersResult.success ? usersResult.data : [];
                this.allTransactionTypes = transactionTypesResult.success ? transactionTypesResult.data : [];

                // Haritaları Oluştur
                this.buildMaps();

                // Formları Başlat
                this.initForms();

                // Tabloyu hemen göster (IP verileri "Yükleniyor..." olarak görünecek)
                this.processData();
                if (this.pagination) {
                    this.pagination.update(this.filteredData.length);
                }
                this.renderTable();

                // ARKA PLAN: IP Kayıtlarını Parça Parça Getir (UI donmadan)
                this.fetchRelatedIpRecordsInChunks();

            } catch (error) {
                console.error(error);
                if (loader) loader.hide(); 
                showNotification('Veriler yüklenirken hata oluştu: ' + error.message, 'error');
            } finally {
                if (loader) loader.hide();
                const oldLoader = document.getElementById('loadingIndicator');
                if(oldLoader) oldLoader.style.display = 'none';
            }
        }

        buildMaps() {
            this.ipRecordsMap.clear();
            // IP haritası başlangıçta boş, fetchRelatedIpRecordsInChunks ile dolacak.

            this.usersMap.clear();
            this.allUsers.forEach(u => {
                if(u.id) this.usersMap.set(u.id, u);
            });

            this.transactionTypesMap.clear();
            this.allTransactionTypes.forEach(t => {
                if(t.id) this.transactionTypesMap.set(t.id, t);
            });
        }

        // --- YENİ: Akıllı IP Çekme Fonksiyonu ---
        async fetchRelatedIpRecordsInChunks() {
            // 1. İşlerde geçen benzersiz IP ID'lerini topla
            const uniqueIpIds = new Set();
            this.allTasks.forEach(t => {
                if (t.relatedIpRecordId) uniqueIpIds.add(t.relatedIpRecordId);
            });

            const idsToFetch = Array.from(uniqueIpIds);
            if (idsToFetch.length === 0) return;

            // 2. ID'leri 30'arlı gruplara böl (Firestore limiti)
            const chunkSize = 30;
            const chunks = [];
            for (let i = 0; i < idsToFetch.length; i += chunkSize) {
                chunks.push(idsToFetch.slice(i, i + chunkSize));
            }

            const fetchChunk = async (chunk) => {
                try {
                    const q = query(collection(db, 'ipRecords'), where(documentId(), 'in', chunk));
                    const snapshot = await getDocs(q);
                    snapshot.forEach(doc => {
                        this.ipRecordsMap.set(doc.id, { id: doc.id, ...doc.data() });
                    });
                } catch (e) {
                    console.warn("IP chunk fetch hatası:", e);
                }
            };

            // İlk 2 grubu hemen çekip tabloyu güncelle
            const initialChunks = chunks.slice(0, 2);
            const remainingChunks = chunks.slice(2);

            await Promise.all(initialChunks.map(chunk => fetchChunk(chunk)));
            
            // UI Güncelle
            this.processData();
            this.renderTable();

            // Kalanları 5'li paraleller halinde çek
            if (remainingChunks.length > 0) {
                const parallelLimit = 5;
                for (let i = 0; i < remainingChunks.length; i += parallelLimit) {
                    const batch = remainingChunks.slice(i, i + parallelLimit);
                    await Promise.all(batch.map(chunk => fetchChunk(chunk)));
                }
                // Son güncelleme
                this.processData();
                this.renderTable();
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
            // Helper fonksiyon (Date parsing)
            const parseDate = (d) => {
                if (!d) return null;
                if (d.toDate) return d.toDate(); // Firestore Timestamp
                if (d.seconds) return new Date(d.seconds * 1000);
                return new Date(d); 
            };

            this.processedData = this.allTasks.map(task => {
                // --- OPTİMİZE EDİLMİŞ VERİ ÇEKME ---
                
                // 1. İlişkili Kayıt (IP Record)
                // Map üzerinden çekiyoruz. Veri henüz yüklenmediyse (undefined ise) ve ID varsa 'Yükleniyor...' gösteriyoruz.
                const ipRecord = this.ipRecordsMap.get(task.relatedIpRecordId);
                
                const relatedRecord = ipRecord 
                    ? (ipRecord.applicationNumber || ipRecord.applicationNo || ipRecord.title || 'Kayıt Bulunamadı') 
                    : (task.relatedIpRecordId ? 'Yükleniyor...' : '—');

                // 2. İşlem Tipi
                const transactionTypeObj = this.transactionTypesMap.get(task.taskType);
                const taskTypeDisplay = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || 'Bilinmiyor');

                // 3. Atanan Kişi
                const assignedUser = this.usersMap.get(task.assignedTo_uid);
                const assignedToDisplay = assignedUser ? (assignedUser.displayName || assignedUser.email) : 'Atanmamış';

                // Tarih İşlemleri
                const operationalDueObj = parseDate(task.dueDate); 
                const operationalDueISO = operationalDueObj ? operationalDueObj.toISOString().slice(0, 10) : ''; 
                const operationalDueDisplay = operationalDueObj ? operationalDueObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                const officialDueObj = parseDate(task.officialDueDate); 
                const officialDueISO = officialDueObj ? officialDueObj.toISOString().slice(0, 10) : '';
                const officialDueDisplay = officialDueObj ? officialDueObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                // Arama Metni (Search String)
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

            this.handleSearch();
        }

        // --- ARAMA ve FİLTRELEME ---
        handleSearch(query) {
            // 1. Arama Metnini Al
            const searchInput = document.getElementById('searchInput');
            const searchValue = (query !== undefined ? query : (searchInput?.value || '')).toLowerCase();

            // 2. Filtreleme Mantığı
            this.filteredData = this.processedData.filter(item => {
                // A) Metin Araması
                const matchesSearch = !searchValue || item.searchString.includes(searchValue);
                
                // B) Tab Filtresi
                let matchesTab = false;
                
                // İş "Bitti" mi?
                const isFinished = ['completed', 'cancelled', 'client_approval_closed', 'client_no_response_closed'].includes(item.status);
                
                // İş "Tahakkuk" (Tip 53) mu?
                const isAccrualTask = String(item.taskType) === '53';

                if (this.activeMainTab === 'active') {
                    // Tahakkuk OLMAYAN ve Henüz BİTMEMİŞ işler
                    matchesTab = !isAccrualTask && !isFinished;
                } 
                else if (this.activeMainTab === 'completed') {
                    // Tahakkuk OLMAYAN ve BİTMİŞ işler
                    matchesTab = !isAccrualTask && isFinished;
                } 
                else if (this.activeMainTab === 'accrual') {
                    // Sadece Tip 53 olanlar
                    if (isAccrualTask) {
                        if (this.activeSubTab === 'active') {
                            matchesTab = !isFinished; // Bekleyen Tahakkuklar
                        } else {
                            matchesTab = isFinished;  // Tamamlanan Tahakkuklar
                        }
                    }
                }

                return matchesSearch && matchesTab;
            });

            // 3. Sıralama ve Render
            this.sortData();

            if (this.pagination) {
                this.pagination.reset();
                this.pagination.update(this.filteredData.length);
            }
            
            this.renderTable();
        }

        // --- SIRALAMA (SORTING) ---
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
                let valA = a[key];
                let valB = b[key];

                if (valA == null) valA = '';
                if (valB == null) valB = '';

                if (valA instanceof Date && valB instanceof Date) return (valA - valB) * multiplier;
                if (valA instanceof Date) return -1 * multiplier; 
                if (valB instanceof Date) return 1 * multiplier;

                if (key === 'id') {
                    const numA = parseFloat(String(valA).replace(/[^0-9]/g, ''));
                    const numB = parseFloat(String(valB).replace(/[^0-9]/g, ''));
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return (numA - numB) * multiplier;
                    }
                }

                return String(valA).localeCompare(String(valB), 'tr') * multiplier;
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
                        <td><input type="checkbox" class="task-checkbox" value="${task.id}" ${this.selectedTaskIds.has(task.id) ? 'checked' : ''}></td>
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
            this.attachCheckboxListeners(); // YENİ: Checkbox dinleyicilerini bağla

            if (window.DeadlineHighlighter && typeof window.DeadlineHighlighter.refresh === 'function') {
                setTimeout(() => window.DeadlineHighlighter.refresh('taskManagement'), 50);
            }
        }

        attachCheckboxListeners() {
            const selectAllCb = document.getElementById('selectAllTasks');
            const rowCbs = document.querySelectorAll('.task-checkbox');

            // Tümü Seç / Kaldır
            if (selectAllCb) {
                // Event listener'ı çoklamamak için önce klonlayıp temizliyoruz
                const newSelectAll = selectAllCb.cloneNode(true);
                selectAllCb.parentNode.replaceChild(newSelectAll, selectAllCb);
                
                newSelectAll.addEventListener('change', (e) => {
                    const isChecked = e.target.checked;
                    rowCbs.forEach(cb => {
                        cb.checked = isChecked;
                        if (isChecked) this.selectedTaskIds.add(cb.value);
                        else this.selectedTaskIds.delete(cb.value);
                    });
                    this.updateBatchAssignButton();
                });
            }

            // Tekil Seçimler
            rowCbs.forEach(cb => {
                cb.addEventListener('change', (e) => {
                    if (e.target.checked) this.selectedTaskIds.add(e.target.value);
                    else this.selectedTaskIds.delete(e.target.value);
                    
                    if (selectAllCb) {
                        selectAllCb.checked = Array.from(rowCbs).every(c => c.checked);
                    }
                    this.updateBatchAssignButton();
                });
            });
        }

        updateBatchAssignButton() {
            const btn = document.getElementById('batchAssignBtn');
            const countSpan = document.getElementById('selectedTaskCount');
            if (!btn || !countSpan) return;

            if (this.selectedTaskIds.size > 0) {
                countSpan.textContent = this.selectedTaskIds.size;
                btn.style.display = 'inline-block';
            } else {
                btn.style.display = 'none';
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

        // --- EVENT LISTENERS ---
        setupStaticEventListeners() {
            const mainTabs = document.querySelectorAll('#mainTaskTabs .nav-link');
            const subTabContainer = document.getElementById('accrualSubTabsContainer');

            mainTabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.preventDefault();
                    
                    mainTabs.forEach(t => {
                        t.classList.remove('active');
                        t.style.color = '#6c757d';
                    });
                    e.currentTarget.classList.add('active');
                    e.currentTarget.style.color = '#495057';

                    this.activeMainTab = e.currentTarget.dataset.tab;

                    if (this.activeMainTab === 'accrual') {
                        subTabContainer.style.display = 'block';
                    } else {
                        subTabContainer.style.display = 'none';
                    }

                    this.handleSearch();
                });
            });

            const subTabs = document.querySelectorAll('#accrualSubTabs .nav-link');
            subTabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.preventDefault();
                    subTabs.forEach(t => t.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    this.activeSubTab = e.currentTarget.dataset.subtab;
                    this.handleSearch();
                });
            });

            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
            }

            const statusFilter = document.getElementById('statusFilter');
            if (statusFilter) {
                statusFilter.addEventListener('change', () => {
                    const currentSearchValue = document.getElementById('searchInput')?.value || '';
                    this.handleSearch(currentSearchValue);
                });
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
                            window.location.href = `task-update.html?id=${taskId}`;
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

            document.getElementById('cancelCreateTaskAccrualBtn')?.addEventListener('click', () => this.closeModal('createTaskAccrualModal'));
            document.getElementById('saveNewAccrualBtn')?.addEventListener('click', () => this.handleSaveNewAccrual());

            document.getElementById('cancelCompleteAccrualBtn')?.addEventListener('click', () => this.closeModal('completeAccrualTaskModal'));
            document.getElementById('submitCompleteAccrualBtn')?.addEventListener('click', () => this.handleCompleteAccrualSubmission());
            document.getElementById('batchAssignBtn')?.addEventListener('click', () => this.openAssignTaskModal());
                    // Export buton dinleyicileri
            document.getElementById('btnExportSelected')?.addEventListener('click', (e) => { 
                e.preventDefault(); 
                this.exportToExcel('selected'); 
            });
            document.getElementById('btnExportAll')?.addEventListener('click', (e) => { 
                e.preventDefault(); 
                this.exportToExcel('all'); 
            });      
                
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
                // Taze Task Verisi
                const taskRef = doc(db, 'tasks', String(taskId));
                const taskSnap = await getDoc(taskRef);

                if (!taskSnap.exists()) {
                    this.taskDetailManager.showError('Bu iş kaydı bulunamadı.');
                    return;
                }

                const task = { id: taskSnap.id, ...taskSnap.data() };
                modalTitle.textContent = `İş Detayı (${task.id})`;

                const ipRecord = this.ipRecordsMap.get(task.relatedIpRecordId);
                const transactionType = this.transactionTypesMap.get(task.taskType);
                const assignedUser = this.usersMap.get(task.assignedTo_uid);
                
                // --- DEĞİŞİKLİK: Tahakkukları sadece bu iş için veritabanından çek ---
                const qAccruals = query(collection(db, 'accruals'), where('taskId', '==', String(task.id)));
                const accSnap = await getDocs(qAccruals);
                const relatedAccruals = accSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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

        openAssignTaskModal(taskId = null) {
            this.tasksToAssign = [];
            
            // Eğer butondan tekil tıklandıysa
            if (taskId) {
                const t = this.allTasks.find(task => task.id === String(taskId));
                if(t) this.tasksToAssign.push(t);
            } 
            // Eğer Toplu Ata butonundan tıklandıysa
            else {
                this.tasksToAssign = this.allTasks.filter(t => this.selectedTaskIds.has(String(t.id)));
            }

            if (this.tasksToAssign.length === 0) { 
                showNotification('Atanacak iş bulunamadı veya seçilmedi.', 'error'); 
                return; 
            }

            const select = document.getElementById('newAssignedTo');
            if (select) {
                select.innerHTML = '<option value="">Seçiniz...</option>';
                this.allUsers.forEach(user => {
                    const opt = document.createElement('option');
                    opt.value = user.id;
                    opt.textContent = user.displayName || user.email;
                    // Sadece tekil seçimse eski sahibini seçili getir
                    if (this.tasksToAssign.length === 1 && user.id === this.tasksToAssign[0].assignedTo_uid) {
                        opt.selected = true;
                    }
                    select.appendChild(opt);
                });
            }
            document.getElementById('assignTaskModal').classList.add('show');
        }

        async saveNewAssignment() {
            const uid = document.getElementById('newAssignedTo')?.value;
            if (!uid) { showNotification('Lütfen kullanıcı seçin.', 'warning'); return; }
            
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Atama Yapılıyor') : null;
            const user = this.usersMap.get(uid);

            try {
                const assignPromises = this.tasksToAssign.map(task => {
                    const updateData = { assignedTo_uid: uid, assignedTo_email: user.email };
                    const historyEntry = { 
                        action: `İş yeniden atandı: ${task.assignedTo_email || 'Atanmamış'} -> ${user.email}`, 
                        timestamp: new Date().toISOString(), 
                        userEmail: this.currentUser.email 
                    };
                    
                    let history = task.history ? [...task.history] : [];
                    history.push(historyEntry);
                    updateData.history = history;

                    return taskService.updateTask(task.id, updateData);
                });

                await Promise.all(assignPromises); // Bütün seçili görevleri paralel güncelle
                
                if (loader) loader.hide();
                showNotification(`${this.tasksToAssign.length} adet iş başarıyla atandı!`, 'success'); 
                
                this.selectedTaskIds.clear(); // Seçimleri sıfırla
                this.updateBatchAssignButton();
                this.closeModal('assignTaskModal'); 
                
                // Header checkbox'ı sıfırla
                const selectAllCb = document.getElementById('selectAllTasks');
                if(selectAllCb) selectAllCb.checked = false;

                await this.loadAllData(); 
            } catch (e) { 
                if (loader) loader.hide();
                console.error(e);
                showNotification('Atama sırasında hata oluştu.', 'error'); 
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


        // --- Tahakkuk Tamamlama Mantığı ---
        async openCompleteAccrualModal(taskId) {
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
                // ✅ Eğer bu task bir tahakkuk GÜNCELLEME işi ise, hedef tahakkuku çekip forma bas
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

            document.getElementById('completeAccrualTaskModal').classList.add('show');
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

        async exportToExcel(mode) {
            let dataToExport = [];

            if (mode === 'selected') {
                if (this.selectedTaskIds.size === 0) {
                    showNotification('Lütfen en az bir iş seçiniz.', 'warning');
                    return;
                }
                dataToExport = this.processedData.filter(item => this.selectedTaskIds.has(String(item.id)));
            } else {
                // O anki filtreli ve sıralı listeyi al
                dataToExport = [...this.filteredData];
            }

            if (dataToExport.length === 0) {
                showNotification('Aktarılacak veri bulunamadı.', 'warning');
                return;
            }

            // Loader göster
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Excel Hazırlanıyor') : null;

            try {
                // Kütüphaneleri dinamik yükle (Portföydeki gibi)
                const loadScript = (src) => {
                    return new Promise((resolve, reject) => {
                        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
                        const script = document.createElement('script');
                        script.src = src;
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                };

                if (!window.ExcelJS) await loadScript('https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js');
                if (!window.saveAs) await loadScript('https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js');

                const workbook = new window.ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('İş Listesi');

                // Sütun tanımları
                worksheet.columns = [
                    { header: 'İş No', key: 'id', width: 15 },
                    { header: 'İlgili Kayıt', key: 'relatedRecord', width: 30 },
                    { header: 'İş Tipi', key: 'taskTypeDisplay', width: 25 },
                    { header: 'Konu', key: 'title', width: 40 },
                    { header: 'Öncelik', key: 'priority', width: 12 },
                    { header: 'Atanan', key: 'assignedToDisplay', width: 25 },
                    { header: 'Operasyonel Son Tarih', key: 'operationalDueDisplay', width: 20 },
                    { header: 'Resmi Son Tarih', key: 'officialDueDisplay', width: 20 },
                    { header: 'Durum', key: 'statusText', width: 20 }
                ];

                // Başlık Stili
                const headerRow = worksheet.getRow(1);
                headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3C72' } };
                headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

                // Verileri Ekle
                dataToExport.forEach(task => {
                    worksheet.addRow({
                        id: task.id,
                        relatedRecord: task.relatedRecord,
                        taskTypeDisplay: task.taskTypeDisplay,
                        title: task.title || '-',
                        priority: task.priority,
                        assignedToDisplay: task.assignedToDisplay,
                        operationalDueDisplay: task.operationalDueDisplay,
                        officialDueDisplay: task.officialDueDisplay,
                        statusText: task.statusText
                    });
                });

                // Dosyayı Kaydet
                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const dateStr = new Date().toISOString().slice(0, 10);
                window.saveAs(blob, `Is_Yonetimi_Export_${dateStr}.xlsx`);
                
                showNotification('Excel başarıyla oluşturuldu.', 'success');
            } catch (error) {
                console.error('Excel Export Hatası:', error);
                showNotification('Excel oluşturulurken bir hata oluştu.', 'error');
            } finally {
                if (loader) loader.hide();
            }
        }

        closeModal(modalId) {
            const m = document.getElementById(modalId);
            if(m) m.classList.remove('show');
            if(modalId === 'createTaskAccrualModal' && this.createTaskFormManager) this.createTaskFormManager.reset();
            if(modalId === 'completeAccrualTaskModal' && this.completeTaskFormManager) this.completeTaskFormManager.reset();
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