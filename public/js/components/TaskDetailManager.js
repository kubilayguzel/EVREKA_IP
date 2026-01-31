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

            // C) Task Owner -> Persons Tablosu (relatedParties yoksa)
            if ((!relatedPartyTxt || relatedPartyTxt === '-') && task.taskOwner) {
                try {
                    const ownerSnap = await getDoc(doc(db, "persons", task.taskOwner));
                    if (ownerSnap.exists()) {
                        const ownerData = ownerSnap.data();
                        relatedPartyTxt = ownerData.name || ownerData.companyName || '-';
                    }
                } catch (err) {
                    console.warn("Task owner fetch error:", err);
                }
            }

            // --- Veri Formatlama ---
            const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : (task.assignedTo_email || 'Atanmamış');
            const relatedRecordTxt = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'İlgili kayıt bulunamadı';
            const taskTypeDisplay = transactionType ? (transactionType.alias || transactionType.name) : (task.taskType || '-');
            const statusText = this.statusDisplayMap[task.status] || task.status;

            // --- CSS STYLES ---
            const styles = {
                container: `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #344767; background-color: #f8f9fa; padding: 20px;`,
                
                // Temel Kart Yapısı
                card: `
                    background: #fff;
                    border: 1px solid #e9ecef;
                    border-radius: 8px;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.04);
                    margin-bottom: 24px;
                    overflow: hidden;
                `,
                
                // Başlık Alanı
                cardHeader: `
                    padding: 12px 20px;
                    border-bottom: 1px solid rgba(0,0,0,0.05);
                    display: flex;
                    align-items: center;
                    font-size: 0.95rem;
                    font-weight: 700;
                    letter-spacing: 0.5px;
                    text-transform: uppercase;
                `,

                cardBody: `
                    padding: 20px;
                `,
                
                label: `
                    display: block;
                    font-size: 0.7rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: #adb5bd;
                    margin-bottom: 4px;
                    letter-spacing: 0.3px;
                `,
                
                valueBox: `
                    background: #fdfdfd;
                    border: 1px solid #e9ecef;
                    border-radius: 6px;
                    padding: 10px 14px;
                    font-size: 0.9rem;
                    font-weight: 500;
                    color: #343a40;
                    display: flex;
                    align-items: center;
                    min-height: 40px;
                `
            };

            const accrualsHtml = this._generateAccrualsHtml(accruals);
            const docsContent = this._generateDocsHtml(task);

            const html = `
            <div style="${styles.container}">
                
                <div style="${styles.card} padding: 20px; border-left: 5px solid #2c3e50; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h5 class="mb-1" style="font-weight: 700; color: #2c3e50;">${task.title || 'Başlıksız Görev'}</h5>
                        <div class="text-muted small">
                            <span class="mr-3">ID: <strong>${task.id}</strong></span>
                            <span><i class="far fa-clock mr-1"></i>${this._formatDate(task.createdAt)}</span>
                        </div>
                    </div>
                    <span class="badge badge-pill px-3 py-2 text-white" style="font-size: 0.85rem; background-color: #2c3e50;">
                        ${statusText}
                    </span>
                </div>

                <div style="${styles.card} border-left: 5px solid #2dce89;">
                    <div style="${styles.cardHeader} background-color: #f0fff4; color: #2dce89;">
                        <i class="fas fa-user-friends mr-2"></i> MÜVEKKİL / İLGİLİ TARAF
                    </div>
                    <div style="${styles.cardBody}">
                        <div style="${styles.valueBox} border-color: #c3e6cb; background-color: #fff;">
                            <span style="font-weight: 600; font-size: 1rem; color: #28a745;">${relatedPartyTxt}</span>
                        </div>
                    </div>
                </div>

                <div style="${styles.card} border-left: 5px solid #11cdef;">
                    <div style="${styles.cardHeader} background-color: #f3fbfc; color: #11cdef;">
                        <i class="fas fa-info-circle mr-2"></i> GENEL BİLGİLER
                    </div>
                    <div style="${styles.cardBody}">
                        
                        <div class="mb-4">
                            <label style="${styles.label}">İLGİLİ VARLIK (DOSYA)</label>
                            <div style="${styles.valueBox} border-left: 3px solid #11cdef;">
                                 <i class="fas fa-folder text-info mr-3"></i>
                                 <span style="font-weight:600;">${relatedRecordTxt}</span>
                            </div>
                        </div>

                        <div class="row">
                            <div class="col-md-4 mb-3">
                                <label style="${styles.label}">İŞ TİPİ</label>
                                <div style="${styles.valueBox}">${taskTypeDisplay}</div>
                            </div>
                            <div class="col-md-4 mb-3">
                                <label style="${styles.label}">ATANAN KİŞİ</label>
                                <div style="${styles.valueBox}">
                                    <i class="fas fa-user-circle text-muted mr-2"></i>${assignedName}
                                </div>
                            </div>
                            <div class="col-md-4 mb-3">
                                <label style="${styles.label}">RESMİ BİTİŞ</label>
                                <div style="${styles.valueBox}">
                                    <i class="far fa-calendar-alt text-danger mr-2"></i>
                                    <span class="${task.officialDueDate ? 'text-danger' : 'text-muted'}" style="font-weight:600;">
                                        ${this._formatDate(task.officialDueDate)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label style="${styles.label}">AÇIKLAMA</label>
                            <div style="${styles.valueBox} height: auto; align-items: flex-start; min-height: 60px; white-space: pre-wrap; line-height: 1.5; color: #525f7f;">${task.description || 'Açıklama girilmemiş.'}</div>
                        </div>
                    </div>
                </div>

                <div style="${styles.card} border-left: 5px solid #fb6340;">
                    <div style="${styles.cardHeader} background-color: #fff5f2; color: #fb6340;">
                        <i class="fas fa-paperclip mr-2"></i> BELGELER
                    </div>
                    <div style="${styles.cardBody}">
                        ${docsContent}
                    </div>
                </div>

                <div style="${styles.card} border-left: 5px solid #5e72e4; margin-bottom: 0;">
                    <div style="${styles.cardHeader} background-color: #f4f6fc; color: #5e72e4;">
                        <i class="fas fa-coins mr-2"></i> TAHAKKUKLAR
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

        if (epatsDoc && epatsUrl) {
            items.push(`
                <a href="${epatsUrl}" target="_blank" class="d-flex align-items-center justify-content-between p-3 mb-2 rounded text-decoration-none bg-white border shadow-sm" style="border-left: 4px solid #f5365c !important;">
                    <div class="d-flex align-items-center">
                        <div class="bg-danger text-white rounded-circle d-flex align-items-center justify-content-center mr-3" style="width: 32px; height: 32px;">
                            <i class="fas fa-file-pdf"></i>
                        </div>
                        <div class="text-truncate">
                            <span class="d-block text-dark font-weight-bold" style="font-size: 0.9rem;">EPATS Belgesi</span>
                            <span class="d-block text-muted small text-truncate">${epatsDoc.name}</span>
                        </div>
                    </div>
                    <span class="text-primary small font-weight-bold">Aç <i class="fas fa-external-link-alt ml-1"></i></span>
                </a>
            `);
        }

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
                    <a href="${fUrl}" target="_blank" class="d-flex align-items-center justify-content-between p-3 mb-2 rounded text-decoration-none bg-white border shadow-sm" style="border-left: 4px solid #fb6340 !important;">
                        <div class="d-flex align-items-center overflow-hidden">
                            <div class="bg-warning text-white rounded-circle d-flex align-items-center justify-content-center mr-3" style="width: 32px; height: 32px;">
                                <i class="fas fa-paperclip"></i>
                            </div>
                            <div class="text-truncate" style="max-width: 250px;">
                                <span class="d-block text-dark font-weight-bold" style="font-size: 0.9rem;">${file.name || 'Dosya'}</span>
                            </div>
                        </div>
                        <span class="text-muted small"><i class="fas fa-download"></i></span>
                    </a>
                `);
            }
        });

        return items.length ? items.join('') : `<div class="text-center text-muted small py-3">Ekli belge bulunmuyor.</div>`;
    }

    _generateAccrualsHtml(accruals) {
        if (!accruals || accruals.length === 0) return `<div class="text-center text-muted small py-3">Bağlı tahakkuk bulunmuyor.</div>`;
        return accruals.map(acc => {
            let statusColor = '#fb6340'; 
            let statusText = 'Ödenmedi';
            
            if(acc.status === 'paid') { statusColor = '#2dce89'; statusText = 'Ödendi'; }
            else if(acc.status === 'cancelled') { statusColor = '#adb5bd'; statusText = 'İptal'; }

            return `
            <div class="d-flex justify-content-between align-items-center p-3 mb-2 rounded bg-white border shadow-sm" style="border-left: 4px solid ${statusColor} !important;">
                <div class="d-flex align-items-center">
                    <div class="mr-3 text-center" style="width: 40px;">
                        <span class="badge badge-pill text-white" style="background-color: ${statusColor};">${acc.id}</span>
                    </div>
                    <div>
                        <span class="d-block font-weight-bold text-dark" style="font-size: 0.95rem;">${this._formatCurrency(acc.totalAmount, acc.totalAmountCurrency)}</span>
                    </div>
                </div>
                <div class="text-right">
                    <small class="d-block font-weight-bold" style="color: ${statusColor};">${statusText}</small>
                    <small class="text-muted" style="font-size: 0.75rem;">${this._formatDate(acc.createdAt)}</small>
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