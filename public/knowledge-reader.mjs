export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function action(text, callback) {
  const button = element('button', text);
  button.type = 'button';
  button.onclick = callback;
  return button;
}
export function link(text, href) {
  const node = element('a', text);
  node.href = href;
  return node;
}
export function readerBar(title, controls) {
  const bar = element('header', null, 'knowledge-reader-bar');
  const tools = element('div', null, 'knowledge-actions');
  tools.append(...controls);
  bar.append(element('h3', title || '无标题知识'), tools);
  return bar;
}
export function restoreReading(control) {
  control?.focus({ preventScroll: true });
  control?.scrollIntoView({ block: 'nearest' });
}
export async function readJson(url, method = 'GET', payload) {
  const response = await fetch(url, {
    method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || '暂时无法读取资料，请重试');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

let activeMenu, listening = false;
export function closeToolMenu(focus = false) {
  if (!activeMenu) return;
  const { menu, trigger } = activeMenu;
  activeMenu = undefined;
  menu.open = false;
  if (focus) trigger.focus({ preventScroll: true });
}
export function toolsMenu(label, controls, className = '') {
  listenForToolMenuDismissal();
  const menu = element('details', null, 'topic-menu ' + className);
  const trigger = element('summary', label);
  const panel = element('div', null, 'topic-menu-items');
  panel.append(...controls);
  trigger.onclick = event => {
    event.preventDefault();
    const wasOpen = activeMenu?.menu === menu;
    closeToolMenu();
    if (!wasOpen) {
      menu.open = true;
      activeMenu = { menu, trigger };
    }
  };
  panel.addEventListener('click', event => {
    // Capture before a menu action opens another dialog or replaces its block.
    if (event.target.closest('button,a')) closeToolMenu(true);
  }, { capture: true });
  menu.append(trigger, panel);
  return menu;
}
function listenForToolMenuDismissal() {
  if (listening) return;
  listening = true;
  document.addEventListener('click', event => {
    if (activeMenu && !activeMenu.menu.contains(event.target)) closeToolMenu();
  }, { capture: true });
  document.addEventListener('focusin', event => {
    if (activeMenu && !activeMenu.menu.contains(event.target)) closeToolMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !activeMenu) return;
    event.preventDefault();
    closeToolMenu(true);
  });
  window.addEventListener('pagehide', () => closeToolMenu());
}
