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
                <div class="spinner-border text-primary mb-3" role="status"></div>
                <h6 class="text-muted font-weight-normal">Veriler yükleniyor...</h6>
            </div>`;
    }

    showError(message) {
        if (!this.container) return;
        this.container.innerHTML = `
            <div class="alert alert-light border-danger text-danger d-flex align-items-center m-3 shadow-sm" role="alert">
                <i class="fas fa-exclamation-circle mr-3 fa-lg"></i>
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

            // 1. ADIM: IP RECORD'U GARANTİLE
            if (!ipRecord && task.relatedIpRecordId) {
                try {
                    const ipDoc = await getDoc(doc(db, "ipRecords", task.relatedIpRecordId));
                    if (ipDoc.exists()) {
                        ipRecord = { id: ipDoc.id, ...ipDoc.data() };
                    }
                } catch (e) { console.warn("IP Record fetch error:", e); }
            }

            // 2. ADIM: MÜVEKKİL / İLGİLİ TARAF İSMİNİ ÇÖZÜMLE
            let relatedPartyTxt = '-';

            // A) Task Details
            if (task.details) {
                let parties = [];
                if (task.details.relatedParty) parties.push(task.details.relatedParty);
                else if (Array.isArray(task.details.relatedParties)) parties = task.details.relatedParties;
                
                if (parties.length > 0) {
                    const manualNames = parties.map(p => (typeof p === 'object' ? (p.name || p.companyName) : p)).filter(Boolean);
                    if (manualNames.length > 0) relatedPartyTxt = manualNames.join(', ');
                }
            }

            // B) IP Record -> Applicants -> Persons Tablosu
            if ((!relatedPartyTxt || relatedPartyTxt === '-') && ipRecord && Array.isArray(ipRecord.applicants) && ipRecord.applicants.length > 0) {
                const applicantPromises = ipRecord.applicants.map(async (app) => {
                    if (app.name && app.name.trim() !== '') return app.name;
                    if (app.id) {
                        try {
                            const personSnap = await getDoc(doc(db, "persons", app.id));
                            if (personSnap.exists()) {
                                const pData = personSnap.data();
                                return pData.name || pData.companyName || null;
                            }
                        } catch (err) {}
                    }
                    return null;
                });
                const resolvedNames = await Promise.all(applicantPromises);
                const validNames = resolvedNames.filter(Boolean);
                if (validNames.length > 0) relatedPartyTxt = validNames.join(', ');
            }

            // --- Veri Formatlama ---
            const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : (task.assignedTo_email || 'Atanmamış');
            const relatedRecordTxt = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'İlgili kayıt bulunamadı';
            const taskTypeDisplay = transactionType ? (transactionType.alias || transactionType.name) : (task.taskType || '-');
            const statusText = this.statusDisplayMap[task.status] || task.status;

            // --- CSS STYLES (Belirgin Kartlar) ---
            const styles = {
                container: `font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #333; background-color: #f8f9fa; padding: 20px;`,
                
                // Kart: Beyaz, belirgin gölge, yuvarlak köşe
                card: `
                    background: #fff;
                    border-radius: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.1);
                    margin-bottom: 24px;
                    overflow: hidden; /* Kenarlık şeridi için */
                    position: relative;
                `,
                
                // Başlık: Renkli ikonlu, daha büyük
                cardHeader: `
                    padding: 16px 24px;
                    border-bottom: 1px solid #f0f0f0;
                    display: flex;
                    align-items: center;
                    font-size: 1.1rem;
                    font-weight: 700;
                    color: #2c3e50;
                `,

                cardBody: `
                    padding: 24px;
                `,
                
                label: `
                    display: block;
                    font-size: 0.75rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: #95a5a6;
                    margin-bottom: 6px;
                    letter-spacing: 0.5px;
                `,
                
                valueBox: `
                    background: #fdfdfd;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    padding: 12px 16px;
                    font-size: 0.95rem;
                    font-weight: 500;
                    color: #2d3748;
                    display: flex;
                    align-items: center;
                    min-height: 48px;
                `
            };

            const accrualsHtml = this._generateAccrualsHtml(accruals);
            const docsContent = this._generateDocsHtml(task);

            const html = `
            <div style="${styles.container}">
                
                <div style="${styles.card} padding: 20px; border-left: 6px solid #2c3e50;">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h4 class="font-weight-bold text-dark mb-1" style="font-size: 1.4rem;">${task.title || 'Başlıksız Görev'}</h4>
                            <div class="text-muted small d-flex align-items-center">
                                <span class="badge badge-light border mr-2">ID: ${task.id}</span>
                                <span><i class="far fa-clock mr-1"></i>${this._formatDate(task.createdAt)}</span>
                            </div>
                        </div>
                        <span class="badge badge-pill px-3 py-2 text-white" style="font-size: 0.9rem; background-color: #2c3e50;">
                            ${statusText}
                        </span>
                    </div>
                </div>

                <div style="${styles.card} border-top: 4px solid #27ae60;">
                    <div style="${styles.cardHeader}">
                        <div class="bg-success text-white rounded-circle d-flex align-items-center justify-content-center mr-3" style="width:36px; height:36px;">
                            <i class="fas fa-user-friends fa-sm"></i>
                        </div>
                        MÜVEKKİL / İLGİLİ TARAF
                    </div>
                    <div style="${styles.cardBody}">
                        <div class="d-flex align-items-center p-3 rounded" style="background-color: #f0fff4; border: 1px solid #c6f6d5;">
                            <i class="fas fa-user-tie text-success fa-2x mr-3"></i>
                            <div>
                                <span class="d-block text-success small font-weight-bold text-uppercase">Dosya Sahibi</span>
                                <span class="font-weight-bold text-dark" style="font-size: 1.2rem;">${relatedPartyTxt}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="${styles.card} border-top: 4px solid #3498db;">
                    <div style="${styles.cardHeader}">
                        <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center mr-3" style="width:36px; height:36px;">
                            <i class="fas fa-info fa-sm"></i>
                        </div>
                        GENEL BİLGİLER
                    </div>
                    <div style="${styles.cardBody}">
                        
                        <div class="mb-4">
                            <label style="${styles.label}">İLGİLİ VARLIK (DOSYA)</label>
                            <div style="${styles.valueBox} border-left: 4px solid #3498db;">
                                 <i class="fas fa-folder text-primary mr-3 fa-lg"></i>
                                 <span style="font-size: 1.1rem; font-weight: 600;">${relatedRecordTxt}</span>
                            </div>
                        </div>

                        <div class="row">
                            <div class="col-md-4 mb-4">
                                <label style="${styles.label}">İŞ TİPİ</label>
                                <div style="${styles.valueBox}">${taskTypeDisplay}</div>
                            </div>
                            <div class="col-md-4 mb-4">
                                <label style="${styles.label}">ATANAN KİŞİ</label>
                                <div style="${styles.valueBox}">
                                    <i class="fas fa-user-circle mr-2 text-secondary"></i>${assignedName}
                                </div>
                            </div>
                            <div class="col-md-4 mb-4">
                                <label style="${styles.label}">RESMİ BİTİŞ</label>
                                <div style="${styles.valueBox}">
                                    <i class="fas fa-calendar-alt mr-2 text-danger"></i>
                                    <span class="${task.officialDueDate ? '' : 'text-muted'}">
                                        ${this._formatDate(task.officialDueDate)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label style="${styles.label}">AÇIKLAMA</label>
                            <div style="${styles.valueBox} height: auto; align-items: flex-start; min-height: 80px; white-space: pre-wrap; line-height: 1.6;">${task.description || 'Açıklama girilmemiş.'}</div>
                        </div>
                    </div>
                </div>

                <div style="${styles.card} border-top: 4px solid #f1c40f;">
                    <div style="${styles.cardHeader}">
                        <div class="bg-warning text-white rounded-circle d-flex align-items-center justify-content-center mr-3" style="width:36px; height:36px;">
                            <i class="fas fa-folder-open fa-sm"></i>
                        </div>
                        BELGELER
                    </div>
                    <div style="${styles.cardBody}">
                        ${docsContent}
                    </div>
                </div>

                <div style="${styles.card} border-top: 4px solid #9b59b6; margin-bottom: 0;">
                    <div style="${styles.cardHeader}">
                        <div class="text-white rounded-circle d-flex align-items-center justify-content-center mr-3" style="width:36px; height:36px; background-color: #9b59b6;">
                            <i class="fas fa-coins fa-sm"></i>
                        </div>
                        FİNANSAL HAREKETLER (TAHAKKUKLAR)
                    </div>
                    <div style="${styles.cardBody}">
                        ${accrualsHtml}
                    </div>
                </div>

            </div>`;

            this.container.innerHTML = html;

        } catch (error) {
            console.error("Render hatası:", error);
            this.showError("Detaylar yüklenirken bir hata oluştu: " + error.message);
        }
    }

    // =========================================================================
    //  ID 66: GÖRSEL MAİL DEĞERLENDİRME EDİTÖRÜ (Aynen Korundu)
    // =========================================================================
    async _renderEvaluationEditor(task) {
        try {
            const mailSnap = await getDoc(doc(db, "mail_notifications", task.mail_notification_id));
            if (!mailSnap.exists()) throw new Error("İlişkili mail taslağı bulunamadı.");
            const mail = mailSnap.data();

            let attachmentsHtml = '';
            // (Dosya listesi oluşturma kodu buraya gelecek - önceki versiyonla aynı)
            
            this.container.innerHTML = `
                <div class="card shadow-sm border-0">
                    <div class="card-header bg-white border-bottom">
                        <h5 class="mb-0 text-dark">Mail Bildirim Değerlendirmesi</h5>
                    </div>
                    <div class="card-body">
                        <div class="mb-3">
                            <label class="small text-muted font-weight-bold">KONU</label>
                            <input type="text" class="form-control" value="${mail.subject}" readonly style="font-weight:600;">
                        </div>
                        <div class="mb-3">
                             <label class="small text-muted font-weight-bold">İÇERİK</label>
                             <div id="eval-body-editor" contenteditable="true" class="form-control" style="min-height: 400px; height: auto;">${mail.body}</div>
                        </div>
                        <button id="btn-save-eval" class="btn btn-dark px-4">Onayla ve Tamamla</button>
                    </div>
                </div>
            `;
            document.getElementById('btn-save-eval').onclick = () => this._submitEvaluation(task);
        } catch (e) { this.showError(e.message); }
    }

    async _submitEvaluation(task) {
        const newBody = document.getElementById('eval-body-editor').innerHTML;
        try {
            const btn = document.getElementById('btn-save-eval');
            btn.disabled = true; btn.innerHTML = 'Kaydediliyor...';
            await updateDoc(doc(db, "mail_notifications", task.mail_notification_id), {
                body: newBody, status: "awaiting_client_approval", updatedAt: Timestamp.now()
            });
            await updateDoc(doc(db, "tasks", task.id), { status: "completed", updatedAt: Timestamp.now() });
            alert("Değerlendirme başarıyla kaydedildi."); window.location.reload();
        } catch (e) { alert("Hata: " + e.message); }
    }

    // =========================================================================
    //  YARDIMCI METODLAR (Modern Liste Görünümü)
    // =========================================================================
    _generateDocsHtml(task) {
        let items = [];
        const epatsDoc = task.details?.epatsDocument;
        const epatsUrl = epatsDoc?.downloadURL || epatsDoc?.url;

        // EPATS: Kırmızı Vurgulu Satır
        if (epatsDoc && epatsUrl) {
            items.push(`
                <div class="d-flex align-items-center justify-content-between p-3 mb-2 rounded bg-white border" style="border-left: 4px solid #e74c3c !important;">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-file-pdf text-danger fa-lg mr-3"></i>
                        <div>
                            <strong class="d-block text-dark" style="font-size: 0.95rem;">EPATS Belgesi</strong>
                            <small class="text-muted">${epatsDoc.name || 'Resmi Evrak'}</small>
                        </div>
                    </div>
                    <a href="${epatsUrl}" target="_blank" class="btn btn-sm btn-outline-danger">Görüntüle</a>
                </div>
            `);
        }

        // Diğer Dosyalar
        let allFiles = [];
        const addFiles = (source) => {
            if (!source) return;
            if (Array.isArray(source)) allFiles.push(...source);
            else if (typeof source === 'object') allFiles.push(...Object.values(source));
        };
        if (task.details) { addFiles(task.details.documents); addFiles(task.details.files); }
        addFiles(task.files); addFiles(task.documents);

        const seenUrls = new Set();
        if (epatsUrl) seenUrls.add(epatsUrl);

        allFiles.forEach(file => {
            const fUrl = file.downloadURL || file.url || file.content;
            if (fUrl && !seenUrls.has(fUrl)) {
                seenUrls.add(fUrl);
                items.push(`
                    <div class="d-flex align-items-center justify-content-between p-3 mb-2 rounded bg-white border" style="border-left: 4px solid #f1c40f !important;">
                        <div class="d-flex align-items-center overflow-hidden">
                            <i class="fas fa-paperclip text-warning fa-lg mr-3"></i>
                            <div class="text-truncate" style="max-width: 250px;">
                                <strong class="d-block text-dark" style="font-size: 0.95rem;">Dosya</strong>
                                <small class="text-muted text-truncate d-block">${file.name || 'Adsız'}</small>
                            </div>
                        </div>
                        <a href="${fUrl}" target="_blank" class="btn btn-sm btn-outline-secondary">İndir</a>
                    </div>
                `);
            }
        });

        return items.length ? items.join('') : `<div class="alert alert-light text-center text-muted small">Bu görevde ekli belge bulunmuyor.</div>`;
    }

    _generateAccrualsHtml(accruals) {
        if (!accruals || accruals.length === 0) return `<div class="alert alert-light text-center text-muted small">Bağlı tahakkuk bulunmuyor.</div>`;
        return accruals.map(acc => {
            let statusColor = '#f39c12'; // Bekliyor (Turuncu)
            let statusText = 'Ödenmedi';
            let icon = 'fa-clock';

            if(acc.status === 'paid') { 
                statusColor = '#27ae60'; statusText = 'Ödendi'; icon = 'fa-check-circle';
            } else if(acc.status === 'cancelled') { 
                statusColor = '#95a5a6'; statusText = 'İptal'; icon = 'fa-ban';
            }

            return `
            <div class="d-flex justify-content-between align-items-center p-3 mb-2 rounded bg-white border" style="border-left: 4px solid ${statusColor} !important;">
                <div class="d-flex align-items-center">
                    <div class="mr-3 text-center" style="width: 40px;">
                        <i class="fas ${icon} fa-lg" style="color: ${statusColor};"></i>
                    </div>
                    <div>
                        <span class="d-block font-weight-bold text-dark">#${acc.id}</span>
                        <small style="color: ${statusColor}; font-weight: 600;">${statusText}</small>
                    </div>
                </div>
                <div class="text-right">
                    <span class="d-block font-weight-bold text-dark" style="font-size: 1rem;">${this._formatCurrency(acc.totalAmount, acc.totalAmountCurrency)}</span>
                    <small class="text-muted">${this._formatDate(acc.createdAt)}</small>
                </div>
            </div>`;
        }).join('');
    }

    _formatDate(dateVal) {
        if (!dateVal) return '-';
        try { const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal); return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('tr-TR'); } catch(e) { return '-'; }
    }

    _formatCurrency(amount, currency) {
        if (Array.isArray(amount)) return amount.map(i => `${i.amount} ${i.currency}`).join(', ');
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency || 'TRY' }).format(amount || 0);
    }
}