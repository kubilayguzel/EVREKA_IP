// public/js/layout-loader.js
import { personService, authService, db } from '../firebase-config.js';
import { doc, getDoc, collection, getDocs, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// CACHE ANAHTARI (Versiyon değişirse burayı artırabilirsiniz, örn: v2)
const LAYOUT_CACHE_KEY = 'app_layout_cache_v1';
let authCache = null;
let lastAuthCheck = 0;
const AUTH_CACHE_DURATION = 5000;

// Menü Yapısı
const menuItems = [
    { id: 'dashboard', text: 'Dashboard', link: 'dashboard.html', icon: 'fas fa-tachometer-alt', category: 'Ana Menü' },
    {
        id: 'portfolio-management-accordion',
        text: 'Portföy Yönetimi',
        icon: 'fas fa-folder',
        category: 'Portföy Yönetimi',
        subItems: [
            { id: 'portfolio', text: 'Portföy', link: 'portfolio.html' },
            { id: 'data-entry', text: 'Yeni Kayıt', link: 'data-entry.html' },
            { id: 'tp-file-transfer', text: 'TÜRKPATENT Dosya Aktarımı', link: 'tp-file-transfer.html' },
            { id: 'excel-upload', text: 'Excel ile Yükle', link: 'excel-upload.html', adminOnly: true }
        ]
    },
    { id: 'reminders', text: 'Hatırlatmalar', link: 'reminders.html', icon: 'fas fa-bell', category: 'Yönetim' },
    {
        id: 'task-management-accordion',
        text: 'İş Yönetimi',
        icon: 'fas fa-briefcase',
        category: 'Yönetim',
        subItems: [
            { id: 'task-management', text: 'İş Yönetimi', link: 'task-management.html' },
            { id: 'my-tasks', text: 'İşlerim', link: 'my-tasks.html' },
            { id: 'create-task', text: 'Yeni İş Oluştur', link: 'create-task.html', specialClass: 'new-task-link' }
        ]
    },
    {
        id: 'new-tasks-accordion',
        text: 'Görevler',
        icon: 'fas fa-clipboard-check',
        category: 'Yönetim',
        subItems: [
            { id: 'scheduled-tasks', text: 'Zamanlanmış Görevler', link: 'scheduled-tasks.html' },
            { id: 'triggered-tasks', text: 'Tetiklenen Görevler', link: 'triggered-tasks.html' },
            { id: 'client-notifications', text: 'Müvekkil Bildirimleri', link: 'notifications.html' }
        ]
    },
    {
        id: 'person-management-accordion',
        text: 'Kişi Yönetimi',
        icon: 'fas fa-users',
        category: 'Yönetim',
        subItems: [
            { id: 'persons', text: 'Kişiler Yönetimi', link: 'persons.html' },
            { id: 'user-management', text: 'Kullanıcı Yönetimi', link: 'user-management.html', superAdminOnly: true }
        ]
    },
    { id: 'accruals', text: 'Tahakkuklarım', link: 'accruals.html', icon: 'fas fa-file-invoice-dollar', category: 'Finans' },
    { id: 'indexing', text: 'Belge İndeksleme', link: 'bulk-indexing-page.html', icon: 'fas fa-folder-open', category: 'Araçlar' },
    { id: 'bulletin-management-accordion', text: 'Bülten Yönetimi', icon: 'fas fa-book', category: 'Araçlar', subItems: [
        { id: 'bulletin-upload', text: 'Bülten Yükleme/Silme', link: 'bulletin-upload.html' },
        { id: 'bulletin-search', text: 'Bülten Sorgulama', link: 'bulletin-search.html' }
    ]},
    {id: 'monitoring-accordion', text: 'İzleme', icon: 'fas fa-eye', category: 'Araçlar', subItems: [
        {id: 'trademark-similarity-search', text: 'Marka İzleme', link: 'trademark-similarity-search.html' },
        { id: 'monitoring-trademarks', text: 'Marka İzleme Listesi', link: 'monitoring-trademarks.html' },
        { id: 'monitoring-designs', text: 'Tasarım İzleme', link: 'monitoring-designs.html' }
    ]},
    { id: 'reports', text: 'Raporlar', link: '#', icon: 'fas fa-chart-line', category: 'Araçlar', disabled: true },
    { id: 'settings', text: 'Ayarlar', link: '#', icon: 'fas fa-cog', category: 'Araçlar', disabled: true }
];

// --- OPTİMİZE EDİLMİŞ LOAD FONKSİYONU ---
export async function loadSharedLayout(options = {}) {
    const placeholder = document.getElementById('layout-placeholder');
    if (!placeholder) {
        console.error('Layout placeholder not found.');
        return;
    }

    // 1. [HIZLI] LocalStorage Cache Kontrolü
    // Eğer önceden yüklenmişse, network'ü beklemeden hemen bas.
    const cachedHTML = localStorage.getItem(LAYOUT_CACHE_KEY);
    if (cachedHTML) {
        placeholder.innerHTML = cachedHTML;
        // İskelet yüklendi, hemen aktif menüyü işaretle ki kullanıcı nerede olduğunu görsün
        highlightActiveMenu(window.location.pathname.split('/').pop());
    }

    // 2. [PARALEL] Veri Çekme İşlemleri
    // Layout HTML'ini (güncelleme için), Auth bilgisini ve Datepicker'ı aynı anda başlatıyoruz.
    // await kullanmıyoruz, promise dizisi oluşturuyoruz.
    const layoutPromise = fetchAndCacheLayout();
    const authPromise = getCachedAuth();
    const datepickerPromise = ensureDatepickerDeps();

    // 3. HTML Güncelleme (Eğer cache yoksa mecbur bekleriz, varsa pas geçeriz)
    if (!cachedHTML) {
        const freshHTML = await layoutPromise;
        if (freshHTML) {
            placeholder.innerHTML = freshHTML;
        }
    }

    // 4. Kullanıcı Bilgilerini ve Menüyü Doldur
    // Auth işlemi bittiğinde burası çalışır.
    const user = await authPromise;
    
    // Auth yoksa dur (Login'e yönlendirme authService içinde olabilir veya burada yapılabilir)
    if (!user) return;

    // Kullanıcıya özel menüyü oluştur
    updateUserInfo(user);
    const sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav) {
        renderMenu(sidebarNav, user.role || 'user');
        setupFastMenuInteractions();
        setupMenuBadges();
        highlightActiveMenu(window.location.pathname.split('/').pop());
    }

    // Logout butonu bağla
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.onclick = (e) => {
            e.preventDefault();
            authService.signOut();
        };
    }

    // Datepicker bağımlılıkları arkada yüklenmeye devam etsin veya bitmiş olsun
    await datepickerPromise;
}

// --- YARDIMCI FONKSİYONLAR ---

async function fetchAndCacheLayout() {
    try {
        const response = await fetch('shared_layout_parts.html');
        if (!response.ok) throw new Error('Layout fetch failed');
        let html = await response.text();
        // Script etiketlerini temizle
        html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
        
        // LocalStorage'a kaydet (Gelecek sefer için)
        localStorage.setItem(LAYOUT_CACHE_KEY, html);
        return html;
    } catch (e) {
        console.error("Layout fetch error:", e);
        return null;
    }
}

async function getCachedAuth() {
    const now = Date.now();
    if (authCache && (now - lastAuthCheck) < AUTH_CACHE_DURATION) {
        return authCache;
    }
    // Auth kontrolünü yap
    authCache = authService.getCurrentUser();
    lastAuthCheck = now;
    return authCache;
}

function updateUserInfo(user) {
    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');
    const userAvatarEl = document.getElementById('userAvatar');
    
    if (userNameEl) userNameEl.textContent = user.displayName || user.email.split('@')[0];
    if (userRoleEl) userRoleEl.textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
    if (userAvatarEl) userAvatarEl.textContent = (user.displayName || user.email.charAt(0)).charAt(0).toUpperCase();
}

function renderMenu(container, userRole) {
    let currentCategory = '';
    container.innerHTML = ''; 

    menuItems.forEach(item => {
        if (item.category && item.category !== currentCategory) {
            const categoryTitle = document.createElement('div');
            categoryTitle.className = 'nav-category-title';
            categoryTitle.textContent = item.category;
            container.appendChild(categoryTitle);
            currentCategory = item.category;
        }

        if ((item.adminOnly && userRole !== 'admin' && userRole !== 'superadmin') || (item.superAdminOnly && userRole !== 'superadmin')) {
            return;
        }

        const hasSubItems = item.subItems && item.subItems.length > 0;
        let linkClass = 'sidebar-nav-item';
        if (item.specialClass) linkClass += ` ${item.specialClass}`;

        if (hasSubItems) {
            const accordionHtml = `
                <div class="accordion">
                    <div class="accordion-header"> <span class="nav-icon"><i class="${item.icon}"></i></span>
                        <span>${item.text}</span>
                    </div>
                    <div class="accordion-content">
                        ${item.subItems.map(subItem => `
                            <a href="${subItem.link}" class="${subItem.specialClass || ''}" id="menu-link-${subItem.id}">
                                <span>${subItem.text}</span>
                                <span class="menu-badge" id="badge-${subItem.id}">0</span>
                            </a> `).join('')}
                    </div>
                </div>`;
            container.innerHTML += accordionHtml;
        } else {
            const singleLinkHtml = `
                <a href="${item.link}" class="${linkClass}" id="menu-link-${item.id}" ${item.disabled ? 'style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                    <span class="nav-icon"><i class="${item.icon}"></i></span>
                    <span>${item.text}</span>
                    <span class="menu-badge" id="badge-${item.id}">0</span>
                </a>`;
            container.innerHTML += singleLinkHtml;
        }
    });
}

function setupFastMenuInteractions() {
    const sidebar = document.querySelector('.sidebar-nav');
    if (!sidebar) return;
    
    sidebar.onclick = (e) => {
        const header = e.target.closest('.accordion-header');
        if (!header) return;
        
        const content = header.nextElementSibling;
        const isActive = header.classList.contains('active');

        if (isActive) {
            header.classList.remove('active');
            content.style.maxHeight = '0';
        } else {
            sidebar.querySelectorAll('.accordion-header.active').forEach(h => h.classList.remove('active'));
            sidebar.querySelectorAll('.accordion-content').forEach(c => c.style.maxHeight = '0');
            header.classList.add('active');
            content.style.maxHeight = content.scrollHeight + 'px';
        }
    };
}

function highlightActiveMenu(currentPage) {
    document.querySelectorAll('.sidebar-nav-item, .accordion-content a').forEach(link => {
        link.classList.remove('active');
    });

    let activeLink = null;
    let parentAccordion = null;

    document.querySelectorAll('.sidebar-nav-item, .accordion-content a').forEach(link => {
        const href = link.getAttribute('href');
        if (href) {
            const fileName = href.split('/').pop();
            if (fileName === currentPage) {
                link.classList.add('active');
                activeLink = link;
                const accordion = link.closest('.accordion');
                if (accordion) parentAccordion = accordion;
            }
        }
    });

    if (parentAccordion) {
        const accordionHeader = parentAccordion.querySelector('.accordion-header');
        const accordionContent = parentAccordion.querySelector('.accordion-content');
        accordionHeader.classList.add('active');
        accordionContent.style.maxHeight = accordionContent.scrollHeight + 'px';
    }
}

function setupMenuBadges() {
    try {
        const tasksQuery = query(collection(db, "tasks"), where("status", "==", "awaiting_client_approval"));
        onSnapshot(tasksQuery, (snapshot) => updateBadgeUI('triggered-tasks', snapshot.size), (e) => console.error(e));
        
        const notificationsQuery = query(collection(db, "mail_notifications"), where("status", "in", ["awaiting_client_approval", "missing_info", "evaluation_pending"]));
        onSnapshot(notificationsQuery, (snapshot) => updateBadgeUI('client-notifications', snapshot.size), (e) => console.error(e));
    } catch (e) { console.error("Badge setup error:", e); }
}

function updateBadgeUI(menuId, count) {
    const badgeEl = document.getElementById(`badge-${menuId}`);
    if (badgeEl) {
        badgeEl.textContent = count;
        badgeEl.style.display = count > 0 ? 'inline-block' : 'none';
    }
}

async function ensureDatepickerDeps() {
  // CSS ve JS kütüphanelerini yükleme (Değişiklik yok, aynen korundu)
  const head = document.head;
  if (!document.querySelector('link[data-evreka="flatpickr-css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css';
    link.setAttribute('data-evreka', 'flatpickr-css');
    head.appendChild(link);
  }
  if (!document.querySelector('style[data-evreka="flatpickr-z"]')) {
    const st = document.createElement('style');
    st.setAttribute('data-evreka', 'flatpickr-z');
    st.textContent = '.flatpickr-calendar{z-index:100000!important}';
    head.appendChild(st);
  }
  const loadScript = (src, attr) => new Promise(res => {
    if (document.querySelector(`script[${attr}]`)) return res();
    const s = document.createElement('script');
    s.src = src;
    s.setAttribute(attr.split('=')[0], attr.split('=')[1]?.replace(/"/g,'') || attr);
    s.onload = () => res();
    head.appendChild(s);
  });
  if (!window.flatpickr) await loadScript('https://cdn.jsdelivr.net/npm/flatpickr', 'data-evreka="flatpickr-js"');
  if (!(window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.tr)) await loadScript('https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/tr.js', 'data-evreka="flatpickr-tr"');
  if (!window.EvrekaDatePicker) await loadScript('./js/date-pickers.js', 'data-evreka="evreka-datepickers"');
  window.EvrekaDatePicker?.init();
}

// === ORTAK KİŞİ MODALİ ===
export function ensurePersonModal() {
  if (document.getElementById('personModal')) return;
  if (!document.getElementById('personModalSharedStyles')) {
    const style = document.createElement('style');
    style.id = 'personModalSharedStyles';
    style.textContent = `
      .modal{display:none;position:fixed;z-index:1002;left:0;top:0;width:100%;height:100%;overflow:auto;background-color:rgba(0,0,0,.6);align-items:center;justify-content:center}
      .modal.show{display:flex}
      .modal-content{background:#fff;margin:auto;padding:30px;border:1px solid #888;width:90%;max-width:600px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2)}
      .close-modal-btn{position:absolute;right:16px;top:12px;font-size:28px;cursor:pointer}
      .modal-title{margin:0 0 15px 0}
      .form-group{margin-bottom:12px}
      .form-label{display:block;font-weight:600;margin-bottom:6px}
      .form-input,.form-select,.form-textarea{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px}
      .modal-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:12px}
      .btn{padding:10px 16px;border-radius:8px;border:0;cursor:pointer}
      .btn-secondary{background:#e6e6e6}
      .btn-success{background:#28a745;color:#fff}
      .text-muted{color:#6c757d}
    `;
    document.head.appendChild(style);
  }

  const html = `
  <div id="personModal" class="modal" aria-hidden="true">
    <div class="modal-content">
      <span class="close-modal-btn" id="closePersonModal">&times;</span>
      <h3 class="modal-title" id="personModalTitle">Yeni Kişi Ekle</h3>
      <form id="personForm">
        <input type="hidden" id="personId">
        <div class="form-group">
          <label for="pm_personType" class="form-label">Kişi Tipi</label>
          <select id="pm_personType" class="form-select" required>
            <option value="">Seçiniz</option>
            <option value="gercek">Gerçek</option>
            <option value="tuzel">Tüzel</option>
          </select>
        </div>
        <div class="form-group">
          <label for="pm_name" class="form-label"><span id="pm_nameLabel">Ad Soyad</span></label>
          <input id="pm_name" type="text" class="form-input" required>
        </div>
        <div class="form-group" id="pm_tcknGroup" style="display:none;">
          <label for="pm_tckn" class="form-label">TC Kimlik No</label>
          <input id="pm_tckn" type="text" class="form-input" maxlength="11" inputmode="numeric" placeholder="11 haneli">
        </div>
        <div class="form-group" id="pm_vknGroup" style="display:none;">
          <label for="pm_vkn" class="form-label">Vergi No</label>
          <input id="pm_vkn" type="text" class="form-input" maxlength="10" inputmode="numeric" placeholder="10 haneli">
        </div>
        <div class="form-group" id="pm_birthDateGroup" style="display:none;">
            <label for="pm_birthDate" class="form-label">Doğum Tarihi</label>
            <input id="pm_birthDate" type="date" class="form-input">
        </div>
        <div class="form-group">
          <label for="pm_tpeNo" class="form-label">TPE Müşteri No</label>
          <input id="pm_tpeNo" type="text" class="form-input">
        </div>
        <div class="form-group">
          <label for="pm_email" class="form-label">E‑posta</label>
          <input id="pm_email" type="email" class="form-input">
        </div>
        <div class="form-group">
            <label for="pm_phone" class="form-label">Telefon</label>
            <input id="pm_phone" type="tel" class="form-input" placeholder="+90 5__ ___ __ __">
        </div>
        <div class="form-group">
            <label for="pm_address" class="form-label">Adres</label>
            <textarea id="pm_address" class="form-textarea" rows="2"></textarea>
        </div>
        <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
                <label for="pm_country" class="form-label">Ülke</label>
                <select id="pm_country" class="form-select"><option value="">Yükleniyor…</option></select>
            </div>
            <div class="form-group" style="flex:1;">
                <label for="pm_city" class="form-label">İl</label>
                <select id="pm_city" class="form-select" disabled><option value="">Önce ülke seçin</option></select>
            </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="pm_cancelBtn">Kapat</button>
          <button type="submit" class="btn btn-success" id="pm_saveBtn">Kaydet</button>
        </div>
      </form>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  const typeSel = document.getElementById('pm_personType');
  const tcknGroup = document.getElementById('pm_tcknGroup');
  const vknGroup = document.getElementById('pm_vknGroup');
  const nameLabel = document.getElementById('pm_nameLabel');
  const birthDateGroup = document.getElementById('pm_birthDateGroup');
  typeSel.addEventListener('change', () => {
    const v = typeSel.value;
    if (v === 'gercek') {
        tcknGroup.style.display = '';
        vknGroup.style.display = 'none';
        birthDateGroup.style.display = '';
        nameLabel.textContent = 'Ad Soyad';
    } else if (v === 'tuzel') {
        tcknGroup.style.display = 'none';
        vknGroup.style.display = '';
        birthDateGroup.style.display = 'none';
        nameLabel.textContent = 'Firma Adı';
    } else {
        tcknGroup.style.display = 'none';
        vknGroup.style.display = 'none';
        birthDateGroup.style.display = 'none';
        nameLabel.textContent = 'Ad Soyad';
    }
  });

  document.getElementById('pm_cancelBtn').addEventListener('click', closePersonModal);
  document.getElementById('closePersonModal').addEventListener('click', closePersonModal);
  document.getElementById('personForm').addEventListener('submit', handlePersonSubmit);
}

let __onPersonSaved = null;

async function handlePersonSubmit(e) {
  e.preventDefault();
  const payload = {
    type: document.getElementById('pm_personType').value,
    name: document.getElementById('pm_name').value.trim(),
    nationalIdOrVkn: document.getElementById('pm_tckn').value.trim() || document.getElementById('pm_vkn').value.trim() || '',
    tpeNo: document.getElementById('pm_tpeNo')?.value.trim(), // Düzeltme: pm_tpeNo ID'si kullanıldı
    email: document.getElementById('pm_email').value.trim(),
    phone: document.getElementById('pm_phone').value.trim(),
    countryCode: document.getElementById('pm_country').value || '',
    cityCode: document.getElementById('pm_city').value || '',
    address: document.getElementById('pm_address').value.trim(),
    birthDate: document.getElementById('pm_birthDate')?.value || ''
  };

  if (!payload.type || !payload.name) {
    alert('Lütfen Kişi Tipi ve Ad/Ünvan girin.');
    return;
  }

  try {
    const res = await personService.addPerson(payload);
    if (!res?.success || !res?.data) throw new Error(res?.error || 'Kayıt başarısız.');
    if (typeof __onPersonSaved === 'function') __onPersonSaved(res.data);
    closePersonModal();
  } catch (err) {
    alert(err.message || 'Bilinmeyen hata.');
  }
}

export function openPersonModal(onSaved) {
  ensurePersonModal();
  __onPersonSaved = onSaved || null;
  const form = document.getElementById('personForm');
  if (form) form.reset();
  
  const phoneInput = document.getElementById('pm_phone');
  if (phoneInput) applyPhoneMask(phoneInput);

  const typeSel = document.getElementById('pm_personType');
  typeSel.value = 'tuzel';
  typeSel.dispatchEvent(new Event('change'));

  populateCountryCitySelects();
  document.getElementById('personModal').classList.add('show');
}

export function closePersonModal() {
  const modal = document.getElementById('personModal');
  if (modal) modal.classList.remove('show');
}

// LOOKUPS
let __countriesCache = null;
let __citiesCacheByCountry = new Map();

async function loadCountries() {
  if (__countriesCache) return __countriesCache;
  try {
    const snapA = await getDoc(doc(db, 'common', 'countries'));
    const dataA = snapA.exists() ? snapA.data() : null;
    if (dataA && Array.isArray(dataA.list)) { __countriesCache = dataA.list; return __countriesCache; }
  } catch {}
  __countriesCache = [];
  return __countriesCache;
}

async function loadCities(countryCode) {
  if (!countryCode) return [];
  if (__citiesCacheByCountry.has(countryCode)) return __citiesCacheByCountry.get(countryCode);
  try {
      const d = await getDoc(doc(db, 'common', `cities_${countryCode}`));
      const data = d.exists() ? d.data() : null;
      if (data && Array.isArray(data.list)) {
          const mapped = data.list.map(n => ({ name: n, code: n }));
          __citiesCacheByCountry.set(countryCode, mapped);
          return mapped;
      }
  } catch {}
  return [];
}

async function populateCountryCitySelects() {
  const countrySel = document.getElementById('pm_country');
  const citySel = document.getElementById('pm_city');
  if (!countrySel || !citySel) return;

  const countries = await loadCountries();
  countrySel.innerHTML = `<option value="">Seçiniz</option>` + countries.map(c => `<option value="${c.code}">${c.name}</option>`).join('');

  const defaultCountry = 'TR';
  if (countries.some(c => c.code === defaultCountry)) {
    countrySel.value = defaultCountry;
    countrySel.dispatchEvent(new Event('change'));
  }

  countrySel.addEventListener('change', async () => {
    const code = countrySel.value;
    citySel.disabled = true;
    citySel.innerHTML = `<option value="">Yükleniyor…</option>`;
    const cities = await loadCities(code);
    citySel.innerHTML = `<option value="">Seçiniz</option>` + cities.map(x => `<option value="${(x.code || x.name)}">${x.name}</option>`).join('');
    citySel.disabled = false;
  });
}

function applyPhoneMask(input) {
  input.addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, '');
    if (!value.startsWith('90')) value = '90' + value;
    if (value.length > 12) value = value.slice(0, 12);
    let formatted = '+' + value.slice(0, 2);
    if (value.length > 2) formatted += ' ' + value.slice(2, 5);
    if (value.length > 5) formatted += ' ' + value.slice(5, 8);
    if (value.length > 8) formatted += ' ' + value.slice(8, 10);
    if (value.length > 10) formatted += ' ' + value.slice(10, 12);
    e.target.value = formatted;
  });
}