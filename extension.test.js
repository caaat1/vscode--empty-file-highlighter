const { afterEach, beforeEach, describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
// The fake first: it makes the `require('vscode')` below resolve to it.
const vscode = require('./test/vscode');
const { BATCH_DELAY_MS, activate } = require('./extension');
const manifest = require('./package.json');

const { fake } = vscode;
const declared = manifest.contributes.configuration.properties;
const readme = readFileSync(join(__dirname, 'readme.md'), 'utf8');

const pathsOf = uris => uris.map(uri => uri.path).sort();

describe('extension', () => {
	let context;

	/**
	 * Activates the extension; resolves at its first refresh, once the
	 * folder index is built (at once, folder marks being off).
	 */
	async function start() {
		context = fake.context();
		activate(context);
		const [provider] = fake.providers;
		const refreshed = await fake.first(provider.onDidChangeFileDecorations);
		return { provider, refreshed };
	}

	/** Fires watcher events and resolves with the refresh the batch makes. */
	function afterEvents(provider, events) {
		const refreshed = fake.next(provider.onDidChangeFileDecorations);
		for (const [kind, path] of events) fake.emit(kind, path);
		mock.timers.tick(BATCH_DELAY_MS);
		return refreshed;
	}

	const decorationOf = (provider, path) => provider.provideFileDecoration(fake.uri(path));

	beforeEach(() => {
		fake.reset();
		mock.timers.enable({ apis: ['setTimeout'] });
	});

	afterEach(() => {
		for (const disposable of context?.subscriptions ?? []) disposable.dispose();
		context = undefined;
		mock.timers.reset();
		mock.restoreAll();
	});

	const linesOf = level => fake.channels[0].lines.filter(line => line.level === level);

	describe('activation', () => {
		it('registers one provider; disposing the context releases all it set up', async () => {
			await start();
			assert.equal(fake.providers.length, 1);
			assert.equal(fake.watchers.length, 1);
			assert.ok(fake.listenerCount > 0);

			for (const disposable of context.subscriptions) disposable.dispose();
			context = undefined;
			assert.equal(fake.providers.length, 0);
			assert.equal(fake.watchers.length, 0);
			assert.equal(fake.listenerCount, 0);
			assert.equal(fake.channels.length, 0);
		});

		it('watches every file of the workspace', async () => {
			await start();
			assert.equal(fake.watchers[0].glob, '**/*');
		});

		it('builds the folder index, then refreshes every decoration', async () => {
			fake.file('/ws/sub/e.txt');
			const { provider, refreshed } = await start();
			assert.equal(refreshed, undefined);
			assert.equal((await decorationOf(provider, '/ws/sub')).badge, '∋');
		});

		it('refreshes nothing more until something changes', async () => {
			const { provider } = await start();
			let refreshes = 0;
			provider.onDidChangeFileDecorations(() => refreshes++);
			mock.timers.tick(60_000);
			await new Promise(setImmediate);
			assert.equal(refreshes, 0);
		});
	});

	describe('file badges', () => {
		it("marks a 0-byte file with the manifest's default badge", async () => {
			fake.file('/ws/e.txt');
			const { provider } = await start();
			const decoration = await decorationOf(provider, '/ws/e.txt');
			assert.equal(decoration.badge, declared['emptyFiles.badgeStyle'].default);
			assert.equal(decoration.tooltip, 'This file is completely empty (0 Bytes).');
		});

		it('uses the badge picked under badgeStyle', async () => {
			fake.file('/ws/e.txt');
			fake.set({ 'emptyFiles.badgeStyle': '0B' });
			const { provider } = await start();
			assert.equal((await decorationOf(provider, '/ws/e.txt')).badge, '0B');
		});

		it('marks a whitespace-only file when that option is on, with its size', async () => {
			fake.file('/ws/one.txt', '\n');
			fake.file('/ws/two.txt', '\n\n');
			fake.set({ 'emptyFiles.whitespaceOnly': true });
			const { provider } = await start();
			assert.equal((await decorationOf(provider, '/ws/one.txt')).tooltip, 'This file holds only whitespace (1 Byte).');
			assert.equal((await decorationOf(provider, '/ws/two.txt')).tooltip, 'This file holds only whitespace (2 Bytes).');
		});

		it('leaves unmarked a file with content, a gone file and a folder with none empty', async () => {
			fake.file('/ws/full.txt', 'text');
			fake.file('/ws/sub/full.txt', 'text');
			const { provider } = await start();
			assert.equal(await decorationOf(provider, '/ws/full.txt'), undefined);
			assert.equal(await decorationOf(provider, '/ws/gone.txt'), undefined);
			assert.equal(await decorationOf(provider, '/ws/sub'), undefined);
		});

		it('does not even stat a URI without a file system behind it', async () => {
			const { provider } = await start();
			const stats = fake.counts.stat;
			assert.equal(await provider.provideFileDecoration(new vscode.Uri('output', 'channel')), undefined);
			assert.equal(fake.counts.stat, stats);
		});

		it('sets no colour and does not propagate', async () => {
			fake.file('/ws/sub/e.txt');
			const { provider } = await start();
			for (const path of ['/ws/sub/e.txt', '/ws/sub']) {
				const decoration = await decorationOf(provider, path);
				assert.equal(decoration.color, undefined);
				assert.equal(decoration.propagate, false);
			}
		});
	});

	describe('folder badges', () => {
		it('marks a folder holding empty files at any depth, with the count', async () => {
			fake.file('/ws/a/one.txt');
			fake.file('/ws/a/b/two.txt');
			const { provider } = await start();
			const outer = await decorationOf(provider, '/ws/a');
			assert.equal(outer.badge, '∋');
			assert.equal(outer.tooltip, 'This folder holds 2 empty files.');
			assert.equal((await decorationOf(provider, '/ws/a/b')).tooltip, 'This folder holds 1 empty file.');
		});

		it('says whitespace-only too when that option is on', async () => {
			fake.file('/ws/a/blank.txt', '\n');
			fake.set({ 'emptyFiles.whitespaceOnly': true });
			const { provider } = await start();
			assert.equal((await decorationOf(provider, '/ws/a')).tooltip, 'This folder holds 1 empty or whitespace-only file.');
		});

		it('marks no folder when the folders option is off', async () => {
			fake.file('/ws/a/e.txt');
			fake.set({ 'emptyFiles.folders': false });
			const { provider } = await start();
			assert.equal(await decorationOf(provider, '/ws/a'), undefined);
			assert.equal((await decorationOf(provider, '/ws/a/e.txt')).badge, '∅');
		});

		it('uses the glyph that the setting and the readme name', async () => {
			fake.file('/ws/a/e.txt');
			const { provider } = await start();
			const glyph = `\`${(await decorationOf(provider, '/ws/a')).badge}\``;
			assert.ok(declared['emptyFiles.folders'].markdownDescription.includes(glyph));
			assert.ok(readme.includes(glyph));
		});
	});

	describe('live updates', () => {
		it('a file gaining content: one refresh, naming it and the folders above it', async () => {
			fake.file('/ws/a/e.txt');
			const { provider } = await start();
			fake.file('/ws/a/e.txt', 'text');
			const refreshed = await afterEvents(provider, [['change', '/ws/a/e.txt']]);
			assert.deepEqual(pathsOf(refreshed), ['/ws', '/ws/a', '/ws/a/e.txt']);
			assert.equal(await decorationOf(provider, '/ws/a'), undefined);
		});

		it('events within the batch delay: one refresh, each URI named once', async () => {
			const { provider } = await start();
			let refreshes = 0;
			provider.onDidChangeFileDecorations(() => refreshes++);
			for (const name of ['1', '2', '3']) {
				fake.file(`/ws/${name}.txt`);
				fake.emit('create', `/ws/${name}.txt`);
				mock.timers.tick(BATCH_DELAY_MS - 1);
			}
			assert.equal(refreshes, 0);

			const refreshed = fake.next(provider.onDidChangeFileDecorations);
			mock.timers.tick(1);
			assert.deepEqual(pathsOf(await refreshed), ['/ws', '/ws/1.txt', '/ws/2.txt', '/ws/3.txt']);
			assert.equal(refreshes, 1);
		});

		it('a folder moved in as one event: counted whole', async () => {
			const { provider } = await start();
			fake.file('/ws/moved/in/e.txt');
			const refreshed = await afterEvents(provider, [['create', '/ws/moved']]);
			assert.deepEqual(pathsOf(refreshed), ['/ws', '/ws/moved', '/ws/moved/in']);
			assert.equal((await decorationOf(provider, '/ws/moved')).badge, '∋');
		});

		it('a deleted folder: its mark goes with it', async () => {
			fake.file('/ws/a/b/e.txt');
			const { provider } = await start();
			fake.remove('/ws/a/b');
			await afterEvents(provider, [['delete', '/ws/a/b']]);
			assert.equal(await decorationOf(provider, '/ws/a'), undefined);
		});
	});

	describe('manifest', () => {
		it('titles the settings with the display name: they sit right under its heading', () => {
			assert.equal(manifest.contributes.configuration.title, manifest.displayName);
		});
	});

	describe('logging', () => {
		it("logs to an Output channel of the extension's display name", async () => {
			await start();
			assert.equal(fake.channels.length, 1);
			assert.equal(fake.channels[0].name, manifest.displayName);
			assert.equal(fake.channels[0].options.log, true);
		});

		it('logs what the folder scan found', async () => {
			fake.file('/ws/a/one.txt');
			fake.file('/ws/a/two.txt');
			fake.file('/ws/full.txt', 'text');
			await start();
			const [line] = linesOf('info');
			assert.match(line.value, /^Folder marks: 2 empty files among 3 scanned, in \d+ ms\.$/);
		});

		it('logs no scan with folder marks off', async () => {
			fake.set({ 'emptyFiles.folders': false });
			await start();
			assert.deepEqual(linesOf('info'), []);
		});

		it('logs a file system error to the channel, not the console', async () => {
			const consoleError = mock.method(console, 'error', () => {});
			const { provider } = await start();
			fake.fail('/ws/locked.txt', 'NoPermissions');
			assert.equal(await decorationOf(provider, '/ws/locked.txt'), undefined);
			assert.deepEqual(linesOf('error').map(line => line.value.code), ['NoPermissions']);
			assert.equal(consoleError.mock.callCount(), 0);
		});

		it('takes a file gone before it is asked about as no error', async () => {
			const { provider } = await start();
			await decorationOf(provider, '/ws/gone.txt');
			assert.deepEqual(linesOf('error'), []);
		});
	});

	describe('settings and workspace folders', () => {
		it('badgeStyle: refreshes every decoration, without rescanning', async () => {
			const { provider } = await start();
			const listings = fake.counts.readDirectory;
			const refreshed = fake.next(provider.onDidChangeFileDecorations);
			fake.change({ 'emptyFiles.badgeStyle': '◎' });
			assert.equal(await refreshed, undefined);
			assert.equal(fake.counts.readDirectory, listings);
		});

		for (const [key, value] of [
			['emptyFiles.folders', true],
			['emptyFiles.whitespaceOnly', true],
			['files.exclude', { '**/out': true }],
			['search.exclude', { '**/out': true }],
		]) {
			it(`${key}: rescans, then refreshes every decoration`, async () => {
				const { provider } = await start();
				const listings = fake.counts.readDirectory;
				const refreshed = fake.next(provider.onDidChangeFileDecorations);
				fake.change({ [key]: value });
				assert.equal(await refreshed, undefined);
				assert.ok(fake.counts.readDirectory > listings);
			});
		}

		it('folders turned off, then on: the marks go, then come back', async () => {
			fake.file('/ws/a/e.txt');
			const { provider } = await start();

			let refreshed = fake.next(provider.onDidChangeFileDecorations);
			fake.change({ 'emptyFiles.folders': false });
			await refreshed;
			assert.equal(await decorationOf(provider, '/ws/a'), undefined);

			refreshed = fake.next(provider.onDidChangeFileDecorations);
			fake.change({ 'emptyFiles.folders': true });
			await refreshed;
			assert.equal((await decorationOf(provider, '/ws/a')).badge, '∋');
		});

		it("another extension's setting: nothing", async () => {
			const { provider } = await start();
			let refreshes = 0;
			provider.onDidChangeFileDecorations(() => refreshes++);
			fake.change({ 'editor.fontSize': 14 });
			await new Promise(setImmediate);
			assert.equal(refreshes, 0);
		});

		it('workspace folders added: rescans them', async () => {
			fake.file('/other/e.txt');
			const { provider } = await start();
			const refreshed = fake.next(provider.onDidChangeFileDecorations);
			fake.setFolders(['/ws', '/other']);
			await refreshed;
			assert.equal((await decorationOf(provider, '/other')).badge, '∋');
		});
	});
});
