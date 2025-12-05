import { TASK_IDS, RELATED_PARTY_REQUIRED, PARTY_LABEL_BY_ID, asId } from './TaskConstants.js';
import { getSelectedNiceClasses } from '../nice-classification.js';

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
                    <li class="nav-item"><a class="nav-link active" id="brand-info-tab" data-toggle="tab" href="#brand-info">Marka Bilgileri</a></li>
                    <li class="nav-item"><a class="nav-link" id="goods-services-tab" data-toggle="tab" href="#goods-services">Mal/Hizmet Seçimi</a></li>
                    <li class="nav-item"><a class="nav-link" id="applicants-tab" data-toggle="tab" href="#applicants">Başvuru Sahibi</a></li>
                    <li class="nav-item"><a class="nav-link" id="priority-tab" data-toggle="tab" href="#priority">Rüçhan</a></li>
                    <li class="nav-item"><a class="nav-link" id="accrual-tab" data-toggle="tab" href="#accrual">Tahakkuk/Diğer</a></li>
                    <li class="nav-item"><a class="nav-link" id="summary-tab" data-toggle="tab" href="#summary">Özet</a></li>
                </ul>
                <div class="tab-content mt-3 tab-content-card" id="myTaskTabContent">
                    ${this._getBrandInfoTabHtml()}
                    ${this._getGoodsServicesTabHtml()}
                    ${this._getApplicantsTabHtml()}
                    ${this._getPriorityTabHtml()}
                    ${this._getAccrualTabHtml()}
                    <div class="tab-pane fade" id="summary" role="tabpanel"><div id="summaryContent" class="form-section"></div></div>
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
        contentHtml += this._getAssetSearchHtml();

        if (isLawsuitTask) {
            contentHtml += this._getLawsuitClientHtml();
            contentHtml += this._getLawsuitDetailsHtml();
            contentHtml += this._getLawsuitOpponentHtml();
        } else if (needsRelatedParty) {
            contentHtml += this._getGenericRelatedPartyHtml(partyLabel);
        }

        contentHtml += this._getAccrualCardHtml();
        contentHtml += this._getJobDetailsHtml();
        contentHtml += this._getFormActionsHtml();

        this.container.innerHTML = contentHtml;
    }

    // --- HTML TEMPLATE HELPERS ---

    _getBrandInfoTabHtml() {
        return `
        <div class="tab-pane fade show active" id="brand-info" role="tabpanel">
            <div class="form-section">
                <h3 class="section-title">Marka Bilgileri</h3>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Marka Tipi</label>
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
                    <label class="col-sm-3 col-form-label">Marka Türü</label>
                    <div class="col-sm-9">
                        <select class="form-control" id="brandCategory">
                            <option value="Ticaret/Hizmet Markası" selected>Ticaret/Hizmet Markası</option>
                            <option value="Garanti Markası">Garanti Markası</option>
                            <option value="Ortak Marka">Ortak Marka</option>
                        </select>
                    </div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Marka Örneği</label>
                    <div class="col-sm-9">
                        <div id="brand-example-drop-zone" class="file-upload-wrapper brand-upload-frame">
                            <input type="file" id="brandExample" accept="image/*" style="display:none;">
                            <div class="file-upload-button">
                                <div class="upload-icon" style="font-size: 2.5em; color: #1e3c72;">🖼️</div>
                                <div style="font-weight: 500;">Marka örneğini buraya sürükleyin veya seçmek için tıklayın</div>
                            </div>
                            <div class="file-upload-info">İstenen format: 591x591px, 300 DPI, JPEG.</div>
                        </div>
                        <div id="brandExamplePreviewContainer" class="mt-3 text-center" style="display:none;">
                            <img id="brandExamplePreview" src="#" style="max-width:200px; max-height:200px; border:1px solid #ddd; padding:5px; border-radius:8px;">
                            <button id="removeBrandExampleBtn" type="button" class="btn btn-sm btn-danger mt-2">Kaldır</button>
                        </div>
                    </div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Marka Örneği Yazılı İfadesi</label>
                    <div class="col-sm-9"><input type="text" class="form-control" id="brandExampleText"></div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Latin Alfabesi Dışı Harf Var Mı?</label>
                    <div class="col-sm-9"><input type="text" class="form-control" id="nonLatinAlphabet"></div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Önyazı Talebi</label>
                    <div class="col-sm-9">
                        <div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="coverLetterRequest" value="var"><label class="form-check-label">Var</label></div>
                        <div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="coverLetterRequest" value="yok" checked><label class="form-check-label">Yok</label></div>
                    </div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Muvafakat Talebi</label>
                    <div class="col-sm-9">
                        <div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="consentRequest" value="var"><label class="form-check-label">Var</label></div>
                        <div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="consentRequest" value="yok" checked><label class="form-check-label">Yok</label></div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    _getGoodsServicesTabHtml() {
        return `
        <div class="tab-pane fade" id="goods-services" role="tabpanel">
            <div class="nice-classification-container mt-3">
                <div class="row">
                    <div class="col-lg-8">
                        <div class="classification-panel mb-3">
                            <div class="panel-header"><h5 class="mb-0"><i class="fas fa-list-ul mr-2"></i>Nice Classification</h5></div>
                            <div class="search-section">
                                <div class="input-group">
                                    <div class="input-group-prepend"><span class="input-group-text"><i class="fas fa-search"></i></span></div>
                                    <input type="text" class="form-control" id="niceClassSearch" placeholder="Sınıf ara...">
                                    <div class="input-group-append"><button class="btn btn-outline-secondary" type="button" onclick="clearNiceSearch()"><i class="fas fa-times"></i></button></div>
                                </div>
                            </div>
                            <div class="classes-list" id="niceClassificationList" style="height: 450px; overflow-y: auto; background: #fafafa;">
                                <div class="loading-spinner"><div class="spinner-border text-primary" role="status"></div><p class="mt-2 text-muted">Yükleniyor...</p></div>
                            </div>
                        </div>
                        <div class="custom-class-frame">
                            <div class="custom-class-section">
                                <div class="d-flex align-items-center mb-2"><span class="badge badge-danger mr-2">99</span><strong class="text-danger">Özel Tanım</strong></div>
                                <div class="input-group">
                                    <textarea class="form-control" id="customClassInput" placeholder="Özel mal/hizmet tanımı..." maxlength="50000" rows="3"></textarea>
                                    <div class="input-group-append"><button class="btn btn-danger" type="button" id="addCustomClassBtn"><i class="fas fa-plus mr-1"></i>Ekle</button></div>
                                </div>
                                <small class="form-text text-muted"><span id="customClassCharCount">0</span> / 50.000</small>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-4 d-flex flex-column">
                        <div class="selected-classes-panel flex-grow-1 d-flex flex-column">
                            <div class="panel-header d-flex justify-content-between align-items-center"><h5 class="mb-0"><i class="fas fa-check-circle mr-2"></i>Seçilenler</h5><span class="badge badge-light" id="selectedClassCount">0</span></div>
                            <div class="selected-classes-content" id="selectedNiceClasses" style="height: 570px; overflow-y: auto; padding: 15px;"><div class="empty-state"><p class="text-muted">Seçim yok.</p></div></div>
                            <div class="border-top p-3"><button type="button" class="btn btn-outline-danger btn-sm btn-block" onclick="clearAllSelectedClasses()"><i class="fas fa-trash mr-1"></i>Temizle</button></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    _getApplicantsTabHtml() {
        return `
        <div class="tab-pane fade" id="applicants" role="tabpanel">
            <div class="form-section">
                <h3 class="section-title">Başvuru Sahibi Bilgileri</h3>
                <div class="form-group full-width">
                    <label class="form-label">Başvuru Sahibi Ara</label>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="applicantSearchInput" class="form-input" placeholder="Ara...">
                        <button type="button" id="addNewApplicantBtn" class="btn-small btn-add-person"><span>&#x2795;</span> Yeni Kişi</button>
                    </div>
                    <div id="applicantSearchResults" class="search-results-list"></div>
                </div>
                <div class="form-group full-width mt-4">
                    <label class="form-label">Seçilen Başvuru Sahipleri</label>
                    <div id="selectedApplicantsList" class="selected-items-list"><div class="empty-state"><p class="text-muted">Seçim yok.</p></div></div>
                </div>
            </div>
        </div>`;
    }

    _getPriorityTabHtml() {
        return `
        <div class="tab-pane fade" id="priority" role="tabpanel">
            <div class="form-section">
                <h3 class="section-title">Rüçhan Bilgileri</h3>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Rüçhan Tipi</label>
                    <div class="col-sm-9"><select class="form-control" id="priorityType"><option value="başvuru">Başvuru</option><option value="sergi">Sergi</option></select></div>
                </div>
                <div class="form-group row"><label class="col-sm-3 col-form-label" id="priorityDateLabel">Rüçhan Tarihi</label><div class="col-sm-9"><input type="text" class="form-control" id="priorityDate"></div></div>
                <div class="form-group row"><label class="col-sm-3 col-form-label">Rüçhan Ülkesi</label><div class="col-sm-9"><select class="form-control" id="priorityCountry"><option value="">Seçiniz...</option></select></div></div>
                <div class="form-group row"><label class="col-sm-3 col-form-label">Rüçhan Numarası</label><div class="col-sm-9"><input type="text" class="form-control" id="priorityNumber"></div></div>
                <div class="form-group full-width text-right mt-3"><button type="button" id="addPriorityBtn" class="btn btn-secondary"><i class="fas fa-plus mr-1"></i> Ekle</button></div>
                <hr class="my-4">
                <div class="form-group full-width"><label class="form-label">Eklenen Rüçhanlar</label><div id="addedPrioritiesList" class="selected-items-list"></div></div>
            </div>
        </div>`;
    }

    _getAccrualTabHtml() {
        return `<div class="tab-pane fade" id="accrual" role="tabpanel">${this._getAccrualCardHtml(true)}${this._getJobDetailsHtml(true)}</div>`;
    }

    // --- BASE FORM ---
    _getAssetSearchHtml() {
        return `
        <div class="section-card" id="card-asset">
            <h3 class="section-title">2. İşleme Konu Varlık</h3>
            <div class="form-group full-width">
                <label class="form-label">Portföyden Ara</label>
                <div class="position-relative">
                    <input type="text" id="ipRecordSearch" class="form-input" placeholder="Başlık, dosya no...">
                    <div id="ipRecordSearchResults" style="position:absolute; top:100%; left:0; right:0; z-index:1000; background:#fff; border:1px solid #ddd; display:none; max-height:260px; overflow:auto;"></div>
                </div>
                <div id="selectedIpRecordContainer" class="mt-2" style="display:none;">
                    <div class="p-2 border rounded d-flex justify-content-between align-items-center">
                        <div><div class="text-muted" id="selectedIpRecordLabel"></div><small class="text-secondary" id="selectedIpRecordMeta"></small></div>
                        <button type="button" class="btn btn-sm btn-outline-danger" id="clearSelectedIpRecord">Kaldır</button>
                    </div>
                </div>
            </div>
            <div id="wipoAripoParentContainer" class="form-group full-width mt-4" style="display:none;">
                <label class="form-label">Eklenen Ülkeler <span class="badge badge-light" id="wipoAripoChildCount">0</span></label>
                <div id="wipoAripoChildList" class="selected-items-list"></div>
            </div>
        </div>`;
    }

    _getLawsuitClientHtml() {
        return `
        <div class="section-card" id="clientSection">
            <h3 class="section-title">3. Müvekkil Bilgileri</h3>
            <div class="form-grid">
                <div class="form-group"><label class="form-label">Rol</label><select id="clientRole" class="form-select"><option value="davaci">Davacı</option><option value="davali">Davalı</option></select></div>
            </div>
            <div class="form-group full-width mt-3">
                <label class="form-label">Müvekkil Ara</label>
                <div class="d-flex" style="gap:10px;"><input type="text" id="personSearchInput" class="form-input"><button type="button" id="addNewPersonBtn" class="btn-small btn-add-person">+</button></div>
                <div id="personSearchResults" class="search-results-list" style="display:none;"></div>
            </div>
            <div class="form-group full-width mt-2"><label class="form-label">Seçilen Müvekkil</label><div id="relatedPartyList" class="selected-items-list"></div></div>
        </div>`;
    }

    _getLawsuitDetailsHtml() {
        return `
        <div class="section-card">
            <h3 class="section-title">4. Dava Bilgileri</h3>
            <div class="form-grid">
                <div class="form-group full-width"><label class="form-label">Mahkeme</label><select id="courtName" class="form-select"><option value="">Seçiniz...</option><option value="ankara_1_fsm">Ankara 1. FSM</option><option value="istinaf">İstinaf</option></select></div>
                <div class="form-group full-width"><label class="form-label">Konu</label><textarea id="subjectOfLawsuit" class="form-textarea" rows="3"></textarea></div>
            </div>
        </div>`;
    }

    _getLawsuitOpponentHtml() {
        return `
        <div class="section-card">
            <h3 class="section-title">5. Karşı Taraf</h3>
            <div class="form-grid">
                <div class="form-group"><label class="form-label">Karşı Taraf</label><input type="text" id="opposingParty" class="form-input"></div>
                <div class="form-group"><label class="form-label">Vekili</label><input type="text" id="opposingCounsel" class="form-input"></div>
            </div>
        </div>`;
    }

    _getGenericRelatedPartyHtml(label) {
        return `
        <div class="section-card" id="relatedPartySection">
            <h3 class="section-title">3. ${label}</h3>
            <div class="form-group full-width">
                <label class="form-label">Kişi Ara</label>
                <div class="d-flex" style="gap:10px;"><input type="text" id="personSearchInput" class="form-input"><button type="button" id="addNewPersonBtn" class="btn-small btn-add-person">+</button></div>
                <div id="personSearchResults" class="search-results-list" style="display:none;"></div>
            </div>
            <div class="form-group full-width mt-2"><label class="form-label">Seçilenler <span id="relatedPartyCount" class="badge badge-light">0</span></label><div id="relatedPartyList" class="selected-items-list"></div></div>
        </div>`;
    }

    _getAccrualCardHtml(isTab = false) {
        const cls = isTab ? 'form-section' : 'section-card';
        return `
        <div class="${cls}">
            <h3 class="section-title">Tahakkuk</h3>
            <div class="form-grid">
                <div class="form-group"><label class="form-label">Resmi Ücret</label><div class="input-with-currency"><input type="number" id="officialFee" class="form-input"><select id="officialFeeCurrency" class="currency-select"><option>TRY</option><option>USD</option><option>EUR</option></select></div></div>
                <div class="form-group"><label class="form-label">Hizmet Bedeli</label><div class="input-with-currency"><input type="number" id="serviceFee" class="form-input"><select id="serviceFeeCurrency" class="currency-select"><option>TRY</option><option>USD</option><option>EUR</option></select></div></div>
                <div class="form-group"><label class="form-label">KDV (%)</label><input type="number" id="vatRate" class="form-input" value="20"></div>
                <div class="form-group"><label class="form-label">Toplam</label><div id="totalAmountDisplay" class="total-amount-display">0.00 TRY</div></div>
                <div class="form-group full-width"><label class="checkbox-label"><input type="checkbox" id="applyVatToOfficialFee" checked> Resmi Ücrete KDV Uygula</label></div>
                <div class="form-group full-width"><label class="form-label">TP Fatura Tarafı</label><input type="text" id="tpInvoicePartySearch" class="form-input"><div id="tpInvoicePartyResults" class="search-results-list"></div><div id="selectedTpInvoicePartyDisplay" style="display:none;"></div></div>
                <div class="form-group full-width"><label class="form-label">Hizmet Fatura Tarafı</label><input type="text" id="serviceInvoicePartySearch" class="form-input"><div id="serviceInvoicePartyResults" class="search-results-list"></div><div id="selectedServiceInvoicePartyDisplay" style="display:none;"></div></div>
            </div>
        </div>`;
    }

    _getJobDetailsHtml(isTab = false) {
        const cls = isTab ? 'form-section' : 'section-card';
        return `
        <div class="${cls}">
            <h3 class="section-title">İş Detayları</h3>
            <div class="form-grid">
                <div class="form-group"><label class="form-label">Öncelik</label><select id="taskPriority" class="form-select"><option value="medium">Orta</option><option value="high">Yüksek</option></select></div>
                <div class="form-group"><label class="form-label">Atanacak</label><select id="assignedTo" class="form-select"><option value="">Seçiniz...</option></select></div>
                <div class="form-group full-width"><label class="form-label">Son Tarih</label><input type="text" id="taskDueDate" class="form-input"></div>
            </div>
        </div>`;
    }

    _getFormActionsHtml() {
        return `<div class="form-actions"><button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button><button type="submit" id="saveTaskBtn" class="btn btn-primary" disabled>Kaydet</button></div>`;
    }

    // --- EKSİK OLAN FONKSİYONLAR EKLENDİ ---

    // 1. Seçilen Başvuru Sahiplerini Listeleme
    renderSelectedApplicants(applicants) {
        const container = document.getElementById('selectedApplicantsList');
        if (!container) return;
        if (!applicants || applicants.length === 0) {
            container.innerHTML = `<div class="empty-state"><p class="text-muted">Seçim yok.</p></div>`;
            return;
        }
        container.innerHTML = applicants.map(p => `
            <div class="selected-item d-flex justify-content-between align-items-center p-2 mb-2 border rounded">
                <span>${p.name}</span>
                <button type="button" class="btn btn-sm btn-danger remove-selected-item-btn" data-id="${p.id}"><i class="fas fa-trash-alt"></i></button>
            </div>`).join('');
    }

    // 2. Seçilen İlgili Tarafları Listeleme
    renderSelectedRelatedParties(parties) {
        const list = document.getElementById('relatedPartyList');
        const countEl = document.getElementById('relatedPartyCount');
        if (!list) return;
        if (!parties || parties.length === 0) {
            list.innerHTML = `<div class="empty-state"><p class="text-muted">Seçim yok.</p></div>`;
        } else {
            list.innerHTML = parties.map(p => `
                <div class="selected-item p-2 border rounded mb-2 d-flex justify-content-between">
                    <span>${p.name}</span>
                    <button class="btn btn-sm btn-danger remove-party" data-id="${p.id}">X</button>
                </div>`).join('');
        }
        if (countEl) countEl.textContent = parties ? parties.length : 0;
    }

    // 3. Rüçhan Listeleme
    renderPriorities(priorities) {
        const container = document.getElementById('addedPrioritiesList');
        if (!container) return;
        if (!priorities || priorities.length === 0) {
            container.innerHTML = `<div class="empty-state"><p class="text-muted">Yok.</p></div>`;
            return;
        }
        container.innerHTML = priorities.map(p => `
            <div class="selected-item d-flex justify-content-between p-2 mb-2 border rounded">
                <span>${p.type} - ${p.country} - ${p.number}</span>
                <button class="btn btn-sm btn-danger remove-priority-btn" data-id="${p.id}">X</button>
            </div>`).join('');
    }

    // 4. WIPO Child Listeleme
    renderWipoAripoChildRecords(children) {
        const container = document.getElementById('wipoAripoChildList');
        const badge = document.getElementById('wipoAripoChildCount');
        const parent = document.getElementById('wipoAripoParentContainer');
        if (!container) return;
        
        if (!children || children.length === 0) {
            if(parent) parent.style.display = 'none';
            container.innerHTML = '';
            if(badge) badge.textContent = '0';
            return;
        }
        if(parent) parent.style.display = 'block';
        if(badge) badge.textContent = children.length;
        
        container.innerHTML = children.map(c => `
            <div class="selected-item d-flex justify-content-between mb-2">
                <span>${c.country} - ${c.applicationNumber||'-'}</span>
                <button class="btn btn-sm btn-danger remove-wipo-child-btn" data-id="${c.id}">X</button>
            </div>`).join('');
    }

    // 5. Özet Sekmesi
    renderSummaryTab(state) {
        const container = document.getElementById('summaryContent');
        if (!container) return;
        
        const { selectedApplicants, allUsers } = state;
        const assigned = allUsers.find(u => u.id === document.getElementById('assignedTo')?.value);
        const goods = typeof getSelectedNiceClasses === 'function' ? getSelectedNiceClasses() : [];
        
        let html = `<h4>Özet</h4><ul>`;
        html += `<li><b>İşlem:</b> ${state.selectedTaskType?.alias}</li>`;
        html += `<li><b>Atanan:</b> ${assigned?.displayName || '-'}</li>`;
        if(selectedApplicants && selectedApplicants.length) html += `<li><b>Başvuru Sahipleri:</b> ${selectedApplicants.map(a=>a.name).join(', ')}</li>`;
        if(goods.length) html += `<li><b>Sınıflar:</b> ${goods.length} adet seçildi</li>`;
        html += `</ul>`;
        
        container.innerHTML = html;
    }

    // 6. Parent Seçim Modalı (Withdrawal için)
    showParentSelectionModal(transactions, title) {
        const modalTitle = document.getElementById('selectParentModalLabel');
        const list = document.getElementById('parentListContainer');
        if(modalTitle) modalTitle.textContent = title;
        
        if(list) {
            list.innerHTML = transactions.map(tx => `
                <li class="list-group-item list-group-item-action" data-id="${tx.id}">
                    <div class="d-flex justify-content-between">
                        <div><strong>${tx.transactionTypeName || 'İşlem'}</strong> <small>${new Date(tx.timestamp).toLocaleDateString('tr-TR')}</small></div>
                        <i class="fas fa-chevron-right"></i>
                    </div>
                </li>`).join('');
        }
        
        // jQuery veya Vanilla JS ile aç
        if(window.$) $('#selectParentModal').modal('show');
        else {
            const m = document.getElementById('selectParentModal');
            if(m) { m.style.display='block'; m.classList.add('show'); }
        }
    }

    hideParentSelectionModal() {
        if(window.$) $('#selectParentModal').modal('hide');
        else {
            const m = document.getElementById('selectParentModal');
            if(m) { m.style.display='none'; m.classList.remove('show'); }
        }
    }

    // --- GENEL ---
    updateButtonsAndTabs(isLastTab) {
        const container = document.getElementById('formActionsContainer');
        if (container) {
            container.innerHTML = !isLastTab ?
                `<button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button><button type="button" id="nextTabBtn" class="btn btn-primary">İlerle</button>` :
                `<button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button><button type="submit" id="saveTaskBtn" class="btn btn-primary" disabled>İşi Oluştur ve Kaydet</button>`;
        }
    }

    // Eksik olan populateDropdown metodu
    populateDropdown(elementId, items, valueKey, textKey, defaultText = 'Seçiniz...') {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.innerHTML = `<option value="">${defaultText}</option>`;
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item[valueKey];
            option.textContent = item[textKey];
            el.appendChild(option);
        });
        el.disabled = false;
    }
}