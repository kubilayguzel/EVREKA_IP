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
        this.selectedIpRecordId = null;
        this.selectedPersonId = null;
        this.tempRenewalData = null;
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
        this.uiManager.ensureRenewalDataModal();
        this.setupRenewalModalEvents();
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
        const lockedTypes = ['2'];
        
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

    setupRenewalModalEvents() {
        const btn = document.getElementById('btnSaveRenewalData');
        if (btn) {
            btn.onclick = (e) => {
                e.preventDefault();
                const newDate = document.getElementById('modalRenewalDate').value;
                if (!newDate) {
                    showNotification('Lütfen yeni koruma tarihini giriniz.', 'warning');
                    return;
                }
                this.tempRenewalData = newDate;
                if (window.$) $('#renewalDataModal').modal('hide');
            };
        }
    }

    handleRenewalLogic() {
        const record = this.masterData.ipRecords.find(r => r.id === this.selectedIpRecordId);
        if (!record) return;

        // Menşei kontrolü (Harf duyarsız)
        const isTurkpatent = (record.origin || '').toUpperCase() === 'TÜRKPATENT';
        const currentRenewalDate = record.renewalDate;
        
        const modalDateInput = document.getElementById('modalRenewalDate');
        const warningArea = document.getElementById('renewalWarningArea');
        const warningText = document.getElementById('renewalWarningText');

        // Reset
        modalDateInput.value = '';
        warningArea.style.display = 'none';

        if (isTurkpatent && currentRenewalDate) {
            let dateObj = (typeof currentRenewalDate === 'object' && currentRenewalDate.toDate) 
                ? currentRenewalDate.toDate() 
                : new Date(currentRenewalDate);

            if (!isNaN(dateObj.getTime())) {
                // 10 yıl ekle
                const nextRenewalDate = new Date(dateObj);
                nextRenewalDate.setFullYear(nextRenewalDate.getFullYear() + 10);
                
                modalDateInput.value = nextRenewalDate.toISOString().split('T')[0];
                warningText.textContent = "Koruma tarihi bu tarih olarak güncellenecektir.";
                warningArea.style.display = 'block';
            }
        }

        if (window.$) {
            $('#renewalDataModal').modal({ backdrop: 'static', keyboard: false, show: true });
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
        
        // 1. Durum ve Veri Yedekleme Başlatma
        if (!this.uploadedEpatsFile) {
            this.statusBeforeEpatsUpload = document.getElementById('taskStatus').value;
            
            // Ana kaydın o anki halini yedekle (Geri dönüş için)
            const record = this.masterData.ipRecords.find(r => r.id === this.selectedIpRecordId);
            if (record) {
                this.taskData.details.backupData = {
                    applicants: record.applicants || record.owners || [],
                    applicationNumber: record.applicationNumber || null,
                    applicationDate: record.applicationDate || null,
                    renewalDate: record.renewalDate || null
                };
                console.log("📥 Mevcut veriler geri dönüş için yedeklendi.");
            }
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
            if(statusSelect) statusSelect.value = 'completed'; 

            // İşlem Tipine Göre Mantığı Tetikle
            const taskType = String(this.taskData.taskType);
            if (taskType === '22') this.handleRenewalLogic();
            
            if (this.isApplicationTask(taskType)) {
                if (typeof $ !== 'undefined') {
                    this.uiManager.ensureApplicationDataModal();
                    setTimeout(() => {
                        $('#applicationDataModal').modal({ backdrop: 'static', keyboard: false, show: true });
                    }, 100);
                }
            }
        } catch (e) {
            console.error('EPATS yükleme hatası:', e);
            showNotification('Dosya yüklenirken hata oluştu: ' + e.message, 'error');
        }
    }
    
    async removeEpatsDocument() {
    if (!confirm('EPATS evrakı silinecek ve yapılan veri değişiklikleri (varsa) eski haline döndürülecektir. Emin misiniz?')) return;
    
    // 1. Storage temizliği
    if (this.uploadedEpatsFile?.storagePath) {
        try {
            await this.dataManager.deleteFileFromStorage(this.uploadedEpatsFile.storagePath);
        } catch (e) { console.warn("Storage silme hatası:", e); }
    }
    
    // 2. Hafızayı sıfırla
    this.uploadedEpatsFile = null;
    this.tempApplicationData = null;
    this.tempRenewalData = null;
    
    // 3. Statüyü geri al
    if (this.statusBeforeEpatsUpload) {
        document.getElementById('taskStatus').value = this.statusBeforeEpatsUpload;
    }

    // 4. UI temizle
    this.uiManager.renderEpatsDocument(null);
    
    // 5. Veritabanını kalıcı olarak güncelle (saveTaskChanges içindeki revert mantığı çalışacak)
    await this.saveTaskChanges(); 
}

    isApplicationTask(taskType) {
        if (!taskType) return false;
        const applicationTypeIds = ['2'];
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
                <div class="text-center p-3 text-muted border rounded bg-light">
                    <i class="fas fa-receipt mr-2"></i>Kayıt bulunamadı.
                </div>`;
            return;
        }

        // ÖNEMLİ: Kartları bir satıra sarıyoruz ve her kartı col-12 (tam genişlik) yapıyoruz
        container.innerHTML = `
            <div class="row w-100 m-0">
                ${accruals.map(a => {
                    const dateStr = a.date ? new Date(a.date).toLocaleDateString('tr-TR') : '-';
                    const itemsSummary = a.items && a.items.length > 0 
                        ? a.items.map(i => i.description).join(', ') 
                        : 'Detay girilmemiş';

                    const amountStr = this.formatCurrency(a.totalAmount);

                    const statusHtml = a.status === 'paid' 
                        ? '<span class="badge badge-success ml-2">Ödendi</span>' 
                        : '<span class="badge badge-warning ml-2">Ödenmedi</span>';

                    return `
                    <div class="col-12 mb-3">
                        <div class="card shadow-sm border-light w-100 h-100">
                            <div class="card-body">

                                <!-- Üst Satır: Tutar + Durum -->
                                <div class="d-flex justify-content-between align-items-center mb-3">
                                    <h5 class="mb-0 font-weight-bold text-dark">${amountStr}</h5>
                                    ${statusHtml}
                                </div>

                                <!-- Orta Alan: Bilgiler blok blok -->
                                <div class="row text-sm">
                                    <div class="col-md-4 mb-2">
                                        <small class="text-muted d-block">Tarih</small>
                                        <span>${dateStr}</span>
                                    </div>

                                    <div class="col-md-4 mb-2">
                                        <small class="text-muted d-block">Açıklama</small>
                                        <span>${itemsSummary}</span>
                                    </div>

                                    <div class="col-md-4 mb-2">
                                        <small class="text-muted d-block">Kayıt No</small>
                                        <span class="text-monospace">#${a.id.substring(0,6)}</span>
                                    </div>
                                </div>

                                <hr/>

                                <!-- Alt Satır: Düzenle butonu -->
                                <div class="text-right">
                                    <button class="btn btn-sm btn-outline-primary edit-accrual-btn" data-id="${a.id}">
                                        <i class="fas fa-pen mr-1"></i>Düzenle
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        `;
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
            // ALERT YERİNE:
            showNotification('Lütfen EPATS evrak bilgilerini (No ve Tarih) doldurunuz.', 'warning');
            return;
        }
        this.uploadedEpatsFile.turkpatentEvrakNo = evrakNo;
        this.uploadedEpatsFile.documentDate = evrakDate;
    }

    // 2. Veri Hazırlama (Aynı kalıyor)
    const updateData = {
        status: document.getElementById('taskStatus').value,
        updatedAt: new Date().toISOString(),
        details: this.taskData.details || {},
        relatedIpRecordId: this.selectedIpRecordId,
        taskOwner: this.selectedPersonId,
        // ... diğer alanlar
    };

    if (this.uploadedEpatsFile) {
        updateData.details.epatsDocument = this.uploadedEpatsFile;
        updateData.details.statusBeforeEpatsUpload = this.statusBeforeEpatsUpload;
    }

    const res = await this.dataManager.updateTask(this.taskId, updateData);
    
    if (res.success) {
        const recordId = this.selectedIpRecordId;
        const taskType = String(this.taskData.taskType);

        // --- ÖZEL DURUM 1: Sahip Değişimi (3, 5, 18) ---
        const ownerChangeTypes = ['3', '5', '18'];
        if (ownerChangeTypes.includes(taskType) && this.selectedPersonId && recordId) {
            try {
                const record = this.masterData.ipRecords.find(r => r.id === recordId);
                const newPerson = this.masterData.persons.find(p => String(p.id) === String(this.selectedPersonId));
                
                if (record && newPerson) {
                    const oldOwnerData = (record.applicants || record.owners || []).map(a => ({ id: a.id || '', name: a.name || a.applicantName || 'Bilinmeyen' }));
                    const newApplicants = [{ id: newPerson.id, name: newPerson.name, email: newPerson.email || null, address: newPerson.address || null }];
                    
                    await this.dataManager.updateIpRecord(recordId, { applicants: newApplicants });
                    
                    if (this.taskData.transactionId) {
                        await this.dataManager.updateTransaction(recordId, this.taskData.transactionId, { oldOwnerData });
                    }

                    // ==========================================================
                    // SAHİP DEĞİŞİKLİĞİ BİLDİRİMİ (YENİ)
                    // ==========================================================
                    showNotification(`Başvuru sahibi "${newPerson.name}" olarak güncellendi.`, 'info');
                }
            } catch (err) { console.error("Sahip güncelleme hatası:", err); }
        }

        // --- DİĞER GÜNCELLEMELER (Başvuru ve Yenileme) ---
        if (this.tempApplicationData && recordId) {
            await this.dataManager.updateIpRecord(recordId, {
                applicationNumber: this.tempApplicationData.appNo,
                applicationDate: this.tempApplicationData.appDate
            });
        }
        if (this.tempRenewalData && recordId) {
            await this.dataManager.updateIpRecord(recordId, { renewalDate: this.tempRenewalData });
        }
        
        showNotification('Değişiklikler başarıyla kaydedildi.', 'success');
        setTimeout(() => { window.location.href = 'task-management.html'; }, 1000); 
    } else {
        showNotification('Güncelleme sırasında bir hata oluştu: ' + res.error, 'error');
    }
}
}

new TaskUpdateController().init();