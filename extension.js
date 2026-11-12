const vscode = require('vscode');
const fs = require('node:fs');

const BATCH_DELAY_MS = 100;

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

	provideFileDecoration(uri) {
		if (uri.scheme !== 'file') return undefined;

		try {
			const filePath = uri.fsPath;
			if (!fs.existsSync(filePath)) return undefined;

			const stats = fs.statSync(filePath);
			if (stats.isDirectory()) return undefined;

			const isFileEmpty = stats.size === 0;

			if (isFileEmpty) {
				const config = vscode.workspace.getConfiguration('emptyFiles');
				// Взимаме директно избрания символ (∅, 0B, ◎, 🔹) от менюто
				const selectedBadge = config.get('badgeStyle', '∅');

				const decoration = new vscode.FileDecoration();
				decoration.propagate = false;
				decoration.badge = selectedBadge;
				decoration.tooltip = 'This file is completely empty (0 Bytes).';

				// Ползваме блед, интелигентен цвят, който стои добре с всички символи
				decoration.color = new vscode.ThemeColor('descriptionForeground');

				return decoration;
			}

			return undefined;

		} catch (error) {
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
