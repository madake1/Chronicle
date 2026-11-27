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
