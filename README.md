# plugin-doc-runtime

[Riot](https://github.com/riot-org/Riot) 的文档插件：创建和编辑 Word、Excel、PowerPoint、PDF。包内自带 Python、Node、LibreOffice 和中文字体，不要求用户机器上有开发环境。

官方市场上架条目在 [`riot-org/riot-marketplace`](https://github.com/riot-org/riot-marketplace)，本仓库只负责插件本身和按平台的 Release 资产。

## 仓库布局

```
darwin-arm64/
  marketplace.json           这个平台构建时产出的清单片段
  doc-runtime-0.2.0-darwin-arm64.tar.zst
win-x64/
  marketplace.json
  doc-runtime-0.2.0-win-x64.tar.zst
```

`.tar.zst` **不在 git 里**（见 `.gitignore`）。GitHub 拒收超过 100MB 的单个文件；Git LFS 的免费额度也撑不住这个量级的下载。包体走 Releases。

包必须在对应平台的机器上制作 —— `skia.node` 之类的原生绑定按平台编译，没法交叉产出。

## 发布

在 Riot 仓库里：

```bash
# macOS
node scripts/build-doc-plugin.mjs

# Windows
pwsh scripts/build-doc-plugin.ps1

# 任一台机器上，等两个平台的产物都到齐之后
node scripts/doc-plugin/publish.mjs
```

`publish.mjs` 会把各平台清单并进 `riot-marketplace` 的 `marketplace.json`、比对 sha256、把 `.tar.zst` 传到**本仓库**的 Releases，最后分别推两个仓库。清单最后推：Riot 一读到新清单就会去下对应的资产。
