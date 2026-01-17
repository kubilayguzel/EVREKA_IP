import { PersonDataManager } from '../persons/PersonDataManager.js';
import { PortfolioDataManager } from '../portfolio/PortfolioDataManager.js';
import { showNotification } from '../../utils.js';

export class EpatsUiManager {
    constructor() {
        this.personData = new PersonDataManager();
        this.portfolioData = new PortfolioDataManager();
        this.selectedIds = new Set();
        this.init();
    }

    async init() {
        // 1. Müvekkil listesini yükle ve select box'ı doldur
        const persons = await this.personData.fetchPersons();
        const select = document.getElementById('epatsClientSelect');
        if (select && persons.success) {
            select.innerHTML = '<option value="">Müvekkil seçin...</option>' + 
                persons.data.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        }

        // 2. Event Listener'ları bağla
        document.getElementById('btnFetchMissingDocs')?.addEventListener('click', () => this.fetchMissingDocuments());
        document.getElementById('selectAllEpats')?.addEventListener('change', (e) => this.toggleAll(e.target.checked));
        document.getElementById('btnStartEpatsTransfer')?.addEventListener('click', () => this.startTransfer());
    }

    // Eksik belgeleri (Transactions koleksiyonunda olmayanları) bulma mantığı
    async fetchMissingDocuments() {
        const clientId = document.getElementById('epatsClientSelect').value;
        if (!clientId) return showNotification('Lütfen bir müvekkil seçin', 'error');

        // Portföy verilerini yükle
        await this.portfolioData.loadInitialData();
        
        // Filtrele: Marka + Tescilli + Seçilen Müvekkil
        const filtered = this.portfolioData.allRecords.filter(r => 
            r.type === 'trademark' && 
            r.status === 'registered' && 
            r.applicants?.some(a => a.id === clientId)
        );

        // TODO: Her kaydın altındaki transactions'da "tescil_belgesi" var mı kontrolü yapılıp tabloya basılacak.
        this.renderResults(filtered);
    }

    renderResults(records) {
        const section = document.getElementById('epatsResultsSection');
        const tbody = document.getElementById('epatsResultsBody');
        section.style.display = 'block';
        
        tbody.innerHTML = records.map(r => `
            <tr>
                <td><input type="checkbox" class="epats-check" value="${r.id}" data-appno="${r.applicationNumber}"></td>
                <td>${r.applicationNumber}</td>
                <td>${r.title}</td>
                <td><span class="status-matched">Kayıtlı</span></td>
            </tr>
        `).join('');
    }
}