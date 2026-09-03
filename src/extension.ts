import * as vscode from 'vscode';
import { CONFIG_SECTION, readConfig, writeTheme } from './config';
import { exportDocument, pickAndExport } from './export';
import { PreviewManager } from './preview/previewManager';
import { THEMES } from './themes';

export function activate(context: vscode.ExtensionContext): void {
	const manager = new PreviewManager(context);
	const resolve = (uri?: vscode.Uri) => resolveResource(uri, manager);

	context.subscriptions.push(
		manager,

		vscode.window.registerWebviewPanelSerializer(PreviewManager.viewType, manager),

		vscode.commands.registerCommand('markdownAtlas.showPreview', (uri?: vscode.Uri) => {
			const resource = resolve(uri);
			if (resource) {
				manager.show(resource, vscode.ViewColumn.Active, false);
			}
		}),

		vscode.commands.registerCommand('markdownAtlas.showPreviewToSide', (uri?: vscode.Uri) => {
			const resource = resolve(uri);
			if (resource) {
				manager.show(resource, vscode.ViewColumn.Beside, true);
			}
		}),

		vscode.commands.registerCommand('markdownAtlas.refreshPreview', () => {
			manager.refresh();
		}),

		vscode.commands.registerCommand('markdownAtlas.selectTheme', () => selectTheme()),

		vscode.commands.registerCommand('markdownAtlas.export', async (uri?: vscode.Uri) => {
			const resource = resolve(uri);
			if (resource) {
				await pickAndExport(context.extensionUri, resource);
			}
		}),

		vscode.commands.registerCommand('markdownAtlas.exportHtml', async (uri?: vscode.Uri) => {
			const resource = resolve(uri);
			if (resource) {
				await exportDocument(context.extensionUri, resource, { format: 'html' });
			}
		}),

		vscode.commands.registerCommand('markdownAtlas.exportPdf', async (uri?: vscode.Uri) => {
			const resource = resolve(uri);
			if (resource) {
				await exportDocument(context.extensionUri, resource, { format: 'pdf' });
			}
		}),

		vscode.commands.registerCommand('markdownAtlas.editCustomCss', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', `${CONFIG_SECTION}.customCss`),
		),
	);
}

export function deactivate(): void {
	// Everything is owned by context.subscriptions.
}

/**
 * Commands arrive from the explorer (with a uri), from a Markdown editor, or
 * from the preview panel itself — where there is no active text editor at all.
 */
function resolveResource(uri: vscode.Uri | undefined, manager: PreviewManager): vscode.Uri | undefined {
	if (uri) {
		return uri;
	}

	const editor = vscode.window.activeTextEditor;
	if (editor?.document.languageId === 'markdown') {
		return editor.document.uri;
	}

	const fromPreview = manager.activeResource();
	if (fromPreview) {
		return fromPreview;
	}

	void vscode.window.showInformationMessage(
		'Markdown Atlas：请先打开一个 Markdown 文件，或从资源管理器里运行。',
	);
	return undefined;
}

async function selectTheme(): Promise<void> {
	const resource = vscode.window.activeTextEditor?.document.uri;
	const active = readConfig(resource).theme;

	const picked = await vscode.window.showQuickPick(
		THEMES.map(theme => ({
			label: theme.label,
			description: theme.id === active ? '$(check) 当前' : undefined,
			detail: theme.description,
			id: theme.id,
		})),
		{ title: 'Markdown Atlas —— 预览主题', placeHolder: '选择一套预览主题' },
	);

	if (picked) {
		await writeTheme(picked.id, resource);
	}
}
