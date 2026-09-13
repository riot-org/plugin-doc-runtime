// 把各平台构建机产出的 marketplace.json 合并成一份发布用的市场清单。
//
// 用法:
//   node scripts/merge-manifest.mjs out.json mac/marketplace.json win/marketplace.json ...

import fs from 'node:fs';
import path from 'node:path';

const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length === 0) {
  console.error('用法: node merge-manifest.mjs <输出.json> <输入1.json> [输入2.json ...]');
  process.exit(2);
}

const merged = { name: 'riot', owner: { name: 'Riot' }, plugins: [] };
const origin = new Map();

for (const file of inputs) {
  if (!fs.existsSync(file)) fail(`找不到 ${file}`);
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(m.plugins)) fail(`${file} 里没有 plugins 数组，不像市场清单`);

  for (const plugin of m.plugins) {
    const id = plugin.name;
    if (!id) fail(`${file} 里有一条没有 name 的插件`);
    const existing = merged.plugins.find((p) => p.name === id);
    if (!existing) {
      merged.plugins.push(structuredClone(plugin));
      for (const p of Object.keys(plugin.source?.platforms ?? {})) origin.set(`${id}/${p}`, file);
      continue;
    }

    if (existing.version !== plugin.version) {
      fail(
        `「${id}」的版本在两份清单里不一致：\n` +
          `  ${origin.get(`${id}/${Object.keys(existing.source?.platforms ?? {})[0]}`)}: ${existing.version}\n` +
          `  ${file}: ${plugin.version}\n` +
          `两台构建机跑的不是同一批。`,
      );
    }
    if (existing.source?.source !== 'archive' || plugin.source?.source !== 'archive') {
      fail(`「${id}」只有 archive 来源能按平台合并，实际：${existing.source?.source} / ${plugin.source?.source}`);
    }

    for (const [plat, asset] of Object.entries(plugin.source.platforms ?? {})) {
      const prev = origin.get(`${id}/${plat}`);
      if (prev) fail(`「${id}」的 ${plat} 在 ${prev} 和 ${file} 里都有，重复了。`);
      existing.source.platforms[plat] = asset;
      origin.set(`${id}/${plat}`, file);
    }
  }
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);

console.log(`合并 ${inputs.length} 份 → ${out}`);
for (const p of merged.plugins) {
  const plats = Object.keys(p.source?.platforms ?? {}).sort();
  console.log(`  ${p.name} ${p.version}  ${plats.join(', ')}`);
}

function fail(m) {
  console.error(`\n错误: ${m}\n`);
  process.exit(1);
}
