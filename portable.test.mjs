import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { locateData } from './runtime-config.mjs';

const exec = promisify(execFile);
const listen = async () => {
  const server = createServer(socket => socket.destroy());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
};
const closed = server => new Promise(resolve => server.close(resolve));

test('便携启动、模式隔离、同库独占、停止和崩溃恢复', { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'Chronicle 便携测试 '));
  const app = join(root, 'app');
  const data = join(root, 'data');
  const logs = join(root, 'logs');
  const config = join(root, 'chronicle.config.json');
  const env = { ...process.env, CHRONICLE_NO_BROWSER: '1' };
  for (const name of ['CHRONICLE_MODE', 'CHRONICLE_DATA_DIR', 'CHRONICLE_LOG_DIR', 'CHRONICLE_ATLAS_DIR', 'CHRONICLE_INIT', 'PORT']) {
    delete env[name];
  }
  const run = (file, args = [], extra = {}) => exec(process.execPath, [join(app, file), ...args], {
    cwd: tmpdir(), timeout: 15_000, env: { ...env, ...extra },
  });
  const start = () => run('portable-launch.mjs', ['start']);
  const stop = () => run('portable-launch.mjs', ['stop']);
  let foreign;
  let verifiedPid;
  try {
    for (const name of ['server.mjs', 'personal-library.mjs', 'personal-store.mjs', 'personal-document.mjs', 'personal-document-schema.mjs', 'runtime-config.mjs', 'portable-launch.mjs', 'atomic-write.mjs', 'knowledge.mjs','topics.mjs', 'spacetime.mjs',
      'note-files.mjs', 'note-storage.mjs', 'atlas-sources.mjs', 'fixtures.json', 'public/experience.mjs', 'public/index.html']) {
      await cp(new URL(name, import.meta.url), join(app, name));
    }
    await symlink(fileURLToPath(new URL('node_modules', import.meta.url)), join(app, 'node_modules'), 'junction');
    const reservation = await listen();
    const port = reservation.address().port;
    await closed(reservation);
    await writeFile(config, JSON.stringify({ port, atlasDir: '地图 资料' }));
    const address = `http://127.0.0.1:${port}`;
    const atlas = join(root, '地图 资料');
    await mkdir(atlas);
    await writeFile(join(atlas, 'manifest.json'), '{"test":true}');
    const [first, second] = await Promise.all([start(), start()]);
    assert.equal(first.stdout.trim(), address);
    assert.equal(second.stdout.trim(), address);
    const { state } = await locateData({ data, logs });
    const live = async () => JSON.parse(await readFile(state, 'utf8'));
    const initial = await live();
    verifiedPid = initial.pid;
    assert.deepEqual(await (await fetch(address + '/api/works')).json(), []);
    assert.deepEqual(await (await fetch(address + '/atlas/data/manifest.json')).json(), { test: true });
    assert.equal((await fetch(address + '/_chronicle/instance', {
      method: 'POST', headers: { Authorization: `Bearer ${initial.token}`, Origin: 'https://example.org' },
    })).status, 403);
    await start();
    assert.equal((await live()).pid, initial.pid);
    await assert.rejects(run('server.mjs', [], {
      PORT: '0', CHRONICLE_MODE: 'formal', CHRONICLE_DATA_DIR: data,
    }), /无法独占资料库/);
    await assert.rejects(run('server.mjs', [], {
      PORT: '0', CHRONICLE_MODE: 'demo', CHRONICLE_DATA_DIR: data,
    }), /无法独占资料库/);
    const work = { id: 'saved', title: '测试作品', type: '游戏', status: '未开始', segments: [] };
    assert.equal((await fetch(address + '/api/works', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([work]),
    })).status, 200);
    await stop();
    verifiedPid = undefined;
    await assert.rejects(readFile(state), { code: 'ENOENT' });
    assert.match((await stop()).stdout, /尚未运行/);
    await assert.rejects(run('server.mjs', [], {
      PORT: '0', CHRONICLE_MODE: 'demo', CHRONICLE_DATA_DIR: data,
    }), /运行模式不匹配/);
    const otherRoot = join(root, '其他正式资料');
    await mkdir(otherRoot);
    await writeFile(join(otherRoot, 'chronicle.sqlite'), '{"schemaVersion":1,"works":[]}');
    await start();
    verifiedPid = (await live()).pid;
    await writeFile(config, JSON.stringify({ port, dataDir: otherRoot }));
    await assert.rejects(start(), /已被其他服务或资料库占用/);
    await assert.rejects(stop(), /未停止任何程序/);
    assert.equal((await (await fetch(address + '/api/works')).json())[0].id, 'saved');
    await writeFile(config, JSON.stringify({ port, atlasDir: '地图 资料' }));
    await stop();
    verifiedPid = undefined;

    foreign = createServer(socket => socket.destroy());
    foreign.listen(port, '127.0.0.1');
    await once(foreign, 'listening');
    await assert.rejects(start(), /已被其他服务或资料库占用/);
    await assert.rejects(stop(), /未停止任何程序/);
    assert.equal(foreign.listening, true);
    await closed(foreign);
    foreign = null;

    await start();
    const crashed = await live();
    verifiedPid = crashed.pid;
    process.kill(crashed.pid, 'SIGKILL');
    for (let attempt = 0; attempt < 40; attempt++) {
      const stillUp = await fetch(address + '/api/works').then(() => true, () => false);
      if (!stillUp) break;
      await delay(50);
    }
    assert.equal((await live()).token, crashed.token);
    await start();
    const recovered = await live();
    verifiedPid = recovered.pid;
    assert.notEqual(recovered.token, crashed.token);
    assert.equal((await (await fetch(address + '/api/works')).json())[0].id, 'saved');
    await stop();
    verifiedPid = undefined;
    await rename(data, join(root, 'saved-data'));
    await assert.rejects(start(), /资料目录缺失/);
    await rename(join(root, 'saved-data'), data);
    await writeFile(join(data, 'chronicle.sqlite'), 'damaged');
    await assert.rejects(run('server.mjs', [], {
      PORT: '0', CHRONICLE_MODE: 'formal', CHRONICLE_DATA_DIR: data, CHRONICLE_INIT: '1',
    }), /请核对运行模式和 SQLite 资料目录/);
    assert.equal(await readFile(join(data, 'chronicle.sqlite'), 'utf8'), 'damaged');
  } finally {
    if (foreign?.listening) await closed(foreign);
    if (verifiedPid) {
      await stop().catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  }
});
