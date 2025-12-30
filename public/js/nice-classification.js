// public/js/nice-classification.js - Professional Neutral & Green Theme

import { db } from '../firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- TASARIM ENJEKSİYONU (CSS) ---
function injectNiceStyles() {
    const styleId = 'nice-classification-styles';
    if (document.getElementById(styleId)) return;

    const css = `
        :root {
            /* Nötr Griler */
            --nice-bg: #ffffff;
            --nice-bg-alt: #f8fafc; /* Slate 50 */
            --nice-border: #e2e8f0; /* Slate 200 */
            --nice-text-main: #1e293b; /* Slate 800 */
            --nice-text-muted: #64748b; /* Slate 500 */
            
            /* Kurumsal Mavi (Uygulama Teması) */
            --nice-brand: #1e3c72; /* Ana mavi */
            --nice-brand-hover: #2a5298; /* Açık mavi */
            --nice-brand-light: #eff6ff; /* Blue 50 */
            --nice-brand-border: #3b82f6; /* Blue 500 */
            
            /* Durum Renkleri */
            --nice-danger: #dc2626; /* Red 600 */
        }

        .nice-container { 
            font-family: 'Inter', system-ui, -apple-system, sans-serif; 
            color: var(--nice-text-main); 
            font-size: 14px;
        }

        /* --- BUTONLAR --- */
        .nice-btn {
            border: 1px solid var(--nice-border);
            background: #fff;
            color: var(--nice-text-main);
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex; align-items: center; justify-content: center;
        }
        .nice-btn:hover { background: var(--nice-bg-alt); border-color: #d4d4d8; }
        
        .nice-btn-primary {
            background: var(--nice-brand);
            border-color: var(--nice-brand);
            color: #fff;
        }
        .nice-btn-primary:hover { background: var(--nice-brand-hover); border-color: var(--nice-brand-hover); color: #fff; }

        .nice-btn-danger-outline {
            color: var(--nice-danger);
            border-color: #fecaca;
            background: #fff;
        }
        .nice-btn-danger-outline:hover { background: #fef2f2; border-color: var(--nice-danger); }

        .nice-btn-sm { padding: 4px 8px; font-size: 12px; }
        .nice-btn-block { width: 100%; display: flex; }

        /* --- LİSTE GRUBU KARTLARI --- */
        .nice-class-group {
            background: var(--nice-bg);
            border: 1px solid var(--nice-border);
            margin-bottom: 8px;
            border-radius: 8px;
            overflow: hidden;
            transition: box-shadow 0.2s, border-color 0.2s;
        }
        .nice-class-group:hover {
            border-color: #a1a1aa;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }
        
        /* Seçili Grup Stili */
        .nice-class-group.has-selection {
            border-color: var(--nice-brand-border);
            background-color: #fff;
            box-shadow: 0 0 0 1px var(--nice-brand-border);
        }
        .nice-class-group.has-selection .nice-class-header {
            background-color: var(--nice-brand-light);
            border-bottom: 1px solid var(--nice-brand-border);
        }
        .nice-class-group.has-selection .nice-badge {
            background-color: var(--nice-brand);
            color: white;
        }

        /* Başlık Alanı */
        .nice-class-header {
            padding: 12px 16px;
            background: var(--nice-bg-alt);
            cursor: pointer;
            display: flex; align-items: center; justify-content: space-between;
            border-bottom: 1px solid transparent;
            user-select: none;
        }
        
        .nice-header-left { display: flex; align-items: center; gap: 12px; flex: 1; }
        
        .nice-badge {
            background: #475569; /* Slate 600 */
            color: #fff;
            font-size: 12px; font-weight: 700;
            padding: 4px 8px; border-radius: 6px;
            min-width: 32px; text-align: center;
            transition: background 0.2s;
        }
        
        .nice-title { font-weight: 600; color: var(--nice-text-main); font-size: 14px; }
        
        .nice-icon-chevron { color: var(--nice-text-muted); transition: transform 0.2s; }
        .nice-class-group.open .nice-icon-chevron { transform: rotate(180deg); color: var(--nice-text-main); }

        /* Tümünü Seç Butonu */
        .nice-btn-select-all {
            background: transparent; border: 1px solid #d4d4d8; 
            color: var(--nice-text-muted); border-radius: 4px; 
            padding: 2px 8px; font-size: 11px; margin-right: 12px; 
            transition: all 0.2s;
        }
        .nice-btn-select-all:hover { border-color: var(--nice-brand); color: var(--nice-brand); background: #fff; }

        /* Alt Liste (Accordion) */
        .nice-sub-list { display: none; background: #fff; border-top: 1px solid var(--nice-border); }
        .nice-sub-list.open { display: block; animation: slideDown 0.15s ease-out; }

        .nice-sub-item {
            padding: 10px 16px 10px 50px;
            border-bottom: 1px solid var(--nice-border);
            cursor: pointer;
            display: flex; align-items: start; gap: 10px;
            transition: background 0.15s;
        }
        .nice-sub-item:last-child { border-bottom: none; }
        .nice-sub-item:hover { background: var(--nice-bg-alt); }
        
        .nice-sub-item.selected {
            background-color: var(--nice-brand-light);
        }
        .nice-sub-item.selected .nice-label {
            color: #1e3a8a; /* Koyu Mavi Metin */
            font-weight: 500;
        }

        /* Checkbox */
        .nice-checkbox {
            width: 16px; height: 16px;
            accent-color: var(--nice-brand);
            margin-top: 3px; cursor: pointer;
        }
        .nice-label {
            font-size: 13px; color: var(--nice-text-muted);
            line-height: 1.5; cursor: pointer; flex: 1;
        }

        /* --- SAĞ/ALT PANEL (SEÇİLENLER) --- */
        .selected-group-card {
            background: #fff;
            border: 1px solid var(--nice-border);
            border-radius: 8px;
            margin-bottom: 12px;
            overflow: hidden;
            box-shadow: 0 1px 2px rgba(0,0,0,0.03);
        }
        .selected-group-header {
            background: var(--nice-bg-alt);
            padding: 8px 16px;
            font-weight: 600;
            color: var(--nice-text-main);
            border-bottom: 1px solid var(--nice-border);
            font-size: 13px;
            display: flex; align-items: center;
        }
        .selected-group-header::before {
            content: ''; display: inline-block; width: 6px; height: 6px;
            background: var(--nice-brand); border-radius: 50%; margin-right: 10px;
        }
        
        .selected-item-row {
            padding: 8px 16px;
            border-bottom: 1px solid var(--nice-border);
            display: flex; align-items: flex-start; gap: 12px;
            transition: background 0.1s;
        }
        .selected-item-row:last-child { border-bottom: none; }
        .selected-item-row:hover { background: #fafafa; }

        .selected-code-badge {
            background: #e4e4e7; color: #3f3f46;
            font-size: 11px; font-weight: 700;
            padding: 2px 6px; border-radius: 4px;
            white-space: nowrap; font-family: monospace;
        }
        .selected-text { font-size: 13px; color: var(--nice-text-main); flex: 1; line-height: 1.5; }
        
        .btn-remove-item {
            color: #a1a1aa; border: none; background: none; 
            padding: 2px; cursor: pointer; transition: color 0.2s;
        }
        .btn-remove-item:hover { color: var(--nice-danger); }

        /* Input Alanları */
        .nice-input {
            width: 100%; padding: 8px 12px;
            border: 1px solid var(--nice-border);
            border-radius: 6px; font-size: 14px;
            outline: none; transition: border-color 0.2s;
        }
        .nice-input:focus { border-color: var(--nice-brand); box-shadow: 0 0 0 2px var(--nice-brand-light); }

        @keyframes slideDown { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
    `;
    const style = document.createElement('style');
    style.id = styleId; style.textContent = css; document.head.appendChild(style);
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
        <div id="${this.modalId}" class="modal fade show" tabindex="-1" style="display:block; background: rgba(0,0,0,0.6); z-index: 1060; backdrop-filter: blur(2px);">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content border-0 shadow-xl" style="border-radius: 12px;">
                    <div class="modal-header border-bottom py-3" style="background: #fff;">
                        <h5 class="modal-title font-weight-bold" style="color: #18181b;">
                            <span class="nice-badge mr-2" style="background: var(--nice-brand);">35-5</span> 
                            Müşterilerin Malları (Perakende)
                        </h5>
                        <button type="button" class="close" data-action="close" style="outline:none;">&times;</button>
                    </div>
                    <div class="modal-body" style="background: #f8fafc;">
                        <div class="row h-100">
                            <div class="col-lg-8 d-flex flex-column h-100">
                                <div class="bg-white p-3 rounded border mb-3">
                                    <input type="text" class="nice-input" id="c35-search" placeholder="🔍 Mal sınıfı ara (örn: ilaç, giysi)...">
                                </div>
                                <div class="bg-white rounded border flex-grow-1 overflow-auto nice-container" id="c35-list-container" style="max-height: 500px; padding: 10px;">
                                    ${this._generateListHTML()}
                                </div>
                                <div class="mt-3 d-flex gap-2">
                                    <input type="text" id="c35-custom-input" class="nice-input" placeholder="Listede olmayan özel bir mal...">
                                    <button class="nice-btn nice-btn-primary ml-2" id="c35-add-custom">Ekle</button>
                                </div>
                            </div>
                            <div class="col-lg-4 d-flex flex-column h-100">
                                <div class="bg-white rounded border h-100 d-flex flex-column">
                                    <div class="p-3 border-bottom d-flex justify-content-between align-items-center bg-light">
                                        <span class="font-weight-bold" style="color: #3f3f46;">Seçilen Mallar</span>
                                        <span class="nice-badge" id="c35-count">0</span>
                                    </div>
                                    <div class="flex-grow-1 overflow-auto p-0" id="c35-selected-container" style="max-height: 500px;"></div>
                                    <div class="p-3 border-top bg-light">
                                        <button class="nice-btn nice-btn-danger-outline nice-btn-block" id="c35-clear">Tümünü Temizle</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer border-top bg-white">
                        <button type="button" class="nice-btn" data-action="close">İptal</button>
                        <button type="button" class="nice-btn nice-btn-primary px-4" id="c35-save">Kaydet ve Ekle</button>
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
                            <input type="checkbox" class="nice-checkbox" id="chk-${code}" value="${code}">
                            <label class="nice-label ml-2" for="chk-${code}">
                                <span style="color:#a1a1aa; font-size:12px;">(${code})</span> ${sub.subClassDescription}
                            </label>
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
            if (target.dataset.action === 'close' || target.classList.contains('close')) return this.close();

            const header = target.closest('.c35-header');
            if (header) {
                const group = header.parentElement;
                const content = group.querySelector('.nice-sub-list');
                const isOpen = content.classList.contains('open');
                
                if (isOpen) { content.classList.remove('open'); group.classList.remove('open'); }
                else { content.classList.add('open'); group.classList.add('open'); }
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
            modal.querySelectorAll('.c35-group').forEach(group => {
                const title = group.querySelector('.nice-title').innerText.toLowerCase();
                const items = group.querySelectorAll('.c35-item-row');
                let match = false;
                
                items.forEach(item => {
                    if(item.innerText.toLowerCase().includes(term)) { item.style.display = 'flex'; match = true; } 
                    else { item.style.display = 'none'; }
                });

                if (title.includes(term) || match) {
                    group.style.display = 'block';
                    if (term.length > 2) {
                        group.classList.add('open');
                        group.querySelector('.nice-sub-list').classList.add('open');
                    }
                } else {
                    group.style.display = 'none';
                }
            });
        });

        document.getElementById('c35-save').addEventListener('click', () => {
            const items = Object.values(this.selectedItems);
            if (items.length === 0) return alert('Lütfen en az bir mal seçin.');
            
            const combinedText = `Müşterilerin malları; şu malların bir araya getirilmesi hizmetleri (nakliyesi hariç): ${items.join(', ')}`;
            
            this.parent.addSelection('35-5', '35', combinedText);
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

        document.getElementById('c35-clear').onclick = () => { 
            this.selectedItems = {}; 
            this.updateSelectedUI(); 
            modal.querySelectorAll('input').forEach(i=>i.checked=false); 
        };
    }

    toggleItem(code, text, isSelected) {
        if (isSelected) this.selectedItems[code] = text;
        else delete this.selectedItems[code];
        this.updateSelectedUI();
    }

    updateSelectedUI() {
        const container = document.getElementById('c35-selected-container');
        document.getElementById('c35-count').innerText = Object.keys(this.selectedItems).length;
        container.innerHTML = Object.entries(this.selectedItems).map(([k,v]) => 
            `<div class="selected-item-row">
                <span class="selected-code-badge">${k}</span>
                <span class="selected-text">${v}</span>
                <button class="btn-remove-item" onclick="document.getElementById('chk-${k}').click()">&times;</button>
            </div>`
        ).join('');
    }

    close() { document.getElementById(this.modalId)?.remove(); document.body.classList.remove('modal-open'); }
}

/**
 * Ana Nice Sınıflandırma Yöneticisi
 */
class NiceClassificationManager {
    constructor() {
        this.allData = [];
        this.selectedClasses = {};
        this.elements = {}; 
        this.class35Manager = new Class35_5Manager(this);
    }

    async init() {
        this.elements = {
            listContainer: document.getElementById('niceClassificationList'),
            selectedContainer: document.getElementById('selectedNiceClasses'),
            searchInput: document.getElementById('niceClassSearch'),
            selectedCountBadge: document.getElementById('selectedClassCount'),
            customInput: document.getElementById('customClassInput'),
            customAddBtn: document.getElementById('addCustomClassBtn'),
            customCharCount: document.getElementById('customClassCharCount')
        };

        if (!this.elements.listContainer) return;

        this.elements.listContainer.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-secondary"></div><div class="mt-2 text-muted">Veriler yükleniyor...</div></div>`;

        try {
            injectNiceStyles();
            const snapshot = await getDocs(collection(db, "niceClassification"));
            this.allData = snapshot.docs.map(doc => ({ ...doc.data(), classNumber: parseInt(doc.data().classNumber) })).sort((a, b) => a.classNumber - b.classNumber);

            this.renderList();
            this.setupEventListeners();
            this.updateSelectionUI();

        } catch (error) {
            console.error("Nice error:", error);
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
                        <button class="nice-btn-select-all mr-2" title="Tümünü Seç"><i class="fas fa-check-double"></i></button>
                        <i class="fas fa-chevron-down nice-icon-chevron"></i>
                    </div>
                </div>
                <div class="nice-sub-list">
                    ${cls.subClasses.map((sub, idx) => {
                        const code = `${cls.classNumber}-${idx + 1}`;
                        const is35_5 = code === '35-5';
                        const extraClass = is35_5 ? 'bg-light font-weight-bold' : '';
                        const icon = is35_5 ? '<i class="fas fa-shopping-cart text-muted mr-2"></i>' : '';
                        
                        return `
                        <div class="nice-sub-item sub-item ${extraClass}" data-code="${code}" data-text="${sub.subClassDescription}">
                            <input type="checkbox" class="nice-checkbox class-checkbox" id="chk-main-${code}" value="${code}">
                            <label class="nice-label ml-2" for="chk-main-${code}">
                                ${icon}<span class="text-muted small mr-1">(${code})</span> ${sub.subClassDescription}
                            </label>
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

            // Tümünü Seç
            const selectAllBtn = target.closest('.nice-btn-select-all');
            if (selectAllBtn) {
                e.stopPropagation();
                this.toggleWholeClass(parseInt(selectAllBtn.closest('.nice-class-group').dataset.classNum));
                return;
            }

            // Accordion Aç/Kapa
            const header = target.closest('.nice-class-header');
            if (header) {
                const group = header.parentElement;
                const list = group.querySelector('.nice-sub-list');
                const isOpen = list.classList.contains('open');
                
                if (isOpen) { list.classList.remove('open'); group.classList.remove('open'); }
                else { list.classList.add('open'); group.classList.add('open'); }
                return;
            }

            // Satır Tıklama
            const subItem = target.closest('.sub-item');
            if (subItem && target.tagName !== 'INPUT' && target.tagName !== 'LABEL') {
                const checkbox = subItem.querySelector('.class-checkbox');
                if(subItem.dataset.code === '35-5') {
                    this.class35Manager.open();
                } else {
                    checkbox.checked = !checkbox.checked;
                    this.handleCheckboxAction(checkbox.value, subItem.dataset.text, checkbox.checked);
                }
            }

            // Checkbox Tıklama
            if (target.classList.contains('class-checkbox')) {
                if (target.value === '35-5') {
                    e.preventDefault();
                    this.class35Manager.open();
                } else {
                    const subItem = target.closest('.sub-item');
                    this.handleCheckboxAction(target.value, subItem.dataset.text, target.checked);
                }
            }
        });

        // Sağ Panel Kaldır
        if (this.elements.selectedContainer) {
            this.elements.selectedContainer.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.btn-remove-item');
                if (removeBtn) this.removeSelection(removeBtn.dataset.key);
            });
        }

        // Arama
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        }

        // Özel Ekle
        if (this.elements.customAddBtn) {
            this.elements.customAddBtn.addEventListener('click', () => {
                const val = this.elements.customInput.value.trim();
                if(val) {
                    this.addSelection(`99-${Date.now()}`, '99', val);
                    this.elements.customInput.value = '';
                }
            });
        }
    }

    handleCheckboxAction(code, text, isChecked) {
        if (code === '35-5') this.class35Manager.open();
        else if (isChecked) this.addSelection(code, code.split('-')[0], text);
        else this.removeSelection(code);
    }

    addSelection(code, classNum, text) {
        this.selectedClasses[code] = { classNum: String(classNum), text };
        this.updateSelectionUI();
    }

    removeSelection(code) {
        delete this.selectedClasses[code];
        this.updateSelectionUI();
    }

    toggleWholeClass(classNum) {
        const classData = this.allData.find(c => c.classNumber === classNum);
        if (!classData) return;
        const subCodes = classData.subClasses.map((_, i) => `${classNum}-${i+1}`).filter(c => c !== '35-5');
        
        const allSelected = subCodes.every(c => this.selectedClasses[c]);
        
        if (allSelected) subCodes.forEach(c => this.removeSelection(c));
        else {
            classData.subClasses.forEach((sub, i) => {
                const c = `${classNum}-${i+1}`;
                if (c !== '35-5') this.addSelection(c, classNum, sub.subClassDescription);
            });
        }
    }

    handleSearch(term) {
        term = term.toLowerCase();
        const groups = this.elements.listContainer.querySelectorAll('.nice-class-group');
        
        groups.forEach(group => {
            const searchText = group.dataset.search;
            const items = group.querySelectorAll('.nice-sub-item');
            let match = false;

            items.forEach(item => {
                if (item.innerText.toLowerCase().includes(term) || item.dataset.code.includes(term)) {
                    item.style.display = 'flex'; match = true;
                } else {
                    item.style.display = 'none';
                }
            });

            if (searchText.includes(term) || match) {
                group.style.display = 'block';
                if (term.length > 2) {
                    group.classList.add('open');
                    group.querySelector('.nice-sub-list').classList.add('open');
                }
            } else {
                group.style.display = 'none';
            }
        });
    }

    updateSelectionUI() {
        const allCheckboxes = this.elements.listContainer.querySelectorAll('.class-checkbox');
        const groups = this.elements.listContainer.querySelectorAll('.nice-class-group');
        
        groups.forEach(g => g.classList.remove('has-selection'));

        allCheckboxes.forEach(chk => {
            const isSelected = !!this.selectedClasses[chk.value];
            chk.checked = isSelected;
            
            const row = chk.closest('.nice-sub-item');
            if (row) {
                if(isSelected) row.classList.add('selected');
                else row.classList.remove('selected');
            }

            if (isSelected) {
                const group = chk.closest('.nice-class-group');
                if (group) group.classList.add('has-selection');
            }
        });

        if (this.elements.selectedContainer) {
            const count = Object.keys(this.selectedClasses).length;
            if (this.elements.selectedCountBadge) this.elements.selectedCountBadge.textContent = count;

            if (count === 0) {
                this.elements.selectedContainer.innerHTML = `<div class="text-center text-muted py-4"><i class="fas fa-box-open fa-2x mb-2 opacity-50"></i><p>Henüz sınıf seçilmedi.</p></div>`;
                this.elements.selectedContainer.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }

            const grouped = {};
            Object.entries(this.selectedClasses).forEach(([code, val]) => {
                if (!grouped[val.classNum]) grouped[val.classNum] = [];
                grouped[val.classNum].push({code, text: val.text});
            });

            let html = '';
            Object.keys(grouped).sort((a,b) => a-b).forEach(num => {
                html += `
                <div class="selected-group-card">
                    <div class="selected-group-header">Sınıf ${num}</div>
                    <div>
                        ${grouped[num].map(item => `
                            <div class="selected-item-row">
                                <span class="selected-code-badge">${item.code}</span>
                                <span class="selected-text">${item.text}</span>
                                <button class="btn-remove-item" data-key="${item.code}" title="Kaldır">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
            });

            this.elements.selectedContainer.innerHTML = html;
            this.elements.selectedContainer.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // --- API Methods ---
    getSelectedData() {
        return Object.entries(this.selectedClasses).map(([k, v]) => 
            v.classNum === '99' ? `(99) ${v.text}` : `(${k}) ${v.text}`
        );
    }

    setSelectedData(arr) {
        this.selectedClasses = {};
        if (Array.isArray(arr)) {
            arr.forEach(s => {
                const m = s.match(/^\((\d+(?:-\d+)?)\)\s*([\s\S]*)$/);
                if (m) this.addSelection(m[1], m[1].split('-')[0], m[2]);
            });
        }
        this.updateSelectionUI();
    }

    clearAll() { this.selectedClasses = {}; this.updateSelectionUI(); }
}

const niceManager = new NiceClassificationManager();

export async function initializeNiceClassification() { await niceManager.init(); }
export function getSelectedNiceClasses() { return niceManager.getSelectedData(); }
export function setSelectedNiceClasses(classes) { niceManager.setSelectedData(classes); }
export function clearAllSelectedClasses() { niceManager.clearAll(); }

window.clearAllSelectedClasses = () => niceManager.clearAll();
window.clearNiceSearch = () => {
    const input = document.getElementById('niceClassSearch');
    if(input) { input.value = ''; input.dispatchEvent(new Event('input')); }
};