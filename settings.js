/**
 * The extension's own settings, read where they are needed so a change
 * applies without a reload.
 */
const vscode = require('vscode');

/**
 * A boolean setting, or its default when set to anything else: a mistyped
 * string such as "off" is truthy, and VS Code does not coerce it, only
 * warns.
 */
function booleanSetting(name, fallback) {
	const value = vscode.workspace.getConfiguration('emptyFiles').get(name);
	return typeof value === 'boolean' ? value : fallback;
}

/** `emptyFiles.whitespaceOnly`: whitespace-only files count as empty. */
function whitespaceOnlyEnabled() {
	return booleanSetting('whitespaceOnly', false);
}

/** `emptyFiles.folders`: folders holding empty files are marked. */
function foldersEnabled() {
	return booleanSetting('folders', true);
}

module.exports = { foldersEnabled, whitespaceOnlyEnabled };
