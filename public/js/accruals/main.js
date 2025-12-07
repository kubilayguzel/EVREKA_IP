// public/js/accruals/main.js

import { authService, accrualService, taskService, personService } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';

class AccrualsModule {
    constructor() {
        this.allAccruals = [];
        this.uploadedFiles = [];
        this.accrualIdToPay = null;
        
        // Modal Referansları
        this.addModal = document.getElementById('addAccrualModal');
        this.viewModal = document.getElementById('viewAccrualModal');
        this.paymentModal = document.getElementById('paymentModal');
    }

    async init() {
        // Ortak layout yükle
        await loadSharedLayout({ activeMenuLink: 'accruals.html' });

        authService.auth.onAuthStateChanged(async (user) => {
            if (user) {
                await this.loadAccruals();
                this.setupEventListeners();
                this.setupFileUpload();
            } else {
                window.location.href = 'index.html';
            }
        });
    }

    async loadAccruals() {
        const tableBody = document.getElementById('accrualsTableBody');
        tableBody.innerHTML = '<tr><td colspan="7"><div class="loading-spinner"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Yükleniyor...</div></td></tr>';

        try {
            const result = await accrualService.getAccruals();
            if (result.success) {
                this.allAccruals = result.data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                this.renderAccruals(this.allAccruals);
                this.updateSummaryCards();
            } else {
                tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Hata: ${result.error}</td></tr>`;
            }
        } catch (error) {
            console.error(error);
            tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Beklenmeyen bir hata oluştu.</td></tr>';
        }
    }

    setupEventListeners() {
        // Modal Açma/Kapama
        document.getElementById('btnAddAccrual').addEventListener('click', () => this.openAddModal());
        
        document.querySelectorAll('.close-modal, .btn-close-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) modal.classList.remove('show');
            });
        });

        // Form Submit
        document.getElementById('saveAccrualBtn').addEventListener('click', () => this.saveAccrual());
        document.getElementById('savePaymentBtn').addEventListener('click', () => this.savePayment());

        // Arama ve Filtreleme
        document.getElementById('searchInput').addEventListener('input', (e) => this.filterAccruals(e.target.value));
        document.getElementById('statusFilter').addEventListener('change', () => this.filterAccruals(document.getElementById('searchInput').value));

        // Dinamik Hesaplama
        ['officialFeeAmount', 'serviceFeeAmount', 'vatRate', 'applyVatToOfficialFee'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.addEventListener('input', () => this.calculateTotal());
        });
    }

    renderAccruals(accruals) {
        const tableBody = document.getElementById('accrualsTableBody');
        tableBody.innerHTML = '';

        if (accruals.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7"><div class="no-records">Kayıt bulunamadı.</div></td></tr>';
            return;
        }

        accruals.forEach(acc => {
            const tr = document.createElement('tr');
            
            // Durum Badge
            let statusBadge = '';
            let statusText = '';
            if (acc.status === 'paid') { statusBadge = 'status-paid'; statusText = 'Ödendi'; }
            else if (acc.status === 'partially_paid') { statusBadge = 'status-partially_paid'; statusText = 'Kısmen'; }
            else { statusBadge = 'status-unpaid'; statusText = 'Ödenmedi'; }

            // Para Formatı
            const totalFormatted = this.formatCurrency(acc.totalAmount, acc.totalAmountCurrency || 'TRY');
            const remainingFormatted = this.formatCurrency(acc.remainingAmount !== undefined ? acc.remainingAmount : acc.totalAmount, acc.totalAmountCurrency || 'TRY');

            tr.innerHTML = `
                <td><span class="font-weight-bold">#${acc.id.substring(0, 6)}</span></td>
                <td>${acc.taskTitle || '-'}</td>
                <td>${acc.tpInvoiceParty?.name || '-'} / ${acc.serviceInvoiceParty?.name || '-'}</td>
                <td><span class="amount">${totalFormatted}</span></td>
                <td><span class="amount ${acc.status === 'paid' ? 'positive' : 'negative'}">${remainingFormatted}</span></td>
                <td><span class="status-badge ${statusBadge}"><span class="status-dot"></span>${statusText}</span></td>
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

    openAddModal() {
        document.getElementById('addAccrualForm').reset();
        this.uploadedFiles = [];
        this.updateFileList();
        this.addModal.classList.add('show');
    }

    calculateTotal() {
        const off = parseFloat(document.getElementById('officialFeeAmount').value) || 0;
        const srv = parseFloat(document.getElementById('serviceFeeAmount').value) || 0;
        const vat = parseFloat(document.getElementById('vatRate').value) || 0;
        const applyVat = document.getElementById('applyVatToOfficialFee').checked;

        let total = applyVat ? (off + srv) * (1 + vat/100) : off + (srv * (1 + vat/100));
        document.getElementById('totalAmountDisplay').textContent = this.formatCurrency(total, 'TRY');
    }

    async saveAccrual() {
        // Basit validasyon
        const offAmount = parseFloat(document.getElementById('officialFeeAmount').value) || 0;
        const srvAmount = parseFloat(document.getElementById('serviceFeeAmount').value) || 0;

        if (offAmount <= 0 && srvAmount <= 0) {
            showNotification('Lütfen en az bir ücret girin.', 'warning');
            return;
        }

        const btn = document.getElementById('saveAccrualBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Kaydediliyor...';

        try {
            // Dosya Yükleme (Varsa)
            // Not: Dosya yükleme servisi TaskDataManager içinde olabilir veya utils'e taşınmış olabilir.
            // Buraya basit bir placeholder koyuyorum, mevcut yapınızdaki dosya yükleme mantığını buraya entegre edebilirsiniz.
            const uploadedDocs = []; // Dosya yükleme logic'i buraya gelecek

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
                files: uploadedDocs
            };

            const result = await accrualService.addAccrual(data);
            if (result.success) {
                showNotification('Tahakkuk başarıyla oluşturuldu.', 'success');
                this.addModal.classList.remove('show');
                this.loadAccruals();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            showNotification('Hata: ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Kaydet';
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

    viewAccrual(id) {
        const acc = this.allAccruals.find(a => a.id === id);
        if (!acc) return;

        document.getElementById('viewTaskTitle').textContent = acc.taskTitle || '-';
        document.getElementById('viewOfficialFee').textContent = this.formatCurrency(acc.officialFee?.amount, acc.officialFee?.currency);
        document.getElementById('viewServiceFee').textContent = this.formatCurrency(acc.serviceFee?.amount, acc.serviceFee?.currency);
        document.getElementById('viewTotalAmount').textContent = this.formatCurrency(acc.totalAmount, acc.totalAmountCurrency);
        document.getElementById('viewRemainingAmount').textContent = this.formatCurrency(acc.remainingAmount, acc.totalAmountCurrency);
        
        // Status
        const statusBadge = document.getElementById('viewStatusBadge');
        statusBadge.className = 'status-badge ' + (acc.status === 'paid' ? 'status-paid' : (acc.status === 'partially_paid' ? 'status-partially_paid' : 'status-unpaid'));
        statusBadge.innerHTML = `<span class="status-dot"></span>${acc.status === 'paid' ? 'Ödendi' : (acc.status === 'partially_paid' ? 'Kısmen Ödendi' : 'Ödenmedi')}`;

        this.viewModal.classList.add('show');
    }

    openPaymentModal(id) {
        this.accrualIdToPay = id;
        const acc = this.allAccruals.find(a => a.id === id);
        if (!acc) return;

        document.getElementById('paymentAmount').value = acc.remainingAmount || 0;
        document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
        this.paymentModal.classList.add('show');
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
            this.paymentModal.classList.remove('show');
            this.loadAccruals();
        } else {
            showNotification('Hata: ' + result.error, 'error');
        }
    }

    // --- Yardımcı Fonksiyonlar ---

    filterAccruals(searchTerm) {
        const term = searchTerm.toLowerCase();
        const status = document.getElementById('statusFilter').value;

        const filtered = this.allAccruals.filter(acc => {
            const matchesSearch = (acc.taskTitle || '').toLowerCase().includes(term) ||
                                  (acc.id || '').toLowerCase().includes(term);
            const matchesStatus = status === 'all' || acc.status === status;
            return matchesSearch && matchesStatus;
        });

        this.renderAccruals(filtered);
    }

    formatCurrency(amount, currency = 'TRY') {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency }).format(amount || 0);
    }

    updateSummaryCards() {
        // Toplam tahakkuk, bekleyen ödeme vb. hesaplayıp kartlara basabilirsiniz.
        // Şimdilik boş bıraktım, isteğe göre eklenebilir.
    }

    // Dosya Yükleme (Drag & Drop)
    setupFileUpload() {
        const area = document.getElementById('fileUploadArea');
        const input = document.getElementById('fileInput');

        if (!area || !input) return;

        area.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => this.handleFiles(e.target.files));
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            area.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        area.addEventListener('dragover', () => area.classList.add('dragover'));
        area.addEventListener('dragleave', () => area.classList.remove('dragover'));
        area.addEventListener('drop', (e) => {
            area.classList.remove('dragover');
            this.handleFiles(e.dataTransfer.files);
        });
    }

    handleFiles(files) {
        this.uploadedFiles = [...this.uploadedFiles, ...Array.from(files)];
        this.updateFileList();
    }

    updateFileList() {
        const list = document.getElementById('fileList');
        list.innerHTML = '';
        this.uploadedFiles.forEach((file, index) => {
            const li = document.createElement('li');
            li.className = 'file-item';
            li.innerHTML = `
                <span><i class="fas fa-file-alt mr-2"></i>${file.name}</span>
                <span class="file-remove" onclick="window.accrualsModule.removeFile(${index})"><i class="fas fa-times"></i></span>
            `;
            list.appendChild(li);
        });
    }

    removeFile(index) {
        this.uploadedFiles.splice(index, 1);
        this.updateFileList();
    }
}

// Global Erişim (HTML'den çağırabilmek için)
window.accrualsModule = new AccrualsModule();
document.addEventListener('DOMContentLoaded', () => window.accrualsModule.init());