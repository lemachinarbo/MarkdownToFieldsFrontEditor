# Changelog

## V0.4.6

- Fix to preserve marker tags with dots/paths during edit/save (e.g. `<!-- description... -->`) so subsection/tag boundaries are not dropped.
- Save replacements now use raw markdown source (not processed image-rewritten content), preventing unrelated image URL mutations.
- Keep `data-mfe` host layout intact on save; only `.fe-editable` content is replaced.
- Live host image refresh now resolves through ProcessWire URLs (`config->urls->files` via `pageFilesBaseUrl`) and updates only the matched/isolated image.

## V0.4.5

- Images save as relative paths; previews use site base URL.
- Replacing an image from the picker now reliably targets the selected image node + shows relative paths.
- Save sync fallback works for all targets (incl. data-mfe).
