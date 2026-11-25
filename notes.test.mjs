import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

test('作品笔记、图片及导出通过本机 API 往返', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chronicle-notes-'));
  let server;
  try {
    for (const name of ['server.mjs', 'atlas-sources.mjs', 'note-storage.mjs', 'note-files.mjs', 'atomic-write.mjs', 'fixtures.json', 'public/experience.mjs']) {
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
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const closed = once(server, 'exit');
      server.kill();
      await closed;
    }
    await rm(root, { force: true, recursive: true });
  }
});
