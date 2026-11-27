import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

test('作品笔记、图片及导出通过本机 API 往返', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chronicle-notes-'));
  let server;
  try {
    for (const name of ['server.mjs', 'runtime-config.mjs', 'knowledge.mjs','topics.mjs', 'spacetime.mjs', 'atlas-sources.mjs', 'note-storage.mjs', 'note-files.mjs', 'atomic-write.mjs', 'fixtures.json', 'public/experience.mjs']) {
      await cp(new URL(name, import.meta.url), join(root, name));
    }
    await symlink(fileURLToPath(new URL('node_modules', import.meta.url)), join(root, 'node_modules'), 'junction');
    async function start() {
      server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: {
        ...process.env, PORT: '0', CHRONICLE_MODE: 'demo', CHRONICLE_INIT: '1',
        CHRONICLE_DATA_DIR: join(root, 'data'), CHRONICLE_ATLAS_DIR: join(root, 'atlas-data'),
        CHRONICLE_LOG_DIR: join(root, 'logs'),
      } });
      const started = await Promise.race([
        once(server.stdout, 'data'),
        once(server, 'exit').then(() => { throw new Error('临时服务启动失败'); }),
      ]);
      const address = started[0].toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      assert.ok(address);
      return address;
    }
    let url = await start();
    const request = (path, options) => fetch(url + path, options);
    const put = (path, value) => request(path, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    });
    const works = await (await request('/api/works')).json();
    const id = 'no-date';
    works.push({ id, title: '无年代作品', type: '小说', status: '未开始', segments: [] });
    const experience = { startedOn: '2026-10-02', endedOn: '2026-11-02', durationMinutes: 360 };
    works[0].experience = { ...experience, endedOn: '2026-11-31' };
    assert.equal((await put('/api/works', works)).status, 400);
    works[0].experience = experience;
    assert.equal((await put('/api/works', works)).status, 200);
    assert.deepEqual((await (await request('/api/works')).json())[0].experience, experience);
    const path = `/api/works/${id}/note`;
    assert.equal((await (await request(path)).json()).revision, null);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1sAAAAASUVORK5CYII=', 'base64');
    const upload = (body, type = 'image/png') => request(path + '/assets', {
      method: 'POST', headers: { 'Content-Type': type }, body,
    });
    assert.equal((await upload(Buffer.from('<svg/>'))).status, 415);
    const uploaded = await upload(png);
    assert.equal(uploaded.status, 201);
    const { path: image } = await uploaded.json();
    assert.equal((await (await request(path)).json()).revision, null);
    const content = `# 笔记\n\n<svg onload=alert(1)>\n\n[坏链接](javascript:alert(1))\n\n![插图][image]\n\n[image]: ./${image}\n`;
    const response = await put(path, { content, revision: null });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.match(saved.html, /<h1>笔记<\/h1>/);
    assert.match(saved.html, /<img /);
    assert.ok(saved.html.includes(`${path}/${image}`));
    assert.doesNotMatch(saved.html, /<svg|href="javascript:/);
    assert.equal((await put(path, { content: '旧页覆盖', revision: null })).status, 409);
    assert.equal((await put('/api/works', works)).status, 200);
    const index = JSON.parse(await readFile(join(root, 'data', 'chronicle.json'), 'utf8'));
    assert.equal(index.works.at(-1).notePath, saved.notePath);
    assert.deepEqual(index.works.at(-1).segments, []);
    assert.equal(await (await request(path + '/export.md')).text(), content);
    const zip = unzipSync(new Uint8Array(await (await request(path + '/export.zip')).arrayBuffer()));
    assert.equal(Buffer.from(zip['note.md']).toString(), content);
    assert.deepEqual(Buffer.from(zip[image]), png);
    assert.deepEqual(Buffer.from(await (await request(`${path}/${image}`)).arrayBuffer()), png);
    assert.equal((await request(`/api/works/${works[0].id}/note/${image}`)).status, 404);
    assert.equal((await request(path + '/assets/%2e%2e%2fnote.md')).status, 404);
    const other = works[0];
    const batch = ids => request('/api/notes/export.zip', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    });
    assert.equal((await batch([])).status, 400);
    assert.equal((await batch([id, other.id])).status, 409);
    assert.equal((await put(`/api/works/${other.id}/note`, { content: '第二份笔记', revision: null })).status, 200);
    const bundle = await batch([id, other.id]);
    assert.equal(bundle.status, 200);
    const combined = unzipSync(new Uint8Array(await bundle.arrayBuffer()));
    assert.equal(Buffer.from(combined['1 - 无年代作品/note.md']).toString(), content);
    assert.deepEqual(Buffer.from(combined[`1 - 无年代作品/${image}`]), png);
    const otherPath = Object.keys(combined).find(name => name.startsWith('2 - ') && name.endsWith('/note.md'));
    assert.equal(Buffer.from(combined[otherPath]).toString(), '第二份笔记');

    const base = '/api/knowledge';
    const get = async route => {
      const result = await request(route);
      assert.equal(result.status, 200);
      return result.json();
    };
    const remove = route => request(route, { method: 'DELETE' });
    const addTag = async (name, parentId = null) => {
      const result = await request(base + '/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentId }),
      });
      assert.equal(result.status, 201);
      return result.json();
    };
    const indexPath = join(root, 'data', 'knowledge', 'index.json');
    await t.test('索引缺失且正文仍在时拒绝读取或重建知识库', async () => {
      const id = randomUUID();
      const route = `${base}/${id}`;
      const original = await (await put(route, { content: '保留这份正文', revision: null })).json();
      const archived = indexPath + '.backup';
      await rename(indexPath, archived);
      try {
        const missing = await request(base);
        assert.equal(missing.status, 409);
        assert.match((await missing.json()).error, /索引缺失.*已存正文/);
        assert.equal((await put(`${base}/${randomUUID()}`, { content: '不能重建', revision: null })).status, 409);
        await assert.rejects(readFile(indexPath), { code: 'ENOENT' });
      } finally {
        await rename(archived, indexPath);
      }
      assert.equal((await get(route)).revision, original.revision);
      assert.equal((await remove(route)).status, 200);
    });
    await t.test('知识录入、层级标签、双向关联及清理', async () => {
      const a = randomUUID(), b = randomUUID();
      const first = `${base}/${a}`, second = `${base}/${b}`;
      assert.equal((await put(first, { content: '  ', revision: null })).status, 400);
      const upload = await request(first + '/assets', {
        method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png,
      });
      assert.equal(upload.status, 201);
      const { path: image } = await upload.json();
      const text = `# 历史材料\n\n![图片](${image})`;
      assert.equal((await put(first, { content: text, revision: null })).status, 200);
      assert.equal((await put(first, { content: '覆盖', revision: null })).status, 409);
      const longBody = '读书记录' + '摘'.repeat(140) + '索引末尾词';
      assert.equal((await put(second, { content: longBody, revision: null })).status, 200);
      assert.match((await get(first)).html, /<h1>历史材料<\/h1>/);
      const files = unzipSync(new Uint8Array(await (await request(first + '/export.zip')).arrayBuffer()));
      assert.equal(Buffer.from(files['note.md']).toString(), text);
      assert.deepEqual(Buffer.from(files[image]), png);
      const download = await request(second + '/export.md');
      assert.match(download.headers.get('content-disposition'), /filename="knowledge\.md"/);
      assert.equal(await download.text(), longBody);
      assert.deepEqual(Buffer.from(await (await request(first + '/' + image)).arrayBuffer()), png);
      assert.equal((await get(base + '?tag=untagged')).notes.length, 2);
      const parent = await addTag('人文');
      const child = await addTag('历史', parent.id);
      assert.equal((await put(base + '/tags/' + parent.id, { name: '人文', parentId: child.id })).status, 400);
      const draft = await get(first);
      const payload = {
        version: draft.metadataVersion, title: '史料摘录', tagIds: [parent.id, child.id],
        related: [{ type: 'knowledge', id: b }, { type: 'work', id }, { type: 'work-note', id }],
      };
      assert.equal((await put(first + '/metadata', payload)).status, 200);
      assert.equal((await put(first + '/metadata', payload)).status, 409);
      const queryTargets = text => get(base + '/targets?q=' + encodeURIComponent(text));
      assert.deepEqual((await queryTargets('史料摘录')).map(item => item.id), [a]);
      const [unnamed] = await queryTargets('索引末尾词');
      assert.equal(unnamed.id, b);
      assert.equal(unnamed.title, '');
      assert.equal(unnamed.excerpt, longBody.slice(0, 120));
      assert.equal(unnamed.content, undefined);
      assert.equal((await get(first)).related.find(item => item.id === b).excerpt, unnamed.excerpt);
      assert.equal((await get(second)).related[0].id, a);
      assert.equal((await get(base + '?related=work-note:' + id)).notes[0].id, a);
      assert.deepEqual((await get(base + '?tag=' + parent.id)).notes.map(note => note.id), [a]);
      assert.equal((await get(base)).tags.find(tag => tag.id === parent.id).count, 1);
      assert.deepEqual((await get(base + '?q=' + encodeURIComponent('人文') + '&tag=' + child.id)).notes.map(note => note.id), [a]);
      assert.deepEqual((await get(base + '?q=' + encodeURIComponent('历史材料'))).notes.map(note => note.id), [a]);
      const workLinks = `${base}/works/${id}`;
      assert.equal((await put(workLinks + '/' + b)).status, 200);
      assert.equal((await put(workLinks + '/' + b)).status, 200);
      const reverse = (await get(workLinks)).related.filter(note => note.id === b);
      assert.equal(reverse.length, 1);
      assert.equal(reverse[0].excerpt, unnamed.excerpt);
      assert.ok((await get(second)).related.some(item => item.type === 'work' && item.id === id));
      assert.equal((await remove(workLinks + '/' + b)).status, 200);
      assert.deepEqual((await get(second)).related.map(item => item.id), [a]);
      const beforeEdit = await get(first);
      assert.equal((await put(first, { content: '此修改应整体失败', revision: beforeEdit.revision,
        metadata: { ...payload, version: beforeEdit.metadataVersion, tagIds: ['invalid'] } })).status, 400);
      assert.equal((await get(first)).content, text);
      assert.equal((await put(first, { content: text + '\n\n补充', revision: beforeEdit.revision,
        metadata: { ...payload, version: beforeEdit.metadataVersion, title: '史料摘录修订' } })).status, 200);
      assert.equal((await get(first)).title, '史料摘录修订');
      assert.deepEqual((await get(base)).notes.map(note => note.id), [b, a]);
      const otherParent = await addTag('研究');
      assert.equal((await put(base + '/tags/' + child.id, { name: '史学', parentId: otherParent.id })).status, 200);
      assert.deepEqual((await get(base + '?tag=' + otherParent.id)).notes.map(note => note.id), [a]);
      assert.equal((await remove(base + '/tags/' + child.id)).status, 200);
      assert.deepEqual((await get(first)).tagIds, [parent.id, otherParent.id]);
      assert.equal((await remove(path)).status, 200);
      assert.deepEqual((await get(first)).related.map(item => item.type).sort(), ['knowledge', 'work']);
      assert.equal((await put('/api/works', works.filter(work => work.id !== id))).status, 200);
      assert.deepEqual((await get(first)).related.map(item => item.type), ['knowledge']);
      const survivingWork = `${base}/works/${other.id}`;
      assert.equal((await put(survivingWork + '/' + a)).status, 200);
      assert.equal((await request(first + '/' + image)).status, 200);
      assert.equal((await remove(first)).status, 200);
      assert.equal((await request(first + '/' + image)).status, 404);
      assert.deepEqual((await get(second)).related, []);
      assert.deepEqual((await get(survivingWork)).related, []);
      assert.equal((await get(`/api/works/${other.id}/note`)).content, '第二份笔记');
      const saved = JSON.parse(await readFile(indexPath, 'utf8'));
      assert.deepEqual(saved.relations, []);
      assert.equal(saved.notes.length, 1);
    });
    await t.test('并发移动和重命名只更新各自字段，保留另一窗口的修改', async () => {
      const oldParent = await addTag('原父级');
      const newParent = await addTag('新父级');
      const tag = await addTag('原标签名', oldParent.id);
      const route = `${base}/tags/${tag.id}`;
      const [moved, renamed] = await Promise.all([
        put(route, { parentId: newParent.id }),
        put(route, { name: '新标签名' }),
      ]);
      assert.equal(moved.status, 200);
      assert.equal(renamed.status, 200);
      let current = (await get(base)).tags.find(item => item.id === tag.id);
      assert.equal(current.name, '新标签名');
      assert.equal(current.parentId, newParent.id);
      assert.equal((await put(route, { name: '第二次重命名' })).status, 200);
      assert.equal((await put(route, { parentId: null })).status, 200);
      current = (await get(base)).tags.find(item => item.id === tag.id);
      assert.equal(current.name, '第二次重命名');
      assert.equal(current.parentId, null);
    });
    await t.test('删除标签原子继承父级，保留后代，并拒绝提升冲突', async () => {
      const top = await addTag('分类');
      const middle = await addTag('待删除', top.id);
      const child = await addTag('下级', middle.id);
      const leaf = await addTag('末级', child.id);
      const conflict = await addTag('下级', top.id);
      const rootConflict = await addTag('下级');
      const extra = await addTag('其他标签');
      async function note(tagIds) {
        const route = `${base}/${randomUUID()}`;
        assert.equal((await put(route, { content: '保留正文', revision: null,
          metadata: { title: '', tagIds, related: [], version: null } })).status, 200);
        return route;
      }
      const duplicate = await note([top.id, middle.id, extra.id]);
      const inherits = await note([middle.id]);
      const descendant = await note([leaf.id]);
      const before = await readFile(indexPath, 'utf8');
      const blocked = await remove(base + '/tags/' + middle.id);
      assert.equal(blocked.status, 409);
      assert.match((await blocked.json()).error, /先重命名或移动/);
      assert.equal(await readFile(indexPath, 'utf8'), before);
      assert.equal((await remove(base + '/tags/' + conflict.id)).status, 200);
      assert.equal((await remove(base + '/tags/' + middle.id)).status, 200);
      assert.deepEqual((await get(duplicate)).tagIds, [top.id, extra.id]);
      assert.deepEqual((await get(inherits)).tagIds, [top.id]);
      assert.deepEqual((await get(descendant)).tagIds, [leaf.id]);
      const snapshot = await get(base);
      assert.equal(snapshot.tags.find(tag => tag.id === child.id).parentId, top.id);
      assert.equal(snapshot.tags.find(tag => tag.id === leaf.id).parentId, child.id);
      assert.equal(snapshot.tags.find(tag => tag.id === top.id).directCount, 2);
      const beforeTop = await readFile(indexPath, 'utf8');
      assert.equal((await remove(base + '/tags/' + top.id)).status, 409);
      assert.equal(await readFile(indexPath, 'utf8'), beforeTop);
      assert.equal((await remove(base + '/tags/' + rootConflict.id)).status, 200);
      assert.equal((await remove(base + '/tags/' + top.id)).status, 200);
      assert.deepEqual((await get(duplicate)).tagIds, [extra.id]);
      assert.deepEqual((await get(inherits)).tagIds, []);
      assert.equal((await get(inherits)).content, '保留正文');
      assert.ok((await get(base + '?tag=untagged')).notes.some(note => inherits.endsWith('/' + note.id)));
      assert.deepEqual((await get(descendant)).tagIds, [leaf.id]);
      assert.equal((await get(base)).tags.find(tag => tag.id === child.id).parentId, null);
    });
    await t.test('个人时空立即反映实体与标注写入，拒绝旧快照', async () => {
      const oldWorks = await get('/api/works');
      const legacy = { id: 'legacy-point', title: '旧版点年代', type: '小说', status: '未开始',
        segments: [{ kind: 'point', start: 0, end: 50, confidence: '确定' }] };
      assert.equal((await put('/api/works', [...oldWorks, legacy])).status, 200);
      assert.deepEqual((await get('/api/works')).at(-1), legacy);
      const legacyProjection = (await get('/api/spacetime?layer=work')).rows.find(row => row.entityId === 'work:legacy-point');
      assert.equal(legacyProjection.start, 0);
      assert.equal(legacyProjection.end, undefined);
      const route = `${base}/${randomUUID()}`;
      const original = await request('/api/works?annotations=1');
      const version = original.headers.get('ETag');
      const list = await original.json();
      const work = { id, title: '时空测试作品', type: '小说', status: '未开始', segments: [] };
      list.push(work);
      const saveWorks = (items, version) => request('/api/works', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': version },
        body: JSON.stringify(items),
      });
      const rows = async () => (await get('/api/spacetime')).rows;
      assert.deepEqual((await get('/api/spacetime?layer=knowledge')).rows, []);
      assert.deepEqual((await get('/api/spacetime?layer=work')).tags, []);
      assert.equal((await request('/api/spacetime?layer=bad')).status, 400);
      assert.equal((await request('/?page=timeline&work=one', { redirect: 'manual' })).headers.get('location'), '/spacetime?work=one');

      const oldRow = (await rows()).find(row => row.entityId === 'work:' + list[0].id);
      assert.equal(oldRow.id, list[0].segments[0].id);
      work.segments.push({ id: 'zero', longitude: 0, latitude: 0 }, {
        id: 'bc', kind: 'point', start: 0, confidence: '确定',
      });
      const [first, stale] = await Promise.all([saveWorks(list, version), saveWorks(list, version)]);
      assert.deepEqual([first.status, stale.status].sort(), [200, 409]);
      assert.equal((await put('/api/works', list.map(entry => ({ ...entry, segments: [] })))).status, 409);
      const metadata = { title: '', tagIds: [], related: [{ type: 'work', id }],
        annotations: [{ id: 'place', longitude: 0, latitude: 0 }], version: null };
      assert.equal((await put(route, { content: '正文', revision: null, metadata })).status, 200);
      assert.equal((await rows()).filter(row => row.entityId === 'work:' + id).length, 2);
      assert.ok((await get('/api/spacetime?layer=work')).rows.every(row => row.entityType === 'work'));
      assert.deepEqual((await get('/api/spacetime?layer=knowledge')).rows.map(row => row.id), ['place']);

      const note = await get(route);
      const updated = { ...metadata, title: '标题已改', version: note.metadataVersion,
        annotations: [{ id: 'place', longitude: 80, latitude: 0 }] };
      assert.equal((await put(route, { content: note.content, revision: note.revision, metadata: updated })).status, 200);
      assert.equal((await put(route, { content: note.content, revision: note.revision, metadata: { ...metadata, version: note.metadataVersion } })).status, 409);
      const currentNote = await get(route);
      const { annotations, ...oldClientMetadata } = updated;
      oldClientMetadata.version = currentNote.metadataVersion;
      assert.equal((await put(route, { content: '旧客户端仍可写正文', revision: currentNote.revision,
        metadata: oldClientMetadata })).status, 200);
      const row = (await rows()).find(row => row.id === 'place');
      assert.equal(row.title, '标题已改');
      assert.equal(row.longitude, 80);
      assert.equal((await remove(route)).status, 200);
      assert.ok(!(await rows()).some(row => row.id === 'place'));
      work.segments.shift();
      const revision = (first.ok ? first : stale).headers.get('ETag');
      const saved = await saveWorks(list, revision);
      assert.equal(saved.status, 200);
      assert.ok(!(await rows()).some(row => row.id === 'zero'));
      assert.ok((await rows()).some(row => row.id === 'bc'));
      assert.equal((await saveWorks(list.filter(entry => entry.id !== id), saved.headers.get('ETag'))).status, 200);
      assert.ok(!(await rows()).some(row => row.entityId === 'work:' + id));
      const beforeRestart = await rows();
      const stopped = once(server, 'exit');
      server.kill();
      await stopped;
      url = await start();
      assert.deepEqual(await rows(), beforeRestart);
      assert.equal((await put('/api/works', [])).status, 409);
    });
    await t.test('专题引用、失效占位、版本保护、时空范围及恢复', async () => {
      const topicApi = '/api/topics';
      const write = (path, method, data) => request(path, { method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data) });
      const create = async (path, data) => {
        const response = await write(path, 'POST', data);
        assert.ok(response.ok, await response.clone().text());
        return response.json();
      };
      const noteId = randomUUID();
      const secondId = randomUUID();
      const tag = await addTag('专题回归标签');
      for (const note of [noteId, secondId]) {
        assert.equal((await put(base + '/' + note, { content: '用于专题引用的 Markdown',
          revision: null, metadata: { title: '', tagIds: [tag.id], related: [], version: null,
            annotations: [{ kind: 'point', start: 0, confidence: '确定', longitude: 0, latitude: 0 }] } })).status, 200);
      }
      assert.deepEqual(await get(topicApi), { topics: [] });
      const work = (await get('/api/works'))[0];
      const topic = await create(topicApi, { title: '测试专题', workIds: [work.id] });
      const url = topicApi + '/' + topic.id;
      const first = await create(url + '/articles', { title: '第一篇', version: topic.version });
      const second = await create(url + '/articles', { title: '第二篇', version: first.version });
      const article = url + '/articles/' + first.id;
      const other = url + '/articles/' + second.id;
      const markdown = { id: randomUUID(), type: 'markdown', markdown: '**正文** <script>alert(1)</script>' };
      const block = { id: randomUUID(), type: 'knowledge', knowledgeId: noteId, hint: '' };
      const repeat = { ...block, id: randomUUID() };
      assert.equal((await put(article, { version: second.version, blocks: [markdown, block, repeat] })).status, 200);
      let detail = await get(url + '?article=' + first.id);
      assert.equal(detail.article.blocks[0].id, markdown.id);
      assert.match(detail.article.blocks[0].html, /<strong>正文<\/strong>/);
      assert.doesNotMatch(detail.article.blocks[0].html, /<script>/);
      assert.equal(detail.knowledge.length, 1);
      assert.equal(detail.article.blocks[1].deleted, false);
      assert.equal((await put(article, { version: second.version, title: '旧窗口' })).status, 409);
      const membership = await get(base + '/' + noteId + '/topics');
      assert.equal(membership.references.length, 2);
      assert.equal(membership.impact.articles, 1);
      const unfiled = async () => (await get(base + '?topic=unfiled&tag=' + tag.id + '&q=Markdown')).notes.map(note => note.id);
      assert.deepEqual(await unfiled(), [secondId]);
      const joined = await create(other + '/references', { version: detail.version, knowledgeId: noteId });
      assert.equal((await request(base + '/' + noteId + '?topicImpact=' + membership.impact.version, { method: 'DELETE' })).status, 409);
      detail = await get(url + '?article=' + first.id);
      assert.equal(detail.version, joined.version);
      const scoped = '/api/spacetime?topic=' + topic.id + '&article=' + first.id;
      assert.equal((await get(scoped + '&layer=knowledge')).rows[0].entityId, 'knowledge:' + noteId);
      assert.ok((await get(scoped + '&layer=work')).rows.every(row => row.entityId === 'work:' + work.id));
      assert.equal((await request('/api/spacetime?topic=' + randomUUID())).status, 404);
      const after = await get(base + '/' + noteId + '/topics');
      assert.equal(after.impact.articles, 2);
      assert.equal((await request(base + '/' + noteId + '?topicImpact=' + after.impact.version, { method: 'DELETE' })).status, 200);
      assert.deepEqual((await get(scoped + '&layer=knowledge')).rows, []);
      detail = await get(url + '?article=' + first.id);
      assert.deepEqual(detail.article.blocks.slice(1).map(block => [block.id, block.deleted]), [[block.id, true], [repeat.id, true]]);
      assert.equal((await write(other + '/references', 'POST', { version: detail.version, knowledgeId: noteId })).status, 409);
      assert.equal((await put(article, { version: detail.version, blocks: [block, markdown] })).status, 200);
      detail = await get(url + '?article=' + first.id);
      const replacement = { ...block, knowledgeId: secondId };
      assert.equal((await put(article, { version: detail.version, blocks: [replacement, markdown] })).status, 200);
      assert.deepEqual(await unfiled(), []);
      detail = await get(url + '?article=' + first.id);
      assert.equal(detail.article.blocks[0].id, block.id);
      assert.equal((await put(url + '/order', { version: detail.version, articleIds: [second.id, first.id] })).status, 200);
      const snapshot = await get(url + '?article=' + first.id);
      const topicIndexPath = join(root, 'data', 'topics.json');
      const originalIndex = await readFile(topicIndexPath);
      const closed = once(server, 'exit');
      server.kill();
      await closed;
      await writeFile(topicIndexPath, '{broken');
      // Starting the program still allows the underlying knowledge to be read.
      server = undefined;
      const restored = await start();
      const bad = await fetch(restored + topicApi);
      assert.equal(bad.status, 500);
      assert.equal((await fetch(restored + topicApi, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '不得覆盖坏索引' }) })).status, 500);
      assert.equal(await readFile(topicIndexPath, 'utf8'), '{broken');
      await writeFile(topicIndexPath, originalIndex);
      const recovered = await (await fetch(restored + url + '?article=' + first.id)).json();
      assert.deepEqual(recovered.article.blocks, snapshot.article.blocks);
      const stored = JSON.parse(originalIndex).topics[0].articles.find(item => item.id === first.id).blocks.find(item => item.type === 'markdown');
      const bodyPath = join(root, 'data', 'topics', stored.revision + '.md');
      await rename(bodyPath, bodyPath + '.backup');
      assert.equal((await fetch(restored + url + '?article=' + first.id)).status, 500);
      await rename(bodyPath + '.backup', bodyPath);
      await rename(topicIndexPath, topicIndexPath + '.backup');
      assert.equal((await fetch(restored + topicApi)).status, 500);
      await rename(topicIndexPath + '.backup', topicIndexPath);
      const removed = await fetch(restored + article, { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: recovered.version }) });
      assert.equal(removed.status, 200);
      const remainingUnfiled = await (await fetch(restored + base + '?topic=unfiled&tag=' + tag.id)).json();
      assert.ok(remainingUnfiled.notes.some(note => note.id === secondId));
      assert.equal((await fetch(restored + url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: (await removed.json()).version }) })).status, 200);
      assert.equal((await fetch(restored + base + '/' + secondId)).status, 200);
      assert.equal((await fetch(restored + scoped)).status, 404);
    });
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const closed = once(server, 'exit');
      server.kill();
      await closed;
    }
    await rm(root, { force: true, recursive: true });
  }
});
