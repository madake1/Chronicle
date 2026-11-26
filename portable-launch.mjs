import { spawn } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { access, mkdir, open, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { asDirectory, configure, locateData, loopback } from './runtime-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const logs = join(root, 'logs');
const marker = new URL('installation.json', asDirectory(logs));
const log = join(logs, 'chronicle.log');
const action = process.argv[2];

async function exists(path) {
  try { await access(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function isListening(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: loopback, port });
    const done = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(400, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function findInstance(paths, address, mode) {
  try {
    const { address: recorded, pid, token } = JSON.parse(await readFile(paths.state, 'utf8'));
    if (recorded !== address || !Number.isSafeInteger(pid) || !/^[a-f0-9]{64}$/.test(token ?? '')) return null;
    const challenge = randomBytes(32).toString('hex');
    const response = await fetch(`${address}/_chronicle/instance`, {
      headers: { 'x-chronicle-challenge': challenge }, redirect: 'error', signal: AbortSignal.timeout(600),
    });
    if (!response.ok) return null;
    const { instance, proof } = await response.json();
    if (instance?.app !== 'Chronicle' || instance.mode !== mode || instance.identity !== paths.identity ||
        instance.pid !== pid || instance.address !== address || !/^[a-f0-9]{64}$/.test(proof ?? '')) return null;
    const expected = createHmac('sha256', token).update(challenge + JSON.stringify(instance)).digest();
    return timingSafeEqual(expected, Buffer.from(proof, 'hex')) ? { token, pid } : null;
  } catch {
    return null;
  }
}

async function waitForInstance(paths, address, mode, timeout) {
  const until = Date.now() + timeout;
  do {
    const current = await findInstance(paths, address, mode);
    if (current) return current;
    await delay(120);
  } while (Date.now() < until);
  return null;
}

async function openBrowser(address) {
  if (process.env.CHRONICLE_NO_BROWSER === '1') return;
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${address}/'`],
      { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`无法打开默认浏览器，请打开 ${address}/`)));
  });
}

async function launch() {
  if (!['start', 'stop'].includes(action)) throw new Error('请选择启动或停止入口');
  const userConfig = join(root, 'chronicle.config.json');
  const options = await exists(userConfig) ? JSON.parse((await readFile(userConfig, 'utf8')).replace(/^\uFEFF/, '')) : {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('配置文件格式无效');
  const data = resolve(root, options.dataDir ?? 'data');
  const env = {
    CHRONICLE_MODE: 'formal', CHRONICLE_DATA_DIR: data,
    CHRONICLE_ATLAS_DIR: resolve(root, options.atlasDir ?? 'atlas-data'),
    CHRONICLE_LOG_DIR: logs, PORT: String(options.port ?? 4173), CHRONICLE_INIT: '0',
  };
  const config = configure(env);
  if (config.port === 0) throw new Error('便携版须配置固定端口');
  const address = `http://${loopback}:${config.port}`;
  const installed = await exists(marker);
  const present = await exists(data);
  const fresh = !present && options.dataDir === undefined && !installed;
  if (!present && !fresh) throw new Error('资料目录缺失。请还原备份或核对 chronicle.config.json。');
  if (action === 'stop' && !present) {
    console.log('Chronicle 尚未运行。');
    return;
  }
  const paths = await locateData(config, fresh);
  let instance = await findInstance(paths, address, config.mode);
  if (action === 'stop') {
    if (!instance && await isListening(config.port)) instance = await waitForInstance(paths, address, config.mode, 1800);
    if (!instance) {
      if (await isListening(config.port)) throw new Error(`端口 ${config.port} 上的服务无法验证为当前资料库，未停止任何程序。`);
      console.log('Chronicle 尚未运行。');
      return;
    }
    const response = await fetch(`${address}/_chronicle/instance`, {
      method: 'POST', headers: { Authorization: `Bearer ${instance.token}` },
      redirect: 'error', signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('服务未接受停止请求，未强制结束进程。');
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!await exists(paths.state) && !await isListening(config.port)) {
        console.log('Chronicle 已停止。');
        return;
      }
      await delay(150);
    }
    throw new Error('Chronicle 仍在等待现有请求完成，请稍后再试。');
  }

  if (!instance && await isListening(config.port)) {
    instance = await waitForInstance(paths, address, config.mode, 2500);
    if (!instance) throw new Error(`端口 ${config.port} 已被其他服务或资料库占用，未打开该服务。`);
  }
  if (!instance) {
    await access(new URL('./server.mjs', import.meta.url));
    await mkdir(logs, { recursive: true });
    const output = await open(log, 'a');
    try {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
        detached: true, windowsHide: true, stdio: ['ignore', output.fd, output.fd],
        env: { ...process.env, ...env, CHRONICLE_INIT: fresh ? '1' : '0' },
      });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('spawn', resolve);
      });
      child.unref();
    } finally { await output.close(); }
    instance = await waitForInstance(paths, address, config.mode, 7000);
    if (!instance) throw new Error(`Chronicle 未就绪。请检查端口 ${config.port}、资料目录及服务日志。`);
  }
  console.log(address);
  await openBrowser(address);
}

try { await launch(); }
catch (error) {
  console.error(`Chronicle：${error.message}\n日志：${log}\n排查说明：${join(root, 'README.md')}`);
  process.exitCode = 1;
}
