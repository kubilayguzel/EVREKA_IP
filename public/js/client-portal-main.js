// client-portal-main.js
// Ana kontrol ve koordinasyon modülü

import { authService, db } from '../firebase-config.js';
import { getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { initTheme, populateUserInfo, showLoading, hideLoading } from './client-portal-utils.js';
import { loadDashboard } from './client-portal-dashboard.js';
import { loadPortfolio } from './client-portal-portfolio.js';
import { loadTasks } from './client-portal-tasks.js';
import { loadInvoices } from './client-portal-invoices.js';
import { loadLitigation } from './client-portal-litigation.js';

// Global değişkenler
let currentUser = null;
let currentSection = 'anasayfa';

/**
 * Sayfa başlatma
 */
async function init() {
    try {
        showLoading('Yükleniyor...');
        
        // Kullanıcı kontrolü
        currentUser = authService.getCurrentUser();
        if (!currentUser) {
            window.location.href = 'login.html';
            return;
        }

        // Tema başlat
        initTheme();
        
        // Kullanıcı bilgilerini göster
        populateUserInfo(currentUser);
        
        // Navigation kurulumu
        setupNavigation();
        
        // Çıkış butonu
        document.getElementById('logoutBtn').addEventListener('click', handleLogout);
        
        // Dashboard yükle
        await loadDashboard(currentUser);
        
        hideLoading();
        
    } catch (error) {
        console.error('Başlatma hatası:', error);
        hideLoading();
        alert('Sayfa yüklenirken bir hata oluştu: ' + error.message);
    }
}

/**
 * Navigation kurulumu
 */
function setupNavigation() {
    const navLinks = document.querySelectorAll('#sidebar .nav-link');
    
    navLinks.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            
            // Aktif linki güncelle
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Section'ı göster
            const sectionId = link.dataset.section;
            await showSection(sectionId);
        });
    });
}

/**
 * Section göster
 */
async function showSection(sectionId) {
    // Tüm section'ları gizle
    document.querySelectorAll('.content-section').forEach(section => {
        section.style.display = 'none';
    });
    
    // Seçili section'ı göster
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.style.display = 'block';
    }
    
    // Section'a göre veri yükle
    currentSection = sectionId;
    
    showLoading();
    
    try {
        switch (sectionId) {
            case 'anasayfa':
                await loadDashboard(currentUser);
                break;
            case 'portfoy':
                await loadPortfolio(currentUser);
                break;
            case 'islerim':
                await loadTasks(currentUser);
                break;
            case 'faturalar':
                await loadInvoices(currentUser);
                break;
            case 'dava-itiraz':
                await loadLitigation(currentUser);
                break;
        }
    } catch (error) {
        console.error('Section yükleme hatası:', error);
        alert('Veri yüklenirken bir hata oluştu: ' + error.message);
    } finally {
        hideLoading();
    }
}

/**
 * Çıkış işlemi
 */
async function handleLogout() {
    if (confirm('Çıkış yapmak istediğinizden emin misiniz?')) {
        showLoading('Çıkış yapılıyor...');
        await authService.signOut();
        window.location.href = 'login.html';
    }
}

/**
 * Sayfa yüklendiğinde başlat
 */
document.addEventListener('DOMContentLoaded', init);

// Export
export { currentUser, currentSection };
