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

            // --- CSS STYLES (Sadeleştirilmiş) ---
            const styles = {
                container: `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #344767;`,
                
                // Kart Yapısı: Gölge yok, sadece ince sınır çizgisi ve temiz arka plan
                card: `
                    background: #fff;
                    border: 1px solid #e9ecef;
                    border-radius: 12px;
                    padding: 24px;
                    margin-bottom: 24px;
                `,
                
                // Başlıklar: İnce, gri alt çizgi, büyük font yerine net okunur font
                sectionTitle: `
                    font-size: 14px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: #8392ab;
                    margin-bottom: 16px;
                    display: flex;
                    align-items: center;
                `,
                
                // Etiketler (Labels): Küçük, silik gri
                label: `
                    display: block;
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: #a0aec0;
                    margin-bottom: 4px;
                `,
                
                // Değerler (Values): Koyu renk, belirgin
                value: `
                    font-size: 14px;
                    font-weight: 500;
                    color: #344767;
                    padding: 8px 0;
                    border-bottom: 1px solid #f0f2f5;
                `,

                // Vurgulu Değer (Kutu içinde değil, temiz metin)
                highlightValue: `
                    font-size: 15px;
                    font-weight: 600;
                    color: #2c3e50;
                `
            };

            const accrualsHtml = this._generateAccrualsHtml(accruals);
            const docsContent = this._generateDocsHtml(task);

            const html = `
            <div class="container-fluid px-2 py-3" style="${styles.container}">
                
                <div class="d-flex justify-content-between align-items-start mb-4 pb-3" style="border-bottom: 1px solid #e9ecef;">
                    <div>
                        <h5 class="font-weight-bold text-dark mb-1" style="font-size: 1.25rem;">${task.title || 'Başlıksız Görev'}</h5>
                        <div class="text-muted small">
                            <span class="mr-3">ID: <strong>${task.id}</strong></span>
                            <span><i class="far fa-clock mr-1"></i>${this._formatDate(task.createdAt)}</span>
                        </div>
                    </div>
                    <span class="badge badge-light border px-3 py-2 text-dark" style="font-size: 0.85rem; font-weight: 600;">
                        ${statusText}
                    </span>
                </div>

                <div style="${styles.card} border-left: 4px solid #2dce89;">
                    <div class="d-flex align-items-center">
                        <div class="mr-3 text-success bg-light rounded-circle d-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
                            <i class="fas fa-user-tie fa-lg"></i>
                        </div>
                        <div>
                            <span style="${styles.label}">DOSYA SAHİBİ / MÜVEKKİL</span>
                            <span style="font-size: 1.2rem; font-weight: 600; color: #2dce89;">${relatedPartyTxt}</span>
                        </div>
                    </div>
                </div>

                <div style="${styles.card}">
                    <div style="${styles.sectionTitle}">
                        <i class="fas fa-layer-group mr-2"></i>Genel Bilgiler
                    </div>
                    
                    <div class="mb-4">
                        <label style="${styles.label}">İLGİLİ VARLIK (DOSYA)</label>
                        <div class="d-flex align-items-center">
                             <i class="fas fa-folder text-warning mr-2"></i>
                             <span style="${styles.highlightValue}">${relatedRecordTxt}</span>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-md-4 mb-3">
                            <label style="${styles.label}">İŞ TİPİ</label>
                            <div style="${styles.value}">${taskTypeDisplay}</div>
                        </div>
                        <div class="col-md-4 mb-3">
                            <label style="${styles.label}">ATANAN KİŞİ</label>
                            <div style="${styles.value}">
                                <img src="https://ui-avatars.com/api/?name=${assignedName}&background=random&size=24" class="rounded-circle mr-2" style="width:20px;height:20px;">
                                ${assignedName}
                            </div>
                        </div>
                        <div class="col-md-4 mb-3">
                            <label style="${styles.label}">RESMİ BİTİŞ</label>
                            <div style="${styles.value}">
                                <span class="${task.officialDueDate ? '' : 'text-muted'}">
                                    ${this._formatDate(task.officialDueDate)}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-12">
                            <label style="${styles.label}">AÇIKLAMA</label>
                            <div class="bg-light p-3 rounded text-dark small" style="min-height: 60px; white-space: pre-wrap; line-height: 1.5;">${task.description || 'Açıklama girilmemiş.'}</div>
                        </div>
                    </div>
                </div>

                <div class="row">
                    <div class="col-md-6">
                        <div style="${styles.card} height: 100%;">
                            <div style="${styles.sectionTitle}">
                                <i class="fas fa-paperclip mr-2"></i>Belgeler
                            </div>
                            ${docsContent}
                        </div>
                    </div>
                    
                    <div class="col-md-6">
                        <div style="${styles.card} height: 100%;">
                            <div style="${styles.sectionTitle}">
                                <i class="fas fa-coins mr-2"></i>Tahakkuklar
                            </div>
                            ${accrualsHtml}
                        </div>
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

            // Attachment mantığı aynen kaldı...
            let attachmentsHtml = '';
            // (Buradaki kod önceki cevaptaki ile aynı, kısalttım)
            
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
    //  YARDIMCI METODLAR (Sadeleştirildi)
    // =========================================================================
    _generateDocsHtml(task) {
        let items = [];
        const epatsDoc = task.details?.epatsDocument;
        const epatsUrl = epatsDoc?.downloadURL || epatsDoc?.url;

        if (epatsDoc && epatsUrl) {
            items.push(`
                <a href="${epatsUrl}" target="_blank" class="d-flex align-items-center p-2 mb-2 rounded text-decoration-none" style="background: #fff5f5; border: 1px solid #fed7d7;">
                    <i class="fas fa-file-pdf text-danger mr-3 ml-2"></i>
                    <div class="text-truncate">
                        <span class="d-block text-dark font-weight-bold small">EPATS Belgesi</span>
                        <span class="d-block text-muted small text-truncate">${epatsDoc.name}</span>
                    </div>
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
                    <a href="${fUrl}" target="_blank" class="d-flex align-items-center p-2 mb-2 rounded text-decoration-none" style="background: #f8f9fa; border: 1px solid #e9ecef;">
                        <i class="fas fa-paperclip text-secondary mr-3 ml-2"></i>
                        <div class="text-truncate">
                            <span class="d-block text-dark font-weight-bold small">${file.name || 'Dosya'}</span>
                        </div>
                    </a>
                `);
            }
        });

        return items.length ? items.join('') : `<div class="text-muted small font-italic">Belge yok.</div>`;
    }

    _generateAccrualsHtml(accruals) {
        if (!accruals || accruals.length === 0) return `<div class="text-muted small font-italic">Bağlı tahakkuk yok.</div>`;
        return accruals.map(acc => {
            let color = 'text-warning';
            let label = 'Ödenmedi';
            if(acc.status === 'paid') { color = 'text-success'; label = 'Ödendi'; }
            else if(acc.status === 'cancelled') { color = 'text-muted'; label = 'İptal'; }

            return `
            <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                <div>
                    <span class="d-block font-weight-bold text-dark small">#${acc.id}</span>
                    <span class="small ${color}">${label}</span>
                </div>
                <div class="text-right">
                    <span class="d-block font-weight-bold text-dark small">${this._formatCurrency(acc.totalAmount, acc.totalAmountCurrency)}</span>
                    <small class="text-muted" style="font-size: 10px;">${this._formatDate(acc.createdAt)}</small>
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