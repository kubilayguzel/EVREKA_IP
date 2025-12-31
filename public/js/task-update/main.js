// public/js/task-update/main.js

import { authService, auth, generateUUID } from '../../firebase-config.js';
import { loadSharedLayout, ensurePersonModal, openPersonModal } from '../layout-loader.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { showNotification } from '../../utils.js';

// Modüller
import { TaskUpdateDataManager } from './TaskUpdateDataManager.js';
import { TaskUpdateUIManager } from './TaskUpdateUIManager.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';

class TaskUpdateController {
    constructor() {
        this.dataManager = new TaskUpdateDataManager();
        this.uiManager = new TaskUpdateUIManager();
        this.accrualManager = null; // Tahakkuk Modal Yöneticisi

        this.taskId = null;
        this.taskData = null;
        this.masterData = {}; // ipRecords, persons, users...
        
        this.currentDocuments = [];
        this.uploadedEpatsFile = null;
        this.statusBeforeEpatsUpload = null;
    }

    async init() {
        await loadSharedLayout();
        ensurePersonModal();

        this.taskId = new URLSearchParams(window.location.search).get('id');
        if (!this.taskId) return window.location.href = 'task-management.html';

        onAuthStateChanged(auth, async (user) => {
            if (!user) return window.location.href = 'index.html';
            
            try {
                // 1. Verileri Çek
                this.masterData = await this.dataManager.loadAllInitialData();
                await this.refreshTaskData();

                // 2. Event Listenerları Kur
                this.setupEvents();
                this.setupAccrualModal(); // Tahakkuk modalını hazırla

            } catch (e) {
                console.error('Başlatma hatası:', e);
                alert('Sayfa yüklenemedi: ' + e.message);
            }
        });
    }

    async refreshTaskData() {
        this.taskData = await this.dataManager.getTaskById(this.taskId);
        this.currentDocuments = this.taskData.documents || [];
        
        // Formu Doldur
        this.uiManager.fillForm(this.taskData, this.masterData.users);
        
        // Listeleri Çiz
        this.uiManager.renderDocuments(this.currentDocuments);
        this.uiManager.renderHistory(this.taskData.history);
        this.renderAccruals(); // Tahakkukları listele
        
        // İlişkili Kayıtları Göster
        if (this.taskData.relatedIpRecordId) {
            const rec = this.masterData.ipRecords.find(r => r.id === this.taskData.relatedIpRecordId);
            this.uiManager.renderSelectedIpRecord(rec);
        }

        // İlgili Tarafı Göster (Array'in ilk elemanı veya string ID)
        let ownerId = this.taskData.taskOwner;
        if (Array.isArray(ownerId)) ownerId = ownerId[0];
        
        if (ownerId) {
            const p = this.masterData.persons.find(x => String(x.id) === String(ownerId));
            this.uiManager.renderSelectedPerson(p);
        }

        // EPATS Belgesi
        if (this.taskData.details?.epatsDocument) {
            this.uploadedEpatsFile = this.taskData.details.epatsDocument;
            this.statusBeforeEpatsUpload = this.taskData.details.statusBeforeEpatsUpload;
            this.uiManager.renderEpatsDocument(this.uploadedEpatsFile);
        }
    }

    setupEvents() {
        // Kaydet Butonu
        document.getElementById('saveTaskChangesBtn').addEventListener('click', (e) => {
            e.preventDefault();
            this.saveTaskChanges();
        });

        // İptal Butonu
        document.getElementById('cancelEditBtn').addEventListener('click', () => {
            window.location.href = 'task-management.html';
        });

        // Dosya Yükleme (Genel)
        document.getElementById('fileUploadArea').addEventListener('click', () => document.getElementById('fileInput').click());
        document.getElementById('fileInput').addEventListener('change', (e) => this.uploadDocuments(e.target.files));

        // Dosya Silme (Delegation)
        document.getElementById('fileListContainer').addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-file');
            if (btn) this.removeDocument(btn.dataset.id);
        });

        // EPATS Yükleme
        document.getElementById('epatsFileUploadArea').addEventListener('click', () => document.getElementById('epatsFileInput').click());
        document.getElementById('epatsFileInput').addEventListener('change', (e) => this.uploadEpatsDocument(e.target.files[0]));
        
        // EPATS Silme
        document.getElementById('epatsFileListContainer').addEventListener('click', (e) => {
            if (e.target.id === 'removeEpatsFileBtn' || e.target.closest('#removeEpatsFileBtn')) {
                this.removeEpatsDocument();
            }
        });

        // Arama (IP Record)
        document.getElementById('relatedIpRecordSearch').addEventListener('input', (e) => {
            const results = this.dataManager.searchIpRecords(this.masterData.ipRecords, e.target.value);
            this.renderSearchResults(results, 'ipRecord');
        });

        // Arama (Person)
        document.getElementById('relatedPartySearch').addEventListener('input', (e) => {
            const results = this.dataManager.searchPersons(this.masterData.persons, e.target.value);
            this.renderSearchResults(results, 'person');
        });

        // Seçim Kaldırma
        document.getElementById('selectedIpRecordDisplay').addEventListener('click', (e) => {
            if(e.target.closest('#removeIpRecordBtn')) this.uiManager.renderSelectedIpRecord(null);
        });
        document.getElementById('selectedRelatedPartyDisplay').addEventListener('click', (e) => {
            if(e.target.closest('#removeRelatedPartyBtn')) this.uiManager.renderSelectedPerson(null);
        });
    }

    // --- ARAMA SONUÇLARI RENDER (Controller içinde basitçe) ---
    renderSearchResults(items, type) {
        const container = type === 'ipRecord' ? this.uiManager.elements.ipResults : this.uiManager.elements.partyResults;
        container.innerHTML = '';
        
        if (items.length === 0) {
            container.style.display = 'none';
            return;
        }

        items.slice(0, 10).forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.textContent = type === 'ipRecord' ? item.title : item.name;
            div.onclick = () => {
                if (type === 'ipRecord') this.uiManager.renderSelectedIpRecord(item);
                else this.uiManager.renderSelectedPerson(item);
                container.style.display = 'none';
            };
            container.appendChild(div);
        });
        container.style.display = 'block';
    }

    // --- DOSYA İŞLEMLERİ ---
    async uploadDocuments(files) {
        if (!files.length) return;
        
        for (const file of files) {
            const id = generateUUID();
            const path = `task_documents/${this.taskId}/${id}_${file.name}`;
            
            try {
                const url = await this.dataManager.uploadFile(file, path);
                this.currentDocuments.push({
                    id, name: file.name, url, storagePath: path, size: file.size, 
                    uploadedAt: new Date().toISOString()
                });
            } catch (e) { console.error(e); }
        }
        
        this.uiManager.renderDocuments(this.currentDocuments);
        await this.dataManager.updateTask(this.taskId, { documents: this.currentDocuments });
    }

    async removeDocument(id) {
        if (!confirm('Silmek istediğinize emin misiniz?')) return;
        const doc = this.currentDocuments.find(d => d.id === id);
        if (doc && doc.storagePath) await this.dataManager.deleteFileFromStorage(doc.storagePath);
        
        this.currentDocuments = this.currentDocuments.filter(d => d.id !== id);
        this.uiManager.renderDocuments(this.currentDocuments);
        await this.dataManager.updateTask(this.taskId, { documents: this.currentDocuments });
    }

    // --- EPATS & MODAL ---
    async uploadEpatsDocument(file) {
        if (!file) return;
        
        // Mevcut statüyü yedekle
        if (!this.uploadedEpatsFile) {
            this.statusBeforeEpatsUpload = document.getElementById('taskStatus').value;
        }

        const id = generateUUID();
        const path = `epats_documents/${id}_${file.name}`;
        const url = await this.dataManager.uploadFile(file, path);
        
        this.uploadedEpatsFile = {
            id, name: file.name, url, storagePath: path, size: file.size,
            uploadedAt: new Date().toISOString()
        };

        this.uiManager.renderEpatsDocument(this.uploadedEpatsFile);

        // Başvuru Modalı Kontrolü
        if (this.isApplicationTask(this.taskData.taskType)) {
            // Modal kodları buraya gelecek (Application Data Modal)
            // Şimdilik alert ile simüle edelim, sonra modal yapısını ekleriz
            // this.openApplicationDataModal();
        }
    }

    async removeEpatsDocument() {
        if (!confirm('EPATS evrakı silinecek. Emin misiniz?')) return;
        if (this.uploadedEpatsFile?.storagePath) {
            await this.dataManager.deleteFileFromStorage(this.uploadedEpatsFile.storagePath);
        }
        this.uploadedEpatsFile = null;
        this.uiManager.renderEpatsDocument(null);
        
        // Statüyü geri al
        if (this.statusBeforeEpatsUpload) {
            document.getElementById('taskStatus').value = this.statusBeforeEpatsUpload;
        }
        
        await this.saveTaskChanges();
    }

    isApplicationTask(typeId) {
        const t = this.masterData.transactionTypes.find(x => x.id === typeId);
        // data/transactionTypes.json'daki ID'ler
        const validIds = ['trademark_application', 'patent_application', 'design_application'];
        return validIds.includes(typeId) || (t && validIds.includes(t.id));
    }

    // --- TAHAKKUK ---
    setupAccrualModal() {
        // AccrualFormManager'ı modal içine mount et
        this.accrualManager = new AccrualFormManager('accrualFormContainer', 'taskUpdate', this.masterData.persons);
        this.accrualManager.render();
        
        // Modal Butonları
        const modal = document.getElementById('accrualModal');
        const saveBtn = document.getElementById('saveAccrualBtn');
        const cancelBtn = document.getElementById('cancelAccrualBtn');

        // Listeden Düzenle'ye basınca
        document.getElementById('accrualsContainer').addEventListener('click', (e) => {
            if (e.target.classList.contains('edit-accrual-btn')) {
                const accId = e.target.dataset.id;
                this.openAccrualModal(accId);
            }
        });
        
        // Yeni Ekle (Eğer buton varsa)
        // document.getElementById('addAccrualBtn').onclick = () => this.openAccrualModal();

        cancelBtn.onclick = () => modal.style.display = 'none';
        
        saveBtn.onclick = async () => {
            const result = this.accrualManager.getData();
            if (result.success) {
                const data = result.data;
                data.taskId = this.taskId;
                
                // Eğer düzenleme ise ID ekle
                const editingId = modal.dataset.editingId;
                if (editingId) data.id = editingId;

                await this.dataManager.saveAccrual(data, !!editingId);
                modal.style.display = 'none';
                this.renderAccruals(); // Listeyi yenile
                showNotification('Tahakkuk kaydedildi.', 'success');
            } else {
                alert(result.error);
            }
        };
    }

    async renderAccruals() {
        const accruals = await this.dataManager.getAccrualsByTaskId(this.taskId);
        // HTML oluşturma işi UIManager'a da verilebilir ama burada basitçe yapalım
        const container = document.getElementById('accrualsContainer');
        container.innerHTML = accruals.map(a => `
            <div class="accrual-card">
                <div class="accrual-card-header">
                    <span class="accrual-id">#${a.id.substring(0,8)}</span>
                    <span class="status-badge status-${a.status}">${a.status === 'paid' ? 'Ödendi' : 'Ödenmedi'}</span>
                </div>
                <div class="accrual-card-body">
                    <p><span>Toplam:</span> <strong>${this.formatCurrency(a.totalAmount)}</strong></p>
                </div>
                <div class="text-right mt-2">
                    <button class="btn btn-sm btn-outline-warning edit-accrual-btn" data-id="${a.id}">Düzenle</button>
                </div>
            </div>
        `).join('');
    }

    openAccrualModal(accId) {
        const modal = document.getElementById('accrualModal');
        const acc = this.accrualsCache?.find(a => a.id === accId); // Cache'den bulmak lazım
        // Basitlik için yeniden çekebiliriz veya bu class içinde saklayabiliriz.
        // Şimdilik boş açalım
        modal.style.display = 'flex';
        // this.accrualManager.setData(acc);
    }
    
    formatCurrency(amountData) {
        // [{amount: 100, currency: 'TRY'}] yapısını destekle
        if (Array.isArray(amountData)) {
            return amountData.map(x => `${x.amount} ${x.currency}`).join(' + ');
        }
        return amountData;
    }

    // --- KAYDETME (ANA FONKSİYON) ---
    async saveTaskChanges() {
        const form = document.getElementById('taskDetailForm');
        
        // Verileri Topla
        const updateData = {
            title: document.getElementById('taskTitle').value,
            description: document.getElementById('taskDescription').value,
            priority: document.getElementById('taskPriority').value,
            status: document.getElementById('taskStatus').value,
            deliveryDate: document.getElementById('deliveryDate').value || null,
            dueDate: document.getElementById('taskDueDate').value || null,
            updatedAt: new Date().toISOString(),
            documents: this.currentDocuments
        };

        // EPATS Detayları
        if (this.uploadedEpatsFile) {
            updateData.details = this.taskData.details || {};
            updateData.details.epatsDocument = {
                ...this.uploadedEpatsFile,
                turkpatentEvrakNo: document.getElementById('turkpatentEvrakNo').value,
                documentDate: document.getElementById('epatsDocumentDate').value
            };
            updateData.details.statusBeforeEpatsUpload = this.statusBeforeEpatsUpload;
        }

        // Güncelle
        const res = await this.dataManager.updateTask(this.taskId, updateData);
        if (res.success) {
            showNotification('Değişiklikler kaydedildi.', 'success');
        } else {
            alert('Hata: ' + res.error);
        }
    }
}

new TaskUpdateController().init();