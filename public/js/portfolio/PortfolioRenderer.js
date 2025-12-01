// public/js/portfolio/PortfolioRenderer.js
import { formatFileSize, STATUSES } from '../../utils.js';

export class PortfolioRenderer {
    constructor(containerId, dataManager) {
        this.tbody = document.getElementById(containerId);
        this.dataManager = dataManager;
    }

    clear() {
        if (this.tbody) this.tbody.innerHTML = '';
    }

    showLoading(show) {
        const el = document.getElementById('loadingIndicator');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    renderHeaders(columns) {
        const headerRow = document.getElementById('portfolioTableHeaderRow');
        const filterRow = document.getElementById('portfolioTableFilterRow');
        if (!headerRow || !filterRow) return;

        headerRow.innerHTML = '';
        filterRow.innerHTML = '';

        columns.forEach(col => {
            // Başlık
            const th = document.createElement('th');
            th.style.width = col.width;
            th.className = col.sortable ? 'sortable-header inactive' : '';
            if (col.sortable) th.dataset.column = col.key;
            th.textContent = col.label || '';
            if (col.isCheckbox) {
                th.innerHTML = '<input type="checkbox" id="selectAllCheckbox">';
            }
            headerRow.appendChild(th);

            // Filtre
            const thF = document.createElement('th');
            if (col.sortable && !col.isCheckbox && col.key !== 'toggle' && col.key !== 'actions') {
                thF.innerHTML = `<input type="text" class="column-filter form-control form-control-sm" data-column="${col.key}" placeholder="Ara...">`;
            }
            filterRow.appendChild(thF);
        });
    }

    // --- Standart Satır Render ---
    renderStandardRow(record, isTrademarkTab) {
        const tr = document.createElement('tr');
        tr.dataset.id = record.id;
        
        const countryName = this.dataManager.getCountryName(record.country);
        const imgHtml = isTrademarkTab ? 
            `<td>
                <div class="trademark-image-wrapper">
                    ${record.brandImageUrl ? `<img class="trademark-image-thumbnail" src="${record.brandImageUrl}" loading="lazy">` : ''}
                </div>
             </td>` : '';

        // Aksiyon Butonları
        const actions = `
            <button class="action-btn view-btn" data-id="${record.id}" title="Görüntüle"><i class="fas fa-eye"></i></button>
            <button class="action-btn edit-btn" data-id="${record.id}" title="Düzenle"><i class="fas fa-edit"></i></button>
            <button class="action-btn delete-btn" data-id="${record.id}" title="Sil"><i class="fas fa-trash"></i></button>
        `;

        // Sütunlar
        let html = `
            <td><input type="checkbox" class="record-checkbox" data-id="${record.id}"></td>
            <td>
                <div class="badge badge-${record.portfoyStatus === 'active' ? 'success' : 'secondary'}">
                    ${record.portfoyStatus === 'active' ? 'Aktif' : 'Pasif'}
                </div>
            </td>
        `;

        if (!isTrademarkTab) html += `<td>${record.type || '-'}</td>`;

        html += `
            <td><strong>${record.title || record.brandText || '-'}</strong></td>
            ${imgHtml}
            ${isTrademarkTab ? `<td>${record.origin || '-'}</td>` : ''}
            ${isTrademarkTab ? `<td>${countryName}</td>` : ''}
            <td>${record.applicationNumber || '-'}</td>
            <td>${this.formatDate(record.applicationDate)}</td>
            <td>${this.getStatusBadge(record)}</td>
            <td>${this.formatApplicants(record.applicants)}</td>
            <td><div class="d-flex gap-2">${actions}</div></td>
        `;

        tr.innerHTML = html;
        return tr;
    }

    // --- İtiraz (Objection) Satır Render ---
    // Parent-Child yapısını burada temizce kuruyoruz
    renderObjectionRow(row, hasChildren, isChild = false) {
        const tr = document.createElement('tr');
        tr.className = isChild ? 'group-row child-row' : (hasChildren ? 'group-header' : '');
        if (isChild) tr.setAttribute('aria-hidden', 'true');
        
        // Doküman Linkleri Oluşturma Helper'ı
        const docsHtml = (row.documents || []).map(doc => `
            <a href="${doc.fileUrl}" target="_blank" class="pdf-link ${doc.type === 'epats_document' ? 'text-info' : 'text-danger'}" title="${doc.fileName}">
                <i class="fas ${doc.type === 'epats_document' ? 'fa-file-invoice' : 'fa-file-pdf'}"></i>
            </a>
        `).join('');

        const caret = hasChildren ? `<i class="fas fa-chevron-right row-caret" style="cursor:pointer;"></i>` : '';
        const indentation = isChild ? 'style="padding-left: 30px; border-left: 3px solid #f39c12;"' : '';

        tr.innerHTML = `
            <td class="toggle-cell">${caret}</td>
            <td ${indentation}>
                ${isChild ? '↳ ' : ''} ${row.transactionTypeName}
                <div class="small text-muted">${row.title}</div>
            </td>
            <td>${row.applicationNumber || '-'}</td>
            <td>${row.applicantName || '-'}</td>
            <td>${row.opponent || '-'}</td>
            <td>${row.bulletinNo || '-'}</td>
            <td>${row.statusText || '-'}</td>
            <td>${docsHtml || '-'}</td>
        `;
        
        // Event Listener'ları Controller'a bırakmak yerine ID/Dataset verelim
        if (hasChildren) tr.dataset.groupId = row.id;
        if (isChild) tr.dataset.parentId = row.parentId;

        return tr;
    }

    // --- Yardımcılar ---
    formatDate(d) {
        if (!d) return '-';
        try {
            return new Date(d).toLocaleDateString('tr-TR');
        } catch { return String(d); }
    }

    formatApplicants(applicants) {
        if (!Array.isArray(applicants)) return '-';
        return applicants.map(a => a.name).join(', ');
    }

    getStatusBadge(record) {
        // Status textini utils'den alabiliriz veya direkt basabiliriz
        const text = record.status || '-';
        return `<span class="badge badge-light border">${text}</span>`;
    }
}