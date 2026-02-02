import { authService, auth, generateUUID } from '../../firebase-config.js';
import { loadSharedLayout, ensurePersonModal } from '../layout-loader.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { Timestamp, arrayUnion} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"; 
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

    /**
     * PDF dosyasını okur ve Evrak No / Tarih bilgisini ayıklar.
     */
    async extractEpatsInfoFromFile(file) {
        try {
            // ✅ GÜNCELLENMİŞ VE ÇALIŞAN CDN ADRESLERİ (cdnjs)
            const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.mjs');
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.mjs';

            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument(arrayBuffer);
            const pdf = await loadingTask.promise;

            let fullText = '';
            // Genellikle bilgi ilk sayfadadır, performans için sadece ilk 2 sayfayı okuyoruz
            const maxPages = Math.min(pdf.numPages, 2);
            for (let i = 1; i <= maxPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                // Satırları birleştirirken araya boşluk koyuyoruz
                const strings = content.items.map(item => item.str);
                fullText += strings.join(' ') + '\n';
            }

            // --- REGEX İLE VERİ AYIKLAMA ---
            
            // 1. Evrak No: "2024-GE-123456" formatı veya "Evrak No: ..."
            let evrakNo = null;
            
            // Öncelikli Format: YYYY-GE-XXXXXX veya YYYY-GP-XXXXXX (TürkPatent standart formatı)
            // \b kelime sınırı ile daha hassas arama yapıyoruz
            const standardMatch = fullText.match(/\b(\d{4}-[A-Z]{2,}-\d+)\b/);
            
            // Alternatif Format: "Evrak No : 12345"
            const labeledMatch = fullText.match(/Evrak\s*No\s*[:]\s*([\w-]+)/i);

            if (standardMatch) evrakNo = standardMatch[1];
            else if (labeledMatch) evrakNo = labeledMatch[1];

            // 2. Tarih: "Tarih : 01.01.2024" veya belgedeki ilk geçerli tarih
            let documentDate = null;
            
            // Önce "Tarih:" etiketiyle arama yap (Daha güvenilir)
            const dateLabelMatch = fullText.match(/(?:Evrak\s*)?Tarih(?:i)?\s*[:]\s*(\d{1,2}[\.\/]\d{1,2}[\.\/]\d{4})/i);
            
            if (dateLabelMatch) {
                documentDate = this.parseDate(dateLabelMatch[1]);
            } else {
                // Etiket yoksa belgedeki ilk mantıklı tarihi bul (GG.AA.YYYY)
                const allDates = fullText.match(/(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})/);
                if (allDates) {
                    documentDate = this.parseDate(allDates[0]);
                }
            }

            return { evrakNo, documentDate };

        } catch (e) {
            console.error("PDF okuma hatası:", e);
            // Hata olsa bile null dönerek akışı bozmuyoruz
            return null;
        }
    }

    // Yardımcı: DD.MM.YYYY formatını YYYY-MM-DD (HTML input formatı) yapar
    parseDate(dateStr) {
        if (!dateStr) return null;
        const parts = dateStr.replace(/\//g, '.').split('.');
        if (parts.length === 3) {
            // parts[2]=Yıl, parts[1]=Ay, parts[0]=Gün
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        return null;
    }

    async refreshTaskData() {
        this.taskData = await this.dataManager.getTaskById(this.taskId);
        this.currentDocuments = this.taskData.documents || [];
        
        this.selectedIpRecordId = this.taskData.relatedIpRecordId || null;
        
        let ownerId = this.taskData.taskOwner;
        if (Array.isArray(ownerId)) ownerId = ownerId[0];
        this.selectedPersonId = ownerId || null;

        this.uiManager.fillForm(this.taskData, this.masterData.users);
        this.uiManager.renderDocuments(this.currentDocuments);
        this.renderAccruals();
        
        if (this.selectedIpRecordId) {
            const rec = this.masterData.ipRecords.find(r => r.id === this.selectedIpRecordId);
            this.uiManager.renderSelectedIpRecord(rec);
        }

        if (this.selectedPersonId) {
            const p = this.masterData.persons.find(x => String(x.id) === String(this.selectedPersonId));
            this.uiManager.renderSelectedPerson(p);
        }

        if (this.taskData.details?.epatsDocument) {
            this.uploadedEpatsFile = this.taskData.details.epatsDocument;
            this.statusBeforeEpatsUpload = this.taskData.details.statusBeforeEpatsUpload;
            this.uiManager.renderEpatsDocument(this.uploadedEpatsFile);
        }

        this.lockFieldsIfApplicationTask();
    }

    lockFieldsIfApplicationTask() {
        const lockedTypes = ['2'];
        const isLocked = lockedTypes.includes(String(this.taskData.taskType));
        
        if (isLocked) {
            console.log('🔒 Başvuru işlemi tespit edildi, ilgili alanlar kilitleniyor.');
            
            const ipSearchInput = document.getElementById('relatedIpRecordSearch');
            const ipRemoveBtn = document.querySelector('#selectedIpRecordDisplay #removeIpRecordBtn');
            
            if (ipSearchInput) {
                ipSearchInput.disabled = true;
                ipSearchInput.placeholder = "Bu iş tipi için varlık değiştirilemez.";
                ipSearchInput.style.backgroundColor = "#e9ecef"; 
            }
            if (ipRemoveBtn) {
                ipRemoveBtn.style.display = 'none'; 
            }
            
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

        document.getElementById('fileUploadArea').addEventListener('click', () => document.getElementById('fileInput').click());
        document.getElementById('fileInput').addEventListener('change', (e) => this.uploadDocuments(e.target.files));
        document.getElementById('fileListContainer').addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-file');
            if (btn) this.removeDocument(btn.dataset.id);
        });

        document.getElementById('epatsFileUploadArea').addEventListener('click', () => document.getElementById('epatsFileInput').click());
        document.getElementById('epatsFileInput').addEventListener('change', (e) => this.uploadEpatsDocument(e.target.files[0]));

        // EPATS drag & drop
        const epatsDropZone = document.getElementById('epatsFileUploadArea');
        const epatsInput = document.getElementById('epatsFileInput');
        if (epatsDropZone) {
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
                epatsDropZone.addEventListener(evt, (ev) => { ev.preventDefault(); ev.stopPropagation(); });
            });
            ['dragenter', 'dragover'].forEach(evt => epatsDropZone.addEventListener(evt, () => epatsDropZone.classList.add('drag-over')));
            ['dragleave', 'drop'].forEach(evt => epatsDropZone.addEventListener(evt, () => epatsDropZone.classList.remove('drag-over')));
            epatsDropZone.addEventListener('drop', (ev) => {
                const files = ev.dataTransfer?.files;
                if (!files || !files.length) return;

                if (files.length > 1) {
                    showNotification('Sadece tek PDF yükleyebilirsiniz. İlk dosya seçildi.', 'warning');
                }

                const file = files[0];
                const isPdf = (file.type === 'application/pdf') || (file.name && file.name.toLowerCase().endsWith('.pdf'));
                if (!isPdf) {
                    showNotification('Lütfen PDF dosyası yükleyin.', 'warning');
                    return;
                }

                // Aynı dosya tekrar seçilebilsin diye input'u temizle
                if (epatsInput) epatsInput.value = '';
                this.uploadEpatsDocument(file);
            });
        }

        document.getElementById('epatsFileListContainer').addEventListener('click', (e) => {
            if (e.target.closest('#removeEpatsFileBtn')) {
                this.removeEpatsDocument();
            }
        });

        document.getElementById('relatedIpRecordSearch').addEventListener('input', (e) => {
            const results = this.dataManager.searchIpRecords(this.masterData.ipRecords, e.target.value);
            this.renderSearchResults(results, 'ipRecord');
        });
        document.getElementById('relatedPartySearch').addEventListener('input', (e) => {
            const results = this.dataManager.searchPersons(this.masterData.persons, e.target.value);
            this.renderSearchResults(results, 'person');
        });

        document.getElementById('selectedIpRecordDisplay').addEventListener('click', (e) => {
            if(e.target.closest('#removeIpRecordBtn')) {
                this.selectedIpRecordId = null; 
                this.uiManager.renderSelectedIpRecord(null);
            }
        });
        document.getElementById('selectedRelatedPartyDisplay').addEventListener('click', (e) => {
            if(e.target.closest('#removeRelatedPartyBtn')) {
                this.selectedPersonId = null; 
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
                
                if(!appNo || !appDate) { 
                    alert('Lütfen Başvuru Numarası ve Tarihi alanlarını doldurunuz.'); 
                    return; 
                }
                
                this.tempApplicationData = { appNo, appDate };
                
                document.getElementById('displayModalAppNo').value = appNo;
                document.getElementById('displayModalAppDate').value = appDate;
                
                const infoArea = document.getElementById('updatedApplicationInfoArea');
                if (infoArea) {
                    infoArea.style.display = 'block';
                }

                const displayNo = document.getElementById('displayAppNumber');
                if(displayNo) displayNo.textContent = appNo;
                
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

        const isTurkpatent = (record.origin || '').toUpperCase() === 'TÜRKPATENT';
        const currentRenewalDate = record.renewalDate;
        
        const modalDateInput = document.getElementById('modalRenewalDate');
        const warningArea = document.getElementById('renewalWarningArea');
        const warningText = document.getElementById('renewalWarningText');

        modalDateInput.value = '';
        warningArea.style.display = 'none';

        if (isTurkpatent && currentRenewalDate) {
            let dateObj = (typeof currentRenewalDate === 'object' && currentRenewalDate.toDate) 
                ? currentRenewalDate.toDate() 
                : new Date(currentRenewalDate);

            if (!isNaN(dateObj.getTime())) {
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

    async uploadEpatsDocument(file) {
        if (!file) return;
        
        if (!this.uploadedEpatsFile) {
            this.statusBeforeEpatsUpload = document.getElementById('taskStatus').value;
            
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

        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            showNotification('PDF taranıyor, evrak bilgileri okunuyor...', 'info');
            
            this.extractEpatsInfoFromFile(file).then(info => {
                if (info) {
                    const noInput = document.getElementById('turkpatentEvrakNo');
                    const dateInput = document.getElementById('epatsDocumentDate');

                    let msg = [];
                    if (info.evrakNo && noInput && !noInput.value) {
                        noInput.value = info.evrakNo;
                        msg.push('Evrak No');
                    }
                    if (info.documentDate && dateInput && !dateInput.value) {
                        dateInput.value = info.documentDate;
                        msg.push('Tarih');
                    }

                    if (msg.length > 0) {
                        showNotification(`✅ PDF'ten otomatik dolduruldu: ${msg.join(', ')}`, 'success');
                    }
                }
            });
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

            const statusSelect = document.getElementById('taskStatus');
            if(statusSelect) statusSelect.value = 'completed'; 

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
        
        if (this.uploadedEpatsFile?.storagePath) {
            try {
                await this.dataManager.deleteFileFromStorage(this.uploadedEpatsFile.storagePath);
            } catch (e) { console.warn("Storage silme hatası:", e); }
        }
        
        this.uploadedEpatsFile = null;
        this.tempApplicationData = null;
        this.tempRenewalData = null;
        
        if (this.taskData && this.taskData.details) {
            delete this.taskData.details.epatsDocument;
            delete this.taskData.details.statusBeforeEpatsUpload;
        }

        if (this.statusBeforeEpatsUpload) {
            document.getElementById('taskStatus').value = this.statusBeforeEpatsUpload;
        } else {
            document.getElementById('taskStatus').value = 'open';
        }

        this.uiManager.renderEpatsDocument(null);
        await this.saveTaskChanges(); 
    }

    isApplicationTask(taskType) {
        if (!taskType) return false;
        const applicationTypeIds = ['2'];
        return applicationTypeIds.includes(String(taskType));
    }

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
                                <div class="d-flex justify-content-between align-items-center mb-3">
                                    <h5 class="mb-0 font-weight-bold text-dark">${amountStr}</h5>
                                    ${statusHtml}
                                </div>
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
        // 1. Giriş Kontrolleri ve Validasyon (Değişmedi)
        if (this.uploadedEpatsFile) {
            const evrakNo = document.getElementById('turkpatentEvrakNo').value;
            const evrakDate = document.getElementById('epatsDocumentDate').value;
            if (!evrakNo || !evrakDate) {
                showNotification('Lütfen EPATS evrak bilgilerini (No ve Tarih) doldurunuz.', 'warning');
                return;
            }
            // İlk atama (Validasyon için gerekli)
            this.uploadedEpatsFile.turkpatentEvrakNo = evrakNo;
            this.uploadedEpatsFile.documentDate = evrakDate;
        }

        // 2. Temel Veriler
        const updateData = {
            status: document.getElementById('taskStatus').value,
            title: document.getElementById('taskTitle').value,
            description: document.getElementById('taskDescription').value,
            priority: document.getElementById('taskPriority').value,
            updatedAt: new Date().toISOString(),
            details: this.taskData.details || {},
            relatedIpRecordId: this.selectedIpRecordId,
            taskOwner: this.selectedPersonId
        };

        // 3. Tarih Alanlarını Düzeltme (Timestamp Formatı)
        const officialDateVal = document.getElementById('taskDueDate').value;
        const operationalDateVal = document.getElementById('deliveryDate').value;

        if (officialDateVal) {
            updateData.officialDueDate = Timestamp.fromDate(new Date(officialDateVal));
        } else {
            updateData.officialDueDate = null;
        }

        if (operationalDateVal) {
            updateData.dueDate = Timestamp.fromDate(new Date(operationalDateVal));
            updateData.operationalDueDate = Timestamp.fromDate(new Date(operationalDateVal));
            updateData.deliveryDate = operationalDateVal;
        } else {
            updateData.dueDate = null;
            updateData.deliveryDate = null;
        }

        if (this.uploadedEpatsFile) {
            updateData.details.epatsDocument = this.uploadedEpatsFile;
            updateData.details.statusBeforeEpatsUpload = this.statusBeforeEpatsUpload;
        }

        // 4. Task Güncelleme İsteği
        const res = await this.dataManager.updateTask(this.taskId, updateData);
        
        if (res.success) {
            const recordId = this.selectedIpRecordId;
            const taskType = String(this.taskData.taskType);

            // --- [GÜNCELLEME BAŞLANGICI: Transaction Doküman Ekleme] ---
            if (this.uploadedEpatsFile && recordId) {
                try {
                    // A) Verileri Inputlardan Taze Olarak Al ve Garantiye Al
                    // (Asenkron işlemler sırasında veri kaybını önlemek için tekrar okuyoruz)
                    const freshEvrakNo = document.getElementById('turkpatentEvrakNo')?.value || null;
                    const freshEvrakDate = document.getElementById('epatsDocumentDate')?.value || null;

                    this.uploadedEpatsFile.turkpatentEvrakNo = freshEvrakNo;
                    this.uploadedEpatsFile.documentDate = freshEvrakDate;

                    // B) Transaction ID'yi belirle (Task'ta yoksa DataManager ile bul)
                    let targetTransactionId = this.taskData.transactionId;
                    if (!targetTransactionId) {
                        console.log("🔍 Task içinde Transaction ID yok, veritabanından aranıyor...");
                        // Bu metodun TaskUpdateDataManager.js içinde tanımlı olduğundan emin olun
                        targetTransactionId = await this.dataManager.findTransactionIdByTaskId(recordId, this.taskId);
                    }

                    // C) Transaction varsa dosyayı ekle
                    if (targetTransactionId) {
                        const docToAdd = {
                            name: this.uploadedEpatsFile.name || 'EPATS Evrakı',
                            url: this.uploadedEpatsFile.url,
                            downloadURL: this.uploadedEpatsFile.url, // Portföy tarafı için
                            type: 'application/pdf', 
                            uploadedAt: this.uploadedEpatsFile.uploadedAt || new Date().toISOString(),
                            
                            // Taze verileri kullanıyoruz
                            turkpatentEvrakNo: this.uploadedEpatsFile.turkpatentEvrakNo,
                            documentDate: this.uploadedEpatsFile.documentDate
                        };

                        await this.dataManager.updateTransaction(
                            recordId,
                            targetTransactionId,
                            { documents: arrayUnion(docToAdd) } // Mevcut listeye ekle
                        );
                        console.log(`✅ EPATS evrakı transaction (${targetTransactionId}) geçmişine eklendi.`);
                    } else {
                        console.warn("⚠️ Bu işe bağlı bir Transaction bulunamadı, dosya geçmişe eklenemedi.");
                    }
                } catch (err) {
                    console.error("❌ Transaction dosya güncelleme hatası:", err);
                }
            }
            // --- [GÜNCELLEME SONU] ---
            
            // Sahip Değişimi Mantığı
            const ownerChangeTypes = ['3', '5', '18'];
            if (ownerChangeTypes.includes(taskType) && this.selectedPersonId && recordId) {
                try {
                    const record = this.masterData.ipRecords.find(r => r.id === recordId);
                    const newPerson = this.masterData.persons.find(p => String(p.id) === String(this.selectedPersonId));
                    
                    if (record && newPerson) {
                        const oldOwnerData = (record.applicants || record.owners || []).map(a => ({ id: a.id || '', name: a.name || a.applicantName || 'Bilinmeyen' }));
                        const newApplicants = [{ id: newPerson.id, name: newPerson.name, email: newPerson.email || null, address: newPerson.address || null }];
                        
                        await this.dataManager.updateIpRecord(recordId, { applicants: newApplicants });
                        
                        // Transaction ID varsa orayı da güncelle
                        let transIdForOwner = this.taskData.transactionId;
                        if (!transIdForOwner) {
                             transIdForOwner = await this.dataManager.findTransactionIdByTaskId(recordId, this.taskId);
                        }

                        if (transIdForOwner) {
                            await this.dataManager.updateTransaction(recordId, transIdForOwner, { oldOwnerData });
                        }
                        showNotification(`Başvuru sahibi "${newPerson.name}" olarak güncellendi.`, 'info');
                    }
                } catch (err) { console.error("Sahip güncelleme hatası:", err); }
            }

            // Başvuru Bilgileri Güncelleme
            if (this.tempApplicationData && recordId) {
                await this.dataManager.updateIpRecord(recordId, {
                    applicationNumber: this.tempApplicationData.appNo,
                    applicationDate: this.tempApplicationData.appDate
                });
            }
            // Yenileme Tarihi Güncelleme
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