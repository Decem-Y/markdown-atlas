import * as vscode from 'vscode';
import type { FrontMatterMode } from './render/renderer';
import { DEFAULT_THEME_ID, getTheme } from './themes';

export type TableDisplay = 'scroll' | 'expand';

export interface AtlasConfig {
	readonly theme: string;
	readonly fontSize: number;
	readonly lineWidth: number;
	readonly scrollPreviewWithEditor: boolean;
	readonly scrollEditorWithPreview: boolean;
	readonly doubleClickToSwitchToEditor: boolean;
	readonly showToolbar: boolean;
	readonly tableDisplay: TableDisplay;
	readonly math: boolean;
	readonly frontMatter: FrontMatterMode;
	readonly customCss: string;
	readonly exportOutputPath: string;
	readonly exportEmbedImages: boolean;
	readonly chromePath: string;
	readonly pdfPageSize: string;
	readonly pdfMargin: string;
}

export const CONFIG_SECTION = 'markdownAtlas';

export function readConfig(resource?: vscode.Uri): AtlasConfig {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	return {
		theme: getTheme(config.get<string>('theme', DEFAULT_THEME_ID)).id,
		fontSize: config.get<number>('preview.fontSize', 16),
		lineWidth: config.get<number>('preview.lineWidth', 760),
		scrollPreviewWithEditor: config.get<boolean>('preview.scrollPreviewWithEditor', true),
		scrollEditorWithPreview: config.get<boolean>('preview.scrollEditorWithPreview', true),
		doubleClickToSwitchToEditor: config.get<boolean>(
			'preview.doubleClickToSwitchToEditor',
			false,
		),
		showToolbar: config.get<boolean>('preview.showToolbar', true),
		tableDisplay: config.get<TableDisplay>('preview.tableDisplay', 'scroll'),
		math: config.get<boolean>('math.enabled', true),
		frontMatter: config.get<FrontMatterMode>('preview.frontMatter', 'hide'),
		customCss: config.get<string>('customCss', ''),
		exportOutputPath: config.get<string>('export.outputPath', ''),
		exportEmbedImages: config.get<boolean>('export.embedImages', true),
		chromePath: config.get<string>('export.chromePath', ''),
		pdfPageSize: config.get<string>('export.pdf.pageSize', 'A4'),
		pdfMargin: config.get<string>('export.pdf.margin', '16mm'),
	};
}

function update(key: string, value: unknown): Thenable<void> {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.update(key, value, vscode.ConfigurationTarget.Global);
}

export async function writeTheme(themeId: string): Promise<void> {
	await update('theme', themeId);
}

export async function writeCustomCss(css: string): Promise<void> {
	await update('customCss', css);
}

export async function writeTableDisplay(mode: TableDisplay): Promise<void> {
	await update('preview.tableDisplay', mode);
}
