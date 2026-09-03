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

/**
 * Writes a value back into whichever scope already defines it.
 *
 * Always writing Global is what makes a toolbar control look broken: a value
 * set in `.vscode/settings.json` keeps winning over the one just written, so
 * the control snaps back on the next settings message with nothing on screen
 * to explain it. `readConfig` reads the effective value, so the write has to
 * land in the same layer the read comes from.
 */
async function update(key: string, value: unknown, resource?: vscode.Uri): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	await config.update(key, value, writeTarget(config.inspect(key)));
}

/** The layer a write has to land in for `readConfig` to read it back. */
export function writeTarget(scope: ConfigScope | undefined): vscode.ConfigurationTarget {
	if (scope?.workspaceFolderValue !== undefined) {
		return vscode.ConfigurationTarget.WorkspaceFolder;
	}
	if (scope?.workspaceValue !== undefined) {
		return vscode.ConfigurationTarget.Workspace;
	}
	return vscode.ConfigurationTarget.Global;
}

interface ConfigScope {
	workspaceValue?: unknown;
	workspaceFolderValue?: unknown;
}

export async function writeTheme(themeId: string, resource?: vscode.Uri): Promise<void> {
	await update('theme', themeId, resource);
}

export async function writeCustomCss(css: string, resource?: vscode.Uri): Promise<void> {
	await update('customCss', css, resource);
}
