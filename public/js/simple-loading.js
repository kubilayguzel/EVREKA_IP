/**
 * Simple Loading Animation - Tech Company Style
 */

class SimpleLoading {
  constructor() {
    this.overlay = null;
    this.onCancel = null;
  }

  show(options = {}) {
    const {
      text = 'İşlem yapılıyor',
      subtext = 'Lütfen bekleyiniz',
      onCancel = null
    } = options;

    this.onCancel = onCancel;

    // Statik üç nokta ekle
    const displayText = text + '...';

    this.overlay = document.createElement('div');
    this.overlay.className = 'simple-loading-overlay';
    this.overlay.innerHTML = `
      <div class="simple-loading-content">
        <div class="loading-spinner"></div>
        <div class="loading-text">${displayText}</div>
        <div class="loading-subtext">${subtext}</div>
        ${onCancel ? '<button class="loading-cancel" id="loadingCancel">İptal</button>' : ''}
      </div>
    `;

    document.body.appendChild(this.overlay);
    
    if (onCancel) {
      const cancelBtn = this.overlay.querySelector('#loadingCancel');
      cancelBtn?.addEventListener('click', () => {
        this.hide();
        onCancel();
      });
    }

    setTimeout(() => {
      this.overlay.classList.add('show');
    }, 10);
  }

  updateText(text, subtext) {
    if (!this.overlay) return;

    const textEl = this.overlay.querySelector('.loading-text');
    const subtextEl = this.overlay.querySelector('.loading-subtext');
    
    if (textEl && text) {
      textEl.textContent = text + '...'; // Statik nokta
    }
    if (subtextEl && subtext) {
      subtextEl.textContent = subtext;
    }
  }

  showSuccess(message) {
    if (!this.overlay) return;

    const content = this.overlay.querySelector('.simple-loading-content');
    content.style.background = 'linear-gradient(145deg, #dcfce7, #bbf7d0)';
    content.innerHTML = `
      <div style="color: #16a34a; font-size: 28px; margin-bottom: 12px;">✓</div>
      <div class="loading-text" style="background: linear-gradient(135deg, #166534, #16a34a); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Tamamlandı</div>
      <div class="loading-subtext">${message}</div>
    `;

    setTimeout(() => this.hide(), 2000);
  }

  showError(message) {
    if (!this.overlay) return;

    const content = this.overlay.querySelector('.simple-loading-content');
    content.style.background = 'linear-gradient(145deg, #fecaca, #fca5a5)';
    content.innerHTML = `
      <div style="color: #dc2626; font-size: 28px; margin-bottom: 12px;">✗</div>
      <div class="loading-text" style="background: linear-gradient(135deg, #991b1b, #dc2626); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Hata Oluştu</div>
      <div class="loading-subtext">${message}</div>
      <button class="loading-cancel" onclick="this.closest('.simple-loading-overlay').remove()">Kapat</button>
    `;
  }

  hide() {
    if (!this.overlay) return;

    this.overlay.classList.remove('show');
    
    setTimeout(() => {
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
      this.overlay = null;
    }, 300);
  }
}

// Global functions
window.SimpleLoading = SimpleLoading;

window.showSimpleLoading = (text, subtext, onCancel) => {
  const loading = new SimpleLoading();
  loading.show({ text, subtext, onCancel });
  return loading;
};

window.showLoadingWithCancel = window.showSimpleLoading;
if (typeof window !== 'undefined') {
  window.SimpleLoading = SimpleLoading;
}