// public/js/components/PersonModalManager.js
import { PersonDataManager } from '../persons/PersonDataManager.js';
import { personService, db } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { doc, collection, writeBatch, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class PersonModalManager {
    constructor(options = {}) {
        this.dataManager = new PersonDataManager();
        this.onSuccess = options.onSuccess || (() => {});
        this.isEdit = false;
        this.currentPersonId = null;
        this.documents = [];
        this.relatedDraft = [];
        this.relatedLoaded = [];
        this.init();
    }

    async init() {
        this.ensureModalMarkup();
        this.setupEventListeners();
    }

    // Modalın HTML içeriğini (Tüm o karmaşık form yapısını) buraya enjekte ediyoruz.
    ensureModalMarkup() {
        if (document.getElementById('personModal')) return;
        // persons.html içindeki <div id="personModal"> içeriğini buraya template literal olarak ekleyin.
        // (Burada tüm To/CC toggle'ları, evrak ekleme alanları vb. yer alacaktır.)
    }

    async open(personId = null) {
        this.currentPersonId = personId;
        this.isEdit = !!personId;
        this.resetForm();
        
        await this.loadCountries();
        
        if (this.isEdit) {
            await this.loadPersonData(personId);
        } else {
            document.getElementById('personModalTitle').textContent = 'Yeni Kişi Ekle';
        }
        window.$('#personModal').modal('show');
    }

    // --- KRİTİK ALAN: Mail Tercihleri Senkronizasyonu ---
    syncMailPrefs() {
        const scopes = ['patent', 'marka', 'tasarim', 'dava', 'muhasebe'];
        scopes.forEach(s => {
            const isChecked = document.getElementById(`scope${s.charAt(0).toUpperCase() + s.slice(1)}`).checked;
            const toEl = document.querySelector(`.mail-to[data-scope="${s}"]`);
            const ccEl = document.querySelector(`.mail-cc[data-scope="${s}"]`);
            if (toEl && ccEl) {
                toEl.disabled = !isChecked;
                ccEl.disabled = !isChecked;
                if (!isChecked) { toEl.checked = false; ccEl.checked = false; }
            }
        });
    }

    // ... handleSave, renderRelatedList, addDocumentHandler metodları ...
}