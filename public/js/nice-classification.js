// public/js/nice-classification.js - DOM Element Selection Fix

import { db } from '../firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- MODERN STİLLERİ ENJEKTE ET ---
function injectNiceStyles() {
    const styleId = 'nice-classification-styles';
    if (document.getElementById(styleId)) return;

    const css = `
        /* Genel Konteyner */
        .nice-container {
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        /* Liste Öğesi (Ana Sınıf) */
        .nice-class-group {
            background: #fff;
            border: 1px solid #e2e8f0;
            margin-bottom: 8px;
            border-radius: 8px;
            overflow: hidden;
            transition: box-shadow 0.2s, border-color 0.2s;
        }
        .nice-class-group:hover {
            border-color: #cbd5e0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }
        .nice-class-group.active-group {
            border-color: #3182ce;
            box-shadow: 0 0 0 1px #3182ce;
        }

        /* Başlık (Header) */
        .nice-class-header {
            padding: 12px 16px;
            background: #f8fafc;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            user-select: none;
        }
        .nice-class-header:hover {
            background: #f1f5f9;
        }
        
        /* Başlık İçeriği */
        .nice-header-left {
            display: flex;
            align-items: center;
            gap: 12px;
            flex: 1;
            min-width: 0; /* Text truncate için */
        }
        .nice-badge {
            background: #3b82f6;
            color: white;
            font-size: 12px;
            font-weight: 700;
            padding: 4px 8px;
            border-radius: 6px;
            min-width: 28px;
            text-align: center;
        }
        .nice-title {
            font-size: 14px;
            font-weight: 600;
            color: #334155;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        /* İkonlar ve Butonlar */
        .nice-icon-chevron {
            color: #94a3b8;
            transition: transform 0.2s ease;
        }
        .nice-class-group.open .nice-icon-chevron {
            transform: rotate(180deg);
            color: #3182ce;
        }
        
        .nice-btn-select-all {
            padding: 4px 8px;
            border-radius: 4px;
            color: #64748b;
            background: transparent;
            border: 1px solid transparent;
            transition: all 0.2s;
        }
        .nice-btn-select-all:hover {
            background: #e2e8f0;
            color: #1e293b;
        }

        /* Alt Liste (Accordion Content) */
        .nice-sub-list {
            display: none;
            border-top: 1px solid #e2e8f0;
            background: #fff;
            animation: slideDown 0.2s ease-out;
        }
        .nice-sub-list.open {
            display: block;
        }

        /* Alt Öğe (Sub Item) */
        .nice-sub-item {
            padding: 10px 16px 10px 48px; /* Soldan girintili */
            border-bottom: 1px solid #f1f5f9;
            cursor: pointer;
            transition: background 0.15s;
            position: relative;
        }
        .nice-sub-item:last-child {
            border-bottom: none;
        }
        .nice-sub-item:hover {
            background: #f8fafc;
        }
        .nice-sub-item.selected {
            background: #eff6ff;
        }
        
        /* Checkbox Tasarımı */
        .nice-checkbox-wrapper {
            display: flex;
            align-items: flex-start;
            gap: 10px;
        }
        .nice-checkbox {
            margin-top: 3px;
            cursor: pointer;
            accent-color: #3182ce;
            width: 16px;
            height: 16px;
        }
        .nice-label {
            font-size: 13px;
            color: #475569;
            line-height: 1.5;
            cursor: pointer;
        }
        .nice-code {
            color: #94a3b8;
            font-size: 12px;
            margin-right: 4px;
        }

        /* Sağ Panel (Seçilenler) */
        .selected-item-card {
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 10px;
            display: flex;
            align-items: flex-start;
            gap: 10px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
            transition: transform 0.1s;
        }
        .selected-item-card:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
        }
        .selected-badge {
            background: #e0f2fe;
            color: #0369a1;
            font-size: 11px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 4px;
            white-space: nowrap;
        }
        .selected-badge.custom {
            background: #fee2e2;
            color: #b91c1c;
        }
        .selected-text {
            font-size: 13px;
            color: #334155;
            flex: 1;
        }
        .btn-remove {
            color: #94a3b8;
            background: none;
            border: none;
            padding: 0;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
        }
        .btn-remove:hover {
            color: #ef4444;
        }

        @keyframes slideDown {
            from { opacity: 0; transform: translateY(-5px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
}

/**
 * 35-5 (Perakende Hizmetleri) Özel Modal Yöneticisi
 */
class Class35_5Manager {
    constructor(parentManager) {
        this.parent = parentManager; 
        this.modalData = []; 
        this.selectedItems = {}; 
        this.modalId = 'class35-5-modal';
    }

    async open() {
        this.modalData = this.parent.allData.filter(cls => cls.classNumber >= 1 && cls.classNumber <= 34);
        this.selectedItems = {}; 
        this.renderModal();
        this.setupEvents();
    }

    renderModal() {
        const modalHTML = `
        <div id="${this.modalId}" class="modal fade show" tabindex="-1" style="display:block; background: rgba(0,0,0,0.5); z-index: 1060;">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content border-0 shadow-lg" style="border-radius: 12px;">
                    <div class="modal-header border-bottom bg-white py-3">
                        <h5 class="modal-title font-weight-bold text-dark">
                            <span class="badge badge-primary mr-2" style="font-size:14px;">35-5</span> 
                            Müşterilerin Malları - Mal Seçimi
                        </h5>
                        <button type="button" class="close" data-action="close" style="outline:none;">&times;</button>
                    </div>
                    <div class="modal-body bg-light">
                        <div class="row h-100">
                            <div class="col-lg-8 d-flex flex-column h-100">
                                <div class="bg-white p-3 rounded shadow-sm mb-3">
                                    <input type="text" class="form-control border-0 bg-light" id="c35-search" 
                                           placeholder="🔍 Mal sınıfı ara (örn: ilaç, giysi)..." style="font-size:14px;">
                                </div>
                                <div class="bg-white rounded shadow-sm flex-grow-1 overflow-auto nice-container" id="c35-list-container" style="max-height: 500px; padding: 10px;">
                                    ${this._generateListHTML()}
                                </div>
                                <div class="mt-3">
                                    <div class="input-group">
                                        <input type="text" id="c35-custom-input" class="form-control border-0 shadow-sm" placeholder="Listede olmayan özel bir mal...">
                                        <div class="input-group-append">
                                            <button class="btn btn-primary shadow-sm" id="c35-add-custom">Ekle</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-lg-4 d-flex flex-column h-100">
                                <div class="bg-white rounded shadow-sm h-100 d-flex flex-column">
                                    <div class="p-3 border-bottom d-flex justify-content-between align-items-center">
                                        <span class="font-weight-bold text-secondary">Seçilenler</span>
                                        <span class="badge badge-pill badge-primary" id="c35-count">0</span>
                                    </div>
                                    <div class="flex-grow-1 overflow-auto p-2" id="c35-selected-container" style="max-height: 500px;"></div>
                                    <div class="p-3 border-top">
                                        <button class="btn btn-outline-danger btn-sm btn-block" id="c35-clear">Hepsini Temizle</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer border-top bg-white">
                        <button type="button" class="btn btn-light text-secondary font-weight-bold" data-action="close">İptal</button>
                        <button type="button" class="btn btn-primary px-4 font-weight-bold shadow-sm" id="c35-save">Kaydet ve Ekle</button>
                    </div>
                </div>
            </div>
        </div>`;

        const oldModal = document.getElementById(this.modalId);
        if (oldModal) oldModal.remove();

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        document.body.classList.add('modal-open');
        this.updateSelectedUI();
    }

    _generateListHTML() {
        return this.modalData.map(cls => `
            <div class="nice-class-group c35-group" data-class="${cls.classNumber}">
                <div class="nice-class-header c35-header">
                    <div class="nice-header-left">
                        <span class="nice-badge">${cls.classNumber}</span>
                        <span class="nice-title">${cls.classTitle}</span>
                    </div>
                    <i class="fas fa-chevron-down nice-icon-chevron"></i>
                </div>
                <div class="nice-sub-list" id="c35-sub-${cls.classNumber}">
                    ${cls.subClasses.map((sub, idx) => {
                        const code = `${cls.classNumber}-${idx + 1}`;
                        return `
                        <div class="nice-sub-item c35-item-row" data-code="${code}" data-text="${sub.subClassDescription}">
                            <div class="nice-checkbox-wrapper">
                                <input type="checkbox" class="nice-checkbox" id="chk-${code}" value="${code}">
                                <label class="nice-label" for="chk-${code}">
                                    <span class="nice-code">(${code})</span> ${sub.subClassDescription}
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
        
        modal.addEventListener('click', (e) => {
            const target = e.target;

            if (target.dataset.action === 'close' || target.classList.contains('close')) {
                this.close();
                return;
            }

            const header = target.closest('.c35-header');
            if (header) {
                const group = header.parentElement;
                const content = group.querySelector('.nice-sub-list');
                const isOpen = content.classList.contains('open');
                
                if (isOpen) {
                    content.classList.remove('open');
                    group.classList.remove('open');
                } else {
                    content.classList.add('open');
                    group.classList.add('open');
                }
                return;
            }

            const itemRow = target.closest('.c35-item-row');
            if (itemRow && target.tagName !== 'INPUT' && target.tagName !== 'LABEL') {
                const checkbox = itemRow.querySelector('input[type="checkbox"]');
                checkbox.checked = !checkbox.checked;
                this.toggleItem(checkbox.value, itemRow.dataset.text, checkbox.checked);
            }
            
            if (target.tagName === 'INPUT' && target.type === 'checkbox') {
                const itemRow = target.closest('.c35-item-row');
                this.toggleItem(target.value, itemRow.dataset.text, target.checked);
            }
        });

        document.getElementById('c35-search').addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const groups = modal.querySelectorAll('.c35-group');
            
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
                
                const title = group.querySelector('.nice-title').innerText.toLowerCase();
                if (title.includes(term) || hasMatch) {
                    group.style.display = '';
                    if (term.length > 2) {
                        group.querySelector('.nice-sub-list').classList.add('open');
                        group.classList.add('open');
                    }
                } else {
                    group.style.display = 'none';
                }
            });
        });

        document.getElementById('c35-save').addEventListener('click', () => {
            const count = Object.keys(this.selectedItems).length;
            if (count === 0) return alert('Lütfen en az bir mal seçin.');
            
            this.parent.addSelection('35-5', '35', 'Müşterilerin malları (seçilen mallar için)');
            Object.entries(this.selectedItems).forEach(([code, text]) => {
                this.parent.addSelection(code, code.split('-')[0], text);
            });

            this.close();
        });
        
        document.getElementById('c35-add-custom').addEventListener('click', () => {
            const input = document.getElementById('c35-custom-input');
            const val = input.value.trim();
            if(!val) return;
            const customCode = `99-${Date.now()}`;
            this.toggleItem(customCode, val, true);
            input.value = '';
        });

        document.getElementById('c35-clear').addEventListener('click', () => {
            this.selectedItems = {};
            this.updateSelectedUI();
            const checkboxes = modal.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
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
                <div class="selected-item-card">
                    <span class="selected-badge">${code}</span>
                    <span class="selected-text text-truncate">${text}</span>
                    <button class="btn-remove" onclick="document.getElementById('chk-${code}').click()">&times;</button>
                </div>
            `;
        });
        container.innerHTML = html || '<div class="text-muted text-center mt-4 small">Henüz seçim yapılmadı</div>';
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
        this.selectedClasses = {};
        this.elements = {}; // Elemanları burada tutuyoruz ama içi boş başlıyor
        this.class35Manager = new Class35_5Manager(this);
    }

    async init() {
        // !!! KRİTİK DEĞİŞİKLİK: DOM elementlerini INIT anında seçiyoruz !!!
        this.elements = {
            listContainer: document.getElementById('niceClassificationList'),
            selectedContainer: document.getElementById('selectedNiceClasses'),
            searchInput: document.getElementById('niceClassSearch'),
            selectedCountBadge: document.getElementById('selectedClassCount'),
            customInput: document.getElementById('customClassInput'),
            customAddBtn: document.getElementById('addCustomClassBtn'),
            customCharCount: document.getElementById('customClassCharCount')
        };

        if (!this.elements.listContainer) {
            console.warn('NiceClassification: Container not found yet.');
            return;
        }

        this.elements.listContainer.innerHTML = `
            <div class="text-center p-5">
                <div class="spinner-border text-primary mb-3"></div>
                <div class="text-muted">Sınıflandırma verileri yükleniyor...</div>
            </div>`;

        try {
            injectNiceStyles();

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
            this.updateSelectionUI();

        } catch (error) {
            console.error("Nice sınıfları yüklenemedi:", error);
            this.elements.listContainer.innerHTML = `<div class="alert alert-danger m-3">Veri yükleme hatası: ${error.message}</div>`;
        }
    }

    renderList() {
        let html = '<div class="nice-container">';
        this.allData.forEach(cls => {
            html += `
            <div class="nice-class-group" data-class-num="${cls.classNumber}" data-search="${(cls.classNumber + ' ' + cls.classTitle).toLowerCase()}">
                <div class="nice-class-header toggle-sublist">
                    <div class="nice-header-left">
                        <span class="nice-badge">${cls.classNumber}</span>
                        <span class="nice-title">${cls.classTitle}</span>
                    </div>
                    <div class="d-flex align-items-center">
                        <button class="nice-btn-select-all mr-2" title="Tüm Sınıfı Seç/Kaldır">
                            <i class="fas fa-check-double"></i>
                        </button>
                        <i class="fas fa-chevron-down nice-icon-chevron"></i>
                    </div>
                </div>
                <div class="nice-sub-list">
                    ${cls.subClasses.map((sub, idx) => {
                        const code = `${cls.classNumber}-${idx + 1}`;
                        const is35_5 = code === '35-5';
                        const extraClass = is35_5 ? 'bg-light font-weight-bold text-primary' : '';
                        
                        return `
                        <div class="nice-sub-item sub-item ${extraClass}" data-code="${code}" data-text="${sub.subClassDescription}">
                            <div class="nice-checkbox-wrapper">
                                <input type="checkbox" class="nice-checkbox class-checkbox" id="chk-main-${code}" value="${code}">
                                <label class="nice-label" for="chk-main-${code}">
                                    <span class="nice-code">(${code})</span> ${sub.subClassDescription}
                                </label>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        });
        html += '</div>';
        this.elements.listContainer.innerHTML = html;
    }

    setupEventListeners() {
        if (!this.elements.listContainer) return;

        this.elements.listContainer.addEventListener('click', (e) => {
            const target = e.target;

            const selectAllBtn = target.closest('.nice-btn-select-all');
            if (selectAllBtn) {
                e.stopPropagation();
                const parent = selectAllBtn.closest('.nice-class-group');
                const classNum = parseInt(parent.dataset.classNum);
                this.toggleWholeClass(classNum);
                return;
            }

            const header = target.closest('.nice-class-header');
            if (header) {
                const group = header.parentElement;
                const list = group.querySelector('.nice-sub-list');
                
                const isOpen = list.classList.contains('open');
                if (isOpen) {
                    list.classList.remove('open');
                    group.classList.remove('open');
                } else {
                    list.classList.add('open');
                    group.classList.add('open');
                }
                return;
            }

            const subItem = target.closest('.sub-item');
            if (subItem && target.tagName !== 'INPUT' && target.tagName !== 'LABEL') {
                const code = subItem.dataset.code;
                if (code === '35-5') {
                    this.class35Manager.open();
                } else {
                    const checkbox = subItem.querySelector('.class-checkbox');
                    checkbox.checked = !checkbox.checked;
                    this.handleSelectionChange(checkbox.value, subItem.dataset.text, checkbox.checked);
                }
            }

            if (target.classList.contains('class-checkbox')) {
                if (target.value === '35-5') {
                    e.preventDefault();
                    this.class35Manager.open();
                } else {
                    const subItem = target.closest('.sub-item');
                    this.handleSelectionChange(target.value, subItem.dataset.text, target.checked);
                }
            }
        });

        if (this.elements.selectedContainer) {
            this.elements.selectedContainer.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.btn-remove');
                if (removeBtn) {
                    const key = removeBtn.dataset.key;
                    if (key) this.removeSelection(key);
                }
            });
        }

        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        }

        if (this.elements.customAddBtn) {
            this.elements.customAddBtn.addEventListener('click', () => this.addCustomClass());
        }
    }

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

        const allCodes = classData.subClasses.map((_, i) => `${classNum}-${i + 1}`);
        const allSelected = allCodes.every(code => this.selectedClasses[code] || code === '35-5');

        if (allSelected) {
            allCodes.forEach(code => this.removeSelection(code));
        } else {
            classData.subClasses.forEach((sub, i) => {
                const code = `${classNum}-${i + 1}`;
                if (code === '35-5') return;
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
        const items = this.elements.listContainer.querySelectorAll('.nice-class-group');
        
        items.forEach(item => {
            const searchText = item.dataset.search;
            const subItems = item.querySelectorAll('.nice-sub-item');
            let hasSubMatch = false;

            subItems.forEach(sub => {
                const text = sub.dataset.text.toLowerCase();
                const code = sub.dataset.code;
                if (text.includes(term) || code.includes(term)) {
                    sub.style.display = 'block';
                    hasSubMatch = true;
                } else {
                    sub.style.display = 'none';
                }
            });

            if (searchText.includes(term) || hasSubMatch) {
                item.style.display = 'block';
                if (term.length > 2) {
                    item.querySelector('.nice-sub-list').classList.add('open');
                    item.classList.add('open');
                }
            } else {
                item.style.display = 'none';
            }
        });
    }

    updateSelectionUI() {
        const allCheckboxes = this.elements.listContainer.querySelectorAll('.class-checkbox');
        allCheckboxes.forEach(chk => {
            chk.checked = !!this.selectedClasses[chk.value];
            const row = chk.closest('.nice-sub-item');
            if (row) {
                if(chk.checked) row.classList.add('selected');
                else row.classList.remove('selected');
            }
        });

        if (this.elements.selectedContainer) {
            const count = Object.keys(this.selectedClasses).length;
            if (this.elements.selectedCountBadge) this.elements.selectedCountBadge.textContent = count;

            if (count === 0) {
                this.elements.selectedContainer.innerHTML = `
                    <div class="text-center text-muted mt-5">
                        <i class="fas fa-clipboard-list fa-3x mb-3 text-secondary opacity-50"></i>
                        <p>Henüz sınıf seçilmedi.</p>
                    </div>`;
                this.elements.selectedContainer.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }

            const grouped = {};
            Object.entries(this.selectedClasses).forEach(([code, data]) => {
                const num = data.classNum;
                if (!grouped[num]) grouped[num] = [];
                grouped[num].push({ code, text: data.text });
            });

            let html = '';
            Object.keys(grouped).sort((a,b) => parseInt(a) - parseInt(b)).forEach(num => {
                const items = grouped[num];
                const is99 = num === '99';
                const badgeClass = is99 ? 'custom' : '';
                
                html += `
                <div class="mb-3">
                    <h6 class="border-bottom pb-2 mb-2 font-weight-bold text-dark" style="font-size:14px;">Sınıf ${num}</h6>
                    ${items.map(item => `
                        <div class="selected-item-card">
                            <span class="selected-badge ${badgeClass}">${is99 ? 'Özel' : item.code}</span>
                            <span class="selected-text">${item.text}</span>
                            <button class="btn-remove" data-key="${item.code}" title="Kaldır">&times;</button>
                        </div>
                    `).join('')}
                </div>`;
            });

            this.elements.selectedContainer.innerHTML = html;
            this.elements.selectedContainer.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // --- API Methods ---
    getSelectedData() {
        return Object.entries(this.selectedClasses).map(([code, val]) => {
            return val.classNum === '99' ? `(99) ${val.text}` : `(${code}) ${val.text}`;
        });
    }

    setSelectedData(classesArray) {
        this.selectedClasses = {};
        if (!Array.isArray(classesArray)) return;

        classesArray.forEach(str => {
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

// Global Örnek
const niceManager = new NiceClassificationManager();

// Exportlar
export async function initializeNiceClassification() { await niceManager.init(); }
export function getSelectedNiceClasses() { return niceManager.getSelectedData(); }
export function setSelectedNiceClasses(classes) { niceManager.setSelectedData(classes); }
export function clearAllSelectedClasses() { niceManager.clearAll(); }

// Window Helpers
window.clearAllSelectedClasses = () => niceManager.clearAll();
window.clearNiceSearch = () => {
    const input = document.getElementById('niceClassSearch');
    if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input'));
    }
};