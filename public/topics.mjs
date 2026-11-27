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
  let topic, dirty = false, busy = false;
  const status = element('p', '', 'topic-status');
  status.setAttribute('role', 'alert');
  const report = error => { status.textContent = error.message; };
  const breadcrumb = element('nav', null, 'topic-breadcrumb');
  breadcrumb.setAttribute('aria-label', '专题路径');
  const body = element('div');
  root.append(breadcrumb, status, body);

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
    const open = action('展开 · ' + label, () => expand(true));
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
        content.replaceChildren(initial, element('p', '原始知识暂时无法读取。', 'meta'), action('重试', expand));
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
    const blocks = element('div', null, 'article-blocks');
    const state = element('span', '未修改', 'meta');
    function changed() { dirty = true; state.textContent = '有未保存的修改'; }
    title.oninput = changed;
    function renderBlocks(focusIndex) {
      blocks.replaceChildren(...units.map((block, index) => {
        const unit = element('section', null, 'editor-unit');
        const controls = element('div', null, 'topic-tools');
        const move = direction => {
          const next = index + direction;
          [units[index], units[next]] = [units[next], units[index]];
          changed();
          renderBlocks(next);
        };
        const up = action('上移', () => move(-1)), down = action('下移', () => move(1));
        up.disabled = index === 0;
        down.disabled = index === units.length - 1;
        controls.append(element('strong', block.type === 'markdown' ? 'Markdown 正文' : '知识引用'), up, down,
          action('移除', () => { units.splice(index, 1); changed(); renderBlocks(Math.min(index, units.length - 1)); }));
        unit.append(controls);
        if (block.type === 'markdown') {
          const input = element('textarea');
          input.rows = 7;
          input.value = block.markdown;
          input.setAttribute('aria-label', 'Markdown 正文 ' + (index + 1));
          input.oninput = () => { block.markdown = input.value; changed(); };
          unit.append(input);
        } else {
          const replace = item => {
            Object.assign(block, { knowledgeId: item.id, hint: item.title || '', deleted: false });
            changed();
            renderBlocks(index);
          };
          unit.append(element('p', block.deleted ? '原始知识已删除 · ' + (block.hint || '无标题知识') : block.hint || '无标题知识'),
            action('替换引用', () => picker('knowledge', replace, editKnowledge)));
        }
        return unit;
      }));
      if (focusIndex !== undefined) blocks.children[focusIndex]?.querySelector('textarea, button:enabled')?.focus();
    }
    function insert(block) { units.push({ id: crypto.randomUUID(), ...block }); changed(); renderBlocks(units.length - 1); }
    const tools = element('div', null, 'topic-tools article-edit-tools');
    tools.append(action('＋ 正文', () => insert({ type: 'markdown', markdown: '' })),
      action('＋ 引用知识', () => picker('knowledge', item => insert({ type: 'knowledge', knowledgeId: item.id, hint: item.title || '' }), editKnowledge)),
      action('保存文章', () => mutate(articleEndpoint, 'PUT', { version: topic.version, title: title.value,
        blocks: units.map(({ deleted, ...block }) => block) }, () => navigate(topicId, articleId))),
      action('取消编辑', () => {
        if (dirty && !confirm('放弃未保存的修改？')) return;
        dirty = false;
        renderDetail();
      }), state);
    container.replaceChildren(labeled('文章标题', title), tools, blocks);
    renderBlocks();
    title.focus();
  }

  function renderDetail() {
    breadcrumb.replaceChildren(link('知识专题', topicHref()), element('span', ' / '), link(topic.title, topicHref(topic.id)));
    if (topic.article) breadcrumb.append(element('span', ' / ' + topic.article.title));
    const layout = element('div', null, 'topic-layout');
    const side = element('aside', null, 'panel topic-index');
    const index = element('details');
    index.open = !matchMedia('(max-width: 700px)').matches;
    index.append(element('summary', '文章目录'));
    const links = element('ol');
    for (const item of topic.articles) {
      const row = element('li');
      const itemLink = link(item.title, topicHref(topic.id, item.id));
      if (item.id === articleId) itemLink.setAttribute('aria-current', 'page');
      row.append(itemLink);
      links.append(row);
    }
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
    side.append(index);
    const reading = element('section', null, 'panel topic-reading');
    const toolbar = element('div', null, 'topic-tools');
    const scope = new URLSearchParams({ topic: topic.id });
    if (articleId) scope.set('article', articleId);
    toolbar.append(link('在个人时空中查看', '/spacetime?' + scope));
    if (topic.article) {
      const article = topic.article;
      const order = topic.articles.map(item => item.id);
      const at = order.indexOf(article.id);
      function reorder(direction) {
        [order[at], order[at + direction]] = [order[at + direction], order[at]];
        void mutate(endpoint + '/order', 'PUT', { version: topic.version, articleIds: order }, () => navigate(topicId, articleId));
      }
      const earlier = action('目录上移', () => reorder(-1));
      const later = action('目录下移', () => reorder(1));
      earlier.disabled = at === 0;
      later.disabled = at === order.length - 1;
      toolbar.append(action('编辑文章', () => enterEditor(reading, article)), earlier, later,
        action('删除文章', () => {
          if (confirm('删除这篇文章及其中的引用？原始知识会保留。')) {
            void mutate(articleEndpoint, 'DELETE', { version: topic.version }, () => navigate(topicId));
          }
        }));
      reading.append(element('h1', article.title), toolbar);
      for (const block of article.blocks) {
        if (block.type === 'knowledge') {
          const row = reference(block);
          if (block.deleted) row.append(action('移除或替换引用', () => enterEditor(reading, article)));
          reading.append(row);
        } else {
          const markdown = element('article', null, 'note-preview article-markdown');
          markdown.innerHTML = block.html;
          reading.append(markdown);
        }
      }
      if (!article.blocks.length) reading.append(element('p', '这篇文章还是空的。点击「编辑文章」开始写作。', 'meta'));
      if (blockId && !article.blocks.some(block => block.id === blockId)) status.textContent = '该引用已移除。';
    } else {
      toolbar.append(action('编辑专题', () => topicForm(topic)), action('删除专题', () => {
        if (confirm('删除专题及全部文章？原始知识和作品会保留。')) {
          void mutate(endpoint, 'DELETE', { version: topic.version }, () => navigate());
        }
      }));
      const overview = element('article', null, 'note-preview article-markdown');
      overview.innerHTML = topic.overviewHtml;
      reading.append(element('h1', topic.title), toolbar, overview);
      if (!topic.articles.length) reading.append(element('p', '还没有文章，可从文章目录新建。', 'meta'));
      if (topic.works.length) {
        const works = element('div', null, 'topic-tools');
        works.append(element('h2', '关联作品'), ...topic.works.map(item => item.deleted ?
          element('span', '已删除作品', 'meta') : link(item.title, '/?work=' + encodeURIComponent(item.id))));
        reading.append(works);
      }
      const knowledge = element('details', null, 'topic-knowledge');
      knowledge.append(element('summary', '收录知识 · ' + topic.knowledge.length));
      knowledge.append(...topic.knowledge.map(note => reference({ knowledgeId: note.id, title: note.title })));
      reading.append(knowledge);
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
    breadcrumb.replaceChildren(link('返回知识专题', topicHref()), ...(articleId && topicId ? [link('返回专题', topicHref(topicId))] : []));
  }
}
