import { noteRequest } from './note-dialog.mjs';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function json(path, method = 'GET') {
  return (await noteRequest(path, { method })).json();
}

export function workKnowledgeSection(work) {
  const endpoint = `/api/knowledge/works/${encodeURIComponent(work.id)}`;
  const section = element('section', undefined, 'detail-section work-knowledge');
  const heading = element('h3', '关联知识');
  const status = element('p', '', 'meta');
  status.setAttribute('role', 'status');
  const entries = element('div');
  const picker = element('form');
  picker.hidden = true;
  const label = element('label', '查找知识');
  const search = element('input');
  search.type = 'search';
  label.append(search);
  const matches = element('select');
  matches.setAttribute('aria-label', '待添加的知识');
  const save = element('button', '添加');
  save.type = 'submit';
  const toggle = element('button', '添加关联');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  picker.append(label, matches, save);
  section.append(heading, entries, toggle, picker, status);
  let related = [];
  let queryVersion = 0;
  let timer;
  const showError = error => { status.textContent = error.message; };

  function render() {
    heading.textContent = `关联知识（${related.length}）`;
    entries.replaceChildren(...related.map(note => {
      const item = element('details');
      const summary = element('summary', note.title || note.excerpt || '无标题知识');
      const preview = element('article', undefined, 'note-preview');
      const link = element('a', '打开详情');
      link.href = `/knowledge?note=${encodeURIComponent(note.id)}`;
      const remove = element('button', '移除关联');
      remove.type = 'button';
      remove.onclick = async () => {
        remove.disabled = true;
        try {
          await update(note.id, 'DELETE');
          if (!picker.hidden) await searchNotes();
        } catch (error) { showError(error); remove.disabled = false; }
      };
      let loaded = false;
      item.addEventListener('toggle', async () => {
        if (!item.open || loaded) return;
        try {
          const result = await json(`/api/knowledge/${encodeURIComponent(note.id)}`);
          preview.innerHTML = result.html;
          loaded = true;
        } catch (error) {
          if (item.isConnected) {
            await refresh().catch(showError);
            showError(error);
          }
        }
      });
      item.append(summary, preview, link, remove);
      return item;
    }));
    if (!related.length) entries.append(element('p', '暂无关联知识', 'meta'));
  }
  async function refresh() {
    ({ related } = await json(endpoint));
    if (section.isConnected) render();
  }
  async function update(id, method) {
    ({ related } = await json(`${endpoint}/${encodeURIComponent(id)}`, method));
    status.textContent = '';
    render();
  }
  async function searchNotes() {
    const version = ++queryVersion;
    save.disabled = true;
    const query = new URLSearchParams({ q: search.value });
    const { notes } = await json(`/api/knowledge?${query}`);
    if (version !== queryVersion) return;
    const linked = new Set(related.map(note => note.id));
    const options = notes.filter(note => !linked.has(note.id)).map(note => new Option(note.title || note.excerpt, note.id));
    matches.replaceChildren(...(options.length ? options : [new Option('没有可添加的知识', '')]));
    save.disabled = !options.length;
  }
  toggle.onclick = () => {
    picker.hidden = !picker.hidden;
    toggle.setAttribute('aria-expanded', String(!picker.hidden));
    if (!picker.hidden) {
      search.focus();
      void searchNotes().catch(showError);
    }
  };
  search.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void searchNotes().catch(showError), 150);
  };
  picker.onsubmit = async event => {
    event.preventDefault();
    if (!matches.value || save.disabled) return;
    save.disabled = true;
    try {
      await update(matches.value, 'PUT');
      picker.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    } catch (error) { showError(error); save.disabled = false; }
  };
  section.addEventListener('focusin', event => {
    if (!event.relatedTarget || section.contains(event.relatedTarget)) return;
    void json(endpoint).then(({ related: current }) => {
      if (section.isConnected && JSON.stringify(current) !== JSON.stringify(related)) {
        related = current;
        render();
      }
    }).catch(showError);
  });
  void refresh().catch(showError);
  return section;
}
