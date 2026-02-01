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
            'allowMultiBlock' => false,
            'toolbarButtons' => 'bold,italic,strike,code,paragraph,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,link,clear,save',
        ];
    }

    /**
     * Module configuration interface
     */
    public static function getModuleConfigInputfields(array $data) {
        $inputfields = new \ProcessWire\InputfieldWrapper();
        
        $defaults = self::getDefaultData();
        $data = array_merge($defaults, $data);

        $f = \ProcessWire\wire('modules')->get('InputfieldCheckbox');
        $f->name = 'allowMultiBlock';
        $f->label = 'Allow Multi-Block Editing';
        $f->description = 'If enabled, fields can contain multiple blocks and line breaks.';
        $f->checked = !empty($data['allowMultiBlock']);
        $inputfields->add($f);

        $f = \ProcessWire\wire('modules')->get('InputfieldText');
        $f->name = 'toolbarButtons';
        $f->label = 'Toolbar Buttons';
        $f->description = 'Comma-separated list of toolbar buttons to show. Available: bold, italic, strike, code, paragraph, h1-h6, ul, ol, blockquote, link, clear, save';
        $f->notes = 'Defaults: bold,italic,strike,code,paragraph,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,link,clear,save';
        $f->value = !empty($data['toolbarButtons']) ? $data['toolbarButtons'] : $defaults['toolbarButtons'];
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
        $allowMultiBlock = isset($this->allowMultiBlock) ? (bool) $this->allowMultiBlock : (bool) $defaults['allowMultiBlock'];
        $toolbarButtons = isset($this->toolbarButtons) ? (string) $this->toolbarButtons : (string) $defaults['toolbarButtons'];
        $config = "<script>window.MarkdownFrontEditorConfig = {allowMultiBlock: " . json_encode($allowMultiBlock) . ", toolbarButtons: " . json_encode($toolbarButtons) . ", version: " . json_encode($version) . "};</script>";
        
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
    * Exposes field metadata: name and type (heading/paragraph/list/block).
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

        $defaults = self::getDefaultData();
        $globalAllowMultiBlock = isset($this->allowMultiBlock) ? (bool) $this->allowMultiBlock : (bool) $defaults['allowMultiBlock'];
        
        // Detect container markers (<!-- name ... -->) for automatic multi-line support
        $containerFields = $this->getContainerFieldNames($page);

        // Collect all fields with their metadata: name, html, type
        $fields = [];
        foreach ($content->sections as $section) {
            if (isset($section->fields) && is_array($section->fields)) {
                foreach ($section->fields as $fname => $f) {
                    if (isset($f->html) && $f->html !== '') {
                        $fieldType = $this->resolveFieldType($f);
                        // Container fields automatically get multi-line unless global config is explicitly set
                        $allowMultiBlock = isset($containerFields[$fname]) ? true : $globalAllowMultiBlock;
                        $html = $f->html;
                        if ($allowMultiBlock && isset($f->markdown) && $f->markdown !== '' && method_exists('\\ProcessWire\\MarkdownHtmlConverter', 'convertMarkdownToHtml')) {
                            $html = \ProcessWire\MarkdownHtmlConverter::convertMarkdownToHtml((string)$f->markdown, $page);
                            $this->wire->log->save('markdown-front-edit', "WRAP field='{$fname}' allowMultiBlock=1 markdownLen=" . strlen((string)$f->markdown) . " htmlLen=" . strlen($html) . " preview=" . substr(str_replace(["\r","\n"],["\\r","\\n"], $html), 0, 120));
                        }
                        $fields[$fname] = [
                            'html' => $html,
                            'type' => $fieldType,
                            'allow_multi_block' => $allowMultiBlock,
                        ];
                    }
                }
            }
            if (isset($section->subsections) && is_array($section->subsections)) {
                foreach ($section->subsections as $subsection) {
                    if (isset($subsection->fields) && is_array($subsection->fields)) {
                        foreach ($subsection->fields as $fname => $f) {
                            if (isset($f->html) && $f->html !== '') {
                                $fieldType = $this->resolveFieldType($f);
                                $allowMultiBlock = isset($containerFields[$fname]) ? true : $globalAllowMultiBlock;
                                $html = $f->html;
                                if ($allowMultiBlock && isset($f->markdown) && $f->markdown !== '' && method_exists('\\ProcessWire\\MarkdownHtmlConverter', 'convertMarkdownToHtml')) {
                                    $html = \ProcessWire\MarkdownHtmlConverter::convertMarkdownToHtml((string)$f->markdown, $page);
                                    $this->wire->log->save('markdown-front-edit', "WRAP field='{$fname}' allowMultiBlock=1 markdownLen=" . strlen((string)$f->markdown) . " htmlLen=" . strlen($html) . " preview=" . substr(str_replace(["\r","\n"],["\\r","\\n"], $html), 0, 120));
                                }
                                $fields[$fname] = [
                                    'html' => $html,
                                    'type' => $fieldType,
                                    'allow_multi_block' => $allowMultiBlock,
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
            $allowMulti = !empty($fieldData['allow_multi_block']) ? 'true' : 'false';
            
            if (stripos($out, 'data-md-name="' . $safeAttr . '"') !== false) continue; // already wrapped
            
            $html = $fieldData['html'];
            $pos = stripos($out, $html);
            if ($pos !== false) {
                $wrapper = '<div class="fe-editable md-edit" data-md-name="' . $safeAttr . '" data-field-type="' . $safeType . '" data-allow-multi-block="' . $allowMulti . '" data-page="' . $page->id . '">' . $html . '</div>';
                $out = substr_replace($out, $wrapper, $pos, strlen($html));
            }
        }

        $event->return = $out;
    }

    /**
      * Template helper for rendering editable markdown regions in templates.
      * Exposes field metadata: name and type.
      * Frontend uses metadata to configure editor constraints.
     */
    public function hookPageMdEdit($event) {
        $page = $event->object;
        $fieldName = trim((string)$event->arguments(0));
        $html = $event->arguments(1) ?? '';
          $options = $event->arguments(2) ?? null;

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
        
        $fieldType = null;
        $defaults = self::getDefaultData();
        $globalAllowMultiBlock = isset($this->allowMultiBlock) ? (bool) $this->allowMultiBlock : (bool) $defaults['allowMultiBlock'];
        
        // Check if this is a container field
        $containerFields = $this->getContainerFieldNames($page);
        $allowMultiBlock = isset($containerFields[$fieldName]) ? true : $globalAllowMultiBlock;

        // Explicit override via options argument
        if (is_bool($options)) {
            $allowMultiBlock = $options;
        } elseif (is_array($options) && array_key_exists('allowMultiBlock', $options)) {
            $allowMultiBlock = (bool) $options['allowMultiBlock'];
        }
        
        if (isset($content->sections) && is_array($content->sections)) {
            foreach ($content->sections as $section) {
                if (isset($section->fields[$fieldName])) {
                    $fieldType = $this->resolveFieldType($section->fields[$fieldName]);
                    break;
                }
                if (isset($section->subsections) && is_array($section->subsections)) {
                    foreach ($section->subsections as $subsection) {
                        if (isset($subsection->fields[$fieldName])) {
                            $fieldType = $this->resolveFieldType($subsection->fields[$fieldName]);
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
        $allowMultiAttr = $allowMultiBlock ? 'true' : 'false';
        $out = "<div class=\"fe-editable md-edit\" data-md-name=\"{$safeAttr}\" data-field-type=\"{$safeType}\" data-allow-multi-block=\"{$allowMultiAttr}\" data-page=\"{$page->id}\">";
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

        // Check if markdown is sent directly (for multi-line container fields)
        // Use textarea() to preserve line breaks
        $markdown = $input->post->textarea('markdown');
        $html = $input->post->get('html');
        
        if(!$markdown && $html === null) {
            $this->sendJsonError('Missing content (html or markdown)', 400);
        }

        $mdName = $input->post->text('mdName');
        if(!$mdName) $this->sendJsonError('Missing mdName', 400);

        $pageId = (int)$input->post->pageId;
        if(!$pageId) $this->sendJsonError('Missing pageId', 400);

        // Trace payload details for debugging
        $markdownLen = strlen((string)$markdown);
        $htmlLen = strlen((string)$html);
        $markdownLines = $markdownLen ? (substr_count((string)$markdown, "\n") + 1) : 0;
        $htmlLines = $htmlLen ? (substr_count((string)$html, "\n") + 1) : 0;
        $markdownPreview = $markdownLen ? substr(str_replace(["\r", "\n"], ["\\r", "\\n"], (string)$markdown), 0, 120) : '';
        $htmlPreview = $htmlLen ? substr(str_replace(["\r", "\n"], ["\\r", "\\n"], (string)$html), 0, 120) : '';
        $debugIsMultiLine = $input->post->text('debug_isMultiLine');
        $debugPlainLen = $input->post->text('debug_plainTextLen');
        $debugHtmlLen = $input->post->text('debug_htmlLen');
        $debugMeta = " debug_isMultiLine={$debugIsMultiLine} debug_plainTextLen={$debugPlainLen} debug_htmlLen={$debugHtmlLen}";
        $this->wire->log->save('markdown-front-edit',
            "PAYLOAD mdName='{$mdName}' pageId={$pageId} markdownLen={$markdownLen} markdownLines={$markdownLines} htmlLen={$htmlLen} htmlLines={$htmlLines}" .
            $debugMeta . " markdownPreview='{$markdownPreview}' htmlPreview='{$htmlPreview}'"
        );

        $page = $this->wire()->pages->get($pageId);
        if(!$page->id) $this->sendJsonError('Page not found', 404);
        if(!$page->editable()) $this->sendJsonError('Page not editable', 403);

        if(!\ProcessWire\MarkdownConfig::supportsPage($page)) {
            $this->sendJsonError('MarkdownToFields not configured for this page', 400);
        }

        // Process content based on what was sent
        if ($markdown) {
            // Plain text markdown sent directly (multi-line container fields)
            $blockMarkdown = $markdown;
        } else {
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
            
            // Convert HTML -> Markdown using MarkdownToFields
            // For container fields (<!-- name ... -->), allow multi-line: <br> → markdown line breaks
            $containerFields = $this->getContainerFieldNames($page);
            $isContainer = isset($containerFields[$mdName]);
            $this->wire->log->save('markdown-front-edit',
                "CONVERT mdName='{$mdName}' isContainer=" . ($isContainer ? '1' : '0') . " htmlLen=" . strlen((string)$html)
            );
            
            try {
                $blockMarkdown = \ProcessWire\MarkdownHtmlConverter::convertHtmlToMarkdown($html, $page, $isContainer);
            } catch (\Throwable $e) {
                $this->sendJsonError('HTML to Markdown failed: ' . $e->getMessage(), 500);
            }
        }

        $blockLen = strlen((string)$blockMarkdown);
        $blockLines = $blockLen ? (substr_count((string)$blockMarkdown, "\n") + 1) : 0;
        $blockPreview = $blockLen ? substr(str_replace(["\r", "\n"], ["\\r", "\\n"], (string)$blockMarkdown), 0, 120) : '';
        $this->wire->log->save('markdown-front-edit',
            "RESULT mdName='{$mdName}' blockLen={$blockLen} blockLines={$blockLines} blockPreview='{$blockPreview}'"
        );

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
        $this->wire->log->save('markdown-front-edit', "BEFORE updateFieldInMarkdown: field='{$fieldName}' newMarkdownLen=" . strlen($newMarkdown) . " preview=" . substr(str_replace(["\r","\n"],["\\r","\\n"], $newMarkdown), 0, 60));
        \ProcessWire\MarkdownFileIO::updateFieldInMarkdown($page, $fieldName, $newMarkdown, $langCode);
        $this->wire->log->save('markdown-front-edit', "AFTER updateFieldInMarkdown: field='{$fieldName}' SUCCESS");
    }

    protected function sendJsonError($msg, $code = 400) {
        if($code) http_response_code($code);
        header('Content-Type: application/json');
        echo json_encode(['status' => 0, 'error' => $msg]);
        exit;
    }

    /**
     * Parse markdown source to detect container fields (<!-- name ... -->).
     * Returns array of field names that have the ... marker.
     */
    protected function getContainerFieldNames(\ProcessWire\Page $page): array {
        if (!class_exists('\\ProcessWire\\MarkdownFileIO')) return [];
        if (!class_exists('\\ProcessWire\\MarkdownLanguageResolver')) return [];
        
        try {
            $language = \ProcessWire\MarkdownLanguageResolver::getLanguageCode($page);
            $path = \ProcessWire\MarkdownFileIO::getMarkdownFilePath($page, $language);
            if (!is_file($path)) return [];

            $markdown = @file_get_contents($path);
            if ($markdown === false || $markdown === '') return [];

            $containers = [];
            // Match <!-- name ... --> markers
            if (preg_match_all('/<!--\s*([a-zA-Z0-9_-]+)(\\.{3})\s*-->/m', $markdown, $matches)) {
                foreach ($matches[1] as $fieldName) {
                    $containers[$fieldName] = true;
                }
            }
            
            return $containers;
        } catch (\Exception $e) {
            return [];
        }
    }

}
