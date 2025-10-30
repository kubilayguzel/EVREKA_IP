// public/js/date-pickers.js
(function (w) {
  const DP = {
    DEFAULT_SELECTORS: ['input[data-datepicker]', 'input.js-datepicker', 'input[type="date"]'],
    _observer: null,

    init({ root = document, ids = [], selectors = null, options = {} } = {}) {
      const sels = selectors || this.DEFAULT_SELECTORS;
      const targets = new Set();

      // ID'lerle topla
      (ids || []).forEach(id => {
        const found = root.querySelectorAll(`#${id}`);
        found.forEach(el => targets.add(el));
      });

      // Seçicilerle topla
      sels.forEach(sel => root.querySelectorAll(sel).forEach(el => targets.add(el)));

      // Her elemana bağla
      targets.forEach(el => this.attach(el, options));

      // Dinamik DOM (modal, AJAX vs.) için izleme başlat
      this.observe(root, options, sels);
    },

    observe(root, options, selectors) {
      if (this._observer) this._observer.disconnect();
      this._observer = new MutationObserver(muts => {
        muts.forEach(m => {
          m.addedNodes.forEach(node => {
            if (!(node instanceof Element)) return;
            // Yeni eklenen düğümleri ve içindekileri tara
            selectors.forEach(sel => {
              if (node.matches?.(sel)) this.attach(node, options);
              node.querySelectorAll?.(sel).forEach(el => this.attach(el, options));
            });
          });
        });
      });
      this._observer.observe(root, { childList: true, subtree: true });
    },

    attach(el, userOpts = {}) {
      try {
        if (!w.flatpickr || typeof w.flatpickr !== 'function') return;
        if (el._flatpickr) return; // zaten bağlı

        // type="date" ise native picker’ı kapat
        try { if ((el.type || '').toLowerCase() === 'date') el.type = 'text'; } catch (e) {}
        el.setAttribute('inputmode', 'numeric');

        // data-* ile özelleştirme
        const dateFormat = el.dataset.dateFormat || 'Y-m-d';
        const altFormat  = el.dataset.altFormat  || 'd.m.Y';
        const minDate    = el.dataset.min || undefined;
        const maxDate    = el.dataset.max || undefined;

        // var olan değeri defaultDate olarak geç (dd.mm.yyyy veya yyyy-mm-dd destekler)
        const val = (el.value || '').trim();
        const ddmmyyyy = /^\d{2}\.\d{2}\.\d{4}$/;
        const yyyymmdd = /^\d{4}-\d{2}-\d{2}$/;
        const defaultDate = ddmmyyyy.test(val) || yyyymmdd.test(val) ? val : undefined;

        const fp = flatpickr(el, {
          dateFormat,
          altInput: true,
          altFormat,
          allowInput: true,
          clickOpens: true,
          locale: (w.flatpickr?.l10ns?.tr) || 'tr',
          defaultDate,
          minDate,
          maxDate,
          onClose: (selectedDates, dateStr, inst) => {
            const vis = inst?.altInput ? inst.altInput.value : '';
            if (vis && !ddmmyyyy.test(vis)) inst.clear(); // yanlış girildiyse temizle
          },
          onKeydown: (sel, str, inst, ev) => {
            if (ev.key === 'Enter') (inst?.altInput || el).blur();
          },
          ...userOpts
        });

        // Maske (dd.mm.yyyy)
        const maskTarget = fp?.altInput || el;
        if (maskTarget && !maskTarget.__evrekaMaskBound) {
          if (!maskTarget.placeholder) maskTarget.placeholder = 'gg.aa.yyyy';
          maskTarget.addEventListener('input', ev => {
            const input = ev.target;
            let v = (input.value || '').replace(/[^\d.]/g, '');
            if (v.length >= 2 && v[2] !== '.') v = v.slice(0, 2) + '.' + v.slice(2);
            if (v.length >= 5 && v[5] !== '.') v = v.slice(0, 5) + '.' + v.slice(5);
            if (v.length > 10) v = v.slice(0, 10);
            input.value = v;
          }, { passive: true });
          maskTarget.__evrekaMaskBound = true;
        }
      } catch (err) {
        console.warn('EvrekaDatePicker.attach error:', err);
      }
    }
  };

  w.EvrekaDatePicker = DP;
})(window);
