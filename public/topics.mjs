import { action, element, link, readerBar, readJson, restoreReading } from './knowledge-reader.mjs';

const api = '/api/topics';
export function topicHref(topic, article, block) {
  const params = new URLSearchParams({ section: 'topics' });
  if (topic) params.set('topic', topic);
  if (article) params.set('article', article);
  if (block) params.set('block', block);
  return '/knowledge?' + params;
}

const noteTitle = note => note.title || note.excerpt || '无标题知识';
const labeled = (text, control) => {
  const label = element('label', text);
  label.append(control);
  return label;
};

function dialog(title, canClose = () => true) {
  const pane = element('dialog', null, 'topic-dialog');
  const heading = element('div', null, 'dialog-head');
  const label = element('h2', title);
  label.id = 'dialog-' + crypto.randomUUID();
  pane.setAttribute('aria-labelledby', label.id);
  heading.append(label, action('关闭', () => { if (canClose()) pane.close(); }));
  pane.append(heading);
  pane.addEventListener('cancel', event => { if (!canClose()) event.preventDefault(); });
  pane.addEventListener('close', () => pane.remove(), { once: true });
  document.body.append(pane);
  return pane;
}

function picker(type, onPick, createKnowledge) {
  const knowledge = type === 'knowledge';
  const pane = dialog(knowledge ? '选择知识' : '选择作品');
  const search = element('input');
  search.type = 'search';
  search.placeholder = knowledge ? '搜索标题或正文' : '搜索作品名称';
  search.setAttribute('aria-label', search.placeholder);
  const results = element('div', null, 'topic-picker-results');
  const status = element('p', '', 'meta');
  status.setAttribute('role', 'status');
  let sequence = 0, timer;
  async function load() {
    const revision = ++sequence;
    results.replaceChildren();
    status.textContent = '正在搜索…';
    try {
      const matches = await readJson('/api/knowledge/targets?' + new URLSearchParams({ q: search.value, type }));
      if (revision !== sequence || !pane.open) return;
      status.textContent = matches.length ? (matches.length === 40 ? '显示前 40 项，可输入关键词缩小范围。' : '') : '没有匹配条目';
      results.append(...matches.map(item => action(noteTitle(item), () => { pane.close(); onPick(item); })));
    } catch (error) { if (revision === sequence) status.textContent = error.message; }
  }
  search.oninput = () => { ++sequence; results.replaceChildren(); clearTimeout(timer); timer = setTimeout(load, 140); };
  pane.append(search, status, results);
  if (createKnowledge) pane.append(action('新建并引用知识', () => {
    pane.close();
    createKnowledge(null, onPick);
  }));
  pane.showModal();
  void load();
}

export async function chooseArticle(knowledgeId, onSaved) {
  const pane = dialog('加入专题文章');
  const status = element('p', '', 'meta');
  status.setAttribute('role', 'status');
  const topics = element('select');
  const articles = element('select');
  const save = action('添加引用', async () => {
    save.disabled = true;
    try {
      const result = await readJson(api + '/' + topics.value + '/articles/' + articles.value + '/references', 'POST',
        { knowledgeId, version });
      pane.close();
      onSaved?.(topicHref(topics.value, articles.value, result.id));
    } catch (error) { status.textContent = error.message; }
  });
  save.disabled = true;
  let version, request = 0;
  async function loadArticles() {
    const current = ++request;
    articles.replaceChildren();
    save.disabled = true;
    try {
      const topic = await readJson(api + '/' + topics.value);
      if (current !== request || !pane.open) return;
      articles.replaceChildren(...topic.articles.map(item => new Option(item.title, item.id)));
      version = topic.version;
      save.disabled = !topic.articles.length;
      status.textContent = topic.articles.length ? '' : '该专题还没有文章。';
    } catch (error) { if (current === request) status.textContent = error.message; }
  }
  topics.onchange = loadArticles;
  pane.append(labeled('专题', topics), labeled('文章', articles), save, status);
  pane.showModal();
  try {
    const result = await readJson(api);
    if (!pane.open) return;
    topics.append(...result.topics.map(item => new Option(item.title, item.id)));
    if (result.topics.length) await loadArticles();
    else status.textContent = '请先在知识专题中新建专题与文章。';
  } catch (error) { status.textContent = error.message; }
}

export async function mountTopics(root, params, editKnowledge) {
  const topicId = params.get('topic');
  const articleId = params.get('article');
  const blockId = params.get('block');
  const endpoint = api + (topicId ? '/' + encodeURIComponent(topicId) : '');
  const articleEndpoint = endpoint + '/articles/' + encodeURIComponent(articleId ?? '');
  let topic, dirty = false, busy = false, editorObserver;
  const status = element('p', '', 'topic-status');
  status.setAttribute('role', 'alert');
  const report = error => { status.textContent = error.message; };
  const body = element('div');
  root.append(status, body);
  const backToShelf = () => {
    const control = link('← 返回专题书架', topicHref());
    control.className = 'topic-back';
    return control;
  };

  let activeMenu;
  function closeMenu(focus = false) {
    if (!activeMenu) return;
    const { menu, trigger } = activeMenu;
    activeMenu = undefined;
    menu.open = false;
    if (focus) trigger.focus({ preventScroll: true });
  }
  function toolsMenu(label, controls, className = '') {
    const menu = element('details', null, 'topic-menu ' + className);
    const trigger = element('summary', label);
    const panel = element('div', null, 'topic-menu-items');
    panel.append(...controls);
    trigger.onclick = event => {
      event.preventDefault();
      const wasOpen = activeMenu?.menu === menu;
      closeMenu();
      if (!wasOpen) {
        menu.open = true;
        activeMenu = { menu, trigger };
      }
    };
    panel.addEventListener('click', event => {
      // Capture before a menu action opens another dialog or replaces its block.
      if (event.target.closest('button,a')) closeMenu(true);
    }, { capture: true });
    menu.append(trigger, panel);
    return menu;
  }
  document.addEventListener('click', event => {
    if (activeMenu && !activeMenu.menu.contains(event.target)) closeMenu();
  }, { capture: true });
  document.addEventListener('focusin', event => {
    if (activeMenu && !activeMenu.menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !activeMenu) return;
    event.preventDefault();
    closeMenu(true);
  });
  window.addEventListener('pagehide', () => closeMenu());

  window.addEventListener('beforeunload', event => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  async function mutate(url, method, data, complete) {
    if (busy) return;
    busy = true;
    status.textContent = '';
    try {
      const result = await readJson(url, method, data);
      await complete(result);
    } catch (error) { report(error); }
    finally { busy = false; }
  }

  const navigate = (topic, article, block) => { dirty = false; location.href = topicHref(topic, article, block); };

  function topicForm(existing) {
    let changed = false;
    const pane = dialog(existing ? '编辑专题' : '新建专题',
      () => !changed || confirm('放弃未保存的专题修改？'));
    const warn = event => {
      if (!changed) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    pane.addEventListener('close', () => window.removeEventListener('beforeunload', warn), { once: true });
    const title = element('input');
    title.maxLength = 180;
    title.required = true;
    title.value = existing?.title ?? '';
    const overview = element('textarea');
    overview.rows = 5;
    overview.value = existing?.overview ?? '';
    const cover = element('select');
    cover.append(new Option('蕨绿','fern'), new Option('石灰','stone'), new Option('赭褐','umber'));
    cover.value = existing?.cover ?? 'fern';
    const works = new Map((existing?.works ?? []).map(item => [item.id, item]));
    const workList = element('div', null, 'topic-tools');
    function renderWorks() {
      workList.replaceChildren(...[...works.values()].map(item => action(
        (item.title || '已删除作品') + ' ×', () => { works.delete(item.id); changed = true; renderWorks(); })));
    }
    const form = element('form', null, 'topic-form');
    const notice = element('p', '', 'topic-status');
    notice.setAttribute('role', 'alert');
    const save = element('button', '保存专题', 'primary');
    form.append(labeled('专题名称', title), labeled('简介（Markdown，可选）', overview), labeled('封面色', cover),
      action('关联作品', () => picker('work', item => { works.set(item.id, item); changed = true; renderWorks(); })), workList, notice, save);
    renderWorks();
    form.oninput = () => { changed = true; };
    form.onsubmit = async event => {
      event.preventDefault();
      save.disabled = true;
      try {
        const result = await readJson(endpoint, existing ? 'PUT' : 'POST', { title: title.value, overview: overview.value,
          cover: cover.value, workIds: [...works.keys()], version: existing?.version });
        changed = false;
        pane.close();
        navigate(result.id, articleId);
      } catch (error) { notice.textContent = error.message; }
      finally { save.disabled = false; }
    };
    pane.append(form);
    pane.showModal();
  }

  async function shelf() {
    const header = element('div', null, 'topic-heading');
    const search = element('input');
    search.type = 'search';
    search.placeholder = '搜索专题名称或简介';
    search.setAttribute('aria-label', search.placeholder);
    header.append(element('h1', '知识专题'), search, action('＋ 新建专题', () => topicForm()));
    const grid = element('div', null, 'topic-shelf');
    body.replaceChildren(header, grid);
    const { topics } = await readJson(api);
    function render() {
      const query = search.value.trim().toLowerCase();
      const matches = topics.filter(item => (item.title + ' ' + item.overview).toLowerCase().includes(query));
      grid.replaceChildren(...matches.map(item => {
        const card = link('', topicHref(item.id));
        card.className = 'topic-card';
        card.dataset.cover = item.cover;
        const cover = element('span', '', 'topic-cover');
        cover.setAttribute('aria-hidden', 'true');
        card.append(cover, element('h2', item.title), element('p', item.overview || '', 'topic-card-overview'),
          element('small', `${item.articles} 篇文章 · ${item.knowledge} 条知识`, 'meta'));
        return card;
      }));
      if (!matches.length) grid.append(element('p', query ? '没有匹配的专题。' : '还没有专题，可以从一篇文章开始。', 'meta'));
    }
    search.oninput = render;
    render();
  }

  function reference(block) {
    const wrapper = element('section', null, 'topic-reference');
    if (block.id) wrapper.id = 'reference-' + block.id;
    const owner = '/knowledge?note=' + encodeURIComponent(block.knowledgeId);
    const label = block.title || block.hint || '无标题知识';
    if (block.deleted) {
      wrapper.append(element('p', '原始知识已删除', 'reference-missing'), element('small', block.hint || '无标题知识', 'meta'));
      return wrapper;
    }
    const open = action(label, () => expand(true));
    open.className = 'reference-toggle';
    open.setAttribute('aria-label', '展开 · ' + label);
    const content = element('div', null, 'reference-reader');
    content.hidden = true;
    open.setAttribute('aria-expanded', 'false');
    const collapse = () => {
      content.hidden = true;
      open.hidden = false;
      open.setAttribute('aria-expanded', 'false');
      restoreReading(open);
    };
    let request = 0;
    async function expand(focus = false) {
      const revision = ++request;
      open.hidden = true;
      open.setAttribute('aria-expanded', 'true');
      content.hidden = false;
      const close = action('收起', () => { ++request; collapse(); });
      const initial = readerBar(label, [close]);
      content.replaceChildren(initial, element('p', '正在读取原始知识…', 'meta'));
      if (focus) close.focus({ preventScroll: true });
      try {
        const note = await readJson('/api/knowledge/' + encodeURIComponent(block.knowledgeId));
        if (revision !== request) return;
        open.textContent = noteTitle(note);
        open.setAttribute('aria-label', '展开 · ' + noteTitle(note));
        const bar = readerBar(noteTitle(note), [link('打开原条目', owner),
          action('编辑原知识', () => editKnowledge(note, () => expand())), close]);
        const markdown = element('article', null, 'note-preview');
        markdown.innerHTML = note.html;
        const tagNames = note.tagIds.map(id => topic.tags.find(tag => tag.id === id)?.name).filter(Boolean);
        content.replaceChildren(bar);
        if (tagNames.length) content.append(element('p', tagNames.join(' · '), 'meta'));
        content.append(markdown);
        if (focus) close.focus({ preventScroll: true });
      } catch (error) {
        if (revision !== request) return;
        if (error.status === 404) {
          try {
            await readJson('/api/knowledge/' + encodeURIComponent(block.knowledgeId) + '/topics');
          } catch (lookup) {
            if (revision !== request) return;
            if (lookup.status === 404) {
              content.replaceChildren(initial, element('p', '原始知识已删除', 'reference-missing'));
              return;
            }
          }
        }
        if (revision !== request) return;
        content.replaceChildren(initial, element('p', '原始知识暂时无法读取。', 'meta'), action('重试', () => expand(true)));
      }
    }
    wrapper.append(open, content);
    if (block.id && block.id === blockId) {
      queueMicrotask(() => { wrapper.scrollIntoView({ block: 'start' }); void expand(true); });
    }
    return wrapper;
  }

  function enterEditor(container, article) {
    const units = article.blocks.map(block => block.type === 'markdown'
      ? { id: block.id, type: block.type, markdown: block.markdown }
      : { id: block.id, type: block.type, knowledgeId: block.knowledgeId, hint: block.title ?? block.hint, deleted: block.deleted });
    const title = element('input');
    title.value = article.title;
    title.maxLength = 180;
    title.setAttribute('aria-label', '文章标题');
    title.className = 'draft-title';
    const paper = element('div', null, 'draft-paper');
    const state = element('span', '未修改', 'meta');
    state.setAttribute('role', 'status');
    const savedScroll = window.scrollY;
    const views = new Map();
    function changed() { dirty = true; state.textContent = '有未保存的修改'; }
    title.oninput = changed;

    function focusUnit(index) {
      const focus = units[index] ? views.get(units[index].id)?.target :
        paper.querySelector('.draft-gap summary');
      restoreReading(focus);
    }
    function makeUnit(block) {
      const unit = element('section', null, 'editor-unit');
      unit.dataset.blockId = block.id;
      const move = direction => {
        const index = units.indexOf(block);
        const next = index + direction;
        [units[index], units[next]] = [units[next], units[index]];
        changed();
        renderBlocks(next);
      };
      const up = action('上移', () => move(-1)), down = action('下移', () => move(1));
      const remove = action('移除', () => {
        const index = units.indexOf(block);
        units.splice(index, 1);
        views.delete(block.id);
        changed();
        renderBlocks(Math.min(index, units.length - 1));
      });
      const controls = [up, down, remove];
      let target;
      if (block.type === 'markdown') {
        const input = element('textarea');
        input.rows = 1;
        input.value = block.markdown;
        input.placeholder = '写下正文（Markdown）';
        input.oninput = () => { block.markdown = input.value; changed(); resizeDraft(input); };
        unit.append(input);
        target = input;
      } else {
        unit.classList.add('editor-reference');
        const label = element('span');
        function labelReference() {
          label.textContent = block.deleted ? '原始知识已删除 · ' + (block.hint || '无标题知识') : block.hint || '无标题知识';
        }
        labelReference();
        unit.append(label);
        controls.unshift(action('替换引用', () => picker('knowledge', item => {
          Object.assign(block, { knowledgeId: item.id, hint: item.title || '', deleted: false });
          labelReference();
          changed();
          restoreReading(target);
        }, editKnowledge)));
      }
      const menu = toolsMenu('⋯', controls, 'draft-block-menu');
      unit.append(menu);
      const trigger = menu.querySelector('summary');
      target ??= trigger;
      return { node: unit, target, menu: trigger, up, down };
    }
    function resizeDraft(input) {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    }
    function insert(index, block) {
      units.splice(index, 0, { id: crypto.randomUUID(), ...block });
      changed();
      renderBlocks(index);
    }
    function gap(index) {
      const menu = toolsMenu('＋', [
        action('插入 Markdown 正文', () => insert(index, { type: 'markdown', markdown: '' })),
        action('插入知识引用', () => picker('knowledge', item => insert(index, {
          type: 'knowledge', knowledgeId: item.id, hint: item.title || '',
        }), editKnowledge)),
      ], 'draft-gap');
      menu.querySelector('summary').setAttribute('aria-label', '在位置 ' + (index + 1) + ' 插入内容');
      return menu;
    }
    function renderBlocks(focusIndex) {
      closeMenu();
      const next = [];
      units.forEach((block, index) => {
        if (!views.has(block.id)) views.set(block.id, makeUnit(block));
        const { node, target, menu, up, down } = views.get(block.id);
        up.disabled = index === 0;
        down.disabled = index === units.length - 1;
        menu.setAttribute('aria-label', '第 ' + (index + 1) + ' 块操作');
        if (block.type === 'markdown') target.setAttribute('aria-label', 'Markdown 正文 ' + (index + 1));
        next.push(gap(index), node);
      });
      next.push(gap(units.length));
      paper.replaceChildren(...next);
      for (const input of paper.querySelectorAll('textarea')) resizeDraft(input);
      if (focusIndex !== undefined) focusUnit(Math.max(0, focusIndex));
    }

    const tools = element('div', null, 'topic-tools article-edit-tools');
    const save = action('保存文章', () => mutate(articleEndpoint, 'PUT', { version: topic.version, title: title.value,
      blocks: units.map(({ deleted, ...block }) => block) }, () => navigate(topicId, articleId, blockId)));
    save.className = 'primary';
    tools.append(state, save, action('取消编辑', () => {
      if (dirty && !confirm('放弃未保存的修改？')) return;
      dirty = false;
      renderDetail();
      window.scrollTo(0, savedScroll);
    }));
    container.classList.add('topic-editing');
    status.textContent = '';
    closeMenu();
    tools.append(status);
    container.replaceChildren(tools, title, paper);
    renderBlocks();
    let paperWidth = 0;
    const resize = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === paperWidth) return;
      paperWidth = entry.contentRect.width;
      for (const input of paper.querySelectorAll('textarea')) resizeDraft(input);
    });
    resize.observe(paper, { box: 'border-box' });
    // The observer only needs the available width, and is disconnected on cancel.
    editorObserver?.disconnect();
    editorObserver = resize;
    title.focus({ preventScroll: true });
    tools.scrollIntoView({ block: 'nearest' });
  }

  function renderDetail() {
    editorObserver?.disconnect();
    closeMenu();
    root.prepend(status);
    const layout = element('div', null, 'topic-layout');
    const side = element('aside', null, 'panel topic-index');
    const index = element('details');
    index.open = !matchMedia('(max-width: 700px)').matches;
    const directoryLabel = element('summary', topic.title);
    directoryLabel.setAttribute('aria-label', topic.title + '的文章目录');
    index.append(directoryLabel);
    const links = element('ol');
    for (const item of topic.articles) {
      const row = element('li');
      const itemLink = link(item.title, topicHref(topic.id, item.id));
      if (item.id === articleId) itemLink.setAttribute('aria-current', 'page');
      row.append(itemLink);
      links.append(row);
    }
    const overviewItem = element('li');
    const overviewLink = link('专题概述', topicHref(topic.id));
    if (!articleId) overviewLink.setAttribute('aria-current', 'page');
    overviewItem.append(overviewLink);
    links.prepend(overviewItem);
    index.append(links);
    index.append(action('＋ 新建文章', () => {
      if (dirty && !confirm('放弃未保存的修改？')) return;
      const pane = dialog('新建文章');
      const form = element('form', null, 'topic-form');
      const title = element('input');
      title.required = true;
      title.maxLength = 180;
      form.append(labeled('文章标题', title), element('button', '创建空文章', 'primary'));
      form.onsubmit = event => {
        event.preventDefault();
        void mutate(endpoint + '/articles', 'POST', { title: title.value, version: topic.version }, result => {
          pane.close();
          navigate(topicId, result.id);
        }).then(() => {
          if (pane.open && status.textContent) {
            const feedback = element('p', status.textContent, 'topic-status');
            pane.append(feedback);
          }
        });
      };
      pane.append(form);
      pane.showModal();
    }));
    side.append(backToShelf(), index);
    const reading = element('section', null, 'panel topic-reading');
    const header = element('header', null, 'reading-heading');
    const toolbar = element('div', null, 'topic-tools reading-tools');
    const scope = new URLSearchParams({ topic: topic.id });
    if (articleId) scope.set('article', articleId);
    const spaceLink = link('在个人时空中查看', '/spacetime?' + scope);
    toolbar.append(spaceLink);
    if (topic.article) {
      const article = topic.article;
      const order = topic.articles.map(item => item.id);
      const at = order.indexOf(article.id);
      function reorder(direction) {
        const updated = [...order];
        [updated[at], updated[at + direction]] = [updated[at + direction], updated[at]];
        void mutate(endpoint + '/order', 'PUT', { version: topic.version, articleIds: updated }, () => navigate(topicId, articleId));
      }
      const earlier = action('目录上移', () => reorder(-1));
      const later = action('目录下移', () => reorder(1));
      earlier.disabled = at === 0;
      later.disabled = at === order.length - 1;
      const deletion = action('删除文章', () => {
        if (confirm('删除这篇文章及其中的引用？原始知识会保留。')) {
          void mutate(articleEndpoint, 'DELETE', { version: topic.version }, () => navigate(topicId));
        }
      });
      deletion.className = 'topic-danger';
      toolbar.append(action('编辑文章', () => enterEditor(reading, article)), toolsMenu('更多', [earlier, later, deletion]));
      header.append(toolbar, element('h1', article.title));
      reading.append(header);
      const text = element('div', null, 'article-text');
      for (const block of article.blocks) {
        if (block.type === 'knowledge') {
          const row = reference(block);
          if (block.deleted) row.append(action('移除或替换引用', () => enterEditor(reading, article)));
          text.append(row);
        } else {
          const markdown = element('article', null, 'note-preview article-markdown');
          markdown.innerHTML = block.html;
          text.append(markdown);
        }
      }
      if (!article.blocks.length) text.append(element('p', '这篇文章还是空的。点击「编辑文章」开始写作。', 'meta'));
      reading.append(text);
      const adjacent = element('nav', null, 'article-turn');
      adjacent.setAttribute('aria-label', '相邻文章');
      if (at > 0) adjacent.append(link('← ' + topic.articles[at - 1].title, topicHref(topicId, order[at - 1])));
      if (at < order.length - 1) adjacent.append(link(topic.articles[at + 1].title + ' →', topicHref(topicId, order[at + 1])));
      if (adjacent.childElementCount) reading.append(adjacent);
      if (blockId && !article.blocks.some(block => block.id === blockId)) status.textContent = '该引用已移除。';
    } else {
      const deletion = action('删除专题', () => {
        if (confirm('删除专题及全部文章？原始知识和作品会保留。')) {
          void mutate(endpoint, 'DELETE', { version: topic.version }, () => navigate());
        }
      });
      deletion.className = 'topic-danger';
      toolbar.append(action('编辑专题', () => topicForm(topic)), toolsMenu('更多', [deletion]));
      const cover = element('div', null, 'frontispiece');
      cover.dataset.cover = topic.cover;
      cover.append(element('h1', topic.title),
        element('p', `${topic.articles.length} 篇文章 · ${topic.knowledge.length} 条有效收录`, 'meta'));
      header.append(toolbar, cover);
      reading.append(header);
      const overview = element('article', null, 'note-preview article-markdown');
      overview.innerHTML = topic.overviewHtml;
      if (topic.overview.trim()) reading.append(overview);
      if (topic.works.length) {
        const works = element('div', null, 'topic-tools overview-works meta');
        works.append(element('span', '关联作品'), ...topic.works.map(item => item.deleted ?
          element('span', '已删除作品', 'meta') : link(item.title, '/?work=' + encodeURIComponent(item.id))));
        reading.append(works);
      }
      const contents = element('section', null, 'contents-list');
      contents.append(element('h2', '目录'));
      if (topic.articles.length) {
        const entries = element('ol');
        for (const item of topic.articles) {
          const entry = element('li');
          entry.append(link(item.title, topicHref(topic.id, item.id)));
          entries.append(entry);
        }
        contents.append(entries);
      } else contents.append(element('p', '还没有文章，可从文章目录新建。', 'meta'));
      reading.append(contents);
    }
    layout.append(side, reading);
    body.replaceChildren(layout);
  }

  try {
    if (!topicId) await shelf();
    else {
      topic = await readJson(endpoint + (articleId ? '?article=' + encodeURIComponent(articleId) : ''));
      renderDetail();
    }
  } catch (error) {
    report(error);
    const recovery = element('nav', null, 'topic-recovery');
    recovery.setAttribute('aria-label', '专题返回');
    recovery.append(backToShelf());
    if (articleId && topicId) recovery.append(link('返回专题概述', topicHref(topicId)));
    body.replaceChildren(recovery);
  }
}
