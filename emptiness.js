/**
 * What counts as an empty file: shared by the file badges and the folder
 * index, so a folder's mark always agrees with the files inside it.
 */
const vscode = require('vscode');

/**
 * Largest file read for the `emptyFiles.whitespaceOnly` check. A file over
 * it is not read: one that large holding only whitespace is rare, and
 * reading every big file on each Explorer refresh is not.
 */
const WHITESPACE_SCAN_MAX_BYTES = 64 * 1024;

/**
 * Decodes file bytes for the whitespace check: UTF-16 when a byte order
 * mark says so, UTF-8 otherwise. Bytes that are not valid UTF-8 decode to
 * U+FFFD, which is no whitespace, so such a file never counts.
 */
function decodeText(bytes) {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		return new TextDecoder('utf-16le').decode(bytes);
	}
	if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		return new TextDecoder('utf-16be').decode(bytes);
	}
	return new TextDecoder('utf-8').decode(bytes);
}

/**
 * `\s` covers spaces, tabs, line breaks (LF, CR), form and vertical feeds,
 * no-break and other Unicode spaces, and the byte order mark (U+FEFF).
 */
function isWhitespaceOnly(text) {
	return /^\s*$/u.test(text);
}

/**
 * How a file of the given size counts as empty: `'empty'` at 0 bytes,
 * `'whitespace'` when it holds only whitespace and `whitespaceOnly` is
 * true (files up to WHITESPACE_SCAN_MAX_BYTES), else undefined.
 */
async function emptinessOf(uri, size, whitespaceOnly) {
	if (size === 0) return 'empty';
	if (!whitespaceOnly || size > WHITESPACE_SCAN_MAX_BYTES) return undefined;

	const text = decodeText(await vscode.workspace.fs.readFile(uri));
	return isWhitespaceOnly(text) ? 'whitespace' : undefined;
}

module.exports = { WHITESPACE_SCAN_MAX_BYTES, emptinessOf };
