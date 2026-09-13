// 从本机 Codex 文档插件缓存抽出四个 skill，改写成 Riot 能用的版本，
// 覆盖本仓库 skills/。打包只复制已经改好的源码，不从 Codex 抽。
//
//   node scripts/import-skills.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { adaptSkill, SKILL_NAMES } from './adapt-skills.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = path.join(os.homedir(), '.codex/plugins/cache/openai-primary-runtime');

function fail(m) {
  console.error(`\n错误: ${m}\n`);
  process.exit(1);
}

if (!fs.existsSync(path.join(ROOT, 'plugin.json'))) {
  fail(`${ROOT} 里没有 plugin.json`);
}
if (!fs.existsSync(PLUGINS)) {
  fail(`找不到 Codex 文档插件缓存: ${PLUGINS}\n需要本机装过 Codex 的文档插件。`);
}

function pluginSkillDir(name) {
  const base = path.join(PLUGINS, name);
  const versions = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^\d/.test(d)) : [];
  if (versions.length === 0) fail(`Codex 插件缓存里没有 ${name}`);
  versions.sort();
  const version = versions[versions.length - 1];
  return { dir: path.join(base, version, 'skills', name), version };
}

function copyDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync('cp', ['-Rpc', src, dest]);
}

const skillsDir = path.join(ROOT, 'skills');
fs.rmSync(skillsDir, { recursive: true, force: true });
fs.mkdirSync(skillsDir, { recursive: true });

console.log(`写入 ${skillsDir}`);
for (const name of SKILL_NAMES) {
  const { dir, version } = pluginSkillDir(name);
  const dest = path.join(skillsDir, name);
  copyDir(dir, dest);
  console.log(`  ${name}  ← Codex ${version}`);
  adaptSkill(dest, name, (m) => console.log(m));
}

console.log('\n完成。审完 diff 再提交。打包会原样复制 skills/，不再从 Codex 抽。');
