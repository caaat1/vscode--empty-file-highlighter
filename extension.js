const vscode = require('vscode');
const fs = require('node:fs');

class EmptyFileDecorationProvider {
	constructor() {
		this._onDidChangeFileDecorations = new vscode.EventEmitter();
		this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
	}

	refresh() {
		this._onDidChangeFileDecorations.fire(undefined);
	}

	provideFileDecoration(uri) {
		if (uri.scheme !== 'file') return undefined;

		try {
			const filePath = uri.fsPath;
			if (!fs.existsSync(filePath)) return undefined;

			const stats = fs.statSync(filePath);
			if (stats.isDirectory()) return undefined;

			const isFileEmpty = stats.size === 0;

			if (isFileEmpty) {
				const config = vscode.workspace.getConfiguration('emptyFiles');
				// Взимаме директно избрания символ (∅, 0B, ◎, 🔹) от менюто
				const selectedBadge = config.get('badgeStyle', '∅');

				const decoration = new vscode.FileDecoration();
				decoration.propagate = false;
				decoration.badge = selectedBadge;
				decoration.tooltip = 'This file is completely empty (0 Bytes).';

				// Ползваме блед, интелигентен цвят, който стои добре с всички символи
				decoration.color = new vscode.ThemeColor('descriptionForeground');

				return decoration;
			}

			return undefined;

		} catch (error) {
			console.error(`[Empty Files Highlighter Error] ${error.message}`);
			return undefined;
		}
	}
}

function activate(context) {
	const provider = new EmptyFileDecorationProvider();

	console.log('✅ [Empty File Highlighter] Extension is now active!');

	const registration = vscode.window.registerFileDecorationProvider(provider);
	context.subscriptions.push(registration);

	setTimeout(() => {
		provider.refresh();
	}, 800);

	const settingsListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('emptyFiles')) {
			provider.refresh();
		}
	});
	context.subscriptions.push(settingsListener);
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
};
