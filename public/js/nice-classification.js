// public/js/nice-classification.js - Refactored Version

import { db } from '../firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * 35-5 (Perakende Hizmetleri) Özel Modal Yöneticisi
 * Bu sınıf sadece 35-5 ile ilgili modal işlemlerini yönetir.
 */
class Class35_5Manager {
    constructor(parentManager) {
        this.parent = parentManager; // Ana yöneticiye referans
        this.modalData = []; // 1-34 arası mallar
        this.selectedItems = {}; // Modal içindeki geçici seçimler
        this.modalId = 'class35-5-modal';
    }

    async open() {
        // Veriyi hazırla (Sadece 1-34 arası mallar)
        this.modalData = this.parent.allData.filter(cls => cls.classNumber >= 1 && cls.classNumber <= 34);
        
        // Varsa mevcut seçimleri yükle (Ana state'den parse et)
        this.selectedItems = {}; 
        // Not: Mevcut yapıda 35-5'in alt detayları saklanmıyor, sadece metin saklanıyor.
        // Gelişmiş versiyonda buraya geri yükleme mantığı eklenebilir.

        this.renderModal();
        this.setupEvents();
    }

    renderModal() {
        // Modal HTML'ini oluştur
        const modalHTML = `
        <div id="${this.modalId}" class="modal fade show" tabindex="-1" style="display:block; background: rgba(0,0,0,0.5);">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header bg-light">
                        <h5 class="modal-title"><i class="fas fa-shopping-cart mr-2 text-primary"></i>(35-5) Müşterilerin Malları - Mal Seçimi</h5>
                        <button type="button" class="close" data-action="close">&times;</button>
                    </div>
                    <div class="modal-body bg-light">
                        <div class="row h-100">
                            <div class="col-lg-8 d-flex flex-column h-100">
                                <div class="card shadow-sm flex-grow-1">
                                    <div class="card-header bg-white py-2">
                                        <div class="input-group">
                                            <div class="input-group-prepend"><span class="input-group-text border-0 bg-light"><i class="fas fa-search"></i></span></div>
                                            <input type="text" class="form-control border-0 bg-light" id="c35-search" placeholder="Mal sınıfı ara (örn: ilaç, giysi)...">
                                        </div>
                                    </div>
                                    <div class="card-body p-0 overflow-auto" id="c35-list-container" style="max-height: 500px;">
                                        ${this._generateListHTML()}
                                    </div>
                                    <div class="card-footer bg-white">
                                        <div class="input-group">
                                            <input type="text" id="c35-custom-input" class="form-control" placeholder="Listedeki olmayan özel bir mal...">
                                            <div class="input-group-append">
                                                <button class="btn btn-outline-primary" id="c35-add-custom">Ekle</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-lg-4 d-flex flex-column h-100">
                                <div class="card shadow-sm h-100">
                                    <div class="card-header bg-white d-flex justify-content-between align-items-center">
                                        <span class="font-weight-bold">Seçilenler</span>
                                        <span class="badge badge-primary badge-pill" id="c35-count">0</span>
                                    </div>
                                    <div class="card-body p-2 overflow-auto" id="c35-selected-container" style="max-height: 500px;"></div>
                                    <div class="card-footer bg-white">
                                        <button class="btn btn-outline-danger btn-sm btn-block" id="c35-clear">Temizle</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-action="close">İptal</button>
                        <button type="button" class="btn btn-primary px-4" id="c35-save">Kaydet ve Ekle</button>
                    </div>
                </div>
            </div>
        </div>`;

        // Varsa eski modalı sil
        const oldModal = document.getElementById(this.modalId);
        if (oldModal) oldModal.remove();

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        document.body.classList.add('modal-open');
        
        this.updateSelectedUI();
    }

    _generateListHTML() {
        return this.modalData.map(cls => `
            <div class="c35-class-group border-bottom">
                <div class="p-2 bg-light d-flex justify-content-between align-items-center c35-header" style="cursor:pointer;" data-class="${cls.classNumber}">
                    <strong><span class="badge badge-secondary mr-2">${cls.classNumber}</span> ${cls.classTitle}</strong>
                    <i class="fas fa-chevron-down text-muted"></i>
                </div>
                <div class="c35-sub-list collapse" id="c35-sub-${cls.classNumber}">
                    ${cls.subClasses.map((sub, idx) => {
                        const code = `${cls.classNumber}-${idx + 1}`;
                        return `
                        <div class="p-2 border-top pl-4 c35-item-row" data-code="${code}" data-text="${sub.subClassDescription}" style="cursor:pointer;">
                            <div class="custom-control custom-checkbox">
                                <input type="checkbox" class="custom-control-input" id="chk-${code}" value="${code}">
                                <label class="custom-control-label" for="chk-${code}" style="cursor:pointer;">
                                    <span class="text-muted small">(${code})</span> ${sub.subClassDescription}
                                </label>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `).join('');
    }

    setupEvents() {
        const modal = document.getElementById(this.modalId);
        
        // Event Delegation
        modal.addEventListener('click', (e) => {
            const target = e.target;

            // Kapatma
            if (target.dataset.action === 'close' || target.classList.contains('close')) {
                this.close();
                return;
            }

            // Accordion Aç/Kapa
            const header = target.closest('.c35-header');
            if (header) {
                const classNum = header.dataset.class;
                const content = document.getElementById(`c35-sub-${classNum}`);
                content.classList.toggle('show');
                return;
            }

            // Öğe Seçimi
            const itemRow = target.closest('.c35-item-row');
            if (itemRow) {
                // Checkbox'a tıklanmadıysa manuel tetikle
                if (target.tagName !== 'INPUT' && target.tagName !== 'LABEL') {
                    const checkbox = itemRow.querySelector('input[type="checkbox"]');
                    checkbox.checked = !checkbox.checked;
                    this.toggleItem(checkbox.value, itemRow.dataset.text, checkbox.checked);
                }
            }
            
            // Checkbox değişimi (Doğrudan tıklama)
            if (target.tagName === 'INPUT' && target.type === 'checkbox') {
                const itemRow = target.closest('.c35-item-row');
                this.toggleItem(target.value, itemRow.dataset.text, target.checked);
            }
        });

        // Arama
        document.getElementById('c35-search').addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const groups = modal.querySelectorAll('.c35-class-group');
            
            groups.forEach(group => {
                let hasMatch = false;
                const items = group.querySelectorAll('.c35-item-row');
                items.forEach(item => {
                    const text = item.dataset.text.toLowerCase();
                    if (text.includes(term)) {
                        item.style.display = '';
                        hasMatch = true;
                    } else {
                        item.style.display = 'none';
                    }
                });
                
                // Başlık veya içerik eşleşiyorsa grubu göster
                const title = group.querySelector('.c35-header').innerText.toLowerCase();
                if (title.includes(term) || hasMatch) {
                    group.style.display = '';
                    // Arama yapılıyorsa accordion'u aç
                    if (term.length > 2) group.querySelector('.c35-sub-list').classList.add('show');
                } else {
                    group.style.display = 'none';
                }
            });
        });

        // Kaydet
        document.getElementById('c35-save').addEventListener('click', () => {
            const count = Object.keys(this.selectedItems).length;
            if (count === 0) return alert('Lütfen en az bir mal seçin.');
            
            // Ana yöneticiye aktar
            this.parent.addSelection('35-5', '35', 'Müşterilerin malları (seçilen mallar için)');
            // Seçilen alt malları da ekleyelim (Opsiyonel: Veritabanına detaylı kaydetmek isterseniz)
            Object.entries(this.selectedItems).forEach(([code, text]) => {
                this.parent.addSelection(code, code.split('-')[0], text);
            });

            this.close();
        });
        
        // Özel Ekle
        document.getElementById('c35-add-custom').addEventListener('click', () => {
            const input = document.getElementById('c35-custom-input');
            const val = input.value.trim();
            if(!val) return;
            const customCode = `99-${Date.now()}`;
            this.toggleItem(customCode, val, true);
            input.value = '';
        });
    }

    toggleItem(code, text, isSelected) {
        if (isSelected) {
            this.selectedItems[code] = text;
        } else {
            delete this.selectedItems[code];
        }
        this.updateSelectedUI();
    }

    updateSelectedUI() {
        const container = document.getElementById('c35-selected-container');
        const countBadge = document.getElementById('c35-count');
        const count = Object.keys(this.selectedItems).length;
        countBadge.textContent = count;

        let html = '';
        Object.entries(this.selectedItems).forEach(([code, text]) => {
            html += `
                <div class="d-flex justify-content-between align-items-center border-bottom py-1">
                    <span class="text-truncate small" style="max-width: 200px;" title="${text}">(${code}) ${text}</span>
                    <button class="btn btn-xs text-danger" onclick="document.getElementById('chk-${code}').click()">&times;</button>
                </div>
            `;
        });
        container.innerHTML = html || '<div class="text-muted text-center mt-4">Seçim yok</div>';
    }

    close() {
        const modal = document.getElementById(this.modalId);
        if (modal) modal.remove();
        document.body.classList.remove('modal-open');
    }
}

/**
 * Ana Nice Sınıflandırma Yöneticisi
 */
class NiceClassificationManager {
    constructor() {
        this.allData = [];
        this.selectedClasses = {}; // { "1-5": { classNum: 1, text: "..." } }
        this.elements = {
            listContainer: document.getElementById('niceClassificationList'),
            selectedContainer: document.getElementById('selectedNiceClasses'),
            searchInput: document.getElementById('niceClassSearch'),
            selectedCountBadge: document.getElementById('selectedClassCount'),
            customInput: document.getElementById('customClassInput'),
            customAddBtn: document.getElementById('addCustomClassBtn'),
            customCharCount: document.getElementById('customClassCharCount')
        };
        
        this.class35Manager = new Class35_5Manager(this);
    }

    async init() {
        if (!this.elements.listContainer) return; // Sayfada element yoksa çık

        this.elements.listContainer.innerHTML = '<div class="text-center p-4"><div class="spinner-border text-primary"></div><div class="mt-2">Sınıflar yükleniyor...</div></div>';

        try {
            const snapshot = await getDocs(collection(db, "niceClassification"));
            this.allData = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    classNumber: parseInt(data.classNumber),
                    classTitle: data.classTitle,
                    subClasses: data.subClasses || []
                };
            }).sort((a, b) => a.classNumber - b.classNumber);

            this.renderList();
            this.setupEventListeners();
            this.updateSelectionUI(); // Başlangıç durumu

        } catch (error) {
            console.error("Nice sınıfları yüklenemedi:", error);
            this.elements.listContainer.innerHTML = `<div class="alert alert-danger">Veri yükleme hatası: ${error.message}</div>`;
        }
    }

    // Sol Panel: Sınıf Listesini Oluştur
    renderList() {
        let html = '';
        this.allData.forEach(cls => {
            html += `
            <div class="class-group-item" data-class-num="${cls.classNumber}" data-search="${(cls.classNumber + ' ' + cls.classTitle).toLowerCase()}">
                <div class="class-header d-flex align-items-center justify-content-between p-2 border-bottom bg-white">
                    <div class="d-flex align-items-center flex-grow-1 toggle-sublist" style="cursor:pointer;">
                        <span class="badge badge-info mr-2" style="width:30px;">${cls.classNumber}</span>
                        <span class="font-weight-bold text-dark small text-truncate" style="max-width: 250px;">${cls.classTitle}</span>
                        <i class="fas fa-chevron-down ml-auto text-muted transition-icon"></i>
                    </div>
                    <div class="ml-2">
                        <button class="btn btn-sm btn-outline-secondary select-all-btn" title="Tüm Sınıfı Seç/Kaldır">
                            <i class="fas fa-check-double"></i>
                        </button>
                    </div>
                </div>
                <div class="sub-class-list collapse bg-light" id="sublist-${cls.classNumber}">
                    ${cls.subClasses.map((sub, idx) => {
                        const code = `${cls.classNumber}-${idx + 1}`;
                        const is35_5 = code === '35-5';
                        const specialClass = is35_5 ? 'text-primary font-weight-bold bg-white border border-primary rounded' : '';
                        const icon = is35_5 ? '<i class="fas fa-shopping-cart mr-1"></i>' : '';
                        
                        return `
                        <div class="sub-item p-2 border-bottom pl-4 d-flex align-items-start ${specialClass}" 
                             data-code="${code}" data-text="${sub.subClassDescription}" style="cursor:pointer;">
                            <div class="custom-control custom-checkbox">
                                <input type="checkbox" class="custom-control-input class-checkbox" id="chk-main-${code}" value="${code}">
                                <label class="custom-control-label" for="chk-main-${code}" style="cursor:pointer; line-height:1.4;">
                                    ${icon} <span class="text-muted mr-1">(${code})</span> ${sub.subClassDescription}
                                </label>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        });
        this.elements.listContainer.innerHTML = html;
    }

    // Event Dinleyicileri (Tek bir merkezden yönetim)
    setupEventListeners() {
        // Liste üzerindeki tıklamalar (Delegation)
        this.elements.listContainer.addEventListener('click', (e) => {
            const target = e.target;

            // 1. Accordion Aç/Kapa
            const toggleBtn = target.closest('.toggle-sublist');
            if (toggleBtn) {
                const parent = toggleBtn.closest('.class-group-item');
                const list = parent.querySelector('.sub-class-list');
                const icon = toggleBtn.querySelector('.fa-chevron-down');
                
                const isShown = list.classList.contains('show');
                if (isShown) {
                    list.classList.remove('show');
                    icon.style.transform = 'rotate(0deg)';
                } else {
                    list.classList.add('show');
                    icon.style.transform = 'rotate(180deg)';
                }
                return;
            }

            // 2. Tüm Sınıfı Seç
            const selectAllBtn = target.closest('.select-all-btn');
            if (selectAllBtn) {
                e.stopPropagation();
                const parent = selectAllBtn.closest('.class-group-item');
                const classNum = parseInt(parent.dataset.classNum);
                this.toggleWholeClass(classNum);
                return;
            }

            // 3. Tekil Öğe Seçimi (Satıra tıklama)
            const subItem = target.closest('.sub-item');
            if (subItem && target.tagName !== 'INPUT' && target.tagName !== 'LABEL') {
                const checkbox = subItem.querySelector('.class-checkbox');
                // Eğer 35-5 ise checkbox'ı manuel tetikleme, özel fonksiyonu çağır
                if (subItem.dataset.code === '35-5') {
                    this.class35Manager.open();
                } else {
                    checkbox.checked = !checkbox.checked;
                    this.handleSelectionChange(checkbox.value, subItem.dataset.text, checkbox.checked);
                }
            }

            // 4. Checkbox Değişimi
            if (target.classList.contains('class-checkbox')) {
                if (target.value === '35-5') {
                    e.preventDefault(); // Checkbox'ın hemen işaretlenmesini engelle
                    this.class35Manager.open();
                } else {
                    const subItem = target.closest('.sub-item');
                    this.handleSelectionChange(target.value, subItem.dataset.text, target.checked);
                }
            }
        });

        // Sağ Panel: Kaldır Butonu
        if (this.elements.selectedContainer) {
            this.elements.selectedContainer.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.remove-selected-btn');
                if (removeBtn) {
                    this.removeSelection(removeBtn.dataset.key);
                }
            });
        }

        // Arama
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        }

        // Özel Sınıf Ekleme
        if (this.elements.customAddBtn) {
            this.elements.customAddBtn.addEventListener('click', () => this.addCustomClass());
        }
        
        // Karakter Sayacı
        if (this.elements.customInput) {
            this.elements.customInput.addEventListener('input', (e) => {
                if(this.elements.customCharCount) 
                    this.elements.customCharCount.textContent = e.target.value.length.toLocaleString('tr-TR');
            });
        }
    }

    // İş Mantığı
    handleSelectionChange(code, text, isSelected) {
        if (isSelected) {
            this.addSelection(code, code.split('-')[0], text);
        } else {
            this.removeSelection(code);
        }
    }

    addSelection(code, classNum, text) {
        this.selectedClasses[code] = { classNum: String(classNum), text };
        this.updateSelectionUI();
    }

    removeSelection(code) {
        if (this.selectedClasses[code]) {
            delete this.selectedClasses[code];
            this.updateSelectionUI();
        }
    }

    toggleWholeClass(classNum) {
        const classData = this.allData.find(c => c.classNumber === classNum);
        if (!classData) return;

        // Bu sınıfın hepsi seçili mi kontrol et
        const allCodes = classData.subClasses.map((_, i) => `${classNum}-${i + 1}`);
        const allSelected = allCodes.every(code => this.selectedClasses[code]);

        if (allSelected) {
            // Hepsini Kaldır
            allCodes.forEach(code => this.removeSelection(code));
        } else {
            // Hepsini Seç
            classData.subClasses.forEach((sub, i) => {
                const code = `${classNum}-${i + 1}`;
                if (code === '35-5') return; // 35-5 toplu seçimden hariç tutulur (özel işlem gerekir)
                this.addSelection(code, classNum, sub.subClassDescription);
            });
        }
    }

    addCustomClass() {
        const val = this.elements.customInput.value.trim();
        if (!val) return alert('Lütfen bir açıklama girin.');
        const code = `99-${Date.now()}`;
        this.addSelection(code, '99', val);
        this.elements.customInput.value = '';
        if(this.elements.customCharCount) this.elements.customCharCount.textContent = '0';
    }

    handleSearch(term) {
        term = term.toLowerCase();
        const items = this.elements.listContainer.querySelectorAll('.class-group-item');
        
        items.forEach(item => {
            const searchText = item.dataset.search;
            const subItems = item.querySelectorAll('.sub-item');
            let hasSubMatch = false;

            subItems.forEach(sub => {
                const text = sub.dataset.text.toLowerCase();
                const code = sub.dataset.code;
                if (text.includes(term) || code.includes(term)) {
                    sub.style.display = 'flex';
                    hasSubMatch = true;
                } else {
                    sub.style.display = 'none';
                }
            });

            if (searchText.includes(term) || hasSubMatch) {
                item.style.display = 'block';
                // Arama varsa aç
                if (term.length > 1) {
                    item.querySelector('.sub-class-list').classList.add('show');
                    item.querySelector('.fa-chevron-down').style.transform = 'rotate(180deg)';
                }
            } else {
                item.style.display = 'none';
            }
        });
    }

    // UI Güncelleme (Merkezi)
    updateSelectionUI() {
        // 1. Sol Paneldeki Checkboxları Güncelle
        const allCheckboxes = this.elements.listContainer.querySelectorAll('.class-checkbox');
        allCheckboxes.forEach(chk => {
            chk.checked = !!this.selectedClasses[chk.value];
            // Parent satırı boya
            const row = chk.closest('.sub-item');
            if (row) {
                if(chk.checked) row.classList.add('bg-primary-light');
                else row.classList.remove('bg-primary-light');
            }
        });

        // 2. Sağ Paneli Güncelle (Liste)
        if (this.elements.selectedContainer) {
            const count = Object.keys(this.selectedClasses).length;
            if (this.elements.selectedCountBadge) this.elements.selectedCountBadge.textContent = count;

            if (count === 0) {
                this.elements.selectedContainer.innerHTML = `
                    <div class="text-center text-muted mt-5">
                        <i class="fas fa-clipboard-list fa-3x mb-3 opacity-50"></i>
                        <p>Henüz sınıf seçilmedi.</p>
                    </div>`;
                // Dışarıya boş olduğunu bildir
                this.elements.selectedContainer.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }

            // Gruplama
            const grouped = {};
            Object.entries(this.selectedClasses).forEach(([code, data]) => {
                const num = data.classNum;
                if (!grouped[num]) grouped[num] = [];
                grouped[num].push({ code, text: data.text });
            });

            let html = '';
            // Sınıf numarasına göre sırala
            Object.keys(grouped).sort((a,b) => parseInt(a) - parseInt(b)).forEach(num => {
                const items = grouped[num];
                const is99 = num === '99';
                const badgeClass = is99 ? 'badge-danger' : 'badge-primary';
                
                html += `
                <div class="selected-group mb-3 animate-fade-in">
                    <h6 class="border-bottom pb-1 mb-2 font-weight-bold text-primary">Sınıf ${num}</h6>
                    ${items.map(item => `
                        <div class="selected-tag d-flex align-items-start mb-2 p-2 rounded border bg-white shadow-sm position-relative">
                            <span class="badge ${badgeClass} mr-2 mt-1">${is99 ? 'Özel' : item.code}</span>
                            <span class="flex-grow-1 text-dark small" style="line-height:1.4;">${item.text}</span>
                            <button class="btn btn-link text-danger p-0 ml-2 remove-selected-btn" data-key="${item.code}" style="text-decoration:none;">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>`;
            });

            this.elements.selectedContainer.innerHTML = html;
            // Değişikliği bildir (TaskSubmitHandler dinliyor olabilir)
            this.elements.selectedContainer.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // --- DIŞARI AÇILAN API ---

    getSelectedData() {
        return Object.entries(this.selectedClasses).map(([code, val]) => {
            return val.classNum === '99' ? `(99) ${val.text}` : `(${code}) ${val.text}`;
        });
    }

    setSelectedData(classesArray) {
        this.selectedClasses = {};
        if (!Array.isArray(classesArray)) return;

        classesArray.forEach(str => {
            // Regex: "(1-5) Açıklama" veya "(99) Özel Açıklama"
            const match = str.match(/^\((\d+(?:-\d+)?)\)\s*([\s\S]*)$/);
            if (match) {
                const code = match[1];
                const text = match[2];
                const classNum = code.includes('-') ? code.split('-')[0] : code;
                this.addSelection(code, classNum, text);
            }
        });
        this.updateSelectionUI();
    }

    clearAll() {
        this.selectedClasses = {};
        this.updateSelectionUI();
    }
}

// Global Örneği Başlat
const niceManager = new NiceClassificationManager();

// --- EXPORT FONKSİYONLAR (Eski yapıyı desteklemek için) ---

export async function initializeNiceClassification() {
    await niceManager.init();
}

export function getSelectedNiceClasses() {
    return niceManager.getSelectedData();
}

export function setSelectedNiceClasses(classes) {
    niceManager.setSelectedData(classes);
}

export function clearAllSelectedClasses() {
    niceManager.clearAll();
}

// Window Global Erişim (HTML onclick için gerekiyorsa - minimize edildi)
window.clearAllSelectedClasses = () => niceManager.clearAll();
window.clearNiceSearch = () => {
    const input = document.getElementById('niceClassSearch');
    if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input'));
    }
};