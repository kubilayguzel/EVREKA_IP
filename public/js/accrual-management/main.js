import { authService, accrualService, taskService, ipRecordsService, personService, generateUUID } from '../../firebase-config.js';
import { showNotification, formatFileSize, readFileAsDataURL } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'accruals.html' });

    class AccrualsManager {
        constructor() {
            this.currentUser = null;
            this.allAccruals = [];
            this.allTasks = {}; // Map
            this.allIpRecords = {}; // Map
            this.allPersons = []; // Array
            this.selectedAccruals = new Set();
            
            // Edit State
            this.currentEditAccrual = null;
            this.editSelectedTpInvoiceParty = null;
            this.editSelectedServiceInvoiceParty = null;
            
            // Upload State
            this.uploadedPaymentReceipts = [];
        }

        async init() {
            this.currentUser = authService.getCurrentUser();
            if (!this.currentUser) return; // Guard
            await this.loadAllData();
            this.setupEventListeners();
        }

        // --- DATA LAYER ---
        async loadAllData() {
            if(window.showSimpleLoading) window.showSimpleLoading('Veriler Yükleniyor...');
            const loading = document.getElementById('loadingIndicator');
            if(loading) loading.style.display = 'block';

            try {
                // 1. Accruals
                const accRes = await accrualService.getAccruals();
                this.allAccruals = accRes?.success ? (accRes.data || []) : [];

                if (!this.allAccruals.length) {
                    this.renderTable();
                    return;
                }

                // 2. IDs
                const taskIds = new Set();
                const personIds = new Set();
                this.allAccruals.forEach(a => {
                    if (a.taskId) taskIds.add(a.taskId);
                    if (a.personId) personIds.add(a.personId);
                });

                // 3. Batch Fetch Tasks
                if (taskIds.size && taskService.getTasksByIds) {
                    const tRes = await taskService.getTasksByIds(Array.from(taskIds));
                    const tasks = tRes?.success ? (tRes.data || []) : [];
                    this.allTasks = Object.fromEntries(tasks.map(t => [t.id, t]));
                }

                // 4. Fetch All Persons (Search için)
                const pRes = await personService.getPersons();
                this.allPersons = pRes?.success ? (pRes.data || []) : [];

                this.renderTable();

            } catch (err) {
                console.error(err);
                showNotification('Veri yükleme hatası', 'error');
            } finally {
                if(loading) loading.style.display = 'none';
                if(window.SimpleLoading) new SimpleLoading().hide();
            }
        }

        // --- UI LAYER: TABLE ---
        renderTable(filter = 'all') {
            const tbody = document.getElementById('accrualsTableBody');
            const noMsg = document.getElementById('noRecordsMessage');
            
            const filtered = this.allAccruals.filter(a => filter === 'all' || a.status === filter);

            if (filtered.length === 0) {
                tbody.innerHTML = '';
                noMsg.style.display = 'block';
                return;
            }
            noMsg.style.display = 'none';

            // Formatters
            const fmtMoney = (v, c) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: c || 'TRY' }).format(v || 0);

            tbody.innerHTML = filtered.map(acc => {
                let sTxt = 'Bilinmiyor', sCls = '';
                if(acc.status === 'paid') { sTxt = 'Ödendi'; sCls = 'status-paid'; }
                if(acc.status === 'unpaid') { sTxt = 'Ödenmedi'; sCls = 'status-unpaid'; }
                if(acc.status === 'partially_paid') { sTxt = 'Kısmen Ödendi'; sCls = 'status-partially-paid'; }

                const isSel = this.selectedAccruals.has(acc.id);
                const isPaid = acc.status === 'paid';
                const rem = acc.remainingAmount !== undefined ? acc.remainingAmount : acc.totalAmount;

                return `
                <tr>
                    <td><input type="checkbox" class="row-checkbox" data-id="${acc.id}" ${isSel ? 'checked' : ''}></td>
                    <td><small>${acc.id}</small></td>
                    <td><span class="status-badge ${sCls}">${sTxt}</span></td>
                    <td><a href="#" class="task-detail-link" data-task-id="${acc.taskId}">${acc.taskTitle || acc.taskId}</a></td>
                    <td>${fmtMoney(acc.officialFee?.amount, acc.officialFee?.currency)}</td>
                    <td>${fmtMoney(acc.serviceFee?.amount, acc.serviceFee?.currency)}</td>
                    <td>${fmtMoney(acc.totalAmount, acc.totalAmountCurrency)}</td>
                    <td>${fmtMoney(rem, acc.totalAmountCurrency)}</td>
                    <td>
                        <button class="action-btn view-btn" data-id="${acc.id}">Görüntüle</button>
                        <button class="action-btn edit-btn" data-id="${acc.id}" ${isPaid ? 'disabled' : ''}>Düzenle</button>
                        <button class="action-btn delete-btn" data-id="${acc.id}">Sil</button>
                    </td>
                </tr>`;
            }).join('');
        }

        // --- UI LAYER: MODALS ---
        
        // 1. View Modal (SİZİN İSTEDİĞİNİZ YENİ TASARIM)
        showViewAccrualDetailModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            const modal = document.getElementById('viewAccrualDetailModal');
            const title = document.getElementById('viewAccrualTitle');
            const body = modal.querySelector('.modal-body-content');

            title.textContent = `Tahakkuk Detayı (#${accrual.id})`;
            
            // Formatters & Status
            const fmtMoney = (v, c) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: c || 'TRY' }).format(v || 0);
            const fmtDate = (d) => { try { return d ? new Date(d).toLocaleDateString('tr-TR') : '-'; } catch{return '-'} };
            
            let sBadge = `<span class="badge badge-secondary px-3 w-100 py-2">Bilinmiyor</span>`;
            if(accrual.status === 'paid') sBadge = `<span class="badge badge-success px-3 w-100 py-2">Ödendi</span>`;
            if(accrual.status === 'unpaid') sBadge = `<span class="badge badge-danger px-3 w-100 py-2">Ödenmedi</span>`;
            if(accrual.status === 'partially_paid') sBadge = `<span class="badge badge-warning px-3 w-100 py-2 text-white">Kısmen Ödendi</span>`;

            // Related Task
            let task = this.allTasks[accrual.taskId];
            
            // Docs
            let docsHtml = '';
            // EPATS
            if(task?.details?.epatsDocument?.url) {
                docsHtml += `
                <div class="col-12 mb-3">
                    <label class="view-label text-primary"><i class="fas fa-file-contract mr-1"></i> İŞİN EPATS DOKÜMANI</label>
                    <div class="view-box bg-light d-flex justify-content-between align-items-center" style="border-left: 4px solid #007bff;">
                        <div class="d-flex align-items-center overflow-hidden">
                            <i class="fas fa-file-pdf text-danger fa-lg mr-3"></i>
                            <strong class="d-block text-dark" style="font-size:0.9rem;">${task.details.epatsDocument.name}</strong>
                        </div>
                        <a href="${task.details.epatsDocument.url}" target="_blank" class="btn btn-sm btn-outline-primary font-weight-bold ml-2">Görüntüle</a>
                    </div>
                </div>`;
            }
            // Other Files
            if(accrual.files?.length) {
                accrual.files.forEach(f => {
                    let lbl = f.documentDesignation || 'BELGE';
                    let ico = 'fa-file-alt text-secondary';
                    if(lbl.includes('Fatura')) { lbl = 'YURTDIŞI FATURA'; ico = 'fa-file-invoice-dollar text-info'; }
                    else if(lbl.includes('Dekont')) { lbl = 'ÖDEME DEKONTU'; ico = 'fa-receipt text-success'; }
                    
                    docsHtml += `
                    <div class="col-md-6 mb-3">
                        <label class="view-label">${lbl.toUpperCase()}</label>
                        <div class="view-box d-flex justify-content-between align-items-center">
                            <div class="d-flex align-items-center text-truncate pr-2">
                                <i class="fas ${ico} fa-lg mr-2"></i>
                                <span class="text-truncate small">${f.name}</span>
                            </div>
                            <a href="${f.content || f.url}" target="_blank" class="btn btn-sm btn-light border ml-1"><i class="fas fa-download"></i></a>
                        </div>
                    </div>`;
                });
            }
            if(!docsHtml) docsHtml = `<div class="col-12"><div class="p-3 border rounded bg-light text-center text-muted small">Belge yok.</div></div>`;

            // HTML Structure
            body.innerHTML = `
            <div class="container-fluid p-0">
                <div class="section-header mt-0"><i class="fas fa-info-circle mr-2"></i>GENEL BİLGİLER</div>
                <div class="row">
                    <div class="col-md-8 mb-3">
                        <label class="view-label">İlgili İş</label>
                        <div class="view-box bg-light font-weight-bold text-dark">${accrual.taskTitle || '-'} <span class="text-muted ml-2 small">(${accrual.taskId || 'ID Yok'})</span></div>
                    </div>
                    <div class="col-md-4 mb-3"><label class="view-label">Durum</label>${sBadge}</div>
                </div>
                <div class="row">
                    <div class="col-md-6 mb-3"><label class="view-label">Oluşturulma</label><div class="view-box"><i class="far fa-calendar-plus mr-2"></i>${fmtDate(accrual.createdAt)}</div></div>
                    <div class="col-md-6 mb-3"><label class="view-label">Ödeme</label><div class="view-box"><i class="far fa-calendar-check mr-2"></i>${accrual.paymentDate ? fmtDate(accrual.paymentDate) : 'Bekliyor'}</div></div>
                </div>

                <div class="section-header"><i class="fas fa-coins mr-2"></i>FİNANSAL DETAYLAR</div>
                <div class="row">
                    <div class="col-md-6 mb-3"><label class="view-label">Resmi Ücret</label><div class="view-box font-weight-bold">${fmtMoney(accrual.officialFee?.amount, accrual.officialFee?.currency)}</div></div>
                    <div class="col-md-6 mb-3"><label class="view-label">Hizmet Bedeli</label><div class="view-box font-weight-bold">${fmtMoney(accrual.serviceFee?.amount, accrual.serviceFee?.currency)}</div></div>
                </div>
                <div class="row">
                    <div class="col-md-4 mb-3"><label class="view-label">KDV</label><div class="view-box text-muted small">%${accrual.vatRate}</div></div>
                    <div class="col-md-4 mb-3"><label class="view-label">Toplam</label><div class="view-box font-weight-bold text-primary bg-light">${fmtMoney(accrual.totalAmount, accrual.totalAmountCurrency)}</div></div>
                    <div class="col-md-4 mb-3"><label class="view-label">Kalan</label><div class="view-box font-weight-bold ${accrual.remainingAmount > 0 ? 'text-danger' : 'text-success'}">${fmtMoney(accrual.remainingAmount !== undefined ? accrual.remainingAmount : accrual.totalAmount, accrual.totalAmountCurrency)}</div></div>
                </div>

                <div class="section-header"><i class="fas fa-file-invoice mr-2"></i>FATURA BİLGİLERİ</div>
                <div class="row">
                    <div class="col-md-6 mb-3"><label class="view-label">TP Faturası</label><div class="view-box small text-truncate"><i class="fas fa-user-tie mr-2"></i>${accrual.tpInvoiceParty?.name || '-'}</div></div>
                    <div class="col-md-6 mb-3"><label class="view-label">Hizmet Faturası</label><div class="view-box small text-truncate"><i class="fas fa-building mr-2"></i>${accrual.serviceInvoiceParty?.name || '-'}</div></div>
                </div>

                <div class="section-header"><i class="fas fa-folder-open mr-2"></i>BELGELER</div>
                <div class="row">${docsHtml}</div>
            </div>`;

            modal.classList.add('show');
        }

        // 2. Edit Modal
        showEditAccrualModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            this.currentEditAccrual = { ...accrual };
            document.getElementById('editAccrualId').value = accrual.id;
            document.getElementById('editAccrualTaskTitleDisplay').value = accrual.taskTitle || '';
            
            // Set Values
            document.getElementById('editOfficialFee').value = accrual.officialFee?.amount || 0;
            document.getElementById('editOfficialFeeCurrency').value = accrual.officialFee?.currency || 'TRY';
            document.getElementById('editServiceFee').value = accrual.serviceFee?.amount || 0;
            document.getElementById('editServiceFeeCurrency').value = accrual.serviceFee?.currency || 'TRY';
            document.getElementById('editVatRate').value = accrual.vatRate || 20;
            document.getElementById('editApplyVatToOfficialFee').checked = accrual.applyVatToOfficialFee ?? true;

            // Parties
            this.editSelectedTpInvoiceParty = accrual.tpInvoiceParty || null;
            this.editSelectedServiceInvoiceParty = accrual.serviceInvoiceParty || null;
            this.updateEditSelectedPartyDisplay('editSelectedTpInvoicePartyDisplay', this.editSelectedTpInvoiceParty);
            this.updateEditSelectedPartyDisplay('editSelectedServiceInvoicePartyDisplay', this.editSelectedServiceInvoiceParty);

            this.calculateEditTotalAmount();
            document.getElementById('editAccrualModal').classList.add('show');
        }

        // 3. Mark Paid Modal (Bulk)
        showMarkPaidModal() {
            if (this.selectedAccruals.size === 0) { showNotification('Seçim yapınız', 'error'); return; }
            
            document.getElementById('paidAccrualCount').textContent = this.selectedAccruals.size;
            
            // Tekli seçimse tutarı göster
            if (this.selectedAccruals.size === 1) {
                const id = Array.from(this.selectedAccruals)[0];
                const acc = this.allAccruals.find(a => a.id === id);
                if(acc) {
                    const fmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: acc.totalAmountCurrency }).format(acc.totalAmount);
                    document.getElementById('displayAccrualTotalAmount').textContent = fmt;
                    document.getElementById('singleAccrualTotalAmountDisplay').style.display = 'block';
                    document.getElementById('remainingAmountGroup').style.display = 'block';
                    document.getElementById('remainingAmount').value = 0;
                }
            } else {
                document.getElementById('singleAccrualTotalAmountDisplay').style.display = 'none';
                document.getElementById('remainingAmountGroup').style.display = 'none';
            }
            document.getElementById('markPaidModal').classList.add('show');
        }

        // --- ACTIONS ---
        async handleBulkUpdate(newStatus) {
            if (this.selectedAccruals.size === 0) return;
            
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Güncelleniyor...') : null;

            try {
                // Logic for Paid/Unpaid/Partial
                // (Orijinal koddaki handleBulkUpdate mantığını buraya taşıyoruz)
                // Kısalık için özet: Her seçili ID için updateAccrual çağırılır.
                // Eğer status 'paid' ise ödeme tarihi ve dekontlar eklenir.
                
                const promises = Array.from(this.selectedAccruals).map(async (id) => {
                    const updates = { status: newStatus };
                    if (newStatus === 'paid') {
                        updates.paymentDate = document.getElementById('paymentDate').value;
                        if(this.selectedAccruals.size === 1) {
                            const rem = parseFloat(document.getElementById('remainingAmount').value);
                            if(rem > 0) updates.status = 'partially_paid';
                            updates.remainingAmount = rem;
                        } else {
                            updates.remainingAmount = 0;
                        }
                        // Dosya ekleme mantığı...
                        if(this.uploadedPaymentReceipts.length > 0) {
                            const acc = this.allAccruals.find(a => a.id === id);
                            const existing = (acc.files || []).filter(f => f.documentDesignation !== 'Ödeme Dekontu');
                            updates.files = [...existing, ...this.uploadedPaymentReceipts];
                        }
                    } else {
                        // Unpaid
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

            } catch(e) {
                showNotification('Hata oluştu', 'error');
            } finally {
                if(loader) loader.hide();
            }
        }

        async deleteAccrual(id) {
            if(confirm('Silmek istiyor musunuz?')) {
                await accrualService.deleteAccrual(id);
                await this.loadAllData();
            }
        }

        // --- EVENTS & HELPERS ---
        setupEventListeners() {
            // Filter
            document.getElementById('statusFilter').addEventListener('change', e => this.renderTable(e.target.value));
            
            // Checkboxes
            document.getElementById('selectAllCheckbox').addEventListener('change', e => this.toggleSelectAll(e.target.checked));
            document.getElementById('accrualsTableBody').addEventListener('change', e => {
                if(e.target.classList.contains('row-checkbox')) this.updateSelection(e.target.dataset.id, e.target.checked);
            });

            // Table Buttons
            document.getElementById('accrualsTableBody').addEventListener('click', e => {
                const id = e.target.dataset.id;
                if(e.target.classList.contains('view-btn')) this.showViewAccrualDetailModal(id);
                if(e.target.classList.contains('edit-btn')) this.showEditAccrualModal(id);
                if(e.target.classList.contains('delete-btn')) this.deleteAccrual(id);
            });

            // Bulk Buttons
            document.getElementById('bulkMarkPaidBtn').addEventListener('click', () => this.showMarkPaidModal());
            document.getElementById('bulkMarkUnpaidBtn').addEventListener('click', () => this.handleBulkUpdate('unpaid'));
            
            // Modal Closers
            document.querySelectorAll('.close-modal-btn, #cancelEditAccrualBtn, #cancelMarkPaidBtn').forEach(b => {
                b.addEventListener('click', e => {
                    const m = e.target.closest('.modal');
                    this.closeModal(m.id);
                });
            });

            // Forms
            document.getElementById('saveAccrualChangesBtn').addEventListener('click', () => this.handleSaveAccrualChanges());
            document.getElementById('confirmMarkPaidBtn').addEventListener('click', () => this.handleBulkUpdate('paid'));
            
            // Inputs calc
            ['editOfficialFee', 'editServiceFee', 'editVatRate', 'editApplyVatToOfficialFee'].forEach(id => {
                document.getElementById(id).addEventListener('input', () => this.calculateEditTotalAmount());
            });

            // File Upload Area
            const area = document.getElementById('paymentReceiptFileUploadArea');
            area.addEventListener('click', () => document.getElementById('paymentReceiptFile').click());
            document.getElementById('paymentReceiptFile').addEventListener('change', e => this.handlePaymentReceiptUpload(e.target.files));
        }

        toggleSelectAll(checked) {
            document.querySelectorAll('.row-checkbox').forEach(cb => {
                cb.checked = checked;
                this.updateSelection(cb.dataset.id, checked);
            });
        }

        updateSelection(id, selected) {
            if(selected) this.selectedAccruals.add(id);
            else this.selectedAccruals.delete(id);
            this.updateBulkActionsVisibility();
        }

        updateBulkActionsVisibility() {
            document.getElementById('bulkActions').style.display = this.selectedAccruals.size > 0 ? 'flex' : 'none';
        }

        calculateEditTotalAmount() {
            const off = parseFloat(document.getElementById('editOfficialFee').value) || 0;
            const srv = parseFloat(document.getElementById('editServiceFee').value) || 0;
            const vat = parseFloat(document.getElementById('editVatRate').value) || 0;
            const apply = document.getElementById('editApplyVatToOfficialFee').checked;
            let tot = apply ? (off + srv) * (1 + vat/100) : off + (srv * (1 + vat/100));
            document.getElementById('editTotalAmountDisplay').textContent = new Intl.NumberFormat('tr-TR', { style:'currency', currency:'TRY'}).format(tot);
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
            list.innerHTML = this.uploadedPaymentReceipts.map(f => 
                `<div class="file-item-modal"><span>${f.name}</span><button class="remove-file-modal" onclick="this.parentElement.remove()">x</button></div>`
            ).join('');
        }

        closeModal(id) {
            document.getElementById(id).classList.remove('show');
            if(id === 'editAccrualModal') {
                this.currentEditAccrual = null;
                document.getElementById('editAccrualForm').reset();
            }
            if(id === 'markPaidModal') {
                this.uploadedPaymentReceipts = [];
                document.getElementById('paymentReceiptFileList').innerHTML = '';
            }
        }
        
        // Search & Update Party Display helper methods... (Kısalık için dahil etmedim ama orijinal koddakiler buraya gelecek)
        updateEditSelectedPartyDisplay(elId, party) {
            const el = document.getElementById(elId);
            el.innerHTML = party ? `<b>Seçilen:</b> ${party.name}` : '';
            el.style.display = party ? 'block' : 'none';
        }
    }

    new AccrualsManager().init();
});