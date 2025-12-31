import { formatFileSize, TASK_STATUSES } from '../../utils.js';

export class TaskUpdateUIManager {
    constructor() {
        this.elements = {
            title: document.getElementById('taskTitle'),
            desc: document.getElementById('taskDescription'),
            priority: document.getElementById('taskPriority'),
            status: document.getElementById('taskStatus'),
            typeDisplay: document.getElementById('taskTypeDisplay'),
            assignedDisplay: document.getElementById('assignedToDisplay'),
            dueDate: document.getElementById('taskDueDate'),
            deliveryDate: document.getElementById('deliveryDate'),
            
            filesContainer: document.getElementById('fileListContainer'),
            epatsContainer: document.getElementById('epatsFileListContainer'), // EPATS listesi
            historyContainer: document.getElementById('historyList'),
            accrualsContainer: document.getElementById('accrualsContainer'),
            
            ipSearch: document.getElementById('relatedIpRecordSearch'),
            ipResults: document.getElementById('relatedIpRecordSearchResults'),
            ipDisplay: document.getElementById('selectedIpRecordDisplay'),
            
            partySearch: document.getElementById('relatedPartySearch'),
            partyResults: document.getElementById('relatedPartySearchResults'),
            partyDisplay: document.getElementById('selectedRelatedPartyDisplay')
        };
    }

    fillForm(task, users) {
        this.elements.title.value = task.title || '';
        this.elements.desc.value = task.description || '';
        this.elements.priority.value = task.priority || 'medium';
        this.elements.dueDate.value = this.formatDateForInput(task.dueDate);
        this.elements.deliveryDate.value = this.formatDateForInput(task.deliveryDate);
        
        const typeParts = (task.taskType || '').split('_');
        const main = typeParts[0] || '';
        const sub = typeParts.slice(1).join(' ');
        this.elements.typeDisplay.value = `${main.toUpperCase()} - ${sub}`;

        const user = users.find(u => u.id === task.assignedTo_uid);
        this.elements.assignedDisplay.value = user ? (user.displayName || user.email) : 'Atanmamış';

        this.populateStatusDropdown(task.status);
    }

    populateStatusDropdown(currentStatus) {
        this.elements.status.innerHTML = '';
        TASK_STATUSES.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.value;
            opt.textContent = s.text;
            if (s.value === currentStatus) opt.selected = true;
            this.elements.status.appendChild(opt);
        });
    }

    renderDocuments(docs) {
        const container = this.elements.filesContainer;
        if (!docs || docs.length === 0) {
            container.innerHTML = '<p class="text-center text-muted p-3">Belge yok.</p>';
            return;
        }

        container.innerHTML = docs.map(d => this._createFileItemHtml(d, false)).join('');
    }

    // --- YENİLENEN EPATS RENDER (Diğer dosyalarla aynı görsel) ---
    renderEpatsDocument(doc) {
        const container = this.elements.epatsContainer;
        const noInput = document.getElementById('turkpatentEvrakNo');
        const dateInput = document.getElementById('epatsDocumentDate');

        // Form alanlarını doldur
        if (doc) {
            // Eğer doc içinde kayıtlı veri varsa onu kullan, yoksa inputtakini koru
            if(doc.turkpatentEvrakNo) noInput.value = doc.turkpatentEvrakNo;
            if(doc.documentDate) dateInput.value = this.formatDateForInput(doc.documentDate);
        } else {
            // Belge yoksa inputları temizle
            noInput.value = '';
            dateInput.value = '';
            container.innerHTML = '';
            return;
        }

        // Görseli oluştur (file-item stili)
        container.innerHTML = this._createFileItemHtml(doc, true);
    }

    // Ortak HTML Oluşturucu (Kod tekrarını önler)
    _createFileItemHtml(d, isEpats) {
        const removeBtnId = isEpats ? 'id="removeEpatsFileBtn"' : `data-id="${d.id}"`;
        const removeClass = isEpats ? 'btn-danger' : 'btn-outline-danger btn-remove-file';
        const iconColor = isEpats ? '#d63384' : '#e74c3c'; // EPATS için pembe, normal için kırmızı
        const subText = isEpats ? '<span class="badge badge-info ml-2">EPATS</span>' : '';

        return `
            <div class="file-item">
                <div class="file-info">
                    <i class="fas fa-file-pdf file-icon" style="color: ${iconColor};"></i>
                    <div class="file-details">
                        <div class="d-flex align-items-center">
                            <a href="${d.downloadURL || d.url}" target="_blank" class="file-name">${d.name}</a>
                            ${subText}
                        </div>
                        <span class="file-size">${formatFileSize(d.size)}</span>
                    </div>
                </div>
                <div class="file-actions">
                    <a href="${d.downloadURL || d.url}" target="_blank" class="btn btn-sm btn-outline-primary">
                        <i class="fas fa-download"></i>
                    </a>
                    <button type="button" class="btn btn-sm ${removeClass}" ${removeBtnId}>
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    renderHistory(history) {
        const container = this.elements.historyContainer;
        if (!history || history.length === 0) {
            container.innerHTML = '<p class="text-muted">Geçmiş yok.</p>';
            return;
        }
        const sorted = [...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        container.innerHTML = sorted.map(h => `
            <div class="history-item">
                <div class="history-item-content">
                    <div class="history-action">${h.action}</div>
                    <div class="history-meta">
                        <span>${h.userEmail}</span>
                        <span>${new Date(h.timestamp).toLocaleString('tr-TR')}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    renderSelectedIpRecord(record) {
        const display = this.elements.ipDisplay;
        if (!record) {
            display.style.display = 'none';
            this.elements.ipSearch.value = '';
            return;
        }
        display.innerHTML = `
            <div>
                <strong>${record.title}</strong>
                <br><small>Başvuru: <span id="displayAppNumber">${record.applicationNumber || '-'}</span></small>
            </div>
            <button type="button" class="btn btn-sm text-danger" id="removeIpRecordBtn">&times;</button>
        `;
        display.style.display = 'flex';
        this.elements.ipSearch.value = '';
        this.elements.ipResults.style.display = 'none';
    }

    renderSelectedPerson(person) {
        const display = this.elements.partyDisplay;
        if (!person) {
            display.style.display = 'none';
            this.elements.partySearch.value = '';
            return;
        }
        display.innerHTML = `
            <div>
                <strong>${person.name}</strong>
                <br><small>${person.email || '-'}</small>
            </div>
            <button type="button" class="btn btn-sm text-danger" id="removeRelatedPartyBtn">&times;</button>
        `;
        display.style.display = 'flex';
        this.elements.partySearch.value = '';
        this.elements.partyResults.style.display = 'none';
    }
    
    // --- BAŞVURU MODALI (Application Data Modal) ---
    // Bu modal HTML'de yok, dinamik yaratıyoruz (Eski sistemdeki gibi)
    ensureApplicationDataModal() {
        if (document.getElementById('applicationDataModal')) return;

        const modalHtml = `
        <div class="modal fade" id="applicationDataModal" tabindex="-1" role="dialog" style="z-index: 1070;">
            <div class="modal-dialog modal-dialog-centered" role="document">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title"><i class="fas fa-file-contract mr-2"></i>Başvuru Bilgileri</h5>
                        <button type="button" class="close text-white" data-dismiss="modal" aria-label="Kapat">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-light border">
                            <i class="fas fa-info-circle text-info mr-1"></i>
                            EPATS evrakı yüklendi. Lütfen başvuru detaylarını giriniz.
                        </div>
                        <div class="form-group">
                            <label class="font-weight-bold">Başvuru Numarası</label>
                            <input type="text" id="modalAppNumber" class="form-control" placeholder="Örn: 2025/12345">
                        </div>
                        <div class="form-group">
                            <label class="font-weight-bold">Başvuru Tarihi</label>
                            <input type="date" id="modalAppDate" class="form-control">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Kapat</button>
                        <button type="button" class="btn btn-primary" id="btnSaveApplicationData">Kaydet</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    formatDateForInput(date) {
        if (!date) return '';
        try {
            const d = (typeof date === 'object' && date.toDate) ? date.toDate() : new Date(date);
            if (isNaN(d.getTime())) return '';
            return d.toISOString().split('T')[0];
        } catch { return ''; }
    }
}