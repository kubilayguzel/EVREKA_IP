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
    
// --- BAŞVURU MODALI (SADE TASARIM) ---
    ensureApplicationDataModal() {
        if (document.getElementById('applicationDataModal')) return;

        const modalHtml = `
        <div class="modal fade" id="applicationDataModal" tabindex="-1" role="dialog" aria-hidden="true" data-backdrop="static" data-keyboard="false">
            <div class="modal-dialog modal-dialog-centered" role="document">
                <div class="modal-content shadow-sm">
                    
                    <div class="modal-header bg-light text-dark border-bottom">
                        <h5 class="modal-title font-weight-bold">
                            <i class="fas fa-file-contract mr-2"></i>Başvuru Bilgileri
                        </h5>
                    </div>

                    <div class="modal-body p-4">
                        <div class="alert alert-secondary border-0 mb-4" style="font-size: 0.9em;">
                            <i class="fas fa-info-circle mr-1"></i>
                            Yüklenen evrak bir başvuru işlemidir. Lütfen ilgili varlığın (Marka/Patent) başvuru bilgilerini güncelleyiniz.
                        </div>

                        <div class="form-group">
                            <label class="font-weight-bold mb-1">Başvuru Numarası</label>
                            <input type="text" id="modalAppNumber" class="form-control" placeholder="Örn: 2025/12345">
                            <small class="text-muted">Bu bilgi Marka/Patent kartına işlenecektir.</small>
                        </div>

                        <div class="form-group mb-0">
                            <label class="font-weight-bold mb-1">Başvuru Tarihi</label>
                            <input type="date" id="modalAppDate" class="form-control">
                        </div>
                    </div>

                    <div class="modal-footer bg-light border-top">
                        <button type="button" class="btn btn-primary px-4" id="btnSaveApplicationData">
                            <i class="fas fa-check mr-2"></i>Kaydet ve Kapat
                        </button>
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