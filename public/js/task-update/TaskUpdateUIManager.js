// public/js/task-update/TaskUpdateUIManager.js

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
            
            // Konteynerler
            filesContainer: document.getElementById('fileListContainer'),
            epatsContainer: document.getElementById('epatsFileListContainer'),
            historyContainer: document.getElementById('historyList'),
            accrualsContainer: document.getElementById('accrualsContainer'),
            
            // Arama/Seçim Alanları
            ipSearch: document.getElementById('relatedIpRecordSearch'),
            ipResults: document.getElementById('relatedIpRecordSearchResults'),
            ipDisplay: document.getElementById('selectedIpRecordDisplay'),
            
            partySearch: document.getElementById('relatedPartySearch'),
            partyResults: document.getElementById('relatedPartySearchResults'),
            partyDisplay: document.getElementById('selectedRelatedPartyDisplay')
        };
    }

    // --- FORM DOLDURMA ---
    fillForm(task, users) {
        this.elements.title.value = task.title || '';
        this.elements.desc.value = task.description || '';
        this.elements.priority.value = task.priority || 'medium';
        this.elements.dueDate.value = this.formatDateForInput(task.dueDate);
        this.elements.deliveryDate.value = this.formatDateForInput(task.deliveryDate);
        
        // İş Tipi Gösterimi
        const typeParts = (task.taskType || '').split('_');
        const main = typeParts[0] || '';
        const sub = typeParts.slice(1).join(' ');
        this.elements.typeDisplay.value = `${main.toUpperCase()} - ${sub}`;

        // Atanan Kişi
        const user = users.find(u => u.id === task.assignedTo_uid);
        this.elements.assignedDisplay.value = user ? (user.displayName || user.email) : 'Atanmamış';

        // Statü Dropdown
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

    // --- LİSTELEMELER ---
    renderDocuments(docs) {
        const container = this.elements.filesContainer;
        if (!docs || docs.length === 0) {
            container.innerHTML = '<p class="text-center text-muted p-3">Belge yok.</p>';
            return;
        }

        container.innerHTML = docs.map(d => `
            <div class="file-item">
                <div class="file-info">
                    <i class="fas fa-file-alt file-icon"></i>
                    <div class="file-details">
                        <a href="${d.downloadURL || d.url}" target="_blank" class="file-name">${d.name}</a>
                        <span class="file-size">${formatFileSize(d.size)}</span>
                    </div>
                </div>
                <button type="button" class="btn btn-sm btn-outline-danger btn-remove-file" data-id="${d.id}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
    }

    renderEpatsDocument(doc) {
        const container = this.elements.epatsContainer;
        const noInput = document.getElementById('turkpatentEvrakNo');
        const dateInput = document.getElementById('epatsDocumentDate');

        if (!doc) {
            container.innerHTML = '';
            noInput.value = '';
            dateInput.value = '';
            return;
        }

        noInput.value = doc.turkpatentEvrakNo || '';
        dateInput.value = this.formatDateForInput(doc.documentDate);

        container.innerHTML = `
            <div class="alert alert-info d-flex justify-content-between align-items-center">
                <div>
                    <strong>${doc.name}</strong>
                    <br><small>EPATS Evrakı</small>
                </div>
                <div>
                    <a href="${doc.downloadURL || doc.url}" target="_blank" class="btn btn-sm btn-primary mr-2">İndir</a>
                    <button type="button" id="removeEpatsFileBtn" class="btn btn-sm btn-danger">Sil</button>
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

    // --- SEÇİM GÖSTERİMLERİ ---
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
                <br><small>Başvuru: ${record.applicationNumber || '-'}</small>
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
    
    // --- YARDIMCILAR ---
    formatDateForInput(date) {
        if (!date) return '';
        try {
            const d = (typeof date === 'object' && date.toDate) ? date.toDate() : new Date(date);
            if (isNaN(d.getTime())) return '';
            return d.toISOString().split('T')[0];
        } catch { return ''; }
    }

    toggleLoading(show) {
        // İsteğe bağlı global loading
    }
}