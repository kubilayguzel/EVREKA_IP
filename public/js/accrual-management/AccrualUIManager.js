// public/js/accrual-management/AccrualUIManager.js

import { AccrualFormManager } from '../components/AccrualFormManager.js';
import { TaskDetailManager } from '../components/TaskDetailManager.js';
import { showNotification } from '../../utils.js';

export class AccrualUIManager {
    constructor() {
        // DOM Elementleri
        this.tableBody = document.getElementById('accrualsTableBody');
        this.foreignTableBody = document.getElementById('foreignTableBody');
        this.noRecordsMessage = document.getElementById('noRecordsMessage');
        this.bulkActions = document.getElementById('bulkActions');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        
        // Modal Elementleri
        this.editModal = document.getElementById('editAccrualModal');
        this.viewModal = document.getElementById('viewAccrualDetailModal');
        this.paymentModal = document.getElementById('markPaidModal');
        this.taskDetailModal = document.getElementById('taskDetailModal');

        // Alt Bileşenler (Managers)
        this.editFormManager = null;
        this.taskDetailManager = new TaskDetailManager('modalBody');
    }

    /**
     * Tabloyu çizer.
     * @param {Array} data - Görüntülenecek (sayfalanmış) veri listesi
     * @param {Object} lookups - { tasks, transactionTypes, ipRecords, selectedIds } referans verileri
     * @param {String} activeTab - 'main' veya 'foreign'
     */
    renderTable(data, lookups, activeTab = 'main') {
        const { tasks, transactionTypes, ipRecords, selectedIds } = lookups;
        const targetBody = activeTab === 'foreign' ? this.foreignTableBody : this.tableBody;
        
        // Temizle
        if (this.tableBody) this.tableBody.innerHTML = '';
        if (this.foreignTableBody) this.foreignTableBody.innerHTML = '';

        // Boş Kontrolü
        if (!data || data.length === 0) {
            if (this.noRecordsMessage) this.noRecordsMessage.style.display = 'block';
            return;
        }
        if (this.noRecordsMessage) this.noRecordsMessage.style.display = 'none';

        // --- SATIR OLUŞTURMA ---
        const rowsHtml = data.map((acc, index) => {
            // Ortak Hesaplamalar
            const isSelected = selectedIds.has(acc.id);
            const isPaid = acc.status === 'paid';
            
            // Durum Badge
            let sTxt = 'Bilinmiyor', sCls = 'badge-secondary';
            if (acc.status === 'paid') { sTxt = 'Ödendi'; sCls = 'status-paid'; }
            else if (acc.status === 'unpaid') { sTxt = 'Ödenmedi'; sCls = 'status-unpaid'; }
            else if (acc.status === 'partially_paid') { sTxt = 'K.Ödendi'; sCls = 'status-partially-paid'; }

            // --- İLGİLİ İŞ VE DOSYA BULMA MANTIĞI ---
            let taskDisplay = '-';
            let relatedFileDisplay = '-';
            
            const task = tasks[String(acc.taskId)];
            
            if (task) {
                // 1. Alias (İş Tipi) Bulma
                const typeObj = transactionTypes.find(t => t.id === task.taskType);
                if (typeObj && typeObj.alias) taskDisplay = typeObj.alias;
                else if (typeObj && typeObj.name) taskDisplay = typeObj.name;
                else taskDisplay = task.title || '-';

                // 2. Dosya (App Number) Bulma
                if (task.relatedIpRecordId) {
                    const ipRec = ipRecords.find(r => r.id === task.relatedIpRecordId);
                    if (ipRec) relatedFileDisplay = ipRec.applicationNumber || ipRec.title || 'Dosya';
                }
            } else {
                taskDisplay = acc.taskTitle || '-';
            }
            // ----------------------------------------

            // Para Birimi Formatları
            const officialStr = acc.officialFee ? this._formatMoney(acc.officialFee.amount, acc.officialFee.currency) : '-';
            
            // TAB 1: ANA LİSTE
            if (activeTab === 'main') {
                const serviceStr = acc.serviceFee ? this._formatMoney(acc.serviceFee.amount, acc.serviceFee.currency) : '-';
                
                // Kalan Tutar Gösterimi (Eğer tam ödenmişse boş geç)
                let remainingHtml = '-';
                const rem = acc.remainingAmount !== undefined ? acc.remainingAmount : acc.totalAmount;
                const total = acc.totalAmount;
                // Basit kontrol: Kalan array boşsa veya tutarlar <= 0 ise ödenmiştir
                const isFullyPaid = (Array.isArray(rem)) 
                    ? rem.length === 0 || rem.every(r => parseFloat(r.amount) <= 0)
                    : parseFloat(rem) <= 0;

                if (!isFullyPaid) {
                    remainingHtml = `<span>${this._formatMoney(rem, acc.totalAmountCurrency)}</span>`;
                }

                // Taraf Bilgisi
                let partyDisplay = '-';
                if (acc.officialFee?.amount > 0 && acc.tpInvoiceParty) {
                    partyDisplay = acc.tpInvoiceParty.name || 'Türk Patent';
                } else if (acc.serviceFee?.amount > 0 && acc.serviceInvoiceParty) {
                    partyDisplay = acc.serviceInvoiceParty.name || '-';
                }

                return `
                <tr>
                    <td><input type="checkbox" class="row-checkbox" data-id="${acc.id}" ${isSelected ? 'checked' : ''}></td>
                    <td><small>${acc.id}</small></td>
                    <td><span class="status-badge ${sCls}">${sTxt}</span></td>
                    <td><span class="badge badge-light border" style="font-weight:normal; font-size: 0.9em;">${relatedFileDisplay}</span></td>
                    <td><a href="#" class="task-detail-link font-weight-bold" data-task-id="${acc.taskId}">${taskDisplay}</a></td>
                    <td><small>${partyDisplay}</small></td>
                    <td>${officialStr}</td>
                    <td>${serviceStr}</td>
                    <td>${this._formatMoney(acc.totalAmount, acc.totalAmountCurrency)}</td>
                    <td>${remainingHtml}</td>
                    <td>
                        <div style="display: flex; gap: 5px;">
                            <button class="action-btn view-btn" data-id="${acc.id}" title="Görüntüle"><i class="fas fa-eye"></i></button>
                            <button class="action-btn edit-btn" data-id="${acc.id}" title="Düzenle" ${isPaid ? 'disabled' : ''}><i class="fas fa-edit"></i></button>
                            <button class="action-btn delete-btn" data-id="${acc.id}" title="Sil"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>
                </tr>`;
            } 
            
            // TAB 2: YURT DIŞI LİSTESİ
            else {
                let paymentParty = acc.tpInvoiceParty?.name || '<span class="text-muted">Belirtilmemiş</span>';
                
                return `
                <tr>
                    <td>${index + 1}</td>
                    <td><span class="badge badge-${acc.status === 'paid' ? 'success' : (acc.status === 'unpaid' ? 'danger' : 'warning')}">${sTxt}</span></td>
                    <td><a href="#" class="task-detail-link font-weight-bold" data-task-id="${acc.taskId}">${taskDisplay}</a></td>
                    <td style="font-weight:600; color:#495057;">
                        <i class="fas fa-university mr-2 text-muted"></i>${paymentParty}
                    </td>
                    <td style="font-weight:bold; color:#1e3c72; font-size:1.1em;">
                        ${officialStr}
                    </td>
                    <td>
                        <div style="display: flex; gap: 5px;">
                            <button class="action-btn view-btn" data-id="${acc.id}" title="Detay">Görüntüle</button>
                            <button class="action-btn edit-btn" data-id="${acc.id}" title="Düzenle">Düzenle</button>
                        </div>
                    </td>
                </tr>`;
            }
        }).join('');

        if (targetBody) targetBody.innerHTML = rowsHtml;
        this.updateBulkActionsVisibility(selectedIds.size > 0);
    }

    /**
     * Düzenleme Modalını Açar ve Formu Doldurur
     */
    initEditModal(accrual, personList, epatsDocument = null) {
        if (!accrual) return;

        // Form Manager'ı Başlat (Sadece bir kere veya her açılışta resetle)
        if (!this.editFormManager) {
            this.editFormManager = new AccrualFormManager('editAccrualFormContainer', 'edit', personList);
            this.editFormManager.render();
        } else {
            // Person listesi güncellenmiş olabilir
            this.editFormManager.persons = personList;
            this.editFormManager.render(); 
        }

        // Verileri Doldur
        document.getElementById('editAccrualId').value = accrual.id;
        document.getElementById('editAccrualTaskTitleDisplay').value = accrual.taskTitle || '';
        
        this.editFormManager.reset();
        this.editFormManager.setData(accrual);
        
        if (epatsDocument) {
            this.editFormManager.showEpatsDoc(epatsDocument);
        }

        this.editModal.classList.add('show');
    }

    /**
     * Detay Görüntüleme Modalını Açar
     */
    showViewDetailModal(accrual) {
        if (!accrual) return;

        const body = this.viewModal.querySelector('.modal-body-content');
        const title = document.getElementById('viewAccrualTitle');
        if(title) title.textContent = `Tahakkuk Detayı (#${accrual.id})`;

        const dFmt = (d) => { try { return d ? new Date(d).toLocaleDateString('tr-TR') : '-'; } catch{return '-'} };
        
        let statusText = 'Bilinmiyor', statusColor = '#6c757d';
        if(accrual.status === 'paid') { statusText = 'Ödendi'; statusColor = '#28a745'; }
        else if(accrual.status === 'unpaid') { statusText = 'Ödenmedi'; statusColor = '#dc3545'; }
        else if(accrual.status === 'partially_paid') { statusText = 'Kısmen Ödendi'; statusColor = '#ffc107'; }

        // Dosyalar HTML
        let filesHtml = '';
        if (accrual.files && accrual.files.length > 0) {
            filesHtml = accrual.files.map(f => {
                const url = f.content || f.url;
                return `
                <div class="col-md-6 mb-2">
                    <div class="p-2 border rounded d-flex align-items-center bg-white shadow-sm h-100">
                        <i class="fas fa-file-alt text-secondary fa-2x mr-3 ml-1"></i>
                        <div style="flex-grow:1; overflow:hidden;">
                            <div class="text-truncate font-weight-bold small" title="${f.name}">${f.name}</div>
                            <div class="text-muted small" style="font-size:0.75rem;">${f.documentDesignation || 'Belge'}</div>
                        </div>
                        <a href="${url}" target="_blank" class="btn btn-sm btn-light ml-2 border"><i class="fas fa-download"></i></a>
                    </div>
                </div>`;
            }).join('');
        } else {
            filesHtml = '<div class="col-12 text-center text-muted font-italic p-3">Ekli dosya bulunmamaktadır.</div>';
        }

        body.innerHTML = `
            <div class="container-fluid p-0">
                <div class="row mb-3">
                    <div class="col-md-8">
                         <div class="p-2 bg-light border rounded">
                            <label class="small text-muted mb-0 font-weight-bold">İLGİLİ İŞ</label>
                            <div class="text-dark">${accrual.taskTitle || '-'} <small class="text-muted">(${accrual.taskId || ''})</small></div>
                         </div>
                    </div>
                    <div class="col-md-4">
                        <div class="p-2 bg-light border rounded text-center">
                            <label class="small text-muted mb-0 font-weight-bold">DURUM</label>
                            <div class="font-weight-bold" style="color:${statusColor}">${statusText.toUpperCase()}</div>
                        </div>
                    </div>
                </div>

                <h6 class="border-bottom pb-2 mb-3 text-primary"><i class="fas fa-coins mr-2"></i>Finansal Özet</h6>
                <div class="row mb-4">
                    <div class="col-md-6 mb-3">
                        <div class="card h-100 border-0 bg-light">
                            <div class="card-body p-3">
                                <label class="small text-muted mb-1">Toplam Tutar</label>
                                <div class="h5 mb-0 text-primary">${this._formatMoney(accrual.totalAmount, accrual.totalAmountCurrency)}</div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6 mb-3">
                        <div class="card h-100 border-0 bg-light">
                            <div class="card-body p-3 text-right">
                                <label class="small text-muted mb-1">Kalan Tutar</label>
                                <div class="h5 mb-0 text-danger">${this._formatMoney(accrual.remainingAmount, accrual.totalAmountCurrency)}</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="row text-muted small mb-3">
                    <div class="col-6"><strong>Oluşturulma:</strong> ${dFmt(accrual.createdAt)}</div>
                    <div class="col-6 text-right"><strong>Ödeme Tarihi:</strong> ${dFmt(accrual.paymentDate)}</div>
                </div>

                <h6 class="border-bottom pb-2 mb-3 text-primary"><i class="fas fa-folder-open mr-2"></i>Dosyalar & Belgeler</h6>
                <div class="row">${filesHtml}</div>
            </div>
        `;
        this.viewModal.classList.add('show');
    }

    /**
     * Ödeme Girişi Modalını Hazırlar
     */
    showPaymentModal(selectedAccrualsList) {
        document.getElementById('paidAccrualCount').textContent = selectedAccrualsList.length;
        document.getElementById('paymentDate').valueAsDate = new Date();
        document.getElementById('paymentReceiptFileList').innerHTML = ''; // Dosya listesini temizle

        const detailedArea = document.getElementById('detailedPaymentInputs');

        // TEKİL SEÇİM: Detaylı giriş göster
        if (selectedAccrualsList.length === 1) {
            detailedArea.style.display = 'block';
            const acc = selectedAccrualsList[0];

            // Resmi Ücret Bilgisi
            const offAmt = acc.officialFee?.amount || 0;
            const offCurr = acc.officialFee?.currency || 'TRY';
            const offPaid = acc.paidOfficialAmount || 0;
            
            document.getElementById('officialFeeBadge').textContent = `${offAmt} ${offCurr}`;
            document.getElementById('manualOfficialCurrencyLabel').textContent = offCurr;
            // Input'a mevcut ödeneni yaz (Düzeltme)
            document.getElementById('manualOfficialAmount').value = offPaid;

            // Hizmet Bedeli Bilgisi
            const srvAmt = acc.serviceFee?.amount || 0;
            const srvCurr = acc.serviceFee?.currency || 'TRY';
            const srvPaid = acc.paidServiceAmount || 0;

            document.getElementById('serviceFeeBadge').textContent = `${srvAmt} ${srvCurr}`;
            document.getElementById('manualServiceCurrencyLabel').textContent = srvCurr;
            // Input'a mevcut ödeneni yaz
            document.getElementById('manualServiceAmount').value = srvPaid;
            
            // Checkbox eventlerini main.js veya controller yönetecek ama UI buradan tetiklenebilir
            // Varsayılan olarak full ödeme seçili gelsin
            document.getElementById('payFullOfficial').checked = true;
            document.getElementById('officialAmountInputContainer').style.display = 'none';
            document.getElementById('payFullService').checked = true;
            document.getElementById('serviceAmountInputContainer').style.display = 'none';

        } else {
            // ÇOKLU SEÇİM: Detayları gizle
            detailedArea.style.display = 'none';
        }

        this.paymentModal.classList.add('show');
    }

    /**
     * Task Detail Modalını Gösterir (Loading/Content/Error durumları)
     */
    showTaskDetailLoading() {
        this.taskDetailModal.classList.add('show');
        document.getElementById('modalTaskTitle').textContent = 'Yükleniyor...';
        this.taskDetailManager.showLoading();
    }
    
    updateTaskDetailContent(task, extraData) {
        document.getElementById('modalTaskTitle').textContent = `İş Detayı (${task.id})`;
        this.taskDetailManager.render(task, extraData);
    }

    updateTaskDetailError(msg) {
        this.taskDetailManager.showError(msg);
    }

    /**
     * Yardımcılar
     */
    updateBulkActionsVisibility(isVisible) {
        if(this.bulkActions) this.bulkActions.style.display = isVisible ? 'flex' : 'none';
    }

    toggleLoading(show) {
        if(this.loadingIndicator) this.loadingIndicator.style.display = show ? 'block' : 'none';
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('show');
    }

    // Para birimi formatlayıcı (Ondalıksız)
    _formatMoney(val, curr) {
        if (Array.isArray(val)) {
            if (val.length === 0) return '0 ' + (curr || 'TRY');
            return val.map(item => {
                const num = parseFloat(item.amount) || 0;
                return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num)} ${item.currency}`;
            }).join(' + ');
        }
        const num = parseFloat(val) || 0;
        return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num)} ${curr || 'TRY'}`;
    }

    // Edit form verisini toplar
    getEditFormData() {
        return this.editFormManager ? this.editFormManager.getData() : { success: false, error: 'Form yüklenmedi' };
    }
}