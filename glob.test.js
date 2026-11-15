const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { globToRegExp } = require('./glob');

/** Each case: [glob, workspace-relative path, whether it matches]. */
function check(cases) {
	for (const [glob, path, matches] of cases) {
		it(`${glob} ${matches ? 'matches' : 'does not match'} ${path}`, () => {
			assert.equal(globToRegExp(glob).test(path), matches);
		});
	}
}

describe('globToRegExp', () => {
	describe("VS Code's default excludes", () => check([
		['**/.git', '.git', true],
		['**/.git', 'a/b/.git', true],
		['**/.git', '.github', false],
		['**/node_modules', 'node_modules', true],
		['**/node_modules', 'pkg/node_modules', true],
		// The folder matches, not its contents: those are excluded through it.
		['**/node_modules', 'node_modules/x', false],
		['**/*.code-search', 'a/b.code-search', true],
		['**/.DS_Store', 'x/.DS_Store', true],
	]));

	describe('`*` stays within one segment', () => check([
		['*.log', 'a.log', true],
		['*.log', 'dir/a.log', false],
		['build', 'build', true],
		['build', 'src/build', false],
	]));

	describe('`**` spans segments', () => check([
		['a/**/b', 'a/b', true],
		['a/**/b', 'a/x/y/b', true],
		['a/**/b', 'a/xb', false],
		['out/**', 'out', true],
		['out/**', 'out/a/b', true],
		['out/**', 'outer', false],
	]));

	describe('`?` is one character of a segment', () => check([
		['file?.txt', 'file1.txt', true],
		['file?.txt', 'file/.txt', false],
	]));

	describe('braces, nested too', () => check([
		['**/*.{js,ts}', 'a/b.ts', true],
		['**/*.{js,ts}', 'a/b.css', false],
		['{a,{b,c}}/x', 'c/x', true],
		['{a,{b,c}}/x', 'd/x', false],
	]));

	describe('character sets', () => check([
		['[abc].txt', 'b.txt', true],
		['[!abc].txt', 'b.txt', false],
		['[!abc].txt', 'd.txt', true],
		['[a-c]x', 'bx', true],
	]));

	describe('everything else is literal', () => check([
		['a+b(1).txt', 'a+b(1).txt', true],
		['a.b', 'axb', false],
		['a{b', 'a{b', true],
		['a[b', 'a[b', true],
	]));

	describe('case matters', () => check([
		['**/Thumbs.db', 'thumbs.db', false],
	]));
});
