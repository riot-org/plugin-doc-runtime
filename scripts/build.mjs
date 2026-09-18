// 打包 doc-runtime（macOS）。
//
// 运行时（Python / Node / LibreOffice / artifact-tool）不进 git：体积太大，
// 而且 @oai/artifact-tool 是 Codex 私有包。本机有 Codex 时用 --seed 抽一次，
// 把 runtime-<平台>.tar.zst 传到本仓库 tag=`runtime` 的 Release。之后
// GitHub Actions 只下载这份运行时，叠上仓库里的 skills / plugin.json 再打包。
//
//   node scripts/build.mjs --seed          从本机 Codex 抽出运行时
//   node scripts/build.mjs --seed --upload 抽出并 gh 上传到 runtime Release
//   node scripts/build.mjs                 用已有运行时 + 本仓库源码打插件包
//   node scripts/build.mjs --runtime <zst> 指定运行时包
//   node scripts/build.mjs --stage-only    只铺出，不打 tar.zst

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK_NAME = 'doc-runtime';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(DIST, '.cache');
const SLUG = process.env.GITHUB_REPOSITORY || 'riot-org/plugin-doc-runtime';

const argv = process.argv.slice(2);
const args = new Set(argv);
const seed = args.has('--seed');
const upload = args.has('--upload');
const stageOnly = args.has('--stage-only');
const keepStage = args.has('--keep-stage') || stageOnly;
function argOf(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

if (process.platform !== 'darwin') {
  fail(`这个脚本只产出 macOS 包。Windows 请用 scripts/build.ps1。`);
}
const PLATFORM = `darwin-${process.arch}`;

const sourcePlugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));
if (sourcePlugin.name !== PACK_NAME) fail(`plugin.json 的 name 是 ${sourcePlugin.name}`);
const PACK_VERSION = sourcePlugin.version;
const PACK_DESCRIPTION = sourcePlugin.description;
if (!PACK_VERSION || !PACK_DESCRIPTION) fail('plugin.json 缺 version 或 description');
if (!fs.existsSync(path.join(ROOT, 'skills'))) fail('没有 skills/');
if (!fs.existsSync(path.join(ROOT, 'mcp.json'))) fail('没有 mcp.json');
const RELEASE_TAG = `${PACK_NAME}-v${PACK_VERSION}`;

const OUT = path.resolve(argOf('--out', path.join(DIST, PLATFORM)));
const RUNTIME_TAR = path.resolve(
  argOf('--runtime', path.join(DIST, `runtime-${PLATFORM}.tar.zst`)),
);
const DEPS = process.env.CODEX_DEPS
  ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies');

fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

if (seed) {
  await seedRuntime();
  if (upload) uploadRuntime();
  if (!args.has('--pack')) {
    log('\n运行时已就绪。打插件包再跑: node scripts/build.mjs');
    process.exit(0);
  }
}

if (!fs.existsSync(RUNTIME_TAR)) {
  if (fs.existsSync(DEPS)) {
    log(`没有 ${RUNTIME_TAR}，本机有 Codex，先 seed 一份。`);
    await seedRuntime();
  } else {
    fail(
      `找不到运行时包:\n  ${RUNTIME_TAR}\n` +
        `在装过 Codex 的机器上跑: node scripts/build.mjs --seed --upload\n` +
        `或把 runtime-${PLATFORM}.tar.zst 放到 dist/。`,
    );
  }
}

const STAGE = path.join(DIST, `${PACK_NAME}-${PACK_VERSION}-${PLATFORM}`);
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

step('展开运行时');
unpackTarZst(RUNTIME_TAR, STAGE);
log(`  ← ${RUNTIME_TAR}`);
// 底包里可能带着坏链接（老底包裁剪 share/terminfo 时留下的 lib/terminfo，
// Codex 运行时自带的几条指向安装机临时目录的绝对链接）。在这里清，现有的
// runtime 底包不用重新 seed。
for (const line of pruneBrokenSymlinks(STAGE)) log(`  删掉坏链接 ${line}`);

step('叠源码');
copyDir(path.join(ROOT, 'skills'), path.join(STAGE, 'skills'));
fs.copyFileSync(path.join(ROOT, 'mcp.json'), path.join(STAGE, 'mcp.json'));
const pluginJson = structuredClone(sourcePlugin);
pluginJson.extensions ??= {};
pluginJson.extensions['dev.riot'] ??= {};
pluginJson.extensions['dev.riot'].platforms = [PLATFORM];
pluginJson.extensions['dev.riot'].builtAt = new Date().toISOString();
fs.writeFileSync(path.join(STAGE, 'plugin.json'), `${JSON.stringify(pluginJson, null, 2)}\n`);

// 打包前最后一道闸：包里不许有绝对的或悬空的符号链接。0.2.0 就是 147 条
// 动态库别名全变成了构建机上的绝对路径，装到用户机器上 dyld 报
// "Library not loaded"，一个字不提解压。这里拦住，比让 verify 去猜快得多。
{
  const broken = findBrokenSymlinks(STAGE);
  if (broken.length > 0) {
    fail(`铺出的目录里有 ${broken.length} 条装上去必坏的符号链接：\n  ${broken.join('\n  ')}`);
  }
}

const installedSize = dirSize(STAGE);
log(`铺出完成: ${mb(installedSize)}`);

if (stageOnly) {
  log(`--stage-only: ${STAGE}`);
  process.exit(0);
}

step('打包');
const tarball = path.join(OUT, `${PACK_NAME}-${PACK_VERSION}-${PLATFORM}.tar.zst`);
packTarZst(DIST, path.basename(STAGE), tarball);
const sha256 = sha256File(tarball);
const size = fs.statSync(tarball).size;
log(`  ${path.basename(tarball)}  ${mb(size)}  sha256 ${sha256.slice(0, 16)}…`);

step('marketplace.json');
const manifestPath = path.join(OUT, 'marketplace.json');
writePlatformManifest(manifestPath, {
  url: `https://github.com/${SLUG}/releases/download/${RELEASE_TAG}/${path.basename(tarball)}`,
  sha256,
  size,
  installedSize,
});
log(`  ${manifestPath}`);

if (!keepStage) fs.rmSync(STAGE, { recursive: true, force: true });
log(`\n完成。压缩 ${mb(size)}，安装后 ${mb(installedSize)}。`);

// —— seed ——————————————————————————————————————————————————

async function seedRuntime() {
  if (!fs.existsSync(DEPS)) {
    fail(`找不到 Codex 运行时: ${DEPS}\n需要本机装过 Codex 并下载完主运行时。`);
  }
  const runtimeName = `runtime-${PLATFORM}`;
  const stage = path.join(DIST, runtimeName);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  log(`从 Codex 抽出运行时 → ${stage}`);
  log(`  ${DEPS}`);

  step('Python');
  copyDir(path.join(DEPS, 'python'), path.join(stage, 'python'));
  const SITE = path.join(stage, 'python/lib/python3.12/site-packages');
  for (const glob of ['artifact_tool_v2', 'pandas']) {
    for (const e of fs.readdirSync(SITE)) {
      if (e === glob || e.startsWith(`${glob}-`)) {
        fs.rmSync(path.join(SITE, e), { recursive: true, force: true });
      }
    }
  }
  pruneCaches(path.join(stage, 'python'));
  // man 页和 pkgconfig 运行时用不到，而且 Codex 装出来的这两处里有指向安装机
  // 临时目录（/var/folders/…/codex-primary-runtime-…）的绝对链接。
  for (const rel of ['share/man', 'lib/pkgconfig']) {
    fs.rmSync(path.join(stage, 'python', rel), { recursive: true, force: true });
  }
  log(`  python: ${mb(dirSize(path.join(stage, 'python')))}`);

  step('Node 与 artifact-tool');
  fs.mkdirSync(path.join(stage, 'node/node_modules/@oai'), { recursive: true });
  fs.copyFileSync(path.join(DEPS, 'node/bin/node'), path.join(stage, 'node/node'));
  fs.chmodSync(path.join(stage, 'node/node'), 0o755);
  copyDir(
    path.join(DEPS, 'node/node_modules/@oai/artifact-tool'),
    path.join(stage, 'node/node_modules/@oai/artifact-tool'),
  );
  log(`  node: ${mb(dirSize(path.join(stage, 'node')))}`);

  step('LibreOffice');
  copyDir(path.join(DEPS, 'native/libreoffice-headless/libreoffice'), path.join(stage, 'libreoffice'));
  log(`  libreoffice: ${mb(dirSize(path.join(stage, 'libreoffice')))}`);

  step('Poppler');
  copyDir(path.join(DEPS, 'native/poppler/poppler'), path.join(stage, 'poppler'));
  const POP = path.join(stage, 'poppler');
  for (const rel of ['include', 'conda-meta', 'ssl', 'sbin',
    'share/gir-1.0', 'share/locale', 'share/terminfo', 'share/man', 'share/doc', 'share/info']) {
    fs.rmSync(path.join(POP, rel), { recursive: true, force: true });
  }
  for (const e of fs.readdirSync(path.join(POP, 'lib'))) {
    if (e.endsWith('.a') || e === 'pkgconfig' || e === 'cmake') {
      fs.rmSync(path.join(POP, 'lib', e), { recursive: true, force: true });
    }
  }
  const KEEP_BINS = ['pdftoppm', 'pdfinfo', 'pdftocairo', 'pdfimages'];
  const popBin = path.join(POP, 'bin');
  for (const e of fs.readdirSync(popBin)) {
    if (!KEEP_BINS.includes(e)) fs.rmSync(path.join(popBin, e), { force: true });
  }
  log(`  poppler: ${mb(dirSize(path.join(stage, 'poppler')))}`);

  step('清理坏链接');
  // 上面裁掉 share/terminfo 之后，ncurses 的 lib/terminfo -> ../share/terminfo
  // 就悬空了；Codex 运行时里还有几条绝对链接。统一在这儿扫一遍。
  const pruned = pruneBrokenSymlinks(stage);
  for (const line of pruned) log(`  删掉 ${line}`);
  if (pruned.length === 0) log('  没有');

  step('CJK 字体');
  const fontDir = path.join(stage, 'libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype');
  if (!fs.existsSync(fontDir)) fail(`LibreOffice 字体目录不存在: ${fontDir}`);
  for (const f of await fetchCjkFonts()) {
    fs.copyFileSync(f, path.join(fontDir, path.basename(f)));
    log(`  装入 ${path.basename(f)}`);
  }

  step('shim');
  const SHIMS = {
    soffice: 'libreoffice/LibreOfficeDev.app/Contents/MacOS/soffice',
    pdftoppm: 'poppler/bin/pdftoppm',
    pdfinfo: 'poppler/bin/pdfinfo',
    pdftocairo: 'poppler/bin/pdftocairo',
    pdfimages: 'poppler/bin/pdfimages',
    python3: 'python/bin/python3.12',
    python: 'python/bin/python3.12',
    node: 'node/node',
  };
  const ON_PATH = ['soffice', 'pdftoppm', 'pdfinfo', 'pdftocairo', 'pdfimages'];
  for (const [name, target] of Object.entries(SHIMS)) {
    if (!fs.existsSync(path.join(stage, target))) fail(`shim ${name} 的目标不存在: ${target}`);
    writeShim(stage, path.join(stage, 'bin'), name, target);
    if (ON_PATH.includes(name)) writeShim(stage, path.join(stage, 'path'), name, target);
  }

  step('打包运行时');
  packTarZst(DIST, runtimeName, RUNTIME_TAR);
  log(`  ${RUNTIME_TAR}  ${mb(fs.statSync(RUNTIME_TAR).size)}`);
  fs.rmSync(stage, { recursive: true, force: true });
}

function uploadRuntime() {
  if (spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status !== 0) {
    fail('gh 没登录，没法 --upload。先 gh auth login，或手工把文件拖到 tag=runtime 的 Release。');
  }
  step('上传 runtime Release');
  const view = spawnSync('gh', ['release', 'view', 'runtime', '--repo', SLUG], { stdio: 'ignore' });
  if (view.status !== 0) {
    execFileSync('gh', [
      'release', 'create', 'runtime', '--repo', SLUG, '--title', 'runtime',
      '--notes', '文档插件运行时底包。CI 打插件包时下载这一份，再叠仓库源码。',
    ], { stdio: 'inherit' });
  }
  execFileSync('gh', ['release', 'upload', 'runtime', RUNTIME_TAR, '--repo', SLUG, '--clobber'], {
    stdio: 'inherit',
  });
}

function writeShim(stage, dir, name, targetFromRoot) {
  fs.mkdirSync(dir, { recursive: true });
  const rel = path.relative(dir, path.join(stage, targetFromRoot));
  fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec "\${DIR}/${rel}" "$@"
`);
  fs.chmodSync(path.join(dir, name), 0o755);
}

function writePlatformManifest(manifestPath, asset) {
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { name: 'riot', owner: { name: 'Riot' }, plugins: [] };
  let entry = manifest.plugins.find((p) => p.name === PACK_NAME);
  if (!entry) {
    entry = { name: PACK_NAME, source: { source: 'archive', platforms: {} } };
    manifest.plugins.push(entry);
  }
  entry.description = PACK_DESCRIPTION;
  entry.version = PACK_VERSION;
  entry.author = { name: 'Riot' };
  entry.category = 'documents';
  entry.tags = ['docx', 'xlsx', 'pptx', 'pdf'];
  entry.source ??= { source: 'archive', platforms: {} };
  entry.source.source = 'archive';
  entry.source.platforms ??= {};
  entry.source.platforms[PLATFORM] = asset;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function packTarZst(parent, basename, dest) {
  const tar = dest.replace(/\.zst$/, '');
  fs.rmSync(tar, { force: true });
  fs.rmSync(dest, { force: true });
  execFileSync('tar', ['-cf', tar, '-C', parent, basename], {
    stdio: 'inherit',
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  execFileSync(process.execPath, [path.join(HERE, 'zstd.mjs'), tar, dest, '19'], { stdio: 'inherit' });
  fs.rmSync(tar, { force: true });
}

function unpackTarZst(file, dest) {
  const tar = path.join(CACHE, `${path.basename(file, '.zst')}-${process.pid}.tar`);
  execFileSync(process.execPath, [path.join(HERE, 'zstd.mjs'), '-d', file, tar], { stdio: 'inherit' });
  const tmp = path.join(CACHE, `unpack-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync('tar', ['-xf', tar, '-C', tmp], { stdio: 'inherit' });
  fs.rmSync(tar, { force: true });
  const kids = fs.readdirSync(tmp).filter((n) => !n.startsWith('.'));
  if (kids.length !== 1) fail(`${file} 顶层该有一个目录，实际: ${kids.join(', ')}`);
  const inner = path.join(tmp, kids[0]);
  // `[约束]` 这里不能用 fs.cpSync：它默认（verbatimSymlinks 关）把相对符号链接
  // 改写成源文件的绝对路径，下一行把 tmp 一删，包里 147 条动态库别名全部悬空
  // —— 0.2.0 就是这么坏的。同一个文件系统里 rename 是瞬间的，链接、权限、
  // 时间戳原样。
  for (const name of fs.readdirSync(inner)) {
    fs.renameSync(path.join(inner, name), path.join(dest, name));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 装到别的机器上必坏的符号链接：目标是绝对路径的（打包机的路径，用户机器
// 上没有）、指到树外的、目标不存在的。返回一行一条的描述。
function findBrokenSymlinks(root) {
  return [...brokenSymlinks(root)].map(({ link, target, reason }) =>
    `${path.relative(root, link)} -> ${target}（${reason}）`);
}

// 删掉 findBrokenSymlinks 找到的那些。悬空的链接和没有这条链接对程序是一回事，
// 留着只会让排查方向跑偏。返回删了哪些，给日志。
function pruneBrokenSymlinks(root) {
  const gone = [];
  for (const { link, target, reason } of brokenSymlinks(root)) {
    fs.rmSync(link, { force: true });
    gone.push(`${path.relative(root, link)} -> ${target}（${reason}）`);
  }
  return gone;
}

function* brokenSymlinks(root) {
  for (const link of walkSymlinks(root)) {
    const target = fs.readlinkSync(link);
    const resolved = path.resolve(path.dirname(link), target);
    const rel = path.relative(root, resolved);
    const reason = path.isAbsolute(target) ? '绝对路径'
      : rel.startsWith('..') || path.isAbsolute(rel) ? '指向树外'
        : !fs.existsSync(resolved) ? '目标不存在'
          : null;
    if (reason) yield { link, target, reason };
  }
}

function* walkSymlinks(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) yield p;
    else if (e.isDirectory()) yield* walkSymlinks(p);
  }
}

async function fetchCjkFonts() {
  const url = 'https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/08_NotoSansCJKsc.zip';
  const zip = path.join(CACHE, 'NotoSansCJKsc.zip');
  if (!fs.existsSync(zip) || fs.statSync(zip).size < 1024 * 1024) {
    log('  下载 Noto Sans CJK SC（约 90MB,已缓存则跳过）…');
    const res = await fetch(url);
    if (!res.ok) fail(`字体下载失败: ${res.status} ${url}`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  const out = path.join(CACHE, 'noto');
  fs.rmSync(out, { recursive: true, force: true });
  execFileSync('unzip', ['-o', '-q', zip, '-d', out]);
  const want = ['NotoSansCJKsc-Regular.otf', 'NotoSansCJKsc-Bold.otf'];
  const found = [...walk(out)].filter((f) => want.includes(path.basename(f)));
  if (found.length !== want.length) {
    fail(`字体包里没找到 ${want.join(' / ')}`);
  }
  return found;
}

function copyDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync('cp', ['-Rpc', src, dest]);
}

function pruneCaches(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__pycache__') fs.rmSync(p, { recursive: true, force: true });
      else pruneCaches(p);
    } else if (e.name.endsWith('.pyc')) {
      fs.rmSync(p, { force: true });
    }
  }
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

function dirSize(dir) {
  return Number(execFileSync('du', ['-sk', dir]).toString().split('\t')[0]) * 1024;
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest('hex');
}

function mb(bytes) { return `${(bytes / 1024 / 1024).toFixed(0)}MB`; }
function log(m) { console.log(m); }
function step(m) { console.log(`\n[${m}]`); }
function fail(m) { console.error(`\n错误: ${m}\n`); process.exit(1); }
