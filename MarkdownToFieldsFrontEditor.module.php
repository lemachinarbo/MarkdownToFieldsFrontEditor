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
            'version' =>  '0.4.2',
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
            'view' => 'fullscreen',
            'toolbarButtons' => 'bold,italic,strike,paragraph,link,unlink,image,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,code,codeblock,clear,|,split',
            'editableTargets' => ['tag', 'container', 'section', 'subsection'],
            'allowedImageExtensions' => 'jpg,jpeg,png,gif,webp,svg',
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
        $f->description = 'Comma-separated list of toolbar buttons to show. Use "|" as a separator. Available: bold, italic, strike, code, codeblock, paragraph, h1-h6, ul, ol, blockquote, link, unlink, image, clear, split. Save is always shown at the end.';
        $f->notes = 'Defaults: bold,italic,strike,paragraph,link,unlink,image,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,code,codeblock,clear,|,split';
        $f->value = !empty($data['toolbarButtons']) ? $data['toolbarButtons'] : $defaults['toolbarButtons'];
        $f->columnWidth = 100;
        $inputfields->add($f);

        $viewField = \ProcessWire\wire('modules')->get('InputfieldRadios');
        $viewField->name = 'view';
        $viewField->label = 'Editor View';
        $viewField->description = 'Choose the editor view layout.';
        $viewField->options = [
            'fullscreen' => 'Fullscreen',
            'inline' => 'Inline',
        ];
        $viewField->value = !empty($data['view']) ? $data['view'] : $defaults['view'];
        $viewField->columnWidth = 100;
        $inputfields->add($viewField);

        $targetsField = \ProcessWire\wire('modules')->get('InputfieldCheckboxes');
        $targetsField->name = 'editableTargets';
        $targetsField->label = 'Editable Targets';
        $targetsField->description = 'Choose which content types get auto-wrapped for editing.';
        $targetsField->options = [
            'tag' => 'Tag fields (<!-- name -->)',
            'container' => 'Container fields (<!-- name... -->)',
            'bind' => 'Bind fields (<!-- field:name -->)',
            'section' => 'Sections (<!-- section:name -->)',
            'subsection' => 'Subsections (<!-- sub:name -->)',
        ];
        $targetsField->value = !empty($data['editableTargets']) ? $data['editableTargets'] : $defaults['editableTargets'];
        $targetsField->notes = 'Defaults: tag, container, section, subsection';
        $targetsField->columnWidth = 100;
        $inputfields->add($targetsField);

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
            'view' => $defaults['view'],
            'toolbarButtons' => $defaults['toolbarButtons'],
            'editableTargets' => $defaults['editableTargets'],
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
        $view = isset($this->view) && trim((string)$this->view) !== ''
            ? (string)$this->view
            : (string)$defaults['view'];

        $modulePath = $config->paths($this->className());
        $jsPath = $modulePath . 'dist/editor.bundle.js';
        $version = is_file($jsPath) ? (string) filemtime($jsPath) : (string) time();
        $sectionsIndex = $this->buildSectionsIndex($page);

        $frontConfig = [
            'view' => $view,
            'toolbarButtons' => $toolbarButtons,
            'editableTargets' => $this->getEditableTargets(),
            'languages' => $langList,
            'currentLanguage' => $currentLangCode,
            'buildStamp' => $version,
            'sectionsIndex' => $sectionsIndex,
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
                        $this->wire->log->save('markdown-front-edit', "COLLECT field='{$fname}' type='{$fieldType}' markdownLen=" . strlen($markdown));
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
                                $this->wire->log->save('markdown-front-edit', "COLLECT field='{$fname}' type='{$fieldType}' markdownLen=" . strlen($markdown));
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

        // NOTE: We avoid DOM wrappers for sections/subsections to preserve layout.
        // Instead we inject invisible comment markers for stable overlay detection.
        $editableTargets = $this->getEditableTargets();
        $allowSectionMarkers = in_array('section', $editableTargets, true);
        $allowSubsectionMarkers = in_array('subsection', $editableTargets, true);
        $rebuilt = $this->injectSectionMarkers($rebuilt, $content, $allowSectionMarkers, $allowSubsectionMarkers);

        // We also attach section metadata to field wrappers to preserve layout.
        
        foreach ($content->sections as $section) {
            if (isset($section->fields) && is_array($section->fields)) {
                foreach ($section->fields as $fname => $f) {
                    if (isset($f->html) && $f->html !== '' && isset($fields[$fname])) {
                        $safeAttr = htmlspecialchars($fname, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $safeType = htmlspecialchars($fields[$fname]['type'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $safeMarkdown = htmlspecialchars($fields[$fname]['markdown'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $safeMarkdownB64 = htmlspecialchars(base64_encode($fields[$fname]['markdown']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $sectionName = (string)($fields[$fname]['section'] ?? '');
                        $sectionMarkdown = (string)($fields[$fname]['sectionMarkdown'] ?? '');
                        $safeSection = htmlspecialchars($sectionName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $safeSectionB64 = htmlspecialchars(base64_encode($sectionMarkdown), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        
                        // Check if already wrapped
                        if (stripos($rebuilt, 'data-md-name="' . $safeAttr . '"') !== false) continue;
                        
                        // Find and wrap the field
                        $originalHtml = $f->html;
                        $displayHtml = $fields[$fname]['html'];
                        $wrapper = '<div class="fe-editable md-edit" data-md-scope="field" data-md-name="' . $safeAttr . '" data-md-section="' . $safeSection . '" data-md-section-b64="' . $safeSectionB64 . '" data-field-type="' . $safeType . '" data-page="' . $page->id . '" data-markdown="' . $safeMarkdown . '" data-markdown-b64="' . $safeMarkdownB64 . '">' . $displayHtml . '</div>';
                        
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
                                $sectionName = (string)($fields[$fname]['section'] ?? '');
                                $sectionMarkdown = (string)($fields[$fname]['sectionMarkdown'] ?? '');
                                $subsectionName = (string)($fields[$fname]['subsection'] ?? '');
                                $subsectionMarkdown = (string)($fields[$fname]['subsectionMarkdown'] ?? '');
                                $safeSection = htmlspecialchars($sectionName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $safeSectionB64 = htmlspecialchars(base64_encode($sectionMarkdown), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $safeSubsection = htmlspecialchars($subsectionName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                $safeSubsectionB64 = htmlspecialchars(base64_encode($subsectionMarkdown), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                                
                                // Check if already wrapped
                                if (stripos($rebuilt, 'data-md-name="' . $safeAttr . '"') !== false) continue;
                                
                                $originalHtml = $f->html;
                                $displayHtml = $fields[$fname]['html'];
                                $wrapper = '<div class="fe-editable md-edit" data-md-scope="field" data-md-name="' . $safeAttr . '" data-md-section="' . $safeSection . '" data-md-section-b64="' . $safeSectionB64 . '" data-md-subsection="' . $safeSubsection . '" data-md-subsection-b64="' . $safeSubsectionB64 . '" data-field-type="' . $safeType . '" data-page="' . $page->id . '" data-markdown="' . $safeMarkdown . '" data-markdown-b64="' . $safeMarkdownB64 . '">' . $displayHtml . '</div>';
                                
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

    private function injectSectionMarkers($rebuilt, $content, $allowSectionMarkers, $allowSubsectionMarkers) {
        if (!$rebuilt || !is_string($rebuilt)) return $rebuilt;
        if (!($allowSectionMarkers || $allowSubsectionMarkers)) return $rebuilt;
        if (!isset($content->sectionsByName) || !is_array($content->sectionsByName)) return $rebuilt;

        foreach ($content->sectionsByName as $sectionName => $section) {
            if (!$sectionName || !$section) continue;
            $sectionHtml = (string)($section->html ?? '');
            if ($sectionHtml === '') continue;
            $safeSection = htmlspecialchars((string)$sectionName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $sectionStart = '<!--mfe:section:start ' . $safeSection . '-->';
            $sectionEnd = '<!--mfe:section:end ' . $safeSection . '-->';
            $sectionHtmlWithMarkers = $sectionHtml;

            if ($allowSubsectionMarkers && isset($section->subsections) && is_array($section->subsections)) {
                foreach ($section->subsections as $subName => $subsection) {
                    if (!$subName || !$subsection) continue;
                    $subHtml = (string)($subsection->html ?? '');
                    if ($subHtml === '') continue;
                    $safeSub = htmlspecialchars((string)$subName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                    $subStart = '<!--mfe:subsection:start ' . $safeSection . '::' . $safeSub . '-->';
                    $subEnd = '<!--mfe:subsection:end ' . $safeSection . '::' . $safeSub . '-->';
                    if (stripos($sectionHtmlWithMarkers, $subStart) === false) {
                        $pos = stripos($sectionHtmlWithMarkers, $subHtml);
                        if ($pos !== false) {
                            $sectionHtmlWithMarkers = substr_replace(
                                $sectionHtmlWithMarkers,
                                $subStart . $subHtml . $subEnd,
                                $pos,
                                strlen($subHtml)
                            );
                        }
                    }
                }
            }

            if ($allowSectionMarkers && stripos($rebuilt, $sectionStart) === false) {
                $pos = stripos($rebuilt, $sectionHtml);
                if ($pos !== false) {
                    $rebuilt = substr_replace(
                        $rebuilt,
                        $sectionStart . $sectionHtmlWithMarkers . $sectionEnd,
                        $pos,
                        strlen($sectionHtml)
                    );
                }
            } elseif ($allowSubsectionMarkers && stripos($rebuilt, $sectionHtmlWithMarkers) === false) {
                $pos = stripos($rebuilt, $sectionHtml);
                if ($pos !== false) {
                    $rebuilt = substr_replace(
                        $rebuilt,
                        $sectionHtmlWithMarkers,
                        $pos,
                        strlen($sectionHtml)
                    );
                }
            }
        }

        if ($allowSubsectionMarkers) {
            foreach ($content->sectionsByName as $sectionName => $section) {
                if (!$sectionName || !$section) continue;
                $safeSection = htmlspecialchars((string)$sectionName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                if (!isset($section->subsections) || !is_array($section->subsections)) continue;
                foreach ($section->subsections as $subName => $subsection) {
                    if (!$subName || !$subsection) continue;
                    $subHtml = (string)($subsection->html ?? '');
                    if ($subHtml === '') continue;
                    $safeSub = htmlspecialchars((string)$subName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                    $subStart = '<!--mfe:subsection:start ' . $safeSection . '::' . $safeSub . '-->';
                    $subEnd = '<!--mfe:subsection:end ' . $safeSection . '::' . $safeSub . '-->';
                    if (stripos($rebuilt, $subStart) === false) {
                        $pos = stripos($rebuilt, $subHtml);
                        if ($pos !== false) {
                            $rebuilt = substr_replace(
                                $rebuilt,
                                $subStart . $subHtml . $subEnd,
                                $pos,
                                strlen($subHtml)
                            );
                        }
                    }
                }
            }
        }

        return $rebuilt;
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
        $out = "<div class=\"fe-editable md-edit\" data-md-scope=\"field\" data-md-name=\"{$safeAttr}\" data-field-type=\"{$safeType}\" data-page=\"{$page->id}\">";
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

            // Get image source paths from MarkdownToFields config
            $mdConfig = $this->wire()->modules->get('MarkdownToFields');
            $imageSourcePaths = [];
            
            if ($mdConfig && isset($mdConfig->imageSourcePaths)) {
                $paths = $mdConfig->imageSourcePaths;
                if (is_string($paths)) {
                    $imageSourcePaths = array_filter(array_map('trim', explode(',', $paths)));
                } elseif (is_array($paths)) {
                    $imageSourcePaths = $paths;
                }
            }

            // Default to site/images/ if not configured
            if (empty($imageSourcePaths)) {
                $imageSourcePaths = [$this->wire()->config->paths->root . 'site/images/'];
            }

            $images = [];
            $allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];

            foreach ($imageSourcePaths as $sourcePath) {
                $fullPath = $sourcePath;
                if (!is_dir($fullPath)) continue;

                $files = new \DirectoryIterator($fullPath);
                foreach ($files as $file) {
                    if ($file->isDot() || $file->isDir()) continue;
                    
                    $ext = strtolower($file->getExtension());
                    if (!in_array($ext, $allowedExtensions, true)) continue;

                    $filename = $file->getFilename();
                    $relativePath = str_replace($this->wire()->config->paths->root, '/', $fullPath);
                    $url = rtrim($relativePath, '/') . '/' . $filename;

                    $images[] = [
                        'filename' => $filename,
                        'url' => $url,
                        'size' => $file->getSize(),
                    ];
                }
            }

            header('Content-Type: application/json');
            echo json_encode(['status' => 1, 'images' => $images]);
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

        $mdScope = $input->post->text('mdScope') ?: 'field';
        $mdSection = $input->post->text('mdSection');

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
                    $fieldEntries[] = [
                        'key' => (string)($entry['key'] ?? ''),
                        'name' => (string)($entry['name'] ?? ''),
                        'scope' => (string)($entry['scope'] ?? 'field'),
                        'section' => (string)($entry['section'] ?? ''),
                        'markdown' => (string)($entry['markdown'] ?? ''),
                    ];
                }
            } else {
                foreach ($fieldsPayload as $mdName => $blockMarkdown) {
                    $fieldEntries[] = [
                        'key' => (string)$mdName,
                        'name' => (string)$mdName,
                        'scope' => 'field',
                        'section' => '',
                        'markdown' => (string)$blockMarkdown,
                    ];
                }
            }

            try {
                $content = \ProcessWire\MarkdownFileIO::loadMarkdown($page);
                $fullMarkdown = $content->getRawDocument();
                $updatedMarkdown = $fullMarkdown;
                $skipped = [];
                $replaced = 0;

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

                    $oldFieldMarkdown = $this->findScopedMarkdown($content, $scope, $mdName, $sectionName);

                    if ($oldFieldMarkdown === null) {
                        $skipped[] = $key;
                        continue;
                    }

                    $updatedMarkdown = str_replace($oldFieldMarkdown, $blockMarkdown, $updatedMarkdown, $count);
                    if ($count === 0) {
                        $skipped[] = $key;
                        continue;
                    }
                    $replaced += $count;
                }

                if ($replaced > 0) {
                    $languageCode = $langCode !== '' ? $langCode : \ProcessWire\MarkdownLanguageResolver::getLanguageCode($page);
                    \ProcessWire\MarkdownFileIO::saveLanguageMarkdown($page, $updatedMarkdown, $languageCode);
                    
                    // Trigger sync to process images and update field values
                    \ProcessWire\MarkdownToFields::sync($page);
                }
            } catch (\Throwable $e) {
                $this->sendJsonError('Failed to update markdown: ' . $e->getMessage(), 500);
            }

            $languageCode = $langCode !== '' ? $langCode : \ProcessWire\MarkdownLanguageResolver::getLanguageCode($page);
            $content = $page->loadContent(null, $languageCode);
            $htmlMap = [];
            foreach ($fieldEntries as $entry) {
                $key = $entry['key'] ?: $entry['name'];
                $mdName = $entry['name'];
                $scope = $entry['scope'] ?: 'field';
                $sectionName = $entry['section'];
                $blockMarkdown = (string)($entry['markdown'] ?? '');
                $canonicalHtml = $this->findScopedHtml($content, $scope, $mdName, $sectionName);
                if ($canonicalHtml && strpos((string)$blockMarkdown, '<') !== false && strpos((string)$blockMarkdown, '>') !== false) {
                    $parsedown = new \Parsedown();
                    $parsedown->setSafeMode(false);
                    $canonicalHtml = $parsedown->text((string)$blockMarkdown);
                }
                if ($canonicalHtml !== null) {
                    $htmlMap[$key] = $canonicalHtml;
                }
            }

            header('Content-Type: application/json');
            echo json_encode(['status' => 1, 'html' => $htmlMap, 'skipped' => $skipped ?? []]);
            exit;
        }

        $markdown = isset($_POST['markdown']) ? (string)$_POST['markdown'] : '';
        if(!$markdown) {
            $this->sendJsonError('Missing markdown content', 400);
        }

        $mdName = $input->post->text('mdName');
        if(!$mdName) $this->sendJsonError('Missing mdName', 400);

        // Trace payload details
        $markdownLen = strlen((string)$markdown);
        $markdownLines = $markdownLen ? (substr_count((string)$markdown, "\n") + 1) : 0;
        $markdownPreview = $markdownLen ? substr(str_replace(["\r", "\n"], ["\\r", "\\n"], (string)$markdown), 0, 120) : '';
        $this->wire->log->save('markdown-front-edit',
            "PAYLOAD mdName='{$mdName}' pageId={$pageId} markdownLen={$markdownLen} markdownLines={$markdownLines} markdownPreview='{$markdownPreview}'"
        );

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
            $fullMarkdown = $content->getRawDocument();
            $oldFieldMarkdown = $this->findScopedMarkdown($content, $mdScope, $mdName, $mdSection ?? '');
            
            // Get HTML for unchanged check
            $oldFieldHtml = $this->findScopedHtml($content, $mdScope, $mdName, $mdSection ?? '');
            
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
            
            $frontRaw = $content->getFrontmatterRaw();
            $this->wire->log->save('markdown-front-edit', "SUCCESS: Markdown file updated");
            
            // Trigger sync to process images and update field values
            \ProcessWire\MarkdownToFields::sync($page);
            
        } catch (\Throwable $e) {
            $this->sendJsonError('Failed to update markdown: ' . $e->getMessage(), 500);
        }

        $languageCode = $langCode !== '' ? $langCode : \ProcessWire\MarkdownLanguageResolver::getLanguageCode($page);
        $content = $page->loadContent(null, $languageCode);
        $canonicalHtml = null;
        
        $this->wire->log->save('markdown-front-edit',
            "RESPONSE: loadContent completed, looking for field '{$mdName}' in " . count($content->sections ?? []) . " sections"
        );
        
        $canonicalHtml = $this->findScopedHtml($content, $mdScope, $mdName, $mdSection ?? '');
        
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
        if (!isset($content->sectionsByName) || !is_array($content->sectionsByName)) return [];

        $sections = [];
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

    protected function findScopedMarkdown($content, string $scope, string $name, string $sectionName = ''): ?string {
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

        if (!isset($content->sections) || !is_array($content->sections)) return null;
        foreach ($content->sections as $section) {
            if (isset($section->fields[$name])) {
                return (string)($section->fields[$name]->markdown ?? '');
            }
            if (isset($section->subsections)) {
                foreach ($section->subsections as $subsection) {
                    if (isset($subsection->fields[$name])) {
                        return (string)($subsection->fields[$name]->markdown ?? '');
                    }
                }
            }
        }
        return null;
    }

    protected function findScopedHtml($content, string $scope, string $name, string $sectionName = ''): ?string {
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

        if (!isset($content->sections) || !is_array($content->sections)) return null;
        foreach ($content->sections as $section) {
            if (isset($section->fields[$name])) {
                return (string)($section->fields[$name]->html ?? '');
            }
            if (isset($section->subsections)) {
                foreach ($section->subsections as $subsection) {
                    if (isset($subsection->fields[$name])) {
                        return (string)($subsection->fields[$name]->html ?? '');
                    }
                }
            }
        }
        return null;
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

}
