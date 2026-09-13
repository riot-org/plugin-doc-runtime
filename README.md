# plugin-doc-runtime

[Riot](https://github.com/riot-org/Riot) 的文档插件源码：创建和编辑 Word、Excel、PowerPoint、PDF。

这个仓库是标准 Agent Plugin 布局（`plugin.json` + `skills/` + `mcp.json`）。Python / Node / LibreOffice 那些运行时**不在 git 里** —— 打包时从本机 Codex 运行时抽出，打成 tar.zst 放到本仓库的 [Releases](https://github.com/riot-org/plugin-doc-runtime/releases)。官方市场上架条目在 [`riot-org/riot-marketplace`](https://github.com/riot-org/riot-marketplace)。

用户在 Riot 里从市场安装，不要 clone 本仓库当安装包：源码树里没有二进制，链本地目录会自检失败。

## 目录

```
plugin.json     身份和 Riot 接线（extensions["dev.riot"]）
mcp.json        artifact-tool MCP
skills/         documents / spreadsheets / presentations / pdf
```

## 改 skill

直接改 `skills/<名>/`。改完在 Riot 仓库打包：

```bash
# macOS
node scripts/build-doc-plugin.mjs

# Windows
pwsh scripts/build-doc-plugin.ps1

# 两个平台的产物都到齐之后
node scripts/doc-plugin/publish.mjs
```

构建读本仓库源码，产物写到 Riot 的 `dist/doc-plugin/<平台>/`，再上传到 Releases。不要把 tar.zst 或平台清单提交进来。

Codex 上游 skill 大改时，在 Riot 仓库跑一次导入（会覆盖 `skills/`，再自己审 diff）：

```bash
node scripts/doc-plugin/import-skills.mjs
```
