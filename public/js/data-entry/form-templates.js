// js/templates/form-templates.js

export const FormTemplates = {
    getTrademarkForm: () => `
        <div class="form-section">
            <ul class="nav nav-tabs" id="portfolioTabs" role="tablist">
                <li class="nav-item">
                    <a class="nav-link active" id="brand-info-tab" data-toggle="tab" href="#brand-info" role="tab"><i class="fas fa-tag mr-1"></i>Marka Bilgileri</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" id="applicants-tab" data-toggle="tab" href="#applicants" role="tab"><i class="fas fa-users mr-1"></i>Başvuru Sahipleri</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" id="priority-tab" data-toggle="tab" href="#priority" role="tab"><i class="fas fa-star mr-1"></i>Rüçhan</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" id="goods-services-tab" data-toggle="tab" href="#goods-services" role="tab"><i class="fas fa-list-ul mr-1"></i>Mal ve Hizmetler</a>
                </li>
            </ul>
            
            <div class="tab-content tab-content-card" id="portfolioTabContent">
                <div class="tab-pane fade show active" id="brand-info" role="tabpanel">
                    <div class="form-grid">
                        <div class="form-group">
                            <label for="brandExampleText" class="form-label">Marka Metni</label>
                            <input type="text" id="brandExampleText" class="form-input" placeholder="Marka adını girin">
                        </div>
                        <div id="applicationNumberWrapper" class="form-group">
                            <label id="applicationNumberLabel" for="applicationNumber" class="form-label">Başvuru Numarası</label>
                            <input type="text" id="applicationNumber" class="form-input" placeholder="Başvuru numarasını girin">
                        </div>
                        <div class="form-group">
                            <label for="applicationDate" class="form-label">Başvuru Tarihi</label>
                            <input type="text" id="applicationDate" class="form-input" placeholder="gg.aa.yyyy">
                        </div>
                        <div id="registrationNumberWrapper" class="form-group">
                            <label id="registrationNumberLabel" for="registrationNumber" class="form-label">Tescil Numarası</label>
                            <input type="text" id="registrationNumber" class="form-input" placeholder="Tescil numarasını girin">
                        </div>
                        <div class="form-group">
                            <label for="registrationDate" class="form-label">Tescil Tarihi</label>
                            <input type="text" id="registrationDate" class="form-input" placeholder="gg.aa.yyyy">
                        </div>
                        <div class="form-group">
                            <label for="renewalDate" class="form-label">Yenileme Tarihi</label>
                            <input type="text" id="renewalDate" class="form-input" placeholder="gg.aa.yyyy">
                        </div>
                        <div class="form-group">
                            <label for="trademarkStatus" class="form-label">Durum</label>
                            <select id="trademarkStatus" class="form-select"></select>
                        </div>
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label for="bulletinNo" class="form-label">Bülten No</label>
                                <input id="bulletinNo" type="text" class="form-input" placeholder="Örn. 1">
                            </div>
                            <div class="form-group col-md-6">
                                <label for="bulletinDate" class="form-label">Bülten Tarihi</label>
                                <input id="bulletinDate" type="text" class="form-input" placeholder="gg.aa.yyyy">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="brandType" class="form-label">Marka Tipi</label>
                            <select id="brandType" class="form-select">
                                <option value="Şekil + Kelime" selected>Şekil + Kelime</option>
                                <option value="Kelime">Kelime</option>
                                <option value="Şekil">Şekil</option>
                                <option value="Üç Boyutlu">Üç Boyutlu</option>
                                <option value="Renk">Renk</option>
                                <option value="Ses">Ses</option>
                                <option value="Hareket">Hareket</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="brandCategory" class="form-label">Marka Türü</label>
                            <select id="brandCategory" class="form-select">
                                <option value="Ticaret/Hizmet Markası" selected>Ticaret/Hizmet Markası</option>
                                <option value="Garanti Markası">Garanti Markası</option>
                                <option value="Ortak Marka">Ortak Marka</option>
                            </select>
                        </div>
                        <div class="form-group full-width">
                            <label for="brandDescription" class="form-label">Marka Açıklaması</label>
                            <textarea id="brandDescription" class="form-textarea" rows="3" placeholder="Marka hakkında açıklama girin"></textarea>
                        </div>
                        <div class="form-group full-width">
                            <label class="form-label">Marka Görseli</label>
                            <div class="brand-upload-frame">
                                <input type="file" id="brandExample" accept="image/*" style="display: none;">
                                <div id="brandExampleUploadArea" class="upload-area">
                                    <i class="fas fa-cloud-upload-alt fa-2x text-muted"></i>
                                    <p class="mt-2 mb-0">Dosya seçmek için tıklayın veya sürükleyip bırakın</p>
                                    <small class="text-muted">PNG, JPG, JPEG dosyaları kabul edilir</small>
                                </div>
                                <div id="brandExamplePreviewContainer" style="display: none;" class="text-center mt-3">
                                    <img id="brandExamplePreview" src="" alt="Marka Örneği" style="max-width: 200px; max-height: 200px; border: 1px solid #ddd; border-radius: 8px;">
                                    <br>
                                    <button type="button" id="removeBrandExampleBtn" class="btn btn-danger btn-sm mt-2">
                                        <i class="fas fa-trash"></i> Kaldır
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="tab-pane fade" id="applicants" role="tabpanel">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5>Başvuru Sahipleri</h5>
                        <button type="button" class="btn-add-person btn-small" id="addApplicantBtn">
                            <i class="fas fa-plus"></i> Yeni Kişi Ekle
                        </button>
                    </div>
                    <div class="form-group">
                        <label for="applicantSearch" class="form-label">Başvuru Sahibi Ara</label>
                        <div class="search-input-wrapper">
                            <input type="text" id="applicantSearch" class="search-input" placeholder="İsim veya e-mail ile ara...">
                            <div id="applicantSearchResults" class="search-results-list" style="display: none;"></div>
                        </div>
                    </div>
                    <div id="selectedApplicantsContainer" class="selected-items-container">
                        <div class="empty-state text-center py-4">
                            <i class="fas fa-users fa-2x text-muted mb-2"></i>
                            <p class="text-muted">Henüz başvuru sahibi seçilmedi</p>
                        </div>
                    </div>
                </div>
                
                <div class="tab-pane fade" id="priority" role="tabpanel">
                    <div class="form-section">
                        <h3 class="section-title">Rüçhan Bilgileri</h3>
                        <p class="text-muted mb-3">Birden fazla rüçhan hakkı ekleyebilirsiniz.</p>
                        
                        <div class="form-group row">
                            <label for="priorityType" class="col-sm-3 col-form-label">Rüçhan Tipi</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="priorityType">
                                    <option value="başvuru" selected>Başvuru</option>
                                    <option value="sergi">Sergi</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-group row">
                            <label for="priorityDate" class="col-sm-3 col-form-label" id="priorityDateLabel">Rüçhan Tarihi</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="priorityDate" placeholder="gg.aa.yyyy">
                            </div>
                        </div>
                        
                        <div class="form-group row">
                            <label for="priorityCountry" class="col-sm-3 col-form-label">Rüçhan Ülkesi</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="priorityCountry">
                                    <option value="">Seçiniz...</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-group row">
                            <label for="priorityNumber" class="col-sm-3 col-form-label">Rüçhan Numarası</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="priorityNumber" placeholder="Örn: 2023/12345">
                            </div>
                        </div>
                        
                        <div class="form-group full-width text-right mt-3">
                            <button type="button" id="addPriorityBtn" class="btn btn-secondary">
                                <i class="fas fa-plus mr-1"></i> Rüçhan Ekle
                            </button>
                        </div>
                        <hr class="my-4">
                        <div class="form-group full-width">
                            <label class="form-label">Eklenen Rüçhan Hakları</label>
                            <div id="addedPrioritiesList" class="selected-items-list">
                                <div class="empty-state text-center py-4">
                                    <i class="fas fa-info-circle fa-2x text-muted mb-2"></i>
                                    <p class="text-muted">Henüz rüçhan bilgisi eklenmedi.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="tab-pane fade" id="goods-services" role="tabpanel">
                    <div class="nice-classification-container">
                        <div class="row">
                            <div class="col-lg-8">
                                <div class="classification-panel mb-3">
                                    <div class="panel-header">
                                        <h5 class="mb-0"><i class="fas fa-list-ul mr-2"></i>Nice Classification - Mal ve Hizmet Sınıfları</h5>
                                        <small class="text-white-50">1-45 arası sınıflardan seçim yapın</small>
                                    </div>
                                    <div class="search-section">
                                        <div class="input-group">
                                            <div class="input-group-prepend">
                                                <span class="input-group-text"><i class="fas fa-search"></i></span>
                                            </div>
                                            <input type="text" class="form-control" id="niceClassSearch" placeholder="Sınıf ara... (örn: kozmetik, kimyasal, teknoloji)">
                                            <div class="input-group-append">
                                                <button class="btn btn-outline-secondary" type="button" onclick="clearNiceSearch()">
                                                    <i class="fas fa-times"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="classes-list" id="niceClassificationList"></div>
                                </div>
                                <div class="custom-class-frame">
                                    <div class="custom-class-section">
                                        <label class="form-label">Özel Mal/Hizmet Tanımı</label>
                                        <textarea id="customClassInput" class="form-control" rows="3" placeholder="Standart sınıflarda olmayan özel mal/hizmetlerinizi buraya yazabilirsiniz..."></textarea>
                                        <div class="d-flex justify-content-between align-items-center mt-2">
                                            <small class="text-muted"><span id="customClassCharCount">0</span>/500 karakter</small>
                                            <button type="button" class="btn btn-warning btn-sm" id="addCustomClassBtn">
                                                <i class="fas fa-plus mr-1"></i>Ekle
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-lg-4">
                                <div class="selected-classes-panel">
                                    <div class="panel-header">
                                        <div class="d-flex justify-content-between align-items-center">
                                            <div>
                                                <h5 class="mb-0"><i class="fas fa-check-circle mr-2"></i>Seçilen Sınıflar</h5>
                                                <small class="text-white-50">Toplam: <span id="selectedClassCount">0</span></small>
                                            </div>
                                            <button type="button" class="btn btn-outline-light btn-sm" id="clearAllClassesBtn" style="display: none;" title="Tüm seçimleri temizle">
                                                <i class="fas fa-trash"></i> Temizle
                                            </button>
                                        </div>
                                    </div>
                                    <div class="scrollable-list" id="selectedNiceClasses" style="max-height: 700px; overflow-y: auto; padding: 15px;">
                                        <div class="empty-state text-center py-4">
                                            <i class="fas fa-clipboard-list fa-2x text-muted mb-2"></i>
                                            <p class="text-muted">Henüz sınıf seçilmedi</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,
    getPatentForm: () => `
        <div class="form-section">
            <h3 class="section-title">Patent Bilgileri</h3>
            <div class="form-grid">
                <div class="form-group">
                    <label for="patentTitle" class="form-label">Patent Başlığı</label>
                    <input type="text" id="patentTitle" class="form-input" placeholder="Patent başlığını girin">
                </div>
                <div class="form-group">
                    <label for="patentApplicationNumber" class="form-label">Başvuru Numarası</label>
                    <input type="text" id="patentApplicationNumber" class="form-input" placeholder="Başvuru numarasını girin">
                </div>
                <div class="form-group full-width">
                    <label for="patentDescription" class="form-label">Patent Açıklaması</label>
                    <textarea id="patentDescription" class="form-textarea" rows="4" placeholder="Patent hakkında detaylı açıklama girin"></textarea>
                </div>
            </div>
        </div>
    `,
    getDesignForm: () => `
        <div class="form-section">
            <h3 class="section-title">Tasarım Bilgileri</h3>
            <div class="form-grid">
                <div class="form-group">
                    <label for="designTitle" class="form-label">Tasarım Başlığı</label>
                    <input type="text" id="designTitle" class="form-input" placeholder="Tasarım başlığını girin">
                </div>
                <div class="form-group">
                    <label for="designApplicationNumber" class="form-label">Başvuru Numarası</label>
                    <input type="text" id="designApplicationNumber" class="form-input" placeholder="Başvuru numarasını girin">
                </div>
                <div class="form-group full-width">
                    <label for="designDescription" class="form-label">Tasarım Açıklaması</label>
                    <textarea id="designDescription" class="form-textarea" rows="4" placeholder="Tasarım hakkında detaylı açıklama girin"></textarea>
                </div>
            </div>
        </div>
    `,
    getSuitFields: (taskName) => `
        <div class="card-header bg-white border-bottom">
            <h5 class="mb-0 text-primary">3. Dava Detayları</h5>
        </div>
        <div class="card-body">
            <div class="form-grid">
                <div class="form-group full-width">
                    <label for="suitCourt" class="form-label">Mahkeme</label>
                    <select id="suitCourt" name="suitCourt" class="form-select" required>
                        <option value="">Seçiniz...</option>
                        <option value="ankara_1_fsm">Ankara 1. Fikri ve Sınai Haklar Hukuk Mahkemesi</option>
                        <option value="ankara_2_fsm">Ankara 2. Fikri ve Sınai Haklar Hukuk Mahkemesi</option>
                        <option value="ankara_3_fsm">Ankara 3. Fikri ve Sınai Haklar Hukuk Mahkemesi</option>
                        <option value="ankara_4_fsm">Ankara 4. Fikri ve Sınai Haklar Hukuk Mahkemesi</option>
                        <option value="ankara_5_fsm">Ankara 5. Fikri ve Sınai Haklar Hukuk Mahkemesi</option>
                        <option value="istinaf">Ankara Bölge Adliye Mahkemesi (İstinaf)</option>
                        <option value="yargitay_11_hd">Yargıtay 11. Hukuk Dairesi</option>
                    </select>
                </div>
                <div class="form-group full-width">
                    <label for="suitDescription" class="form-label">Dava Konusu ve Kısa Açıklaması</label>
                    <textarea class="form-control" id="suitDescription" rows="3"></textarea>
                </div>
                <div class="form-group">
                    <label for="opposingParty" class="form-label">Karşı Taraf</label>
                    <input type="text" id="opposingParty" name="opposingParty" class="form-input" placeholder="Örn: X Firması">
                </div>
                <div class="form-group">
                    <label for="opposingCounsel" class="form-label">Karşı Taraf Vekili</label>
                    <input type="text" id="opposingCounsel" name="opposingCounsel" class="form-input" placeholder="Örn: Av. Y">
                </div>
                <div class="form-group">
                    <label for="suitStatusSelect" class="form-label">Dava Durumu</label>
                    <select id="suitStatusSelect" class="form-select" required>
                        <option value="filed">Dava Açıldı</option>
                        <option value="continue">Devam Ediyor</option>
                        <option value="judgment_made">Karar Verildi</option>
                        <option value="closed">Kapandı</option>
                        <option value="appeal">İstinaf/Temyiz Aşamasında</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="suitCaseNo" class="form-label">Esas No</label>
                    <input type="text" class="form-control" id="suitCaseNo" placeholder="Örn: 2023/123 Esas">
                </div>
                <div class="form-group">
                    <label for="suitOpeningDate" class="form-label">Dava Tarihi</label>
                    <input type="text" class="form-control" id="suitOpeningDate" placeholder="gg.aa.yyyy" required>
                </div>
            </div>
        </div>
    `,
    getClientSection: () => `
        <div class="card mb-4" id="clientSection">
            <div class="card-header bg-white border-bottom">
                <h5 class="mb-0 text-primary">1. Müvekkil Bilgileri</h5>
            </div>
            <div class="card-body">
                <div class="form-grid">
                    <div class="form-group">
                        <label for="clientRole" class="form-label">Müvekkil Rolü</label>
                        <select id="clientRole" name="clientRole" class="form-select" required>
                            <option value="">Seçiniz...</option>
                            <option value="davaci">Davacı (Plaintiff)</option>
                            <option value="davali">Davalı (Defendant)</option>
                        </select>
                    </div>
                    <div class="form-group"></div>
                </div>
                <div class="form-group full-width mt-3">
                    <label for="suitClientSearch" class="form-label">Müvekkil Ara (Sistemdeki Kişiler)</label>
                    <div class="d-flex" style="gap:10px; align-items:flex-start;">
                        <div class="search-input-wrapper" style="flex:1; position:relative;">
                            <input type="text" id="suitClientSearch" class="form-input" placeholder="Müvekkil adı, e-posta..." autocomplete="off">
                            <div id="suitClientSearchResults" class="search-results-list" style="display:none;"></div> 
                        </div>
                        <button type="button" id="addNewPersonBtn" class="btn-small btn-add-person">
                            <span>&#x2795;</span> Yeni Kişi
                        </button>
                    </div>
                </div>
                <div id="selectedSuitClient" class="mt-2" style="display:none; padding: 10px; border: 1px solid #ccc; border-radius: 4px; background-color: #f8f9fa;">
                    Seçilen: <span id="selectedSuitClientName"></span>
                    <button type="button" class="btn btn-sm btn-danger ml-2" id="clearSuitClient">Kaldır</button>
                </div>
            </div>
        </div>
    `,
    getSubjectAssetSection: () => `
        <div class="card mb-4" id="subjectAssetSection">
            <div class="card-header bg-white border-bottom">
                <h5 class="mb-0 text-primary">2. Dava Konusu (Portföy Varlığı)</h5>
            </div>
            <div class="card-body">
                <div class="form-group full-width">
                    <label for="subjectAssetSearch" class="form-label">Portföyden Varlık Ara (Marka, Patent, Tasarım)</label>
                    <div class="search-input-wrapper" style="position:relative;">
                        <input type="text" id="subjectAssetSearch" class="form-input" placeholder="Başlık, numara, tip..." autocomplete="off">
                        <div id="subjectAssetSearchResults" class="search-results-list" style="display:none;"></div> 
                    </div>
                </div>
                <div id="selectedSubjectAsset" class="mt-3" style="display:none; padding: 10px; border: 1px solid #ccc; border-radius: 4px; background-color: #f8f9fa;">
                    Seçilen: <span id="selectedSubjectAssetName" class="font-weight-bold"></span>
                    (<span id="selectedSubjectAssetType"></span> - <span id="selectedSubjectAssetNumber"></span>)
                    <button type="button" class="btn btn-sm btn-danger ml-2" id="clearSubjectAsset">Kaldır</button>
                </div>
            </div>
        </div>
    `
}; 