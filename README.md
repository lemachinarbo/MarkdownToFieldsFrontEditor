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

## What's New

**0.4.2.beta.2**
- Image support (images in editor can be updated on double click).

**0.4.1**
- Breadcrumbs in fullscreen allow you to edit ancestors (section > subsection > container > field).
- Section breadcrumb is disabled when the section has no direct content.
  
**0.4**
- Adds sections/subsections support.
- New hybrid system: inline editing + fullscreen editing.

**0.3**
- Official launch of the front-end editor tested in one machine, one installation, one browser.


## Install

**MarkdownToFields** must be installed and your content ready and tagged. The module auto‑detects `tag fields` and `container fields` once it’s installed. And you can edit them by double‑clicking.

1. Install the module using your preferred [method](https://modules.processwire.com/install-uninstall/).
2. Give your editors the `page-edit-front` permission.


## Configuration

In module settings:

- **Editor View**: `fullscreen` or `inline`.
- **Toolbar Buttons**: comma list like:
  `bold,italic,strike,paragraph,|,h1,h2,h3,|,ul,ol,blockquote,|,link,unlink,|,code,codeblock,clear,|,split`

Notes:
- `|` adds a separator.
- `save` is always shown at the end.

## Editing Behavior

- **Tag fields**: `Ctrl + double-click` opens **inline** editor.
- **All other targets**: double-click opens **fullscreen** editor.

If a section only contains subsections, it may not have its own content. In that case the section breadcrumb is shown but not clickable.

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
