import { resolve } from 'node:path';
import { savePersonalBackup, restorePersonalBackup } from '../personal-maintenance.mjs';

const [action, mode, directory, file, previous, ...extra] = process.argv.slice(2);
if (!['formal', 'development', 'demo'].includes(mode) || !directory || !file || extra.length ||
    !['backup', 'restore'].includes(action) || (action === 'backup' && previous)) {
  console.error('用法：node scripts/personal-library.mjs backup|restore formal|development|demo 资料目录 快照文件 [恢复前的备份文件]');
  process.exitCode = 1;
} else {
  try {
    const data = resolve(directory);
    if (action === 'backup') await savePersonalBackup({ mode, data, destination: file });
    else await restorePersonalBackup({ mode, data, source: file, previous });
    console.log('资料库操作完成');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
