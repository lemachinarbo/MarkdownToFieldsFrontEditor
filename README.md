# MarkdownToFieldsFrontEditor

This is the **front‑end editor** for [MarkdownToFields](https://github.com/lemachinarbo/MarkdownToFields).

The name is horrible, but it lets you double‑click tagged content, edit it and preview it right on the page (yes I know ProcessWire does that, but this is different and this is mine).

It is NOT a standalone module. It only works **together** with MarkdownToFields.

## What you can do

- **Double‑click** any editable zone to open fullscreen editor
- **Ctrl + double‑click** tag fields for quick inline edits (Only available at the moment for simple `tag fields`))
- Edit in multiple languages side by side
- Changes save to markdown and preview live on the page

 
https://github.com/user-attachments/assets/fa348df1-37ef-468d-ad05-027dccdef357



## Features

### Multilanguage support 
Compare and update content in different languages (uses ProcessWire languages).

<img src="docs/fullscreen.png" width="700">

### Inline editing (limited support)

`Ctrl + double click` The best for quick edits (Only available for one line `tag fields`).

<img src="docs/inline.png" width="700">

### Breadcrumbs in fullscreen:

Click breadcrumbs to edit parent sections, subsections oor container fields.


### Image picker

Double click images to open the image picker and select a new one from your MarkdownToFields image folder. The markdown will be updated with the new image path.

## How MFE Works

The editor is built around a simple idea: everything comes from one Markdown document, and it treats that source with care. 
Your Markdown content and format must stay exactly as you wrote it.

This editor works in 4 layers:

### Document

The Markdown file is the original content.
What you see in the editor or on the page is always a representation of that same document.

### Scope

Scope is just *which part* of the document you’re editing. The scope is provided by MarkdownToFields, and it can be:

* whole document
* a section
* a subsection
* a field

Changing scope doesn’t change content. It only changes what portion the user is focused on.

### Views

Views control **how content is shown**, not what it is:

* **Raw** → Markdown text
* **Rich** → visual editor
* **Outline** → shows boundaries and labels
* **Map** → shows structure as a tree

Switching views never modifies the content.

### Context

Context is where users edit:

* **Inline** WYSIWYG editor on top of your frontend (LIMITED for now)
* **Fullscreen** An editor window

Context only changes where you edit, not how editing works.

## Install

[MarkdownToFields](https://github.com/lemachinarbo/MarkdownToFields) must be installed first and your content needs to be tagged.

1. Download the [last release](https://github.com/lemachinarbo/MarkdownToFieldsFrontEditor/releases) (DON'T clone the repo) and install the module using your preferred [method](https://modules.processwire.com/install-uninstall/).
2. Give your editors the `page-edit-front` permission.
3. Add `data-mfe` attributes to your templates (see below).

## Define editable zones in your template

When you render a field using html (e.g. `{$content->title->html}`), the editor can automatically detect it and make it editable.

But if you render it using `->text` or changing the HTML, rollovers won't appear. In that case, you need to define the editable zones manually in your templates.

The same happens with sections, subsections and containers. You need to define the editable zones manually using `data-mfe` attributes:


```html
<div data-mfe="mysection">
  <?= $content->mysection->html ?>
</div>
```

## Nesting section/subsection/fields

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



### Live preview behavior with nested sections and fields

When you use the editor to edit an area that contains other editable areas:

```html
<!-- section columns is editable -->
<div data-mfe="columns"> 
  <div>
    <!-- But also the title is set as a editable zone -->
    <?= $content->columns->title->html ?>
  </div>
</div>
```

Live preview tries hard to keep your layout intact with the new content. But when nesting them, you create a situation where replacing the whole parent block raises a question: what should happen with the inner editable content?

So in those cases, when you save a parent (section/subsection), the editor checks if replacing the whole block is safe:

* **If safe →** full parent block gets replaced.
* **If risky →** the editor keeps parent wrappers and applies safe partial updates:
  * updates child editable keys,
  * updates safe non-editable media nodes (like images/picture blocks),
  * completes unresolved keys from canonical markdown content when needed.

This keeps nested editable zones stable while still showing the saved changes in live preview.

You can control this in module settings:

**Modules → MarkdownToFieldsFrontEditor → Enable Safe Parent Live Preview Replacement**

If you turn it off, risky parent replacement is always skipped.

Full parent replacement only runs when all of these are true:

* no inline editor open
* no fullscreen unsaved changes
* no unsaved child drafts inside that parent

If any check fails, it falls back to safe mode: keep parent as-is and patch children only.


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
  `bold,italic,strike,paragraph,|,h1,h2,h3,|,ul,ol,blockquote,|,link,unlink,|,code,codeblock,clear,|,split,document,outline`

Notes:
- `|` adds a separator.
- `document` opens full document view and enables outline mode.
- `outline` toggles outline boundaries/labels for the current editor scope.
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
