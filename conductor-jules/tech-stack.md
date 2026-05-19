# Tech Stack: MarkdownToFieldsFrontEditor

## Core Engine
- **JavaScript**: ES6+ (Modules)
- **Editor Engine**: CodeMirror 6 / TipTap / ProseMirror
- **State Management**: Canonical `DocumentState` draft architecture
- **Backend Integration**: ProcessWire 3.x via `MarkdownToFieldsFrontEditor.module.php`

## Architecture
- **Scope Session**: Locks active state to prevent cross-scope accidental writes (`src/scope-session.js`).
- **Interfaces & Modes**: Fullscreen reference shell, Inline WYSIWYG overlay, and Split View multi-language sync.
- **Build Tooling**: Vite frontend compilation (`npm run build`).

## Development Environment
- **Node.js**: Frontend asset compilation and testing (`npm test` / Jest / Playwright).
- **DDEV**: Standardized PHP backend environment (`ddev php`).
