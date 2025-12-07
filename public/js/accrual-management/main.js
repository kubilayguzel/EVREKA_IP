import { authService, accrualService, taskService, personService, generateUUID, db } from '../../firebase-config.js';
import { showNotification, readFileAsDataURL } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import PaginationManager from '../pagination.js'; 

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'accruals.html' });

    class AccrualsManager {
        constructor() {
            this.currentUser = null;
            this.allAccruals = [];
            this.processedData = []; // İşlenmiş (filtrelenmiş/sıralanmış) veriyi burada tutacağız
            this.allTasks = {}; 
            this.allPersons = [];
            this.selectedAccruals = new Set();
            
            // --- Pagination & Sorting State ---
            this.paginationManager = null;
            this.itemsPerPage = 10;
            this.currentSort = { column: 'createdAt', direction: 'desc' }; 
            this.currentFilterStatus = 'all';

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

            // HATA ÇÖZÜMÜ 1: PaginationManager Obje olarak başlatılıyor
            this.paginationManager = new PaginationManager({
                containerId: 'paginationControls', // HTML'deki ID ile eşleşmeli
                itemsPerPage: this.itemsPerPage,
                // Sayfa değiştiğinde bu fonksiyon çalışır
                onPageChange: (page, itemsPerPage) => {
                    this.renderCurrentPage();
                }
            });

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
                const accRes = await accrualService.getAccruals();
                this.allAccruals = accRes?.success ? (accRes.data || []) : [];

                if (this.allAccruals.length > 0) {
                    this.allAccruals.forEach(a => {
                        a.createdAt = a.createdAt ? new Date(a.createdAt) : new Date(0);
                    });

                    const taskIds = new Set();
                    this.allAccruals.forEach(a => {
                        if (a.taskId) taskIds.add(String(a.taskId));
                    });

                    if (taskIds.size && taskService.getTasksByIds) {
                        const tRes = await taskService.getTasksByIds(Array.from(taskIds));
                        const tasks = tRes?.success ? (tRes.data || []) : [];
                        this.allTasks = {};
                        tasks.forEach(t => {
                            this.allTasks[String(t.id)] = t;
                        });
                    }

                    const pRes = await personService.getPersons();
                    this.allPersons = pRes?.success ? (pRes.data || []) : [];
                }

                this.processAndRender();

            } catch (err) {
                console.error(err);
                showNotification('Veri yükleme hatası', 'error');
            } finally {
                if(loadingIndicator) loadingIndicator.style.display = 'none';
                if(simpleLoader) simpleLoader.hide();
            }
        }

        // --- CORE LOGIC: FILTER & SORT & PAGINATE ---
        
        processAndRender() {
            // 1. Filtreleme
            let data = [...this.allAccruals];
            if (this.currentFilterStatus !== 'all') {
                data = data.filter(a => a.status === this.currentFilterStatus);
            }

            // 2. Sıralama
            data = this.sortData(data);

            // 3. İşlenmiş veriyi sınıfa kaydet (Pagination dilimleme yaparken bunu kullanacak)
            this.processedData = data;

            // 4. Boş Durum Kontrolü
            const noMsg = document.getElementById('noRecordsMessage');
            if (this.processedData.length === 0) {
                document.getElementById('accrualsTableBody').innerHTML = '';
                document.getElementById('paginationControls').style.display = 'none';
                if(noMsg) noMsg.style.display = 'block';
                return;
            }
            if(noMsg) noMsg.style.display = 'none';
            document.getElementById('paginationControls').style.display = 'flex';

            // 5. Pagination Güncelleme (HATA ÇÖZÜMÜ 2: setItems yerine update kullanıyoruz)
            // Pagination sınıfına sadece toplam sayıyı bildiriyoruz.
            this.paginationManager.update(this.processedData.length);
            
            // İlk sayfayı veya mevcut sayfayı render et
            this.renderCurrentPage();
        }

        // Yeni Yardımcı Metod: Sayfayı kesip render eder
        renderCurrentPage() {
            if (!this.processedData || this.processedData.length === 0) return;
            
            // pagination.js içindeki getCurrentPageData metodu mevcut veriyi kesip bize verir
            const pageData = this.paginationManager.getCurrentPageData(this.processedData);
            this.renderPageRows(pageData);
        }

        sortData(data) {
            const { column, direction } = this.currentSort;
            const dirMultiplier = direction === 'asc' ? 1 : -1;

            return data.sort((a, b) => {
                let valA, valB;

                switch (column) {
                    case 'id':
                        valA = (a.id || '').toLowerCase(); valB = (b.id || '').toLowerCase(); break;
                    case 'status':
                        valA = (a.status || '').toLowerCase(); valB = (b.status || '').toLowerCase(); break;
                    case 'taskTitle':
                        const taskA = this.allTasks[String(a.taskId)];
                        const taskB = this.allTasks[String(b.taskId)];
                        valA = (taskA ? taskA.title : (a.taskTitle || '')).toLowerCase();
                        valB = (taskB ? taskB.title : (b.taskTitle || '')).toLowerCase();
                        break;
                    case 'officialFee':
                        valA = a.officialFee?.amount || 0; valB = b.officialFee?.amount || 0; break;
                    case 'serviceFee':
                        valA = a.serviceFee?.amount || 0; valB = b.serviceFee?.amount || 0; break;
                    case 'totalAmount':
                        valA = a.totalAmount || 0; valB = b.totalAmount || 0; break;
                    case 'remainingAmount':
                        valA = a.remainingAmount !== undefined ? a.remainingAmount : a.totalAmount;
                        valB = b.remainingAmount !== undefined ? b.remainingAmount : b.totalAmount;
                        break;
                    case 'createdAt':
                        valA = a.createdAt; valB = b.createdAt; break;
                    default:
                        valA = 0; valB = 0;
                }

                if (valA < valB) return -1 * dirMultiplier;
                if (valA > valB) return 1 * dirMultiplier;
                return 0;
            });
        }

        // --- UI LAYER: ROW RENDER ---
        renderPageRows(pageData) {
            const tbody = document.getElementById('accrualsTableBody');
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
            
            this.updateBulkActionsVisibility();
        }

        // --- UI LAYER: MODALS ---
        
        async showViewAccrualDetailModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            const modal = document.getElementById('viewAccrualDetailModal');
            const title = document.getElementById('viewAccrualTitle');
            const body = modal.querySelector('.modal-body-content');

            title.textContent = `Tahakkuk Detayı (#${accrual.id})`;
            
            const fmtMoney = (v, c) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: c || 'TRY' }).format(v || 0);
            const fmtDate = (d) => { try { return d ? new Date(d).toLocaleDateString('tr-TR') : '-'; } catch{return '-'} };
            
            let statusText = 'Bilinmiyor';
            let statusColor = '#6c757d';
            if(accrual.status === 'paid') { statusText = 'Ödendi'; statusColor = '#28a745'; }
            if(accrual.status === 'unpaid') { statusText = 'Ödenmedi'; statusColor = '#dc3545'; }
            if(accrual.status === 'partially_paid') { statusText = 'Kısmen Ödendi'; statusColor = '#ffc107'; }

            let task = null;
            if (accrual.taskId) {
                try {
                    const taskRef = doc(db, 'tasks', String(accrual.taskId));
                    const taskDoc = await getDoc(taskRef);
                    if (taskDoc.exists()) {
                        task = { id: taskDoc.id, ...taskDoc.data() };
                    }
                } catch (error) {
                    console.error('Task çekilirken hata:', error);
                }
            }
            
            let epatsHtml = '';
            let foreignInvHtml = '';
            let receiptHtml = '';

            let epatsData = null;
            if (task && task.details && task.details.epatsDocument) {
                epatsData = task.details.epatsDocument;
            }

            if (epatsData && (epatsData.downloadURL || epatsData.url)) {
                const docUrl = epatsData.downloadURL || epatsData.url;
                const docName = epatsData.name || 'EPATS Belgesi';
                
                epatsHtml = `
                <div class="col-md-6 mb-3">
                    <div class="doc-card doc-type-epats">
                        <div class="doc-icon-box"><i class="fas fa-file-contract"></i></div>
                        <div class="doc-content">
                            <span class="doc-title">İŞİN EPATS DOKÜMANI</span>
                            <span class="doc-filename" title="${docName}">${docName}</span>
                        </div>
                        <div class="doc-action">
                            <a href="${docUrl}" target="_blank" class="btn btn-sm btn-outline-primary"><i class="fas fa-eye"></i></a>
                        </div>
                    </div>
                </div>`;
            } else {
                epatsHtml = '<div class="col-12 text-muted small font-italic mb-2 pl-3">Bu işe bağlı görüntülenecek EPATS belgesi bulunamadı.</div>';
            }

            if(accrual.files && accrual.files.length > 0) {
                accrual.files.forEach(f => {
                    const url = f.content || f.url;
                    let label = f.documentDesignation || 'BELGE';
                    
                    const getCard = (typeClass, icon, title) => `
                    <div class="col-md-6 mb-3">
                        <div class="doc-card ${typeClass}">
                            <div class="doc-icon-box"><i class="fas ${icon}"></i></div>
                            <div class="doc-content">
                                <span class="doc-title">${title}</span>
                                <span class="doc-filename" title="${f.name}">${f.name}</span>
                            </div>
                            <div class="doc-action">
                                <a href="${url}" target="_blank" class="btn btn-sm btn-outline-secondary"><i class="fas fa-download"></i></a>
                            </div>
                        </div>
                    </div>`;

                    if(label.includes('Fatura') || label.includes('Invoice') || label.includes('Debit')) {
                        foreignInvHtml += getCard('doc-type-invoice', 'fa-file-invoice-dollar', 'YURTDIŞI FATURA/DEBIT');
                    } else if(label.includes('Dekont') || label.includes('Receipt')) {
                        receiptHtml += getCard('doc-type-receipt', 'fa-receipt', 'ÖDEME DEKONTU');
                    } else {
                        foreignInvHtml += getCard('doc-type-generic', 'fa-file-alt', label.toUpperCase());
                    }
                });
            }
            
            if(!foreignInvHtml) foreignInvHtml = '<div class="col-12 text-muted small font-italic mb-2 pl-3">Fatura/Debit yok.</div>';
            if(!receiptHtml) receiptHtml = '<div class="col-12 text-muted small font-italic mb-2 pl-3">Ödeme dekontu yok.</div>';

            body.innerHTML = `
                <div class="form-group">
                    <label class="form-label">İlgili İş</label>
                    <input type="text" class="form-input" value="${accrual.taskTitle || (task ? task.title : '-')} (${accrual.taskId || ''})" readonly style="background-color: #f8f9fa; font-weight: 500;">
                </div>

                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Tahakkuk Durumu</label>
                        <input type="text" class="form-input" value="${statusText}" readonly style="color: ${statusColor}; font-weight: bold;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Oluşturulma Tarihi</label>
                        <input type="text" class="form-input" value="${fmtDate(accrual.createdAt)}" readonly>
                    </div>
                </div>

                <div class="section-header mt-4"><i class="fas fa-coins mr-2"></i>FİNANSAL DETAYLAR</div>
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
                        <input type="text" class="form-input" value="${fmtMoney(accrual.totalAmount, accrual.totalAmountCurrency)}" readonly style="font-weight: bold; color: #1e3c72;">
                    </div>
                </div>
                
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Kalan Tutar</label>
                        <input type="text" class="form-input" value="${fmtMoney(accrual.remainingAmount !== undefined ? accrual.remainingAmount : accrual.totalAmount, accrual.totalAmountCurrency)}" readonly style="color: ${accrual.remainingAmount > 0 ? '#dc3545' : '#28a745'}; font-weight: bold;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Ödeme Tarihi</label>
                        <input type="text" class="form-input" value="${accrual.paymentDate ? fmtDate(accrual.paymentDate) : 'Ödeme Bekleniyor'}" readonly>
                    </div>
                </div>

                <div class="section-header mt-4"><i class="fas fa-file-invoice mr-2"></i>FATURA BİLGİLERİ</div>
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

                <div class="section-header mt-4"><i class="fas fa-folder-open mr-2"></i>BELGELER</div>
                <div class="row">
                    ${epatsHtml}
                    ${foreignInvHtml}
                    ${receiptHtml}
                </div>
            `;

            modal.classList.add('show');
        }

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
            if (accrual.files && accrual.files.length > 0) {
                accrual.files.filter(f => f.documentDesignation !== 'Ödeme Dekontu').forEach(f => {
                    fileList.innerHTML += `<div class="file-item-modal"><i class="fas fa-check text-success mr-2"></i> ${f.name} <small class="text-muted ml-2">(Mevcut)</small></div>`;
                });
            }

            this.calculateEditTotalAmount();
            document.getElementById('editAccrualModal').classList.add('show');
        }

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

        // --- EVENTS & HELPERS ---
        setupEventListeners() {
            document.getElementById('statusFilter').addEventListener('change', e => {
                this.currentFilterStatus = e.target.value;
                this.processAndRender();
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
                    
                    document.querySelectorAll('.sort-icon').forEach(icon => icon.className = 'fas fa-sort sort-icon text-muted');
                    const currentIcon = th.querySelector('.sort-icon');
                    if(currentIcon) currentIcon.className = `fas fa-sort-${this.currentSort.direction === 'asc' ? 'up' : 'down'} sort-icon`;

                    this.processAndRender();
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
        async showTaskDetailModal(taskId) {
            const modal = document.getElementById('taskDetailModal');
            const body = document.getElementById('modalBody');
            const title = document.getElementById('modalTaskTitle');
            
            // 1. Modalı aç ve yükleniyor göster
            modal.classList.add('show');
            title.textContent = 'İş Detayı Yükleniyor...';
            body.innerHTML = '<div style="text-align:center; padding:30px; color:#666;"><i class="fas fa-circle-notch fa-spin fa-2x"></i><br><br>Veriler getiriliyor...</div>';

            try {
                // 2. Veritabanından en güncel veriyi çek (Task Service veya Direct DB)
                const taskRef = doc(db, 'tasks', String(taskId));
                const taskSnap = await getDoc(taskRef);

                if (!taskSnap.exists()) {
                    body.innerHTML = '<div style="padding:20px; text-align:center; color:red;">Bu iş kaydı veritabanında bulunamadı (Silinmiş olabilir).</div>';
                    title.textContent = 'İş Bulunamadı';
                    return;
                }

                const task = taskSnap.data();
                title.textContent = `İş Detayı: ${task.title}`;

                // 3. Yardımcı Formatlayıcılar
                const fmtDate = (d) => d ? new Date(d).toLocaleDateString('tr-TR') : '-';
                
                // Durum Rengi Belirle
                let statusBadge = '';
                const s = (task.status || '').toLowerCase();
                if(s === 'tamamlandı' || s === 'completed') statusBadge = '<span class="status-badge status-paid" style="font-size:1rem; width:100%; display:block; padding:10px;">Tamamlandı</span>';
                else if(s === 'iptal' || s === 'cancelled') statusBadge = '<span class="status-badge status-unpaid" style="font-size:1rem; width:100%; display:block; padding:10px;">İptal</span>';
                else statusBadge = `<span class="status-badge status-partially-paid" style="font-size:1rem; width:100%; display:block; padding:10px;">${task.status || 'Devam Ediyor'}</span>`;

                // 4. HTML İçeriğini Oluştur
                let epatsHtml = '';
                // EPATS Belgesi Varsa Göster
                if (task.details && task.details.epatsDocument && (task.details.epatsDocument.url || task.details.epatsDocument.downloadURL)) {
                    const docUrl = task.details.epatsDocument.downloadURL || task.details.epatsDocument.url;
                    epatsHtml = `
                    <div class="section-header mt-4"><i class="fas fa-file-contract mr-2"></i>EPATS DOKÜMANI</div>
                    <div class="row">
                        <div class="col-md-12">
                            <div class="doc-card doc-type-epats" style="display:flex; align-items:center; border:1px solid #ddd; padding:15px; border-radius:8px;">
                                <div class="doc-icon-box" style="margin-right:15px; font-size:24px; color:#1976d2;"><i class="fas fa-file-pdf"></i></div>
                                <div class="doc-content" style="flex-grow:1;">
                                    <span class="doc-title" style="display:block; font-size:0.8rem; color:#888;">DOSYA ADI</span>
                                    <span class="doc-filename" style="font-weight:bold;">${task.details.epatsDocument.name || 'Epats_Belgesi.pdf'}</span>
                                </div>
                                <div class="doc-action">
                                    <a href="${docUrl}" target="_blank" class="btn btn-primary btn-sm"><i class="fas fa-eye"></i> Görüntüle</a>
                                </div>
                            </div>
                        </div>
                    </div>`;
                }

                // Modal İçeriği
                body.innerHTML = `
                    <div class="form-grid" style="grid-template-columns: 2fr 1fr; gap: 20px;">
                        <div class="form-group">
                            <label class="form-label">İş Başlığı</label>
                            <input type="text" class="form-input" value="${task.title}" readonly style="font-weight:bold;">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Durum</label>
                            ${statusBadge}
                        </div>
                    </div>

                    <div class="form-grid mt-3">
                        <div class="form-group">
                            <label class="form-label">Müvekkil / Marka</label>
                            <input type="text" class="form-input" value="${task.clientName || task.brandName || '-'}" readonly>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Tarihler</label>
                            <div style="display:flex; gap:10px;">
                                <input type="text" class="form-input" value="Oluşturma: ${fmtDate(task.createdAt)}" readonly style="font-size:0.9em;">
                                <input type="text" class="form-input" value="Bitiş: ${fmtDate(task.deadline)}" readonly style="font-size:0.9em;">
                            </div>
                        </div>
                    </div>

                    <div class="form-group mt-3">
                        <label class="form-label">Açıklama</label>
                        <textarea class="form-textarea" rows="4" readonly style="background:#f9f9f9;">${task.description || 'Açıklama girilmemiş.'}</textarea>
                    </div>

                    ${epatsHtml}
                `;

            } catch (error) {
                console.error(error);
                body.innerHTML = '<div style="color:red; text-align:center;">Bir hata oluştu: ' + error.message + '</div>';
            }
        }
    }

    new AccrualsManager().init();
});