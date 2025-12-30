// public/js/nice-classification.js - FINAL STABLE (Slate & Emerald Theme)

import { db } from '../firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- TASARIM (CSS) ---
function injectNiceStyles() {
    const styleId = 'nice-classification-styles';
    if (document.getElementById(styleId)) return;

    const css = `
        :root {
            --nice-primary: #334155; /* Slate 700 */
            --nice-secondary: #64748b; /* Slate 500 */
            --nice-accent: #10b981; /* Emerald 500 */
            --nice-accent-light: #ecfdf5; /* Emerald 50 */
            --nice-border: #e2e8f0; /* Slate 200 */
            --nice-bg-hover: #f8fafc; /* Slate 50 */
            --nice-danger: #ef4444; /* Red 500 */
        }

        .nice-container { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: var(--nice-primary); }

        /* ANA LİSTE KARTLARI */
        .nice-class-group {
            background: #fff;
            border: 1px solid var(--nice-border);
            margin-bottom: 12px;
            border-radius: 8px;
            overflow: hidden;
            transition: all 0.2s ease;
            box-shadow: 0 1px 2px rgba(0,0,0,0.02);
        }
        
        .nice-class-group:hover {
            border-color: #cbd5e1;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
        }

        .nice-class-group.has-selection {
            border-color: var(--nice-accent);
            background-color: #f0fdf4;
            box-shadow: 0 0 0 1px var(--nice-accent);
        }
        .nice-class-group.has-selection .nice-class-header {
            background-color: #f0fdf4;
            border-bottom-color: #bbf7d0;
        }
        .nice-class-group.has-selection .nice-badge {
            background-color: var(--nice-accent);
        }

        /* HEADER */
        .nice-class-header {
            padding: 14px 18px;
            background: #fff;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid transparent;
        }
        .nice-class-header:hover { background: var(--nice-bg-hover); }
        
        .nice-header-left { display: flex; align-items: center; gap: 12px; flex: 1; }
        
        .nice-badge {
            background: #475569;
            color: #fff;
            font-size: 12px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 6px;
            min-width: 32px;
            text-align: center;
            transition: background 0.2s;
        }
        
        .nice-title { font-size: 15px; font-weight: 600; color: #1e293b; }
        .nice-icon-chevron { color: #94a3b8; transition: transform 0.2s; }
        .nice-class-group.open .nice-icon-chevron { transform: rotate(180deg); color: var(--nice-accent); }

        /* BUTONLAR */
        .nice-btn-select-all {
            background: transparent; border: 1px solid #cbd5e1; color: #64748b;
            border-radius: 4px; padding: 4px 8px; transition: all 0.2s;
        }
        .nice-btn-select-all:hover { border-color: var(--nice-accent); color: var(--nice-accent); background: #fff; }

        /* ALT LİSTE */
        .nice-sub-list { display: none; background: #fff; border-top: 1px solid var(--nice-border); }
        .nice-sub-list.open { display: block; animation: niceSlideDown 0.2s ease-out; }

        .nice-sub-item {
            padding: 12px 20px 12px 52px;
            border-bottom: 1px solid #f1f5f9;
            cursor: pointer;
            transition: background 0.15s;
            position: relative;
            display: flex; align-items: start; gap: 10px;
        }
        .nice-sub-item:last-child { border-bottom: none; }
        .nice-sub-item:hover { background-color: var(--nice-bg-hover); }
        
        .nice-sub-item.selected {
            background-color: var(--nice-accent-light);
            color: #065f46;
        }
        .nice-sub-item.selected::before {
            content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--nice-accent);
        }

        /* SEÇİLENLER PANELİ */
        .selected-group-card {
            background: #fff; border: 1px solid var(--nice-border);
            border-radius: 8px; margin-bottom: 16px; overflow: hidden;
            box-shadow: 0 2px 4px rgba(0,0,0,0.03);
        }
        .selected-group-header {
            background: #f8fafc; padding: 10px 16px; font-weight: 700; color: #334155;
            border-bottom: 1px solid var(--nice-border); font-size: 14px;
            display: flex; align-items: center;
        }
        .selected-group-header::before {
            content: ''; display: inline-block; width: 8px; height: 8px;
            background: var(--nice-accent); border-radius: 50%; margin-right: 8px;
        }
        
        .selected-item-row {
            padding: 12px 16px; border-bottom: 1px solid #f1f5f9;
            display: flex; align-items: flex-start; gap: 12px; transition: background 0.1s;
        }
        .selected-item-row:last-child { border-bottom: none; }
        .selected-item-row:hover { background: #fffdf5; }

        .selected-code-badge {
            background: #e2e8f0; color: #475569; font-size: 11px; font-weight: 700;
            padding: 2px 6px; border-radius: 4px; white-space: nowrap;
        }
        .selected-text { font-size: 14px; color: #334155; flex: 1; line-height: 1.5; }
        
        .btn-remove-item {
            color: #94a3b8; border: none; background: none; padding: 4px;
            cursor: pointer; transition: color 0.2s;
        }
        .btn-remove-item:hover { color: var(--nice-danger); }

        .nice-checkbox {
            width: 18px; height: 18px; accent-color: var(--nice-accent);
            margin-top: 3px; cursor: pointer;
        }
        .nice-label { cursor: pointer; font-size: 14px; line-height: 1.5; color: #475569; margin-bottom: 0; }

        @keyframes niceSlideDown {
            from { opacity: 0; transform: translateY(-5px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
    const style = document.createElement('style');
    style.id = styleId; style.textContent = css; document.head.appendChild(style);
}

/**
 * 35-5 Modal Yöneticisi
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
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-white border-bottom">
                        <h5 class="modal-title font-weight-bold text-dark">
                            <span class="badge badge-primary mr-2" style="background:#10b981;">35-5</span> 
                            Müşterilerin Malları - Mal Seçimi
                        </h5>
                        <button type="button" class="close" data-action="close">&times;</button>
                    </div>
                    <div class="modal-body bg-light">
                        <div class="row h-100">
                            <div class="col-lg-8 d-flex flex-column h-100">
                                <div class="bg-white p-3 rounded shadow-sm mb-3 border">
                                    <input type="text" class="form-control border-0" id="c35-search" placeholder="🔍 Mal sınıfı ara..." style="background:#f8fafc;">
                                </div>
                                <div class="bg-white rounded shadow-sm flex-grow-1 overflow-auto nice-container border" id="c35-list-container" style="max-height: 500px; padding: 10px;">
                                    ${this._generateListHTML()}
                                </div>
                                <div class="mt-3">
                                    <div class="input-group shadow-sm">
                                        <input type="text" id="c35-custom-input" class="form-control border-0" placeholder="Listede olmayan özel bir mal...">
                                        <div class="input-group-append">
                                            <button class="btn btn-primary" id="c35-add-custom" style="background:#10b981; border:none;">Ekle</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-lg-4 d-flex flex-column h-100">
                                <div class="bg-white rounded shadow-sm h-100 d-flex flex-column border">
                                    <div class="p-3 border-bottom d-flex justify-content-between align-items-center bg-light">
                                        <span class="font-weight-bold text-secondary">Seçilen Mallar</span>
                                        <span class="badge badge-pill badge-dark" id="c35-count">0</span>
                                    </div>
                                    <div class="flex-grow-1 overflow-auto p-2" id="c35-selected-container" style="max-height: 500px;"></div>
                                    <div class="p-3 border-top bg-light">
                                        <button class="btn btn-outline-danger btn-sm btn-block" id="c35-clear">Hepsini Temizle</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer border-top bg-white">
                        <button type="button" class="btn btn-light" data-action="close">İptal</button>
                        <button type="button" class="btn btn-success px-4 font-weight-bold" id="c35-save" style="background:#10b981; border:none;">Onayla ve Ekle</button>
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
                            <label class="nice-label ml-2 mb-0" for="chk-${code}">
                                <span class="text-muted small">(${code})</span> ${sub.subClassDescription}
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
            `<div class="border-bottom py-2 px-1 small text-dark d-flex justify-content-between align-items-center">
                <span>${v}</span>
                <button class="btn btn-sm text-danger p-0 ml-2" onclick="document.getElementById('chk-${k}').click()">&times;</button>
            </div>`
        ).join('');
    }

    close() { document.getElementById(this.modalId)?.remove(); document.body.classList.remove('modal-open'); }
}

/**
 * Ana Yönetici
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

        this.elements.listContainer.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-secondary"></div><div class="mt-2 text-muted">Yükleniyor...</div></div>`;

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
                        <button class="nice-btn-select-all mr-3" title="Tümünü Seç"><i class="fas fa-check-double"></i></button>
                        <i class="fas fa-chevron-down nice-icon-chevron"></i>
                    </div>
                </div>
                <div class="nice-sub-list">
                    ${cls.subClasses.map((sub, idx) => {
                        const code = `${cls.classNumber}-${idx + 1}`;
                        const is35_5 = code === '35-5';
                        const extraClass = is35_5 ? 'bg-light font-weight-bold text-dark' : '';
                        const icon = is35_5 ? '<i class="fas fa-shopping-cart text-muted mr-2"></i>' : '';
                        
                        return `
                        <div class="nice-sub-item sub-item ${extraClass}" data-code="${code}" data-text="${sub.subClassDescription}">
                            <input type="checkbox" class="nice-checkbox class-checkbox" id="chk-main-${code}" value="${code}">
                            <label class="nice-label ml-2 mb-0" for="chk-main-${code}">
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

            // Accordion Header
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

    // API
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