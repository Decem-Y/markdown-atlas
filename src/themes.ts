/**
 * Theme registry.
 *
 * A theme is just a stylesheet under `media/themes/<id>.css`. Only the active
 * theme's stylesheet is linked into the preview, so theme rules do not need any
 * `[data-theme]` scoping — they scope to `.atlas-content` and nothing else.
 *
 * `codeScheme` decides which highlight.js token palette (from `media/code.css`)
 * is applied. Fixed light themes must pin `'light'`: the preview lives inside a
 * webview that may be running under a dark VS Code color theme, and without the
 * pin a light page would get dark code tokens.
 */
export interface Theme {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly codeScheme: 'light' | 'dark' | 'auto';
}

export const THEMES: readonly Theme[] = [
	{
		id: 'editor',
		label: 'Editor · 跟随编辑器',
		description: 'Follows the current VS Code color theme',
		codeScheme: 'auto',
	},
	{
		id: 'wechat',
		label: 'WeChat Classic · 微信经典',
		description: 'Centred warm headings, blue accents',
		codeScheme: 'light',
	},
	{
		id: 'macos',
		label: 'macOS Minimal · macOS 简约',
		description: 'Neutral greys, generous whitespace',
		codeScheme: 'light',
	},
	{
		id: 'academic',
		label: 'Academic Paper · 学术论文',
		description: 'Serif body, tight tables, printed feel',
		codeScheme: 'light',
	},
	{
		id: 'notion',
		label: 'Notion Clean · Notion 简洁',
		description: 'Flat sans-serif, soft dividers',
		codeScheme: 'light',
	},
	{
		id: 'medium',
		label: 'Medium Editorial · Medium 编辑',
		description: 'Large serif body, wide measure',
		codeScheme: 'light',
	},
	{
		id: 'tech-blog',
		label: 'Tech Blog · 科技博客',
		description: 'Compact sans-serif, dense and readable',
		codeScheme: 'light',
	},
	{
		id: 'clean-blue',
		label: 'Clean Blue · 简约蓝',
		description: 'Light blue accents, business-report look',
		codeScheme: 'light',
	},
];

export const DEFAULT_THEME_ID = 'editor';

export function getTheme(id: string | undefined): Theme {
	return THEMES.find(t => t.id === id) ?? THEMES[0];
}
