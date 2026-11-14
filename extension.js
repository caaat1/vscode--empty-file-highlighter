const vscode = require('vscode');
const { emptinessOf } = require('./emptiness');
const { EmptyFileIndex } = require('./folderIndex');
const { foldersEnabled, whitespaceOnlyEnabled } = require('./settings');

const BATCH_DELAY_MS = 100;

/**
 * The badge of a folder holding empty files: "contains", to pair with the
 * files' `∅`. Not `∅` itself, which on a folder would read "empty folder".
 */
const FOLDER_BADGE = '∋';

/** The badge's tooltip for an empty file, by how it counts as empty. */
function fileTooltip(emptiness, size) {
	if (emptiness === 'empty') return 'This file is completely empty (0 Bytes).';
	const unit = size === 1 ? 'Byte' : 'Bytes';
	return `This file holds only whitespace (${size} ${unit}).`;
}

function folderTooltip(count) {
	const kind = whitespaceOnlyEnabled() ? 'empty or whitespace-only' : 'empty';
	const noun = count === 1 ? 'file' : 'files';
	return `This folder holds ${count} ${kind} ${noun}.`;
}

/**
 * A badge without colour. An item shows one colour: the first among its
 * decorations, newest provider first (VS Code's DecorationsService). Git
 * registers a provider as it opens each repository, so a colour of ours
 * would win or lose by timing, and could hide Git's green or yellow on an
 * empty file. A grey would also read as Git's dimming of ignored files.
 */
function badge(text, tooltip) {
	const decoration = new vscode.FileDecoration(text, tooltip);
	decoration.propagate = false;
	return decoration;
}

class EmptyFileDecorationProvider {
	/** @param log The extension's Output channel (a `LogOutputChannel`). */
	constructor(log) {
		this._log = log;
		this._onDidChangeFileDecorations = new vscode.EventEmitter();
		this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
		/** URI string → { uri, created } of the events not yet reported. */
		this._pending = new Map();
		this._timer = undefined;
		this._index = new EmptyFileIndex();
	}

	/**
	 * Collects a changed URI and reports the whole batch once events pause
	 * for BATCH_DELAY_MS, so a checkout or a formatter run touching hundreds
	 * of files causes one refresh, not hundreds.
	 */
	schedule(uri, created) {
		const key = uri.toString();
		const earlier = this._pending.get(key);
		this._pending.set(key, { uri, created: created || (earlier?.created ?? false) });
		clearTimeout(this._timer);
		this._timer = setTimeout(() => {
			this._timer = undefined;
			this._flush().catch(error => this._log.error(error));
		}, BATCH_DELAY_MS);
	}

	async _flush() {
		const events = [...this._pending.values()];
		this._pending.clear();

		// Keyed by URI string: files in one folder name that folder once.
		const uris = new Map(events.map(event => [event.uri.toString(), event.uri]));
		if (foldersEnabled()) {
			const folders = await Promise.all(events.map(event =>
				this._index.update(event.uri, event.created).catch(error => {
					this._log.error(error);
					return [];
				})));
			for (const folder of folders.flat()) uris.set(folder.toString(), folder);
		}
		this.refresh([...uris.values()]);
	}

	/**
	 * Scans the workspace for the folder marks afresh, or drops them when
	 * `emptyFiles.folders` is off, then refreshes every decoration. Logs
	 * what a scan found and how long it took: the measure for turning the
	 * marks off on a workspace too large.
	 */
	async rebuildIndex() {
		if (foldersEnabled()) {
			const started = Date.now();
			const scan = await this._index.rebuild(whitespaceOnlyEnabled());
			if (scan !== undefined) {
				const noun = scan.empty === 1 ? 'file' : 'files';
				this._log.info(`Folder marks: ${scan.empty} empty ${noun} among ${scan.scanned} scanned, in ${Date.now() - started} ms.`);
			}
		} else {
			this._index.clear();
		}
		this.refresh();
	}

	dispose() {
		clearTimeout(this._timer);
		this._pending.clear();
		this._index.clear();
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

		// Only folders have a count, so no stat is needed to tell.
		const count = foldersEnabled() ? this._index.countUnder(uri) : 0;
		if (count > 0) return badge(FOLDER_BADGE, folderTooltip(count));

		try {
			const stats = await vscode.workspace.fs.stat(uri);
			if ((stats.type & vscode.FileType.File) === 0) return undefined;

			const emptiness = await emptinessOf(uri, stats.size, whitespaceOnlyEnabled());
			if (emptiness === undefined) return undefined;

			// The badge picked under `emptyFiles.badgeStyle`, one of the
			// choices its enum in package.json offers.
			const selectedBadge = vscode.workspace.getConfiguration('emptyFiles').get('badgeStyle', '∅');
			return badge(selectedBadge, fileTooltip(emptiness, stats.size));

		} catch (error) {
			// A file deleted between the event and this query is no error.
			if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
				return undefined;
			}
			this._log.error(error);
			return undefined;
		}
	}
}

/** Settings whose change alters which files the folder index counts. */
const INDEX_SETTINGS = ['emptyFiles.folders', 'emptyFiles.whitespaceOnly', 'files.exclude', 'search.exclude'];

function activate(context) {
	// Output → Empty File Highlighter: errors, and what each folder scan found.
	const log = vscode.window.createOutputChannel(context.extension.packageJSON.displayName, { log: true });
	const logError = error => log.error(error);
	const provider = new EmptyFileDecorationProvider(log);

	const registration = vscode.window.registerFileDecorationProvider(provider);
	context.subscriptions.push(log, registration, provider);

	// Ends with a full refresh, folder marks on or off.
	provider.rebuildIndex().catch(logError);

	const settingsListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (INDEX_SETTINGS.some(setting => event.affectsConfiguration(setting))) {
			provider.rebuildIndex().catch(logError);
		} else if (event.affectsConfiguration('emptyFiles')) {
			provider.refresh();
		}
	});
	const foldersListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
		provider.rebuildIndex().catch(logError);
	});
	context.subscriptions.push(settingsListener, foldersListener);

	// VS Code caches a decoration per URI until the provider reports a
	// change, so a file gaining or losing content must be reported here, or
	// its badge stays as first computed.
	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	watcher.onDidCreate(uri => provider.schedule(uri, true));
	watcher.onDidChange(uri => provider.schedule(uri, false));
	watcher.onDidDelete(uri => provider.schedule(uri, false));
	context.subscriptions.push(watcher);
}

function deactivate() { }

module.exports = {
	BATCH_DELAY_MS,
	activate,
	deactivate
};
