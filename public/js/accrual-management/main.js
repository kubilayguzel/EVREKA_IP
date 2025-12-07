import { authService, accrualService, taskService, ipRecordsService, personService, generateUUID } from '../../firebase-config.js';
import { showNotification, formatFileSize, readFileAsDataURL } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'accruals.html' });

    class AccrualsManager {
        constructor() {
            this.currentUser = null;
            this.allAccruals = [];
            this.allTasks = {}; // Map: { "279": { ...taskData... } }
            this.allIpRecords = {}; 
            this.allPersons = []; 
            this.selectedAccruals = new Set();
            
            // Edit State
            this.currentEditAccrual = null;
            this.editSelectedTpInvoiceParty = null;
            this.editSelectedServiceInvoiceParty = null;
            this.editNewForeignInvoices = []; 
            
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
                // 1. Tahakkukları Çek
                const accRes = await accrualService.getAccruals();
                this.allAccruals = accRes?.success ? (accRes.data || []) : [];

                if (!this.allAccruals.length) {
                    this.renderTable();
                    return;
                }

                // 2. ID'leri Topla
                const taskIds = new Set();
                const personIds = new Set();
                this.allAccruals.forEach(a => {
                    if (a.taskId) taskIds.add(String(a.taskId)); // ID'leri String olarak sakla
                    if (a.personId) personIds.add(a.personId);
                });

                // 3. İlişkili İşleri (Tasks) Çek ve Map'e Çevir
                if (taskIds.size && taskService.getTasksByIds) {
                    const tRes = await taskService.getTasksByIds(Array.from(taskIds));
                    const tasks = tRes?.success ? (tRes.data || []) : [];
                    
                    // Task'leri ID'lerine göre (String formatında) Map yap
                    this.allTasks = {};
                    tasks.forEach(t => {
                        this.allTasks[String(t.id)] = t;
                    });
                }

                // 4. Kişileri Çek
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

                // Task Title Fallback
                let taskDisplay = acc.taskTitle || acc.taskId;
                // Eğer Task yüklendiyse güncel başlığı al
                if (this.allTasks[String(acc.taskId)]) {
                    taskDisplay = this.allTasks[String(acc.taskId)].title;
                }

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
        }

        // --- UI LAYER: MODALS ---
        
        // 1. View Modal (GÜNCEL: Düzeltilmiş EPATS ve Form Yapısı)
        showViewAccrualDetailModal(accrualId) {
            // 1. Tahakkuk Verisini Bul
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            // 2. Modal Elementlerini Hazırla
            const modal = document.getElementById('viewAccrualDetailModal');
            const title = document.getElementById('viewAccrualTitle');
            const body = modal.querySelector('.modal-body-content');

            title.textContent = `Tahakkuk Detayı (#${accrual.id})`;

            // 3. Yardımcı Formatlayıcılar
            const fmtMoney = (v, c) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: c || 'TRY' }).format(v || 0);
            const fmtDate = (d) => { try { return d ? new Date(d).toLocaleDateString('tr-TR') : '-'; } catch { return '-'; } };

            let statusText = 'Bilinmiyor';
            let statusColor = '#6c757d'; // secondary
            if (accrual.status === 'paid') { statusText = 'Ödendi'; statusColor = '#28a745'; } // success
            else if (accrual.status === 'unpaid') { statusText = 'Ödenmedi'; statusColor = '#dc3545'; } // danger
            else if (accrual.status === 'partially_paid') { statusText = 'Kısmen Ödendi'; statusColor = '#ffc107'; } // warning

            // 4. İlgili İş (Task) Verisini Bul
            // main.js'de init() kısmında this.allTasks map'ini doldurmuştuk.
            // Veritabanı yapısına göre taskId string olarak saklanıyor olabilir, güvenli erişim için String() kullanıyoruz.
            let relatedTask = null;
            let taskTitleDisplay = accrual.taskTitle || '-';
            
            if (accrual.taskId) {
                relatedTask = this.allTasks[String(accrual.taskId)];
                // Eğer task bellekte varsa güncel başlığı oradan alalım
                if (relatedTask) {
                    taskTitleDisplay = relatedTask.title;
                }
            }

            // 5. Belge (Doküman) Kartlarını Hazırla
            let epatsHtml = '';
            let foreignInvHtml = '';
            let receiptHtml = '';

            // A) EPATS BELGESİ (Task -> details -> epatsDocument -> downloadURL)
            // Görseldeki veritabanı yapısına (image_900c12.png) tam uyumlu kontrol:
            if (relatedTask && relatedTask.details && relatedTask.details.epatsDocument) {
                const epatsDoc = relatedTask.details.epatsDocument;
                const docUrl = epatsDoc.downloadURL || epatsDoc.url; // downloadURL öncelikli
                const docName = epatsDoc.name || 'EPATS Belgesi';

                if (docUrl) {
                    epatsHtml = `
                    <div class="col-md-6 mb-3">
                        <div class="doc-card" style="border-left: 5px solid #007bff; background: #f8f9fa; padding: 10px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                            <div class="d-flex align-items-center justify-content-between">
                                <div class="d-flex align-items-center overflow-hidden">
                                    <div class="doc-icon-box mr-3">
                                        <i class="fas fa-file-contract fa-2x text-primary"></i>
                                    </div>
                                    <div class="doc-content overflow-hidden">
                                        <span class="d-block text-primary font-weight-bold" style="font-size: 0.75rem;">İŞİN EPATS DOKÜMANI</span>
                                        <span class="d-block text-truncate" title="${docName}" style="font-size: 0.9rem; font-weight: 500;">${docName}</span>
                                    </div>
                                </div>
                                <div class="doc-action ml-2">
                                    <a href="${docUrl}" target="_blank" class="btn btn-sm btn-outline-primary shadow-sm" title="Görüntüle">
                                        <i class="fas fa-eye"></i>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>`;
                }
            }

            // B) TAHAKKUK DOSYALARI (accrual.files)
            if (accrual.files && accrual.files.length > 0) {
                accrual.files.forEach(f => {
                    const url = f.content || f.url;
                    let label = f.documentDesignation || 'BELGE';
                    let icon = 'fa-file-alt';
                    let colorClass = 'text-secondary';
                    let borderStyle = 'border-left: 5px solid #6c757d;';

                    if (label.includes('Fatura') || label.includes('Invoice') || label.includes('Debit')) {
                        label = 'YURTDIŞI FATURA/DEBIT';
                        icon = 'fa-file-invoice-dollar';
                        colorClass = 'text-info';
                        borderStyle = 'border-left: 5px solid #17a2b8;';
                    } else if (label.includes('Dekont') || label.includes('Receipt')) {
                        label = 'ÖDEME DEKONTU';
                        icon = 'fa-receipt';
                        colorClass = 'text-success';
                        borderStyle = 'border-left: 5px solid #28a745;';
                    } else {
                        label = label.toUpperCase();
                    }

                    const cardHtml = `
                    <div class="col-md-6 mb-3">
                        <div class="doc-card" style="${borderStyle} background: #fff; border-top:1px solid #eee; border-right:1px solid #eee; border-bottom:1px solid #eee; padding: 10px; border-radius: 4px;">
                            <div class="d-flex align-items-center justify-content-between">
                                <div class="d-flex align-items-center overflow-hidden">
                                    <div class="doc-icon-box mr-3">
                                        <i class="fas ${icon} fa-2x ${colorClass}"></i>
                                    </div>
                                    <div class="doc-content overflow-hidden">
                                        <span class="d-block text-muted font-weight-bold" style="font-size: 0.75rem;">${label}</span>
                                        <span class="d-block text-truncate" title="${f.name}" style="font-size: 0.9rem;">${f.name}</span>
                                    </div>
                                </div>
                                <div class="doc-action ml-2">
                                    <a href="${url}" target="_blank" class="btn btn-sm btn-outline-secondary" title="İndir/Görüntüle">
                                        <i class="fas fa-download"></i>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>`;

                    if (label === 'ÖDEME DEKONTU') receiptHtml += cardHtml;
                    else foreignInvHtml += cardHtml;
                });
            }

            if (!epatsHtml && !foreignInvHtml && !receiptHtml) {
                foreignInvHtml = '<div class="col-12"><div class="alert alert-light text-center text-muted small border">Bu kayda ait görüntülenecek herhangi bir belge bulunamadı.</div></div>';
            }


            // 6. Modal İçeriğini Oluştur (HTML Render)
            body.innerHTML = `
                <div class="form-group mb-4">
                    <label class="form-label text-muted small font-weight-bold">İlgili İş (Task)</label>
                    <div class="p-2 bg-light rounded border d-flex justify-content-between align-items-center">
                        <span class="font-weight-bold text-dark">${taskTitleDisplay}</span>
                        <span class="badge badge-light border">ID: ${accrual.taskId || 'Yok'}</span>
                    </div>
                </div>

                <div class="row mb-3">
                    <div class="col-md-6">
                        <label class="form-label text-muted small font-weight-bold">Tahakkuk Durumu</label>
                        <div class="form-control-plaintext font-weight-bold" style="color: ${statusColor};">${statusText}</div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label text-muted small font-weight-bold">Oluşturulma Tarihi</label>
                        <div class="form-control-plaintext">${fmtDate(accrual.createdAt)}</div>
                    </div>
                </div>

                <div class="section-header mt-4 mb-3 pb-2 border-bottom"><i class="fas fa-coins mr-2 text-warning"></i>FİNANSAL DETAYLAR</div>
                <div class="row mb-2">
                    <div class="col-md-6 mb-3">
                        <label class="form-label text-muted small">Resmi Ücret</label>
                        <input type="text" class="form-control bg-white" value="${fmtMoney(accrual.officialFee?.amount, accrual.officialFee?.currency)}" readonly>
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label text-muted small">Hizmet Bedeli</label>
                        <input type="text" class="form-control bg-white" value="${fmtMoney(accrual.serviceFee?.amount, accrual.serviceFee?.currency)}" readonly>
                    </div>
                </div>
                <div class="row mb-2">
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted small">KDV</label>
                        <input type="text" class="form-control bg-white" value="%${accrual.vatRate} (${accrual.applyVatToOfficialFee ? 'Tümü' : 'Hizmet'})" readonly>
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted small">Toplam Tutar</label>
                        <input type="text" class="form-control" value="${fmtMoney(accrual.totalAmount, accrual.totalAmountCurrency)}" readonly style="font-weight: bold; color: #1e3c72; background-color: #e2e6ea;">
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-muted small">Kalan Tutar</label>
                        <input type="text" class="form-control" value="${fmtMoney(accrual.remainingAmount !== undefined ? accrual.remainingAmount : accrual.totalAmount, accrual.totalAmountCurrency)}" readonly style="font-weight: bold; color: ${accrual.remainingAmount > 0 ? '#dc3545' : '#28a745'}; background-color: #fff3f3;">
                    </div>
                </div>

                <div class="section-header mt-4 mb-3 pb-2 border-bottom"><i class="fas fa-file-invoice mr-2 text-info"></i>FATURA BİLGİLERİ</div>
                <div class="row">
                    <div class="col-md-6 mb-3">
                        <label class="form-label text-muted small">Türk Patent Faturası Kime?</label>
                        <div class="p-2 border rounded bg-light small"><i class="fas fa-user-tie mr-2 text-muted"></i>${accrual.tpInvoiceParty?.name || '-'}</div>
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label text-muted small">Hizmet Faturası Kime?</label>
                        <div class="p-2 border rounded bg-light small"><i class="fas fa-building mr-2 text-muted"></i>${accrual.serviceInvoiceParty?.name || '-'}</div>
                    </div>
                </div>

                <div class="section-header mt-4 mb-3 pb-2 border-bottom"><i class="fas fa-folder-open mr-2 text-primary"></i>BELGELER</div>
                <div class="row">
                    ${epatsHtml}
                    ${foreignInvHtml}
                    ${receiptHtml}
                </div>
            `;

            modal.classList.add('show');
        }

        // 2. Edit Modal (Dosya Yükleme Alanı ile)
        showEditAccrualModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            this.currentEditAccrual = { ...accrual };
            this.editNewForeignInvoices = [];
            document.getElementById('editAccrualId').value = accrual.id;
            document.getElementById('editAccrualTaskTitleDisplay').value = accrual.taskTitle || '';
            
            document.getElementById('editOfficialFee').value = accrual.officialFee?.amount || 0;
            document.getElementById('editOfficialFeeCurrency').value = accrual.officialFee?.currency || 'TRY';
            document.getElementById('editServiceFee').value = accrual.serviceFee?.amount || 0;
            document.getElementById('editServiceFeeCurrency').value = accrual.serviceFee?.currency || 'TRY';
            document.getElementById('editVatRate').value = accrual.vatRate || 20;
            document.getElementById('editApplyVatToOfficialFee').checked = accrual.applyVatToOfficialFee ?? true;

            this.editSelectedTpInvoiceParty = accrual.tpInvoiceParty || null;
            this.editSelectedServiceInvoiceParty = accrual.serviceInvoiceParty || null;
            this.updateEditSelectedPartyDisplay('editSelectedTpInvoicePartyDisplay', this.editSelectedTpInvoiceParty);
            this.updateEditSelectedPartyDisplay('editSelectedServiceInvoicePartyDisplay', this.editSelectedServiceInvoiceParty);

            const fileList = document.getElementById('editForeignInvoiceFileList');
            fileList.innerHTML = '';
            // Mevcut dosyaları listele (Ödeme dekontu hariç)
            if (accrual.files && accrual.files.length > 0) {
                accrual.files.filter(f => f.documentDesignation !== 'Ödeme Dekontu').forEach(f => {
                    fileList.innerHTML += `<div class="file-item-modal"><i class="fas fa-check text-success mr-2"></i> ${f.name} <small class="text-muted ml-2">(Mevcut)</small></div>`;
                });
            }

            this.calculateEditTotalAmount();
            document.getElementById('editAccrualModal').classList.add('show');
        }

        // 3. Mark Paid Modal
        showMarkPaidModal() {
            if (this.selectedAccruals.size === 0) { showNotification('Seçim yapınız', 'error'); return; }
            
            document.getElementById('paidAccrualCount').textContent = this.selectedAccruals.size;
            
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
        
        handleEditFileUpload(files) {
            Array.from(files).forEach(file => {
                readFileAsDataURL(file).then(url => {
                    const newFile = {
                        id: generateUUID(), name: file.name, size: file.size, type: file.type, content: url, 
                        documentDesignation: 'Yurtdışı Fatura/Debit' 
                    };
                    this.editNewForeignInvoices.push(newFile);
                    
                    const list = document.getElementById('editForeignInvoiceFileList');
                    const div = document.createElement('div');
                    div.className = 'file-item-modal';
                    div.innerHTML = `<span><i class="fas fa-plus text-primary mr-2"></i>${file.name}</span> <button type="button" class="remove-file-modal">&times;</button>`;
                    div.querySelector('button').onclick = () => {
                        this.editNewForeignInvoices = this.editNewForeignInvoices.filter(f => f.id !== newFile.id);
                        div.remove();
                    };
                    list.appendChild(div);
                });
            });
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

                // Dosyaları Birleştir
                let existingFiles = this.currentEditAccrual.files || [];
                let finalFiles = [...existingFiles, ...this.editNewForeignInvoices];

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
                    files: finalFiles
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
        async handleBulkUpdate(newStatus) {
            if (this.selectedAccruals.size === 0) return;
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Güncelleniyor...') : null;
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

            const editArea = document.getElementById('editForeignInvoiceUploadArea');
            if(editArea) {
                editArea.addEventListener('click', () => document.getElementById('editForeignInvoiceFile').click());
                document.getElementById('editForeignInvoiceFile').addEventListener('change', e => this.handleEditFileUpload(e.target.files));
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
            list.innerHTML = this.uploadedPaymentReceipts.map(f => `<div class="file-item-modal"><span>${f.name}</span><button class="remove-file-modal" onclick="this.parentElement.remove()">x</button></div>`).join('');
        }
        closeModal(id) {
            document.getElementById(id).classList.remove('show');
            if(id === 'editAccrualModal') {
                this.currentEditAccrual = null;
                document.getElementById('editAccrualForm').reset();
                if(document.getElementById('editForeignInvoiceFileList')) document.getElementById('editForeignInvoiceFileList').innerHTML = '';
            }
            if(id === 'markPaidModal') {
                this.uploadedPaymentReceipts = [];
                document.getElementById('paymentReceiptFileList').innerHTML = '';
            }
        }
        searchPersons(query, target) {
            const container = document.getElementById(target === 'editTpInvoiceParty' ? 'editTpInvoicePartyResults' : 'editServiceInvoicePartyResults');
            container.innerHTML = '';
            if(query.length < 2) { container.style.display = 'none'; return; }
            const filtered = this.allPersons.filter(p => (p.name || '').toLowerCase().includes(query.toLowerCase()));
            if(filtered.length === 0) container.innerHTML = '<div class="search-result-item">Sonuç yok</div>';
            else filtered.forEach(p => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.textContent = p.name;
                div.onclick = () => this.selectPerson(p, target);
                container.appendChild(div);
            });
            container.style.display = 'block';
        }
        selectPerson(person, target) {
            const displayId = target === 'editTpInvoiceParty' ? 'editSelectedTpInvoicePartyDisplay' : 'editSelectedServiceInvoicePartyDisplay';
            const inputId = target === 'editTpInvoiceParty' ? 'editTpInvoicePartySearch' : 'editServiceInvoicePartySearch';
            const resultsId = target === 'editTpInvoiceParty' ? 'editTpInvoicePartyResults' : 'editServiceInvoicePartyResults';
            if(target === 'editTpInvoiceParty') this.editSelectedTpInvoiceParty = person; else this.editSelectedServiceInvoiceParty = person;
            this.updateEditSelectedPartyDisplay(displayId, person);
            document.getElementById(inputId).value = '';
            document.getElementById(resultsId).style.display = 'none';
        }
        updateEditSelectedPartyDisplay(elId, party) {
            const el = document.getElementById(elId);
            el.innerHTML = party ? `<b>Seçilen:</b> ${party.name} <span style="cursor:pointer;color:red" onclick="this.parentElement.style.display='none'">[X]</span>` : '';
            el.style.display = party ? 'block' : 'none';
            if(party) el.querySelector('span').onclick = () => {
                el.style.display = 'none';
                if(elId.includes('Tp')) this.editSelectedTpInvoiceParty = null; else this.editSelectedServiceInvoiceParty = null;
            };
        }
        showTaskDetailModal(taskId) {
            // Task verisi allTasks içinde olmayabilir (eğer sadece ID'si varsa ama detay yüklenmediyse)
            // Bu yüzden önce allTasks kontrol edilir, yoksa fetch edilebilir.
            // Bu örnekte basitleştirilmiştir.
            let task = this.allTasks[String(taskId)];
            
            // Eğer task yoksa veya basit bir nesne ise ve detayları eksikse (örn: sadece ID'si var)
            if(!task) { 
                showNotification('İş bulunamadı veya yüklenemedi', 'error'); 
                return; 
            }

            document.getElementById('modalTaskTitle').textContent = `İş Detayı: ${task.title}`;
            document.getElementById('modalBody').innerHTML = `<p><b>Durum:</b> ${task.status}</p><p><b>Açıklama:</b> ${task.description || '-'}</p>`;
            document.getElementById('taskDetailModal').classList.add('show');
        }
    }

    new AccrualsManager().init();
});