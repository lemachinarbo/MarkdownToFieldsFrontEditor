# Conductor Tracks

This file tracks the active development tracks for Jules and other agents in MarkdownToFieldsFrontEditor.

- [ ] **Performance: Cache snapshot index file reads** (Session: 12712479203828006873)
- [ ] **Performance: Optimize DOM query loop in collectReadOnlyHostMounts** (Session: 15552125936496673555)
- [ ] **Code Health: Remove leftover console statement** (Session: 8475759274777109420)
- [ ] **Testing Improvement: Missing tests for buildScopeKeyFromMeta** (Session: 15009249872801566978)
- [ ] **Testing Improvement: Missing test file for markdown-text-utils.js** (Session: 13446809845484129784)

## Completed

- [x] **Security Fix: Use of unsafe $_POST superglobal** (Integrated: 5958058741393063784)
  - [x] Replace $_POST usage with $this->wire()->input->post in MarkdownToFieldsFrontEditor.module.php

- [x] **Security Fix: Unauthenticated access to thumbnails endpoint** (Integrated: 11059085929516967132)
  - [x] Add user login and permission check to deliverThumb action in MarkdownToFieldsFrontEditor.module.php

- [x] **Security Fix: Use of unsafe $_SERVER HTTP_HOST** (Integrated: 1963317963683446311)
  - [x] Replace $_SERVER['HTTP_HOST'] and $_SERVER['HTTPS'] with $config->httpHost and $config->https in MarkdownToFieldsFrontEditor.module.php
