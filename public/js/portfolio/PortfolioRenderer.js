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
            // Başlık Satırı
            const th = document.createElement('th');
            if (col.width) th.style.width = col.width; // Genişlik ayarı
            
            th.className = col.sortable ? 'sortable-header inactive' : '';
            if (col.sortable) th.dataset.column = col.key;
            
            th.textContent = col.label || '';
            if (col.isCheckbox) {
                th.innerHTML = '<input type="checkbox" id="selectAllCheckbox">';
            }
            headerRow.appendChild(th);

            // Filtre Satırı
            const thF = document.createElement('th');
            if (col.sortable && !col.isCheckbox && col.key !== 'toggle' && col.key !== 'actions') {
                thF.innerHTML = `<input type="text" class="column-filter form-control form-control-sm" data-column="${col.key}" placeholder="Ara...">`;
            }
            filterRow.appendChild(thF);
        });
    }

    // --- STANDART ROW (TÜMÜ / MARKA / PATENT) ---
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

        // Helper veriler
        const countryName = this.dataManager.getCountryName(record.country);
        const caret = isWipoParent ? `<i class="fas fa-chevron-right row-caret" style="cursor:pointer;"></i>` : '';

        // --- HTML OLUŞTURMA (Main.js kolon sırasına göre) ---
        let html = '';

        // 1. Seçim (Checkbox)
        html += `<td><input type="checkbox" class="record-checkbox" data-id="${record.id}" ${isSelected ? 'checked' : ''}></td>`;
        
        // 2. Toggle (Ok)
        html += `<td class="toggle-cell text-center">${caret}</td>`;
        
        // 3. Portföy Durumu (Aktif/Pasif)
        html += `<td><div class="badge badge-${record.portfoyStatus === 'active' ? 'success' : 'secondary'}">${record.portfoyStatus === 'active' ? 'Aktif' : 'Pasif'}</div></td>`;

        // 4. Tür (Sadece 'Tümü' vb. sekmelerde)
        if (!isTrademarkTab) {
            html += `<td>${record.type || '-'}</td>`;
        }

        // 5. Başlık
        html += `<td><strong>${record.title || record.brandText || '-'}</strong></td>`;

        // --- MARKA İSE EK KOLONLAR ---
        if (isTrademarkTab) {
            // 6. Görsel
            html += `<td><div class="trademark-image-wrapper">${record.brandImageUrl ? `<img class="trademark-image-thumbnail" src="${record.brandImageUrl}" loading="lazy">` : ''}</div></td>`;
            // 7. Menşe
            html += `<td>${record.origin || '-'}</td>`;
            // 8. Ülke
            html += `<td>${countryName}</td>`;
        }

        // 9. Başvuru No (WIPO ise IR No gösterilebilir)
        html += `<td>${record.applicationNumber || (isWipoParent ? irNo : '-')}</td>`;
        
        // 10. Başvuru Tarihi
        html += `<td>${this.formatDate(record.applicationDate)}</td>`;
        
        // 11. Başvuru Durumu (Badge)
        html += `<td>${this.getStatusBadge(record)}</td>`;
        
        // 12. Başvuru Sahibi (PortfolioDataManager'dan gelen zenginleştirilmiş veri)
        html += `<td><small>${record.formattedApplicantName || '-'}</small></td>`;
        
        // 13. İşlemler
        html += `<td>
            <div class="d-flex gap-1 justify-content-end">
                <button class="action-btn view-btn btn btn-sm btn-info" data-id="${record.id}" title="Görüntüle"><i class="fas fa-eye"></i></button>
                <button class="action-btn edit-btn btn btn-sm btn-warning" data-id="${record.id}" title="Düzenle"><i class="fas fa-edit"></i></button>
                <button class="action-btn delete-btn btn btn-sm btn-danger" data-id="${record.id}" title="Sil"><i class="fas fa-trash"></i></button>
            </div>
        </td>`;

        tr.innerHTML = html;
        return tr;
    }

    // --- LITIGATION (DAVA) ROW ---
    renderLitigationRow(row) {
        const tr = document.createElement('tr');
        tr.dataset.id = row.id;

        // Dava türüne göre satır renklendirme
        const suitTypeStr = String(row.suitType || '');
        if (suitTypeStr.includes('İptal')) tr.style.backgroundColor = '#ffebee';
        else if (suitTypeStr.includes('Tecavüz')) tr.style.backgroundColor = '#fff3e0';

        const actions = `
            <div class="d-flex gap-1 justify-content-end">
                <button class="action-btn view-btn btn btn-sm btn-info" data-id="${row.id}"><i class="fas fa-eye"></i></button>
                <button class="action-btn edit-btn btn btn-sm btn-warning" data-id="${row.id}"><i class="fas fa-edit"></i></button>
            </div>
        `;

        // 8 Kolonlu Yapı
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
        
        // Doküman Linkleri
        const docsHtml = (row.documents || []).map(doc => `
            <a href="${doc.fileUrl}" target="_blank" class="pdf-link ${doc.type === 'epats_document' ? 'text-info' : 'text-danger'}" title="${doc.fileName}">
                <i class="fas ${doc.type === 'epats_document' ? 'fa-file-invoice' : 'fa-file-pdf'}"></i>
            </a>
        `).join('');

        const caret = hasChildren ? `<i class="fas fa-chevron-right row-caret" style="cursor:pointer;"></i>` : '';
        const indentation = isChild ? 'style="padding-left: 30px; border-left: 3px solid #f39c12;"' : '';

        // 10 Kolonlu Yapı
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
            <td>${row.statusText || '-'}</td>
            <td>${docsHtml || '-'}</td>
        `;
        
        if (hasChildren) tr.dataset.groupId = row.id;
        if (isChild) tr.dataset.parentId = row.parentId;

        return tr;
    }

    // --- YARDIMCILAR ---
    formatDate(d) {
        if (!d) return '-';
        try { return new Date(d).toLocaleDateString('tr-TR'); } catch { return String(d); }
    }

    getStatusBadge(record) {
        const text = record.status || '-';
        // Duruma göre renk (örnek)
        let color = 'light';
        if (text === 'registered' || text === 'Tescilli') color = 'success';
        if (text === 'application' || text === 'Başvuru') color = 'warning';
        
        return `<span class="badge badge-${color} border">${text}</span>`;
    }
}