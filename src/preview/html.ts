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
	['.atlas-content', '文章容器'],
	['.atlas-content h1 / h2 / h3', '标题'],
	['.atlas-content p', '正文段落'],
	['.atlas-content strong', '加粗文字'],
	['.atlas-content a', '链接'],
	['.atlas-content blockquote', '引用块'],
	['.atlas-content :not(pre) > code', '行内代码'],
	['.atlas-code', '代码块容器'],
	['.atlas-content table / th / td', '表格'],
	['.atlas-content ul / ol', '列表'],
	['.atlas-content img', '图片'],
	['.atlas-content figcaption', '图片说明'],
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
<html lang="zh-CN">
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
			<span class="atlas-field-label">主题</span>
			<select id="atlas-theme-select" title="预览主题">${options}</select>
		</label>

		<span class="atlas-toolbar-group">
			<button type="button" class="atlas-tool" id="atlas-outline-toggle" title="目录 —— 本文档的标题层级">&#128209; 目录</button>
			<button type="button" class="atlas-tool" id="atlas-style-toggle" title="叠加在主题之上的自定义 CSS">&#127912; 样式</button>
			<button type="button" class="atlas-tool" id="atlas-table-toggle" hidden title="宽表格：在文章栏内滚动，或展开后整页滚动">&#9638; 滚动</button>
		</span>

		<span class="atlas-toolbar-group">
			<button type="button" class="atlas-tool" id="atlas-sync-to-preview" title="把预览跳到编辑器光标所在的位置">&rarr;</button>
			<button type="button" class="atlas-tool" id="atlas-sync-to-editor" title="把编辑器跳到预览当前的位置">&larr;</button>
		</span>

		<span class="atlas-toolbar-group atlas-zoom">
			<button type="button" class="atlas-tool" id="atlas-zoom-out" title="缩小">&minus;</button>
			<button type="button" class="atlas-tool atlas-zoom-level" id="atlas-zoom-reset" title="重置缩放">100%</button>
			<button type="button" class="atlas-tool" id="atlas-zoom-in" title="放大">+</button>
		</span>

		<span class="atlas-toolbar-spacer"></span>

		<span class="atlas-menu-wrap">
			<button type="button" class="atlas-tool" id="atlas-export" aria-haspopup="true" aria-expanded="false" title="导出当前文档">&#128190; 导出 <span class="atlas-caret">&#9662;</span></button>
			<div class="atlas-menu" id="atlas-export-menu" hidden>
				<div class="atlas-menu-label">格式</div>
				<button type="button" class="atlas-menu-item" data-format="html">
					<span class="atlas-menu-item-title">&#127760; HTML</span>
					<span class="atlas-menu-item-desc">单个独立文件 —— CSS、图片和公式字体全部内联。</span>
				</button>
				<button type="button" class="atlas-menu-item" data-format="pdf">
					<span class="atlas-menu-item-title">&#128196; PDF</span>
					<span class="atlas-menu-item-desc">用本机已装好的 Chrome / Edge / Chromium 打印。</span>
				</button>
				<div class="atlas-menu-divider"></div>
				<div class="atlas-menu-label">目标位置</div>
				<input type="text" id="atlas-export-path" spellcheck="false" autocapitalize="off"
					autocomplete="off" placeholder="留空 = 写在 .md 文件旁边"
					title="绝对路径，或相对于 Markdown 文件的路径。">
				<p class="atlas-menu-hint">目录会沿用文档名；文件名直接采用，扩展名强制匹配当前格式。</p>
			</div>
		</span>
	</header>

	<aside class="atlas-panel" id="atlas-outline-panel" hidden aria-label="文档目录">
		<div class="atlas-panel-header">
			<span>&#128209; 目录</span>
			<button type="button" class="atlas-panel-close" data-close-panel="outline" title="关闭">&times;</button>
		</div>
		<nav class="atlas-outline" id="atlas-outline"></nav>
	</aside>

	<aside class="atlas-panel atlas-panel-wide" id="atlas-style-panel" hidden aria-label="自定义 CSS">
		<div class="atlas-panel-header">
			<span>&#127912; 自定义 CSS</span>
			<button type="button" class="atlas-panel-close" data-close-panel="style" title="关闭">&times;</button>
		</div>
		<div class="atlas-panel-body">
			<p class="atlas-panel-hint">
				叠加在当前主题之上。每条规则都要以 <code>.atlas-content</code> 开头（代码块用
				<code>.atlas-code</code>）。
			</p>
			<details class="atlas-cheatsheet">
				<summary>可以写的选择器</summary>
				<div class="atlas-cheatsheet-body">${hints}</div>
			</details>
			<textarea id="atlas-css-input" spellcheck="false" autocapitalize="off" autocomplete="off"
				placeholder="/* 示例 */
.atlas-content h1 {
  color: #07c160;
  border-bottom: 2px solid #07c160;
}
.atlas-content blockquote {
  background: #f0fff4;
  border-left: 4px solid #07c160;
}"></textarea>
			<div class="atlas-panel-actions">
				<button type="button" class="atlas-tool atlas-tool-primary" id="atlas-css-apply">应用</button>
				<button type="button" class="atlas-tool" id="atlas-css-reset">重置</button>
			</div>
			<p class="atlas-panel-note">保存在 <code>markdownAtlas.customCss</code> 设置里，重新加载后依然生效，并对所有预览生效。</p>
		</div>
	</aside>

	<main class="atlas-page">
		<article class="atlas-content" id="atlas-content" dir="auto">
			<p class="atlas-placeholder">渲染中&hellip;</p>
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
