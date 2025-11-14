// client-portal-tasks.js
// İşler/Görevler yönetim modülü

import { db } from '../firebase-config.js';
import { getDocs, collection, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { formatDate, showNotification } from './client-portal-utils.js';

let tasksData = [];

/**
 * İşleri yükle ve göster
 */
export async function loadTasks(user) {
    try {
        const container = document.getElementById('tasks-container');
        container.innerHTML = '<div class="text-center"><div class="spinner-border"></div><p>İşler yükleniyor...</p></div>';
        
        // Görevleri getir
        tasksData = await getUserTasks(user);
        
        if (tasksData.length === 0) {
            container.innerHTML = '<div class="alert alert-info">Henüz size atanmış iş bulunmamaktadır.</div>';
            return;
        }
        
        // UI oluştur
        renderTasksUI();
        
    } catch (error) {
        console.error('İşler yükleme hatası:', error);
        const container = document.getElementById('tasks-container');
        container.innerHTML = '<div class="alert alert-danger">İşler yüklenirken hata oluştu.</div>';
    }
}

/**
 * Kullanıcının görevlerini getir
 */
async function getUserTasks(user) {
    try {
        const tasksRef = collection(db, 'tasks');
        const q = query(
            tasksRef,
            where('details.relatedParty.email', '==', user.email),
            orderBy('createdAt', 'desc')
        );
        
        const snapshot = await getDocs(q);
        const tasks = [];
        
        snapshot.forEach(doc => {
            tasks.push({ id: doc.id, ...doc.data() });
        });
        
        return tasks;
    } catch (error) {
        console.error('Görev getirme hatası:', error);
        return [];
    }
}

/**
 * İşler UI oluştur
 */
function renderTasksUI() {
    const container = document.getElementById('tasks-container');
    
    // Duruma göre filtrele
    const pendingTasks = tasksData.filter(t => t.status === 'pending' || t.status === 'in_progress');
    const completedTasks = tasksData.filter(t => t.status === 'completed');
    const pendingApproval = tasksData.filter(t => t.status === 'pending_approval');
    
    container.innerHTML = `
        <div class="card mb-4">
            <div class="card-header">
                <h5 class="mb-0">
                    <i class="fas fa-filter"></i> Filtrele
                </h5>
            </div>
            <div class="card-body">
                <div class="row">
                    <div class="col-md-4">
                        <label>Durum</label>
                        <select class="form-control" id="taskStatusFilter">
                            <option value="all">Tümü (${tasksData.length})</option>
                            <option value="pending">Devam Eden (${pendingTasks.length})</option>
                            <option value="pending_approval">Onay Bekleyen (${pendingApproval.length})</option>
                            <option value="completed">Tamamlanan (${completedTasks.length})</option>
                        </select>
                    </div>
                    <div class="col-md-4">
                        <label>Sıralama</label>
                        <select class="form-control" id="taskSortFilter">
                            <option value="date-desc">Tarihe Göre (Yeniden Eskiye)</option>
                            <option value="date-asc">Tarihe Göre (Eskiden Yeniye)</option>
                            <option value="priority">Önceliğe Göre</option>
                        </select>
                    </div>
                    <div class="col-md-4">
                        <label>Arama</label>
                        <input type="text" class="form-control" id="taskSearchInput" placeholder="İş ara...">
                    </div>
                </div>
            </div>
        </div>
        
        <div id="tasks-list">
            ${renderTaskCards(tasksData)}
        </div>
    `;
    
    // Event listener'ları ekle
    setupTaskFilters();
}

/**
 * Görev kartlarını oluştur
 */
function renderTaskCards(tasks) {
    if (tasks.length === 0) {
        return '<div class="alert alert-info">Gösterile cek görev bulunmamaktadır.</div>';
    }
    
    return tasks.map((task, index) => renderTaskCard(task, index)).join('');
}

/**
 * Tek bir görev kartı oluştur
 */
function renderTaskCard(task, index) {
    const taskTitle = task.title || 'İsimsiz Görev';
    const taskType = task.transactionType?.name || 'İşlem Türü Belirtilmemiş';
    const relatedIP = task.relatedIpRecordTitle || '-';
    const dueDate = task.dueDate ? formatDate(task.dueDate) : '-';
    const status = getTaskStatus(task.status);
    const priority = task.priority || 'normal';
    const description = task.description || 'Açıklama eklenmemiş';
    
    // Öncelik badge'i
    const priorityBadge = {
        'high': '<span class="badge badge-danger"><i class="fas fa-exclamation-circle"></i> Yüksek</span>',
        'normal': '<span class="badge badge-warning"><i class="fas fa-minus-circle"></i> Normal</span>',
        'low': '<span class="badge badge-secondary"><i class="fas fa-arrow-down"></i> Düşük</span>'
    }[priority] || '';
    
    return `
        <div class="card task-card mb-3">
            <div class="task-number-tag">${index + 1}</div>
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-3">
                    <div>
                        <h5 class="task-title mb-2">${taskTitle}</h5>
                        <p class="text-muted mb-1">
                            <i class="fas fa-tags"></i> ${taskType}
                        </p>
                        <p class="text-muted mb-0">
                            <i class="fas fa-folder-open"></i> ${relatedIP}
                        </p>
                    </div>
                    <div class="text-right">
                        ${priorityBadge}
                        ${status}
                    </div>
                </div>
                
                <div class="mb-3">
                    <p class="mb-0">${description}</p>
                </div>
                
                <div class="d-flex justify-content-between align-items-center">
                    <div class="text-muted">
                        <i class="fas fa-calendar-alt"></i> 
                        <strong>Son Tarih:</strong> ${dueDate}
                    </div>
                    ${task.status === 'pending_approval' ? renderApprovalButtons(task) : ''}
                </div>
                
                ${task.documents && task.documents.length > 0 ? renderTaskDocuments(task.documents) : ''}
            </div>
        </div>
    `;
}

/**
 * Görev durumu badge'i
 */
function getTaskStatus(status) {
    const badges = {
        'pending': '<span class="badge badge-warning">Beklemede</span>',
        'in_progress': '<span class="badge badge-info">Devam Ediyor</span>',
        'pending_approval': '<span class="badge badge-primary">Onay Bekliyor</span>',
        'completed': '<span class="badge badge-success">Tamamlandı</span>',
        'cancelled': '<span class="badge badge-danger">İptal Edildi</span>'
    };
    
    return badges[status] || '<span class="badge badge-secondary">Bilinmiyor</span>';
}

/**
 * Onay butonları
 */
function renderApprovalButtons(task) {
    return `
        <div>
            <button class="btn btn-sm btn-success mr-2" onclick="window.approveTask('${task.id}')">
                <i class="fas fa-check"></i> Onayla
            </button>
            <button class="btn btn-sm btn-danger" onclick="window.rejectTask('${task.id}')">
                <i class="fas fa-times"></i> Reddet
            </button>
        </div>
    `;
}

/**
 * Görev belgelerini göster
 */
function renderTaskDocuments(documents) {
    if (!documents || documents.length === 0) return '';
    
    return `
        <div class="mt-3 pt-3 border-top">
            <h6><i class="fas fa-paperclip"></i> Belgeler</h6>
            <div class="list-group">
                ${documents.map(doc => `
                    <a href="${doc.downloadURL || '#'}" target="_blank" class="list-group-item list-group-item-action">
                        <i class="fas fa-file-pdf"></i> ${doc.name}
                    </a>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Filtre kurulumu
 */
function setupTaskFilters() {
    const statusFilter = document.getElementById('taskStatusFilter');
    const sortFilter = document.getElementById('taskSortFilter');
    const searchInput = document.getElementById('taskSearchInput');
    
    if (statusFilter) {
        statusFilter.addEventListener('change', applyFilters);
    }
    
    if (sortFilter) {
        sortFilter.addEventListener('change', applyFilters);
    }
    
    if (searchInput) {
        searchInput.addEventListener('input', applyFilters);
    }
}

/**
 * Filtreleri uygula
 */
function applyFilters() {
    const statusFilter = document.getElementById('taskStatusFilter')?.value || 'all';
    const sortFilter = document.getElementById('taskSortFilter')?.value || 'date-desc';
    const searchQuery = document.getElementById('taskSearchInput')?.value.toLowerCase() || '';
    
    let filtered = [...tasksData];
    
    // Durum filtresi
    if (statusFilter !== 'all') {
        filtered = filtered.filter(t => {
            if (statusFilter === 'pending') {
                return t.status === 'pending' || t.status === 'in_progress';
            }
            return t.status === statusFilter;
        });
    }
    
    // Arama filtresi
    if (searchQuery) {
        filtered = filtered.filter(t => 
            (t.title || '').toLowerCase().includes(searchQuery) ||
            (t.transactionType?.name || '').toLowerCase().includes(searchQuery) ||
            (t.relatedIpRecordTitle || '').toLowerCase().includes(searchQuery)
        );
    }
    
    // Sıralama
    if (sortFilter === 'date-asc') {
        filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (sortFilter === 'date-desc') {
        filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sortFilter === 'priority') {
        const priorityOrder = { 'high': 3, 'normal': 2, 'low': 1 };
        filtered.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
    }
    
    // Listeyi güncelle
    const tasksList = document.getElementById('tasks-list');
    if (tasksList) {
        tasksList.innerHTML = renderTaskCards(filtered);
    }
}

/**
 * Görevi onayla
 */
window.approveTask = async function(taskId) {
    if (!confirm('Bu işi onaylamak istediğinizden emin misiniz?')) return;
    
    try {
        // Firebase işlemi burada yapılacak
        showNotification('İş başarıyla onaylandı!', 'success');
        // Listeyi yenile
        await loadTasks(window.authService.getCurrentUser());
    } catch (error) {
        console.error('Onaylama hatası:', error);
        showNotification('İş onaylanırken hata oluştu!', 'error');
    }
};

/**
 * Görevi reddet
 */
window.rejectTask = async function(taskId) {
    const reason = prompt('Ret nedeni:');
    if (!reason) return;
    
    try {
        // Firebase işlemi burada yapılacak
        showNotification('İş reddedildi.', 'info');
        // Listeyi yenile
        await loadTasks(window.authService.getCurrentUser());
    } catch (error) {
        console.error('Reddetme hatası:', error);
        showNotification('İş reddedilirken hata oluştu!', 'error');
    }
};

export { tasksData };
