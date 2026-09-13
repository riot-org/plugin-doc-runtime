---
name: "pdf"
description: "创建、填写和校验 PDF。用 reportlab 生成,pdfplumber / pypdf 读取和填 AcroForm 表单,pdftoppm 渲成 PNG 后逐页目检再交付。"
---

# PDF Skill

## When To Use

- Read or review PDF content where layout and visuals matter.
- Create PDFs programmatically with reliable formatting.
- Fill and validate interactive PDF forms.
- Validate final rendering before delivery.

## Tools + Contract Requirements

## Workflow

1. Prefer visual review: render PDF pages to PNGs and inspect them.
   - Use `pdftoppm` from the bundled runtime or system Poppler when available.
   - If unavailable, install Poppler or ask the user to review the output locally.
2. Use `reportlab` to generate PDFs when creating new documents.
3. Use `pdfplumber` or `pypdf` for text extraction and quick checks; do not rely on text extraction for layout fidelity.
4. After each meaningful update, re-render pages and verify alignment, spacing, and legibility.

## Fill And Validate AcroForms

Visual review alone is not a correctness check for a fillable PDF. A page `/Widget` annotation can render a value from its appearance stream while the canonical `/AcroForm/Fields` tree is missing or contains a stale value.

1. Keep the result interactive by default; set `flatten=True` only when the user explicitly requests a completed, static form. Preserve the source PDF, and do not flatten a signed PDF without an explicit workflow decision.
2. Inspect both representations before filling: enumerate fields from `reader.get_fields()` and `/Widget` annotations from every page's `/Annots`, following `/Parent` and `/Kids`. If a widget and a canonical field have the same name but are distinct objects with no `/Parent` relationship, do not call `reattach_fields()` blindly: it can create a second top-level field with the same name. Report the ambiguity or produce a static result.
3. Recover genuinely orphaned widgets, fill all pages, and write the result with `pypdf`:

```python
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

reader = PdfReader(input_pdf)
writer = PdfWriter()
writer.clone_document_from_reader(reader)

# Restores widgets that are missing from /AcroForm/Fields.
writer.reattach_fields()
fields = writer.get_fields() or {}
missing = set(expected_values) - set(fields)
if missing:
    raise ValueError(f"Form fields not found after repair: {sorted(missing)}")

values_to_write = dict(expected_values)
if flatten:
    # Paint every existing value before removing every widget.
    values_to_write = {
        name: field.get("/V", "/Off" if field.get("/FT") == "/Btn" else "")
        for name, field in fields.items()
    }
    values_to_write.update(expected_values)

writer.update_page_form_field_values(
    None, values_to_write, auto_regenerate=False, flatten=flatten
)

if flatten:
    # pypdf's flatten=True paints appearances but does not remove widgets.
    writer.remove_annotations(subtypes="/Widget")
    writer.root_object.pop(NameObject("/AcroForm"), None)

with open(output_pdf, "wb") as stream:
    writer.write(stream)
```

4. Reopen the written PDF before delivery. For an interactive result, require every expected field to be present in `get_fields()` with the expected `/V`, enumerate page widgets again, and confirm their effective `/V` (the widget value or inherited `/Parent` value) agrees. Confirm each updated widget has a non-empty `/AP` `/N` appearance and render the final pages to catch stale or clipped appearances. Do not rely on `/NeedAppearances` or a successful PNG render as proof that logical field data was updated.
5. For a flattened result, require zero `/Widget` annotations and no remaining `/AcroForm` field tree after reopening, then render the final pages. Keep an editable copy when the user may need to revise the form.

## Temp And Output Conventions

- Use `tmp/pdfs/` for intermediate files; delete them when done.
- Write final artifacts under `output/pdf/` when working in this repo.
- Keep filenames stable and descriptive.

## Dependencies

Riot 在启动工具进程时已经把文档运行时接好了,不需要任何发现或安装步骤。三个环境变量总是可用:

- `RUNTIME_BIN_DIR` — 包内所有可执行文件所在目录
- `RUNTIME_NODE` — Node 可执行文件
- `RUNTIME_NODE_MODULES` — 含 `@oai/artifact-tool` 的包目录

**跑 Python 必须写成 `"$RUNTIME_BIN_DIR/python3"`,跑 Node 必须写成 `"$RUNTIME_NODE"`。** 直接敲 `python3` 或 `node` 拿到的是用户自己的解释器 —— 那里面没有 python-docx、python-pptx、openpyxl,脚本会以 ImportError 失败。这两个刻意不放进 `PATH`,免得盖掉用户项目的虚拟环境。

`pdftoppm`、`pdfinfo` 在 `PATH` 上,按名字直接调即可。LibreOffice **不在** `PATH` 上 —— 它的目录里带着自己的 `python.exe`,放进 `PATH` 会盖掉用户的 Python。要用它就调 skill 自带的 `render_docx.py`,那个脚本自己会从 `RUNTIME_BIN_DIR` 找。

不要用 `brew`、`apt`、`pip install`、`npm install` 装任何东西 —— 目标用户机器上没有开发环境,装不上,也不需要装。如果某个 `RUNTIME_*` 变量缺失,说明文档插件没装好,直接报阻塞,不要自己找替代路径。

# macOS (Homebrew)
brew install poppler

# Ubuntu/Debian
sudo apt-get install -y poppler-utils
```

If installation is not possible in this environment, tell the user which dependency is missing and how to install it locally.

## Environment

无需额外环境变量,上面那些由 Riot 预置。

## Rendering Command

```bash
pdftoppm -png "$INPUT_PDF" "$OUTPUT_PREFIX"
```

## Quality Expectations

- Maintain polished visual design: consistent typography, spacing, margins, and section hierarchy.
- Avoid rendering issues: clipped text, overlapping elements, broken tables, black squares, or unreadable glyphs.
- Charts, tables, and images must be sharp, aligned, and clearly labeled.
- Use ASCII hyphens only. Avoid U+2011 and other Unicode dashes.
- Citations and references must be human-readable; never leave tool tokens or placeholder strings.

## Final Checks

- Do not deliver until the latest PNG inspection shows zero visual or formatting defects.
- Confirm headers, footers, page numbering, and section transitions look polished.
- Keep intermediate files organized or remove them after final approval.
