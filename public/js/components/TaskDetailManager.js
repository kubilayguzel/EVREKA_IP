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
                <h6 class="text-muted font-weight-normal">Yükleniyor...</h6>
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
                console.log("C aşaması başladı - taskOwner:", task.taskOwner);
                try {
                    // taskOwner array veya string olabilir
                    const ownerIds = Array.isArray(task.taskOwner) ? task.taskOwner : [task.taskOwner];
                    console.log("ownerIds:", ownerIds);
                    const ownerPromises = ownerIds.map(async (ownerId) => {
                        if (!ownerId) return null;
                        console.log("Owner ID sorgulanıyor:", ownerId);
                        try {
                            const ownerSnap = await getDoc(doc(db, "persons", ownerId));
                            if (ownerSnap.exists()) {
                                const ownerData = ownerSnap.data();
                                console.log("Owner bulundu:", ownerData);
                                return ownerData.name || ownerData.companyName || null;
                            } else {
                                console.log("Owner bulunamadı:", ownerId);
                            }
                        } catch (err) {
                            console.error("Owner fetch hatası:", err);
                        }
                        return null;
                    });
                    const ownerNames = await Promise.all(ownerPromises);
                    console.log("ownerNames:", ownerNames);
                    const validOwnerNames = ownerNames.filter(Boolean);
                    console.log("validOwnerNames:", validOwnerNames);
                    if (validOwnerNames.length > 0) relatedPartyTxt = validOwnerNames.join(', ');
                } catch (err) {
                    console.warn("Task owner fetch error:", err);
                }
            }
            console.log("Final relatedPartyTxt:", relatedPartyTxt);

            // --- Veri Formatlama ---
            const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : (task.assignedTo_email || 'Atanmamış');
            const relatedRecordTxt = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'İlgili kayıt bulunamadı';
            const taskTypeDisplay = transactionType ? (transactionType.alias || transactionType.name) : (task.taskType || '-');
            const statusText = this.statusDisplayMap[task.status] || task.status;

            // --- CSS STYLES (SADE & KURUMSAL) ---
            const styles = {
                container: `font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #333; background-color: #f8f9fa; padding: 20px;`,
                
                // Kart: Beyaz, çok hafif gölge, gri kenarlık
                card: `
                    background: #fff;
                    border: 1px solid #e0e0e0;
                    border-radius: 8px;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
                    margin-bottom: 20px;
                    overflow: hidden;
                `,
                
                // Başlık: Temiz, koyu gri zemin değil, sadece alt çizgi
                cardHeader: `
                    padding: 15px 20px;
                    border-bottom: 1px solid #eee;
                    display: flex;
                    align-items: center;
                    font-size: 0.95rem;
                    font-weight: 700;
                    color: #1e3c72; /* Kurumsal Lacivert */
                    background-color: #fff;
                `,

                cardBody: `padding: 20px;`,
                
                // Etiket
                label: `
                    display: block;
                    font-size: 0.75rem;
                    font-weight: 600;
                    text-transform: uppercase;
                    color: #8898aa;
                    margin-bottom: 6px;
                    letter-spacing: 0.5px;
                `,
                
                // Değer Kutusu
                valueBox: `
                    background: #f8f9fa;
                    border: 1px solid #e9ecef;
                    border-radius: 6px;
                    padding: 12px 16px;
                    font-size: 0.95rem;
                    font-weight: 500;
                    color: #2d3748;
                    display: flex;
                    align-items: center;
                    min-height: 45px;
                `
            };

            const accrualsHtml = this._generateAccrualsHtml(accruals);
            const docsContent = this._generateDocsHtml(task);

            const html = `
            <div style="${styles.container}">
                
                <div style="${styles.card} padding: 20px; display: flex; justify-content: space-between; align-items: center; border-top: 4px solid #1e3c72;">
                    <div>
                        <h5 class="mb-1" style="font-weight: 700; color: #2d3748;">${task.title || 'Başlıksız Görev'}</h5>
                        <div class="text-muted small">
                            <span class="mr-3"><i class="fas fa-hashtag mr-1"></i>${task.id}</span>
                            <span><i class="far fa-clock mr-1"></i>${this._formatDate(task.createdAt)}</span>
                        </div>
                    </div>
                    <span class="badge badge-pill px-3 py-2" style="font-size: 0.85rem; background-color: #1e3c72; color: #fff;">
                        ${statusText}
                    </span>
                </div>

                <div style="${styles.card}">
                    <div style="${styles.cardHeader}">
                        <i class="fas fa-star mr-2 text-warning"></i> TEMEL BİLGİLER
                    </div>
                    <div style="${styles.cardBody}">
                        
                        <div class="mb-4">
                            <label style="${styles.label}">İLGİLİ TARAF / MÜVEKKİL</label>
                            <div style="${styles.valueBox} border-left: 4px solid #1e3c72;">
                                 <i class="fas fa-user-tie text-primary mr-3 fa-lg" style="color: #1e3c72 !important;"></i>
                                 <span style="font-size: 1.1rem; font-weight: 600;">${relatedPartyTxt}</span>
                            </div>
                        </div>

                        <div>
                            <label style="${styles.label}">İLGİLİ VARLIK (DOSYA)</label>
                            <div style="${styles.valueBox}">
                                 <i class="fas fa-folder text-muted mr-3"></i>
                                 <span style="font-size: 1rem; font-weight: 500;">${relatedRecordTxt}</span>
                            </div>
                        </div>

                    </div>
                </div>

                <div style="${styles.card}">
                    <div style="${styles.cardHeader}">
                        <i class="fas fa-list-alt mr-2 text-muted"></i> GÖREV DETAYLARI
                    </div>
                    <div style="${styles.cardBody}">
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
                                    <i class="far fa-calendar-alt text-muted mr-2"></i>
                                    <span class="${task.officialDueDate ? 'text-danger font-weight-bold' : 'text-muted'}">
                                        ${this._formatDate(task.officialDueDate)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label style="${styles.label}">AÇIKLAMA</label>
                            <div style="${styles.valueBox} height: auto; align-items: flex-start; min-height: 60px; white-space: pre-wrap; line-height: 1.6; color: #525f7f;">${task.description || 'Açıklama girilmemiş.'}</div>
                        </div>
                    </div>
                </div>

                <div style="${styles.card}">
                    <div style="${styles.cardHeader}">
                        <i class="fas fa-paperclip mr-2 text-muted"></i> BELGELER
                    </div>
                    <div style="${styles.cardBody}">
                        ${docsContent}
                    </div>
                </div>

                <div style="${styles.card} margin-bottom: 0;">
                    <div style="${styles.cardHeader}">
                        <i class="fas fa-coins mr-2 text-muted"></i> TAHAKKUKLAR
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
    //  ID 66: EVALUATION (AYNEN KORUNDU)
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
    //  YARDIMCI METODLAR (SADE)
    // =========================================================================
    _generateDocsHtml(task) {
        let items = [];
        const epatsDoc = task.details?.epatsDocument;
        const epatsUrl = epatsDoc?.downloadURL || epatsDoc?.url;

        if (epatsDoc && epatsUrl) {
            items.push(`
                <a href="${epatsUrl}" target="_blank" class="d-flex align-items-center justify-content-between p-3 mb-2 rounded text-decoration-none bg-white border" style="border-left: 3px solid #d63384 !important;">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-file-pdf text-danger fa-lg mr-3"></i>
                        <div class="text-truncate">
                            <span class="d-block text-dark font-weight-bold" style="font-size: 0.9rem;">EPATS Belgesi</span>
                            <span class="d-block text-muted small text-truncate">${epatsDoc.name}</span>
                        </div>
                    </div>
                    <i class="fas fa-external-link-alt text-muted small"></i>
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
                    <a href="${fUrl}" target="_blank" class="d-flex align-items-center justify-content-between p-3 mb-2 rounded text-decoration-none bg-white border">
                        <div class="d-flex align-items-center overflow-hidden">
                            <i class="fas fa-paperclip text-muted fa-lg mr-3"></i>
                            <div class="text-truncate" style="max-width: 250px;">
                                <span class="d-block text-dark font-weight-bold" style="font-size: 0.9rem;">Dosya</span>
                                <small class="text-muted text-truncate d-block">${file.name || 'Adsız'}</small>
                            </div>
                        </div>
                        <i class="fas fa-download text-muted small"></i>
                    </a>
                `);
            }
        });

        return items.length ? items.join('') : `<div class="text-muted small font-italic p-2">Ekli belge bulunmuyor.</div>`;
    }

    _generateAccrualsHtml(accruals) {
        if (!accruals || accruals.length === 0) return `<div class="text-muted small font-italic p-2">Bağlı tahakkuk bulunmuyor.</div>`;
        return accruals.map(acc => {
            let statusColor = '#f39c12'; // Default warning
            let statusText = 'Ödenmedi';
            
            if(acc.status === 'paid') { statusColor = '#27ae60'; statusText = 'Ödendi'; }
            else if(acc.status === 'cancelled') { statusColor = '#95a5a6'; statusText = 'İptal'; }

            return `
            <div class="d-flex justify-content-between align-items-center p-3 mb-2 rounded bg-white border">
                <div class="d-flex align-items-center">
                    <span class="badge badge-light border mr-3">#${acc.id}</span>
                    <span class="font-weight-bold text-dark" style="font-size: 0.95rem;">${this._formatCurrency(acc.totalAmount, acc.totalAmountCurrency)}</span>
                </div>
                <div class="text-right">
                    <span class="badge badge-pill text-white" style="background-color: ${statusColor}; font-size: 0.75rem;">${statusText}</span>
                    <div class="text-muted small mt-1">${this._formatDate(acc.createdAt)}</div>
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