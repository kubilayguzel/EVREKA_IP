// public/js/components/TaskDetailManager.js

export class TaskDetailManager {
    /**
     * @param {string} containerId - Detayların gösterileceği div'in ID'si
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

    showLoading() {
        if (!this.container) return;
        this.container.innerHTML = `
            <div class="d-flex flex-column align-items-center justify-content-center py-5">
                <i class="fas fa-circle-notch fa-spin fa-3x text-primary mb-3"></i>
                <h6 class="text-muted">Veriler hazırlanıyor...</h6>
            </div>`;
    }

    showError(message) {
        if (!this.container) return;
        this.container.innerHTML = `
            <div class="alert alert-danger d-flex align-items-center m-3" role="alert">
                <i class="fas fa-exclamation-triangle mr-3 fa-lg"></i>
                <div>${message}</div>
            </div>`;
    }

    render(task, options = {}) {
        if (!this.container) return;
        if (!task) { this.showError('İş kaydı bulunamadı.'); return; }

        const { ipRecord, transactionType, assignedUser, accruals = [] } = options;

        // --- Veri Hazırlığı ---
        const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : (task.assignedTo_email || 'Atanmamış');
        const relatedRecordTxt = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'İlgili kayıt bulunamadı';
        const taskTypeDisplay = transactionType ? (transactionType.alias || transactionType.name) : (task.taskType || '-');
        const statusText = this.statusDisplayMap[task.status] || task.status;

        // Statüye göre renk
        const isCompleted = task.status === 'completed';
        const statusColorClass = isCompleted ? 'text-success' : 'text-primary';

        // İçerik Parçaları
        const accrualsHtml = this._generateAccrualsHtml(accruals);
        const docsContent = this._generateDocsHtml(task);

        // --- Ana Şablon ---
        const html = `
            <div class="container-fluid px-1 py-2">
                
                <div class="d-flex justify-content-between align-items-center p-3 mb-4 bg-light border rounded shadow-sm" style="border-left: 5px solid #1e3c72 !important;">
                    <div>
                        <h5 class="font-weight-bold text-dark mb-1">${task.title || 'Başlıksız Görev'}</h5>
                        <small class="text-muted"><i class="fas fa-hashtag mr-1"></i>Task ID: ${task.id}</small>
                    </div>
                    <div class="text-right">
                        <span class="badge badge-pill px-3 py-2 ${statusColorClass}" style="background-color: #e9ecef; font-size: 0.9rem;">
                            ${statusText}
                        </span>
                    </div>
                </div>

                <div class="mb-4">
                    <h6 class="border-bottom pb-2 mb-3 text-primary font-weight-bold" style="letter-spacing: 0.5px;">
                        <i class="fas fa-info-circle mr-2"></i>GENEL BİLGİLER
                    </h6>
                    
                    <div class="row mb-3">
                        <div class="col-md-6">
                            <div class="form-group mb-0">
                                <label class="text-secondary small font-weight-bold mb-1">İLGİLİ DOSYA</label>
                                <div class="d-flex align-items-center p-2 bg-white border rounded">
                                    <i class="fas fa-folder text-warning mr-3 fa-lg"></i>
                                    <span class="text-dark font-weight-bold">${relatedRecordTxt}</span>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-group mb-0">
                                <label class="text-secondary small font-weight-bold mb-1">İŞ TİPİ</label>
                                <div class="d-flex align-items-center p-2 bg-white border rounded">
                                    <i class="fas fa-tasks text-info mr-3 fa-lg"></i>
                                    <span class="text-dark">${taskTypeDisplay}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-md-4">
                            <div class="p-2 border rounded bg-light h-100">
                                <label class="text-secondary small font-weight-bold d-block mb-1">OPERASYONEL BİTİŞ</label>
                                <div class="text-dark"><i class="far fa-clock text-warning mr-2"></i>${this._formatDate(task.dueDate)}</div>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <div class="p-2 border rounded bg-light h-100">
                                <label class="text-secondary small font-weight-bold d-block mb-1">RESMİ BİTİŞ</label>
                                <div class="text-dark"><i class="far fa-calendar-check text-danger mr-2"></i>${this._formatDate(task.officialDueDate)}</div>
                            </div>
                        </div>
                        <div class="col-md-4">
                             <div class="p-2 border rounded bg-light h-100">
                                <label class="text-secondary small font-weight-bold d-block mb-1">ATANAN KİŞİ</label>
                                <div class="text-dark text-truncate"><i class="fas fa-user-circle text-primary mr-2"></i>${assignedName}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="mb-4">
                    <h6 class="border-bottom pb-2 mb-3 text-primary font-weight-bold" style="letter-spacing: 0.5px;">
                        <i class="fas fa-folder-open mr-2"></i>BELGELER
                    </h6>
                    ${docsContent}
                </div>

                <div class="mb-4">
                    <h6 class="border-bottom pb-2 mb-3 text-primary font-weight-bold" style="letter-spacing: 0.5px;">
                        <i class="fas fa-coins mr-2"></i>BAĞLI TAHAKKUKLAR
                    </h6>
                    ${accrualsHtml}
                </div>

                <div class="mb-3">
                     <h6 class="border-bottom pb-2 mb-3 text-primary font-weight-bold" style="letter-spacing: 0.5px;">
                        <i class="fas fa-align-left mr-2"></i>AÇIKLAMA & NOTLAR
                     </h6>
                     <div class="p-3 bg-light border rounded text-dark" style="min-height: 80px; white-space: pre-wrap; font-size: 0.95rem;">${task.description || '<span class="text-muted font-italic">Herhangi bir açıklama girilmemiş.</span>'}</div>
                </div>

            </div>`;

        this.container.innerHTML = html;
    }

    _generateDocsHtml(task) {
            let content = '';
            let hasContent = false;

            // 1. EPATS Belgesi (Varsa en üstte özel kart olarak göster)
            const epatsDoc = task.details?.epatsDocument;
            const epatsUrl = epatsDoc?.downloadURL || epatsDoc?.url;

            if (epatsDoc && epatsUrl) {
                hasContent = true;
                content += `
                <div class="alert alert-secondary d-flex align-items-center justify-content-between mb-3 shadow-sm" style="border-left: 4px solid #1e3c72; background-color: #f8f9fa;">
                    <div class="d-flex align-items-center">
                        <div class="text-center mr-3" style="width: 40px;">
                            <i class="fas fa-file-pdf text-danger fa-2x"></i>
                        </div>
                        <div>
                            <h6 class="mb-0 font-weight-bold text-dark">EPATS Belgesi</h6>
                            <small class="text-muted">${epatsDoc.name || 'İlgili Resmi Evrak'}</small>
                        </div>
                    </div>
                    <a href="${epatsUrl}" target="_blank" class="btn btn-sm btn-outline-primary shadow-sm rounded-pill px-3">
                        <i class="fas fa-external-link-alt mr-1"></i> Görüntüle
                    </a>
                </div>`;
            }

            // 2. Diğer Dosyaları Topla (Kapsamlı Tarama)
            let allFiles = [];

            // Helper: Dosyaları güvenli bir şekilde listeye ekler (Array veya Map olsa bile)
            const addFiles = (source) => {
                if (!source) return;
                if (Array.isArray(source)) {
                    allFiles.push(...source);
                } else if (typeof source === 'object') {
                    // Eğer Firebase array yerine map/obje {0:..., 1:...} döndürürse değerleri al
                    allFiles.push(...Object.values(source));
                }
            };

            // Veritabanındaki olası tüm dosya yollarını kontrol et
            if (task.details) {
                addFiles(task.details.documents); // Sizin veri yapınızdaki ana yol
                addFiles(task.details.files);     // Alternatif yol
            }
            addFiles(task.files);     // Eski yapı
            addFiles(task.documents); // Olası kök yapı

            // 3. Tekilleştirme (Aynı dosyanın tekrarını önle)
            const uniqueFiles = [];
            const seenUrls = new Set();

            if (epatsUrl) seenUrls.add(epatsUrl); // EPATS belgesini tekrar listede gösterme

            allFiles.forEach(file => {
                // URL alan adı farklı olabilir (downloadURL, url veya content)
                const fileUrl = file.downloadURL || file.url || file.content;
                
                // Eğer geçerli bir URL varsa ve daha önce eklenmediyse listeye al
                if (fileUrl && !seenUrls.has(fileUrl)) {
                    seenUrls.add(fileUrl);
                    uniqueFiles.push(file);
                }
            });

            // 4. Diğer Belgeleri Kart Olarak Listele
            if (uniqueFiles.length > 0) {
                hasContent = true;
                content += '<div class="row">';
                uniqueFiles.forEach(file => {
                    const fUrl = file.downloadURL || file.url || file.content;
                    const fName = file.name || 'Adsız Dosya';
                    const fType = file.documentDesignation || 'Ek Belge'; // Doküman türü (Örn: Diğer, Fatura vb.)
                    
                    content += `
                    <div class="col-md-6 mb-2">
                        <div class="d-flex justify-content-between align-items-center p-2 border rounded bg-white shadow-sm h-100">
                            <div class="d-flex align-items-center text-truncate overflow-hidden" style="max-width: 80%;">
                                <i class="fas fa-paperclip text-secondary mr-2"></i>
                                <div class="text-truncate">
                                    <span class="d-block small font-weight-bold text-dark text-truncate" title="${fName}">${fName}</span>
                                    <small class="text-muted" style="font-size: 0.75rem;">${fType}</small>
                                </div>
                            </div>
                            <a href="${fUrl}" target="_blank" class="btn btn-sm btn-light border text-primary ml-2">
                                <i class="fas fa-download"></i>
                            </a>
                        </div>
                    </div>`;
                });
                content += '</div>';
            }

            // Eğer hiç belge yoksa
            if (!hasContent) {
                return `<div class="p-3 bg-light border rounded text-center text-muted font-italic small">Bu göreve ekli belge bulunmamaktadır.</div>`;
            }
            
            return content;
        }

    _generateAccrualsHtml(accruals) {
        if (!accruals || accruals.length === 0) {
            return `<div class="p-3 bg-light border rounded text-center text-muted font-italic small">Bağlı tahakkuk bulunmamaktadır.</div>`;
        }

        const rows = accruals.map(acc => {
            const isPaid = acc.status === 'paid';
            const statusBadge = isPaid 
                ? `<span class="badge badge-success px-2">Ödendi</span>` 
                : `<span class="badge badge-warning px-2 text-white">Ödenmedi</span>`;
            
            return `
                <tr style="background: white;">
                    <td class="align-middle py-2 pl-3 border-bottom"><small class="text-muted">#${acc.id || '-'}</small></td>
                    <td class="align-middle py-2 border-bottom font-weight-bold text-dark">${this._formatCurrency(acc.totalAmount, acc.totalAmountCurrency)}</td>
                    <td class="align-middle py-2 border-bottom text-center">${statusBadge}</td>
                    <td class="align-middle py-2 border-bottom text-right pr-3 text-muted small">${this._formatDate(acc.createdAt)}</td>
                </tr>`;
        }).join('');

        return `
            <div class="border rounded overflow-hidden shadow-sm">
                <table class="table table-sm table-hover mb-0" style="background-color: #f8f9fa;">
                    <thead class="text-secondary small bg-light">
                        <tr>
                            <th class="pl-3 py-2 border-bottom border-top-0 border-0">ID</th>
                            <th class="py-2 border-bottom border-top-0 border-0">TUTAR</th>
                            <th class="py-2 border-bottom border-top-0 border-0 text-center">DURUM</th>
                            <th class="pr-3 py-2 border-bottom border-top-0 border-0 text-right">TARİH</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    _formatDate(dateVal) {
        if (!dateVal) return '-';
        // "2024-12-20" gibi string gelirse doğrudan işle
        if (typeof dateVal === 'string' && dateVal.includes('-')) {
             const parts = dateVal.split('T')[0].split('-'); // T varsa temizle
             if(parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`; // YYYY-MM-DD -> DD.MM.YYYY
        }
        
        try {
            const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
            return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('tr-TR');
        } catch(e) { return '-'; }
    }

    _formatCurrency(amount, currency) {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency || 'TRY' }).format(amount || 0);
    }
}