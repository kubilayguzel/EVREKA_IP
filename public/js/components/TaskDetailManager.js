// public/js/components/TaskDetailManager.js
import { getFirestore, doc, getDoc, updateDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const db = getFirestore();

export class TaskDetailManager {
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

        this.showLoading();

        try {
            // --- ID 66: DEĞERLENDİRME İŞİ KONTROLÜ ---
            if (String(task.taskType) === '66') {
                await this._renderEvaluationEditor(task);
                return;
            }

            let { ipRecord, transactionType, assignedUser, accruals = [] } = options;

            // 1. ADIM: IP RECORD'U GARANTİLE (Veritabanından Taze Çek)
            if (!ipRecord && task.relatedIpRecordId) {
                try {
                    const ipDoc = await getDoc(doc(db, "ipRecords", task.relatedIpRecordId));
                    if (ipDoc.exists()) {
                        ipRecord = { id: ipDoc.id, ...ipDoc.data() };
                    }
                } catch (e) { console.warn("IP Record fetch error:", e); }
            }

            // 2. ADIM: MÜVEKKİL / İLGİLİ TARAF İSMİNİ ÇÖZÜMLE
            // TaskUpdateDataManager mantığıyla aynı: ID'leri al -> Persons'dan sorgula -> İsimleri birleştir
            let relatedPartyTxt = '-';

            // A) Önce Task üzerindeki override bilgilerine bak
            if (task.details) {
                let parties = [];
                if (task.details.relatedParty) parties.push(task.details.relatedParty);
                else if (Array.isArray(task.details.relatedParties)) parties = task.details.relatedParties;
                
                if (parties.length > 0) {
                    // Eğer detaylarda isim zaten varsa direkt kullan
                    const manualNames = parties.map(p => (typeof p === 'object' ? (p.name || p.companyName) : p)).filter(Boolean);
                    if (manualNames.length > 0) relatedPartyTxt = manualNames.join(', ');
                }
            }

            // B) Eğer Task detayında yoksa, IP Record -> Applicants -> Persons Tablosu zincirini kur
            if ((!relatedPartyTxt || relatedPartyTxt === '-') && ipRecord && Array.isArray(ipRecord.applicants) && ipRecord.applicants.length > 0) {
                
                // Tüm applicants için asenkron sorguları hazırla
                const applicantPromises = ipRecord.applicants.map(async (app) => {
                    // 1. İsim direkt obje üzerindeyse kullan
                    if (app.name && app.name.trim() !== '') return app.name;
                    
                    // 2. ID varsa Persons tablosuna git
                    if (app.id) {
                        try {
                            const personSnap = await getDoc(doc(db, "persons", app.id));
                            if (personSnap.exists()) {
                                const pData = personSnap.data();
                                return pData.name || pData.companyName || null;
                            }
                        } catch (err) {
                            console.error(`Person fetch error for ID ${app.id}:`, err);
                        }
                    }
                    return null;
                });

                // Hepsini paralel çöz
                const resolvedNames = await Promise.all(applicantPromises);
                
                // Geçerli (null olmayan) isimleri filtrele ve birleştir
                const validNames = resolvedNames.filter(Boolean);
                if (validNames.length > 0) {
                    relatedPartyTxt = validNames.join(', ');
                }
            }

            // --- Diğer Verileri Hazırla ---
            const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : (task.assignedTo_email || 'Atanmamış');
            const relatedRecordTxt = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'İlgili kayıt bulunamadı';
            const taskTypeDisplay = transactionType ? (transactionType.alias || transactionType.name) : (task.taskType || '-');
            const statusText = this.statusDisplayMap[task.status] || task.status;

            // --- HTML GENERATION ---
            const cardStyle = `
                background: #ffffff; 
                padding: 25px; 
                border-radius: 12px; 
                box-shadow: 0 2px 8px rgba(0,0,0,0.05); 
                margin-bottom: 20px; 
                border: 1px solid #eaedf0;
            `;
            
            const titleStyle = `
                font-size: 1.1em; 
                color: #2c3e50; 
                margin-bottom: 20px; 
                padding-bottom: 10px; 
                border-bottom: 2px solid #f1f3f5; 
                font-weight: 700;
                display: flex; align-items: center;
            `;

            const labelStyle = `
                display: block; 
                margin-bottom: 6px; 
                color: #7f8c8d; 
                font-weight: 600; 
                font-size: 0.8rem; 
                text-transform: uppercase; 
                letter-spacing: 0.5px;
            `;

            const valueStyle = `
                font-size: 1rem; 
                font-weight: 500; 
                color: #2c3e50; 
                background: #f8f9fa; 
                padding: 10px 12px; 
                border-radius: 6px; 
                border: 1px solid #dfe6e9;
                min-height: 45px;
                display: flex; align-items: center;
            `;

            const accrualsHtml = this._generateAccrualsHtml(accruals);
            const docsContent = this._generateDocsHtml(task);

            const html = `
            <div class="container-fluid px-1 py-2" style="font-family: 'Segoe UI', sans-serif;">
                
                <div class="d-flex justify-content-between align-items-center p-4 mb-4 bg-white border rounded shadow-sm" style="border-left: 6px solid #1e3c72 !important;">
                    <div>
                        <h4 class="font-weight-bold text-dark mb-1">${task.title || 'Başlıksız Görev'}</h4>
                        <div class="d-flex align-items-center text-muted small">
                            <span class="mr-3"><i class="fas fa-hashtag mr-1"></i>${task.id}</span>
                            <span><i class="far fa-calendar-alt mr-1"></i>${this._formatDate(task.createdAt || new Date())}</span>
                        </div>
                    </div>
                    <div>
                        <span class="badge badge-pill px-3 py-2" style="font-size: 0.9rem; background-color: #e9ecef; color: #1e3c72; border: 1px solid #d0d6dd;">
                            ${statusText}
                        </span>
                    </div>
                </div>

                <div style="${cardStyle}; border-left: 5px solid #28a745;">
                    <h3 style="${titleStyle}"><i class="fas fa-user-friends mr-2 text-success"></i>İlgili Taraf / Müvekkil</h3>
                    
                    <div class="d-flex align-items-center">
                        <div class="bg-success text-white rounded-circle d-flex align-items-center justify-content-center shadow-sm mr-3" style="width: 50px; height: 50px; min-width:50px;">
                            <i class="fas fa-user-tie fa-lg"></i>
                        </div>
                        <div>
                            <span class="d-block text-muted small font-weight-bold text-uppercase" style="letter-spacing: 0.5px;">Dosya Sahibi</span>
                            <span class="font-weight-bold text-dark" style="font-size: 1.25rem;">${relatedPartyTxt}</span>
                        </div>
                    </div>
                </div>

                <div style="${cardStyle}">
                    <h3 style="${titleStyle}"><i class="fas fa-info-circle mr-2 text-primary"></i>Genel Bilgiler</h3>
                    
                    <div class="mb-4">
                        <label style="${labelStyle}">İLGİLİ VARLIK (DOSYA)</label>
                        <div class="p-3 bg-light border rounded d-flex align-items-center">
                            <div class="bg-white p-2 rounded border shadow-sm mr-3 text-primary">
                                <i class="fas fa-folder fa-lg"></i>
                            </div>
                            <span class="font-weight-bold text-dark" style="font-size: 1.1em;">${relatedRecordTxt}</span>
                        </div>
                    </div>

                    <div class="row mb-3">
                        <div class="col-md-6">
                            <label style="${labelStyle}">İş Tipi</label>
                            <div style="${valueStyle}">${taskTypeDisplay}</div>
                        </div>
                        <div class="col-md-6">
                            <label style="${labelStyle}">Atanan Kişi</label>
                            <div style="${valueStyle}">
                                <i class="fas fa-user-circle mr-2 text-secondary"></i>${assignedName}
                            </div>
                        </div>
                    </div>

                    <div class="row mb-3">
                        <div class="col-md-6">
                            <label style="${labelStyle}">Operasyonel Bitiş</label>
                            <div style="${valueStyle}">
                                <i class="far fa-clock mr-2 text-warning"></i>${this._formatDate(task.dueDate)}
                            </div>
                        </div>
                        <div class="col-md-6">
                            <label style="${labelStyle}">Resmi Bitiş</label>
                            <div style="${valueStyle}">
                                <i class="fas fa-calendar-check mr-2 text-danger"></i>${this._formatDate(task.officialDueDate)}
                            </div>
                        </div>
                    </div>

                    <div class="mb-0">
                        <label style="${labelStyle}">Açıklama</label>
                        <div style="${valueStyle}; height: auto; align-items: flex-start; min-height: 80px; white-space: pre-wrap;">${task.description || 'Açıklama girilmemiş.'}</div>
                    </div>
                </div>

                <div style="${cardStyle}">
                    <h3 style="${titleStyle}"><i class="fas fa-folder-open mr-2 text-warning"></i>Belgeler</h3>
                    ${docsContent}
                </div>

                <div style="${cardStyle}">
                    <h3 style="${titleStyle}"><i class="fas fa-file-invoice-dollar mr-2 text-success"></i>Finansal Hareketler</h3>
                    ${accrualsHtml}
                </div>

            </div>`;

            this.container.innerHTML = html;

        } catch (error) {
            console.error("Render hatası:", error);
            this.showError("Detaylar yüklenirken bir hata oluştu: " + error.message);
        }
    }

    // =========================================================================
    //  ID 66: GÖRSEL MAİL DEĞERLENDİRME EDİTÖRÜ
    // =========================================================================
    async _renderEvaluationEditor(task) {
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
            <div class="d-flex align-items-center justify-content-between p-3 mb-3 rounded" style="background-color: #fff0f6; border: 1px solid #f8ccde;">
                <div class="d-flex align-items-center">
                    <div class="bg-white p-2 rounded-circle mr-3 border">
                        <i class="fas fa-file-signature text-danger fa-lg" style="color: #d63384 !important;"></i>
                    </div>
                    <div>
                        <h6 class="mb-0 font-weight-bold text-dark" style="color: #d63384 !important;">EPATS Belgesi</h6>
                        <small class="text-muted">${epatsDoc.name || 'Resmi Evrak'}</small>
                    </div>
                </div>
                <a href="${epatsUrl}" target="_blank" class="btn btn-sm btn-outline-danger shadow-sm px-3" style="border-color: #d63384; color: #d63384;">Aç</a>
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
        if (!accruals || accruals.length === 0) return `<div class="text-center text-muted small py-3 bg-light rounded">Tahakkuk yok.</div>`;
        return accruals.map(acc => {
            let badgeClass = 'badge-warning';
            let badgeText = 'Ödenmedi';
            if(acc.status === 'paid') { badgeClass = 'badge-success'; badgeText = 'Ödendi'; }
            else if(acc.status === 'cancelled') { badgeClass = 'badge-secondary'; badgeText = 'İptal'; }

            return `
            <div class="d-flex justify-content-between align-items-center p-2 mb-2 border rounded bg-white">
                <div>
                    <span class="d-block font-weight-bold text-dark small">#${acc.id}</span>
                    <span class="badge ${badgeClass}" style="font-size: 0.7rem;">${badgeText}</span>
                </div>
                <div class="text-right">
                    <span class="d-block font-weight-bold text-primary">${this._formatCurrency(acc.totalAmount, acc.totalAmountCurrency)}</span>
                    <small class="text-muted">${this._formatDate(acc.createdAt)}</small>
                </div>
            </div>`;
        }).join('');
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