/**
 * A fake of the `vscode` module for the unit tests: the parts of the API
 * the extension uses, over an in-memory workspace. Requiring this file
 * makes `require('vscode')` resolve to it (Node's `module.registerHooks`,
 * Node 22.15 or later); the tests drive the workspace through `fake`.
 * `node --test` runs every test file in a process of its own.
 */
const { registerHooks } = require('node:module');
const { posix } = require('node:path');
const { pathToFileURL } = require('node:url');
const manifest = require('../package.json');

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'vscode') return { shortCircuit: true, url: pathToFileURL(__filename).href };
		return nextResolve(specifier, context);
	},
});

class Uri {
	constructor(scheme, path) {
		this.scheme = scheme;
		this.path = path;
	}

	static file(path) {
		return new Uri('file', path);
	}

	static joinPath(base, ...segments) {
		return base.with({ path: posix.join(base.path, ...segments) });
	}

	static parse(value) {
		const separator = value.indexOf('://');
		return new Uri(value.slice(0, separator), value.slice(separator + 3));
	}

	with({ path = this.path, scheme = this.scheme }) {
		return new Uri(scheme, path);
	}

	toString() {
		return `${this.scheme}://${this.path}`;
	}
}

const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

class FileSystemError extends Error {
	constructor(message, code = 'Unknown') {
		super(message);
		this.code = code;
	}

	static FileNotFound(uri) {
		return new FileSystemError(`File not found: ${uri}`, 'FileNotFound');
	}
}

class EventEmitter {
	constructor() {
		this._listeners = new Set();
		/** Every value fired so far, for `fake.first`. */
		this.fired = [];
		this.event = listener => {
			this._listeners.add(listener);
			return { dispose: () => this._listeners.delete(listener) };
		};
		this.event.emitter = this;
	}

	fire(value) {
		this.fired.push(value);
		for (const listener of [...this._listeners]) listener(value);
	}

	dispose() {
		this._listeners.clear();
	}
}

class FileDecoration {
	constructor(badge, tooltip, color) {
		this.badge = badge;
		this.tooltip = tooltip;
		this.color = color;
	}
}

class ThemeColor {
	constructor(id) {
		this.id = id;
	}
}

const state = {};

/** Adds to a set and returns the disposable that removes it again. */
function subscribe(set, item) {
	set.add(item);
	return { dispose: () => set.delete(item) };
}

function entryAt(uri) {
	const failure = state.failures.get(uri.path);
	if (failure !== undefined) throw new FileSystemError(`Failing: ${uri}`, failure);
	const entry = state.entries.get(uri.path);
	if (entry === undefined) throw FileSystemError.FileNotFound(uri);
	return entry;
}

function folderOf(uri) {
	return state.folders.find(folder =>
		folder.uri.scheme === uri.scheme
		&& (uri.path === folder.uri.path || uri.path.startsWith(`${folder.uri.path}/`)));
}

/** A configuration change event naming the given setting keys. */
function changeEvent(keys) {
	return {
		affectsConfiguration: section =>
			keys.some(key => key === section || key.startsWith(`${section}.`)),
	};
}

const workspace = {
	get workspaceFolders() {
		return state.folders.length > 0 ? [...state.folders] : undefined;
	},
	getWorkspaceFolder: folderOf,
	asRelativePath(uri, _includeWorkspaceFolder) {
		const folder = folderOf(uri);
		return folder === undefined ? uri.path : posix.relative(folder.uri.path, uri.path);
	},
	getConfiguration(section) {
		return {
			get: (key, fallback) => {
				const value = state.settings.get(`${section}.${key}`);
				return value === undefined ? fallback : value;
			},
		};
	},
	onDidChangeConfiguration: listener => subscribe(state.configurationListeners, listener),
	onDidChangeWorkspaceFolders: listener => subscribe(state.folderListeners, listener),
	createFileSystemWatcher(glob) {
		const handlers = { change: new Set(), create: new Set(), delete: new Set() };
		const watcher = {
			glob,
			handlers,
			onDidChange: listener => subscribe(handlers.change, listener),
			onDidCreate: listener => subscribe(handlers.create, listener),
			onDidDelete: listener => subscribe(handlers.delete, listener),
			dispose: () => state.watchers.delete(watcher),
		};
		state.watchers.add(watcher);
		return watcher;
	},
	fs: {
		isWritableFileSystem: scheme => (scheme === 'file' ? true : undefined),
		async stat(uri) {
			state.counts.stat++;
			const entry = entryAt(uri);
			return { ctime: 0, mtime: 0, size: entry.bytes?.length ?? 0, type: entry.type };
		},
		async readFile(uri) {
			state.counts.readFile++;
			const entry = entryAt(uri);
			if ((entry.type & FileType.File) === 0) throw new FileSystemError(`Not a file: ${uri}`, 'FileIsADirectory');
			return entry.bytes;
		},
		async readDirectory(uri) {
			state.counts.readDirectory++;
			const entry = entryAt(uri);
			if ((entry.type & FileType.Directory) === 0) throw new FileSystemError(`Not a folder: ${uri}`, 'FileNotADirectory');
			return [...state.entries]
				.filter(([path]) => path !== uri.path && posix.dirname(path) === uri.path)
				.map(([path, child]) => [posix.basename(path), child.type]);
		},
	},
};

const window = {
	/** A log channel keeping its lines as `{ level, value }`. */
	createOutputChannel(name, options) {
		const channel = { lines: [], name, options };
		for (const level of ['trace', 'debug', 'info', 'warn', 'error']) {
			channel[level] = value => channel.lines.push({ level, value });
		}
		channel.dispose = () => state.channels.delete(channel);
		state.channels.add(channel);
		return channel;
	},
	registerFileDecorationProvider: provider => subscribe(state.providers, provider),
};

/** The test's handle on the fake workspace. */
const fake = {
	/** An empty workspace with one folder, `/ws`, and no settings. */
	reset() {
		state.entries = new Map();
		state.failures = new Map();
		state.settings = new Map();
		state.folders = [];
		state.channels = new Set();
		state.providers = new Set();
		state.watchers = new Set();
		state.configurationListeners = new Set();
		state.folderListeners = new Set();
		state.counts = { readDirectory: 0, readFile: 0, stat: 0 };
		fake.setFolders(['/ws']);
	},

	uri: path => Uri.file(path),

	/** A file holding the given text (UTF-8) or bytes; missing folders above it are made. */
	file(path, content = '') {
		fake.folder(posix.dirname(path));
		const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
		state.entries.set(path, { bytes, type: FileType.File });
	},

	/** A folder, with the folders above it; `link` makes it a symbolic link. */
	folder(path, { link = false } = {}) {
		if (path !== '/' && !state.entries.has(path)) fake.folder(posix.dirname(path));
		const type = link ? FileType.Directory | FileType.SymbolicLink : FileType.Directory;
		if (path !== '/' && (link || !state.entries.has(path))) state.entries.set(path, { type });
	},

	/** Removes the path and everything below it. */
	remove(path) {
		for (const key of [...state.entries.keys()]) {
			if (key === path || key.startsWith(`${path}/`)) state.entries.delete(key);
		}
	},

	/** Makes every file system call on the path fail with the given code. */
	fail(path, code) {
		state.failures.set(path, code);
	},

	/** Sets settings by full key (`emptyFiles.folders`); undefined removes one. */
	set(settings) {
		for (const [key, value] of Object.entries(settings)) {
			if (value === undefined) state.settings.delete(key);
			else state.settings.set(key, value);
		}
	},

	/** Sets settings as the user would: listeners hear of the change. */
	change(settings) {
		fake.set(settings);
		const event = changeEvent(Object.keys(settings));
		for (const listener of [...state.configurationListeners]) listener(event);
	},

	/** Replaces the workspace folders; listeners hear of it once any exist. */
	setFolders(paths) {
		const hadListeners = state.folderListeners.size > 0;
		state.folders = paths.map((path, index) => {
			fake.folder(path);
			return { index, name: posix.basename(path), uri: Uri.file(path) };
		});
		if (hadListeners) for (const listener of [...state.folderListeners]) listener({ added: [], removed: [] });
	},

	/** A watcher event, `create`, `change` or `delete`, for the path. */
	emit(kind, path) {
		for (const watcher of [...state.watchers]) {
			for (const listener of [...watcher.handlers[kind]]) listener(Uri.file(path));
		}
	},

	/** The first value ever fired on a fake's `vscode.Event`: at once if it fired already. */
	first(event) {
		const { fired } = event.emitter;
		return fired.length > 0 ? Promise.resolve(fired[0]) : fake.next(event);
	},

	/** The next value fired on a `vscode.Event`. */
	next(event) {
		return new Promise(resolve => {
			const subscription = event(value => {
				subscription.dispose();
				resolve(value);
			});
		});
	},

	/** An extension context, of this extension's manifest; the test disposes its subscriptions. */
	context: () => ({ extension: { packageJSON: manifest }, subscriptions: [] }),

	get channels() {
		return [...state.channels];
	},
	get counts() {
		return { ...state.counts };
	},
	get providers() {
		return [...state.providers];
	},
	get watchers() {
		return [...state.watchers];
	},
	get listenerCount() {
		return state.configurationListeners.size + state.folderListeners.size;
	},
};

fake.reset();

module.exports = {
	EventEmitter,
	FileDecoration,
	FileSystemError,
	FileType,
	ThemeColor,
	Uri,
	window,
	workspace,
	fake,
};
