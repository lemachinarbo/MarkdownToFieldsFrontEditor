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



### Live Preview Editor

When you save, this module does two things:

1. Saves markdown (this is the real source of truth).
2. Tries to patch the page live (preview only).

Live preview is **server-rendered fragment sync** (DataStar SSE).  
If a fragment cannot be resolved for a key, save is still correct and the editor falls back to updating only the editable node(s).  
If needed, refresh to see the fully re-rendered page.

Use `data-mfe` to mark preview zones:

```txt
data-mfe="body"              section
data-mfe="body/features"     subsection or section field
data-mfe="body/features/end" subsection field
data-mfe="title"             top-level field (optional shorthand)
```

Example:

```html
<div data-mfe="body/features/end">
  <?= $content->body->features->end->html ?>
</div>
```

`data-mfe` can use either:
- path form: `body/features/end`
- scoped form: `subsection:body:features:end`

Scoped form reference:
- `section:body`
- `subsection:body:features`
- `field:body:title`
- `subsection:body:features:end`

### Rendering The Same Field Twice

If the same content is rendered in multiple places, one node should be the main `data-mfe` mount.  
Extra copies should use `data-mfe-source` so they mirror the same saved content.

```html
<section data-mfe="body">
  <div data-mfe="body/features/end">
    <?= $content->body->features->end->html ?>
  </div>

  <aside>
    <div data-mfe-source="body/features/end">
      <?= $content->body->features->end->html ?>
    </div>
  </aside>
</section>
```

`data-mfe-source` accepts:
- path form: `body/features/end` (recommended)
- scoped form: `subsection:body:features:end`

### Identity Protocol (V0.5)

Live preview now uses a stamped canonical identity per mount.

- Authors keep writing shorthand (`data-mfe`, `data-mfe-source`).
- Compiler resolves canonical identity and stamps:
  - `data-mfe-key` (canonical key used across network)
  - `data-mfe-sig` (structural signature)
  - `data-mfe-key-id` (runtime patch selector id)
- In debug mode it also stamps:
  - `data-mfe-path` (human-readable path, e.g. `topics.description`)

Canonical keys:

```txt
section:hero
field:topics:title
subsection:methods:logos
subsection:methods:logos:cta
```

Important rule:
- If `data-mfe-key` is present, runtime uses that key directly (no shorthand inference for that node).

Debug helpers:
- `window.MarkdownFrontEditor.recompile()` -> recompute and restamp mount graph.
- `window.MarkdownFrontEditor.watch()` -> dev-only MutationObserver auto-recompile.
- `window.MarkdownFrontEditor.unwatch()` -> stop watch mode.

Diagnostics you may see in logs:
- `mfe_missing` -> fragment key not resolved server-side; editable-only fallback applied.
- `FRAGMENTS_GRAPH_MISMATCH` -> client and server mount graph checksums differ.
- `FRAGMENTS_STAMP_WARN` / `FRAGMENTS_STAMP_ERROR` -> stamped key mismatch or non-recomputable key on server render.



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
