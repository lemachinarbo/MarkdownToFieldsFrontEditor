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
            'version' =>  '0.5.0',
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
            'toolbarButtons' => 'bold,italic,strike,paragraph,link,unlink,image,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,code,codeblock,clear,|,split,markers',
            'editableTargets' => ['tag', 'container'],
            'allowedImageExtensions' => 'jpg,jpeg,png,gif,webp,svg',
            'debug' => false,
            'debugShowSections' => false,
            'debugShowLabels' => false,
            'labelStyle' => 'outside',
            'confirmOnUnsavedClose' => true,
        ];
    }

    /**
     * Module configuration interface
     */
    public static function getModuleConfigInputfields(array $data) {
        $inputfields = new InputfieldWrapper();
        
        $defaults = self::getDefaultData();
        $data = array_merge($defaults, $data);

        $f = wire('modules')->get('InputfieldText');
        $f->name = 'toolbarButtons';
        $f->label = 'Toolbar Buttons';
        $f->description = 'Comma-separated list of toolbar buttons to show. Use "|" as a separator. Available: bold, italic, strike, code, codeblock, paragraph, h1-h6, ul, ol, blockquote, link, unlink, image, clear, split, markers. Save is always shown at the end.';
        $f->notes = 'Defaults: bold,italic,strike,paragraph,link,unlink,image,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,code,codeblock,clear,|,split,markers';
        $f->value = !empty($data['toolbarButtons']) ? $data['toolbarButtons'] : $defaults['toolbarButtons'];
        $f->columnWidth = 100;
        $inputfields->add($f);

        $targetsField = wire('modules')->get('InputfieldCheckboxes');
        $targetsField->name = 'editableTargets';
        $targetsField->label = 'Editable Targets';
        $targetsField->description = 'Choose which field types get auto-wrapped for editing.';
        $targetsField->options = [
            'tag' => 'Tag fields (<!-- name -->)',
            'container' => 'Container fields (<!-- name... -->)',
            'bind' => 'Bind fields (<!-- field:name -->)',
        ];
        $targetsField->value = !empty($data['editableTargets']) ? $data['editableTargets'] : $defaults['editableTargets'];
        $targetsField->notes = 'Defaults: tag, container';
        $targetsField->columnWidth = 100;
        $inputfields->add($targetsField);

        $debugLoggingField = wire('modules')->get('InputfieldCheckbox');
        $debugLoggingField->name = 'debug';
        $debugLoggingField->label = 'Enable Debug Logging';
        $debugLoggingField->description = 'When enabled, verbose diagnostic logs are written to markdown-front-edit.txt';
        $debugLoggingField->value = 1;
        $debugLoggingField->checked = !empty($data['debug']);
        $debugLoggingField->columnWidth = 100;
        $inputfields->add($debugLoggingField);

        $debugField = wire('modules')->get('InputfieldCheckbox');
        $debugField->name = 'debugShowSections';
        $debugField->label = 'Debug: Always Show Section Bounds';
        $debugField->description = 'When enabled, section/subsection wrappers are outlined with labels in the frontend.';
        $debugField->value = 1;
        $debugField->checked = !empty($data['debugShowSections']);
        $debugField->columnWidth = 100;
        $inputfields->add($debugField);

        $debugLabelsField = wire('modules')->get('InputfieldCheckbox');
        $debugLabelsField->name = 'debugShowLabels';
        $debugLabelsField->label = 'Debug: Show editable areas Labels';
        $debugLabelsField->description = 'Shows scope labels like "section:hero" in the rollover helper.';
        $debugLabelsField->value = 1;
        $debugLabelsField->checked = !empty($data['debugShowLabels']);
        $debugLabelsField->columnWidth = 100;
        $inputfields->add($debugLabelsField);

        $labelStyleField = wire('modules')->get('InputfieldRadios');
        $labelStyleField->name = 'labelStyle';
        $labelStyleField->label = 'Label Position';
        $labelStyleField->description = 'Choose whether labels sit outside or inside the region.';
        $labelStyleField->options = [
            'outside' => 'Outside (top-right)',
            'inside' => 'Inside (top-right)',
        ];
        $labelStyleField->value = !empty($data['labelStyle']) ? $data['labelStyle'] : $defaults['labelStyle'];
        $labelStyleField->columnWidth = 100;
        $inputfields->add($labelStyleField);

        $confirmUnsavedField = wire('modules')->get('InputfieldCheckbox');
        $confirmUnsavedField->name = 'confirmOnUnsavedClose';
        $confirmUnsavedField->label = 'Prompt Before Closing Unsaved Editor';
        $confirmUnsavedField->description = 'When enabled, closing the fullscreen editor (Escape/close button) asks confirmation if there are unsaved changes.';
        $confirmUnsavedField->value = 1;
        $confirmUnsavedField->checked = array_key_exists('confirmOnUnsavedClose', $data)
            ? !empty($data['confirmOnUnsavedClose'])
            : !empty($defaults['confirmOnUnsavedClose']);
        $confirmUnsavedField->columnWidth = 100;
        $inputfields->add($confirmUnsavedField);

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
            'editableTargets' => $defaults['editableTargets'],
            'debug' => $defaults['debug'],
            'debugShowSections' => $defaults['debugShowSections'],
            'debugShowLabels' => $defaults['debugShowLabels'],
            'labelStyle' => $defaults['labelStyle'],
            'confirmOnUnsavedClose' => $defaults['confirmOnUnsavedClose'],
        ]);
    }

    /**
     * Log debug messages (only when debug mode is enabled)
     */
    private function logDebug(string $message): void {
        $enabled = (bool)($this->debug ?? false);
        if (!$enabled) {
            return;
        }
        $this->wire->log->save('markdown-front-edit', $message);
    }

    /**
     * Log info events (debug mode only)
     */
    private function logInfo(string $message): void {
        $enabled = (bool)($this->debug ?? false);
        if (!$enabled) {
            return;
        }
        $this->wire->log->save('markdown-front-edit', $message);
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
        if (!$user->isLoggedIn() || !$user->hasPermission('page-edit-front')) return;

        $page = $event->object;
        if (!$page instanceof \ProcessWire\Page) return;
        $enabled = $this->enabledForRequest || $this->isMarkdownTemplateEnabled($page);
        if (!$enabled) return;

        $out = $event->return;
        if (!is_string($out)) return;
        
        $url = $config->urls($this->className());
        
        $defaults = self::getDefaultData();
        $toolbarButtons = isset($this->toolbarButtons) && trim((string)$this->toolbarButtons) !== ''
            ? (string)$this->toolbarButtons
            : (string)$defaults['toolbarButtons'];
        $currentLangCode = \ProcessWire\MarkdownLanguageResolver::getLanguageCode($this->wire()->page);
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
        $modulePath = $config->paths($this->className());
        $jsPath = $modulePath . 'dist/editor.bundle.js';
        $version = is_file($jsPath) ? (string) filemtime($jsPath) : (string) time();
        $sectionsIndex = $this->buildSectionsIndex($page);
        $fieldsIndex = $this->buildFieldsIndex($page);

        $frontConfig = [
            'toolbarButtons' => $toolbarButtons,
            'editableTargets' => $this->getEditableTargets(),
            'languages' => $langList,
            'currentLanguage' => $currentLangCode,
            'imageBaseUrl' => rtrim((string)$this->wire()->config->urls->site, '/') . '/images/',
            'pageFilesBaseUrl' => rtrim((string)$this->wire()->config->urls->files, '/') . '/' . (int)$page->id . '/',
            'buildStamp' => $version,
            'sectionsIndex' => $sectionsIndex,
            'fieldsIndex' => $fieldsIndex,
            'debug' => (bool)($this->debug ?? false),
            'debugShowSections' => (bool)($this->debugShowSections ?? false),
            'debugLabels' => (bool)($this->debugShowLabels ?? false),
            'labelStyle' => (string)($this->labelStyle ?? $defaults['labelStyle']),
            'confirmOnUnsavedClose' => (bool)($this->confirmOnUnsavedClose ?? $defaults['confirmOnUnsavedClose']),
        ];
        $configScript = "<script>window.MarkdownFrontEditorConfig=" . json_encode($frontConfig) . ";document.body.setAttribute('data-mfe-build','{$version}');</script>";

        $cssPath = $modulePath . 'assets/front-editor.css';
        $cssVersion = is_file($cssPath) ? (string) filemtime($cssPath) : (string) time();
        $cssHref = $url . 'assets/front-editor.css?v=' . $cssVersion;
        $cssLink = "<link rel=\"stylesheet\" href=\"{$cssHref}\">";

        $inlineCssPath = $modulePath . 'assets/front-editor-inline.css';
        $inlineCssVersion = is_file($inlineCssPath) ? (string) filemtime($inlineCssPath) : (string) time();
        $inlineCssHref = $url . 'assets/front-editor-inline.css?v=' . $inlineCssVersion;

        $fullscreenCssPath = $modulePath . 'assets/front-editor-fullscreen.css';
        $fullscreenCssVersion = is_file($fullscreenCssPath) ? (string) filemtime($fullscreenCssPath) : (string) time();
        $fullscreenCssHref = $url . 'assets/front-editor-fullscreen.css?v=' . $fullscreenCssVersion;

        $imagePickerCssPath = $modulePath . 'assets/image-picker.css';
        $imagePickerCssVersion = is_file($imagePickerCssPath) ? (string) filemtime($imagePickerCssPath) : (string) time();
        $imagePickerCssHref = $url . 'assets/image-picker.css?v=' . $imagePickerCssVersion;

        $viewCssLink = "<link rel=\"stylesheet\" href=\"{$inlineCssHref}\">";
        $viewCssLink .= "<link rel=\"stylesheet\" href=\"{$fullscreenCssHref}\">";
        $viewCssLink .= "<link rel=\"stylesheet\" href=\"{$imagePickerCssHref}\">";
        
        // Load bundled ProseMirror editor (single file, no external dependencies)
        $moduleScript = "<script src=\"{$url}dist/editor.bundle.js?v={$version}\"></script>";
        
        $script = $cssLink . $viewCssLink . $configScript . $moduleScript;

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
        if (!$this->enabledForRequest && !$this->isMarkdownTemplateEnabled($page)) return;
        
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

        $targets = $this->getEditableTargets();
        $allow = fn($kind) => in_array($kind, $targets, true);

        $sectionNameByObject = [];
        if (isset($content->sectionsByName) && is_array($content->sectionsByName)) {
            foreach ($content->sectionsByName as $sectionName => $sectionObj) {
                if (!$sectionObj) continue;
                $sectionNameByObject[spl_object_hash($sectionObj)] = $sectionName;
            }
        }

        // Collect all fields with their metadata: name, html, markdown, type
        $fields = [];
        foreach ($content->sections as $section) {
            if (isset($section->fields) && is_array($section->fields)) {
                foreach ($section->fields as $fname => $f) {
                    if (isset($f->html) && $f->html !== '') {
                        $fieldKind = $this->resolveFieldKind($f);
                        if (!$allow($fieldKind)) continue;
                        $fieldType = $this->resolveFieldType($f);
                        $html = $f->html;
                        // Trust MarkdownToFields API for field extraction and boundaries
                        $markdown = (string)($f->markdown ?? '');
                        $sectionName = $sectionNameByObject[spl_object_hash($section)] ?? '';
                        $fields[$fname] = [
                            'html' => $html,
                            'markdown' => $markdown,
                            'type' => $fieldType,
                            'section' => $sectionName,
                            'sectionMarkdown' => (string)($section->markdown ?? ''),
                        ];
                        $this->logDebug("COLLECT field='{$fname}' type='{$fieldType}' markdownLen=" . strlen($markdown));
                    }
                }
            }
            if (isset($section->subsections) && is_array($section->subsections)) {
                foreach ($section->subsections as $subsectionName => $subsection) {
                    if (isset($subsection->fields) && is_array($subsection->fields)) {
                        foreach ($subsection->fields as $fname => $f) {
                            if (isset($f->html) && $f->html !== '') {
                                $fieldKind = $this->resolveFieldKind($f);
                                if (!$allow($fieldKind)) continue;
                                $fieldType = $this->resolveFieldType($f);
                                $html = $f->html;
                                // Trust MarkdownToFields API for field extraction and boundaries
                                $markdown = (string)($f->markdown ?? '');
                                $sectionName = $sectionNameByObject[spl_object_hash($section)] ?? '';
                                $fields[$fname] = [
                                    'html' => $html,
                                    'markdown' => $markdown,
                                    'type' => $fieldType,
                                    'section' => $sectionName,
                                    'sectionMarkdown' => (string)($section->markdown ?? ''),
                                    'subsection' => (string)$subsectionName,
                                    'subsectionMarkdown' => (string)($subsection->markdown ?? ''),
                                ];
                                $this->logDebug("COLLECT field='{$fname}' type='{$fieldType}' markdownLen=" . strlen($markdown));
                            }
                        }
                    }
                }
            }
        }

        // Rebuild output by wrapping blocks/fields using HTML comment markers
        // LetMeDown source has <!-- fieldname --> markers; we'll insert them into HTML
        // then wrap based on those markers
        $rebuilt = $out;

        // Keep rendered DOM unchanged: no automatic section/subsection wrapper injection.
        // Section/subsection editing is opt-in via explicit [data-mfe] hosts.
        // Field wrappers still carry section/subsection metadata for save routing.
        
        foreach ($content->sections as $section) {
            if (isset($section->fields) && is_array($section->fields)) {
                foreach ($section->fields as $fname => $f) {
                    if (isset($f->html) && $f->html !== '') {
                        $safeAttr = htmlspecialchars($fname, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $safeType = htmlspecialchars($this->resolveFieldType($f), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $fieldMarkdown = (string)($f->markdown ?? '');
                        $safeMarkdown = htmlspecialchars($fieldMarkdown, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $safeMarkdownB64 = htmlspecialchars(base64_encode($fieldMarkdown), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $sectionName = $sectionNameByObject[spl_object_hash($section)] ?? '';
                        $safeSection = htmlspecialchars($sectionName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $sourceKey = $this->scopedHtmlKey('field', (string)$fname, (string)$sectionName, '');
                        $safeSourceKey = htmlspecialchars($sourceKey, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        
                        // Check if already wrapped
                        if (
                            stripos($rebuilt, 'data-md-name="' . $safeAttr . '" data-md-section="' . $safeSection . '"') !== false ||
                            stripos($rebuilt, 'data-mfe-name="' . $safeAttr . '" data-mfe-section="' . $safeSection . '"') !== false
                        ) continue;
                        
                        // Find and wrap the field
                        $originalHtml = $f->html;
                        $displayHtml = $f->html;
                        $wrapper = '<div class="fe-editable md-edit" data-md-scope="field" data-mfe-scope="field" data-md-name="' . $safeAttr . '" data-mfe-name="' . $safeAttr . '" data-md-section="' . $safeSection . '" data-mfe-section="' . $safeSection . '" data-mfe-source="' . $safeSourceKey . '" data-field-type="' . $safeType . '" data-page="' . $page->id . '" data-markdown="' . $safeMarkdown . '" data-markdown-b64="' . $safeMarkdownB64 . '">' . $displayHtml . '</div>';
                        
                        // Find original HTML in output and replace with wrapped version
                        $pos = stripos($rebuilt, $originalHtml);
                        if ($pos !== false) {
                            $rebuilt = substr_replace($rebuilt, $wrapper, $pos, strlen($originalHtml));
                        }
                    }
                }
            }
            if (isset($section->subsections) && is_array($section->subsections)) {
                foreach ($section->subsections as $subsectionName => $subsection) {
                    if (isset($subsection->fields) && is_array($subsection->fields)) {
                        foreach ($subsection->fields as $fname => $f) {
                            if (isset($f->html) && $f->html !== '') {
                                $safeAttr = htmlspecialchars($fname, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $safeType = htmlspecialchars($this->resolveFieldType($f), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $fieldMarkdown = (string)($f->markdown ?? '');
                                $safeMarkdown = htmlspecialchars($fieldMarkdown, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $safeMarkdownB64 = htmlspecialchars(base64_encode($fieldMarkdown), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $sectionName = $sectionNameByObject[spl_object_hash($section)] ?? '';
                                $subsectionName = (string)$subsectionName;
                                $safeSection = htmlspecialchars($sectionName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $safeSubsection = htmlspecialchars($subsectionName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $sourceKey = $this->scopedHtmlKey('field', (string)$fname, (string)$sectionName, (string)$subsectionName);
                                $safeSourceKey = htmlspecialchars($sourceKey, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                
                                // Check if already wrapped
                                if (
                                    stripos($rebuilt, 'data-md-name="' . $safeAttr . '" data-md-section="' . $safeSection . '" data-md-subsection="' . $safeSubsection . '"') !== false ||
                                    stripos($rebuilt, 'data-mfe-name="' . $safeAttr . '" data-mfe-section="' . $safeSection . '" data-mfe-subsection="' . $safeSubsection . '"') !== false
                                ) continue;
                                
                                $originalHtml = $f->html;
                                $displayHtml = $f->html;
                                $wrapper = '<div class="fe-editable md-edit" data-md-scope="field" data-mfe-scope="field" data-md-name="' . $safeAttr . '" data-mfe-name="' . $safeAttr . '" data-md-section="' . $safeSection . '" data-mfe-section="' . $safeSection . '" data-md-subsection="' . $safeSubsection . '" data-mfe-subsection="' . $safeSubsection . '" data-mfe-source="' . $safeSourceKey . '" data-field-type="' . $safeType . '" data-page="' . $page->id . '" data-markdown="' . $safeMarkdown . '" data-markdown-b64="' . $safeMarkdownB64 . '">' . $displayHtml . '</div>';
                                
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
        if (!$this->enabledForRequest && !$this->isMarkdownTemplateEnabled($page)) {
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
        $fieldKind = null;
        
        if (isset($content->sections) && is_array($content->sections)) {
            foreach ($content->sections as $section) {
                if (isset($section->fields[$fieldName])) {
                    $fieldType = $this->resolveFieldType($section->fields[$fieldName]);
                    $fieldKind = $this->resolveFieldKind($section->fields[$fieldName]);
                    break;
                }
                if (isset($section->subsections) && is_array($section->subsections)) {
                    foreach ($section->subsections as $subsection) {
                        if (isset($subsection->fields[$fieldName])) {
                            $fieldType = $this->resolveFieldType($subsection->fields[$fieldName]);
                            $fieldKind = $this->resolveFieldKind($subsection->fields[$fieldName]);
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
        $targets = $this->getEditableTargets();
        if ($fieldKind && !in_array($fieldKind, $targets, true)) {
            $event->return = $html;
            return;
        }

        // Wrap in editable container with metadata
        $safeAttr = htmlspecialchars($fieldName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeType = htmlspecialchars($fieldType, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $sourceKey = htmlspecialchars($this->scopedHtmlKey('field', $fieldName, '', ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $out = "<div class=\"fe-editable md-edit\" data-md-scope=\"field\" data-mfe-scope=\"field\" data-md-name=\"{$safeAttr}\" data-mfe-name=\"{$safeAttr}\" data-mfe-source=\"{$sourceKey}\" data-field-type=\"{$safeType}\" data-page=\"{$page->id}\">";
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
            $mdScope = $input->get->text('mdScope') ?: 'field';
            $mdSection = $input->get->text('mdSection');
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
                    $found = $this->findScopedMarkdown($content, $mdScope, $mdName, $mdSection ?? '');
                    $results[$langCode] = (string)($found ?? '');
                } catch (\Throwable $e) {
                    $results[$langCode] = '';
                }
            }

            header('Content-Type: application/json');
            echo json_encode(['status' => 1, 'data' => $results]);
            exit;
        }

        // List images endpoint
        if ($input->post->text('action') === 'listImages') {
            $user = $this->wire()->user;
            if(!$user->isLoggedIn() || !$user->hasPermission('page-edit-front')) {
                $this->sendJsonError('Forbidden', 403);
            }

            // CSRF validation
            try { $this->wire()->session->CSRF->validate(); }
            catch(\Exception $e) { $this->sendJsonError('Failed CSRF check', 403); }

            $pageId = (int)$input->post->pageId;
            if(!$pageId) $this->sendJsonError('Missing pageId', 400);

            $page = $this->wire()->pages->get($pageId);
            if(!$page->id) $this->sendJsonError('Page not found', 404);

            // Get image source paths (config override first, then module config)
            $imageSourcePaths = [];
            $cfg = $this->wire()->config->MarkdownToFields ?? [];
            $paths = $cfg['imageSourcePaths'] ?? [];
            if (is_string($paths)) {
                $imageSourcePaths = array_filter(array_map('trim', explode(',', $paths)));
            } elseif (is_array($paths)) {
                $imageSourcePaths = $paths;
            }

            if (empty($imageSourcePaths)) {
                $mdConfig = $this->wire()->modules->get('MarkdownToFields');
                if ($mdConfig && isset($mdConfig->imageSourcePaths)) {
                    $paths = $mdConfig->imageSourcePaths;
                    if (is_string($paths)) {
                        $imageSourcePaths = array_filter(array_map('trim', explode(',', $paths)));
                    } elseif (is_array($paths)) {
                        $imageSourcePaths = $paths;
                    }
                }
            }

            // Default to site/images/ if not configured
            if (empty($imageSourcePaths)) {
                $imageSourcePaths = [$this->wire()->config->paths->site . 'images/'];
            }

            $images = [];
            $missingDirs = [];
            $allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
            $warnedOutsideRoot = false;

            $cfg = $this->wire()->config;
            $sitePath = rtrim((string)($cfg->paths->site ?? ''), '/') . '/';
            $siteImages = $sitePath . 'images/';
            $siteUrl = rtrim((string)($cfg->urls->site ?? '/'), '/') . '/';
            $projectRoot = rtrim((string)($cfg->paths->projectRoot ?? ''), '/') . '/';
            $projectSiteImages = $projectRoot !== '/' ? $projectRoot . 'src/site/images/' : '';
            $rootPath = rtrim((string)($cfg->paths->root ?? ''), '/') . '/';

            // Normalize trailing slash for reliable comparisons
            $siteImagesNorm = rtrim($siteImages, '/') . '/';
            $projectSiteImagesNorm = $projectSiteImages ? rtrim($projectSiteImages, '/') . '/' : '';

            foreach ($imageSourcePaths as $sourcePath) {
                $fullPath = $sourcePath;
                if (!is_dir($fullPath)) {
                    $missingDirs[] = $fullPath;
                    continue;
                }

                $fullPathNorm = rtrim($fullPath, '/') . '/';

                try {
                    $files = new \RecursiveIteratorIterator(
                        new \RecursiveDirectoryIterator(
                            $fullPathNorm,
                            \FilesystemIterator::SKIP_DOTS
                        )
                    );
                } catch (\Throwable $e) {
                    $missingDirs[] = $fullPath;
                    continue;
                }
                foreach ($files as $file) {
                    if (!$file->isFile()) continue;
                    
                    $ext = strtolower($file->getExtension());
                    if (!in_array($ext, $allowedExtensions, true)) continue;

                    $filename = $file->getFilename();
                    $fullFilename = str_replace('\\', '/', $file->getPathname());
                    $relativeSourcePath = ltrim(substr($fullFilename, strlen($fullPathNorm)), '/');
                    $relativeSourcePath = str_replace('\\', '/', $relativeSourcePath);

                    if ($fullPathNorm === $siteImagesNorm || ($projectSiteImagesNorm && $fullPathNorm === $projectSiteImagesNorm)) {
                        $url = $siteUrl . 'images/' . $relativeSourcePath;
                    } elseif ($sitePath && str_starts_with($fullPathNorm, $sitePath)) {
                        $relativePath = ltrim(substr($fullPathNorm, strlen($sitePath)), '/');
                        $url = $siteUrl . rtrim($relativePath, '/') . '/' . $relativeSourcePath;
                    } else {
                        if (!$warnedOutsideRoot && $rootPath && !str_starts_with($fullPathNorm, $rootPath)) {
                            $this->logInfo(sprintf(
                                "LIST_IMAGES warning: path outside root/site: %s",
                                $fullPathNorm
                            ));
                            $warnedOutsideRoot = true;
                        }
                        $relativePath = $rootPath ? str_replace($rootPath, '/', $fullPathNorm) : $fullPathNorm;
                        $url = rtrim($relativePath, '/') . '/' . $relativeSourcePath;
                    }

                    $images[] = [
                        'filename' => $filename,
                        'path' => $relativeSourcePath,
                        'url' => $url,
                        'size' => $file->getSize(),
                    ];
                }
            }

            $this->logDebug(sprintf(
                "LIST_IMAGES pageId=%d paths=%s missing=%s count=%d",
                $pageId,
                json_encode(array_values($imageSourcePaths)),
                json_encode(array_values($missingDirs)),
                count($images)
            ));

            header('Content-Type: application/json');
            echo json_encode(['status' => 1, 'images' => $images]);
            exit;
        }

        // Save endpoint
        if($input->get->markdownFrontEditorFragments) {
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

            $pageId = (int)$input->post->pageId;
            if(!$pageId) $this->sendJsonError('Missing pageId', 400);

            $langCode = $input->post->text('lang');
            if ($langCode !== '') {
                $languages = $this->wire()->languages;
                if ($languages && !$languages->get($langCode)) {
                    $this->sendJsonError('Invalid language', 400);
                }
            }

            $page = $this->wire()->pages->get($pageId);
            if(!$page->id) $this->sendJsonError('Page not found', 404);
            if(!$page->editable()) $this->sendJsonError('Page not editable', 403);
            if(!\ProcessWire\MarkdownConfig::supportsPage($page)) {
                $this->sendJsonError('MarkdownToFields not configured for this page', 400);
            }

            $languageCode = $this->resolveRequestLanguageCode($page, $langCode);
            $transport = $input->post->text('transport') ?: 'datastar';
            $keysPayload = (string)$input->post('keys', 'string');
            $keys = [];
            if ($keysPayload !== '') {
                $decoded = wireDecodeJSON($keysPayload);
                if (is_array($decoded)) {
                    $keys = array_values(array_filter(array_map('strval', $decoded)));
                }
            }
            if (!$keys) {
                $keys = (array)$input->post('keys');
                $keys = array_values(array_filter(array_map('strval', $keys)));
            }
            $keys = $this->normalizeCanonicalKeys($keys);
            if (!$keys) {
                $this->sendJsonError('Missing keys', 400);
            }

            $targetsPayload = (string)$input->post('mountTargets', 'string');
            $mountTargets = [];
            if ($targetsPayload !== '') {
                $decodedTargets = wireDecodeJSON($targetsPayload);
                if (is_array($decodedTargets)) {
                    foreach ($decodedTargets as $k => $targets) {
                        $key = trim((string)$k);
                        if (!$this->isCanonicalScopedKey($key)) continue;
                        $mountTargets[$key] = is_array($targets) ? $targets : [];
                    }
                }
            }
            $clientGraphChecksum = trim((string)$input->post->text('graphChecksum'));
            $clientGraphNodeCount = (int)$input->post->int('graphNodeCount');

            $this->logInfo(sprintf(
                "FRAGMENTS_REQUEST pageId=%d lang='%s' transport='%s' keys=%d mountTargetKeys=%d graph='%s' graphNodes=%d",
                $pageId,
                $languageCode,
                $transport,
                count($keys),
                count($mountTargets),
                $clientGraphChecksum,
                $clientGraphNodeCount
            ));

            try {
                $renderedHtml = $this->renderPageHtmlForLang($page, $languageCode);
                if ($renderedHtml === '') {
                    $this->logInfo("FRAGMENTS_ERROR reason=empty_render_html pageId={$pageId} lang='{$languageCode}'");
                    $this->sendJsonError('Failed to render page fragments', 500);
                }

                $sectionsIndex = $this->buildSectionsIndex($page);
                $fieldsIndex = $this->buildFieldsIndex($page);
                $graphMeta = [];
                $fragments = $this->extractRenderedFragmentsByKeys(
                    $renderedHtml,
                    $keys,
                    $sectionsIndex,
                    $fieldsIndex,
                    $graphMeta
                );
                $serverGraphChecksum = (string)($graphMeta['graphChecksum'] ?? '');
                $serverGraphNodeCount = (int)($graphMeta['graphNodeCount'] ?? 0);
                if ($clientGraphChecksum !== '' && $serverGraphChecksum !== '' && $clientGraphChecksum !== $serverGraphChecksum) {
                    $this->logInfo(sprintf(
                        "FRAGMENTS_GRAPH_MISMATCH pageId=%d lang='%s' client='%s' clientNodes=%d server='%s' serverNodes=%d",
                        $pageId,
                        $languageCode,
                        $clientGraphChecksum,
                        $clientGraphNodeCount,
                        $serverGraphChecksum,
                        $serverGraphNodeCount
                    ));
                }

                $missing = [];
                foreach ($keys as $k) {
                    if (!isset($fragments[$k])) $missing[] = $k;
                }

                $this->logInfo(sprintf(
                    "FRAGMENTS_RESULT pageId=%d lang='%s' requested=%d resolved=%d missing=%d keys='%s' missingKeys='%s'",
                    $pageId,
                    $languageCode,
                    count($keys),
                    count($fragments),
                    count($missing),
                    implode(',', $keys),
                    implode(',', $missing)
                ));

                if ($transport === 'json') {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'status' => 1,
                        'fragments' => $fragments,
                        'missing' => $missing,
                    ]);
                    exit;
                }

                $this->sendDatastarPatchElementsStream($fragments, $mountTargets, $missing);
                exit;
            } catch (\Throwable $e) {
                $this->logInfo(sprintf(
                    "FRAGMENTS_ERROR reason=exception pageId=%d lang='%s' class='%s' message='%s'",
                    $pageId,
                    $languageCode,
                    get_class($e),
                    str_replace(["\n", "\r"], ' ', (string)$e->getMessage())
                ));
                $this->sendJsonError('Fragment render failed', 500);
            }
        }

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
        $isBatch = (bool)$input->post->int('batch');
        $pageId = (int)$input->post->pageId;
        if(!$pageId) $this->sendJsonError('Missing pageId', 400);

        $langCode = $input->post->text('lang');
        if ($langCode !== '') {
            $languages = $this->wire()->languages;
            if ($languages && !$languages->get($langCode)) {
                $this->sendJsonError('Invalid language', 400);
            }
        }

        $page = $this->wire()->pages->get($pageId);
        if(!$page->id) $this->sendJsonError('Page not found', 404);
        if(!$page->editable()) $this->sendJsonError('Page not editable', 403);

        if(!\ProcessWire\MarkdownConfig::supportsPage($page)) {
            $this->sendJsonError('MarkdownToFields not configured for this page', 400);
        }
        $languageCode = $this->resolveRequestLanguageCode($page, $langCode);

        $mdScope = $input->post->text('mdScope') ?: 'field';
        $mdSection = $input->post->text('mdSection');
        $fieldId = $input->post->text('fieldId');
        $postKeys = implode(',', array_keys($_POST ?? []));
        $this->logInfo(
            "SAVE_REQUEST pageId={$pageId} mdScope='{$mdScope}' mdSection='{$mdSection}' fieldId='{$fieldId}' lang='{$langCode}' resolvedLang='{$languageCode}' batch=" . ($isBatch ? '1' : '0') . " postKeys='{$postKeys}'"
        );

        if ($isBatch) {
            $fieldsJson = (string)$input->post('fields', 'string');
            $fieldsPayload = wireDecodeJSON($fieldsJson);
            if (!is_array($fieldsPayload) || !$fieldsPayload) {
                $this->sendJsonError('Missing fields payload', 400);
            }

            $fieldEntries = [];
            if (array_is_list($fieldsPayload)) {
                foreach ($fieldsPayload as $entry) {
                    if (!is_array($entry)) continue;
                    $md = (string)($entry['markdown'] ?? '');
                    $img = '';
                    if (preg_match('/<img[^>]+src=["\']([^"\']+)["\']/', $md, $m)) {
                        $img = $m[1];
                    } elseif (preg_match('/!\\[[^\\]]*\\]\\(([^)]+)\\)/', $md, $m)) {
                        $img = $m[1];
                    }
                    $this->logDebug(
                        "BATCH_FIELD key='" . (string)($entry['key'] ?? '') . "' name='" . (string)($entry['name'] ?? '') . "' scope='" . (string)($entry['scope'] ?? '') . "' section='" . (string)($entry['section'] ?? '') . "' mdLen=" . strlen($md) . " image='{$img}'"
                    );
                    $fieldEntries[] = [
                        'key' => (string)($entry['key'] ?? ''),
                        'name' => (string)($entry['name'] ?? ''),
                        'scope' => (string)($entry['scope'] ?? 'field'),
                        'section' => (string)($entry['section'] ?? ''),
                        'subsection' => (string)($entry['subsection'] ?? ''),
                        'markdown' => $md,
                    ];
                }
            } else {
                foreach ($fieldsPayload as $mdName => $blockMarkdown) {
                    $md = (string)$blockMarkdown;
                    $img = '';
                    if (preg_match('/<img[^>]+src=["\']([^"\']+)["\']/', $md, $m)) {
                        $img = $m[1];
                    } elseif (preg_match('/!\\[[^\\]]*\\]\\(([^)]+)\\)/', $md, $m)) {
                        $img = $m[1];
                    }
                    $this->logDebug(
                        "BATCH_FIELD key='{$mdName}' name='{$mdName}' scope='field' section='' mdLen=" . strlen($md) . " image='{$img}'"
                    );
                    $fieldEntries[] = [
                        'key' => (string)$mdName,
                        'name' => (string)$mdName,
                        'scope' => 'field',
                        'section' => '',
                        'markdown' => $md,
                    ];
                }
            }

            try {
                $fullMarkdown = $this->loadRawMarkdownDocument($page, $languageCode);
                $rawContent = $this->parseRawMarkdownDocument($fullMarkdown);
                $updatedMarkdown = $fullMarkdown;
                $skipped = [];
                $replaced = 0;
                $changedKeys = [];

                foreach ($fieldEntries as $entry) {
                    $key = $entry['key'];
                    $mdName = $entry['name'];
                    $scope = $entry['scope'] ?: 'field';
                    $sectionName = $entry['section'];
                    $blockMarkdown = (string)($entry['markdown'] ?? '');

                    if ($mdName === '' || trim($blockMarkdown) === '') {
                        $skipped[] = $key;
                        continue;
                    }

                    $oldFieldMarkdown = $this->findScopedMarkdown(
                        $rawContent,
                        (string)$scope,
                        (string)$mdName,
                        (string)$sectionName,
                        (string)($entry['subsection'] ?? '')
                    );
                    if ($oldFieldMarkdown === null) {
                        $skipped[] = $key;
                        continue;
                    }

                    $blockMarkdown = $this->preserveMarkdownFormattingFromOriginal($oldFieldMarkdown, $blockMarkdown);
                    $mergedImageOnly = $this->mergeImageSrcOnlyChange($oldFieldMarkdown, $blockMarkdown);
                    if ($mergedImageOnly !== null) {
                        $blockMarkdown = $mergedImageOnly;
                        $this->logDebug(
                            "IMAGE_ONLY_MERGE batch key='{$key}' scope='{$scope}' section='{$sectionName}'"
                        );
                    }
                    if ($oldFieldMarkdown === $blockMarkdown) {
                        continue;
                    }

                    $replaceResult = $this->replaceUniqueMarkdownBlock(
                        $updatedMarkdown,
                        $blockMarkdown,
                        (string)$scope,
                        (string)$mdName,
                        (string)$sectionName,
                        (string)($entry['subsection'] ?? ''),
                        [
                            'mode' => 'batch',
                            'key' => (string)$key,
                            'scope' => (string)$scope,
                            'name' => (string)$mdName,
                            'section' => (string)$sectionName,
                            'subsection' => (string)($entry['subsection'] ?? ''),
                            'pageId' => (string)$pageId,
                            'lang' => (string)$languageCode,
                        ]
                    );
                    if ($replaceResult['status'] === 'missing') {
                        $skipped[] = $key;
                        continue;
                    }
                    if ($replaceResult['status'] === 'ambiguous') {
                        throw new \ProcessWire\WireException("Ambiguous markdown block for field '{$mdName}' in scope '{$scope}'.");
                    }
                    $updatedMarkdown = $replaceResult['document'];
                    $replaced += 1;
                    $changedKeys[] = $this->scopedHtmlKey(
                        (string)$scope,
                        (string)$mdName,
                        (string)$sectionName,
                        (string)($entry['subsection'] ?? '')
                    );
                }

                if ($replaced > 0) {
                    \ProcessWire\MarkdownFileIO::saveLanguageMarkdown($page, $updatedMarkdown, $languageCode);
                }
            } catch (\Throwable $e) {
                $this->sendJsonError('Failed to update markdown: ' . $e->getMessage(), 500);
            }

            $content = $page->loadContent(null, $languageCode);
            $htmlMap = [];
            foreach ($fieldEntries as $entry) {
                $key = $entry['key'] ?: $entry['name'];
                $mdName = $entry['name'];
                $scope = $entry['scope'] ?: 'field';
                $sectionName = $entry['section'];
                $blockMarkdown = (string)($entry['markdown'] ?? '');
                $canonicalHtml = $this->findScopedHtml(
                    $content,
                    (string)$scope,
                    (string)$mdName,
                    (string)$sectionName,
                    (string)($entry['subsection'] ?? '')
                );
                if ($canonicalHtml !== null) {
                    $htmlMap[$key] = $canonicalHtml;
                }
            }

            $allHtml = $this->getAllFieldsHtml($content);
            $finalHtmlMap = array_merge($allHtml, $htmlMap);
            $expandedChanged = $this->expandChangedHtmlKeys(
                array_values(array_unique($changedKeys ?? [])),
                $finalHtmlMap
            );

            header('Content-Type: application/json');
            echo json_encode([
                'status' => 1, 
                'html' => $finalHtmlMap, 
                'htmlMap' => $finalHtmlMap,
                'fragments' => $finalHtmlMap,
                'changed' => $expandedChanged,
                'sectionsIndex' => $this->buildSectionsIndex($page),
                'fieldsIndex' => $this->buildFieldsIndex($page),
                'skipped' => $skipped ?? []
            ]);
            exit;
        }

        $markdown = isset($_POST['markdown']) ? (string)$_POST['markdown'] : '';
        if(!$markdown) {
            $this->sendJsonError('Missing markdown content', 400);
        }

        $mdName = $input->post->text('mdName');
        if(!$mdName) $this->sendJsonError('Missing mdName', 400);
        $mdSubsection = $input->post->text('mdSubsection');
        if ($fieldId !== '') {
            $fieldIdentity = $this->parseFieldIdentityFromFieldId($fieldId, (string)$pageId);
            if ($fieldIdentity === null) {
                $this->sendJsonError('Invalid fieldId identity', 400);
            }
            $mdScope = (string)$fieldIdentity['scope'];
            $mdName = (string)$fieldIdentity['name'];
            $mdSection = (string)$fieldIdentity['section'];
            $mdSubsection = (string)$fieldIdentity['subsection'];
        }

        // Trace payload details
        $markdownLen = strlen((string)$markdown);
        $markdownLines = $markdownLen ? (substr_count((string)$markdown, "\n") + 1) : 0;
        $markdownPreview = $markdownLen ? substr(str_replace(["\r", "\n"], ["\\r", "\\n"], (string)$markdown), 0, 120) : '';
        $imgPreview = '';
        if (preg_match('/<img[^>]+src=["\']([^"\']+)["\']/', $markdown, $m)) {
            $imgPreview = $m[1];
        } elseif (preg_match('/!\\[[^\\]]*\\]\\(([^)]+)\\)/', $markdown, $m)) {
            $imgPreview = $m[1];
        }
        $this->logDebug(
            "PAYLOAD mdName='{$mdName}' pageId={$pageId} markdownLen={$markdownLen} markdownLines={$markdownLines} markdownPreview='{$markdownPreview}' image='{$imgPreview}'"
        );

        // Use markdown directly - no conversion
        $blockMarkdown = $markdown;

        $blockLen = strlen((string)$blockMarkdown);
        $blockLines = $blockLen ? (substr_count((string)$blockMarkdown, "\n") + 1) : 0;
        $blockPreview = $blockLen ? substr(str_replace(["\r", "\n"], ["\\r", "\\n"], (string)$blockMarkdown), 0, 120) : '';
        $this->logDebug(
            "RESULT mdName='{$mdName}' blockLen={$blockLen} blockLines={$blockLines} blockPreview='{$blockPreview}'"
        );

        if(trim((string)$blockMarkdown) === '') {
            $this->sendJsonError('Empty markdown', 400);
        }

        // TRUST THE FRAMEWORK: Use MarkdownToFields' native mechanisms
        try {
            $fullMarkdown = $this->loadRawMarkdownDocument($page, $languageCode);
            $rawContent = $this->parseRawMarkdownDocument($fullMarkdown);
            $oldFieldMarkdown = $this->findScopedMarkdown(
                $rawContent,
                (string)$mdScope,
                (string)$mdName,
                (string)($mdSection ?? ''),
                (string)($mdSubsection ?? '')
            );
            $handledByEmptyScopeInsert = false;
            $changedKeys = [];

            if (($mdScope === 'section' || $mdScope === 'subsection') && trim($blockMarkdown) !== '') {
                if ($oldFieldMarkdown === null || trim((string)$oldFieldMarkdown) === '') {
                    $insertedMarkdown = $this->insertIntoEmptyScopedMarkdownBlock(
                        $fullMarkdown,
                        $mdScope,
                        $mdName,
                        (string)($mdSection ?? ''),
                        $blockMarkdown
                    );
                    if ($insertedMarkdown !== null) {
                        if ($insertedMarkdown !== $fullMarkdown) {
                            \ProcessWire\MarkdownFileIO::saveLanguageMarkdown($page, $insertedMarkdown, $languageCode);
                            $this->logInfo("INSERT_EMPTY_SCOPE: mdName='{$mdName}' scope='{$mdScope}' section='{$mdSection}'");
                            $changedKeys[] = $this->scopedHtmlKey(
                                $mdScope,
                                $mdName,
                                (string)($mdSection ?? ''),
                                (string)($mdSubsection ?? '')
                            );
                        }
                        $content = \ProcessWire\MarkdownFileIO::loadLanguageMarkdown($page, $languageCode);
                        if (!$content) {
                            throw new \ProcessWire\WireException("Failed to reload fresh content after empty-scope insert.");
                        }
                        $handledByEmptyScopeInsert = true;
                    }
                }
            }

            if (!$handledByEmptyScopeInsert) {
                if ($oldFieldMarkdown === null) {
                    $this->sendJsonError('Field not found in content: ' . $mdName, 400);
                }
                $blockMarkdown = $this->preserveMarkdownFormattingFromOriginal($oldFieldMarkdown, $blockMarkdown);
                $mergedImageOnly = $this->mergeImageSrcOnlyChange($oldFieldMarkdown, $blockMarkdown);
                if ($mergedImageOnly !== null) {
                    $blockMarkdown = $mergedImageOnly;
                    $this->logDebug(
                        "IMAGE_ONLY_MERGE single mdName='{$mdName}' scope='{$mdScope}' section='{$mdSection}'"
                    );
                }
                if ($oldFieldMarkdown === $blockMarkdown) {
                    $content = \ProcessWire\MarkdownFileIO::loadLanguageMarkdown($page, $languageCode);
                    if (!$content) {
                        throw new \ProcessWire\WireException("Failed to load markdown content for language '{$languageCode}'.");
                    }
                    $this->logInfo("NOOP: unchanged markdown for '{$mdName}'");
                } else {
                // Proceed with save even if unchanged to ensure fresh sync and HTML generation
                $this->logInfo("REQUEST: Beginning save process for '{$mdName}'");
                
                // Simple string replacement - preserves all markdown formatting
                $replaceResult = $this->replaceUniqueMarkdownBlock(
                    $fullMarkdown,
                    $blockMarkdown,
                    (string)$mdScope,
                    (string)$mdName,
                    (string)($mdSection ?? ''),
                    (string)($mdSubsection ?? ''),
                    [
                        'mode' => 'single',
                        'scope' => (string)$mdScope,
                        'name' => (string)$mdName,
                        'section' => (string)($mdSection ?? ''),
                        'subsection' => (string)($mdSubsection ?? ''),
                        'fieldId' => (string)($fieldId ?? ''),
                        'pageId' => (string)$pageId,
                        'lang' => (string)$languageCode,
                    ]
                );
                if ($replaceResult['status'] === 'missing') {
                    $this->sendJsonError('Failed to find field content for replacement', 400);
                }
                if ($replaceResult['status'] === 'ambiguous') {
                    $this->sendJsonError('Ambiguous field content: duplicate markdown block found. Save aborted to avoid cross-field mutation.', 409);
                }
                $updatedMarkdown = $replaceResult['document'];
                
                $this->logDebug(
                    "SAVE: Before saving - oldField='" . substr($oldFieldMarkdown, 0, 50) . "' blockMarkdown='" . substr($blockMarkdown, 0, 50) . "'"
                );
                
                // Use MarkdownFileIO's native save mechanism (respect current language or override)
                \ProcessWire\MarkdownFileIO::saveLanguageMarkdown($page, $updatedMarkdown, $languageCode);
                $this->logInfo("SUCCESS: Markdown file updated");
                $changedKeys[] = $this->scopedHtmlKey(
                    $mdScope,
                    $mdName,
                    (string)($mdSection ?? ''),
                    (string)($mdSubsection ?? '')
                );
                $content = \ProcessWire\MarkdownFileIO::loadLanguageMarkdown($page, $languageCode);
                
                if (!$content) {
                    throw new \ProcessWire\WireException("Failed to reload fresh content after save.");
                }

                $this->logDebug("RESPONSE: loadContent completed via direct IO");
                }
            }

        } catch (\Throwable $e) {
            $this->sendJsonError('Failed to update markdown: ' . $e->getMessage(), 500);
        }

        // Generate full page map
        $allHtml = $this->getAllFieldsHtml($content);
        
        // Target field specifics
        $canonicalHtml = $this->findScopedHtml(
            $content,
            (string)$mdScope,
            (string)$mdName,
            (string)($mdSection ?? ''),
            (string)($mdSubsection ?? '')
        );
        $canonicalMd = $this->findScopedMarkdown(
            $content,
            (string)$mdScope,
            (string)$mdName,
            (string)($mdSection ?? ''),
            (string)($mdSubsection ?? '')
        );
        if ($canonicalMd === null) {
            $this->logDebug(
                "RESPONSE: Field not found after save mdName='{$mdName}' scope='{$mdScope}' section='{$mdSection}'"
            );
        }
        
        // Log the src attributed of the first image found to verify update
        preg_match('/<img[^>]+src=["\']([^"\']+)["\']/', $canonicalHtml ?: '', $matches);
        $srcInfo = $matches ? "Primary Src: " . $matches[1] : "No image found in HTML";
        
        $this->logDebug(
            "RESPONSE: Final HTML. Field: {$mdName}. " . $srcInfo
        );
        
        $requestedFieldId = $this->wire->input->post->fieldId;
        if ($requestedFieldId) {
            $allHtml[$requestedFieldId] = $canonicalHtml;
        }
        if (!isset($allHtml[$mdName])) {
            $allHtml[$mdName] = $canonicalHtml;
        }

        $expandedChanged = $this->expandChangedHtmlKeys(
            array_values(array_unique($changedKeys ?? [])),
            $allHtml
        );

        header('Content-Type: application/json');
        echo json_encode([
            'status' => 1, 
            'html' => $canonicalHtml, // For fallback
            'htmlMap' => $allHtml,    // Primary source for syncing
            'fragments' => $allHtml,
            'changed' => $expandedChanged,
            'sectionsIndex' => $this->buildSectionsIndex($page),
            'fieldsIndex' => $this->buildFieldsIndex($page),
            'fieldId' => $requestedFieldId
        ]);
        exit;
    }

    protected function loadRawMarkdownDocument(\ProcessWire\Page $page, string $languageCode): string {
        $path = \ProcessWire\MarkdownFileIO::getMarkdownFilePath($page, $languageCode);
        $raw = @file_get_contents($path);
        if ($raw === false) {
            throw new \ProcessWire\WireException("Failed to read markdown file: {$path}");
        }
        return (string)$raw;
    }

    protected function parseRawMarkdownDocument(string $markdown) {
        $parser = new \LetMeDown\LetMeDown();
        return $parser->loadFromString($markdown);
    }

    /**
     * Resolve canonical field type from LetMeDown field data.
     * Uses $field->type when provided; falls back to HTML tag inspection.
     */
    protected function resolveFieldType($field): string {
        if ($field instanceof \LetMeDown\FieldContainer) {
            return 'container';
        }
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

    protected function resolveFieldKind($field): string {
        if ($field instanceof \LetMeDown\FieldContainer) {
            return 'container';
        }
        if (is_object($field) && isset($field->type) && $field->type === 'binding') {
            return 'bind';
        }
        return 'tag';
    }

    protected function getEditableTargets(): array {
        $defaults = self::getDefaultData();
        $targets = $this->editableTargets ?? $defaults['editableTargets'];
        if (is_string($targets)) {
            $targets = array_filter(array_map('trim', explode(',', $targets)));
        }
        if (!is_array($targets)) {
            $targets = $defaults['editableTargets'];
        }
        return array_values($targets);
    }

    protected function buildSectionsIndex(?\ProcessWire\Page $page): array {
        if (!$page || !$page->id || !method_exists($page, 'content')) return [];
        try {
            $content = $page->content();
        } catch (\Throwable $e) {
            return [];
        }
        $sections = [];

        if (isset($content->sectionsByName) && is_array($content->sectionsByName)) {
            foreach ($content->sectionsByName as $name => $section) {
                if (!$name || !$section) continue;
                $sectionItem = [
                    'name' => (string)$name,
                    'text' => (string)($section->text ?? ''),
                    'markdownB64' => base64_encode((string)($section->markdown ?? '')),
                    'subsections' => [],
                ];
                if (isset($section->subsections) && is_array($section->subsections)) {
                    foreach ($section->subsections as $subName => $subsection) {
                        if (!$subName || !$subsection) continue;
                        $subEntry = [
                            'name' => (string)$subName,
                            'text' => (string)($subsection->text ?? ''),
                            'markdownB64' => base64_encode((string)($subsection->markdown ?? '')),
                        ];
                        $sectionItem['subsections'][] = $subEntry;
                    }
                }
                $sections[] = $sectionItem;
            }
            return $sections;
        }

        if (isset($content->sections) && is_array($content->sections)) {
            foreach ($content->sections as $section) {
                if (!$section) continue;
                $name = (string)($section->name ?? '');
                if ($name === '') continue;
                $sectionItem = [
                    'name' => $name,
                    'text' => (string)($section->text ?? ''),
                    'markdownB64' => base64_encode((string)($section->markdown ?? '')),
                    'subsections' => [],
                ];
                if (isset($section->subsections) && is_array($section->subsections)) {
                    foreach ($section->subsections as $subName => $subsection) {
                        $subNameStr = is_string($subName) ? (string)$subName : (string)($subsection->name ?? '');
                        if ($subNameStr === '' || !$subsection) continue;
                        $subEntry = [
                            'name' => $subNameStr,
                            'text' => (string)($subsection->text ?? ''),
                            'markdownB64' => base64_encode((string)($subsection->markdown ?? '')),
                        ];
                        $sectionItem['subsections'][] = $subEntry;
                    }
                }
                $sections[] = $sectionItem;
            }
        }

        return $sections;
    }

    protected function buildFieldsIndex(?\ProcessWire\Page $page): array {
        if (!$page || !$page->id || !method_exists($page, 'content')) return [];
        try {
            $content = $page->content();
        } catch (\Throwable $e) {
            return [];
        }

        $fields = [];
        $pushField = function (string $name, string $section, string $subsection, $field) use (&$fields) {
            if ($name === '' || !$field) return;
            $markdown = (string)($field->markdown ?? '');
            $fields[] = [
                'name' => $name,
                'section' => $section,
                'subsection' => $subsection,
                'type' => $this->resolveFieldType($field),
                'kind' => $this->resolveFieldKind($field),
                'markdownB64' => base64_encode($markdown),
            ];
        };

        if (isset($content->sectionsByName) && is_array($content->sectionsByName)) {
            foreach ($content->sectionsByName as $sectionName => $section) {
                if (!$section) continue;
                $sectionName = (string)$sectionName;
                if (isset($section->fields) && is_array($section->fields)) {
                    foreach ($section->fields as $fieldName => $field) {
                        $pushField((string)$fieldName, $sectionName, '', $field);
                    }
                }
                if (isset($section->subsections) && is_array($section->subsections)) {
                    foreach ($section->subsections as $subName => $subsection) {
                        if (!$subsection) continue;
                        $subName = (string)$subName;
                        if (isset($subsection->fields) && is_array($subsection->fields)) {
                            foreach ($subsection->fields as $fieldName => $field) {
                                $pushField((string)$fieldName, $sectionName, $subName, $field);
                            }
                        }
                    }
                }
            }
            return $fields;
        }

        if (isset($content->sections) && is_array($content->sections)) {
            foreach ($content->sections as $section) {
                if (!$section) continue;
                $sectionName = (string)($section->name ?? '');
                if ($sectionName === '') continue;
                if (isset($section->fields) && is_array($section->fields)) {
                    foreach ($section->fields as $fieldName => $field) {
                        $pushField((string)$fieldName, $sectionName, '', $field);
                    }
                }
                if (isset($section->subsections) && is_array($section->subsections)) {
                    foreach ($section->subsections as $subName => $subsection) {
                        if (!$subsection) continue;
                        $subName = is_string($subName)
                            ? (string)$subName
                            : (string)($subsection->name ?? '');
                        if ($subName === '') continue;
                        if (isset($subsection->fields) && is_array($subsection->fields)) {
                            foreach ($subsection->fields as $fieldName => $field) {
                                $pushField((string)$fieldName, $sectionName, $subName, $field);
                            }
                        }
                    }
                }
            }
        }

        return $fields;
    }

    protected function findScopedMarkdown(
        $content,
        string $scope,
        string $name,
        string $sectionName = '',
        string $subsectionName = ''
    ): ?string {
        if ($scope === 'block') {
            if ($sectionName === '' || !isset($content->sectionsByName[$sectionName])) {
                return null;
            }
            $section = $content->sectionsByName[$sectionName];
            $subName = '';
            $blockIndex = null;
            if (strpos($name, '::') !== false) {
                [$subName, $indexStr] = explode('::', $name, 2);
                $blockIndex = ctype_digit($indexStr) ? (int)$indexStr : null;
            } else {
                $blockIndex = ctype_digit($name) ? (int)$name : null;
            }
            if ($blockIndex === null) return null;
            if ($subName !== '') {
                if (!isset($section->subsections[$subName])) return null;
                $subsection = $section->subsections[$subName];
                if (!isset($subsection->blocks[$blockIndex])) return null;
                return (string)($subsection->blocks[$blockIndex]->markdown ?? '');
            }
            if (!isset($section->blocks[$blockIndex])) return null;
            return (string)($section->blocks[$blockIndex]->markdown ?? '');
        }
        if ($scope === 'section') {
            if (isset($content->sectionsByName[$name])) {
                return (string)($content->sectionsByName[$name]->markdown ?? '');
            }
            return null;
        }
        if ($scope === 'subsection') {
            if ($sectionName !== '' && isset($content->sectionsByName[$sectionName])) {
                $section = $content->sectionsByName[$sectionName];
                if (isset($section->subsections[$name])) {
                    return (string)($section->subsections[$name]->markdown ?? '');
                }
            }
            return null;
        }

        if ($scope === 'field' && $sectionName !== '' && isset($content->sectionsByName[$sectionName])) {
            $section = $content->sectionsByName[$sectionName];
            if ($subsectionName !== '') {
                if (isset($section->subsections[$subsectionName]) && isset($section->subsections[$subsectionName]->fields[$name])) {
                    return (string)($section->subsections[$subsectionName]->fields[$name]->markdown ?? '');
                }
                return null;
            }
            if (isset($section->fields[$name])) {
                return (string)($section->fields[$name]->markdown ?? '');
            }
            return null;
        }

        if (!isset($content->sections) || !is_array($content->sections)) return null;
        foreach ($content->sections as $section) {
            if ($sectionName !== '' && ((string)($section->name ?? '')) !== $sectionName) {
                continue;
            }
            if (isset($section->fields[$name])) {
                return (string)($section->fields[$name]->markdown ?? '');
            }
            if (isset($section->subsections)) {
                foreach ($section->subsections as $subsection) {
                    if ($subsectionName !== '' && ((string)($subsection->name ?? '')) !== $subsectionName) {
                        continue;
                    }
                    if (isset($subsection->fields[$name])) {
                        return (string)($subsection->fields[$name]->markdown ?? '');
                    }
                }
            }
        }
        return null;
    }

    protected function findScopedHtml(
        $content,
        string $scope,
        string $name,
        string $sectionName = '',
        string $subsectionName = ''
    ): ?string {
        if ($scope === 'block') {
            if ($sectionName === '' || !isset($content->sectionsByName[$sectionName])) {
                return null;
            }
            $section = $content->sectionsByName[$sectionName];
            $subName = '';
            $blockIndex = null;
            if (strpos($name, '::') !== false) {
                [$subName, $indexStr] = explode('::', $name, 2);
                $blockIndex = ctype_digit($indexStr) ? (int)$indexStr : null;
            } else {
                $blockIndex = ctype_digit($name) ? (int)$name : null;
            }
            if ($blockIndex === null) return null;
            if ($subName !== '') {
                if (!isset($section->subsections[$subName])) return null;
                $subsection = $section->subsections[$subName];
                if (!isset($subsection->blocks[$blockIndex])) return null;
                return (string)($subsection->blocks[$blockIndex]->html ?? '');
            }
            if (!isset($section->blocks[$blockIndex])) return null;
            return (string)($section->blocks[$blockIndex]->html ?? '');
        }
        if ($scope === 'section') {
            if (isset($content->sectionsByName[$name])) {
                return (string)($content->sectionsByName[$name]->html ?? '');
            }
            return null;
        }
        if ($scope === 'subsection') {
            if ($sectionName !== '' && isset($content->sectionsByName[$sectionName])) {
                $section = $content->sectionsByName[$sectionName];
                if (isset($section->subsections[$name])) {
                    return (string)($section->subsections[$name]->html ?? '');
                }
            }
            return null;
        }

        if ($scope === 'field' && $sectionName !== '' && isset($content->sectionsByName[$sectionName])) {
            $section = $content->sectionsByName[$sectionName];
            if ($subsectionName !== '') {
                if (isset($section->subsections[$subsectionName]) && isset($section->subsections[$subsectionName]->fields[$name])) {
                    return (string)($section->subsections[$subsectionName]->fields[$name]->html ?? '');
                }
                return null;
            }
            if (isset($section->fields[$name])) {
                return (string)($section->fields[$name]->html ?? '');
            }
            return null;
        }

        if (!isset($content->sections) || !is_array($content->sections)) return null;
        foreach ($content->sections as $section) {
            if ($sectionName !== '' && ((string)($section->name ?? '')) !== $sectionName) {
                continue;
            }
            if (isset($section->fields[$name])) {
                return (string)($section->fields[$name]->html ?? '');
            }
            if (isset($section->subsections)) {
                foreach ($section->subsections as $subsection) {
                    if ($subsectionName !== '' && ((string)($subsection->name ?? '')) !== $subsectionName) {
                        continue;
                    }
                    if (isset($subsection->fields[$name])) {
                        return (string)($subsection->fields[$name]->html ?? '');
                    }
                }
            }
        }
        return null;
    }

    protected function resolveRequestLanguageCode(\ProcessWire\Page $page, string $langCode): string {
        if ($langCode !== '') {
            return $langCode;
        }
        return (string)\ProcessWire\MarkdownLanguageResolver::getLanguageCode($page);
    }

    protected function replaceUniqueMarkdownBlock(
        string $document,
        string $replacement,
        string $scope,
        string $name,
        string $sectionName = '',
        string $subsectionName = '',
        array $ctx = []
    ): array {
        $docLen = strlen($document);
        $replacementLen = strlen($replacement);
        $ctxStr = $this->formatReplaceContextForLog($ctx);
        $scopeNorm = trim($scope);
        $nameNorm = trim($name);
        $sectionNorm = trim($sectionName);
        $subsectionNorm = trim($subsectionName);

        if ($scopeNorm === '' || $nameNorm === '') {
            $this->logDebug(
                "REPLACE_UNIQUE status=missing reason=invalid_identity docLen={$docLen} replacementLen={$replacementLen} scope='{$scopeNorm}' name='{$nameNorm}' {$ctxStr}"
            );
            return ['status' => 'missing', 'document' => $document];
        }

        $range = $this->resolveScopedReplacementRange(
            $document,
            $scopeNorm,
            $nameNorm,
            $sectionNorm,
            $subsectionNorm
        );
        if (($range['status'] ?? '') !== 'ok') {
            $status = ($range['status'] ?? '') === 'ambiguous' ? 'ambiguous' : 'missing';
            $this->logDebug(
                "REPLACE_UNIQUE status={$status} reason=" . (string)($range['reason'] ?? 'range_not_found') . " docLen={$docLen} replacementLen={$replacementLen} scope='{$scopeNorm}' section='{$sectionNorm}' subsection='{$subsectionNorm}' name='{$nameNorm}' markers=" . (string)($range['markers'] ?? 0) . " {$ctxStr}"
            );
            return ['status' => $status, 'document' => $document];
        }

        $start = (int)$range['start'];
        $end = (int)$range['end'];
        if ($end < $start) {
            $this->logDebug(
                "REPLACE_UNIQUE status=missing reason=invalid_range docLen={$docLen} replacementLen={$replacementLen} start={$start} end={$end} scope='{$scopeNorm}' section='{$sectionNorm}' subsection='{$subsectionNorm}' name='{$nameNorm}' {$ctxStr}"
            );
            return ['status' => 'missing', 'document' => $document];
        }

        $after = substr($document, $end);
        $safeReplacement = $replacement;
        if (
            $safeReplacement !== '' &&
            preg_match('/^\s*<!--\s*(section:|sub:|[^>]+)-->/i', $after) &&
            !preg_match('/\R\s*\R?\s*$/', $safeReplacement)
        ) {
            $safeReplacement .= "\n\n";
        }

        $updated = substr($document, 0, $start) . $safeReplacement . $after;
        $this->logDebug(
            "REPLACE_UNIQUE status=replaced reason=scoped_range docLen={$docLen} replacementLen={$replacementLen} start={$start} end={$end} scope='{$scopeNorm}' section='{$sectionNorm}' subsection='{$subsectionNorm}' name='{$nameNorm}' replacementSha1=" . sha1($replacement) . " {$ctxStr}"
        );
        return ['status' => 'replaced', 'document' => $updated];
    }

    protected function resolveScopedReplacementRange(
        string $document,
        string $scope,
        string $name,
        string $sectionName,
        string $subsectionName
    ): array {
        $docLen = strlen($document);

        if ($scope === 'section') {
            // Section edits replace only direct section content.
            // Subsection blocks remain outside this range by design.
            return $this->resolveSectionContentRange($document, $name);
        }
        if ($scope === 'subsection') {
            if ($sectionName === '') {
                return ['status' => 'missing', 'reason' => 'missing_section_for_subsection'];
            }
            return $this->resolveSubsectionContentRange($document, $sectionName, $name);
        }
        if ($scope !== 'field') {
            return ['status' => 'missing', 'reason' => 'unsupported_scope'];
        }

        $parentStart = 0;
        $parentEnd = $docLen;
        $parentType = 'document';
        if ($sectionName !== '' && $subsectionName !== '') {
            $subRange = $this->resolveSubsectionContentRange($document, $sectionName, $subsectionName);
            if (($subRange['status'] ?? '') !== 'ok') return $subRange;
            $parentStart = (int)$subRange['start'];
            $parentEnd = (int)$subRange['end'];
            $parentType = 'subsection';
        } elseif ($sectionName !== '') {
            // Section-scoped fields live in section direct content (before first subsection marker).
            $sectionRange = $this->resolveSectionContentRange($document, $sectionName);
            if (($sectionRange['status'] ?? '') !== 'ok') return $sectionRange;
            $parentStart = (int)$sectionRange['start'];
            $parentEnd = (int)$sectionRange['end'];
            $parentType = 'section';
        }

        $fieldPattern = '/<!--\s*' . preg_quote($name, '/') . '(?:\.\.\.)?\s*-->\s*/i';
        $fieldMarkers = $this->findMarkersInRange($document, $fieldPattern, $parentStart, $parentEnd);
        $count = count($fieldMarkers);
        if ($count === 0) return ['status' => 'missing', 'reason' => 'field_marker_not_found'];
        if ($count > 1) return ['status' => 'ambiguous', 'reason' => 'field_marker_ambiguous', 'markers' => $count];

        $marker = $fieldMarkers[0];
        $start = (int)$marker['end'];
        $end = $parentEnd;

        $nextField = $this->findFirstMarkerPosInRange(
            $document,
            '/<!--\s*(?!section:|sub:)[^>]+-->\s*/i',
            $start,
            $parentEnd
        );
        if ($nextField !== null) {
            $end = min($end, $nextField);
        }
        if ($parentType !== 'subsection') {
            $nextSub = $this->findFirstMarkerPosInRange(
                $document,
                '/<!--\s*sub:[^>]*-->\s*/i',
                $start,
                $parentEnd
            );
            if ($nextSub !== null) {
                $end = min($end, $nextSub);
            }
        }
        if ($parentType === 'document') {
            $nextSection = $this->findFirstMarkerPosInRange(
                $document,
                '/<!--\s*section:[^>]*-->\s*/i',
                $start,
                $parentEnd
            );
            if ($nextSection !== null) {
                $end = min($end, $nextSection);
            }
        }

        return ['status' => 'ok', 'start' => $start, 'end' => $end];
    }

    protected function resolveSectionBlockRange(string $document, string $sectionName): array {
        $markerPattern = '/<!--\s*section:' . preg_quote($sectionName, '/') . '\s*-->\s*/i';
        $markers = $this->findMarkersInRange($document, $markerPattern, 0, strlen($document));
        $count = count($markers);
        if ($count === 0) return ['status' => 'missing', 'reason' => 'section_marker_not_found'];
        if ($count > 1) return ['status' => 'ambiguous', 'reason' => 'section_marker_ambiguous', 'markers' => $count];

        $start = (int)$markers[0]['end'];
        $docLen = strlen($document);
        $end = $docLen;
        $nextSection = $this->findFirstMarkerPosInRange(
            $document,
            '/<!--\s*section:[^>]*-->\s*/i',
            $start,
            $docLen
        );
        if ($nextSection !== null) {
            $end = $nextSection;
        }
        return ['status' => 'ok', 'start' => $start, 'end' => $end];
    }

    protected function resolveSectionContentRange(string $document, string $sectionName): array {
        $sectionBlock = $this->resolveSectionBlockRange($document, $sectionName);
        if (($sectionBlock['status'] ?? '') !== 'ok') return $sectionBlock;

        $start = (int)$sectionBlock['start'];
        $end = (int)$sectionBlock['end'];
        $firstSub = $this->findFirstMarkerPosInRange(
            $document,
            '/<!--\s*sub:[^>]*-->\s*/i',
            $start,
            $end
        );
        if ($firstSub !== null) {
            $end = $firstSub;
        }

        return ['status' => 'ok', 'start' => $start, 'end' => $end];
    }

    protected function resolveSubsectionContentRange(string $document, string $sectionName, string $subsectionName): array {
        $sectionRange = $this->resolveSectionBlockRange($document, $sectionName);
        if (($sectionRange['status'] ?? '') !== 'ok') return $sectionRange;

        $sectionStart = (int)$sectionRange['start'];
        $sectionEnd = (int)$sectionRange['end'];
        $subPattern = '/<!--\s*sub:' . preg_quote($subsectionName, '/') . '\s*-->\s*/i';
        $subMarkers = $this->findMarkersInRange($document, $subPattern, $sectionStart, $sectionEnd);
        $count = count($subMarkers);
        if ($count === 0) return ['status' => 'missing', 'reason' => 'subsection_marker_not_found'];
        if ($count > 1) return ['status' => 'ambiguous', 'reason' => 'subsection_marker_ambiguous', 'markers' => $count];

        $start = (int)$subMarkers[0]['end'];
        $end = $sectionEnd;
        $nextSub = $this->findFirstMarkerPosInRange(
            $document,
            '/<!--\s*sub:[^>]*-->\s*/i',
            $start,
            $sectionEnd
        );
        if ($nextSub !== null) {
            $end = $nextSub;
        }
        return ['status' => 'ok', 'start' => $start, 'end' => $end];
    }

    protected function findMarkersInRange(string $document, string $pattern, int $start, int $end): array {
        $out = [];
        if ($end <= $start) return $out;
        if (!preg_match_all($pattern, $document, $matches, PREG_OFFSET_CAPTURE)) {
            return $out;
        }
        foreach ($matches[0] as $capture) {
            $text = (string)($capture[0] ?? '');
            $pos = (int)($capture[1] ?? -1);
            if ($pos < $start || $pos >= $end) continue;
            $len = strlen($text);
            $out[] = [
                'pos' => $pos,
                'end' => $pos + $len,
                'len' => $len,
            ];
        }
        return $out;
    }

    protected function findFirstMarkerPosInRange(string $document, string $pattern, int $start, int $end): ?int {
        if ($end <= $start) return null;
        if (!preg_match($pattern, $document, $m, PREG_OFFSET_CAPTURE, $start)) {
            return null;
        }
        $pos = (int)($m[0][1] ?? -1);
        if ($pos < $start || $pos >= $end) {
            return null;
        }
        return $pos;
    }

    protected function parseFieldIdentityFromFieldId(string $fieldId, string $expectedPageId = ''): ?array {
        $id = trim($fieldId);
        if ($id === '') return null;
        $parts = explode(':', $id);
        if (count($parts) < 3) return null;

        $pagePart = (string)$parts[0];
        if ($expectedPageId !== '' && $pagePart !== (string)$expectedPageId) {
            return null;
        }

        $scope = trim((string)$parts[1]);
        if ($scope === '') return null;

        if ($scope === 'section') {
            if (count($parts) === 3) {
                return [
                    'scope' => 'section',
                    'section' => '',
                    'subsection' => '',
                    'name' => (string)$parts[2],
                ];
            }
            if (count($parts) < 4) return null;
            return [
                'scope' => 'section',
                'section' => '',
                'subsection' => '',
                'name' => (string)$parts[3],
            ];
        }

        if ($scope === 'subsection') {
            if (count($parts) < 4) return null;
            return [
                'scope' => 'subsection',
                'section' => (string)$parts[2],
                'subsection' => '',
                'name' => (string)$parts[3],
            ];
        }

        if ($scope === 'field') {
            if (count($parts) === 3) {
                return [
                    'scope' => 'field',
                    'section' => '',
                    'subsection' => '',
                    'name' => (string)$parts[2],
                ];
            }
            if (count($parts) === 4) {
                return [
                    'scope' => 'field',
                    'section' => (string)$parts[2],
                    'subsection' => '',
                    'name' => (string)$parts[3],
                ];
            }
            if (count($parts) >= 5) {
                return [
                    'scope' => 'field',
                    'section' => (string)$parts[2],
                    'subsection' => (string)$parts[3],
                    'name' => implode(':', array_slice($parts, 4)),
                ];
            }
        }

        if ($scope === 'block') {
            if (count($parts) < 4) return null;
            return [
                'scope' => 'block',
                'section' => (string)$parts[2],
                'subsection' => '',
                'name' => (string)$parts[3],
            ];
        }

        return null;
    }

    protected function formatReplaceContextForLog(array $ctx): string {
        if (!$ctx) return '';
        $pairs = [];
        foreach ($ctx as $k => $v) {
            $key = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$k);
            if ($key === '') continue;
            $val = str_replace(["\r", "\n", "'"], ["\\r", "\\n", "\\'"], (string)$v);
            $pairs[] = "{$key}='{$val}'";
        }
        return implode(' ', $pairs);
    }

    protected function buildReplaceContextSnippet(string $document, int $pos, int $len): string {
        $radius = 60;
        $start = max(0, $pos - $radius);
        $end = min(strlen($document), $pos + $len + $radius);
        $slice = substr($document, $start, max(0, $end - $start));
        return str_replace(["\r", "\n", "'"], ["\\r", "\\n", "\\'"], (string)$slice);
    }

    protected function insertIntoEmptyScopedMarkdownBlock(
        string $document,
        string $scope,
        string $name,
        string $sectionName,
        string $blockMarkdown
    ): ?string {
        $content = trim($blockMarkdown);
        if ($content === '') {
            return null;
        }

        if ($scope === 'section') {
            $sectionPattern = '/^[ \t]*<!--\s*section:' . preg_quote($name, '/') . '\s*-->[ \t]*\R?/mi';
            if (!preg_match($sectionPattern, $document, $m, PREG_OFFSET_CAPTURE)) {
                return null;
            }
            $sectionPos = (int)$m[0][1];
            $sectionLen = strlen((string)$m[0][0]);
            $start = $sectionPos + $sectionLen;

            $nextSectionPos = null;
            if (preg_match('/^[ \t]*<!--\s*section:[^>]*-->/mi', $document, $nextSection, PREG_OFFSET_CAPTURE, $start)) {
                $nextSectionPos = (int)$nextSection[0][1];
            }
            $nextSubPos = null;
            if (preg_match('/^[ \t]*<!--\s*sub:[^>]*-->/mi', $document, $nextSub, PREG_OFFSET_CAPTURE, $start)) {
                $nextSubPos = (int)$nextSub[0][1];
            }

            $end = strlen($document);
            if ($nextSectionPos !== null) $end = min($end, $nextSectionPos);
            if ($nextSubPos !== null) $end = min($end, $nextSubPos);

            $existing = substr($document, $start, max(0, $end - $start));
            if (trim((string)$existing) !== '') {
                return null;
            }

            $insertion = "\n" . $content . "\n\n";
            return substr($document, 0, $start) . $insertion . substr($document, $start);
        }

        if ($scope === 'subsection') {
            if ($sectionName === '') return null;
            $sectionPattern = '/^[ \t]*<!--\s*section:' . preg_quote($sectionName, '/') . '\s*-->[ \t]*\R?/mi';
            if (!preg_match($sectionPattern, $document, $sectionMatch, PREG_OFFSET_CAPTURE)) {
                return null;
            }
            $sectionStart = (int)$sectionMatch[0][1] + strlen((string)$sectionMatch[0][0]);
            $sectionEnd = strlen($document);
            if (preg_match('/^[ \t]*<!--\s*section:[^>]*-->/mi', $document, $nextSection, PREG_OFFSET_CAPTURE, $sectionStart)) {
                $sectionEnd = (int)$nextSection[0][1];
            }

            $subPattern = '/^[ \t]*<!--\s*sub:' . preg_quote($name, '/') . '\s*-->[ \t]*\R?/mi';
            if (!preg_match($subPattern, $document, $subMatch, PREG_OFFSET_CAPTURE, $sectionStart)) {
                return null;
            }
            $subMarkerPos = (int)$subMatch[0][1];
            if ($subMarkerPos >= $sectionEnd) return null;
            $subStart = $subMarkerPos + strlen((string)$subMatch[0][0]);

            $subEnd = $sectionEnd;
            if (preg_match('/^[ \t]*<!--\s*sub:[^>]*-->/mi', $document, $nextSub, PREG_OFFSET_CAPTURE, $subStart)) {
                $nextSubPos = (int)$nextSub[0][1];
                if ($nextSubPos < $sectionEnd) {
                    $subEnd = $nextSubPos;
                }
            }

            $existing = substr($document, $subStart, max(0, $subEnd - $subStart));
            if (trim((string)$existing) !== '') {
                return null;
            }

            $insertion = "\n" . $content . "\n\n";
            return substr($document, 0, $subStart) . $insertion . substr($document, $subStart);
        }

        return null;
    }

    protected function mergeImageSrcOnlyChange(string $oldMarkdown, string $newMarkdown): ?string {
        $pattern = '/!\\[([^\\]]*)\\]\\(([^)\\s]+)(\\s+"[^"]*")?\\)/';

        $oldMatches = [];
        $newMatches = [];
        $oldNormalized = preg_replace_callback(
            $pattern,
            function ($m) use (&$oldMatches) {
                $idx = count($oldMatches);
                $oldMatches[] = $m;
                $title = $m[3] ?? '';
                return '![' . $m[1] . '](__MFE_IMG_' . $idx . '__' . $title . ')';
            },
            $oldMarkdown
        );
        $newNormalized = preg_replace_callback(
            $pattern,
            function ($m) use (&$newMatches) {
                $idx = count($newMatches);
                $newMatches[] = $m;
                $title = $m[3] ?? '';
                return '![' . $m[1] . '](__MFE_IMG_' . $idx . '__' . $title . ')';
            },
            $newMarkdown
        );

        if (!$oldMatches || !$newMatches) {
            return null;
        }
        if (count($oldMatches) !== count($newMatches)) {
            return null;
        }
        $oldComparable = $this->normalizeMarkdownForImageOnlyComparison($oldNormalized);
        $newComparable = $this->normalizeMarkdownForImageOnlyComparison($newNormalized);
        if ($oldComparable !== $newComparable) {
            return null;
        }

        $index = 0;
        $merged = preg_replace_callback(
            $pattern,
            function ($m) use (&$index, $newMatches) {
                $newSrc = $newMatches[$index][2] ?? $m[2];
                $index += 1;
                return str_replace($m[2], $newSrc, $m[0]);
            },
            $oldMarkdown
        );

        return is_string($merged) ? $merged : null;
    }

    protected function normalizeMarkdownForImageOnlyComparison(string $markdown): string {
        $normalized = str_replace(["\r\n", "\r"], "\n", $markdown);
        // Normalize unordered list marker style so serializer differences don't force rewrites.
        $normalized = preg_replace('/^([ \t]{0,3})[*+-](\s+)/m', '$1-$2', $normalized);
        return is_string($normalized) ? $normalized : $markdown;
    }

    protected function preserveMarkdownFormattingFromOriginal(string $oldMarkdown, string $newMarkdown): string {
        $oldNl = $this->detectMarkdownLineEnding($oldMarkdown);
        $oldLines = explode("\n", str_replace(["\r\n", "\r"], "\n", $oldMarkdown));
        $newLines = explode("\n", str_replace(["\r\n", "\r"], "\n", $newMarkdown));

        $count = min(count($oldLines), count($newLines));
        for ($i = 0; $i < $count; $i++) {
            if (
                preg_match('/^([ \t]{0,3})([*+-])(\s+)(.*)$/', $oldLines[$i], $oldMatch) &&
                preg_match('/^([ \t]{0,3})([*+-])(\s+)(.*)$/', $newLines[$i], $newMatch)
            ) {
                $newLines[$i] = $oldMatch[1] . $oldMatch[2] . $oldMatch[3] . $newMatch[4];
            }
        }

        $joined = implode("\n", $newLines);
        if ($oldNl !== "\n") {
            $joined = str_replace("\n", $oldNl, $joined);
        }
        return $joined;
    }

    protected function detectMarkdownLineEnding(string $markdown): string {
        if (strpos($markdown, "\r\n") !== false) return "\r\n";
        if (strpos($markdown, "\r") !== false) return "\r";
        return "\n";
    }

    protected function renderPageHtmlForLang(\ProcessWire\Page $page, string $languageCode): string {
        $user = $this->wire()->user;
        $languages = $this->wire()->languages;
        $prevLang = null;
        $httpHtml = '';
        $savedGet = [
            'markdownFrontEditorFragments' => $_GET['markdownFrontEditorFragments'] ?? null,
            'markdownFrontEditorSave' => $_GET['markdownFrontEditorSave'] ?? null,
            'markdownFrontEditorListImages' => $_GET['markdownFrontEditorListImages'] ?? null,
        ];
        if ($languages && $user && isset($user->language)) {
            $prevLang = $user->language;
            $nextLang = $languages->get($languageCode);
            if ($nextLang && $nextLang->id) {
                $user->language = $nextLang;
            }
        }

        // Prefer real HTTP page render to ensure page/template runtime helpers
        // run in the same context as normal frontend requests.
        try {
            $config = $this->wire()->config;
            $host = (string)($config->httpHost ?: ($_SERVER['HTTP_HOST'] ?? ''));
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';

            $pageUrl = (string)$page->url;
            if ($languages && $user && isset($user->language)) {
                $nextLang = $languages->get($languageCode);
                if ($nextLang && $nextLang->id) {
                    $prev = $user->language;
                    $user->language = $nextLang;
                    $pageUrl = (string)$page->url;
                    $user->language = $prev;
                }
            }

            if ($host !== '' && $pageUrl !== '') {
                $url = "{$scheme}://{$host}{$pageUrl}";
                $http = new \ProcessWire\WireHttp();
                $http->setTimeout(10.0);
                $http->set('header', 'Accept: text/html');
                if (!empty($_SERVER['HTTP_COOKIE'])) {
                    $http->set('header', 'Cookie: ' . (string)$_SERVER['HTTP_COOKIE']);
                }

                $body = (string)$http->get($url);
                $status = (int)$http->getHttpCode();
                $this->logInfo(sprintf(
                    "FRAGMENTS_HTTP_RENDER pageId=%d lang='%s' status=%d url='%s' len=%d",
                    (int)$page->id,
                    $languageCode,
                    $status,
                    $url,
                    strlen($body)
                ));
                if ($status >= 200 && $status < 300 && trim($body) !== '') {
                    $httpHtml = $body;
                }
            }
        } catch (\Throwable $e) {
            $this->logInfo(sprintf(
                "FRAGMENTS_HTTP_RENDER_EXCEPTION pageId=%d lang='%s' class='%s' message='%s'",
                (int)$page->id,
                $languageCode,
                get_class($e),
                str_replace(["\n", "\r"], ' ', (string)$e->getMessage())
            ));
        }

        if ($httpHtml !== '') {
            if ($prevLang && $user) {
                $user->language = $prevLang;
            }
            return $httpHtml;
        }

        try {
            // Avoid recursive interception while rendering inside save/fragment request.
            unset($_GET['markdownFrontEditorFragments'], $_GET['markdownFrontEditorSave'], $_GET['markdownFrontEditorListImages']);
            $html = (string)$page->render();
        } catch (\Throwable $e) {
            $this->logInfo(sprintf(
                "FRAGMENTS_RENDER_EXCEPTION pageId=%d lang='%s' class='%s' message='%s'",
                (int)$page->id,
                $languageCode,
                get_class($e),
                str_replace(["\n", "\r"], ' ', (string)$e->getMessage())
            ));
            $html = '';
        } finally {
            foreach ($savedGet as $k => $v) {
                if ($v === null) {
                    unset($_GET[$k]);
                } else {
                    $_GET[$k] = $v;
                }
            }
            if ($prevLang && $user) {
                $user->language = $prevLang;
            }
        }

        if (trim($html) !== '') {
            return $html;
        }

        return $html;
    }

    protected function extractRenderedFragmentsByKeys(
        string $renderedHtml,
        array $keys,
        array $sectionsIndex,
        array $fieldsIndex,
        ?array &$graphMeta = null
    ): array {
        $keys = $this->normalizeCanonicalKeys($keys);
        if (!$keys || trim($renderedHtml) === '') {
            $graphMeta = ['graphChecksum' => '', 'graphNodeCount' => 0];
            return [];
        }

        $dom = new \DOMDocument();
        $prev = libxml_use_internal_errors(true);
        $loaded = $dom->loadHTML(
            '<?xml encoding="utf-8" ?>' . $renderedHtml,
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOERROR | LIBXML_NOWARNING
        );
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        if (!$loaded) return [];

        $lookup = $this->buildSemanticLookupFromIndexes($sectionsIndex, $fieldsIndex);
        $xpath = new \DOMXPath($dom);
        $nodeByKey = [];
        $graphKeys = [];

        foreach ($xpath->query('//*[@data-mfe-key]') as $node) {
            if (!$node instanceof \DOMElement) continue;
            $key = trim((string)$node->getAttribute('data-mfe-key'));
            if ($key !== '' && $this->isCanonicalScopedKey($key) && !isset($nodeByKey[$key])) {
                $nodeByKey[$key] = $node;
            }
            if ($key !== '' && $this->isCanonicalScopedKey($key)) {
                $graphKeys[$key] = true;
            }
        }

        foreach ($xpath->query('//*[@data-mfe]') as $node) {
            if (!$node instanceof \DOMElement) continue;
            $raw = (string)$node->getAttribute('data-mfe');
            $stampedKey = trim((string)$node->getAttribute('data-mfe-key'));
            if ($this->isCanonicalScopedKey($stampedKey)) {
                $recomputed = $this->resolveRenderedMountKeyWithContext($raw, $node, $lookup);
                if ($recomputed === '') {
                    $this->logInfo(sprintf(
                        "FRAGMENTS_STAMP_ERROR reason=non_recomputable key='%s' attr='data-mfe' value='%s'",
                        $stampedKey,
                        str_replace(["\n", "\r"], ' ', trim($raw))
                    ));
                } elseif ($recomputed !== $stampedKey) {
                    $this->logInfo(sprintf(
                        "FRAGMENTS_STAMP_WARN reason=mismatch key='%s' recomputed='%s' attr='data-mfe' value='%s'",
                        $stampedKey,
                        $recomputed,
                        str_replace(["\n", "\r"], ' ', trim($raw))
                    ));
                }
                $key = $stampedKey;
            } else {
                $key = $this->resolveRenderedMountKeyWithContext($raw, $node, $lookup);
            }
            if ($key !== '' && !isset($nodeByKey[$key])) {
                $nodeByKey[$key] = $node;
            }
            if ($key !== '' && $this->isCanonicalScopedKey($key)) {
                $graphKeys[$key] = true;
            }
        }

        foreach ($xpath->query('//*[@data-mfe-source]') as $node) {
            if (!$node instanceof \DOMElement) continue;
            $raw = (string)$node->getAttribute('data-mfe-source');
            $stampedKey = trim((string)$node->getAttribute('data-mfe-key'));
            if ($this->isCanonicalScopedKey($stampedKey)) {
                $recomputed = $this->resolveRenderedMountKeyWithContext($raw, $node, $lookup);
                if ($recomputed === '') {
                    $this->logInfo(sprintf(
                        "FRAGMENTS_STAMP_ERROR reason=non_recomputable key='%s' attr='data-mfe-source' value='%s'",
                        $stampedKey,
                        str_replace(["\n", "\r"], ' ', trim($raw))
                    ));
                } elseif ($recomputed !== $stampedKey) {
                    $this->logInfo(sprintf(
                        "FRAGMENTS_STAMP_WARN reason=mismatch key='%s' recomputed='%s' attr='data-mfe-source' value='%s'",
                        $stampedKey,
                        $recomputed,
                        str_replace(["\n", "\r"], ' ', trim($raw))
                    ));
                }
                $key = $stampedKey;
            } else {
                $key = $this->resolveRenderedMountKeyWithContext($raw, $node, $lookup);
                if ($key === '') {
                    $key = trim($raw);
                }
            }
            if ($key !== '' && !$this->isCanonicalScopedKey($key)) {
                $key = '';
            }
            if ($key !== '' && !isset($nodeByKey[$key])) {
                $nodeByKey[$key] = $node;
            }
            if ($key !== '' && $this->isCanonicalScopedKey($key)) {
                $graphKeys[$key] = true;
            }
        }

        foreach ($xpath->query('//*[contains(concat(" ", normalize-space(@class), " "), " fe-editable ")]') as $node) {
            if (!$node instanceof \DOMElement) continue;
            $key = $this->scopedHtmlKey(
                (string)($node->getAttribute('data-mfe-scope') ?: $node->getAttribute('data-md-scope') ?: 'field'),
                (string)($node->getAttribute('data-mfe-name') ?: $node->getAttribute('data-md-name')),
                (string)($node->getAttribute('data-mfe-section') ?: $node->getAttribute('data-md-section')),
                (string)($node->getAttribute('data-mfe-subsection') ?: $node->getAttribute('data-md-subsection'))
            );
            if ($key !== '' && !isset($nodeByKey[$key])) {
                $nodeByKey[$key] = $node;
            }
            if ($key !== '' && $this->isCanonicalScopedKey($key)) {
                $graphKeys[$key] = true;
            }
        }

        $graphMeta = $this->buildGraphMetaFromKeySet(array_keys($graphKeys));

        $fragments = [];
        foreach ($keys as $key) {
            if (!isset($nodeByKey[$key])) continue;
            $fragments[$key] = $this->domNodeInnerHtml($nodeByKey[$key]);
        }

        return $fragments;
    }

    protected function domNodeInnerHtml(\DOMNode $node): string {
        $html = '';
        foreach ($node->childNodes as $child) {
            $html .= $node->ownerDocument->saveHTML($child);
        }
        return (string)$html;
    }

    protected function buildSemanticLookupFromIndexes(array $sections, array $fields): array {
        $sectionNames = [];
        $subsectionKeys = [];
        $fieldSectionKeys = [];
        $fieldSubsectionKeys = [];
        $fieldTopLevelNames = [];

        foreach ($sections as $section) {
            $sec = trim((string)($section['name'] ?? ''));
            if ($sec === '') continue;
            $sectionNames[$sec] = true;
            $subs = is_array($section['subsections'] ?? null) ? $section['subsections'] : [];
            foreach ($subs as $sub) {
                $subName = trim((string)($sub['name'] ?? ''));
                if ($subName === '') continue;
                $subsectionKeys["{$sec}/{$subName}"] = true;
            }
        }

        foreach ($fields as $field) {
            $name = trim((string)($field['name'] ?? ''));
            $sec = trim((string)($field['section'] ?? ''));
            $sub = trim((string)($field['subsection'] ?? ''));
            if ($name === '') continue;
            if ($sec === '' && $sub === '') {
                $fieldTopLevelNames[$name] = true;
                continue;
            }
            if ($sec !== '' && $sub !== '') {
                $fieldSubsectionKeys["{$sec}/{$sub}/{$name}"] = true;
                continue;
            }
            if ($sec !== '') {
                $fieldSectionKeys["{$sec}/{$name}"] = true;
            }
        }

        return [
            'sectionNames' => $sectionNames,
            'subsectionKeys' => $subsectionKeys,
            'fieldSectionKeys' => $fieldSectionKeys,
            'fieldSubsectionKeys' => $fieldSubsectionKeys,
            'fieldTopLevelNames' => $fieldTopLevelNames,
        ];
    }

    protected function resolveRenderedMountKeyWithContext(string $rawValue, \DOMElement $host, array $lookup): string {
        $direct = $this->resolveRenderedMountKey($rawValue, $lookup);
        if ($direct !== '') return $direct;

        $parts = $this->splitMountPath(str_replace(':', '/', trim($rawValue)));
        if (!$parts) return '';
        $ctx = $this->inferRenderedContextFromAncestors($host, $lookup);
        if (!$ctx || ($ctx['section'] ?? '') === '') return '';

        $section = (string)($ctx['section'] ?? '');
        $subsection = (string)($ctx['subsection'] ?? '');
        if (count($parts) === 1) {
            $name = $parts[0];
            if ($subsection !== '' && !empty($lookup['fieldSubsectionKeys']["{$section}/{$subsection}/{$name}"])) {
                return "subsection:{$section}:{$subsection}:{$name}";
            }
            if (!empty($lookup['fieldSectionKeys']["{$section}/{$name}"])) {
                return "field:{$section}:{$name}";
            }
            return '';
        }
        if (count($parts) === 2) {
            [$a, $b] = $parts;
            if (!empty($lookup['fieldSubsectionKeys']["{$section}/{$a}/{$b}"])) {
                return "subsection:{$section}:{$a}:{$b}";
            }
        }
        return '';
    }

    protected function inferRenderedContextFromAncestors(\DOMElement $host, array $lookup): ?array {
        $node = $host->parentNode;
        while ($node instanceof \DOMElement) {
            $raw = trim((string)$node->getAttribute('data-mfe'));
            if ($raw !== '') {
                $key = $this->resolveRenderedMountKey($raw, $lookup);
                if (str_starts_with($key, 'section:')) {
                    return ['section' => substr($key, strlen('section:')), 'subsection' => ''];
                }
                if (str_starts_with($key, 'subsection:')) {
                    $parts = explode(':', $key);
                    return ['section' => (string)($parts[1] ?? ''), 'subsection' => (string)($parts[2] ?? '')];
                }
                if (str_starts_with($key, 'field:')) {
                    $parts = explode(':', $key);
                    return ['section' => (string)($parts[1] ?? ''), 'subsection' => ''];
                }
            }
            $node = $node->parentNode;
        }
        return null;
    }

    protected function resolveRenderedMountKey(string $rawValue, array $lookup): string {
        $raw = trim($rawValue);
        if ($raw === '') return '';
        $lower = strtolower($raw);
        $pathParts = $this->splitMountPath(str_replace(':', '/', $raw));

        if (str_starts_with($lower, 'field:')) {
            $parts = array_values(array_filter(array_map('trim', explode(':', $raw)), fn($p) => $p !== ''));
            // field:name
            if (count($parts) === 2) {
                return "field:{$parts[1]}";
            }
            // field:section:name
            if (count($parts) >= 3) {
                return "field:{$parts[1]}:{$parts[2]}";
            }
            return '';
        }
        if (str_starts_with($lower, 'section:')) {
            $parts = $this->splitMountPath(substr($raw, 8));
            return $parts ? "section:{$parts[0]}" : '';
        }
        if (str_starts_with($lower, 'subsection:')) {
            $parts = array_values(array_filter(array_map('trim', explode(':', $raw)), fn($p) => $p !== ''));
            // subsection:section:sub
            if (count($parts) === 3) {
                return "subsection:{$parts[1]}:{$parts[2]}";
            }
            // subsection:section:sub:field
            if (count($parts) >= 4) {
                return "subsection:{$parts[1]}:{$parts[2]}:{$parts[3]}";
            }
            return '';
        }
        if (str_starts_with($lower, 'sub:')) {
            $path = str_starts_with($lower, 'sub:') ? substr($raw, 4) : substr($raw, 11);
            $parts = $this->splitMountPath(str_replace(':', '/', $path));
            if (count($parts) < 2) return '';
            return "subsection:{$parts[0]}:{$parts[1]}";
        }

        if (count($pathParts) === 1) {
            $a = $pathParts[0];
            if (!empty($lookup['sectionNames'][$a])) return "section:{$a}";
            if (!empty($lookup['fieldTopLevelNames'][$a])) return "field:{$a}";
            return '';
        }
        if (count($pathParts) === 2) {
            [$a, $b] = $pathParts;
            if (!empty($lookup['subsectionKeys']["{$a}/{$b}"])) return "subsection:{$a}:{$b}";
            if (!empty($lookup['fieldSectionKeys']["{$a}/{$b}"])) return "field:{$a}:{$b}";
            return '';
        }
        if (count($pathParts) >= 3) {
            [$a, $b, $c] = $pathParts;
            if (!empty($lookup['fieldSubsectionKeys']["{$a}/{$b}/{$c}"])) return "subsection:{$a}:{$b}:{$c}";
            return '';
        }
        return '';
    }

    protected function splitMountPath(string $value): array {
        $parts = array_map('trim', explode('/', $value));
        return array_values(array_filter($parts, fn($p) => $p !== ''));
    }

    protected function isCanonicalScopedKey(string $key): bool {
        if ($key === '') return false;
        if (preg_match('/^section:[^:]+$/', $key)) return true;
        if (preg_match('/^field:[^:]+$/', $key)) return true;
        if (preg_match('/^field:[^:]+:[^:]+$/', $key)) return true;
        if (preg_match('/^subsection:[^:]+:[^:]+$/', $key)) return true;
        if (preg_match('/^subsection:[^:]+:[^:]+:[^:]+$/', $key)) return true;
        return false;
    }

    protected function normalizeCanonicalKeys(array $keys): array {
        $out = [];
        foreach ($keys as $keyRaw) {
            $key = trim((string)$keyRaw);
            if ($key === '') continue;
            if (!$this->isCanonicalScopedKey($key)) continue;
            $out[$key] = true;
        }
        return array_keys($out);
    }

    protected function buildGraphMetaFromKeySet(array $keys): array {
        $normalized = $this->normalizeCanonicalKeys($keys);
        sort($normalized, SORT_STRING);
        $checksum = '';
        if ($normalized) {
            $checksum = 'mfe-g-' . $this->fnv1aHashBase36(json_encode($normalized));
        }
        return [
            'graphChecksum' => $checksum,
            'graphNodeCount' => count($normalized),
        ];
    }

    protected function fnv1aHashBase36(string $input): string {
        $hash = 2166136261;
        $len = strlen($input);
        for ($i = 0; $i < $len; $i++) {
            $hash ^= ord($input[$i]);
            $hash = ($hash * 16777619) & 0xFFFFFFFF;
        }
        if ($hash < 0) {
            $hash = $hash & 0xFFFFFFFF;
        }
        return base_convert((string)$hash, 10, 36);
    }

    protected function sendDatastarPatchElementsStream(array $fragments, array $mountTargets, array $missing = []): void {
        header('Content-Type: text/event-stream');
        header('Cache-Control: no-cache, no-transform');
        header('Connection: keep-alive');

        $eventsSent = 0;
        foreach ($fragments as $key => $html) {
            $targets = $mountTargets[$key] ?? [];
            if (!is_array($targets) || !$targets) continue;
            foreach ($targets as $target) {
                $selector = trim((string)($target['selector'] ?? ''));
                if ($selector === '') continue;
                $mode = trim((string)($target['mode'] ?? 'inner'));
                if ($mode === '') $mode = 'inner';

                echo "event: datastar-patch-elements\n";
                echo "data: key {$key}\n";
                echo "data: selector {$selector}\n";
                echo "data: mode {$mode}\n";
                foreach (preg_split("/\r\n|\n|\r/", (string)$html) as $line) {
                    echo "data: elements {$line}\n";
                }
                echo "\n";
                $eventsSent++;
            }
        }

        if ($missing) {
            echo "event: datastar-patch-signals\n";
            echo "data: signals " . json_encode(['mfe_missing' => array_values($missing)]) . "\n\n";
        }
        $this->logInfo(sprintf(
            "FRAGMENTS_STREAM events=%d fragmentKeys=%d targetKeys=%d missing=%d",
            $eventsSent,
            count($fragments),
            count($mountTargets),
            count($missing)
        ));
        @ob_flush();
        flush();
    }

    protected function sendJsonError($msg, $code = 400) {
        if($code) http_response_code($code);
        header('Content-Type: application/json');
        echo json_encode(['status' => 0, 'error' => $msg]);
        exit;
    }

    private function isMarkdownTemplateEnabled(\ProcessWire\Page $page): bool {
        $template = $page->template ?? null;
        if (!$template) return false;

        $config = $this->wire()->config;
        $mdConfig = $config->MarkdownToFields ?? [];
        if (isset($mdConfig['enabledTemplates'])) {
            $enabled = (array) $mdConfig['enabledTemplates'];
        } else {
            $moduleConfig = $this->wire()->modules->getConfig('MarkdownToFields');
            $enabled = is_array($moduleConfig['templates'] ?? null) ? $moduleConfig['templates'] : [];
        }

        if (!$enabled) return false;
        return in_array($template->name, $enabled, true);
    }

    protected function getAllFieldsHtml($content): array {
        $htmlMap = [];
        // Use sectionsByName to get string keys (e.g., "columns", "intro")
        $sections = isset($content->sectionsByName) ? $content->sectionsByName : (isset($content->sections) ? $content->sections : []);
        if (!is_array($sections) && !($sections instanceof \Traversable)) return $htmlMap;

        foreach ($sections as $sectionName => $section) {
            $sectionName = (string)$sectionName;
            // Whole section
            if (isset($section->html)) {
                $htmlMap["section:{$sectionName}"] = (string)$section->html;
            }
            
            // Fields in section scope
            if (isset($section->fields) && is_array($section->fields)) {
                foreach ($section->fields as $fieldName => $field) {
                    if (isset($field->html)) {
                        $htmlMap["field:{$sectionName}:{$fieldName}"] = (string)$field->html;
                    }
                }
            }
            
            // Subsections - use subsectionsByName if available
            $subsections = isset($section->subsectionsByName) ? $section->subsectionsByName : (isset($section->subsections) ? $section->subsections : []);
            if (is_array($subsections) || ($subsections instanceof \Traversable)) {
                foreach ($subsections as $subName => $subsection) {
                    $subName = (string)$subName;
                    // Whole subsection
                    if (isset($subsection->html)) {
                        $htmlMap["subsection:{$sectionName}:{$subName}"] = (string)$subsection->html;
                    }
                    
                    if (isset($subsection->fields) && is_array($subsection->fields)) {
                        foreach ($subsection->fields as $fieldName => $field) {
                            if (isset($field->html)) {
                                $htmlMap["subsection:{$sectionName}:{$subName}:{$fieldName}"] = (string)$field->html;
                            }
                        }
                    }
                }
            }
        }
        return $htmlMap;
    }

    protected function scopedHtmlKey(string $scope, string $name, string $sectionName = '', string $subsectionName = ''): string {
        if ($scope === 'section') {
            return "section:{$name}";
        }
        if ($scope === 'subsection') {
            return "subsection:{$sectionName}:{$name}";
        }
        if ($scope === 'field') {
            if ($sectionName !== '' && $subsectionName !== '') {
                return "subsection:{$sectionName}:{$subsectionName}:{$name}";
            }
            if ($sectionName !== '') {
                return "field:{$sectionName}:{$name}";
            }
            return "field:{$name}";
        }
        if ($scope === 'block') {
            if ($sectionName !== '') {
                return "block:{$sectionName}:{$name}";
            }
            return "block:{$name}";
        }
        return "{$scope}:{$name}";
    }

    protected function expandChangedHtmlKeys(array $changedKeys, array $htmlMap): array {
        $out = [];
        foreach ($changedKeys as $key) {
            $keyStr = (string)$key;
            if ($keyStr === '') continue;
            $out[$keyStr] = true;

            if (str_starts_with($keyStr, 'section:')) {
                $parts = explode(':', $keyStr, 2);
                $section = $parts[1] ?? '';
                if ($section !== '') {
                    foreach ($htmlMap as $mapKey => $_html) {
                        $mk = (string)$mapKey;
                        if (str_starts_with($mk, "field:{$section}:") || str_starts_with($mk, "subsection:{$section}:")) {
                            $out[$mk] = true;
                        }
                    }
                }
                continue;
            }

            if (str_starts_with($keyStr, 'subsection:')) {
                $parts = explode(':', $keyStr);
                if (count($parts) >= 3) {
                    $section = $parts[1] ?? '';
                    $sub = $parts[2] ?? '';
                    if ($section !== '' && $sub !== '') {
                        $prefix = "subsection:{$section}:{$sub}:";
                        foreach ($htmlMap as $mapKey => $_html) {
                            $mk = (string)$mapKey;
                            if (str_starts_with($mk, $prefix)) {
                                $out[$mk] = true;
                            }
                        }
                    }
                }
            }
        }
        return array_keys($out);
    }

}
