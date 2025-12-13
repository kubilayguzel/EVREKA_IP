import { authService, accrualService, taskService, personService, generateUUID, db, ipRecordsService, transactionTypeService } from '../../firebase-config.js';
import { showNotification, readFileAsDataURL } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

import Pagination from '../pagination.js'; 
import { AccrualFormManager } from '../components/AccrualFormManager.js';
import { TaskDetailManager } from '../components/TaskDetailManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Ortak Layout Yüklemesi
    await loadSharedLayout({ activeMenuLink: 'accruals.html' });

    class AccrualsManager {
        constructor() {
            this.currentUser = null;
            this.storage = getStorage();
            
            // Veri Havuzları
            this.allAccruals = [];
            this.processedData = []; // Tabloda gösterilecek işlenmiş veri
            
            this.allTasks = {}; 
            this.allPersons = [];
            this.allUsers = [];
            this.allTransactionTypes = []; 
            this.selectedAccruals = new Set();
            
            // Tablo Ayarları
            this.pagination = null;
            this.itemsPerPage = 10;
            this.currentSort = { column: 'createdAt', direction: 'desc' }; 
            this.currentFilterStatus = 'all';

            // Edit & Form Yönetimi
            this.currentEditAccrual = null;
            this.editFormManager = null;
            
            // Ödeme Yönetimi
            this.uploadedPaymentReceipts = [];
            
            // Detay Yönetimi
            this.taskDetailManager = null;
        }

        async init() {
            this.currentUser = authService.getCurrentUser();
            this.initializePagination();
            
            // Modalları Yöneten Managerlar
            this.taskDetailManager = new TaskDetailManager('modalBody');
            
            // Edit formunu başlat
            this.editFormManager = new AccrualFormManager(
                'editAccrualFormContainer', 
                'edit', 
                [] // Kişi listesi veriler gelince güncellenecek
            );

            await this.loadAllData();
            this.setupEventListeners();
        }

        initializePagination() {
            if (typeof Pagination === 'undefined') { console.error("Pagination yüklenemedi."); return; }
            // HTML'deki ID'ye göre kontrol
            const containerId = document.getElementById('paginationContainer') ? 'paginationContainer' : 'paginationControls';
            
            this.pagination = new Pagination({
                containerId: containerId, 
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

                // Edit Form Manager'a kişi listesini ver
                this.editFormManager.allPersons = this.allPersons;
                this.editFormManager.render();

                // Verileri Hazırla ve Arama Stringlerini Oluştur
                if (this.allAccruals.length > 0) {
                    this.allAccruals.forEach(a => { 
                        a.createdAt = a.createdAt ? new Date(a.createdAt) : new Date(0); 
                        
                        // --- Arama Performansı İçin Search String ---
                        const statusMap = {
                            'paid': 'Ödendi', 'unpaid': 'Ödenmedi', 
                            'partially_paid': 'Kısmen Ödendi', 'cancelled': 'İptal'
                        };
                        const statusText = statusMap[a.status] || a.status;
                        
                        // Tutar bilgisini stringe çevir
                        let amountStr = '';
                        if(Array.isArray(a.totalAmount)) {
                            amountStr = a.totalAmount.map(x => x.amount).join(' ');
                        } else {
                            amountStr = String(a.totalAmount || '');
                        }

                        a.searchString = `${a.id} ${a.taskTitle || ''} ${a.tpInvoiceParty?.name || ''} ${a.serviceInvoiceParty?.name || ''} ${statusText} ${amountStr}`.toLocaleLowerCase('tr');
                    });

                    // İlişkili Task verilerini çek (Cache mantığı)
                    const taskIds = new Set();
                    this.allAccruals.forEach(a => { if (a.taskId) taskIds.add(String(a.taskId)); });

                    if (taskIds.size && taskService.getTasksByIds) {
                        const tRes = await taskService.getTasksByIds(Array.from(taskIds));
                        const tasks = tRes?.success ? (tRes.data || []) : [];
                        this.allTasks = {};
                        tasks.forEach(t => { this.allTasks[String(t.id)] = t; });
                    }
                }

                this.processData();

            } catch (err) {
                console.error(err);
                showNotification('Veri yükleme hatası', 'error');
            } finally {
                if(loadingIndicator) loadingIndicator.style.display = 'none';
                if(loader) loader.hide();
            }
        }

        // --- VERİ İŞLEME (Filtreleme & Sıralama) ---
        processData() {
            let data = [...this.allAccruals];

            // 1. Statü Filtresi
            if (this.currentFilterStatus !== 'all') {
                data = data.filter(a => a.status === this.currentFilterStatus);
            }

            // 2. Arama Filtresi
            const searchInput = document.getElementById('searchInput');
            if (searchInput && searchInput.value) {
                const query = searchInput.value.toLocaleLowerCase('tr');
                data = data.filter(item => item.searchString.includes(query));
            }

            // 3. Sıralama
            this.processedData = this.sortData(data);
            
            // 4. Pagination Güncelle
            if (this.pagination) this.pagination.update(this.processedData.length);
            
            // 5. Tabloyu Çiz
            this.renderTable();
        }

        handleSearch() {
            this.processData();
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
                    case 'totalAmount': 
                        valA = Array.isArray(a.totalAmount) ? (a.totalAmount[0]?.amount || 0) : (a.totalAmount || 0); 
                        valB = Array.isArray(b.totalAmount) ? (b.totalAmount[0]?.amount || 0) : (b.totalAmount || 0); 
                        break;
                    case 'remainingAmount': 
                        let remA = a.remainingAmount !== undefined ? a.remainingAmount : a.totalAmount;
                        let remB = b.remainingAmount !== undefined ? b.remainingAmount : b.totalAmount;
                        valA = Array.isArray(remA) ? (remA[0]?.amount || 0) : (remA || 0);
                        valB = Array.isArray(remB) ? (remB[0]?.amount || 0) : (remB || 0);
                        break;
                    case 'createdAt': valA = a.createdAt; valB = b.createdAt; break;
                    default: valA = 0; valB = 0;
                }
                if (valA < valB) return -1 * dirMultiplier;
                if (valA > valB) return 1 * dirMultiplier;
                return 0;
            });
        }

        // --- TABLO RENDER ---
        renderTable() {
            const tbody = document.getElementById('accrualsTableBody');
            const noMsg = document.getElementById('noRecordsMessage');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (!this.processedData || this.processedData.length === 0) {
                if(noMsg) noMsg.style.display = 'block';
                if(this.pagination) this.pagination.update(0);
                return;
            }
            if(noMsg) noMsg.style.display = 'none';

            let pageData = this.pagination ? this.pagination.getCurrentPageData(this.processedData) : this.processedData;
            
            // Para birimi formatlayıcı helper
            const formatMultiCurrency = (data, defaultCurrency = 'TRY') => {
                if (Array.isArray(data)) {
                    if (data.length === 0) return '0,00 ' + defaultCurrency;
                    return data.map(item => {
                        const val = parseFloat(item.amount);
                        const safeVal = isNaN(val) ? 0 : val;
                        const formatted = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeVal);
                        return `${formatted} ${item.currency}`;
                    }).join(' + ');
                }
                const val = parseFloat(data);
                if (isNaN(val)) return '0,00 ' + defaultCurrency;
                return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: defaultCurrency }).format(val);
            };

            tbody.innerHTML = pageData.map(acc => {
                let sTxt = 'Bilinmiyor', sCls = '';
                if(acc.status === 'paid') { sTxt = 'Ödendi'; sCls = 'status-paid'; }
                else if(acc.status === 'unpaid') { sTxt = 'Ödenmedi'; sCls = 'status-unpaid'; }
                else if(acc.status === 'partially_paid') { sTxt = 'Kısmen Ödendi'; sCls = 'status-partially-paid'; }

                const isSel = this.selectedAccruals.has(acc.id);
                const isPaid = acc.status === 'paid';
                
                // İlişkili İş Başlığı
                let taskDisplay = acc.taskTitle || acc.taskId;
                if (this.allTasks[String(acc.taskId)]) taskDisplay = this.allTasks[String(acc.taskId)].title;

                const officialStr = acc.officialFee ? formatMultiCurrency(acc.officialFee.amount, acc.officialFee.currency) : '-';
                const serviceStr = acc.serviceFee ? formatMultiCurrency(acc.serviceFee.amount, acc.serviceFee.currency) : '-';

                // Kalan Tutar Görüntüleme Mantığı
                const rem = acc.remainingAmount !== undefined ? acc.remainingAmount : acc.totalAmount;
                let totalNumeric = 0;
                if (Array.isArray(acc.totalAmount)) totalNumeric = acc.totalAmount.reduce((s, i) => s + (parseFloat(i.amount)||0), 0);
                else totalNumeric = parseFloat(acc.totalAmount) || 0;

                let remNumeric = 0;
                if (Array.isArray(rem)) remNumeric = rem.reduce((s, i) => s + (parseFloat(i.amount)||0), 0);
                else remNumeric = parseFloat(rem) || 0;

                let remainingHtml = ''; 
                const isZero = remNumeric < 0.01;
                const isEqualTotal = Math.abs(totalNumeric - remNumeric) < 0.01;

                if (!isZero && !isEqualTotal) {
                    remainingHtml = `<span style="color: black; font-weight: bold;">${formatMultiCurrency(rem, acc.totalAmountCurrency)}</span>`;
                } else if (!isZero) {
                     remainingHtml = `<span>${formatMultiCurrency(rem, acc.totalAmountCurrency)}</span>`;
                } else {
                     remainingHtml = `<span class="text-success"><i class="fas fa-check"></i> Tamamlandı</span>`;
                }

                return `
                <tr>
                    <td><input type="checkbox" class="row-checkbox" data-id="${acc.id}" ${isSel ? 'checked' : ''}></td>
                    <td><small>${acc.id.substring(0, 8)}...</small></td>
                    <td><span class="status-badge ${sCls}">${sTxt}</span></td>
                    <td><a href="#" class="task-detail-link" data-task-id="${acc.taskId}">${taskDisplay}</a></td>
                    <td>${acc.tpInvoiceParty?.name || '-'}</td>
                    <td>${acc.serviceInvoiceParty?.name || '-'}</td>
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
            
            this.updateBulkActionsVisibility();
            this.updateSortIcons();
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

        // --- GÖRÜNTÜLEME MODALI ---
        async showViewAccrualDetailModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            const modal = document.getElementById('viewAccrualDetailModal') || document.getElementById('detailModal'); // İki farklı ID ihtimali için
            if (!modal) {
                // Eğer modal yoksa TaskDetailManager ile göster
                // (HTML yapısına göre ya özel modalınız vardır ya da generic)
                // Kodunuzda detailModal varsa generic bir yapı kurabiliriz:
                alert("Detay modalı HTML'de bulunamadı."); 
                return; 
            }
            
            // Eğer HTML'de 'detailContent' varsa oraya basıyoruz
            const contentDiv = document.getElementById('detailContent');
            if (contentDiv) {
                // Basit bir render (Generic)
                contentDiv.innerHTML = `
                    <p><strong>ID:</strong> ${accrual.id}</p>
                    <p><strong>İş:</strong> ${accrual.taskTitle}</p>
                    <p><strong>Tutar:</strong> ${JSON.stringify(accrual.totalAmount)}</p>
                    <p><strong>Durum:</strong> ${accrual.status}</p>
                `;
            }
            modal.classList.add('show');
        }

        // --- DÜZENLEME (EDIT) MODALI ---
        async showEditAccrualModal(accrualId) {
            const accrual = this.allAccruals.find(a => a.id === accrualId);
            if (!accrual) return;

            this.currentEditAccrual = { ...accrual };
            document.getElementById('editAccrualId').value = accrual.id;
            document.getElementById('editAccrualTaskTitleDisplay').value = accrual.taskTitle || '';
            
            if(this.editFormManager) {
                this.editFormManager.reset();
                this.editFormManager.setData(accrual);

                let epatsDoc = null;
                const taskId = accrual.taskId;
                let task = this.allTasks[String(taskId)];
                
                if (!task || (!task.details && !task.relatedTaskId)) {
                    try {
                        const taskSnap = await getDoc(doc(db, 'tasks', String(taskId)));
                        if (taskSnap.exists()) {
                            task = { id: taskSnap.id, ...taskSnap.data() };
                            this.allTasks[String(taskId)] = task;
                        }
                    } catch(e) { console.warn('Task fetch error:', e); }
                }

                if (task) {
                    if (task.details && task.details.epatsDocument) {
                        epatsDoc = task.details.epatsDocument;
                    } else if (task.relatedTaskId) {
                         const parent = this.allTasks[String(task.relatedTaskId)];
                         if (parent && parent.details) epatsDoc = parent.details.epatsDocument;
                    }
                }
                this.editFormManager.showEpatsDoc(epatsDoc);
            }
            document.getElementById('editAccrualModal').classList.add('show');
        }

        async handleSaveAccrualChanges() {
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Kaydediliyor...') : null;
            try {
                const result = this.editFormManager.getData();
                if (!result.success) {
                    if(loader) loader.hide(); showNotification(result.error, 'error'); return;
                }
                const formData = result.data;
                const accrualId = document.getElementById('editAccrualId').value;

                // Dosya Yükleme
                let newFiles = [];
                if (formData.files && formData.files.length > 0) {
                    try {
                        const file = formData.files[0];
                        const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                        const snapshot = await uploadBytes(storageRef, file);
                        const url = await getDownloadURL(snapshot.ref);
                        newFiles.push({ name: file.name, url, type: 'foreign_invoice', documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() });
                    } catch(err) { if(loader) loader.hide(); showNotification("Dosya yüklenemedi.", "error"); return; }
                }
                const finalFiles = [...(this.currentEditAccrual.files || []), ...newFiles];

                // Kalan Tutar Hesaplama (Orijinal Mantığınız Korundu)
                const vatMultiplier = 1 + (formData.vatRate / 100);
                const targetOff = formData.applyVatToOfficialFee ? formData.officialFee.amount * vatMultiplier : formData.officialFee.amount;
                const targetSrv = formData.serviceFee.amount * vatMultiplier;
                const paidOff = this.currentEditAccrual.paidOfficialAmount || 0;
                const paidSrv = this.currentEditAccrual.paidServiceAmount || 0;
                
                const remOff = Math.max(0, targetOff - paidOff);
                const remSrv = Math.max(0, targetSrv - paidSrv);

                const remMap = {};
                if (remOff > 0.01) {
                    const c = formData.officialFee.currency; remMap[c] = (remMap[c] || 0) + remOff;
                }
                if (remSrv > 0.01) {
                    const c = formData.serviceFee.currency; remMap[c] = (remMap[c] || 0) + remSrv;
                }
                const newRemainingAmount = Object.entries(remMap).map(([curr, amt]) => ({ amount: amt, currency: curr }));

                let newStatus = 'unpaid';
                if (newRemainingAmount.length === 0) newStatus = 'paid';
                else if (paidOff > 0 || paidSrv > 0) newStatus = 'partially_paid';

                const updates = {
                    ...formData,
                    totalAmount: formData.totalAmount, 
                    remainingAmount: newRemainingAmount,
                    status: newStatus,
                    files: finalFiles
                };

                await accrualService.updateAccrual(accrualId, updates);
                this.closeModal('editAccrualModal');
                await this.loadAllData();
                showNotification('Kaydedildi.', 'success');

            } catch(e) { console.error(e); showNotification('Hata: ' + e.message, 'error'); } 
            finally { if(loader) loader.hide(); }
        }

        // --- ÖDEME (MARK PAID) MODALI ---
        showMarkPaidModal() {
            if (this.selectedAccruals.size === 0) { showNotification('Seçim yapınız', 'error'); return; }
            
            const modal = document.getElementById('markPaidModal');
            document.getElementById('paidAccrualCount').textContent = this.selectedAccruals.size;
            document.getElementById('paymentDate').valueAsDate = new Date(); 

            const detailedArea = document.getElementById('detailedPaymentInputs');
            
            // TEKİL SEÇİM MANTIĞI
            if (this.selectedAccruals.size === 1) {
                detailedArea.style.display = 'block';
                const accrualId = this.selectedAccruals.values().next().value;
                const accrual = this.allAccruals.find(a => a.id === accrualId);
                
                const offAmount = accrual.officialFee?.amount || 0;
                const offCurr = accrual.officialFee?.currency || 'TRY';
                const offVatText = accrual.applyVatToOfficialFee ? ' (+KDV)' : '';
                
                document.getElementById('officialFeeBadge').textContent = `${offAmount} ${offCurr}${offVatText}`;
                document.getElementById('manualOfficialCurrencyLabel').textContent = offCurr;
                
                document.getElementById('payFullOfficial').checked = true;
                document.getElementById('officialAmountInputContainer').style.display = 'none';
                document.getElementById('manualOfficialAmount').value = accrual.paidOfficialAmount || 0; 

                const srvAmount = accrual.serviceFee?.amount || 0;
                const srvCurr = accrual.serviceFee?.currency || 'TRY';
                
                document.getElementById('serviceFeeBadge').textContent = `${srvAmount} ${srvCurr} (+KDV)`;
                document.getElementById('manualServiceCurrencyLabel').textContent = srvCurr;

                document.getElementById('payFullService').checked = true;
                document.getElementById('serviceAmountInputContainer').style.display = 'none';
                document.getElementById('manualServiceAmount').value = accrual.paidServiceAmount || 0;

                // Checkbox Eventleri
                document.getElementById('payFullOfficial').onchange = (e) => {
                    document.getElementById('officialAmountInputContainer').style.display = e.target.checked ? 'none' : 'block';
                };
                document.getElementById('payFullService').onchange = (e) => {
                    document.getElementById('serviceAmountInputContainer').style.display = e.target.checked ? 'none' : 'block';
                };

            } else {
                detailedArea.style.display = 'none';
            }

            modal.classList.add('show');
        }

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

                    if (this.selectedAccruals.size === 1) {
                        const payFullOff = document.getElementById('payFullOfficial').checked;
                        const payFullSrv = document.getElementById('payFullService').checked;
                        
                        const vatMultiplier = 1 + ((accrual.vatRate || 0) / 100);
                        const offTarget = accrual.applyVatToOfficialFee 
                            ? (accrual.officialFee?.amount || 0) * vatMultiplier 
                            : (accrual.officialFee?.amount || 0);

                        let newPaidOff = payFullOff ? offTarget : (parseFloat(document.getElementById('manualOfficialAmount').value) || 0);

                        const srvTarget = (accrual.serviceFee?.amount || 0) * vatMultiplier;
                        let newPaidSrv = payFullSrv ? srvTarget : (parseFloat(document.getElementById('manualServiceAmount').value) || 0);

                        updates.paidOfficialAmount = newPaidOff;
                        updates.paidServiceAmount = newPaidSrv;

                        const remOff = Math.max(0, offTarget - newPaidOff);
                        const remSrv = Math.max(0, srvTarget - newPaidSrv);
                        
                        const offCurr = accrual.officialFee?.currency || 'TRY';
                        const srvCurr = accrual.serviceFee?.currency || 'TRY';

                        const remMap = {};
                        if (remOff > 0.01) remMap[offCurr] = (remMap[offCurr] || 0) + remOff;
                        if (remSrv > 0.01) remMap[srvCurr] = (remMap[srvCurr] || 0) + remSrv;

                        const remainingArray = Object.entries(remMap).map(([c, a]) => ({ amount: a, currency: c }));
                        updates.remainingAmount = remainingArray;

                        if (remainingArray.length === 0) updates.status = 'paid';
                        else if (newPaidOff > 0 || newPaidSrv > 0) updates.status = 'partially_paid';
                        else updates.status = 'unpaid';

                    } else {
                        // ÇOKLU SEÇİM: Hepsini tam öde
                        updates.status = 'paid';
                        updates.remainingAmount = []; 
                        const vatMultiplier = 1 + ((accrual.vatRate || 0) / 100);
                        updates.paidOfficialAmount = accrual.applyVatToOfficialFee 
                            ? (accrual.officialFee?.amount || 0) * vatMultiplier 
                            : (accrual.officialFee?.amount || 0);
                        updates.paidServiceAmount = (accrual.serviceFee?.amount || 0) * vatMultiplier;
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

        // --- TOPLU İŞLEMLER ---
        async handleBulkUpdate(newStatus) {
            if (newStatus === 'paid') return; // paid durumu özel modal gerektirir
            if (this.selectedAccruals.size === 0) return;

            let loader = window.showSimpleLoading ? window.showSimpleLoading('Güncelleniyor...') : null;
            try {
                const promises = Array.from(this.selectedAccruals).map(async (id) => {
                    const acc = this.allAccruals.find(a => a.id === id);
                    if (!acc) return;

                    const updates = { 
                        status: newStatus,
                        paymentDate: null,
                        remainingAmount: acc.totalAmount, 
                        paidOfficialAmount: 0, 
                        paidServiceAmount: 0 
                    };
                    return accrualService.updateAccrual(id, updates);
                });

                await Promise.all(promises);
                showNotification('Güncellendi', 'success');
                this.selectedAccruals.clear();
                this.updateBulkActionsVisibility();
                await this.loadAllData();
            } catch(e) { 
                showNotification('Hata oluştu', 'error'); 
            } finally { if(loader) loader.hide(); }
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

        // --- SEÇİM MANTIĞI ---
        toggleSelectAll(checked) {
            document.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = checked; this.updateSelection(cb.dataset.id, checked); });
        }
        updateSelection(id, selected) {
            if(selected) this.selectedAccruals.add(id); else this.selectedAccruals.delete(id);
            this.updateBulkActionsVisibility();
        }
        updateBulkActionsVisibility() {
            const el = document.getElementById('bulkActions');
            if(el) el.style.display = this.selectedAccruals.size > 0 ? 'flex' : 'none';
        }

        // --- MODAL YÖNETİMİ ---
        closeModal(id) {
            document.getElementById(id).classList.remove('show');
            if(id === 'editAccrualModal') {
                this.currentEditAccrual = null;
                if(this.editFormManager) this.editFormManager.reset();
            }
            if(id === 'markPaidModal') {
                this.uploadedPaymentReceipts = [];
                const list = document.getElementById('paymentReceiptFileList');
                if(list) list.innerHTML = '';
            }
        }

        async showTaskDetailModal(taskId) {
            const modal = document.getElementById('taskDetailModal');
            if(modal) modal.classList.add('show');
            if(this.taskDetailManager) {
                this.taskDetailManager.showLoading();
                try {
                    const taskRef = doc(db, 'tasks', String(taskId));
                    const taskSnap = await getDoc(taskRef);
                    if(taskSnap.exists()) {
                        const task = {id:taskSnap.id, ...taskSnap.data()};
                        // Diğer verileri bul
                        const ipRecord = this.allAccruals.find(a => a.taskId === taskId) ? null : null; // Basit tutuldu, isterseniz detaylandırın
                        this.taskDetailManager.render(task, {ipRecord:null, transactionType:null}); 
                    }
                } catch(e) { console.error(e); }
            }
        }

        // --- EVENT LISTENERS (Hepsini Birleştiren Yer) ---
        setupEventListeners() {
            // YENİ: Arama Kutusu
            document.getElementById('searchInput')?.addEventListener('input', (e) => this.handleSearch(e.target.value));

            // Filtre
            document.getElementById('statusFilter')?.addEventListener('change', e => {
                this.currentFilterStatus = e.target.value;
                this.processData();
            });

            // Sıralama
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

            // Tablo Butonları
            document.getElementById('selectAllCheckbox')?.addEventListener('change', e => this.toggleSelectAll(e.target.checked));
            
            const tbody = document.getElementById('accrualsTableBody');
            tbody.addEventListener('change', e => { 
                if(e.target.classList.contains('row-checkbox')) this.updateSelection(e.target.dataset.id, e.target.checked); 
            });
            tbody.addEventListener('click', e => { 
                 const btn = e.target.closest('.action-btn');
                 if(btn) {
                     e.preventDefault(); 
                     const id = btn.dataset.id;
                     if(btn.classList.contains('view-btn')) this.showViewAccrualDetailModal(id);
                     if(btn.classList.contains('edit-btn')) this.showEditAccrualModal(id);
                     if(btn.classList.contains('delete-btn')) this.deleteAccrual(id);
                 } else if (e.target.classList.contains('task-detail-link')) {
                     e.preventDefault();
                     this.showTaskDetailModal(e.target.dataset.taskId);
                 }
            });

            // Buton Aksiyonları
            document.getElementById('bulkMarkPaidBtn')?.addEventListener('click', () => this.showMarkPaidModal());
            document.getElementById('bulkMarkUnpaidBtn')?.addEventListener('click', () => this.handleBulkUpdate('unpaid'));
            document.getElementById('saveAccrualChangesBtn')?.addEventListener('click', () => this.handleSaveAccrualChanges());
            
            const confirmBtn = document.getElementById('confirmMarkPaidBtn');
            if(confirmBtn) {
                // Event listener yığılmasını önlemek için klonlama (opsiyonel ama güvenli)
                const newBtn = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
                newBtn.addEventListener('click', () => this.handlePaymentSubmission());
            }

            // Dosya Yükleme Alanı
            const area = document.getElementById('paymentReceiptFileUploadArea');
            if(area) {
                area.addEventListener('click', () => document.getElementById('paymentReceiptFile').click());
                document.getElementById('paymentReceiptFile').addEventListener('change', e => this.handlePaymentReceiptUpload(e.target.files));
            }

            // Modal Kapatma
            document.querySelectorAll('.close-modal-btn, #cancelEditAccrualBtn, #cancelMarkPaidBtn').forEach(b => {
                b.addEventListener('click', e => {
                    const m = e.target.closest('.modal');
                    this.closeModal(m.id);
                });
            });
        }
    }

    new AccrualsManager().init();
});