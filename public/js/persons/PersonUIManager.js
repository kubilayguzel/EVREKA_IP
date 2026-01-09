// public/js/persons/PersonUIManager.js
import { PersonDataManager } from './PersonDataManager.js';
import Pagination from '../pagination.js';

export class PersonUIManager {
    constructor() {
        this.dataManager = new PersonDataManager();
        this.allPersons = [];
        this.pagination = new Pagination({
            containerId: 'paginationContainer',
            onPageChange: () => this.renderTable()
        });
    }

    async loadPersons() {
        const res = await this.dataManager.fetchPersons();
        if (res.success) {
            this.allPersons = res.data;
            this.renderTable();
        }
    }

    renderTable() {
        const tableBody = document.getElementById('personsTableBody');
        tableBody.innerHTML = '';
        const data = this.pagination.getCurrentPageData(this.allPersons);
        
        data.forEach((p, idx) => {
            const row = `
                <tr>
                    <td>${this.pagination.getStartIndex() + idx + 1}</td>
                    <td>${p.name}</td>
                    <td>${p.tckn || p.taxNo || '-'}</td>
                    <td>${p.tpeNo || '-'}</td>
                    <td>${p.email || '-'}</td>
                    <td><span class="type-badge type-${p.type}">${p.type === 'gercek' ? 'Gerçek' : 'Tüzel'}</span></td>
                    <td class="text-right">
                        <button class="action-btn edit-btn btn-sm mr-1" data-id="${p.id}" title="Düzenle">
                            <i class="fas fa-edit edit-btn" data-id="${p.id}"></i>
                        </button>
                        <button class="action-btn delete-btn btn-sm" data-id="${p.id}" title="Sil">
                            <i class="fas fa-trash-alt delete-btn" data-id="${p.id}"></i>
                        </button>
                    </td>
                </tr>`;
            tableBody.insertAdjacentHTML('beforeend', row);
        });
    }
}