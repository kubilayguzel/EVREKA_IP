// js/layout-loader.js
import {personService , authService, db } from '../firebase-config.js';
import { doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Menü yapısını daha yönetilebilir bir veri formatında tanımlıyoruz
const menuItems = [
    { id: 'dashboard', text: 'Dashboard', link: 'dashboard.html', icon: 'fas fa-tachometer-alt', category: 'Ana Menü' },
    
    // Yeni Portföy Yönetimi Akordiyonu eklendi
    {
        id: 'portfolio-management-accordion',
        text: 'Portföy Yönetimi',
        icon: 'fas fa-folder', // Portföy Yönetimi için uygun bir ikon
        category: 'Portföy Yönetimi', // Yeni kategori
        subItems: [
            { id: 'portfolio', text: 'Portföy', link: 'portfolio.html' }, // Buraya taşındı
            { id: 'data-entry', text: 'Yeni Kayıt', link: 'data-entry.html' }, // Buraya taşındı
            { id: 'excel-upload', text: 'Excel ile Yükle', link: 'excel-upload.html', adminOnly: true } // Buraya taşındı
        ]
    },

    // Hatırlatmalar sekmesi Kişi Yönetimi'nden önce ve ayrı sekme olarak taşındı
    { id: 'reminders', text: 'Hatırlatmalar', link: 'reminders.html', icon: 'fas fa-bell', category: 'Yönetim' },
    
    // Mevcut 'tasks-accordion' değiştirildi ve adı 'İş Yönetimi' oldu
    {
        id: 'task-management-accordion', // ID güncellendi
        text: 'İş Yönetimi', // Adı güncellendi
        icon: 'fas fa-briefcase', // İkon güncellendi
        category: 'Yönetim',
        subItems: [
            { id: 'task-management', text: 'İş Yönetimi', link: 'task-management.html' }, // Konumu korundu
            { id: 'my-tasks', text: 'İşlerim', link: 'my-tasks.html' }, // Konumu korundu
            { id: 'create-task', text: 'Yeni İş Oluştur', link: 'create-task.html', specialClass: 'new-task-link' } // Konumu korundu
            // 'Hatırlatmalar' ve 'Zamanlanmış Görevler' buradan kaldırıldı
        ]
    },
    {
        id: 'new-tasks-accordion',
        text: 'Görevler',
        icon: 'fas fa-clipboard-check', // ← YENİ İKON
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
        icon: 'fas fa-users', // Kişi Yönetimi ikonu
        category: 'Yönetim',
        subItems: [
            { id: 'persons', text: 'Kişiler Yönetimi', link: 'persons.html' },
            { id: 'user-management', text: 'Kullanıcı Yönetimi', link: 'user-management.html', superAdminOnly: true }
        ]
    },
    { id: 'accruals', text: 'Tahakkuklarım', link: 'accruals.html', icon: 'fas fa-file-invoice-dollar', category: 'Finans' },
    
    // GÜNCELLENMIŞ: indexing.html → bulk-indexing-page.html
    { id: 'indexing', text: 'Belge İndeksleme', link: 'bulk-indexing-page.html', icon: 'fas fa-folder-open', category: 'Araçlar' },
    { id: 'bulletin-management-accordion', text: 'Bülten Yönetimi', icon: 'fas fa-book', category: 'Araçlar', subItems: [
        { id: 'bulletin-upload', text: 'Bülten Yükleme/Silme', link: 'bulletin-upload.html' },
        { id: 'bulletin-search', text: 'Bülten Sorgulama', link: 'bulletin-search.html' }
    ]
    },
    {id: 'monitoring-accordion', text: 'İzleme', icon: 'fas fa-eye', category: 'Araçlar', subItems: [
        {id: 'trademark-similarity-search', text: 'Marka İzleme', link: 'trademark-similarity-search.html' },
        { id: 'monitoring-trademarks', text: 'Marka İzleme Listesi', link: 'monitoring-trademarks.html' },
        { id: 'monitoring-designs', text: 'Tasarım İzleme', link: 'monitoring-designs.html' }
    ]
    },
    { id: 'reports', text: 'Raporlar', link: '#', icon: 'fas fa-chart-line', category: 'Araçlar', disabled: true },
    { id: 'settings', text: 'Ayarlar', link: '#', icon: 'fas fa-cog', category: 'Araçlar', disabled: true }
    ];

export async function loadSharedLayout(options = {}) {
    const { activeMenuLink } = options;
    const placeholder = document.getElementById('layout-placeholder');

    if (!placeholder) {
        console.error('Layout placeholder not found. Ensure you have <div id="layout-placeholder"></div> in your HTML.');
        return;
    }

    try {
        // Font Awesome kütüphanesini ekle
        if (!document.querySelector('link[href*="font-awesome"]')) {
            const fontAwesomeLink = document.createElement('link');
            fontAwesomeLink.rel = 'stylesheet';
            fontAwesomeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css';
            document.head.appendChild(fontAwesomeLink);
        }
        // shared-styles.css dosyasını da buraya ekleyelim, eğer zaten eklenmemişse
        if (!document.querySelector('link[href*="shared-styles.css"]')) {
            const sharedStylesLink = document.createElement('link');
            sharedStylesLink.rel = 'stylesheet';
            sharedStylesLink.href = 'css/shared-styles.css';
            document.head.appendChild(sharedStylesLink);
        }

        const response = await fetch('shared_layout_parts.html');
        if (!response.ok) throw new Error('shared_layout_parts.html could not be loaded.');
        placeholder.innerHTML = await response.text();
        const user = authService.getCurrentUser();
            if (!user && window.top === window) {
                window.location.href = 'index.html';
                return;
            }

        const userRole = user.role || 'user';
        
        const userNameEl = document.getElementById('userName');
        if (userNameEl) {
            userNameEl.textContent = user.displayName || user.email.split('@')[0];
        }
        const userRoleEl = document.getElementById('userRole');
        if (userRoleEl) {
            userRoleEl.textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
        }
        const userAvatarEl = document.getElementById('userAvatar');
        if (userAvatarEl) {
            userAvatarEl.textContent = (user.displayName || user.email.charAt(0)).charAt(0).toUpperCase();
        }

        const sidebarNav = document.querySelector('.sidebar-nav');
        if(sidebarNav) {
            renderMenu(sidebarNav, userRole); // activeMenuLink parametresi renderMenu'den kaldırıldı
        } else {
            console.error('Sidebar navigation container (.sidebar-nav) not found in layout.');
        }

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.addEventListener('click', (e) => { e.preventDefault(); authService.signOut(); });

        const currentPath = window.location.pathname.split('/').pop();
        setupMenuInteractions(currentPath);


    } catch (error) {
        console.error('Error loading shared layout:', error);
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'padding: 20px; background-color: #f8d7da; color: #721c24; border-radius: 8px; margin: 20px;';
        errorDiv.textContent = 'Uygulama arayüzü yüklenirken bir hata oluştu. Lütfen sayfayı yenilemeyi deneyin.';
        document.body.prepend(errorDiv);
    }
}

function renderMenu(container, userRole) { // currentPage parametresi kaldırıldı
    let currentCategory = '';
    container.innerHTML = ''; // Mevcut içeriği temizle

    menuItems.forEach(item => {
        // Kategori başlığını ekle
        if (item.category && item.category !== currentCategory) {
            const categoryTitle = document.createElement('div');
            categoryTitle.className = 'nav-category-title';
            categoryTitle.textContent = item.category;
            container.appendChild(categoryTitle);
            currentCategory = item.category;
        }

        // Yetki kontrolü
        if ((item.adminOnly && userRole !== 'admin' && userRole !== 'superadmin') || (item.superAdminOnly && userRole !== 'superadmin')) {
            return; // Menü öğesini atla
        }

        const hasSubItems = item.subItems && item.subItems.length > 0;
        
        let linkClass = 'sidebar-nav-item';
        // isDirectActive, isParentActive ve active sınıfı ekleme mantığı renderMenu'den kaldırıldı
        // if (isDirectActive || isParentActive) {
        //     linkClass += ' active';
        // }
        if (item.specialClass) { // create-task için özel sınıf
            linkClass += ` ${item.specialClass}`;
        }

        if (hasSubItems) {
            const accordionHtml = `
                <div class="accordion">
                    <div class="accordion-header"> <span class="nav-icon"><i class="${item.icon}"></i></span>
                        <span>${item.text}</span>
                    </div>
                    <div class="accordion-content">
                        ${item.subItems.map(subItem => `
                            <a href="${subItem.link}" class="${subItem.specialClass || ''}">${subItem.text}</a> `).join('')}
                    </div>
                </div>
            `;
            container.innerHTML += accordionHtml;
        } else {
            const singleLinkHtml = `
                <a href="${item.link}" class="${linkClass}" ${item.disabled ? 'style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                    <span class="nav-icon"><i class="${item.icon}"></i></span>
                    <span>${item.text}</span>
                </a>
            `;
            container.innerHTML += singleLinkHtml;
        }
    });
}

function setupMenuInteractions(currentPage) {
    // 1. Accordion başlıklarına tıklama olay dinleyicilerini ekle
    // Bu kısım, accordionların tıklama ile açılıp kapanmasını sağlar.
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const isActive = header.classList.contains('active');

            // Tüm accordion'ları kapat
            document.querySelectorAll('.accordion-header').forEach(h => h.classList.remove('active'));
            document.querySelectorAll('.accordion-content').forEach(c => c.style.maxHeight = '0');

            // Eğer tıklanan accordion kapalıydı, aç
            if (!isActive) {
                header.classList.add('active');
                content.style.maxHeight = content.scrollHeight + 'px';
            }
        });
    });

    // 2. Aktif sayfanın menüsünü vurgula
    highlightActiveMenu(currentPage);
}

function highlightActiveMenu(currentPage) {
    // Tüm aktif sınıfları temizle
    document.querySelectorAll('.sidebar-nav-item, .accordion-content a').forEach(link => {
        link.classList.remove('active');
    });

    // Aktif linki bul
    let activeLink = null;
    let parentAccordion = null;

    document.querySelectorAll('.sidebar-nav-item, .accordion-content a').forEach(link => {
        const href = link.getAttribute('href');
        if (href && href === currentPage) {
            link.classList.add('active');
            activeLink = link;
            
            // Eğer accordion içindeyse, parent accordion'ı bul
            const accordion = link.closest('.accordion');
            if (accordion) {
                parentAccordion = accordion;
            }
        }
    });

    // Eğer aktif link accordion içindeyse, accordion'ı aç
    if (parentAccordion) {
        const accordionHeader = parentAccordion.querySelector('.accordion-header');
        const accordionContent = parentAccordion.querySelector('.accordion-content');
        
        accordionHeader.classList.add('active');
        accordionContent.style.maxHeight = accordionContent.scrollHeight + 'px';
    }
    
}

// === [ORTAK KİŞİ MODALİ] ====================================================

// Sayfaya bir defa modal ve stil enjekte et
export function ensurePersonModal() {
  // persons.html içinde zaten #personModal var => tekrar enjekte etme
  if (document.getElementById('personModal')) return;

  // Minimal gerekli stiller (persons.html'deki modal görünümünün özeti)
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

  // Modal HTML (persons.html’deki alanların sadeleştirilmiş hali)
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
          <small class="text-muted">Sadece rakam, 11 hane</small>
        </div>

        <div class="form-group" id="pm_vknGroup" style="display:none;">
          <label for="pm_vkn" class="form-label">Vergi No</label>
          <input id="pm_vkn" type="text" class="form-input" maxlength="10" inputmode="numeric" placeholder="10 haneli">
          <small class="text-muted">Sadece rakam, 10 hane</small>
        </div>

        <!-- Doğum Tarihi (yalnız GERÇEK kişi için görünsün) -->
        <div class="form-group" id="pm_birthDateGroup" style="display:none;">
        <label for="pm_birthDate" class="form-label">Doğum Tarihi</label>
        <input id="pm_birthDate" type="date" class="form-input">
        </div>

        <div class="form-group">
          <label for="pm_tpeMn" class="form-label">TPE Müşteri No</label>
          <input id="pm_tpeMn" type="text" class="form-input">
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

        <!-- Ülke / İl -->
        <div class="form-row" style="display:flex; gap:12px;">
        <div class="form-group" style="flex:1;">
            <label for="pm_country" class="form-label">Ülke</label>
            <select id="pm_country" class="form-select">
            <option value="">Yükleniyor…</option>
            </select>
        </div>
        <div class="form-group" style="flex:1;">
            <label for="pm_city" class="form-label">İl</label>
            <select id="pm_city" class="form-select" disabled>
            <option value="">Önce ülke seçin</option>
            </select>
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

  // Tip değişince TCKN/VKN alanlarını göster/gizle
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
        birthDateGroup.style.display = '';         // doğum tarihi göster
        nameLabel.textContent = 'Ad Soyad';
    } else if (v === 'tuzel') {
        tcknGroup.style.display = 'none';
        vknGroup.style.display = '';
        birthDateGroup.style.display = 'none';     // doğum tarihi gizle
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
    type: document.getElementById('pm_personType').value,                                  // 'gercek' | 'tuzel'
    name: document.getElementById('pm_name').value.trim(),
    nationalIdOrVkn: document.getElementById('pm_tckn').value.trim() || document.getElementById('pm_vkn').value.trim() || '',
    tpeMn: document.getElementById('pm_tpeMn').value.trim(),
    email: document.getElementById('pm_email').value.trim(),
    phone: document.getElementById('pm_phone').value.trim(),
    countryCode: document.getElementById('pm_country').value || '',
    cityCode: document.getElementById('pm_city').value || '',
    address: document.getElementById('pm_address').value.trim(),
    birthDate: document.getElementById('pm_birthDate')?.value || ''                        // sadece gerçek kişide dolu olur
    };

  if (!payload.type || !payload.name) {
    alert('Lütfen Kişi Tipi ve Ad/Ünvan girin.');
    return;
  }

  // Firebase’e kaydet
  try {
    const res = await personService.addPerson(payload);
    if (!res?.success || !res?.data) throw new Error(res?.error || 'Kayıt başarısız.');
    // Callback’i çağır
    if (typeof __onPersonSaved === 'function') {
      __onPersonSaved(res.data);
    }
    closePersonModal();
  } catch (err) {
    alert(err.message || 'Bilinmeyen hata.');
  }
}

export function openPersonModal(onSaved) {
  ensurePersonModal();
  __onPersonSaved = onSaved || null;

  // Formu sıfırla
  const form = document.getElementById('personForm');
  if (form) form.reset();
  
  const phoneInput = document.getElementById('pm_phone');
    if (phoneInput) {
    applyPhoneMask(phoneInput);
    }

  // Varsayılan: TÜZEL
  const typeSel = document.getElementById('pm_personType');
  typeSel.value = 'tuzel';
  typeSel.dispatchEvent(new Event('change'));

  // Ülke/İl yükle
  populateCountryCitySelects();

  document.getElementById('personModalTitle').textContent = 'Yeni Kişi Ekle';
  document.getElementById('personModal').classList.add('show');
}

export function closePersonModal() {
  const modal = document.getElementById('personModal');
  if (modal) modal.classList.remove('show');
}
// ---------- Common Lookups (Ülke/İl) ----------
let __countriesCache = null;
let __citiesCacheByCountry = new Map();

async function loadCountries() {
  if (__countriesCache) return __countriesCache;

  // 3 olası yapıdan birini deneyelim: 
  // A) doc('common', 'countries') -> { list: [{code,name}, ...] }
  // B) collection('common/countries/list') -> docs {code,name}
  // C) collection('countries') -> docs {code,name}
  // Sende hangisi varsa o çalışır; sırayla dener ve ilk bulduğunda döner.
  // — A
  try {
    const snapA = await getDoc(doc(db, 'common', 'countries'));
    const dataA = snapA.exists() ? snapA.data() : null;
    if (dataA && Array.isArray(dataA.list) && dataA.list.length) {
      __countriesCache = dataA.list;
      return __countriesCache;
    }
  } catch {}

  // — B
  try {
    const snapB = await getDocs(collection(db, 'common', 'countries', 'list'));
    const arrB = snapB.docs.map(d => d.data()).filter(x => x && x.code && x.name);
    if (arrB.length) {
      __countriesCache = arrB;
      return __countriesCache;
    }
  } catch {}

  // — C
  try {
    const snapC = await getDocs(collection(db, 'countries'));
    const arrC = snapC.docs.map(d => d.data()).filter(x => x && x.code && x.name);
    if (arrC.length) {
      __countriesCache = arrC;
      return __countriesCache;
    }
  } catch {}

  __countriesCache = [];
  return __countriesCache;
}

async function loadCities(countryCode) {
  if (!countryCode) return [];
  if (__citiesCacheByCountry.has(countryCode)) return __citiesCacheByCountry.get(countryCode);

  // Yine olası yapıları sırayla deneriz:
  // A) doc('common', 'cities_TR') -> { list: ['İstanbul', 'Ankara', ...] }  (countryCode ile değişken)
  // B) collection('common/cities') where countryCode == 'TR' -> { name }
  // C) collection('cities_TR') -> { name }
  // D) collection('cities') where countryCode == 'TR' -> { name }
  // (Senin şemana uyan ilk yapı çalışacaktır.)
  const tryDocs = [
    async () => {
      const d = await getDoc(doc(db, 'common', `cities_${countryCode}`));
      const data = d.exists() ? d.data() : null;
      if (data && Array.isArray(data.list)) return data.list.map(n => ({ name: n, code: n }));
      return null;
    },
    async () => {
      const snap = await getDocs(query(collection(db, 'common', 'cities', 'list'), where('countryCode', '==', countryCode)));
      const arr = snap.docs.map(d => d.data()).filter(x => x && x.name);
      return arr.length ? arr : null;
    },
    async () => {
      const snap = await getDocs(collection(db, `cities_${countryCode}`));
      const arr = snap.docs.map(d => d.data()).filter(x => x && x.name);
      return arr.length ? arr : null;
    },
    async () => {
      const snap = await getDocs(query(collection(db, 'cities'), where('countryCode', '==', countryCode)));
      const arr = snap.docs.map(d => d.data()).filter(x => x && x.name);
      return arr.length ? arr : null;
    }
  ];

  for (const fn of tryDocs) {
    try {
      const res = await fn();
      if (res && res.length) {
        __citiesCacheByCountry.set(countryCode, res);
        return res;
      }
    } catch {}
  }

  __citiesCacheByCountry.set(countryCode, []);
  return [];
}

async function populateCountryCitySelects() {
  const countrySel = document.getElementById('pm_country');
  const citySel = document.getElementById('pm_city');
  if (!countrySel || !citySel) return;

  // Ülkeleri yükle
  const countries = await loadCountries();
  countrySel.innerHTML = `<option value="">Seçiniz</option>` + countries
    .map(c => `<option value="${c.code}">${c.name}</option>`)
    .join('');

  // Varsayılan TR seçili olsun (istenmiyorsa kaldır)
  const defaultCountry = 'TR';
  const hasTR = countries.some(c => c.code === defaultCountry);
  if (hasTR) {
    countrySel.value = defaultCountry;
    countrySel.dispatchEvent(new Event('change'));
  }

  // Ülke seçilince illeri getir
  countrySel.addEventListener('change', async () => {
    const code = countrySel.value;
    citySel.disabled = true;
    citySel.innerHTML = `<option value="">Yükleniyor…</option>`;
    const cities = await loadCities(code);
    citySel.innerHTML = `<option value="">Seçiniz</option>` + cities
      .map(x => `<option value="${(x.code || x.name)}">${x.name}</option>`)
      .join('');
    citySel.disabled = false;
  });
}
function applyPhoneMask(input) {
  input.addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, ''); // sadece rakam
    if (!value.startsWith('90')) {
      value = '90' + value; // TR kodu ekle
    }
    if (value.length > 12) {
      value = value.slice(0, 12);
    }
    let formatted = '+' + value.slice(0, 2); // +90
    if (value.length > 2) {
      formatted += ' ' + value.slice(2, 5);
    }
    if (value.length > 5) {
      formatted += ' ' + value.slice(5, 8);
    }
    if (value.length > 8) {
      formatted += ' ' + value.slice(8, 10);
    }
    if (value.length > 10) {
      formatted += ' ' + value.slice(10, 12);
    }
    e.target.value = formatted;
  });
}

// ===========================================================================