// 把各平台 marketplace 片段并进官方目录仓库的 marketplace.json。
//
//   node scripts/publish-market.mjs --catalog ../riot-marketplace/marketplace.json dist/darwin-arm64/marketplace.json dist/win-x64/marketplace.json
//
// 只替换本次涉及的插件条目。要提交的话在目录仓库里自己 git commit / 或让 Actions 推。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
function argOf(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

const catalogPath = path.resolve(argOf('--catalog') ?? '');
const fragments = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--catalog');

if (!catalogPath || fragments.length === 0) {
  console.error('用法: node scripts/publish-market.mjs --catalog <marketplace.json> <片段.json>…');
  process.exit(2);
}

const tmp = path.join(os.tmpdir(), `riot-merge-${process.pid}.json`);
const r = spawnSync(process.execPath, [path.join(HERE, 'merge-manifest.mjs'), tmp, ...fragments], {
  stdio: 'inherit',
});
if (r.status !== 0) process.exit(r.status ?? 1);

const catalog = fs.existsSync(catalogPath)
  ? JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  : { name: 'riot', owner: { name: 'Riot' }, plugins: [] };
if (!Array.isArray(catalog.plugins)) catalog.plugins = [];
const merged = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.rmSync(tmp, { force: true });
for (const plugin of merged.plugins) {
  const i = catalog.plugins.findIndex((p) => p.name === plugin.name);
  if (i >= 0) catalog.plugins[i] = plugin;
  else catalog.plugins.push(plugin);
}
fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`已写入 ${catalogPath}`);
