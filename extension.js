const vscode = require('vscode');

const BATCH_DELAY_MS = 100;

/**
 * Largest file read for the `emptyFiles.whitespaceOnly` check. A file over
 * it is not read: one that large holding only whitespace is rare, and
 * reading every big file on each Explorer refresh is not.
 */
const WHITESPACE_SCAN_MAX_BYTES = 64 * 1024;

/**
 * Decodes file bytes for the whitespace check: UTF-16 when a byte order
 * mark says so, UTF-8 otherwise. Bytes that are not valid UTF-8 decode to
 * U+FFFD, which is no whitespace, so such a file never counts.
 */
function decodeText(bytes) {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		return new TextDecoder('utf-16le').decode(bytes);
	}
	if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		return new TextDecoder('utf-16be').decode(bytes);
	}
	return new TextDecoder('utf-8').decode(bytes);
}

/**
 * `\s` covers spaces, tabs, line breaks (LF, CR), form and vertical feeds,
 * no-break and other Unicode spaces, and the byte order mark (U+FEFF).
 */
function isWhitespaceOnly(text) {
	return /^\s*$/u.test(text);
}

class EmptyFileDecorationProvider {
	constructor() {
		this._onDidChangeFileDecorations = new vscode.EventEmitter();
		this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
		this._pending = new Map();
		this._timer = undefined;
	}

	/**
	 * Collects a changed URI and reports the whole batch once events pause
	 * for BATCH_DELAY_MS, so a checkout or a formatter run touching hundreds
	 * of files causes one refresh, not hundreds.
	 */
	schedule(uri) {
		this._pending.set(uri.toString(), uri);
		clearTimeout(this._timer);
		this._timer = setTimeout(() => {
			const uris = [...this._pending.values()];
			this._pending.clear();
			this._timer = undefined;
			this.refresh(uris);
		}, BATCH_DELAY_MS);
	}

	dispose() {
		clearTimeout(this._timer);
		this._pending.clear();
		this._onDidChangeFileDecorations.dispose();
	}

	/**
	 * Asks VS Code to query decorations again: for the given URI(s), or for
	 * every file when called without an argument.
	 */
	refresh(uris) {
		this._onDidChangeFileDecorations.fire(uris);
	}

	/**
	 * The badge's tooltip when the file counts as empty, else undefined: a
	 * 0-byte file always counts; one holding only whitespace counts when
	 * `emptyFiles.whitespaceOnly` is on and it is small enough to read.
	 */
	async emptinessTooltip(uri, size, config) {
		if (size === 0) return 'This file is completely empty (0 Bytes).';

		// Only a real `true` turns the option on: a mistyped string such as
		// "off" is truthy, but VS Code does not coerce it and only warns.
		if (config.get('whitespaceOnly', false) !== true) return undefined;
		if (size > WHITESPACE_SCAN_MAX_BYTES) return undefined;

		const text = decodeText(await vscode.workspace.fs.readFile(uri));
		if (!isWhitespaceOnly(text)) return undefined;

		const unit = size === 1 ? 'Byte' : 'Bytes';
		return `This file holds only whitespace (${size} ${unit}).`;
	}

	async provideFileDecoration(uri) {
		// Decorations are asked for every URI VS Code shows (Git diffs,
		// untitled editors, output channels…); stat only those with a file
		// system provider behind them.
		if (vscode.workspace.fs.isWritableFileSystem(uri.scheme) === undefined) {
			return undefined;
		}

		try {
			const stats = await vscode.workspace.fs.stat(uri);
			if ((stats.type & vscode.FileType.File) === 0) return undefined;

			const config = vscode.workspace.getConfiguration('emptyFiles');
			const tooltip = await this.emptinessTooltip(uri, stats.size, config);

			if (tooltip !== undefined) {
				// Взимаме директно избрания символ (∅, 0B, ◎, 🔹) от менюто
				const selectedBadge = config.get('badgeStyle', '∅');

				const decoration = new vscode.FileDecoration();
				decoration.propagate = false;
				decoration.badge = selectedBadge;
				decoration.tooltip = tooltip;
				// No colour: VS Code shows one colour per item, so ours would
				// either cover Git's (an untracked file's green) or be covered.

				return decoration;
			}

			return undefined;

		} catch (error) {
			// A file deleted between the event and this query is no error.
			if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
				return undefined;
			}
			console.error(`[Empty Files Highlighter Error] ${error.message}`);
			return undefined;
		}
	}
}

function activate(context) {
	const provider = new EmptyFileDecorationProvider();

	console.log('✅ [Empty File Highlighter] Extension is now active!');

	const registration = vscode.window.registerFileDecorationProvider(provider);
	context.subscriptions.push(registration, provider);

	setTimeout(() => {
		provider.refresh();
	}, 800);

	const settingsListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('emptyFiles')) {
			provider.refresh();
		}
	});
	context.subscriptions.push(settingsListener);

	// VS Code caches a decoration per URI until the provider reports a
	// change, so a file gaining or losing content must be reported here, or
	// its badge stays as first computed.
	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	const onFileEvent = uri => provider.schedule(uri);
	watcher.onDidCreate(onFileEvent);
	watcher.onDidChange(onFileEvent);
	watcher.onDidDelete(onFileEvent);
	context.subscriptions.push(watcher);
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
};
