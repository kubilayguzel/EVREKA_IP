import { showNotification } from '../../utils.js';

export default class AccrualsUI {
    constructor(dataManager) {
        this.dataManager = dataManager; 
    }

    renderTable(filteredAccruals, selectedAccruals) {
        const tableBody = document.getElementById('accrualsTableBody');
        const noRecordsMessage = document.getElementById('noRecordsMessage');

        if (!filteredAccruals || filteredAccruals.length === 0) {
            tableBody.innerHTML = '';
            if(noRecordsMessage) noRecordsMessage.style.display = 'block';
            return;
        }
        if(noRecordsMessage) noRecordsMessage.style.display = 'none';

        // Helper: Güvenli Formatlayıcı (NaN korumalı)
        const fmtSimple = (val, curr) => {
            const num = Number(val);
            const safeVal = isNaN(num) ? 0 : num;
            return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeVal) + ' ' + (curr || 'TRY');
        };

        const rows = filteredAccruals.map(accrual => {
            let statusText = 'Bilinmiyor', statusClass = 'badge-secondary';
            switch (accrual.status) {
                case 'paid': statusText = 'Ödendi'; statusClass = 'status-paid'; break;
                case 'unpaid': statusText = 'Ödenmedi'; statusClass = 'status-unpaid'; break;
                case 'partially_paid': statusText = 'Kısmen Ödendi'; statusClass = 'status-partially-paid'; break;
            }

            // Resmi ve Hizmet Ücretleri (Güvenli Format)
            const officialDisplay = fmtSimple(accrual.officialFee?.amount, accrual.officialFee?.currency);
            const serviceDisplay = fmtSimple(accrual.serviceFee?.amount, accrual.serviceFee?.currency);
            
            // Toplam ve Kalan Tutar (Array ve NaN Korumalı)
            const totalDisplay = this.formatTotalAmount(accrual);
            const remainingDisplay = this.formatRemainingAmount(accrual);

            const isSelected  = selectedAccruals.has(accrual.id);
            const isPaid = accrual.status === 'paid';
            const relatedTaskDisplay = accrual.taskTitle || accrual.taskId || 'İş Detayı';

            return `
            <tr>
                <td><input type="checkbox" class="row-checkbox" data-id="${accrual.id}" ${isSelected ? 'checked' : ''}></td>
                <td><small>${accrual.id}</small></td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td><a href="#" class="task-detail-link" data-task-id="${accrual.taskId || ''}">${relatedTaskDisplay}</a></td>
                <td>${officialDisplay}</td>
                <td>${serviceDisplay}</td>
                <td>${totalDisplay}</td>
                <td>${remainingDisplay}</td>
                <td>
                    <div style="display:flex;">
                        <button class="action-btn view-btn" data-id="${accrual.id}">Görüntüle</button>
                        <button class="action-btn edit-btn" data-id="${accrual.id}" ${isPaid ? 'disabled' : ''}>Düzenle</button>
                        <button class="action-btn delete-btn" data-id="${accrual.id}">Sil</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        tableBody.innerHTML = rows;
    }

    updateBulkActionsVisibility(hasSelection) {
        const bulkActions = document.getElementById('bulkActions');
        if(bulkActions) bulkActions.style.display = hasSelection ? 'flex' : 'none';
    }

    /**
     * 1. Toplam Tutar Gösterimi (NaN Korumalı)
     */
    formatTotalAmount(accrual) {
        const totalData = accrual.totalAmount;
        const fmt = (v) => {
            const num = Number(v);
            return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(isNaN(num) ? 0 : num);
        };

        // A) Veri Dizi (Array) ise
        if (Array.isArray(totalData)) {
            if (totalData.length === 0) return '0.00 TRY';
            const parts = totalData.map(t => `${fmt(t.amount)} ${t.currency}`);
            if (parts.length === 1) return `<span class="font-weight-bold">${parts[0]}</span>`;
            return `<div class="font-weight-bold small" style="line-height:1.2;">${parts.join('<br>+ ')}</div>`;
        } 
        
        // B) Veri Sayı veya Hatalı ise (Fallback)
        else {
            let val = Number(totalData);
            if (isNaN(val)) val = 0;
            const curr = accrual.totalAmountCurrency || 'TRY';
            return `<span class="font-weight-bold">${fmt(val)} ${curr}</span>`;
        }
    }

    /**
     * 2. Kalan Tutar Gösterimi (NaN Korumalı)
     */
    formatRemainingAmount(accrual) {
        const fmt = (v) => {
             const num = Number(v);
             return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(isNaN(num) ? 0 : num);
        };

        // A) Veritabanında Hazır Dizi Varsa
        if (Array.isArray(accrual.remainingAmount)) {
            const arr = accrual.remainingAmount;
            if (arr.length === 0) return '<span class="text-success font-weight-bold">0.00</span>';
            const parts = arr.map(t => `${fmt(t.amount)} ${t.currency}`);
            return `<div class="text-danger font-weight-bold small" style="line-height:1.2;">${parts.join('<br>+ ')}</div>`;
        }

        // B) Fallback Hesaplama
        const off = Number(accrual.officialFee?.amount) || 0;
        const offCurr = accrual.officialFee?.currency || 'TRY';
        const srv = Number(accrual.serviceFee?.amount) || 0;
        const srvCurr = accrual.serviceFee?.currency || 'TRY';
        const vat = Number(accrual.vatRate) || 0;
        
        const offTarget = accrual.applyVatToOfficialFee ? off * (1 + vat/100) : off;
        const srvTarget = srv * (1 + vat/100);

        const paidOff = Number(accrual.paidOfficialAmount) || 0;
        const paidSrv = Number(accrual.paidServiceAmount) || 0;

        const remOff = Math.max(0, offTarget - paidOff);
        const remSrv = Math.max(0, srvTarget - paidSrv);

        if (remOff < 0.01 && remSrv < 0.01) {
             return '<span class="text-success font-weight-bold">0.00</span>';
        }

        const remTotals = {};
        if (remOff > 0.01) remTotals[offCurr] = (remTotals[offCurr] || 0) + remOff;
        if (remSrv > 0.01) remTotals[srvCurr] = (remTotals[srvCurr] || 0) + remSrv;

        const parts = Object.entries(remTotals).map(([curr, amt]) => `${fmt(amt)} ${curr}`);

        if (parts.length === 0) return '<span class="text-success font-weight-bold">0.00</span>';
        return `<div class="text-danger font-weight-bold small" style="line-height:1.2;">${parts.join('<br>+ ')}</div>`;
    }

    // --- View Modal ---
    showViewAccrualDetailModal(accrual) {
        const modal = document.getElementById('viewAccrualDetailModal');
        const body = modal.querySelector('.modal-body-content');
        const title = document.getElementById('viewAccrualTitle');
        if(title) title.textContent = `Tahakkuk Detayı (#${accrual.id})`;

        const dFmt = (d) => d ? new Date(d).toLocaleDateString('tr-TR') : '-';

        let filesHtml = '';
        if (accrual.files && accrual.files.length > 0) {
            filesHtml = accrual.files.map(f => {
                const url = f.content || f.url;
                let icon = 'fa-file-alt';
                let colorClass = 'text-secondary';
                
                const nameLower = (f.name || '').toLowerCase();
                const desigLower = (f.documentDesignation || '').toLowerCase();
                
                if(desigLower.includes('fatura') || nameLower.includes('invoice')) { icon = 'fa-file-invoice-dollar'; colorClass = 'text-info'; }
                else if(desigLower.includes('dekont') || nameLower.includes('receipt')) { icon = 'fa-receipt'; colorClass = 'text-success'; }
                else if(nameLower.endsWith('.pdf')) { icon = 'fa-file-pdf'; colorClass = 'text-danger'; }

                return `
                <div class="col-md-6 mb-2">
                    <div class="p-2 border rounded d-flex align-items-center bg-white shadow-sm h-100">
                        <i class="fas ${icon} ${colorClass} fa-2x mr-3 ml-1"></i>
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
                            <div class="font-weight-bold ${accrual.status==='paid'?'text-success':'text-danger'}">
                                ${accrual.status === 'paid' ? 'ÖDENDİ' : (accrual.status === 'partially_paid' ? 'KISMEN ÖDENDİ' : 'ÖDENMEDİ')}
                            </div>
                        </div>
                    </div>
                </div>

                <h6 class="border-bottom pb-2 mb-3 text-primary"><i class="fas fa-coins mr-2"></i>Finansal Özet</h6>
                <div class="row mb-4">
                    <div class="col-md-6 mb-3">
                        <div class="card h-100 border-0 bg-light">
                            <div class="card-body p-3">
                                <label class="small text-muted mb-1">Toplam Tutar</label>
                                <div class="h5 mb-0 text-primary">${this.formatTotalAmount(accrual)}</div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6 mb-3">
                        <div class="card h-100 border-0 bg-light">
                            <div class="card-body p-3 text-right">
                                <label class="small text-muted mb-1">Kalan Tutar</label>
                                <div class="h5 mb-0 text-danger">${this.formatRemainingAmount(accrual)}</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="row text-muted small mb-3">
                    <div class="col-6">
                        <strong>Oluşturulma:</strong> ${dFmt(accrual.createdAt)}
                    </div>
                    <div class="col-6 text-right">
                        <strong>Ödeme Tarihi:</strong> ${dFmt(accrual.paymentDate)}
                    </div>
                </div>

                <h6 class="border-bottom pb-2 mb-3 text-primary"><i class="fas fa-folder-open mr-2"></i>Dosyalar & Belgeler</h6>
                <div class="row">
                    ${filesHtml}
                </div>
            </div>
        `;
        modal.classList.add('show');
    }
    
    showTaskDetailModal(taskId) {
        const modal = document.getElementById('taskDetailModal');
        if(modal) modal.classList.add('show');
    }
}