// public/js/indexing/triggered-tasks.js

import { authService, taskService, ipRecordsService, accrualService, personService, transactionTypeService, functions } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { doc, getDoc, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from '../../firebase-config.js';

// --- ORTAK MODÜLLER ---
import Pagination from '../pagination.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';
import { TaskDetailManager } from '../components/TaskDetailManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'triggered-tasks.html' });

    class TriggeredTasksModule {
        constructor() {
            this.currentUser = null;
            
            // Veri Havuzları
            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allAccruals = [];
            this.allTransactionTypes = [];

            // Tablo Yönetimi
            this.processedData = [];
            this.filteredData = [];
            this.sortState = { key: 'officialDueObj', direction: 'asc' };
            this.pagination = null;

            // Seçili Görevler
            this.currentTaskForAccrual = null;
            this.currentTaskForStatusChange = null;

            // --- MANAGERS (Ortak Bileşenler) ---
            this.taskDetailManager = null;
            this.accrualFormManager = null;

            // Statü Tanımları
            this.statusDisplayMap = {
                'open': 'Açık', 'in-progress': 'Devam Ediyor', 'completed': 'Tamamlandı',
                'pending': 'Beklemede', 'cancelled': 'İptal Edildi', 'on-hold': 'Askıda',
                'awaiting-approval': 'Onay Bekliyor',
                'awaiting_client_approval': 'Müvekkil Onayı Bekliyor',
                'client_approval_opened': 'Müvekkil Onayı - Açıldı',
                'client_approval_closed': 'Müvekkil Onayı - Kapatıldı',
                'client_no_response_closed': 'Müvekkil Cevaplamadı - Kapatıldı'
            };

            this.triggeredTaskStatuses = [
                'awaiting_client_approval', 'client_approval_opened', 
                'client_approval_closed', 'client_no_response_closed'
            ];
        }

        init() {
            this.initializePagination();
            this.setupStaticEventListeners();

            // Managerları Başlat (HTML'deki container ID'lerine göre)
            this.taskDetailManager = new TaskDetailManager('modalBody');
            
            // AccrualFormManager veriler yüklendikten sonra 'allPersons' ile render edilecek
            // Şimdilik boş başlatıyoruz
            this.accrualFormManager = new AccrualFormManager('accrualFormContainer', 'triggeredAccrual');

            authService.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    this.currentUser = user;
                    await this.loadAllData();
                } else {
                    window.location.href = '/index.html';
                }
            });
        }

        initializePagination() {
            if (typeof Pagination !== 'undefined') {
                this.pagination = new Pagination({
                    containerId: 'paginationContainer',
                    itemsPerPage: 10,
                    itemsPerPageOptions: [10, 25, 50, 100],
                    onPageChange: () => this.renderTable()
                });
            }
        }

        async loadAllData() {
            const loader = document.getElementById('loadingIndicator');
            if (loader) loader.style.display = 'block';

            try {
                let isSuper = false;
                try {
                    const token = await this.currentUser.getIdTokenResult();
                    isSuper = !!(token.claims && token.claims.superAdmin);
                } catch (_) {}

                const [tasksResult, personsResult, transTypesResult, accrualsResult] = await Promise.all([
                    isSuper ? taskService.getAllTasks() : taskService.getTasksForUser(this.currentUser.uid),
                    personService.getPersons(),
                    transactionTypeService.getTransactionTypes(),
                    accrualService.getAccruals()
                ]);

                this.allTasks = tasksResult.success ? tasksResult.data : [];
                this.allTasks = tasksResult.success ? tasksResult.data : [];
                // ✅ Görevlerde kullanılan IP kayıtlarını ID bazlı ve server'dan çek (GARANTİLİ)
                const relatedIds = [...new Set(
                    (this.allTasks || [])
                        .map(t => t.relatedIpRecordId)
                        .filter(Boolean)
                        .map(id => String(id))
                )];

                let ipRecords = [];
                if (relatedIds.length) {
                    const ipRes = await ipRecordsService.getRecordsByIds(relatedIds, { source: 'server' });
                    ipRecords = ipRes.success ? ipRes.data : [];
                }
                this.allIpRecords = ipRecords;

                this.allPersons = personsResult.success ? personsResult.data : [];
                this.allTransactionTypes = transTypesResult.success ? transTypesResult.data : [];
                this.allAccruals = accrualsResult.success ? accrualsResult.data : [];

                // --- MANAGER GÜNCELLEME ---
                // Kişi listesi geldiği için Form Manager'ı güncelleyip render ediyoruz
                this.accrualFormManager.allPersons = this.allPersons;
                this.accrualFormManager.render();

                this.processData();

            } catch (error) {
                console.error(error);
                showNotification('Veriler yüklenirken hata oluştu.', 'error');
            } finally {
                if (loader) loader.style.display = 'none';
            }
        }

        processData() {
            const relevantTasks = this.allTasks.filter(task => this.triggeredTaskStatuses.includes(task.status));

            this.processedData = relevantTasks.map(task => {
                const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId) || null;
                const transactionTypeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                
                const taskTypeDisplayName = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || 'Bilinmiyor');
                const applicationNumber = ipRecord?.applicationNumber || 'N/A';
                const relatedRecordTitle = task.relatedIpRecordTitle || 'N/A';

                // --- [BAŞLANGIÇ] SAHİP BİLGİSİ GÜNCELLEMESİ ---
                
                let resolvedOwnerName = null;

                // 1. ADIM: Task Owner (Görev Sahibi) Kontrolü
                // Veritabanındaki taskOwner dizisinin ilk elemanını alıp Kişiler (allPersons) listesinde arıyoruz.
                if (Array.isArray(task.taskOwner) && task.taskOwner.length > 0) {
                    const ownerId = task.taskOwner[0];
                    // ownerId bazen yanlışlıkla TaskID olabiliyor, bu yüzden persons listesinde ID eşleşmesi var mı diye bakıyoruz.
                    const person = this.allPersons.find(p => p.id === ownerId);
                    if (person) {
                        resolvedOwnerName = person.name;
                    }
                }

                // 2. ADIM: Fallback (Yedek) - IP Record Applicants
                // Eğer taskOwner boşsa veya geçerli bir kişi bulunamadıysa (örn: 197 nolu task hatası), dosya sahiplerini çekiyoruz.
                if (!resolvedOwnerName) {
                    if (ipRecord && Array.isArray(ipRecord.applicants) && ipRecord.applicants.length > 0) {
                        resolvedOwnerName = ipRecord.applicants.map(a => {
                            // a: String ID olabilir, {name: '...'} olabilir veya {id: '...'} olabilir.
                            if (a.name) return a.name; // İsim varsa direkt al
                            
                            const pId = (typeof a === 'string') ? a : a.id;
                            if (pId) {
                                const p = this.allPersons.find(person => person.id === pId);
                                return p ? p.name : '';
                            }
                            return '';
                        }).filter(Boolean).join(', ');
                    }
                }

                const applicantName = resolvedOwnerName || 'N/A';
                
                // --- [BİTİŞ] SAHİP BİLGİSİ GÜNCELLEMESİ ---

                // --- TARİH DÜZELTMESİ ---
                const parseDate = (d) => {
                    if (!d) return null;
                    if (d.toDate) return d.toDate();
                    if (d.seconds) return new Date(d.seconds * 1000);
                    return new Date(d);
                };

                const operationalDueObj = parseDate(task.dueDate); 
                const officialDueObj = parseDate(task.officialDueDate);

                const statusText = this.statusDisplayMap[task.status] || task.status;
                const searchString = `${task.id} ${applicationNumber} ${relatedRecordTitle} ${applicantName} ${taskTypeDisplayName} ${statusText}`.toLowerCase();

                return {
                    ...task,
                    applicationNumber,
                    relatedRecordTitle,
                    applicantName, // Hesapladığımız yeni isim buraya atanıyor
                    taskTypeDisplayName,
                    operationalDueObj,
                    officialDueObj,
                    statusText,
                    searchString
                };
            });

            this.handleSearch(document.getElementById('searchInput')?.value || '');
        }

        // --- ARAMA ve SIRALAMA (Standart) ---
        handleSearch(query) {
            const statusFilter = document.getElementById('statusFilter').value;
            const lowerQuery = query ? query.toLowerCase() : '';

            this.filteredData = this.processedData.filter(item => {
                const matchesSearch = !lowerQuery || item.searchString.includes(lowerQuery);
                const matchesStatus = (statusFilter === 'all' || item.status === statusFilter);
                return matchesSearch && matchesStatus;
            });

            this.sortData();
            if (this.pagination) {
                this.pagination.reset();
                this.pagination.update(this.filteredData.length);
            }
            this.renderTable();
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
                let valA = a[key];
                let valB = b[key];

                // --- ÖZEL KURAL: Boş Değerler En Üstte ---
                // Değer boş mu kontrol et (null, undefined veya boş string)
                const isEmptyA = (valA === null || valA === undefined || valA === '');
                const isEmptyB = (valB === null || valB === undefined || valB === '');

                // Eğer ikisi de boşsa sıralama değişmez
                if (isEmptyA && isEmptyB) return 0;
                
                // Eğer sadece A boşsa, A'yı en üste al (-1)
                if (isEmptyA) return -1;
                
                // Eğer sadece B boşsa, B'yi en üste al (1)
                // (Burada A dolu olduğu için B onun altına gelmeli veya tam tersi mantıkla
                // array'in başında toplanmalılar)
                if (isEmptyB) return 1;
                // ------------------------------------------

                // Tarih Karşılaştırması
                if (valA instanceof Date && valB instanceof Date) {
                    return (valA - valB) * multiplier;
                }

                // ID (Sayısal) Karşılaştırması
                if (key === 'id') {
                    const numA = parseInt(String(valA), 10);
                    const numB = parseInt(String(valB), 10);
                    if (!isNaN(numA) && !isNaN(numB)) return (numA - numB) * multiplier;
                }

                // Metin (String) Karşılaştırması
                return String(valA).localeCompare(String(valB), 'tr') * multiplier;
            });
            
            this.updateSortIcons();
        }


        updateSortIcons() {
            document.querySelectorAll('#tasksTableHeaderRow th[data-sort]').forEach(th => {
                const icon = th.querySelector('i');
                if (icon) {
                    icon.className = 'fas fa-sort';
                    icon.style.opacity = '0.3';
                    if (th.dataset.sort === this.sortState.key) {
                        icon.className = this.sortState.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                        icon.style.opacity = '1';
                    }
                }
            });
        }

        // --- RENDER ---
        renderTable() {
            const tbody = document.getElementById('myTasksTableBody');
            const noRecordsMsg = document.getElementById('noTasksMessage');
            tbody.innerHTML = '';

            if (this.filteredData.length === 0) {
                noRecordsMsg.style.display = 'block';
                return;
            }
            noRecordsMsg.style.display = 'none';

            let currentData = this.filteredData;
            if (this.pagination) {
                currentData = this.pagination.getCurrentPageData(this.filteredData);
            }

            currentData.forEach(task => {
                const row = document.createElement('tr');
                const statusClass = `status-${task.status.replace(/ /g, '_').toLowerCase()}`;
                
                // Tarih gösterimleri (Güvenli kontrol)
                const opDate = task.operationalDueObj ? task.operationalDueObj.toLocaleDateString('tr-TR') : '-';
                const offDate = task.officialDueObj ? task.officialDueObj.toLocaleDateString('tr-TR') : '-';
                const opISO = task.operationalDueObj ? task.operationalDueObj.toISOString().slice(0,10) : '';
                const offISO = task.officialDueObj ? task.officialDueObj.toISOString().slice(0,10) : '';

                row.innerHTML = `
                    <td>${task.id}</td>
                    <td>${task.applicationNumber}</td>
                    <td>${task.relatedRecordTitle}</td>
                    <td>${task.applicantName}</td>
                    <td>${task.taskTypeDisplayName}</td>
                    <td data-field="operationalDue" data-date="${opISO}">${opDate}</td>
                    <td data-field="officialDue" data-date="${offISO}">${offDate}</td>
                    <td><span class="status-badge ${statusClass}">${task.statusText}</span></td>
                    <td>
                        <button class="action-btn view-btn" data-id="${task.id}">Görüntüle</button>
                        <button class="action-btn edit-btn" data-id="${task.id}">Düzenle</button>
                        <button class="action-btn add-accrual-btn" data-id="${task.id}">Ek Tahakkuk</button>
                        <button class="action-btn change-status-btn" data-id="${task.id}">Durum</button>
                    </td>
                `;
                tbody.appendChild(row);
            });

            if (window.DeadlineHighlighter) {
                setTimeout(() => window.DeadlineHighlighter.refresh('triggeredTasks'), 50);
            }
        }

        // --- ENTEGRASYON NOKTALARI (Shared Components) ---

        // 1. TaskDetailManager Kullanımı
        showTaskDetail(taskId) {
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            const modal = document.getElementById('taskDetailModal');
            const title = document.getElementById('modalTaskTitle');
            modal.classList.add('show');
            title.textContent = 'Yükleniyor...';
            this.taskDetailManager.showLoading();

            // İlişkili verileri bul
            const ipRecord = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
            const transactionType = this.allTransactionTypes.find(t => t.id === task.taskType);
            const assignedUser = task.assignedTo_email ? { email: task.assignedTo_email } : null;
            const relatedAccruals = this.allAccruals.filter(acc => String(acc.taskId) === String(task.id));

            title.textContent = `İş Detayı (${task.id})`;
            
            // --- MANAGER RENDER ÇAĞRISI ---
            this.taskDetailManager.render(task, {
                ipRecord, transactionType, assignedUser, accruals: relatedAccruals
            });
        }

        // 2. AccrualFormManager Kullanımı
        showAccrualModal(taskId) {
            this.currentTaskForAccrual = this.allTasks.find(t => t.id === taskId);
            if (!this.currentTaskForAccrual) return;

            document.getElementById('accrualTaskTitleDisplay').value = this.currentTaskForAccrual.title;
            
            // --- MANAGER RESET ve DATA ---
            this.accrualFormManager.reset();
            
            // EPATS Belgesi varsa bul ve form manager'a gönder
            // (Bu mantık main.js'de de vardı, burada da koruyoruz)
            let epatsDoc = null;
            if (this.currentTaskForAccrual.details?.epatsDocument) {
                epatsDoc = this.currentTaskForAccrual.details.epatsDocument;
            } else if (this.currentTaskForAccrual.relatedTaskId) {
                const parent = this.allTasks.find(t => t.id === this.currentTaskForAccrual.relatedTaskId);
                if (parent?.details?.epatsDocument) epatsDoc = parent.details.epatsDocument;
            }
            this.accrualFormManager.showEpatsDoc(epatsDoc);

            document.getElementById('createMyTaskAccrualModal').classList.add('show');
        }

        async handleSaveAccrual() {
            if (!this.currentTaskForAccrual) return;

            // --- MANAGER DATA ÇEKME ---
            const result = this.accrualFormManager.getData();
            if (!result.success) {
                showNotification(result.error, 'error');
                return;
            }
            const formData = result.data;

            // Dosya yükleme ve Accrual oluşturma mantığı (Main.js ile aynı)
            // Kısaca:
            const newAccrual = {
                taskId: this.currentTaskForAccrual.id,
                taskTitle: this.currentTaskForAccrual.title,
                ...formData, // Manager'dan gelen temiz veri
                status: 'unpaid',
                createdAt: new Date().toISOString()
            };

            // Not: Dosya yükleme (storage) kodları buraya eklenebilir
            // Basitlik adına şimdilik direkt servisi çağırıyorum
            try {
                const res = await accrualService.addAccrual(newAccrual);
                if (res.success) {
                    showNotification('Tahakkuk oluşturuldu.', 'success');
                    this.closeModal('createMyTaskAccrualModal');
                    await this.loadAllData();
                } else {
                    showNotification('Hata: ' + res.error, 'error');
                }
            } catch(e) { showNotification('Hata oluştu.', 'error'); }
        }

        // --- SAYFAYA ÖZEL İŞLEMLER ---
        
        showStatusChangeModal(taskId) {
            this.currentTaskForStatusChange = this.allTasks.find(t => t.id === taskId);
            if(!this.currentTaskForStatusChange) return;
            
            document.getElementById('changeStatusModalTaskTitleDisplay').textContent = 
                this.currentTaskForStatusChange.title;
            document.getElementById('newTriggeredTaskStatus').value = 
                this.currentTaskForStatusChange.status;
            
            document.getElementById('changeTriggeredTaskStatusModal').classList.add('show');
        }

        async handleUpdateStatus() {
            if (!this.currentTaskForStatusChange) return;
            
            // [DEĞİŞİKLİK 1] const yerine let kullanıyoruz ki değiştirebilelim
            let newStatus = document.getElementById('newTriggeredTaskStatus').value;
            
            // [DEĞİŞİKLİK 2] Kritik Müdahale:
            // Eğer kullanıcı "Müvekkil Onayı - Açıldı" seçeneğini seçtiyse,
            // bunu arka planda "open" (Açık) olarak değiştiriyoruz.
            // Böylece backend tarafındaki tahakkuk ve atama otomasyonları tetiklenir.
            if (newStatus === 'client_approval_opened') {
                console.log('🔄 Statü "Müvekkil Onayı - Açıldı" seçildi, otomasyon için "Açık" (open) olarak gönderiliyor.');
                newStatus = 'open';
            }

            try {
                await taskService.updateTask(this.currentTaskForStatusChange.id, {
                    status: newStatus,
                    history: arrayUnion({
                        action: `Durum değiştirildi: ${newStatus} (Müvekkil Onayı ile)`,
                        timestamp: new Date().toISOString(),
                        userEmail: this.currentUser.email
                    })
                });
                showNotification('Durum güncellendi ve işleme alındı.', 'success');
                this.closeModal('changeTriggeredTaskStatusModal');
                await this.loadAllData();
            } catch (e) {
                showNotification('Hata: ' + e.message, 'error');
            }
        }

        // --- EVENT LISTENERS ---
        setupStaticEventListeners() {
            // Arama
            document.getElementById('searchInput')?.addEventListener('input', (e) => this.handleSearch(e.target.value));
            
            // Filtre
            document.getElementById('statusFilter')?.addEventListener('change', (e) => {
                const query = document.getElementById('searchInput').value;
                this.handleSearch(query);
            });

            // Sıralama
            document.querySelectorAll('#tasksTableHeaderRow th[data-sort]').forEach(th => {
                th.addEventListener('click', () => this.handleSort(th.dataset.sort));
            });

            // Tablo Butonları
            document.getElementById('myTasksTableBody').addEventListener('click', (e) => {
                const btn = e.target.closest('.action-btn');
                if (!btn) return;
                const taskId = btn.dataset.id;

                if (btn.classList.contains('view-btn')) this.showTaskDetail(taskId);
                else if (btn.classList.contains('edit-btn')) window.location.href = `task-update.html?id=${taskId}`;
                else if (btn.classList.contains('add-accrual-btn')) this.showAccrualModal(taskId);
                else if (btn.classList.contains('change-status-btn')) this.showStatusChangeModal(taskId);
            });

            // Modallar
            const closeModal = (id) => this.closeModal(id);
            document.getElementById('closeTaskDetailModal').addEventListener('click', () => closeModal('taskDetailModal'));
            
            document.getElementById('closeMyTaskAccrualModal').addEventListener('click', () => closeModal('createMyTaskAccrualModal'));
            document.getElementById('cancelCreateMyTaskAccrualBtn').addEventListener('click', () => closeModal('createMyTaskAccrualModal'));
            document.getElementById('saveNewMyTaskAccrualBtn').addEventListener('click', () => this.handleSaveAccrual());

            document.getElementById('closeChangeTriggeredTaskStatusModal').addEventListener('click', () => closeModal('changeTriggeredTaskStatusModal'));
            document.getElementById('cancelChangeTriggeredTaskStatusBtn').addEventListener('click', () => closeModal('changeTriggeredTaskStatusModal'));
            document.getElementById('saveChangeTriggeredTaskStatusBtn').addEventListener('click', () => this.handleUpdateStatus());

            // Manuel Tetikleme
            document.getElementById('manualRenewalTriggerBtn')?.addEventListener('click', async () => {
                showNotification('Kontrol ediliyor...', 'info');
                try {
                    const callable = httpsCallable(functions, 'checkAndCreateRenewalTasks');
                    const res = await callable({});
                    if(res.data.success) {
                        showNotification(`${res.data.count} görev oluşturuldu.`, 'success');
                        this.loadAllData();
                    } else showNotification(res.data.error, 'error');
                } catch(e) { showNotification(e.message, 'error'); }
            });
        }

        closeModal(modalId) {
            document.getElementById(modalId).classList.remove('show');
            if (modalId === 'createMyTaskAccrualModal') {
                this.accrualFormManager.reset();
            }
        }
    }

    new TriggeredTasksModule().init();
});