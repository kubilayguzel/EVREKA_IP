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

    renderHeaders(columns, activeFilters = {}) {
        const headerRow = document.getElementById('portfolioTableHeaderRow');
        const thead = headerRow ? headerRow.parentElement : null;

        if (!headerRow || !thead) return;

        headerRow.innerHTML = '';

        // Filtre satırını kontrol et veya oluştur
        let filterRow = document.getElementById('portfolioTableFilterRow');
        if (!filterRow) {
            filterRow = document.createElement('tr');
            filterRow.id = 'portfolioTableFilterRow';
            filterRow.style.backgroundColor = '#f8f9fa';
            thead.appendChild(filterRow);
        }
        filterRow.innerHTML = '';

        columns.forEach(col => {
            // 1. Üst Başlık
            const th = document.createElement('th');
            if (col.width) th.style.width = col.width;
            th.className = col.sortable ? 'sortable-header inactive' : '';
            if (col.sortable) th.dataset.column = col.key;
            th.textContent = col.label || '';
            if (col.isCheckbox) th.innerHTML = '<input type="checkbox" id="selectAllCheckbox">';
            headerRow.appendChild(th);

            // 2. Filtre Inputu
            const filterTh = document.createElement('th');
            filterTh.style.padding = '5px';
            if (col.filterable) {
                const input = document.createElement('input');
                // Tip belirleme (Varsayılan text)
                input.type = col.inputType || 'text';
                
                input.className = 'form-control column-filter';
                // STİL İYİLEŞTİRMELERİ:
                input.style.width = '100%';
                input.style.fontSize = '14px';      // Yazı biraz daha büyük
                input.style.padding = '8px 12px';   // İç boşluk arttırıldı
                input.style.borderRadius = '8px';   // Köşeler yumuşatıldı
                input.style.border = '1px solid #ced4da';
                input.style.height = '38px';        // Tıklama alanı büyütüldü

                // Sadece text ise placeholder ekle
                if (input.type === 'text') {
                    input.placeholder = '🔍 Ara...';
                }

                input.dataset.key = col.key;
                input.value = activeFilters[col.key] || '';
                filterTh.appendChild(input);
            }
            filterRow.appendChild(filterTh);
        });
    }

    // --- STANDART ROW ---
    renderStandardRow(record, isTrademarkTab, isSelected) {
        const tr = document.createElement('tr');
        tr.dataset.id = record.id;
        
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

        // Güvenli Veri Erişimi (Null check ve String'e çevirme)
        const titleText = record.title || record.brandText || '-';
        const appNoText = record.applicationNumber || (isWipoParent ? irNo : '-');
        const applicantText = record.formattedApplicantName || '-';

        let html = `
            <td><input type="checkbox" class="record-checkbox" data-id="${record.id}" ${isSelected ? 'checked' : ''}></td>
            <td class="toggle-cell text-center">${caret}</td>
            
        `;

        if (!isTrademarkTab) {
            html += `<td>${record.type || '-'}</td>`;
        }

        html += `<td title="${titleText}"><strong>${titleText}</strong></td>`;

        if (isTrademarkTab) {
            html += imgHtml;
            html += `<td>${record.origin || '-'}</td>`;
            html += `<td title="${countryName}">${countryName}</td>`;
        }

        html += `<td title="${appNoText}">${appNoText}</td>`;
        html += `<td>${this.formatDate(record.applicationDate)}</td>`;
        
        // Başvuru Durumu (Child ise boş, değilse Utils'den çevrilmiş metin)
        html += `<td>${isChild ? '' : this.getStatusBadge(record)}</td>`;
        
        html += `<td><small title="${applicantText}">${applicantText}</small></td>`;
        // YENİ: Nice Sınıfları
        const niceText = record.formattedNiceClasses || '-';
        html += `<td title="${niceText}">${niceText}</td>`;
        html += `<td>${actions}</td>`;

        tr.innerHTML = html;
        return tr;
    }

    renderLitigationRow(row, index) {
        const tr = document.createElement('tr');
        tr.dataset.id = row.id;
        
        // Dava türüne göre arka plan rengi (Mevcut mantık)
        const suitTypeStr = String(row.suitType || '');
        if (suitTypeStr.includes('İptal')) tr.style.backgroundColor = '#ffebee';
        else if (suitTypeStr.includes('Tecavüz')) tr.style.backgroundColor = '#fff3e0';
        
        // İşlem butonları
        const actions = `
            <div class="d-flex gap-1 justify-content-end">
                <button class="action-btn view-btn btn btn-sm btn-info" data-id="${row.id}" title="Görüntüle"><i class="fas fa-eye"></i></button>
                <button class="action-btn edit-btn btn btn-sm btn-warning" data-id="${row.id}" title="Düzenle"><i class="fas fa-edit"></i></button>
            </div>`;
            
        // Durum Rozeti (utils.js entegrasyonu)
        // Not: DataManager'da row.type = 'litigation' ataması yaptığınızdan emin olun.
        const statusBadge = this.getStatusBadge(row);

        // HTML Yapısı:
        // 1. Sıra No (index)
        // 2-8. Standart Veriler
        // 9. Durum (Status) - İşlemlerden hemen önce
        // 10. İşlemler (Actions)
        tr.innerHTML = `
            <td><strong>${index}</strong></td>
            <td title="${row.title || ''}">${row.title || '-'}</td>
            <td title="${row.suitType || ''}">${row.suitType || '-'}</td>
            <td title="${row.caseNo || ''}">${row.caseNo || '-'}</td>
            <td title="${row.court || ''}">${row.court || '-'}</td>
            <td title="${row.client || ''}">${row.client || '-'}</td>
            <td title="${row.opposingParty || ''}">${row.opposingParty || '-'}</td>
            <td>${row.openedDate || '-'}</td>
            <td>${statusBadge}</td>
            <td>${actions}</td>`;
            
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
    
    getStatusBadge(record) {
        const rawStatus = record.status;
        let displayStatus = rawStatus || '-';
        let color = 'secondary'; // Varsayılan renk (Gri)
        
        // 1. Kayıt tipine göre utils.js'ten doğru listeyi bul (litigation, trademark vb.)
        if (record.type && STATUSES[record.type]) {
            const statusObj = STATUSES[record.type].find(s => s.value === rawStatus);
            
            if (statusObj) {
                displayStatus = statusObj.text; // Türkçe metni al
                if (statusObj.color) color = statusObj.color; // Utils'deki rengi (danger, warning vb.) al
            }
        } else {
            // Tipi bilinmiyorsa veya listede yoksa genel arama yap (Fallback)
            for (const type in STATUSES) {
                const found = STATUSES[type].find(s => s.value === rawStatus);
                if (found) {
                    displayStatus = found.text;
                    if (found.color) color = found.color;
                    break;
                }
            }
        }

        // Eğer hala renk atanmadıysa eski manuel kontrolü yap (Geriye dönük uyumluluk için)
        if (color === 'secondary') {
             const s = String(rawStatus).toLowerCase();
             if (['registered', 'approved', 'active', 'tescilli', 'finalized', 'kesinleşti'].includes(s)) color = 'success';
             else if (['filed', 'application', 'pending', 'published', 'decision_pending', 'karar bekleniyor'].includes(s)) color = 'warning';
             else if (['rejected', 'refused', 'cancelled', 'reddedildi'].includes(s)) color = 'danger';
        }

        return `<span class="badge badge-${color} border">${displayStatus}</span>`;
    }
}