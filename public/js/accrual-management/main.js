// public/js/accrual-management/main.js

import { authService, accrualService, taskService, personService, generateUUID, db, ipRecordsService, transactionTypeService } from '../../firebase-config.js';
import { showNotification, readFileAsDataURL } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

import Pagination from '../pagination.js'; 
import { AccrualFormManager } from '../components/AccrualFormManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'accruals.html' });

    class AccrualsManager {
        constructor() {
            this.currentUser = null;
            this.storage = getStorage();
            
            this.allAccruals = [];
            this.processedData = [];
            this.allTasks = {}; 
            this.allPersons = [];
            this.allUsers = [];
            this.allTransactionTypes = []; 
            this.selectedAccruals = new Set();
            
            this.pagination = null;
            this.itemsPerPage = 10;
            this.currentSort = { column: 'createdAt', direction: 'desc' }; 
            this.currentFilterStatus = 'all';

            this.currentEditAccrual = null;
            this.editFormManager = null;
            
            this.uploadedPaymentReceipts = [];
        }

        async init() {
            this.currentUser = authService.getCurrentUser();
            this.initializePagination();
            await this.loadAllData();
            this.setupEventListeners();
        }

        initializePagination() {
            if (typeof Pagination === 'undefined') { console.error("Pagination yüklenemedi."); return; }
            this.pagination = new Pagination({
                containerId: 'paginationControls', 
                itemsPerPage: this.itemsPerPage,
                itemsPerPageOptions: [10, 25, 50, 100],
                onPageChange: () => this.renderTable()
            });
        }

        async loadAllData() {
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Veriler Yükleniyor', 'Lütfen bekleyiniz...') : null;
            const loadingIndicator = document.getElementById('loadingIndicator');
            if(loadingIndicator) loadingIndicator.style.display = 'block';

            try {
                const [accRes, personsRes, usersRes, typesRes] = await Promise.all([
                    accrualService.getAccruals(),
                    personService.getPersons(),
                    taskService.getAllUsers(),
                    transactionTypeService.getTransactionTypes()
                ]);

                this.allAccruals = accRes?.success ? (accRes.data || []) : [];
                this.allPersons = personsRes?.success ? (personsRes.data || []) : [];
                this.allUsers = usersRes?.success ? (usersRes.data || []) : [];
                this.allTransactionTypes = typesRes?.success ? (typesRes.data || []) : [];

                if (this.allAccruals.length > 0) {
                    this.allAccruals.forEach(a => { a.createdAt = a.createdAt ? new Date(a.createdAt) : new Date(0); });
                    const taskIds = new Set();
                    this.allAccruals.forEach(a => { if (a.taskId) taskIds.add(String(a.taskId)); });

                    if (taskIds.size && taskService.getTasksByIds) {
                        const tRes = await taskService.getTasksByIds(Array.from(taskIds));
                        const tasks = tRes?.success ? (tRes.data || []) : [];
                        this.allTasks = {};
                        tasks.forEach(t => { this.allTasks[String(t.id)] = t; });
                    }
                }

                this.initEditForm();
                this.processData();

            } catch (err) {
                console.error(err);
                showNotification('Veri yükleme hatası', 'error');
            } finally {
                if(loadingIndicator) loadingIndicator.style.display = 'none';
                if(loader) loader.hide();
            }
        }

        initEditForm() {
            this.editFormManager = new AccrualFormManager(
                'editAccrualFormContainer', 
                'edit', 
                this.allPersons
            );
            this.editFormManager.render();
        }

        processData() {
            let data = [...this.allAccruals];
            if (this.currentFilterStatus !== 'all') {
                data = data.filter(a => a.status === this.currentFilterStatus);
            }
            this.processedData = this.sortData(data);
            if (this.pagination) this.pagination.update(this.processedData.length);
            this.renderTable();
        }

        sortData(data) {
            const { column, direction } = this.currentSort;
            const dirMultiplier = direction === 'asc' ? 1 : -1;
            return data.sort((a, b) => {
                let valA, valB;
                switch (column) {
                    case 'id': valA = (a.id || '').toLowerCase(); valB = (b.id || '').toLowerCase(); break;
                    case 'status': valA = (a.status || '').toLowerCase(); valB = (b.status || '').toLowerCase(); break;
                    case 'taskTitle':
                        const taskA = this.allTasks[String(a.taskId)];
                        const taskB = this.allTasks[String(b.taskId)];
                        valA = (taskA ? taskA.title : (a.taskTitle || '')).toLowerCase();
                        valB = (taskB ? taskB.title : (b.taskTitle || '')).toLowerCase();
                        break;
                    case 'officialFee': valA = a.officialFee?.amount || 0; valB = b.officialFee?.amount || 0; break;
                    case 'serviceFee': valA = a.serviceFee?.amount || 0; valB = b.serviceFee?.amount || 0; break;
                    case 'totalAmount': valA = a.totalAmount || 0; valB = b.totalAmount || 0; break;
                    case 'remainingAmount': 
                        valA = a.remainingAmount !== undefined ? a.remainingAmount : a.totalAmount;
                        valB = b.remainingAmount !== undefined ? b.remainingAmount : b.totalAmount;
                        break;
                    case 'createdAt': valA = a.createdAt; valB = b.createdAt; break;
                    default: valA = 0; valB = 0;
                }
                if (valA < valB) return -1 * dirMultiplier;
                if (valA > valB) return 1 * dirMultiplier;
                return 0;
            });
        }

        renderTable() {
            const tbody = document.getElementById('accrualsTableBody');
            const noMsg = document.getElementById('noRecordsMessage');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (!this.processedData || this.processedData.length === 0) {
                if(noMsg) noMsg.style.display = 'block';
                if(this.pagination) this.pagination.update(0);
                return;
            }
            if(noMsg) noMsg.style.display = 'none';

            let pageData = this.pagination ? this.pagination.getCurrentPageData(this.processedData) : this.processedData;
            const fmtMoney = (v, c) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: c || 'TRY' }).format(v || 0);

            tbody.innerHTML = pageData.map(acc => {
                let sTxt = 'Bilinmiyor', sCls = '';
                if(acc.status === 'paid') { sTxt = 'Ödendi'; sCls = 'status-paid'; }
                else if(acc.status === 'unpaid') { sTxt = 'Ödenmedi'; sCls = 'status-unpaid'; }
                else if(acc.status === 'partially_paid') { sTxt = 'Kısmen Ödendi'; sCls = 'status-partially-paid'; }

                const isSel = this.selectedAccruals.has(acc.id);
                const isPaid = acc.status === 'paid';
                const rem = acc.remainingAmount !== undefined ? acc.remainingAmount : acc.totalAmount;
                let taskDisplay = acc.taskTitle || acc.taskId;
                if (this.allTasks[String(acc.taskId)]) taskDisplay = this.allTasks[String(acc.taskId)].title;

                return `
                <tr>
                    <td><input type="checkbox" class="row-checkbox" data-id="${acc.id}" ${isSel ? 'checked' : ''}></td>
                    <td><small>${acc.id}</small></td>
                    <td><span class="status-badge ${sCls}">${sTxt}</span></td>
                    <td><a href="#" class="task-detail-link" data-task-id="${acc.taskId}">${taskDisplay}</a></td>
                    <td>${fmtMoney(acc.officialFee?.amount, acc.officialFee?.currency)}</td>
                    <td>${fmtMoney(acc.serviceFee?.amount, acc.serviceFee?.currency)}</td>
                    <td>${fmtMoney(acc.totalAmount, acc.totalAmountCurrency)}</td>
                    <td>${fmtMoney(rem, acc.totalAmountCurrency)}</td>
                    <td>
                        <div style="display: flex; gap: 5px;">
                            <button class="action-btn view-btn" data-id="${acc.id}">Görüntüle</button>
                            <button class="action-btn edit-btn" data-id="${acc.id}" ${isPaid ? 'disabled' : ''}>Düzenle</button>
                            <button class="action-btn delete-btn" data-id="${acc.id}">Sil</button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
            
            this.updateBulkActionsVisibility();
            this.updateSortIcons();
        }

        updateSortIcons() {
            document.querySelectorAll('th[data-sort] i').forEach(icon => {
                icon.className = 'fas fa-sort sort-icon text-muted';
            });
            const activeHeader = document.querySelector(`th[data-sort="${this.currentSort.column}"]`);
            if (activeHeader) {
                const icon = activeHeader.querySelector('i');
                if (icon) icon.className = `fas fa-sort-${this.currentSort.direction === 'asc' ? 'up' : 'down'} sort-icon`;
            }
        }

        // --- GÜNCELLENEN EDIT MODAL (Async Task Fetch Eklendi) ---
        async showEditAccrualModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            this.currentEditAccrual = { ...accrual };
            document.getElementById('editAccrualId').value = accrual.id;
            document.getElementById('editAccrualTaskTitleDisplay').value = accrual.taskTitle || '';
            
            if(this.editFormManager) {
                this.editFormManager.reset();
                this.editFormManager.setData(accrual);

                // --- EPATS Belgesi Bulma Mantığı (DÜZELTİLDİ) ---
                let epatsDoc = null;
                const taskId = accrual.taskId;

                // 1. Önbelleği kontrol et
                let task = this.allTasks[String(taskId)];
                
                // 2. Önbellekte yoksa veya detay eksikse veritabanından çek
                if (!task || (!task.details && !task.relatedTaskId)) {
                    try {
                        const taskSnap = await getDoc(doc(db, 'tasks', String(taskId)));
                        if (taskSnap.exists()) {
                            task = { id: taskSnap.id, ...taskSnap.data() };
                            // Cache'i güncelle
                            this.allTasks[String(taskId)] = task;
                        }
                    } catch(e) { console.warn('Task fetch error:', e); }
                }

                // 3. Task verisinden belgeyi çıkar
                if (task) {
                    if (task.details && task.details.epatsDocument) {
                        epatsDoc = task.details.epatsDocument;
                    } else if (task.relatedTaskId) {
                         const parent = this.allTasks[String(task.relatedTaskId)];
                         if (parent && parent.details) epatsDoc = parent.details.epatsDocument;
                    }
                }
                
                // 4. Belgeyi forma gönder
                this.editFormManager.showEpatsDoc(epatsDoc);
            }

            document.getElementById('editAccrualModal').classList.add('show');
        }

        async handleSaveAccrualChanges() {
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Kaydediliyor...') : null;

            try {
                const result = this.editFormManager.getData();
                if (!result.success) {
                    if(loader) loader.hide();
                    showNotification(result.error, 'error');
                    return;
                }
                const formData = result.data;
                const accrualId = document.getElementById('editAccrualId').value;

                let newFiles = [];
                if (formData.files && formData.files.length > 0) {
                    try {
                        const file = formData.files[0];
                        const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                        const snapshot = await uploadBytes(storageRef, file);
                        const url = await getDownloadURL(snapshot.ref);
                        newFiles.push({ name: file.name, url, type: 'foreign_invoice', documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() });
                    } catch(err) { 
                        if(loader) loader.hide(); showNotification("Dosya yüklenemedi.", "error"); return; 
                    }
                }

                const existingFiles = this.currentEditAccrual.files || [];
                const finalFiles = [...existingFiles, ...newFiles];

                const updates = {
                    officialFee: formData.officialFee,
                    serviceFee: formData.serviceFee,
                    vatRate: formData.vatRate,
                    applyVatToOfficialFee: formData.applyVatToOfficialFee,
                    totalAmount: formData.totalAmount,
                    totalAmountCurrency: 'TRY',
                    remainingAmount: this.currentEditAccrual.remainingAmount !== undefined ? this.currentEditAccrual.remainingAmount : formData.totalAmount,
                    tpInvoiceParty: formData.tpInvoiceParty,
                    serviceInvoiceParty: formData.serviceInvoiceParty,
                    isForeignTransaction: formData.isForeignTransaction,
                    files: finalFiles
                };

                await accrualService.updateAccrual(accrualId, updates);
                this.closeModal('editAccrualModal');
                await this.loadAllData();
                showNotification('Kaydedildi', 'success');

            } catch(e) {
                console.error(e);
                showNotification('Hata', 'error');
            } finally {
                if(loader) loader.hide();
            }
        }

        closeModal(id) {
            document.getElementById(id).classList.remove('show');
            if(id === 'editAccrualModal') {
                this.currentEditAccrual = null;
                if(this.editFormManager) this.editFormManager.reset();
            }
            if(id === 'markPaidModal') {
                this.uploadedPaymentReceipts = [];
                document.getElementById('paymentReceiptFileList').innerHTML = '';
            }
        }

        async showViewAccrualDetailModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            const modal = document.getElementById('viewAccrualDetailModal');
            const title = document.getElementById('viewAccrualTitle');
            const body = modal.querySelector('.modal-body-content');

            title.textContent = `Tahakkuk Detayı (#${accrual.id})`;
            
            const fmtMoney = (v, c) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: c || 'TRY' }).format(v || 0);
            const fmtDate = (d) => { try { return d ? new Date(d).toLocaleDateString('tr-TR') : '-'; } catch{return '-'} };
            
            let statusText = 'Bilinmiyor', statusColor = '#6c757d';
            if(accrual.status === 'paid') { statusText = 'Ödendi'; statusColor = '#28a745'; }
            else if(accrual.status === 'unpaid') { statusText = 'Ödenmedi'; statusColor = '#dc3545'; }
            else if(accrual.status === 'partially_paid') { statusText = 'Kısmen Ödendi'; statusColor = '#ffc107'; }

            let docsHtml = '';
            if(accrual.files && accrual.files.length > 0) {
                accrual.files.forEach(f => {
                    const url = f.content || f.url;
                    docsHtml += `
                    <div class="col-md-6 mb-2">
                        <div class="view-box d-flex justify-content-between align-items-center">
                            <div class="text-truncate">
                                <i class="fas fa-file-alt text-secondary mr-2"></i> ${f.name}
                            </div>
                            <a href="${url}" target="_blank" class="btn btn-sm btn-light border"><i class="fas fa-download"></i></a>
                        </div>
                    </div>`;
                });
            } else {
                docsHtml = '<div class="col-12 text-muted small">Belge yok.</div>';
            }

            body.innerHTML = `
                <div class="form-group">
                    <label class="view-label">İlgili İş</label>
                    <div class="view-box bg-light text-dark font-weight-bold">${accrual.taskTitle || '-'}</div>
                </div>
                <div class="form-grid">
                    <div class="form-group">
                        <label class="view-label">Durum</label>
                        <div class="view-box" style="color:${statusColor}; font-weight:bold;">${statusText}</div>
                    </div>
                    <div class="form-group">
                        <label class="view-label">Tarih</label>
                        <div class="view-box">${fmtDate(accrual.createdAt)}</div>
                    </div>
                </div>
                <div class="section-header"><i class="fas fa-coins mr-2"></i>FİNANSAL</div>
                <div class="form-grid">
                    <div class="form-group"><label class="view-label">Resmi</label><div class="view-box">${fmtMoney(accrual.officialFee?.amount, accrual.officialFee?.currency)}</div></div>
                    <div class="form-group"><label class="view-label">Hizmet</label><div class="view-box">${fmtMoney(accrual.serviceFee?.amount, accrual.serviceFee?.currency)}</div></div>
                    <div class="form-group"><label class="view-label">Toplam</label><div class="view-box font-weight-bold text-primary">${fmtMoney(accrual.totalAmount, accrual.totalAmountCurrency)}</div></div>
                    <div class="form-group"><label class="view-label">Kalan</label><div class="view-box">${fmtMoney(accrual.remainingAmount, accrual.totalAmountCurrency)}</div></div>
                </div>
                <div class="section-header"><i class="fas fa-file-invoice mr-2"></i>TARAFLAR</div>
                <div class="form-grid">
                    <div class="form-group"><label class="view-label">Fatura (TP)</label><div class="view-box">${accrual.tpInvoiceParty?.name || '-'}</div></div>
                    <div class="form-group"><label class="view-label">Hizmet/Yurtdışı</label><div class="view-box">${accrual.serviceInvoiceParty?.name || '-'}</div></div>
                </div>
                <div class="section-header"><i class="fas fa-folder-open mr-2"></i>BELGELER</div>
                <div class="row">${docsHtml}</div>
            `;
            modal.classList.add('show');
        }

        async showTaskDetailModal(taskId) {
            const modal = document.getElementById('taskDetailModal');
            const body = document.getElementById('modalBody');
            const title = document.getElementById('modalTaskTitle');
            
            modal.classList.add('show');
            title.textContent = 'İş Detayı Yükleniyor...';
            body.innerHTML = '<div class="text-center p-4"><i class="fas fa-circle-notch fa-spin fa-2x text-primary"></i><br>Veriler getiriliyor...</div>';

            try {
                const taskRef = doc(db, 'tasks', String(taskId));
                const taskSnap = await getDoc(taskRef);

                if (!taskSnap.exists()) {
                    body.innerHTML = '<div class="alert alert-danger">Bu iş kaydı bulunamadı.</div>';
                    title.textContent = 'Hata';
                    return;
                }
                const task = { id: taskSnap.id, ...taskSnap.data() };
                title.textContent = `İş Detayı (${task.id})`;

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

                const formatDate = (d) => d ? new Date(d).toLocaleDateString('tr-TR') : '-';
                const assignedUser = this.allUsers.find(u => u.id === task.assignedTo_uid);
                const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : 'Atanmamış';
                const relatedRecordTxt = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'Bulunamadı';
                const taskTypeDisplay = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : task.taskType;

                let html = `
                    <div class="container-fluid p-0">
                        <div class="section-header mt-0"><i class="fas fa-info-circle mr-2"></i> GENEL BİLGİLER</div>
                        <div class="mb-3"><label class="view-label">İş Konusu</label><div class="view-box font-weight-bold">${task.title || '-'}</div></div>
                        <div class="form-grid">
                            <div class="form-group"><label class="view-label">İlgili Dosya</label><div class="view-box">${relatedRecordTxt}</div></div>
                            <div class="form-group"><label class="view-label">İş Tipi</label><div class="view-box">${taskTypeDisplay}</div></div>
                            <div class="form-group"><label class="view-label">Atanan Kişi</label><div class="view-box">${assignedName}</div></div>
                            <div class="form-group"><label class="view-label">Durum</label><div class="view-box font-weight-bold text-primary">${task.status}</div></div>
                        </div>
                        <div class="section-header"><i class="far fa-calendar-alt mr-2"></i> TARİHLER</div>
                        <div class="form-grid">
                            <div class="form-group"><label class="view-label">Operasyonel</label><div class="view-box">${formatDate(task.dueDate)}</div></div>
                            <div class="form-group"><label class="view-label">Resmi</label><div class="view-box text-danger">${formatDate(task.officialDueDate)}</div></div>
                        </div>
                        <div class="section-header"><i class="fas fa-align-left mr-2"></i> AÇIKLAMA</div>
                        <div class="view-box" style="min-height: 60px;">${task.description || '-'}</div>
                    </div>`;

                body.innerHTML = html;

            } catch (error) {
                console.error(error);
                body.innerHTML = '<div class="alert alert-danger">Hata: ' + error.message + '</div>';
            }
        }

// --- Modal Gösterim (Currency Etiketlerini Ayarla) ---
        showMarkPaidModal() {
            if (this.selectedAccruals.size === 0) { showNotification('Seçim yapınız', 'error'); return; }
            
            const modal = document.getElementById('markPaidModal');
            document.getElementById('paidAccrualCount').textContent = this.selectedAccruals.size;
            document.getElementById('paymentDate').valueAsDate = new Date();

            const detailedArea = document.getElementById('detailedPaymentInputs');
            
            // TEKİL SEÇİM MANTIĞI
            if (this.selectedAccruals.size === 1) {
                detailedArea.style.display = 'block';
                const accrualId = this.selectedAccruals.values().next().value;
                const accrual = this.allAccruals.find(a => a.id === accrualId);
                
                // 1. Resmi Ücret Ayarları
                const offAmount = accrual.officialFee?.amount || 0;
                const offCurr = accrual.officialFee?.currency || 'TRY';
                // KDV Varsa Gösterimde Belirt
                const offVatText = accrual.applyVatToOfficialFee ? ' (+KDV)' : '';
                
                document.getElementById('officialFeeBadge').textContent = `${offAmount} ${offCurr}${offVatText}`;
                document.getElementById('manualOfficialCurrencyLabel').textContent = offCurr; // Input Yanındaki Label
                
                document.getElementById('payFullOfficial').checked = true;
                document.getElementById('officialAmountInputContainer').style.display = 'none';
                document.getElementById('manualOfficialAmount').value = '';

                // 2. Hizmet Bedeli Ayarları
                const srvAmount = accrual.serviceFee?.amount || 0;
                const srvCurr = accrual.serviceFee?.currency || 'TRY';
                
                document.getElementById('serviceFeeBadge').textContent = `${srvAmount} ${srvCurr} (+KDV)`;
                document.getElementById('manualServiceCurrencyLabel').textContent = srvCurr; // Input Yanındaki Label

                document.getElementById('payFullService').checked = true;
                document.getElementById('serviceAmountInputContainer').style.display = 'none';
                document.getElementById('manualServiceAmount').value = '';

                // Checkbox Eventleri
                document.getElementById('payFullOfficial').onchange = (e) => {
                    document.getElementById('officialAmountInputContainer').style.display = e.target.checked ? 'none' : 'block';
                };
                document.getElementById('payFullService').onchange = (e) => {
                    document.getElementById('serviceAmountInputContainer').style.display = e.target.checked ? 'none' : 'block';
                };

            } else {
                // ÇOKLU SEÇİM: Detayları gizle
                detailedArea.style.display = 'none';
            }

            modal.classList.add('show');
        }

        // --- Ödeme Kaydetme (Görsel Düzeltme ile Uyumlu) ---
        async handlePaymentSubmission() {
            if (this.selectedAccruals.size === 0) return;
            
            const paymentDate = document.getElementById('paymentDate').value;
            if(!paymentDate) { showNotification('Lütfen tarih seçiniz', 'error'); return; }

            let loader = window.showSimpleLoading ? window.showSimpleLoading('İşleniyor...') : null;

            try {
                const promises = Array.from(this.selectedAccruals).map(async (id) => {
                    const accrual = this.allAccruals.find(a => a.id === id);
                    if (!accrual) return;

                    let updates = {
                        paymentDate: paymentDate,
                        files: [...(accrual.files || []), ...this.uploadedPaymentReceipts]
                    };

                    if (this.selectedAccruals.size === 1) {
                        const payFullOff = document.getElementById('payFullOfficial').checked;
                        const payFullSrv = document.getElementById('payFullService').checked;
                        
                        // KDV Oranı
                        const vatRate = accrual.vatRate || 0;
                        const vatMultiplier = 1 + (vatRate / 100);

                        // 1. Resmi Ücret Hesapla
                        let paidOff = 0;
                        const rawOfficial = accrual.officialFee?.amount || 0;
                        const officialWithVat = accrual.applyVatToOfficialFee ? rawOfficial * vatMultiplier : rawOfficial;

                        if (payFullOff) {
                            paidOff = officialWithVat; // Tamamını öde (KDV dahil gerekiyorsa dahil halini al)
                        } else {
                            paidOff = parseFloat(document.getElementById('manualOfficialAmount').value) || 0;
                        }

                        // 2. Hizmet Bedeli Hesapla
                        let paidSrv = 0;
                        const rawService = accrual.serviceFee?.amount || 0;
                        const serviceWithVat = rawService * vatMultiplier;

                        if (payFullSrv) {
                            paidSrv = serviceWithVat;
                        } else {
                            paidSrv = parseFloat(document.getElementById('manualServiceAmount').value) || 0;
                        }

                        // Veritabanına Yazılacak Değerler (Mevcut ödenmişin üzerine ekle)
                        updates.paidOfficialAmount = (accrual.paidOfficialAmount || 0) + paidOff;
                        updates.paidServiceAmount = (accrual.paidServiceAmount || 0) + paidSrv;

                        // Durum Kontrolü
                        const totalPaidOff = updates.paidOfficialAmount;
                        const totalPaidSrv = updates.paidServiceAmount;
                        
                        // Kalan Hesapla (Toleranslı)
                        const remOff = Math.max(0, officialWithVat - totalPaidOff);
                        const remSrv = Math.max(0, serviceWithVat - totalPaidSrv);

                        if (remOff < 0.1 && remSrv < 0.1) {
                            updates.status = 'paid';
                            updates.remainingAmount = 0;
                        } else {
                            updates.status = 'partially_paid';
                            // Burada remainingAmount alanı "sıralama" için kullanıldığından
                            // Farklı currency olsa bile matematiksel toplam yazıyoruz.
                            // Ancak GÖSTERİM UI tarafında ayrıştırılıyor.
                            updates.remainingAmount = remOff + remSrv;
                        }

                    } else {
                        // Çoklu seçimde her şeyi ödendi yap
                        updates.status = 'paid';
                        updates.remainingAmount = 0;
                    }

                    return accrualService.updateAccrual(id, updates);
                });

                await Promise.all(promises);
                showNotification('İşlem Başarılı', 'success');
                this.closeModal('markPaidModal');
                this.selectedAccruals.clear();
                this.updateBulkActionsVisibility();
                await this.loadAllData();

            } catch(e) {
                console.error(e);
                showNotification('Hata: ' + e.message, 'error');
            } finally {
                if(loader) loader.hide();
            }
        }

        handlePaymentReceiptUpload(files) {
            Array.from(files).forEach(file => {
                readFileAsDataURL(file).then(url => {
                    this.uploadedPaymentReceipts.push({
                        id: generateUUID(), name: file.name, size: file.size, type: file.type, content: url, documentDesignation: 'Ödeme Dekontu'
                    });
                    this.renderPaymentReceiptFileList();
                });
            });
        }
        renderPaymentReceiptFileList() {
            const list = document.getElementById('paymentReceiptFileList');
            list.innerHTML = this.uploadedPaymentReceipts.map(f => `<div class="file-item-modal"><span>${f.name}</span><button class="remove-file-modal" onclick="this.parentElement.remove()">x</button></div>`).join('');
        }

        async handleBulkUpdate(newStatus) {
            // Eğer yanlışlıkla 'paid' gönderilirse işlem yapma (o artık diğer fonksiyonda)
            if (newStatus === 'paid') return; 
            
            if (this.selectedAccruals.size === 0) return;

            let loader = window.showSimpleLoading ? window.showSimpleLoading('Güncelleniyor...') : null;
            try {
                const promises = Array.from(this.selectedAccruals).map(async (id) => {
                    const acc = this.allAccruals.find(a => a.id === id);
                    if (!acc) return;

                    // Ödenmedi durumuna çekiliyorsa tüm ödeme verilerini sıfırla
                    const updates = { 
                        status: newStatus,
                        paymentDate: null,
                        remainingAmount: acc.totalAmount, // Kalan tutarı tekrar toplama eşitle
                        paidOfficialAmount: 0,            // Ödenen resmi ücreti sıfırla
                        paidServiceAmount: 0              // Ödenen hizmet bedelini sıfırla
                    };
                    
                    return accrualService.updateAccrual(id, updates);
                });

                await Promise.all(promises);
                showNotification('Güncellendi', 'success');
                
                // Seçimleri temizle
                this.selectedAccruals.clear();
                this.updateBulkActionsVisibility();
                
                // Tabloyu yenile
                await this.loadAllData();
            } catch(e) { 
                console.error(e);
                showNotification('Hata oluştu', 'error'); 
            } 
            finally { if(loader) loader.hide(); }
        }

        async deleteAccrual(id) {
            if(confirm('Silmek istiyor musunuz?')) {
                let loader = window.showSimpleLoading ? window.showSimpleLoading('Siliniyor...') : null;
                try {
                    await accrualService.deleteAccrual(id);
                    await this.loadAllData();
                } catch(e) { showNotification('Hata', 'error'); }
                finally { if(loader) loader.hide(); }
            }
        }

        toggleSelectAll(checked) {
            document.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = checked; this.updateSelection(cb.dataset.id, checked); });
        }
        updateSelection(id, selected) {
            if(selected) this.selectedAccruals.add(id); else this.selectedAccruals.delete(id);
            this.updateBulkActionsVisibility();
        }
        updateBulkActionsVisibility() {
            document.getElementById('bulkActions').style.display = this.selectedAccruals.size > 0 ? 'flex' : 'none';
        }

        setupEventListeners() {
            document.getElementById('statusFilter').addEventListener('change', e => {
                this.currentFilterStatus = e.target.value;
                this.processData();
            });

            document.querySelectorAll('th[data-sort]').forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    const column = th.dataset.sort;
                    if (this.currentSort.column === column) {
                        this.currentSort.direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        this.currentSort = { column: column, direction: 'asc' };
                    }
                    this.processData();
                });
            });

            document.getElementById('selectAllCheckbox').addEventListener('change', e => this.toggleSelectAll(e.target.checked));
            const tbody = document.getElementById('accrualsTableBody');
            
            tbody.addEventListener('change', e => {
                if(e.target.classList.contains('row-checkbox')) this.updateSelection(e.target.dataset.id, e.target.checked);
            });

            tbody.addEventListener('click', e => {
                const btn = e.target.closest('.action-btn');
                if (btn) {
                    e.preventDefault();
                    const dataId = btn.dataset.id;
                    if(btn.classList.contains('view-btn')) this.showViewAccrualDetailModal(dataId);
                    if(btn.classList.contains('edit-btn')) this.showEditAccrualModal(dataId);
                    if(btn.classList.contains('delete-btn')) this.deleteAccrual(dataId);
                } else if(e.target.classList.contains('task-detail-link')) {
                    e.preventDefault();
                    this.showTaskDetailModal(e.target.dataset.taskId);
                }
            });

            document.getElementById('bulkMarkPaidBtn').addEventListener('click', () => this.showMarkPaidModal());
            document.getElementById('bulkMarkUnpaidBtn').addEventListener('click', () => this.handleBulkUpdate('unpaid'));
            
            document.querySelectorAll('.close-modal-btn, #cancelEditAccrualBtn, #cancelMarkPaidBtn').forEach(b => {
                b.addEventListener('click', e => {
                    const m = e.target.closest('.modal');
                    this.closeModal(m.id);
                });
            });

            // YENİ: Kaydet Butonu
            document.getElementById('saveAccrualChangesBtn').addEventListener('click', () => this.handleSaveAccrualChanges());
            const confirmBtn = document.getElementById('confirmMarkPaidBtn');
            if(confirmBtn) {
                confirmBtn.replaceWith(confirmBtn.cloneNode(true)); // Varsa eski eventleri temizlemek için clone (opsiyonel)
                document.getElementById('confirmMarkPaidBtn').addEventListener('click', () => this.handlePaymentSubmission());
            }
            
            const area = document.getElementById('paymentReceiptFileUploadArea');
            area.addEventListener('click', () => document.getElementById('paymentReceiptFile').click());
            document.getElementById('paymentReceiptFile').addEventListener('change', e => this.handlePaymentReceiptUpload(e.target.files));
        }
    }

    new AccrualsManager().init();
});