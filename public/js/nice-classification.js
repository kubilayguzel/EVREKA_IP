// public/js/nice-classification.js - Layout & Logic Update (Final)

import { db } from '../firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- MODERN STİLLERİ ENJEKTE ET ---
function injectNiceStyles() {
    const styleId = 'nice-classification-styles';
    if (document.getElementById(styleId)) return;

    const css = `
        .nice-container { font-family: 'Segoe UI', sans-serif; }

        /* ANA LİSTE GRUBU */
        .nice-class-group {
            background: #fff;
            border: 1px solid #e2e8f0;
            margin-bottom: 8px;
            border-radius: 8px;
            overflow: hidden;
            transition: all 0.2s;
        }
        
        /* SEÇİM YAPILMIŞ GRUP STİLİ (YENİ) */
        .nice-class-group.has-selection {
            border-color: #48bb78; /* Yeşil Çerçeve */
            background-color: #f0fff4; /* Açık Yeşil Arkaplan */
            box-shadow: 0 0 0 1px #48bb78;
        }
        .nice-class-group.has-selection .nice-class-header {
            background-color: #f0fff4;
        }
        .nice-class-group.has-selection .nice-badge {
            background-color: #2f855a; /* Koyu Yeşil Badge */
        }

        /* Başlık */
        .nice-class-header {
            padding: 12px 16px;
            background: #f8fafc;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .nice-class-header:hover { background: #f1f5f9; }
        
        .nice-header-left { display: flex; align-items: center; gap: 12px; flex: 1; }
        
        .nice-badge {
            background: #3b82f6; color: white; font-size: 13px; font-weight: 700;
            padding: 5px 10px; border-radius: 6px; min-width: 32px; text-align: center;
        }
        .nice-title { font-size: 15px; font-weight: 600; color: #334155; }
        
        .nice-sub-list { display: none; border-top: 1px solid #e2e8f0; background: #fff; }
        .nice-sub-list.open { display: block; }

        .nice-sub-item {
            padding: 10px 16px 10px 50px; border-bottom: 1px solid #f1f5f9; cursor: pointer;
        }
        .nice-sub-item:hover { background: #f8fafc; }
        
        /* Seçili Alt Öğe */
        .nice-sub-item.selected {
            background: #e6fffa;
            color: #2c7a7b;
            font-weight: 500;
        }
        
        /* SAĞ/ALT PANEL KARTLARI */
        .selected-group-card {
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }
        .selected-group-title {
            font-weight: 700; color: #2d3748; border-bottom: 2px solid #edf2f7;
            padding-bottom: 8px; margin-bottom: 10px; font-size: 1.1em;
        }
        .selected-tag {
            display: inline-flex; align-items: center;
            background: #ebf8ff; border: 1px solid #bee3f8; color: #2c5282;
            padding: 6px 12px; border-radius: 20px; font-size: 13px;
            margin-right: 8px; margin-bottom: 8px; max-width: 100%;
        }
        .selected-tag.custom { background: #fff5f5; border-color: #fed7d7; color: #c53030; }
        
        .tag-text { white-space: normal; margin-right: 8px; line-height: 1.4; }
        .tag-remove { cursor: pointer; color: #e53e3e; font-weight: bold; font-size: 16px; margin-left: 5px; }
        .tag-remove:hover { color: #c53030; }
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
        // Ana veriden 1-34 arası malları filtrele
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
                    <div class="modal-header bg-white">
                        <h5 class="modal-title font-weight-bold">
                            <span class="badge badge-primary mr-2">35-5</span> Müşterilerin Malları
                        </h5>
                        <button type="button" class="close" data-action="close">&times;</button>
                    </div>
                    <div class="modal-body bg-light">
                        <div class="row h-100">
                            <div class="col-lg-8 d-flex flex-column h-100">
                                <input type="text" class="form-control mb-3 shadow-sm" id="c35-search" placeholder="🔍 Mal sınıfı ara...">
                                <div class="bg-white rounded shadow-sm flex-grow-1 overflow-auto p-2" id="c35-list-container" style="max-height: 500px;">
                                    ${this._generateListHTML()}
                                </div>
                            </div>
                            <div class="col-lg-4 d-flex flex-column h-100">
                                <div class="bg-white rounded shadow-sm h-100 p-3 d-flex flex-column">
                                    <h6 class="border-bottom pb-2 font-weight-bold">Seçilen Mallar (<span id="c35-count">0</span>)</h6>
                                    <div class="flex-grow-1 overflow-auto" id="c35-selected-container"></div>
                                    <button class="btn btn-outline-danger btn-sm btn-block mt-2" id="c35-clear">Temizle</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer bg-white">
                        <button type="button" class="btn btn-secondary" data-action="close">İptal</button>
                        <button type="button" class="btn btn-success px-4 font-weight-bold" id="c35-save">Onayla ve Ekle</button>
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
            <div class="mb-2 border rounded c35-group">
                <div class="p-2 bg-light c35-header d-flex justify-content-between align-items-center" style="cursor:pointer">
                    <strong><span class="badge badge-secondary mr-2">${cls.classNumber}</span> ${cls.classTitle}</strong>
                    <i class="fas fa-chevron-down text-muted"></i>
                </div>
                <div class="c35-sub-list collapse">
                    ${cls.subClasses.map((sub, idx) => `
                        <div class="p-2 border-top pl-4 c35-item-row" data-text="${sub.subClassDescription}" style="cursor:pointer">
                            <input type="checkbox" class="mr-2" value="${cls.classNumber}-${idx+1}"> 
                            <span>${sub.subClassDescription}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }

    setupEvents() {
        const modal = document.getElementById(this.modalId);
        
        modal.addEventListener('click', (e) => {
            const target = e.target;
            if (target.dataset.action === 'close' || target.classList.contains('close')) return this.close();

            // Accordion
            const header = target.closest('.c35-header');
            if (header) {
                header.nextElementSibling.classList.toggle('show');
                return;
            }

            // Seçim
            const row = target.closest('.c35-item-row');
            if (row) {
                const cb = row.querySelector('input');
                if (target !== cb) cb.checked = !cb.checked;
                
                if (cb.checked) this.selectedItems[cb.value] = row.dataset.text;
                else delete this.selectedItems[cb.value];
                
                this.updateSelectedUI();
            }
        });

        // Arama
        document.getElementById('c35-search').addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            modal.querySelectorAll('.c35-group').forEach(group => {
                const title = group.querySelector('.c35-header').innerText.toLowerCase();
                const items = group.querySelectorAll('.c35-item-row');
                let match = false;
                
                items.forEach(item => {
                    if(item.innerText.toLowerCase().includes(term)) {
                        item.style.display = ''; match = true;
                    } else {
                        item.style.display = 'none';
                    }
                });

                if (title.includes(term) || match) {
                    group.style.display = '';
                    if (term.length > 2) group.querySelector('.c35-sub-list').classList.add('show');
                } else {
                    group.style.display = 'none';
                }
            });
        });

        // --- 35-5 KAYDETME MANTIĞI (DÜZELTİLDİ) ---
        document.getElementById('c35-save').addEventListener('click', () => {
            const items = Object.values(this.selectedItems);
            if (items.length === 0) return alert('Lütfen en az bir mal seçin.');
            
            // Seçilen malları birleştirerek TEK BİR string oluşturuyoruz
            const combinedText = `Müşterilerin malları; şu malların bir araya getirilmesi hizmetleri (nakliyesi hariç): ${items.join(', ')}`;
            
            // Ana listeye sadece bu birleştirilmiş metni ekliyoruz
            this.parent.addSelection('35-5', '35', combinedText);
            
            this.close();
        });

        document.getElementById('c35-clear').onclick = () => { this.selectedItems = {}; this.updateSelectedUI(); modal.querySelectorAll('input').forEach(i=>i.checked=false); };
    }

    updateSelectedUI() {
        const container = document.getElementById('c35-selected-container');
        document.getElementById('c35-count').innerText = Object.keys(this.selectedItems).length;
        container.innerHTML = Object.entries(this.selectedItems).map(([k,v]) => 
            `<div class="border-bottom py-1 small">${v}</div>`
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

        this.elements.listContainer.innerHTML = `<div class="text-center p-5"><div class="spinner-border text-primary"></div></div>`;

        try {
            injectNiceStyles();
            const snapshot = await getDocs(collection(db, "niceClassification"));
            this.allData = snapshot.docs.map(doc => ({ ...doc.data(), classNumber: parseInt(doc.data().classNumber) })).sort((a, b) => a.classNumber - b.classNumber);

            this.renderList();
            this.setupEventListeners();
            this.updateSelectionUI();

        } catch (error) {
            console.error("Nice error:", error);
            this.elements.listContainer.innerHTML = `<div class="alert alert-danger">Hata: ${error.message}</div>`;
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
                
                list.classList.toggle('open');
                group.classList.toggle('open');
                return;
            }

            // Checkbox veya Satır Tıklama
            const subItem = target.closest('.sub-item');
            if (subItem) {
                // Label veya Input değilse manuel tetikle
                const isDirectInput = target.tagName === 'INPUT';
                if (!isDirectInput && target.tagName !== 'LABEL') {
                    const checkbox = subItem.querySelector('.class-checkbox');
                    if(subItem.dataset.code === '35-5') {
                        e.preventDefault(); // 35-5 için checkbox'ı elle değiştirme, modal açacak
                    } else {
                        checkbox.checked = !checkbox.checked;
                    }
                    // Event'i simüle et
                    this.handleCheckboxAction(subItem.dataset.code, subItem.dataset.text, checkbox.checked);
                } 
                // Input ise
                else if (isDirectInput) {
                    if (target.value === '35-5') e.preventDefault(); // 35-5 için iptal et
                    this.handleCheckboxAction(target.value, subItem.dataset.text, target.checked);
                }
            }
        });

        // Kaldır Butonu
        if (this.elements.selectedContainer) {
            this.elements.selectedContainer.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.tag-remove');
                if (removeBtn) this.removeSelection(removeBtn.dataset.key);
            });
        }

        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        }

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
        if (code === '35-5') {
            this.class35Manager.open();
        } else {
            if (isChecked) this.addSelection(code, code.split('-')[0], text);
            else this.removeSelection(code);
        }
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
                    item.style.display = 'block'; match = true;
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
        // 1. Sol Panel Görsel Güncelleme (Checkbox + Renklendirme)
        const allCheckboxes = this.elements.listContainer.querySelectorAll('.class-checkbox');
        const groups = this.elements.listContainer.querySelectorAll('.nice-class-group');
        
        // Önce tüm gruplardan renklendirmeyi kaldır
        groups.forEach(g => g.classList.remove('has-selection'));

        allCheckboxes.forEach(chk => {
            const isSelected = !!this.selectedClasses[chk.value];
            chk.checked = isSelected;
            
            const row = chk.closest('.nice-sub-item');
            if (row) {
                if(isSelected) row.classList.add('selected');
                else row.classList.remove('selected');
            }

            // Grubu renklendir
            if (isSelected) {
                const group = chk.closest('.nice-class-group');
                if (group) group.classList.add('has-selection');
            }
        });

        // 2. Alt Panel (Seçilenler) Listesi
        if (this.elements.selectedContainer) {
            const count = Object.keys(this.selectedClasses).length;
            if (this.elements.selectedCountBadge) this.elements.selectedCountBadge.textContent = count;

            if (count === 0) {
                this.elements.selectedContainer.innerHTML = `<div class="text-center text-muted py-4"><p>Henüz seçim yok.</p></div>`;
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
                    <div class="selected-group-title">Sınıf ${num}</div>
                    <div>
                        ${grouped[num].map(item => `
                            <div class="selected-tag ${num==='99'?'custom':''}">
                                <span class="font-weight-bold mr-2">(${item.code})</span>
                                <span class="tag-text">${item.text}</span>
                                <span class="tag-remove" data-key="${item.code}">&times;</span>
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