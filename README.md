# plugin-doc-runtime

[Riot](https://github.com/riot-org/Riot) 的文档插件：创建和编辑 Word、Excel、PowerPoint、PDF。

仓库里是源码和打包脚本。Python / Node / LibreOffice / `@oai/artifact-tool` **不进 git**（单个包两百多 MB，且 artifact-tool 是 Codex 私有包）。运行时底包放在本仓库 [tag=`runtime` 的 Release](https://github.com/riot-org/plugin-doc-runtime/releases/tag/runtime)。改 skill 之后由 GitHub Actions 下载底包、叠源码、打安装包。

用户在 Riot 里从市场安装。不要把本仓库当安装目录链接：源码树里没有二进制，自检会失败。官方目录：[`riot-org/riot-marketplace`](https://github.com/riot-org/riot-marketplace)。

## 目录

```
plugin.json                 身份和 Riot 接线
mcp.json                    artifact-tool MCP
skills/                     documents / spreadsheets / presentations / pdf
scripts/build.mjs           macOS：seed 运行时 + 打插件包
scripts/build.ps1           Windows：用已有运行时打插件包
scripts/seed.ps1            Windows：从本机 Codex 抽出运行时（只需一次）
scripts/import-skills.mjs   从本机 Codex 更新 skills/
scripts/verify.mjs          对解开的包装完冒烟
.github/workflows/release.yml
```

## 日常：改源码，Actions 打包

1. 改 `skills/` 或 `plugin.json`（版本号在 `plugin.json`）。
2. 推到 `main`，打 tag：`git tag v0.2.1 && git push origin v0.2.1`（或在 Actions 里 Run workflow）。
3. Actions 在 `macos-14` / `windows-2022` 上各打一份，把打出来的 `.tar.zst` 解开跑一遍 `verify.mjs`（macOS 失败即中止发布），再上传到 `doc-runtime-v<版本>`。
4. 若仓库 Secrets 里有 `MARKETPLACE_TOKEN`（能推 `riot-org/riot-marketplace`），会顺带更新官方目录。没有就只发 Release，再手工并清单。

改了包里的任何东西都要升 `plugin.json` 的版本号再发：Riot 按 `<名字>-<版本>.tar.zst` 缓存下载，同版本换内容会撞校验和。

## 第一次：把运行时底包传上去

只在换 Codex 运行时、换 LibreOffice、换 artifact-tool 时才要重做。

```bash
# 装过 Codex 的 Mac
node scripts/build.mjs --seed --upload

# 装过 Codex 的 Windows（系统自带 powershell 即可，不必装 PowerShell 7）
powershell -ExecutionPolicy Bypass -File scripts\seed.ps1
gh release upload runtime dist\runtime-win-x64.tar.zst --repo riot-org/plugin-doc-runtime --clobber
```

本地打一份插件包（不经 Actions）：

```bash
node scripts/build.mjs
# 或
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

产物在 `dist/<平台>/`，不要提交。冒烟：`node scripts/verify.mjs <解开的插件目录>`。

## 从 Codex 更新 skill 正文

本机装过 Codex 文档插件时：

```bash
node scripts/import-skills.mjs
```

会覆盖 `skills/`，审完 diff 再提交。
