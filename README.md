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

When you save in the editor, two things happen:

1. The markdown file is saved.
2. The page is updated live, so you can see the result right away.

That live update is only a preview.  
If something looks wrong, refresh. Reload shows the real HTML rendered from saved markdown.

In short: save updates your markdown, but the preview is only a temporal visual update.

If the preview of one area isn't updating correctly, try adding a clear `data-mfe` host around that area so the editor knows exactly what to patch.

Example:

```html
<div data-mfe="body/features/end">
  <?= $content->body->features->end->html ?>
</div>
```

```
data-mfe="body"              section
data-mfe="body/features"     subsection or section field (resolved from content index)
data-mfe="body/features/end" subsection field
data-mfe="title"             top-level field (optional shorthand)
```


### Rendering The Same Field Twice

If a field is printed in multiple places, the preview by default updates only the primary "node", but the extra copies must declare their 'source' with `data-mfe-source` so the editor knows which content to update:

```html
<section data-mfe="body">
  <div data-mfe="body/features/end">
    <!-- this is the primary node for this content, so it gets the live update -->
    <?= $content->body->features->end->html ?> 
  </div>

  <aside>
    <div>
      <!-- this is a copy without source, so it won't get the live update -->
      <?= $content->body->features->end->html ?> 
    </div>
    <div data-mfe-source="body/features/end">
      <!-- this is a copy with source, so it will get the live update -->
      <?= $content->body->features->end->html ?> 
    </div>
  </aside>
</section>
```

`data-mfe-source` accepts:
- slash path: `body/features/end` (recommended)
- scoped key: `subsection:body:features:end` (internal format)

Why this split:
- `data-mfe` is the main editable/bound area.
- `data-mfe-source` is an extra mirror of that same content.
- This avoids preview conflicts when the same content is printed in more than one place.

Canonical keys are type-first:
- `section` = whole section
- `subsection` = whole subsection
- `field` = field inside a section
- `subsection:...:...:fieldName` = field inside a subsection



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
