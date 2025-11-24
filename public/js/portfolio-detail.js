// js/portfolio-detail.js
import { loadSharedLayout } from './layout-loader.js';
import { ipRecordsService, transactionTypeService, auth, db, storage, taskService } from '../firebase-config.js';
import { formatFileSize, STATUSES } from '../utils.js';
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, uploadBytes, getDownloadURL, deleteObject, getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";


// URL
const params = new URLSearchParams(location.search);
const recordId = params.get('id');

// DOM Elements
const loadingEl = document.getElementById('loading');
const rootEl = document.getElementById('detail-root');
const applicantEl = document.getElementById('applicantName');
const applicantAddressEl = document.getElementById('applicantAddress');
const heroCard = document.getElementById('heroCard');
const heroTitleEl = document.getElementById('heroTitle');
const brandImageEl = document.getElementById('brandImage');
const heroKv = document.getElementById('heroKv');
const goodsContainer = document.getElementById('goodsContainer');
const docsTbody = document.getElementById('documentsTbody');
const docCount  = document.getElementById('docCount');
const txAccordion = document.getElementById('txAccordion'); // ✅ DOĞRU ID BU

// Global Data
let currentData = null;

class PortfolioDetail {
    constructor() {
        this.init();
    }

    async init() {
        if (!recordId) {
            alert('Kayıt ID bulunamadı.');
            window.location.href = 'portfolio.html';
            return;
        }

        const user = auth.currentUser;
        if (!user) {
            window.location.href = 'index.html';
            return;
        }

        try {
            await loadSharedLayout({ activeMenuLink: 'portfolio.html' });
            await this.loadRecord();
        } catch (error) {
            console.error('Yükleme hatası:', error);
        }
    }

    async loadRecord() {
        if(loadingEl) loadingEl.classList.remove('d-none');
        
        try {
            // 1. Kayıt Verisini Çek
            const res = await ipRecordsService.getRecordById(recordId);
            if (!res?.success || !res?.data) throw new Error('Kayıt bulunamadı.');
            currentData = res.data;

            // 2. Sayfa Alanlarını Doldur
            this.renderHero(currentData);
            this.renderApplicantInfo(currentData);
            this.renderGoodsList(currentData);
            this.renderDocuments(currentData.documents);

            // 3. İşlem Geçmişini Yükle ve Render Et
            await this.renderTransactions();

            // UI Göster
            if(loadingEl) loadingEl.classList.add('d-none');
            if(rootEl) rootEl.classList.remove('d-none');

        } catch (e) {
            console.error('Kayıt yüklenirken hata:', e);
            if(loadingEl) {
                loadingEl.className = 'alert alert-danger';
                loadingEl.textContent = 'Kayıt yüklenirken hata oluştu: ' + e.message;
            }
        }
    }

    // --- RENDER HELPERS ---

    renderHero(rec) {
        if (heroTitleEl) heroTitleEl.textContent = rec.title || rec.brandText || '—';
        
        const kv = [
            ['Başvuru No', rec.applicationNumber],
            ['Tür', rec.type],
            ['Durum', this.getStatusText(rec.type, rec.status)],
            ['Tarih', this.fmtDate(rec.applicationDate)]
        ];

        if (heroKv) {
            heroKv.innerHTML = kv.map(([label, val]) => `
                <div class="kv-item">
                    <div class="label">${label}</div>
                    <div class="value">${val || '-'}</div>
                </div>
            `).join('');
        }

        const imgSrc = (rec.type === 'trademark') ? (rec.brandImageUrl || rec.details?.brandInfo?.brandImage) : null;
        if (imgSrc && brandImageEl) {
            brandImageEl.src = imgSrc;
            heroCard?.classList.remove('d-none');
        }
    }

    renderApplicantInfo(rec) {
        if (applicantEl) {
            const applicants = rec.applicants || [];
            applicantEl.value = applicants.map(a => a.name).join(', ') || rec.applicantName || '-';
        }
    }

    renderGoodsList(rec) {
        if (!goodsContainer) return;
        const gsbc = rec.goodsAndServicesByClass || [];
        if (gsbc.length === 0) {
            goodsContainer.innerHTML = '<div class="text-muted">Eşya listesi yok.</div>';
            return;
        }
        // Basit listeleme
        goodsContainer.innerHTML = gsbc.map(g => 
            `<div class="mb-2"><strong>Sınıf ${g.classNo}:</strong> ${g.items?.join(', ') || ''}</div>`
        ).join('');
    }

    renderDocuments(docs) {
        if (!docsTbody) return;
        const arr = Array.isArray(docs) ? docs : [];
        if (docCount) docCount.textContent = arr.length;
        
        if (arr.length === 0) {
            docsTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Belge yok.</td></tr>';
            return;
        }

        docsTbody.innerHTML = arr.map(doc => `
            <tr>
                <td>${doc.name || 'Belge'}</td>
                <td>${doc.documentDesignation || doc.type || '-'}</td>
                <td><a href="${doc.url || doc.downloadURL || doc.path}" target="_blank" class="btn btn-sm btn-primary">İndir</a></td>
            </tr>
        `).join('');
    }

    // --- TRANSACTION RENDER LOGIC (DÜZELTİLEN KISIM) ---

    async getTransactionDocs(tx) {
        const docs = [];
        const seenUrls = new Set();

        const add = (docObj) => {
            const url = docObj.fileUrl || docObj.url || docObj.downloadURL || docObj.path;
            if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                docs.push({
                    name: docObj.name || docObj.fileName || 'Belge',
                    url: url,
                    icon: docObj.icon || 'fas fa-file-alt',
                    class: docObj.btnClass || 'btn-secondary'
                });
            }
        };

        // 1. Transaction içindeki documents dizisi
        if (Array.isArray(tx.documents)) {
            tx.documents.forEach(d => {
                add({ 
                    name: d.name, 
                    url: d.downloadURL || d.url, 
                    icon: 'fas fa-file-pdf', 
                    btnClass: 'btn-danger' 
                });
            });
        }

        // 2. İndekslenen Ana PDF (relatedPdfUrl)
        if (tx.relatedPdfUrl) {
            add({ name: 'İndekslenen Belge', url: tx.relatedPdfUrl, icon: 'fas fa-file-import', btnClass: 'btn-info' });
        }

        // 3. İtiraz Dilekçesi (oppositionPetitionFileUrl)
        if (tx.oppositionPetitionFileUrl) {
            add({ name: 'İtiraz Dilekçesi', url: tx.oppositionPetitionFileUrl, icon: 'fas fa-gavel', btnClass: 'btn-warning' });
        }

        // 4. Bağlı Görev Belgeleri (ePats vb.)
        if (tx.triggeringTaskId) {
            try {
                const taskResult = await taskService.getTaskById(tx.triggeringTaskId);
                if (taskResult.success && taskResult.data) {
                    const task = taskResult.data;
                    if (task.details?.epatsDocument?.downloadURL) {
                        add({
                            name: `ePats: ${task.details.epatsDocument.turkpatentEvrakNo || 'Belge'}`,
                            url: task.details.epatsDocument.downloadURL,
                            icon: 'fas fa-file-invoice',
                            btnClass: 'btn-primary'
                        });
                    }
                }
            } catch (e) { console.warn('Task belgeleri alınamadı:', e); }
        }

        return docs;
    }

    async renderTransactions() {
        // ✅ DÜZELTME: Doğru ID'yi kullanıyoruz
        const container = document.getElementById('txAccordion'); 
        if (!container) return;
        
        container.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm"></div> Yükleniyor...</div>';

        const txRes = await ipRecordsService.getTransactionsForRecord(recordId);
        const transactions = (txRes?.success && Array.isArray(txRes.transactions)) ? txRes.transactions : [];

        if (transactions.length === 0) {
            container.innerHTML = '<div class="text-muted text-center py-3">İşlem geçmişi bulunamadı.</div>';
            return;
        }

        // İşlem Tiplerini Çek
        const typesRes = await transactionTypeService.getTransactionTypes();
        const types = typesRes?.success ? typesRes.data : [];
        const getType = (id) => types.find(t => t.id === id || t.id === String(id));

        // Hiyerarşi
        const parents = transactions
            .filter(t => t.transactionHierarchy === 'parent' || !t.transactionHierarchy)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const childrenMap = {};
        transactions.filter(t => t.transactionHierarchy === 'child').forEach(child => {
            if (!childrenMap[child.parentId]) childrenMap[child.parentId] = [];
            childrenMap[child.parentId].push(child);
        });

        container.innerHTML = ''; // Temizle

        for (const parent of parents) {
            const pType = getType(parent.type);
            const pName = pType ? (pType.alias || pType.name) : (parent.description || 'İşlem');
            const pDate = this.fmtDate(parent.timestamp);
            
            const parentDocs = await this.getTransactionDocs(parent);
            const parentDocsHtml = parentDocs.map(d => 
                `<a href="${d.url}" target="_blank" class="btn btn-sm ${d.class} mr-1 mb-1" title="${d.name}">
                    <i class="${d.icon}"></i>
                </a>`
            ).join('');

            const children = childrenMap[parent.id] || [];
            const hasChildren = children.length > 0;

            // HTML Oluştur
            const itemDiv = document.createElement('div');
            itemDiv.className = 'timeline-item mb-3 border rounded bg-white shadow-sm';
            itemDiv.innerHTML = `
                <div class="d-flex justify-content-between align-items-center p-3 ${hasChildren ? 'cursor-pointer' : ''}" 
                     ${hasChildren ? `onclick="document.getElementById('child-${parent.id}').classList.toggle('d-none')"` : ''}>
                    <div>
                        <h6 class="mb-0 font-weight-bold text-dark">
                            ${hasChildren ? '<i class="fas fa-chevron-right mr-2 text-muted"></i>' : '<i class="fas fa-circle mr-2 text-muted" style="font-size:8px;"></i>'}
                            ${pName}
                        </h6>
                        <small class="text-muted">${pDate}</small>
                    </div>
                    <div>${parentDocsHtml}</div>
                </div>
            `;

            if (hasChildren) {
                const childContainer = document.createElement('div');
                childContainer.id = `child-${parent.id}`;
                childContainer.className = 'bg-light p-3 border-top d-none'; // Varsayılan gizli

                // Child'ları sırala ve render et
                children.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                
                for (const child of children) {
                    const cType = getType(child.type);
                    const cName = cType ? (cType.alias || cType.name) : (child.description || 'Alt İşlem');
                    const cDate = this.fmtDate(child.timestamp);
                    const cDocs = await this.getTransactionDocs(child);
                    
                    const cDocsHtml = cDocs.map(d => 
                        `<a href="${d.url}" target="_blank" class="btn btn-sm ${d.class} mr-1" title="${d.name}">
                            <i class="${d.icon}"></i>
                        </a>`
                    ).join('');

                    const childRow = document.createElement('div');
                    childRow.className = 'd-flex justify-content-between align-items-center mb-2 pb-2 border-bottom';
                    childRow.innerHTML = `
                        <div>
                            <i class="fas fa-level-up-alt fa-rotate-90 mr-2 text-secondary"></i>
                            <span class="font-weight-bold">${cName}</span>
                            <small class="text-muted ml-2">${cDate}</small>
                        </div>
                        <div>${cDocsHtml}</div>
                    `;
                    childContainer.appendChild(childRow);
                }
                itemDiv.appendChild(childContainer);
            }
            container.appendChild(itemDiv);
        }
    }

    // Utils
    fmtDate(d) {
        if (!d) return '-';
        try {
            const date = new Date(d);
            return isNaN(date.getTime()) ? d : date.toLocaleDateString('tr-TR');
        } catch { return d; }
    }

    getStatusText(type, val) {
        const list = STATUSES[type] || [];
        const match = list.find(s => s.value === val);
        return match ? match.text : val;
    }
}

// Başlat
document.addEventListener('DOMContentLoaded', () => {
    new PortfolioDetail();
});