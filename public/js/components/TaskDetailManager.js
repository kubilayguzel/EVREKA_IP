// public/js/components/TaskDetailManager.js
import { getFirestore, doc, getDoc, updateDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const db = getFirestore();

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

    async render(task, options = {}) {
        if (!this.container) return;
        if (!task) { this.showError('İş kaydı bulunamadı.'); return; }

        // Yükleniyor göster (Asenkron işlemler olacağı için)
        this.showLoading();

        try {
            // --- ID 66: DEĞERLENDİRME İŞİ KONTROLÜ ---
            if (String(task.taskType) === '66') {
                await this._renderEvaluationEditor(task);
                return;
            }

            const { ipRecord, transactionType, assignedUser, accruals = [] } = options;

            // --- Veri Hazırlığı ---
            const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : (task.assignedTo_email || 'Atanmamış');
            const relatedRecordTxt = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'İlgili kayıt bulunamadı';
            const taskTypeDisplay = transactionType ? (transactionType.alias || transactionType.name) : (task.taskType || '-');
            const statusText = this.statusDisplayMap[task.status] || task.status;

            const isCompleted = task.status === 'completed';
            const statusColorClass = isCompleted ? 'text-success' : 'text-primary';

            // --- [GÜNCELLEME] İLGİLİ TARAF BELİRLEME MANTIĞI (DB Fetch Ekli) ---
            let relatedPartyTxt = null;

            // 1. Öncelik: Task Details içindeki veriler
            if (task.details) {
                let parties = [];
                if (task.details.relatedParty) {
                    parties.push(task.details.relatedParty);
                } else if (Array.isArray(task.details.relatedParties)) {
                    parties = task.details.relatedParties;
                }
                
                if (parties.length > 0) {
                    relatedPartyTxt = parties.map(p => {
                        if (typeof p === 'object') return p.name || p.companyName || '-';
                        return p;
                    }).join(', ');
                }
            }

            // 2. Öncelik: Eğer task içinde yoksa, IP Record (Applicant) bilgisi
            if ((!relatedPartyTxt || relatedPartyTxt === '-') && ipRecord && Array.isArray(ipRecord.applicants) && ipRecord.applicants.length > 0) {
                // Applicants dizisindeki ID'leri kullanarak Persons tablosundan isimleri çek
                const applicantNames = [];
                
                for (const app of ipRecord.applicants) {
                    // Eğer 'name' alanı zaten doluysa onu kullan
                    if (app.name) {
                        applicantNames.push(app.name);
                    } 
                    // 'id' varsa Persons tablosuna git
                    else if (app.id) {
                        try {
                            const personDoc = await getDoc(doc(db, "persons", app.id));
                            if (personDoc.exists()) {
                                const pData = personDoc.data();
                                applicantNames.push(pData.name || pData.companyName || '-');
                            }
                        } catch (e) {
                            console.warn("Kişi bilgisi çekilemedi:", app.id, e);
                        }
                    }
                }

                if (applicantNames.length > 0) {
                    relatedPartyTxt = applicantNames.join(', ');
                }
            }

            // 3. Sonuç yoksa varsayılan
            if (!relatedPartyTxt) relatedPartyTxt = '-';
            // -------------------------------------------------------------------

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
                        <h6 class="border-bottom pb-2 mb-3 text-success font-weight-bold">
                            <i class="fas fa-user-friends mr-2"></i>MÜVEKKİL / İLGİLİ TARAF
                        </h6>
                        <div class="p-3 bg-white border rounded shadow-sm d-flex align-items-center">
                            <div class="mr-3 bg-success text-white rounded-circle d-flex align-items-center justify-content-center" style="width: 45px; height: 45px;">
                                <i class="fas fa-user fa-lg"></i>
                            </div>
                            <div>
                                <span class="d-block text-muted small font-weight-bold text-uppercase">Taraf Bilgisi</span>
                                <span class="text-dark font-weight-bold" style="font-size: 1.1rem;">${relatedPartyTxt}</span>
                            </div>
                        </div>
                    </div>

                    <div class="mb-4">
                        <h6 class="border-bottom pb-2 mb-3 text-primary font-weight-bold">
                            <i class="fas fa-info-circle mr-2"></i>GENEL BİLGİLER
                        </h6>
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="text-secondary small font-weight-bold mb-1">İLGİLİ DOSYA</label>
                                <div class="d-flex align-items-center p-2 bg-white border rounded h-100">
                                    <i class="fas fa-folder text-warning mr-3 fa-lg"></i>
                                    <span class="text-dark font-weight-bold text-truncate" title="${relatedRecordTxt}">${relatedRecordTxt}</span>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <label class="text-secondary small font-weight-bold mb-1">İŞ TİPİ</label>
                                <div class="d-flex align-items-center p-2 bg-white border rounded h-100">
                                    <i class="fas fa-tasks text-info mr-3 fa-lg"></i>
                                    <span class="text-dark text-truncate" title="${taskTypeDisplay}">${taskTypeDisplay}</span>
                                </div>
                            </div>
                        </div>
                        <div class="row">
                            <div class="col-md-4"><div class="p-2 border rounded bg-light h-100"><label class="small font-weight-bold d-block">OPERASYONEL BİTİŞ</label>${this._formatDate(task.dueDate)}</div></div>
                            <div class="col-md-4"><div class="p-2 border rounded bg-light h-100"><label class="small font-weight-bold d-block">RESMİ BİTİŞ</label>${this._formatDate(task.officialDueDate)}</div></div>
                            <div class="col-md-4"><div class="p-2 border rounded bg-light h-100"><label class="small font-weight-bold d-block">ATANAN KİŞİ</label>${assignedName}</div></div>
                        </div>
                    </div>

                    <div class="mb-4">
                        <h6 class="border-bottom pb-2 mb-3 text-primary font-weight-bold"><i class="fas fa-folder-open mr-2"></i>BELGELER</h6>
                        ${docsContent}
                    </div>

                    <div class="mb-4">
                        <h6 class="border-bottom pb-2 mb-3 text-primary font-weight-bold"><i class="fas fa-coins mr-2"></i>BAĞLI TAHAKKUKLAR</h6>
                        ${accrualsHtml}
                    </div>

                    <div class="mb-3">
                         <h6 class="border-bottom pb-2 mb-3 text-primary font-weight-bold"><i class="fas fa-align-left mr-2"></i>AÇIKLAMA & NOTLAR</h6>
                         <div class="p-3 bg-light border rounded text-dark" style="min-height: 80px; white-space: pre-wrap;">${task.description || 'Açıklama girilmemiş.'}</div>
                    </div>
                </div>`;

            this.container.innerHTML = html;
        } catch (error) {
            console.error("Render hatası:", error);
            this.showError("Detaylar yüklenirken bir hata oluştu: " + error.message);
        }
    }

    // =========================================================================
    //  ID 66: GÖRSEL MAİL DEĞERLENDİRME EDİTÖRÜ (AYNEN KORUNDU)
    // =========================================================================
    async _renderEvaluationEditor(task) {
        // Not: render fonksiyonu içinde showLoading() zaten çağrılıyor.
        try {
            const mailSnap = await getDoc(doc(db, "mail_notifications", task.mail_notification_id));
            if (!mailSnap.exists()) throw new Error("İlişkili mail taslağı bulunamadı.");
            const mail = mailSnap.data();

            let attachmentsHtml = '';
            const attachments = [];

            if (mail.epatsAttachment && (mail.epatsAttachment.downloadURL || mail.epatsAttachment.url)) {
                attachments.push({
                    name: mail.epatsAttachment.fileName || 'EPATS Belgesi.pdf',
                    url: mail.epatsAttachment.downloadURL || mail.epatsAttachment.url,
                    icon: 'fa-file-pdf',
                    color: 'text-danger',
                    label: 'RESMİ EPATS BELGESİ'
                });
            }

            if (mail.supplementaryAttachment && (mail.supplementaryAttachment.downloadURL || mail.supplementaryAttachment.url)) {
                attachments.push({
                    name: mail.supplementaryAttachment.fileName || 'Ek Belge',
                    url: mail.supplementaryAttachment.downloadURL || mail.supplementaryAttachment.url,
                    icon: 'fa-paperclip',
                    color: 'text-primary',
                    label: 'EK DOSYA (Dilekçe vb.)'
                });
            }

            if (mail.files && Array.isArray(mail.files)) {
                mail.files.forEach(f => {
                    const fUrl = f.url || f.downloadURL;
                    const isDuplicate = attachments.some(existing => existing.url === fUrl);
                    if (fUrl && !isDuplicate) {
                        attachments.push({
                            name: f.name || f.fileName || 'Dosya',
                            url: fUrl,
                            icon: 'fa-file-alt',
                            color: 'text-secondary',
                            label: 'EKLENTİ'
                        });
                    }
                });
            }

            if (attachments.length > 0) {
                const filesList = attachments.map(file => `
                    <div class="col-md-6 mb-2">
                        <div class="d-flex align-items-center justify-content-between p-2 bg-white border rounded shadow-sm h-100">
                            <div class="d-flex align-items-center overflow-hidden">
                                <i class="fas ${file.icon} ${file.color} fa-2x mr-3"></i>
                                <div class="text-truncate">
                                    <small class="text-muted font-weight-bold d-block" style="font-size: 0.7rem;">${file.label}</small>
                                    <span class="text-dark font-weight-bold text-truncate d-block" style="max-width: 200px;" title="${file.name}">${file.name}</span>
                                </div>
                            </div>
                            <a href="${file.url}" target="_blank" class="btn btn-sm btn-outline-primary rounded-pill px-3 ml-2">
                                <i class="fas fa-eye mr-1"></i>Görüntüle
                            </a>
                        </div>
                    </div>
                `).join('');

                attachmentsHtml = `
                    <div class="mb-3 p-3 bg-light border rounded" style="border-left: 4px solid #17a2b8 !important;">
                        <label class="text-info small font-weight-bold text-uppercase mb-2"><i class="fas fa-paperclip mr-1"></i>Bu Maile Eklenecek Dosyalar</label>
                        <div class="row">
                            ${filesList}
                        </div>
                    </div>
                `;
            }

            this.container.innerHTML = `
                <div class="card shadow-sm border-primary">
                    <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
                        <h5 class="mb-0"><i class="fas fa-edit mr-2"></i>Mail Bildirim Değerlendirmesi</h5>
                        <span class="badge badge-light text-primary font-weight-bold">İŞ ID: ${task.id}</span>
                    </div>
                    <div class="card-body bg-light">
                        <div class="alert alert-info py-2 small mb-3">
                            <i class="fas fa-info-circle mr-1"></i> Mail içeriği aşağıda sunulmuştur. Metinleri düzenleyebilir ve ekli dosyaları kontrol edebilirsiniz.
                        </div>
                        ${attachmentsHtml}
                        <div class="form-group bg-white p-3 border rounded shadow-sm mb-3">
                            <label class="text-muted small font-weight-bold text-uppercase">Mail Konusu</label>
                            <input type="text" class="form-control border-0 font-weight-bold p-0" style="font-size: 1.1rem; height: auto;" value="${mail.subject}" readonly>
                        </div>
                        <div id="eval-body-editor" contenteditable="true" class="bg-white p-4 border rounded shadow-sm" style="min-height: 500px; max-height: 700px; overflow-y: auto; outline: none; border: 1px solid #ced4da !important; background: white !important; color: #333 !important; font-family: Arial, sans-serif;">${mail.body}</div>
                        <div class="text-right mt-4">
                            <button id="btn-save-eval" class="btn btn-success btn-lg px-5 shadow-sm rounded-pill">
                                <i class="fas fa-check-circle mr-2"></i>Değerlendirmeyi Tamamla ve Onaya Gönder
                            </button>
                        </div>
                    </div>
                </div>
            `;
            document.getElementById('btn-save-eval').onclick = () => this._submitEvaluation(task);
        } catch (e) { 
            console.error("Evaluation render error:", e);
            this.showError("Taslak yüklenirken hata oluştu: " + e.message); 
        }
    }

    async _submitEvaluation(task) {
        const newBody = document.getElementById('eval-body-editor').innerHTML;
        
        try {
            const btn = document.getElementById('btn-save-eval');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Kaydediliyor...';

            await updateDoc(doc(db, "mail_notifications", task.mail_notification_id), {
                body: newBody,
                status: "awaiting_client_approval",
                updatedAt: Timestamp.now()
            });

            await updateDoc(doc(db, "tasks", task.id), {
                status: "completed",
                updatedAt: Timestamp.now()
            });

            alert("Değerlendirme başarıyla kaydedildi. Mail 'Onay Bekliyor' listesine aktarıldı.");
            window.location.reload();
        } catch (e) { 
            alert("Güncelleme sırasında bir hata oluştu: " + e.message); 
            document.getElementById('btn-save-eval').disabled = false;
        }
    }

    // =========================================================================
    //  YARDIMCI METODLAR
    // =========================================================================
    _generateDocsHtml(task) {
        let content = '';
        let hasContent = false;
        const epatsDoc = task.details?.epatsDocument;
        const epatsUrl = epatsDoc?.downloadURL || epatsDoc?.url;

        if (epatsDoc && epatsUrl) {
            hasContent = true;
            content += `
            <div class="alert alert-secondary d-flex align-items-center justify-content-between mb-3 shadow-sm" style="border-left: 4px solid #1e3c72; background-color: #f8f9fa;">
                <div class="d-flex align-items-center">
                    <i class="fas fa-file-pdf text-danger fa-2x mr-3"></i>
                    <div>
                        <h6 class="mb-0 font-weight-bold text-dark">EPATS Belgesi</h6>
                        <small class="text-muted">${epatsDoc.name || 'İlgili Resmi Evrak'}</small>
                    </div>
                </div>
                <a href="${epatsUrl}" target="_blank" class="btn btn-sm btn-outline-primary shadow-sm rounded-pill px-3">Görüntüle</a>
            </div>`;
        }

        let allFiles = [];
        const addFiles = (source) => {
            if (!source) return;
            if (Array.isArray(source)) allFiles.push(...source);
            else if (typeof source === 'object') allFiles.push(...Object.values(source));
        };

        if (task.details) { addFiles(task.details.documents); addFiles(task.details.files); }
        addFiles(task.files); addFiles(task.documents);

        const uniqueFiles = [];
        const seenUrls = new Set();
        if (epatsUrl) seenUrls.add(epatsUrl);
        allFiles.forEach(file => {
            const fileUrl = file.downloadURL || file.url || file.content;
            if (fileUrl && !seenUrls.has(fileUrl)) { seenUrls.add(fileUrl); uniqueFiles.push(file); }
        });

        if (uniqueFiles.length > 0) {
            hasContent = true;
            content += '<div class="row">';
            uniqueFiles.forEach(file => {
                const fUrl = file.downloadURL || file.url || file.content;
                content += `
                <div class="col-md-6 mb-2">
                    <div class="d-flex justify-content-between align-items-center p-2 border rounded bg-white shadow-sm h-100">
                        <div class="d-flex align-items-center text-truncate">
                            <i class="fas fa-paperclip text-secondary mr-2"></i>
                            <span class="small font-weight-bold text-dark text-truncate">${file.name || 'Adsız Dosya'}</span>
                        </div>
                        <a href="${fUrl}" target="_blank" class="btn btn-sm btn-light border text-primary ml-2"><i class="fas fa-download"></i></a>
                    </div>
                </div>`;
            });
            content += '</div>';
        }
        return hasContent ? content : `<div class="p-3 bg-light border rounded text-center text-muted font-italic small">Belge bulunmamaktadır.</div>`;
    }

    _generateAccrualsHtml(accruals) {
        if (!accruals || accruals.length === 0) return `<div class="p-3 bg-light border rounded text-center text-muted font-italic small">Bağlı tahakkuk bulunmamaktadır.</div>`;
        const rows = accruals.map(acc => {
            let badge = '';
            switch (acc.status) {
                case 'paid': badge = `<span class="badge badge-success px-2">Ödendi</span>`; break;
                case 'partially_paid': badge = `<span class="badge badge-info px-2 text-white">Kısmi</span>`; break;
                case 'cancelled': badge = `<span class="badge badge-secondary px-2">İptal</span>`; break;
                default: badge = `<span class="badge badge-warning px-2 text-white">Ödenmedi</span>`;
            }
            return `
                <tr>
                    <td class="py-2 pl-3 border-bottom"><small>#${acc.id || '-'}</small></td>
                    <td class="py-2 border-bottom font-weight-bold">${this._formatCurrency(acc.totalAmount, acc.totalAmountCurrency)}</td>
                    <td class="py-2 border-bottom text-center">${badge}</td>
                    <td class="py-2 border-bottom text-right pr-3 text-muted small">${this._formatDate(acc.createdAt)}</td>
                </tr>`;
        }).join('');
        return `<div class="border rounded overflow-hidden shadow-sm"><table class="table table-sm table-hover mb-0" style="background-color: #f8f9fa;"><tbody>${rows}</tbody></table></div>`;
    }

    _formatDate(dateVal) {
        if (!dateVal) return '-';
        if (typeof dateVal === 'string' && dateVal.includes('-')) {
            const parts = dateVal.split('T')[0].split('-'); 
            if(parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`; 
        }
        try { const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal); return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('tr-TR'); } catch(e) { return '-'; }
    }

    _formatCurrency(amount, currency) {
        if (Array.isArray(amount)) {
            return amount.map(item => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: item.currency || 'TRY' }).format(item.amount || 0)).join('<br>');
        }
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency || 'TRY' }).format(amount || 0);
    }
}