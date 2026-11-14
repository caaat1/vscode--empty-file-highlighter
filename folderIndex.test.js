const { beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
// The fake first: it makes the `require('vscode')` below resolve to it.
const { fake } = require('./test/vscode');
const { EmptyFileIndex } = require('./folderIndex');

/** The workspace most tests start from; `/ws` holds 4 empty files. */
function standardWorkspace() {
	fake.file('/ws/a.txt');
	fake.file('/ws/full.txt', 'text');
	fake.file('/ws/src/deep/e1.txt');
	fake.file('/ws/src/deep/e2.txt');
	fake.file('/ws/src/blank.txt', '\n');
	fake.file('/ws/node_modules/pkg/empty.js');
	fake.file('/ws/.git/HEAD');
	fake.file('/ws/clean/x.txt', 'text');
	// Excluded only under a `when` clause, which is not applied.
	fake.file('/ws/when/e.txt');
	fake.folder('/ws/linked', { link: true });
	fake.file('/ws/linked/e.txt');
	fake.set({
		'files.exclude': { '**/.git': true, '**/when': { when: '$(basename).ts' } },
		'search.exclude': { '**/node_modules': true },
	});
}

function countsOf(index, paths) {
	return Object.fromEntries(paths.map(path => [path, index.countUnder(fake.uri(path))]));
}

function pathsOf(uris) {
	return uris.map(uri => uri.path).sort();
}

describe('EmptyFileIndex', () => {
	let index;
	beforeEach(() => {
		fake.reset();
		standardWorkspace();
		index = new EmptyFileIndex();
	});

	describe('rebuild', () => {
		it('counts empty files in every folder above them', async () => {
			await index.rebuild(false);
			assert.deepEqual(countsOf(index, ['/ws', '/ws/src', '/ws/src/deep', '/ws/clean']), {
				'/ws': 4, '/ws/src': 2, '/ws/src/deep': 2, '/ws/clean': 0,
			});
		});

		it('skips what files.exclude and search.exclude name', async () => {
			await index.rebuild(false);
			assert.deepEqual(countsOf(index, ['/ws/.git', '/ws/node_modules', '/ws/node_modules/pkg']), {
				'/ws/.git': 0, '/ws/node_modules': 0, '/ws/node_modules/pkg': 0,
			});
		});

		it('applies no pattern set to a `when` clause', async () => {
			await index.rebuild(false);
			assert.equal(index.countUnder(fake.uri('/ws/when')), 1);
		});

		it('does not enter a linked folder', async () => {
			await index.rebuild(false);
			assert.equal(index.countUnder(fake.uri('/ws/linked')), 0);
		});

		it('counts whitespace-only files when asked to', async () => {
			await index.rebuild(true);
			assert.deepEqual(countsOf(index, ['/ws', '/ws/src']), { '/ws': 5, '/ws/src': 3 });
		});

		it('passes over a folder it cannot read', async () => {
			fake.fail('/ws/src/deep', 'NoPermissions');
			await index.rebuild(false);
			assert.deepEqual(countsOf(index, ['/ws', '/ws/src']), { '/ws': 2, '/ws/src': 0 });
		});

		it('covers every workspace folder', async () => {
			fake.setFolders(['/ws', '/other']);
			fake.file('/other/e.txt');
			await index.rebuild(false);
			assert.deepEqual(countsOf(index, ['/ws', '/other']), { '/ws': 4, '/other': 1 });
		});

		it('starts afresh', async () => {
			await index.rebuild(false);
			fake.remove('/ws/src');
			await index.rebuild(false);
			assert.deepEqual(countsOf(index, ['/ws', '/ws/src']), { '/ws': 2, '/ws/src': 0 });
		});
	});

	describe('update', () => {
		beforeEach(() => index.rebuild(false));

		it('a file gaining content: returns the folders above it, counted down', async () => {
			fake.file('/ws/src/deep/e1.txt', 'now full');
			const changed = await index.update(fake.uri('/ws/src/deep/e1.txt'), false);
			assert.deepEqual(pathsOf(changed), ['/ws', '/ws/src', '/ws/src/deep']);
			assert.deepEqual(countsOf(index, ['/ws', '/ws/src/deep']), { '/ws': 3, '/ws/src/deep': 1 });
		});

		it('a file becoming empty: counted up', async () => {
			fake.file('/ws/full.txt', '');
			assert.deepEqual(pathsOf(await index.update(fake.uri('/ws/full.txt'), false)), ['/ws']);
			assert.equal(index.countUnder(fake.uri('/ws')), 5);
		});

		it('a change that changes nothing: no folders', async () => {
			assert.deepEqual(await index.update(fake.uri('/ws/full.txt'), false), []);
			assert.deepEqual(await index.update(fake.uri('/ws/a.txt'), false), []);
		});

		it('a deleted folder: its files leave the counts', async () => {
			fake.remove('/ws/src/deep');
			const changed = await index.update(fake.uri('/ws/src/deep'), false);
			assert.deepEqual(pathsOf(changed), ['/ws', '/ws/src', '/ws/src/deep']);
			assert.deepEqual(countsOf(index, ['/ws', '/ws/src', '/ws/src/deep']), {
				'/ws': 2, '/ws/src': 0, '/ws/src/deep': 0,
			});
		});

		it('a folder moved in as one event: counted whole', async () => {
			fake.file('/ws/moved/in/z.txt');
			fake.file('/ws/moved/y.txt');
			const changed = await index.update(fake.uri('/ws/moved'), true);
			assert.deepEqual(pathsOf(changed), ['/ws', '/ws/moved', '/ws/moved/in']);
			assert.deepEqual(countsOf(index, ['/ws/moved', '/ws/moved/in']), { '/ws/moved': 2, '/ws/moved/in': 1 });
		});

		it('a folder that only changed: not rescanned', async () => {
			fake.file('/ws/clean/new.txt');
			assert.deepEqual(await index.update(fake.uri('/ws/clean'), false), []);
		});

		it('ignores paths under an excluded folder, and outside the workspace', async () => {
			fake.file('/ws/node_modules/pkg/new.js');
			assert.deepEqual(await index.update(fake.uri('/ws/node_modules/pkg/new.js'), true), []);
			assert.deepEqual(await index.update(fake.uri('/elsewhere/e.txt'), true), []);
		});
	});

	it('clear: forgets every count and stops a scan under way', async () => {
		const scan = index.rebuild(false);
		index.clear();
		await scan;
		assert.equal(index.countUnder(fake.uri('/ws')), 0);
	});
});
