import { authService, auth, generateUUID } from '../../firebase-config.js';
import { loadSharedLayout, ensurePersonModal } from '../layout-loader.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { showNotification } from '../../utils.js';

import { TaskUpdateDataManager } from './TaskUpdateDataManager.js';
import { TaskUpdateUIManager } from './TaskUpdateUIManager.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';

class TaskUpdateController {
    constructor() {
        this.dataManager = new TaskUpdateDataManager();
        this.uiManager = new TaskUpdateUIManager();
        this.accrualManager = null; 

        this.taskId = null;
        this.taskData = null;
        this.masterData = {}; 
        
        this.currentDocuments = [];
        this.uploadedEpatsFile = null;
        this.statusBeforeEpatsUpload = null;
        this.tempApplicationData = null; 

        // 🔥 STATE: Seçili İlişkileri Hafızada Tutmak İçin
        this.selectedIpRecordId = null;
        this.selectedPersonId = null;
    }

    async init() {
        await loadSharedLayout();
        ensurePersonModal();

        // Başvuru Modalı HTML'ini sayfa açılır açılmaz enjekte et
        this.uiManager.ensureApplicationDataModal();
        this.setupApplicationModalEvents();

        this.taskId = new URLSearchParams(window.location.search).get('id');
        if (!this.taskId) return window.location.href = 'task-management.html';

        onAuthStateChanged(auth, async (user) => {
            if (!user) return window.location.href = 'index.html';
            
            try {
                this.masterData = await this.dataManager.loadAllInitialData();
                await this.refreshTaskData();
                this.setupEvents();
                this.setupAccrualModal();
            } catch (e) {
                console.error('Başlatma hatası:', e);
                alert('Sayfa yüklenemedi: ' + e.message);
            }
        });
    }

    async refreshTaskData() {
        this.taskData = await this.dataManager.getTaskById(this.taskId);
        this.currentDocuments = this.taskData.documents || [];
        
        // --- 🔥 DÜZELTME 1: Mevcut İlişkileri Hafızaya Al ---
        this.selectedIpRecordId = this.taskData.relatedIpRecordId || null;
        
        // Task Owner bazen array ([id]) bazen string (id) gelebilir, düzeltiyoruz:
        let ownerId = this.taskData.taskOwner;
        if (Array.isArray(ownerId)) ownerId = ownerId[0];
        this.selectedPersonId = ownerId || null;
        // ---------------------------------------------------

        this.uiManager.fillForm(this.taskData, this.masterData.users);
        this.uiManager.renderDocuments(this.currentDocuments);
        this.renderAccruals();
        
        // İlgili Varlığı Ekrana Bas
        if (this.selectedIpRecordId) {
            const rec = this.masterData.ipRecords.find(r => r.id === this.selectedIpRecordId);
            this.uiManager.renderSelectedIpRecord(rec);
        }

        // İlgili Tarafı Ekrana Bas
        if (this.selectedPersonId) {
            const p = this.masterData.persons.find(x => String(x.id) === String(this.selectedPersonId));
            this.uiManager.renderSelectedPerson(p);
        }

        if (this.taskData.details?.epatsDocument) {
            this.uploadedEpatsFile = this.taskData.details.epatsDocument;
            this.statusBeforeEpatsUpload = this.taskData.details.statusBeforeEpatsUpload;
            this.uiManager.renderEpatsDocument(this.uploadedEpatsFile);
        }

        // Başvuru ise alanları kilitle
        this.lockFieldsIfApplicationTask();
    }

    // --- YENİ FONKSİYON: Alanları Kilitleme Mantığı ---
    lockFieldsIfApplicationTask() {
        // Hangi tiplerde kilitlenecek? (Başvuru ID'leri)
        const lockedTypes = [
            '2', '5', '8', 
            'trademark_application', 
            'patent_application', 
            'design_application'
        ];
        
        const isLocked = lockedTypes.includes(String(this.taskData.taskType));
        
        if (isLocked) {
            console.log('🔒 Başvuru işlemi tespit edildi, ilgili alanlar kilitleniyor.');
            
            // 1. İlgili Varlık Alanını Kilitle
            const ipSearchInput = document.getElementById('relatedIpRecordSearch');
            const ipRemoveBtn = document.querySelector('#selectedIpRecordDisplay #removeIpRecordBtn');
            
            if (ipSearchInput) {
                ipSearchInput.disabled = true;
                ipSearchInput.placeholder = "Bu iş tipi için varlık değiştirilemez.";
                ipSearchInput.style.backgroundColor = "#e9ecef"; // Readonly gri tonu
            }
            if (ipRemoveBtn) {
                ipRemoveBtn.style.display = 'none'; // Çarpı butonunu gizle
            }
            
            // 2. İlgili Taraf Alanını Kilitle
            const partySearchInput = document.getElementById('relatedPartySearch');
            const partyRemoveBtn = document.querySelector('#selectedRelatedPartyDisplay #removeRelatedPartyBtn');
            
            if (partySearchInput) {
                partySearchInput.disabled = true;
                partySearchInput.placeholder = "Bu iş tipi için taraf değiştirilemez.";
                partySearchInput.style.backgroundColor = "#e9ecef";
            }
            if (partyRemoveBtn) {
                partyRemoveBtn.style.display = 'none';
            }
        }
    }
    
    setupEvents() {
        document.getElementById('saveTaskChangesBtn').addEventListener('click', (e) => {
            e.preventDefault();
            this.saveTaskChanges();
        });

        document.getElementById('cancelEditBtn').addEventListener('click', () => {
            window.location.href = 'task-management.html';
        });

        // Genel Dosyalar
        document.getElementById('fileUploadArea').addEventListener('click', () => document.getElementById('fileInput').click());
        document.getElementById('fileInput').addEventListener('change', (e) => this.uploadDocuments(e.target.files));
        document.getElementById('fileListContainer').addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-file');
            if (btn) this.removeDocument(btn.dataset.id);
        });

        // EPATS İşlemleri
        document.getElementById('epatsFileUploadArea').addEventListener('click', () => document.getElementById('epatsFileInput').click());
        document.getElementById('epatsFileInput').addEventListener('change', (e) => this.uploadEpatsDocument(e.target.files[0]));
        document.getElementById('epatsFileListContainer').addEventListener('click', (e) => {
            if (e.target.closest('#removeEpatsFileBtn')) {
                this.removeEpatsDocument();
            }
        });

        // Aramalar
        document.getElementById('relatedIpRecordSearch').addEventListener('input', (e) => {
            const results = this.dataManager.searchIpRecords(this.masterData.ipRecords, e.target.value);
            this.renderSearchResults(results, 'ipRecord');
        });
        document.getElementById('relatedPartySearch').addEventListener('input', (e) => {
            const results = this.dataManager.searchPersons(this.masterData.persons, e.target.value);
            this.renderSearchResults(results, 'person');
        });

        // --- 🔥 DÜZELTME 2: Silme Butonları (Hafızadan Silme) ---
        document.getElementById('selectedIpRecordDisplay').addEventListener('click', (e) => {
            if(e.target.closest('#removeIpRecordBtn')) {
                this.selectedIpRecordId = null; // Hafızayı temizle
                this.uiManager.renderSelectedIpRecord(null);
            }
        });
        document.getElementById('selectedRelatedPartyDisplay').addEventListener('click', (e) => {
            if(e.target.closest('#removeRelatedPartyBtn')) {
                this.selectedPersonId = null; // Hafızayı temizle
                this.uiManager.renderSelectedPerson(null);
            }
        });
    }

    setupApplicationModalEvents() {
        const btn = document.getElementById('btnSaveApplicationData');
        if(btn) {
            btn.onclick = (e) => {
                e.preventDefault();
                const appNo = document.getElementById('modalAppNumber').value;
                const appDate = document.getElementById('modalAppDate').value;
                
                // Validasyon
                if(!appNo || !appDate) { 
                    alert('Lütfen Başvuru Numarası ve Tarihi alanlarını doldurunuz.'); 
                    return; 
                }
                
                // 1. Veriyi hafızaya al
                this.tempApplicationData = { appNo, appDate };
                
                // 2. Yeni kutucukları doldur
                document.getElementById('displayModalAppNo').value = appNo;
                document.getElementById('displayModalAppDate').value = appDate;
                
                // 3. Alanı görünür yap (Standart JS ile)
                const infoArea = document.getElementById('updatedApplicationInfoArea');
                if (infoArea) {
                    infoArea.style.display = 'block';
                }

                // 4. Sağ taraftaki "İlgili Varlık" kartını güncelle
                const displayNo = document.getElementById('displayAppNumber');
                if(displayNo) displayNo.textContent = appNo;
                
                // Modalı kapat
                if(window.$) $('#applicationDataModal').modal('hide');
            };
        }
    }

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
                // --- 🔥 DÜZELTME 3: Seçim Anında Hafızayı Güncelle ---
                if (type === 'ipRecord') {
                    this.selectedIpRecordId = item.id;
                    this.uiManager.renderSelectedIpRecord(item);
                } else {
                    this.selectedPersonId = item.id;
                    this.uiManager.renderSelectedPerson(item);
                }
                container.style.display = 'none';
            };
            container.appendChild(div);
        });
        container.style.display = 'block';
    }

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

    // --- EPATS YÜKLEME ---
    async uploadEpatsDocument(file) {
        if (!file) return;
        
        if (!this.uploadedEpatsFile) {
            this.statusBeforeEpatsUpload = document.getElementById('taskStatus').value;
        }

        const id = generateUUID();
        const path = `epats_documents/${id}_${file.name}`;
        
        try {
            const url = await this.dataManager.uploadFile(file, path);
            
            this.uploadedEpatsFile = {
                id, name: file.name, url, storagePath: path, size: file.size,
                uploadedAt: new Date().toISOString()
            };

            this.uiManager.renderEpatsDocument(this.uploadedEpatsFile);

            // Statüyü "Tamamlandı" yap
            const statusSelect = document.getElementById('taskStatus');
            if(statusSelect) {
                statusSelect.value = 'completed'; 
                statusSelect.style.border = "2px solid #28a745";
                setTimeout(() => statusSelect.style.border = "", 2000);
            }

            // Modal Kontrolü
            const isApp = this.isApplicationTask(this.taskData.taskType);
            if (isApp) {
                if (typeof $ !== 'undefined') {
                    this.uiManager.ensureApplicationDataModal();
                    setTimeout(() => {
                        $('#applicationDataModal').modal({
                            backdrop: 'static',
                            keyboard: false,
                            show: true
                        });
                    }, 100);
                }
            }

        } catch (e) {
            console.error('EPATS yükleme hatası:', e);
            alert('Dosya yüklenirken hata oluştu: ' + e.message);
        }
    }
    
    async removeEpatsDocument() {
        if (!confirm('EPATS evrakı silinecek. Emin misiniz?')) return;
        
        // 1. Storage'dan silmeye çalış
        if (this.uploadedEpatsFile?.storagePath) {
            try {
                await this.dataManager.deleteFileFromStorage(this.uploadedEpatsFile.storagePath);
            } catch (e) {
                console.error("Storage silme hatası (Önemli değil, DB'den silinecek):", e);
            }
        }
        
        // 2. Hafızadan sil
        this.uploadedEpatsFile = null;
        
        // 3. Arayüzü temizle
        this.uiManager.renderEpatsDocument(null);
        
        // 4. Statüyü geri al
        if (this.statusBeforeEpatsUpload) {
            document.getElementById('taskStatus').value = this.statusBeforeEpatsUpload;
        }
        
        // 5. Veritabanını güncelle
        await this.saveTaskChanges(); 
    }

    isApplicationTask(taskType) {
        if (!taskType) return false;
        const applicationTypeIds = ['2', '5', '8', 'trademark_application', 'patent_application', 'design_application'];
        return applicationTypeIds.includes(String(taskType));
    }

    // --- TAHAKKUK ---
    setupAccrualModal() {
        this.accrualManager = new AccrualFormManager('accrualFormContainer', 'taskUpdate', this.masterData.persons);
        this.accrualManager.render();
        
        document.getElementById('addAccrualBtn').onclick = (e) => {
            e.preventDefault();
            this.openAccrualModal(); 
        };

        document.getElementById('accrualsContainer').addEventListener('click', (e) => {
            if (e.target.classList.contains('edit-accrual-btn')) {
                e.preventDefault();
                const accId = e.target.dataset.id;
                this.openAccrualModal(accId);
            }
        });

        document.getElementById('saveAccrualBtn').onclick = async () => {
            const result = this.accrualManager.getData();
            if (result.success) {
                const data = result.data;
                data.taskId = this.taskId;
                const modalEl = document.getElementById('accrualModal');
                const editingId = modalEl.dataset.editingId;
                if (editingId) data.id = editingId;

                try {
                    await this.dataManager.saveAccrual(data, !!editingId);
                    $('#accrualModal').modal('hide');
                    this.renderAccruals();
                    showNotification('Tahakkuk kaydedildi.', 'success');
                } catch (error) {
                    alert('Kaydetme hatası: ' + error.message);
                }
            } else {
                alert(result.error);
            }
        };
    }

    openAccrualModal(accId = null) {
        const modalEl = document.getElementById('accrualModal');
        this.accrualManager.render(); 

        if (accId) {
            modalEl.dataset.editingId = accId;
            document.querySelector('#accrualModal .modal-title').textContent = 'Tahakkuk Düzenle';
            this.dataManager.getAccrualsByTaskId(this.taskId).then(accruals => {
                const acc = accruals.find(a => a.id === accId);
                if (acc) this.accrualManager.setData(acc);
            });
        } else {
            delete modalEl.dataset.editingId;
            document.querySelector('#accrualModal .modal-title').textContent = 'Yeni Tahakkuk Ekle';
        }
        
        if (window.$) $('#accrualModal').modal('show');
    }

    async renderAccruals() {
        const accruals = await this.dataManager.getAccrualsByTaskId(this.taskId);
        const container = document.getElementById('accrualsContainer');
        
        if (!accruals || accruals.length === 0) {
            container.innerHTML = `
                <div class="text-center p-4 text-muted bg-light rounded border border-light">
                    <i class="fas fa-receipt fa-2x mb-2 text-secondary"></i>
                    <p class="m-0">Henüz finansal bir hareket eklenmemiş.</p>
                </div>`;
            return;
        }

        // TABLO YAPISI (Hizalamayı Garanti Eder)
        let html = `
            <div class="table-responsive border rounded bg-white">
                <table class="table table-hover mb-0" style="min-width: 600px;">
                    <thead class="thead-light">
                        <tr>
                            <th style="width: 100px;" class="pl-3">Ref No</th>
                            <th style="width: 120px;">Tarih</th>
                            <th>Açıklama / Kalemler</th>
                            <th style="width: 150px; text-align: right;">Tutar</th>
                            <th style="width: 120px; text-align: center;">Durum</th>
                            <th style="width: 80px;"></th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        // Satırlar
        html += accruals.map(a => {
            const dateStr = a.date ? new Date(a.date).toLocaleDateString('tr-TR') : '-';
            
            // Kalemlerin özetini çıkar
            const itemsSummary = a.items && a.items.length > 0 
                ? a.items.map(i => i.description).join(', ') 
                : '<span class="text-muted font-italic">Detay girilmemiş</span>';
            
            const amountStr = this.formatCurrency(a.totalAmount);
            const statusClass = a.status === 'paid' ? 'badge-success' : 'badge-warning';
            const statusText = a.status === 'paid' ? 'Ödendi' : 'Ödenmedi';

            return `
            <tr>
                <td class="pl-3 align-middle text-monospace text-muted small">#${a.id.substring(0,6)}</td>
                <td class="align-middle">${dateStr}</td>
                <td class="align-middle text-truncate" style="max-width: 250px;" title="${itemsSummary.replace(/<[^>]*>?/gm, '')}">
                    ${itemsSummary}
                </td>
                <td class="align-middle text-right font-weight-bold">${amountStr}</td>
                <td class="align-middle text-center">
                    <span class="badge ${statusClass} px-2 py-1">${statusText}</span>
                </td>
                <td class="align-middle text-right pr-3">
                    <button class="btn btn-sm btn-light border text-primary edit-accrual-btn" data-id="${a.id}" title="Düzenle">
                        <i class="fas fa-pen"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');

        html += '</tbody></table></div>';
        container.innerHTML = html;
    }

    formatCurrency(amountData) {
        if (Array.isArray(amountData)) return amountData.map(x => `${x.amount} ${x.currency}`).join(' + ');
        return amountData;
    }

    // --- KAYDETME VE YÖNLENDİRME ---
    async saveTaskChanges() {
        // 1. EPATS Validasyonu
        if (this.uploadedEpatsFile) {
            const evrakNo = document.getElementById('turkpatentEvrakNo').value;
            const evrakDate = document.getElementById('epatsDocumentDate').value;
            
            if (!evrakNo || !evrakDate) {
                alert('UYARI: EPATS evrakı yüklediniz. Lütfen "TürkPatent Evrak No" ve "Evrak Tarihi" alanlarını doldurunuz.');
                document.getElementById('turkpatentEvrakNo').focus();
                return;
            }
            
            this.uploadedEpatsFile.turkpatentEvrakNo = evrakNo;
            this.uploadedEpatsFile.documentDate = evrakDate;
        }

        // 2. Veri Objesini Hazırla
        const updateData = {
            title: document.getElementById('taskTitle').value,
            description: document.getElementById('taskDescription').value,
            priority: document.getElementById('taskPriority').value,
            status: document.getElementById('taskStatus').value,
            deliveryDate: document.getElementById('deliveryDate').value || null,
            dueDate: document.getElementById('taskDueDate').value || null,
            updatedAt: new Date().toISOString(),
            documents: this.currentDocuments,
            details: this.taskData.details || {},

            // --- 🔥 DÜZELTME 4: Yeni İlişkileri Pakete Ekle ---
            relatedIpRecordId: this.selectedIpRecordId, // Marka/Patent ID
            taskOwner: this.selectedPersonId            // Taraf ID
        };

        // 3. EPATS Evrak Durumu
        if (this.uploadedEpatsFile) {
            updateData.details.epatsDocument = this.uploadedEpatsFile;
            updateData.details.statusBeforeEpatsUpload = this.statusBeforeEpatsUpload;
        } else {
            // Dosya silinmişse NULL yap
            updateData.details.epatsDocument = null; 
        }

        // 4. Gönder
        const res = await this.dataManager.updateTask(this.taskId, updateData);
        
        if (res.success) {
            // Başvuru Verisi (App No) varsa IP Record'a işle
            if (this.tempApplicationData && this.taskData.relatedIpRecordId) {
                await this.dataManager.updateIpRecord(this.taskData.relatedIpRecordId, {
                    applicationNumber: this.tempApplicationData.appNo,
                    applicationDate: this.tempApplicationData.appDate
                });
            }
            
            showNotification('Değişiklikler kaydedildi.', 'success');
            
            setTimeout(() => {
                window.location.href = 'task-management.html';
            }, 1000); 
        } else {
            alert('Hata: ' + res.error);
        }
    }
}

new TaskUpdateController().init();