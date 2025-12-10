// public/js/components/AccrualFormManager.js

export class AccrualFormManager {
    /**
     * @param {string} containerId - Formun içine çizileceği div'in ID'si
     * @param {string} prefix - ID çakışmalarını önlemek için ön ek (örn: 'comp', 'create', 'edit')
     * @param {Array} allPersons - Kişi arama için kullanılacak kişi listesi
     */
    constructor(containerId, prefix, allPersons = []) {
        this.container = document.getElementById(containerId);
        this.prefix = prefix;
        this.allPersons = allPersons;
        
        // Seçim Durumları
        this.selectedTpParty = null;
        this.selectedForeignParty = null;
    }

    /**
     * Formu HTML olarak oluşturur ve container içine basar.
     */
    render() {
        if (!this.container) {
            console.error(`Container not found: ${this.containerId}`);
            return;
        }

        const p = this.prefix; // Kısaltma

        // DÜZELTME: Select genişlikleri 80px -> 130px !important yapıldı.
        const selectStyle = "width: 130px !important; min-width: 130px !important; border-top-left-radius: 0; border-bottom-left-radius: 0; background-color: #f8f9fa;";

        const html = `
            <div class="form-group mb-3 p-2 bg-light border rounded">
                <label class="checkbox-label mb-0 font-weight-bold text-primary" style="cursor:pointer; display:flex; align-items:center;">
                    <input type="checkbox" id="${p}IsForeignTransaction" style="width:18px; height:18px; margin-right:10px;"> Yurtdışı İşlem
                </label>
            </div>

            <div id="${p}EpatsDocumentContainer" class="alert alert-secondary align-items-center justify-content-between mb-4" style="display:none; border-left: 4px solid #1e3c72;">
                <div class="d-flex align-items-center">
                    <div class="icon-box mr-3 text-center" style="width: 40px;"><i class="fas fa-file-pdf text-danger fa-2x"></i></div>
                    <div>
                        <h6 class="mb-0 font-weight-bold text-dark" id="${p}EpatsDocName">Belge Adı</h6>
                        <small class="text-muted">İlgili EPATS Evrakı</small>
                    </div>
                </div>
                <a id="${p}EpatsDocLink" href="#" target="_blank" class="btn btn-sm btn-outline-primary shadow-sm"><i class="fas fa-external-link-alt mr-1"></i> Belgeyi Aç</a>
            </div>

            <div class="row">
                <div class="col-md-6">
                    <div class="form-group">
                        <label>Resmi Ücret</label>
                        <div class="input-with-currency" style="display:flex;">
                            <input type="number" id="${p}OfficialFee" class="form-input form-control" step="0.01" placeholder="0.00" style="border-top-right-radius: 0; border-bottom-right-radius: 0;">
                            <select id="${p}OfficialFeeCurrency" class="currency-select form-control" style="${selectStyle}"><option value="TRY">TRY</option><option value="USD">USD</option><option value="EUR">EUR</option></select>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="form-group">
                        <label>Hizmet Ücreti</label>
                        <div class="input-with-currency" style="display:flex;">
                            <input type="number" id="${p}ServiceFee" class="form-input form-control" step="0.01" placeholder="0.00" style="border-top-right-radius: 0; border-bottom-right-radius: 0;">
                            <select id="${p}ServiceFeeCurrency" class="currency-select form-control" style="${selectStyle}"><option value="TRY">TRY</option><option value="USD">USD</option><option value="EUR">EUR</option></select>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row">
                <div class="col-md-6">
                    <div class="form-group">
                        <label>KDV Oranı (%)</label>
                        <input type="number" id="${p}VatRate" class="form-input form-control" value="20">
                    </div>
                </div>
                <div class="col-md-6 d-flex align-items-center">
                    <label class="checkbox-label mt-4" style="cursor:pointer; display:flex; align-items:center;">
                        <input type="checkbox" id="${p}ApplyVatToOfficial" style="width:18px; height:18px; margin-right:10px;"> Resmi Ücrete KDV Ekle
                    </label>
                </div>
            </div>

            <div id="${p}TotalAmountDisplay" class="total-amount-display" style="font-size: 1.2em; font-weight: bold; color: #1e3c72; text-align: right; margin-top: 10px; padding: 12px 15px; background-color: #f0f4f8; border-radius: 10px;">0.00 ₺</div>

            <div class="form-group mt-3" id="${p}ForeignPaymentPartyContainer" style="display:none; background-color: #e3f2fd; padding: 10px; border-radius: 8px; border: 1px solid #90caf9;">
                <label class="text-primary font-weight-bold"><i class="fas fa-globe-americas mr-2"></i>Yurtdışı Ödeme Yapılacak Taraf</label>
                <input type="text" id="${p}ForeignPaymentPartySearch" class="form-input form-control" placeholder="Yurtdışı tarafı ara...">
                <div id="${p}ForeignPaymentPartyResults" class="search-results-list" style="display:none; max-height: 150px; overflow-y: auto; border: 1px solid #ccc; border-radius: 8px; margin-top: 5px; background:white; position:absolute; z-index:1000; width:90%;"></div>
                <div id="${p}ForeignPaymentPartyDisplay" class="search-result-display" style="display:none; background: #e9f5ff; border: 1px solid #bde0fe; padding: 10px; border-radius: 8px; margin-top: 10px;"></div>
            </div>

            <div class="form-group mt-3">
                <label>Fatura Kesilecek Kişi (Müvekkil/TP)</label>
                <input type="text" id="${p}TpInvoicePartySearch" class="form-input form-control" placeholder="Kişi ara...">
                <div id="${p}TpInvoicePartyResults" class="search-results-list" style="display:none; max-height: 150px; overflow-y: auto; border: 1px solid #ccc; border-radius: 8px; margin-top: 5px; background:white; position:absolute; z-index:1000; width:90%;"></div>
                <div id="${p}TpInvoicePartyDisplay" class="search-result-display" style="display:none; background: #e9f5ff; border: 1px solid #bde0fe; padding: 10px; border-radius: 8px; margin-top: 10px;"></div>
            </div>
            
            <div class="form-group mt-3" id="${p}ForeignInvoiceContainer" style="display:none;">
                <label class="form-label">Yurtdışı Fatura/Debit (PDF)</label>
                <label for="${p}ForeignInvoiceFile" class="custom-file-upload btn btn-outline-secondary w-100" style="cursor:pointer;"><i class="fas fa-cloud-upload-alt mr-2"></i> Dosya Seçin</label>
                <input type="file" id="${p}ForeignInvoiceFile" accept="application/pdf" style="display:none;">
                <small id="${p}ForeignInvoiceFileName" class="text-muted d-block mt-1 text-center"></small>
            </div>
        `;

        this.container.innerHTML = html;
        this.setupListeners();
    }

    /**
     * Olay dinleyicilerini (Events) bağlar.
     */
    setupListeners() {
        const p = this.prefix;

        // 1. Hesaplama Listenerları
        [`${p}OfficialFee`, `${p}ServiceFee`, `${p}VatRate`].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => this.calculateTotal());
        });
        document.getElementById(`${p}ApplyVatToOfficial`)?.addEventListener('change', () => this.calculateTotal());
        document.getElementById(`${p}OfficialFeeCurrency`)?.addEventListener('change', () => this.calculateTotal()); // Para birimi değişince sembol değişsin diye

        // 2. Yurtdışı Toggle Listener
        document.getElementById(`${p}IsForeignTransaction`)?.addEventListener('change', () => this.handleForeignToggle());

        // 3. Dosya Seçimi Listener
        document.getElementById(`${p}ForeignInvoiceFile`)?.addEventListener('change', (e) => {
            const nameEl = document.getElementById(`${p}ForeignInvoiceFileName`);
            if (nameEl) nameEl.textContent = e.target.files[0] ? e.target.files[0].name : '';
        });

        // 4. Arama Listenerları
        this.setupSearch(`${p}TpInvoiceParty`, (person) => { this.selectedTpParty = person; });
        this.setupSearch(`${p}ForeignPaymentParty`, (person) => { this.selectedForeignParty = person; });
    }

    /**
     * Kişi arama ve seçme mantığı
     */
    setupSearch(baseId, onSelect) {
        const input = document.getElementById(`${baseId}Search`);
        const results = document.getElementById(`${baseId}Results`);
        const display = document.getElementById(`${baseId}Display`);

        if (!input || !results || !display) return;

        input.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            if (query.length < 2) { results.style.display = 'none'; return; }

            const filtered = this.allPersons.filter(p => 
                (p.name && p.name.toLowerCase().includes(query)) || 
                (p.email && p.email.toLowerCase().includes(query))
            ).slice(0, 10);

            if (filtered.length === 0) {
                results.innerHTML = '<div style="padding:10px; color:#999;">Sonuç bulunamadı</div>';
            } else {
                results.innerHTML = filtered.map(person => `
                    <div class="search-result-item" style="padding:10px; cursor:pointer; border-bottom:1px solid #eee;" data-id="${person.id}">
                        <strong>${person.name}</strong><br><small>${person.email || ''}</small>
                    </div>
                `).join('');

                // Tıklama olaylarını ekle
                results.querySelectorAll('.search-result-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const pid = item.dataset.id;
                        const person = this.allPersons.find(p => String(p.id) === String(pid));
                        
                        // Seçimi işle
                        onSelect(person);
                        
                        // Arayüzü güncelle
                        input.value = '';
                        results.style.display = 'none';
                        display.innerHTML = `
                            <div class="d-flex justify-content-between align-items-center">
                                <span><i class="fas fa-check-circle text-success mr-2"></i> ${person.name}</span>
                                <span class="remove-selection text-danger" style="cursor:pointer; font-weight:bold;">&times;</span>
                            </div>`;
                        display.style.display = 'block';

                        // Kaldırma butonu
                        display.querySelector('.remove-selection').addEventListener('click', () => {
                            onSelect(null);
                            display.style.display = 'none';
                            display.innerHTML = '';
                        });
                    });
                });
            }
            results.style.display = 'block';
        });

        // Dışarı tıklayınca kapat
        document.addEventListener('click', (e) => {
            if (!results.contains(e.target) && e.target !== input) {
                results.style.display = 'none';
            }
        });
    }

    /**
     * Toplam tutarı hesaplar ve ekrana yazar.
     */
    calculateTotal() {
        const p = this.prefix;
        const off = parseFloat(document.getElementById(`${p}OfficialFee`).value) || 0;
        const srv = parseFloat(document.getElementById(`${p}ServiceFee`).value) || 0;
        const vat = parseFloat(document.getElementById(`${p}VatRate`).value) || 0;
        const apply = document.getElementById(`${p}ApplyVatToOfficial`).checked;
        
        let total = apply ? (off + srv) * (1 + vat / 100) : off + (srv * (1 + vat / 100));
        
        // Para birimi (Görsel amaçlı)
        const currency = document.getElementById(`${p}OfficialFeeCurrency`)?.value || 'TRY';

        const fmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(total);
        
        document.getElementById(`${p}TotalAmountDisplay`).textContent = fmt;
        return total;
    }

    /**
     * Yurtdışı/Yurtiçi görünümünü değiştirir.
     */
    handleForeignToggle() {
        const p = this.prefix;
        const isForeign = document.getElementById(`${p}IsForeignTransaction`).checked;
        const foreignPartyDiv = document.getElementById(`${p}ForeignPaymentPartyContainer`);
        const fileDiv = document.getElementById(`${p}ForeignInvoiceContainer`);

        if (isForeign) {
            foreignPartyDiv.style.display = 'block';
            fileDiv.style.display = 'block';
        } else {
            foreignPartyDiv.style.display = 'none';
            fileDiv.style.display = 'none';
        }
    }

    /**
     * Formu tamamen sıfırlar.
     */
    reset() {
        const p = this.prefix;
        
        // Inputları temizle
        this.container.querySelectorAll('input').forEach(i => {
            if(i.type === 'checkbox') i.checked = false;
            else if(i.type !== 'hidden') i.value = '';
        });
        
        // Varsayılanlar
        document.getElementById(`${p}OfficialFeeCurrency`).value = 'TRY';
        document.getElementById(`${p}ServiceFeeCurrency`).value = 'TRY';
        document.getElementById(`${p}VatRate`).value = '20';
        document.getElementById(`${p}TotalAmountDisplay`).textContent = '0.00 ₺';
        
        // Seçimleri temizle
        this.selectedTpParty = null;
        this.selectedForeignParty = null;
        
        document.getElementById(`${p}TpInvoicePartyDisplay`).innerHTML = '';
        document.getElementById(`${p}TpInvoicePartyDisplay`).style.display = 'none';
        
        document.getElementById(`${p}ForeignPaymentPartyDisplay`).innerHTML = '';
        document.getElementById(`${p}ForeignPaymentPartyDisplay`).style.display = 'none';
        
        document.getElementById(`${p}ForeignInvoiceFileName`).textContent = '';
        
        // EPATS gizle
        document.getElementById(`${p}EpatsDocumentContainer`).style.display = 'none';

        // Toggle durumu güncelle
        this.handleForeignToggle();
    }

    /**
     * Düzenleme (Edit) modu için verileri forma doldurur.
     */
    setData(data) {
        const p = this.prefix;
        if(!data) return;

        // Ücretler
        if (data.officialFee) {
            document.getElementById(`${p}OfficialFee`).value = data.officialFee.amount || 0;
            document.getElementById(`${p}OfficialFeeCurrency`).value = data.officialFee.currency || 'TRY';
        }
        if (data.serviceFee) {
            document.getElementById(`${p}ServiceFee`).value = data.serviceFee.amount || 0;
            document.getElementById(`${p}ServiceFeeCurrency`).value = data.serviceFee.currency || 'TRY';
        }
        
        // KDV
        document.getElementById(`${p}VatRate`).value = data.vatRate || 20;
        document.getElementById(`${p}ApplyVatToOfficial`).checked = data.applyVatToOfficialFee ?? false;

        // Taraflar (Sadece görseli güncellemek için, nesneleri state'e atıyoruz)
        if (data.tpInvoiceParty) {
            this.selectedTpParty = data.tpInvoiceParty;
            this.manualSelectDisplay(`${p}TpInvoiceParty`, data.tpInvoiceParty);
        }
        
        // Yurtdışı Taraf Tespiti
        let isForeign = false;
        if (data.serviceInvoiceParty && (!data.tpInvoiceParty || data.serviceInvoiceParty.id !== data.tpInvoiceParty.id)) {
            isForeign = true;
            this.selectedForeignParty = data.serviceInvoiceParty;
            this.manualSelectDisplay(`${p}ForeignPaymentParty`, data.serviceInvoiceParty);
        } else if (data.isForeignTransaction) {
            isForeign = true;
        }

        document.getElementById(`${p}IsForeignTransaction`).checked = isForeign;
        this.handleForeignToggle();
        this.calculateTotal();
    }

    manualSelectDisplay(baseId, person) {
        const display = document.getElementById(`${baseId}Display`);
        const input = document.getElementById(`${baseId}Search`);
        if(!display) return;
        
        input.value = '';
        display.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <span><i class="fas fa-check-circle text-success mr-2"></i> ${person.name}</span>
                <span class="remove-selection text-danger" style="cursor:pointer; font-weight:bold;">&times;</span>
            </div>`;
        display.style.display = 'block';
        
        display.querySelector('.remove-selection').addEventListener('click', () => {
            if(baseId.includes('Tp')) this.selectedTpParty = null;
            else this.selectedForeignParty = null;
            display.style.display = 'none';
            display.innerHTML = '';
        });
    }

    /**
     * Formdaki verileri toplayıp döndürür (Validation dahil).
     */
    getData() {
        const p = this.prefix;
        const officialFee = parseFloat(document.getElementById(`${p}OfficialFee`).value) || 0;
        const serviceFee = parseFloat(document.getElementById(`${p}ServiceFee`).value) || 0;
        
        // Basit Validation
        if (officialFee <= 0 && serviceFee <= 0) {
            return { success: false, error: 'En az bir ücret (Resmi veya Hizmet) girmelisiniz.' };
        }

        const isForeign = document.getElementById(`${p}IsForeignTransaction`).checked;
        const fileInput = document.getElementById(`${p}ForeignInvoiceFile`);
        const files = fileInput.files;

        // Taraf Mantığı
        const tpParty = this.selectedTpParty ? { id: this.selectedTpParty.id, name: this.selectedTpParty.name } : null;
        let serviceParty = null;

        if (isForeign) {
            if (this.selectedForeignParty) {
                serviceParty = { id: this.selectedForeignParty.id, name: this.selectedForeignParty.name };
            }
        } else {
            serviceParty = tpParty;
        }

        return {
            success: true,
            data: {
                officialFee: { amount: officialFee, currency: document.getElementById(`${p}OfficialFeeCurrency`).value },
                serviceFee: { amount: serviceFee, currency: document.getElementById(`${p}ServiceFeeCurrency`).value },
                vatRate: parseFloat(document.getElementById(`${p}VatRate`).value) || 0,
                applyVatToOfficialFee: document.getElementById(`${p}ApplyVatToOfficial`).checked,
                totalAmount: parseFloat(document.getElementById(`${p}TotalAmountDisplay`).textContent.replace(/[^0-9.,]/g, '').replace(',','.')) || 0, // Basit parse
                tpInvoiceParty: tpParty,
                serviceInvoiceParty: serviceParty,
                isForeignTransaction: isForeign,
                files: files // Dosya objesi döner, upload çağıran yerde yapılır
            }
        };
    }
    
    /**
     * EPATS Belgesini Gösterir
     */
    showEpatsDoc(doc) {
        const p = this.prefix;
        const container = document.getElementById(`${p}EpatsDocumentContainer`);
        
        // Reset
        document.getElementById(`${p}EpatsDocName`).textContent = 'Belge Adı';
        document.getElementById(`${p}EpatsDocLink`).href = '#';

        if (!doc || (!doc.url && !doc.downloadURL)) {
            container.style.display = 'none';
            return;
        }
        
        document.getElementById(`${p}EpatsDocName`).textContent = doc.name || 'EPATS Belgesi';
        document.getElementById(`${p}EpatsDocLink`).href = doc.url || doc.downloadURL;
        container.style.display = 'flex';
    }
}