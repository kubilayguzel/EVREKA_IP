
/**
 * Evreka Date Pickers (centralized)
 * - Idempotent: won't initialize the same <input data-datepicker> twice
 * - Cleans up stray altInput if any
 * - Uses flatpickr with altInput and hides the original input to avoid double fields
 * - Adds a simple gg.aa.yyyy mask on the visible input
 * - Syncs alt input changes back to the original hidden input (#deliveryDate etc.)
 */
(function (w) {
  const DP = {
    /**
     * Initialize all inputs under a root (defaults to document).
     * @param {HTMLElement|Document} root
     * @param {Object} userOpts - flatpickr options override
     */
    init(root = document, userOpts = {}) {
      try {
        const nodes = Array.from(root.querySelectorAll('input[data-datepicker]'));
        nodes.forEach((el) => this.attach(el, userOpts));
      } catch (err) {
        console.warn('EvrekaDatePicker.init error:', err);
      }
    },

    /**
     * Attach a date picker to a single input
     * @param {HTMLInputElement} el
     * @param {Object} userOpts
     */
    attach(el, userOpts = {}) {
      try {
        if (!w.flatpickr || typeof w.flatpickr !== 'function') return;

        // ✅ Idempotent & guard
        if (el.dataset.dpInit === '1') return;
        if (el._flatpickr) return;

        // Disable native date UI to avoid double pickers
        try { if ((el.type || '').toLowerCase() === 'date') el.type = 'text'; } catch (e) {}
        el.setAttribute('inputmode', 'numeric');

        // ✅ If a previous alt input is lingering next to this element, remove it
        if (el.nextElementSibling && el.nextElementSibling.classList.contains('flatpickr-alt-input')) {
          el.nextElementSibling.remove();
        }

        // Resolve formats from data-*
        const dateFormat = el.dataset.dateFormat || 'Y-m-d';
        const altFormat  = el.dataset.altFormat  || 'd.m.Y';
        const minDate    = el.dataset.min || undefined;
        const maxDate    = el.dataset.max || undefined;

        // Pick up an initial value if it looks like a date
        const val = (el.value || '').trim();
        const ddmmyyyy = /^\d{2}\.\d{2}\.\d{4}$/;
        const yyyymmdd = /^\d{4}-\d{2}-\d{2}$/;
        const defaultDate = (ddmmyyyy.test(val) || yyyymmdd.test(val)) ? val : undefined;

        const fp = w.flatpickr(el, {
          dateFormat,
          altInput: true,
          altFormat,
          allowInput: true,
          clickOpens: true,
          locale: (w.flatpickr && w.flatpickr.l10ns && (w.flatpickr.l10ns.tr || w.flatpickr.l10ns.default)) || 'tr',
          defaultDate,
          minDate,
          maxDate,
          onChange: (selectedDates, dateStr, inst) => {
            // Sync ISO (Y-m-d) to hidden/original input and dispatch events for validators
            el.value = dateStr || '';
            try {
              el.dispatchEvent(new Event('input',  { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } catch(e){}
          },
          onClose: (selectedDates, dateStr, inst) => {
            // If visible value is not in dd.mm.yyyy sanitize by clearing
            const vis = inst && inst.altInput ? inst.altInput.value : '';
            if (vis && !ddmmyyyy.test(vis)) inst.clear();
          },
          onKeydown: (sel, str, inst, ev) => {
            if (ev.key === 'Enter') (inst && (inst.altInput || el) ? (inst.altInput || el).blur() : null);
          },
          ...userOpts
        });

        // ✅ Mark initialized & hide original input if altInput exists
        el.dataset.dpInit = '1';
        if (fp && fp.altInput) {
          el.style.display = 'none'; // keep only the nice visible input
          try { fp.altInput.setAttribute('data-for', el.id || ''); } catch (e) {}

          // 🔁 Keep original input in sync when user types manually into alt input
          const alt = fp.altInput;
          if (alt && !alt.__evrekaSyncBound) {
            alt.addEventListener('input', (ev) => {
              let v = (alt.value || '').replace(/[^\d.]/g, '');
              if (v.length >= 2 && v[2] !== '.') v = v.slice(0, 2) + '.' + v.slice(2);
              if (v.length >= 5 && v[5] !== '.') v = v.slice(0, 5) + '.' + v.slice(5);
              if (v.length > 10) v = v.slice(0, 10);
              alt.value = v;

              // dd.mm.yyyy → yyyy-mm-dd
              if (ddmmyyyy.test(v)) {
                const [dd, mm, yyyy] = v.split('.');
                el.value = `${yyyy}-${mm}-${dd}`;
              } else {
                el.value = '';
              }
              try {
                el.dispatchEvent(new Event('input',  { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } catch(e){}
            }, { passive: true });
            alt.__evrekaSyncBound = true;
          }
        }

        // 🔤 Simple mask for the visible input (or fallback to original) — keep for non-altInput case
        const maskTarget = (fp && fp.altInput) ? fp.altInput : el;
        if (maskTarget && !maskTarget.__evrekaMaskBound) {
          if (!maskTarget.placeholder) maskTarget.placeholder = 'gg.aa.yyyy';
          maskTarget.addEventListener('input', ev => {
            // If there's an altInput, the sync above already formats it; keep this for fallback cases
            if (fp && fp.altInput && ev.target === fp.altInput) return;
            let v = (ev.target.value || '').replace(/[^\d.]/g, '');
            if (v.length >= 2 && v[2] !== '.') v = v.slice(0, 2) + '.' + v.slice(2);
            if (v.length >= 5 && v[5] !== '.') v = v.slice(0, 5) + '.' + v.slice(5);
            if (v.length > 10) v = v.slice(0, 10);
            ev.target.value = v;
          }, { passive: true });
          maskTarget.__evrekaMaskBound = true;
        }
      } catch (err) {
        console.warn('EvrekaDatePicker.attach error:', err);
      }
    },

    /**
     * Re-init (useful after dynamic HTML injections)
     */
    refresh(root = document) {
      this.init(root);
    }
  };

  // Expose
  w.EvrekaDatePicker = w.EvrekaDatePicker || DP;

  // Auto init on DOMContentLoaded (safe if imported once)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { w.EvrekaDatePicker.init(); } catch (e) {}
    });
  } else {
    try { w.EvrekaDatePicker.init(); } catch (e) {}
  }
})(window);
