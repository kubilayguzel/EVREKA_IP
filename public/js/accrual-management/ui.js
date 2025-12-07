import { showNotification, formatFileSize } from '../../utils.js';

export default class AccrualsUI {
    constructor(dataManager) {
        this.dataManager = dataManager; // Veri yöneticisine erişim gerekebilir (örn: ID'den Task bulma)
    }

    renderTable(filteredAccruals, selectedAccruals) {
        const tableBody = document.getElementById('accrualsTableBody');
        const noRecordsMessage = document.getElementById('noRecordsMessage');

        if (filteredAccruals.length === 0) {
            tableBody.innerHTML = '';
            noRecordsMessage.style.display = 'block';
            return;
        }
        noRecordsMessage.style.display = 'none';

        const currencyFormatter = (amount, currency) => {
            try { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency || 'TRY' }).format(amount ?? 0); } 
            catch (e) { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount ?? 0); }
        };

        const formatFee = (feeData) => {
            if (feeData && typeof feeData === 'object' && feeData.currency) return { amount: feeData.amount || 0, currency: feeData.currency };
            if (typeof feeData === 'number') return { amount: feeData, currency: 'TRY' };
            return { amount: 0, currency: 'TRY' };
        };

        const rows = filteredAccruals.map(accrual => {
            let statusText = 'Bilinmiyor';
            let statusClass = '';
            switch (accrual.status) {
                case 'paid': statusText = 'Ödendi'; statusClass = 'status-paid'; break;
                case 'unpaid': statusText = 'Ödenmedi'; statusClass = 'status-unpaid'; break;
                case 'partially_paid': statusText = 'Kısmen Ödendi'; statusClass = 'status-partially-paid'; break;
            }

            const officialFee = formatFee(accrual.officialFee);
            const serviceFee  = formatFee(accrual.serviceFee);
            const isSelected  = selectedAccruals.has(accrual.id);
            const isPaid      = accrual.status === 'paid';
            const editButtonDisabled = isPaid ? 'disabled' : '';

            const relatedTaskDisplay = accrual.taskTitle ? `${accrual.taskTitle} (${accrual.taskId})` : (accrual.taskId || 'İş Detayı');
            const remainingAmount = (accrual.remainingAmount !== undefined) ? accrual.remainingAmount : (accrual.totalAmount || 0);

            return `
            <tr>
                <td><input type="checkbox" class="row-checkbox" data-id="${accrual.id}" ${isSelected ? 'checked' : ''}></td>
                <td><small>${(accrual.id || '')}</small></td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td><a href="#" class="task-detail-link" data-task-id="${accrual.taskId || ''}">${relatedTaskDisplay}</a></td>
                <td>${currencyFormatter(officialFee.amount, officialFee.currency)}</td>
                <td>${currencyFormatter(serviceFee.amount,  serviceFee.currency)}</td>
                <td>${currencyFormatter(accrual.totalAmount || 0, accrual.totalAmountCurrency || 'TRY')}</td>
                <td>${currencyFormatter(remainingAmount, accrual.totalAmountCurrency || 'TRY')}</td>
                <td>
                    <div style="display:flex;">
                        <button class="action-btn view-btn" data-id="${accrual.id}">Görüntüle</button>
                        <button class="action-btn edit-btn" data-id="${accrual.id}" ${editButtonDisabled}>Düzenle</button>
                        <button class="action-btn delete-btn" data-id="${accrual.id}">Sil</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        tableBody.innerHTML = rows;
    }

    updateBulkActionsVisibility(hasSelection) {
        const bulkActions = document.getElementById('bulkActions');
        bulkActions.style.display = hasSelection ? 'flex' : 'none';
    }

    showViewAccrualDetailModal(accrual) {
        const modal = document.getElementById('viewAccrualDetailModal');
        const modalBody = modal.querySelector('.modal-body-content');
        
        // Yardımcı formatlayıcılar
        const formatCurrency = (amount, currency) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency || 'TRY' }).format(amount || 0);
        const formatDate = (dateVal) => { try { return dateVal ? new Date(dateVal).toLocaleDateString('tr-TR') : '-'; } catch (e) { return '-'; } };

        // Durum Rozeti
        let statusBadge = '';
        if(accrual.status === 'paid') statusBadge = '<span class="badge badge-success px-3 w-100 py-2">Ödendi</span>';
        else if(accrual.status === 'unpaid') statusBadge = '<span class="badge badge-danger px-3 w-100 py-2">Ödenmedi</span>';
        else if(accrual.status === 'partially_paid') statusBadge = '<span class="badge badge-warning px-3 w-100 py-2 text-white">Kısmen Ödendi</span>';
        else statusBadge = '<span class="badge badge-secondary px-3 w-100 py-2">Bilinmiyor</span>';

        // Bağlı İş Bulma
        let relatedTask = this.dataManager.getTask(accrual.taskId);

        // Doküman HTML
        let docsContent = '';
        
        // 1. EPATS Belgesi
        if (relatedTask && relatedTask.details && relatedTask.details.epatsDocument && (relatedTask.details.epatsDocument.url || relatedTask.details.epatsDocument.downloadURL)) {
            const doc = relatedTask.details.epatsDocument;
            const url = doc.url || doc.downloadURL;
            docsContent += `
                <div class="col-12 mb-3">
                    <label class="view-label text-primary"><i class="fas fa-file-contract mr-1"></i> İŞİN EPATS DOKÜMANI</label>
                    <div class="view-box bg-light d-flex justify-content-between align-items-center" style="border-left: 4px solid #007bff;">
                        <div class="d-flex align-items-center overflow-hidden">
                            <i class="fas fa-file-pdf text-danger fa-lg mr-3"></i>
                            <div class="text-truncate">
                                <strong class="d-block text-dark" style="font-size:0.9rem;">${doc.name || 'EPATS Dosyası'}</strong>
                            </div>
                        </div>
                        <a href="${url}" target="_blank" class="btn btn-sm btn-outline-primary font-weight-bold ml-2">Görüntüle</a>
                    </div>
                </div>`;
        }

        // 2. Diğer Belgeler
        if (accrual.files && accrual.files.length > 0) {
            accrual.files.forEach(f => {
                const url = f.content || f.url;
                let label = f.documentDesignation || 'Diğer Belge';
                let iconClass = 'fa-file-alt text-secondary';

                if (label.includes('Fatura') || label.includes('Invoice') || label.includes('Debit')) {
                    label = 'YURTDIŞI FATURA / DEBIT'; iconClass = 'fa-file-invoice-dollar text-info';
                } else if (label.includes('Dekont') || label.includes('Receipt')) {
                    label = 'ÖDEME DEKONTU'; iconClass = 'fa-receipt text-success';
                } else { label = label.toUpperCase(); }

                docsContent += `
                    <div class="col-md-6 mb-3">
                        <label class="view-label">${label}</label>
                        <div class="view-box d-flex justify-content-between align-items-center">
                            <div class="d-flex align-items-center text-truncate pr-2">
                                <i class="fas ${iconClass} fa-lg mr-2"></i>
                                <span class="text-truncate small" title="${f.name}">${f.name}</span>
                            </div>
                            <a href="${url}" target="_blank" class="btn btn-sm btn-light border ml-1"><i class="fas fa-download"></i></a>
                        </div>
                    </div>`;
            });
        }

        if (docsContent === '') docsContent = `<div class="col-12"><div class="p-3 border rounded bg-light text-muted font-italic small text-center">Bu kayda ait görüntülenecek belge bulunamadı.</div></div>`;

        const html = `
            <div class="container-fluid p-0">
                <div class="section-header mt-0"><i class="fas fa-info-circle mr-2"></i>GENEL BİLGİLER</div>
                <div class="row">
                    <div class="col-md-8 mb-3">
                        <label class="view-label">İlgili İş (Task)</label>
                        <div class="view-box bg-light font-weight-bold text-dark">${accrual.taskTitle || '-'} <span class="text-muted ml-2 small font-weight-normal">(${accrual.taskId || 'ID Yok'})</span></div>
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="view-label">Durum</label>
                        ${statusBadge}
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-6 mb-3">
                        <label class="view-label">Oluşturulma Tarihi</label>
                        <div class="view-box"><i class="far fa-calendar-plus mr-2 text-muted"></i> ${formatDate(accrual.createdAt)}</div>
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="view-label">Ödeme Tarihi</label>
                        <div class="view-box"><i class="far fa-calendar-check mr-2 text-muted"></i> ${accrual.paymentDate ? formatDate(accrual.paymentDate) : 'Bekliyor'}</div>
                    </div>
                </div>

                <div class="section-header"><i class="fas fa-coins mr-2"></i>FİNANSAL DETAYLAR</div>
                <div class="row">
                    <div class="col-md-6 mb-3">
                        <label class="view-label">Resmi Ücret</label>
                        <div class="view-box font-weight-bold">${formatCurrency(accrual.officialFee?.amount, accrual.officialFee?.currency)}</div>
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="view-label">Hizmet Bedeli</label>
                        <div class="view-box font-weight-bold">${formatCurrency(accrual.serviceFee?.amount, accrual.serviceFee?.currency)}</div>
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-4 mb-3">
                        <label class="view-label">KDV</label>
                        <div class="view-box text-muted small">%${accrual.vatRate || 20} <span class="ml-1 font-italic">(${accrual.applyVatToOfficialFee ? 'Tümü' : 'Hizmet'})</span></div>
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="view-label">Toplam Tutar</label>
                        <div class="view-box font-weight-bold text-primary bg-light" style="font-size: 1.1em;">${formatCurrency(accrual.totalAmount, accrual.totalAmountCurrency)}</div>
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="view-label">Kalan Tutar</label>
                        <div class="view-box font-weight-bold ${accrual.remainingAmount > 0 ? 'text-danger' : 'text-success'}">${formatCurrency(accrual.remainingAmount !== undefined ? accrual.remainingAmount : accrual.totalAmount, accrual.totalAmountCurrency)}</div>
                    </div>
                </div>

                <div class="section-header"><i class="fas fa-file-invoice mr-2"></i>FATURA BİLGİLERİ</div>
                <div class="row">
                    <div class="col-md-6 mb-3">
                        <label class="view-label">Türk Patent Faturası</label>
                        <div class="view-box small text-truncate"><i class="fas fa-user-tie text-secondary mr-2"></i>${accrual.tpInvoiceParty?.name || '-'}</div>
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="view-label">Hizmet Faturası</label>
                        <div class="view-box small text-truncate"><i class="fas fa-building text-secondary mr-2"></i>${accrual.serviceInvoiceParty?.name || '-'}</div>
                    </div>
                </div>

                <div class="section-header"><i class="fas fa-folder-open mr-2"></i>BELGELER</div>
                <div class="row">${docsContent}</div>
            </div>`;

        modalBody.innerHTML = html;
        modal.classList.add('show');
    }

    showTaskDetailModal(taskId) {
        const task = this.dataManager.getTask(taskId);
        if (!task) { showNotification('İş bulunamadı', 'error'); return; }
        
        const modal = document.getElementById('taskDetailModal');
        const modalBody = document.getElementById('modalBody');
        
        // Basit Task Detail (Detaylı yapıyı buraya kopyalayabilirsiniz, kısalık için özet geçiyorum)
        modalBody.innerHTML = `<div><b>İş Başlığı:</b> ${task.title}<br><b>Durum:</b> ${task.status}</div>`; 
        modal.classList.add('show');
    }

    // Edit, MarkPaid modalları için form doldurma işlemleri buraya (Kısalık için Main'de tuttum ama buraya taşınmalı)
    // Şimdilik Main.js içinde UI manipülasyonlarını da tutarak 2 dosya ile işi bitirelim, çok bölmeyelim.
}