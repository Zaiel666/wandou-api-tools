(function (global) {
  'use strict';
  if (global.WandouTheme) return;
  const keys = ['ai-tools-theme', 'wd-theme', 'aiCanvasProjectHubTheme', 'pea-theme'];
  const valid = value => value === 'light' || value === 'dark';
  const bridge = global.wandouShell;
  let theme = readStored(), localChanges = 0, desktopRevision = -1;
  function readStored() {
    try { for (const key of keys) { const value = localStorage.getItem(key); if (valid(value)) return value; } } catch (_) {}
    return 'light';
  }
  function persist(value) {
    try { for (const key of keys) if (localStorage.getItem(key) !== value) localStorage.setItem(key, value); } catch (_) {}
  }
  function apply(value) {
    const root = document.documentElement, body = document.body, dark = value === 'dark';
    root.dataset.theme = value;
    root.classList.toggle('dark', dark);
    root.style.colorScheme = value;
    if (body) {
      body.classList.toggle('dark', dark);
      body.classList.toggle('dark-theme', dark);
      body.classList.toggle('light-theme', !dark);
      body.style.colorScheme = value;
    }
  }
  function receive(value, save = true) {
    if (!valid(value)) return theme;
    const changed = theme !== value;
    theme = value;
    if (save) persist(value);
    apply(value);
    if (changed) global.dispatchEvent(new CustomEvent('wandou-theme-change', { detail: { theme: value } }));
    return theme;
  }
  function set(value) {
    if (!valid(value)) return theme;
    const changed = value !== theme;
    if (changed) localChanges++;
    receive(value);
    if (changed) bridge?.setTheme?.(value);
    return theme;
  }
  function fromDesktop(state) {
    if (!state || !valid(state.theme)) return;
    const revision = Number(state.revision) || 0;
    if (revision < desktopRevision) return;
    desktopRevision = revision;
    receive(state.theme);
  }
  global.WandouTheme = { get: () => theme, set };
  apply(theme);
  if (!document.body) {
    const bodyReady = new MutationObserver(() => {
      if (document.body) { bodyReady.disconnect(); apply(theme); }
    });
    bodyReady.observe(document.documentElement, { childList: true });
  }
  global.addEventListener('DOMContentLoaded', () => apply(theme), { once: true });
  global.addEventListener('storage', event => {
    if (!keys.includes(event.key) || !valid(event.newValue)) return;
    // The canonical key wins while compatibility aliases are being updated.
    receive(readStored(), false);
  });
  global.addEventListener('pageshow', () => { if (!bridge?.getTheme) receive(readStored(), false); });
  global.addEventListener('focus', () => { if (!bridge?.getTheme) receive(readStored(), false); });
  bridge?.onThemeChanged?.(fromDesktop);
  if (bridge?.getTheme) {
    const beforeRead = localChanges;
    Promise.resolve(bridge.getTheme()).then(state => {
      if (localChanges !== beforeRead) return;
      if (valid(state?.theme)) fromDesktop(state);
      else bridge.setTheme?.(theme); // Migrate the existing page preference once.
    }).catch(() => {});
  }
})(window);
