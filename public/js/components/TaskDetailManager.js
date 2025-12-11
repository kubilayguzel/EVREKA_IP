// public/js/components/TaskDetailManager.js

export class TaskDetailManager {
    /**
     * @param {string} containerId - Detayların gösterileceği div'in ID'si (örn: 'modalBody')
     */
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        
        this.statusDisplayMap = {
            'open': 'Açık', 'in-progress': 'Devam Ediyor', 'completed': 'Tamamlandı',
            'pending': 'Beklemede', 'cancelled': 'İptal Edildi', 'on-hold': 'Askıda',
            'awaiting-approval': 'Onay Bekliyor', 'awaiting_client_approval': 'Müvekkil Onayı Bekliyor',
            'client_approval_opened': 'Müvekkil Onayı - Açıldı', 'client_approval_closed': 'Müvekkil Onayı - Kapatıldı',
            'client_no_response_closed': 'Müvekkil Cevaplamadı - Kapatıldı'
        };
    }

    /**
     * Yükleniyor animasyonunu gösterir.
     */
    showLoading() {
        if (!this.container) return;
        this.container.innerHTML = '<div class="text-center p-4"><i class="fas fa-circle-notch fa-spin fa-2x text-primary"></i><br><br>Veriler getiriliyor...</div>';
    }

    /**
     * Hata mesajı gösterir.
     */
    showError(message) {
        if (!this.container) return;
        this.container.innerHTML = `<div class="alert alert-danger">${message}</div>`;
    }

    /**
     * Task verilerini ve ilişkili verileri alıp HTML'i oluşturur.
     * @param {Object} task - Ana Task objesi
     * @param {Object} options - { ipRecord, transactionType, assignedUser, accruals }
     */
    render(task, options = {}) {
        if (!this.container) return;
        if (!task) {
            this.showError('İş kaydı bulunamadı.');
            return;
        }

        const { ipRecord, transactionType, assignedUser, accruals = [] } = options;

        // 1. Veri Hazırlığı
        const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : (task.assignedTo_email || 'Atanmamış');
        const relatedRecordTxt = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'İlgili kayıt bulunamadı';
        const taskTypeDisplay = transactionType ? (transactionType.alias || transactionType.name) : (task.taskType || '-');
        const statusText = this.statusDisplayMap[task.status] || task.status;

        // 2. HTML Parçalarının Oluşturulması
        const accrualsHtml = this._generateAccrualsHtml(accruals);
        const docsContent = this._generateDocsHtml(task);

        // 3. Ana Şablon
        const html = `
            <div class="container-fluid p-0">
                <div class="section-header mt-0"><i class="fas fa-info-circle mr-2"></i> GENEL BİLGİLER</div>
                
                <div class="mb-3">
                    <label class="view-label">İş Konusu</label>
                    <div class="view-box font-weight-bold text-dark" style="background-color: #f8f9fa;">${task.title || '-'}</div>
                </div>

                <div class="form-grid">
                    <div class="form-group">
                        <label class="view-label">İlgili Dosya</label>
                        <div class="view-box">${relatedRecordTxt}</div>
                    </div>
                    <div class="form-group">
                        <label class="view-label">İş Tipi</label>
                        <div class="view-box">${taskTypeDisplay}</div>
                    </div>
                    <div class="form-group">
                        <label class="view-label">Atanan Kişi</label>
                        <div class="view-box"><i class="fas fa-user-circle mr-2 text-muted"></i> ${assignedName}</div>
                    </div>
                    <div class="form-group">
                        <label class="view-label">Güncel Durum</label>
                        <div class="view-box font-weight-bold" style="color:#1e3c72;">${statusText}</div>
                    </div>
                </div>

                <div class="section-header"><i class="far fa-calendar-alt mr-2"></i> TARİHLER</div>
                <div class="form-grid">
                    <div class="form-group">
                        <label class="view-label">Operasyonel Son Tarih</label>
                        <div class="view-box"><i class="far fa-clock mr-2 text-warning"></i> ${this._formatDate(task.dueDate)}</div>
                    </div>
                    <div class="form-group">
                        <label class="view-label">Resmi Son Tarih</label>
                        <div class="view-box"><i class="far fa-calendar-check mr-2 text-danger"></i> ${this._formatDate(task.officialDueDate)}</div>
                    </div>
                </div>

                <div class="section-header"><i class="fas fa-folder-open mr-2"></i> BELGELER</div>
                <div class="mb-3">
                    ${docsContent}
                </div>

                <div class="section-header"><i class="fas fa-coins mr-2"></i> BAĞLI TAHAKKUKLAR</div>
                <div class="mb-3">
                    ${accrualsHtml}
                </div>

                <div class="section-header"><i class="fas fa-align-left mr-2"></i> AÇIKLAMA & NOTLAR</div>
                <div class="view-box" style="min-height: 80px; white-space: pre-wrap; background:#fff;">${task.description || '<span class="text-muted font-italic">Açıklama girilmemiş.</span>'}</div>
            </div>`;

        this.container.innerHTML = html;
    }

    /**
     * Tahakkuk tablosunu oluşturur (Helper)
     */
    _generateAccrualsHtml(accruals) {
        if (!accruals || accruals.length === 0) {
            return `<div class="view-box text-muted font-italic small"><i class="fas fa-info-circle mr-2"></i>Bu işe bağlı tahakkuk kaydı bulunmamaktadır.</div>`;
        }

        const rows = accruals.map(acc => {
            const accStatusBadge = acc.status === 'paid' 
                ? '<span style="color:green; font-weight:bold;">Ödendi</span>' 
                : '<span style="color:orange; font-weight:bold;">Ödenmedi</span>';
            return `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding:8px;">#${acc.id || '-'}</td>
                    <td style="padding:8px; font-weight:bold;">${this._formatCurrency(acc.totalAmount, acc.totalAmountCurrency)}</td>
                    <td style="padding:8px;">${accStatusBadge}</td>
                    <td style="padding:8px; color:#666;">${this._formatDate(acc.createdAt)}</td>
                </tr>`;
        }).join('');

        return `
            <div class="view-box" style="display:block; padding:0; overflow:hidden;">
                <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                    <thead style="background:#f8f9fa; border-bottom:2px solid #e9ecef;">
                        <tr>
                            <th style="padding:10px; text-align:left;">ID</th>
                            <th style="padding:10px; text-align:left;">Tutar</th>
                            <th style="padding:10px; text-align:left;">Durum</th>
                            <th style="padding:10px; text-align:left;">Tarih</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    /**
     * Belge listesini oluşturur (Helper)
     */
    _generateDocsHtml(task) {
        let docsContent = '';
        
        // EPATS Belgesi
        if (task.details && task.details.epatsDocument && (task.details.epatsDocument.url || task.details.epatsDocument.downloadURL)) {
            const doc = task.details.epatsDocument;
            const url = doc.url || doc.downloadURL;
            docsContent += `
            <div class="col-12 mb-2">
                <div class="view-box d-flex justify-content-between align-items-center" style="border-left: 4px solid #007bff; background:#f0f7ff;">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-file-contract text-primary fa-lg mr-3"></i>
                        <div>
                            <strong class="d-block text-dark" style="font-size:0.9rem;">EPATS Belgesi</strong>
                            <small class="text-muted">${doc.name || 'Dosya'}</small>
                        </div>
                    </div>
                    <a href="${url}" target="_blank" class="btn btn-sm btn-primary">Aç</a>
                </div>
            </div>`;
        }

        // Diğer Dosyalar
        const files = task.files || (task.details ? task.details.files : []) || [];
        if (files.length > 0) {
            files.forEach(file => {
                const epatsUrl = (task.details && task.details.epatsDocument) ? (task.details.epatsDocument.url || task.details.epatsDocument.downloadURL) : null;
                const fileUrl = file.url || file.content;
                // EPATS belgesi tekrar gösterilmesin
                if (epatsUrl && (fileUrl === epatsUrl)) return;

                docsContent += `
                <div class="col-md-6 mb-2">
                    <div class="view-box d-flex justify-content-between align-items-center">
                        <div class="d-flex align-items-center text-truncate" style="max-width: 80%;">
                            <i class="fas fa-paperclip text-secondary mr-2"></i>
                            <span class="text-truncate small" title="${file.name}">${file.name}</span>
                        </div>
                        <a href="${fileUrl}" target="_blank" class="btn btn-sm btn-light border"><i class="fas fa-download"></i></a>
                    </div>
                </div>`;
            });
        }

        if (docsContent === '') {
            return `<div class="col-12"><div class="view-box text-muted font-italic small">Ekli belge bulunmamaktadır.</div></div>`;
        }
        return `<div class="row" style="margin:0 -5px;">${docsContent}</div>`;
    }

    _formatDate(dateVal) {
        if (!dateVal) return '-';
        try {
            const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
            return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('tr-TR');
        } catch(e) { return '-'; }
    }

    _formatCurrency(amount, currency) {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency || 'TRY' }).format(amount || 0);
    }
}