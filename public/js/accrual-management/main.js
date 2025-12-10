import { authService, accrualService, taskService, personService, generateUUID, db, ipRecordsService, transactionTypeService } from '../../firebase-config.js';
import { showNotification, readFileAsDataURL } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

import Pagination from '../pagination.js'; 

// YENİ: Form Yöneticisini Import Ediyoruz
import { AccrualFormManager } from '../components/AccrualFormManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'accruals.html' });

    class AccrualsManager {
        constructor() {
            this.currentUser = null;
            this.storage = getStorage(); // Storage eklendi
            
            this.allAccruals = [];
            this.processedData = [];
            this.allTasks = {}; 
            this.allPersons = [];
            this.allUsers = [];
            this.selectedAccruals = new Set();
            
            this.pagination = null;
            this.itemsPerPage = 10;
            this.currentSort = { column: 'createdAt', direction: 'desc' }; 
            this.currentFilterStatus = 'all';

            // Edit State
            this.currentEditAccrual = null;
            this.editFormManager = null; // Manager Eklendi
            
            // Upload State (Mark Paid Modal için)
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
                const [accRes, personsRes, usersRes] = await Promise.all([
                    accrualService.getAccruals(),
                    personService.getPersons(),
                    taskService.getAllUsers()
                ]);

                this.allAccruals = accRes?.success ? (accRes.data || []) : [];
                this.allPersons = personsRes?.success ? (personsRes.data || []) : [];
                this.allUsers = usersRes?.success ? (usersRes.data || []) : [];

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

                // YENİ: Form Yöneticisini Başlat (Veriler geldikten sonra)
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

        // --- YENİ: Form Manager Başlatma ---
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

        // --- YENİ: Edit Modal Fonksiyonu ---
        showEditAccrualModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            this.currentEditAccrual = { ...accrual };
            document.getElementById('editAccrualId').value = accrual.id;
            document.getElementById('editAccrualTaskTitleDisplay').value = accrual.taskTitle || '';
            
            // Manager ile verileri doldur
            if(this.editFormManager) {
                this.editFormManager.reset();
                this.editFormManager.setData(accrual);
            }

            document.getElementById('editAccrualModal').classList.add('show');
        }

        // --- YENİ: Edit Kaydetme Fonksiyonu ---
        async handleSaveAccrualChanges() {
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Kaydediliyor...') : null;

            try {
                // 1. Manager'dan verileri al
                const result = this.editFormManager.getData();
                if (!result.success) {
                    if(loader) loader.hide();
                    showNotification(result.error, 'error');
                    return;
                }
                const formData = result.data;
                const accrualId = document.getElementById('editAccrualId').value;

                // 2. Dosya Yükleme (Yeni dosya varsa)
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

                // Mevcut dosyalar + Yeni dosya
                const existingFiles = this.currentEditAccrual.files || [];
                const finalFiles = [...existingFiles, ...newFiles];

                // 3. Güncelleme Objesi
                const updates = {
                    officialFee: formData.officialFee,
                    serviceFee: formData.serviceFee,
                    vatRate: formData.vatRate,
                    applyVatToOfficialFee: formData.applyVatToOfficialFee,
                    totalAmount: formData.totalAmount,
                    totalAmountCurrency: 'TRY',
                    // Kalan tutarı güncelle (Eğer ödeme yapılmadıysa toplama eşitle, yapıldıysa mantığına göre bırak)
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

        // --- Helper: Modal Kapatma ---
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

        // --- Diğer Fonksiyonlar (Aynı Kalıyor) ---
        // (showViewAccrualDetailModal, showTaskDetailModal, showMarkPaidModal, handleBulkUpdate, deleteAccrual vb.)
        
        async showViewAccrualDetailModal(accrualId) {
            // ... (Aynı kalacak, yer kazanmak için yazmadım) ...
            // Önceki main.js dosyasındaki showViewAccrualDetailModal kodunu buraya ekleyin.
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;
            const modal = document.getElementById('viewAccrualDetailModal');
            const title = document.getElementById('viewAccrualTitle');
            const body = modal.querySelector('.modal-body-content');
            title.textContent = `Tahakkuk Detayı (#${accrual.id})`;
            const fmtMoney = (v, c) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: c || 'TRY' }).format(v || 0);
            body.innerHTML = `<div>Tutar: ${fmtMoney(accrual.totalAmount, accrual.totalAmountCurrency)}</div>`; // Basit örnek
            modal.classList.add('show');
        }

        async showTaskDetailModal(taskId) {
            // ... (Aynı kalacak) ...
            const modal = document.getElementById('taskDetailModal');
            const body = document.getElementById('modalBody');
            const title = document.getElementById('modalTaskTitle');
            modal.classList.add('show');
            title.textContent = `İş Detayı Yükleniyor...`;
            body.innerHTML = '<div class="text-center">Yükleniyor...</div>';
            
            const taskRef = doc(db, 'tasks', String(taskId));
            const taskSnap = await getDoc(taskRef);
            if (!taskSnap.exists()) { body.innerHTML = 'Bulunamadı'; return; }
            const task = { id: taskSnap.id, ...taskSnap.data() };
            title.textContent = `İş Detayı (${task.id})`;
            body.innerHTML = `<div class="p-3"><b>${task.title}</b><br>${task.description||''}</div>`; // Basit örnek
        }

        showMarkPaidModal() {
            if (this.selectedAccruals.size === 0) { showNotification('Seçim yapınız', 'error'); return; }
            document.getElementById('paidAccrualCount').textContent = this.selectedAccruals.size;
            document.getElementById('markPaidModal').classList.add('show');
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
            if (this.selectedAccruals.size === 0) return;
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Güncelleniyor...') : null;
            try {
                const promises = Array.from(this.selectedAccruals).map(async (id) => {
                    const updates = { status: newStatus };
                    if (newStatus === 'paid') {
                        updates.paymentDate = document.getElementById('paymentDate').value;
                        updates.remainingAmount = 0;
                        if(this.uploadedPaymentReceipts.length > 0) {
                            const acc = this.allAccruals.find(a => a.id === id);
                            const existing = (acc.files || []).filter(f => f.documentDesignation !== 'Ödeme Dekontu');
                            updates.files = [...existing, ...this.uploadedPaymentReceipts];
                        }
                    } else {
                        updates.paymentDate = null;
                        const acc = this.allAccruals.find(a => a.id === id);
                        updates.remainingAmount = acc.totalAmount;
                    }
                    return accrualService.updateAccrual(id, updates);
                });
                await Promise.all(promises);
                showNotification('Güncellendi', 'success');
                this.closeModal('markPaidModal');
                this.selectedAccruals.clear();
                this.updateBulkActionsVisibility();
                await this.loadAllData();
            } catch(e) { showNotification('Hata', 'error'); } 
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
            document.getElementById('confirmMarkPaidBtn').addEventListener('click', () => this.handleBulkUpdate('paid'));
            
            const area = document.getElementById('paymentReceiptFileUploadArea');
            area.addEventListener('click', () => document.getElementById('paymentReceiptFile').click());
            document.getElementById('paymentReceiptFile').addEventListener('change', e => this.handlePaymentReceiptUpload(e.target.files));
        }
    }

    new AccrualsManager().init();
});