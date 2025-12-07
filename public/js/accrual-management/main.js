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
            
            // Modalı aç ve yükleniyor göster
            modal.classList.add('show');
            title.textContent = 'İş Detayı Yükleniyor...';
            body.innerHTML = '<div class="text-center p-4"><i class="fas fa-circle-notch fa-spin fa-2x text-primary"></i><br><br>Veriler getiriliyor...</div>';

            try {
                // 1. İş verisini veritabanından taze çek
                const taskRef = doc(db, 'tasks', String(taskId));
                const taskSnap = await getDoc(taskRef);

                if (!taskSnap.exists()) {
                    body.innerHTML = '<div class="alert alert-danger">Bu iş kaydı bulunamadı.</div>';
                    title.textContent = 'Hata';
                    return;
                }

                const task = { id: taskSnap.id, ...taskSnap.data() };
                title.textContent = `İş Detayı (${task.id})`;

                // 2. Yardımcılar ve Haritalamalar (Task Management dosyasından alındı)
                const statusDisplayMap = {
                    'open': 'Açık', 'in-progress': 'Devam Ediyor', 'completed': 'Tamamlandı',
                    'pending': 'Beklemede', 'cancelled': 'İptal Edildi', 'on-hold': 'Askıda',
                    'awaiting-approval': 'Onay Bekliyor', 'awaiting_client_approval': 'Müvekkil Onayı Bekliyor',
                    'client_approval_opened': 'Müvekkil Onayı - Açıldı', 'client_approval_closed': 'Müvekkil Onayı - Kapatıldı',
                    'client_no_response_closed': 'Müvekkil Cevaplamadı - Kapatıldı'
                };

                const formatDate = (dateVal) => {
                    if (!dateVal) return 'Belirtilmemiş';
                    try {
                        // Timestamp kontrolü
                        const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
                        return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('tr-TR');
                    } catch(e) { return '-'; }
                };

                const formatCurrency = (amount, currency) => {
                    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency || 'TRY' }).format(amount || 0);
                };

                // 3. Verileri Hazırla
                const statusText = statusDisplayMap[task.status] || task.status;
                const assignedName = task.assignedTo_email || task.assignedTo_uid || 'Atanmamış'; // User listesi burada yoksa email göster
                
                // İlgili kayıt ismini bulmaya çalış (IP record listesi tam yüklü olmayabilir, varsa kullan yoksa ID göster)
                // Not: Task Management'ta ipRecordsService kullanılıyor, burada basitçe ID veya varsa başlık gösteriyoruz.
                const relatedRecordTxt = task.relatedIpRecordId ? (task.relatedIpRecordId) : 'İlgili kayıt bulunamadı';

                // İş Tipi (Cache'den veya ID'den)
                let taskTypeDisplay = task.taskType || '-';
                // Eğer elinizde transactionTypes varsa eşleştirebilirsiniz, yoksa ham veriyi gösterelim (görünümü bozmaz)

                // 4. Bağlı Tahakkuklar (Bu sayfada zaten accruals listemiz var)
                const relatedAccruals = this.allAccruals.filter(acc => String(acc.taskId) === String(task.id));
                let accrualsHtml = '';
                
                if (relatedAccruals.length > 0) {
                    let rows = '';
                    relatedAccruals.forEach(acc => {
                        const accStatusBadge = acc.status === 'paid' ? '<span class="badge badge-success">Ödendi</span>' : '<span class="badge badge-warning">Ödenmedi</span>';
                        rows += `<tr>
                                    <td>#${acc.id || '-'}</td>
                                    <td class="font-weight-bold text-dark">${formatCurrency(acc.totalAmount, acc.totalAmountCurrency)}</td>
                                    <td>${accStatusBadge}</td>
                                    <td><small class="text-muted">${formatDate(acc.createdAt)}</small></td>
                                 </tr>`;
                    });
                    accrualsHtml = `<div class="table-responsive mt-1">
                                        <table class="table table-sm table-bordered mb-0 bg-white" style="font-size: 0.9rem;">
                                            <thead class="thead-light"><tr><th>No</th><th>Tutar</th><th>Durum</th><th>Tarih</th></tr></thead>
                                            <tbody>${rows}</tbody>
                                        </table>
                                    </div>`;
                } else {
                    accrualsHtml = `<div class="p-2 border rounded bg-light text-muted font-italic small">Bu işe bağlı tahakkuk kaydı bulunmamaktadır.</div>`;
                }

                // 5. Belgeler (EPATS ve Diğerleri)
                let epatsDocHtml = '';
                let otherDocsHtml = '';

                // EPATS Belgesi
                if (task.details && task.details.epatsDocument && (task.details.epatsDocument.url || task.details.epatsDocument.downloadURL)) {
                    const doc = task.details.epatsDocument;
                    const url = doc.url || doc.downloadURL;
                    epatsDocHtml = `
                    <div class="alert alert-primary d-flex align-items-center justify-content-between p-2 mb-2" style="border-left: 4px solid #007bff;">
                        <div class="d-flex align-items-center">
                            <i class="fas fa-file-pdf text-danger fa-lg mr-2"></i>
                            <div>
                                <strong class="d-block" style="font-size:0.9rem;">EPATS Belgesi</strong>
                                <small class="text-muted">${doc.name || 'Belge'}</small>
                            </div>
                        </div>
                        <a href="${url}" target="_blank" class="btn btn-sm btn-outline-primary bg-white">Aç</a>
                    </div>`;
                }

                // Diğer Dosyalar
                const files = task.files || (task.details ? task.details.files : []) || [];
                if (files.length > 0) {
                    otherDocsHtml = '<ul class="list-group list-group-flush border rounded">';
                    files.forEach(file => {
                        const epatsUrl = (task.details && task.details.epatsDocument) ? (task.details.epatsDocument.url || task.details.epatsDocument.downloadURL) : null;
                        // EPATS dosyasını tekrar listede gösterme
                        if (epatsUrl && (file.url === epatsUrl || file.content === epatsUrl)) return;
                        
                        const fileUrl = file.url || file.content;
                        otherDocsHtml += `
                        <li class="list-group-item d-flex justify-content-between align-items-center p-2">
                            <div class="d-flex align-items-center text-truncate">
                                <i class="fas fa-paperclip text-secondary mr-2"></i>
                                <span class="small text-dark" title="${file.name}">${file.name}</span>
                            </div>
                            <a href="${fileUrl}" target="_blank" class="btn btn-xs btn-light border">
                                <i class="fas fa-download"></i>
                            </a>
                        </li>`;
                    });
                    otherDocsHtml += '</ul>';
                }
                
                if (!epatsDocHtml && (!otherDocsHtml || otherDocsHtml === '<ul class="list-group list-group-flush border rounded"></ul>')) {
                    otherDocsHtml = `<div class="p-2 border rounded bg-light text-muted font-italic small">Ekli belge bulunmamaktadır.</div>`;
                }

                // 6. HTML Yapısı (Task Management ile Birebir Aynı)
                let html = `
                    <div class="container-fluid p-0">
                        <div class="form-group mb-3">
                            <label class="text-muted font-weight-bold small text-uppercase" style="letter-spacing:0.5px;">İş Konusu</label>
                            <div class="p-2 bg-light border rounded text-dark">${task.title || '-'}</div>
                        </div>
                        
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <label class="text-muted font-weight-bold small text-uppercase">İlgili Dosya</label>
                                <div class="p-2 border rounded">${relatedRecordTxt}</div>
                            </div>
                            <div class="col-md-6 mb-3">
                                <label class="text-muted font-weight-bold small text-uppercase">İş Tipi</label>
                                <div class="p-2 border rounded">${taskTypeDisplay}</div>
                            </div>
                        </div>
                        
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <label class="text-muted font-weight-bold small text-uppercase">Atanan Kişi</label>
                                <div class="p-2 border rounded">${assignedName}</div>
                            </div>
                            <div class="col-md-6 mb-3">
                                <label class="text-muted font-weight-bold small text-uppercase">Güncel Durum</label>
                                <div class="p-2 border rounded bg-white">
                                    <span class="font-weight-bold text-primary">${statusText}</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <label class="text-muted font-weight-bold small text-uppercase">Operasyonel Son Tarih</label>
                                <div class="p-2 border rounded bg-light">
                                    <i class="far fa-calendar-alt text-secondary mr-2"></i>${formatDate(task.dueDate)}
                                </div>
                            </div>
                            <div class="col-md-6 mb-3">
                                <label class="text-muted font-weight-bold small text-uppercase">Resmi Son Tarih</label>
                                <div class="p-2 border rounded bg-light">
                                    <i class="fas fa-calendar-check text-danger mr-2"></i>${formatDate(task.officialDueDate)}
                                </div>
                            </div>
                        </div>
                        
                        <hr>
                        
                        <div class="form-group mb-3">
                            <label class="text-muted font-weight-bold small text-uppercase"><i class="fas fa-folder-open mr-1"></i> Belgeler</label>
                            <div class="p-1">
                                ${epatsDocHtml}
                                ${otherDocsHtml}
                            </div>
                        </div>
                        
                        <div class="form-group mb-3">
                            <label class="text-muted font-weight-bold small text-uppercase"><i class="fas fa-coins mr-1"></i> Bağlı Tahakkuklar</label>
                            ${accrualsHtml}
                        </div>
                        
                        <div class="form-group mt-2">
                            <label class="text-muted font-weight-bold small text-uppercase">Açıklama & Notlar</label>
                            <div class="p-3 border rounded bg-light text-break" style="min-height: 80px; white-space: pre-wrap;">${task.description || '<span class="text-muted font-italic">Açıklama girilmemiş.</span>'}</div>
                        </div>
                    </div>`;

                body.innerHTML = html;

            } catch (error) {
                console.error(error);
                body.innerHTML = '<div class="alert alert-danger">Veri yüklenirken hata oluştu: ' + error.message + '</div>';
            }
        }

    }

    new AccrualsManager().init();
});