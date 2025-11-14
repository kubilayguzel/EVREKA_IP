// client-portal-utils.js
// Yardımcı fonksiyonlar modülü

/**
 * Tarih formatlama
 */
export function formatDate(date) {
    if (!date) return '-';
    try {
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleDateString('tr-TR', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit' 
        });
    } catch (e) {
        return '-';
    }
}

/**
 * Para formatı
 */
export function formatCurrency(amount, currency = 'TRY') {
    if (amount === null || amount === undefined) return '-';
    const formatted = new Intl.NumberFormat('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
    return `${formatted} ${currency}`;
}

/**
 * Durum badge'i oluşturma
 */
export function getStatusBadge(status) {
    const badges = {
        'application_filed': { class: 'badge-filed', text: 'Başvuru Yapıldı' },
        'registered': { class: 'badge-registered', text: 'Tescilli' },
        'objection': { class: 'badge-objection', text: 'İtiraz' },
        'rejected': { class: 'badge-rejected', text: 'Reddedildi' },
        'paid': { class: 'badge-success', text: 'Ödendi' },
        'unpaid': { class: 'badge-danger', text: 'Ödenmedi' },
        'partially_paid': { class: 'badge-partially-paid', text: 'Kısmi Ödendi' },
        'pending': { class: 'badge-warning', text: 'Beklemede' }
    };
    
    const badge = badges[status] || { class: 'badge-secondary', text: status || '-' };
    return `<span class="badge ${badge.class}">${badge.text}</span>`;
}

/**
 * Tablo sıralama
 */
export function sortTable(table, column, direction) {
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    
    const sorted = rows.sort((a, b) => {
        const aVal = a.querySelector(`td:nth-child(${column + 1})`).textContent.trim();
        const bVal = b.querySelector(`td:nth-child(${column + 1})`).textContent.trim();
        
        // Sayısal karşılaştırma
        const aNum = parseFloat(aVal.replace(/[^0-9.-]+/g, ''));
        const bNum = parseFloat(bVal.replace(/[^0-9.-]+/g, ''));
        
        if (!isNaN(aNum) && !isNaN(bNum)) {
            return direction === 'asc' ? aNum - bNum : bNum - aNum;
        }
        
        // Alfabetik karşılaştırma
        return direction === 'asc' 
            ? aVal.localeCompare(bVal, 'tr')
            : bVal.localeCompare(aVal, 'tr');
    });
    
    tbody.innerHTML = '';
    sorted.forEach(row => tbody.appendChild(row));
}

/**
 * Tema değiştirme
 */
export function initTheme() {
    const themeSwitch = document.getElementById('themeSwitch');
    const body = document.body;
    const toggleLabel = document.querySelector('.theme-toggle .custom-control-label');
    const savedTheme = localStorage.getItem('theme') || 'dark';

    if (savedTheme === 'light') {
        body.classList.add('light-mode');
        body.classList.remove('dark-mode');
        if (themeSwitch) themeSwitch.checked = false;
        if (toggleLabel) toggleLabel.textContent = 'Beyaz Tema';
    } else {
        body.classList.add('dark-mode');
        body.classList.remove('light-mode');
        if (themeSwitch) themeSwitch.checked = true;
        if (toggleLabel) toggleLabel.textContent = 'Koyu Tema';
    }

    if (themeSwitch) {
        themeSwitch.addEventListener('change', function () {
            if (this.checked) {
                body.classList.remove('light-mode');
                body.classList.add('dark-mode');
                localStorage.setItem('theme', 'dark');
                if (toggleLabel) toggleLabel.textContent = 'Koyu Tema';
            } else {
                body.classList.remove('dark-mode');
                body.classList.add('light-mode');
                localStorage.setItem('theme', 'light');
                if (toggleLabel) toggleLabel.textContent = 'Beyaz Tema';
            }
        });
    }
}

/**
 * Kullanıcı bilgilerini göster
 */
export function populateUserInfo(user) {
    if (!user) return;
    
    const elements = {
        userName: document.getElementById('userName'),
        userRole: document.getElementById('userRole'),
        userAvatar: document.getElementById('userAvatar'),
        welcomeUserName: document.getElementById('welcomeUserName')
    };
    
    if (elements.userName) {
        elements.userName.textContent = user.displayName || user.email;
    }
    if (elements.userRole) {
        elements.userRole.textContent = (user.role ? user.role.toUpperCase() : 'CLIENT');
    }
    if (elements.userAvatar) {
        const initial = user.displayName ? user.displayName.charAt(0) : user.email.charAt(0);
        elements.userAvatar.textContent = initial.toUpperCase();
    }
    if (elements.welcomeUserName) {
        elements.welcomeUserName.textContent = user.displayName || user.email;
    }
}

/**
 * Loading göster/gizle
 */
export function showLoading(message = 'Yükleniyor...') {
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    `;
    overlay.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 15px; text-align: center;">
            <div class="spinner-border text-primary" role="status"></div>
            <p style="margin-top: 15px; color: #333;">${message}</p>
        </div>
    `;
    document.body.appendChild(overlay);
}

export function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.remove();
}

/**
 * Bildiri göster
 */
export function showNotification(message, type = 'info') {
    const colors = {
        success: '#28a745',
        error: '#dc3545',
        warning: '#ffc107',
        info: '#17a2b8'
    };
    
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        background: ${colors[type] || colors.info};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

/**
 * Debounce fonksiyonu
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
