// client-portal-portfolio.js
// Portföy tabloları yönetim modülü

import { db } from '../firebase-config.js';
import { getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { formatDate, getStatusBadge, sortTable } from './client-portal-utils.js';
import PaginationModule from './pagination.js';

// Ülke kodları mapping
const countriesMap = {
    'TR': 'Türkiye',
    'US': 'ABD',
    'GB': 'İngiltere',
    'DE': 'Almanya',
    'FR': 'Fransa',
    'IT': 'İtalya',
    'ES': 'İspanya',
    'CN': 'Çin',
    'JP': 'Japonya'
};

let portfolioData = {
    all: [],
    trademark: [],
    patent: [],
    design: []
};

/**
 * Portföy verilerini yükle ve göster
 */
export async function loadPortfolio(user) {
    try {
        const container = document.getElementById('portfolio-container');
        container.innerHTML = '<div class="text-center"><div class="spinner-border"></div><p>Portföy yükleniyor...</p></div>';
        
        // Owner'ları getir
        const owners = await getUserOwners(user);
        if (!owners || owners.length === 0) {
            container.innerHTML = '<div class="alert alert-warning">Portföy kaydı bulunamadı.</div>';
            return;
        }
        
        const ownerIds = owners.map(o => o.id);
        
        // IP kayıtlarını getir
        const records = await getIPRecords(ownerIds);
        
        // Verileri kategorilere ayır
        portfolioData.all = records;
        portfolioData.trademark = records.filter(r => r.type === 'trademark');
        portfolioData.patent = records.filter(r => r.type === 'patent');
        portfolioData.design = records.filter(r => r.type === 'design');
        
        // UI oluştur
        renderPortfolioUI();
        
    } catch (error) {
        console.error('Portföy yükleme hatası:', error);
        const container = document.getElementById('portfolio-container');
        container.innerHTML = '<div class="alert alert-danger">Portföy yüklenirken hata oluştu.</div>';
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
 * IP kayıtlarını getir
 */
async function getIPRecords(ownerIds) {
    const ipRecordsRef = collection(db, 'iprecords');
    const records = [];
    
    // Firestore "in" limiti 10 olduğu için chunk'lara böl
    const chunks = chunkArray(ownerIds, 10);
    
    for (const chunk of chunks) {
        const queries = await Promise.all(
            chunk.map(ownerId => {
                const q = query(ipRecordsRef, where('applicants', 'array-contains', { id: ownerId }));
                return getDocs(q);
            })
        );
        
        queries.forEach(snapshot => {
            snapshot.forEach(doc => {
                const data = { id: doc.id, ...doc.data() };
                // Duplicate kontrolü
                if (!records.find(r => r.id === data.id)) {
                    records.push(data);
                }
            });
        });
    }
    
    return records;
}

/**
 * Portföy UI oluştur
 */
function renderPortfolioUI() {
    const container = document.getElementById('portfolio-container');
    
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <ul class="nav nav-tabs card-header-tabs" role="tablist">
                    <li class="nav-item">
                        <a class="nav-link active" data-toggle="tab" href="#tab-all" role="tab">
                            Tümü (${portfolioData.all.length})
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" data-toggle="tab" href="#tab-trademark" role="tab">
                            Marka (${portfolioData.trademark.length})
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" data-toggle="tab" href="#tab-patent" role="tab">
                            Patent (${portfolioData.patent.length})
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" data-toggle="tab" href="#tab-design" role="tab">
                            Tasarım (${portfolioData.design.length})
                        </a>
                    </li>
                </ul>
            </div>
            <div class="card-body">
                <div class="tab-content">
                    <div class="tab-pane fade show active" id="tab-all" role="tabpanel">
                        ${renderPortfolioTable('all', portfolioData.all)}
                    </div>
                    <div class="tab-pane fade" id="tab-trademark" role="tabpanel">
                        ${renderPortfolioTable('trademark', portfolioData.trademark)}
                    </div>
                    <div class="tab-pane fade" id="tab-patent" role="tabpanel">
                        ${renderPortfolioTable('patent', portfolioData.patent)}
                    </div>
                    <div class="tab-pane fade" id="tab-design" role="tabpanel">
                        ${renderPortfolioTable('design', portfolioData.design)}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Sıralama event listener'ları ekle
    setupTableSorting();
}

/**
 * Portföy tablosu oluştur
 */
function renderPortfolioTable(type, data) {
    if (data.length === 0) {
        return '<div class="alert alert-info">Kayıt bulunamadı.</div>';
    }
    
    const tableId = `table-${type}`;
    
    return `
        <div class="table-responsive">
            <table class="table table-hover" id="${tableId}">
                <thead>
                    <tr>
                        <th class="sortable" data-column="0">#</th>
                        <th class="sortable" data-column="1">Menşe</th>
                        <th>Görsel</th>
                        <th class="sortable" data-column="3">Marka/Patent/Tasarım</th>
                        <th class="sortable" data-column="4">Başvuru No</th>
                        <th class="sortable" data-column="5">Tescil No</th>
                        <th class="sortable" data-column="6">Başvuru Tarihi</th>
                        <th class="sortable" data-column="7">Durum</th>
                        <th>Sınıflar</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.map((item, index) => renderPortfolioRow(item, index)).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Portföy satırı oluştur
 */
function renderPortfolioRow(item, index) {
    const title = item.title || item.brandText || 'İsimsiz';
    const appNumber = item.applicationNumber || '-';
    const regNumber = item.registrationNumber || '-';
    const appDate = formatApplicationDate(item.applicationDate);
    const status = item.status || 'Bilinmiyor';
    const classes = getClasses(item);
    const origin = getOrigin(item);
    const imageUrl = item.brandImageUrl || item.brandImage || '';
    
    const imageHtml = imageUrl 
        ? `<img src="${imageUrl}" alt="marka" class="brand-thumb" />` 
        : '-';
    
    return `
        <tr>
            <td>${index + 1}</td>
            <td>${origin}</td>
            <td class="text-center">${imageHtml}</td>
            <td><strong>${title}</strong></td>
            <td>${appNumber}</td>
            <td>${regNumber}</td>
            <td>${appDate}</td>
            <td>${getStatusBadge(status)}</td>
            <td>${classes}</td>
        </tr>
    `;
}

/**
 * Başvuru tarihini formatla
 */
function formatApplicationDate(date) {
    if (!date || date === '-') return '-';
    
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return date;
        
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        
        return `${day}/${month}/${year}`;
    } catch (error) {
        return date;
    }
}

/**
 * Sınıfları getir
 */
function getClasses(item) {
    if (Array.isArray(item.goodsAndServicesByClass) && item.goodsAndServicesByClass.length) {
        const classes = item.goodsAndServicesByClass
            .map(c => parseInt(c.classNo, 10))
            .filter(n => !isNaN(n));
        return Array.from(new Set(classes)).sort((a, b) => a - b).join(', ');
    }
    
    if (item.classes) {
        const norm = Array.isArray(item.classes) 
            ? item.classes 
            : String(item.classes).split(',');
        const classes = norm
            .map(x => parseInt(String(x).trim(), 10))
            .filter(n => !isNaN(n));
        return Array.from(new Set(classes)).sort((a, b) => a - b).join(', ') || '-';
    }
    
    return '-';
}

/**
 * Menşe bilgisini getir
 */
function getOrigin(item) {
    const originRaw = (item.origin || 'TÜRKPATENT').toString().trim().toUpperCase();
    
    if (originRaw === 'TÜRKPATENT' || originRaw === 'TURKPATENT') {
        return 'TÜRKPATENT';
    } else if (item.origin === 'Yurtdışı Ulusal') {
        const countryCode = item.country || '';
        return countriesMap[countryCode] || countryCode;
    } else {
        return item.origin || 'Bilinmiyor';
    }
}

/**
 * Tablo sıralama kurulumu
 */
function setupTableSorting() {
    const sortableHeaders = document.querySelectorAll('.sortable');
    
    sortableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const table = header.closest('table');
            const columnIndex = parseInt(header.dataset.column);
            const currentDirection = header.dataset.direction || 'asc';
            const newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
            
            // Tüm header'ları temizle
            sortableHeaders.forEach(h => {
                h.dataset.direction = '';
                h.innerHTML = h.textContent.replace(' ▲', '').replace(' ▼', '');
            });
            
            // Aktif header'ı işaretle
            header.dataset.direction = newDirection;
            header.innerHTML += newDirection === 'asc' ? ' ▲' : ' ▼';
            
            // Tabloyu sırala
            sortTable(table, columnIndex, newDirection);
        });
    });
}

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

export { portfolioData };
