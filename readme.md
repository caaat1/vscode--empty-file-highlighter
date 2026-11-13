# Empty File Highlighter 🚀

Easily identify empty files directly inside Visual Studio Code’s Explorer view — without opening them or using the terminal. Perfect for keeping large workspaces clean and spotting configuration files that were left blank by mistake!

## ⚡ Key Features
* **Instant Visual Indicator** — Places a clear status badge next to any file with a size of 0 Bytes.
* **Native Integration** — Works seamlessly with your existing VS Code themes and file system.
* **Bypasses Git Overrides** — Designed to stay visible even when new or untracked files turn green from Git.

## ⚙️ How to Customize
You can choose your favorite icon style directly from the VS Code Settings interface:
1. Open Settings (`Ctrl + ,`)
2. Search for `empty file highlight`
3. Select your preferred icon from the dropdown:
   * `∅` (Empty set - default)
   * `0B` (Zero Bytes text)
   * `0b` (Zero Bytes lowercase text)
   * `◎` (Bullseye circle)
   * `🔹` (Blue diamond badge)

To also mark files that only *look* empty (a single empty line, spaces, tabs, a byte order mark), turn on **Whitespace Only** (`emptyFiles.whitespaceOnly`). Their tooltip says "holds only whitespace" and gives the size. Files over 64 KiB are not read for this check.

## 📦 Requirements
* Visual Studio Code v1.80.0 or newer
* Works in untrusted (Restricted Mode), remote (WSL) and virtual (GitHub Repositories) workspaces

## 🐛 Known Issues
* No known issues so far. Counting on you for the unknowns!