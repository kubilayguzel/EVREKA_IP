// public/js/accrual-management/main.js

import { authService } from '../../firebase-config.js';
import { loadSharedLayout } from '../layout-loader.js';
import Pagination from '../pagination.js'; 
import { readFileAsDataURL, showNotification } from '../../utils.js';

// Yeni Modüller
import { AccrualDataManager } from './AccrualDataManager.js';
import { AccrualUIManager } from './AccrualUIManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'accruals.html' });

    class AccrualsController {
        constructor() {
            // Modülleri Başlat
            this.dataManager = new AccrualDataManager();
            this.uiManager = new AccrualUIManager();
            
            // Durum (State) Yönetimi
            this.state = {
                activeTab: 'main',       // 'main' | 'foreign'
                filterStatus: 'all',     // 'all' | 'paid' | 'unpaid' | ...
                searchQuery: '',
                sort: { column: 'createdAt', direction: 'desc' },
                selectedIds: new Set(),
                itemsPerPage: 10
            };

            this.pagination = null;
            this.uploadedPaymentReceipts = []; // Ödeme modalı için geçici dosya tutucu
        }

        async init() {
            const currentUser = authService.getCurrentUser(); // Kullanıcı kontrolü (Gerekirse)
            
            this.initPagination();
            this.setupEventListeners();

            // İlk Yükleme
            await this.loadData();
        }

        initPagination() {
            if (typeof Pagination === 'undefined') { console.error("Pagination kütüphanesi eksik."); return; }
            this.pagination = new Pagination({
                containerId: 'paginationControls', 
                itemsPerPage: this.state.itemsPerPage,
                itemsPerPageOptions: [10, 25, 50, 100],
                onPageChange: () => this.renderPage() // Sayfa değişiminde tabloyu güncelle
            });
        }

        async loadData() {
            this.uiManager.toggleLoading(true);
            try {
                await this.dataManager.fetchAllData();
                this.renderPage();
            } catch (error) {
                showNotification('Veriler yüklenirken hata oluştu.', 'error');
            } finally {
                this.uiManager.toggleLoading(false);
            }
        }

        /**
         * Verileri filtreler, sıralar ve sayfayı yeniden çizer.
         * (Merkezi Render Fonksiyonu)
         */
        renderPage() {
            // 1. Veriyi Filtrele ve Sırala (DataManager)
            const criteria = { 
                tab: this.state.activeTab, 
                status: this.state.filterStatus, 
                search: this.state.searchQuery 
            };
            const allFilteredData = this.dataManager.filterAndSort(criteria, this.state.sort);

            // 2. Pagination Güncelle
            if (this.pagination) this.pagination.update(allFilteredData.length);
            const pageData = this.pagination ? this.pagination.getCurrentPageData(allFilteredData) : allFilteredData;

            // 3. Referans Verilerini Hazırla (Lookup)
            const lookups = {
                tasks: this.dataManager.allTasks,
                transactionTypes: this.dataManager.allTransactionTypes,
                ipRecords: this.dataManager.allIpRecords,
                selectedIds: this.state.selectedIds
            };

            // 4. Tabloyu Çiz (UIManager)
            this.uiManager.renderTable(pageData, lookups, this.state.activeTab);
            this.uiManager.updateTaskDetailError(''); // Varsa önceki hataları temizle
        }

        /**
         * Olay Dinleyicileri (Event Listeners)
         */
        setupEventListeners() {
            // --- FİLTRELER ---
            
            // 1. Arama Kutusu
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.state.searchQuery = e.target.value;
                    this.renderPage();
                });
            }

            // 2. Durum Filtresi
            const statusFilter = document.getElementById('statusFilter');
            if (statusFilter) {
                statusFilter.addEventListener('change', (e) => {
                    this.state.filterStatus = e.target.value;
                    this.renderPage();
                });
            }

            // 3. Sekme Değişimi (Tab)
            $('a[data-toggle="tab"]').on('shown.bs.tab', (e) => {
                const target = $(e.target).attr("href"); // #content-main veya #content-foreign
                this.state.activeTab = target === '#content-foreign' ? 'foreign' : 'main';
                this.renderPage();
            });

            // 4. Sıralama (Sort)
            document.querySelectorAll('th[data-sort]').forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    const column = th.dataset.sort;
                    // Yönü tersine çevir veya yeni kolona geç
                    if (this.state.sort.column === column) {
                        this.state.sort.direction = this.state.sort.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        this.state.sort = { column: column, direction: 'asc' };
                    }
                    
                    // İkonları güncelle (Basitçe UI Manager helper'ı veya manuel)
                    document.querySelectorAll('.sort-icon').forEach(i => i.className = 'fas fa-sort sort-icon text-muted');
                    const icon = th.querySelector('i');
                    if(icon) icon.className = `fas fa-sort-${this.state.sort.direction === 'asc' ? 'up' : 'down'} sort-icon`;

                    this.renderPage();
                });
            });

            // --- SEÇİM İŞLEMLERİ ---

            // 5.1 Tümünü Seç
            const selectAllCb = document.getElementById('selectAllCheckbox');
            if (selectAllCb) {
                selectAllCb.addEventListener('change', (e) => {
                    const checked = e.target.checked;
                    document.querySelectorAll('.row-checkbox').forEach(cb => {
                        cb.checked = checked;
                        const id = cb.dataset.id;
                        if(checked) this.state.selectedIds.add(id); else this.state.selectedIds.delete(id);
                    });
                    this.uiManager.updateBulkActionsVisibility(this.state.selectedIds.size > 0);
                });
            }

            // 5.2 Tümünü Seç (Yurt Dışı Tablosu İçin - YENİ)
            const selectAllCbForeign = document.getElementById('selectAllCheckboxForeign');
            if (selectAllCbForeign) {
                selectAllCbForeign.addEventListener('change', (e) => {
                    const checked = e.target.checked;
                    // Sadece o an görünür olan tablodaki checkboxları seçmek daha güvenlidir ama 
                    // basitlik adına tüm row-checkbox'ları tetikleyebiliriz çünkü ID'ler benzersizdir.
                    document.querySelectorAll('.row-checkbox').forEach(cb => {
                        cb.checked = checked;
                        const id = cb.dataset.id;
                        if(checked) this.state.selectedIds.add(id); else this.state.selectedIds.delete(id);
                    });
                    this.uiManager.updateBulkActionsVisibility(this.state.selectedIds.size > 0);
                });
            }

            // 6. Tekil Seçim (Tablo içi tıklama - Delegation)
            const tbody = document.getElementById('accrualsTableBody'); // ve foreignTableBody gerekirse
            [document.getElementById('accrualsTableBody'), document.getElementById('foreignTableBody')].forEach(body => {
                if(!body) return;
                body.addEventListener('change', (e) => {
                    if (e.target.classList.contains('row-checkbox')) {
                        const id = e.target.dataset.id;
                        if(e.target.checked) this.state.selectedIds.add(id); else this.state.selectedIds.delete(id);
                        this.uiManager.updateBulkActionsVisibility(this.state.selectedIds.size > 0);
                    }
                });
            });

            // --- ÖDEME MODALI ETKİLEŞİMLERİ (EKSİK OLAN KISIM) ---
            const payFullOfficial = document.getElementById('payFullOfficial');
            const officialInputContainer = document.getElementById('officialAmountInputContainer');
            if (payFullOfficial && officialInputContainer) {
                payFullOfficial.addEventListener('change', (e) => {
                    officialInputContainer.style.display = e.target.checked ? 'none' : 'block';
                });
            }

            const payFullService = document.getElementById('payFullService');
            const serviceInputContainer = document.getElementById('serviceAmountInputContainer');
            if (payFullService && serviceInputContainer) {
                payFullService.addEventListener('change', (e) => {
                    serviceInputContainer.style.display = e.target.checked ? 'none' : 'block';
                });
            }

            // YURT DIŞI "TAMAMINI ÖDE" CHECKBOX DİNLEYİCİSİ
            const payFullForeign = document.getElementById('payFullForeign');
            const foreignSplitInputs = document.getElementById('foreignSplitInputs');
            
            if (payFullForeign && foreignSplitInputs) {
                payFullForeign.addEventListener('change', (e) => {
                    // DEĞİŞİKLİK: 'flex' yerine 'block' yapıyoruz ki kartlar alt alta gelsin
                    foreignSplitInputs.style.display = e.target.checked ? 'none' : 'block'; 
                });
            }

            // --- AKSİYON BUTONLARI (Tablo İçi) ---
            const handleActionClick = async (e) => {
                const btn = e.target.closest('.action-btn');
                const link = e.target.closest('.task-detail-link');

                if (link) {
                    e.preventDefault();
                    this.uiManager.showTaskDetailLoading();
                    const taskId = link.dataset.taskId;
                    // Task verisini Manager'dan veya DB'den taze çekmeye gerek yok, cache yeterli olabilir ama detaylı gösterim için servisi kullanıyoruz
                    // TaskDetailManager kendi içinde DB çağrısı yapıyor, biz sadece ID veriyoruz
                    this.uiManager.taskDetailManager.showLoading();
                    // TaskDetailManager'a veriyi controller üzerinden de sağlayabiliriz ama mevcut yapıda ID verip o çekiyor. 
                    // Ancak UIManager'daki entegrasyonu kullanmak daha temiz:
                    // Not: AccrualUIManager içinde showTaskDetail fonksiyonunu tetiklemiştik. 
                    // Burada asıl işi yapan `uiManager.showTaskDetailModal` değil, `uiManager.taskDetailManager`'ı kullanmak.
                    // Mevcut yapıda AccrualUIManager içinde `showTaskDetailLoading` var.
                    // Biz en temiz yöntemi kullanalım:
                    this.openTaskDetail(taskId);
                }

                if (!btn) return;
                e.preventDefault();
                const id = btn.dataset.id;

                if (btn.classList.contains('view-btn')) {
                    const acc = this.dataManager.allAccruals.find(a => a.id === id);
                    this.uiManager.showViewDetailModal(acc);
                }
                
                else if (btn.classList.contains('edit-btn')) {
                    this.uiManager.toggleLoading(true);
                    // 1. Accrual verisini al
                    const acc = this.dataManager.allAccruals.find(a => a.id === id);
                    // 2. Task detayını TAZELE (EPATS belgesi için kritik)
                    const task = await this.dataManager.getFreshTaskDetail(acc.taskId);
                    // 3. Modalı aç
                    let epatsDoc = null;
                    if(task && task.details?.epatsDocument) epatsDoc = task.details.epatsDocument;
                    
                    this.uiManager.initEditModal(acc, this.dataManager.allPersons, epatsDoc);
                    this.uiManager.toggleLoading(false);
                }
                
                else if (btn.classList.contains('delete-btn')) {
                    if (confirm('Bu tahakkuku silmek istediğinize emin misiniz?')) {
                        this.uiManager.toggleLoading(true);
                        await this.dataManager.deleteAccrual(id);
                        this.renderPage();
                        this.uiManager.toggleLoading(false);
                        showNotification('Silindi', 'success');
                    }
                }
            };

            if(this.uiManager.tableBody) this.uiManager.tableBody.addEventListener('click', handleActionClick);
            if(this.uiManager.foreignTableBody) this.uiManager.foreignTableBody.addEventListener('click', handleActionClick);

            // --- TOPLU İŞLEMLER ---
            document.getElementById('bulkMarkPaidBtn').addEventListener('click', () => {
                const selected = Array.from(this.state.selectedIds).map(id => this.dataManager.allAccruals.find(a => a.id === id)).filter(Boolean);
                this.uploadedPaymentReceipts = []; // Reset
                this.uiManager.showPaymentModal(selected);
            });

            const unpaidBtn = document.getElementById('bulkMarkUnpaidBtn');
            if(unpaidBtn) {
                unpaidBtn.addEventListener('click', async () => {
                    if(confirm('Seçilenleri "Ödenmedi" durumuna getirmek istiyor musunuz? Tüm ödeme geçmişi silinecektir.')) {
                        this.uiManager.toggleLoading(true);
                        await this.dataManager.batchUpdateStatus(this.state.selectedIds, 'unpaid');
                        this.state.selectedIds.clear();
                        this.renderPage();
                        this.uiManager.toggleLoading(false);
                        showNotification('Güncellendi', 'success');
                    }
                });
            }

            // --- MODAL BUTONLARI (KAYDETME) ---
            
            // 1. Düzenleme Kaydet
            document.getElementById('saveAccrualChangesBtn').addEventListener('click', async () => {
                const formResult = this.uiManager.getEditFormData();
                if (!formResult.success) { showNotification(formResult.error, 'error'); return; }

                this.uiManager.toggleLoading(true);
                try {
                    const id = document.getElementById('editAccrualId').value;
                    // Dosya yükleme UI manager'da handled edilmedi, form verisinde file objesi geliyor
                    const file = (formResult.data.files && formResult.data.files.length > 0) ? formResult.data.files[0] : null;
                    
                    await this.dataManager.updateAccrual(id, formResult.data, file);
                    this.uiManager.closeModal('editAccrualModal');
                    this.renderPage();
                    showNotification('Başarıyla güncellendi', 'success');
                } catch (e) {
                    showNotification('Hata: ' + e.message, 'error');
                } finally {
                    this.uiManager.toggleLoading(false);
                }
            });

            // 2. Ödeme Onayla
            document.getElementById('confirmMarkPaidBtn').addEventListener('click', async () => {
                const date = document.getElementById('paymentDate').value;
                if(!date) { showNotification('Tarih seçiniz', 'error'); return; }

                let singlePaymentDetails = null;

                // Tekil seçim varsa detayları al
                if (this.state.selectedIds.size === 1) {
                    if (this.state.activeTab === 'foreign') {
                        // --- YURT DIŞI MODU ---
                        const isFull = document.getElementById('payFullForeign').checked;
                        
                        singlePaymentDetails = {
                            isForeignMode: true,
                            payFullOfficial: isFull, // Tikliyse "Tamamını Öde" (Resmi + Hizmet)
                            payFullService: isFull,
                            // Tiksizse input değerlerini al
                            manualOfficial: document.getElementById('manualForeignOfficial').value,
                            manualService: document.getElementById('manualForeignService').value
                        };
                    } else {
                        // --- YEREL MOD ---
                        singlePaymentDetails = {
                            isForeignMode: false,
                            payFullOfficial: document.getElementById('payFullOfficial').checked,
                            payFullService: document.getElementById('payFullService').checked,
                            manualOfficial: document.getElementById('manualOfficialAmount').value,
                            manualService: document.getElementById('manualServiceAmount').value
                        };
                    }
                }

                const paymentData = {
                    date: date,
                    receiptFiles: this.uploadedPaymentReceipts,
                    singlePaymentDetails: singlePaymentDetails
                };

                this.uiManager.toggleLoading(true);
                try {
                    await this.dataManager.savePayment(this.state.selectedIds, paymentData);
                    this.uiManager.closeModal('markPaidModal');
                    this.state.selectedIds.clear();
                    this.renderPage();
                    showNotification('Ödeme işlendi', 'success');
                } catch(e) {
                    console.error(e);
                    showNotification('Hata: ' + e.message, 'error');
                } finally {
                    this.uiManager.toggleLoading(false);
                }
            });

            // "bulkMarkPaidBtn" butonuna tıklanınca activeTab'i göndermeyi unutmayın:
            document.getElementById('bulkMarkPaidBtn').addEventListener('click', () => {
                const selected = Array.from(this.state.selectedIds).map(id => this.dataManager.allAccruals.find(a => a.id === id)).filter(Boolean);
                this.uploadedPaymentReceipts = []; 
                // BURASI ÖNEMLİ: activeTab parametresi eklendi
                this.uiManager.showPaymentModal(selected, this.state.activeTab); 
            });

            // 3. Modal Kapatma Butonları
            document.querySelectorAll('.close-modal-btn, #cancelEditAccrualBtn, #cancelMarkPaidBtn').forEach(b => {
                b.addEventListener('click', e => {
                    const m = e.target.closest('.modal');
                    this.uiManager.closeModal(m.id);
                });
            });

            // 4. Ödeme Dekont Yükleme (Helper)
            const area = document.getElementById('paymentReceiptFileUploadArea');
            if(area) {
                area.addEventListener('click', () => document.getElementById('paymentReceiptFile').click());
                document.getElementById('paymentReceiptFile').addEventListener('change', e => {
                    Array.from(e.target.files).forEach(file => {
                        readFileAsDataURL(file).then(url => {
                            this.uploadedPaymentReceipts.push({
                                id: Date.now().toString(), // Basit ID
                                name: file.name,
                                type: file.type,
                                content: url,
                                documentDesignation: 'Ödeme Dekontu'
                            });
                            // UI Listesini Güncelle (Basitçe manuel yapıyoruz burda)
                            const list = document.getElementById('paymentReceiptFileList');
                            list.innerHTML = this.uploadedPaymentReceipts.map(f => `
                                <div class="file-item-modal"><span>${f.name}</span> <small class="text-success">(Hazır)</small></div>
                            `).join('');
                        });
                    });
                });
            }
        }

        /**
         * Task Detayını Açar (Helper)
         */
        async openTaskDetail(taskId) {
            // TaskDetailManager zaten UI Manager içinde initialize edildi.
            // Sadece modalı açıp veriyi çekeceğiz.
            const modal = document.getElementById('taskDetailModal');
            modal.classList.add('show');
            document.getElementById('modalTaskTitle').textContent = 'Yükleniyor...';
            this.uiManager.taskDetailManager.showLoading();

            try {
                // Taze veri çek
                const task = await this.dataManager.getFreshTaskDetail(taskId);
                if(!task) throw new Error("İş bulunamadı");
                
                // İlişkili diğer verileri bul
                const ipRecord = task.relatedIpRecordId ? this.dataManager.allIpRecords.find(r => r.id === task.relatedIpRecordId) : null;
                const transactionType = this.dataManager.allTransactionTypes.find(t => t.id === task.taskType);
                const assignedUser = this.dataManager.allUsers.find(u => u.id === task.assignedTo_uid);
                const relatedAccruals = this.dataManager.allAccruals.filter(acc => String(acc.taskId) === String(task.id));

                this.uiManager.taskDetailManager.render(task, {
                    ipRecord, transactionType, assignedUser, accruals: relatedAccruals
                });
            } catch(e) {
                this.uiManager.taskDetailManager.showError('İş detayı yüklenemedi.');
            }
        }
    }

    // Uygulamayı Başlat
    new AccrualsController().init();
});