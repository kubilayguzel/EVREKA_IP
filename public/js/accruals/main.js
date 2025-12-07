// public/js/accruals/main.js

import { authService, accrualService } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';

class AccrualsModule {
    constructor() {
        this.allAccruals = [];
        // Ödeme işlemi için geçici ID
        this.accrualIdToPay = null;
        
        // Modal Referansları (Bootstrap jQuery bağımlılığı olduğu için jQuery kullanıyoruz)
        this.addModal = $('#addAccrualModal');
        this.viewModal = $('#viewAccrualModal');
        this.paymentModal = $('#paymentModal');
    }

    async init() {
        // Ortak layout yükle
        await loadSharedLayout({ activeMenuLink: 'accruals.html' });

        authService.auth.onAuthStateChanged(async (user) => {
            if (user) {
                await this.loadAccruals();
                this.setupEventListeners();
            } else {
                window.location.href = 'index.html';
            }
        });
    }

    async loadAccruals() {
        const tableBody = document.getElementById('accrualsTableBody');
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center"><div class="spinner-border text-primary" role="status"></div><p class="mt-2">Yükleniyor...</p></td></tr>';

        try {
            const result = await accrualService.getAccruals();
            if (result.success) {
                // Tarihe göre sırala (Yeniden eskiye)
                this.allAccruals = result.data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                this.renderAccruals(this.allAccruals);
            } else {
                tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Hata: ${result.error}</td></tr>`;
            }
        } catch (error) {
            console.error(error);
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Beklenmeyen bir hata oluştu.</td></tr>';
        }
    }

    setupEventListeners() {
        // Kaydet Butonu
        document.getElementById('saveAccrualBtn').addEventListener('click', () => this.saveAccrual());
        
        // Ödeme Kaydet Butonu
        document.getElementById('savePaymentBtn').addEventListener('click', () => this.savePayment());

        // Arama Input
        document.getElementById('searchInput').addEventListener('input', (e) => this.filterAccruals(e.target.value));

        // Dinamik Hesaplama (Yeni Ekle Modalı İçin)
        ['officialFeeAmount', 'serviceFeeAmount', 'vatRate', 'applyVatToOfficialFee'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.addEventListener('input', () => this.calculateTotal());
        });
    }

    renderAccruals(accruals) {
        const tableBody = document.getElementById('accrualsTableBody');
        tableBody.innerHTML = '';

        if (accruals.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Kayıt bulunamadı.</td></tr>';
            return;
        }

        accruals.forEach(acc => {
            const tr = document.createElement('tr');
            
            // Durum Badge
            let statusBadge = '';
            let statusText = '';
            if (acc.status === 'paid') { statusBadge = 'status-paid'; statusText = 'Ödendi'; }
            else if (acc.status === 'partially_paid') { statusBadge = 'status-partially_paid'; statusText = 'Kısmen Ödendi'; }
            else { statusBadge = 'status-unpaid'; statusText = 'Ödenmedi'; }

            // Para Formatı
            const totalFormatted = this.formatCurrency(acc.totalAmount, acc.totalAmountCurrency || 'TRY');
            const remainingFormatted = this.formatCurrency(acc.remainingAmount !== undefined ? acc.remainingAmount : acc.totalAmount, acc.totalAmountCurrency || 'TRY');

            tr.innerHTML = `
                <td><span class="font-weight-bold">#${acc.id.substring(0, 6)}</span></td>
                <td>${acc.taskTitle || '-'}</td>
                <td>${acc.tpInvoiceParty?.name || '-'}</td>
                <td>${acc.serviceInvoiceParty?.name || '-'}</td>
                <td><span class="amount-text">${totalFormatted}</span></td>
                <td><span class="amount-text ${acc.status === 'paid' ? 'text-success' : 'text-danger'}">${remainingFormatted}</span></td>
                <td><span class="badge-status ${statusBadge}">${statusText}</span></td>
                <td>
                    <button class="action-btn btn-view" title="Detay" onclick="window.accrualsModule.viewAccrual('${acc.id}')"><i class="fas fa-eye"></i></button>
                    ${acc.status !== 'paid' ? `<button class="action-btn btn-pay" title="Ödeme Al" onclick="window.accrualsModule.openPaymentModal('${acc.id}')"><i class="fas fa-money-bill-wave"></i></button>` : ''}
                    <button class="action-btn btn-delete" title="Sil" onclick="window.accrualsModule.deleteAccrual('${acc.id}')"><i class="fas fa-trash"></i></button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // --- Modal ve Form İşlemleri ---

    calculateTotal() {
        const off = parseFloat(document.getElementById('officialFeeAmount').value) || 0;
        const srv = parseFloat(document.getElementById('serviceFeeAmount').value) || 0;
        const vat = parseFloat(document.getElementById('vatRate').value) || 0;
        const applyVat = document.getElementById('applyVatToOfficialFee').checked;

        let total = applyVat ? (off + srv) * (1 + vat/100) : off + (srv * (1 + vat/100));
        document.getElementById('totalAmountDisplay').textContent = this.formatCurrency(total, 'TRY');
    }

    async saveAccrual() {
        const offAmount = parseFloat(document.getElementById('officialFeeAmount').value) || 0;
        const srvAmount = parseFloat(document.getElementById('serviceFeeAmount').value) || 0;

        if (offAmount <= 0 && srvAmount <= 0) {
            showNotification('Lütfen en az bir ücret girin.', 'warning');
            return;
        }

        const btn = document.getElementById('saveAccrualBtn');
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Kaydediliyor...';

        try {
            const data = {
                taskTitle: document.getElementById('taskTitleInput').value || 'Manuel Tahakkuk',
                officialFee: { amount: offAmount, currency: document.getElementById('officialFeeCurrency').value },
                serviceFee: { amount: srvAmount, currency: document.getElementById('serviceFeeCurrency').value },
                vatRate: parseFloat(document.getElementById('vatRate').value) || 0,
                applyVatToOfficialFee: document.getElementById('applyVatToOfficialFee').checked,
                totalAmount: parseFloat(document.getElementById('totalAmountDisplay').textContent.replace(/[^0-9.,]/g, '').replace(',','.')) || 0,
                totalAmountCurrency: 'TRY',
                status: 'unpaid',
                remainingAmount: parseFloat(document.getElementById('totalAmountDisplay').textContent.replace(/[^0-9.,]/g, '').replace(',','.')) || 0,
                createdAt: new Date().toISOString(),
                // Manuel eklemede taraf bilgileri şimdilik boş veya inputlardan alınabilir
                // Orijinal kodda inputlar yoktu, burayı taskTitle gibi basit tutuyoruz
            };

            const result = await accrualService.addAccrual(data);
            if (result.success) {
                showNotification('Tahakkuk başarıyla oluşturuldu.', 'success');
                $('#addAccrualModal').modal('hide');
                document.getElementById('addAccrualForm').reset();
                document.getElementById('totalAmountDisplay').textContent = '0.00 TRY';
                this.loadAccruals();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            showNotification('Hata: ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    async deleteAccrual(id) {
        if (confirm('Bu tahakkuku silmek istediğinizden emin misiniz?')) {
            const result = await accrualService.deleteAccrual(id);
            if (result.success) {
                showNotification('Silindi.', 'success');
                this.loadAccruals();
            } else {
                showNotification('Silinemedi.', 'error');
            }
        }
    }

    // Detay Görüntüleme (Orijinal yapıya uygun)
    viewAccrual(id) {
        const acc = this.allAccruals.find(a => a.id === id);
        if (!acc) return;

        // Alanları Doldur
        document.getElementById('viewAccrualTaskTitle').textContent = acc.taskTitle || '-';
        document.getElementById('viewAccrualOfficialFee').textContent = this.formatCurrency(acc.officialFee?.amount, acc.officialFee?.currency);
        document.getElementById('viewAccrualServiceFee').textContent = this.formatCurrency(acc.serviceFee?.amount, acc.serviceFee?.currency);
        document.getElementById('viewAccrualVatRate').textContent = '%' + (acc.vatRate || 0);
        document.getElementById('viewAccrualTotalAmount').textContent = this.formatCurrency(acc.totalAmount, acc.totalAmountCurrency);
        document.getElementById('viewAccrualRemainingAmount').textContent = this.formatCurrency(acc.remainingAmount, acc.totalAmountCurrency);
        
        const statusBadge = document.getElementById('viewAccrualStatus');
        statusBadge.className = 'badge-status ' + (acc.status === 'paid' ? 'status-paid' : (acc.status === 'partially_paid' ? 'status-partially_paid' : 'status-unpaid'));
        statusBadge.textContent = acc.status === 'paid' ? 'Ödendi' : (acc.status === 'partially_paid' ? 'Kısmen Ödendi' : 'Ödenmedi');

        document.getElementById('viewAccrualTpInvoiceParty').textContent = acc.tpInvoiceParty?.name || '-';
        document.getElementById('viewAccrualServiceInvoiceParty').textContent = acc.serviceInvoiceParty?.name || '-';
        document.getElementById('viewAccrualCreatedAt').textContent = acc.createdAt ? new Date(acc.createdAt).toLocaleString('tr-TR') : '-';
        document.getElementById('viewAccrualPaymentDate').textContent = acc.paymentDate ? new Date(acc.paymentDate).toLocaleDateString('tr-TR') : '-';

        // Belgeleri Listele
        const documentListUl = document.getElementById('viewAccrualDocumentList');
        documentListUl.innerHTML = '';
        if (acc.files && acc.files.length > 0) {
            acc.files.forEach(file => {
                const listItem = document.createElement('li');
                listItem.innerHTML = `<a href="${file.url || file.downloadURL || file.content}" target="_blank">📄 ${file.name} (${this.formatFileSize(file.size)})</a>`;
                documentListUl.appendChild(listItem);
            });
        } else {
            documentListUl.innerHTML = '<li style="text-align: center; color: #666; padding: 10px;">Henüz belge yok.</li>';
        }

        $('#viewAccrualModal').modal('show');
    }

    openPaymentModal(id) {
        this.accrualIdToPay = id;
        const acc = this.allAccruals.find(a => a.id === id);
        if (!acc) return;

        document.getElementById('paymentAmount').value = acc.remainingAmount || 0;
        document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
        $('#paymentModal').modal('show');
    }

    async savePayment() {
        const amount = parseFloat(document.getElementById('paymentAmount').value);
        if (!amount || amount <= 0) {
            showNotification('Geçerli bir tutar girin.', 'warning');
            return;
        }

        const result = await accrualService.addPayment(this.accrualIdToPay, {
            amount: amount,
            date: document.getElementById('paymentDate').value,
            notes: document.getElementById('paymentNotes').value
        });

        if (result.success) {
            showNotification('Ödeme alındı.', 'success');
            $('#paymentModal').modal('hide');
            this.loadAccruals();
        } else {
            showNotification('Hata: ' + result.error, 'error');
        }
    }

    // --- Yardımcılar ---

    filterAccruals(searchTerm) {
        const term = searchTerm.toLowerCase();
        const filtered = this.allAccruals.filter(acc => {
            const matchesSearch = (acc.taskTitle || '').toLowerCase().includes(term) ||
                                  (acc.id || '').toLowerCase().includes(term) ||
                                  (acc.tpInvoiceParty?.name || '').toLowerCase().includes(term) ||
                                  (acc.serviceInvoiceParty?.name || '').toLowerCase().includes(term);
            return matchesSearch;
        });
        this.renderAccruals(filtered);
    }

    formatCurrency(amount, currency = 'TRY') {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency }).format(amount || 0);
    }

    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// Global Erişim ve Başlatma
window.accrualsModule = new AccrualsModule();
document.addEventListener('DOMContentLoaded', () => window.accrualsModule.init());