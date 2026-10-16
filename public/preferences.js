// Apply the saved theme before styles paint. Storage can be disabled by the browser.
(() => {
  let theme;
  try { theme = localStorage.getItem('tplus-theme'); } catch {}
  document.documentElement.dataset.theme = ['light', 'dark'].includes(theme)
    ? theme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
})();
