const vscode = require('vscode');
const { emptinessOf, whitespaceOnlyEnabled } = require('./emptiness');

const BATCH_DELAY_MS = 100;

/** The badge's tooltip for an empty file, by how it counts as empty. */
function fileTooltip(emptiness, size) {
	if (emptiness === 'empty') return 'This file is completely empty (0 Bytes).';
	const unit = size === 1 ? 'Byte' : 'Bytes';
	return `This file holds only whitespace (${size} ${unit}).`;
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

			const emptiness = await emptinessOf(uri, stats.size, whitespaceOnlyEnabled());

			if (emptiness !== undefined) {
				const config = vscode.workspace.getConfiguration('emptyFiles');
				// Взимаме директно избрания символ (∅, 0B, ◎, 🔹) от менюто
				const selectedBadge = config.get('badgeStyle', '∅');

				const decoration = new vscode.FileDecoration();
				decoration.propagate = false;
				decoration.badge = selectedBadge;
				decoration.tooltip = fileTooltip(emptiness, stats.size);
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
