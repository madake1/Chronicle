import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
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
    for (const name of ['server.mjs', 'knowledge.mjs', 'atlas-sources.mjs', 'note-storage.mjs', 'note-files.mjs', 'atomic-write.mjs', 'fixtures.json', 'public/experience.mjs']) {
      await cp(new URL(name, import.meta.url), join(root, name));
    }
    await symlink(fileURLToPath(new URL('node_modules', import.meta.url)), join(root, 'node_modules'), 'junction');
    server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: '0' } });
    const started = await Promise.race([
      once(server.stdout, 'data'),
      once(server, 'exit').then(() => { throw new Error('临时服务启动失败'); }),
    ]);
    const url = started[0].toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url);
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
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const closed = once(server, 'exit');
      server.kill();
      await closed;
    }
    await rm(root, { force: true, recursive: true });
  }
});
