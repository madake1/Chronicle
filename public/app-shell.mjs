export const navigation = [
  ['/', '作品库'], ['/knowledge', '知识库'], ['/spacetime', '个人时空'], ['/atlas', '历史时空'],
];

if (typeof document !== 'undefined') {
  const header = document.querySelector('[data-app-shell]');
  const root = document.documentElement;
  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = '/';
  brand.textContent = 'Chronicle';
  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', '主导航');
  for (const [href, title] of navigation) {
    const link = document.createElement('a');
    link.className = 'nav-link';
    link.href = href;
    link.textContent = title;
    if (location.pathname === href) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'theme';
  toggle.className = 'quiet';
  toggle.textContent = '切换主题';
  toggle.setAttribute('aria-label', '深色主题');
  const system = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme(theme = localStorage.getItem('chronicle-theme')) {
    root.dataset.theme = theme || (system.matches ? 'dark' : 'light');
    toggle.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
  }
  toggle.onclick = () => {
    const value = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('chronicle-theme', value);
    applyTheme(value);
  };
  window.addEventListener('storage', event => {
    if (event.key === 'chronicle-theme' || event.key === null) applyTheme();
  });
  window.addEventListener('pageshow', () => applyTheme());
  system.addEventListener('change', () => applyTheme());
  applyTheme();
  header.append(brand, nav, toggle);
}
