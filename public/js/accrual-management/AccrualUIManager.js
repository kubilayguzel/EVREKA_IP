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
    // public/js/accrual-management/AccrualUIManager.js

    renderTable(data, lookups, activeTab = 'main') {
        const { tasks, transactionTypes, ipRecords, selectedIds } = lookups;
        const targetBody = activeTab === 'foreign' ? this.foreignTableBody : this.tableBody;
        
        if (targetBody) targetBody.innerHTML = '';
        if (!data || data.length === 0) {
            if (this.noRecordsMessage) this.noRecordsMessage.style.display = 'block';
            return;
        }
        if (this.noRecordsMessage) this.noRecordsMessage.style.display = 'none';

        const rowsHtml = data.map((acc, index) => {
            const isSelected = selectedIds.has(acc.id);
            let sTxt = 'Bilinmiyor', sCls = 'badge-secondary';
            if (acc.status === 'paid') { sTxt = 'Ödendi'; sCls = 'status-paid'; }
            else if (acc.status === 'unpaid') { sTxt = 'Ödenmedi'; sCls = 'status-unpaid'; }
            else if (acc.status === 'partially_paid') { sTxt = 'K.Ödendi'; sCls = 'status-partially-paid'; }

            // --- Tarih, Alan ve Dosya Bilgileri ---
            const dateStr = acc.createdAt ? new Date(acc.createdAt).toLocaleDateString('tr-TR') : '-';
            
            let taskDisplay = '-', relatedFileDisplay = '-', fieldDisplay = '-';
            const task = tasks[String(acc.taskId)];
            
            if (task) {
                const typeObj = transactionTypes.find(t => t.id === task.taskType);
                taskDisplay = typeObj ? (typeObj.alias || typeObj.name) : (task.title || '-');
                
                if (activeTab === 'main' && task.relatedIpRecordId) {
                    const ipRec = ipRecords.find(r => r.id === task.relatedIpRecordId);
                    if (ipRec) relatedFileDisplay = ipRec.applicationNumber || ipRec.title || 'Dosya';
                }

                if (typeObj && typeObj.ipType) {
                    const ipTypeMap = { 'trademark': 'Marka', 'patent': 'Patent', 'design': 'Tasarım', 'suit': 'Dava' };
                    fieldDisplay = ipTypeMap[typeObj.ipType] || typeObj.ipType.toUpperCase();
                }
            } else { taskDisplay = acc.taskTitle || '-'; }

            const tfn = acc.tpeInvoiceNo || '-';
            const efn = acc.evrekaInvoiceNo || '-';
            const officialStr = acc.officialFee ? this._formatMoney(acc.officialFee.amount, acc.officialFee.currency) : '-';

            // --- MENÜ (DROPDOWN) MANTIĞI ---
            // Düzenle butonu 'paid' ise pasif olsun
            const isEditDisabled = acc.status === 'paid';
            const editItemClass = isEditDisabled ? 'dropdown-item disabled text-muted' : 'dropdown-item edit-btn';
            const editItemStyle = isEditDisabled ? 'cursor: not-allowed;' : 'cursor: pointer;';
            const editTitle = isEditDisabled ? 'Ödenmiş kayıt düzenlenemez' : 'Düzenle';

            const actionMenuHtml = `
                <div class="dropdown">
                    <button class="btn btn-sm btn-light text-secondary rounded-circle" type="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="dropdown-menu dropdown-menu-right shadow-sm border-0">
                        <a class="dropdown-item view-btn font-weight-bold" href="#" data-id="${acc.id}">
                            <i class="fas fa-eye mr-2 text-primary" style="width:20px;"></i> Görüntüle
                        </a>
                        <a class="${editItemClass}" href="#" data-id="${acc.id}" style="${editItemStyle}" title="${editTitle}">
                            <i class="fas fa-edit mr-2 text-warning" style="width:20px;"></i> Düzenle
                        </a>
                        <div class="dropdown-divider"></div>
                        <a class="dropdown-item delete-btn text-danger" href="#" data-id="${acc.id}">
                            <i class="fas fa-trash-alt mr-2" style="width:20px;"></i> Sil
                        </a>
                    </div>
                </div>
            `;

            // =========================================================
            // TAB 1: ANA LİSTE
            // =========================================================
            if (activeTab === 'main') {
                const serviceStr = acc.serviceFee ? this._formatMoney(acc.serviceFee.amount, acc.serviceFee.currency) : '-';
                
                let remainingHtml = '-';
                const rem = acc.remainingAmount !== undefined ? acc.remainingAmount : acc.totalAmount;
                const isFullyPaid = (Array.isArray(rem)) 
                    ? rem.length === 0 || rem.every(r => parseFloat(r.amount) <= 0.01)
                    : parseFloat(rem) <= 0.01;

                if (!isFullyPaid) {
                    remainingHtml = `<span>${this._formatMoney(rem, acc.totalAmountCurrency)}</span>`;
                }

                let partyDisplay = '-';
                if (acc.officialFee?.amount > 0 && acc.tpInvoiceParty) partyDisplay = acc.tpInvoiceParty.name || 'Türk Patent';
                else if (acc.serviceFee?.amount > 0 && acc.serviceInvoiceParty) partyDisplay = acc.serviceInvoiceParty.name || '-';

                return `
                <tr>
                    <td><input type="checkbox" class="row-checkbox" data-id="${acc.id}" ${isSelected ? 'checked' : ''}></td>
                    <td><small>${acc.id}</small></td>
                    <td><small>${dateStr}</small></td>
                    <td><span class="badge badge-info" style="font-weight:normal;">${fieldDisplay}</span></td>
                    <td><span class="status-badge ${sCls}">${sTxt}</span></td>
                    <td><span class="badge badge-light border" style="font-weight:normal; font-size: 0.9em;">${relatedFileDisplay}</span></td>
                    <td><a href="#" class="task-detail-link font-weight-bold" data-task-id="${acc.taskId}">${taskDisplay}</a></td>
                    <td><small>${partyDisplay}</small></td>
                    <td><small class="text-muted font-weight-bold">${tfn}</small></td>
                    <td><small class="text-muted font-weight-bold">${efn}</small></td>
                    <td>${officialStr}</td>
                    <td>${serviceStr}</td>
                    <td>${this._formatMoney(acc.totalAmount, acc.totalAmountCurrency)}</td>
                    <td>${remainingHtml}</td>
                    <td class="text-center">
                        ${actionMenuHtml}
                    </td>
                </tr>`;
            } 
            
            // TAB 2: YURT DIŞI LİSTESİ
            else {
                let paymentParty = acc.serviceInvoiceParty?.name || '<span class="text-muted">Belirtilmemiş</span>';
                const fStatus = acc.foreignStatus || 'unpaid';
                let sTxt = 'Ödenmedi', sCls = 'danger';
                if (fStatus === 'paid') { sTxt = 'Ödendi'; sCls = 'success'; }
                else if (fStatus === 'partially_paid') { sTxt = 'Kısmen'; sCls = 'warning'; }
                
                let remainingHtml = '-';
                let foreignRem = acc.foreignRemainingAmount;
                if (foreignRem === undefined) {
                    if (fStatus !== 'paid') foreignRem = [{ amount: acc.officialFee?.amount || 0, currency: acc.officialFee?.currency || 'EUR' }];
                    else foreignRem = []; 
                }
                const isFullyPaid = (Array.isArray(foreignRem)) 
                    ? foreignRem.length === 0 || foreignRem.every(r => parseFloat(r.amount) <= 0.01)
                    : parseFloat(foreignRem) <= 0.01;

                if (!isFullyPaid) {
                    remainingHtml = `<span class="text-danger font-weight-bold">${this._formatMoney(foreignRem, acc.officialFee?.currency || 'EUR')}</span>`;
                } else {
                    remainingHtml = `<span class="text-success"><i class="fas fa-check-circle"></i> Tamamlandı</span>`;
                }

                let documentHtml = '';
                if (acc.files && acc.files.length > 0) {
                    const lastFile = acc.files[acc.files.length - 1];
                    const link = lastFile.url || lastFile.content;
                    documentHtml = `
                        <a href="${link}" target="_blank" class="text-secondary" title="${lastFile.name || 'Dekont'}" style="text-decoration: none;">
                            <i class="fas fa-file-contract fa-lg hover-primary"></i>
                        </a>
                    `;
                } else {
                    documentHtml = '<span class="text-muted small">-</span>';
                }

                // Yurt dışı tabında düzenleme/silme butonları daha sade olabilir ama tutarlılık için aynı menü yapısını kullanabiliriz.
                // Ancak orijinal tasarımda sadece belge linki vardı, buraya da işlem menüsü eklenebilir. 
                // Şimdilik orijinal yapıyı koruyup sadece belgeyi gösteriyoruz.
                // İsterseniz buraya da actionMenuHtml ekleyebiliriz.

                return `
                <tr>
                    <td><input type="checkbox" class="row-checkbox" data-id="${acc.id}" ${isSelected ? 'checked' : ''}></td>
                    <td><small>${acc.id}</small></td>
                    <td><span class="badge badge-${sCls}">${sTxt}</span></td>
                    <td><a href="#" class="task-detail-link font-weight-bold" data-task-id="${acc.taskId}">${taskDisplay}</a></td>
                    <td style="font-weight:600; color:#495057;"><i class="fas fa-university mr-2 text-muted"></i>${paymentParty}</td>
                    <td style="font-weight:bold; color:#1e3c72;">${officialStr}</td>
                    <td>${remainingHtml}</td>
                    <td>${documentHtml}</td>
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
     * @param {Array} selectedAccrualsList - Seçilen tahakkuk objeleri
     * @param {String} activeTab - 'main' veya 'foreign'
     */

    showPaymentModal(selectedAccrualsList, activeTab = 'main') {
        document.getElementById('paidAccrualCount').textContent = selectedAccrualsList.length;
        document.getElementById('paymentDate').valueAsDate = new Date();
        document.getElementById('paymentReceiptFileList').innerHTML = '';

        const localArea = document.getElementById('detailedPaymentInputs');
        const foreignArea = document.getElementById('foreignPaymentInputs');

        // Önce her iki alanı da gizle
        if(localArea) localArea.style.display = 'none';
        if(foreignArea) foreignArea.style.display = 'none';

        // SADECE TEKİL SEÇİMDE DETAY GÖSTERİLİR
        if (selectedAccrualsList.length === 1) {
            const acc = selectedAccrualsList[0];

            // --- SENARYO A: YURT DIŞI TABI ---
            if (activeTab === 'foreign') {
                if(foreignArea) foreignArea.style.display = 'block';

                const offAmt = acc.officialFee?.amount || 0;
                const offCurr = acc.officialFee?.currency || 'EUR';
                
                document.getElementById('foreignTotalBadge').textContent = `${this._formatMoney(offAmt, offCurr)}`;
                document.querySelectorAll('.foreign-currency-label').forEach(el => el.textContent = offCurr);

                // --- GÜNCELLEME BURADA: Yeni alanlardan veriyi çek ---
                document.getElementById('manualForeignOfficial').value = acc.foreignPaidOfficialAmount || 0;
                document.getElementById('manualForeignService').value = acc.foreignPaidServiceAmount || 0;
                // ----------------------------------------------------

                const payFullCb = document.getElementById('payFullForeign');
                const splitInputs = document.getElementById('foreignSplitInputs');
                
                if(payFullCb) payFullCb.checked = true;
                if(splitInputs) splitInputs.style.display = 'none';
            }
            
            // --- SENARYO B: ANA LİSTE (YEREL) ---
            else {
                if(localArea) localArea.style.display = 'block'; // Yerel alanı aç

                // Resmi Ücret
                const offAmt = acc.officialFee?.amount || 0;
                const offCurr = acc.officialFee?.currency || 'TRY';
                document.getElementById('officialFeeBadge').textContent = `${offAmt} ${offCurr}`;
                document.getElementById('manualOfficialCurrencyLabel').textContent = offCurr;
                document.getElementById('manualOfficialAmount').value = acc.paidOfficialAmount || 0;

                // Hizmet Bedeli
                const srvAmt = acc.serviceFee?.amount || 0;
                const srvCurr = acc.serviceFee?.currency || 'TRY';
                document.getElementById('serviceFeeBadge').textContent = `${srvAmt} ${srvCurr}`;
                document.getElementById('manualServiceCurrencyLabel').textContent = srvCurr;
                document.getElementById('manualServiceAmount').value = acc.paidServiceAmount || 0;

                // Varsayılanlar
                document.getElementById('payFullOfficial').checked = true;
                document.getElementById('officialAmountInputContainer').style.display = 'none';
                document.getElementById('payFullService').checked = true;
                document.getElementById('serviceAmountInputContainer').style.display = 'none';
            }
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