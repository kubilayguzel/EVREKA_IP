import { authService, accrualService, taskService, ipRecordsService, personService, generateUUID } from '../../firebase-config.js';
import { showNotification, formatFileSize, readFileAsDataURL } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'accruals.html' });

    class AccrualsManager {
        constructor() {
            this.currentUser = null;
            this.allAccruals = [];
            this.allTasks = {}; // Map yapısı
            this.allIpRecords = {}; 
            this.allPersons = []; 
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
            if (!this.currentUser) return; 
            await this.loadAllData();
            this.setupEventListeners();
        }

        // --- DATA LAYER ---
        async loadAllData() {
            let simpleLoader = null;
            if(window.showSimpleLoading) {
                simpleLoader = window.showSimpleLoading('Veriler Yükleniyor', 'Lütfen bekleyiniz...');
            }
            
            const loadingIndicator = document.getElementById('loadingIndicator');
            if(loadingIndicator) loadingIndicator.style.display = 'block';

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
                if(loadingIndicator) loadingIndicator.style.display = 'none';
                if(simpleLoader) simpleLoader.hide();
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
                        <div style="display: flex; gap: 5px;">
                            <button class="action-btn view-btn" data-id="${acc.id}">Görüntüle</button>
                            <button class="action-btn edit-btn" data-id="${acc.id}" ${isPaid ? 'disabled' : ''}>Düzenle</button>
                            <button class="action-btn delete-btn" data-id="${acc.id}">Sil</button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
        }

        // --- UI LAYER: MODALS ---
        
        // 1. View Modal (TASARIM GÜNCELLENDİ: Form/Input Görünümü)
        showViewAccrualDetailModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            const modal = document.getElementById('viewAccrualDetailModal');
            const title = document.getElementById('viewAccrualTitle');
            const body = modal.querySelector('.modal-body-content');

            title.textContent = `Tahakkuk Detayı (#${accrual.id})`;
            
            const fmtMoney = (v, c) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: c || 'TRY' }).format(v || 0);
            const fmtDate = (d) => { try { return d ? new Date(d).toLocaleDateString('tr-TR') : '-'; } catch{return '-'} };
            
            let statusText = 'Bilinmiyor';
            if(accrual.status === 'paid') statusText = 'Ödendi';
            if(accrual.status === 'unpaid') statusText = 'Ödenmedi';
            if(accrual.status === 'partially_paid') statusText = 'Kısmen Ödendi';

            let task = this.allTasks[accrual.taskId];
            
            // Dokümanlar
            let docsHtml = '';
            
            // EPATS Belgesi
            if(task?.details?.epatsDocument?.url) {
                docsHtml += `
                <div class="file-item-modal d-flex justify-content-between align-items-center" style="background-color: #e3f2fd; border-left: 4px solid #2196f3;">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-file-pdf text-danger mr-2"></i>
                        <span><strong>EPATS:</strong> ${task.details.epatsDocument.name}</span>
                    </div>
                    <a href="${task.details.epatsDocument.url}" target="_blank" class="btn btn-sm btn-primary">Görüntüle</a>
                </div>`;
            }

            // Diğer Dosyalar
            if(accrual.files?.length) {
                accrual.files.forEach(f => {
                    let label = f.documentDesignation || 'Belge';
                    let icon = 'fa-file-alt';
                    if(label.includes('Fatura')) icon = 'fa-file-invoice-dollar';
                    if(label.includes('Dekont')) icon = 'fa-receipt';
                    
                    docsHtml += `
                    <div class="file-item-modal d-flex justify-content-between align-items-center">
                        <div class="d-flex align-items-center">
                            <i class="fas ${icon} text-secondary mr-2"></i>
                            <span><strong>${label}:</strong> ${f.name}</span>
                        </div>
                        <a href="${f.content || f.url}" target="_blank" class="btn btn-sm btn-outline-secondary">İndir</a>
                    </div>`;
                });
            }
            if(!docsHtml) docsHtml = '<div class="text-muted font-italic p-2">Görüntülenecek belge yok.</div>';

            // HTML Yapısı (Edit Modalı ile Aynı Sınıflar Kullanıldı)
            body.innerHTML = `
                <div class="form-group">
                    <label class="form-label">İlgili İş</label>
                    <input type="text" class="form-input" value="${accrual.taskTitle || '-'} (${accrual.taskId || ''})" readonly style="background-color: #f8f9fa;">
                </div>

                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Tahakkuk Durumu</label>
                        <input type="text" class="form-input" value="${statusText}" readonly>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Oluşturulma Tarihi</label>
                        <input type="text" class="form-input" value="${fmtDate(accrual.createdAt)}" readonly>
                    </div>
                </div>

                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Resmi Ücret</label>
                        <input type="text" class="form-input" value="${fmtMoney(accrual.officialFee?.amount, accrual.officialFee?.currency)}" readonly>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Hizmet Bedeli</label>
                        <input type="text" class="form-input" value="${fmtMoney(accrual.serviceFee?.amount, accrual.serviceFee?.currency)}" readonly>
                    </div>
                </div>

                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">KDV Oranı</label>
                        <input type="text" class="form-input" value="%${accrual.vatRate} (${accrual.applyVatToOfficialFee ? 'Tümü' : 'Hizmet'})" readonly>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Toplam Tutar</label>
                        <div class="total-amount-display" style="margin-top:0; text-align:left; font-size:1rem;">
                            ${fmtMoney(accrual.totalAmount, accrual.totalAmountCurrency)}
                        </div>
                    </div>
                </div>

                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Kalan Tutar</label>
                        <input type="text" class="form-input" value="${fmtMoney(accrual.remainingAmount !== undefined ? accrual.remainingAmount : accrual.totalAmount, accrual.totalAmountCurrency)}" readonly style="color: ${accrual.remainingAmount > 0 ? '#dc3545' : '#28a745'}; font-weight:bold;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Ödeme Tarihi</label>
                        <input type="text" class="form-input" value="${accrual.paymentDate ? fmtDate(accrual.paymentDate) : 'Ödeme Bekleniyor'}" readonly>
                    </div>
                </div>

                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Türk Patent Faturası Kime?</label>
                        <input type="text" class="form-input" value="${accrual.tpInvoiceParty?.name || '-'}" readonly>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Hizmet Faturası Kime?</label>
                        <input type="text" class="form-input" value="${accrual.serviceInvoiceParty?.name || '-'}" readonly>
                    </div>
                </div>

                <div class="form-group" style="margin-top: 20px;">
                    <label class="form-label">Belgeler</label>
                    <div class="file-list-modal" style="border: 1px solid #e1e8ed; border-radius: 10px; padding: 10px;">
                        ${docsHtml}
                    </div>
                </div>
            `;

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
            
            let loader = null;
            if(window.showSimpleLoading) loader = window.showSimpleLoading('Güncelleniyor...');

            try {
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
                        // Dosya ekleme
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
                let loader = null;
                if(window.showSimpleLoading) loader = window.showSimpleLoading('Siliniyor...');
                
                try {
                    await accrualService.deleteAccrual(id);
                    await this.loadAllData();
                } catch(e) {
                    showNotification('Silinemedi', 'error');
                } finally {
                    if(loader) loader.hide();
                }
            }
        }

        async handleSaveAccrualChanges() {
            let loader = null;
            if(window.showSimpleLoading) loader = window.showSimpleLoading('Kaydediliyor...');

            try {
                const accrualId = document.getElementById('editAccrualId').value;
                const officialFee = parseFloat(document.getElementById('editOfficialFee').value) || 0;
                const serviceFee = parseFloat(document.getElementById('editServiceFee').value) || 0;
                const vatRate = parseFloat(document.getElementById('editVatRate').value) || 0;
                const applyVatToOfficial = document.getElementById('editApplyVatToOfficialFee').checked;
                let totalAmount;
                if (applyVatToOfficial) {
                    totalAmount = (officialFee + serviceFee) * (1 + vatRate / 100);
                } else {
                    totalAmount = officialFee + (serviceFee * (1 + vatRate / 100));
                }

                const updates = {
                    officialFee: { amount: officialFee, currency: document.getElementById('editOfficialFeeCurrency').value },
                    serviceFee: { amount: serviceFee, currency: document.getElementById('editServiceFeeCurrency').value },
                    vatRate,
                    applyVatToOfficialFee: applyVatToOfficial,
                    totalAmount,
                    totalAmountCurrency: 'TRY',
                    remainingAmount: this.currentEditAccrual.remainingAmount !== undefined ? this.currentEditAccrual.remainingAmount : totalAmount,
                    tpInvoiceParty: this.editSelectedTpInvoiceParty ? { id: this.editSelectedTpInvoiceParty.id, name: this.editSelectedTpInvoiceParty.name } : null,
                    serviceInvoiceParty: this.editSelectedServiceInvoiceParty ? { id: this.editSelectedServiceInvoiceParty.id, name: this.editSelectedServiceInvoiceParty.name } : null,
                };

                await accrualService.updateAccrual(accrualId, updates);
                this.closeModal('editAccrualModal');
                await this.loadAllData();
                showNotification('Kaydedildi', 'success');

            } catch(e) {
                showNotification('Hata', 'error');
            } finally {
                if(loader) loader.hide();
            }
        }

        // --- EVENTS & HELPERS ---
        setupEventListeners() {
            document.getElementById('statusFilter').addEventListener('change', e => this.renderTable(e.target.value));
            
            document.getElementById('selectAllCheckbox').addEventListener('change', e => this.toggleSelectAll(e.target.checked));
            document.getElementById('accrualsTableBody').addEventListener('change', e => {
                if(e.target.classList.contains('row-checkbox')) this.updateSelection(e.target.dataset.id, e.target.checked);
            });

            document.getElementById('accrualsTableBody').addEventListener('click', e => {
                const btn = e.target.closest('.action-btn');
                if(!btn) return;
                
                e.preventDefault();
                const dataId = btn.dataset.id;
                if(btn.classList.contains('view-btn')) this.showViewAccrualDetailModal(dataId);
                if(btn.classList.contains('edit-btn')) this.showEditAccrualModal(dataId);
                if(btn.classList.contains('delete-btn')) this.deleteAccrual(dataId);
            });

            document.getElementById('accrualsTableBody').addEventListener('click', e => {
                if(e.target.classList.contains('task-detail-link')) {
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

            document.getElementById('saveAccrualChangesBtn').addEventListener('click', () => this.handleSaveAccrualChanges());
            document.getElementById('confirmMarkPaidBtn').addEventListener('click', () => this.handleBulkUpdate('paid'));
            
            ['editOfficialFee', 'editServiceFee', 'editVatRate', 'editApplyVatToOfficialFee'].forEach(id => {
                document.getElementById(id).addEventListener('input', () => this.calculateEditTotalAmount());
            });

            document.getElementById('editTpInvoicePartySearch').addEventListener('input', e => this.searchPersons(e.target.value, 'editTpInvoiceParty'));
            document.getElementById('editServiceInvoicePartySearch').addEventListener('input', e => this.searchPersons(e.target.value, 'editServiceInvoiceParty'));

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
        
        searchPersons(query, target) {
            const resultsContainerId = target === 'editTpInvoiceParty' ? 'editTpInvoicePartyResults' : 'editServiceInvoicePartyResults';
            const container = document.getElementById(resultsContainerId);
            container.innerHTML = '';
            
            if(query.length < 2) { container.style.display = 'none'; return; }

            const filtered = this.allPersons.filter(p => (p.name || '').toLowerCase().includes(query.toLowerCase()));
            
            if(filtered.length === 0) {
                container.innerHTML = '<div class="search-result-item">Sonuç yok</div>';
            } else {
                filtered.forEach(p => {
                    const div = document.createElement('div');
                    div.className = 'search-result-item';
                    div.textContent = p.name;
                    div.onclick = () => this.selectPerson(p, target);
                    container.appendChild(div);
                });
            }
            container.style.display = 'block';
        }

        selectPerson(person, target) {
            const displayId = target === 'editTpInvoiceParty' ? 'editSelectedTpInvoicePartyDisplay' : 'editSelectedServiceInvoicePartyDisplay';
            const inputId = target === 'editTpInvoiceParty' ? 'editTpInvoicePartySearch' : 'editServiceInvoicePartySearch';
            const resultsId = target === 'editTpInvoiceParty' ? 'editTpInvoicePartyResults' : 'editServiceInvoicePartyResults';

            if(target === 'editTpInvoiceParty') this.editSelectedTpInvoiceParty = person;
            else this.editSelectedServiceInvoiceParty = person;

            this.updateEditSelectedPartyDisplay(displayId, person);
            document.getElementById(inputId).value = '';
            document.getElementById(resultsId).style.display = 'none';
        }

        updateEditSelectedPartyDisplay(elId, party) {
            const el = document.getElementById(elId);
            el.innerHTML = party ? `<b>Seçilen:</b> ${party.name} <span style="cursor:pointer;color:red" onclick="this.parentElement.style.display='none'">[X]</span>` : '';
            el.style.display = party ? 'block' : 'none';
            if(party) {
                el.querySelector('span').onclick = () => {
                    el.style.display = 'none';
                    if(elId.includes('Tp')) this.editSelectedTpInvoiceParty = null;
                    else this.editSelectedServiceInvoiceParty = null;
                };
            }
        }

        showTaskDetailModal(taskId) {
            const task = this.allTasks[taskId];
            if(!task) { showNotification('İş bulunamadı', 'error'); return; }
            document.getElementById('modalTaskTitle').textContent = `İş Detayı: ${task.title}`;
            document.getElementById('modalBody').innerHTML = `<p><b>Durum:</b> ${task.status}</p><p><b>Açıklama:</b> ${task.description || '-'}</p>`;
            document.getElementById('taskDetailModal').classList.add('show');
        }
    }

    new AccrualsManager().init();
});