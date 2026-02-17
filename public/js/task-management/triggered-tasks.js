// public/js/indexing/triggered-tasks.js

import { authService, taskService, ipRecordsService, accrualService, personService, transactionTypeService, functions } from '../../firebase-config.js';
import { showNotification,TASK_STATUS_MAP, formatToTRDate } from '../../utils.js';
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

			// Hızlı join için Map (id -> ipRecord)
			this.ipRecordsMap = new Map();

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
            this.statusDisplayMap = TASK_STATUS_MAP;
            // Tetiklenen görevler sayfasında sadece müvekkil onayı bekleyen işler görünecek.
            this.triggeredTaskStatuses = ['awaiting_client_approval'];
            // Progressive yükleme için cache
            this.ipRecordsCache = new Map();   // id -> ipRecord
            this.personsCache = new Map();     // id -> person

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
                    onPageChange: async () => {
                    this.renderTable();
                    await this.enrichVisiblePage();   // yeni fonksiyon
                    }
                });
            }
        }

        async loadAllData() {
            const loader = document.getElementById('loadingIndicator');
            if (loader) loader.style.display = 'block';

            try {
                // 1) yetki
                const token = await this.currentUser.getIdTokenResult();
                const isSuper = !!(token.claims && token.claims.superAdmin);

                const targetStatus = 'awaiting_client_approval';

                // 2) Tasks + işlem tipleri (paralel)
                const [tasksResult, transTypesResult] = await Promise.all([
                taskService.getTasksByStatus(targetStatus, isSuper ? null : this.currentUser.uid),
                transactionTypeService.getTransactionTypes()
                ]);

                this.allTasks = tasksResult.success ? tasksResult.data : [];
                this.allTransactionTypes = transTypesResult.success ? transTypesResult.data : [];

                // 3) İlk çizim: ipRecords/persons BEKLEMEDEN tabloyu bas
                //    (placeholders gözükecek, sonra zenginleşecek)
                this.allIpRecords = [];
                this.allPersons = [];
                this.ipRecordsMap = new Map();
                this.personsMap = new Map();

                this.processData(); // tabloyu hemen çiz (veriler eksikse "Yükleniyor..." vs görünebilir)

                // 4) Loader'ı ilk ekran için kapat (asıl hız hissi burada)
                if (loader) loader.style.display = 'none';

                // Görev yoksa işimiz bitti
                if (!this.allTasks.length) return;

                // 5) Arka planda: sadece görünen sayfayı zenginleştir
                //    (UI'yı bloklamasın)
                setTimeout(() => {
                this.enrichVisiblePage().catch(console.error);
                }, 0);

            } catch (error) {
                console.error("Yükleme Hatası:", error);
            } finally {
                // loader'ı yukarıda kapattık; burada tekrar kapatmak sorun değil
                if (loader) loader.style.display = 'none';
            }
            }


		buildMaps() {
			this.ipRecordsMap.clear();
			(this.allIpRecords || []).forEach(r => {
				const key = r?.id ? String(r.id).trim() : null;
				if (key) this.ipRecordsMap.set(key, r);
			});
		}

        async enrichVisiblePage() {
        // Filtrelenmiş veri yoksa çık
        if (!this.filteredData || this.filteredData.length === 0) return;

        // O an görünen sayfanın görevlerini al
        let currentData = this.filteredData;
        if (this.pagination) {
            currentData = this.pagination.getCurrentPageData(this.filteredData);
        }

        // 1) Görünen görevlerden ipRecord id’leri topla (cache’te olmayanlar)
        const ipIdsToFetch = [];
        for (const t of currentData) {
            const id = t?.relatedIpRecordId ? String(t.relatedIpRecordId).trim() : null;
            if (id && !this.ipRecordsCache.has(id)) ipIdsToFetch.push(id);
        }

        // ipRecords çek
        if (ipIdsToFetch.length) {
            const ipRes = await ipRecordsService.getRecordsByIds(ipIdsToFetch);
            const records = ipRes.success ? ipRes.data : [];
            records.forEach(r => {
            const key = r?.id ? String(r.id).trim() : null;
            if (key) this.ipRecordsCache.set(key, r);
            });
        }

        // 2) Görünen görevlerden + ipRecord applicant’larından person id’leri topla (cache’te olmayanlar)
        const personIds = new Set();

        for (const t of currentData) {
            if (Array.isArray(t.taskOwner)) {
            t.taskOwner.forEach(id => personIds.add(String(id)));
            }
            const rid = t?.relatedIpRecordId ? String(t.relatedIpRecordId).trim() : null;
            const ip = rid ? this.ipRecordsCache.get(rid) : null;
            if (ip && Array.isArray(ip.applicants)) {
            ip.applicants.forEach(a => {
                const pId = (typeof a === 'string') ? a : (a.id || a.personId);
                if (pId) personIds.add(String(pId));
            });
            }
        }

        const toFetchPersons = Array.from(personIds).filter(id => !this.personsCache.has(String(id)));
        if (toFetchPersons.length) {
            const pRes = await personService.getPersonsByIds(toFetchPersons);
            const persons = pRes.success ? pRes.data : [];
            persons.forEach(p => {
            const key = p?.id ? String(p.id) : null;
            if (key) this.personsCache.set(key, p);
            });
        }

        // 3) Cache’ten allIpRecords/allPersons’ı güncelle ve tabloyu aynı filtreyle tekrar bas
        this.allIpRecords = Array.from(this.ipRecordsCache.values());
        this.allPersons = Array.from(this.personsCache.values());
        this.buildMaps();

        // Mevcut arama/filtreyi koruyarak yeniden işle
        const query = document.getElementById('searchInput')?.value || '';
        this.processData();
        // processData handleSearch çağırdığı için tablo yenilenir; kullanıcı aynı sayfadaysa pagination zaten korur
        }


    processData() {
        // 1. ADIM: Hızlı erişim için Yardımcı Map'leri (Sözlükleri) oluşturun
        // Bu sayede .find() kullanmak yerine doğrudan "nokta atışı" veri çekeceğiz.
        const transTypeMap = new Map();
        this.allTransactionTypes.forEach(t => transTypeMap.set(String(t.id), t));

        // allPersons listesini Map'e çevirelim (Eğer loadAllData içinde yapmadıysanız burada yapın)
        const personsMap = new Map();
        this.allPersons.forEach(p => personsMap.set(String(p.id), p));

        const relevantTasks = this.allTasks.filter(task => this.triggeredTaskStatuses.includes(task.status));

        this.processedData = relevantTasks.map(task => {
            const relatedId = task?.relatedIpRecordId ? String(task.relatedIpRecordId).trim() : '';
            const ipRecord = relatedId ? this.ipRecordsMap.get(relatedId) : null;
            
            // .find() yerine .get() kullanarak hızı O(n)'den O(1)'e düşürdük
            const transactionTypeObj = transTypeMap.get(String(task.taskType));
            
            const taskTypeDisplayName = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || 'Bilinmiyor');
            const applicationNumber = ipRecord?.applicationNumber || ipRecord?.applicationNo || (relatedId ? 'Yükleniyor…' : '—');
            const relatedRecordTitle = task.relatedIpRecordTitle || ipRecord?.title || '—';

            // --- [BAŞLANGIÇ] SAHİP BİLGİSİ GÜNCELLEMESİ (OPTIMIZED) ---
            let resolvedOwnerName = null;

            // 1. ADIM: Task Owner Kontrolü (.find yerine Map.get)
            if (Array.isArray(task.taskOwner) && task.taskOwner.length > 0) {
                const ownerId = String(task.taskOwner[0]);
                const person = personsMap.get(ownerId);
                if (person) {
                    resolvedOwnerName = person.name;
                }
            }

            // 2. ADIM: Fallback - IP Record Applicants (.find yerine Map.get)
            if (!resolvedOwnerName) {
                if (ipRecord && Array.isArray(ipRecord.applicants) && ipRecord.applicants.length > 0) {
                    resolvedOwnerName = ipRecord.applicants.map(a => {
                        if (a.name) return a.name;
                        
                        const pId = String((typeof a === 'string') ? a : a.id);
                        const p = personsMap.get(pId);
                        return p ? p.name : '';
                    }).filter(Boolean).join(', ');
                }
            }

            const applicantName = resolvedOwnerName || 'N/A';
            // --- [BİTİŞ] SAHİP BİLGİSİ GÜNCELLEMESİ ---

            // Tarih ve Statü işlemleri (Aynen kalıyor ama Map kullanımı sayesinde buraya çok hızlı ulaşıyoruz)
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
                applicantName,
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
                
                // Tarih formatlama (Merkezi utils fonksiyonu ile)
                const opDate = formatToTRDate(task.operationalDueObj);
                const offDate = formatToTRDate(task.officialDueObj);

                // ISO değerleri DeadlineHighlighter (renklendirme) için gereklidir, bu yüzden bunları koruyoruz
                const opISO = task.operationalDueObj ? task.operationalDueObj.toISOString().slice(0,10) : '';
                const offISO = task.officialDueObj ? task.officialDueObj.toISOString().slice(0,10) : '';

                // --- İŞLEMLER MENÜSÜ HTML YAPISI ---
                // Tahakkuk sayfasındaki yapının aynısı uyarlandı.
                // Butonlara gerekli sınıflar (view-btn, edit-btn vb.) eklendiği için
                // mevcut listener'lar otomatik olarak çalışacaktır.
                
                const actionMenuHtml = `
                    <div class="dropdown">
                        <button class="btn btn-sm btn-light text-secondary rounded-circle" type="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-ellipsis-v" style="pointer-events: none;"></i>
                        </button>
                        
                        <div class="dropdown-menu dropdown-menu-right shadow-sm border-0 p-2" style="min-width: auto;">
                            <div class="d-flex justify-content-center align-items-center" style="gap: 5px;">
                                
                                <button class="btn btn-sm btn-light text-primary view-btn action-btn" data-id="${task.id}" title="Detay Görüntüle">
                                    <i class="fas fa-eye" style="pointer-events: none;"></i>
                                </button>

                                <button class="btn btn-sm btn-light text-warning edit-btn action-btn" data-id="${task.id}" title="Düzenle">
                                    <i class="fas fa-edit" style="pointer-events: none;"></i>
                                </button>

                                <button class="btn btn-sm btn-light text-success add-accrual-btn action-btn" data-id="${task.id}" title="Ek Tahakkuk Ekle">
                                    <i class="fas fa-file-invoice-dollar" style="pointer-events: none;"></i>
                                </button>

                                <button class="btn btn-sm btn-light text-info change-status-btn action-btn" data-id="${task.id}" title="Durum Değiştir">
                                    <i class="fas fa-exchange-alt" style="pointer-events: none;"></i>
                                </button>

                            </div>
                        </div>
                    </div>
                `;

                row.innerHTML = `
                    <td>${task.id}</td>
                    <td>${task.applicationNumber}</td>
                    <td>${task.relatedRecordTitle}</td>
                    <td>${task.applicantName}</td>
                    <td>${task.taskTypeDisplayName}</td>
                    <td data-field="operationalDue" data-date="${opISO}">${opDate}</td>
                    <td data-field="officialDue" data-date="${offISO}">${offDate}</td>
                    <td><span class="status-badge ${statusClass}">${task.statusText}</span></td>
                    <td class="text-center" style="overflow:visible;">
                        ${actionMenuHtml}
                    </td>
                `;
                tbody.appendChild(row);
            });

            if (window.DeadlineHighlighter) {
                setTimeout(() => window.DeadlineHighlighter.refresh('triggeredTasks'), 50);
            }
            
            // Dropdown'ların tablodan taşmasını engellemek için gerekli Bootstrap tetiklemesi (Opsiyonel ama önerilir)
            $('.dropdown-toggle').dropdown();
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

			// İlişkili verileri bul (ID normalize)
			const relatedId = task?.relatedIpRecordId ? String(task.relatedIpRecordId).trim() : '';
			const ipRecord = relatedId ? this.ipRecordsMap.get(relatedId) : null;
			const transactionType = this.allTransactionTypes.find(t => String(t.id) === String(task.taskType));
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