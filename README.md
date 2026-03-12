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

### 1. Document

Outside an editing session, the Markdown file is the persisted source of truth.

#### State

When a user opens an editor, MFE creates or reuses one canonical document state for that session and language. That state is the editable draft of the document, and it can be modified without affecting the persisted markdown file until the user decides to save or discard the changes.

#### Status

The document can be in one of the following statuses:
- No changes: the document state is the same as the original markdown file.
- Draft: the document state has been modified, but not yet saved to the original

Status changes are triggered by 2 actions:

- Discarded: the document state has been discarded, and the original markdown file is unchanged
- Saved: the document state has been saved to the original markdown file, and the original markdown file is updated with the changes.

### 2. Scope

Scope is just *which part* of the document you’re editing. The scope is provided by MarkdownToFields, and it can be:

- whole document
- a section
- a subsection
- a field

Each of these scopes acts as a peek window into the same 'document state'.

If document state changes, any scope that can view the modified content will show the change immediately, because scopes are just lenses of the same document state, not versions or copies. 

Changing scope doesn’t change content, status, or state. It only changes what portion the user is focused on.

### 3. Interfaces

Interfaces allow users to view and edit the document state through specific scopes. There are two main interfaces:

- **Fullscreen** An editor window
- **Inline** WYSIWYG editor on top of your frontend (LIMITED for now)

Interfaces only define where you are editing, not how the 'editing' works.

### 4. Runtime projection

Rich editors may build a temporary runtime projection of the current scope so editing stays comfortable.

That projection may be rebuilt when scope changes, but it never becomes the source of truth. The canonical document state remains the authority.

### 5. Modes

Modes control **how content is presented and interacted with**:

Editors:
- **Raw** → Markdown text
- **Rich** → visual editor

Helpers:
- **Outline** → shows boundaries and labels
- **Split** → shows two documents at the same time
- **Map** → shows structured navigation (WIP)


#### Split and multilanguage

The idea of split view is that you can open multiple documents at the same time, and see them side by side. 
Is currently implemented to identify documents by language, but it can be extended to other dimensions in the future.

If your website is structured as:

en/markdown.md
es/markdown.md
de/markdown.md

When split view is open, a document state is created for each language, and each document state is independent from the others.

Editing tools (like bold, italic, etc. in the rich editor) are local for the document you are editing, but scopes and helpers are global. This means: Saving, discarding, changing the scope or activating the outline mode, will change for all documents, but editing tools, will only apply to the document you are editing.


### Nice to know:

So, basically, MFE works like this: We have `Interfaces` with `Modes`, which displays a `Scope` of the `Document State`.

No matter if user is viewing, saving, or discarding changes in any scope or language, each document state is unique, and all scopes reflect the changes accordingly. This ensures that users have a consistent and accurate view of their work, until they decide to finalize their changes. And most important, that the pipelines for opening, editing, viewing, saving discarding changes are deterministic, consistent, predictable and centralized, not branched or decentralized.


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

If you need to troubleshoot, check [docs/debug.md](docs/debug.md). It has practical steps and copy/paste helpers.

By default, logs stay pretty quiet. Turn on debug mode only when you actually need deeper details.


## License

UBC+P.

Use it.
Break it.
Change it.
And if you make money, buy us some pizza.

Deployed by [mutants.txt](mutants.txt)
