import { createHash } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

const source = fileURLToPath(new URL('.', import.meta.url));
export const loopback = '127.0.0.1';
export const asDirectory = path => pathToFileURL(path.endsWith(sep) ? path : path + sep);

export function configure(env = process.env) {
  const mode = env.CHRONICLE_MODE ?? 'development';
  if (!['formal', 'demo', 'development'].includes(mode)) throw new Error('无效的 Chronicle 运行模式');
  if (mode === 'formal' && !env.CHRONICLE_DATA_DIR) throw new Error('正式模式必须指定资料目录');
  const data = env.CHRONICLE_DATA_DIR ?? join(source, '.chronicle-dev', mode);
  const atlas = env.CHRONICLE_ATLAS_DIR ?? join(source, 'atlas-data');
  const logs = env.CHRONICLE_LOG_DIR;
  for (const path of [data, atlas, ...(logs ? [logs] : [])]) {
    if (!isAbsolute(path)) throw new Error('Chronicle 资料和日志目录必须使用绝对路径');
  }
  const port = Number(env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Chronicle 端口无效');
  return { mode, data: resolve(data), atlas: resolve(atlas), logs: logs && resolve(logs), port, initialize: env.CHRONICLE_INIT === '1' };
}

export async function locateData(config, create = false) {
  let canonical;
  let newDirectory = false;
  try { canonical = await realpath(config.data); }
  catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    const parent = dirname(config.data);
    await mkdir(parent, { recursive: true });
    canonical = join(await realpath(parent), basename(config.data));
    newDirectory = true;
  }
  if (!newDirectory && !(await stat(canonical)).isDirectory()) throw new Error('Chronicle 资料路径不是目录');
  const identity = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  return { canonical, identity, newDirectory, state: config.logs && join(config.logs, `state-${identity}.json`) };
}

// An OS-owned exclusive listener is released even if the process is killed.
// Hash collisions fail closed, as does an unrelated process occupying the lock port.
export function lockData(identity) {
  const lockPort = 20000 + (parseInt(identity.slice(0, 8), 16) % 20000);
  const guard = createServer(socket => socket.destroy());
  return new Promise((resolve, reject) => {
    guard.once('error', error => reject(new Error(
      `无法独占资料库（锁端口 ${lockPort}）。可能有同库实例运行，或锁端口被占用。`, { cause: error })));
    guard.listen({ port: lockPort, host: loopback, exclusive: true }, () => resolve(guard));
  });
}
