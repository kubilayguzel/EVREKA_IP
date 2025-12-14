// public/js/accrual-management/main.js

import { authService, accrualService, taskService, personService, generateUUID, db, ipRecordsService, transactionTypeService } from '../../firebase-config.js';
import { showNotification, readFileAsDataURL } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { doc, getDoc, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

import Pagination from '../pagination.js'; 
import { AccrualFormManager } from '../components/AccrualFormManager.js';
import { TaskDetailManager } from '../components/TaskDetailManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'accruals.html' });

    class AccrualsManager {
        constructor() {
            this.currentUser = null;
            this.storage = getStorage();
            
            this.allAccruals = [];
            this.processedData = [];
            this.allTasks = {}; 
            this.allPersons = [];
            this.allUsers = [];
            this.allTransactionTypes = []; 
            this.allIpRecords = [];
            this.selectedAccruals = new Set();
            
            this.pagination = null;
            this.itemsPerPage = 10;
            this.currentSort = { column: 'createdAt', direction: 'desc' }; 
            this.currentFilterStatus = 'all';

            this.currentEditAccrual = null;
            this.editFormManager = null;
            
            this.uploadedPaymentReceipts = [];
            this.taskDetailManager = null;
            this.activeTab = 'main';
        }

        async init() {
            this.currentUser = authService.getCurrentUser();
            this.initializePagination();
            this.taskDetailManager = new TaskDetailManager('modalBody');
            await this.loadAllData();
            this.setupEventListeners();
        }

        initializePagination() {
            if (typeof Pagination === 'undefined') { console.error("Pagination yüklenemedi."); return; }
            this.pagination = new Pagination({
                containerId: 'paginationControls', 
                itemsPerPage: this.itemsPerPage,
                itemsPerPageOptions: [10, 25, 50, 100],
                onPageChange: () => this.renderTable()
            });
        }

        async loadAllData() {
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Veriler Yükleniyor', 'Lütfen bekleyiniz...') : null;
            const loadingIndicator = document.getElementById('loadingIndicator');
            if(loadingIndicator) loadingIndicator.style.display = 'block';

            try {
                // 1. IP Kayıtlarını (Dosyaları) direkt Firestore'dan çekiyoruz (Servis hatasını bypass ediyoruz)
                const ipRecordsRef = collection(db, 'ipRecords');
                const ipSnapshot = await getDocs(ipRecordsRef);
                
                // Gelen veriyi diziye çeviriyoruz
                this.allIpRecords = ipSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                // 2. Diğer verileri çekiyoruz
                const [accRes, personsRes, usersRes, typesRes] = await Promise.all([
                    accrualService.getAccruals(),
                    personService.getPersons(),
                    taskService.getAllUsers(),
                    transactionTypeService.getTransactionTypes()
                ]);

                this.allAccruals = accRes?.success ? (accRes.data || []) : [];
                this.allPersons = personsRes?.success ? (personsRes.data || []) : [];
                this.allUsers = usersRes?.success ? (usersRes.data || []) : [];
                this.allTransactionTypes = typesRes?.success ? (typesRes.data || []) : [];

                // 3. Task detaylarını ID'lere göre topluca çekiyoruz
                if (this.allAccruals.length > 0) {
                    this.allAccruals.forEach(a => { a.createdAt = a.createdAt ? new Date(a.createdAt) : new Date(0); });
                    const taskIds = new Set();
                    this.allAccruals.forEach(a => { if (a.taskId) taskIds.add(String(a.taskId)); });

                    if (taskIds.size && taskService.getTasksByIds) {
                        const tRes = await taskService.getTasksByIds(Array.from(taskIds));
                        const tasks = tRes?.success ? (tRes.data || []) : [];
                        this.allTasks = {};
                        tasks.forEach(t => { this.allTasks[String(t.id)] = t; });
                    }
                }

                this.initEditForm();
                this.processData(); // Tabloyu oluştur

            } catch (err) {
                console.error(err);
                showNotification('Veri yükleme hatası: ' + err.message, 'error');
            } finally {
                if(loadingIndicator) loadingIndicator.style.display = 'none';
                if(loader) loader.hide();
            }
        }

        initEditForm() {
            this.editFormManager = new AccrualFormManager(
                'editAccrualFormContainer', 
                'edit', 
                this.allPersons
            );
            this.editFormManager.render();
        }

        processData() {
            let data = [...this.allAccruals];

            // 1. SEKME FİLTRESİ
            if (this.activeTab === 'foreign') {
                // Sadece yurt dışı işlemleri
                data = data.filter(a => a.isForeignTransaction === true);
            }

            // 2. DURUM FİLTRESİ (Mevcut)
            if (this.currentFilterStatus !== 'all') {
                data = data.filter(a => a.status === this.currentFilterStatus);
            }

            // 3. ARAMA (Mevcut)
            const searchInput = document.getElementById('searchInput');
            if (searchInput && searchInput.value) {
                const query = searchInput.value.toLocaleLowerCase('tr');
                data = data.filter(item => item.searchString.includes(query));
            }

            this.processedData = this.sortData(data);
            if (this.pagination) this.pagination.update(this.processedData.length);
            
            // Tabloyu çiz (Hangi tab aktifse onu çizer)
            this.renderTable();
        }

        sortData(data) {
            const { column, direction } = this.currentSort;
            const dirMultiplier = direction === 'asc' ? 1 : -1;
            return data.sort((a, b) => {
                let valA, valB;
                switch (column) {
                    case 'id': valA = (a.id || '').toLowerCase(); valB = (b.id || '').toLowerCase(); break;
                    case 'status': valA = (a.status || '').toLowerCase(); valB = (b.status || '').toLowerCase(); break;
                    case 'taskTitle':
                        const taskA = this.allTasks[String(a.taskId)];
                        const taskB = this.allTasks[String(b.taskId)];
                        valA = (taskA ? taskA.title : (a.taskTitle || '')).toLowerCase();
                        valB = (taskB ? taskB.title : (b.taskTitle || '')).toLowerCase();
                        break;
                    case 'officialFee': valA = a.officialFee?.amount || 0; valB = b.officialFee?.amount || 0; break;
                    case 'serviceFee': valA = a.serviceFee?.amount || 0; valB = b.serviceFee?.amount || 0; break;
                    case 'totalAmount': valA = a.totalAmount || 0; valB = b.totalAmount || 0; break;
                    case 'remainingAmount': 
                        valA = a.remainingAmount !== undefined ? a.remainingAmount : a.totalAmount;
                        valB = b.remainingAmount !== undefined ? b.remainingAmount : b.totalAmount;
                        break;
                    case 'createdAt': valA = a.createdAt; valB = b.createdAt; break;
                    default: valA = 0; valB = 0;
                }
                if (valA < valB) return -1 * dirMultiplier;
                if (valA > valB) return 1 * dirMultiplier;
                return 0;
            });
        }

        renderTable() {
            // Hangi tabloyu dolduracağız?
            const tbodyId = this.activeTab === 'foreign' ? 'foreignTableBody' : 'accrualsTableBody';
            const tbody = document.getElementById(tbodyId);
            const noMsg = document.getElementById('noRecordsMessage');
            
            if (!tbody) return;
            tbody.innerHTML = '';

            // Veri yoksa mesaj göster
            if (!this.processedData || this.processedData.length === 0) {
                if(noMsg) noMsg.style.display = 'block';
                return;
            }
            if(noMsg) noMsg.style.display = 'none';

            // Pagination uygula
            let pageData = this.pagination ? this.pagination.getCurrentPageData(this.processedData) : this.processedData;
            
            // --- Helper: Para Birimi Formatla ---
            const formatMultiCurrency = (data, defaultCurrency = 'TRY') => {
                if (Array.isArray(data)) {
                    if (data.length === 0) return '0,00 ' + defaultCurrency;
                    return data.map(item => {
                        const val = parseFloat(item.amount) || 0;
                        return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(val)} ${item.currency}`;
                    }).join(' + ');
                }
                const val = parseFloat(data) || 0;
                return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: defaultCurrency }).format(val);
            };

            // --- TAB 1: GENEL TAHAKKUK LİSTESİ (Mevcut Kodunuz) ---
            if (this.activeTab === 'main') {
                tbody.innerHTML = pageData.map(acc => {
                    // ... (Status class hesaplamaları aynen kalsın) ...
                    let sTxt = 'Bilinmiyor', sCls = '';
                    if(acc.status === 'paid') { sTxt = 'Ödendi'; sCls = 'status-paid'; }
                    else if(acc.status === 'unpaid') { sTxt = 'Ödenmedi'; sCls = 'status-unpaid'; }
                    else if(acc.status === 'partially_paid') { sTxt = 'Kısmen Ödendi'; sCls = 'status-partially-paid'; }

                    const isSel = this.selectedAccruals.has(acc.id);
                    const isPaid = acc.status === 'paid';
                    
                    // --- DÜZELTME BAŞLANGICI ---
                    
            let taskDisplay = acc.taskTitle || '-'; 
            let relatedFileDisplay = '-';

            const task = this.allTasks[String(acc.taskId)];
            
            if (task) {
                // 1. İş Tipini (TransactionType) Bul
                // allTransactionTypes dizisi loadAllData() fonksiyonunda zaten yüklenmişti
                const typeObj = this.allTransactionTypes.find(t => t.id === task.taskType);

                // 2. İLGİLİ İŞ GÖSTERİMİ: Alias değerini al
                if (typeObj) {
                    // Alias varsa onu, yoksa tipin adını (name) göster
                    taskDisplay = typeObj.alias || typeObj.name;
                } else {
                    // İş tipi bulunamazsa işin kendi başlığını kullan (Fallback)
                    taskDisplay = task.title || '-';
                }

                // 3. İLGİLİ DOSYA (Önceki adımda eklediğimiz kısım - aynen kalıyor)
                if (task.relatedIpRecordId) {
                    const ipRec = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
                    if (ipRec) {
                        relatedFileDisplay = ipRec.applicationNumber || ipRec.title || 'Dosya';
                    }
                }
            }

                    const officialStr = acc.officialFee ? formatMultiCurrency(acc.officialFee.amount, acc.officialFee.currency) : '-';
                    const serviceStr = acc.serviceFee ? formatMultiCurrency(acc.serviceFee.amount, acc.serviceFee.currency) : '-';
                    const rem = acc.remainingAmount !== undefined ? acc.remainingAmount : acc.totalAmount;
                    
                    let remainingHtml = `<span>${formatMultiCurrency(rem, acc.totalAmountCurrency)}</span>`;

                    return `
                    <tr>
                        <td><input type="checkbox" class="row-checkbox" data-id="${acc.id}" ${isSel ? 'checked' : ''}></td>
                        <td><small>${acc.id.substring(0, 8)}...</small></td>
                        <td><span class="status-badge ${sCls}">${sTxt}</span></td>
                        
                        <td><span class="badge badge-light border" style="font-weight:normal; font-size: 0.9em;">${relatedFileDisplay}</span></td>
                        
                        <td><a href="#" class="task-detail-link font-weight-bold" data-task-id="${acc.taskId}">${taskDisplay}</a></td>
                        
                        <td>${officialStr}</td>
                        <td>${serviceStr}</td>
                        <td>${formatMultiCurrency(acc.totalAmount, acc.totalAmountCurrency)}</td>
                        <td>${remainingHtml}</td>
                        <td>
                            <div style="display: flex; gap: 5px;">
                                <button class="action-btn view-btn" data-id="${acc.id}" title="Detay">Görüntüle</button>
                                <button class="action-btn edit-btn" data-id="${acc.id}" title="Düzenle" ${isPaid ? 'disabled' : ''}>Düzenle</button>
                                <button class="action-btn delete-btn" data-id="${acc.id}" title="Sil">Sil</button>
                            </div>
                        </td>
                    </tr>`;
                }).join('');
            }
            
            this.updateBulkActionsVisibility();
        }

        // Mevcut satır oluşturma kodunuzu buraya taşıyabilirsiniz (Temiz kod için)
        createMainRow(acc, formatFn) {
            // ... (Mevcut 'renderTable' içindeki map fonksiyonunun içeriği) ...
            // Bu fonksiyonu oluşturmak zorunda değilsiniz, if(this.activeTab === 'main') bloğunun içine 
            // eski kodunuzu aynen yapıştırabilirsiniz.
             let sTxt = 'Bilinmiyor', sCls = '';
             if(acc.status === 'paid') { sTxt = 'Ödendi'; sCls = 'status-paid'; }
             else if(acc.status === 'unpaid') { sTxt = 'Ödenmedi'; sCls = 'status-unpaid'; }
             else if(acc.status === 'partially_paid') { sTxt = 'Kısmen Ödendi'; sCls = 'status-partially-paid'; }

             const isSel = this.selectedAccruals.has(acc.id);
             const isPaid = acc.status === 'paid';
             
             let taskDisplay = acc.taskId; 
             let relatedFileDisplay = '-';

             const task = this.allTasks[String(acc.taskId)];
             if (task) {
                 const typeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                 const typeName = typeObj ? (typeObj.alias || typeObj.name) : 'İşlem';
                 taskDisplay = `${typeName} (${task.id})`;
                 if (task.relatedIpRecordId) {
                     const ipRec = this.allIpRecords.find(r => r.id === task.relatedIpRecordId);
                     if (ipRec) relatedFileDisplay = ipRec.applicationNumber || ipRec.title || 'Dosya';
                 }
             } else if (acc.taskTitle) {
                 taskDisplay = acc.taskTitle;
             }

             const officialStr = acc.officialFee ? formatFn(acc.officialFee.amount, acc.officialFee.currency) : '-';
             const serviceStr = acc.serviceFee ? formatFn(acc.serviceFee.amount, acc.serviceFee.currency) : '-';
             const rem = acc.remainingAmount !== undefined ? acc.remainingAmount : acc.totalAmount;
             
             // Kalan Tutar HTML (Basitleştirilmiş)
             let remainingHtml = `<span>${formatFn(rem, acc.totalAmountCurrency)}</span>`;

             return `
             <tr>
                 <td><input type="checkbox" class="row-checkbox" data-id="${acc.id}" ${isSel ? 'checked' : ''}></td>
                 <td><small>${acc.id.substring(0, 8)}...</small></td>
                 <td><span class="status-badge ${sCls}">${sTxt}</span></td>
                 <td><span class="badge badge-light border" style="font-weight:normal;">${relatedFileDisplay}</span></td>
                 <td><a href="#" class="task-detail-link font-weight-bold" data-task-id="${acc.taskId}">${taskDisplay}</a></td>
                 <td>${officialStr}</td>
                 <td>${serviceStr}</td>
                 <td>${formatFn(acc.totalAmount, acc.totalAmountCurrency)}</td>
                 <td>${remainingHtml}</td>
                 <td>
                     <div style="display: flex; gap: 5px;">
                         <button class="action-btn view-btn" data-id="${acc.id}" title="Detay">Görüntüle</button>
                         <button class="action-btn edit-btn" data-id="${acc.id}" title="Düzenle" ${isPaid ? 'disabled' : ''}>Düzenle</button>
                         <button class="action-btn delete-btn" data-id="${acc.id}" title="Sil">Sil</button>
                     </div>
                 </td>
             </tr>`;
        }

        updateSortIcons() {
            document.querySelectorAll('th[data-sort] i').forEach(icon => {
                icon.className = 'fas fa-sort sort-icon text-muted';
            });
            const activeHeader = document.querySelector(`th[data-sort="${this.currentSort.column}"]`);
            if (activeHeader) {
                const icon = activeHeader.querySelector('i');
                if (icon) icon.className = `fas fa-sort-${this.currentSort.direction === 'asc' ? 'up' : 'down'} sort-icon`;
            }
        }

        // --- GÜNCELLENEN EDIT MODAL (Async Task Fetch Eklendi) ---
        async showEditAccrualModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            this.currentEditAccrual = { ...accrual };
            document.getElementById('editAccrualId').value = accrual.id;
            document.getElementById('editAccrualTaskTitleDisplay').value = accrual.taskTitle || '';
            
            if(this.editFormManager) {
                this.editFormManager.reset();
                this.editFormManager.setData(accrual);

                // --- EPATS Belgesi Bulma Mantığı (DÜZELTİLDİ) ---
                let epatsDoc = null;
                const taskId = accrual.taskId;

                // 1. Önbelleği kontrol et
                let task = this.allTasks[String(taskId)];
                
                // 2. Önbellekte yoksa veya detay eksikse veritabanından çek
                if (!task || (!task.details && !task.relatedTaskId)) {
                    try {
                        const taskSnap = await getDoc(doc(db, 'tasks', String(taskId)));
                        if (taskSnap.exists()) {
                            task = { id: taskSnap.id, ...taskSnap.data() };
                            // Cache'i güncelle
                            this.allTasks[String(taskId)] = task;
                        }
                    } catch(e) { console.warn('Task fetch error:', e); }
                }

                // 3. Task verisinden belgeyi çıkar
                if (task) {
                    if (task.details && task.details.epatsDocument) {
                        epatsDoc = task.details.epatsDocument;
                    } else if (task.relatedTaskId) {
                         const parent = this.allTasks[String(task.relatedTaskId)];
                         if (parent && parent.details) epatsDoc = parent.details.epatsDocument;
                    }
                }
                
                // 4. Belgeyi forma gönder
                this.editFormManager.showEpatsDoc(epatsDoc);
            }

            document.getElementById('editAccrualModal').classList.add('show');
        }

    async handleSaveAccrualChanges() {
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Kaydediliyor...') : null;

            try {
                // 1. Formdaki verileri al
                const result = this.editFormManager.getData();
                if (!result.success) {
                    if(loader) loader.hide();
                    showNotification(result.error, 'error');
                    return;
                }
                const formData = result.data;
                const accrualId = document.getElementById('editAccrualId').value;

                // 2. Yeni Dosyaları Yükle (Varsa)
                let newFiles = [];
                if (formData.files && formData.files.length > 0) {
                    try {
                        const file = formData.files[0];
                        const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                        const snapshot = await uploadBytes(storageRef, file);
                        const url = await getDownloadURL(snapshot.ref);
                        newFiles.push({ name: file.name, url, type: 'foreign_invoice', documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() });
                    } catch(err) { 
                        if(loader) loader.hide(); showNotification("Dosya yüklenemedi.", "error"); return; 
                    }
                }

                const existingFiles = this.currentEditAccrual.files || [];
                const finalFiles = [...existingFiles, ...newFiles];

                // --- 3. KALAN TUTARI YENİDEN HESAPLA (DÜZELTME BURADA) ---
                
                // A) KDV Çarpanını Bul
                const vatMultiplier = 1 + (formData.vatRate / 100);

                // B) Yeni Hedef Tutarları Hesapla (KDV Dahil)
                const targetOff = formData.applyVatToOfficialFee 
                    ? formData.officialFee.amount * vatMultiplier 
                    : formData.officialFee.amount;
                
                const targetSrv = formData.serviceFee.amount * vatMultiplier;

                // C) Daha Önce Ödenmiş Tutarları Çek (Veritabanından)
                const paidOff = this.currentEditAccrual.paidOfficialAmount || 0;
                const paidSrv = this.currentEditAccrual.paidServiceAmount || 0;

                // D) Kalanları Hesapla (Hedef - Ödenen)
                // Eksiye düşmemesi için Math.max(0, ...) kullanıyoruz
                const remOff = Math.max(0, targetOff - paidOff);
                const remSrv = Math.max(0, targetSrv - paidSrv);

                // E) Para Birimine Göre Grupla (Multi-Currency Support)
                const remMap = {};
                
                // Resmi Ücret Kalanı
                if (remOff > 0.01) {
                    const cur = formData.officialFee.currency;
                    remMap[cur] = (remMap[cur] || 0) + remOff;
                }
                
                // Hizmet Bedeli Kalanı
                if (remSrv > 0.01) {
                    const cur = formData.serviceFee.currency;
                    remMap[cur] = (remMap[cur] || 0) + remSrv;
                }

                // F) Veritabanı Formatına (Array) Çevir
                const newRemainingAmount = Object.entries(remMap).map(([curr, amt]) => ({
                    amount: amt,
                    currency: curr
                }));

                // G) Durumu (Status) Otomatik Güncelle
                let newStatus = 'unpaid';
                if (newRemainingAmount.length === 0) {
                    // Hiç borç kalmadıysa
                    newStatus = 'paid';
                } else if (paidOff > 0 || paidSrv > 0) {
                    // Borç var ama daha önce bir şeyler ödenmişse
                    newStatus = 'partially_paid';
                }
                // Hiç ödeme yoksa 'unpaid' kalır.

                // --- 4. GÜNCELLEME OBJESİ ---
                const updates = {
                    officialFee: formData.officialFee,
                    serviceFee: formData.serviceFee,
                    vatRate: formData.vatRate,
                    applyVatToOfficialFee: formData.applyVatToOfficialFee,
                    
                    totalAmount: formData.totalAmount,     // Formdan gelen yeni toplam
                    remainingAmount: newRemainingAmount,   // YUKARIDA HESAPLANAN YENİ KALAN
                    status: newStatus,                     // YUKARIDA HESAPLANAN YENİ DURUM
                    
                    totalAmountCurrency: 'TRY', // Bu alan array yapısına geçişte önemsizleşti ama tutuyoruz
                    
                    tpInvoiceParty: formData.tpInvoiceParty,
                    serviceInvoiceParty: formData.serviceInvoiceParty,
                    isForeignTransaction: formData.isForeignTransaction,
                    files: finalFiles
                };

                await accrualService.updateAccrual(accrualId, updates);
                this.closeModal('editAccrualModal');
                await this.loadAllData();
                showNotification('Kaydedildi ve Tutarlar Güncellendi', 'success');

            } catch(e) {
                console.error(e);
                showNotification('Hata: ' + e.message, 'error');
            } finally {
                if(loader) loader.hide();
            }
        }

        closeModal(id) {
            document.getElementById(id).classList.remove('show');
            if(id === 'editAccrualModal') {
                this.currentEditAccrual = null;
                if(this.editFormManager) this.editFormManager.reset();
            }
            if(id === 'markPaidModal') {
                this.uploadedPaymentReceipts = [];
                document.getElementById('paymentReceiptFileList').innerHTML = '';
            }
        }

        async showViewAccrualDetailModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            const modal = document.getElementById('viewAccrualDetailModal');
            const title = document.getElementById('viewAccrualTitle');
            const body = modal.querySelector('.modal-body-content');

            title.textContent = `Tahakkuk Detayı (#${accrual.id})`;
            
            const fmtMoney = (v, c) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: c || 'TRY' }).format(v || 0);
            const fmtDate = (d) => { try { return d ? new Date(d).toLocaleDateString('tr-TR') : '-'; } catch{return '-'} };
            
            let statusText = 'Bilinmiyor', statusColor = '#6c757d';
            if(accrual.status === 'paid') { statusText = 'Ödendi'; statusColor = '#28a745'; }
            else if(accrual.status === 'unpaid') { statusText = 'Ödenmedi'; statusColor = '#dc3545'; }
            else if(accrual.status === 'partially_paid') { statusText = 'Kısmen Ödendi'; statusColor = '#ffc107'; }

            let docsHtml = '';
            if(accrual.files && accrual.files.length > 0) {
                accrual.files.forEach(f => {
                    const url = f.content || f.url;
                    docsHtml += `
                    <div class="col-md-6 mb-2">
                        <div class="view-box d-flex justify-content-between align-items-center">
                            <div class="text-truncate">
                                <i class="fas fa-file-alt text-secondary mr-2"></i> ${f.name}
                            </div>
                            <a href="${url}" target="_blank" class="btn btn-sm btn-light border"><i class="fas fa-download"></i></a>
                        </div>
                    </div>`;
                });
            } else {
                docsHtml = '<div class="col-12 text-muted small">Belge yok.</div>';
            }

            body.innerHTML = `
                <div class="form-group">
                    <label class="view-label">İlgili İş</label>
                    <div class="view-box bg-light text-dark font-weight-bold">${accrual.taskTitle || '-'}</div>
                </div>
                <div class="form-grid">
                    <div class="form-group">
                        <label class="view-label">Durum</label>
                        <div class="view-box" style="color:${statusColor}; font-weight:bold;">${statusText}</div>
                    </div>
                    <div class="form-group">
                        <label class="view-label">Tarih</label>
                        <div class="view-box">${fmtDate(accrual.createdAt)}</div>
                    </div>
                </div>
                <div class="section-header"><i class="fas fa-coins mr-2"></i>FİNANSAL</div>
                <div class="form-grid">
                    <div class="form-group"><label class="view-label">Resmi</label><div class="view-box">${fmtMoney(accrual.officialFee?.amount, accrual.officialFee?.currency)}</div></div>
                    <div class="form-group"><label class="view-label">Hizmet</label><div class="view-box">${fmtMoney(accrual.serviceFee?.amount, accrual.serviceFee?.currency)}</div></div>
                    <div class="form-group"><label class="view-label">Toplam</label><div class="view-box font-weight-bold text-primary">${fmtMoney(accrual.totalAmount, accrual.totalAmountCurrency)}</div></div>
                    <div class="form-group"><label class="view-label">Kalan</label><div class="view-box">${fmtMoney(accrual.remainingAmount, accrual.totalAmountCurrency)}</div></div>
                </div>
                <div class="section-header"><i class="fas fa-file-invoice mr-2"></i>TARAFLAR</div>
                <div class="form-grid">
                    <div class="form-group"><label class="view-label">Fatura (TP)</label><div class="view-box">${accrual.tpInvoiceParty?.name || '-'}</div></div>
                    <div class="form-group"><label class="view-label">Hizmet/Yurtdışı</label><div class="view-box">${accrual.serviceInvoiceParty?.name || '-'}</div></div>
                </div>
                <div class="section-header"><i class="fas fa-folder-open mr-2"></i>BELGELER</div>
                <div class="row">${docsHtml}</div>
            `;
            modal.classList.add('show');
        }

    async showTaskDetailModal(taskId) {
            const modal = document.getElementById('taskDetailModal');
            if(!modal || !this.taskDetailManager) return;

            modal.classList.add('show');
            document.getElementById('modalTaskTitle').textContent = 'İş Detayı Yükleniyor...';
            this.taskDetailManager.showLoading();

            try {
                // Task verisini çek
                const taskRef = doc(db, 'tasks', String(taskId));
                const taskSnap = await getDoc(taskRef);

                if (!taskSnap.exists()) {
                    this.taskDetailManager.showError('Bu iş kaydı bulunamadı.');
                    return;
                }
                const task = { id: taskSnap.id, ...taskSnap.data() };
                document.getElementById('modalTaskTitle').textContent = `İş Detayı (${task.id})`;

                // DÜZELTME: İlişkili Kaydı (IP Record) Anlık Çek
                let ipRecord = null;
                if (task.relatedIpRecordId) {
                    try {
                        const ipRef = doc(db, 'ipRecords', String(task.relatedIpRecordId));
                        const ipSnap = await getDoc(ipRef);
                        if(ipSnap.exists()) {
                            ipRecord = { id: ipSnap.id, ...ipSnap.data() };
                        }
                    } catch(e) { console.warn('IP Record fetch error', e); }
                }

                // Diğer bilgiler
                const transactionType = this.allTransactionTypes.find(t => t.id === task.taskType);
                const assignedUser = this.allUsers.find(u => u.id === task.assignedTo_uid);
                const relatedAccruals = this.allAccruals.filter(acc => String(acc.taskId) === String(task.id));

                this.taskDetailManager.render(task, {
                    ipRecord: ipRecord, // Artık dolu gelecek
                    transactionType: transactionType,
                    assignedUser: assignedUser,
                    accruals: relatedAccruals
                });

            } catch (error) {
                console.error(error);
                this.taskDetailManager.showError('Veri yüklenirken hata oluştu.');
            }
        }

// --- Modal Gösterim (Currency Etiketlerini Ayarla) --
        showMarkPaidModal() {
            if (this.selectedAccruals.size === 0) { showNotification('Seçim yapınız', 'error'); return; }
            
            const modal = document.getElementById('markPaidModal');
            document.getElementById('paidAccrualCount').textContent = this.selectedAccruals.size;
            document.getElementById('paymentDate').valueAsDate = new Date(); // Bugünün tarihi

            const detailedArea = document.getElementById('detailedPaymentInputs');
            
            // TEKİL SEÇİM MANTIĞI
            if (this.selectedAccruals.size === 1) {
                detailedArea.style.display = 'block';
                const accrualId = this.selectedAccruals.values().next().value;
                const accrual = this.allAccruals.find(a => a.id === accrualId);
                
                // 1. Resmi Ücret Ayarları
                const offAmount = accrual.officialFee?.amount || 0;
                const offCurr = accrual.officialFee?.currency || 'TRY';
                const offVatText = accrual.applyVatToOfficialFee ? ' (+KDV)' : '';
                
                document.getElementById('officialFeeBadge').textContent = `${offAmount} ${offCurr}${offVatText}`;
                document.getElementById('manualOfficialCurrencyLabel').textContent = offCurr;
                
                document.getElementById('payFullOfficial').checked = true;
                document.getElementById('officialAmountInputContainer').style.display = 'none';
                
                // --- DEĞİŞİKLİK 1: MEVCUT ÖDENEN TUTARI INPUT'A YAZ ---
                // Eskiden burası boşaltılıyordu (''), şimdi veritabanındaki değeri yazıyoruz.
                document.getElementById('manualOfficialAmount').value = accrual.paidOfficialAmount || 0; 
                // -------------------------------------------------------

                // 2. Hizmet Bedeli Ayarları
                const srvAmount = accrual.serviceFee?.amount || 0;
                const srvCurr = accrual.serviceFee?.currency || 'TRY';
                
                document.getElementById('serviceFeeBadge').textContent = `${srvAmount} ${srvCurr} (+KDV)`;
                document.getElementById('manualServiceCurrencyLabel').textContent = srvCurr;

                document.getElementById('payFullService').checked = true;
                document.getElementById('serviceAmountInputContainer').style.display = 'none';
                
                // --- DEĞİŞİKLİK 2: MEVCUT ÖDENEN TUTARI INPUT'A YAZ ---
                document.getElementById('manualServiceAmount').value = accrual.paidServiceAmount || 0;
                // -------------------------------------------------------

                // Checkbox Eventleri (Değişmedi)
                document.getElementById('payFullOfficial').onchange = (e) => {
                    document.getElementById('officialAmountInputContainer').style.display = e.target.checked ? 'none' : 'block';
                };
                document.getElementById('payFullService').onchange = (e) => {
                    document.getElementById('serviceAmountInputContainer').style.display = e.target.checked ? 'none' : 'block';
                };

            } else {
                // ÇOKLU SEÇİM: Detayları gizle
                detailedArea.style.display = 'none';
            }

            modal.classList.add('show');
        }

        // --- Ödeme Kaydetme (Görsel Düzeltme ile Uyumlu) ---
        
        async handlePaymentSubmission() {
            if (this.selectedAccruals.size === 0) return;
            const paymentDate = document.getElementById('paymentDate').value;
            if(!paymentDate) { showNotification('Lütfen tarih seçiniz', 'error'); return; }

            let loader = window.showSimpleLoading ? window.showSimpleLoading('İşleniyor...') : null;

            try {
                const promises = Array.from(this.selectedAccruals).map(async (id) => {
                    const accrual = this.allAccruals.find(a => a.id === id);
                    if (!accrual) return;

                    let updates = {
                        paymentDate: paymentDate,
                        files: [...(accrual.files || []), ...this.uploadedPaymentReceipts]
                    };

                    // TEKİL SEÇİM (Detaylı Ödeme ve Update Mantığı)
                    if (this.selectedAccruals.size === 1) {
                        const payFullOff = document.getElementById('payFullOfficial').checked;
                        const payFullSrv = document.getElementById('payFullService').checked;
                        
                        const vatMultiplier = 1 + ((accrual.vatRate || 0) / 100);

                        // --- 1. Resmi Ücret Ödemesi ---
                        const offTarget = accrual.applyVatToOfficialFee 
                            ? (accrual.officialFee?.amount || 0) * vatMultiplier 
                            : (accrual.officialFee?.amount || 0);

                        let newPaidOff = 0;

                        if (payFullOff) {
                            // Tamamını öde seçiliyse -> Hedef tutarı al
                            newPaidOff = offTarget;
                        } else {
                            // Seçili DEĞİLSE -> Inputtaki değeri DİREKT al (Ekleme yapma)
                            newPaidOff = parseFloat(document.getElementById('manualOfficialAmount').value) || 0;
                        }

                        // --- 2. Hizmet Bedeli Ödemesi ---
                        const srvTarget = (accrual.serviceFee?.amount || 0) * vatMultiplier;
                        
                        let newPaidSrv = 0;

                        if (payFullSrv) {
                            // Tamamını öde seçiliyse -> Hedef tutarı al
                            newPaidSrv = srvTarget;
                        } else {
                            // Seçili DEĞİLSE -> Inputtaki değeri DİREKT al (Ekleme yapma)
                            newPaidSrv = parseFloat(document.getElementById('manualServiceAmount').value) || 0;
                        }

                        // --- UPDATE İŞLEMİ (Kümülatif Değil, Override) ---
                        updates.paidOfficialAmount = newPaidOff;
                        updates.paidServiceAmount = newPaidSrv;

                        // KALAN TUTARI HESAPLA (Hedef - Yeni Ödenen)
                        const remOff = Math.max(0, offTarget - newPaidOff);
                        const remSrv = Math.max(0, srvTarget - newPaidSrv);
                        
                        const offCurr = accrual.officialFee?.currency || 'TRY';
                        const srvCurr = accrual.serviceFee?.currency || 'TRY';

                        const remMap = {};
                        if (remOff > 0.01) remMap[offCurr] = (remMap[offCurr] || 0) + remOff;
                        if (remSrv > 0.01) remMap[srvCurr] = (remMap[srvCurr] || 0) + remSrv;

                        // Kalan tutarı diziye çevir
                        const remainingArray = Object.entries(remMap).map(([c, a]) => ({ amount: a, currency: c }));
                        updates.remainingAmount = remainingArray;

                        // Status Kontrolü
                        if (remainingArray.length === 0) {
                            updates.status = 'paid';
                        } else if (newPaidOff > 0 || newPaidSrv > 0) {
                            updates.status = 'partially_paid';
                        } else {
                            updates.status = 'unpaid';
                        }

                    } else {
                        // ÇOKLU SEÇİM (Hepsini kapat - değişmedi)
                        updates.status = 'paid';
                        updates.remainingAmount = []; 
                        
                        // Çoklu seçimde ödendi yapınca tam tutarları paidAmount olarak işle
                        const vatMultiplier = 1 + ((accrual.vatRate || 0) / 100);
                        const offTarget = accrual.applyVatToOfficialFee 
                            ? (accrual.officialFee?.amount || 0) * vatMultiplier 
                            : (accrual.officialFee?.amount || 0);
                        const srvTarget = (accrual.serviceFee?.amount || 0) * vatMultiplier;
                        
                        updates.paidOfficialAmount = offTarget;
                        updates.paidServiceAmount = srvTarget;
                    }

                    return accrualService.updateAccrual(id, updates);
                });

                await Promise.all(promises);
                showNotification('Başarılı', 'success');
                this.closeModal('markPaidModal');
                this.selectedAccruals.clear();
                this.updateBulkActionsVisibility();
                await this.loadAllData();

            } catch(e) {
                console.error(e);
                showNotification('Hata: ' + e.message, 'error');
            } finally {
                if(loader) loader.hide();
            }
        }

        handlePaymentReceiptUpload(files) {
            Array.from(files).forEach(file => {
                readFileAsDataURL(file).then(url => {
                    this.uploadedPaymentReceipts.push({
                        id: generateUUID(), name: file.name, size: file.size, type: file.type, content: url, documentDesignation: 'Ödeme Dekontu'
                    });
                    this.renderPaymentReceiptFileList();
                });
            });
        }
        renderPaymentReceiptFileList() {
            const list = document.getElementById('paymentReceiptFileList');
            list.innerHTML = this.uploadedPaymentReceipts.map(f => `<div class="file-item-modal"><span>${f.name}</span><button class="remove-file-modal" onclick="this.parentElement.remove()">x</button></div>`).join('');
        }

        async handleBulkUpdate(newStatus) {
            // Eğer yanlışlıkla 'paid' gönderilirse işlem yapma (o artık diğer fonksiyonda)
            if (newStatus === 'paid') return; 
            
            if (this.selectedAccruals.size === 0) return;

            let loader = window.showSimpleLoading ? window.showSimpleLoading('Güncelleniyor...') : null;
            try {
                const promises = Array.from(this.selectedAccruals).map(async (id) => {
                    const acc = this.allAccruals.find(a => a.id === id);
                    if (!acc) return;

                    // Ödenmedi durumuna çekiliyorsa tüm ödeme verilerini sıfırla
                    const updates = { 
                        status: newStatus,
                        paymentDate: null,
                        remainingAmount: acc.totalAmount, // Kalan tutarı tekrar toplama eşitle
                        paidOfficialAmount: 0,            // Ödenen resmi ücreti sıfırla
                        paidServiceAmount: 0              // Ödenen hizmet bedelini sıfırla
                    };
                    
                    return accrualService.updateAccrual(id, updates);
                });

                await Promise.all(promises);
                showNotification('Güncellendi', 'success');
                
                // Seçimleri temizle
                this.selectedAccruals.clear();
                this.updateBulkActionsVisibility();
                
                // Tabloyu yenile
                await this.loadAllData();
            } catch(e) { 
                console.error(e);
                showNotification('Hata oluştu', 'error'); 
            } 
            finally { if(loader) loader.hide(); }
        }

        async deleteAccrual(id) {
            if(confirm('Silmek istiyor musunuz?')) {
                let loader = window.showSimpleLoading ? window.showSimpleLoading('Siliniyor...') : null;
                try {
                    await accrualService.deleteAccrual(id);
                    await this.loadAllData();
                } catch(e) { showNotification('Hata', 'error'); }
                finally { if(loader) loader.hide(); }
            }
        }

        toggleSelectAll(checked) {
            document.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = checked; this.updateSelection(cb.dataset.id, checked); });
        }
        updateSelection(id, selected) {
            if(selected) this.selectedAccruals.add(id); else this.selectedAccruals.delete(id);
            this.updateBulkActionsVisibility();
        }
        updateBulkActionsVisibility() {
            document.getElementById('bulkActions').style.display = this.selectedAccruals.size > 0 ? 'flex' : 'none';
        }

        setupEventListeners() {
            document.getElementById('statusFilter').addEventListener('change', e => {
                this.currentFilterStatus = e.target.value;
                this.processData();
            });

            document.querySelectorAll('th[data-sort]').forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    const column = th.dataset.sort;
                    if (this.currentSort.column === column) {
                        this.currentSort.direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        this.currentSort = { column: column, direction: 'asc' };
                    }
                    this.processData();
                });
            });

            document.getElementById('selectAllCheckbox').addEventListener('change', e => this.toggleSelectAll(e.target.checked));
            const tbody = document.getElementById('accrualsTableBody');
            
            tbody.addEventListener('change', e => {
                if(e.target.classList.contains('row-checkbox')) this.updateSelection(e.target.dataset.id, e.target.checked);
            });

            tbody.addEventListener('click', e => {
                const btn = e.target.closest('.action-btn');
                if (btn) {
                    e.preventDefault();
                    const dataId = btn.dataset.id;
                    if(btn.classList.contains('view-btn')) this.showViewAccrualDetailModal(dataId);
                    if(btn.classList.contains('edit-btn')) this.showEditAccrualModal(dataId);
                    if(btn.classList.contains('delete-btn')) this.deleteAccrual(dataId);
                } else if(e.target.classList.contains('task-detail-link')) {
                    e.preventDefault();
                    this.showTaskDetailModal(e.target.dataset.taskId);
                }
            });

            document.getElementById('bulkMarkPaidBtn').addEventListener('click', () => this.showMarkPaidModal());
            document.getElementById('bulkMarkUnpaidBtn').addEventListener('click', () => this.handleBulkUpdate('unpaid'));
            
            document.querySelectorAll('.close-modal-btn, #cancelEditAccrualBtn, #cancelMarkPaidBtn').forEach(b => {
                b.addEventListener('click', e => {
                    const m = e.target.closest('.modal');
                    this.closeModal(m.id);
                });
            });

            // TAB DEĞİŞİMİNİ DİNLE
            $('a[data-toggle="tab"]').on('shown.bs.tab', (e) => {
                const target = $(e.target).attr("href"); // #content-main veya #content-foreign
                this.activeTab = target === '#content-foreign' ? 'foreign' : 'main';
                
                // Tab değişince tabloyu yeniden çiz (filtreleri uygulayarak)
                this.processData();
            });

            // YENİ: Kaydet Butonu
            document.getElementById('saveAccrualChangesBtn').addEventListener('click', () => this.handleSaveAccrualChanges());
            const confirmBtn = document.getElementById('confirmMarkPaidBtn');
            if(confirmBtn) {
                confirmBtn.replaceWith(confirmBtn.cloneNode(true)); // Varsa eski eventleri temizlemek için clone (opsiyonel)
                document.getElementById('confirmMarkPaidBtn').addEventListener('click', () => this.handlePaymentSubmission());
            }
            
            const area = document.getElementById('paymentReceiptFileUploadArea');
            area.addEventListener('click', () => document.getElementById('paymentReceiptFile').click());
            document.getElementById('paymentReceiptFile').addEventListener('change', e => this.handlePaymentReceiptUpload(e.target.files));
        }
    }

    new AccrualsManager().init();
});