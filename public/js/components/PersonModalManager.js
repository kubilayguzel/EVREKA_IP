import { PersonDataManager } from '../persons/PersonDataManager.js';
import { personService, db } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { collection, doc, writeBatch, deleteDoc, updateDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const $ = window.jQuery || window.$;

export class PersonModalManager {
    constructor(options = {}) {
        this.dataManager = new PersonDataManager();
        this.onSuccess = options.onSuccess || (() => {});
        this.isEdit = false;
        this.currentPersonId = null;
        this.documents = []; // {type, validityDate, countryCode, fileName, fileObj, url, isNew}
        this.relatedDraft = [];
        this.relatedLoaded = [];
        this.init();
    }

    async init() {
        this.ensureModalMarkup();
        this.setupEventListeners();
    }

    ensureModalMarkup() {
        if (document.getElementById('personModal')) return;

        const modalHtml = `
        <div id="personModal" class="modal fade" tabindex="-1" role="dialog" aria-hidden="true" data-backdrop="static">
            <div class="modal-dialog modal-xl modal-dialog-centered" role="document">
                <div class="modal-content shadow-lg border-0" style="border-radius: 20px; background: #f8fafc;">
                    <div class="modal-header bg-white border-bottom p-4">
                        <h5 class="modal-title font-weight-bold text-primary" id="personModalTitle">Yeni Kişi Ekle</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true" style="font-size: 1.5rem;">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body p-4" style="max-height: 75vh; overflow-y: auto;">
                        <form id="personForm">
                            <div class="card border-0 shadow-sm rounded-lg mb-4 p-4">
                                <h6 class="text-primary font-weight-bold mb-4 border-bottom pb-2"><i class="fas fa-info-circle mr-2"></i>Genel Bilgiler</h6>
                                <div class="row">
                                    <div class="col-md-6 border-right">
                                        <div class="form-group">
                                            <label class="small font-weight-bold text-muted">KİŞİ TİPİ *</label>
                                            <select id="personType" class="form-control rounded-lg border-2" required>
                                                <option value="gercek">Gerçek Kişi</option>
                                                <option value="tuzel">Tüzel Kişi (Firma)</option>
                                            </select>
                                        </div>
                                        <div class="form-group">
                                            <label class="small font-weight-bold text-muted" id="personNameLabel">AD SOYAD / FİRMA ADI *</label>
                                            <input type="text" id="personName" class="form-control rounded-lg border-2 shadow-sm" required>
                                        </div>
                                        <div id="gercekFields">
                                            <div class="form-row">
                                                <div class="form-group col-md-6">
                                                    <label class="small font-weight-bold text-muted">TC KİMLİK NO</label>
                                                    <input type="text" id="personTckn" class="form-control rounded-lg border-2" maxlength="11">
                                                </div>
                                                <div class="form-group col-md-6">
                                                    <label class="small font-weight-bold text-muted">DOĞUM TARİHİ</label>
                                                    <input type="date" id="personBirthDate" class="form-control rounded-lg border-2">
                                                </div>
                                            </div>
                                        </div>
                                        <div id="tuzelFields" style="display:none;">
                                            <div class="form-group">
                                                <label class="small font-weight-bold text-muted">VERGİ NO (VKN)</label>
                                                <input type="text" id="personVkn" class="form-control rounded-lg border-2" maxlength="10">
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="form-row">
                                            <div class="form-group col-md-6">
                                                <label class="small font-weight-bold text-muted">TPE MÜŞTERİ NO</label>
                                                <input type="text" id="personTpeNo" class="form-control rounded-lg border-2">
                                            </div>
                                            <div class="form-group col-md-6">
                                                <label class="small font-weight-bold text-muted">TELEFON</label>
                                                <input type="tel" id="personPhone" class="form-control rounded-lg border-2" placeholder="+90 5__ ___ __ __">
                                            </div>
                                        </div>
                                        <div class="form-group">
                                            <label class="small font-weight-bold text-muted">E-POSTA</label>
                                            <input type="email" id="personEmail" class="form-control rounded-lg border-2">
                                        </div>
                                        <div class="bg-light p-3 rounded border">
                                            <div class="custom-control custom-switch">
                                                <input type="checkbox" class="custom-control-input" id="is_evaluation_required">
                                                <label class="custom-control-label font-weight-bold text-dark" for="is_evaluation_required">Değerlendirme İşlemi Gerekli (ID 66)</label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="card border-0 shadow-sm rounded-lg mb-4 p-4">
                                <h6 class="text-primary font-weight-bold mb-4 border-bottom pb-2"><i class="fas fa-map-marker-alt mr-2"></i>Adres Bilgileri</h6>
                                <div class="row">
                                    <div class="col-md-4"><label class="small font-weight-bold text-muted">ÜLKE</label><select id="countrySelect" class="form-control rounded-lg border-2"></select></div>
                                    <div class="col-md-4"><label class="small font-weight-bold text-muted">İL / EYALET</label><select id="provinceSelect" class="form-control rounded-lg border-2"></select><input type="text" id="provinceText" class="form-control rounded-lg" style="display:none;"></div>
                                    <div class="col-md-4"><label class="small font-weight-bold text-muted">TAM ADRES</label><input type="text" id="personAddress" class="form-control rounded-lg border-2"></div>
                                </div>
                            </div>

                            <div class="card border-0 shadow-sm rounded-lg mb-4 overflow-hidden">
                                <div class="card-header bg-white d-flex justify-content-between align-items-center p-3">
                                    <h6 class="text-primary font-weight-bold mb-0"><i class="fas fa-users-cog mr-2"></i>İlgili Kişiler & Bildirim Tercihleri</h6>
                                    <button type="button" class="btn btn-sm btn-outline-primary px-3 rounded-pill" id="toggleRelatedSectionBtn">İlgilileri Yönet</button>
                                </div>
                                <div id="relatedSection" style="display:none;" class="card-body bg-light">
                                    <div class="row bg-white p-3 rounded border mx-0 shadow-sm mb-3">
                                        <div class="col-md-4">
                                            <input type="hidden" id="relatedId"> 
                                            <div class="form-group mb-2">
                                                <label class="small font-weight-bold">İlgili Adı *</label>
                                                <input type="text" id="relatedName" class="form-control form-control-sm border-2">
                                            </div>
                                            <div class="form-group mb-2">
                                                <label class="small font-weight-bold">E-posta</label>
                                                <input type="email" id="relatedEmail" class="form-control form-control-sm border-2">
                                            </div>
                                            <div class="form-group mb-0">
                                                <label class="small font-weight-bold">Telefon</label>
                                                <input type="tel" id="relatedPhone" class="form-control form-control-sm border-2" placeholder="+90 5__ ___ __ __">
                                            </div>
                                        </div>
                                        <div class="col-md-4 border-left">
                                            <label class="small font-weight-bold text-dark">Sorumlu Alanlar</label>
                                            <div class="d-flex flex-wrap gap-2 mt-1">
                                                ${['Patent', 'Marka', 'Tasarim', 'Dava', 'Muhasebe'].map(s => `
                                                    <div class="custom-control custom-checkbox mr-3 mb-2">
                                                        <input type="checkbox" class="custom-control-input scope-cb" id="scope${s}" value="${s.toLowerCase()}">
                                                        <label class="custom-control-label small" for="scope${s}">${s}</label>
                                                    </div>`).join('')}
                                            </div>
                                        </div>
                                        <div class="col-md-4 border-left">
                                            <label class="small font-weight-bold text-dark">Mail To / CC</label>
                                            <div class="mail-prefs-grid small bg-light p-2 border rounded">
                                                ${['patent','marka','tasarim','dava','muhasebe'].map(s => `
                                                    <div class="mail-scope-row d-flex justify-content-between align-items-center mb-1">
                                                        <span class="text-capitalize font-weight-bold">${s}</span>
                                                        <div class="toggles">
                                                            <label class="mb-0 mr-2 disabled"><input type="checkbox" class="mail-to" data-scope="${s}" checked> To</label>
                                                            <label class="mb-0 disabled"><input type="checkbox" class="mail-cc" data-scope="${s}"> CC</label>
                                                        </div>
                                                    </div>`).join('')}
                                            </div>
                                        </div>
                                        <div class="col-12 text-right mt-3 border-top pt-3">
                                            <button type="button" class="btn btn-sm btn-secondary" id="cancelRelatedBtn" style="display:none;">İptal</button>
                                            <button type="button" class="btn btn-sm btn-primary px-4" id="addRelatedBtn">➕ İlgiliyi Ekle</button>
                                            <button type="button" class="btn btn-sm btn-success px-4" id="updateRelatedBtn" style="display:none;">✔️ Güncelle</button>
                                        </div>
                                    </div>
                                    <div id="relatedListContainer" class="list-group list-group-flush rounded border bg-white shadow-sm"></div>
                                </div>
                            </div>

                            <div class="card border-0 shadow-sm rounded-lg p-4">
                                <h6 class="text-primary font-weight-bold mb-4 border-bottom pb-2"><i class="fas fa-file-pdf mr-2"></i>Evraklar (PDF)</h6>
                                <div class="bg-light p-3 rounded-lg border mb-3">
                                    <div class="row align-items-end mb-3">
                                        <div class="col-md-3 mb-2">
                                            <label class="small font-weight-bold text-muted">EVRAK TÜRÜ</label>
                                            <select id="docType" class="form-control form-control-sm border-2">
                                                <option value="Vekaletname">Vekaletname</option>
                                                <option value="Kimlik Belgesi">Kimlik Belgesi</option>
                                                <option value="İmza Sirküleri">İmza Sirküleri</option>
                                                <option value="Diğer">Diğer</option>
                                            </select>
                                        </div>
                                        <div class="col-md-3 mb-2">
                                            <label class="small font-weight-bold text-muted">VEKALET VERİLEN TARAF</label>
                                            <input type="text" id="docProxyParty" class="form-control form-control-sm border-2">
                                        </div>
                                        <div class="col-md-3 mb-2">
                                            <label class="small font-weight-bold text-muted">GEÇERLİLİK TARİHİ</label>
                                            <input type="date" id="docDate" class="form-control form-control-sm">
                                        </div>
                                        <div class="col-md-3 mb-2">
                                            <label class="small font-weight-bold text-muted">ÜLKE</label>
                                            <select id="docCountry" class="form-control form-control-sm border-2"></select>
                                        </div>
                                    </div>
                                    <div class="row align-items-center">
                                        <div class="col-md-9">
                                            <div id="docDropZone" class="file-upload-area py-3" style="border: 2px dashed #a8dadc; background: #f1faee; cursor: pointer; text-align: center; border-radius: 12px;">
                                                <i class="fas fa-cloud-upload-alt text-primary mr-2"></i>
                                                <span class="font-weight-bold" id="docFileNameDisplay">PDF Sürükle veya Tıkla</span>
                                                <input type="file" id="docFile" style="display: none;" accept=".pdf">
                                            </div>
                                        </div>
                                        <div class="col-md-3">
                                            <button type="button" class="btn btn-primary btn-block" id="addDocBtn" style="height: 52px; font-weight: bold;">➕ Listeye Ekle</button>
                                        </div>
                                    </div>
                                </div>
                                <div id="docListContainer" class="list-group list-group-flush rounded border bg-white"></div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer bg-white border-top p-4">
                        <button type="button" class="btn btn-secondary px-4 rounded-pill" data-dismiss="modal">Vazgeç</button>
                        <button type="button" class="btn btn-primary btn-lg px-5 rounded-pill shadow" id="savePersonBtn"><i class="fas fa-save mr-2"></i>Kaydet</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    setupEventListeners() {
        // TCKN/VKN Sadece Rakam ve Hane Sınırı
        document.getElementById('personTckn').oninput = (e) => e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);
        document.getElementById('personVkn').oninput = (e) => e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
        
        // Kişi Tipi Değişimi
        document.getElementById('personType').onchange = (e) => {
            const isGercek = e.target.value === 'gercek';
            document.getElementById('gercekFields').style.display = isGercek ? '' : 'none';
            document.getElementById('tuzelFields').style.display = isGercek ? 'none' : '';
            document.getElementById('personNameLabel').innerText = isGercek ? 'Ad Soyad *' : 'Firma Adı *';
        };

        // Ülke -> İl/Eyalet Değişimi
        document.getElementById('countrySelect').onchange = async (e) => {
            const countryCode = e.target.value;
            const isTR = /^(TR|TUR)$/i.test(countryCode);
            document.getElementById('provinceSelect').style.display = isTR ? '' : 'none';
            document.getElementById('provinceText').style.display = isTR ? 'none' : '';
            if (isTR) await this.loadProvinces(countryCode);
        };

        // --- KRİTİK: Mail To/CC Toggle Senkronizasyonu ---
        document.querySelectorAll('.scope-cb').forEach(cb => {
            cb.onchange = () => this.syncMailPrefsAvailability();
        });

        // İlgili Kişi & Evrak Butonları
        document.getElementById('toggleRelatedSectionBtn').onclick = () => {
            const sect = document.getElementById('relatedSection');
            sect.style.display = sect.style.display === 'none' ? 'block' : 'none';
        };

        document.getElementById('addRelatedBtn').onclick = () => this.addRelatedHandler();
        document.getElementById('updateRelatedBtn').onclick = () => this.updateRelatedHandler();
        document.getElementById('cancelRelatedBtn').onclick = () => this.resetRelatedForm();
        document.getElementById('addDocBtn').onclick = () => this.addDocumentHandler();
        document.getElementById('savePersonBtn').onclick = (e) => this.handleSave(e);

        // Telefon Formatlama
        this.addPhoneListeners('personPhone');
        this.addPhoneListeners('relatedPhone');

        // --- SÜRÜKLE BIRAK MANTIĞI ---
        const dropZone = document.getElementById('docDropZone');
        const fileInput = document.getElementById('docFile');
        const fileNameDisplay = document.getElementById('docFileNameDisplay');

        if (dropZone && fileInput) {
            dropZone.onclick = () => fileInput.click();

            dropZone.ondragover = (e) => {
                e.preventDefault();
                dropZone.style.background = "#e0f2f1";
                dropZone.style.borderColor = "#4db6ac";
            };

            dropZone.ondragleave = () => {
                dropZone.style.background = "#f1faee";
                dropZone.style.borderColor = "#a8dadc";
            };

            dropZone.ondrop = (e) => {
                e.preventDefault();
                dropZone.style.background = "#f1faee";
                dropZone.style.borderColor = "#a8dadc";
                if (e.dataTransfer.files.length) {
                    fileInput.files = e.dataTransfer.files;
                    fileNameDisplay.innerText = e.dataTransfer.files[0].name;
                }
            };

            fileInput.onchange = () => {
                if (fileInput.files.length) fileNameDisplay.innerText = fileInput.files[0].name;
            };
        }
    }

    async open(personId = null) {
        this.isEdit = !!personId;
        this.currentPersonId = personId;
        this.resetForm();

        await this.loadInitialData();

        if (this.isEdit) {
            document.getElementById('personModalTitle').textContent = 'Kişiyi Düzenle';
            await this.loadPersonData(personId);
        } else {
            document.getElementById('personModalTitle').textContent = 'Yeni Kişi Ekle';
        }

        $('#personModal').modal('show');
    }

    syncMailPrefsAvailability() {
        ['patent', 'marka', 'tasarim', 'dava', 'muhasebe'].forEach(s => {
            const capitalized = s.charAt(0).toUpperCase() + s.slice(1);
            const cb = document.getElementById('scope' + capitalized);
            const toEl = document.querySelector(`.mail-to[data-scope="${s}"]`);
            const ccEl = document.querySelector(`.mail-cc[data-scope="${s}"]`);
            
            if (!cb || !toEl || !ccEl) return; // Elemanlardan biri eksikse bu turu atla

            const toLabel = toEl.parentElement;
            const ccLabel = ccEl.parentElement;
            
            if (cb.checked) {
                toLabel.classList.remove('disabled');
                ccLabel.classList.remove('disabled');
                toEl.disabled = false;
                ccEl.disabled = false;
            } else {
                toLabel.classList.add('disabled');
                ccLabel.classList.add('disabled');
                toEl.disabled = true;
                ccEl.disabled = true;
                // Düzenleme modunda değilsek temizle (Edit modunda burayı atlamak için input check kontrolü eklenebilir)
                if (!this.editingRelated) {
                    toEl.checked = false;
                    ccEl.checked = false;
                }
            }
        });
    }

    async handleSave(e) {
        e.preventDefault();
        const saveBtn = document.getElementById('savePersonBtn');
        const nameVal = document.getElementById('personName').value.trim();

        if (!nameVal) return showNotification('Lütfen isim/firma adı giriniz.', 'warning');

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Yükleniyor...';

        try {
            // 1. Evrakları Storage'a yükle (Sadece yenileri)
            const processedDocs = [];
            for (const doc of this.documents) {
                if (doc.isNew && doc.fileObj) {
                    doc.url = await this.dataManager.uploadDocument(doc.fileObj);
                }
                processedDocs.push({
                    type: doc.type, url: doc.url, validityDate: doc.validityDate,
                    countryCode: doc.countryCode, fileName: doc.fileName
                });
            }

            // 2. Kişi Veri Paketi
            const countrySel = document.getElementById('countrySelect');
            const personData = {
                name: nameVal,
                type: document.getElementById('personType').value,
                tckn: document.getElementById('personTckn').value,
                birthDate: document.getElementById('personBirthDate').value,
                taxNo: document.getElementById('personVkn').value,
                tpeNo: document.getElementById('personTpeNo').value,
                email: document.getElementById('personEmail').value,
                phone: document.getElementById('personPhone').value,
                address: document.getElementById('personAddress').value,
                countryCode: countrySel.value,
                countryName: countrySel.options[countrySel.selectedIndex]?.text,
                province: document.getElementById('provinceSelect').style.display === 'none' 
                            ? document.getElementById('provinceText').value 
                            : document.getElementById('provinceSelect').options[document.getElementById('provinceSelect').selectedIndex]?.text,
                is_evaluation_required: document.getElementById('is_evaluation_required').checked,
                documents: processedDocs,
                updatedAt: new Date().toISOString()
            };

            // 3. Firestore Kayıt (Service üzerinden)
            let savedId = this.currentPersonId;
            if (this.isEdit) {
                await personService.updatePerson(this.currentPersonId, personData);
            } else {
                const res = await personService.addPerson(personData);
                savedId = res.data.id;
            }

            // 4. İlgilileri Kaydet (Batch ile)
            await this.saveRelatedToDb(savedId);

            showNotification('Kişi bilgileri başarıyla kaydedildi.', 'success');
            window.$('#personModal').modal('hide');
            this.onSuccess(savedId);

        } catch (err) {
            showNotification('Kayıt hatası: ' + err.message, 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Kaydet';
        }
    }

    // --- İlgili Kişi (Related) İşlemleri ---
    addRelatedHandler() {
        const name = document.getElementById('relatedName').value.trim();
        if (!name) return showNotification('İlgili adı zorunludur.', 'warning');

        const scopes = Array.from(document.querySelectorAll('.scope-cb:checked')).map(cb => cb.value);
        const notify = {};
        ['patent','marka','tasarim','dava','muhasebe'].forEach(s => {
            notify[s] = {
                to: document.querySelector(`.mail-to[data-scope="${s}"]`).checked,
                cc: document.querySelector(`.mail-cc[data-scope="${s}"]`).checked
            };
        });

        this.relatedDraft.push({
            name,
            email: document.getElementById('relatedEmail').value.trim(),
            phone: document.getElementById('relatedPhone').value.trim(),
            responsible: scopes.reduce((obj, s) => ({ ...obj, [s]: true }), {}),
            notify
        });

        this.renderRelatedList();
        this.resetRelatedForm();
    }

    renderRelatedList() {
        const container = document.getElementById('relatedListContainer');
        container.innerHTML = '';
        const all = [...this.relatedLoaded, ...this.relatedDraft];

        if (all.length === 0) {
            container.innerHTML = '<div class="alert alert-info py-2 small">Henüz ilgili kişi eklenmedi.</div>';
            return;
        }

        all.forEach((r, idx) => {
            const isLoaded = !!r.id;
            const item = `
                <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center p-2" 
                     style="cursor: pointer;" 
                     onclick="window.personModal.editRelated(${idx}, ${isLoaded === true})">
                    <div style="flex-grow: 1;">
                        <strong class="d-block text-dark">${r.name}</strong>
                        <small class="text-muted">${r.email || ''} ${r.phone || ''}</small>
                    </div>
                    <div>
                        <button type="button" class="btn btn-sm btn-outline-danger border-0" 
                                onclick="event.stopPropagation(); window.personModal.removeRelated(${idx}, ${isLoaded})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
            container.insertAdjacentHTML('beforeend', item);
        });
    }

    editRelated(idx, isLoaded) {
        const data = isLoaded ? this.relatedLoaded[idx] : this.relatedDraft[idx];
        console.log("Düzenlenen İlgili Verisi:", data);

        if (!data) return;

        // Elementleri güvenli bir şekilde doldurma (Null check ekleyelim)
        const safeSet = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        };

        safeSet('relatedId', isLoaded ? data.id : idx);
        safeSet('relatedName', data.name);
        safeSet('relatedEmail', data.email);
        safeSet('relatedPhone', data.phone);

        // Checkbox ve diğer kısımlar (Önceki kodunuzdaki gibi devam edebilir)
        const resp = data.responsible || {};
        const scopes = ['patent', 'marka', 'tasarim', 'dava', 'muhasebe'];
        
        scopes.forEach(s => {
            const capitalized = s.charAt(0).toUpperCase() + s.slice(1);
            const cb = document.getElementById('scope' + capitalized);
            if (cb) cb.checked = !!(resp[s] || resp[capitalized]);
        });

        this.syncMailPrefsAvailability();

        const notify = data.notify || {};
        scopes.forEach(s => {
            const toInput = document.querySelector(`.mail-to[data-scope="${s}"]`);
            const ccInput = document.querySelector(`.mail-cc[data-scope="${s}"]`);
            const prefs = notify[s] || notify[s.charAt(0).toUpperCase() + s.slice(1)] || { to: false, cc: false };
            
            if (toInput) toInput.checked = !!prefs.to;
            if (ccInput) ccInput.checked = !!prefs.cc;
        });

        document.getElementById('addRelatedBtn').style.display = 'none';
        document.getElementById('updateRelatedBtn').style.display = 'inline-block';
        document.getElementById('cancelRelatedBtn').style.display = 'inline-block';
        
        this.editingRelated = { idx, isLoaded };
        
        const form = document.getElementById('relatedForm');
        if(form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    updateRelatedHandler() {
        if (!this.editingRelated) return;
        const { idx, isLoaded } = this.editingRelated;

        const name = document.getElementById('relatedName').value.trim();
        if (!name) return showNotification('İlgili adı zorunludur.', 'warning');

        // Formdaki yeni verileri topla
        const scopes = Array.from(document.querySelectorAll('.scope-cb:checked')).map(cb => cb.value);
        const notify = {};
        ['patent','marka','tasarim','dava','muhasebe'].forEach(s => {
            notify[s] = {
                to: document.querySelector(`.mail-to[data-scope="${s}"]`).checked,
                cc: document.querySelector(`.mail-cc[data-scope="${s}"]`).checked
            };
        });

        const updatedData = {
            name,
            email: document.getElementById('relatedEmail').value.trim(),
            phone: document.getElementById('relatedPhone').value.trim(),
            responsible: scopes.reduce((obj, s) => ({ ...obj, [s]: true }), {}),
            notify
        };

        // İlgili diziyi güncelle
        if (isLoaded) {
            // Firestore'daki ID'yi koru
            const oldId = this.relatedLoaded[idx].id;
            this.relatedLoaded[idx] = { id: oldId, ...updatedData };
            // Not: Firestore güncellemesi handleSave sırasında veya anlık yapılabilir. 
            // Şimdilik liste üzerinden yönetiyoruz.
        } else {
            this.relatedDraft[idx] = updatedData;
        }

        this.renderRelatedList();
        this.resetRelatedForm();
        showNotification('İlgili bilgileri güncellendi.', 'success');
    }

    async removeRelated(idx, isLoaded) {
        if (!confirm('Bu ilgiliyi silmek istediğinizden emin misiniz?')) return;
        if (isLoaded) {
            const item = this.relatedLoaded[idx];
            await deleteDoc(doc(db, 'personsRelated', item.id));
            this.relatedLoaded.splice(idx, 1);
        } else {
            this.relatedDraft.splice(idx, 1);
        }
        this.renderRelatedList();
    }

    addDocumentHandler() {
        const fileInput = document.getElementById('docFile');
        const file = fileInput.files[0];
        const proxyParty = document.getElementById('docProxyParty').value.trim();

        if (!file) return showNotification('Lütfen bir dosya seçin.', 'warning');

        this.documents.push({
            type: document.getElementById('docType').value,
            proxyParty: proxyParty, // Yeni alan
            validityDate: document.getElementById('docDate').value,
            countryCode: document.getElementById('docCountry').value,
            fileName: file.name,
            fileObj: file,
            isNew: true
        });

        this.renderDocuments();
        
        // Temizlik
        fileInput.value = '';
        document.getElementById('docProxyParty').value = '';
        document.getElementById('docFileNameDisplay').innerText = 'PDF Dosyasını Buraya Sürükleyin veya Tıklayın';    }

    renderDocuments() {
        const cont = document.getElementById('docListContainer');
        cont.innerHTML = this.documents.length === 0 ? '<div class="p-4 text-center text-muted small">Henüz evrak eklenmedi.</div>' : '';
        
        this.documents.forEach((d, i) => {
            cont.insertAdjacentHTML('beforeend', `
                <div class="list-group-item d-flex justify-content-between align-items-center p-3 border-bottom">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-file-pdf text-danger fa-2x mr-3"></i>
                        <div>
                            <div class="font-weight-bold text-dark">${d.type} ${d.proxyParty ? `(${d.proxyParty})` : ''}</div>
                            <div class="small text-muted">
                                ${d.fileName} ${d.validityDate ? ` • S.T: ${d.validityDate}` : ''}
                            </div>
                        </div>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-danger border-0 rounded-circle" onclick="window.personModal.removeDocument(${i})">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`);
        });
    }

    removeDocument(idx) {
        this.documents.splice(idx, 1);
        this.renderDocuments();
    }

    // --- Veri Yükleme ve Yardımcılar ---
    async loadInitialData() {
        const countries = await this.dataManager.getCountries();
        const options = countries.map(c => `<option value="${c.code}">${c.name}</option>`).join('');
        document.getElementById('countrySelect').innerHTML = options;
        document.getElementById('docCountry').innerHTML = options;

        // Varsayılan Türkiye Seçimi
        const trOpt = Array.from(document.getElementById('countrySelect').options).find(o => /^(TR|TUR)$/i.test(o.value));
        if (trOpt) {
            trOpt.selected = true;
            await this.loadProvinces('TR');
        }
    }

    async loadProvinces(code) {
        const provinces = await this.dataManager.getProvinces(code);
        
        const options = ['<option value="">İl Seçiniz</option>'].concat(
            provinces.map(p => {
                // Veri obje ise code/id/name/label alanlarını dene, değilse doğrudan kendisini kullan
                const pCode = (p.code || p.id || p).toString();
                const pName = (p.name || p.label || p).toString();
                return `<option value="${pCode}">${pName}</option>`;
            })
        ).join('');
        
        const provinceSel = document.getElementById('provinceSelect');
        if (provinceSel) {
            provinceSel.innerHTML = options;
        }
    }

    async loadPersonData(id) {
        const persons = await personService.getPersons(); // Cache veya master data'dan da gelebilir
        const p = persons.data.find(x => x.id === id);
        if (!p) return;

        document.getElementById('personType').value = p.type || 'gercek';
        document.getElementById('personType').dispatchEvent(new Event('change'));
        document.getElementById('personName').value = p.name || '';
        document.getElementById('personTckn').value = p.tckn || '';
        document.getElementById('personBirthDate').value = p.birthDate || '';
        document.getElementById('personVkn').value = p.taxNo || '';
        document.getElementById('personTpeNo').value = p.tpeNo || '';
        document.getElementById('personEmail').value = p.email || '';
        document.getElementById('personPhone').value = p.phone || '';
        document.getElementById('personAddress').value = p.address || '';
        document.getElementById('is_evaluation_required').checked = !!p.is_evaluation_required;

        this.documents = p.documents || [];
        this.renderDocuments();

        // İlgilileri Firestore'dan çek
        const related = await this.dataManager.getRelatedPersons(id);
        this.relatedLoaded = related;
        this.renderRelatedList();
    }

    resetForm() {
        document.getElementById('personForm').reset();
        this.documents = [];
        this.relatedDraft = [];
        this.relatedLoaded = [];
        document.getElementById('relatedSection').style.display = 'none';
        document.getElementById('docListContainer').innerHTML = '';
        document.getElementById('relatedListContainer').innerHTML = '';
        window.personModal = this; // Global erişim için (remove metodları)
    }

// PersonModalManager.js
    addPhoneListeners(id) {
        const el = document.getElementById(id);
        
        // KRİTİK DÜZELTME: Eğer eleman bulunamazsa işlemi durdur (Hata almayı önler)
        if (!el) {
            console.warn(`Uyarı: ${id} ID'li telefon inputu bulunamadı.`);
            return;
        }

        el.onfocus = () => { if(!el.value) el.value = '+90 '; };
        el.oninput = (e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (v.startsWith('90')) v = v.slice(2);
            v = v.slice(0, 10);
            let res = '+90 ';
            if(v.length > 0) res += v.substring(0,3);
            if(v.length > 3) res += ' ' + v.substring(3,6);
            if(v.length > 6) res += ' ' + v.substring(6,8);
            if(v.length > 8) res += ' ' + v.substring(8,10);
            e.target.value = res.trim();
        };
    }

    async saveRelatedToDb(personId) {
        if (!this.relatedDraft.length) return;
        const batch = writeBatch(db);
        this.relatedDraft.forEach(r => {
            const newRef = doc(collection(db, 'personsRelated'));
            batch.set(newRef, { ...r, personId, createdAt: Date.now() });
        });
        await batch.commit();
        this.relatedDraft = [];
    }
}