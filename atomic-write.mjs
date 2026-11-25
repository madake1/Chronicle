import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

export async function atomicWrite(file, content) {
  const temporary = new URL(`.chronicle-${randomUUID()}.tmp`, file);
  try {
    await writeFile(temporary, content, { flag: 'wx', flush: true });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
