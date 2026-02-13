// public/js/portfolio/PortfolioDetailManager.js
import { TransactionHelper } from './TransactionHelper.js';
import { loadSharedLayout } from '../layout-loader.js';
import { ipRecordsService, transactionTypeService, db, storage, waitForAuthUser } from '../../firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { STATUSES } from '../../utils.js';

export class PortfolioDetailManager {
    constructor() {
        this.recordId = new URLSearchParams(location.search).get('id');
        this.currentRecord = null;
        this.transactionTypesMap = new Map();
        this.countriesMap = new Map();
        
        // SimpleLoading Panelini Hazırla
        this.simpleLoader = null;
        if (window.SimpleLoading) {
            this.simpleLoader = new window.SimpleLoading();
        }

        this.initElements();
        this.init();
    }

    initElements() {
        this.elements = {
            heroTitle: document.getElementById('heroTitle'),
            brandImage: document.getElementById('brandImage'),
            heroCard: document.getElementById('heroCard'),
            heroKv: document.getElementById('heroKv'),
            goodsContainer: document.getElementById('goodsContainer'),
            txAccordion: document.getElementById('txAccordion'),
            docsTbody: document.getElementById('documentsTbody'),
            applicantName: document.getElementById('applicantName'),
            applicantAddress: document.getElementById('applicantAddress'),
            tpQueryBtn: document.getElementById('tpQueryBtn'),
            loading: document.getElementById('loading'),
            detailRoot: document.getElementById('detail-root')
        };
    }

    async init() {
        try {
            this.toggleLoading(true);
            
            // 1. Auth ve Paralel Veri Çekme (Hız için)
            await waitForAuthUser(); 
            const [recordSnap, countriesSnap, txTypesRes] = await Promise.all([
                getDoc(doc(db, "ipRecords", this.recordId)),
                getDoc(doc(db, 'common', 'countries')),
                transactionTypeService.getTransactionTypes().catch(() => ({ success: false, data: [] }))
            ]);

            if (!recordSnap.exists()) throw new Error("Kayıt bulunamadı.");

            // 2. Lookup Haritalarını Doldur
            if (countriesSnap.exists()) {
                countriesSnap.data().list?.forEach(c => this.countriesMap.set(String(c.id || c.code), c.name));
            }
            if (txTypesRes.success) {
                txTypesRes.data.forEach(t => this.transactionTypesMap.set(String(t.id), t));
            }

            this.currentRecord = { id: recordSnap.id, ...recordSnap.data() };
            
            // 3. UI Parçalarını Render Et
            await this.renderAll();

            if (typeof loadSharedLayout === 'function') {
                loadSharedLayout({ activeMenuLink: 'portfolio.html' });
            }

        } catch (e) {
            console.error("❌ Hata:", e);
            this.showError(e.message);
        } finally {
            this.toggleLoading(false);
        }
    }

    async renderAll() {
        this.renderHero();
        this.renderGoodsList();
        await this.renderTransactions();
        this.renderDocuments();
        await this.renderApplicants();
    }

    renderHero() {
        const r = this.currentRecord;
        if (!r) return;

        // Marka Başlığı ve Kart Görünürlüğü
        if (this.elements.heroTitle) this.elements.heroTitle.textContent = r.trademarkName || r.brandText || r.title || '-';
        if (this.elements.heroCard) {
            this.elements.heroCard.classList.remove('d-none');
            this.elements.heroCard.style.display = 'flex'; // Görsel olmasa da kart her zaman görünür
        }

        // Görsel Kontrolü
        const imgSrc = r.brandImageUrl || r.brandImage || r.details?.brandInfo?.brandImage;
        const imgWrap = this.elements.brandImage?.closest('.hero-img-wrap');
        if (imgSrc && this.elements.brandImage) {
            this.elements.brandImage.src = imgSrc;
            if (imgWrap) imgWrap.style.display = 'block';
        } else {
            if (imgWrap) imgWrap.style.display = 'none'; // Görsel yoksa alanı kapat, metinler genişlesin
        }

        // Sınıf Numaraları (Hero Kartı için)
        const gsbc = r.goodsAndServicesByClass;
        let classList = Array.isArray(gsbc) ? gsbc : (gsbc ? Object.values(gsbc) : []);
        let classesStr = classList.length > 0 ? classList.map(c => c.classNo).join(', ') : (r.classes || '-');

        // Ülke ve Orijin Kontrolü
        const isTP = String(r.origin || '').toUpperCase().includes('TÜRKPATENT');
        const countryName = this.countriesMap.get(String(r.country)) || r.country || '-';
        const regNo = r.registrationNumber || r.internationalRegNumber || r.wipoIrNumber || '-';

        if (this.elements.heroKv) {
            this.elements.heroKv.innerHTML = `
                <div class="kv-item"><div class="label">Başvuru No</div><div class="value">${r.applicationNumber || '-'}</div></div>
                <div class="kv-item"><div class="label">Tescil No</div><div class="value">${regNo}</div></div>
                <div class="kv-item"><div class="label">Durum</div><div class="value">${this.getStatusText(r.type, r.status)}</div></div>
                <div class="kv-item"><div class="label">Başvuru Tarihi</div><div class="value">${this.formatDate(r.applicationDate)}</div></div>
                <div class="kv-item"><div class="label">Tescil Tarihi</div><div class="value">${this.formatDate(r.registrationDate)}</div></div>
                <div class="kv-item"><div class="label">Yenileme Tarihi</div><div class="value">${this.formatDate(r.renewalDate)}</div></div>
                
                ${(!isTP) ? `
                    <div style="grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 15px; border-top: 1px solid #eee; padding-top: 10px; margin-top: 5px;">
                        <div class="kv-item" style="border:none; padding:0;"><div class="label">Ülke</div><div class="value">${countryName}</div></div>
                        <div class="kv-item" style="border:none; padding:0;"><div class="label">Orijin</div><div class="value">${r.origin || '-'}</div></div>
                    </div>` : ''}

                <div class="kv-item" style="grid-column: 1 / -1; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e0e0e0;">
                    <div class="label" style="margin-bottom: 4px;">Sınıflar (Nice)</div>
                    <div class="value text-primary" style="font-weight: 700;">${classesStr}</div>
                </div>
            `;
        }

        // TÜRKPATENT Sorgula Butonu İşlevi
        if (this.elements.tpQueryBtn) {
            this.elements.tpQueryBtn.style.display = isTP ? 'inline-block' : 'none';
            this.elements.tpQueryBtn.onclick = () => {
                const appNo = r.applicationNumber;
                if (!appNo) return alert('Başvuru numarası bulunamadı.');
                window.open(`https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(appNo)}`, '_blank');
            };
        }
    }

    renderGoodsList() {
        const container = this.elements.goodsContainer;
        if (!container) return;

        const gsbc = this.currentRecord.goodsAndServicesByClass;
        let arr = Array.isArray(gsbc) ? gsbc : (gsbc ? Object.values(gsbc) : []);

        if (arr.length === 0) {
            container.innerHTML = '<div class="text-muted p-3">Eşya listesi bulunmuyor.</div>';
            return;
        }

        container.innerHTML = arr.sort((a,b) => Number(a.classNo) - Number(b.classNo))
            .map(entry => {
                const listHtml = this.formatNiceClassContent(entry.classNo, entry.items || [entry.goodsText || '-']);
                return `
                <div class="goods-group border rounded p-3 mb-2 bg-white shadow-sm">
                    <div class="font-weight-bold text-primary mb-2">Nice Sınıfı ${entry.classNo}</div>
                    <ul class="pl-3 mb-0 small text-secondary" style="line-height: 1.6;">
                        ${listHtml}
                    </ul>
                </div>`
            }).join('');
    }

    formatNiceClassContent(classNo, items) {
        if (!items || !items.length) return '';
        
        // 🔥 35. Sınıf "satın alması için" Özel Biçimlendirmesi
        if (String(classNo) === '35') {
            let html = '';
            let isIndentedSection = false;
            const triggerPhrase = "satın alması için";
            const startPhrase = "müşterilerin malları";

            items.forEach(t => {
                const text = String(t || '');
                const lowerText = text.toLowerCase();
                
                if (!isIndentedSection && lowerText.includes(startPhrase) && lowerText.includes(triggerPhrase)) {
                    const regex = new RegExp(`(${triggerPhrase})`, 'i');
                    const match = text.match(regex);
                    if (match) {
                        const splitIndex = match.index + match[1].length;
                        const preText = text.substring(0, splitIndex);
                        const postText = text.substring(splitIndex);
                        html += `<li class="font-weight-bold mt-2" style="list-style:none;">${preText}</li>`;
                        if (postText.trim().length > 0) html += `<li class="ml-4" style="list-style-type:circle;">${postText}</li>`;
                        isIndentedSection = true;
                        return;
                    }
                }
                if (isIndentedSection) html += `<li class="ml-4" style="list-style-type:circle;">${text}</li>`;
                else html += `<li>${text}</li>`;
            });
            return html;
        }
        return items.map(item => `<li>${item}</li>`).join('');
    }

    async renderTransactions() {
        const accordion = this.elements.txAccordion;
        if (!accordion) return;

        const res = await ipRecordsService.getTransactionsForRecord(this.recordId);
        const transactions = res.success ? res.transactions : [];

        if (transactions.length === 0) {
            accordion.innerHTML = '<p class="p-3 text-muted">İşlem geçmişi bulunmuyor.</p>';
            return;
        }

        const { parents, childrenMap } = TransactionHelper.organizeTransactions(transactions);

        accordion.innerHTML = parents.map(parent => {
            const typeInfo = this.transactionTypesMap.get(String(parent.type));
            const typeName = typeInfo?.name || `İşlem ${parent.type}`;
            const children = childrenMap[parent.id] || [];
            
            // 🔥 PDF İkonu Kontrolü (Garantili)
            const directDocs = TransactionHelper.getDirectDocuments ? TransactionHelper.getDirectDocuments(parent) : [];
            const pdfUrl = parent.pdfUrl || parent.documentUrl || (directDocs.length > 0 ? directDocs[0].url : null);

            return `
                <div class="accordion-transaction-item border-bottom">
                    <div class="accordion-transaction-header d-flex justify-content-between align-items-center p-3" style="cursor:pointer; background:#fff;">
                        <div class="d-flex align-items-center">
                            <i class="fas fa-chevron-right mr-2 text-muted transition-icon"></i>
                            <div class="d-flex flex-column">
                                <span class="font-weight-bold">${typeName}</span>
                                <small class="text-muted">${this.formatDate(parent.timestamp || parent.date, true)}</small>
                            </div>
                        </div>
                        <div class="d-flex align-items-center">
                            ${pdfUrl ? `<i class="fas fa-file-pdf text-danger mx-3 fa-lg" style="cursor:pointer;" onclick="window.open('${pdfUrl}','_blank')"></i>` : ''}
                            ${children.length ? `<span class="badge badge-light border">${children.length} alt</span>` : ''}
                        </div>
                    </div>
                    <div class="accordion-transaction-children d-none bg-light">
                        ${children.map(child => {
                            const cPdf = child.pdfUrl || child.documentUrl;
                            return `
                            <div class="child-item d-flex justify-content-between p-2 ml-4 border-top">
                                <small>↳ ${this.transactionTypesMap.get(String(child.type))?.name || child.type}</small>
                                ${cPdf ? `<i class="fas fa-file-pdf text-danger" style="cursor:pointer;" onclick="window.open('${cPdf}','_blank')"></i>` : ''}
                            </div>`;
                        }).join('')}
                    </div>
                </div>`;
        }).join('');

        this.setupAccordionEvents();
    }

    async renderApplicants() {
        const r = this.currentRecord;
        if (!this.elements.applicantName) return;
        let names = [], addresses = [];
        if (Array.isArray(r.applicants) && r.applicants.length > 0) {
            const resolved = await Promise.all(r.applicants.map(async (app) => {
                const personId = typeof app === 'string' ? app : (app.id || app.uid);
                if (!personId) return { name: app.name || '-' };
                try {
                    const snap = await getDoc(doc(db, 'persons', personId));
                    if (snap.exists()) return { name: snap.data().name, address: snap.data().address };
                } catch { }
                return { name: app.name || '-' };
            }));
            names = resolved.map(a => a.name);
            addresses = resolved.map(a => a.address).filter(Boolean);
        } else {
            names = [r.applicantName || r.clientName || '-'];
            addresses = [r.applicantAddress || '-'];
        }
        this.elements.applicantName.innerHTML = names.join('<br>');
        if (this.elements.applicantAddress) this.elements.applicantAddress.innerHTML = addresses.join('<br>') || '-';
    }

    renderDocuments() {
        const docs = this.currentRecord.documents || [];
        if (this.elements.docsTbody) {
            this.elements.docsTbody.innerHTML = docs.length ? docs.map(d => `
                <tr>
                    <td>${d.name}</td>
                    <td>${d.documentDesignation || '-'}</td>
                    <td>${this.formatDate(d.uploadedAt)}</td>
                    <td class="text-right"><i class="fas fa-eye text-primary cursor-pointer" onclick="window.open('${d.url}','_blank')"></i></td>
                </tr>`).join('') : '<tr><td colspan="4" class="text-center">Belge yok.</td></tr>';
        }
    }

    setupAccordionEvents() {
        this.elements.txAccordion.querySelectorAll('.accordion-transaction-header').forEach(header => {
            header.onclick = (e) => {
                if (e.target.closest('.fa-file-pdf')) return;
                const item = header.closest('.accordion-transaction-item');
                const children = item.querySelector('.accordion-transaction-children');
                const icon = header.querySelector('.transition-icon');
                if (children) {
                    const isHidden = children.classList.contains('d-none');
                    children.classList.toggle('d-none');
                    if (icon) icon.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
                }
            };
        });
    }

    formatDate(d, withTime = false) {
        if (!d) return '-';
        try {
            const dateObj = d.toDate ? d.toDate() : new Date(d);
            return dateObj.toLocaleDateString('tr-TR', withTime ? { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit', year:'numeric'} : {});
        } catch { return String(d); }
    }

    getStatusText(type, status) {
        const list = STATUSES[type] || [];
        const found = list.find(s => s.value === status);
        return found ? found.text : status;
    }

    toggleLoading(show) {
        if (show) {
            if (this.elements.detailRoot) this.elements.detailRoot.classList.add('d-none');
            if (this.simpleLoader) {
                this.simpleLoader.show({ text: 'Yükleniyor', subtext: 'Portföy detayları hazırlanıyor...' });
            }
        } else {
            if (this.simpleLoader) this.simpleLoader.hide();
            if (this.elements.detailRoot) this.elements.detailRoot.classList.remove('d-none');
        }
    }

    showError(msg) {
        if (this.simpleLoader) this.simpleLoader.hide();
        if (this.elements.loading) {
            this.elements.loading.style.display = 'block';
            this.elements.loading.innerHTML = `<div class="alert alert-danger m-3"><h4>Hata</h4><p>${msg}</p></div>`;
        }
    }
}

window.manager = new PortfolioDetailManager();