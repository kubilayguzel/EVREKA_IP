// public/js/portfolio/PortfolioRenderer.js
import '../simple-loading.js'; // SimpleLoading scriptini çağır

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
            // Eski spinner'ı gizle (çakışma olmasın)
            if (defaultSpinner) defaultSpinner.style.display = 'none';
            
            // SimpleLoading'i göster
            if (this.simpleLoader) {
                this.simpleLoader.show({
                    text: 'Veriler Yükleniyor',
                    subtext: 'Lütfen bekleyiniz, kayıtlar taranıyor...'
                });
            } else if (defaultSpinner) {
                // Eğer SimpleLoading yüklenemedi ise eskisini göster (Fallback)
                defaultSpinner.style.display = 'flex';
            }
        } else {
            // Hepsini gizle
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

        let html = `
            <td><input type="checkbox" class="record-checkbox" data-id="${record.id}" ${isSelected ? 'checked' : ''}></td>
            <td class="toggle-cell text-center">${caret}</td>
            
            <td><div class="badge badge-${record.portfoyStatus === 'active' ? 'success' : 'secondary'}">${record.portfoyStatus === 'active' ? 'Aktif' : 'Pasif'}</div></td>
        `;

        if (!isTrademarkTab) {
            html += `<td>${record.type || '-'}</td>`;
        }

        html += `
            <td><strong>${record.title || record.brandText || '-'}</strong></td>
            ${imgHtml}
            ${isTrademarkTab ? `<td>${record.origin || '-'}</td>` : ''}
            ${isTrademarkTab ? `<td>${countryName}</td>` : ''}
            <td>${record.applicationNumber || (isWipoParent ? irNo : '-')}</td>
            <td>${this.formatDate(record.applicationDate)}</td>
            
            <td>${this.getStatusBadge(record)}</td>
            
            <td><small>${record.formattedApplicantName || '-'}</small></td>
            <td>${actions}</td>
        `;

        tr.innerHTML = html;
        return tr;
    }

    renderLitigationRow(row) {
        const tr = document.createElement('tr');
        tr.dataset.id = row.id;
        const suitTypeStr = String(row.suitType || '');
        if (suitTypeStr.includes('İptal')) tr.style.backgroundColor = '#ffebee';
        else if (suitTypeStr.includes('Tecavüz')) tr.style.backgroundColor = '#fff3e0';
        
        const actions = `
            <div class="d-flex gap-1 justify-content-end">
                <button class="action-btn view-btn btn btn-sm btn-info" data-id="${row.id}"><i class="fas fa-eye"></i></button>
                <button class="action-btn edit-btn btn btn-sm btn-warning" data-id="${row.id}"><i class="fas fa-edit"></i></button>
            </div>`;
            
        tr.innerHTML = `<td>${row.title || '-'}</td><td>${row.suitType || '-'}</td><td>${row.caseNo || '-'}</td><td>${row.court || '-'}</td><td>${row.client || '-'}</td><td>${row.opposingParty || '-'}</td><td>${row.openedDate || '-'}</td><td>${actions}</td>`;
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
            <td ${indentation}>
                ${isChild ? '↳ ' : ''} <strong>${row.transactionTypeName}</strong>
                <div class="small text-muted">${row.title}</div>
            </td>
            <td>${row.applicationNumber || '-'}</td>
            <td>${row.applicantName || '-'}</td>
            <td>${row.opponent || '-'}</td>
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
        const text = record.status || '-';
        let color = 'light';
        if (text === 'registered' || text === 'Tescilli') color = 'success';
        if (text === 'application' || text === 'Başvuru') color = 'warning';
        return `<span class="badge badge-${color} border">${text}</span>`;
    }
}