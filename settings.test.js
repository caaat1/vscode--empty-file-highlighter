const { beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
// The fake first: it makes the `require('vscode')` below resolve to it.
const { fake } = require('./test/vscode');
const { foldersEnabled, whitespaceOnlyEnabled } = require('./settings');
const manifest = require('./package.json');

const declared = manifest.contributes.configuration.properties;

/** Values VS Code would warn about and pass on as they are. */
const NOT_BOOLEAN = ['off', 'on', 'true', 'false', 1, 0, null];

for (const [read, key] of [
	[whitespaceOnlyEnabled, 'emptyFiles.whitespaceOnly'],
	[foldersEnabled, 'emptyFiles.folders'],
]) {
	describe(read.name, () => {
		beforeEach(() => fake.reset());
		const fallback = declared[key].default;

		it('follows a boolean', () => {
			fake.set({ [key]: true });
			assert.equal(read(), true);
			fake.set({ [key]: false });
			assert.equal(read(), false);
		});

		it(`falls back to the manifest's default (${fallback}) when unset`, () => {
			assert.equal(read(), fallback);
		});

		for (const value of NOT_BOOLEAN) {
			it(`falls back to the default when set to ${JSON.stringify(value)}`, () => {
				fake.set({ [key]: value });
				assert.equal(read(), fallback);
			});
		}
	});
}
