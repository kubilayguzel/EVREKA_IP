// js/data-entry.js
import { initializeNiceClassification, getSelectedNiceClasses, setSelectedNiceClasses } from './nice-classification.js';
import { personService, ipRecordsService, storage } from '../firebase-config.js';
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { loadSharedLayout, openPersonModal, ensurePersonModal } from './layout-loader.js';
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { STATUSES } from '../utils.js';

class DataEntryModule {
    constructor() {
        this.ipTypeSelect = document.getElementById('ipTypeSelect');
        this.dynamicFormContainer = document.getElementById('dynamicFormContainer');
        this.saveBtn = document.getElementById('savePortfolioBtn');
        this.selectedApplicants = [];
        this.priorities = []; // Rüçhan bilgileri için
        this.isNiceInitialized = false;
        this.uploadedBrandImage = null;
        this.allPersons = [];
        this.recordOwnerTypeSelect = document.getElementById('recordOwnerType');
        this.editingRecordId = null;
        this.allCountries = [];
        this.currentIpType = null;
    }

    async init() {
        console.log('🚀 Data Entry Module başlatılıyor...');
        try {
            await this.loadAllData();
            this.setupEventListeners();
            this.setupModalCloseButtons();

            // ✅ Yeni: URL'den kayıt ID'sini kontrol et ve kaydı yükle
            await this.loadRecordForEditing();

        } catch (error) {
            console.error('Data Entry Module init hatası:', error);
        }
    }

    async loadAllData() {
        try {
            const [personsResult, countriesResult] = await Promise.all([
                personService.getPersons(),
                this.getCountries()
            ]);
            
            this.allPersons = personsResult.success ? personsResult.data : [];
            this.allCountries = countriesResult; // Yeni eklenen
            
            console.log('📊 Tüm veriler yüklendi:', this.allPersons.length, 'kişi,', this.allCountries.length, 'ülke.');
        } catch (error) {
            console.error('Veriler yüklenirken hata:', error);
            this.allPersons = [];
            this.allCountries = [];
        }
    }

    setupEventListeners() {
        console.log('🎯 Event listener kuruluyor...');
        
        if (this.ipTypeSelect) {
            this.ipTypeSelect.addEventListener('change', (e) => {
                this.handleIPTypeChange(e.target.value);
            });
        }

        if (this.saveBtn) {
            this.saveBtn.addEventListener('click', () => {
                this.handleSavePortfolio();
            });
        }
        if (this.recordOwnerTypeSelect) {
            this.recordOwnerTypeSelect.addEventListener('change', () => {
                this.updateSaveButtonState();
            });
        }
    }

    setupModalCloseButtons() {
        const cancelPersonBtn = document.getElementById('cancelPersonBtn');
        if (cancelPersonBtn) {
            cancelPersonBtn.addEventListener('click', () => this.hideAddPersonModal());
        }
        
        const savePersonBtn = document.getElementById('savePersonBtn');
        if (savePersonBtn) {
            savePersonBtn.addEventListener('click', () => this.saveNewPerson());
        }
    }

    hideAddPersonModal() {
        const personModal = document.getElementById('personModal');
        if (personModal) {
            personModal.classList.remove('show');
            document.body.classList.remove('modal-open');
        }
    }

    handleIPTypeChange(ipType) {
        console.log('📋 IP türü değişti:', ipType);
        
        this.dynamicFormContainer.innerHTML = '';
        this.selectedApplicants = [];
        this.priorities = []; // Rüçhan listesini temizle
        this.isNiceInitialized = false;
        this.uploadedBrandImage = null;
        this.updateSaveButtonState();

        switch(ipType) {
            case 'trademark':
                this.renderTrademarkForm();
                break;
            case 'patent':
                this.renderPatentForm();
                break;
            case 'design':
                this.renderDesignForm();
                break;
        }
    }

    renderTrademarkForm() {
        console.log('🏷️ Marka formu render ediliyor...');
        
        const html = 
            '<div class="form-section">' +
                '<ul class="nav nav-tabs" id="portfolioTabs" role="tablist">' +
                    '<li class="nav-item">' +
                        '<a class="nav-link active" id="brand-info-tab" data-toggle="tab" href="#brand-info" role="tab">' +
                            '<i class="fas fa-tag mr-1"></i>Marka Bilgileri' +
                        '</a>' +
                    '</li>' +
                    '<li class="nav-item">' +
                        '<a class="nav-link" id="applicants-tab" data-toggle="tab" href="#applicants" role="tab">' +
                            '<i class="fas fa-users mr-1"></i>Başvuru Sahipleri' +
                        '</a>' +
                    '</li>' +
                    '<li class="nav-item">' +
                        '<a class="nav-link" id="priority-tab" data-toggle="tab" href="#priority" role="tab">' +
                            '<i class="fas fa-star mr-1"></i>Rüçhan' +
                        '</a>' +
                    '</li>' +
                    '<li class="nav-item">' +
                        '<a class="nav-link" id="goods-services-tab" data-toggle="tab" href="#goods-services" role="tab">' +
                            '<i class="fas fa-list-ul mr-1"></i>Mal ve Hizmetler' +
                        '</a>' +
                    '</li>' +
                '</ul>' +
                
                '<div class="tab-content tab-content-card" id="portfolioTabContent">' +
                    // Tab 1: Marka Bilgileri
                    '<div class="tab-pane fade show active" id="brand-info" role="tabpanel">' +
                        '<div class="form-grid">' +
                            '<div class="form-group">' +
                                '<label for="brandExampleText" class="form-label">Marka Metni</label>' +
                                '<input type="text" id="brandExampleText" class="form-input" placeholder="Marka adını girin">' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="applicationNumber" class="form-label">Başvuru Numarası</label>' +
                                '<input type="text" id="applicationNumber" class="form-input" placeholder="Başvuru numarasını girin">' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="applicationDate" class="form-label">Başvuru Tarihi</label>' +
                                '<input type="date" id="applicationDate" class="form-input">' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="registrationNumber" class="form-label">Tescil Numarası</label>' +
                                '<input type="text" id="registrationNumber" class="form-input" placeholder="Tescil numarasını girin">' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="registrationDate" class="form-label">Tescil Tarihi</label>' +
                                '<input type="date" id="registrationDate" class="form-input">' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="renewalDate" class="form-label">Yenileme Tarihi</label>' +
                                '<input type="date" id="renewalDate" class="form-input">' +
                            '</div>' +
                            '<div class="form-group">' +
                                '<label for="trademarkStatus" class="form-label">Durum</label>' +
                                '<select id="trademarkStatus" class="form-select"></select>' +
                                '</div>' +

                                // BÜLTEN NO & TARİHİ (yanyana istersen grid/couple wrap ile stillersin)
                                '<div class="form-row">' +

                                '<div class="form-group col-md-6">' +
                                    '<label for="bulletinNo" class="form-label">Bülten No</label>' +
                                    '<input id="bulletinNo" type="text" class="form-input" placeholder="Örn. 1">' +
                                '</div>' +

                                '<div class="form-group col-md-6">' +
                                    '<label for="bulletinDate" class="form-label">Bülten Tarihi</label>' +
                                    '<input id="bulletinDate" type="date" class="form-input">' +
                                '</div>' +

                                '</div>' +

                                // MARKA TİPİ
                                '<div class="form-group">' +
                                '<label for="brandType" class="form-label">Marka Tipi</label>' +
                                '<select id="brandType" class="form-select">' +
                                    '<option value="Şekil + Kelime" selected>Şekil + Kelime</option>' +
                                    '<option value="Kelime">Kelime</option>' +
                                    '<option value="Şekil">Şekil</option>' +
                                    '<option value="Üç Boyutlu">Üç Boyutlu</option>' +
                                    '<option value="Renk">Renk</option>' +
                                    '<option value="Ses">Ses</option>' +
                                    '<option value="Hareket">Hareket</option>' +
                                '</select>' +
                                '</div>' +

                                // MARKA TÜRÜ
                                '<div class="form-group">' +
                                '<label for="brandCategory" class="form-label">Marka Türü</label>' +
                                '<select id="brandCategory" class="form-select">' +
                                    '<option value="Ticaret/Hizmet Markası" selected>Ticaret/Hizmet Markası</option>' +
                                    '<option value="Garanti Markası">Garanti Markası</option>' +
                                    '<option value="Ortak Marka">Ortak Marka</option>' +
                                '</select>' +
                                '</div>'+
                            '<div class="form-group full-width">' +
                                '<label for="brandDescription" class="form-label">Marka Açıklaması</label>' +
                                '<textarea id="brandDescription" class="form-textarea" rows="3" placeholder="Marka hakkında açıklama girin"></textarea>' +
                            '</div>' +
                            '<div class="form-group full-width">' +
                                '<label class="form-label">Marka Görseli</label>' +
                                '<div class="brand-upload-frame">' +
                                    '<input type="file" id="brandExample" accept="image/*" style="display: none;">' +
                                    '<div id="brandExampleUploadArea" class="upload-area">' +
                                        '<i class="fas fa-cloud-upload-alt fa-2x text-muted"></i>' +
                                        '<p class="mt-2 mb-0">Dosya seçmek için tıklayın veya sürükleyip bırakın</p>' +
                                        '<small class="text-muted">PNG, JPG, JPEG dosyaları kabul edilir</small>' +
                                    '</div>' +
                                    '<div id="brandExamplePreviewContainer" style="display: none;" class="text-center mt-3">' +
                                        '<img id="brandExamplePreview" src="" alt="Marka Örneği" style="max-width: 200px; max-height: 200px; border: 1px solid #ddd; border-radius: 8px;">' +
                                        '<br>' +
                                        '<button type="button" id="removeBrandExampleBtn" class="btn btn-danger btn-sm mt-2">' +
                                            '<i class="fas fa-trash"></i> Kaldır' +
                                        '</button>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    // Tab 2: Başvuru Sahipleri
                    '<div class="tab-pane fade" id="applicants" role="tabpanel">' +
                        '<div class="d-flex justify-content-between align-items-center mb-3">' +
                            '<h5>Başvuru Sahipleri</h5>' +
                            '<button type="button" class="btn-add-person btn-small" id="addApplicantBtn">' +
                                '<i class="fas fa-plus"></i> Yeni Kişi Ekle' +
                            '</button>' +
                        '</div>' +
                        '<div class="form-group">' +
                            '<label for="applicantSearch" class="form-label">Başvuru Sahibi Ara</label>' +
                            '<div class="search-input-wrapper">' +
                                '<input type="text" id="applicantSearch" class="search-input" placeholder="İsim veya e-mail ile ara...">' +
                                '<div id="applicantSearchResults" class="search-results-list" style="display: none;"></div>' +
                            '</div>' +
                        '</div>' +
                        '<div id="selectedApplicantsContainer" class="selected-items-container">' +
                            '<div class="empty-state text-center py-4">' +
                                '<i class="fas fa-users fa-2x text-muted mb-2"></i>' +
                                '<p class="text-muted">Henüz başvuru sahibi seçilmedi</p>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    // Tab 3: Rüçhan
                    '<div class="tab-pane fade" id="priority" role="tabpanel">' +
                        '<div class="form-section">' +
                            '<h3 class="section-title">Rüçhan Bilgileri</h3>' +
                            '<p class="text-muted mb-3">Birden fazla rüçhan hakkı ekleyebilirsiniz.</p>' +
                            
                            '<div class="form-group row">' +
                                '<label for="priorityType" class="col-sm-3 col-form-label">Rüçhan Tipi</label>' +
                                '<div class="col-sm-9">' +
                                    '<select class="form-control" id="priorityType">' +
                                        '<option value="başvuru" selected>Başvuru</option>' +
                                        '<option value="sergi">Sergi</option>' +
                                    '</select>' +
                                '</div>' +
                            '</div>' +
                            
                            '<div class="form-group row">' +
                                '<label for="priorityDate" class="col-sm-3 col-form-label" id="priorityDateLabel">Rüçhan Tarihi</label>' +
                                '<div class="col-sm-9">' +
                                    '<input type="date" class="form-control" id="priorityDate">' +
                                '</div>' +
                            '</div>' +
                            
                            '<div class="form-group row">' +
                                '<label for="priorityCountry" class="col-sm-3 col-form-label">Rüçhan Ülkesi</label>' +
                                '<div class="col-sm-9">' +
                                    '<select class="form-control" id="priorityCountry">' +
                                        '<option value="">Seçiniz...</option>' +
                                    '</select>' +
                                '</div>' +
                            '</div>' +
                            
                            '<div class="form-group row">' +
                                '<label for="priorityNumber" class="col-sm-3 col-form-label">Rüçhan Numarası</label>' +
                                '<div class="col-sm-9">' +
                                    '<input type="text" class="form-control" id="priorityNumber" placeholder="Örn: 2023/12345">' +
                                '</div>' +
                            '</div>' +
                            
                            '<div class="form-group full-width text-right mt-3">' +
                                '<button type="button" id="addPriorityBtn" class="btn btn-secondary">' +
                                    '<i class="fas fa-plus mr-1"></i> Rüçhan Ekle' +
                                '</button>' +
                            '</div>' +
                            
                            '<hr class="my-4">' +
                            
                            '<div class="form-group full-width">' +
                                '<label class="form-label">Eklenen Rüçhan Hakları</label>' +
                                '<div id="addedPrioritiesList" class="selected-items-list">' +
                                    '<div class="empty-state text-center py-4">' +
                                        '<i class="fas fa-info-circle fa-2x text-muted mb-2"></i>' +
                                        '<p class="text-muted">Henüz rüçhan bilgisi eklenmedi.</p>' +
                                    '</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    // Tab 4: Mal ve Hizmetler (Nice Classification)
                    '<div class="tab-pane fade" id="goods-services" role="tabpanel">' +
                        '<div class="nice-classification-container">' +
                            '<div class="row">' +
                                '<div class="col-lg-8">' +
                                    '<div class="classification-panel mb-3">' +
                                        '<div class="panel-header">' +
                                            '<h5 class="mb-0">' +
                                                '<i class="fas fa-list-ul mr-2"></i>' +
                                                'Nice Classification - Mal ve Hizmet Sınıfları' +
                                            '</h5>' +
                                            '<small class="text-white-50">1-45 arası sınıflardan seçim yapın</small>' +
                                        '</div>' +
                                        '<div class="search-section">' +
                                            '<div class="input-group">' +
                                                '<div class="input-group-prepend">' +
                                                    '<span class="input-group-text">' +
                                                        '<i class="fas fa-search"></i>' +
                                                    '</span>' +
                                                '</div>' +
                                                '<input type="text" class="form-control" id="niceClassSearch" placeholder="Sınıf ara... (örn: kozmetik, kimyasal, teknoloji)">' +
                                                '<div class="input-group-append">' +
                                                    '<button class="btn btn-outline-secondary" type="button" onclick="clearNiceSearch()">' +
                                                        '<i class="fas fa-times"></i>' +
                                                    '</button>' +
                                                '</div>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="classes-list" id="niceClassificationList">' +
                                            '<!-- Nice classification sınıfları buraya yüklenecek -->' +
                                        '</div>' +
                                    '</div>' +
                                    '<!-- Özel Mal/Hizmet Tanımı - Liste altında -->' +
                                    '<div class="custom-class-frame">' +
                                        '<div class="custom-class-section">' +
                                            '<label class="form-label">Özel Mal/Hizmet Tanımı</label>' +
                                            '<textarea id="customClassInput" class="form-control" rows="3" placeholder="Standart sınıflarda olmayan özel mal/hizmetlerinizi buraya yazabilirsiniz..."></textarea>' +
                                            '<div class="d-flex justify-content-between align-items-center mt-2">' +
                                                '<small class="text-muted">' +
                                                    '<span id="customClassCharCount">0</span>/500 karakter' +
                                                '</small>' +
                                                '<button type="button" class="btn btn-warning btn-sm" id="addCustomClassBtn">' +
                                                    '<i class="fas fa-plus mr-1"></i>Ekle' +
                                                '</button>' +
                                            '</div>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="col-lg-4">' +
                                '    <div class="selected-classes-panel">' +
                                '        <div class="panel-header">' +
                                '            <div class="d-flex justify-content-between align-items-center">' +
                                '                <div>' +
                                '                    <h5 class="mb-0">' +
                                '                        <i class="fas fa-check-circle mr-2"></i>' +
                                '                        Seçilen Sınıflar' +
                                '                    </h5>' +
                                '                    <small class="text-white-50">Toplam: <span id="selectedClassCount">0</span></small>' +
                                '                </div>' +
                                '                <button type="button" class="btn btn-outline-light btn-sm" id="clearAllClassesBtn" style="display: none;" title="Tüm seçimleri temizle">' +
                                '                    <i class="fas fa-trash"></i> Temizle' +
                                '                </button>' +
                                '            </div>' +
                                '        </div>' +
                                '        <div class="scrollable-list" id="selectedNiceClasses" style="max-height: 700px; overflow-y: auto; padding: 15px;">' +
                                '            <div class="empty-state text-center py-4">' +
                                '                <i class="fas fa-clipboard-list fa-2x text-muted mb-2"></i>' +
                                '                <p class="text-muted">Henüz sınıf seçilmedi</p>' +
                                '            </div>' +
                                '        </div>' +
                                '    </div>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        this.dynamicFormContainer.innerHTML = html;
        
        // Durum select'ini STATUSES.trademark ile doldur
        const stSel = document.getElementById('trademarkStatus');
        if (stSel) {
        stSel.innerHTML = STATUSES.trademark
            .map(s => `<option value="${s.value}">${s.text}</option>`)
            .join('');
        // Varsayılan olarak "filed"
        if (!stSel.value) stSel.value = 'filed';
        }

        this.setupDynamicFormListeners();
        this.setupBrandExampleUploader();
        this.setupClearClassesButton(); // Temizle butonu setup'ını ekle
        this.populateCountriesDropdown();
        this.updateSaveButtonState();
    }

    renderPatentForm() {
        console.log('⚗️ Patent formu render ediliyor...');
        
        const html = '<div class="form-section">' +
            '<h3 class="section-title">Patent Bilgileri</h3>' +
            '<div class="form-grid">' +
                '<div class="form-group">' +
                    '<label for="patentTitle" class="form-label">Patent Başlığı</label>' +
                    '<input type="text" id="patentTitle" class="form-input" placeholder="Patent başlığını girin">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label for="patentApplicationNumber" class="form-label">Başvuru Numarası</label>' +
                    '<input type="text" id="patentApplicationNumber" class="form-input" placeholder="Başvuru numarasını girin">' +
                '</div>' +
                '<div class="form-group full-width">' +
                    '<label for="patentDescription" class="form-label">Patent Açıklaması</label>' +
                    '<textarea id="patentDescription" class="form-textarea" rows="4" placeholder="Patent hakkında detaylı açıklama girin"></textarea>' +
                '</div>' +
            '</div>' +
        '</div>';

        this.dynamicFormContainer.innerHTML = html;
        this.updateSaveButtonState();
    }

    renderDesignForm() {
        console.log('🎨 Tasarım formu render ediliyor...');
        
        const html = '<div class="form-section">' +
            '<h3 class="section-title">Tasarım Bilgileri</h3>' +
            '<div class="form-grid">' +
                '<div class="form-group">' +
                    '<label for="designTitle" class="form-label">Tasarım Başlığı</label>' +
                    '<input type="text" id="designTitle" class="form-input" placeholder="Tasarım başlığını girin">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label for="designApplicationNumber" class="form-label">Başvuru Numarası</label>' +
                    '<input type="text" id="designApplicationNumber" class="form-input" placeholder="Başvuru numarasını girin">' +
                '</div>' +
                '<div class="form-group full-width">' +
                    '<label for="designDescription" class="form-label">Tasarım Açıklaması</label>' +
                    '<textarea id="designDescription" class="form-textarea" rows="4" placeholder="Tasarım hakkında detaylı açıklama girin"></textarea>' +
                '</div>' +
            '</div>' +
        '</div>';

        this.dynamicFormContainer.innerHTML = html;
        this.updateSaveButtonState();
    }

    setupDynamicFormListeners() {
        console.log('🎯 Dynamic form listeners kuruluyor...');
        
        // Tab değişim listener'ları - jQuery ve vanilla JS ikisini de deneyelim
        const tabLinks = document.querySelectorAll('#portfolioTabs a[data-toggle="tab"]');
        tabLinks.forEach(tabLink => {
            // Bootstrap tab event
            tabLink.addEventListener('shown.bs.tab', (e) => {
                const targetTab = e.target.getAttribute('href');
                console.log('📋 Tab değişti (Bootstrap):', targetTab);
                this.handleTabChange(targetTab);
            });
            
            // Tıklama eventi de ekleyelim
            tabLink.addEventListener('click', (e) => {
                const targetTab = e.target.getAttribute('href');
                console.log('📋 Tab tıklandı:', targetTab);
                setTimeout(() => {
                    this.handleTabChange(targetTab);
                }, 200);
            });
        });

        // jQuery varsa o da çalışsın
        if (window.$ && window.$('#portfolioTabs a[data-toggle="tab"]').length > 0) {
            window.$('#portfolioTabs a[data-toggle="tab"]').on('shown.bs.tab', (e) => {
                const targetTab = window.$(e.target).attr('href');
                console.log('📋 Tab değişti (jQuery):', targetTab);
                this.handleTabChange(targetTab);
            });
        }

        // Başvuru sahibi arama
        const applicantSearch = document.getElementById('applicantSearch');
        if (applicantSearch) {
            applicantSearch.addEventListener('input', (e) => {
                this.searchPersons(e.target.value, 'applicant');
            });
        }

        // Yeni kişi ekleme butonu
        const addApplicantBtn = document.getElementById('addApplicantBtn');
        if (addApplicantBtn) {
            addApplicantBtn.addEventListener('click', () => {
                // openPersonModal fonksiyonuna, yeni kişi kaydedildiğinde
                // çalışacak bir callback fonksiyonu gönderiyoruz.
                openPersonModal((newPerson) => {
                    // Callback çağrıldığında, yeni kişiyi
                    // ana kişi listemize (allPersons) ekliyoruz.
                    this.allPersons.push(newPerson);

                    // Ardından, bu kişiyi başvuru sahipleri listesine ekliyoruz.
                    this.addSelectedPerson(newPerson, 'applicant');

                    // Modalı kapat
                    this.hideAddPersonModal();

                    // Konsol çıktısı
                    console.log('✅ Yeni kişi eklendi:', newPerson);
                });
            });
        }

        // Rüçhan ekleme butonu
        const addPriorityBtn = document.getElementById('addPriorityBtn');
        if (addPriorityBtn) {
            addPriorityBtn.addEventListener('click', () => {
                this.addPriority();
            });
        }

        // Rüçhan tipi değişim listener'ı
        const priorityType = document.getElementById('priorityType');
        if (priorityType) {
            priorityType.addEventListener('change', (e) => {
                this.handlePriorityTypeChange(e.target.value);
            });
        }

        // Rüçhan listesi click listener'ı
        const addedPrioritiesList = document.getElementById('addedPrioritiesList');
        if (addedPrioritiesList) {
            addedPrioritiesList.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.remove-priority-btn');
                if (removeBtn) {
                    const priorityId = removeBtn.dataset.id;
                    this.removePriority(priorityId);
                }
            });
        }

        // Form input change listeners
        this.dynamicFormContainer.addEventListener('input', () => {
            this.updateSaveButtonState();
        });

        // Temizle butonu için event listener
        $(document).on('click', '#clearAllClassesBtn', () => {
            if (typeof window.clearAllSelectedClasses === 'function') {
                window.clearAllSelectedClasses();
                console.log('✅ Tüm sınıflar temizlendi');
            } else {
                console.error('❌ clearAllSelectedClasses fonksiyonu bulunamadı.');
            }
        });
        this.initializeDatePickers();
    }
    // Yeni metod: Tarih seçicileri başlatma
    initializeDatePickers() {
        // Takvim işlevselliği eklemek istediğiniz tüm ID'leri buraya ekleyin
        const dateFields = [
            'applicationDate',
            'registrationDate',
            'renewalDate',
            'bulletinDate',
            'priorityDate',
            // Diğer tarih alanlarını buraya ekleyebilirsiniz
        ];

        dateFields.forEach(fieldId => {
            const element = document.getElementById(fieldId);
            if (element) {
                flatpickr(element, {
                    dateFormat: "Y-m-d",      // Yıl-Ay-Gün formatı
                    allowInput: true,         // Manuel girişe izin ver
                    clickOpens: true,         // Giriş alanına tıklama takvimi açar
                    locale: "tr"              // Türkçe dil desteği
                });
            }
        });
    }
    handleTabChange(targetTab) {
        if (targetTab === '#goods-services' && !this.isNiceInitialized) {
            console.log('🔄 Nice Classification başlatılıyor...');
            console.log('🔍 DOM elementleri kontrol ediliyor...');
            
            const niceList = document.getElementById('niceClassificationList');
            const selectedList = document.getElementById('selectedNiceClasses');
            const searchInput = document.getElementById('niceClassSearch');
            
            console.log('📋 Nice elementleri:', {
                niceList: !!niceList,
                selectedList: !!selectedList,
                searchInput: !!searchInput
            });
            
            if (niceList && selectedList && searchInput) {
                this.isNiceInitialized = true;
                console.log('✅ Nice Classification elementleri hazır, başlatılıyor...');
                
                setTimeout(() => {
                    initializeNiceClassification()
                        .then(() => {
                            console.log('✅ Nice Classification başarıyla başlatıldı');
                            // Temizle butonu event listener'ı ekle
                            this.setupClearClassesButton();
                        })
                        .catch((error) => {
                            console.error('❌ Nice Classification başlatma hatası:', error);
                        });
                }, 100);
            } else {
                console.error('❌ Nice Classification elementleri bulunamadı');
            }
        }
    }

    setupClearClassesButton() {
        const clearBtn = document.getElementById('clearAllClassesBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Tüm seçilen sınıfları temizlemek istediğinizden emin misiniz?')) {
                    // clearAllSelectedClasses fonksiyonu nice-classification.js'de tanımlı
                    if (window.clearAllSelectedClasses) {
                        window.clearAllSelectedClasses();
                        console.log('✅ Tüm sınıflar temizlendi');
                    }
                }
            });
        }

        // MutationObserver ile selectedClassCount'u izle
        const countBadge = document.getElementById('selectedClassCount');
        if (countBadge) {
            const observer = new MutationObserver(() => {
                this.updateClearButtonVisibility();
            });
            observer.observe(countBadge, { childList: true, characterData: true, subtree: true });
        }
    }

    updateClearButtonVisibility() {
        const clearBtn = document.getElementById('clearAllClassesBtn');
        const countBadge = document.getElementById('selectedClassCount');
        
        if (clearBtn && countBadge) {
            const count = parseInt(countBadge.textContent) || 0;
            clearBtn.style.display = count > 0 ? 'inline-block' : 'none';
            console.log('🔄 Temizle butonu güncellendi, seçim sayısı:', count);
        }
    }

    searchPersons(searchTerm, type) {
        const resultsContainer = document.getElementById(`${type}SearchResults`);
        if (!resultsContainer) return;

        if (searchTerm.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }

        const filteredPersons = this.allPersons.filter(person => 
            person.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (person.email && person.email.toLowerCase().includes(searchTerm.toLowerCase()))
        );

        if (filteredPersons.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results-message">Sonuç bulunamadı</div>';
        } else {
            resultsContainer.innerHTML = filteredPersons.map(person => 
                '<div class="search-result-item" data-person-id="' + person.id + '">' +
                    '<strong>' + person.name + '</strong>' +
                    (person.email ? '<br><small class="text-muted">' + person.email + '</small>' : '') +
                '</div>'
            ).join('');

            // Tıklama listener'ları ekle
            resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const personId = item.dataset.personId;
                    const person = this.allPersons.find(p => p.id === personId);
                    if (person) {
                        this.addSelectedPerson(person, type);
                        document.getElementById(`${type}Search`).value = '';
                        resultsContainer.style.display = 'none';
                    }
                });
            });
        }

        resultsContainer.style.display = 'block';
    }

    addSelectedPerson(person, type) {
        if (type === 'applicant') {
            // Zaten seçili mi kontrol et
            if (this.selectedApplicants.find(p => p.id === person.id)) {
                alert('Bu kişi zaten seçili');
                return;
            }

            this.selectedApplicants.push(person);
            this.renderSelectedApplicants();
        }
        
        this.updateSaveButtonState();
    }

    renderSelectedApplicants() {
        const container = document.getElementById('selectedApplicantsContainer');
        if (!container) return;

        if (this.selectedApplicants.length === 0) {
            container.innerHTML = 
                '<div class="empty-state text-center py-4">' +
                    '<i class="fas fa-users fa-2x text-muted mb-2"></i>' +
                    '<p class="text-muted">Henüz başvuru sahibi seçilmedi</p>' +
                '</div>';
        } else {
            container.innerHTML = this.selectedApplicants.map(person => 
                '<div class="selected-item">' +
                    '<span><strong>' + person.name + '</strong>' + (person.email ? ' (' + person.email + ')' : '') + '</span>' +
                    '<button type="button" class="remove-selected-item-btn" data-person-id="' + person.id + '">' +
                        '&times;' +
                    '</button>' +
                '</div>'
            ).join('');

            // Kaldır butonları için listener'lar
            container.querySelectorAll('.remove-selected-item-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const personId = btn.dataset.personId;
                    this.selectedApplicants = this.selectedApplicants.filter(p => p.id !== personId);
                    this.renderSelectedApplicants();
                    this.updateSaveButtonState();
                });
            });
        }
    }

    setupBrandExampleUploader() {
        const uploadArea = document.getElementById('brandExampleUploadArea');
        const fileInput = document.getElementById('brandExample');
        
        if (!uploadArea || !fileInput) return;

        // Drag & Drop olayları
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.style.backgroundColor = '#e9ecef';
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.style.backgroundColor = '#f8f9fa';
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.style.backgroundColor = '#f8f9fa';
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleBrandExampleFile(files[0]);
            }
        });

        // Tıklama olayı
        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        // Dosya seçim olayı
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleBrandExampleFile(e.target.files[0]);
            }
        });

        // Kaldır butonu
        const removeBtn = document.getElementById('removeBrandExampleBtn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                const previewContainer = document.getElementById('brandExamplePreviewContainer');
                const previewImage = document.getElementById('brandExamplePreview');
                
                if (previewContainer) previewContainer.style.display = 'none';
                if (previewImage) previewImage.src = '';
                if (fileInput) fileInput.value = '';
                
                this.uploadedBrandImage = null;
                this.updateSaveButtonState();
            });
        }
    }

    handleBrandExampleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Lütfen geçerli bir resim dosyası seçin (PNG, JPG, JPEG)');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const previewContainer = document.getElementById('brandExamplePreviewContainer');
            const previewImage = document.getElementById('brandExamplePreview');
            
            if (previewImage) previewImage.src = e.target.result;
            if (previewContainer) previewContainer.style.display = 'block';
            
            this.uploadedBrandImage = file;
            this.updateSaveButtonState();
        };
        
        reader.readAsDataURL(file);
    }

    // Rüçhan (Priority) Fonksiyonları
    handlePriorityTypeChange(value) {
        const priorityDateLabel = document.getElementById('priorityDateLabel');
        if (priorityDateLabel) {
            if (value === 'sergi') {
                priorityDateLabel.textContent = 'Sergi Tarihi';
            } else {
                priorityDateLabel.textContent = 'Rüçhan Tarihi';
            }
        }
    }

    addPriority() {
        const priorityType = document.getElementById('priorityType')?.value;
        const priorityDate = document.getElementById('priorityDate')?.value;
        const priorityCountry = document.getElementById('priorityCountry')?.value;
        const priorityNumber = document.getElementById('priorityNumber')?.value;

        if (!priorityDate || !priorityCountry || !priorityNumber) {
            alert('Lütfen tüm rüçhan bilgilerini doldurun.');
            return;
        }

        const newPriority = {
            id: Date.now().toString(),
            type: priorityType,
            date: priorityDate,
            country: priorityCountry,
            number: priorityNumber
        };

        this.priorities.push(newPriority);
        this.renderPriorities();

        // Formu temizle
        document.getElementById('priorityDate').value = '';
        document.getElementById('priorityCountry').value = '';
        document.getElementById('priorityNumber').value = '';
        
        console.log('✅ Rüçhan eklendi:', newPriority);
    }

    removePriority(priorityId) {
        this.priorities = this.priorities.filter(p => p.id !== priorityId);
        this.renderPriorities();
        console.log('🗑️ Rüçhan kaldırıldı:', priorityId);
    }

    renderPriorities() {
        const container = document.getElementById('addedPrioritiesList');
        if (!container) return;

        if (this.priorities.length === 0) {
            container.innerHTML = 
                '<div class="empty-state text-center py-4">' +
                    '<i class="fas fa-info-circle fa-2x text-muted mb-2"></i>' +
                    '<p class="text-muted">Henüz rüçhan bilgisi eklenmedi.</p>' +
                '</div>';
            return;
        }

        let html = '';
        this.priorities.forEach(priority => {
            html += 
                '<div class="selected-item d-flex justify-content-between align-items-center p-2 mb-2 border rounded">' +
                    '<span>' +
                        '<b>Tip:</b> ' + (priority.type === 'sergi' ? 'Sergi' : 'Başvuru') + ' | ' +
                        '<b>Tarih:</b> ' + priority.date + ' | ' +
                        '<b>Ülke:</b> ' + priority.country + ' | ' +
                        '<b>Numara:</b> ' + priority.number +
                    '</span>' +
                    '<button type="button" class="btn btn-sm btn-danger remove-priority-btn" data-id="' + priority.id + '">' +
                        '<i class="fas fa-trash-alt"></i>' +
                    '</button>' +
                '</div>';
        });
        
        container.innerHTML = html;
    }

    updateSaveButtonState() {
    const ipType = this.ipTypeSelect.value;
    const recordOwnerType = this.recordOwnerTypeSelect?.value;
    let isComplete = false;

    if (!ipType || !recordOwnerType) {
        this.saveBtn.disabled = true;
        return;
    }

    if (ipType === 'trademark') {
        const brandText = document.getElementById('brandExampleText');
        const hasApplicants = this.selectedApplicants.length > 0;
        isComplete = brandText && brandText.value.trim() && hasApplicants;
    } else if (ipType === 'patent') {
        const patentTitle = document.getElementById('patentTitle');
        isComplete = patentTitle && patentTitle.value.trim();
    } else if (ipType === 'design') {
        const designTitle = document.getElementById('designTitle');
        isComplete = designTitle && designTitle.value.trim();
    }

    if (this.saveBtn) {
        this.saveBtn.disabled = !isComplete;
    }
    }

    async uploadFileToStorage(file, path) {
        if (!file || !path) {
            return null;
        }
        
        const storageRef = ref(storage, path);
        try {
            const uploadResult = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(uploadResult.ref);
            return downloadURL;
        } catch (error) {
            console.error("Dosya yüklenirken hata oluştu:", error);
            return null;
        }
    }
// ✅ Eklenecek metod: loadRecordForEditing
async loadRecordForEditing() {
    const urlParams = new URLSearchParams(window.location.search);
    this.editingRecordId = urlParams.get('id');

    const formTitle = document.getElementById('formTitle');
    
    if (this.editingRecordId) {
        if (formTitle) formTitle.textContent = 'Kayıt Düzenle';

        try {
            const recordResult = await ipRecordsService.getRecordById(this.editingRecordId);
            if (recordResult.success) {
                this.populateFormFields(recordResult.data);
            } else {
                console.error('Kayıt yüklenemedi: ' + (recordResult.message || 'Bilinmeyen hata'));
            }
        } catch (error) {
            console.error('Kayıt yüklenirken bir hata oluştu:', error);
        }
    } else {
        if (formTitle) formTitle.textContent = 'Yeni Kayıt Ekle';
        this.currentIpType = this.ipTypeSelect.value;
        this.handleIPTypeChange(this.currentIpType);
    }
}

// ✅ Yeni veri yapısına uygun populateFormFields fonksiyonu
populateFormFields(recordData) {
    if (!recordData) return;

    console.log('🔄 Form alanları doldruluyor:', recordData);

    // IP türünü ayarla ve formu yeniden render et
    const ipType = recordData.type || recordData.ipType; // Yeni yapıda 'type' alanı
    this.ipTypeSelect.value = ipType || 'trademark';
    this.currentIpType = this.ipTypeSelect.value;
    this.handleIPTypeChange(this.currentIpType);

    // Record Owner Type
    if (this.recordOwnerTypeSelect && recordData.recordOwnerType) {
        this.recordOwnerTypeSelect.value = recordData.recordOwnerType;
    }

    // Formu render ettikten sonra alanları doldurmak için setTimeout kullan
    setTimeout(() => {
        // Ortak alanları doldur (yeni veri yapısından)
        const formTitle = document.getElementById('formTitle');
        if (formTitle) formTitle.textContent = 'Kayıt Düzenle';

        // ✅ Yeni yapıya göre - ana seviyeden al
        const applicationNumber = document.getElementById('applicationNumber');
        if (applicationNumber) applicationNumber.value = recordData.applicationNumber || '';

        const applicationDate = document.getElementById('applicationDate');
        if (applicationDate) applicationDate.value = recordData.applicationDate || '';

        const registrationNumber = document.getElementById('registrationNumber');
        if (registrationNumber) registrationNumber.value = recordData.registrationNumber || '';

        const registrationDate = document.getElementById('registrationDate');
        if (registrationDate) registrationDate.value = recordData.registrationDate || '';
        
        const renewalDate = document.getElementById('renewalDate');
        if (renewalDate) renewalDate.value = recordData.renewalDate || '';

        // Marka özel alanları
        if (this.currentIpType === 'trademark') {
            const brandType = document.getElementById('brandType');
            if (brandType) brandType.value = recordData.brandType || null;

            const brandCategory = document.getElementById('brandCategory');
            if (brandCategory) brandCategory.value = recordData.brandCategory || null;

            const nonLatinAlphabet = document.getElementById('nonLatinAlphabet');
            if (nonLatinAlphabet) nonLatinAlphabet.value = recordData.nonLatinAlphabet || null;

            // ✅ Yeni yapıya göre - brandText ana seviyede
            const brandText = document.getElementById('brandExampleText');
            if (brandText) brandText.value = recordData.title || recordData.brandText || '';

            // ✅ Açıklama ana seviyeden
            const description = document.getElementById('brandDescription');
            if (description) description.value = recordData.description || '';
            
            const b0 = Array.isArray(recordData.bulletins) ? recordData.bulletins[0] : null;
            const bNo = document.getElementById('bulletinNo');
            const bDt = document.getElementById('bulletinDate');
            if (b0) {
                if (bNo) bNo.value = b0.bulletinNo || '';
                if (bDt) bDt.value = b0.bulletinDate || '';
            } else {
                if (bNo) bNo.value = '';
                if (bDt) bDt.value = '';
            }

            // ✅ Marka görseli - brandImageUrl ana seviyede
            const brandImageUrl = this.uploadedBrandImage || null;
            if (recordData.brandImageUrl) {
                this.uploadedBrandImage = recordData.brandImageUrl; // String olarak sakla
                
                const imagePreview = document.getElementById('brandExamplePreview');
                if (imagePreview) {
                    imagePreview.src = recordData.brandImageUrl;
                    imagePreview.style.display = 'block';
                }
                
                const previewContainer = document.getElementById('brandExamplePreviewContainer');
                if (previewContainer) previewContainer.style.display = 'block';
            }

            // ✅ Nice sınıfları - goodsAndServices ana seviyede
            if (recordData.goodsAndServicesByClass && recordData.goodsAndServicesByClass.length > 0) {
                if (typeof setSelectedNiceClasses === 'function') {
                    const flattenedGoodsAndServices = recordData.goodsAndServicesByClass.flatMap(group =>
                        group.items.map(item => `${group.classNo}. ${item}`)
                    );
                    console.log('🎯 Nice sınıfları ayarlanıyor:', flattenedGoodsAndServices);
                    setSelectedNiceClasses(flattenedGoodsAndServices);
                }
            }

            // ✅ Başvuru sahipleri - applicants ana seviyede
            if (recordData.applicants && recordData.applicants.length > 0) {
                this.selectedApplicants = recordData.applicants.map(applicant => ({
                    id: applicant.id,
                    name: applicant.name,
                    email: applicant.email || ''
                }));
                this.renderSelectedApplicants();
                console.log('👥 Başvuru sahipleri yüklendi:', this.selectedApplicants);
            }

            // ✅ Rüçhan bilgileri - priorities ana seviyede  
            if (recordData.priorities && recordData.priorities.length > 0) {
                this.priorities = recordData.priorities;
                this.renderPriorities();
                console.log('🏆 Rüçhan bilgileri yüklendi:', this.priorities);
            }
        }

        // Patent özel alanları
        else if (this.currentIpType === 'patent') {
            // ✅ Patent için title ana seviyede
            const patentTitle = document.getElementById('patentTitle');
            if (patentTitle) patentTitle.value = recordData.title || '';

            const patentApplicationNumber = document.getElementById('patentApplicationNumber');
            if (patentApplicationNumber) patentApplicationNumber.value = recordData.applicationNumber || '';

            const patentDescription = document.getElementById('patentDescription');
            if (patentDescription) patentDescription.value = recordData.description || '';

            // Başvuru sahipleri ve rüçhan bilgileri patent için de
            if (recordData.applicants && recordData.applicants.length > 0) {
                this.selectedApplicants = recordData.applicants;
                this.renderSelectedApplicants();
            }

            if (recordData.priorities && recordData.priorities.length > 0) {
                this.priorities = recordData.priorities;
                this.renderPriorities();
            }
        }

        // Tasarım özel alanları
        else if (this.currentIpType === 'design') {
            // ✅ Tasarım için title ana seviyede
            const designTitle = document.getElementById('designTitle');
            if (designTitle) designTitle.value = recordData.title || '';

            const designApplicationNumber = document.getElementById('designApplicationNumber');
            if (designApplicationNumber) designApplicationNumber.value = recordData.applicationNumber || '';

            const designDescription = document.getElementById('designDescription');
            if (designDescription) designDescription.value = recordData.description || '';

            // Başvuru sahipleri ve rüçhan bilgileri tasarım için de
            if (recordData.applicants && recordData.applicants.length > 0) {
                this.selectedApplicants = recordData.applicants;
                this.renderSelectedApplicants();
            }

            if (recordData.priorities && recordData.priorities.length > 0) {
                this.priorities = recordData.priorities;
                this.renderPriorities();
            }
        }

        // Kaydet butonunun durumunu güncelle
        this.updateSaveButtonState();
        
        console.log('✅ Form alanları başarıyla dolduruldu');
    }, 500); // Form render edilmesini bekle
}
 async handleSavePortfolio() {
    const ipType = this.ipTypeSelect.value;
    
    if (!ipType) {
        alert('Lütfen bir IP türü seçin');
        return;
    }

    let portfolioData = {
        ipType: ipType,
        portfoyStatus: 'active', // ✅ Kayıt durumu için portfoyStatus
        status: 'filed', // ✅ Başvuru durumu için status - default filed
        createdAt: new Date().toISOString(),
        recordOwnerType: this.recordOwnerTypeSelect.value,
        details: {}
    };

    try {
        if (ipType === 'trademark') {
            await this.saveTrademarkPortfolio(portfolioData);
        } else if (ipType === 'patent') {
            await this.savePatentPortfolio(portfolioData);
        } else if (ipType === 'design') {
            await this.saveDesignPortfolio(portfolioData);
        }
    } catch (error) {
        console.error('Portföy kaydı kaydetme hatası:', error);
        alert('Portföy kaydı kaydedilirken bir hata oluştu');
    }
}
// data-entry.js dosyasındaki saveTrademarkPortfolio fonksiyonunda yapılacak değişiklik:

async saveTrademarkPortfolio(portfolioData) {
    // Form verilerini al
    const brandText = document.getElementById('brandExampleText').value.trim();
    const applicationNumber = document.getElementById('applicationNumber').value.trim();
    const applicationDate = document.getElementById('applicationDate').value;
    const registrationNumber = document.getElementById('registrationNumber').value.trim();
    const registrationDate = document.getElementById('registrationDate').value;
    const renewalDate = document.getElementById('renewalDate').value;
    const description = document.getElementById('brandDescription').value.trim();
    
    const goodsAndServices = getSelectedNiceClasses();
    if (!Array.isArray(goodsAndServices) || goodsAndServices.length === 0) {
        alert('Lütfen en az bir mal veya hizmet seçin.');
        return;
    }

    // ✅ MARKA GÖRSELİ UPLOAD İŞLEMİ - BURASI ÖNEMLİ!
    let brandImageUrl = null;
    
    // Eğer uploadedBrandImage bir File nesnesi ise Firebase Storage'a yükle
    if (this.uploadedBrandImage && typeof this.uploadedBrandImage === 'object' && this.uploadedBrandImage instanceof File) {
        try {
            console.log('📤 Marka görseli yükleniyor...', this.uploadedBrandImage.name);
            
            // Firebase Storage'a yükle
            const timestamp = Date.now();
            const storagePath = `brand-examples/${timestamp}_${this.uploadedBrandImage.name}`;
            const storageRef = ref(storage, storagePath);
            
            // Dosyayı yükle
            await uploadBytes(storageRef, this.uploadedBrandImage);
            
            // Download URL'sini al
            brandImageUrl = await getDownloadURL(storageRef);
            
            console.log('✅ Marka görseli başarıyla yüklendi:', brandImageUrl);
            
        } catch (error) {
            console.error('❌ Marka görseli yükleme hatası:', error);
            alert('Marka görseli yüklenirken bir hata oluştu. Lütfen tekrar deneyin.');
            return; // Hata durumunda işlemi durdur
        }
    } 
    // Eğer uploadedBrandImage zaten bir URL string'i ise (edit durumunda)
    else if (this.uploadedBrandImage && typeof this.uploadedBrandImage === 'string') {
        brandImageUrl = this.uploadedBrandImage;
    }
    // Eğer görsel yok ise null bırak
    else {
        brandImageUrl = null;
    }

// 2) Yardımcılar (blok içi; fonksiyon dışına alma zorunluluğu yok)
    const parseClassNo = (val) => {
        if (val == null) return null;
        if (typeof val === 'number') return Number(val);
        if (typeof val === 'object') {
            const cand = val.classNo ?? val.class ?? val.classNumber ?? val.niceClass ?? val.k ?? null;
            if (cand != null) return Number(cand);
            val = val.text ?? val.name ?? val.label ?? '';
        }
        const s = String(val);
        // 1–45 arası sınıfı metinden yakalamaya da çalış
        const m = s.match(/(?:^|\b)([1-9]|[12]\d|3\d|4[0-5])(?:\b|[^\d])/);
        return m ? Number(m[1]) : null;
    };

const deriveNiceClasses = (gas) => {
  const set = new Set();
  const visit = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (typeof v === 'object') {
      const cls = parseClassNo(v); if (cls != null) set.add(cls);
      if (Array.isArray(v.items)) v.items.forEach(visit);
      return;
    }
    const cls = parseClassNo(v); if (cls != null) set.add(cls);
  };
  visit(gas);
  return Array.from(set).sort((a,b)=>a-b);
};

const groupGoodsByClass = (gas) => {
  const groups = new Map();
  const add = (cls, text) => {
    if (cls == null) return;
    const key = Number(cls);
    if (!groups.has(key)) groups.set(key, []);
    const t = String(text ?? '').trim();
    if (t) groups.get(key).push(t);
  };
  const visit = (v, currentClass=null) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(e => visit(e, currentClass)); return; }
    if (typeof v === 'object') {
      const cls = parseClassNo(v) ?? currentClass;
      const maybeText = v.text ?? v.name ?? v.label ?? null;
      if (maybeText) add(cls, maybeText);
      if (Array.isArray(v.items)) {
        v.items.forEach(it => {
          if (typeof it === 'object') {
            const t = it.text ?? it.name ?? it.label ?? JSON.stringify(it);
            const itCls = parseClassNo(it) ?? cls;
            add(itCls, t);
          } else {
            const itCls = parseClassNo(it) ?? cls;
            add(itCls, it);
          }
        });
      }
      return;
    }
    const cls = parseClassNo(v) ?? currentClass;
    add(cls, v);
  };
  visit(gas);
  return Array.from(groups.entries())
    .sort((a,b)=>a[0]-b[0])
    .map(([classNo, items]) => ({ classNo, items }));
};

// 3) Bağı kuran alanlar
const niceClass = deriveNiceClasses(goodsAndServices);      // Örn. [5] veya [5,35]
const goodsAndServicesByClass = groupGoodsByClass(goodsAndServices);

// 4) Kayıt payload’u
const dataToSave = {
  // Temel bilgiler
  title: brandText,
  type: 'trademark',
  portfoyStatus: 'active',
  status: document.getElementById('trademarkStatus')?.value || 'filed',
  recordOwnerType: this.recordOwnerTypeSelect.value,
  
  // Başvuru bilgileri
  applicationNumber: applicationNumber || null,
  applicationDate: applicationDate || null,
  registrationNumber: registrationNumber || null,
  registrationDate: registrationDate || null,
  renewalDate: renewalDate || null,
  
  // Marka özeli
  brandText: brandText,
  brandImageUrl: brandImageUrl,
  description: description || null,
  
  // Ana seviyeye taşınan alanlar
  brandType: document.getElementById('brandType')?.value || 'Şekil + Kelime',
  brandCategory: document.getElementById('brandCategory')?.value || 'Ticaret/Hizmet Markası',
  consentRequest: document.querySelector('input[name="consentRequest"]:checked')?.value || null,
  coverLetterRequest: document.querySelector('input[name="coverLetterRequest"]:checked')?.value || null,
  nonLatinAlphabet: document.getElementById('nonLatinAlphabet')?.value || null,
  goodsAndServicesByClass: goodsAndServicesByClass,

  // 📌 Bülten alanları
  bulletins: (() => {
    const no = document.getElementById('bulletinNo')?.value?.trim();
    const dt = document.getElementById('bulletinDate')?.value?.trim();
    return (no || dt) ? [{ bulletinNo: no || null, bulletinDate: dt || null }] : [];
  })(),
  
  // Ana seviye
  applicants: this.selectedApplicants.map(p => ({ id: p.id, name: p.name, email: p.email || null })),
  priorities: this.priorities,
  
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
// Kaydet
// Kaydet
let result;
let usedId = null;
let isExisting = false;

// 1) update mi create mi?
if (this.editingRecordId) {
  // GÜNCELLEME
  result = await ipRecordsService.updateRecord(this.editingRecordId, dataToSave);
  usedId = this.editingRecordId;
} else {
  // YENİ KAYIT (Data Entry bağlamı)
  result = await ipRecordsService.createRecordFromDataEntry(dataToSave);
  usedId = result?.id || result?.existingRecordId || null;
  isExisting = !!(result?.isExistingRecord || result?.isDuplicate);
}

// 2) başarı kriteri:
// - update: result.success
// - create: result.success || isExisting (mevcut kayıt kullanıldı)
if ((this.editingRecordId && result?.success) || (!this.editingRecordId && (result?.success || isExisting))) {
  // ✅ SADECE yeni kayıt ise ve recordOwnerType 'self' ise transaction ekle
  const shouldAddTransaction = !this.editingRecordId && !isExisting && dataToSave.recordOwnerType === 'self';

  if (shouldAddTransaction) {
    // ipType -> code
    const CODE_BY_IP = {
      trademark: 'TRADEMARK_APPLICATION',
      patent:    'PATENT_APPLICATION',
      design:    'DESIGN_APPLICATION'
    };
    const targetCode = CODE_BY_IP[dataToSave.ipType || 'trademark'];

    // 1) code -> id çöz (önce servis)
    let txTypeId = null;
    try {
      const res = await transactionTypeService.getTransactionTypes();
      const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      const map = new Map(list.map(t => [String((t.code || '').toUpperCase()), String(t.id)]));
      txTypeId = map.get(targetCode);
    } catch (e) {
      console.warn('TxTypes yüklenemedi, fallback kullanılacak:', e);
    }

    // 2) fallback (kendi gerçek ID’lerinle güncelle)
    if (!txTypeId) {
      const TX_IDS = { trademark: '2', patent: '5', design: '8' };
      txTypeId = TX_IDS[dataToSave.ipType || 'trademark'] || '2';
    }

    // 3) Transaction’u **ID** ile yaz
    await ipRecordsService.addTransactionToRecord(String(usedId), {
      type: String(txTypeId),               // ✅ ID
      transactionTypeId: String(txTypeId),  // ✅ güvenlik için
      description: 'Başvuru işlemi.',
      parentId: null,
      transactionHierarchy: 'parent'
    });
  }

  // 3) kullanıcıya mesaj
  const msg = this.editingRecordId
    ? 'Marka portföy kaydı başarıyla güncellendi!'
    : (isExisting
        ? 'Bu başvuru zaten kayıtlıydı; mevcut verilerle yeni bir başvuru oluşturulmadı. Başvuru numarasını lütfen kontrol edin.'
        : 'Marka portföy kaydı başarıyla oluşturuldu!');

  alert(msg);
  window.location.href = 'portfolio.html';
} else {
  alert('Portföy kaydı oluşturulamadı: ' + (result?.error || 'Bilinmeyen hata'));
}
}
// Patent için
async savePatentPortfolio(portfolioData) {
    const patentTitle = document.getElementById('patentTitle').value.trim();
    const applicationNumber = document.getElementById('patentApplicationNumber').value.trim();
    const description = document.getElementById('patentDescription').value.trim();

    const dataToSave = {
        title: patentTitle,
        type: 'patent',
        portfoyStatus: 'active',
        status: 'başvuru',
        recordOwnerType: this.recordOwnerTypeSelect.value,
        
        applicationNumber: applicationNumber || null,
        applicationDate: null,
        registrationNumber: null,
        registrationDate: null,
        renewalDate: null,
        
        brandText: null,
        brandImageUrl: null,
        description: description || null,
        
        applicants: this.selectedApplicants.map(p => ({
            id: p.id,
            name: p.name,
            email: p.email || null
        })),
        priorities: this.priorities,
        goodsAndServices: [],
        
        details: {
            patentInfo: {
                patentTitle: patentTitle,
                patentType: null,
                description: description || null
            }
        },
        
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    const result = await ipRecordsService.createRecordFromDataEntry(dataToSave);
    if (result.success) {
        if (dataToSave.recordOwnerType === 'self' && !this.editingRecordId) {
        // ipType'a göre code belirle
        const CODE_BY_IP = {
            trademark: 'TRADEMARK_APPLICATION',
            patent: 'PATENT_APPLICATION',
            design: 'DESIGN_APPLICATION'
        };
        const targetCode = CODE_BY_IP[dataToSave.ipType] || 'TRADEMARK_APPLICATION';

        // Transaction type ID'sini çek
        let txTypeId = null;
        try {
            const typeRes = await transactionTypeService.getByCode?.(targetCode);
            txTypeId = typeRes?.id || null;
        } catch (err) {
            console.error('Transaction type bulunamadı:', err);
        }

        if (!txTypeId) {
            console.error('Transaction type ID bulunamadı, ekleme yapılmıyor.');
        } else {
            await ipRecordsService.addTransactionToRecord(result.id, {
            type: String(txTypeId), // ✅ Artık ID yazıyoruz
            description: 'Başvuru işlemi.',
            parentId: null,
            transactionHierarchy: 'parent'
            });
        }
        }
        alert('Patent portföy kaydı başarıyla oluşturuldu!');
        window.location.href = 'portfolio.html';
    } else {
        throw new Error(result.error);
    }
}

async getCountries() {
    try {
        const db = getFirestore();
        const docRef = doc(db, 'common', 'countries');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            return data.list || [];
        } else {
            console.log("common/countries belgesi bulunamadı!");
            return [];
        }
    } catch (error) {
        console.error("Ülke listesi çekilirken hata oluştu:", error);
        return [];
    }
}

populateCountriesDropdown() {
    const countrySelect = document.getElementById('priorityCountry');
    if (!countrySelect) return;

    countrySelect.innerHTML = '<option value="">Seçiniz...</option>';

    this.allCountries.forEach(country => {
        const option = document.createElement('option');
        option.value = country.code;
        option.textContent = country.name;
        countrySelect.appendChild(option);
    });
}

// Tasarım için
async saveDesignPortfolio(portfolioData) {
    const designTitle = document.getElementById('designTitle').value.trim();
    const applicationNumber = document.getElementById('designApplicationNumber').value.trim();
    const description = document.getElementById('designDescription').value.trim();

    const dataToSave = {
        title: designTitle,
        type: 'design',
        portfoyStatus: 'active',
        status: 'başvuru',
        recordOwnerType: this.recordOwnerTypeSelect.value,
        
        applicationNumber: applicationNumber || null,
        applicationDate: null,
        registrationNumber: null,
        registrationDate: null,
        renewalDate: null,
        
        brandText: null,
        brandImageUrl: null,
        description: description || null,
        
        applicants: this.selectedApplicants.map(p => ({
            id: p.id,
            name: p.name,
            email: p.email || null
        })),
        priorities: this.priorities,
        goodsAndServices: [],
        
        details: {
            designInfo: {
                designTitle: designTitle,
                designType: null,
                description: description || null
            }
        },
        
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    const result = await ipRecordsService.createRecordFromDataEntry(dataToSave);
    if (result.success) {
        alert('Tasarım portföy kaydı başarıyla oluşturuldu!');
        window.location.href = 'portfolio.html';
    } else {
        throw new Error(result.error);
    }
}
}

// Global fonksiyonlar
window.clearNiceSearch = function() {
    const searchInput = document.getElementById('niceClassSearch');
    if (searchInput) {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
    }
};

// Temizle butonunun görünürlüğünü kontrol et
window.updateClearButton = function() {
    const clearBtn = document.getElementById('clearAllClassesBtn');
    const countBadge = document.getElementById('selectedClassCount');
    
    if (clearBtn && countBadge) {
        const count = parseInt(countBadge.textContent) || 0;
        clearBtn.style.display = count > 0 ? 'inline-block' : 'none';
        console.log('🔄 Temizle butonu güncellendi, seçim sayısı:', count);
    }
};

// Nice Classification render'ından sonra çağrılacak
window.addEventListener('load', () => {
    // Interval ile temizle butonunu kontrol et
    setInterval(() => {
        if (window.updateClearButton) {
            window.updateClearButton();
        }
    }, 1000); // Her saniye kontrol et
});

// Sayfa yüklendiğinde modülü başlat
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Data Entry sayfası yükleniyor...');
    
    try {
        // Önce layout'u yükle
        console.log('📐 Layout yükleniyor...');
        await loadSharedLayout();
        
    ensurePersonModal();
console.log('✅ Layout yüklendi');
        
        // Sonra data entry modülünü başlat
        console.log('📋 Data Entry Module başlatılıyor...');
        const dataEntry = new DataEntryModule();
        await dataEntry.init();
        console.log('✅ Data Entry Module başlatıldı');
        
    } catch (error) {
        console.error('❌ Sayfa yükleme hatası:', error);
    }
});

export default DataEntryModule; 