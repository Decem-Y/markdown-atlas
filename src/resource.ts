import * as vscode from 'vscode';

/** True for anything already carrying a scheme, or a protocol-relative URL. */
export function isExternalHref(href: string): boolean {
	return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
}

export function dirname(resource: vscode.Uri): vscode.Uri {
	return resource.with({
		path: resource.path.replace(/\/[^/]*$/, '') || '/',
		query: '',
		fragment: '',
	});
}

export function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export interface SplitHref {
	/** The path portion, with any `?query` / `#fragment` removed. */
	file: string;
	/** The removed portion, `?`/`#` included, ready to be re-appended. */
	suffix: string;
}

export function splitHref(href: string): SplitHref {
	const at = href.search(/[?#]/);
	return at === -1
		? { file: href, suffix: '' }
		: { file: href.slice(0, at), suffix: href.slice(at) };
}

/**
 * Resolves an `src`/`href` written inside `document` to a URI on disk, or
 * `undefined` when the target is not a local file.
 */
export function resolveDocumentHref(document: vscode.Uri, href: string): vscode.Uri | undefined {
	if (isExternalHref(href)) {
		return undefined;
	}
	const { file } = splitHref(href);
	if (!file) {
		return undefined;
	}

	const decoded = safeDecode(file);
	return decoded.startsWith('/')
		? document.with({ path: decoded, query: '', fragment: '' })
		: vscode.Uri.joinPath(dirname(document), decoded);
}
