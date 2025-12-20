export class PortfolioRenderer {
    constructor(dataManager) {
        this.dataManager = dataManager;
        // Tablo gövdesini seçiyoruz. HTML'de id="portfolioTableBody" olmalı.
        this.tbody = document.getElementById('portfolioTableBody');
        this.thead = document.querySelector('#portfolioTable thead tr'); 
    }

    // Tabloyu Temizle
    clear() {
        if (this.tbody) {
            this.tbody.innerHTML = '';
        }
    }

    // Başlıkları Çiz (Dinamik Kolonlar)
    renderHeader(columns) {
        if (!this.thead) return;
        this.thead.innerHTML = '';

        columns.forEach(col => {
            const th = document.createElement('th');
            th.className = `min-w-${col.width || '100px'} ${col.className || ''}`;
            
            if (col.isCheckbox) {
                th.innerHTML = `
                    <div class="form-check form-check-sm form-check-custom form-check-solid me-3">
                        <input class="form-check-input" type="checkbox" id="selectAll" />
                    </div>`;
            } else {
                th.textContent = col.label || '';
                if (col.sortable) {
                    th.style.cursor = 'pointer';
                    th.classList.add('sortable-header');
                    // Sıralama ikonu eklenebilir
                    th.innerHTML += ' <i class="fas fa-sort text-muted ms-1 small"></i>';
                    th.onclick = () => window.app.handleSort(col.key); // Global app referansı üzerinden
                }
            }
            this.thead.appendChild(th);
        });
    }

    // --- A) STANDART SATIR (Marka/Patent/Tasarım) ---
    renderStandardRow(record, isTrademarkTab, isSelected, index) {
        const tr = document.createElement('tr');
        tr.dataset.id = record.id;
        if (isSelected) tr.classList.add('bg-light-primary');

        // WIPO Parent/Child Ayarı
        const isWipoParent = (record.origin === 'WIPO' || record.origin === 'ARIPO') && record.transactionHierarchy === 'parent';
        const isChild = record.transactionHierarchy === 'child'; 
        const irNo = record.wipoIR || record.aripoIR;
        
        if (isWipoParent && irNo) {
            tr.dataset.groupId = irNo;
            tr.className = 'group-header';
        }

        const countryName = this.dataManager.getCountryName(record.country);
        
        // Görsel HTML (Sadece Marka Tabında)
        const imgHtml = isTrademarkTab ? 
            `<td>
                <div class="symbol symbol-45px me-2">
                    <img src="${record.imagePath || record.brandImageUrl || 'assets/media/svg/files/blank-image.svg'}" 
                         class="h-100 align-self-end" 
                         onerror="this.src='assets/media/svg/files/blank-image.svg'" 
                         style="object-fit:contain;">
                </div>
             </td>` : '';

        // Aksiyon Butonları
        const actions = `
            <div class="d-flex justify-content-end flex-shrink-0">
                <a href="${isTrademarkTab ? 'portfolio-detail.html' : 'portfolio-detail.html'}?id=${record.id}" class="btn btn-icon btn-bg-light btn-active-color-primary btn-sm me-1" title="Görüntüle">
                    <i class="fas fa-eye"></i>
                </a>
                <a href="#" class="btn btn-icon btn-bg-light btn-active-color-primary btn-sm me-1 edit-btn" data-id="${record.id}" title="Düzenle">
                    <i class="fas fa-edit"></i>
                </a>
            </div>
        `;

        const caret = isWipoParent ? `<i class="fas fa-chevron-right row-caret text-gray-600" style="cursor:pointer;"></i>` : '';
        const titleText = record.title || record.brandText || '-';
        const appNoText = record.applicationNumber || (isWipoParent ? irNo : '-');
        const applicantText = record.formattedApplicantName || '-';

        // HTML OLUŞTURMA
        let html = `
            <td>
                <div class="form-check form-check-sm form-check-custom form-check-solid">
                    <input class="form-check-input record-checkbox" type="checkbox" data-id="${record.id}" ${isSelected ? 'checked' : ''} />
                </div>
            </td>
            <td class="text-gray-800 fw-bold">${index || ''}</td>
            <td class="text-center toggle-cell">${caret}</td>
            <td>${this._getStatusBadge(record.portfoyStatus)}</td>
        `;

        if (!isTrademarkTab) { 
            html += `<td><span class="badge badge-light fw-bolder">${record.type || '-'}</span></td>`; 
        }

        html += `<td class="text-gray-800 fw-bolder mb-1 fs-6" title="${titleText}">${titleText}</td>`;

        if (isTrademarkTab) {
            html += imgHtml;
            html += `<td><span class="text-gray-600 fw-bold d-block fs-7">${record.origin || '-'}</span></td>`;
            html += `<td title="${countryName}"><span class="text-gray-600 fw-bold d-block fs-7">${countryName}</span></td>`;
        }

        html += `<td class="text-gray-600 fw-bold text-hover-primary mb-1 fs-6">${appNoText}</td>`;
        html += `<td><span class="text-gray-600 fw-bold d-block fs-7">${this.formatDate(record.applicationDate)}</span></td>`;
        
        // Sınıflar (Rozetler Halinde)
        let classesHtml = '';
        if(record.classes && Array.isArray(record.classes)) {
             classesHtml = record.classes.map(c => `<span class="badge badge-light-primary fw-bolder me-1">${c}</span>`).join('');
        } else if (record.niceClasses) {
             // Eski veri yapısı desteği
             const cls = Array.isArray(record.niceClasses) ? record.niceClasses : [record.niceClasses];
             classesHtml = cls.map(c => `<span class="badge badge-light-primary fw-bolder me-1">${c}</span>`).join('');
        }
        html += `<td>${classesHtml}</td>`;

        html += `<td><span class="text-gray-600 fw-bold d-block fs-7" title="${applicantText}">${applicantText}</span></td>`;
        html += `<td class="text-end">${actions}</td>`;

        tr.innerHTML = html;
        return tr;
    }

    // --- B) DAVA SATIRI (Litigation) ---
    renderLitigationRow(row, index) {
        const tr = document.createElement('tr');
        tr.dataset.id = row.id;
        
        // Alt işlemler varsa gruplama ID'si ver
        if (row.hasChildren) {
            tr.dataset.groupId = row.id;
            tr.className = 'group-header cursor-pointer'; // Tıklanabilir imleç
        }

        // Satır Renklendirme (İptal/Tecavüz)
        const suitTypeStr = String(row.suitType || '');
        if (suitTypeStr.includes('İptal')) tr.style.backgroundColor = '#fff5f8';
        else if (suitTypeStr.includes('Tecavüz')) tr.style.backgroundColor = '#fff8f0';
        
        // Aksiyonlar
        const actions = `
            <div class="d-flex justify-content-end flex-shrink-0">
                <a href="suit-detail.html?id=${row.id}" class="btn btn-icon btn-bg-light btn-active-color-primary btn-sm me-1" title="Dava Detayı">
                    <i class="fas fa-eye"></i>
                </a>
                <a href="#" class="btn btn-icon btn-bg-light btn-active-color-primary btn-sm me-1 edit-btn" data-id="${row.id}" title="Düzenle">
                    <i class="fas fa-edit"></i>
                </a>
            </div>`;
            
        const statusBadge = this._getLitigationStatusBadge(row.suitStatus);
        const caret = row.hasChildren ? `<i class="fas fa-chevron-right row-caret text-primary fs-5" style="transition: transform 0.2s;"></i>` : '';

        tr.innerHTML = `
            <td class="text-gray-800 fw-bold ps-4">${index}</td>
            <td class="text-center toggle-cell">${caret}</td>
            
            <td class="text-gray-800 fw-bolder mb-1 fs-6" title="${row.title || ''}">${row.title || '-'}</td>
            <td><span class="badge badge-light fw-bolder">${row.suitType || '-'}</span></td>
            <td><span class="badge badge-light-dark fw-bolder">${row.caseNo || '-'}</span></td>
            <td><span class="text-gray-600 fw-bold d-block fs-7">${row.court || '-'}</span></td>
            <td><span class="text-gray-600 fw-bold d-block fs-7">${row.client || '-'}</span></td>
            <td><span class="text-gray-600 fw-bold d-block fs-7">${row.opposingParty || '-'}</span></td>
            <td>${statusBadge}</td>
            <td><span class="text-gray-600 fw-bold d-block fs-7">${row.openedDate || '-'}</span></td>
            <td class="text-end">${actions}</td>`;
            
        return tr;
    }

    // --- C) DAVA ALT İŞLEM SATIRI ---
    renderLitigationChildRow(child) {
        const tr = document.createElement('tr');
        tr.className = 'child-row bg-light'; // Ayırt edici arka plan
        tr.style.display = 'none'; // Başlangıçta gizli
        tr.dataset.parentId = child.parentId;

        // Tarih formatı
        let dateDisplay = '-';
        if(child.date) {
            try {
                const d = child.date.toDate ? child.date.toDate() : new Date(child.date);
                dateDisplay = d.toLocaleDateString('tr-TR');
            } catch(e){}
        }

        tr.innerHTML = `
            <td></td> <td class="text-end pe-3"><i class="fas fa-level-up-alt fa-rotate-90 text-gray-400"></i></td>
            
            <td colspan="2">
                <span class="text-gray-800 fw-bold fs-7">${child.transactionTypeName}</span>
                <br>
                <span class="text-muted fs-8">${child.description}</span>
            </td>
            <td colspan="5"></td> <td>
                <span class="text-gray-600 fw-bold fs-7"><i class="far fa-clock me-1"></i> ${dateDisplay}</span>
            </td>
            <td class="text-end pe-4">
                <span class="badge badge-light-info fs-8">İşlem Kaydı</span>
            </td>
        `;
        return tr;
    }

    // --- D) İTİRAZ SATIRI (Placeholder) ---
    renderObjectionRow(row, hasChildren, isChild, index) {
        const tr = document.createElement('tr');
        // İtiraz render mantığı buraya eklenecek...
        return tr;
    }

    // --- YARDIMCILAR ---

    _getStatusBadge(status) {
        // 'active' -> Aktif, 'inactive' -> Pasif
        if (status === 'active') return '<span class="badge badge-light-success fw-bolder">Aktif</span>';
        return '<span class="badge badge-light-secondary fw-bolder">Pasif</span>';
    }

    _getLitigationStatusBadge(status) {
        const s = String(status || '').trim();
        let badgeClass = 'badge-light-secondary'; // Gri

        switch (s) {
            case 'Devam Ediyor': badgeClass = 'badge-light-primary'; break; // Mavi
            case 'Bilirkişi İncelemesinde': badgeClass = 'badge-light-info'; break; // Açık Mavi
            case 'Karar Aşamasında': badgeClass = 'badge-light-warning'; break; // Turuncu
            case 'Karar Verildi (Kısa Karar)': badgeClass = 'badge-light-success'; break; // Yeşil
            case 'Gerekçeli Karar Yazıldı': badgeClass = 'badge-light-danger'; break; // Kırmızı
            case 'İstinaf / Bölge Adliye': 
            case 'Temyiz / Yargıtay': badgeClass = 'badge-light-dark'; break; // Siyah
            case 'Kesinleşti': badgeClass = 'badge-success'; break; // Koyu Yeşil
        }
        return `<span class="badge ${badgeClass} fw-bolder">${s}</span>`;
    }

    formatDate(dateVal) {
        if (!dateVal) return '-';
        try {
            const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
            if(isNaN(d.getTime())) return '-';
            return d.toLocaleDateString('tr-TR');
        } catch (e) {
            return '-';
        }
    }
}