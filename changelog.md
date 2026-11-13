# Change Log

All notable changes to the "emtpy-file-highlighter" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.4]

- New option `emptyFiles.whitespaceOnly` (off by default): also mark files holding only whitespace, such as a single empty line (files up to 64 KiB).
- Works in Restricted Mode: badges show before the workspace is trusted.
- Declares support for virtual workspaces (tested with GitHub Repositories).

## [0.0.3]

- Badges update live when files are created, changed or deleted (no reload needed).
- File events are batched into one refresh.
- File sizes are read asynchronously through VS Code's file system API; remote and virtual workspaces are supported.

## [Unreleased]

- Initial release