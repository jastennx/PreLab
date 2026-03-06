(function initPrelabDialogs() {
  function hasCoolAlert() {
    return typeof window.CoolAlert !== 'undefined' && typeof window.CoolAlert.show === 'function';
  }

  function installSwalCompat() {
    if (!hasCoolAlert() || (typeof window.Swal !== 'undefined' && typeof window.Swal.fire === 'function')) {
      return;
    }

    window.Swal = {
      fire: (options = {}) => {
        const normalized = { ...options };

        if (normalized.allowOutsideClick === false) {
          normalized.allowOutsideClick = () => false;
        }

        const promise = window.CoolAlert.show(normalized);

        if (typeof options.didOpen === 'function') {
          window.setTimeout(() => {
            try {
              options.didOpen();
            } catch (error) {
              // Ignore callback errors to preserve alert flow.
            }
          }, 120);
        }

        return promise;
      },
      close: () => {
        if (typeof window.CoolAlert.closeModal === 'function') {
          window.CoolAlert.closeModal();
        }
      },
      showLoading: () => {},
      isLoading: () => (typeof window.CoolAlert.isLoading === 'function' ? window.CoolAlert.isLoading() : false)
    };
  }

  async function alertDialog(message, options = {}) {
    const text = String(message || '').trim() || 'Something happened.';

    if (hasCoolAlert()) {
      await window.CoolAlert.show({
        title: options.title || 'Notice',
        text,
        icon: options.icon || 'info',
        confirmButtonText: options.confirmButtonText || 'OK'
      });
      return;
    }

    window.alert(text);
  }

  async function confirmDialog(message, options = {}) {
    const text = String(message || '').trim() || 'Please confirm.';

    if (hasCoolAlert()) {
      const result = await window.CoolAlert.show({
        title: options.title || 'Please confirm',
        text,
        icon: options.icon || 'question',
        showCancelButton: true,
        confirmButtonText: options.confirmButtonText || 'Yes',
        cancelButtonText: options.cancelButtonText || 'Cancel',
        reverseButtons: true
      });
      return Boolean(result.isConfirmed);
    }

    return window.confirm(text);
  }

  window.prelabDialog = {
    alert: alertDialog,
    confirm: confirmDialog
  };

  installSwalCompat();
})();
