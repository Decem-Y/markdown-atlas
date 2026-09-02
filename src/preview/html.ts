import * as vscode from 'vscode';
import { THEMES } from '../themes';

export interface ThemeLink {
	id: string;
	label: string;
	description: string;
	href: string;
	codeScheme: 'light' | 'dark' | 'auto';
}

/** Selectors offered in the Style panel, mirroring Markdown2Anything's cheat sheet. */
const SELECTOR_HINTS: ReadonlyArray<readonly [string, string]> = [
	['.atlas-content', 'the article container'],
	['.atlas-content h1 / h2 / h3', 'headings'],
	['.atlas-content p', 'body paragraphs'],
	['.atlas-content strong', 'bold text'],
	['.atlas-content a', 'links'],
	['.atlas-content blockquote', 'quotes'],
	['.atlas-content :not(pre) > code', 'inline code'],
	['.atlas-code', 'code block container'],
	['.atlas-content table / th / td', 'tables'],
	['.atlas-content ul / ol', 'lists'],
	['.atlas-content img', 'images'],
	['.atlas-content figcaption', 'image captions'],
];

function nonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

function mediaUri(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	...parts: string[]
): vscode.Uri {
	return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', ...parts));
}

export function themeLinks(webview: vscode.Webview, extensionUri: vscode.Uri): ThemeLink[] {
	return THEMES.map(theme => ({
		id: theme.id,
		label: theme.label,
		description: theme.description,
		codeScheme: theme.codeScheme,
		href: mediaUri(webview, extensionUri, 'themes', `${theme.id}.css`).toString(),
	}));
}

export function shellHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	activeThemeId: string,
	title: string,
): string {
	const csp = webview.cspSource;
	const n = nonce();
	const themes = themeLinks(webview, extensionUri);
	const activeTheme = themes.find(t => t.id === activeThemeId) ?? themes[0];

	const baseCss = mediaUri(webview, extensionUri, 'base.css');
	const chromeCss = mediaUri(webview, extensionUri, 'chrome.css');
	const codeCss = mediaUri(webview, extensionUri, 'code.css');
	const katexCss = mediaUri(webview, extensionUri, 'vendor', 'katex', 'katex.min.css');
	const previewJs = mediaUri(webview, extensionUri, 'preview.js');

	const options = themes
		.map(
			t =>
				`<option value="${t.id}"${t.id === activeTheme.id ? ' selected' : ''}>${escapeHtml(
					t.label,
				)}</option>`,
		)
		.join('');

	const hints = SELECTOR_HINTS.map(
		([selector, description]) =>
			`<div><code>${escapeHtml(selector)}</code> — ${escapeHtml(description)}</div>`,
	).join('');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https: data:; media-src ${csp} https: data:; style-src ${csp} 'unsafe-inline'; font-src ${csp} data:; script-src 'nonce-${n}';">
	<link rel="stylesheet" href="${katexCss}">
	<link rel="stylesheet" href="${baseCss}">
	<link rel="stylesheet" href="${chromeCss}">
	<link rel="stylesheet" href="${codeCss}">
	<link rel="stylesheet" id="atlas-theme-link" href="${activeTheme.href}">
	<style id="atlas-custom-style"></style>
	<title>${escapeHtml(title)}</title>
</head>
<body class="atlas-body" data-code-scheme="${activeTheme.codeScheme}">
	<header class="atlas-toolbar" id="atlas-toolbar">
		<label class="atlas-field">
			<span class="atlas-field-label">Theme</span>
			<select id="atlas-theme-select" title="Preview theme">${options}</select>
		</label>

		<span class="atlas-toolbar-group">
			<button type="button" class="atlas-tool" id="atlas-outline-toggle" title="Outline — headings in this document">&#128209; Outline</button>
			<button type="button" class="atlas-tool" id="atlas-style-toggle" title="Custom CSS layered on top of the theme">&#127912; Style</button>
			<button type="button" class="atlas-tool" id="atlas-table-toggle" hidden title="Wide tables: scroll inside the column, or expand and scroll the page">&#9638; Scroll</button>
		</span>

		<span class="atlas-toolbar-group">
			<button type="button" class="atlas-tool" id="atlas-sync-to-preview" title="Jump the preview to the editor's cursor">&rarr;</button>
			<button type="button" class="atlas-tool" id="atlas-sync-to-editor" title="Jump the editor to the preview's position">&larr;</button>
		</span>

		<span class="atlas-toolbar-group atlas-zoom">
			<button type="button" class="atlas-tool" id="atlas-zoom-out" title="Zoom out">&minus;</button>
			<button type="button" class="atlas-tool atlas-zoom-level" id="atlas-zoom-reset" title="Reset zoom">100%</button>
			<button type="button" class="atlas-tool" id="atlas-zoom-in" title="Zoom in">+</button>
		</span>

		<span class="atlas-toolbar-spacer"></span>

		<span class="atlas-menu-wrap">
			<button type="button" class="atlas-tool" id="atlas-export" aria-haspopup="true" aria-expanded="false" title="Export this document">&#128190; Export <span class="atlas-caret">&#9662;</span></button>
			<div class="atlas-menu" id="atlas-export-menu" hidden>
				<div class="atlas-menu-label">Format</div>
				<button type="button" class="atlas-menu-item" data-format="html">
					<span class="atlas-menu-item-title">&#127760; HTML</span>
					<span class="atlas-menu-item-desc">One self-contained file — CSS, images and math fonts inlined.</span>
				</button>
				<button type="button" class="atlas-menu-item" data-format="pdf">
					<span class="atlas-menu-item-title">&#128196; PDF</span>
					<span class="atlas-menu-item-desc">Printed by the Chrome, Edge or Chromium already on this machine.</span>
				</button>
				<div class="atlas-menu-divider"></div>
				<div class="atlas-menu-label">Destination</div>
				<input type="text" id="atlas-export-path" spellcheck="false" autocapitalize="off"
					autocomplete="off" placeholder="empty = beside the .md file"
					title="Absolute, or relative to the Markdown file.">
				<p class="atlas-menu-hint">A directory keeps the document&#39;s name; a filename is used as given, with the extension matched to the format.</p>
			</div>
		</span>
	</header>

	<aside class="atlas-panel" id="atlas-outline-panel" hidden aria-label="Document outline">
		<div class="atlas-panel-header">
			<span>&#128209; Outline</span>
			<button type="button" class="atlas-panel-close" data-close-panel="outline" title="Close">&times;</button>
		</div>
		<nav class="atlas-outline" id="atlas-outline"></nav>
	</aside>

	<aside class="atlas-panel atlas-panel-wide" id="atlas-style-panel" hidden aria-label="Custom CSS">
		<div class="atlas-panel-header">
			<span>&#127912; Custom CSS</span>
			<button type="button" class="atlas-panel-close" data-close-panel="style" title="Close">&times;</button>
		</div>
		<div class="atlas-panel-body">
			<p class="atlas-panel-hint">
				Layered on top of the active theme. Every rule must start with
				<code>.atlas-content</code> (or <code>.atlas-code</code> for code blocks).
			</p>
			<details class="atlas-cheatsheet">
				<summary>Selectors you can target</summary>
				<div class="atlas-cheatsheet-body">${hints}</div>
			</details>
			<textarea id="atlas-css-input" spellcheck="false" autocapitalize="off" autocomplete="off"
				placeholder="/* example */
.atlas-content h1 {
  color: #07c160;
  border-bottom: 2px solid #07c160;
}
.atlas-content blockquote {
  background: #f0fff4;
  border-left: 4px solid #07c160;
}"></textarea>
			<div class="atlas-panel-actions">
				<button type="button" class="atlas-tool atlas-tool-primary" id="atlas-css-apply">Apply</button>
				<button type="button" class="atlas-tool" id="atlas-css-reset">Reset</button>
			</div>
			<p class="atlas-panel-note">Saved to the <code>markdownAtlas.customCss</code> setting, so it survives a reload and applies to every preview.</p>
		</div>
	</aside>

	<main class="atlas-page">
		<article class="atlas-content" id="atlas-content" dir="auto">
			<p class="atlas-placeholder">Rendering&hellip;</p>
		</article>
	</main>

	<div class="atlas-toast" id="atlas-toast" hidden role="status"></div>
	<script nonce="${n}" src="${previewJs}"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
