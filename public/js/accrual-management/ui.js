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

        // Helper: Para Formatlama
        const fmt = (val, curr) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0) + ' ' + (curr || 'TRY');

        const rows = filteredAccruals.map(accrual => {
            let statusText = 'Bilinmiyor', statusClass = 'badge-secondary';
            switch (accrual.status) {
                case 'paid': statusText = 'Ödendi'; statusClass = 'status-paid'; break;
                case 'unpaid': statusText = 'Ödenmedi'; statusClass = 'status-unpaid'; break;
                case 'partially_paid': statusText = 'Kısmen Ödendi'; statusClass = 'status-partially-paid'; break;
            }

            // Para Birimi Kontrollü Gösterimler
            const officialDisplay = fmt(accrual.officialFee?.amount, accrual.officialFee?.currency);
            const serviceDisplay = fmt(accrual.serviceFee?.amount, accrual.serviceFee?.currency);
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

    // --- DÜZELTİLEN TOPLAM TUTAR MANTIĞI ---
    formatTotalAmount(accrual) {
        const off = accrual.officialFee?.amount || 0;
        const offCurr = accrual.officialFee?.currency || 'TRY';
        const srv = accrual.serviceFee?.amount || 0;
        const srvCurr = accrual.serviceFee?.currency || 'TRY';
        const vat = accrual.vatRate || 0;
        const applyVatToOfficial = accrual.applyVatToOfficialFee;

        // KDV Dahil Tutarlar
        const offTotal = applyVatToOfficial ? off * (1 + vat / 100) : off;
        const srvTotal = srv * (1 + vat / 100);

        const fmt = (v) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

        if (offCurr === srvCurr) {
            return `<span class="font-weight-bold">${fmt(offTotal + srvTotal)} ${offCurr}</span>`;
        } else {
            // FARKLI PARA BİRİMİ: Alt alta göster
            return `<div style="line-height:1.2;">
                <small>${fmt(offTotal)} ${offCurr}</small><br>
                <small>+ ${fmt(srvTotal)} ${srvCurr}</small>
            </div>`;
        }
    }

    // --- DÜZELTİLEN KALAN TUTAR MANTIĞI ---
    formatRemainingAmount(accrual) {
        const off = accrual.officialFee?.amount || 0;
        const offCurr = accrual.officialFee?.currency || 'TRY';
        const srv = accrual.serviceFee?.amount || 0;
        const srvCurr = accrual.serviceFee?.currency || 'TRY';
        const vat = accrual.vatRate || 0;

        // Toplam Gereken (KDV Dahil)
        const offNeeded = accrual.applyVatToOfficialFee ? off * (1 + vat/100) : off;
        const srvNeeded = srv * (1 + vat/100);

        // Ödenenler (Veritabanından)
        const paidOff = accrual.paidOfficialAmount || 0;
        const paidSrv = accrual.paidServiceAmount || 0;

        // Kalanlar
        let remOff = offNeeded - paidOff;
        let remSrv = srvNeeded - paidSrv;

        if (remOff < 0.01) remOff = 0;
        if (remSrv < 0.01) remSrv = 0;

        // Eğer hepsi ödendiyse
        if (remOff === 0 && remSrv === 0) {
            return '<span class="text-success font-weight-bold">0.00</span>';
        }

        const fmt = (v) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

        // Gösterim Mantığı
        if (offCurr === srvCurr) {
            // Aynı birimse topla
            return `<span class="text-danger font-weight-bold">${fmt(remOff + remSrv)} ${offCurr}</span>`;
        } else {
            // Farklı birimse sadece kalanları göster
            let parts = [];
            if (remOff > 0) parts.push(`${fmt(remOff)} ${offCurr}`);
            if (remSrv > 0) parts.push(`${fmt(remSrv)} ${srvCurr}`);
            return `<span class="text-danger font-weight-bold small">${parts.join(' + ')}</span>`;
        }
    }

    // --- DÜZELTİLEN PDF GÖSTERİM ALANI (View Modal İçin) ---
    showViewAccrualDetailModal(accrual) {
        const modal = document.getElementById('viewAccrualDetailModal');
        const body = modal.querySelector('.modal-body-content');
        
        // Basit tarih formatlayıcı
        const dFmt = (d) => d ? new Date(d).toLocaleDateString('tr-TR') : '-';

        // Dosya HTML Oluşturucu (Grid yapısı düzeltildi)
        let filesHtml = '';
        if (accrual.files && accrual.files.length > 0) {
            filesHtml = accrual.files.map(f => {
                const url = f.content || f.url;
                let icon = 'fa-file-alt';
                let colorClass = 'text-secondary';
                if(f.documentDesignation?.includes('Fatura')) { icon = 'fa-file-invoice-dollar'; colorClass = 'text-info'; }
                else if(f.documentDesignation?.includes('Dekont')) { icon = 'fa-receipt'; colorClass = 'text-success'; }

                return `
                <div class="col-md-6 mb-2">
                    <div class="p-2 border rounded d-flex align-items-center bg-white shadow-sm h-100">
                        <i class="fas ${icon} ${colorClass} fa-2x mr-3 ml-1"></i>
                        <div style="flex-grow:1; overflow:hidden;">
                            <div class="text-truncate font-weight-bold small" title="${f.name}">${f.name}</div>
                            <div class="text-muted small" style="font-size:0.75rem;">${f.documentDesignation || 'Belge'}</div>
                        </div>
                        <a href="${url}" target="_blank" class="btn btn-sm btn-light ml-2"><i class="fas fa-download"></i></a>
                    </div>
                </div>`;
            }).join('');
        } else {
            filesHtml = '<div class="col-12 text-center text-muted font-italic p-3">Ekli dosya bulunmamaktadır.</div>';
        }

        body.innerHTML = `
            <div class="container-fluid p-0">
                <div class="alert ${accrual.status === 'paid' ? 'alert-success' : 'alert-light border'} d-flex justify-content-between align-items-center">
                    <div><strong>Durum:</strong> ${accrual.status === 'paid' ? 'ÖDENDİ' : 'ÖDEME BEKLİYOR/KISMI'}</div>
                    <div><strong>Tarih:</strong> ${dFmt(accrual.createdAt)}</div>
                </div>
                
                <h6 class="border-bottom pb-2 mb-3 text-primary">Finansal Özet</h6>
                <div class="row mb-4">
                    <div class="col-md-6">
                        <label class="small text-muted mb-0">Toplam Tutar</label>
                        <div class="h5">${this.formatTotalAmount(accrual)}</div>
                    </div>
                    <div class="col-md-6 text-right">
                        <label class="small text-muted mb-0">Kalan Tutar</label>
                        <div class="h5 text-danger">${this.formatRemainingAmount(accrual)}</div>
                    </div>
                </div>

                <h6 class="border-bottom pb-2 mb-3 text-primary">Dosyalar & Belgeler</h6>
                <div class="row">
                    ${filesHtml}
                </div>
            </div>
        `;
        modal.classList.add('show');
    }
}