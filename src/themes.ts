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
		description: '跟随当前 VS Code 配色主题',
		codeScheme: 'auto',
	},
	{
		id: 'wechat',
		label: 'WeChat Classic · 微信经典',
		description: '居中暖色标题，蓝色强调',
		codeScheme: 'light',
	},
	{
		id: 'macos',
		label: 'macOS Minimal · macOS 简约',
		description: '中性灰，留白充足',
		codeScheme: 'light',
	},
	{
		id: 'academic',
		label: 'Academic Paper · 学术论文',
		description: '衬线正文，三线表，纸质感',
		codeScheme: 'light',
	},
	{
		id: 'notion',
		label: 'Notion Clean · Notion 简洁',
		description: '扁平无衬线，柔和分隔线',
		codeScheme: 'light',
	},
	{
		id: 'medium',
		label: 'Medium Editorial · Medium 编辑',
		description: '大号衬线正文，宽版心',
		codeScheme: 'light',
	},
	{
		id: 'tech-blog',
		label: 'Tech Blog · 科技博客',
		description: '紧凑无衬线，密而易读',
		codeScheme: 'light',
	},
	{
		id: 'clean-blue',
		label: 'Clean Blue · 简约蓝',
		description: '蓝色强调，商务报告感',
		codeScheme: 'light',
	},
];

export const DEFAULT_THEME_ID = 'editor';

export function getTheme(id: string | undefined): Theme {
	return THEMES.find(t => t.id === id) ?? THEMES[0];
}
