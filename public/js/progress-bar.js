/**
 * Progress Bar Utility
 * Ortak progress bar componenti
 */

class ProgressBar {
  constructor() {
    this.overlay = null;
    this.progressBar = null;
    this.currentStep = 0;
    this.steps = [];
    this.onCancel = null;
  }

  /**
   * Progress bar'ı başlat
   * @param {Object} options - Konfigürasyon
   * @param {string} options.title - Ana başlık
   * @param {string} options.subtitle - Alt açıklama
   * @param {Array} options.steps - Adım listesi
   * @param {Function} options.onCancel - İptal callback'i
   * @param {boolean} options.indeterminate - Belirsiz progress modu
   */
  show(options = {}) {
    const {
      title = 'İşlem Yapılıyor',
      subtitle = 'Lütfen bekleyiniz...',
      steps = [],
      onCancel = null,
      indeterminate = false
    } = options;

    this.steps = steps;
    this.currentStep = 0;
    this.onCancel = onCancel;

    // Overlay oluştur
    this.overlay = document.createElement('div');
    this.overlay.className = 'progress-overlay';
    this.overlay.innerHTML = `
      <div class="progress-container">
        <div class="progress-title">${title}</div>
        <div class="progress-subtitle">${subtitle}</div>
        
        <div class="progress-bar-wrapper">
          <div class="progress-bar ${indeterminate ? 'indeterminate' : ''}" id="progressBarFill"></div>
        </div>
        
        ${!indeterminate ? '<div class="progress-percentage" id="progressPercentage">0%</div>' : ''}
        
        ${steps.length > 0 ? `
          <div class="progress-steps" id="progressSteps">
            ${steps.map((step, index) => `
              <div class="progress-step" data-step="${index}">
                <span class="progress-spinner" style="display: none;"></span>
                ${step}
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        ${onCancel ? '<button class="progress-cancel" id="progressCancel">İptal</button>' : ''}
      </div>
    `;

    // DOM'a ekle
    document.body.appendChild(this.overlay);
    
    // Event listener'ları kur
    if (onCancel) {
      const cancelBtn = this.overlay.querySelector('#progressCancel');
      cancelBtn?.addEventListener('click', () => {
        this.hide();
        onCancel();
      });
    }

    // Progress bar referansını al
    this.progressBar = this.overlay.querySelector('#progressBarFill');

    // Göster
    setTimeout(() => {
      this.overlay.classList.add('show');
    }, 10);
  }

  /**
   * Progress yüzdesini güncelle
   * @param {number} percentage - 0-100 arası
   */
  setProgress(percentage) {
    if (!this.progressBar || this.progressBar.classList.contains('indeterminate')) return;
    
    const safePercentage = Math.max(0, Math.min(100, percentage));
    this.progressBar.style.width = `${safePercentage}%`;
    
    const percentageEl = this.overlay?.querySelector('#progressPercentage');
    if (percentageEl) {
      percentageEl.textContent = `${Math.round(safePercentage)}%`;
    }
  }

  /**
   * Aktif adımı değiştir
   * @param {number} stepIndex - Adım indeksi
   * @param {string} status - 'active', 'completed', 'error'
   */
  setStep(stepIndex, status = 'active') {
    if (!this.steps.length) return;

    const stepsContainer = this.overlay?.querySelector('#progressSteps');
    if (!stepsContainer) return;

    // Önceki adımları completed yap
    for (let i = 0; i < stepIndex; i++) {
      const stepEl = stepsContainer.querySelector(`[data-step="${i}"]`);
      if (stepEl) {
        stepEl.className = 'progress-step completed';
        const spinner = stepEl.querySelector('.progress-spinner');
        if (spinner) spinner.style.display = 'none';
      }
    }

    // Aktif adımı güncelle
    const activeStepEl = stepsContainer.querySelector(`[data-step="${stepIndex}"]`);
    if (activeStepEl) {
      activeStepEl.className = `progress-step ${status}`;
      const spinner = activeStepEl.querySelector('.progress-spinner');
      if (spinner) {
        spinner.style.display = status === 'active' ? 'inline-block' : 'none';
      }
    }

    this.currentStep = stepIndex;

    // Auto progress güncellemesi
    if (!this.progressBar.classList.contains('indeterminate')) {
      const progress = ((stepIndex + 1) / this.steps.length) * 100;
      this.setProgress(progress);
    }
  }

  /**
   * Mevcut adımı tamamla ve bir sonrakine geç
   */
  nextStep() {
    if (this.currentStep < this.steps.length - 1) {
      this.setStep(this.currentStep + 1);
    }
  }

  /**
   * Başlık/alt başlığı güncelle
   * @param {string} title - Yeni başlık
   * @param {string} subtitle - Yeni alt başlık
   */
  updateText(title, subtitle) {
    if (!this.overlay) return;

    const titleEl = this.overlay.querySelector('.progress-title');
    const subtitleEl = this.overlay.querySelector('.progress-subtitle');
    
    if (titleEl && title) titleEl.textContent = title;
    if (subtitleEl && subtitle) subtitleEl.textContent = subtitle;
  }

  /**
   * Hata durumu göster
   * @param {string} message - Hata mesajı
   */
  showError(message) {
    if (!this.overlay) return;

    const container = this.overlay.querySelector('.progress-container');
    container.style.borderLeft = '4px solid #e74c3c';
    
    this.updateText('Hata Oluştu', message);
    
    // Progress bar'ı kırmızı yap
    if (this.progressBar) {
      this.progressBar.style.background = '#e74c3c';
    }

    // İptal butonunu kapat yap
    const cancelBtn = this.overlay.querySelector('#progressCancel');
    if (cancelBtn) {
      cancelBtn.textContent = 'Kapat';
    }
  }

  /**
   * Başarı durumu göster
   * @param {string} message - Başarı mesajı
   */
  showSuccess(message) {
    if (!this.overlay) return;

    const container = this.overlay.querySelector('.progress-container');
    container.style.borderLeft = '4px solid #27ae60';
    
    this.updateText('Tamamlandı', message);
    this.setProgress(100);

    // Progress bar'ı yeşil yap
    if (this.progressBar) {
      this.progressBar.style.background = '#27ae60';
    }

    // Auto close after 2 seconds
    setTimeout(() => {
      this.hide();
    }, 2000);
  }

  /**
   * Progress bar'ı gizle
   */
  hide() {
    if (!this.overlay) return;

    this.overlay.classList.remove('show');
    
    setTimeout(() => {
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
      this.overlay = null;
      this.progressBar = null;
    }, 300);
  }
}

// Global instance
window.ProgressBar = ProgressBar;

// Utility functions
window.showProgress = (options) => {
  const progress = new ProgressBar();
  progress.show(options);
  return progress;
};

window.showSimpleProgress = (title, subtitle) => {
  return window.showProgress({
    title,
    subtitle,
    indeterminate: true
  });
};