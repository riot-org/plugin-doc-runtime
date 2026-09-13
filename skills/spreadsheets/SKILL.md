---
name: "Spreadsheets"
description: "创建、编辑、分析和校验 .xlsx / .xls / .csv / .tsv 电子表格,通过 artifact_session_run 工具完成,支持真实公式求值。不用于控制正在运行的 Excel 应用。"
---

# Spreadsheets skill
Read entirely for spreadsheet creation, editing, analysis, or visualization.

## Decision Boundary

默认用 `artifact_session_run` 创建和编辑电子表格。Riot 版本里的 Google Sheets 链路依赖它的 Drive connector,Riot 没有,已移除。

## 运行时

Riot 在启动工具进程时已经把文档运行时接好了,不需要任何发现或安装步骤。三个环境变量总是可用:

- `RUNTIME_BIN_DIR` — 包内所有可执行文件所在目录
- `RUNTIME_NODE` — Node 可执行文件
- `RUNTIME_NODE_MODULES` — 含 `@oai/artifact-tool` 的包目录

**跑 Python 必须写成 `"$RUNTIME_BIN_DIR/python3"`,跑 Node 必须写成 `"$RUNTIME_NODE"`。** 直接敲 `python3` 或 `node` 拿到的是用户自己的解释器 —— 那里面没有 python-docx、python-pptx、openpyxl,脚本会以 ImportError 失败。这两个刻意不放进 `PATH`,免得盖掉用户项目的虚拟环境。

`pdftoppm`、`pdfinfo` 在 `PATH` 上,按名字直接调即可。LibreOffice **不在** `PATH` 上 —— 它的目录里带着自己的 `python.exe`,放进 `PATH` 会盖掉用户的 Python。要用它就调 skill 自带的 `render_docx.py`,那个脚本自己会从 `RUNTIME_BIN_DIR` 找。

不要用 `brew`、`apt`、`pip install`、`npm install` 装任何东西 —— 目标用户机器上没有开发环境,装不上,也不需要装。如果某个 `RUNTIME_*` 变量缺失,说明文档插件没装好,直接报阻塞,不要自己找替代路径。

## Important Instructions
- For new workbooks or authorized redesigns, plan the simplest correct workbook that meets the task, audience, actual data and domain. If formulas become hard to read, first reconsider whether the workbook’s structure, layout, or logic is overcomplicated before simplifying individual formulas. Remove unnecessary or duplicated logic while preserving calculation correctness, required business relationships, and financial reconciliation
- Instruction precedence for workbook content, layout, and formatting is: user request > reference/template > domain defaults/conventions > general defaults.

## Tools + Contract Requirements

- 电子表格的创建和编辑一律走 `artifact_session_run` 这个 MCP 工具,它就是 `@oai/artifact-tool` 的服务端封装,API 与 `artifact_tool_docs/` 里写的完全一致。
- **每次调用都必须显式传 `target` 绝对路径。** Riot 会从会话 id 推断输出位置,Riot 不提供这个,漏传就会写到你预期之外的地方。创建新文件时同时传 `create: true`。
- 要把 `.xlsx` / `.pptx` 落到磁盘,在 `code` 里显式 `await workbook.export({ format: "xlsx", fileName: "…" })`(演示文稿用对应的 export),并传 `outputDirectory`。工具不再自动写到 `target`。
- `code` 参数里的脚本运行在 workbook 上下文中,可以直接用 `workbook`,通过 `return` 把要回读的值带出来。
- 不要用 `openpyxl`、`xlsxwriter`、`pandas.ExcelWriter` 来写工作簿 —— 它们不做公式求值,存出来的公式没有缓存值,Excel 之外的工具全读成空。反向校验时用 `openpyxl` 读是可以的。
- 需要在工作簿之外做数据处理时,用文档插件里的 Python 存 JSON/CSV 中间结果,再由 `artifact_session_run` 写进工作簿。可审计的计算要以公式形式留在表里。
- 复杂表格任务用 `TodoWrite` 记待办。
- 交付时用普通 Markdown 链接或绝对路径指向最终文件,正文里说明改了什么。渲染出的 PNG 和中间 PDF 只用于你自己的质检,除非用户明确要,否则不要交付。

## Writing Quality and Authored Content
For newly authored content, including additions during edits:

- Write for intended audience. Never include internal file paths, authoring commentary, planning notes, or requester instructions in the artifact unless explicitly requested. Do not repeat audience or style directives such as “executive-friendly” in headings, content, or comments.

- Use concise, literal subject titles and labels. Put company, timeframe and source context in subtitles or nearby notes.
  - Good: `Weekly metrics`. Bad: `Follow the weekly trends`
  - Good: `Monthly results`. Bad: `Decision-ready monthly impact analysis`
  - Good: `Income and household assumptions`. Bad: `Same paycheck. Different purchasing power.`

- Prefer direct, specific human wording. Avoid slogans, buzzwords, invented terminology, vague framing and formulaic claims.
  - Good: `Contributions decreased`. Bad: `Contributions waned`
  - Good: `Permanent drop in commuting`. Bad: `Structurally lower commute base`
  - Good: `Revenue metrics`. Bad: `Strategic Value Drivers`

- Avoid AI-like sentence constructions when simpler wording is clearer:
  - Semicolons: `Travel demand and employment from Jan to Feb. Persistent behavior shifts are shaping recovery.` not `Travel demand and employment fell from Jan to Feb; persistent behavior shifts are shaping the path back.`
  - Passive voice: `The team approved the proposal.` not `The proposal was approved by the team.`
  - Contrast slogans like `It’s not X, it’s Y`: `Humidity exposure over time` not `Humidity is an exposure trajectory, not a setpoint.`

- Keep wording factual, parseable and supported by the workbook.
  - Good: `Transit use is at 79%, matching pre-pandemic levels`
  - Bad: `79% Transit use back to pre-pandemic`

- Avoid AI-style decoration in titles and labels: bullets, icons, emoji, pipe-delimited titles, decorative arrows, or generic suffixes such as `review`, `impact`, `analysis`, or `dashboard`.
  - Good: `$ in USD`
  - Bad: `$ in USD • monthly • forecast`

- For checks and logic, be specific:
  - Bad: `Signal integrity: BLOCKED`. Good: `Missing input: forecast rate` (a specific functional warning)

- Do not include motivational wording, self-assessment, repeated setup. Do not add decorative badges, confidence ratings, status tags or PASS/WARN/BLOCKED banners.
  - Bad: `This workbook is source-backed and ready for review`. Omit the self-assessment, and keep needed sources and limitations besides analysis if actually useful.

User requests and preferences always take priority. For edits, follow existing writing style in the workbook.

## Workflows
Required:
- `workflows/edit_workflows.md` for existing files/follow-ups.
- `workflows/create_workflows.md` for new files

## Resources
Read the following BEFORE starting the task:

Required:
- `artifact_tool_docs/API_QUICK_START.md` for `artifact_tool` JS API documentation. Read entirely.
- `style_guidelines.md` for formatting.

As applicable:
- `references/template-elicitation.md`: if user has not provided a template, reference, or visual direction.
- `references/image-references.md`: if a reference image or screenshot is provided.
- `references/read_only_qna.md`: for Q&/audits
- `features/charts.md`: for creating or editing charts.

## Domain Requirements
Read only relevant guidance:
- Finance and investment banking: `domain_guidance/financial_models.md`
- Corporate finance and FP&A: `domain_guidance/corporate_finance_fpa.md`
- Healthcare: `domain_guidance/healthcare.md`
- Marketing and advertising: `domain_guidance/marketing_advertising.md`
- Scientific research: `domain_guidance/scientific_research.md`

## Create and Edits
For any task that requires modifying or creating a workbook:

### Formula Correctness
Apply to newly added or edited formulas, alongside the relevant create/edit workflow.

- Keep raw data, assumptions, editable mappings, scoring rules and thresholds in labeled inputs/tables. Mathematical, index and control constants may remain in formulas.
- Keep calculated outputs formula-driven so they update with inputs. Use consistent patterns across comparable rows and projection periods, preserving intentional differences. Reuse shared results; keep independent reconciliation checks independent.
- Use the simplest correct, human-readable formula. Formulas must be **easily auditable**. Do not perform complex calculations in a single cell when possible. Instead, use helper cells for intermediate values, direct references, arithmetic, aggregates and lookups like INDEX/MATCH/XLOOKUP, SUMIFS etc. Use supported LET, IF or arrays only when they improve clarity. Users should be able to trace the model from inputs to outputs easily.
- Reuse results or shared checks only when inputs, periods, units, rounding and overrides match; gate only affected outputs. Add helpers for meaningful repeated work, not trivial expressions; narrow edits do not authorize new helper ranges. Compute shared intermediate calculations once in labeled helper cells.
- Make formulas copy/fill-safe: reference destination headers/IDs, anchor only fixed sources, and use keyed lookups when layouts differ. Derive period filters/labels from destination keys;
- Quote cross-sheet names, e.g. ='Sheet Name'!A1.
- Keep workbook validation useful and proportional to realistic input risks. Reuse checks and separate them from calculations. Block outputs only when invalid inputs would make them misleading; do not invent business restrictions to validate inputs.
- Handle expected missing/invalid inputs explicitly; avoid blanket IFERROR wrappers or plausible-zero substitutes for unexpected errors. When simplifying, preserve calculation meaning, intended blank/error behavior, one-offs and overrides. Remove redundant guard layers while preserving checks that expose invalid source data.
- Scale verification to complexity and risk: check references/results for simple formulas; test representative inputs, copies and affected outputs for complex or consequential calculations. Keep authoring-only tests out of the workbook.
- For source-backed analyses, spot-check representative outputs and reconcile key totals with source definitions.
- Use numeric tolerances consistent with required calculation precision; compare identifiers, integer counts and categories exactly.

### Data Formatting Rules
- Store numbers, percentages, currency, and dates as typed spreadsheet values, not preformatted strings. Use text only for true identifiers such as ZIP codes, account IDs, SKUs, or labels.
- Use Excel-invariant number/date format codes, not locale-specific display strings. Generic examples include `#,##0`, `#,##0.0`, `0.0%`, `0.00%`, `"$"#,##0`, `"$"#,##0.00`, `yyyy-mm-dd`, `mmm yyyy`. Existing workbook/reference, and domain conventions take priority;
- Percentages: Follow the domain or reference's precision. Otherwise, use 1 decimal for most analytical cells, 0 decimals for dashboard outputs, and 2 decimals where small rate differences matter.
- Do not swap `.` and `,` in format codes to mimic locale separators; separators are controlled by spreadsheet/render locale. Use `0.0%`, not `0,0%`, and `#,##0`, not `#.##0`.
- Choose the appropriate format for readability. Match precision to meaning: counts use `#,##0`; rates usually use `0.0%` or `0.00%`; currency uses whole units unless cents matter.

### Verification Rules
Before final response, apply these checks within the authorized changes and their dependencies. Report unrelated pre-existing defects without repairing them.

1. Inspect key ranges:
```js
const check = await workbook.inspect({
  kind: "table",
  range: "Dashboard!A1:H20",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 12,
});
console.log(check.ndjson);
```

2. Scan formula errors:
```js
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);
```

3. Render sheets/ranges to verify visual output (skip if already verified and no style changes):
```js
const blob = await workbook.render({ sheetName: "Sheet1", range: "A1:H20", scale: 2 });
```
For creation or broad authorized restructuring, visually review every sheet. For a narrow edit, review the changed view and affected dependencies, then compare all tabs with the source for unintended value, formula, object, validation or style changes. Do not repeatedly render unchanged tabs; investigate any scope-preservation failure.

Visual requirements:
- Fix severe defects before finalizing: blank/broken charts, low-contrast text, unreadable font sizes, clipped headers/numbers or chart data/axis labels, obvious formula errors, default blank sheets, or content outside the visible working area.
- Ensure logical labels or titles appear once and have a clear layout
- Ensure text is visible and columns/rows are appropriately sized; verify chart labels, axis ticks and fonts at normal zoom.

4. Keep verification compact:
- Use Artifact Tool to verify requested features and results, reusing checks for unchanged content.
- Investigate the saved file further only when there is a specific export concern.
- Avoid arbitrary formula count checks, assumptions about file storage, and huge NDJSON dumps.

5. Export:
```js
await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/output.xlsx`);
```

6. Finalize immediately after successful export and checks above.
- Do not export extra `.xlsx` variants unless asked.

### Citation Requirements
- Cite sources inside the spreadsheet
- Use plain-text URLs in spreadsheet cells.
- For financial models, preserve provenance through existing source conventions, a compact source table or an existing supported cell annotation. Prefer a table for repeated inputs; do not force a new table into a narrow edit.
- Do not add cell comments or cell notes unless the user requests them. Preserve existing annotations; put needed new source or assumption context in ordinary cells within scope.
- For researched row-wise data tables, include source URLs in a dedicated source column.
- When comments are requested, keep them succinct, minimal and easy to read.
- Use one supported annotation path per cell; update an existing note/thread rather than layering another system over it. Reject duplicate cell references in a legacy comment part. Repair the authoring path rather than deleting provenance to make export succeed.

## Completion Criteria
### Criteria for Question / Read only requests
- Answer from the available workbook context. Do not edit or overwrite unless the user asks for a workbook change.

### Criteria for all create and edit requests
Complete only when:
- Content is populated, addresses the user's request, and formulas compute, with no obvious formula errors in key scanned ranges (including bad-reference, off-by-one or circular errors).
- `.xlsx` saved to `outputs/<unique_thread_id>/`.
- Visual verification passes: organized, legible layout matches requested style or default/existing edit baseline; all important numbers/callouts are visible; numbers, text, charts and content are unclipped without awkward wrapping.
- Required controls, charts, panes and requested features exist.

## Error Recovery
On first tool or API error:
1. Read error text.
2. Consult the selected workflow's targeted help or schema discovery only if needed.
3. Retry with minimal patch (not full rewrite).
4. Continue from existing workbook state.

Do not loop indefinitely on similar failures.

## Comment Author
- If the authenticated/user profile or env context provides a user display name, use it as the threaded comment display name unless the user requests another name. Default to `User`.

## Source, PDF, and Attachment Processing
- Keep source notes compact: record file name, section/table label, and enough context to audit the number. Do not paste large PDF excerpts into the workbook unless requested.
- Bundled Python libraries available in the bundled runtime environment for extraction/analysis include `pandas`, `numpy`, `pypdf`, `python-docx`, and `reportlab`. You may read/extract in separate scripts if needed.
- Bundled JS libraries available for document/PDF work include `docx`, `pdf-lib`, and `pdfjs-dist`.
