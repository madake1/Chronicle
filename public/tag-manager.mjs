function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, action, className) {
  const node = element('button', text, className);
  node.type = 'button';
  node.onclick = action;
  return node;
}

export function createTagManager(dialog, { paths, changeTag }) {
  const search = dialog.querySelector('#tag-management-search');
  const editor = dialog.querySelector('#tag-management-editor');
  const tree = dialog.querySelector('#tag-management-tree');
  const status = dialog.querySelector('#tag-management-status');
  const actions = dialog.querySelector('#tag-management-actions');
  const selection = dialog.querySelector('#tag-management-selection');
  const path = dialog.querySelector('#tag-management-path');
  const count = dialog.querySelector('#tag-management-count');
  const empty = dialog.querySelector('#tag-management-empty');
  const rootButton = dialog.querySelector('#new-root-tag');
  const closeButton = dialog.querySelector('#tag-management-close');
  const back = dialog.querySelector('#tag-management-back');
  const narrow = matchMedia('(max-width: 700px)');
  const collapsed = new Set();
  let selected = null;
  let busy = false;
  let formDirty = () => false;
  let returnControl, pendingReveal = false;
  selection.tabIndex = -1;

  const canLeave = () => !busy && (!formDirty() || confirm('放弃尚未保存的标签修改？'));

  function showDetails() {
    dialog.dataset.pane = 'detail';
    if (narrow.matches) selection.focus({ preventScroll: true });
  }

  function clearForm() {
    editor.replaceChildren();
    formDirty = () => false;
    syncSelection();
  }

  function selectedControl() {
    return selected ? tree.querySelector(`[data-tag="${CSS.escape(selected)}"]`) : null;
  }

  function revealSelected(tags) {
    const byId = new Map(tags.map(tag => [tag.id, tag]));
    for (let id = byId.get(selected)?.parentId; id; id = byId.get(id)?.parentId) collapsed.delete(id);
  }

  function close() {
    if (canLeave()) dialog.close();
  }
  closeButton.onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  back.onclick = () => {
    if (!canLeave()) return;
    clearForm();
    dialog.dataset.pane = 'tree';
    render();
    const current = selectedControl();
    if (current?.getClientRects().length) {
      current.focus({ preventScroll: true });
      if (pendingReveal) current.scrollIntoView({ block: 'nearest' });
    }
    else search.focus({ preventScroll: true });
    pendingReveal = false;
  };

  function syncSelection(tags = paths()) {
    const tag = tags.find(item => item.id === selected);
    const editing = editor.childElementCount > 0;
    actions.hidden = !tag || editing;
    empty.hidden = Boolean(tag) || editing;
    selection.textContent = tag?.name ?? '';
    path.textContent = tag?.path ?? '';
    count.textContent = tag ? `${tag.count} 条知识 · 直接关联 ${tag.directCount} 条` : '';
    for (const control of tree.querySelectorAll('.tag-management-name')) {
      control.setAttribute('aria-pressed', String(control.dataset.tag === selected));
    }
  }

  function render() {
    const tags = paths();
    const byId = new Map(tags.map(tag => [tag.id, tag]));
    const groups = new Map();
    for (const tag of tags) {
      if (!groups.has(tag.parentId)) groups.set(tag.parentId, []);
      groups.get(tag.parentId).push(tag);
    }
    const query = search.value.trim().toLowerCase();
    const visible = new Set();
    if (query) {
      for (const tag of tags) {
        if (!tag.path.toLowerCase().includes(query)) continue;
        for (let current = tag; current && !visible.has(current.id); current = byId.get(current.parentId)) {
          visible.add(current.id);
        }
      }
    }
    function level(parentId) {
      const list = element('ul', undefined, 'tag-management-level');
      for (const tag of groups.get(parentId) ?? []) {
        if (query && !visible.has(tag.id)) continue;
        const item = element('li');
        const row = element('div', undefined, 'tag-management-row');
        const select = button(tag.name, () => {
          if (selected !== tag.id) {
            if (!canLeave()) return;
            selected = tag.id;
            clearForm();
          }
          showDetails();
        }, 'tag-management-name');
        select.dataset.tag = tag.id;
        select.setAttribute('aria-pressed', String(selected === tag.id));
        const count = element('span', String(tag.count), 'tag-count');
        count.setAttribute('aria-label', `${tag.count} 条知识`);
        let children;
        if ((groups.get(tag.id) ?? []).some(child => !query || visible.has(child.id))) {
          children = level(tag.id);
          children.id = `managed-children-${tag.id}`;
          children.hidden = !query && collapsed.has(tag.id);
          const toggle = button('', () => {
            children.hidden = !children.hidden;
            if (!query) {
              if (children.hidden) collapsed.add(tag.id);
              else collapsed.delete(tag.id);
            }
            syncToggle();
          }, 'tag-management-toggle');
          toggle.setAttribute('aria-controls', children.id);
          function syncToggle() {
            toggle.textContent = children.hidden ? '▸' : '▾';
            toggle.setAttribute('aria-expanded', String(!children.hidden));
            toggle.setAttribute('aria-label', `${children.hidden ? '展开' : '折叠'}${tag.name}的子标签`);
          }
          syncToggle();
          row.append(toggle);
        }
        row.append(select, count);
        item.append(row);
        if (children) item.append(children);
        list.append(item);
      }
      return list;
    }
    const list = level(null);
    const scroll = tree.scrollTop;
    tree.replaceChildren(list.childElementCount ? list : element('p', query ? '没有匹配的标签' : '暂无标签', 'meta'));
    tree.scrollTop = scroll;
    syncSelection(tags);
  }

  async function save(id, method, payload) {
    if (busy) return;
    busy = true;
    const form = editor.querySelector('form');
    const controls = [...form.querySelectorAll('button, input')];
    for (const control of controls) control.disabled = true;
    const errorBox = form.querySelector('[role=alert]');
    errorBox.textContent = '';
    try {
      const result = await changeTag(id, method, payload);
      selected = method === 'DELETE' ? result.parentId : result.id;
      revealSelected(paths());
      search.value = '';
      clearForm();
      render();
      status.textContent = method === 'DELETE' ? '标签已删除，知识分类已更新' : '标签已保存';
      const current = selectedControl();
      if (!narrow.matches && current?.getClientRects().length) {
        current.focus({ preventScroll: true });
        current.scrollIntoView({ block: 'nearest' });
      } else if (selected) { pendingReveal = true; showDetails(); }
      else rootButton.focus({ preventScroll: true });
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      busy = false;
      for (const control of controls) control.disabled = false;
    }
  }

  function makeForm(label, submitText) {
    const form = element('form', undefined, 'tag-management-form');
    const error = element('p');
    error.setAttribute('role', 'alert');
    const actions = element('div', undefined, 'knowledge-actions');
    const submit = element('button', submitText, 'primary');
    submit.type = 'submit';
    actions.append(button('取消', () => {
      if (busy) return;
      clearForm();
      if (returnControl?.getClientRects().length) returnControl.focus({ preventScroll: true });
      else if (selected) showDetails();
      else rootButton.focus({ preventScroll: true });
    }), submit);
    form.append(element('h3', label), error, actions);
    editor.replaceChildren(form);
    showDetails();
    syncSelection();
    editor.parentElement.scrollTop = 0;
    status.textContent = '';
    return { form, error };
  }

  function showEditor(operation, tag, tags = []) {
    if (!canLeave()) return;
    returnControl = document.activeElement;
    const moving = operation === 'move';
    const renaming = operation === 'rename';
    const editing = moving || renaming;
    const label = moving ? `移动「${tag.name}」` : renaming ? `重命名「${tag.name}」` :
      tag ? `在「${tag.name}」下新建标签` : '新建顶级标签';
    const { form, error } = makeForm(label, moving ? '确认移动' : '保存');
    let parentId = editing ? tag.parentId : tag?.id ?? null;
    let input;
    if (moving) {
      const byId = new Map(tags.map(item => [item.id, item]));
      const allowed = tags.filter(item => {
        for (let current = item; current; current = byId.get(current.parentId)) {
          if (current.id === tag.id) return false;
        }
        return true;
      });
      input = element('input');
      input.type = 'search';
      input.placeholder = '搜索可选上级标签';
      input.setAttribute('aria-label', '搜索可选上级标签');
      const choices = element('div', undefined, 'tag-parent-options');
      const selectedParent = element('p', '', 'meta');
      function showChoices() {
        const query = input.value.trim().toLowerCase();
        selectedParent.textContent = `目标位置 · ${byId.get(parentId)?.path ?? '顶层'}`;
        const matches = allowed.filter(item => item.path.toLowerCase().includes(query));
        const destinations = [{ id: null, path: '顶层（无上级）' }, ...matches];
        choices.replaceChildren(...destinations.map(item => {
          const control = button(item.path, () => {
            parentId = item.id;
            showChoices();
            choices.querySelector('[aria-pressed=true]')?.focus();
          });
          control.setAttribute('aria-pressed', String(item.id === parentId));
          return control;
        }));
        if (!matches.length && query) choices.append(element('p', '没有匹配的上级标签', 'meta'));
      }
      input.oninput = showChoices;
      error.before(input, selectedParent, choices);
      showChoices();
    } else {
      const field = element('label', '标签名称');
      input = element('input');
      input.required = true;
      input.maxLength = 100;
      if (renaming) input.value = tag.name;
      field.append(input);
      error.before(field);
    }
    const priorValue = input.value;
    formDirty = () => moving ? parentId !== tag.parentId : input.value !== priorValue;
    form.onsubmit = event => {
      event.preventDefault();
      const payload = moving ? { parentId } : renaming ? { name: input.value } : { name: input.value, parentId };
      void save(editing ? tag.id : '', editing ? 'PUT' : 'POST', payload);
    };
    input.focus();
  }

  function showDelete(tag, parent) {
    if (!canLeave()) return;
    formDirty = () => false;
    returnControl = document.activeElement;
    const { form, error } = makeForm(`删除「${tag.name}」？`, '确认删除');
    const impact = parent
      ? `${tag.directCount} 条直接关联的知识将继承「${parent.name}」，重复归类只保留一次。直属子标签将移到「${parent.name}」下。`
      : `${tag.directCount} 条直接关联的知识将移除该标签。没有其他标签的知识会进入「无标签」。直属子标签将提升为顶级标签。`;
    error.before(element('p', impact), element('p', '其他标签、知识正文、附件和关联条目均保留。', 'meta'));
    form.onsubmit = event => {
      event.preventDefault();
      void save(tag.id, 'DELETE');
    };
    form.querySelector('button').focus();
  }

  rootButton.onclick = () => showEditor('root', null);
  for (const control of actions.querySelectorAll('[data-tag-action]')) {
    control.onclick = () => {
      const tags = paths();
      const tag = tags.find(item => item.id === selected);
      if (!tag || busy) return;
      const operation = control.dataset.tagAction;
      if (operation === 'delete') showDelete(tag, tags.find(item => item.id === tag.parentId));
      else showEditor(operation, tag, tags);
    };
  }
  search.oninput = () => {
    if (narrow.matches && dialog.dataset.pane === 'detail') {
      if (!canLeave()) return;
      clearForm();
      dialog.dataset.pane = 'tree';
    }
    render();
  };
  return {
    open() {
      search.value = '';
      clearForm();
      dialog.dataset.pane = 'tree';
      status.textContent = '';
      render();
      dialog.showModal();
      search.focus();
    },
  };
}
