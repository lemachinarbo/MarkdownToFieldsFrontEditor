# MarkdownToFieldsFrontEditor

This is the **front‑end editor** for [MarkdownToFields](https://github.com/lemachinarbo/MarkdownToFields).
The name is horrible, but it lets you double‑click tagged content and edit it right on the page (yes I know ProcessWire does that, but this is different and this is mine).

It is NOT a standalone module. It only works **together** with MarkdownToFields.

## What it does

- Double‑click any tag field `<!-- field -->` container field `<!-- container... -->`, section `<!-- section:name -->` or subsection `<!-- sub:name -->` to edit it.
- Save the change back to the markdown file.
- Supports multiple languages (uses ProcessWire languages).
- It supports two different views: 

### Inline 

`Ctrl + double click` The best for quick edits (Only avaible for `tag fields`).

<img src="docs/inline.png" width="700">

### Fullscreen 
`double click` Amazing for comparing content in different languages

<img src="docs/fullscreen.png" width="700">


## Install

**MarkdownToFields** must be installed and your content ready and tagged. The module auto‑detects `tag fields` and `container fields` once it’s installed. And you can edit them by double‑clicking.

1. Install the module using your preferred [method](https://modules.processwire.com/install-uninstall/).
2. Give your editors the `page-edit-front` permission.


## Configuration

In module settings:

- **Toolbar Buttons**: comma list like:
  `bold,italic,strike,paragraph,|,h1,h2,h3,|,ul,ol,blockquote,|,link,unlink,|,code,codeblock,clear,|,split`

Notes:
- `|` adds a separator.
- `save` is always shown at the end.

## Editing Behavior

- **Tag fields**: `Ctrl + double-click` opens **inline** editor.
- **All other targets**: double-click opens **fullscreen** editor.

If a section only contains subsections, it may not have its own content. In that case the section breadcrumb is shown but not clickable.

### Template Output Notes

- Rendering `->html` preserves the original MarkdownToFields HTML, so the editor can auto‑wrap fields and show **rollover** zones.
- Rendering `->text` (or otherwise transforming the HTML) breaks that exact match, so **field rollovers won’t appear**.
  - In this case, you can still define explicit section/subsection hosts in your template (see below).

### Explicit Mount Contract (Recommended for Deterministic Preview)

Live preview updates are now **strict-key based**.  
The editor replaces HTML inside:

- `.fe-editable` field nodes
- explicit mount nodes with `data-mfe-slot`
- read-only `data-mfe` hosts (`section` / `subsection`) when the host is a safe direct mount

No runtime DOM injection or wrapper insertion is used.

Use these mounts in templates:

**Section mount**
```html
<section data-mfe="hero">
  <div data-mfe-slot="section:hero"></div>
</section>
```

**Subsection mount**
```html
<div data-mfe="hero/left">
  <div data-mfe-slot="subsection:hero:left"></div>
</div>
```

**Field mount (`.fe-editable` metadata)**
```html
<div
  class="fe-editable md-edit"
  data-mfe-scope="field"
  data-mfe-section="hero"
  data-mfe-name="title"
  data-page="1234"
  data-markdown-b64="..."
></div>
```

Key rules:
- `section:{name}` -> `data-mfe-slot="section:{name}"`
- `subsection:{section}:{sub}` -> `data-mfe-slot="subsection:{section}:{sub}"`
- `field` keys are resolved from `.fe-editable` metadata (`scope/section/subsection/name`)
- `data-mfe="foo"` and `data-mfe="foo/bar"` are auto-mapped at runtime as section/subsection mounts when safe.
- If a changed key has no mount, save still works, but live preview for that key is skipped.


#### Clicking the zones

Depending on your layout, when double clicking a clickable zone you can click a real link therefore you will be redirected to anopther page. In those cases use ctrl + click.

## Requirements

- ProcessWire + MarkdownToFields
- Tagged markdown (content tags)
- `page-edit-front` permission

## Support

This module is small and opinionated. If something breaks, start by (shaking) checking:

- the markdown file
- the tags (`<!-- name -->`, `<!-- name... -->`, `<!-- section:name -->`, `<!-- sub:name -->`)
- the permission (`page-edit-front`)
- the AI

## License

UBC+P.

Use it.
Break it.
Change it.
And if you make money, buy us some pizza.

Deployed by [mutants.txt](mutants.txt)
