// public/js/task-update/main.js - GÜNCELLENMİŞ

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
    }

    async init() {
        await loadSharedLayout();
        ensurePersonModal();

        // 🔥 YENİ: Başvuru Modalı HTML'ini sayfa açılır açılmaz enjekte et
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
        
        this.uiManager.fillForm(this.taskData, this.masterData.users);
        this.uiManager.renderDocuments(this.currentDocuments);
        this.uiManager.renderHistory(this.taskData.history);
        this.renderAccruals();
        
        if (this.taskData.relatedIpRecordId) {
            const rec = this.masterData.ipRecords.find(r => r.id === this.taskData.relatedIpRecordId);
            this.uiManager.renderSelectedIpRecord(rec);
        }

        let ownerId = this.taskData.taskOwner;
        if (Array.isArray(ownerId)) ownerId = ownerId[0];
        if (ownerId) {
            const p = this.masterData.persons.find(x => String(x.id) === String(ownerId));
            this.uiManager.renderSelectedPerson(p);
        }

        if (this.taskData.details?.epatsDocument) {
            this.uploadedEpatsFile = this.taskData.details.epatsDocument;
            this.statusBeforeEpatsUpload = this.taskData.details.statusBeforeEpatsUpload;
            this.uiManager.renderEpatsDocument(this.uploadedEpatsFile);
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
        document.getElementById('selectedIpRecordDisplay').addEventListener('click', (e) => {
            if(e.target.closest('#removeIpRecordBtn')) this.uiManager.renderSelectedIpRecord(null);
        });
        document.getElementById('selectedRelatedPartyDisplay').addEventListener('click', (e) => {
            if(e.target.closest('#removeRelatedPartyBtn')) this.uiManager.renderSelectedPerson(null);
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
                
                // 1. Veriyi hafızaya al (IP Record güncellenecek)
                this.tempApplicationData = { appNo, appDate };
                
                // 2. Görsel güncelleme (Sağ taraftaki 'İlgili Varlık' kartı)
                const displayNo = document.getElementById('displayAppNumber');
                if(displayNo) displayNo.textContent = appNo;
                
                // 3. 🔥 YENİ: EPATS Kartındaki Inputları Doldur
                // Kullanıcı modalı kapattığında verileri burada görecek.
                document.getElementById('turkpatentEvrakNo').value = appNo;
                document.getElementById('epatsDocumentDate').value = appDate;
                
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
                if (type === 'ipRecord') this.uiManager.renderSelectedIpRecord(item);
                else this.uiManager.renderSelectedPerson(item);
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

// --- EPATS YÜKLEME (GÜNCELLENMİŞ: Statü Değişikliği Ekli) ---
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

            // 🔥 YENİ ÖZELLİK: Statüyü "Tamamlandı" yap
            const statusSelect = document.getElementById('taskStatus');
            if(statusSelect) {
                // 'completed' değeri projenizdeki utils.js/TASK_STATUSES ile aynı olmalı
                statusSelect.value = 'completed'; 
                
                // Görsel uyarı (İsteğe bağlı - yanıp sönme efekti vs. eklenebilir)
                statusSelect.style.border = "2px solid #28a745"; // Yeşil çerçeve
                setTimeout(() => statusSelect.style.border = "", 2000);
            }

            // Modal Kontrolü (Aynı kalıyor)
            const isApp = this.isApplicationTask(this.taskData.taskType);
            if (isApp) {
                // Modalda daha önce veri varsa onu koru yoksa boş gelsin
                // (Artık EPATS inputundan veri kopyalamıyoruz)
                
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
        
        // 1. Storage'dan silmeye çalış (Hata olsa bile devam et)
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
        const applicationTypeIds = ['2', '5', '8'];
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

    formatCurrency(amountData) {
        if (Array.isArray(amountData)) return amountData.map(x => `${x.amount} ${x.currency}`).join(' + ');
        return amountData;
    }

    // --- KAYDETME VE YÖNLENDİRME (DÜZELTİLDİ) ---
    async saveTaskChanges() {
        // 1. EPATS Validasyonu (Eğer dosya varsa zorunlu alanları kontrol et)
        if (this.uploadedEpatsFile) {
            const evrakNo = document.getElementById('turkpatentEvrakNo').value;
            const evrakDate = document.getElementById('epatsDocumentDate').value;
            
            if (!evrakNo || !evrakDate) {
                alert('UYARI: EPATS evrakı yüklediniz. Lütfen "TürkPatent Evrak No" ve "Evrak Tarihi" alanlarını doldurunuz.');
                document.getElementById('turkpatentEvrakNo').focus();
                return;
            }
            
            // Objeyi güncelle
            this.uploadedEpatsFile.turkpatentEvrakNo = evrakNo;
            this.uploadedEpatsFile.documentDate = evrakDate;
        }

        // 2. Temel Veri Objesini Hazırla
        const updateData = {
            title: document.getElementById('taskTitle').value,
            description: document.getElementById('taskDescription').value,
            priority: document.getElementById('taskPriority').value,
            status: document.getElementById('taskStatus').value,
            deliveryDate: document.getElementById('deliveryDate').value || null,
            dueDate: document.getElementById('taskDueDate').value || null,
            updatedAt: new Date().toISOString(),
            documents: this.currentDocuments,
            
            // Mevcut details objesini al (yoksa boş obje oluştur)
            details: this.taskData.details || {} 
        };

        // 3. EPATS Evrak Durumunu İşle (Ekleme veya SİLME)
        if (this.uploadedEpatsFile) {
            // Dosya varsa kaydet
            updateData.details.epatsDocument = this.uploadedEpatsFile;
            updateData.details.statusBeforeEpatsUpload = this.statusBeforeEpatsUpload;
        } else {
            // 🔥 KRİTİK KISIM: Dosya silinmişse (null ise), veritabanındaki alanı da NULL yap
            // Bunu yapmazsak dosya silinmez!
            updateData.details.epatsDocument = null; 
        }

        // 4. Güncelleme İsteğini Gönder
        const res = await this.dataManager.updateTask(this.taskId, updateData);
        
        if (res.success) {
            // Eğer Modal'dan gelen Başvuru Verisi (App No) varsa, onu da IP Record'a işle
            if (this.tempApplicationData && this.taskData.relatedIpRecordId) {
                await this.dataManager.updateIpRecord(this.taskData.relatedIpRecordId, {
                    applicationNumber: this.tempApplicationData.appNo,
                    applicationDate: this.tempApplicationData.appDate
                });
            }
            
            showNotification('Değişiklikler kaydedildi.', 'success');
            
            // --- Geri Yönlendirme ---
            setTimeout(() => {
                window.location.href = 'task-management.html';
            }, 1000); 
        } else {
            alert('Hata: ' + res.error);
        }
    }
}

new TaskUpdateController().init();