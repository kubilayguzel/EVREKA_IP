// client-portal-dashboard.js
// Dashboard sayaçları ve özet modülü

import { db } from '../firebase-config.js';
import { getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

/**
 * Dashboard verilerini yükle
 */
export async function loadDashboard(user) {
    try {
        // Sayaçları sıfırla
        setDashboardValue('dashPortfolio', 0);
        setDashboardValue('dashPendingApprovals', 0);
        setDashboardValue('dashUnpaidInvoices', 0);
        
        // Kullanıcının owner'ları bul
        const owners = await getUserOwners(user);
        if (!owners || owners.length === 0) {
            console.log('Kullanıcıya bağlı owner bulunamadı');
            return;
        }
        
        const ownerIds = owners.map(o => o.id);
        
        // Portföy sayısını getir
        const portfolioCount = await getPortfolioCount(ownerIds);
        setDashboardValue('dashPortfolio', portfolioCount);
        
        // Onay bekleyen işlem sayısını getir
        const pendingCount = await getPendingApprovalsCount(user.email);
        setDashboardValue('dashPendingApprovals', pendingCount);
        
        // Ödenmemiş fatura sayısını getir
        const unpaidInvoices = await getUnpaidInvoicesCount(ownerIds);
        setDashboardValue('dashUnpaidInvoices', unpaidInvoices);
        
    } catch (error) {
        console.error('Dashboard yükleme hatası:', error);
        throw error;
    }
}

/**
 * Kullanıcının sahip olduğu owner'ları getir
 */
async function getUserOwners(user) {
    try {
        const ownersRef = collection(db, 'owners');
        const q = query(ownersRef, where('clientEmail', '==', user.email));
        const snapshot = await getDocs(q);
        
        const owners = [];
        snapshot.forEach(doc => {
            owners.push({ id: doc.id, ...doc.data() });
        });
        
        return owners;
    } catch (error) {
        console.error('Owner getirme hatası:', error);
        return [];
    }
}

/**
 * Portföy sayısını getir
 */
async function getPortfolioCount(ownerIds) {
    try {
        const ipRecordsRef = collection(db, 'iprecords');
        let totalCount = 0;
        
        // Her owner için sorgu yap (Firestore "in" limiti 10)
        const chunks = chunkArray(ownerIds, 10);
        
        for (const chunk of chunks) {
            const q = query(
                ipRecordsRef,
                where('applicants', 'array-contains-any', chunk.map(id => ({ id })))
            );
            const snapshot = await getDocs(q);
            totalCount += snapshot.size;
        }
        
        return totalCount;
    } catch (error) {
        console.error('Portföy sayısı getirme hatası:', error);
        return 0;
    }
}

/**
 * Onay bekleyen işlem sayısını getir
 */
async function getPendingApprovalsCount(userEmail) {
    try {
        const tasksRef = collection(db, 'tasks');
        const q = query(
            tasksRef,
            where('details.relatedParty.email', '==', userEmail),
            where('status', '==', 'pending_approval')
        );
        const snapshot = await getDocs(q);
        return snapshot.size;
    } catch (error) {
        console.error('Onay bekleyen işlem sayısı getirme hatası:', error);
        return 0;
    }
}

/**
 * Ödenmemiş fatura sayısını getir
 */
async function getUnpaidInvoicesCount(ownerIds) {
    try {
        const invoicesRef = collection(db, 'invoices');
        let totalCount = 0;
        
        // Her owner için sorgu yap
        const chunks = chunkArray(ownerIds, 10);
        
        for (const chunk of chunks) {
            const q = query(
                invoicesRef,
                where('ownerId', 'in', chunk),
                where('paymentStatus', 'in', ['unpaid', 'partially_paid'])
            );
            const snapshot = await getDocs(q);
            totalCount += snapshot.size;
        }
        
        return totalCount;
    } catch (error) {
        console.error('Ödenmemiş fatura sayısı getirme hatası:', error);
        return 0;
    }
}

/**
 * Dashboard değerini güncelle
 */
function setDashboardValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        // Animasyonlu sayı artışı
        animateValue(element, 0, value, 500);
    }
}

/**
 * Sayı animasyonu
 */
function animateValue(element, start, end, duration) {
    const range = end - start;
    const startTime = Date.now();
    
    function update() {
        const now = Date.now();
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const currentValue = Math.floor(start + range * progress);
        element.textContent = currentValue;
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
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
