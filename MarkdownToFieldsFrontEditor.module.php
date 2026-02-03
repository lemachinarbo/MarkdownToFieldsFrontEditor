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
            'version' =>  '0.3',
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
            'toolbarButtons' => 'bold,italic,strike,paragraph,link,unlink,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,code,codeblock,clear,|,split',
        ];
    }

    /**
     * Module configuration interface
     */
    public static function getModuleConfigInputfields(array $data) {
        $inputfields = new \ProcessWire\InputfieldWrapper();
        
        $defaults = self::getDefaultData();
        $data = array_merge($defaults, $data);

        $f = \ProcessWire\wire('modules')->get('InputfieldText');
        $f->name = 'toolbarButtons';
        $f->label = 'Toolbar Buttons';
        $f->description = 'Comma-separated list of toolbar buttons to show. Use "|" as a separator. Available: bold, italic, strike, code, codeblock, paragraph, h1-h6, ul, ol, blockquote, link, unlink, clear, split. Save is always shown at the end.';
        $f->notes = 'Defaults: bold,italic,strike,paragraph,link,unlink,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,code,codeblock,clear,|,split';
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

    public function install() {
        $defaults = self::getDefaultData();
        $this->wire('modules')->saveConfig($this, [
            'toolbarButtons' => $defaults['toolbarButtons'],
        ]);
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
        
        $defaults = self::getDefaultData();
        $toolbarButtons = isset($this->toolbarButtons) && trim((string)$this->toolbarButtons) !== ''
            ? (string)$this->toolbarButtons
            : (string)$defaults['toolbarButtons'];
        $currentLangCode = \ProcessWire\MarkdownLanguageResolver::getLanguageCode($this->wire()->page);
        if ($this->wire()->languages && $this->wire()->user && $this->wire()->user->language) {
            $currentLangCode = $this->wire()->user->language->name;
        }
        $langList = [];
        $languages = $this->wire()->languages;
        if ($languages) {
            foreach ($languages as $lang) {
                $langList[] = [
                    'name' => $lang->name,
                    'title' => (string)($lang->title ?: $lang->name),
                    'isDefault' => (bool)$lang->isDefault(),
                ];
            }
        } else {
            $langList[] = [
                'name' => 'default',
                'title' => 'Default',
                'isDefault' => true,
            ];
        }
        $frontConfig = [
            'toolbarButtons' => $toolbarButtons,
            'languages' => $langList,
            'currentLanguage' => $currentLangCode,
        ];
        $configScript = "<script>window.MarkdownFrontEditorConfig=" . json_encode($frontConfig) . ";</script>";

        $modulePath = $config->paths($this->className());
        $cssPath = $modulePath . 'assets/front-editor.css';
        $cssVersion = is_file($cssPath) ? (string) filemtime($cssPath) : (string) time();
        $cssHref = $url . 'assets/front-editor.css?v=' . $cssVersion;
        $cssLink = "<link rel=\"stylesheet\" href=\"{$cssHref}\">";

        $jsPath = $modulePath . 'dist/editor.bundle.js';
        $version = is_file($jsPath) ? (string) filemtime($jsPath) : (string) time();
        
        // Load bundled ProseMirror editor (single file, no external dependencies)
        $moduleScript = "<script src=\"{$url}dist/editor.bundle.js?v={$version}\"></script>";
        
        $script = $cssLink . $configScript . $moduleScript;

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

        // Collect all fields with their metadata: name, html, markdown, type
        $fields = [];
        foreach ($content->sections as $section) {
            if (isset($section->fields) && is_array($section->fields)) {
                foreach ($section->fields as $fname => $f) {
                    if (isset($f->html) && $f->html !== '') {
                        $fieldType = $this->resolveFieldType($f);
                        $html = $f->html;
                        // Trust MarkdownToFields API for field extraction and boundaries
                        $markdown = (string)($f->markdown ?? '');
                        $fields[$fname] = [
                            'html' => $html,
                            'markdown' => $markdown,
                            'type' => $fieldType,
                        ];
                        $this->wire->log->save('markdown-front-edit', "COLLECT field='{$fname}' type='{$fieldType}' markdownLen=" . strlen($markdown));
                    }
                }
            }
            if (isset($section->subsections) && is_array($section->subsections)) {
                foreach ($section->subsections as $subsection) {
                    if (isset($subsection->fields) && is_array($subsection->fields)) {
                        foreach ($subsection->fields as $fname => $f) {
                            if (isset($f->html) && $f->html !== '') {
                                $fieldType = $this->resolveFieldType($f);
                                $html = $f->html;
                                // Trust MarkdownToFields API for field extraction and boundaries
                                $markdown = (string)($f->markdown ?? '');
                                $fields[$fname] = [
                                    'html' => $html,
                                    'markdown' => $markdown,
                                    'type' => $fieldType,
                                ];
                                $this->wire->log->save('markdown-front-edit', "COLLECT field='{$fname}' type='{$fieldType}' markdownLen=" . strlen($markdown));
                            }
                        }
                    }
                }
            }
        }

        // Rebuild output by wrapping fields using HTML comment markers
        // LetMeDown source has <!-- fieldname --> markers; we'll insert them into HTML
        // then wrap based on those markers
        $rebuilt = $out;
        
        foreach ($content->sections as $section) {
            if (isset($section->fields) && is_array($section->fields)) {
                foreach ($section->fields as $fname => $f) {
                    if (isset($f->html) && $f->html !== '' && isset($fields[$fname])) {
                        $safeAttr = htmlspecialchars($fname, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $safeType = htmlspecialchars($fields[$fname]['type'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $safeMarkdown = htmlspecialchars($fields[$fname]['markdown'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $safeMarkdownB64 = htmlspecialchars(base64_encode($fields[$fname]['markdown']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        
                        // Check if already wrapped
                        if (stripos($rebuilt, 'data-md-name="' . $safeAttr . '"') !== false) continue;
                        
                        // Find and wrap the field
                        $originalHtml = $f->html;
                        $displayHtml = $fields[$fname]['html'];
                        $wrapper = '<div class="fe-editable md-edit" data-md-name="' . $safeAttr . '" data-field-type="' . $safeType . '" data-page="' . $page->id . '" data-markdown="' . $safeMarkdown . '" data-markdown-b64="' . $safeMarkdownB64 . '">' . $displayHtml . '</div>';
                        
                        // Find original HTML in output and replace with wrapped version
                        $pos = stripos($rebuilt, $originalHtml);
                        if ($pos !== false) {
                            $rebuilt = substr_replace($rebuilt, $wrapper, $pos, strlen($originalHtml));
                        }
                    }
                }
            }
            if (isset($section->subsections) && is_array($section->subsections)) {
                foreach ($section->subsections as $subsection) {
                    if (isset($subsection->fields) && is_array($subsection->fields)) {
                        foreach ($subsection->fields as $fname => $f) {
                            if (isset($f->html) && $f->html !== '' && isset($fields[$fname])) {
                                $safeAttr = htmlspecialchars($fname, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $safeType = htmlspecialchars($fields[$fname]['type'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $safeMarkdown = htmlspecialchars($fields[$fname]['markdown'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $safeMarkdownB64 = htmlspecialchars(base64_encode($fields[$fname]['markdown']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                
                                // Check if already wrapped
                                if (stripos($rebuilt, 'data-md-name="' . $safeAttr . '"') !== false) continue;
                                
                                $originalHtml = $f->html;
                                $displayHtml = $fields[$fname]['html'];
                                $wrapper = '<div class="fe-editable md-edit" data-md-name="' . $safeAttr . '" data-field-type="' . $safeType . '" data-page="' . $page->id . '" data-markdown="' . $safeMarkdown . '" data-markdown-b64="' . $safeMarkdownB64 . '">' . $displayHtml . '</div>';
                                
                                $pos = stripos($rebuilt, $originalHtml);
                                if ($pos !== false) {
                                    $rebuilt = substr_replace($rebuilt, $wrapper, $pos, strlen($originalHtml));
                                }
                            }
                        }
                    }
                }
            }
        }
        
        $out = $rebuilt;

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
        $out = "<div class=\"fe-editable md-edit\" data-md-name=\"{$safeAttr}\" data-field-type=\"{$safeType}\" data-page=\"{$page->id}\">";
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

        // Translations endpoint
        if ($input->get->markdownFrontEditorTranslations) {
            $user = $this->wire()->user;
            if(!$user->isLoggedIn() || !$user->hasPermission('page-edit-front')) {
                $this->sendJsonError('Forbidden', 403);
            }

            $mdName = $input->get->text('mdName');
            $pageId = (int)$input->get->pageId;
            if(!$mdName || !$pageId) {
                $this->sendJsonError('Missing mdName or pageId', 400);
            }

            $page = $this->wire()->pages->get($pageId);
            if(!$page || !$page->id) {
                $this->sendJsonError('Page not found', 404);
            }

            $languages = $this->wire()->languages;
            $langItems = [];
            if ($languages) {
                foreach ($languages as $lang) {
                    $langItems[] = $lang;
                }
            } else {
                $langItems[] = null;
            }

            $results = [];
            foreach ($langItems as $lang) {
                $langCode = $lang ? $lang->name : 'default';
                try {
                    $content = $page->loadContent(null, $lang ? $lang->name : null);
                    $found = null;
                    if (isset($content->sections) && is_array($content->sections)) {
                        foreach ($content->sections as $section) {
                            if (isset($section->fields[$mdName])) {
                                $found = $section->fields[$mdName]->markdown ?? '';
                                break;
                            }
                            if (isset($section->subsections)) {
                                foreach ($section->subsections as $subsection) {
                                    if (isset($subsection->fields[$mdName])) {
                                        $found = $subsection->fields[$mdName]->markdown ?? '';
                                        break 2;
                                    }
                                }
                            }
                        }
                    }
                    $results[$langCode] = (string)($found ?? '');
                } catch (\Throwable $e) {
                    $results[$langCode] = '';
                }
            }

            header('Content-Type: application/json');
            echo json_encode(['status' => 1, 'data' => $results]);
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

        // Accept markdown directly from frontend
        // IMPORTANT: Use raw POST data, not $input->post->textarea() which may sanitize HTML tags
        $markdown = isset($_POST['markdown']) ? (string)$_POST['markdown'] : '';
        
        if(!$markdown) {
            $this->sendJsonError('Missing markdown content', 400);
        }

        $mdName = $input->post->text('mdName');
        if(!$mdName) $this->sendJsonError('Missing mdName', 400);

        $pageId = (int)$input->post->pageId;
        if(!$pageId) $this->sendJsonError('Missing pageId', 400);

        $langCode = $input->post->text('lang');
        if ($langCode !== '') {
            $languages = $this->wire()->languages;
            if ($languages && !$languages->get($langCode)) {
                $this->sendJsonError('Invalid language', 400);
            }
        }

        // Trace payload details
        $markdownLen = strlen((string)$markdown);
        $markdownLines = $markdownLen ? (substr_count((string)$markdown, "\n") + 1) : 0;
        $markdownPreview = $markdownLen ? substr(str_replace(["\r", "\n"], ["\\r", "\\n"], (string)$markdown), 0, 120) : '';
        $this->wire->log->save('markdown-front-edit',
            "PAYLOAD mdName='{$mdName}' pageId={$pageId} markdownLen={$markdownLen} markdownLines={$markdownLines} markdownPreview='{$markdownPreview}'"
        );

        $page = $this->wire()->pages->get($pageId);
        if(!$page->id) $this->sendJsonError('Page not found', 404);
        if(!$page->editable()) $this->sendJsonError('Page not editable', 403);

        if(!\ProcessWire\MarkdownConfig::supportsPage($page)) {
            $this->sendJsonError('MarkdownToFields not configured for this page', 400);
        }

        // Use markdown directly - no conversion
        $blockMarkdown = $markdown;

        $blockLen = strlen((string)$blockMarkdown);
        $blockLines = $blockLen ? (substr_count((string)$blockMarkdown, "\n") + 1) : 0;
        $blockPreview = $blockLen ? substr(str_replace(["\r", "\n"], ["\\r", "\\n"], (string)$blockMarkdown), 0, 120) : '';
        $this->wire->log->save('markdown-front-edit',
            "RESULT mdName='{$mdName}' blockLen={$blockLen} blockLines={$blockLines} blockPreview='{$blockPreview}'"
        );

        if(trim((string)$blockMarkdown) === '') {
            $this->sendJsonError('Empty markdown', 400);
        }

        // TRUST THE FRAMEWORK: Use MarkdownToFields' native mechanisms
        try {
            // Load the current markdown document using MarkdownFileIO
            $content = \ProcessWire\MarkdownFileIO::loadMarkdown($page);
            
            // Get original field markdown from MarkdownToFields
            // MarkdownToFields handles all field boundary extraction
            $fullMarkdown = $content->getMarkdown();
            $oldFieldMarkdown = '';
            foreach ($content->sections as $section) {
                if (isset($section->fields[$mdName])) {
                    $oldFieldMarkdown = (string)($section->fields[$mdName]->markdown ?? '');
                    break;
                }
                // Check subsections if they exist
                if (isset($section->subsections)) {
                    foreach ($section->subsections as $subsection) {
                        if (isset($subsection->fields[$mdName])) {
                            $oldFieldMarkdown = (string)($subsection->fields[$mdName]->markdown ?? '');
                            break 2;
                        }
                    }
                }
            }
            
            // Get HTML for unchanged check
            $oldFieldHtml = null;
            foreach ($content->sections as $section) {
                if (isset($section->fields[$mdName])) {
                    $oldFieldHtml = $section->fields[$mdName]->html;
                    break;
                }
                // Check subsections if they exist
                if (isset($section->subsections)) {
                    foreach ($section->subsections as $subsection) {
                        if (isset($subsection->fields[$mdName])) {
                            $oldFieldHtml = $subsection->fields[$mdName]->html;
                            break 2;
                        }
                    }
                }
            }
            
            if ($oldFieldMarkdown === null) {
                $this->sendJsonError('Field not found in content: ' . $mdName, 400);
            }
            
            // Check if content is actually unchanged - if so, return cached HTML without re-parsing
            if ($blockMarkdown === trim($oldFieldMarkdown)) {
                $this->wire->log->save('markdown-front-edit',
                    "RESPONSE: Content unchanged, returning cached HTML (preserves HTML tags)"
                );
                header('Content-Type: application/json');
                echo json_encode(['status' => 1, 'html' => $oldFieldHtml]);
                exit;
            }
            
            // Simple string replacement - preserves all markdown formatting
            $updatedMarkdown = str_replace($oldFieldMarkdown, $blockMarkdown, $fullMarkdown, $count);
            
            if ($count === 0) {
                $this->sendJsonError('Failed to find field content for replacement', 400);
            }
            
            $this->wire->log->save('markdown-front-edit',
                "SAVE: Before saving - oldField='" . substr($oldFieldMarkdown, 0, 50) . "' blockMarkdown='" . substr($blockMarkdown, 0, 50) . "'"
            );
            
            // Use MarkdownFileIO's native save mechanism (respect current language or override)
            $languageCode = $langCode !== '' ? $langCode : \ProcessWire\MarkdownLanguageResolver::getLanguageCode($page);
            \ProcessWire\MarkdownFileIO::saveLanguageMarkdown($page, $updatedMarkdown, $languageCode);
            
            $this->wire->log->save('markdown-front-edit',
                "SAVE: After save - file updated"
            );
            
        } catch (\Throwable $e) {
            $this->sendJsonError('Failed to update markdown: ' . $e->getMessage(), 500);
        }

        $languageCode = $langCode !== '' ? $langCode : \ProcessWire\MarkdownLanguageResolver::getLanguageCode($page);
        $content = $page->loadContent(null, $languageCode);
        $canonicalHtml = null;
        
        $this->wire->log->save('markdown-front-edit',
            "RESPONSE: loadContent completed, looking for field '{$mdName}' in " . count($content->sections ?? []) . " sections"
        );
        
        if (isset($content->sections) && is_array($content->sections)) {
            foreach ($content->sections as $s) {
                if (isset($s->fields[$mdName]->html)) {
                    $canonicalHtml = $s->fields[$mdName]->html;
                    $this->wire->log->save('markdown-front-edit',
                        "RESPONSE: Found field HTML in section: " . substr($canonicalHtml, 0, 100)
                    );
                    break;
                }
                if (isset($s->subsections) && is_array($s->subsections)) {
                    foreach ($s->subsections as $sub) {
                        if (isset($sub->fields[$mdName]->html)) {
                            $canonicalHtml = $sub->fields[$mdName]->html;
                            $this->wire->log->save('markdown-front-edit',
                                "RESPONSE: Found field HTML in subsection: " . substr($canonicalHtml, 0, 100)
                            );
                            break 2;
                        }
                    }
                }
            }
        }
        
        // If the incoming markdown contains raw HTML tags (e.g., <br>), 
        // generate fresh HTML using Parsedown with safe mode disabled to preserve them
        if ($canonicalHtml && strpos($blockMarkdown, '<') !== false && strpos($blockMarkdown, '>') !== false) {
            $this->wire->log->save('markdown-front-edit',
                "RESPONSE: Markdown contains HTML tags, regenerating with safe HTML support"
            );
            // Use Parsedown directly with safe mode disabled to preserve raw HTML
            $parsedown = new \Parsedown();
            $parsedown->setSafeMode(false);
            $canonicalHtml = $parsedown->text($blockMarkdown);
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

    protected function sendJsonError($msg, $code = 400) {
        if($code) http_response_code($code);
        header('Content-Type: application/json');
        echo json_encode(['status' => 0, 'error' => $msg]);
        exit;
    }

}
