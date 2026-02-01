<?php

namespace ProcessWire;
/**
 * MarkdownToFieldsFrontEditor.module
 * Frontend Markdown editor for MarkdownToFields tag fields.
 * Enables inline editing with contentEditable + toolbar.
 * Enforces one-block constraint for tag field integrity.
 */

class MarkdownToFieldsFrontEditor extends WireData implements Module, ConfigurableModule {

    public static function getModuleInfo() {
        return [
            'title' => 'MarkdownToFieldsFrontEditor',
            'summary' => 'Frontend editor for MarkdownToFields.',
            'version' =>  '0.1.0',
            'autoload' => true,
            'singular' => true,
            'requires' => ['MarkdownToFields'],
        ];
    }

    /**
     * Default module configuration
     */
    public static function getDefaultData() {
        return [
            'containerToolbar' => 'bold,italic,strike,code,paragraph,h1,h2,h3,h4,h5,h6,bulletList,orderedList,blockquote,link,clear',
        ];
    }

    /**
     * Module configuration interface
     */
    public static function getModuleConfigInputfields(array $data) {
        $inputfields = new \ProcessWire\InputfieldWrapper();
        
        $defaults = self::getDefaultData();
        $data = array_merge($defaults, $data);

        // Container toolbar configuration
        $f = \ProcessWire\wire('modules')->get('InputfieldText');
        $f->name = 'containerToolbar';
        $f->label = 'Container Field Toolbar Options';
        $f->description = 'Comma-separated list of toolbar options for container fields (<!-- name... -->).';
        $f->notes = 'Available options: bold, italic, strike, code, paragraph, h1, h2, h3, h4, h5, h6, bulletList, orderedList, blockquote, link, clear, save';
        $f->value = $data['containerToolbar'];
        $f->columnWidth = 100;
        $inputfields->add($f);

        return $inputfields;
    }

    public function init() {
        // runtime flag set by template opt-in
        $this->enabledForRequest = false;

        // Inject assets and auto-wrap editable fields when rendering
        $this->addHookAfter('Page::render', $this, 'hookPageRenderAssets');
        $this->addHookAfter('Page::render', $this, 'hookAutoWrapFields');

        // Provide the mdEdit page helper for templates (optional, for explicit control)
        $this->addHook('Page::mdEdit', $this, 'hookPageMdEdit');
        $this->addHook('Page::renderEditable', $this, 'hookPageRenderEditable');

        // Handle minimal save/token endpoints on ready
        $this->addHookBefore('ProcessWire::ready', $this, 'handleSaveRequest');
    }

    /**
     * Template helper: call this from a template to opt in to the frontend editor on that page.
     * Example in template: <?= $modules->get('MarkdownFrontEditor')->enable() ?>
     * Only enables if the current user is logged in and has 'page-edit-front' permission.
     */
    public function enable() {
        $user = $this->wire()->user;
        if(!$user->isLoggedIn()) return false;
        // permission gate — using existing page-edit-front permission
        if(!$user->hasPermission('page-edit-front')) return false;

        $this->enabledForRequest = true;
        return true;
    }

    /**
     * Asset injector — only runs when enable() was called for this request.
     */
    public function hookPageRenderAssets($event) {
        // Skip AJAX requests and admin contexts
        $config = $this->wire()->config;
        if ($config->ajax) return;
        
        $input = $this->wire()->input;
        if ($input->url && strpos($input->url, $config->urls->admin) === 0) return;
        
        // Only inject assets for editors: either template explicitly enabled or user has front edit permission
        $user = $this->wire()->user;
        if (empty($this->enabledForRequest) && (!$user->isLoggedIn() || !$user->hasPermission('page-edit-front'))) return;

        $out = $event->return;
        if (!is_string($out)) return;
        
        $url = $config->urls($this->className());
        // Minimal CSS for the floating toolbar, slash menu, handle, editor host, and toast
        $css = "<style>\n.fe-editor-host { min-height:1.2em; }\n.fe-toolbar { position: absolute; z-index: 9999; display:flex; gap:6px; background:#fff; border-radius:6px; padding:6px; box-shadow:0 6px 18px rgba(0,0,0,0.12); border:1px solid rgba(0,0,0,0.06); }\n.fe-toolbar button { background:transparent; border:0; padding:6px; cursor:pointer; border-radius:4px; }\n.fe-toolbar button:hover { background:rgba(0,0,0,0.03); }\n.fe-editable[data-fe-editing] { outline:2px solid rgba(0,122,255,0.12); }\n.fe-slash-menu { position: absolute; z-index:10000; background: #fff; border:1px solid rgba(0,0,0,0.08); border-radius:6px; box-shadow:0 6px 18px rgba(0,0,0,0.12); padding:6px; min-width:160px; }\n.fe-slash-menu ul{ list-style:none; margin:0; padding:4px 0; }\n.fe-slash-menu li{ padding:6px 10px; cursor:pointer; border-radius:4px; }\n.fe-slash-menu li:hover{ background:rgba(0,0,0,0.03);}\n.fe-handle { position:absolute; left:-28px; top:4px; width:22px; height:22px; border-radius:4px; background:#fff; border:1px solid rgba(0,0,0,0.06); display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.06); }\n.fe-toast { position: fixed; right: 20px; bottom: 20px; min-width: 220px; padding: 10px 14px; border-radius: 8px; color: #111; background: rgba(255,255,255,0.98); border: 1px solid rgba(0,0,0,0.06); box-shadow: 0 6px 18px rgba(0,0,0,0.08); z-index: 100000; display: none; }\n.fe-toast.success { border-left: 4px solid #10b981; }\n.fe-toast.error { border-left: 4px solid #ef4444; }\n</style>";
        $modulePath = $config->paths($this->className());
        $jsPath = $modulePath . 'MarkdownFrontEditor.js';
        $shimPath = $modulePath . 'assets/tiptap-shim.umd.js';
        $version = is_file($jsPath) ? (string) filemtime($jsPath) : (string) time();
        $shimVersion = is_file($shimPath) ? (string) filemtime($shimPath) : $version;

        // Local shim only (UMD bundles unavailable in this environment)
        $shim = "<script src='" . $url . "assets/tiptap-shim.umd.js?v={$shimVersion}'></script>";
        
        // Expose module config to JavaScript
        $defaults = self::getDefaultData();
        $containerToolbar = isset($this->containerToolbar) ? $this->containerToolbar : $defaults['containerToolbar'];
        $config = "<script>window.MarkdownFrontEditorConfig = {containerToolbar: " . json_encode($containerToolbar) . ", version: " . json_encode($version) . "};</script>";
        
        // Also include module script
        $script = $css . $config . $shim . "<script type=\"module\" src=\"{$url}MarkdownFrontEditor.js?v={$version}\"></script>";

        if(stripos($out, '</body>') !== false) {
            $out = str_ireplace('</body>', $script . '</body>', $out);
        } else {
            $out .= $script;
        }

        $event->return = $out;
    }

    /**
     * Auto-wrap MarkdownToFields field markers in rendered output.
     * Exposes field metadata: name, type (heading/paragraph/list/container), is_container flag.
     * Frontend uses metadata to configure editor constraints.
     * Transparent to templates—no markup required.
     */
    public function hookAutoWrapFields($event) {
        $user = $this->wire()->user;
        if(!$user->isLoggedIn() || !$user->hasPermission('page-edit-front')) return;

        $page = $event->object;
        if(!$page || !$page->id || !$page->editable()) return;
        
        // Skip admin pages, AJAX requests, and system templates
        $config = $this->wire()->config;
        if ($config->ajax) return; // Don't process AJAX requests (like page tree loading)
        if ($page->template && ($page->template->flags & \ProcessWire\Template::flagSystem)) return;
        
        // Skip if we're in the admin
        $input = $this->wire()->input;
        if ($input->url && strpos($input->url, $config->urls->admin) === 0) return;

        $out = $event->return;
        if(!is_string($out)) return;

        // Check if page has markdown content - bail silently if not
        try {
            $content = $page->content();
        } catch (\Exception $e) {
            return; // No markdown content, skip wrapping
        }
        if (!isset($content->sections) || !is_array($content->sections)) return;

        // Collect all fields with their metadata: name, html, type, is_container
        try {
            $containerMap = $this->getContainerMapFromMarkdown($page);
        } catch (\Exception $e) {
            $containerMap = []; // Fallback to empty map if markdown file not found
        }
        $fields = [];
        foreach ($content->sections as $section) {
            if (isset($section->fields) && is_array($section->fields)) {
                foreach ($section->fields as $fname => $f) {
                    if (isset($f->html) && $f->html !== '') {
                        $isContainer = $containerMap[$fname] ?? $this->resolveIsContainer($f);
                        $fieldType = $this->resolveFieldType($f);
                        if ($isContainer) $fieldType = 'container';
                        $fields[$fname] = [
                            'html' => $f->html,
                            'type' => $fieldType,
                            'is_container' => $isContainer
                        ];
                    }
                }
            }
            if (isset($section->subsections) && is_array($section->subsections)) {
                foreach ($section->subsections as $subsection) {
                    if (isset($subsection->fields) && is_array($subsection->fields)) {
                        foreach ($subsection->fields as $fname => $f) {
                            if (isset($f->html) && $f->html !== '') {
                                $isContainer = $containerMap[$fname] ?? $this->resolveIsContainer($f);
                                $fieldType = $this->resolveFieldType($f);
                                if ($isContainer) $fieldType = 'container';
                                $fields[$fname] = [
                                    'html' => $f->html,
                                    'type' => $fieldType,
                                    'is_container' => $isContainer
                                ];
                            }
                        }
                    }
                }
            }
        }

        // Wrap each field in the output with metadata
        foreach ($fields as $fname => $fieldData) {
            $safeAttr = htmlspecialchars($fname, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $safeType = htmlspecialchars($fieldData['type'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $isContainer = $fieldData['is_container'] ? 'true' : 'false';
            
            if (stripos($out, 'data-md-name="' . $safeAttr . '"') !== false) continue; // already wrapped
            
            $html = $fieldData['html'];
            $pos = stripos($out, $html);
            if ($pos !== false) {
                $wrapper = '<div class="fe-editable md-edit" data-md-name="' . $safeAttr . '" data-field-type="' . $safeType . '" data-is-container="' . $isContainer . '" data-page="' . $page->id . '">' . $html . '</div>';
                $out = substr_replace($out, $wrapper, $pos, strlen($html));
            }
        }

        $event->return = $out;
    }

    /**
     * Template helper for rendering editable markdown regions in templates.
     * Exposes field metadata: name, type, is_container flag.
     * Frontend uses metadata to configure editor constraints.
     */
    public function hookPageMdEdit($event) {
        $page = $event->object;
        $fieldName = trim((string)$event->arguments(0));
        $html = $event->arguments(1) ?? '';

        // Permission check
        $user = $this->wire()->user;
        if(!$user->hasPermission('page-edit-front', $page) || !$page->editable()) {
            $event->return = $html;
            return;
        }

        // Check if field exists in LetMeDown structure and get metadata
        if ($fieldName === '' || !method_exists($page, 'content')) {
            $event->return = $html;
            return;
        }

        try {
            $content = $page->content();
        } catch (\Exception $e) {
            $event->return = $html;
            return;
        }
        
        try {
            $containerMap = $this->getContainerMapFromMarkdown($page);
        } catch (\Exception $e) {
            $containerMap = [];
        }
        
        $fieldType = null;
        $isContainer = false;
        
        if (isset($content->sections) && is_array($content->sections)) {
            foreach ($content->sections as $section) {
                if (isset($section->fields[$fieldName])) {
                    $isContainer = $containerMap[$fieldName] ?? $this->resolveIsContainer($section->fields[$fieldName]);
                    $fieldType = $this->resolveFieldType($section->fields[$fieldName]);
                    if ($isContainer) $fieldType = 'container';
                    break;
                }
                if (isset($section->subsections) && is_array($section->subsections)) {
                    foreach ($section->subsections as $subsection) {
                        if (isset($subsection->fields[$fieldName])) {
                            $isContainer = $containerMap[$fieldName] ?? $this->resolveIsContainer($subsection->fields[$fieldName]);
                            $fieldType = $this->resolveFieldType($subsection->fields[$fieldName]);
                            if ($isContainer) $fieldType = 'container';
                            break 2;
                        }
                    }
                }
            }
        }

        if ($fieldType === null) {
            $event->return = $html;
            return;
        }

        // Wrap in editable container with metadata
        $safeAttr = htmlspecialchars($fieldName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeType = htmlspecialchars($fieldType, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $isContainerAttr = $isContainer ? 'true' : 'false';
        $out = "<div class=\"fe-editable md-edit\" data-md-name=\"{$safeAttr}\" data-field-type=\"{$safeType}\" data-is-container=\"{$isContainerAttr}\" data-page=\"{$page->id}\">";
        $out .= $html;
        $out .= "</div>";
        $event->return = $out;
    }

    /**
     * Auto-wrap MarkdownToFields sections/fields in the rendered HTML so templates don't need to opt-in.
     * Only applies for logged-in users with 'page-edit-front' permission and when page is editable.
     */
    // REMOVED: Templates must opt-in via $page->mdEdit() to ensure data-driven edits, no hidden mutations

    public function handleSaveRequest($event) {
        $input = $this->wire()->input;

        // Token endpoint
        if($input->get->markdownFrontEditorToken) {
            $user = $this->wire()->user;
            if(!$user->isLoggedIn() || !$user->hasPermission('page-edit-front')) {
                header('HTTP/1.1 403 Forbidden');
                echo 'Forbidden';
                exit;
            }
            echo $this->wire()->session->CSRF->renderInput();
            exit;
        }

        // Save endpoint
        if(!$input->get->markdownFrontEditorSave) return;

        // Must be POST
        if(!$this->wire()->input->requestMethod('POST')) {
            $this->sendJsonError('Invalid method', 405);
        }

        // CSRF validation
        try { $this->wire()->session->CSRF->validate(); }
        catch(\Exception $e) { $this->sendJsonError('Failed CSRF check', 403); }

        $user = $this->wire()->user;
        if(!$user->isLoggedIn() || !$user->hasPermission('page-edit-front')) {
            $this->sendJsonError('Forbidden', 403);
        }

        $html = $input->post->get('html');
        if($html === null) $this->sendJsonError('Missing html', 400);

        // Restore protected inline HTML tokens if provided
        $tokensJson = $input->post->text('mdTokens') ?: null;
        if ($tokensJson) {
            $tokens = json_decode($tokensJson, true);
            if (is_array($tokens)) {
                $html = \ProcessWire\MarkdownHtmlConverter::restoreHtmlFromEditor($html, $tokens);
            }
        }

        // Fallback: replace inline-break placeholders if still present
        if (stripos($html, 'md-inline-break') !== false) {
            $html = preg_replace(
                '/<md-inline-break\b[^>]*><\/md-inline-break>/i',
                '<br>',
                $html
            ) ?? $html;
            $html = preg_replace(
                '/&lt;md-inline-break\b[^&]*&gt;\s*<\/md-inline-break>/i',
                '<br>',
                $html
            ) ?? $html;
            $html = preg_replace(
                '/<\/md-inline-break>/i',
                '',
                $html
            ) ?? $html;
            $html = preg_replace(
                '/&lt;\/md-inline-break&gt;/i',
                '',
                $html
            ) ?? $html;
        }

        $mdName = $input->post->text('mdName');
        if(!$mdName) $this->sendJsonError('Missing mdName', 400);

        $pageId = (int)$input->post->pageId;
        if(!$pageId) $this->sendJsonError('Missing pageId', 400);

        $page = $this->wire()->pages->get($pageId);
        if(!$page->id) $this->sendJsonError('Page not found', 404);
        if(!$page->editable()) $this->sendJsonError('Page not editable', 403);

        if(!\ProcessWire\MarkdownConfig::supportsPage($page)) {
            $this->sendJsonError('MarkdownToFields not configured for this page', 400);
        }

        // Convert HTML -> Markdown using MarkdownToFields
        try {
            $blockMarkdown = \ProcessWire\MarkdownHtmlConverter::convertHtmlToMarkdown($html, $page);
        } catch (\Throwable $e) {
            $this->sendJsonError('HTML to Markdown failed: ' . $e->getMessage(), 500);
        }

        // Normalize encoded blockquote markers
        $blockMarkdown = preg_replace('/^([\t ]*)&gt;\s*/m', '$1> ', $blockMarkdown) ?? $blockMarkdown;

        // Normalize HTML <del> to markdown strikethrough
        $blockMarkdown = preg_replace('/<del>([\s\S]*?)<\/del>/i', '~~$1~~', $blockMarkdown) ?? $blockMarkdown;

        if(trim((string)$blockMarkdown) === '') {
            $this->sendJsonError('Empty markdown', 400);
        }

        // Use updateFieldUsingLetMeDown to respect exact boundaries
        // This uses LetMeDown's object structure for precise field identification
        try {
            $langCode = \ProcessWire\MarkdownLanguageResolver::getDefaultLanguageCode($page);
            $oldContent = '';
            
            $content = $page->content();
            if (isset($content->sections) && is_array($content->sections)) {
                foreach ($content->sections as $section) {
                    if (isset($section->fields[$mdName]->markdown)) {
                        $oldContent = trim($section->fields[$mdName]->markdown);
                        break;
                    }
                    if (isset($section->subsections) && is_array($section->subsections)) {
                        foreach ($section->subsections as $subsection) {
                            if (isset($subsection->fields[$mdName]->markdown)) {
                                $oldContent = trim($subsection->fields[$mdName]->markdown);
                                break 2;
                            }
                        }
                    }
                }
            }
            
            $this->updateFieldUsingLetMeDown($page, $mdName, $blockMarkdown, $langCode);
            
            // Log the update
            $oldPreview = substr($oldContent, 0, 60) . (strlen($oldContent) > 60 ? '...' : '');
            $newPreview = substr(trim($blockMarkdown), 0, 60) . (strlen(trim($blockMarkdown)) > 60 ? '...' : '');
            $this->wire->log->save('markdown-front-edit', "FIELD: '$mdName' | BEFORE: " . (empty($oldPreview) ? '(empty)' : $oldPreview) . " | AFTER: " . $newPreview);
        } catch (\Throwable $e) {
            $this->sendJsonError('Failed to update markdown: ' . $e->getMessage(), 500);
        }

        // Sync from markdown to update page fields
        try {
            \ProcessWire\MarkdownSyncEngine::syncFromMarkdown($page);
        } catch (\Throwable $e) {
            $this->sendJsonError('Sync from markdown failed: ' . $e->getMessage(), 500);
        }

        $content = $page->loadContent();
        $canonicalHtml = null;
        
        if (isset($content->sections) && is_array($content->sections)) {
            foreach ($content->sections as $s) {
                if (isset($s->fields[$mdName]->html)) {
                    $canonicalHtml = $s->fields[$mdName]->html;
                    break;
                }
                if (isset($s->subsections) && is_array($s->subsections)) {
                    foreach ($s->subsections as $sub) {
                        if (isset($sub->fields[$mdName]->html)) {
                            $canonicalHtml = $sub->fields[$mdName]->html;
                            break 2;
                        }
                    }
                }
            }
        }
        
        if ($canonicalHtml === null) {
            $this->sendJsonError('Field not found after sync: ' . $mdName, 500);
        }

        header('Content-Type: application/json');
        echo json_encode(['status' => 1, 'html' => $canonicalHtml]);
        exit;
    }

    /**
     * Resolve canonical field type from LetMeDown field data.
     * Uses $field->type when provided; falls back to HTML tag inspection.
     */
    protected function resolveFieldType($field): string {
        if (is_object($field) && !empty($field->type)) {
            return $field->type;
        }

        $html = '';
        if (is_object($field) && isset($field->html)) {
            $html = trim((string)$field->html);
        }
        if ($html === '') return 'block';

        if (preg_match('/^<h[1-6]\b/i', $html)) return 'heading';
        if (preg_match('/^<p\b/i', $html)) return 'paragraph';
        if (preg_match('/^<(ul|ol)\b/i', $html)) return 'list';
        if (preg_match('/^<blockquote\b/i', $html)) return 'quote';

        return 'block';
    }

    /**
     * Build a map of field name => is_container by parsing markdown markers.
     * Used as a fallback when LetMeDown field objects omit container info.
     */
    protected function getContainerMapFromMarkdown(\ProcessWire\Page $page): array {
        // Verify MarkdownToFields is available
        if (!class_exists('\\ProcessWire\\MarkdownFileIO')) return [];
        if (!class_exists('\\ProcessWire\\MarkdownLanguageResolver')) return [];
        
        $language = \ProcessWire\MarkdownLanguageResolver::getLanguageCode($page);
        $path = \ProcessWire\MarkdownFileIO::getMarkdownFilePath($page, $language);
        if (!is_file($path)) return [];

        $markdown = @file_get_contents($path);
        if ($markdown === false || $markdown === '') return [];

        $map = [];
        if (!preg_match_all('/<!--\s*(.*?)\s*-->/m', $markdown, $matches)) return $map;

        foreach ($matches[1] as $raw) {
            $content = trim($raw);

            // Field binding: field:name
            if (preg_match('/^field:([a-zA-Z0-9_-]+)$/', $content, $m)) {
                $map[$m[1]] = false;
                continue;
            }

            // Field opener: name or name...
            if (preg_match('/^([a-zA-Z0-9_-]+)(\.{3})?$/', $content, $m)) {
                $map[$m[1]] = !empty($m[2]);
                continue;
            }
        }

        return $map;
    }

    /**
     * Resolve container status from field data.
     */
    protected function resolveIsContainer($field): bool {
        if (!is_object($field)) return false;

        if (isset($field->is_container)) return (bool) $field->is_container;
        if (isset($field->isContainer)) return (bool) $field->isContainer;
        if (isset($field->container)) return (bool) $field->container;
        if (!empty($field->type) && $field->type === 'container') return true;

        return false;
    }

    /**
     * Update a field in markdown using LetMeDown's exact boundaries.
     */
    protected function updateFieldUsingLetMeDown($page, $fieldName, $newMarkdown, $langCode = null) {
        if (!$langCode) {
            $langCode = \ProcessWire\MarkdownLanguageResolver::getDefaultLanguageCode($page);
        }

        $content = $page->content();
        
        // Verify field exists in LetMeDown structure
        $fieldExists = false;
        if (isset($content->sections) && is_array($content->sections)) {
            foreach ($content->sections as $section) {
                if (isset($section->fields[$fieldName])) {
                    $fieldExists = true;
                    break;
                }
                if (isset($section->subsections) && is_array($section->subsections)) {
                    foreach ($section->subsections as $subsection) {
                        if (isset($subsection->fields[$fieldName])) {
                            $fieldExists = true;
                            break 2;
                        }
                    }
                }
            }
        }
        
        if (!$fieldExists) {
            throw new \Exception("Field '{$fieldName}' not found in parsed content");
        }

        // Update via MarkdownFileIO - let exceptions bubble
        \ProcessWire\MarkdownFileIO::updateFieldInMarkdown($page, $fieldName, $newMarkdown, $langCode);
    }

    protected function sendJsonError($msg, $code = 400) {
        if($code) http_response_code($code);
        header('Content-Type: application/json');
        echo json_encode(['status' => 0, 'error' => $msg]);
        exit;
    }

}
