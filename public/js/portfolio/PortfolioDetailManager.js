// public/js/portfolio/PortfolioDetailManager.js
import { TransactionHelper } from './TransactionHelper.js';
import { loadSharedLayout } from '../layout-loader.js';
import { ipRecordsService, transactionTypeService, db, storage, waitForAuthUser, redirectOnLogout } from '../../firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { STATUSES } from '../../utils.js';

export class PortfolioDetailManager {
    constructor() {
        this.recordId = new URLSearchParams(location.search).get('id');
        this.currentRecord = null;
        this.transactionTypesMap = new Map();
        
        this.elements = {
            heroTitle: document.getElementById('heroTitle'),
            brandImage: document.getElementById('brandImage'),
            heroCard: document.getElementById('heroCard'),
            heroKv: document.getElementById('heroKv'),
            goodsContainer: document.getElementById('goodsContainer'),
            txAccordion: document.getElementById('txAccordion'),
            docsTbody: document.getElementById('documentsTbody'),
            addDocForm: document.getElementById('addDocForm'),
            applicantName: document.getElementById('applicantName'),
            applicantAddress: document.getElementById('applicantAddress'),
            tpQueryBtn: document.getElementById('tpQueryBtn')
        };

        this.init();
    }

    async init() {
        await loadSharedLayout({ activeMenuLink: 'portfolio.html' });
        const user = await waitForAuthUser();
        if (!user) return redirectOnLogout();

        if (!this.recordId) {
            this.showError('Kayıt ID parametresi eksik.');
            return;
        }

        await this.loadLookups();
        await this.loadRecord();
        this.setupEventListeners();
    }

    async loadLookups() {
        const res = await transactionTypeService.getTransactionTypes();
        if (res.success && Array.isArray(res.data)) {
            res.data.forEach(t => {
                this.transactionTypesMap.set(String(t.id), t.alias || t.name);
                if (t.code) this.transactionTypesMap.set(String(t.code), t.alias || t.name);
            });
        }
    }

    async loadRecord() {
        try {
            const res = await ipRecordsService.getRecordById(this.recordId);
            if (!res.success) throw new Error('Kayıt verisi alınamadı.');
            
            this.currentRecord = res.data;
            
            // Render fonksiyonlarını çağır
            this.renderHero();
            this.renderApplicants();
            this.renderGoodsList();
            await this.renderTransactions(); // Async işlem (Task belgeleri için)
            this.renderDocuments();

            document.getElementById('loading').classList.add('d-none');
            document.getElementById('detail-root').classList.remove('d-none');

        } catch (e) {
            console.error(e);
            this.showError('Kayıt yüklenirken hata oluştu: ' + e.message);
        }
    }

    renderHero() {
        const r = this.currentRecord;
        this.elements.heroTitle.textContent = r.title || r.brandText || '-';

        const imgSrc = (r.type === 'trademark') ? (r.brandImageUrl || r.details?.brandInfo?.brandImage) : null;
        if (imgSrc) {
            this.elements.brandImage.src = imgSrc;
            this.elements.heroCard.classList.remove('d-none');
        } else {
            this.elements.heroCard.classList.add('d-none');
        }

        // Tescil Numarası
        let regNo = r.registrationNumber;
        if (!regNo) regNo = r.internationalRegNumber || r.wipoIrNumber || '-';

        // Nice Sınıfları
        let classesStr = '-';
        if (Array.isArray(r.goodsAndServicesByClass) && r.goodsAndServicesByClass.length > 0) {
            classesStr = r.goodsAndServicesByClass.map(c => c.classNo).join(', ');
        } else if (Array.isArray(r.classes)) {
            classesStr = r.classes.join(', ');
        } else if (r.classes) {
            classesStr = r.classes;
        }

        // --- GÜNCELLENEN HTML YAPISI ---
        const kvHtml = `
            <div class="kv-item"><div class="label">Başvuru No</div><div class="value">${r.applicationNumber || '-'}</div></div>
            <div class="kv-item"><div class="label">Tescil No</div><div class="value">${regNo}</div></div>
            <div class="kv-item"><div class="label">Durum</div><div class="value">${this.getStatusText(r.type, r.status)}</div></div>
            <div class="kv-item"><div class="label">Başvuru Tarihi</div><div class="value">${this.formatDate(r.applicationDate)}</div></div>
            <div class="kv-item"><div class="label">Tescil Tarihi</div><div class="value">${this.formatDate(r.registrationDate)}</div></div>
            
            <div class="kv-item" style="grid-column: 1 / -1; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e0e0e0;">
                <div class="label" style="margin-bottom: 4px;">Sınıflar (Nice)</div>
                <div class="value text-primary" style="font-weight: 700; line-height: 1.4;">${classesStr}</div>
            </div>
        `;

        this.elements.heroKv.innerHTML = kvHtml;

        const isTP = this.checkIfTurkPatentOrigin(r);
        if (this.elements.tpQueryBtn) {
            this.elements.tpQueryBtn.style.display = isTP ? 'inline-block' : 'none';
        }
    }
    
    async renderApplicants() {
        const r = this.currentRecord;
        const nameContainer = this.elements.applicantName;
        const addressContainer = this.elements.applicantAddress;
        
        let namesHtml = '<span class="text-muted">-</span>';
        let addressesHtml = '<span class="text-muted">-</span>';

        if (Array.isArray(r.applicants) && r.applicants.length > 0) {
            // 1. İsimleri Çözümle
            const resolvedApplicants = await Promise.all(r.applicants.map(async (app) => {
                let name = 'İsimsiz';
                let address = null;
                let personId = null;

                // ID Tespiti
                if (typeof app === 'string') personId = app;
                else if (typeof app === 'object' && app) personId = app.id;

                // Veritabanından Detay Çek
                if (personId) {
                    try {
                        const snap = await getDoc(doc(db, 'persons', personId));
                        if (snap.exists()) {
                            const d = snap.data();
                            name = d.name || d.displayName || name;
                            address = [d.address, d.province, d.countryName].filter(Boolean).join(' - ');
                        }
                    } catch (e) { console.warn('Kişi detayı alınamadı:', personId); }
                } 
                
                // Fallback: DB'den bulunamazsa obje içindeki ismi kullan
                if (name === 'İsimsiz' && typeof app === 'object' && app.name) {
                    name = app.name;
                }

                return { name, address };
            }));

            // 2. HTML Olarak Listele (Alt alta div)
            if (resolvedApplicants.length > 0) {
                // İsimler Listesi
                namesHtml = resolvedApplicants
                    .map(a => `<div style="margin-bottom: 4px; border-bottom: 1px solid #dee2e6; padding-bottom: 2px;">${a.name}</div>`)
                    .join('');
                
                // Adresler Listesi
                addressesHtml = resolvedApplicants
                    .map(a => `<div style="margin-bottom: 4px; border-bottom: 1px solid #dee2e6; padding-bottom: 2px;">${a.address || '-'}</div>`)
                    .join('');
            }
        } else {
            // Eski usul tekil kayıt varsa
            const singleName = r.applicantName || r.ownerName;
            if (singleName) namesHtml = singleName;
        }

        // 3. Konteynerlara Bas (Input olmadığı için innerHTML kullanıyoruz)
        if (nameContainer) nameContainer.innerHTML = namesHtml;
        if (addressContainer) addressContainer.innerHTML = addressesHtml;
    }

    renderGoodsList() {
        const container = this.elements.goodsContainer;
        if (!container) return;

        const gsbc = this.currentRecord.goodsAndServicesByClass;
        let arr = Array.isArray(gsbc) ? gsbc : (gsbc ? Object.values(gsbc) : []);

        if (arr.length === 0) {
            container.innerHTML = '<div class="text-muted">Eşya listesi yok.</div>';
            return;
        }

        container.innerHTML = arr.sort((a,b) => Number(a.classNo) - Number(b.classNo))
            .map(entry => {
                const listHtml = this.formatNiceClassContent(entry.classNo, entry.items);
                return `
                <div class="goods-group border rounded p-3 mb-2 bg-white">
                    <div class="font-weight-bold text-primary mb-2">Nice ${entry.classNo}</div>
                    <ul class="pl-3 mb-0 goods-items">
                        ${listHtml}
                    </ul>
                </div>
            `}).join('');
    }

    // --- SINIF 35 FORMATLAMA MANTIĞI ---
    formatNiceClassContent(classNo, items) {
        if (!items || !items.length) return '';
        
        if (String(classNo) === '35') {
            let html = '';
            let isIndentedSection = false;
            const triggerPhrase = "satın alması için";
            const startPhrase = "müşterilerin malları";

            items.forEach(t => {
                const text = t || '';
                const lowerText = text.toLowerCase();
                
                if (!isIndentedSection && lowerText.includes(startPhrase) && lowerText.includes(triggerPhrase)) {
                    const regex = new RegExp(`(${triggerPhrase})`, 'i');
                    const match = text.match(regex);
                    if (match) {
                        const splitIndex = match.index + match[1].length;
                        const preText = text.substring(0, splitIndex);
                        const postText = text.substring(splitIndex);
                        
                        html += `<li class="font-weight-bold list-unstyled mt-2" style="list-style:none;">${preText}</li>`;
                        if (postText.trim().length > 0) {
                            html += `<li class="ml-4" style="list-style-type:circle;">${postText}</li>`;
                        }
                        isIndentedSection = true;
                        return;
                    }
                }
                
                if (isIndentedSection) {
                    html += `<li class="ml-4" style="list-style-type:circle;">${text}</li>`;
                } else {
                    html += `<li>${text}</li>`;
                }
            });
            return html;
        }
        return items.map(item => `<li>${item}</li>`).join('');
    }

    async renderTransactions() {
        const accordion = this.elements.txAccordion;
        accordion.innerHTML = '<div class="p-3 text-center text-muted"><span class="spinner-border spinner-border-sm"></span> İşlemler analiz ediliyor...</div>';

        const res = await ipRecordsService.getTransactionsForRecord(this.recordId);
        const transactions = res.success ? res.transactions : [];

        if (transactions.length === 0) {
            accordion.innerHTML = '<div class="p-3 text-muted">İşlem geçmişi bulunamadı.</div>';
            return;
        }

        const { parents, childrenMap } = TransactionHelper.organizeTransactions(transactions);

        let html = '';
        for (const parent of parents) {
            const typeName = this.transactionTypesMap.get(String(parent.type)) || `İşlem ${parent.type}`;
            const docs = await TransactionHelper.getDocuments(parent);
            const children = childrenMap[parent.id] || [];
            
            const docIcons = docs.map((d, i) => this.createDocIcon(d, i === 0)).join(' ');
            
            let childrenHtml = '';
            if (children.length > 0) {
                const childItems = await Promise.all(children.map(async child => {
                    const cTypeName = this.transactionTypesMap.get(String(child.type)) || `İşlem ${child.type}`;
                    const cDocs = await TransactionHelper.getDocuments(child);
                    const cDocIcons = cDocs.map((d, i) => this.createDocIcon(d, i === 0)).join(' ');
                    
                    return `
                        <div class="child-transaction-item d-flex justify-content-between align-items-center p-2 border-top bg-light ml-4" style="border-left: 3px solid #f39c12;">
                            <div>
                                <small class="text-muted">↳ ${cTypeName}</small>
                                <span class="text-muted ml-2 small">${this.formatDate(child.timestamp, true)}</span>
                            </div>
                            <div>${cDocIcons}</div>
                        </div>
                    `;
                }));
                childrenHtml = `<div class="accordion-transaction-children" style="display:none;">${childItems.join('')}</div>`;
            }

            html += `
                <div class="accordion-transaction-item border-bottom">
                    <div class="accordion-transaction-header d-flex justify-content-between align-items-center p-3" style="cursor:pointer; background: #fff;">
                        <div class="d-flex align-items-center">
                            <i class="fas fa-chevron-right mr-2 text-muted transition-icon ${children.length ? 'has-child-indicator' : ''}"></i>
                            <div class="d-flex flex-column">
                                <span class="font-weight-bold">${typeName}</span>
                                <small class="text-muted">${this.formatDate(parent.timestamp, true)}</small>
                            </div>
                        </div>
                        <div class="d-flex align-items-center">
                            ${docIcons}
                            ${children.length ? `<span class="badge badge-light border ml-2">${children.length} alt</span>` : ''}
                        </div>
                    </div>
                    ${childrenHtml}
                </div>
            `;
        }
        
        accordion.innerHTML = html;
        this.setupAccordionEvents();
    }

    renderDocuments() {
        const tbody = this.elements.docsTbody;
        const docs = this.currentRecord.documents || [];
        
        document.getElementById('docCount').textContent = docs.length;

        if (docs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Ekli belge yok.</td></tr>';
            return;
        }

        tbody.innerHTML = docs.map((d, i) => `
            <tr>
                <td>${d.name}</td>
                <td>${d.documentDesignation || d.type || '-'}</td>
                <td><small class="text-muted text-truncate d-inline-block" style="max-width: 200px;">${d.path || 'URL'}</small></td>
                <td class="text-right">
                    <a href="${d.url || d.content}" target="_blank" class="btn btn-sm btn-outline-primary mr-1">
                        <i class="fas fa-download"></i>
                    </a>
                    <button class="btn btn-sm btn-outline-danger btn-doc-remove" data-index="${i}">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    createDocIcon(doc, isFirst) {
        const colorClass = (doc.source === 'task') ? 'text-info' : 'text-danger'; 
        return `
            <a href="${doc.url}" target="_blank" class="doc-link-item ${colorClass} mx-1" title="${doc.name} (${doc.type})">
                <i class="fas fa-file-pdf fa-lg"></i>
            </a>
        `;
    }

    formatDate(d, withTime = false) {
        if (!d) return '-';
        const date = new Date(d);
        if (isNaN(date)) return String(d);
        let str = date.toLocaleDateString('tr-TR');
        if (withTime) str += ` ${date.toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'})}`;
        return str;
    }

    getStatusText(ipType, status) {
        const list = STATUSES[ipType] || [];
        const found = list.find(s => s.value === status);
        return found ? found.text : status;
    }

    checkIfTurkPatentOrigin(rec) {
        const candidates = [rec?.origin, rec?.source, rec?.details?.origin].map(s => (s||'').toUpperCase());
        return candidates.some(s => s.includes('TURKPATENT') || s.includes('TÜRKPATENT'));
    }

    setupEventListeners() {
        this.setupAccordionEvents();

        document.getElementById('addDocToggleBtn')?.addEventListener('click', () => {
            this.elements.addDocForm.classList.toggle('d-none');
        });

        document.getElementById('docCancelBtn')?.addEventListener('click', () => {
            this.elements.addDocForm.classList.add('d-none');
        });

        document.getElementById('docSaveBtn')?.addEventListener('click', () => this.handleDocUpload());

        this.elements.docsTbody.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-doc-remove');
            if (btn) this.handleDocDelete(btn.dataset.index);
        });

        this.elements.tpQueryBtn?.addEventListener('click', () => {
             const appNo = this.currentRecord.applicationNumber;
             // Varsa Chrome Extension'ı tetiklemek için özel event veya direkt link
             if(window.triggerTpQuery) {
                 window.triggerTpQuery(appNo);
             } else {
                 window.open(`https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(appNo)}`, '_blank');
             }
        });
    }

    setupAccordionEvents() {
        const headers = this.elements.txAccordion.querySelectorAll('.accordion-transaction-header');
        headers.forEach(header => {
            if (header.dataset.bound) return;
            header.dataset.bound = true;

            header.addEventListener('click', (e) => {
                if (e.target.closest('a')) return;
                
                const item = header.parentElement;
                const childrenContainer = item.querySelector('.accordion-transaction-children');
                const icon = header.querySelector('.fa-chevron-right');

                if (childrenContainer) {
                    const isVisible = childrenContainer.style.display !== 'none';
                    childrenContainer.style.display = isVisible ? 'none' : 'block';
                    if (icon) icon.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(90deg)';
                }
            });
        });
    }

    async handleDocUpload() {
        const fileInput = document.getElementById('docFile');
        const nameInput = document.getElementById('docName');
        const typeInput = document.getElementById('docType');
        
        if (!fileInput.files[0] || !nameInput.value) {
            alert('Lütfen dosya ve ad giriniz.');
            return;
        }

        const btn = document.getElementById('docSaveBtn');
        btn.disabled = true;
        btn.textContent = 'Yükleniyor...';

        try {
            const file = fileInput.files[0];
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `ipRecordDocs/${this.recordId}/${Date.now()}_${safeName}`;
            
            const storageRef = ref(storage, path);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);

            const newDoc = {
                name: nameInput.value,
                documentDesignation: typeInput.value,
                path: path,
                url: url,
                uploadedAt: new Date().toISOString()
            };

            const docs = [...(this.currentRecord.documents || []), newDoc];
            await ipRecordsService.updateRecord(this.recordId, { documents: docs });
            
            this.currentRecord.documents = docs;
            this.renderDocuments();
            
            fileInput.value = '';
            nameInput.value = '';
            this.elements.addDocForm.classList.add('d-none');
            alert('Belge başarıyla yüklendi.');

        } catch (e) {
            console.error(e);
            alert('Yükleme hatası: ' + e.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Ekle ve Kaydet';
        }
    }

    async handleDocDelete(index) {
        if (!confirm('Bu belgeyi silmek istediğinize emin misiniz?')) return;
        
        try {
            const docs = this.currentRecord.documents.filter((_, i) => i !== Number(index));
            await ipRecordsService.updateRecord(this.recordId, { documents: docs });
            this.currentRecord.documents = docs;
            this.renderDocuments();
        } catch (e) {
            alert('Silme hatası: ' + e.message);
        }
    }

    showError(msg) {
        document.getElementById('loading').innerHTML = `<div class="alert alert-danger">${msg}</div>`;
    }
}

new PortfolioDetailManager();