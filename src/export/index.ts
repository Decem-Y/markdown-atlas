import * as vscode from 'vscode';
import { readConfig } from '../config';
import { dirname } from '../resource';
import { buildStandaloneHtml } from './document';
import { renderPdf } from './pdf';

export type ExportFormat = 'html' | 'pdf';

export interface ExportRequest {
	format: ExportFormat;
	/**
	 * One-off destination typed into the preview's export field. Absolute, or
	 * relative to the Markdown file. Overrides `markdownAtlas.export.outputPath`.
	 */
	outputPath?: string;
}

export async function exportDocument(
	extensionUri: vscode.Uri,
	resource: vscode.Uri,
	request: ExportRequest,
): Promise<void> {
	const config = readConfig(resource);
	const target = resolveTarget(
		resource,
		request.outputPath?.trim() || config.exportOutputPath.trim(),
		request.format,
	);

	try {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Markdown Atlas: exporting ${request.format.toUpperCase()}`,
			},
			async () => {
				const document = await vscode.workspace.openTextDocument(resource);
				const html = await buildStandaloneHtml(
					extensionUri,
					resource,
					document.getText(),
					config,
					request.format === 'pdf'
						? {
								print: {
									pageSize: config.pdfPageSize,
									margin: config.pdfMargin,
								},
							}
						: {},
				);

				await vscode.workspace.fs.createDirectory(dirname(target));

				if (request.format === 'pdf') {
					await renderPdf(html, target, { chromePath: config.chromePath });
				} else {
					await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
				}
			},
		);
	} catch (error) {
		await reportFailure(error);
		return;
	}

	const action = await vscode.window.showInformationMessage(
		`Exported to ${vscode.workspace.asRelativePath(target)}`,
		'Open File',
		'Reveal in Explorer',
	);
	if (action === 'Open File') {
		await vscode.commands.executeCommand('vscode.open', target);
	} else if (action === 'Reveal in Explorer') {
		await vscode.commands.executeCommand('revealFileInOS', target);
	}
}

/** Command-palette entry point: asks which format, then exports. */
export async function pickAndExport(
	extensionUri: vscode.Uri,
	resource: vscode.Uri,
): Promise<void> {
	const picked = await vscode.window.showQuickPick(
		[
			{
				label: '$(globe) HTML',
				detail: 'One self-contained file — CSS and images inlined.',
				format: 'html' as const,
			},
			{
				label: '$(file-pdf) PDF',
				detail: 'Rendered through the Chrome, Edge or Chromium already installed on this machine.',
				format: 'pdf' as const,
			},
		],
		{ title: 'Markdown Atlas — export', placeHolder: 'Choose a format' },
	);

	if (picked) {
		await exportDocument(extensionUri, resource, { format: picked.format });
	}
}

/**
 * Turns a configured or typed destination into a file URI.
 *
 * A value that looks like a filename is used as one (with the extension forced
 * to match the format, so a PDF never lands inside `.html`); anything else is
 * treated as a directory. Empty means "beside the source file", which is the
 * one-click default.
 */
export function resolveTarget(
	resource: vscode.Uri,
	requested: string,
	format: ExportFormat,
): vscode.Uri {
	const extension = format === 'pdf' ? '.pdf' : '.html';
	const source = resource.path.split('/').pop() ?? 'document.md';
	const stem = source.replace(/\.[^.]*$/, '') || 'document';

	if (!requested) {
		return vscode.Uri.joinPath(dirname(resource), stem + extension);
	}

	const base = toUri(resource, requested);
	const last = requested.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
	const looksLikeFile = /\.[A-Za-z0-9]{1,8}$/.test(last);

	if (!looksLikeFile) {
		return vscode.Uri.joinPath(base, stem + extension);
	}
	return base.with({ path: base.path.replace(/\.[^./]*$/, extension) });
}

function toUri(resource: vscode.Uri, requested: string): vscode.Uri {
	if (/^[a-zA-Z]:[\\/]/.test(requested)) {
		return vscode.Uri.file(requested);
	}
	if (requested.startsWith('/')) {
		return resource.with({ path: requested, query: '', fragment: '' });
	}
	return vscode.Uri.joinPath(dirname(resource), requested.replace(/\\/g, '/'));
}

async function reportFailure(error: unknown): Promise<void> {
	const message = error instanceof Error ? error.message : String(error);
	const needsBrowser = message.includes('No Chrome, Edge or Chromium');

	const action = await vscode.window.showErrorMessage(
		`Markdown Atlas: export failed. ${message}`,
		...(needsBrowser ? ['Set browser path'] : []),
	);
	if (action === 'Set browser path') {
		await vscode.commands.executeCommand(
			'workbench.action.openSettings',
			'markdownAtlas.export.chromePath',
		);
	}
}
