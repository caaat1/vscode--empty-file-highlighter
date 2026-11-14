# Empty File Highlighter 🚀

Easily identify empty files directly inside Visual Studio Code’s Explorer view — without opening them or using the terminal. Perfect for keeping large workspaces clean and spotting configuration files that were left blank by mistake!

## ⚡ Key Features
* **Instant Visual Indicator** — Places a clear status badge next to any file with a size of 0 Bytes.
* **Folder Marks** — A folder holding empty files, at any depth, shows `∋` ("contains"), even while collapsed; its tooltip gives the count.
* **Leaves Colours Alone** — Badges only: Git's colours (and any other extension's) stay as they are.
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

Folder marks (**Folders**, `emptyFiles.folders`, on by default) count what the Explorer shows and is worth searching: paths in `files.exclude` and `search.exclude` (such as `node_modules`) are skipped. The workspace is scanned once at startup and kept up to date as files change; on a very large workspace, turn the option off if the scan is slow.

## 📦 Requirements
* Visual Studio Code v1.80.0 or newer
* Works in untrusted (Restricted Mode), remote (WSL) and virtual (GitHub Repositories) workspaces

## 🐛 Known Issues
* A folder that also holds Git changes or problems (errors, warnings) below it shows VS Code's own faded dot, "Contains emphasized items", instead of `∋`: VS Code replaces every badge of such a folder with it. The empty files inside still show their own badge. Counting on you for the unknowns!