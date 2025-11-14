// client-portal-invoices.js
// Fatura yönetim modülü

import { db } from '../firebase-config.js';
import { getDocs, collection, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { formatDate, formatCurrency, sortTable } from './client-portal-utils.js';

let invoicesData = [];

/**
 * Faturaları yükle ve göster
 */
export async function loadInvoices(user) {
    try {
        const container = document.getElementById('invoices-container');
        container.innerHTML = '<div class="text-center"><div class="spinner-border"></div><p>Faturalar yükleniyor...</p></div>';
        
        // Owner'ları getir
        const owners = await getUserOwners(user);
        if (!owners || owners.length === 0) {
            container.innerHTML = '<div class="alert alert-warning">Fatura kaydı bulunamadı.</div>';
            return;
        }
        
        const ownerIds = owners.map(o => o.id);
        
        // Faturaları getir
        invoicesData = await getInvoices(ownerIds);
        
        if (invoicesData.length === 0) {
            container.innerHTML = '<div class="alert alert-info">Henüz fatura bulunmamaktadır.</div>';
            return;
        }
        
        // UI oluştur
        renderInvoicesUI();
        
    } catch (error) {
        console.error('Faturalar yükleme hatası:', error);
        const container = document.getElementById('invoices-container');
        container.innerHTML = '<div class="alert alert-danger">Faturalar yüklenirken hata oluştu.</div>';
    }
}

/**
 * Kullanıcının owner kayıtlarını getir
 */
async function getUserOwners(user) {
    const ownersRef = collection(db, 'owners');
    const q = query(ownersRef, where('clientEmail', '==', user.email));
    const snapshot = await getDocs(q);
    
    const owners = [];
    snapshot.forEach(doc => {
        owners.push({ id: doc.id, ...doc.data() });
    });
    
    return owners;
}

/**
 * Faturaları getir
 */
async function getInvoices(ownerIds) {
    const invoicesRef = collection(db, 'invoices');
    const invoices = [];
    
    // Firestore "in" limiti 10 olduğu için chunk'lara böl
    const chunks = chunkArray(ownerIds, 10);
    
    for (const chunk of chunks) {
        const q = query(
            invoicesRef,
            where('ownerId', 'in', chunk),
            orderBy('issueDate', 'desc')
        );
        
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            if (!invoices.find(i => i.id === data.id)) {
                invoices.push(data);
            }
        });
    }
    
    return invoices;
}

/**
 * Faturalar UI oluştur
 */
function renderInvoicesUI() {
    const container = document.getElementById('invoices-container');
    
    // Durum bazlı sayılar
    const unpaid = invoicesData.filter(i => i.paymentStatus === 'unpaid');
    const partiallyPaid = invoicesData.filter(i => i.paymentStatus === 'partially_paid');
    const paid = invoicesData.filter(i => i.paymentStatus === 'paid');
    
    container.innerHTML = `
        <!-- Özet Kartları -->
        <div class="row mb-4">
            <div class="col-md-4">
                <div class="card stat-card border-danger">
                    <div class="card-body">
                        <div class="stat-number text-danger">${unpaid.length}</div>
                        <div class="stat-label">Ödenmemiş Fatura</div>
                        <div class="mt-2">
                            <strong>${calculateTotal(unpaid)}</strong>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-4">
                <div class="card stat-card border-warning">
                    <div class="card-body">
                        <div class="stat-number text-warning">${partiallyPaid.length}</div>
                        <div class="stat-label">Kısmi Ödenen</div>
                        <div class="mt-2">
                            <strong>${calculateTotal(partiallyPaid)}</strong>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-4">
                <div class="card stat-card border-success">
                    <div class="card-body">
                        <div class="stat-number text-success">${paid.length}</div>
                        <div class="stat-label">Ödenen Fatura</div>
                        <div class="mt-2">
                            <strong>${calculateTotal(paid)}</strong>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Filtreler -->
        <div class="card mb-4">
            <div class="card-header">
                <h5 class="mb-0"><i class="fas fa-filter"></i> Filtrele</h5>
            </div>
            <div class="card-body">
                <div class="row">
                    <div class="col-md-4">
                        <label>Ödeme Durumu</label>
                        <select class="form-control" id="invoiceStatusFilter">
                            <option value="all">Tümü (${invoicesData.length})</option>
                            <option value="unpaid">Ödenmemiş (${unpaid.length})</option>
                            <option value="partially_paid">Kısmi Ödenen (${partiallyPaid.length})</option>
                            <option value="paid">Ödenen (${paid.length})</option>
                        </select>
                    </div>
                    <div class="col-md-4">
                        <label>Tarih Aralığı</label>
                        <select class="form-control" id="invoiceDateFilter">
                            <option value="all">Tüm Zamanlar</option>
                            <option value="this-month">Bu Ay</option>
                            <option value="last-month">Geçen Ay</option>
                            <option value="this-year">Bu Yıl</option>
                        </select>
                    </div>
                    <div class="col-md-4">
                        <label>Arama</label>
                        <input type="text" class="form-control" id="invoiceSearchInput" placeholder="Fatura no, açıklama ara...">
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Fatura Tablosu -->
        <div class="card">
            <div class="card-header">
                <h5 class="mb-0"><i class="fas fa-file-invoice-dollar"></i> Faturalar</h5>
            </div>
            <div class="card-body">
                ${renderInvoicesTable(invoicesData)}
            </div>
        </div>
    `;
    
    // Event listener'ları ekle
    setupInvoiceFilters();
}

/**
 * Fatura tablosu oluştur
 */
function renderInvoicesTable(invoices) {
    if (invoices.length === 0) {
        return '<div class="alert alert-info">Gösterilecek fatura bulunmamaktadır.</div>';
    }
    
    return `
        <div class="table-responsive">
            <table class="table table-hover" id="invoices-table">
                <thead>
                    <tr>
                        <th class="sortable" data-column="0">#</th>
                        <th class="sortable" data-column="1">Fatura No</th>
                        <th class="sortable" data-column="2">Düzenleme Tarihi</th>
                        <th class="sortable" data-column="3">Vade Tarihi</th>
                        <th class="sortable" data-column="4">Tutar</th>
                        <th class="sortable" data-column="5">Ödenen</th>
                        <th class="sortable" data-column="6">Kalan</th>
                        <th class="sortable" data-column="7">Durum</th>
                        <th>İşlemler</th>
                    </tr>
                </thead>
                <tbody>
                    ${invoices.map((invoice, index) => renderInvoiceRow(invoice, index)).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Fatura satırı oluştur
 */
function renderInvoiceRow(invoice, index) {
    const invoiceNo = invoice.invoiceNumber || '-';
    const issueDate = formatDate(invoice.issueDate);
    const dueDate = formatDate(invoice.dueDate);
    const totalAmount = invoice.totalAmount || 0;
    const paidAmount = invoice.paidAmount || 0;
    const remainingAmount = totalAmount - paidAmount;
    const currency = invoice.currency || 'TRY';
    const status = invoice.paymentStatus || 'unpaid';
    
    const statusBadge = {
        'paid': '<span class="badge badge-success">Ödendi</span>',
        'unpaid': '<span class="badge badge-danger">Ödenmedi</span>',
        'partially_paid': '<span class="badge badge-warning">Kısmi Ödendi</span>'
    }[status] || '<span class="badge badge-secondary">Bilinmiyor</span>';
    
    // Vade kontrolü
    const isOverdue = status !== 'paid' && new Date(invoice.dueDate) < new Date();
    const overdueClass = isOverdue ? 'table-danger' : '';
    
    return `
        <tr class="${overdueClass}">
            <td>${index + 1}</td>
            <td>
                <strong>${invoiceNo}</strong>
                ${isOverdue ? '<br><small class="text-danger"><i class="fas fa-exclamation-triangle"></i> Vadesi Geçti</small>' : ''}
            </td>
            <td>${issueDate}</td>
            <td>${dueDate}</td>
            <td><strong>${formatCurrency(totalAmount, currency)}</strong></td>
            <td>${formatCurrency(paidAmount, currency)}</td>
            <td><strong>${formatCurrency(remainingAmount, currency)}</strong></td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="window.viewInvoiceDetail('${invoice.id}')">
                    <i class="fas fa-eye"></i> Detay
                </button>
                ${status !== 'paid' ? `
                    <button class="btn btn-sm btn-success" onclick="window.downloadInvoice('${invoice.id}')">
                        <i class="fas fa-download"></i>
                    </button>
                ` : ''}
            </td>
        </tr>
    `;
}

/**
 * Toplam tutar hesapla
 */
function calculateTotal(invoices) {
    const totals = {};
    
    invoices.forEach(inv => {
        const currency = inv.currency || 'TRY';
        const amount = inv.totalAmount || 0;
        
        if (!totals[currency]) {
            totals[currency] = 0;
        }
        totals[currency] += amount;
    });
    
    return Object.entries(totals)
        .map(([currency, amount]) => formatCurrency(amount, currency))
        .join(' + ');
}

/**
 * Filtre kurulumu
 */
function setupInvoiceFilters() {
    const statusFilter = document.getElementById('invoiceStatusFilter');
    const dateFilter = document.getElementById('invoiceDateFilter');
    const searchInput = document.getElementById('invoiceSearchInput');
    
    if (statusFilter) {
        statusFilter.addEventListener('change', applyInvoiceFilters);
    }
    
    if (dateFilter) {
        dateFilter.addEventListener('change', applyInvoiceFilters);
    }
    
    if (searchInput) {
        searchInput.addEventListener('input', applyInvoiceFilters);
    }
    
    // Tablo sıralama
    const sortableHeaders = document.querySelectorAll('#invoices-table .sortable');
    sortableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const table = document.getElementById('invoices-table');
            const columnIndex = parseInt(header.dataset.column);
            const currentDirection = header.dataset.direction || 'asc';
            const newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
            
            sortableHeaders.forEach(h => {
                h.dataset.direction = '';
                h.innerHTML = h.textContent.replace(' ▲', '').replace(' ▼', '');
            });
            
            header.dataset.direction = newDirection;
            header.innerHTML += newDirection === 'asc' ? ' ▲' : ' ▼';
            
            sortTable(table, columnIndex, newDirection);
        });
    });
}

/**
 * Filtreleri uygula
 */
function applyInvoiceFilters() {
    const statusFilter = document.getElementById('invoiceStatusFilter')?.value || 'all';
    const dateFilter = document.getElementById('invoiceDateFilter')?.value || 'all';
    const searchQuery = document.getElementById('invoiceSearchInput')?.value.toLowerCase() || '';
    
    let filtered = [...invoicesData];
    
    // Durum filtresi
    if (statusFilter !== 'all') {
        filtered = filtered.filter(i => i.paymentStatus === statusFilter);
    }
    
    // Tarih filtresi
    if (dateFilter !== 'all') {
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const thisYear = new Date(now.getFullYear(), 0, 1);
        
        filtered = filtered.filter(i => {
            const issueDate = new Date(i.issueDate);
            
            if (dateFilter === 'this-month') {
                return issueDate >= thisMonth;
            } else if (dateFilter === 'last-month') {
                return issueDate >= lastMonth && issueDate < thisMonth;
            } else if (dateFilter === 'this-year') {
                return issueDate >= thisYear;
            }
            return true;
        });
    }
    
    // Arama filtresi
    if (searchQuery) {
        filtered = filtered.filter(i =>
            (i.invoiceNumber || '').toLowerCase().includes(searchQuery) ||
            (i.description || '').toLowerCase().includes(searchQuery)
        );
    }
    
    // Tabloyu güncelle
    const tableContainer = document.querySelector('#invoices-table').closest('.table-responsive');
    if (tableContainer) {
        tableContainer.innerHTML = '';
        const newTable = document.createElement('div');
        newTable.innerHTML = renderInvoicesTable(filtered);
        tableContainer.appendChild(newTable.firstChild);
        setupInvoiceFilters(); // Event listener'ları yeniden ekle
    }
}

/**
 * Fatura detayını göster
 */
window.viewInvoiceDetail = function(invoiceId) {
    const invoice = invoicesData.find(i => i.id === invoiceId);
    if (!invoice) {
        alert('Fatura bulunamadı!');
        return;
    }
    
    // Modal veya yeni sayfa ile detay göster
    console.log('Fatura detayı:', invoice);
    alert(`Fatura No: ${invoice.invoiceNumber}\nTutar: ${formatCurrency(invoice.totalAmount, invoice.currency)}`);
};

/**
 * Fatura indir
 */
window.downloadInvoice = function(invoiceId) {
    const invoice = invoicesData.find(i => i.id === invoiceId);
    if (!invoice) {
        alert('Fatura bulunamadı!');
        return;
    }
    
    // PDF indirme işlemi
    if (invoice.pdfUrl) {
        window.open(invoice.pdfUrl, '_blank');
    } else {
        alert('Fatura PDF dosyası bulunamadı!');
    }
};

/**
 * Array'i chunk'lara böl
 */
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

export { invoicesData };
