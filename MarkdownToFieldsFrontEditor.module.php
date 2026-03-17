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
            'summary' => 'Frontend markdown editor for MarkdownToFields.',
            'version' =>  '0.8.0',
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
            'toolbarButtons' => 'bold,italic,strike,paragraph,link,unlink,image,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,code,codeblock,clear,|,split,document,outline',
            'allowedImageExtensions' => 'jpg,jpeg,png,gif,webp,svg',
            'defaultEmphasisStyle' => 'asterisk',
            'defaultUnorderedListMarker' => '*',
            'strictSectionReplace' => true,
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
        self::handleModuleConfigActions();
        $inputfields->add(self::buildToolbarButtonsInput($data, $defaults));
        $inputfields->add(self::buildBehaviorFieldset($data, $defaults));
        $inputfields->add(self::buildDebugFieldset($data));
        $inputfields->add(self::buildThumbCacheFieldset());

        return $inputfields;
    }

    /**
     * Create config inputfield instances from ProcessWire modules.
     * Centralizing this keeps the config form assembly consistent.
     */
    private static function createConfigInputfield(string $type) {
        return wire('modules')->get($type);
    }

    /**
     * Execute config-form side effects before fields are rendered.
     * This keeps POST actions out of the structural form builders.
     */
    private static function handleModuleConfigActions(): void {
        $input = wire('input');
        if ($input->post->text('mfeClearThumbCache') === '') {
            return;
        }

        $module = wire('modules')->get('MarkdownToFieldsFrontEditor');
        if (!$module) {
            return;
        }

        $deleted = $module->clearThumbCache();
        $module->message(
            sprintf('Thumbnail cache cleared (%d files).', $deleted)
        );
    }

    /**
     * Build the toolbar configuration field.
     * This field defines which editor controls are exposed to the frontend.
     */
    private static function buildToolbarButtonsInput(array $data, array $defaults) {
        $field = self::createConfigInputfield('InputfieldText');
        $field->name = 'toolbarButtons';
        $field->label = 'Toolbar Buttons';
        $field->description = 'Comma-separated list of toolbar buttons to show. Use "|" as a separator. Available: bold, italic, strike, code, codeblock, paragraph, h1-h6, ul, ol, blockquote, link, unlink, image, clear, split, document, outline. Save is always shown at the end.';
        $field->notes = 'Defaults: bold,italic,strike,paragraph,link,unlink,image,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,code,codeblock,clear,|,split,document,outline';
        $field->value = !empty($data['toolbarButtons']) ? $data['toolbarButtons'] : $defaults['toolbarButtons'];
        $field->columnWidth = 100;

        return $field;
    }

    /**
     * Build the behavior fieldset shown in module config.
     * These options affect authoring defaults and fullscreen editor behavior.
     */
    private static function buildBehaviorFieldset(array $data, array $defaults) {
        $fieldset = self::createConfigInputfield('InputfieldFieldset');
        $fieldset->label = 'Editor Behavior';
        $fieldset->description = 'General editor behavior options.';

        $emphasisStyleField = self::createConfigInputfield('InputfieldRadios');
        $emphasisStyleField->name = 'defaultEmphasisStyle';
        $emphasisStyleField->label = 'Default Markdown Emphasis Style';
        $emphasisStyleField->description = 'Used for newly created bold and italic formatting from the editor toolbar and shortcuts.';
        $emphasisStyleField->notes = 'Existing markdown keeps its original style. If content comes from an external editor using both **asterisks** and __underscores__, we preserve it as-authored. This default only applies when the frontend editor creates new markdown.';
        $emphasisStyleField->options = [
            'asterisk' => 'Use asterisks: *italic*, **bold**, ***bold italic***',
            'underscore' => 'Use underscores: _italic_, __bold__, ___bold italic___',
        ];
        $emphasisStyleField->value = !empty($data['defaultEmphasisStyle']) ? $data['defaultEmphasisStyle'] : $defaults['defaultEmphasisStyle'];
        $emphasisStyleField->columnWidth = 100;
        $fieldset->add($emphasisStyleField);

        $unorderedMarkerField = self::createConfigInputfield('InputfieldRadios');
        $unorderedMarkerField->name = 'defaultUnorderedListMarker';
        $unorderedMarkerField->label = 'Default Unordered List Marker';
        $unorderedMarkerField->description = 'Used when the frontend editor creates a new unordered list.';
        $unorderedMarkerField->notes = 'Existing list markers are preserved as-authored. This only defines the marker used for newly created unordered lists.';
        $unorderedMarkerField->options = [
            '*' => 'Use *',
            '-' => 'Use -',
            '+' => 'Use +',
        ];
        $unorderedMarkerField->value = !empty($data['defaultUnorderedListMarker']) ? $data['defaultUnorderedListMarker'] : $defaults['defaultUnorderedListMarker'];
        $unorderedMarkerField->columnWidth = 100;
        $fieldset->add($unorderedMarkerField);

        $strictReplaceField = self::createConfigInputfield('InputfieldCheckbox');
        $strictReplaceField->name = 'strictSectionReplace';
        $strictReplaceField->label = 'Enable Safe Parent Live Preview Replacement';
        $strictReplaceField->description = 'When enabled (default), section/subsection parent live preview replacement runs only when safe; otherwise child zones are updated to avoid breaking nested editable areas.';
        $strictReplaceField->value = 1;
        $strictReplaceField->checked = array_key_exists('strictSectionReplace', $data)
            ? !empty($data['strictSectionReplace'])
            : !empty($defaults['strictSectionReplace']);
        $strictReplaceField->columnWidth = 100;
        $fieldset->add($strictReplaceField);

        $labelStyleField = self::createConfigInputfield('InputfieldRadios');
        $labelStyleField->name = 'labelStyle';
        $labelStyleField->label = 'Label Position';
        $labelStyleField->description = 'Choose whether labels sit outside or inside the region.';
        $labelStyleField->options = [
            'outside' => 'Outside (top-right)',
            'inside' => 'Inside (top-right)',
        ];
        $labelStyleField->value = !empty($data['labelStyle']) ? $data['labelStyle'] : $defaults['labelStyle'];
        $labelStyleField->columnWidth = 100;
        $fieldset->add($labelStyleField);

        $confirmUnsavedField = self::createConfigInputfield('InputfieldCheckbox');
        $confirmUnsavedField->name = 'confirmOnUnsavedClose';
        $confirmUnsavedField->label = 'Prompt Before Closing Unsaved Editor';
        $confirmUnsavedField->description = 'When enabled, closing the fullscreen editor (Escape/close button) asks confirmation if there are unsaved changes.';
        $confirmUnsavedField->value = 1;
        $confirmUnsavedField->checked = array_key_exists('confirmOnUnsavedClose', $data)
            ? !empty($data['confirmOnUnsavedClose'])
            : !empty($defaults['confirmOnUnsavedClose']);
        $confirmUnsavedField->columnWidth = 100;
        $fieldset->add($confirmUnsavedField);

        return $fieldset;
    }

    /**
     * Build the debug fieldset shown in module config.
     * These flags expose diagnostics without changing editor behavior.
     */
    private static function buildDebugFieldset(array $data) {
        $fieldset = self::createConfigInputfield('InputfieldFieldset');
        $fieldset->label = 'Debug Options';
        $fieldset->description = 'All debug helpers in one place.';

        $debugLoggingField = self::createConfigInputfield('InputfieldCheckbox');
        $debugLoggingField->name = 'debug';
        $debugLoggingField->label = 'Enable Debug Logging';
        $debugLoggingField->description = 'When enabled, verbose diagnostic logs are written to markdown-front-edit.txt';
        $debugLoggingField->value = 1;
        $debugLoggingField->checked = !empty($data['debug']);
        $debugLoggingField->columnWidth = 100;
        $fieldset->add($debugLoggingField);

        $debugField = self::createConfigInputfield('InputfieldCheckbox');
        $debugField->name = 'debugShowSections';
        $debugField->label = 'Debug: Always Show Section Bounds';
        $debugField->description = 'When enabled, section/subsection wrappers are outlined with labels in the frontend.';
        $debugField->value = 1;
        $debugField->checked = !empty($data['debugShowSections']);
        $debugField->columnWidth = 100;
        $fieldset->add($debugField);

        $debugLabelsField = self::createConfigInputfield('InputfieldCheckbox');
        $debugLabelsField->name = 'debugShowLabels';
        $debugLabelsField->label = 'Debug: Show editable areas Labels';
        $debugLabelsField->description = 'Shows scope labels like "section:hero" in the rollover helper.';
        $debugLabelsField->value = 1;
        $debugLabelsField->checked = !empty($data['debugShowLabels']);
        $debugLabelsField->columnWidth = 100;
        $fieldset->add($debugLabelsField);

        return $fieldset;
    }

    /**
     * Build the thumbnail cache maintenance controls.
     * The submit button delegates execution to handleModuleConfigActions().
     */
    private static function buildThumbCacheFieldset() {
        $fieldset = self::createConfigInputfield('InputfieldFieldset');
        $fieldset->label = 'Thumbnail Cache';
        $fieldset->description = 'Manual cache controls for image picker thumbnails.';

        $clearThumbs = self::createConfigInputfield('InputfieldSubmit');
        $clearThumbs->name = 'mfeClearThumbCache';
        $clearThumbs->value = 'Clear thumbnail cache';
        $clearThumbs->description = 'Deletes /site/assets/cache/MFE/thumbs/index.json and cached thumbs.';
        $clearThumbs->columnWidth = 100;
        $fieldset->add($clearThumbs);

        return $fieldset;
    }

    /**
     * Register runtime hooks used by the frontend editor.
     * This keeps initialization focused on request-time wiring only.
     */
    public function init() {
        // runtime flag set by template opt-in
        $this->enabledForRequest = false;
        $this->registerRuntimeHooks();
    }

    /**
     * Install required permissions and persist default config values.
     * This keeps fresh installs aligned with the editor defaults shipped in code.
     */
    public function install() {
        $this->ensureFrontendEditPermission();
        $this->saveDefaultModuleConfig();
    }

    /**
     * Register all module hooks in one place.
     * This makes the module entry responsibilities easier to trace.
     */
    private function registerRuntimeHooks(): void {
        $this->addHookAfter('Page::render', $this, 'hookPageRenderAssets');
        $this->addHookAfter('Page::render', $this, 'hookAutoWrapFields');
        $this->addHook('Page::mdEdit', $this, 'hookPageMdEdit');
        $this->addHook('Page::renderEditable', $this, 'hookPageRenderEditable');
        $this->addHookBefore('ProcessWire::ready', $this, 'handleSaveRequest');
    }

    /**
     * Persist default config values for a fresh module install.
     * Keeping this isolated avoids duplicating the default config map.
     */
    private function saveDefaultModuleConfig(): void {
        $defaults = self::getDefaultData();
        $this->wire('modules')->saveConfig($this, [
            'toolbarButtons' => $defaults['toolbarButtons'],
            'defaultEmphasisStyle' => $defaults['defaultEmphasisStyle'],
            'defaultUnorderedListMarker' => $defaults['defaultUnorderedListMarker'],
            'strictSectionReplace' => $defaults['strictSectionReplace'],
            'debug' => $defaults['debug'],
            'debugShowSections' => $defaults['debugShowSections'],
            'debugShowLabels' => $defaults['debugShowLabels'],
            'labelStyle' => $defaults['labelStyle'],
            'confirmOnUnsavedClose' => $defaults['confirmOnUnsavedClose'],
        ]);
    }

    /**
     * Ensure the frontend editing permission exists before runtime use.
     * Install should be able to run repeatedly without changing existing permissions.
     */
    private function ensureFrontendEditPermission(): void {
        $permissions = $this->wire('permissions');
        if (!$permissions) {
            return;
        }

        $name = 'page-edit-front';
        $existing = $permissions->get($name);
        if ($existing && (int)$existing->id > 0) {
            return;
        }

        $permission = new Permission();
        $permission->name = $name;
        $permission->title = 'Edit pages from frontend';
        $permission->save();
    }

    /**
     * Log debug messages when module debug mode is enabled.
     * This is the lowest-friction tracing path for frontend-editor audits.
     */
    private function logDebug(string $message): void {
        $enabled = (bool)($this->debug ?? false);
        if (!$enabled) {
            return;
        }
        $this->wire->log->save('markdown-front-edit', $message);
    }

    /**
     * Log info messages when module debug mode is enabled.
     * Keeping this separate makes intent explicit at call sites.
     */
    private function logInfo(string $message): void {
        $enabled = (bool)($this->debug ?? false);
        if (!$enabled) {
            return;
        }
        $this->wire->log->save('markdown-front-edit', $message);
    }

    private function countMarkdownMarkers(string $markdown): int {
        if ($markdown === '') {
            return 0;
        }
        if (!preg_match_all('/<!--\s*[^>]+?\s*-->/', $markdown, $matches)) {
            return 0;
        }
        return is_array($matches[0]) ? count($matches[0]) : 0;
    }

    private function countLeadingNewlineBytes(string $markdown): int {
        $length = strlen($markdown);
        $count = 0;
        for ($i = 0; $i < $length; $i++) {
            $char = $markdown[$i];
            if ($char === "\n" || $char === "\r") {
                $count++;
                continue;
            }
            break;
        }
        return $count;
    }

    private function markdownByteProbe(string $markdown): string {
        return sprintf(
            "bytes=%d sha1=%s markers=%d leadingNewlineBytes=%d",
            strlen($markdown),
            substr(sha1($markdown), 0, 12),
            $this->countMarkdownMarkers($markdown),
            $this->countLeadingNewlineBytes($markdown)
        );
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
     * Inject frontend assets and runtime config into rendered page HTML.
     * This only runs when the request is allowed to use the frontend editor.
     */
    public function hookPageRenderAssets($event) {
        $page = $event->object;
        if (!$page instanceof \ProcessWire\Page) {
            return;
        }
        if (!$this->canInjectFrontendAssets($page)) {
            return;
        }

        $out = $event->return;
        if (!is_string($out)) {
            return;
        }

        $config = $this->wire()->config;
        $defaults = self::getDefaultData();
        $currentLangCode = \ProcessWire\MarkdownLanguageResolver::getLanguageCode($this->wire()->page);
        $toolbarButtons = $this->resolveFrontendToolbarButtons($defaults);
        $modulePath = $config->paths($this->className());
        $jsPath = $modulePath . 'dist/editor.bundle.js';
        $version = is_file($jsPath) ? (string) filemtime($jsPath) : (string) time();
        $frontConfig = $this->buildFrontendAssetConfig(
            $page,
            $toolbarButtons,
            $currentLangCode,
            $defaults,
            $version
        );
        $script = $this->buildFrontendAssetMarkup($modulePath, $version, $frontConfig);

        if(stripos($out, '</body>') !== false) {
            $out = str_ireplace('</body>', $script . '</body>', $out);
        } else {
            $out .= $script;
        }

        $event->return = $out;
    }

    /**
     * Decide whether the current request may receive frontend-editor assets.
     * This keeps permission, admin, and template checks in one place.
     */
    private function canInjectFrontendAssets(\ProcessWire\Page $page): bool {
        $config = $this->wire()->config;
        if ($config->ajax) {
            return false;
        }

        $input = $this->wire()->input;
        if ($input->url && strpos($input->url, $config->urls->admin) === 0) {
            return false;
        }

        $user = $this->wire()->user;
        if (!$user->isLoggedIn() || !$user->hasPermission('page-edit-front')) {
            return false;
        }

        return $this->enabledForRequest || $this->isMarkdownTemplateEnabled($page);
    }

    /**
     * Resolve the toolbar button configuration sent to the frontend bundle.
     * Empty module config falls back to the shipped defaults.
     */
    private function resolveFrontendToolbarButtons(array $defaults): string {
        return isset($this->toolbarButtons) && trim((string)$this->toolbarButtons) !== ''
            ? (string)$this->toolbarButtons
            : (string)$defaults['toolbarButtons'];
    }

    /**
     * Build the language list exposed to the frontend runtime.
     * The current language is normalized against ProcessWire language storage codes.
     */
    private function buildFrontendLanguageList(string $currentLangCode): array {
        $user = $this->wire()->user;
        $languages = $this->wire()->languages;
        $currentLangName = (string)$currentLangCode;
        $langList = [];

        if (!$languages) {
            return [[
                'id' => 0,
                'name' => 'default',
                'title' => 'Default',
                'isDefault' => true,
                'isCurrent' => true,
            ]];
        }

        $currentUserLanguage = ($user && isset($user->language) && $user->language)
            ? $user->language
            : null;
        $defaultLanguage = $languages->getDefault();
        if ($currentLangName === '' && $currentUserLanguage && isset($currentUserLanguage->id)) {
            $currentLangName = $this->resolveLanguageStorageCode($currentUserLanguage);
        } elseif ($currentLangName === '' && $defaultLanguage && isset($defaultLanguage->id)) {
            $currentLangName = $this->resolveLanguageStorageCode($defaultLanguage);
        }

        foreach ($languages as $lang) {
            $storageCode = $this->resolveLanguageStorageCode($lang);
            $langList[] = [
                'id' => (int) $lang->id,
                'name' => $storageCode,
                'title' => (string)($lang->title ?: $lang->name),
                'isDefault' => (bool)$lang->isDefault(),
                'isCurrent' => false,
            ];
        }

        $langNames = array_map(static fn($item) => (string)($item['name'] ?? ''), $langList);
        if (!in_array($currentLangName, $langNames, true)) {
            if ($defaultLanguage && isset($defaultLanguage->id)) {
                $currentLangName = $this->resolveLanguageStorageCode($defaultLanguage);
            }
            if (!in_array($currentLangName, $langNames, true)) {
                $currentLangName = (string)($langList[0]['name'] ?? 'default');
            }
        }

        foreach ($langList as &$item) {
            $item['isCurrent'] = ((string)$item['name'] === $currentLangName);
        }
        unset($item);

        return $langList;
    }

    /**
     * Build the serialized frontend config payload injected into the page.
     * This collects all runtime data the JS bundle needs to bootstrap editing.
     */
    private function buildFrontendAssetConfig(
        \ProcessWire\Page $page,
        string $toolbarButtons,
        string $currentLangCode,
        array $defaults,
        string $version
    ): array {
        $langList = $this->buildFrontendLanguageList($currentLangCode);
        $currentLanguage = 'default';
        foreach ($langList as $item) {
            if (!empty($item['isCurrent'])) {
                $currentLanguage = (string)($item['name'] ?? 'default');
                break;
            }
        }

        $documentMarkdownB64 = '';
        try {
            $fullMarkdown = $this->loadRawMarkdownDocument($page, $currentLangCode);
            $documentMarkdownB64 = base64_encode($fullMarkdown);
        } catch (\Throwable $e) {
            $documentMarkdownB64 = '';
        }

        return [
            'toolbarButtons' => $toolbarButtons,
            'languages' => $langList,
            'currentLanguage' => $currentLanguage,
            'pageId' => (int)$page->id,
            'adminUrl' => (string)$this->wire()->config->urls->admin,
            'imageBaseUrl' => $this->resolveConfiguredImageBaseUrl($page),
            'pageFilesBaseUrl' => $this->resolvePageFilesBaseUrl($page),
            'buildStamp' => $version,
            'sectionsIndex' => $this->buildSectionsIndex($page),
            'fieldsIndex' => $this->buildFieldsIndex($page),
            'documentMarkdownB64' => $documentMarkdownB64,
            'debug' => (bool)($this->debug ?? false),
            'debugShowSections' => (bool)($this->debugShowSections ?? false),
            'debugLabels' => (bool)($this->debugShowLabels ?? false),
            'strictSectionReplace' => (bool)($this->strictSectionReplace ?? $defaults['strictSectionReplace']),
            'defaultEmphasisStyle' => (string)($this->defaultEmphasisStyle ?? $defaults['defaultEmphasisStyle']),
            'defaultUnorderedListMarker' => (string)($this->defaultUnorderedListMarker ?? $defaults['defaultUnorderedListMarker']),
            'labelStyle' => (string)($this->labelStyle ?? $defaults['labelStyle']),
            'confirmOnUnsavedClose' => (bool)($this->confirmOnUnsavedClose ?? $defaults['confirmOnUnsavedClose']),
        ];
    }

    /**
     * Build the CSS and JS tags injected into the rendered page.
     * Asset versions come from file mtimes so frontend code stays in sync after deploys.
     */
    private function buildFrontendAssetMarkup(string $modulePath, string $version, array $frontConfig): string {
        $config = $this->wire()->config;
        $url = $config->urls($this->className());
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

        $moduleScript = "<script src=\"{$url}dist/editor.bundle.js?v={$version}\"></script>";

        return $cssLink . $viewCssLink . $configScript . $moduleScript;
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
                        // $this->logDebug("COLLECT field='{$fname}' type='{$fieldType}' markdownLen=" . strlen($markdown));
                    }
                }
            }
            if (isset($section->subsections) && is_array($section->subsections)) {
                foreach ($section->subsections as $subsectionName => $subsection) {
                    if (isset($subsection->fields) && is_array($subsection->fields)) {
                        foreach ($subsection->fields as $fname => $f) {
                            if (isset($f->html) && $f->html !== '') {
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
                                // $this->logDebug("COLLECT field='{$fname}' type='{$fieldType}' markdownLen=" . strlen($markdown));
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
                            stripos($rebuilt, 'data-mfe-name="' . $safeAttr . '" data-mfe-section="' . $safeSection . '"') !== false
                        ) continue;
                        
                        // Find and wrap the field
                        $originalHtml = $f->html;
                        $displayHtml = $f->html;
                        $wrapper = '<div class="fe-editable md-edit" data-mfe-scope="field" data-mfe-name="' . $safeAttr . '" data-mfe-section="' . $safeSection . '" data-mfe-source="' . $safeSourceKey . '" data-field-type="' . $safeType . '" data-page="' . $page->id . '" data-markdown="' . $safeMarkdown . '" data-markdown-b64="' . $safeMarkdownB64 . '">' . $displayHtml . '</div>';
                        
                        $scopeKey = $sectionName !== '' ? (string)$sectionName : '';
                        $rebuilt = $this->replaceFirstScopedHtmlMatch(
                            $rebuilt,
                            $originalHtml,
                            $wrapper,
                            $scopeKey
                        );
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
                                    stripos($rebuilt, 'data-mfe-name="' . $safeAttr . '" data-mfe-section="' . $safeSection . '" data-mfe-subsection="' . $safeSubsection . '"') !== false
                                ) continue;
                                
                                $originalHtml = $f->html;
                                $displayHtml = $f->html;
                                $wrapper = '<div class="fe-editable md-edit" data-mfe-scope="field" data-mfe-name="' . $safeAttr . '" data-mfe-section="' . $safeSection . '" data-mfe-subsection="' . $safeSubsection . '" data-mfe-source="' . $safeSourceKey . '" data-field-type="' . $safeType . '" data-page="' . $page->id . '" data-markdown="' . $safeMarkdown . '" data-markdown-b64="' . $safeMarkdownB64 . '">' . $displayHtml . '</div>';
                                
                                $scopeKey = $sectionName !== ''
                                    ? (string)$sectionName . '/' . (string)$subsectionName
                                    : '';
                                $rebuilt = $this->replaceFirstScopedHtmlMatch(
                                    $rebuilt,
                                    $originalHtml,
                                    $wrapper,
                                    $scopeKey
                                );
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
        $sourceKey = htmlspecialchars($this->scopedHtmlKey('field', $fieldName, '', ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $out = "<div class=\"fe-editable md-edit\" data-mfe-scope=\"field\" data-mfe-name=\"{$safeAttr}\" data-mfe-source=\"{$sourceKey}\" data-field-type=\"{$safeType}\" data-page=\"{$page->id}\">";
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
                $langCode = $lang ? $this->resolveLanguageStorageCode($lang) : 'default';
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

        // Thumb delivery endpoint (GET) - serves cached thumbnails
        if ($input->get->text('action') === 'deliverThumb') {
            $thumbName = $input->get->text('thumb');
            if (!$thumbName || !preg_match('/^[a-z0-9\-_.]+\.[a-z0-9]{64}\.jpg$/i', $thumbName)) {
                header('HTTP/1.1 400 Bad Request');
                exit;
            }
            $cachePath = rtrim((string)$this->wire()->config->paths->cache, '/') . '/';
            $thumbPath = $cachePath . 'MFE/thumbs/' . $thumbName;

            if (!is_file($thumbPath) || !is_readable($thumbPath)) {
                header('HTTP/1.1 404 Not Found');
                exit;
            }
            header('Content-Type: image/jpeg');
            header('Content-Length: ' . filesize($thumbPath));
            header('Cache-Control: public, max-age=31536000');
            readfile($thumbPath);
            exit;
        }

        // SSE thumb stream endpoint
        if ($input->get->text('action') === 'thumbStream') {
            $user = $this->wire()->user;
            if(!$user->isLoggedIn() || !$user->hasPermission('page-edit-front')) {
                header('HTTP/1.1 403 Forbidden');
                echo 'Forbidden';
                exit;
            }

            if (session_status() === PHP_SESSION_ACTIVE) {
                session_write_close();
            }

            $thumbsParam = $input->get->text('thumbs');
            if ($thumbsParam === '') {
                header('HTTP/1.1 400 Bad Request');
                echo 'Missing thumbs parameter';
                exit;
            }

            $thumbNames = array_filter(array_map('trim', explode(',', $thumbsParam)));
            if (empty($thumbNames)) {
                header('HTTP/1.1 400 Bad Request');
                echo 'No thumb names provided';
                exit;
            }

            header('Content-Type: text/event-stream');
            header('Cache-Control: no-cache');
            header('Connection: keep-alive');
            if (function_exists('apache_setenv')) {
                @apache_setenv('no-gzip', '1');
            }
            @ini_set('output_buffering', 'off');
            @ini_set('zlib.output_compression', 'off');
            if (function_exists('ob_end_clean')) {
                while (ob_get_level() > 0) {
                    ob_end_clean();
                }
            }

            try {
                $thumbDir = $this->ensureThumbDir();
            } catch (\RuntimeException $e) {
                header('HTTP/1.1 400 Bad Request');
                echo $e->getMessage();
                exit;
            }
            $remaining = $thumbNames;
            $timeout = 30;
            $start = time();

            while (count($remaining) > 0 && (time() - $start) < $timeout) {
                $toCheck = $remaining;
                $remaining = [];
                foreach ($toCheck as $name) {
                    $path = $thumbDir . $name;
                    if (is_file($path)) {
                        // Serve thumbnail through PHP endpoint to bypass .htaccess restrictions
                        $url = '?markdownFrontEditorSave=1&action=deliverThumb&thumb=' . urlencode($name);
                        echo "event: ready\n";
                        echo 'data: ' . json_encode(['thumbName' => $name, 'thumbUrl' => $url]) . "\n\n";
                        if (function_exists('ob_flush')) {
                            ob_flush();
                        }
                        flush();
                    } else {
                        $remaining[] = $name;
                    }
                }
                if (count($remaining) > 0) {
                    usleep(500000);
                }
            }

            echo "event: done\n";
            echo "data: {}\n\n";
            if (function_exists('ob_flush')) {
                ob_flush();
            }
            flush();
            exit;
        }

        // Thumb generation endpoint
        if ($input->post->text('action') === 'generateThumb') {
            $user = $this->wire()->user;
            if(!$user->isLoggedIn() || !$user->hasPermission('page-edit-front')) {
                $this->sendJsonError('Forbidden', 403);
            }

            try { $this->wire()->session->CSRF->validate(); }
            catch(\Exception $e) { $this->sendJsonError('Failed CSRF check', 403); }

            $imagePath = $input->post->text('imagePath');
            $relativePath = $input->post->text('relativePath');
            $hash = $input->post->text('hash');
            $pageId = (int)$input->post->pageId;
            if (!$imagePath) {
                $this->sendJsonError('Missing imagePath', 400);
            }
            if (!$pageId) {
                $this->sendJsonError('Missing pageId', 400);
            }

            if (session_status() === PHP_SESSION_ACTIVE) {
                session_write_close();
            }

            if (!is_file($imagePath) || !is_readable($imagePath)) {
                $this->sendJsonError('Image not found or not readable', 404);
            }

            $basename = basename($imagePath);
            $ext = strtolower(pathinfo($imagePath, PATHINFO_EXTENSION));
            
            // Skip SVG files - cannot generate thumb with GD library
            if ($ext === 'svg') {
                header('Content-Type: application/json');
                echo json_encode([
                    'status' => 'skip',
                    'reason' => 'svg',
                    'url' => $input->post->text('imageUrl') ?: '',
                ]);
                exit;
            }
            
            // Compute hash if not provided (lazy initialization)
            if ($hash === '') {
                $hash = $this->hashFile($imagePath);
                if ($relativePath !== '') {
                    $this->saveHashToIndex($relativePath, $hash);
                }
            }

            try {
                $thumbPath = $this->thumbPath($basename, $hash, $imagePath);
            } catch (\Throwable $e) {
                $this->sendJsonError($e->getMessage(), 400);
            }
            if (is_file($thumbPath)) {
                header('Content-Type: application/json');
                echo json_encode([
                    'status' => 'exists',
                    'thumbUrl' => $this->thumbUrl($basename, $hash),
                    'hash' => $hash,
                ]);
                exit;
            }

            $thumbSource = $relativePath !== '' ? $relativePath : $imagePath;
            try {
                $pwVariationPath = $this->buildProcessWireThumbVariation($pageId, $thumbSource, 500, $relativePath);
                $this->ensureThumbDir($imagePath);
                $saved = @copy($pwVariationPath, $thumbPath);
                if (is_file($pwVariationPath) && basename($pwVariationPath) !== basename($thumbPath)) {
                    @unlink($pwVariationPath);
                }
            } catch (\Throwable $e) {
                if ($this->debug) {
                    $this->wire()->log->save('markdown-front-edit', sprintf(
                        "THUMB_IMPORT_FAILED pageId=%d thumbSource='%s' imagePath='%s' relativePath='%s' class='%s' message='%s'",
                        $pageId,
                        str_replace(["\n", "\r"], ' ', (string)$thumbSource),
                        str_replace(["\n", "\r"], ' ', (string)$imagePath),
                        str_replace(["\n", "\r"], ' ', (string)$relativePath),
                        get_class($e),
                        str_replace(["\n", "\r"], ' ', (string)$e->getMessage())
                    ));
                }
                $this->sendJsonError($e->getMessage(), 500);
            }

            if (!$saved || !is_file($thumbPath)) {
                $this->sendJsonError('Failed to save thumb', 500);
            }

            // Ensure thumbnail is readable by the web server
            @chmod($thumbPath, 0644);

            header('Content-Type: application/json');
            echo json_encode([
                'status' => 'created',
                'thumbUrl' => $this->thumbUrl($basename, $hash),
                'hash' => $hash,
            ]);
            exit;
        }

        // Resolve image endpoint - copies MF image to PW assets, returns PW URL
        if ($input->post->text('action') === 'resolveImage') {
            $user = $this->wire()->user;
            if(!$user->isLoggedIn() || !$user->hasPermission('page-edit-front')) {
                $this->sendJsonError('Forbidden', 403);
            }

            try { $this->wire()->session->CSRF->validate(); }
            catch(\Exception $e) { $this->sendJsonError('Failed CSRF check', 403); }

            $pageId = (int)$input->post->pageId;
            $imagePath = trim((string)$input->post->imagePath);

            if(!$pageId) $this->sendJsonError('Missing pageId', 400);
            if($imagePath === '') $this->sendJsonError('Missing imagePath', 400);

            $page = $this->wire()->pages->get($pageId);
            if(!$page->id) $this->sendJsonError('Page not found', 404);

            // Use MarkdownHtmlConverter's existing pipeline to copy to PW assets
            $resolvedUrl = \ProcessWire\MarkdownHtmlConverter::resolveImageForInsertion(
                $page,
                $imagePath
            );

            if ($resolvedUrl === null) {
                $this->sendJsonError('Failed to process image to page assets', 500);
            }

            header('Content-Type: application/json');
            echo json_encode(['status' => 1, 'url' => $resolvedUrl]);
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
            try {
                $imageSourcePaths = $this->getConfiguredImageSourcePaths();
            } catch (\RuntimeException $e) {
                $this->sendJsonError($e->getMessage(), 400);
            }

            $images = [];
            $missingDirs = [];
            $allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];

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
                    
                    // Skip files inside thumbnail cache directories
                    if (strpos($fullFilename, '/_thumbs/') !== false) {
                        continue;
                    }
                    
                    // Skip SVG files from thumb generation (display directly)
                    $isSvg = strtolower($ext) === 'svg';
                    
                    $relativeSourcePath = ltrim(substr($fullFilename, strlen($fullPathNorm)), '/');
                    $relativeSourcePath = str_replace('\\', '/', $relativeSourcePath);
                    try {
                        $sourceBaseUrl = $this->sourcePathToPublicBaseUrl($fullPathNorm);
                    } catch (\RuntimeException $e) {
                        $this->sendJsonError($e->getMessage(), 400);
                    }
                    $url = rtrim($sourceBaseUrl, '/') . '/' . $relativeSourcePath;

                    // Check mfe-owned hash index (lazy cache)
                    $hash = null;
                    if (!isset($thumbIndex)) {
                        $thumbIndex = $this->loadThumbIndex();
                    }
                    if (isset($thumbIndex[$relativeSourcePath])) {
                        $hash = $thumbIndex[$relativeSourcePath];
                    }

                    $thumbUrl = null;
                    $thumbPending = false;
                    $thumbName = null;
                    $requestThumb = false;
                    
                    // SVG files: no thumb generation, display directly
                    if ($isSvg) {
                        // No thumb for SVG, will use full URL
                    } elseif ($hash) {
                        $name = pathinfo($filename, PATHINFO_FILENAME);
                        $thumbName = $name . '.' . $hash . '.jpg';
                        $thumbPath = $this->ensureThumbDir($fullFilename) . $thumbName;
                        if (is_file($thumbPath)) {
                            // Serve thumbnail through PHP endpoint to bypass .htaccess restrictions
                            $thumbUrl = '?markdownFrontEditorSave=1&action=deliverThumb&thumb=' . urlencode($thumbName);
                        } else {
                            $thumbPending = true;
                        }
                    } else {
                        // No hash: request thumb generation but don't show loading state
                        $requestThumb = true;
                    }

                    $imageItem = [
                        'filename' => $filename,
                        'path' => $relativeSourcePath,
                        'url' => $url,
                        'size' => $file->getSize(),
                        'fullPath' => $fullFilename,
                    ];
                    
                    // Get display dimensions (EXIF-aware) for aspect ratio placeholder and cache EXIF orientation
                    $imgDims = $this->getImageDisplayDimensions($fullFilename);
                    if ($imgDims) {
                        $imageItem['width'] = $imgDims['width'];
                        $imageItem['height'] = $imgDims['height'];
                        // Cache EXIF orientation for thumbnail generation (avoid re-reading)
                        $this->cacheImageExifOrientation($relativeSourcePath, $fullFilename);
                    }
                    
                    if ($hash) {
                        $imageItem['hash'] = $hash;
                    }
                    if ($thumbUrl) {
                        $imageItem['thumbUrl'] = $thumbUrl;
                    }
                    if ($thumbPending) {
                        $imageItem['thumbPending'] = true;
                        $imageItem['thumbName'] = $thumbName;
                    }
                    if ($requestThumb) {
                        $imageItem['requestThumb'] = true;
                    }

                    $images[] = $imageItem;
                }
            }

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
                $resolvedLang = $this->resolveLanguagePageByRequestCode(null, $langCode);
                if (!$resolvedLang) {
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
            $renderPath = trim((string)$input->post('renderPath', 'string'));
            $languages = $this->wire()->languages;
            $isMultilingual = $languages && $languages->count() > 0;
            if ($isMultilingual && $renderPath === '') {
                $this->sendJsonError('Missing renderPath for multilingual fragment render', 400);
            }
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
                "FRAGMENTS_REQUEST pageId=%d lang='%s' transport='%s' keys=%d mountTargetKeys=%d graph='%s' graphNodes=%d renderPath='%s'",
                $pageId,
                $languageCode,
                $transport,
                count($keys),
                count($mountTargets),
                $clientGraphChecksum,
                $clientGraphNodeCount,
                str_replace(["\n", "\r"], ' ', (string)$renderPath)
            ));

            try {
                $renderedHtml = $this->renderPageHtmlForLang($page, $languageCode, $renderPath);
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

                if ($missing) {
                    try {
                        $canonicalContent = \ProcessWire\MarkdownFileIO::loadLanguageMarkdown($page, $languageCode);
                        if ($canonicalContent) {
                            $canonicalHtmlMap = $this->getAllFieldsHtml($canonicalContent);
                            $filled = 0;
                            foreach ($missing as $missingKey) {
                                if (isset($canonicalHtmlMap[$missingKey]) && !isset($fragments[$missingKey])) {
                                    $fragments[$missingKey] = (string)$canonicalHtmlMap[$missingKey];
                                    $filled += 1;
                                }
                            }
                            if ($filled > 0) {
                                $this->logInfo(sprintf(
                                    "FRAGMENTS_CANONICAL_FILL pageId=%d lang='%s' filled=%d",
                                    $pageId,
                                    $languageCode,
                                    $filled
                                ));
                            }
                        }
                    } catch (\Throwable $e) {
                        $this->logInfo(sprintf(
                            "FRAGMENTS_CANONICAL_FILL_ERROR pageId=%d lang='%s' class='%s' message='%s'",
                            $pageId,
                            $languageCode,
                            get_class($e),
                            str_replace(["\n", "\r"], ' ', (string)$e->getMessage())
                        ));
                    }

                    $missing = [];
                    foreach ($keys as $k) {
                        if (!isset($fragments[$k])) $missing[] = $k;
                    }
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
                    $fragments = $this->sortCanonicalHtmlMapByKeyOrder($fragments);
                    header('Content-Type: application/json');
                    echo json_encode([
                        'status' => 1,
                        'fragments' => $fragments,
                        'missing' => $missing,
                    ]);
                    exit;
                }

                $fragments = $this->sortCanonicalHtmlMapByKeyOrder($fragments);
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
            $resolvedLang = $this->resolveLanguagePageByRequestCode(null, $langCode);
            if (!$resolvedLang) {
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
        $summarizeListTopology = function(string $markdown): string {
            [$frontRaw, $body] = $this->splitLeadingFrontmatter($markdown);
            $source = ($body !== '' || $frontRaw !== '') ? (string)$body : (string)$markdown;
            $lines = preg_split('/\r?\n/', $source) ?: [];
            $count = 0;
            $sample = [];

            foreach ($lines as $line) {
                if (!preg_match('/^([ \t]*)(?:[-*+]|\d+[.)])\s+(.+)$/', (string)$line, $match)) {
                    continue;
                }

                $count++;
                if (count($sample) >= 4) {
                    continue;
                }

                $indentColumns = 0;
                foreach (str_split((string)$match[1]) as $char) {
                    $indentColumns += $char === "\t" ? 4 : 1;
                }

                $text = trim((string)$match[2]);
                if (strlen($text) > 40) {
                    $text = substr($text, 0, 37) . '...';
                }
                $sample[] = $indentColumns . ':' . $text;
            }

            return 'items=' . $count
                . ' hash=' . substr(md5($source), 0, 12)
                . ' sample=' . (count($sample) ? implode(' | ', $sample) : 'none');
        };
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
                        (string)$oldFieldMarkdown,
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
                    $this->logInfo(
                        "BYTE_PROBE stage=pre-write mode='batch' pageId={$pageId} lang='{$languageCode}' " . $this->markdownByteProbe((string)$updatedMarkdown)
                    );
                    $this->logInfo(
                        "BYTE_PROBE stage=persistence-call mode='batch' pageId={$pageId} lang='{$languageCode}' callee='saveRawMarkdownDocumentExact'"
                    );
                    $this->saveRawMarkdownDocumentExact($page, $languageCode, (string)$updatedMarkdown);
                    $postWriteMarkdown = $this->loadRawMarkdownDocument($page, $languageCode);
                    $this->logInfo(
                        "BYTE_PROBE stage=post-write mode='batch' pageId={$pageId} lang='{$languageCode}' " . $this->markdownByteProbe($postWriteMarkdown)
                    );
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
            $finalHtmlMap = $this->sortCanonicalHtmlMapByKeyOrder($finalHtmlMap);
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
                'documentMarkdownB64' => base64_encode($updatedMarkdown),
                'skipped' => $skipped ?? []
            ]);
            exit;
        }

        $markdown = isset($_POST['markdown']) ? (string)$_POST['markdown'] : '';
        if(!$markdown) {
            $this->sendJsonError('Missing markdown content', 400);
        }

        $this->logInfo(
            "BYTE_PROBE stage=request-receive mode='single' pageId={$pageId} lang='{$languageCode}' mdScope='{$mdScope}' mdSection='" . (string)$mdSection . "' fieldId='" . (string)$fieldId . "' mdName='" . (string)$input->post->text('mdName') . "' " . $this->markdownByteProbe((string)$markdown)
        );

        $mdName = $input->post->text('mdName');
        if(!$mdName) $this->sendJsonError('Missing mdName', 400);
        $mdSubsection = $input->post->text('mdSubsection');
        if ($fieldId !== '' && $mdScope === 'field') {
            $fieldIdentity = $this->parseFieldIdentityFromFieldId($fieldId, (string)$pageId);
            if ($fieldIdentity === null) {
                $this->sendJsonError('Invalid fieldId identity', 400);
            }
            $mdScope = (string)$fieldIdentity['scope'];
            $mdName = (string)$fieldIdentity['name'];
            $mdSection = (string)$fieldIdentity['section'];
            $mdSubsection = (string)$fieldIdentity['subsection'];
        } elseif ($fieldId !== '' && $mdScope !== 'field') {
            $this->logDebug(
                "SAVE_IDENTITY_SOURCE explicit_scope mdScope='{$mdScope}' mdName='{$mdName}' mdSection='" . (string)$mdSection . "' mdSubsection='" . (string)$mdSubsection . "' fieldId='" . (string)$fieldId . "'"
            );
        }

        $this->logDebug(
            "SAVE_INPUT_TOPOLOGY mode='single' pageId={$pageId} mdName='{$mdName}' scope='{$mdScope}' section='" . (string)$mdSection . "' subsection='" . (string)$mdSubsection . "' fieldId='" . (string)$fieldId . "' lang='{$languageCode}' payload=" . $summarizeListTopology((string)$markdown)
        );

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

            if ($mdScope === 'document') {
                $oldFieldMarkdown = $fullMarkdown;
                $normalizedDocument = (string)$blockMarkdown;
                [$oldFrontmatter, $_oldBody] = $this->splitLeadingFrontmatter($oldFieldMarkdown);
                [$newFrontmatter, $newBody] = $this->splitLeadingFrontmatter($normalizedDocument);
                if ($newFrontmatter === '' && $oldFrontmatter !== '') {
                    $normalizedDocument = $oldFrontmatter . $newBody;
                }
                if ((string)$oldFieldMarkdown !== $normalizedDocument) {
                    $this->logDebug(
                        "SAVE_OUTPUT_TOPOLOGY mode='document' pageId={$pageId} mdName='{$mdName}' scope='{$mdScope}' section='" . (string)$mdSection . "' subsection='" . (string)$mdSubsection . "' fieldId='" . (string)$fieldId . "' lang='{$languageCode}' document=" . $summarizeListTopology((string)$normalizedDocument)
                    );
                    $this->logInfo(
                        "BYTE_PROBE stage=pre-write mode='document' pageId={$pageId} lang='{$languageCode}' " . $this->markdownByteProbe((string)$normalizedDocument)
                    );
                    $this->logInfo(
                        "BYTE_PROBE stage=persistence-call mode='document' pageId={$pageId} lang='{$languageCode}' callee='saveRawMarkdownDocumentExact'"
                    );
                    $this->saveRawMarkdownDocumentExact($page, $languageCode, $normalizedDocument);
                    $postWriteMarkdown = $this->loadRawMarkdownDocument($page, $languageCode);
                    $this->logInfo(
                        "BYTE_PROBE stage=post-write mode='document' pageId={$pageId} lang='{$languageCode}' " . $this->markdownByteProbe($postWriteMarkdown)
                    );
                    $this->logInfo("SUCCESS: Full document markdown updated");
                    $content = \ProcessWire\MarkdownFileIO::loadLanguageMarkdown($page, $languageCode);
                    if (!$content) {
                        throw new \ProcessWire\WireException("Failed to reload fresh content after document save.");
                    }
                } else {
                    $content = \ProcessWire\MarkdownFileIO::loadLanguageMarkdown($page, $languageCode);
                    if (!$content) {
                        throw new \ProcessWire\WireException("Failed to load markdown content for language '{$languageCode}'.");
                    }
                }
                $allKeys = array_keys($this->getAllFieldsHtml($content));
                $changedKeys = array_values(array_filter($allKeys, fn($k) => is_string($k) && $k !== ''));
            } else {

            if ($mdScope === 'subsection' && trim($blockMarkdown) !== '') {
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
                            $this->logDebug(
                                "SAVE_OUTPUT_TOPOLOGY mode='empty-scope-insert' pageId={$pageId} mdName='{$mdName}' scope='{$mdScope}' section='" . (string)$mdSection . "' subsection='" . (string)$mdSubsection . "' fieldId='" . (string)$fieldId . "' lang='{$languageCode}' document=" . $summarizeListTopology((string)$insertedMarkdown)
                            );
                            $this->logInfo(
                                "BYTE_PROBE stage=pre-write mode='empty-scope-insert' pageId={$pageId} lang='{$languageCode}' " . $this->markdownByteProbe((string)$insertedMarkdown)
                            );
                            $this->logInfo(
                                "BYTE_PROBE stage=persistence-call mode='empty-scope-insert' pageId={$pageId} lang='{$languageCode}' callee='saveRawMarkdownDocumentExact'"
                            );
                            $this->saveRawMarkdownDocumentExact($page, $languageCode, (string)$insertedMarkdown);
                            $postWriteMarkdown = $this->loadRawMarkdownDocument($page, $languageCode);
                            $this->logInfo(
                                "BYTE_PROBE stage=post-write mode='empty-scope-insert' pageId={$pageId} lang='{$languageCode}' " . $this->markdownByteProbe($postWriteMarkdown)
                            );
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
                    (string)$oldFieldMarkdown,
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
                $this->logDebug(
                    "SAVE_OUTPUT_TOPOLOGY mode='single' pageId={$pageId} mdName='{$mdName}' scope='{$mdScope}' section='" . (string)$mdSection . "' subsection='" . (string)$mdSubsection . "' fieldId='" . (string)$fieldId . "' lang='{$languageCode}' document=" . $summarizeListTopology((string)$updatedMarkdown)
                );

                $this->logInfo(
                    "BYTE_PROBE stage=pre-write mode='single' pageId={$pageId} lang='{$languageCode}' mdScope='{$mdScope}' mdSection='" . (string)$mdSection . "' mdSubsection='" . (string)$mdSubsection . "' mdName='{$mdName}' fieldId='" . (string)$fieldId . "' " . $this->markdownByteProbe((string)$updatedMarkdown)
                );
                $this->logInfo(
                    "BYTE_PROBE stage=persistence-call mode='single' pageId={$pageId} lang='{$languageCode}' mdScope='{$mdScope}' mdSection='" . (string)$mdSection . "' mdSubsection='" . (string)$mdSubsection . "' mdName='{$mdName}' fieldId='" . (string)$fieldId . "' callee='saveRawMarkdownDocumentExact'"
                );

                // Persist exact bytes to prevent backend normalization/truncation drift on readback.
                $this->saveRawMarkdownDocumentExact($page, $languageCode, (string)$updatedMarkdown);
                $postWriteMarkdown = $this->loadRawMarkdownDocument($page, $languageCode);
                $this->logInfo(
                    "BYTE_PROBE stage=post-write mode='single' pageId={$pageId} lang='{$languageCode}' mdScope='{$mdScope}' mdSection='" . (string)$mdSection . "' mdSubsection='" . (string)$mdSubsection . "' mdName='{$mdName}' fieldId='" . (string)$fieldId . "' " . $this->markdownByteProbe($postWriteMarkdown)
                );
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
        $allHtml = $this->sortCanonicalHtmlMapByKeyOrder($allHtml);

        $expandedChanged = $this->expandChangedHtmlKeys(
            array_values(array_unique($changedKeys ?? [])),
            $allHtml
        );
        $documentMarkdown = '';
        try {
            $documentMarkdown = $this->loadRawMarkdownDocument($page, $languageCode);
            $this->logInfo(
                "BYTE_PROBE stage=readback-fetch mode='response' pageId={$pageId} lang='{$languageCode}' mdScope='{$mdScope}' mdSection='" . (string)$mdSection . "' mdSubsection='" . (string)$mdSubsection . "' mdName='{$mdName}' fieldId='" . (string)$fieldId . "' " . $this->markdownByteProbe((string)$documentMarkdown)
            );
        } catch (\Throwable $e) {
            $documentMarkdown = (string)($mdScope === 'document' ? $blockMarkdown : $fullMarkdown);
        }

        header('Content-Type: application/json');
        echo json_encode([
            'status' => 1, 
            'html' => $canonicalHtml, // For fallback
            'htmlMap' => $allHtml,    // Primary source for syncing
            'fragments' => $allHtml,
            'changed' => $expandedChanged,
            'sectionsIndex' => $this->buildSectionsIndex($page),
            'fieldsIndex' => $this->buildFieldsIndex($page),
            'documentMarkdownB64' => base64_encode($documentMarkdown),
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

    protected function saveRawMarkdownDocumentExact(\ProcessWire\Page $page, string $languageCode, string $markdown): void {
        $path = \ProcessWire\MarkdownFileIO::getMarkdownFilePath($page, $languageCode);
        $bytes = @file_put_contents($path, $markdown, LOCK_EX);
        if ($bytes === false) {
            throw new \ProcessWire\WireException("Failed to write markdown file: {$path}");
        }
        if ((int)$bytes !== strlen($markdown)) {
            throw new \ProcessWire\WireException("Incomplete markdown write: {$path}");
        }

        $persisted = @file_get_contents($path);
        if ($persisted === false) {
            throw new \ProcessWire\WireException("Failed to verify markdown file after write: {$path}");
        }
        if ((string)$persisted !== $markdown) {
            throw new \ProcessWire\WireException("Persisted markdown differs from requested markdown after exact write");
        }
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

    protected function replaceFirstScopedHtmlMatch(
        string $html,
        string $needle,
        string $replacement,
        string $scopeKey
    ): string {
        if ($needle === '') return $html;

        $range = $this->findDataMfeHostRange($html, $scopeKey);
        if ($range) {
            $replaced = $this->replaceFirstMatchInRange(
                $html,
                $needle,
                $replacement,
                $range['start'],
                $range['end']
            );
            if ($replaced !== null) return $replaced;
        }

        $count = substr_count($html, $needle);
        if ($count === 1) {
            $pos = strpos($html, $needle);
            if ($pos !== false) {
                return substr_replace($html, $replacement, $pos, strlen($needle));
            }
        } elseif ($count > 1) {
            $this->logDebug("WRAP_AMBIGUOUS reason=multiple_matches scope='{$scopeKey}' count={$count}");
        }

        return $html;
    }

    protected function replaceFirstMatchInRange(
        string $html,
        string $needle,
        string $replacement,
        int $start,
        int $end
    ): ?string {
        if ($end <= $start) return null;
        $segment = substr($html, $start, $end - $start);
        $count = substr_count($segment, $needle);
        if ($count !== 1) {
            if ($count > 1) {
                $this->logDebug("WRAP_AMBIGUOUS reason=multiple_matches_in_scope count={$count}");
            }
            return null;
        }
        $pos = strpos($segment, $needle);
        if ($pos === false) return null;
        $absolute = $start + $pos;
        return substr_replace($html, $replacement, $absolute, strlen($needle));
    }

    protected function findDataMfeHostRange(string $html, string $dataMfeValue): ?array {
        $value = trim($dataMfeValue);
        if ($value === '') return null;
        $pattern = '/<([a-z0-9]+)\b[^>]*\bdata-mfe="' . preg_quote($value, '/') . '"[^>]*>/i';
        if (!preg_match($pattern, $html, $match, PREG_OFFSET_CAPTURE)) {
            return null;
        }
        $tag = strtolower((string)$match[1][0]);
        $start = (int)$match[0][1];
        $openEnd = $start + strlen((string)$match[0][0]);
        $closeStart = $this->findMatchingClosingTag($html, $openEnd, $tag);
        if ($closeStart === null) return null;
        return ['start' => $openEnd, 'end' => $closeStart];
    }

    protected function findMatchingClosingTag(string $html, int $offset, string $tag): ?int {
        $pattern = '/<\s*\/?\s*' . preg_quote($tag, '/') . '\b[^>]*>/i';
        $depth = 1;
        $pos = $offset;
        while (preg_match($pattern, $html, $match, PREG_OFFSET_CAPTURE, $pos)) {
            $token = (string)$match[0][0];
            $tokenPos = (int)$match[0][1];
            $pos = $tokenPos + strlen($token);
            $isClosing = preg_match('/^<\s*\//', $token) === 1;
            $isSelfClosing = preg_match('/\/\s*>$/', $token) === 1;
            if ($isClosing) {
                $depth -= 1;
                if ($depth === 0) return $tokenPos;
                continue;
            }
            if (!$isSelfClosing) {
                $depth += 1;
            }
        }
        return null;
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
        if ($scope === 'document') {
            if (isset($content->markdown)) {
                return (string)$content->markdown;
            }
            return null;
        }
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
        if ($scope === 'document') {
            if (isset($content->html)) {
                return (string)$content->html;
            }
            return null;
        }
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
            $resolvedLang = $this->resolveLanguagePageByRequestCode($page, $langCode);
            if ($resolvedLang) {
                return $this->resolveLanguageStorageCode($resolvedLang);
            }
            return $langCode;
        }
        return (string)\ProcessWire\MarkdownLanguageResolver::getLanguageCode($page);
    }

    protected function resolveLanguageStorageCode(\ProcessWire\Language $lang): string {
        $code = '';
        if (method_exists($lang, 'get')) {
            $code = trim((string)$lang->get('code'));
        }
        if ($code !== '') {
            return $code;
        }
        return (string)$lang->name;
    }

    protected function resolveLanguagePageByRequestCode(?\ProcessWire\Page $page, string $langCode): ?\ProcessWire\Language {
        if ($langCode === '') {
            return null;
        }

        $languages = $this->wire()->languages;
        if (!$languages) {
            return null;
        }

        $direct = $languages->get($langCode);
        if ($direct && (int)$direct->id > 0) {
            return $direct;
        }

        foreach ($languages as $lang) {
            if ($this->resolveLanguageStorageCode($lang) === $langCode) {
                return $lang;
            }
        }
        return null;
    }

    protected function replaceUniqueMarkdownBlock(
        string $document,
        string $replacement,
        string $scope,
        string $name,
        string $sectionName = '',
        string $subsectionName = '',
        ?string $expectedCurrentMarkdown = null,
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
            $subsectionNorm,
            $expectedCurrentMarkdown
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
        $updated = substr($document, 0, $start) . $replacement . $after;
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
        string $subsectionName,
        ?string $expectedCurrentMarkdown = null
    ): array {
        $docLen = strlen($document);

        if ($scope === 'section') {
            // Section scope payload is the full section markdown (including subsection blocks).
            // Replace the whole section block range to avoid duplicating subsection markers.
            return $this->resolveSectionBlockRange($document, $name);
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

        if ($expectedCurrentMarkdown !== null && $expectedCurrentMarkdown !== '') {
            $anchored = $this->resolveAnchoredFieldRangeByExpectedMarkdown(
                $document,
                $start,
                $end,
                $expectedCurrentMarkdown
            );
            if (($anchored['status'] ?? '') !== 'ok') {
                return $anchored;
            }
            $start = (int)$anchored['start'];
            $end = (int)$anchored['end'];
        }

        return ['status' => 'ok', 'start' => $start, 'end' => $end];
    }

    protected function resolveAnchoredFieldRangeByExpectedMarkdown(
        string $document,
        int $start,
        int $end,
        string $expectedMarkdown
    ): array {
        if ($end <= $start) {
            return ['status' => 'missing', 'reason' => 'field_expected_invalid_parent_range'];
        }

        $scanStart = $start;
        while ($scanStart < $end) {
            $ch = $document[$scanStart] ?? '';
            if ($ch === " " || $ch === "\t" || $ch === "\r" || $ch === "\n") {
                $scanStart += 1;
                continue;
            }
            break;
        }

        $normalizedExpected = str_replace(["\r\n", "\r"], "\n", $expectedMarkdown);
        $window = substr($document, $scanStart, max(0, $end - $scanStart));
        $windowNl = $this->detectMarkdownLineEnding($window);

        $variants = [$expectedMarkdown, $normalizedExpected];
        if ($windowNl !== "\n") {
            $variants[] = str_replace("\n", $windowNl, $normalizedExpected);
        }
        $variants = array_values(array_unique(array_filter($variants, static function ($v) {
            return is_string($v) && $v !== '';
        })));

        $matches = [];
        foreach ($variants as $variant) {
            $len = strlen($variant);
            if ($len === 0) continue;
            if ($scanStart + $len > $end) continue;
            if (substr($document, $scanStart, $len) === $variant) {
                $matches[] = ['start' => $scanStart, 'end' => $scanStart + $len, 'len' => $len];
            }
        }

        if (count($matches) === 1) {
            return ['status' => 'ok', 'start' => $matches[0]['start'], 'end' => $matches[0]['end']];
        }
        if (count($matches) > 1) {
            return ['status' => 'ambiguous', 'reason' => 'field_expected_anchored_ambiguous', 'markers' => count($matches)];
        }

        return ['status' => 'missing', 'reason' => 'field_expected_not_anchored'];
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

    protected function detectMarkdownLineEnding(string $markdown): string {
        if (strpos($markdown, "\r\n") !== false) return "\r\n";
        if (strpos($markdown, "\r") !== false) return "\r";
        return "\n";
    }

    protected function splitLeadingFrontmatter(string $markdown): array {
        $match = [];
        if (preg_match('/^(?:\xEF\xBB\xBF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/', $markdown, $match) === 1) {
            $frontmatter = (string)$match[0];
            $body = substr($markdown, strlen($frontmatter));
            return [$frontmatter, $body === false ? '' : $body];
        }
        return ['', $markdown];
    }

    protected function renderPageHtmlForLang(\ProcessWire\Page $page, string $languageCode, string $renderPath = ''): string {
        $user = $this->wire()->user;
        $languages = $this->wire()->languages;
        $isMultilingual = $languages && $languages->count() > 0;
        $prevLang = null;
        $httpHtml = '';
        $fetchHttpHtml = function() use ($page, $languageCode, $languages, $renderPath): string {
            try {
                $config = $this->wire()->config;
                $requestUrl = '';
                $source = 'none';
                $host = (string)($config->httpHost ?: ($_SERVER['HTTP_HOST'] ?? ''));
                $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
                $requestedPath = trim($renderPath);
                if ($requestedPath !== '') {
                    if (strpos($requestedPath, '://') !== false || strpos($requestedPath, '/') !== 0) {
                        $requestedPath = '';
                    }
                }

                // Deterministic pipeline:
                // 1) exact current frontend path (renderPath)
                // 2) ProcessWire language path via pages->getPath(language)
                // 3) page->httpUrl fallback
                if ($requestedPath !== '' && $host !== '') {
                    $requestUrl = "{$scheme}://{$host}{$requestedPath}";
                    $source = 'request.renderPath';
                }

                if ($requestUrl === '' && $languages && $host !== '') {
                    $nextLang = $this->resolveLanguagePageByRequestCode($page, $languageCode);
                    if ($nextLang) {
                        $pagePath = (string)$this->wire()->pages->getPath((int)$page->id, ['language' => $nextLang]);
                        if ($pagePath !== '') {
                            $requestUrl = "{$scheme}://{$host}{$pagePath}";
                            $source = 'pages.getPath(language)';
                        }
                    }
                }

                if ($requestUrl === '' && isset($page->httpUrl)) {
                    if ($languages && $languages->count() > 0) {
                        return '';
                    }
                    $requestUrl = (string)$page->httpUrl;
                    if ($requestUrl !== '') {
                        $source = 'page.httpUrl';
                    }
                }

                if ($requestUrl === '') {
                    return '';
                }

                $http = new \ProcessWire\WireHttp();
                $http->setTimeout(10.0);
                $http->set('header', 'Accept: text/html');
                $http->set('header', 'Accept-Language: ' . (string)$languageCode);
                if (!empty($_SERVER['HTTP_COOKIE'])) {
                    $http->set('header', 'Cookie: ' . (string)$_SERVER['HTTP_COOKIE']);
                }

                $body = (string)$http->get($requestUrl);
                $status = (int)$http->getHttpCode();
                $this->logInfo(sprintf(
                    "FRAGMENTS_HTTP_RENDER pageId=%d lang='%s' source='%s' status=%d url='%s' len=%d",
                    (int)$page->id,
                    $languageCode,
                    $source,
                    $status,
                    $requestUrl,
                    strlen($body)
                ));
                if ($status >= 200 && $status < 300 && trim($body) !== '') {
                    return $body;
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
            return '';
        };
        $savedGet = [
            'markdownFrontEditorFragments' => $_GET['markdownFrontEditorFragments'] ?? null,
            'markdownFrontEditorSave' => $_GET['markdownFrontEditorSave'] ?? null,
            'markdownFrontEditorListImages' => $_GET['markdownFrontEditorListImages'] ?? null,
        ];
        if ($languages && $user && isset($user->language)) {
            $prevLang = $user->language;
            $nextLang = $this->resolveLanguagePageByRequestCode($page, $languageCode);
            if ($nextLang) {
                $user->language = $nextLang;
            }
        }

        // Deterministic route-first rendering: for multilingual pages, prefer HTTP render first.
        if ($isMultilingual) {
            $httpHtml = $fetchHttpHtml();
        }

        if ($httpHtml !== '') {
            if ($prevLang && $user) {
                $user->language = $prevLang;
            }
            return $httpHtml;
        }

        if ($isMultilingual) {
            if ($prevLang && $user) {
                $user->language = $prevLang;
            }
            return '';
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

        // Fallback for single-language or failed in-process render.
        if (!$isMultilingual) {
            $fallbackHtml = $fetchHttpHtml();
            if ($fallbackHtml !== '') {
                return $fallbackHtml;
            }
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
            $recomputed = $this->resolveRenderedMountKeyWithContext($raw, $node, $lookup);
            if ($this->isCanonicalScopedKey($stampedKey) && $recomputed !== $stampedKey) {
                if ($recomputed === '') {
                    $this->logInfo(sprintf(
                        "FRAGMENTS_STAMP_ERROR reason=non_recomputable key='%s' attr='data-mfe' value='%s'",
                        $stampedKey,
                        str_replace(["\n", "\r"], ' ', trim($raw))
                    ));
                } else {
                    $this->logInfo(sprintf(
                        "FRAGMENTS_STAMP_WARN reason=mismatch key='%s' recomputed='%s' attr='data-mfe' value='%s'",
                        $stampedKey,
                        $recomputed,
                        str_replace(["\n", "\r"], ' ', trim($raw))
                    ));
                }
            }
            $key = $recomputed;
            if ($key !== '' && !isset($nodeByKey[$key])) {
                $nodeByKey[$key] = $node;
            }
            if ($key !== '' && $this->isCanonicalScopedKey($key)) {
                $graphKeys[$key] = true;
            }
        }

        foreach ($xpath->query('//*[@data-mfe-source]') as $node) {
            if (!$node instanceof \DOMElement) continue;
            $classAttr = ' ' . preg_replace('/\s+/', ' ', trim((string)$node->getAttribute('class'))) . ' ';
            if (strpos($classAttr, ' fe-editable ') !== false) continue;
            $raw = (string)$node->getAttribute('data-mfe-source');
            $stampedKey = trim((string)$node->getAttribute('data-mfe-key'));
            $recomputed = $this->resolveRenderedMountKeyWithContext($raw, $node, $lookup);
            if ($this->isCanonicalScopedKey($stampedKey) && $recomputed !== $stampedKey) {
                if ($recomputed === '') {
                    $this->logInfo(sprintf(
                        "FRAGMENTS_STAMP_ERROR reason=non_recomputable key='%s' attr='data-mfe-source' value='%s'",
                        $stampedKey,
                        str_replace(["\n", "\r"], ' ', trim($raw))
                    ));
                } else {
                    $this->logInfo(sprintf(
                        "FRAGMENTS_STAMP_WARN reason=mismatch key='%s' recomputed='%s' attr='data-mfe-source' value='%s'",
                        $stampedKey,
                        $recomputed,
                        str_replace(["\n", "\r"], ' ', trim($raw))
                    ));
                }
            }
            $key = $recomputed;
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
                (string)($node->getAttribute('data-mfe-scope') ?: 'field'),
                (string)$node->getAttribute('data-mfe-name'),
                (string)$node->getAttribute('data-mfe-section'),
                (string)$node->getAttribute('data-mfe-subsection')
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
            'graphKeys' => $normalized,
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
        return $this->sortCanonicalHtmlMapByKeyOrder($htmlMap);
    }

    protected function sortCanonicalHtmlMapByKeyOrder(array $map): array {
        if (!$map) return $map;

        uksort($map, function ($leftKey, $rightKey) {
            $left = $this->canonicalScopedKeySortTuple((string)$leftKey);
            $right = $this->canonicalScopedKeySortTuple((string)$rightKey);
            $count = min(count($left), count($right));
            for ($i = 0; $i < $count; $i++) {
                if ($left[$i] === $right[$i]) continue;
                return ($left[$i] < $right[$i]) ? -1 : 1;
            }
            return strcmp((string)$leftKey, (string)$rightKey);
        });

        return $map;
    }

    protected function canonicalScopedKeySortTuple(string $key): array {
        $value = trim($key);
        if ($value === '') return [9, '', '', '', ''];

        $parts = explode(':', $value);
        $scope = strtolower((string)($parts[0] ?? ''));

        if ($scope === 'section' && count($parts) === 2) {
            return [1, (string)$parts[1], '', '', $value];
        }
        if ($scope === 'subsection' && count($parts) === 3) {
            return [2, (string)$parts[1], (string)$parts[2], '', $value];
        }
        if ($scope === 'field' && count($parts) === 3) {
            return [3, (string)$parts[1], '', (string)$parts[2], $value];
        }
        if ($scope === 'subsection' && count($parts) === 4) {
            return [3, (string)$parts[1], (string)$parts[2], (string)$parts[3], $value];
        }
        if ($scope === 'field' && count($parts) === 2) {
            return [3, '', '', (string)$parts[1], $value];
        }

        // Unknown keys still sort deterministically so response order never drifts.
        return [9, '', '', '', $value];
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

    // ─────────────────────────────────────────────────────────────────────────
    // Thumbnail system (mfe-only)
    // ─────────────────────────────────────────────────────────────────────────

    protected function getMarkdownToFieldsSetting(string $key) {
        $cfg = $this->wire()->config->MarkdownToFields ?? [];
        if (is_array($cfg) && array_key_exists($key, $cfg)) {
            return $cfg[$key];
        }

        $mdModule = $this->wire()->modules->get('MarkdownToFields');
        if ($mdModule && isset($mdModule->{$key})) {
            return $mdModule->{$key};
        }

        return null;
    }

    protected function getConfiguredImageSourcePaths(): array {
        $paths = $this->getMarkdownToFieldsSetting('imageSourcePaths');
        $imageSourcePaths = [];

        if (is_string($paths)) {
            $imageSourcePaths = array_filter(array_map('trim', explode(',', $paths)));
        } elseif (is_array($paths)) {
            $imageSourcePaths = $paths;
        }

        if (empty($imageSourcePaths)) {
            throw new \RuntimeException('MarkdownToFields.imageSourcePaths is required for image picker operations.');
        }

        return array_values(array_filter(array_map(static fn($p) => rtrim((string)$p, '/') . '/', $imageSourcePaths)));
    }

    protected function resolveThumbSourcePath(string $imagePath = ''): string {
        $sources = $this->getConfiguredImageSourcePaths();
        if (empty($sources)) {
            throw new \RuntimeException('No image source paths configured.');
        }
        if ($imagePath !== '') {
            $normalizedImagePath = str_replace('\\', '/', $imagePath);
            foreach ($sources as $source) {
                if (str_starts_with($normalizedImagePath, $source)) {
                    return $source;
                }
            }
            throw new \RuntimeException('Image path is outside configured imageSourcePaths.');
        }
        return $sources[0];
    }

    protected function sourcePathToPublicBaseUrl(string $sourcePath): string {
        $cfg = $this->wire()->config;
        $sitePath = rtrim((string)$cfg->paths->site, '/') . '/';
        $siteUrl = rtrim((string)$cfg->urls->site, '/') . '/';
        $rootPath = rtrim((string)$cfg->paths->root, '/') . '/';

        $fullPathNorm = rtrim((string)$sourcePath, '/') . '/';

        if (str_starts_with($fullPathNorm, $sitePath)) {
            $relativePath = ltrim(substr($fullPathNorm, strlen($sitePath)), '/');
            return $siteUrl . rtrim($relativePath, '/') . '/';
        }
        if (str_starts_with($fullPathNorm, $rootPath)) {
            $relativePath = ltrim(substr($fullPathNorm, strlen($rootPath)), '/');
            return '/' . trim($relativePath, '/') . '/';
        }
        throw new \RuntimeException('Configured image source path is outside ProcessWire site/root paths: ' . $fullPathNorm);
    }

    protected function ensureThumbDir(string $imagePath = ''): string {
        $cachePath = rtrim((string)$this->wire()->config->paths->cache, '/') . '/';
        $thumbDir = $cachePath . 'MFE/thumbs/';
        if (!is_dir($thumbDir)) {
            if (!mkdir($thumbDir, 0755, true)) {
                throw new \RuntimeException("Failed to create thumb directory: {$thumbDir}");
            }
        }
        // Ensure directory is readable/writable
        @chmod($thumbDir, 0755);
        return $thumbDir;
    }

    protected function hashFile(string $path): string {
        if (!is_file($path) || !is_readable($path)) {
            throw new \RuntimeException("Cannot read file for hashing: {$path}");
        }
        return hash_file('sha256', $path);
    }

    protected function buildProcessWireThumbVariation(int $pageId, string $sourceImagePath, int $maxDim, string $relativePath = ''): string {
        $resolvedPath = $this->resolveSourceImageAbsolutePath($sourceImagePath);
        $thumbDir = $this->ensureThumbDir($resolvedPath);
        $tempPath = $thumbDir . 'tmp-' . sha1($resolvedPath . microtime(true)) . '.jpg';

        $resource = $this->loadImageResourceForThumb($resolvedPath, $relativePath);
        if (!$resource) {
            throw new \RuntimeException('Failed to load source image for thumbnail generation.');
        }

        if (!@imagejpeg($resource, $tempPath, 90)) {
            @imagedestroy($resource);
            throw new \RuntimeException('Failed to create temporary thumbnail source image.');
        }
        @imagedestroy($resource);

        $sizer = $this->wire(new \ProcessWire\ImageSizer($tempPath, [
            'upscaling' => false,
        ]));
        $ok = $sizer->resize($maxDim, 0);
        if (!$ok || !is_file($tempPath)) {
            @unlink($tempPath);
            throw new \RuntimeException('ProcessWire ImageSizer failed to generate thumbnail variation.');
        }

        return $tempPath;
    }

    protected function resolveSourceImageAbsolutePath(string $sourceImagePath): string {
        $candidate = str_replace('\\', '/', trim($sourceImagePath));
        if ($candidate !== '' && str_starts_with($candidate, '/') && is_file($candidate) && is_readable($candidate)) {
            return $candidate;
        }

        foreach ($this->getConfiguredImageSourcePaths() as $sourceBase) {
            $full = rtrim($sourceBase, '/') . '/' . ltrim($candidate, '/');
            if (is_file($full) && is_readable($full)) {
                return str_replace('\\', '/', $full);
            }
        }

        throw new \RuntimeException('Failed to resolve source image path for thumbnail generation.');
    }

    protected function loadImageResourceForThumb(string $path, string $relativePath = '') {
        $ext = strtolower((string)pathinfo($path, PATHINFO_EXTENSION));
        $resource = null;
        if ($ext === 'jpg' || $ext === 'jpeg') {
            $resource = @imagecreatefromjpeg($path);
        } elseif ($ext === 'png') {
            $resource = @imagecreatefrompng($path);
        } elseif ($ext === 'gif') {
            $resource = @imagecreatefromgif($path);
        } elseif ($ext === 'webp') {
            $resource = @imagecreatefromwebp($path);
        }
        
        if (!$resource) {
            return null;
        }
        
        // Apply EXIF rotation for JPEG/TIFF images (uses cache if available)
        $canHaveOrientation = in_array($ext, ['jpg', 'jpeg', 'tif', 'tiff'], true);
        if ($canHaveOrientation && function_exists('exif_read_data')) {
            $resource = $this->applyExifRotationToResource($resource, $path, $relativePath);
        }
        
        return $resource;
    }

    protected function applyExifRotationToResource($resource, string $path, string $relativePath = '') {
        // Try to get cached orientation first (set during picker load)
        $orientation = null;
        if ($relativePath !== '') {
            $orientation = $this->getCachedExifOrientation($relativePath);
        }
        
        // If not cached, read from file
        if ($orientation === null) {
            $exif = @exif_read_data($path);
            if (!$exif || !isset($exif['Orientation'])) {
                return $resource;
            }
            $orientation = (int)$exif['Orientation'];
        }
        
        $angle = 0;
        
        switch ($orientation) {
            case 3: $angle = 180; break;
            case 6: $angle = 270; break;
            case 8: $angle = 90; break;
            case 2:
            case 4:
            case 5:
            case 7:
                // Flipping not supported by basic imagerotate, skip
                return $resource;
            default: return $resource;
        }
        
        if ($angle === 0) {
            return $resource;
        }
        
        $rotated = @imagerotate($resource, $angle, 0);
        if ($rotated) {
            @imagedestroy($resource);
            return $rotated;
        }
        
        return $resource;
    }

    protected function cacheImageExifOrientation(string $relativePath, string $fullPath): void {
        $cache = (array)($this->exifOrientationCache ?? []);

        $exif = @exif_read_data($fullPath);
        if ($exif && isset($exif['Orientation'])) {
            $cache[$relativePath] = (int)$exif['Orientation'];
            $this->exifOrientationCache = $cache;
        }
    }

    protected function getCachedExifOrientation(string $relativePath): ?int {
        $cache = (array)($this->exifOrientationCache ?? []);
        return isset($cache[$relativePath]) ? (int)$cache[$relativePath] : null;
    }

    protected function thumbPath(string $basename, string $hash, string $imagePath = ''): string {
        $thumbDir = $this->ensureThumbDir($imagePath);
        $name = pathinfo($basename, PATHINFO_FILENAME);
        return $thumbDir . $name . '.' . $hash . '.jpg';
    }

    protected function getImageDisplayDimensions(string $fullFilename): ?array {
        $imgDims = @getimagesize($fullFilename);
        if (!$imgDims || !is_array($imgDims) || count($imgDims) < 2) {
            return null;
        }

        $width = (int)$imgDims[0];
        $height = (int)$imgDims[1];

        $ext = strtolower((string)pathinfo($fullFilename, PATHINFO_EXTENSION));
        $canHaveOrientation = in_array($ext, ['jpg', 'jpeg', 'tif', 'tiff'], true);
        if ($canHaveOrientation && function_exists('exif_read_data')) {
            $exif = @exif_read_data($fullFilename);
            $orientation = (int)($exif['Orientation'] ?? 1);
            if (in_array($orientation, [5, 6, 7, 8], true)) {
                $tmp = $width;
                $width = $height;
                $height = $tmp;
            }
        }

        return [
            'width' => $width,
            'height' => $height,
        ];
    }

    protected function thumbUrl(string $basename, string $hash): string {
        $name = pathinfo($basename, PATHINFO_FILENAME);
        $thumbName = $name . '.' . $hash . '.jpg';
        // Serve thumbnail through PHP endpoint to bypass .htaccess restrictions
        return '?markdownFrontEditorSave=1&action=deliverThumb&thumb=' . urlencode($thumbName);
    }

    protected function resolveConfiguredImageBaseUrl(\ProcessWire\Page $page): string {
        $raw = trim((string)($this->getMarkdownToFieldsSetting('imageBaseUrl') ?? ''));

        if ($raw === '') {
            throw new \RuntimeException('MarkdownToFields.imageBaseUrl is required for frontend editor image operations.');
        }

        if (strpos($raw, '{pageId}') !== false) {
            $raw = str_replace('{pageId}', (string)((int)$page->id), $raw);
        }

        return str_ends_with($raw, '/') ? $raw : ($raw . '/');
    }

    protected function resolvePageFilesBaseUrl(\ProcessWire\Page $page): string {
        return rtrim((string)$this->wire()->config->urls->files, '/') . '/' . (int)$page->id . '/';
    }

    protected function clearThumbCache(): int {
        $thumbDir = $this->ensureThumbDir();
        if (!is_dir($thumbDir)) {
            return 0;
        }
        $iterator = new \FilesystemIterator($thumbDir, \FilesystemIterator::SKIP_DOTS);
        $deleted = 0;
        foreach ($iterator as $file) {
            if ($file->isFile()) {
                if (@unlink($file->getPathname())) {
                    $deleted++;
                }
            }
        }
        return $deleted;
    }

    protected function thumbIndexPath(): string {
        $thumbDir = $this->ensureThumbDir();
        return $thumbDir . 'index.json';
    }

    protected function loadThumbIndex(): array {
        $indexPath = $this->thumbIndexPath();
        if (!is_file($indexPath)) {
            return [];
        }
        $data = json_decode(file_get_contents($indexPath), true);
        return is_array($data) ? $data : [];
    }

    protected function saveHashToIndex(string $filename, string $hash): void {
        $index = $this->loadThumbIndex();
        $index[$filename] = $hash;
        $indexPath = $this->thumbIndexPath();
        file_put_contents($indexPath, json_encode($index, JSON_PRETTY_PRINT));
    }

}
