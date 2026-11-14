const { beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
// The fake first: it makes the `require('vscode')` below resolve to it.
const { fake } = require('./test/vscode');
const { WHITESPACE_SCAN_MAX_BYTES, emptinessOf } = require('./emptiness');
const manifest = require('./package.json');

const BOM = String.fromCodePoint(0xfeff);
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

function utf16le(text) {
	return new Uint8Array(Buffer.from(BOM + text, 'utf16le'));
}

function utf16be(text) {
	return new Uint8Array(Buffer.from(BOM + text, 'utf16le').swap16());
}

/** How a file holding the content (text as UTF-8, or bytes) counts as empty. */
function emptinessWith(content, whitespaceOnly) {
	const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
	fake.file('/ws/f', bytes);
	return emptinessOf(fake.uri('/ws/f'), bytes.length, whitespaceOnly);
}

describe('emptinessOf', () => {
	beforeEach(() => fake.reset());

	it('counts a 0-byte file as empty without reading it, whitespace on or off', async () => {
		assert.equal(await emptinessWith('', false), 'empty');
		assert.equal(await emptinessWith('', true), 'empty');
		assert.equal(fake.counts.readFile, 0);
	});

	describe('with whitespaceOnly', () => {
		for (const [label, content] of [
			['one line break', '\n'],
			['Windows line breaks', '\r\n\r\n'],
			['spaces and tabs', ' \t  \t'],
			['a UTF-8 byte order mark', BOM],
			['a no-break space', NO_BREAK_SPACE],
			['UTF-16 LE line breaks', utf16le('\n\n')],
			['UTF-16 BE line breaks', utf16be('\n')],
			['spaces up to the size limit', ' '.repeat(WHITESPACE_SCAN_MAX_BYTES)],
		]) {
			it(`counts ${label} as whitespace`, async () => {
				assert.equal(await emptinessWith(content, true), 'whitespace');
			});
		}

		for (const [label, content] of [
			['a letter', 'a'],
			['a letter among blanks', '\n a \n'],
			['bytes that are not UTF-8', Uint8Array.from([0x20, 0xc3])],
			['a NUL byte', Uint8Array.from([0])],
			['a zero-width space, which is no whitespace', ZERO_WIDTH_SPACE],
		]) {
			it(`does not count ${label}`, async () => {
				assert.equal(await emptinessWith(content, true), undefined);
			});
		}

		it('does not read, nor count, a file over the size limit', async () => {
			assert.equal(await emptinessWith(' '.repeat(WHITESPACE_SCAN_MAX_BYTES + 1), true), undefined);
			assert.equal(fake.counts.readFile, 0);
		});
	});

	it('without whitespaceOnly, does not read, nor count, whitespace', async () => {
		assert.equal(await emptinessWith('\n', false), undefined);
		assert.equal(fake.counts.readFile, 0);
	});

	it('has the size limit that the setting and the readme name', () => {
		const limit = ` ${WHITESPACE_SCAN_MAX_BYTES / 1024} KiB`;
		const setting = manifest.contributes.configuration.properties['emptyFiles.whitespaceOnly'];
		assert.ok(setting.markdownDescription.includes(limit), setting.markdownDescription);
		assert.ok(readFileSync(join(__dirname, 'readme.md'), 'utf8').includes(limit));
	});
});
