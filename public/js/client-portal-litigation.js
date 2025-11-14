// client-portal-litigation.js
// Dava & İtiraz yönetim modülü

import { db } from '../firebase-config.js';
import { getDocs, collection, query, where, collectionGroup } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { formatDate, sortTable } from './client-portal-utils.js';

let litigationData = {
    suits: [],
    objections: []
};

/**
 * Dava ve itirazları yükle
 */
export async function loadLitigation(user) {
    try {
        const container = document.getElementById('litigation-container');
        container.innerHTML = '<div class="text-center"><div class="spinner-border"></div><p>Dava & İtirazlar yükleniyor...</p></div>';
        
        // Owner'ları getir
        const owners = await getUserOwners(user);
        if (!owners || owners.length === 0) {
            container.innerHTML = '<div class="alert alert-warning">Dava/İtiraz kaydı bulunamadı.</div>';
            return;
        }
        
        const ownerIds = owners.map(o => o.id);
        
        // Davaları ve itirazları getir
        await Promise.all([
            getSuits(ownerIds),
            getObjections(user)
        ]);
        
        if (litigationData.suits.length === 0 && litigationData.objections.length === 0) {
            container.innerHTML = '<div class="alert alert-info">Henüz dava veya itiraz bulunmamaktadır.</div>';
            return;
        }
        
        // UI oluştur
        renderLitigationUI();
        
    } catch (error) {
        console.error('Dava/İtiraz yükleme hatası:', error);
        const container = document.getElementById('litigation-container');
        container.innerHTML = '<div class="alert alert-danger">Veriler yüklenirken hata oluştu.</div>';
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
 * Davaları getir
 */
async function getSuits(ownerIds) {
    try {
        const suitsRef = collection(db, 'suits');
        const suits = [];
        
        // Chunk'lara böl
        const chunks = chunkArray(ownerIds, 10);
        
        for (const chunk of chunks) {
            const q = query(suitsRef, where('client.id', 'in', chunk));
            const snapshot = await getDocs(q);
            
            snapshot.forEach(doc => {
                const data = { id: doc.id, ...doc.data() };
                if (!suits.find(s => s.id === data.id)) {
                    suits.push(data);
                }
            });
        }
        
        litigationData.suits = suits;
    } catch (error) {
        console.error('Dava getirme hatası:', error);
        litigationData.suits = [];
    }
}

/**
 * İtirazları getir
 */
async function getObjections(user) {
    try {
        // İtirazları transaction'lardan çek
        const transactionsRef = collectionGroup(db, 'transactions');
        const objectionsQuery = query(
            transactionsRef,
            where('type', 'in', ['7', '19', '20']) // İtiraz türleri
        );
        
        const snapshot = await getDocs(objectionsQuery);
        const objections = [];
        
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            objections.push(data);
        });
        
        litigationData.objections = objections;
    } catch (error) {
        console.error('İtiraz getirme hatası:', error);
        litigationData.objections = [];
    }
}

/**
 * UI oluştur
 */
function renderLitigationUI() {
    const container = document.getElementById('litigation-container');
    
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <ul class="nav nav-tabs card-header-tabs" role="tablist">
                    <li class="nav-item">
                        <a class="nav-link active" data-toggle="tab" href="#tab-suits" role="tab">
                            <i class="fas fa-gavel"></i> Davalar (${litigationData.suits.length})
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" data-toggle="tab" href="#tab-objections" role="tab">
                            <i class="fas fa-exclamation-triangle"></i> İtirazlar (${litigationData.objections.length})
                        </a>
                    </li>
                </ul>
            </div>
            <div class="card-body">
                <div class="tab-content">
                    <div class="tab-pane fade show active" id="tab-suits" role="tabpanel">
                        ${renderSuitsTable()}
                    </div>
                    <div class="tab-pane fade" id="tab-objections" role="tabpanel">
                        ${renderObjectionsTable()}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Sıralama event listener'ları ekle
    setupTableSorting();
}

/**
 * Davalar tablosu
 */
function renderSuitsTable() {
    if (litigationData.suits.length === 0) {
        return '<div class="alert alert-info">Dava kaydı bulunmamaktadır.</div>';
    }
    
    return `
        <div class="table-responsive">
            <table class="table table-hover" id="suits-table">
                <thead>
                    <tr>
                        <th class="sortable" data-column="0">#</th>
                        <th class="sortable" data-column="1">Dava No</th>
                        <th class="sortable" data-column="2">Dava Türü</th>
                        <th class="sortable" data-column="3">Mahkeme</th>
                        <th class="sortable" data-column="4">Müvekkil</th>
                        <th class="sortable" data-column="5">Müvekkil Rolü</th>
                        <th class="sortable" data-column="6">Karşı Taraf</th>
                        <th class="sortable" data-column="7">Açılış Tarihi</th>
                        <th class="sortable" data-column="8">Durum</th>
                    </tr>
                </thead>
                <tbody>
                    ${litigationData.suits.map((suit, index) => renderSuitRow(suit, index)).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Dava satırı
 */
function renderSuitRow(suit, index) {
    const caseNo = suit.suitDetails?.caseNo || '-';
    const suitType = suit.transactionType?.alias || suit.transactionType?.name || '-';
    const court = suit.suitDetails?.court || '-';
    const client = suit.client?.name || '-';
    const clientRole = suit.client?.clientRole || '-';
    const opposingParty = suit.suitDetails?.opposingParty || '-';
    const openingDate = formatDate(suit.suitDetails?.openingDate);
    const status = suit.suitDetails?.suitStatus || 'Bilinmiyor';
    
    const statusBadge = {
        'Devam Ediyor': '<span class="badge badge-primary">Devam Ediyor</span>',
        'Sonuçlandı': '<span class="badge badge-success">Sonuçlandı</span>',
        'Beklemede': '<span class="badge badge-warning">Beklemede</span>',
        'Kapatıldı': '<span class="badge badge-secondary">Kapatıldı</span>'
    }[status] || '<span class="badge badge-secondary">Bilinmiyor</span>';
    
    return `
        <tr>
            <td>${index + 1}</td>
            <td><strong>${caseNo}</strong></td>
            <td>${suitType}</td>
            <td>${court}</td>
            <td>${client}</td>
            <td>${clientRole}</td>
            <td>${opposingParty}</td>
            <td>${openingDate}</td>
            <td>${statusBadge}</td>
        </tr>
    `;
}

/**
 * İtirazlar tablosu
 */
function renderObjectionsTable() {
    if (litigationData.objections.length === 0) {
        return '<div class="alert alert-info">İtiraz kaydı bulunmamaktadır.</div>';
    }
    
    return `
        <div class="table-responsive">
            <table class="table table-hover" id="objections-table">
                <thead>
                    <tr>
                        <th class="sortable" data-column="0">#</th>
                        <th>Görsel</th>
                        <th class="sortable" data-column="2">Marka</th>
                        <th class="sortable" data-column="3">İşlem Türü</th>
                        <th class="sortable" data-column="4">Başvuru No</th>
                        <th class="sortable" data-column="5">Başvuru Sahibi</th>
                        <th class="sortable" data-column="6">İtiraz Sahibi</th>
                        <th class="sortable" data-column="7">Bülten Tarihi</th>
                        <th class="sortable" data-column="8">Bülten No</th>
                        <th class="sortable" data-column="9">İşlem Tarihi</th>
                        <th class="sortable" data-column="10">Durum</th>
                    </tr>
                </thead>
                <tbody>
                    ${litigationData.objections.map((obj, index) => renderObjectionRow(obj, index)).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * İtiraz satırı
 */
function renderObjectionRow(objection, index) {
    const brandImage = objection.brandImageUrl || '';
    const imageHtml = brandImage 
        ? `<img src="${brandImage}" alt="marka" class="brand-thumb" style="height: 80px; width: auto;" />` 
        : '-';
    
    const title = objection.title || '-';
    const transactionType = objection.transactionTypeName || '-';
    const applicationNumber = objection.applicationNumber || '-';
    const applicant = objection.applicantName || '-';
    const opponent = objection.opponent || '-';
    const bulletinDate = formatDate(objection.bulletinDate);
    const bulletinNo = objection.bulletinNo || '-';
    const processDate = formatDate(objection.epatsDate);
    const status = objection.statusText || 'Bilinmiyor';
    
    const statusBadge = `<span class="badge badge-warning">${status}</span>`;
    
    return `
        <tr>
            <td>${index + 1}</td>
            <td class="text-center">${imageHtml}</td>
            <td><strong>${title}</strong></td>
            <td>${transactionType}</td>
            <td>${applicationNumber}</td>
            <td>${applicant}</td>
            <td>
                ${opponent}
                ${opponent !== '-' ? '<span class="opposition-owner-badge">İtiraz</span>' : ''}
            </td>
            <td>${bulletinDate}</td>
            <td>${bulletinNo}</td>
            <td>${processDate}</td>
            <td>${statusBadge}</td>
        </tr>
    `;
}

/**
 * Tablo sıralama kurulumu
 */
function setupTableSorting() {
    const tables = ['suits-table', 'objections-table'];
    
    tables.forEach(tableId => {
        const table = document.getElementById(tableId);
        if (!table) return;
        
        const sortableHeaders = table.querySelectorAll('.sortable');
        
        sortableHeaders.forEach(header => {
            header.addEventListener('click', () => {
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

export { litigationData };
