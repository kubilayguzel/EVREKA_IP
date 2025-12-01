// public/js/portfolio/PortfolioRenderer.js
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
            const th = document.createElement('th');
            th.style.width = col.width;
            th.className = col.sortable ? 'sortable-header inactive' : '';
            if (col.sortable) th.dataset.column = col.key;
            th.textContent = col.label || '';
            if (col.isCheckbox) th.innerHTML = '<input type="checkbox" id="selectAllCheckbox">';
            headerRow.appendChild(th);

            const thF = document.createElement('th');
            if (col.sortable && !col.isCheckbox && col.key !== 'toggle' && col.key !== 'actions') {
                thF.innerHTML = `<input type="text" class="column-filter form-control form-control-sm" data-column="${col.key}" placeholder="Ara...">`;
            }
            filterRow.appendChild(thF);
        });
    }

    // --- STANDART ROW (WIPO DESTEKLİ) ---
    renderStandardRow(record, isTrademarkTab, isSelected) {
        const tr = document.createElement('tr');
        tr.dataset.id = record.id;
        
        // WIPO/ARIPO Parent Kontrolü
        const isWipoParent = (record.origin === 'WIPO' || record.origin === 'ARIPO') && record.transactionHierarchy === 'parent';
        const irNo = record.wipoIR || record.aripoIR;
        
        if (isWipoParent && irNo) {
            tr.dataset.groupId = irNo;
            tr.className = 'group-header';
        }

        const countryName = this.dataManager.getCountryName(record.country);
        const imgHtml = isTrademarkTab ? 
            `<td style="width: 60px;"><div class="trademark-image-wrapper">${record.brandImageUrl ? `<img class="trademark-image-thumbnail" src="${record.brandImageUrl}" loading="lazy">` : ''}</div></td>` : '';

        const actions = `
            <button class="action-btn view-btn" data-id="${record.id}" title="Görüntüle"><i class="fas fa-eye"></i></button>
            <button class="action-btn edit-btn" data-id="${record.id}" title="Düzenle"><i class="fas fa-edit"></i></button>
            <button class="action-btn delete-btn" data-id="${record.id}" title="Sil"><i class="fas fa-trash"></i></button>
        `;

        // Caret (Ok işareti)
        const caret = isWipoParent ? `<i class="fas fa-chevron-right row-caret" style="cursor:pointer;"></i>` : '';

        let html = `
            <td style="width: 40px;"><input type="checkbox" class="record-checkbox" data-id="${record.id}" ${isSelected ? 'checked' : ''}></td>
            <td class="toggle-cell" style="width: 40px;">${caret}</td>
            <td style="width: 90px;"><div class="badge badge-${record.portfoyStatus === 'active' ? 'success' : 'secondary'}">${record.portfoyStatus === 'active' ? 'Aktif' : 'Pasif'}</div></td>
        `;

        if (!isTrademarkTab) html += `<td style="width: 90px;">${record.type || '-'}</td>`;

        html += `
            <td style="width: 220px;"><strong>${record.title || record.brandText || '-'}</strong></td>
            ${imgHtml}
            ${isTrademarkTab ? `<td style="width: 80px;">${record.origin || '-'}</td>` : ''}
            ${isTrademarkTab ? `<td style="width: 80px;">${countryName}</td>` : ''}
            <td style="width: 120px;">${record.applicationNumber || (isWipoParent ? irNo : '-')}</td>
            <td style="width: 105px;">${this.formatDate(record.applicationDate)}</td>
            <td style="width: 115px;">${this.getStatusBadge(record)}</td>
            <td style="width: 200px;">${this.formatApplicants(record)}</td>
            <td style="width: 160px;"><div class="d-flex gap-2">${actions}</div></td>
        `;

        tr.innerHTML = html;
        return tr;
    }

    // --- LITIGATION (DAVA) ROW ---
    renderLitigationRow(row) {
        const tr = document.createElement('tr');
        tr.dataset.id = row.id;

        // Renklendirme Mantığı (Eski Koddan)
        const suitTypeStr = String(row.suitType || '');
        if (suitTypeStr.includes('İptal')) {
            tr.style.backgroundColor = '#ffebee'; // Kırmızımsı
        } else if (suitTypeStr.includes('Tecavüz')) {
            tr.style.backgroundColor = '#fff3e0'; // Turuncumsu
        }

        const actions = `
            <button class="action-btn view-btn" data-id="${row.id}"><i class="fas fa-eye"></i> Görüntüle</button>
            <button class="action-btn edit-btn" data-id="${row.id}"><i class="fas fa-edit"></i></button>
        `;

        tr.innerHTML = `
            <td>${row.title || '-'}</td>
            <td>${row.suitType || '-'}</td>
            <td>${row.caseNo || '-'}</td>
            <td>${row.court || '-'}</td>
            <td>${row.client || '-'}</td>
            <td>${row.opposingParty || '-'}</td>
            <td>${row.openedDate || '-'}</td>
            <td>${actions}</td>
        `;
        return tr;
    }

    // --- OBJECTION (İTİRAZ) ROW ---
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

        tr.innerHTML = `
            <td class="toggle-cell">${caret}</td>
            <td ${indentation}>
                ${isChild ? '↳ ' : ''} ${row.transactionTypeName}
                <div class="small text-muted">${row.title}</div>
            </td>
            <td>${row.applicationNumber || '-'}</td>
            <td>${row.applicantName || '-'}</td>
            <td>${row.opponent || '-'}</td>
            <td>${row.bulletinDate || '-'}</td>
            <td>${row.bulletinNo || '-'}</td>
            <td>${row.epatsDate || '-'}</td>
            <td>${row.statusText || '-'}</td>
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

    formatApplicants(record) {
        // Önce applicantName string field'ını kontrol et
        if (record.applicantName && typeof record.applicantName === 'string') {
            return record.applicantName;
        }
        
        // Sonra applicants array'ini kontrol et
        if (Array.isArray(record.applicants) && record.applicants.length > 0) {
            return record.applicants.map(a => a.name || '-').filter(n => n !== '-').join(', ') || '-';
        }
        
        return '-';
    }

    getStatusBadge(record) {
        const text = record.status || '-';
        return `<span class="badge badge-light border">${text}</span>`;
    }
}