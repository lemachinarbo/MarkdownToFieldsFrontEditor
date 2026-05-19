# Product: MarkdownToFieldsFrontEditor (MFE)

## Vision
To serve as the dedicated front-end live editing extension for `MarkdownToFields`. MFE is not a standalone module; it exists solely to allow authors to double-click MF-tagged content, edit it, and preview it directly on the rendered page while preserving the underlying Markdown files as the absolute source of truth.

## Core Architectural Pillars

### 1. Markdown-First Pipeline
Outside of an active editing session, the persisted Markdown file in the filesystem remains the absolute, canonical source of truth. MFE respects author formatting, structure, and HTML comments entirely.

### 2. Canonical Document State
When an editor opens, MFE establishes one authoritative `DocumentState` draft per language session. This draft acts as the mutable working memory, allowing edits to be staged, previewed live, and discarded without premature persistence.

### 3. Scope as a Lens
Scope (`field`, `subsection`, `section`, or `document`) defines the active editing viewport. Scopes are not distinct document copies; they function as lenses focusing on specific portions of the underlying canonical `DocumentState`. Changing scope adjusts the focal window without duplicating or altering the document's state.

### 4. Deterministic Mutability
All edits within a scope mutate the canonical body via a centralized, predictable mutation engine (`applyScopedEdit`). The save pipeline is strictly guarded, validating readback integrity before persisting changes back to the physical Markdown file.

---

## Interfaces & Modes

### Interfaces
- **Fullscreen Editor**: The primary authoring environment featuring breadcrumb navigation for traversing parent sections and containers.
- **Inline Editor**: An intentionally focused WYSIWYG overlay (`Ctrl + double-click`) designed for rapid, single-line tag field updates.
- **Split View**: Side-by-side authoring displaying independent `DocumentState` instances simultaneously, enabling seamless multi-language translation and synchronization.

### Modes
- **Editor Modes**: Toggle between **Rich** (visual WYSIWYG) and **Raw** (direct Markdown text) authoring.
- **Helper Modes**: 
  - **Outline**: Renders visual boundary boxes and labels for editable zones.
  - **Split**: Activates multi-document side-by-side authoring.

---

## Live Preview & Safe Replacement Engine

### Safe Parent Replacement
When editing parent structures (sections or subsections) containing nested child editable zones, MFE employs an intelligent live preview engine:
- **Safe Mode**: If no inline editors or unsaved child drafts are active, MFE replaces the entire parent DOM block cleanly.
- **Risky Mode (Partial Updates)**: If unsaved child states exist, MFE preserves parent wrappers and applies granular partial updates—refreshing child editable keys, maintaining non-editable media nodes (e.g., `<picture>` blocks), and resolving canonical keys dynamically.

### Source Mirroring
To support complex layouts where identical content is rendered multiple times, MFE utilizes `data-mfe-source` attributes to mirror live preview updates across duplicate nodes without rendering collisions.

---

## Target Audience
ProcessWire developers and content authors who require a git-friendly, local IDE authoring pipeline combined with a powerful, in-context live editing experience on the rendered frontend.
