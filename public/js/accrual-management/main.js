import { authService, accrualService, personService, taskService } from '../../firebase-config.js';
import { loadSharedLayout } from '../layout-loader.js';
import * as UI from './ui.js'; // UI işlemlerini ui.js dosyasından alıyoruz
import { AccrualFormManager } from '../components/AccrualFormManager.js'; // Form yönetimini buradan alıyoruz
import { showNotification } from '../../utils.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Ortak menü ve layout yüklemesi
    await loadSharedLayout({ activeMenuLink: 'accruals.html' });

    class AccrualManagement {
        constructor() {
            this.currentUser = null;
            
            // Veri Havuzları
            this.allAccruals = [];
            this.allPersons = [];
            this.allTasks = [];
            
            // Tablo Verileri (Arama ve Sıralama için)
            this.processedData = [];
            this.filteredData = [];
            
            // Varsayılan Sıralama: En yeni en üstte
            this.sortState = { key: 'createdAt', direction: 'desc' };

            // Yöneticiler
            this.createFormManager = null;
            this.selectedAccrualForPayment = null;
        }

        async init() {
            this.setupEventListeners();
            
            // Form Yöneticisini Başlat (Create Modal içindeki form için)
            // 'createAccrualFormContainer' -> HTML'deki ID
            // 'newAccrual' -> Input ID'leri için ön ek (prefix)
            this.createFormManager = new AccrualFormManager('createAccrualFormContainer', 'newAccrual');
            
            authService.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    this.currentUser = user;
                    await this.loadData();
                } else {
                    window.location.href = '/index.html';
                }
            });
        }

        async loadData() {
            UI.showLoading(true);
            try {
                // Tüm verileri paralel çek (Performans artışı)
                const [accrualsRes, personsRes, tasksRes] = await Promise.all([
                    accrualService.getAccruals(),
                    personService.getPersons(),
                    taskService.getAllTasks()
                ]);

                this.allAccruals = accrualsRes.success ? accrualsRes.data : [];
                this.allPersons = personsRes.success ? personsRes.data : [];
                this.allTasks = tasksRes.success ? tasksRes.data : [];

                // Form Manager'a güncel kişi listesini ver ve formu çiz
                this.createFormManager.allPersons = this.allPersons;
                this.createFormManager.render();

                // Verileri işle ve tabloyu hazırla
                this.processData();

            } catch (error) {
                console.error("Veri yükleme hatası:", error);
                showNotification("Veriler yüklenirken hata oluştu: " + error.message, "error");
            } finally {
                UI.showLoading(false);
            }
        }

        processData() {
            // Ham verileri tablo için zenginleştiriyoruz
            this.processedData = this.allAccruals.map(acc => {
                // İlişkili Görev Bilgisi
                const task = this.allTasks.find(t => t.id === acc.taskId);
                const taskTitle = acc.taskTitle || (task ? task.title : 'Bağımsız İşlem');
                
                // İlişkili Kişi Bilgileri
                const tpName = acc.tpInvoiceParty?.name || '-';
                const serviceName = acc.serviceInvoiceParty?.name || '-';
                
                // Statü Çevirisi
                const statusMap = {
                    'paid': 'Ödendi', 
                    'unpaid': 'Ödenmedi', 
                    'partial': 'Kısmi Ödeme', 
                    'cancelled': 'İptal'
                };
                const statusText = statusMap[acc.status] || acc.status;

                // Arama İçin Özel Metin (Tüm alanları birleştirip küçük harf yapıyoruz)
                const searchString = `${acc.id} ${taskTitle} ${tpName} ${serviceName} ${statusText} ${acc.totalAmount}`.toLocaleLowerCase('tr');

                return {
                    ...acc,
                    taskTitle,
                    tpInvoicePartyName: tpName,
                    serviceInvoicePartyName: serviceName,
                    statusText,
                    searchString
                };
            });

            // Veriler hazırlandıktan sonra mevcut arama kriterlerine göre filtrele
            this.handleSearch();
        }

        // --- ARAMA ve FİLTRELEME ---
        handleSearch() {
            // 1. Arama Kutusundaki Değeri Al
            const searchInput = document.getElementById('searchInput');
            const query = searchInput ? searchInput.value.toLocaleLowerCase('tr') : '';

            // 2. Durum Filtresindeki Değeri Al
            const statusFilter = document.getElementById('statusFilter');
            const statusValue = statusFilter ? statusFilter.value : 'all';

            // 3. Filtreleme Mantığı (VE operatörü)
            this.filteredData = this.processedData.filter(item => {
                const matchesSearch = !query || item.searchString.includes(query);
                const matchesStatus = (statusValue === 'all' || item.status === statusValue);
                return matchesSearch && matchesStatus;
            });

            // 4. Sırala ve Çiz
            this.sortData();
            
            // Eğer UI.js içinde renderAccrualsTable fonksiyonunuz varsa onu kullanıyoruz
            if (typeof UI.renderAccrualsTable === 'function') {
                UI.renderAccrualsTable(this.filteredData);
            } else {
                console.error("UI.renderAccrualsTable fonksiyonu bulunamadı!");
            }
        }

        // --- SIRALAMA ---
        handleSort(key) {
            if (this.sortState.key === key) {
                this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortState.key = key;
                this.sortState.direction = 'asc';
            }
            
            this.sortData();
            UI.renderAccrualsTable(this.filteredData);
            this.updateSortIcons();
        }

        sortData() {
            const { key, direction } = this.sortState;
            const multiplier = direction === 'asc' ? 1 : -1;

            this.filteredData.sort((a, b) => {
                let valA = a[key];
                let valB = b[key];

                if (valA == null) valA = '';
                if (valB == null) valB = '';

                // Tarih ise
                const dateA = new Date(valA);
                const dateB = new Date(valB);
                if (!isNaN(dateA) && !isNaN(dateB) && (key.includes('Date') || key === 'createdAt')) {
                     return (dateA - dateB) * multiplier;
                }

                // Sayı ise
                if (typeof valA === 'number' && typeof valB === 'number') {
                    return (valA - valB) * multiplier;
                }

                // Metin ise
                return String(valA).localeCompare(String(valB), 'tr') * multiplier;
            });
        }

        updateSortIcons() {
            document.querySelectorAll('#accrualsTableHeaderRow th[data-sort]').forEach(th => {
                const icon = th.querySelector('i');
                if(!icon) return;
                
                icon.className = 'fas fa-sort'; // Sıfırla
                icon.style.opacity = '0.3';
                
                if (th.dataset.sort === this.sortState.key) {
                    icon.className = this.sortState.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                    icon.style.opacity = '1';
                }
            });
        }

        // --- OLAY DİNLEYİCİLERİ ---
        setupEventListeners() {
            // Arama ve Filtre
            document.getElementById('searchInput')?.addEventListener('input', () => this.handleSearch());
            document.getElementById('statusFilter')?.addEventListener('change', () => this.handleSearch());

            // Sıralama Başlıkları
            document.querySelectorAll('#accrualsTableHeaderRow th[data-sort]').forEach(th => {
                th.addEventListener('click', () => this.handleSort(th.dataset.sort));
            });

            // Tablo Butonları (Delegation)
            const tbody = document.getElementById('accrualsTableBody');
            if(tbody) {
                tbody.addEventListener('click', (e) => {
                    const btn = e.target.closest('.action-btn');
                    if (!btn) return;
                    const id = btn.dataset.id;
                    
                    if (btn.classList.contains('view-btn')) {
                        const acc = this.allAccruals.find(a => a.id === id);
                        UI.showDetailModal(acc); // UI.js'deki fonksiyon
                    } else if (btn.classList.contains('pay-btn')) {
                        this.openPaymentModal(id);
                    } else if (btn.classList.contains('delete-btn')) {
                        this.handleDelete(id);
                    }
                });
            }

            // Yeni Tahakkuk Butonları
            document.getElementById('btnOpenCreateModal')?.addEventListener('click', () => {
                this.createFormManager.reset(); // Formu temizle
                UI.toggleModal('createAccrualModal', true);
            });

            document.getElementById('btnSaveAccrual')?.addEventListener('click', () => this.handleCreateAccrual());
            
            // Ortak Modal Kapatma Mantığı
            const closeModalBtns = [
                { btn: 'btnCancelCreate', modal: 'createAccrualModal' },
                { btn: 'closeCreateModal', modal: 'createAccrualModal' },
                { btn: 'btnCancelPayment', modal: 'paymentModal' },
                { btn: 'closePaymentModal', modal: 'paymentModal' },
                { btn: 'closeDetailModal', modal: 'detailModal' }
            ];

            closeModalBtns.forEach(item => {
                document.getElementById(item.btn)?.addEventListener('click', () => UI.toggleModal(item.modal, false));
            });

            // Ödeme Kaydet Butonu
            document.getElementById('btnSavePayment')?.addEventListener('click', () => this.handlePaymentSave());
        }

        // --- İŞLEMLER ---

        async handleCreateAccrual() {
            // Manager üzerinden verileri al ve doğrula
            const result = this.createFormManager.getData();
            if (!result.success) {
                showNotification(result.error, 'error');
                return;
            }
            
            // Manager'dan gelen veriyi servise gönder
            const newAccrual = {
                ...result.data, // officialFee, serviceFee, vatRate vb.
                status: 'unpaid',
                createdAt: new Date().toISOString()
            };

            try {
                const res = await accrualService.addAccrual(newAccrual);
                if (res.success) {
                    showNotification("Tahakkuk başarıyla oluşturuldu.", "success");
                    UI.toggleModal('createAccrualModal', false);
                    await this.loadData(); // Listeyi yenile
                } else {
                    showNotification("Hata: " + res.error, 'error');
                }
            } catch (e) { 
                showNotification("Beklenmeyen hata: " + e.message, 'error'); 
            }
        }

        openPaymentModal(id) {
            this.selectedAccrualForPayment = this.allAccruals.find(a => a.id === id);
            if (!this.selectedAccrualForPayment) return;
            
            // UI.js'deki formu doldurma fonksiyonunu çağır
            if (typeof UI.renderPaymentForm === 'function') {
                UI.renderPaymentForm(this.selectedAccrualForPayment);
                UI.toggleModal('paymentModal', true);
            } else {
                console.error("UI.renderPaymentForm fonksiyonu eksik.");
            }
        }

        async handlePaymentSave() {
            if (!this.selectedAccrualForPayment) return;

            // Verileri Formdan Al (UI.js veriyi DOM'a yazdı, buradan okuyoruz)
            const amountInput = document.getElementById('paymentAmount');
            const dateInput = document.getElementById('paymentDate');
            
            const amount = parseFloat(amountInput?.value);
            const date = dateInput?.value;
            
            if (!amount || amount <= 0 || !date) { 
                showNotification("Lütfen geçerli bir tutar ve tarih giriniz.", "error"); 
                return; 
            }
            
            // Ödeme verisini hazırla
            const paymentData = {
                accrualId: this.selectedAccrualForPayment.id,
                amount: amount,
                paymentDate: new Date(date).toISOString(),
                // Gerekirse not vb. eklenebilir
            };

            try {
                // Servis çağrısı (addPayment metodu accrualService'de tanımlı olmalı)
                // Eğer yoksa updateAccrual kullanılabilir
                const res = await accrualService.addPayment(paymentData); 
                
                if (res.success) {
                    showNotification("Ödeme başarıyla kaydedildi.", "success"); 
                    UI.toggleModal('paymentModal', false);
                    await this.loadData();
                } else {
                    showNotification("Ödeme kaydedilemedi: " + res.error, "error");
                }
            } catch(e) { 
                showNotification("Hata: " + e.message, 'error'); 
            }
        }

        async handleDelete(id) {
            if(confirm('Bu tahakkuku silmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) {
                try {
                    const res = await accrualService.deleteAccrual(id);
                    if (res.success) {
                        showNotification("Tahakkuk silindi.", "success");
                        await this.loadData();
                    } else {
                        showNotification("Silme hatası: " + res.error, "error");
                    }
                } catch(e) { 
                    showNotification("Hata: " + e.message, 'error'); 
                }
            }
        }
    }

    const app = new AccrualManagement();
    app.init();
});