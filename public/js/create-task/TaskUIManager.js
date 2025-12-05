import { TASK_IDS, RELATED_PARTY_REQUIRED, PARTY_LABEL_BY_ID, asId } from './TaskConstants.js';

export class TaskUIManager {
    constructor() {
        this.container = document.getElementById('conditionalFieldsContainer');
    }

    clearContainer() {
        if (this.container) this.container.innerHTML = '';
    }

    // --- 1. MARKA BAŞVURU FORMU ---
    renderTrademarkApplicationForm() {
        if (!this.container) return;
        this.container.innerHTML = `
        <div class="section-card">
            <h3 class="section-title">Marka Başvuru Bilgileri</h3>
             <div class="card-body">
                <ul class="nav nav-tabs" id="myTaskTabs" role="tablist">
                    <li class="nav-item">
                        <a class="nav-link active" id="brand-info-tab" data-toggle="tab" href="#brand-info" role="tab" aria-controls="brand-info" aria-selected="true">Marka Bilgileri</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="goods-services-tab" data-toggle="tab" href="#goods-services" role="tab" aria-controls="goods-services" aria-selected="false">Mal/Hizmet Seçimi</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="applicants-tab" data-toggle="tab" href="#applicants" role="tab" aria-controls="applicants" aria-selected="false">Başvuru Sahibi</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="priority-tab" data-toggle="tab" href="#priority" role="tab" aria-controls="priority" aria-selected="false">Rüçhan</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="accrual-tab" data-toggle="tab" href="#accrual" role="tab" aria-controls="accrual" aria-selected="false">Tahakkuk/Diğer</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" id="summary-tab" data-toggle="tab" href="#summary" role="tab" aria-controls="summary" aria-selected="false">Özet</a>
                    </li>
                </ul>
                <div class="tab-content mt-3 tab-content-card" id="myTaskTabContent">
                    ${this._getBrandInfoTabHtml()}
                    ${this._getGoodsServicesTabHtml()}
                    ${this._getApplicantsTabHtml()}
                    ${this._getPriorityTabHtml()}
                    ${this._getAccrualTabHtml()}
                    <div class="tab-pane fade" id="summary" role="tabpanel" aria-labelledby="summary-tab">
                        <div id="summaryContent" class="form-section">
                            <div class="empty-state">
                                <i class="fas fa-search-plus fa-3x text-muted mb-3"></i>
                                <p class="text-muted">Özet bilgileri yükleniyor...</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="formActionsContainer" class="form-actions"></div>
        </div>`;
    }

    // --- 2. DİĞER İŞLEMLER (BASE FORM) ---
    renderBaseForm(taskTypeName, taskTypeId, isLawsuitTask) {
        if (!this.container) return;

        const taskIdStr = asId(taskTypeId);
        const needsRelatedParty = RELATED_PARTY_REQUIRED.has(taskIdStr);
        const partyLabel = PARTY_LABEL_BY_ID[taskIdStr] || 'İlgili Taraf';

        let contentHtml = '';

        // 2.1. Varlık Arama (Asset Search) - Her zaman var
        contentHtml += this._getAssetSearchHtml();

        // 2.2. Dava veya İlgili Taraf Bölümleri
        if (isLawsuitTask) {
            contentHtml += this._getLawsuitClientHtml(); // 3. Müvekkil Bilgileri
            contentHtml += this._getLawsuitDetailsHtml(); // 4. Dava Bilgileri
            contentHtml += this._getLawsuitOpponentHtml(); // 5. Karşı Taraf
        } else if (needsRelatedParty) {
            contentHtml += this._getGenericRelatedPartyHtml(partyLabel); // 3. İlgili Taraf
        }

        // 2.3. Tahakkuk ve İş Detayları
        contentHtml += this._getAccrualCardHtml();
        contentHtml += this._getJobDetailsHtml();
        contentHtml += this._getFormActionsHtml();

        this.container.innerHTML = contentHtml;
    }

    // --- HTML TEMPLATE HELPERS ---

    _getBrandInfoTabHtml() {
        return `
        <div class="tab-pane fade show active" id="brand-info" role="tabpanel" aria-labelledby="brand-info-tab">
            <div class="form-section">
                <h3 class="section-title">Marka Bilgileri</h3>
                <div class="form-group row">
                    <label for="brandType" class="col-sm-3 col-form-label">Marka Tipi</label>
                    <div class="col-sm-9">
                        <select class="form-control" id="brandType">
                            <option value="Sadece Kelime">Sadece Kelime</option>
                            <option value="Sadece Şekil">Sadece Şekil</option>
                            <option value="Şekil + Kelime" selected>Şekil + Kelime</option>
                            <option value="Ses">Ses</option>
                            <option value="Hareket">Hareket</option>
                            <option value="Renk">Renk</option>
                            <option value="Üç Boyutlu">Üç Boyutlu</option>
                        </select>
                    </div>
                </div>
                <div class="form-group row">
                    <label for="brandCategory" class="col-sm-3 col-form-label">Marka Türü</label>
                    <div class="col-sm-9">
                        <select class="form-control" id="brandCategory">
                            <option value="Ticaret/Hizmet Markası" selected>Ticaret/Hizmet Markası</option>
                            <option value="Garanti Markası">Garanti Markası</option>
                            <option value="Ortak Marka">Ortak Marka</option>
                        </select>
                    </div>
                </div>
                <div class="form-group row">
                    <label for="brandExample" class="col-sm-3 col-form-label">Marka Örneği</label>
                    <div class="col-sm-9">
                        <div id="brand-example-drop-zone" class="file-upload-wrapper brand-upload-frame">
                            <input type="file" id="brandExample" accept="image/*" style="display:none;">
                            <div class="file-upload-button">
                                <div class="upload-icon" style="font-size: 2.5em; color: #1e3c72;">🖼️</div>
                                <div style="font-weight: 500;">Marka örneğini buraya sürükleyin veya seçmek için tıklayın</div>
                            </div>
                            <div class="file-upload-info">
                                İstenen format: 591x591px, 300 DPI, JPEG. Yüklenen dosya otomatik olarak dönüştürülecektir.
                            </div>
                        </div>
                        <div id="brandExamplePreviewContainer" class="mt-3 text-center" style="display:none;">
                            <img id="brandExamplePreview" src="#" alt="Marka Örneği Önizlemesi"
                                style="max-width:200px; max-height:200px; border:1px solid #ddd; padding:5px; border-radius:8px;">
                            <button id="removeBrandExampleBtn" type="button" class="btn btn-sm btn-danger mt-2">Kaldır</button>
                            <div id="image-processing-status" class="mt-2 text-muted" style="font-size: 0.9em;"></div>
                        </div>
                    </div>
                </div>
                <div class="form-group row">
                    <label for="brandExampleText" class="col-sm-3 col-form-label">Marka Örneği Yazılı İfadesi</label>
                    <div class="col-sm-9">
                        <input type="text" class="form-control" id="brandExampleText">
                    </div>
                </div>
                <div class="form-group row">
                    <label for="nonLatinAlphabet" class="col-sm-3 col-form-label">Marka Örneğinde Latin Alfabesi Haricinde Harf Var Mı?</label>
                    <div class="col-sm-9">
                        <input type="text" class="form-control" id="nonLatinAlphabet">
                    </div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Önyazı Talebi</label>
                    <div class="col-sm-9">
                        <div class="form-check form-check-inline">
                            <input class="form-check-input" type="radio" name="coverLetterRequest" id="coverLetterRequestVar" value="var">
                            <label class="form-check-label" for="coverLetterRequestVar">Var</label>
                        </div>
                        <div class="form-check form-check-inline">
                            <input class="form-check-input" type="radio" name="coverLetterRequest" id="coverLetterRequestYok" value="yok" checked>
                            <label class="form-check-label" for="coverLetterRequestYok">Yok</label>
                        </div>
                    </div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Muvafakat Talebi</label>
                    <div class="col-sm-9">
                        <div class="form-check form-check-inline">
                            <input class="form-check-input" type="radio" name="consentRequest" id="consentRequestVar" value="var">
                            <label class="form-check-label" for="consentRequestVar">Var</label>
                        </div>
                        <div class="form-check form-check-inline">
                            <input class="form-check-input" type="radio" name="consentRequest" id="consentRequestYok" value="yok" checked>
                            <label class="form-check-label" for="consentRequestYok">Yok</label>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    _getGoodsServicesTabHtml() {
        return `
        <div class="tab-pane fade" id="goods-services" role="tabpanel" aria-labelledby="goods-services-tab">
            <div class="nice-classification-container mt-3">
                <div class="row">
                    <div class="col-lg-8">
                        <div class="classification-panel mb-3">
                            <div class="panel-header">
                                <h5 class="mb-0"><i class="fas fa-list-ul mr-2"></i>Nice Classification</h5>
                                <small class="text-white-50">1-45 arası sınıflardan seçim yapın</small>
                            </div>
                            <div class="search-section">
                                <div class="input-group">
                                    <div class="input-group-prepend"><span class="input-group-text"><i class="fas fa-search"></i></span></div>
                                    <input type="text" class="form-control" id="niceClassSearch" placeholder="Sınıf ara...">
                                    <div class="input-group-append">
                                        <button class="btn btn-outline-secondary" type="button" onclick="clearNiceSearch()"><i class="fas fa-times"></i></button>
                                    </div>
                                </div>
                            </div>
                            <div class="classes-list" id="niceClassificationList" style="height: 450px; overflow-y: auto; background: #fafafa;">
                                <div class="loading-spinner">
                                    <div class="spinner-border text-primary" role="status"><span class="sr-only">Yükleniyor...</span></div>
                                    <p class="mt-2 text-muted">Nice sınıfları yükleniyor...</p>
                                </div>
                            </div>
                        </div>
                        <div class="custom-class-frame">
                            <div class="custom-class-section">
                                <div class="d-flex align-items-center mb-2">
                                    <span class="badge badge-danger mr-2">99</span><strong class="text-danger">Özel Tanım</strong>
                                </div>
                                <div class="input-group">
                                    <textarea class="form-control" id="customClassInput" placeholder="Özel mal/hizmet tanımı..." maxlength="50000" rows="3"></textarea>
                                    <div class="input-group-append">
                                        <button class="btn btn-danger" type="button" id="addCustomClassBtn"><i class="fas fa-plus mr-1"></i>Ekle</button>
                                    </div>
                                </div>
                                <small class="form-text text-muted"><span id="customClassCharCount">0</span> / 50.000</small>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-4 d-flex flex-column">
                        <div class="selected-classes-panel flex-grow-1 d-flex flex-column">
                            <div class="panel-header d-flex justify-content-between align-items-center">
                                <h5 class="mb-0"><i class="fas fa-check-circle mr-2"></i>Seçilenler</h5>
                                <span class="badge badge-light" id="selectedClassCount">0</span>
                            </div>
                            <div class="selected-classes-content" id="selectedNiceClasses" style="height: 570px; overflow-y: auto; padding: 15px;">
                                <div class="empty-state"><i class="fas fa-list-alt fa-3x text-muted mb-3"></i><p class="text-muted">Henüz sınıf seçilmedi.</p></div>
                            </div>
                            <div class="border-top p-3">
                                <button type="button" class="btn btn-outline-danger btn-sm btn-block" onclick="clearAllSelectedClasses()"><i class="fas fa-trash mr-1"></i>Temizle</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    _getApplicantsTabHtml() {
        return `
        <div class="tab-pane fade" id="applicants" role="tabpanel" aria-labelledby="applicants-tab">
            <div class="form-section">
                <h3 class="section-title">Başvuru Sahibi Bilgileri</h3>
                <div class="form-group full-width">
                    <label for="applicantSearchInput" class="form-label">Başvuru Sahibi Ara</label>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="applicantSearchInput" class="form-input" placeholder="Aramak için en az 2 karakter...">
                        <button type="button" id="addNewApplicantBtn" class="btn-small btn-add-person"><span>&#x2795;</span> Yeni Kişi</button>
                    </div>
                    <div id="applicantSearchResults" class="search-results-list"></div>
                </div>
                <div class="form-group full-width mt-4">
                    <label class="form-label">Seçilen Başvuru Sahipleri</label>
                    <div id="selectedApplicantsList" class="selected-items-list">
                        <div class="empty-state"><i class="fas fa-user-plus fa-3x text-muted mb-3"></i><p class="text-muted">Henüz başvuru sahibi seçilmedi.</p></div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    _getPriorityTabHtml() {
        return `
        <div class="tab-pane fade" id="priority" role="tabpanel" aria-labelledby="priority-tab">
            <div class="form-section">
                <h3 class="section-title">Rüçhan Bilgileri</h3>
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
                    <div class="col-sm-9"><input type="text" class="form-control" id="priorityDate"></div>
                </div>
                <div class="form-group row">
                    <label for="priorityCountry" class="col-sm-3 col-form-label">Rüçhan Ülkesi</label>
                    <div class="col-sm-9"><select class="form-control" id="priorityCountry"><option value="">Seçiniz...</option></select></div>
                </div>
                <div class="form-group row">
                    <label for="priorityNumber" class="col-sm-3 col-form-label">Rüçhan Numarası</label>
                    <div class="col-sm-9"><input type="text" class="form-control" id="priorityNumber"></div>
                </div>
                <div class="form-group full-width text-right mt-3">
                    <button type="button" id="addPriorityBtn" class="btn btn-secondary"><i class="fas fa-plus mr-1"></i> Rüçhan Ekle</button>
                </div>
                <hr class="my-4">
                <div class="form-group full-width">
                    <label class="form-label">Eklenen Rüçhan Hakları</label>
                    <div id="addedPrioritiesList" class="selected-items-list">
                        <div class="empty-state"><i class="fas fa-info-circle fa-3x text-muted mb-3"></i><p class="text-muted">Henüz rüçhan bilgisi eklenmedi.</p></div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    _getAccrualTabHtml() {
        return `
        <div class="tab-pane fade" id="accrual" role="tabpanel" aria-labelledby="accrual-tab">
            ${this._getAccrualCardHtml(true)}
            ${this._getJobDetailsHtml(true)}
        </div>`;
    }

    // --- BASE FORM PARÇALARI ---

    _getAssetSearchHtml() {
        return `
        <div class="section-card" id="card-asset">
            <h3 class="section-title">2. İşleme Konu Varlık</h3>
            <div class="form-group full-width">
                <label for="ipRecordSearch" class="form-label">Portföyden Ara</label>
                <div class="position-relative">
                    <input type="text" id="ipRecordSearch" class="form-input" placeholder="Başlık, dosya no, başvuru no, sahip adı...">
                    <div id="ipRecordSearchResults" style="position:absolute; top:100%; left:0; right:0; z-index:1000; background:#fff; border:1px solid #ddd; border-top:none; display:none; max-height:260px; overflow:auto;"></div>
                </div>
                <div id="selectedIpRecordContainer" class="mt-2" style="display:none;">
                    <div class="p-2 border rounded d-flex justify-content-between align-items-center">
                        <div>
                            <div class="text-muted" id="selectedIpRecordLabel"></div>
                            <small class="text-secondary" id="selectedIpRecordMeta"></small>
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-danger" id="clearSelectedIpRecord">Kaldır</button>
                    </div>
                </div>
            </div>
            <div id="wipoAripoParentContainer" class="form-group full-width mt-4" style="display:none;">
                <label class="form-label">Eklenen Ülkeler <span class="badge badge-light" id="wipoAripoChildCount">0</span></label>
                <div id="wipoAripoChildList" class="selected-items-list">
                    <div class="empty-state">
                        <i class="fas fa-flag fa-3x text-muted mb-3"></i>
                        <p class="text-muted">Bu işleme bağlı ülke kaydı bulunamadı.</p>
                    </div>
                </div>
            </div>
        </div>`;
    }

    _getLawsuitClientHtml() {
        return `
        <div class="section-card" id="clientSection">
            <h3 class="section-title" id="clientTitle">3. Müvekkil Bilgileri</h3>
            <div class="form-grid">
                <div class="form-group">
                    <label for="clientRole" class="form-label">Müvekkil Rolü</label>
                    <select id="clientRole" name="clientRole" class="form-select">
                        <option value="">Seçiniz...</option>
                        <option value="davaci">Davacı (Plaintiff)</option>
                        <option value="davali">Davalı (Defendant)</option>
                    </select>
                </div>
            </div>
            <div class="form-group full-width mt-3">
                <label for="personSearchInput" class="form-label">Müvekkil Ara (Sistemdeki Kişiler)</label>
                <div class="d-flex" style="gap:10px; align-items:flex-start;">
                <div class="search-input-wrapper" style="flex:1; position:relative;">
                    <input type="text" id="personSearchInput" class="form-input" placeholder="Müvekkil adı, e-posta...">
                    <div id="personSearchResults" class="search-results-list" style="display:none;"></div> 
                </div>
                <button type="button" id="addNewPersonBtn" class="btn-small btn-add-person"><span>&#x2795;</span> Yeni Kişi</button>
                </div>
            </div>
            <div class="form-group full-width mt-2">
                <label class="form-label">Seçilen Müvekkil <span class="badge badge-light ml-2" id="relatedPartyCount">0</span></label>
                <div id="relatedPartyList" class="selected-items-list">
                    <div class="empty-state"><i class="fas fa-user-friends fa-3x text-muted mb-3"></i><p class="text-muted">Henüz müvekkil eklenmedi.</p></div>
                </div>
            </div>
        </div>`;
    }

    _getLawsuitDetailsHtml() {
        return `
        <div class="section-card">
            <h3 class="section-title">4. Dava Bilgileri</h3>
            <div class="form-grid">
                <div class="form-group full-width">
                    <label for="courtName" class="form-label">Mahkeme</label>
                    <select id="courtName" name="courtName" class="form-select">
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
                    <label for="subjectOfLawsuit" class="form-label">Dava Konusu ve Kısa Açıklaması</label>
                    <textarea id="subjectOfLawsuit" name="subjectOfLawsuit" class="form-textarea" rows="3"></textarea>
                </div>
            </div>
        </div>`;
    }

    _getLawsuitOpponentHtml() {
        return `
        <div class="section-card" id="opponentSection">
            <h3 class="section-title">5. Karşı Taraf Bilgileri</h3>
            <div class="form-grid">
                <div class="form-group">
                    <label for="opposingParty" class="form-label">Karşı Taraf</label>
                    <input type="text" id="opposingParty" name="opposingParty" class="form-input" placeholder="Örn: X Firması">
                </div>
                <div class="form-group">
                    <label for="opposingCounsel" class="form-label">Karşı Taraf Vekili</label>
                    <input type="text" id="opposingCounsel" name="opposingCounsel" class="form-input" placeholder="Örn: Av. Y">
                </div>
            </div>
        </div>`;
    }

    _getGenericRelatedPartyHtml(partyLabel) {
        return `
        <div class="section-card" id="relatedPartySection">
            <h3 class="section-title" id="relatedPartyTitle">3. ${partyLabel}</h3>
            <div class="form-group full-width">
                <label for="personSearchInput" class="form-label">Sistemdeki Kişilerden Ara</label>
                <div class="d-flex" style="gap:10px; align-items:flex-start;">
                    <div class="search-input-wrapper" style="flex:1; position:relative;">
                        <input type="text" id="personSearchInput" class="form-input" placeholder="Aramak için en az 2 karakter...">
                        <div id="personSearchResults" class="search-results-list" style="display:none;"></div>
                    </div>
                    <button type="button" id="addNewPersonBtn" class="btn-small btn-add-person"><span>&#x2795;</span> Yeni Kişi</button>
                </div>
            </div>
            <div class="form-group full-width mt-2">
                <label class="form-label">Seçilen Taraflar <span class="badge badge-light ml-2" id="relatedPartyCount">0</span></label>
                <div id="relatedPartyList" class="selected-items-list">
                    <div class="empty-state"><i class="fas fa-user-friends fa-3x text-muted mb-3"></i><p class="text-muted">Henüz taraf eklenmedi.</p></div>
                </div>
            </div>
        </div>`;
    }

    _getAccrualCardHtml(isTab = false) {
        const sectionClass = isTab ? 'form-section' : 'section-card';
        const idAttr = isTab ? '' : 'id="card-accrual"';
        return `
        <div class="${sectionClass}" ${idAttr}>
            <h3 class="section-title">Tahakkuk Bilgileri</h3>
            <div class="form-grid">
                <div class="form-group">
                    <label for="officialFee" class="form-label">Resmi Ücret</label>
                    <div class="input-with-currency">
                        <input type="number" id="officialFee" class="form-input" placeholder="0.00" step="0.01">
                        <select id="officialFeeCurrency" class="currency-select">
                            <option value="TRY" selected>TL</option><option value="EUR">EUR</option><option value="USD">USD</option><option value="CHF">CHF</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label for="serviceFee" class="form-label">Hizmet Bedeli</label>
                    <div class="input-with-currency">
                        <input type="number" id="serviceFee" class="form-input" placeholder="0.00" step="0.01">
                        <select id="serviceFeeCurrency" class="currency-select">
                            <option value="TRY" selected>TL</option><option value="EUR">EUR</option><option value="USD">USD</option><option value="CHF">CHF</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label for="vatRate" class="form-label">KDV Oranı (%)</label>
                    <input type="number" id="vatRate" class="form-input" value="20">
                </div>
                <div class="form-group">
                    <label for="totalAmountDisplay" class="form-label">Toplam Tutar</label>
                    <div id="totalAmountDisplay" class="total-amount-display">0.00 TRY</div>
                </div>
                <div class="form-group full-width">
                    <label class="checkbox-label"><input type="checkbox" id="applyVatToOfficialFee" checked> Resmi Ücrete KDV Uygula</label>
                </div>
                <div class="form-group full-width">
                    <label for="tpInvoicePartySearch" class="form-label">Türk Patent Faturası Tarafı</label>
                    <input type="text" id="tpInvoicePartySearch" class="form-input" placeholder="Fatura tarafı arayın...">
                    <div id="tpInvoicePartyResults" class="search-results-list"></div>
                    <div id="selectedTpInvoicePartyDisplay" class="search-result-display" style="display:none;"></div>
                </div>
                <div class="form-group full-width">
                    <label for="serviceInvoicePartySearch" class="form-label">Hizmet Faturası Tarafı</label>
                    <input type="text" id="serviceInvoicePartySearch" class="form-input" placeholder="Fatura tarafı arayın...">
                    <div id="serviceInvoicePartyResults" class="search-results-list"></div>
                    <div id="selectedServiceInvoicePartyDisplay" class="search-result-display" style="display:none;"></div>
                </div>
            </div>
        </div>`;
    }

    _getJobDetailsHtml(isTab = false) {
        const sectionClass = isTab ? 'form-section' : 'section-card';
        const idAttr = isTab ? '' : 'id="card-job"';
        return `
        <div class="${sectionClass}" ${idAttr}>
            <h3 class="section-title">İş Detayları ve Atama</h3>
            <div class="form-grid">
                <div class="form-group">
                    <label for="taskPriority" class="form-label">Öncelik</label>
                    <select id="taskPriority" class="form-select"><option value="medium">Orta</option><option value="high">Yüksek</option><option value="low">Düşük</option></select>
                </div>
                <div class="form-group">
                    <label for="assignedTo" class="form-label">Atanacak Kullanıcı</label>
                    <select id="assignedTo" class="form-select"><option value="">Seçiniz...</option></select>
                </div>
                <div class="form-group full-width">
                    <label for="taskDueDate" class="form-label">Operasyonel Son Tarih</label>
                    <input type="text" id="taskDueDate" class="form-input">
                </div>
            </div>
        </div>`;
    }

    _getFormActionsHtml() {
        return `
        <div class="form-actions">
            <button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button>
            <button type="submit" id="saveTaskBtn" class="btn btn-primary" disabled>İşi Oluştur ve Kaydet</button>
        </div>`;
    }

    updateButtonsAndTabs(isLastTab) {
        const container = document.getElementById('formActionsContainer');
        if (container) {
            container.innerHTML = !isLastTab ?
                `<button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button><button type="button" id="nextTabBtn" class="btn btn-primary">İlerle</button>` :
                `<button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button><button type="submit" id="saveTaskBtn" class="btn btn-primary" disabled>İşi Oluştur ve Kaydet</button>`;
        }
    }
}