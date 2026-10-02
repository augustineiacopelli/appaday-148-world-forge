// === APP:BOOT BEGIN ===
(function () {
  'use strict';
  function wire(id, icon, label, fn) {
    var b = document.getElementById(id);
    if (!b) return;
    if (icon) b.innerHTML = Kit.icon(icon) + (label ? '<span class="lbl">' + label + '</span>' : '');
    b.addEventListener('click', fn);
  }
  Kit.theme.apply();
  try { window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (Kit.theme.get() === 'system') Kit.theme.apply(); }); } catch (e) {}
  wire('btnSettings', 'gear', null, function () { Kit.settings.open(); });
  document.getElementById('btnTheme').addEventListener('click', Kit.theme.toggle);
  wire('btnTitle', null, null, Kit.renameProject);
  wire('btnValidation', null, null, Kit.openValidation);
  wire('btnSize', null, null, function () { WORLD.openSize(); });
  wire('btnSave', 'save', 'Save', function () { if (Kit.bundle.save()) Kit.ui.toast('Draft saved in this browser.', 'ok'); });
  wire('btnSlots', 'slots', 'Slots', Kit.openSlots);
  wire('btnImport', 'import', 'Import', function () { var f = document.getElementById('fileImport'); f.value = ''; f.click(); });
  wire('btnExport', 'export', 'Export', Kit.openExport);
  document.getElementById('btnBannerExport').addEventListener('click', Kit.openExport);
  document.getElementById('fileImport').addEventListener('change', function (e) { Kit.importPicked(e.target.files && e.target.files[0]); });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (Kit.bundle.save()) Kit.ui.toast('Draft saved in this browser.', 'ok');
    } else if (e.key === 'Escape' && Kit.ui.overlayCount() && !Kit.ui.busy.active()) { e.preventDefault(); Kit.ui.closeTop(); }
  });
  // The draft may live in IndexedDB (see WORLD.storage), so restoring waits for the mirror to load. It always resolves.
  WORLD.booted = WORLD.storage.ready().then(function () {
    var b = Kit.bundle.restoreDraft() || Kit.bundle.create('Untitled Saga');
    if (WORLD.ensure(b)) Kit.bundle.touch('world-ensure');
    var want = Kit.uiState.get().tab;
    if (!want || !Kit.go(want, { silent: true })) Kit.go('start', { silent: true });
    WORLD.paintMeter();
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') Kit.bundle.suspend.save(); });
  window.addEventListener('pagehide', function () { Kit.bundle.suspend.save(); });
})();
// === APP:BOOT END ===
