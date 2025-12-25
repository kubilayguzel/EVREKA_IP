// js/nice-classification.js - Tamamen Revize Edilmiş ve Görselliği Düzeltilmiş Kod

import { db } from '../firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let allNiceData = [];
let selectedClasses = {};  // { key: { classNum, text } }

// 35-5 özel modal değişkenleri
let class35_5_modalSelectedItems = {};
let class35_5_modalAllData = [];

function renderSelectedClasses() {
    const container = document.getElementById('selectedNiceClasses');
    const countBadge = document.getElementById('selectedClassCount');
    if (!container || !countBadge) return;

    countBadge.textContent = Object.keys(selectedClasses).length;
    if (Object.keys(selectedClasses).length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-list-alt fa-3x text-muted mb-3"></i>
                <p class="text-muted">
                    Henüz hiçbir sınıf seçilmedi.<br>
                    Sol panelden sınıf başlığına veya alt sınıfları seçin.
                </p>
            </div>`;
        return;
    }

    const grouped = {};
    Object.entries(selectedClasses).forEach(([code, item]) => {
        if (!grouped[item.classNum]) grouped[item.classNum] = [];
        grouped[item.classNum].push({ code, text: item.text });
    });

    let html = '';
    Object.keys(grouped).sort((a, b) => parseInt(a) - parseInt(b)).forEach(classNum => {
        grouped[classNum].forEach(item => {
            const isCustom = classNum === '99';
            const displayCode = isCustom ? classNum : item.code;
            html += `
            <div class="selected-class-item ${isCustom ? 'custom' : ''}">
                <div class="selected-class-number">Sınıf ${displayCode}</div>
                <p class="selected-class-description">${item.text}</p>
                <button class="remove-selected-btn" data-key="${item.code}" title="Kaldır">&times;</button>
            </div>`;
        });
    });
    container.innerHTML = html;
document.dispatchEvent(new Event('input'));
}

export function setSelectedNiceClasses(classes) {
    // Mevcut tüm seçilmiş sınıfları temizle
    clearAllSelectedClasses();

    classes.forEach(classString => {
        // Gelen string'i (örn: "1. (1-2) Gübreler ve topraklar" veya "(1-2) Gübreler") parçala
        // [DEĞİŞİKLİK] Çok satırlı metinleri destekleyen Regex
        const match = classString.match(/^(?:\d+\.\s*)?\((\d+-\d+)\)\s*([\s\S]*)$/);        
        if (match) {
            const code = match[1];
            const text = match[2];
            const parts = code.split('-');
            const classNum = parts[0];
            
            // Eğer 35-5 özel bir durumsa, onu ayrı işle
            if (code === '35-5') {
                selectedClasses['35-5'] = { classNum: '35', text: 'Müşterilerin malları' };
            } else {
                selectedClasses[code] = { classNum, text };
            }
        } else {
            // Eğer string formatı eşleşmezse (örn. özel sınıf 99)
            const customMatch = classString.match(/^\(99\)\s*(.*)$/);
            if (customMatch) {
                const text = customMatch[1];
                const code = `99-${Date.now()}`; // Yeni bir key oluştur
                selectedClasses[code] = { classNum: '99', text };
            }
        }
    });

    // Arayüzü güncelle
    renderSelectedClasses();
    updateVisualStates();
}

function toggleAccordion(id) {
    const el = document.getElementById(`subclasses-${id}`);
    if (!el) return;
    el.classList.toggle('show');
    const header = document.querySelector(`.class-header[data-id="${id}"]`);
    if (header) header.classList.toggle('expanded');
}

// TEK selectItem FONKSIYONU - 35-5 DESTEKLİ
function selectItem(key, classNum, text) {
    if (key === "35-5") {
        openClass35_5Modal();
        return;
    }
    
    if (selectedClasses[key]) return;
    
    selectedClasses[key] = { classNum, text };
    renderSelectedClasses();
    updateVisualStates();

    const el = document.querySelector(`[data-code="${key}"]`);
    if (el) el.classList.add('selected');
}

function removeSelectedClass(key) {
    if (!selectedClasses[key]) return;
    delete selectedClasses[key];
    renderSelectedClasses();
    updateVisualStates();
    const el = document.querySelector(`[data-code="${key}"]`);
    if (el) el.classList.remove('selected');
}

// ANA SINIF SEÇİMİ FONKSİYONLARI
function selectWholeClass(classNumber) {
  const classData = allNiceData.find(c => c.classNumber === parseInt(classNumber));
  if (!classData) return;

  // SADECE ALT SINIFLAR:
  classData.subClasses.forEach((sc, index) => {
    const code = `${classNumber}-${index + 1}`;
    selectItem(code, classNumber, sc.subClassDescription);
  });

  const collapseElement = document.getElementById(`subclasses-${classNumber}`);
  if (collapseElement) collapseElement.classList.add('show');
  const header = document.querySelector(`.class-header[data-id="${classNumber}"]`);
  if (header) header.classList.add('expanded');
}

function deselectWholeClass(classNumber) {
    const classData = allNiceData.find(c => c.classNumber === parseInt(classNumber));
    if (!classData) return;

    const mainClassCode = `${classNumber}-main`;
    removeSelectedClass(mainClassCode);

    classData.subClasses.forEach((sc, index) => {
        const code = `${classNumber}-${index + 1}`;
        removeSelectedClass(code);
    });
}

function isClassFullySelected(classNumber) {
  const classData = allNiceData.find(c => c.classNumber === parseInt(classNumber));
  if (!classData) return false;

  const selectedSubCount = classData.subClasses.filter((sc, index) => {
    const code = `${classNumber}-${index + 1}`;
    return selectedClasses[code];
  }).length;

  return selectedSubCount === classData.subClasses.length && classData.subClasses.length > 0;
}

function updateVisualStates() {
  allNiceData.forEach(cls => {
    const classNumber = cls.classNumber;

    const selectedSubCount = cls.subClasses.filter((sc, index) => {
      const code = `${classNumber}-${index + 1}`;
      return selectedClasses[code];
    }).length;

    const allSubClassesSelected = selectedSubCount === cls.subClasses.length && cls.subClasses.length > 0;
    const someSubClassesSelected = selectedSubCount > 0;

    const headerElement = document.querySelector(`.class-header[data-id="${classNumber}"]`);
    const accordionElement = document.getElementById(`subclasses-${classNumber}`);

    if (headerElement) {
      headerElement.classList.remove('selected', 'partially-selected', 'fully-selected');

      if (allSubClassesSelected) {
        headerElement.classList.add('selected', 'fully-selected');
        if (accordionElement) accordionElement.classList.add('show');
      } else if (someSubClassesSelected) {
        headerElement.classList.add('selected', 'partially-selected');
        if (accordionElement) accordionElement.classList.add('show');
      } else {
        if (accordionElement) accordionElement.classList.remove('show');
        headerElement.classList.remove('expanded');
      }
    }

    cls.subClasses.forEach((sc, index) => {
      const code = `${classNumber}-${index + 1}`;
      const subElement = document.querySelector(`[data-code="${code}"]`);
      if (subElement) {
        subElement.classList.toggle('selected', !!selectedClasses[code]);
      }
    });
  });
}

// 35-5 MODAL FONKSİYONLARI
function openClass35_5Modal() {
    const modalHTML = `
<div id="class35-5-modal" class="modal fade show" tabindex="-1">
    <div class="modal-dialog modal-xl">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">
                    <i class="fas fa-shopping-cart mr-2"></i>
                    (35-5) Müşterilerin Malları - Mal Seçimi
                </h5>
                <button type="button" class="close" onclick="closeClass35_5Modal(true)">&times;</button>
            </div>
            <div class="modal-body">
                <div class="nice-classification-container">
                    <div class="row">
                        <div class="col-lg-8">
                            <div class="classification-panel">
                                <div class="panel-header">
                                    <h5 class="mb-0">
                                        <i class="fas fa-list-ul mr-2"></i>
                                        Mal Sınıfları (1-34)
                                    </h5>
                                    <small class="text-white-50">35-5 hizmeti için uygun mal sınıflarını seçin</small>
                                </div>
                                <div class="search-section">
                                    <div class="input-group">
                                        <div class="input-group-prepend">
                                            <span class="input-group-text">
                                                <i class="fas fa-search"></i>
                                            </span>
                                        </div>
                                        <input type="text" class="form-control" id="class35-5-search" 
                                                placeholder="Mal sınıfı ara...">
                                        <div class="input-group-append">
                                            <button class="btn btn-outline-secondary" type="button" onclick="clearClass35_5Search()">
                                                <i class="fas fa-times"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div class="classes-list" id="class35-5-list" 
                                        style="height: 450px; overflow-y: auto; background: #fafafa;">
                                </div>
                                <div class="custom-class-section">
                                    <div class="d-flex align-items-center mb-2">
                                        <span class="badge badge-danger mr-2" style="font-size: 11px;">99</span>
                                        <strong class="text-danger">Özel Mal Tanımı</strong>
                                    </div>
                                    <div class="input-group">
                                        <textarea class="form-control" id="class35-5-custom-input" 
                                                placeholder="Özel mal tanımınızı yazın..."
                                                maxlength="1000" rows="2"></textarea>
                                        <div class="input-group-append">
                                            <button class="btn btn-danger" type="button" id="class35-5-add-custom">
                                                <i class="fas fa-plus mr-1"></i>Ekle
                                            </button>
                                        </div>
                                    </div>
                                    <small class="form-text text-muted">
                                        <span id="class35-5-char-count">0</span> / 1.000 karakter
                                    </small>
                                </div>
                            </div>
                        </div>

                        <div class="col-lg-4">
                            <div class="selected-classes-panel">
                                <div class="panel-header d-flex justify-content-between align-items-center">
                                    <h5 class="mb-0">
                                        <i class="fas fa-check-circle mr-2"></i>
                                        Seçilen Mallar
                                    </h5>
                                    <span class="badge badge-light" id="class35-5-selected-count">0</span>
                                </div>
                                <div class="border-top p-3">
                                    <button type="button" class="btn btn-outline-danger btn-sm btn-block" id="clearGoodsBtn">
                                        <i class="fas fa-trash mr-1"></i>Tümünü Temizle
                                    </button>
                                </div>
                                <div class="selected-classes-content" id="class35-5-selected-items">
                                    <div class="empty-state">
                                        <i class="fas fa-shopping-basket fa-3x text-muted mb-3"></i>
                                        <p class="text-muted">
                                            Henüz mal seçilmedi.<br>
                                            Sol panelden mal sınıflarını seçin.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="closeClass35_5Modal(true)">
                    <i class="fas fa-times mr-1"></i>İptal
                </button>
                <button type="button" class="btn btn-primary" id="class35-5-save-btn">
                    <i class="fas fa-save mr-1"></i>Kaydet
                </button>
            </div>
        </div>
    </div>
</div>
`;
    const modalContainer = document.createElement('div');
    modalContainer.className = 'modal-backdrop fade show';
    document.body.appendChild(modalContainer);

    const modalElement = document.createElement('div');
    modalElement.className = 'modal fade show d-block';
    modalElement.id = 'class35-5-modal';
    modalElement.setAttribute('tabindex', '-1');
    modalElement.setAttribute('role', 'dialog');
    modalElement.setAttribute('aria-labelledby', 'modalLabel');
    modalElement.setAttribute('aria-hidden', 'true');
    modalElement.innerHTML = modalHTML;
    document.body.appendChild(modalElement);
    
    // Modal içeriğini yükle
    loadClass35_5ModalContent();
    
    // Event listener'ları kur
    setupClass35_5ModalEvents();
}

function closeClass35_5Modal(isCanceled) {
    // Modal ve backdrop'ı temizle
    const modal = document.getElementById('class35-5-modal');
    if (modal) {
        modal.remove();
    }
    
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) {
        backdrop.remove();
    }

    // Body'den modal sınıflarını temizle
    document.body.classList.remove('modal-open');
    document.body.style.paddingRight = '';

    if (isCanceled) {
        // İptal edilmişse modal seçimlerini temizle
        class35_5_modalSelectedItems = {};
        console.log('Modal iptal edildi, seçimler temizlendi.');
    } else {
        console.log('Modal başarıyla kapatıldı.');
    }
}

async function loadClass35_5ModalContent() {
    try {
        const goodsClasses = allNiceData.filter(cls => cls.classNumber >= 1 && cls.classNumber <= 34);
        
        class35_5_modalAllData = goodsClasses;
        
        let html = '';
        goodsClasses.forEach(c => {
            html += `
                <div class="class-item" data-search-text="${(c.classNumber + ' ' + c.classTitle).toLowerCase()}">
                    <div class="class-header" data-class-number="${c.classNumber}">
                        <div class="class-header-content">
                            <i class="fas fa-chevron-down toggle-icon"></i>
                            <span class="class-number">${c.classNumber}</span>
                            <span class="class-title">${c.classTitle}</span>
                        </div>
                        <div class="class-header-actions">
                            <button class="select-class-btn" data-class-number="${c.classNumber}" title="Tüm sınıfı seç/kaldır">
                                <i class="fas fa-check"></i>
                            </button>
                        </div>
                    </div>
                    <div class="subclasses-container" id="modal-subclasses-${c.classNumber}">`;
            
            if (c.subClasses.length > 0) {
                c.subClasses.forEach((sc, index) => {
                    const code = `${c.classNumber}-${index + 1}`;
                    const isSelected = class35_5_modalSelectedItems[code] ? 'selected' : '';
                    html += `
                        <div class="subclass-item ${isSelected}" data-code="${code}" data-class-num="${c.classNumber}" data-text="${sc.subClassDescription}">
                            <span class="subclass-code">(${code})</span> ${sc.subClassDescription}
                        </div>`;
                });
            } else {
                html += `<div class="p-3 text-muted">Bu sınıfta alt kategori bulunmuyor</div>`;
            }
            html += `</div></div>`;
        });
        
        document.getElementById('class35-5-list').innerHTML = html;
        updateClass35_5VisualStates();
        renderClass35_5Selected();

    } catch (error) {
        console.error('35-5 modal yüklenirken hata:', error);
        document.getElementById('class35-5-list').innerHTML = `
            <div class="alert alert-danger">Mal sınıfları yüklenemedi: ${error.message}</div>
        `;
    }
}

function setupClass35_5ModalEvents() {
    const modal = document.getElementById('class35-5-modal');
    if (!modal) return;

    modal.addEventListener('click', e => {
        const target = e.target.closest('.select-class-btn, .subclass-item, .class-header, #clearGoodsBtn, .close');
        if (!target) return;

        e.preventDefault();
        e.stopPropagation();

        if (target.id === 'clearGoodsBtn') {
            clearClass35_5Selection();
        } else if (target.classList.contains('select-class-btn')) {
            const classNumber = parseInt(target.dataset.classNumber);
            const isFullySelected = class35_5_modalAllData.find(c => c.classNumber === classNumber).subClasses.every((sc, index) => class35_5_modalSelectedItems[`${classNumber}-${index + 1}`]);
            if (isFullySelected) {
                deselectWholeClass35_5(classNumber);
            } else {
                selectWholeClass35_5(classNumber);
            }
        } else if (target.classList.contains('subclass-item')) {
            const code = target.dataset.code;
            const classNum = target.dataset.classNum;
            const text = target.dataset.text;
            
            if (class35_5_modalSelectedItems[code]) {
                removeClass35_5(code);
            } else {
                addClass35_5(code, classNum, text);
            }
        } else if (target.classList.contains('class-header') && !e.target.closest('.select-class-btn')) {
            const classNumber = parseInt(target.dataset.classNumber);
            const container = document.getElementById(`modal-subclasses-${classNumber}`);
            if (container) {
                container.classList.toggle('show');
                target.classList.toggle('expanded');
            }
        }
    });

    const searchInput = document.getElementById('class35-5-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            modal.querySelectorAll('.class-item').forEach(item => {
                const shouldShow = item.dataset.searchText.includes(term);
                item.style.display = shouldShow ? '' : 'none';
                if (shouldShow && term.length > 2) {
                    const container = item.querySelector('.subclasses-container');
                    if (container) container.classList.add('show');
                    const header = item.querySelector('.class-header');
                    if (header) header.classList.add('expanded');
                }
            });
        });
    }

    const addCustomBtn = document.getElementById('class35-5-add-custom');
    const customInput = document.getElementById('class35-5-custom-input');
    const charCount = document.getElementById('class35-5-char-count');
    if (addCustomBtn) {
        addCustomBtn.addEventListener('click', () => {
            const text = customInput.value.trim();
            if (!text) return alert('Lütfen özel mal tanımını girin');
            const code = `99-${Date.now()}`;
            addClass35_5(code, '99', text);
            customInput.value = '';
            if (charCount) charCount.textContent = '0';
        });
    }

    const saveBtn = document.getElementById('class35-5-save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveClass35_5Selection);
    }
    
    const clearBtn = document.getElementById('clearGoodsBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearClass35_5Selection);
    }
}

function addClass35_5(code, classNum, text) {
    if (class35_5_modalSelectedItems[code]) return;
    class35_5_modalSelectedItems[code] = { classNum, text };
    renderClass35_5Selected();
    updateClass35_5VisualStates();
}

function removeClass35_5(code) {
    if (!class35_5_modalSelectedItems[code]) return;
    delete class35_5_modalSelectedItems[code];
    renderClass35_5Selected();
    updateClass35_5VisualStates();
}

function selectWholeClass35_5(classNumber) {
    const classData = class35_5_modalAllData.find(c => c.classNumber === classNumber);
    if (!classData) return;

    classData.subClasses.forEach((sc, index) => {
        const code = `${classNumber}-${index + 1}`;
        addClass35_5(code, classNumber, sc.subClassDescription);
    });

    const container = document.getElementById(`modal-subclasses-${classNumber}`);
    if (container) container.classList.add('show');
}
function deselectWholeClass35_5(classNumber) {
    const classData = class35_5_modalAllData.find(c => c.classNumber === classNumber);
    if (!classData) return;

    classData.subClasses.forEach((sc, index) => {
        const code = `${classNumber}-${index + 1}`;
        removeClass35_5(code);
    });
}

function renderClass35_5Selected() {
    const container = document.getElementById('class35-5-selected-items');
    const countBadge = document.getElementById('class35-5-selected-count');
    if (!container || !countBadge) return;

    const count = Object.keys(class35_5_modalSelectedItems).length;
    countBadge.textContent = count;

    if (count === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-shopping-basket fa-3x text-muted mb-3"></i>
                <p class="text-muted">
                    Henüz mal seçilmedi.<br>
                    Sol panelden mal sınıflarını seçin.
                </p>
            </div>`;
        return;
    }

    const grouped = {};
    Object.entries(class35_5_modalSelectedItems).forEach(([code, item]) => {
        if (!grouped[item.classNum]) grouped[item.classNum] = [];
        grouped[item.classNum].push({ code, text: item.text });
    });

    let html = '';
    Object.keys(grouped).sort((a, b) => parseInt(a) - parseInt(b)).forEach(classNum => {
        grouped[classNum].forEach(item => {
            const isCustom = classNum === '99';
            const displayCode = isCustom ? classNum : item.code;
            html += `
                <div class="selected-class-item ${isCustom ? 'custom' : ''}">
                    <div class="selected-class-number">Sınıf ${displayCode}</div>
                    <p class="selected-class-description" style="white-space: pre-wrap;">${item.text}</p>
                    <button class="remove-selected-btn" data-key="${item.code}" title="Kaldır" onclick="removeClass35_5('${item.code}')">&times;</button>
                </div>`;
        });
    });
    
    container.innerHTML = html;
}

function updateClass35_5VisualStates() {
    class35_5_modalAllData.forEach(cls => {
        const classNumber = cls.classNumber;
        
        const selectedSubCount = Object.keys(class35_5_modalSelectedItems).filter(key => key.startsWith(`${classNumber}-`)).length;
        const allSelected = selectedSubCount === cls.subClasses.length && cls.subClasses.length > 0;
        const someSelected = selectedSubCount > 0;

        const header = document.querySelector(`#class35-5-modal .class-header[data-class-number="${classNumber}"]`);
        if (header) {
            header.classList.remove('selected', 'partially-selected', 'fully-selected');
            
            if (allSelected) {
                header.classList.add('selected', 'fully-selected');
            } else if (someSelected) {
                header.classList.add('selected', 'partially-selected');
            }
        }

        cls.subClasses.forEach((sc, index) => {
            const code = `${classNumber}-${index + 1}`;
            const subElement = document.querySelector(`#class35-5-modal [data-code="${code}"]`);
            if (subElement) {
                if (class35_5_modalSelectedItems[code]) {
                    subElement.classList.add('selected');
                } else {
                    subElement.classList.remove('selected');
                }
            }
        });
    });
}

function saveClass35_5Selection() {
    try {
        const itemCount = Object.keys(class35_5_modalSelectedItems).length;
        if (itemCount === 0) {
            alert('Lütfen en az bir mal seçin.');
            return;
        }

        // Önce modal'ı kapat
        closeClass35_5Modal(false);

        // Seçilen malları ana sisteme aktar
        Object.entries(class35_5_modalSelectedItems).forEach(([code, item]) => {
            selectedClasses[code] = { classNum: item.classNum, text: item.text };
        });

        // 35-5 ana seçimini ekle
        selectedClasses["35-5"] = { classNum: "35", text: "Müşterilerin malları (seçilen mallar için)" };

        // Ana sistemi güncelle
        renderSelectedClasses();
        updateVisualStates();

        // Başarı mesajı
        alert(`✅ 35-5 hizmeti başarıyla güncellendi!\n${itemCount} mal kategorisi eklendi.`);
        
    } catch (error) {
        console.error('❌ Kaydetme hatası:', error);
        alert('Kaydetme sırasında hata oluştu:\n' + error.message);
    }
}

function clearClass35_5Search() {
    const searchInput = document.getElementById('class35-5-search');
    if (searchInput) {
        searchInput.value = '';
        const listContainer = document.getElementById('class35-5-list');
        listContainer.querySelectorAll('.class-item').forEach(item => {
            item.style.display = '';
            const container = item.querySelector('.subclasses-container');
            if (container) container.classList.remove('show');
            const header = item.querySelector('.class-header');
            if (header) header.classList.remove('expanded');
        });
    }
}

function clearClass35_5Selection() {
    try {
        class35_5_modalSelectedItems = {};
        renderClass35_5Selected();
        updateClass35_5VisualStates();
    } catch (error) {
        console.error('❌ 35-5 seçimlerini temizleme hatası:', error);
    }
}

export async function initializeNiceClassification() {
    const listContainer = document.getElementById('niceClassificationList');
    const searchInput = document.getElementById('niceClassSearch');
    const addCustomBtn = document.getElementById('addCustomClassBtn');
    const customInput = document.getElementById('customClassInput');
    const selectedContainer = document.getElementById('selectedNiceClasses');
    const charCountElement = document.getElementById('customClassCharCount');

    if (!listContainer) return;

    if (customInput && charCountElement) {
        customInput.addEventListener('input', (e) => {
            charCountElement.textContent = e.target.value.length.toLocaleString('tr-TR');
        });
    }

    listContainer.innerHTML = '';

    try {
        const niceCollection = collection(db, "niceClassification");
        const snapshot = await getDocs(niceCollection);
        allNiceData = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                classNumber: parseInt(data.classNumber),
                classTitle: data.classTitle,
                subClasses: data.subClasses || []
            };
        }).sort((a, b) => a.classNumber - b.classNumber);
        
        let html = '';
        allNiceData.forEach(c => {
            html += `
                <div class="class-item" data-search-text="${(c.classNumber + ' ' + c.classTitle).toLowerCase()}">
                    <div class="class-header" data-id="${c.classNumber}">
                        <div class="class-header-content">
                            <i class="fas fa-chevron-down toggle-icon"></i>
                            <span class="class-number">${c.classNumber}</span>
                            <span class="class-title">${c.classTitle}</span>
                        </div>
                        <div class="class-header-actions">
                            <button class="select-class-btn" data-class-number="${c.classNumber}" title="Tüm sınıfı seç/kaldır">
                                <i class="fas fa-check"></i>
                            </button>
                        </div>
                    </div>
                    <div class="subclasses-container" id="subclasses-${c.classNumber}">`;
            if (c.subClasses.length > 0) {
                c.subClasses.forEach((sc, index) => {
                    const code = `${c.classNumber}-${index + 1}`;
                    const isSelected = selectedClasses[code] ? 'selected' : '';
                    html += `
                        <div class="subclass-item ${isSelected}" data-code="${code}" data-class-num="${c.classNumber}" data-text="${sc.subClassDescription}">
                            <span class="subclass-code">(${code})</span> ${sc.subClassDescription}
                        </div>`;
                });
            } else {
                html += `<div class="p-3 text-muted">Bu sınıfta alt kategori bulunmuyor</div>`;
            }
            html += `</div></div>`;
        });
        listContainer.innerHTML = html;

        listContainer.addEventListener('click', e => {
            const selectBtn = e.target.closest('.select-class-btn');
            if (selectBtn) {
                e.preventDefault();
                e.stopPropagation();
                const classNumber = parseInt(selectBtn.dataset.classNumber);
                if (isClassFullySelected(classNumber)) {
                    deselectWholeClass(classNumber);
                } else {
                    selectWholeClass(classNumber);
                }
                return;
            }

            const header = e.target.closest('.class-header');
            const sub = e.target.closest('.subclass-item');
            
            if (sub) {
                const code = sub.dataset.code;
                const classNum = sub.dataset.classNum;
                const text = sub.dataset.text;
                
                if (code === '35-5') {
                    openClass35_5Modal();
                } else {
                    if (selectedClasses[code]) {
                        removeSelectedClass(code);
                    } else {
                        selectItem(code, classNum, text);
                    }
                }
                return;
            }
            
            if (header && !e.target.closest('.select-class-btn')) {
                toggleAccordion(parseInt(header.dataset.id));
            }
        });

        selectedContainer.addEventListener('click', e => {
            const btn = e.target.closest('.remove-selected-btn');
            if (btn) removeSelectedClass(btn.dataset.key);
        });

        searchInput.addEventListener('input', e => {
            const term = e.target.value.toLowerCase();
            document.querySelectorAll('#niceClassificationList .class-item').forEach(el => {
                const shouldShow = el.dataset.searchText.includes(term);
                el.style.display = shouldShow ? '' : 'none';
                
                if (shouldShow && term.length > 2) {
                    const collapseElement = el.querySelector('.subclasses-container');
                    if (collapseElement) collapseElement.classList.add('show');
                    const header = el.querySelector('.class-header');
                    if (header) header.classList.add('expanded');
                }
            });
        });

        addCustomBtn?.addEventListener('click', () => {
            const text = customInput.value.trim();
            if (!text) return alert('Lütfen özel sınıf metnini girin');
            const code = `99-${Date.now()}`;
            selectItem(code, '99', text);
            customInput.value = '';
            if (charCountElement) charCountElement.textContent = '0';
        });

        customInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addCustomBtn.click();
            }
        });

        renderSelectedClasses();
        updateVisualStates();

    } catch (err) {
        console.error("Nice sınıfları yüklenirken hata:", err);
        listContainer.innerHTML = `<div class="error-state">Sınıflar yüklenemedi: ${err.message}</div>`;
    }
}

export function clearAllSelectedClasses() {
    selectedClasses = {};
    renderSelectedClasses();
    updateVisualStates();
    document.querySelectorAll('.subclass-item.selected').forEach(el => el.classList.remove('selected'));
}

export function getSelectedNiceClasses() {
    return Object.entries(selectedClasses).map(([k, v]) => {
        return v.classNum === '99' ? `(99) ${v.text}` : `(${k}) ${v.text}`;
    });
}

window.clearAllSelectedClasses = clearAllSelectedClasses;
window.clearNiceSearch = () => {
    const input = document.getElementById('niceClassSearch');
    if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input'));
    }
};

window.openClass35_5Modal = openClass35_5Modal;
window.closeClass35_5Modal = closeClass35_5Modal;
window.clearClass35_5Search = clearClass35_5Search;
window.removeClass35_5 = removeClass35_5;
window.addClass35_5 = addClass35_5;