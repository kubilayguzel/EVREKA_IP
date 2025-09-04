/**
 * Simple Loading Animation
 * Basit yükleniyor animasyonu
 */

class SimpleLoading {
  constructor() {
    this.overlay = null;
    this.onCancel = null;
  }

  /**
   * Loading animasyonunu göster
   * @param {Object} options - Konfigürasyon
   * @param {string} options.text - Ana metin
   * @param {string} options.subtext - Alt açıklama
   * @param {Function} options.onCancel - İptal callback'i
   */
  show(options = {}) {
    const {
      text = 'İşlem yapılıyor',
      subtext = 'Lütfen bekleyiniz',
      onCancel = null
    } = options;

    this.onCancel = onCancel;

    // Overlay oluştur
    this.overlay = document.createElement('div');
    this.overlay.className = 'simple-loading-overlay';
    this.overlay.innerHTML = `
      <div class="simple-loading-content">
        <div class="loading-spinner"></div>
        <div class="loading-text">${text}<span class="loading-dots"></span></div>
        <div class="loading-subtext">${subtext}</div>
        ${onCancel ? '<button class="loading-cancel" id="loadingCancel">İptal</button>' : ''}
      </div>
    `;

    // DOM'a ekle
    document.body.appendChild(this.overlay);
    
    // Event listener kur
    if (onCancel) {
      const cancelBtn = this.overlay.querySelector('#loadingCancel');
      cancelBtn?.addEventListener('click', () => {
        this.hide();
        onCancel();
      });
    }

    // Göster
    setTimeout(() => {
      this.overlay.classList.add('show');
    }, 10);
  }

  /**
   * Metni güncelle
   * @param {string} text - Yeni ana metin
   * @param {string} subtext - Yeni alt metin
   */
  updateText(text, subtext) {
    if (!this.overlay) return;

    const textEl = this.overlay.querySelector('.loading-text');
    const subtextEl = this.overlay.querySelector('.loading-subtext');
    
    if (textEl && text) {
      textEl.innerHTML = `${text}<span class="loading-dots"></span>`;
    }
    if (subtextEl && subtext) {
      subtextEl.textContent = subtext;
    }
  }

  /**
   * Başarı durumu göster ve kapat
   * @param {string} message - Başarı mesajı
   */
  showSuccess(message) {
    if (!this.overlay) return;

    const content = this.overlay.querySelector('.simple-loading-content');
    content.style.borderLeft = '4px solid #27ae60';
    
    content.innerHTML = `
      <div style="color: #27ae60; font-size: 24px; margin-bottom: 10px;">✓</div>
      <div class="loading-text" style="color: #27ae60;">Tamamlandı</div>
      <div class="loading-subtext">${message}</div>
    `;

    // 2 saniye sonra otomatik kapat
    setTimeout(() => {
      this.hide();
    }, 2000);
  }

  /**
   * Hata durumu göster
   * @param {string} message - Hata mesajı
   */
  showError(message) {
    if (!this.overlay) return;

    const content = this.overlay.querySelector('.simple-loading-content');
    content.style.borderLeft = '4px solid #e74c3c';
    
    content.innerHTML = `
      <div style="color: #e74c3c; font-size: 24px; margin-bottom: 10px;">✗</div>
      <div class="loading-text" style="color: #e74c3c;">Hata Oluştu</div>
      <div class="loading-subtext">${message}</div>
      <button class="loading-cancel" onclick="this.closest('.simple-loading-overlay').remove()">Kapat</button>
    `;
  }

  /**
   * Loading'i gizle
   */
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

// Global utility functions
window.SimpleLoading = SimpleLoading;

window.showSimpleLoading = (text, subtext, onCancel) => {
  const loading = new SimpleLoading();
  loading.show({ text, subtext, onCancel });
  return loading;
};

window.showLoadingWithCancel = (text, subtext, onCancel) => {
  return window.showSimpleLoading(text, subtext, onCancel);
};