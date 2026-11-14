/**
 * The empty files of the workspace, counted per folder, so a folder can be
 * marked while collapsed: VS Code asks for decorations only of the items it
 * shows, so the files inside a collapsed folder are never asked about.
 */
const vscode = require('vscode');
const { posix } = require('node:path');
const { emptinessOf } = require('./emptiness');
const { globToRegExp } = require('./glob');

/**
 * Files of a folder looked at at once. Unbounded, a folder of many files
 * would have each of them stat'ed, and with `whitespaceOnly` read, at the
 * same time.
 */
const SCAN_CONCURRENCY = 16;

/** Runs `task` on every item, at most `limit` at a time. */
async function forEachLimited(items, limit, task) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await task(items[next++]);
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Tells whether a workspace-relative path is excluded by `files.exclude`
 * (what the Explorer hides) or `search.exclude` (contents not worth
 * searching, `node_modules` by default). A pattern set to a `when` clause
 * instead of `true` is not applied.
 */
function excludeMatcher() {
	const patterns = [];
	for (const section of ['files', 'search']) {
		const excludes = vscode.workspace.getConfiguration(section).get('exclude', {});
		for (const [glob, on] of Object.entries(excludes)) {
			if (on === true) patterns.push(globToRegExp(glob));
		}
	}
	return relativePath => patterns.some(pattern => pattern.test(relativePath));
}

/**
 * The folders from the given URI's parent up to its workspace folder; none
 * when it lies outside the workspace.
 */
function ancestorsOf(uri) {
	const root = vscode.workspace.getWorkspaceFolder(uri);
	if (root === undefined) return [];

	const ancestors = [];
	let current = uri;
	while (current.path.length > root.uri.path.length) {
		current = current.with({ path: posix.dirname(current.path) });
		ancestors.push(current);
	}
	return ancestors;
}

function isFileNotFound(error) {
	return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

class EmptyFileIndex {
	constructor() {
		/** URI strings of the empty files found. */
		this._files = new Set();
		/** Folder URI string → number of empty files below it. */
		this._counts = new Map();
		/** Bumped by clear(), so a scan still running stops. */
		this._generation = 0;
		this._isExcluded = () => false;
		this._whitespaceOnly = false;
		/** Files looked at since the last rebuild began. */
		this._scanned = 0;
	}

	/** The number of empty files anywhere below the folder. */
	countUnder(folderUri) {
		return this._counts.get(folderUri.toString()) ?? 0;
	}

	clear() {
		this._generation++;
		this._files.clear();
		this._counts.clear();
	}

	/**
	 * Scans every workspace folder afresh. Reads the exclude settings and
	 * `whitespaceOnly` once, so a change to them needs a rebuild. Resolves
	 * with what it found, `{ empty, scanned }` files, or undefined when
	 * cleared or rebuilt again meanwhile.
	 */
	async rebuild(whitespaceOnly) {
		this.clear();
		const generation = this._generation;
		this._isExcluded = excludeMatcher();
		this._whitespaceOnly = whitespaceOnly;
		this._scanned = 0;
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			await this._scan(folder.uri, generation, new Map());
		}
		if (generation !== this._generation) return undefined;
		return { empty: this._files.size, scanned: this._scanned };
	}

	/**
	 * Brings one created, changed or deleted URI up to date. Returns the
	 * folders whose count changed, so their marks can be refreshed.
	 */
	async update(uri, created) {
		const changed = new Map();
		if (vscode.workspace.getWorkspaceFolder(uri) === undefined) return [];
		if (this._isExcludedPath(vscode.workspace.asRelativePath(uri, false))) return [];

		let stats;
		try {
			stats = await vscode.workspace.fs.stat(uri);
		} catch (error) {
			// Gone: a deleted file, or a deleted folder with all inside it.
			if (isFileNotFound(error)) this._removeUnder(uri, changed);
			return [...changed.values()];
		}

		if (stats.type & vscode.FileType.Directory) {
			// A folder created or moved in may arrive as one event, without
			// one for each file inside it.
			if (created) await this._scan(uri, this._generation, changed);
		} else if (stats.type & vscode.FileType.File) {
			const emptiness = await emptinessOf(uri, stats.size, this._whitespaceOnly);
			if (emptiness === undefined) this._remove(uri, changed);
			else this._add(uri, changed);
		}
		return [...changed.values()];
	}

	/** Whether the path or any folder above it is excluded. */
	_isExcludedPath(relativePath) {
		const segments = relativePath.split('/');
		for (let i = 1; i <= segments.length; i++) {
			if (this._isExcluded(segments.slice(0, i).join('/'))) return true;
		}
		return false;
	}

	async _scan(folderUri, generation, changed) {
		let entries;
		try {
			entries = await vscode.workspace.fs.readDirectory(folderUri);
		} catch {
			return;
		}
		if (generation !== this._generation) return;

		const subfolders = [];
		await forEachLimited(entries, SCAN_CONCURRENCY, async ([name, type]) => {
			// Superseded: the rest of the folder is not looked at.
			if (generation !== this._generation) return;
			const child = vscode.Uri.joinPath(folderUri, name);
			if (this._isExcluded(vscode.workspace.asRelativePath(child, false))) return;

			if (type & vscode.FileType.Directory) {
				// A linked folder is not entered: it may loop back.
				if ((type & vscode.FileType.SymbolicLink) === 0) subfolders.push(child);
				return;
			}
			if ((type & vscode.FileType.File) === 0) return;
			this._scanned++;

			try {
				const stats = await vscode.workspace.fs.stat(child);
				const emptiness = await emptinessOf(child, stats.size, this._whitespaceOnly);
				if (emptiness !== undefined && generation === this._generation) {
					this._add(child, changed);
				}
			} catch {
				// Gone or unreadable since listed: not counted.
			}
		});

		for (const subfolder of subfolders) {
			if (generation !== this._generation) return;
			await this._scan(subfolder, generation, changed);
		}
	}

	_add(fileUri, changed) {
		const key = fileUri.toString();
		if (this._files.has(key)) return;
		this._files.add(key);
		this._shift(fileUri, +1, changed);
	}

	_remove(fileUri, changed) {
		const key = fileUri.toString();
		if (!this._files.delete(key)) return;
		this._shift(fileUri, -1, changed);
	}

	/** Removes the URI's own entry and every entry below it. */
	_removeUnder(uri, changed) {
		const key = uri.toString();
		const prefix = key.endsWith('/') ? key : `${key}/`;
		for (const file of [...this._files]) {
			if (file === key || file.startsWith(prefix)) {
				this._remove(vscode.Uri.parse(file), changed);
			}
		}
	}

	_shift(fileUri, delta, changed) {
		for (const folder of ancestorsOf(fileUri)) {
			const key = folder.toString();
			const count = (this._counts.get(key) ?? 0) + delta;
			if (count > 0) this._counts.set(key, count);
			else this._counts.delete(key);
			changed.set(key, folder);
		}
	}
}

module.exports = { EmptyFileIndex, SCAN_CONCURRENCY };
