# Changelog

All notable changes to Empty File Highlighter. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.4] - 2026-11-14

### Added

- Folder marks: a folder holding empty files, at any depth, shows `∋`, even while collapsed; the tooltip gives the count. Paths in `files.exclude` and `search.exclude` are skipped. Option `emptyFiles.folders` (on by default).
- Option `emptyFiles.whitespaceOnly` (off by default): also mark files holding only whitespace, such as a single empty line (files up to 64 KiB).
- Output → Empty File Highlighter: errors, and what each folder scan found and how long it took.
- Badges in Restricted Mode: they show before the workspace is trusted.

### Changed

- Badges no longer tint the file name grey. The tint could hide Git's colour on an empty file, as an item shows one colour only, and it looked like Git's dimming of ignored files.
- The settings sit right under the extension's heading in the Settings editor, titled with its name.
- Declares support for virtual workspaces (tested with GitHub Repositories).

## [0.0.3] - 2026-11-12

### Fixed

- Badges update live when files are created, changed or deleted; no reload needed.

### Changed

- File events are batched into one refresh.
- File sizes are read asynchronously through VS Code's file system API, so remote and virtual workspaces are supported.

## [0.0.2]

- The marketplace release by the original author, Teodor Daraktchiev, that these versions build on: a badge on 0-byte files, in one of five styles.

[0.0.4]: https://github.com/caaat1/vscode--empty-file-highlighter/pull/3
[0.0.3]: https://github.com/caaat1/vscode--empty-file-highlighter/pull/2
[0.0.2]: https://marketplace.visualstudio.com/items?itemName=TeodorDaraktchiev.empty-file-highlighter

<!-- Keep a Changelog repeats "Added", "Changed"… under each version. -->
<!-- markdownlint-configure-file { "MD024": { "siblings_only": true } } -->
