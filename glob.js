/**
 * Glob matching for VS Code's exclude settings (`files.exclude`,
 * `search.exclude`), whose syntax is `/`, `*`, `?`, `**`, `{a,b}`, `[abc]`
 * and `[!abc]`. VS Code's API exposes no matcher, so this is a small one for
 * exactly that syntax. Matching is case-sensitive.
 */

const REGEXP_SPECIAL = /[\\^$.*+?()[\]{}|]/g;

/**
 * Turns a glob into a RegExp that matches a whole workspace-relative path
 * written with `/` separators.
 */
function globToRegExp(glob) {
	return new RegExp(`^${toSource(glob)}$`);
}

function toSource(glob) {
	let source = '';
	let i = 0;
	while (i < glob.length) {
		const char = glob[i];

		if (char === '*' && glob[i + 1] === '*') {
			i += 2;
			if (glob[i] === '/') {
				// `**/`: any number of whole segments, none included.
				source += '(?:.*/)?';
				i += 1;
			} else {
				source += '.*';
			}
			continue;
		}

		if (char === '/' && glob.slice(i) === '/**') {
			// A trailing `/**` also matches the folder itself.
			source += '(?:/.*)?';
			break;
		}

		if (char === '*') {
			source += '[^/]*';
			i += 1;
			continue;
		}

		if (char === '?') {
			source += '[^/]';
			i += 1;
			continue;
		}

		if (char === '[') {
			const close = glob.indexOf(']', i + 2);
			if (close !== -1) {
				let set = glob.slice(i + 1, close).replace(/\\/g, '\\\\');
				if (set.startsWith('!')) set = `^${set.slice(1)}`;
				else if (set.startsWith('^')) set = `\\${set}`;
				source += `[${set}]`;
				i = close + 1;
				continue;
			}
		}

		if (char === '{') {
			const close = matchingBrace(glob, i);
			if (close !== -1) {
				const choices = splitTopLevel(glob.slice(i + 1, close));
				source += `(?:${choices.map(toSource).join('|')})`;
				i = close + 1;
				continue;
			}
		}

		source += char.replace(REGEXP_SPECIAL, '\\$&');
		i += 1;
	}
	return source;
}

/** The index of the `}` closing the `{` at `open`, or -1. */
function matchingBrace(glob, open) {
	let depth = 0;
	for (let i = open; i < glob.length; i++) {
		if (glob[i] === '{') depth++;
		else if (glob[i] === '}' && --depth === 0) return i;
	}
	return -1;
}

/** Splits a brace group's body at the commas outside nested groups. */
function splitTopLevel(body) {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < body.length; i++) {
		if (body[i] === '{') depth++;
		else if (body[i] === '}') depth--;
		else if (body[i] === ',' && depth === 0) {
			parts.push(body.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(body.slice(start));
	return parts;
}

module.exports = { globToRegExp };
