import { PersonDataManager } from '../persons/PersonDataManager.js';
import { personService, db } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
import { collection, doc, writeBatch, deleteDoc, updateDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

    // Modal HTML yapısını (Tüm form alanlarıyla birlikte) enjekte eder
    ensureModalMarkup() {
        if (document.getElementById('personModal')) return;

        const modalHtml = `
        <div id="personModal" class="modal fade" tabindex="-1" role="dialog" aria-hidden="true" data-backdrop="static">
            <div class="modal-dialog modal-xl modal-dialog-centered" role="document">
                <div class="modal-content shadow-lg border-0" style="border-radius: 20px; overflow: hidden;">
                    <div class="modal-header bg-light border-bottom">
                        <h5 class="modal-title font-weight-bold" id="personModalTitle">Yeni Kişi Ekle</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body p-4" style="max-height: 80vh; overflow-y: auto;">
                        <form id="personForm">
                            <div class="row">
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label class="form-label">Kişi Tipi <span class="text-danger">*</span></label>
                                        <select id="personType" class="form-control" required>
                                            <option value="gercek">Gerçek Kişi</option>
                                            <option value="tuzel">Tüzel Kişi (Firma)</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" id="personNameLabel">Ad Soyad / Firma Adı <span class="text-danger">*</span></label>
                                        <input type="text" id="personName" class="form-control" required>
                                    </div>
                                    <div id="gercekFields">
                                        <div class="form-row">
                                            <div class="form-group col-md-6">
                                                <label class="form-label">TC Kimlik No</label>
                                                <input type="text" id="personTckn" class="form-control" maxlength="11">
                                            </div>
                                            <div class="form-group col-md-6">
                                                <label class="form-label">Doğum Tarihi</label>
                                                <input type="date" id="personBirthDate" class="form-control">
                                            </div>
                                        </div>
                                    </div>
                                    <div id="tuzelFields" style="display:none;">
                                        <div class="form-group">
                                            <label class="form-label">Vergi No (VKN)</label>
                                            <input type="text" id="personVkn" class="form-control" maxlength="10">
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="form-row">
                                        <div class="form-group col-md-6">
                                            <label class="form-label">TPE Müşteri No</label>
                                            <input type="text" id="personTpeNo" class="form-control">
                                        </div>
                                        <div class="form-group col-md-6">
                                            <label class="form-label">Telefon</label>
                                            <input type="tel" id="personPhone" class="form-control" placeholder="+90 5__ ___ __ __">
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">E-posta</label>
                                        <input type="email" id="personEmail" class="form-control">
                                    </div>
                                    <div class="form-group mb-0">
                                        <div class="custom-control custom-switch mt-4">
                                            <input type="checkbox" class="custom-control-input" id="is_evaluation_required">
                                            <label class="custom-control-label font-weight-bold" for="is_evaluation_required">
                                                Değerlendirme İşlemi Gerekli (ID 66)
                                            </label>
                                            <p class="small text-muted">Bu müvekkile giden bildirimler önce uzman onayına düşer.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <hr class="my-4">

                            <div class="row">
                                <div class="col-md-12">
                                    <div class="form-group">
                                        <label class="form-label">Adres Ülke / İl</label>
                                        <div class="row">
                                            <div class="col-md-4">
                                                <select id="countrySelect" class="form-control"></select>
                                            </div>
                                            <div class="col-md-4">
                                                <select id="provinceSelect" class="form-control"></select>
                                                <input type="text" id="provinceText" class="form-control" style="display:none;" placeholder="İl/Eyalet">
                                            </div>
                                            <div class="col-md-4">
                                                <input type="text" id="personAddress" class="form-control" placeholder="Tam Adres Bilgisi">
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <hr class="my-4">

                            <div class="section-title mb-3 d-flex justify-content-between align-items-center">
                                <h6 class="font-weight-bold text-primary mb-0"><i class="fas fa-users mr-2"></i>İlgili Kişiler & Mail Tercihleri</h6>
                                <button type="button" class="btn btn-sm btn-outline-primary" id="toggleRelatedSectionBtn">
                                    İlgilileri Yönet
                                </button>
                            </div>

                            <div id="relatedSection" style="display:none;">
                                <div class="card bg-light border-0 mb-3">
                                    <div class="card-body">
                                        <div class="row" id="relatedForm">
                                            <input type="hidden" id="relatedId">
                                            <div class="col-md-4">
                                                <div class="form-group">
                                                    <label class="small font-weight-bold">Ad Soyad</label>
                                                    <input type="text" id="relatedName" class="form-control form-control-sm">
                                                </div>
                                                <div class="form-group">
                                                    <label class="small font-weight-bold">E-posta</label>
                                                    <input type="email" id="relatedEmail" class="form-control form-control-sm">
                                                </div>
                                            </div>
                                            <div class="col-md-4">
                                                <label class="small font-weight-bold">Sorumlu Olduğu Alanlar</label>
                                                <div class="d-flex flex-wrap gap-2 mb-2">
                                                    <div class="custom-control custom-checkbox mr-3">
                                                        <input type="checkbox" class="custom-control-input scope-cb" id="scopePatent" value="patent">
                                                        <label class="custom-control-label small" for="scopePatent">Patent</label>
                                                    </div>
                                                    <div class="custom-control custom-checkbox mr-3">
                                                        <input type="checkbox" class="custom-control-input scope-cb" id="scopeMarka" value="marka">
                                                        <label class="custom-control-label small" for="scopeMarka">Marka</label>
                                                    </div>
                                                    <div class="custom-control custom-checkbox mr-3">
                                                        <input type="checkbox" class="custom-control-input scope-cb" id="scopeTasarim" value="tasarim">
                                                        <label class="custom-control-label small" for="scopeTasarim">Tasarım</label>
                                                    </div>
                                                </div>
                                                <div class="d-flex flex-wrap gap-2">
                                                    <div class="custom-control custom-checkbox mr-3">
                                                        <input type="checkbox" class="custom-control-input scope-cb" id="scopeDava" value="dava">
                                                        <label class="custom-control-label small" for="scopeDava">Dava</label>
                                                    </div>
                                                    <div class="custom-control custom-checkbox">
                                                        <input type="checkbox" class="custom-control-input scope-cb" id="scopeMuhasebe" value="muhasebe">
                                                        <label class="custom-control-label small" for="scopeMuhasebe">Muhasebe</label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="col-md-4">
                                                <label class="small font-weight-bold">Mail To / CC Tercihleri</label>
                                                <div class="mail-prefs-grid small">
                                                    ${['patent','marka','tasarim','dava','muhasebe'].map(s => `
                                                        <div class="mail-scope-row d-flex justify-content-between mb-1">
                                                            <span class="text-capitalize">${s}</span>
                                                            <div class="toggles">
                                                                <label class="mr-2 disabled"><input type="checkbox" class="mail-to" data-scope="${s}" checked> To</label>
                                                                <label class="disabled"><input type="checkbox" class="mail-cc" data-scope="${s}"> CC</label>
                                                            </div>
                                                        </div>
                                                    `).join('')}
                                                </div>
                                            </div>
                                        </div>
                                        <div class="text-right mt-2">
                                            <button type="button" class="btn btn-sm btn-secondary" id="cancelRelatedBtn" style="display:none;">İptal</button>
                                            <button type="button" class="btn btn-sm btn-primary" id="addRelatedBtn">Ekle</button>
                                            <button type="button" class="btn btn-sm btn-success" id="updateRelatedBtn" style="display:none;">Güncelle</button>
                                        </div>
                                    </div>
                                </div>
                                <div id="relatedListContainer" class="list-group small mb-3">
                                    </div>
                            </div>

                            <hr class="my-4">

                            <h6 class="font-weight-bold text-primary mb-3"><i class="fas fa-file-pdf mr-2"></i>Evraklar (Vekaletname vb.)</h6>
                            <div class="row mb-3 bg-light p-3 rounded mx-0">
                                <div class="col-md-3">
                                    <label class="small font-weight-bold">Evrak Türü</label>
                                    <select id="docType" class="form-control form-control-sm">
                                        <option value="Vekaletname">Vekaletname</option>
                                        <option value="Kimlik Belgesi">Kimlik Belgesi</option>
                                        <option value="İmza Sirküleri">İmza Sirküleri</option>
                                        <option value="Diğer">Diğer</option>
                                    </select>
                                </div>
                                <div class="col-md-3">
                                    <label class="small font-weight-bold">Geçerlilik Tarihi</label>
                                    <input type="date" id="docDate" class="form-control form-control-sm">
                                </div>
                                <div class="col-md-3">
                                    <label class="small font-weight-bold">Ülke</label>
                                    <select id="docCountry" class="form-control form-control-sm"></select>
                                </div>
                                <div class="col-md-3">
                                    <label class="small font-weight-bold">Dosya</label>
                                    <div class="d-flex">
                                        <input type="file" id="docFile" class="form-control-file small" accept=".pdf">
                                        <button type="button" class="btn btn-sm btn-primary ml-2" id="addDocBtn">Ekle</button>
                                    </div>
                                </div>
                            </div>
                            <div id="docListContainer" class="list-group small">
                                </div>
                        </form>
                    </div>
                    <div class="modal-footer bg-light">
                        <button type="button" class="btn btn-secondary px-4" data-dismiss="modal">Vazgeç</button>
                        <button type="button" class="btn btn-primary px-5" id="savePersonBtn">
                            <i class="fas fa-save mr-2"></i>Kaydet
                        </button>
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

        window.$('#personModal').modal('show');
    }

    syncMailPrefsAvailability() {
        ['patent', 'marka', 'tasarim', 'dava', 'muhasebe'].forEach(s => {
            const cb = document.getElementById(`scope${s.charAt(0).toUpperCase() + s.slice(1)}`);
            const toLabel = document.querySelector(`.mail-to[data-scope="${s}"]`).parentElement;
            const ccLabel = document.querySelector(`.mail-cc[data-scope="${s}"]`).parentElement;
            
            if (cb.checked) {
                toLabel.classList.remove('disabled');
                ccLabel.classList.remove('disabled');
            } else {
                toLabel.classList.add('disabled');
                ccLabel.classList.add('disabled');
                toLabel.querySelector('input').checked = false;
                ccLabel.querySelector('input').checked = false;
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
                <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center p-2">
                    <div>
                        <strong class="d-block">${r.name}</strong>
                        <small class="text-muted">${r.email || ''} ${r.phone || ''}</small>
                    </div>
                    <div>
                        <button type="button" class="btn btn-sm btn-outline-danger border-0" onclick="window.personModal.removeRelated(${idx}, ${isLoaded})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
            container.insertAdjacentHTML('beforeend', item);
        });
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

    // --- Evrak (Document) İşlemleri ---
    addDocumentHandler() {
        const fileInput = document.getElementById('docFile');
        const file = fileInput.files[0];
        if (!file) return showNotification('Lütfen bir dosya seçin.', 'warning');

        this.documents.push({
            type: document.getElementById('docType').value,
            validityDate: document.getElementById('docDate').value,
            countryCode: document.getElementById('docCountry').value,
            fileName: file.name,
            fileObj: file,
            isNew: true
        });

        this.renderDocuments();
        fileInput.value = '';
    }

    renderDocuments() {
        const container = document.getElementById('docListContainer');
        container.innerHTML = '';
        if (!this.documents.length) return;

        this.documents.forEach((d, idx) => {
            const item = `
                <div class="list-group-item d-flex justify-content-between align-items-center p-2">
                    <div>
                        <i class="fas fa-file-pdf text-danger mr-2"></i>
                        <span>${d.type} - ${d.fileName}</span>
                        ${d.validityDate ? `<small class="ml-2 text-muted">(S.T: ${d.validityDate})</small>` : ''}
                    </div>
                    <button type="button" class="btn btn-sm text-danger" onclick="window.personModal.removeDocument(${idx})">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`;
            container.insertAdjacentHTML('beforeend', item);
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
        document.getElementById('provinceSelect').innerHTML = provinces.map(p => `<option value="${p.code}">${p.name}</option>`).join('');
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