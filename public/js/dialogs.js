(function initPrelabDialogs() {
  function hasSweetAlert() {
    return typeof window.Swal !== 'undefined' && typeof window.Swal.fire === 'function';
  }

  async function alertDialog(message, options = {}) {
    const text = String(message || '').trim() || 'Something happened.';

    if (hasSweetAlert()) {
      await window.Swal.fire({
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

    if (hasSweetAlert()) {
      const result = await window.Swal.fire({
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
})();
