# MarkdownToFieldsFrontEditor

This is the **front‑end editor** for [MarkdownToFields](https://github.com/lemachinarbo/MarkdownToFields).

The name is horrible, but it lets you double‑click tagged content, edit it and preview it right on the page (yes I know ProcessWire does that, but this is different and this is mine).

It is NOT a standalone module. It only works **together** with MarkdownToFields.

## What you can do

- **Double‑click** any editable zone to open fullscreen editor
- **Ctrl + double‑click** tag fields for quick inline edits (Only available at the moment for simple `tag fields`))
- Edit in multiple languages side by side
- Changes save to markdown and preview live on the page

## Features

### Multilanguage support 
Compare and update content in different languages (uses ProcessWire languages).

<img src="docs/fullscreen.png" width="700">

### Inline editing (limited support)

`Ctrl + double click` The best for quick edits (Only available for one line `tag fields`).

<img src="docs/inline.png" width="700">

### Breadcrumbs in fullscreen:

Click breadcrumbs to edit parent sections, subsections oor container fields.

### In Markdown we trust

The editor respects your markdown text and formatting. For example, if you markdown has a `<br>` we never transform it into a new line, we keep it as is. 


## Install

[MarkdownToFields](https://github.com/lemachinarbo/MarkdownToFields) must be installed first and your content needs to be tagged.

1. Download the [last release](https://github.com/lemachinarbo/MarkdownToFieldsFrontEditor/releases) (DON'T clone the repo) and install the module using your preferred [method](https://modules.processwire.com/install-uninstall/).
2. Give your editors the `page-edit-front` permission.
3. Add `data-mfe` attributes to your templates (see below).

## Define editable zones in your template

Once installed, all you need to do is to define in your templates the editable zones using the same tags you have in your markdown content. For example, if you have a tag field `<!-- title -->` in your markdown, you can render it in your template like this:

```html
<div data-mfe="title">
  <?= $content->title->html ?>
</div>
```

## Define section/subsection/fields

When nesting, its recommended to add the whole path in the `data-mfe` attribute, so the editor can properly resolve the identity of each field. 

Markdown:
```md
<!-- section:columns -->

<!-- title -->
Hello world

<!-- sub:left -->
# Left title

![Left image](01.jpg)

- Left item 1
- Left item 2

<!-- sub:right -->
# Right title

Right content
```

Template:
```html
<section>
  <!-- whole section became editable -->
  <div data-mfe="columns"> 
    <!-- Left content editable zone -->    
    <div data-mfe="columns/left">
      <?= $content->columns->left->html ?>
    </div>
    <!-- Right content editable zone -->    
    <div data-mfe="right">
      <?= $content->columns->right->html ?>
    </div>
  </div>
</section>
```

> Note: Its possible to use shorthand like `data-mfe="right"` instead of the whole path `data-mfe="columns/right"`, but it can lead to identity resolution issues if there are multiple fields with the same name.

And thats it. You can now edit the content directly on the page by double-clicking the defined zones. The changes will be saved to your markdown file and reflected on the page immediately.


### Rendering the same content twice

If you render the same content in multiple places, funny things happen with the preview. To fix this
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


## Module configuration

### Toolbar

In the module config you can define which buttons to show in the toolbar when editing. You can choose from a variety of options, including:

- **Toolbar Buttons**: comma list like:
  `bold,italic,strike,paragraph,|,h1,h2,h3,|,ul,ol,blockquote,|,link,unlink,|,code,codeblock,clear,|,split`

Notes:
- `|` adds a separator.
- `save` is always shown at the end.


## Requirements

- ProcessWire + MarkdownToFields
- Tagged markdown (content tags)
- `page-edit-front` permission

## Support

This module is small and opinionated. If something breaks, start by (shaking) checking:

- the markdown file
- the tags (`<!-- name -->`, `<!-- name... -->`, `<!-- section:name -->`, `<!-- sub:name -->`)
- the permission (`page-edit-front`)
- Ask your local AI.

### Debugging

Live preview uses a stamped canonical identity per mount.

- Authors write shorthand (`data-mfe`, `data-mfe-source`).
- Compiler resolves canonical identity and stamps:
  - `data-mfe-key` (canonical key used across network)
  - `data-mfe-sig` (structural signature)
  - `data-mfe-key-id` (runtime patch selector id)
- In debug mode it also stamps:
  - `data-mfe-path` (human-readable path, e.g. `topics.description`)

Important rule:
- If `data-mfe-key` is present, runtime uses that key directly (no shorthand inference for that node).

Debug helpers (run in your console):
- `window.MarkdownFrontEditor.recompile()` -> recompute and restamp mount graph.
- `window.MarkdownFrontEditor.watch()` -> dev-only MutationObserver auto-recompile.
- `window.MarkdownFrontEditor.unwatch()` -> stop watch mode.

Diagnostics you may see in processwire log:
- `mfe_missing` -> fragment key not resolved server-side; editable-only fallback applied.
- `FRAGMENTS_GRAPH_MISMATCH` -> client and server mount graph checksums differ.
- `FRAGMENTS_STAMP_WARN` / `FRAGMENTS_STAMP_ERROR` -> stamped key mismatch or non-recomputable key on server render.


## License

UBC+P.

Use it.
Break it.
Change it.
And if you make money, buy us some pizza.

Deployed by [mutants.txt](mutants.txt)
