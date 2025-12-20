// public/js/portfolio/PortfolioRenderer.js
import { STATUSES } from '../../utils.js'; // Utils'den durumları al
import '../simple-loading.js';

export class PortfolioRenderer {
    constructor(containerId, dataManager) {
        this.tbody = document.getElementById(containerId);
        this.dataManager = dataManager;
        
        // SimpleLoading örneğini hazırla
        this.simpleLoader = null;
        if (window.SimpleLoading) {
            this.simpleLoader = new window.SimpleLoading();
        }
    }

    clear() {
        if (this.tbody) this.tbody.innerHTML = '';
    }

    showLoading(show) {
        const defaultSpinner = document.getElementById('loadingIndicator');
        
        if (show) {
            if (defaultSpinner) defaultSpinner.style.display = 'none';
            
            if (this.simpleLoader) {
                this.simpleLoader.show({
                    text: 'Veriler Yükleniyor',
                    subtext: 'Lütfen bekleyiniz, kayıtlar taranıyor...'
                });
            } else if (defaultSpinner) {
                defaultSpinner.style.display = 'flex';
            }
        } else {
            if (this.simpleLoader) this.simpleLoader.hide();
            if (defaultSpinner) defaultSpinner.style.display = 'none';
        }
    }

    renderHeaders(columns) {
        const headerRow = document.getElementById('portfolioTableHeaderRow');
        const filterRow = document.getElementById('portfolioTableFilterRow');
        if (!headerRow) return;

        headerRow.innerHTML = '';
        if (filterRow) filterRow.innerHTML = '';

        columns.forEach(col => {
            const th = document.createElement('th');
            if (col.width) th.style.width = col.width;
            
            th.className = col.sortable ? 'sortable-header inactive' : '';
            if (col.sortable) th.dataset.column = col.key;
            
            th.textContent = col.label || '';
            
            if (col.isCheckbox) {
                th.innerHTML = '<input type="checkbox" id="selectAllCheckbox">';
            }
            headerRow.appendChild(th);
        });
    }

    // --- STANDART ROW ---
    renderStandardRow(record, isTrademarkTab, isSelected, index) {
        const tr = document.createElement('tr');
        tr.dataset.id = record.id;
        
        // ... (Mevcut değişken tanımları aynı kalsın) ...
        const isWipoParent = (record.origin === 'WIPO' || record.origin === 'ARIPO') && record.transactionHierarchy === 'parent';
        const isChild = record.transactionHierarchy === 'child'; 
        const irNo = record.wipoIR || record.aripoIR;
        
        if (isWipoParent && irNo) {
            tr.dataset.groupId = irNo;
            tr.className = 'group-header';
        }

        const countryName = this.dataManager.getCountryName(record.country);
        const imgHtml = isTrademarkTab ? 
            `<td><div class="trademark-image-wrapper">${record.brandImageUrl ? `<img class="trademark-image-thumbnail" src="${record.brandImageUrl}" loading="lazy">` : ''}</div></td>` : '';

        const actions = `
            <div class="d-flex gap-1 justify-content-end">
                <button class="action-btn view-btn btn btn-sm btn-info" data-id="${record.id}" title="Görüntüle"><i class="fas fa-eye"></i></button>
                <button class="action-btn edit-btn btn btn-sm btn-warning" data-id="${record.id}" title="Düzenle"><i class="fas fa-edit"></i></button>
                <button class="action-btn delete-btn btn btn-sm btn-danger" data-id="${record.id}" title="Sil"><i class="fas fa-trash"></i></button>
            </div>
        `;

        const caret = isWipoParent ? `<i class="fas fa-chevron-right row-caret" style="cursor:pointer;"></i>` : '';
        const titleText = record.title || record.brandText || '-';
        const appNoText = record.applicationNumber || (isWipoParent ? irNo : '-');
        const applicantText = record.formattedApplicantName || '-';

        // --- HTML OLUŞTURMA (Sıra No Eklendi) ---
        let html = `
            <td><input type="checkbox" class="record-checkbox" data-id="${record.id}" ${isSelected ? 'checked' : ''}></td>
            <td class="font-weight-bold text-muted">${isChild ? '' : index}</td> <td class="toggle-cell text-center">${caret}</td>
            
            <td>
                ${isChild ? '' : `<div class="badge badge-${record.portfoyStatus === 'active' ? 'success' : 'secondary'}">${record.portfoyStatus === 'active' ? 'Aktif' : 'Pasif'}</div>`}
            </td>
        `;
        // ... (Kalan HTML kodları aynı devam eder) ...
        if (!isTrademarkTab) { html += `<td>${record.type || '-'}</td>`; }
        html += `<td title="${titleText}"><strong>${titleText}</strong></td>`;
        if (isTrademarkTab) {
            html += imgHtml;
            html += `<td>${record.origin || '-'}</td>`;
            html += `<td title="${countryName}">${countryName}</td>`;
        }
        html += `<td title="${appNoText}">${appNoText}</td>`;
        html += `<td>${this.formatDate(record.applicationDate)}</td>`;
        html += `<td>${isChild ? '' : this.getStatusBadge(record)}</td>`;
        html += `<td><small title="${applicantText}">${applicantText}</small></td>`;
        html += `<td>${actions}</td>`;

        tr.innerHTML = html;
        return tr;
    }

// Dava Statüleri İçin Renklendirme Yardımcısı (GÜNCELLENDİ)
    _getLitigationStatusBadge(status) {
        const s = String(status || '').trim();
        let badgeClass = 'badge-light-secondary'; // Varsayılan gri

        switch (s) {
            case 'Devam Ediyor':
                badgeClass = 'badge-light-primary'; // Mavi
                break;
            case 'Bilirkişi İncelemesinde':
                badgeClass = 'badge-light-info'; // Açık Mavi/Cyan
                break;
            case 'Karar Aşamasında':
                badgeClass = 'badge-light-warning'; // Turuncu (Bekleme)
                break;
            case 'Karar Verildi (Kısa Karar)':
                badgeClass = 'badge-light-success'; // Yeşil (Sonuç var ama bitmedi)
                break;
            case 'Gerekçeli Karar Yazıldı':
                badgeClass = 'badge-light-danger'; // Kırmızı (Dikkat! Süreler başlayacak/başladı)
                break;
            case 'İstinaf / Bölge Adliye':
            case 'Temyiz / Yargıtay':
                badgeClass = 'badge-light-dark'; // Koyu/Siyah (Yüksek Yargı)
                break;
            case 'Kesinleşti':
                badgeClass = 'badge-success'; // Koyu Yeşil (Tamamen Bitti)
                break;
            case 'Beklemede':
                badgeClass = 'badge-light-secondary'; // Gri
                break;
        }

        return `<span class="badge ${badgeClass} border">${s}</span>`;
    }

    renderLitigationRow(row, index) {
        const tr = document.createElement('tr');
        tr.dataset.id = row.id;
        
        if (row.hasChildren) {
            tr.dataset.groupId = row.id; // Accordion için ID
            tr.className = 'group-header';
        }

        const suitTypeStr = String(row.suitType || '');
        if (suitTypeStr.includes('İptal')) tr.style.backgroundColor = '#fff5f8';
        else if (suitTypeStr.includes('Tecavüz')) tr.style.backgroundColor = '#fff8f0';
        
        const actions = `
            <div class="d-flex gap-1 justify-content-end">
                <button class="action-btn view-btn btn btn-sm btn-info" data-id="${row.id}"><i class="fas fa-eye"></i></button>
                <button class="action-btn edit-btn btn btn-sm btn-warning" data-id="${row.id}"><i class="fas fa-edit"></i></button>
            </div>`;
            
        const statusBadge = this._getLitigationStatusBadge(row.suitStatus);
        
        // Accordion Oku
        const caret = row.hasChildren ? `<i class="fas fa-chevron-right row-caret text-primary" style="cursor:pointer;"></i>` : '';

        tr.innerHTML = `
            <td class="font-weight-bold text-muted pl-4">${index}</td> <td class="text-center toggle-cell">${caret}</td> <td title="${row.title || ''}">${row.title || '-'}</td>
            <td title="${row.suitType || ''}">${row.suitType || '-'}</td>
            <td title="${row.caseNo || ''}"><span class="badge badge-light border">${row.caseNo || '-'}</span></td>
            <td title="${row.court || ''}">${row.court || '-'}</td>
            <td title="${row.client || ''}">${row.client || '-'}</td>
            <td title="${row.opposingParty || ''}">${row.opposingParty || '-'}</td>
            <td>${statusBadge}</td>
            <td>${row.openedDate || '-'}</td>
            <td>${actions}</td>`;
            
        return tr;
    }
    
    renderLitigationChildRow(child) {
        const tr = document.createElement('tr');
        tr.className = 'child-row bg-light'; // Gri arka plan
        tr.style.display = 'none'; // Başlangıçta gizli
        tr.dataset.parentId = child.parentId;

        // Tarih formatı
        let dateDisplay = '-';
        try {
            if(child.date) {
                const d = child.date.toDate ? child.date.toDate() : new Date(child.date);
                dateDisplay = d.toLocaleDateString('tr-TR');
            }
        } catch(e){}

        tr.innerHTML = `
            <td></td> <td class="text-center"><i class="fas fa-level-up-alt fa-rotate-90 text-muted"></i></td>
            
            <td colspan="2">
                <strong>${child.description}</strong> </td>
            <td colspan="5">
                <span class="text-muted small"><i class="far fa-clock mr-1"></i> ${dateDisplay}</span>
            </td>
            <td colspan="2">
                <span class="badge badge-light-info">İşlem Kaydı</span>
            </td>
        `;
        return tr;
    }
    
    renderObjectionRow(row, hasChildren, isChild = false) {
        const tr = document.createElement('tr');
        tr.className = isChild ? 'group-row child-row' : (hasChildren ? 'group-header' : '');
        if (isChild) tr.setAttribute('aria-hidden', 'true');
        
        const docsHtml = (row.documents || []).map(doc => `
            <a href="${doc.fileUrl}" target="_blank" class="pdf-link ${doc.type === 'epats_document' ? 'text-info' : 'text-danger'}" title="${doc.fileName}">
                <i class="fas ${doc.type === 'epats_document' ? 'fa-file-invoice' : 'fa-file-pdf'}"></i>
            </a>
        `).join('');

        const caret = hasChildren ? `<i class="fas fa-chevron-right row-caret" style="cursor:pointer;"></i>` : '';
        const indentation = isChild ? 'style="padding-left: 30px; border-left: 3px solid #f39c12;"' : '';

        // Child ise durum metni BOŞ olsun
        const statusDisplay = isChild ? '' : (row.statusText || '-');

        tr.innerHTML = `
            <td class="toggle-cell text-center">${caret}</td>
            <td ${indentation} title="${row.transactionTypeName} - ${row.title}">
                ${isChild ? '↳ ' : ''} <strong>${row.transactionTypeName}</strong>
                <div class="small text-muted">${row.title}</div>
            </td>
            <td title="${row.applicationNumber}">${row.applicationNumber || '-'}</td>
            <td title="${row.applicantName}">${row.applicantName || '-'}</td>
            <td title="${row.opponent}">${row.opponent || '-'}</td>
            <td>${row.bulletinDate || '-'}</td>
            <td>${row.bulletinNo || '-'}</td>
            <td>${row.epatsDate || '-'}</td>
            <td>${statusDisplay}</td>
            <td>${docsHtml || '-'}</td>
        `;
        
        if (hasChildren) tr.dataset.groupId = row.id;
        if (isChild) tr.dataset.parentId = row.parentId;

        return tr;
    }

    formatDate(d) {
        if (!d) return '-';
        try { return new Date(d).toLocaleDateString('tr-TR'); } catch { return String(d); }
    }
    
    // --- GÜNCELLENEN DURUM ROZETİ (Utils.js Entegrasyonu) ---
    getStatusBadge(record) {
        const rawStatus = record.status;
        let displayStatus = rawStatus || '-';
        
        // Utils dosyasındaki STATUSES'tan çeviri yap
        if (record.type && STATUSES[record.type]) {
            const statusObj = STATUSES[record.type].find(s => s.value === rawStatus);
            if (statusObj) {
                displayStatus = statusObj.text;
            }
        } else {
            // Kayıt tipi eşleşmezse (örn. 'patent' tipi yoksa) genel arama yap
            for (const type in STATUSES) {
                const found = STATUSES[type].find(s => s.value === rawStatus);
                if (found) {
                    displayStatus = found.text;
                    break;
                }
            }
        }

        // Renk belirleme
        let color = 'secondary';
        const s = String(rawStatus).toLowerCase();
        
        if (['registered', 'approved', 'active', 'tescilli'].includes(s)) color = 'success';
        else if (['filed', 'application', 'pending', 'published', 'partial_refusal', 'basvuru', 'yayinlandi'].includes(s)) color = 'warning';
        else if (['rejected', 'refused', 'expired', 'invalidated', 'invalid_not_renewed', 'withdrawn', 'reddedildi'].includes(s)) color = 'danger';
        else if (['opposition_filed', 'itiraz'].includes(s)) color = 'info';

        return `<span class="badge badge-${color} border">${displayStatus}</span>`;
    }
}