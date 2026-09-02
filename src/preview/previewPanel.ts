import * as vscode from 'vscode';
import { readConfig, writeCustomCss, writeTableDisplay, writeTheme, type TableDisplay } from '../config';
import { exportDocument, type ExportFormat } from '../export';
import { render } from '../render/renderer';
import { dirname, resolveDocumentHref, splitHref } from '../resource';
import { getTheme } from '../themes';
import { shellHtml, themeLinks } from './html';

export const PREVIEW_VIEW_TYPE = 'markdownAtlas.preview';

/** How long one side of the scroll sync suppresses echoes from the other. */
const SCROLL_ECHO_MS = 250;
const UPDATE_DEBOUNCE_MS = 200;

interface WebviewMessage {
	type: string;
	line?: number;
	href?: string;
	theme?: string;
	css?: string;
	mode?: TableDisplay;
	format?: ExportFormat;
	outputPath?: string;
	/** Set by the explicit sync buttons, which must win over the echo lock. */
	force?: boolean;
}

export interface PreviewSnapshot {
	resource: string;
	line: number;
}

export class PreviewPanel {
	private readonly disposables: vscode.Disposable[] = [];
	private updateTimer: NodeJS.Timeout | undefined;
	private previewDrivenScrollUntil = 0;
	private editorDrivenScrollUntil = 0;
	private pendingInitialLine: number | undefined;
	private disposed = false;

	static create(
		context: vscode.ExtensionContext,
		resource: vscode.Uri,
		viewColumn: vscode.ViewColumn,
		preserveFocus: boolean,
	): PreviewPanel {
		const panel = vscode.window.createWebviewPanel(
			PREVIEW_VIEW_TYPE,
			previewTitle(resource),
			{ viewColumn, preserveFocus },
			webviewOptions(context, resource),
		);
		return new PreviewPanel(context, panel, resource);
	}

	static revive(
		context: vscode.ExtensionContext,
		panel: vscode.WebviewPanel,
		snapshot: PreviewSnapshot,
	): PreviewPanel {
		const resource = vscode.Uri.parse(snapshot.resource);
		panel.webview.options = webviewOptions(context, resource);
		return new PreviewPanel(context, panel, resource, snapshot.line);
	}

	private constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly panel: vscode.WebviewPanel,
		readonly resource: vscode.Uri,
		initialLine?: number,
	) {
		this.pendingInitialLine = initialLine;
		this.panel.title = previewTitle(resource);
		this.panel.webview.html = shellHtml(
			this.panel.webview,
			this.context.extensionUri,
			readConfig(resource).theme,
			previewTitle(resource),
		);

		this.disposables.push(
			this.panel.webview.onDidReceiveMessage(message => this.onMessage(message)),

			vscode.workspace.onDidChangeTextDocument(event => {
				if (this.matches(event.document.uri) && event.contentChanges.length > 0) {
					this.scheduleUpdate();
				}
			}),

			vscode.workspace.onDidCloseTextDocument(document => {
				// The buffer went away; fall back to whatever is on disk.
				if (this.matches(document.uri)) {
					this.scheduleUpdate();
				}
			}),

			vscode.window.onDidChangeTextEditorVisibleRanges(event => {
				this.onEditorScroll(event);
			}),

			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration('markdownAtlas', this.resource)) {
					this.postSettings();
					// Only the render-affecting settings need a re-render; theme,
					// custom CSS and zoom are applied by the client alone.
					if (
						event.affectsConfiguration('markdownAtlas.math', this.resource) ||
						event.affectsConfiguration(
							'markdownAtlas.preview.frontMatter',
							this.resource,
						)
					) {
						void this.update();
					}
				}
			}),
		);

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	get viewColumn(): vscode.ViewColumn | undefined {
		return this.panel.viewColumn;
	}

	get active(): boolean {
		return this.panel.active;
	}

	reveal(viewColumn: vscode.ViewColumn, preserveFocus: boolean): void {
		this.panel.reveal(viewColumn, preserveFocus);
	}

	refresh(): void {
		this.postSettings();
		void this.update();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
			this.updateTimer = undefined;
		}
		for (const item of this.disposables) {
			item.dispose();
		}
		this.disposables.length = 0;
		this.onDidDisposeEmitter.fire();
		this.onDidDisposeEmitter.dispose();
		this.panel.dispose();
	}

	private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>();
	readonly onDidDispose = this.onDidDisposeEmitter.event;

	// ── rendering ──────────────────────────────────────────────────────────

	private scheduleUpdate(): void {
		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
		}
		this.updateTimer = setTimeout(() => {
			this.updateTimer = undefined;
			void this.update();
		}, UPDATE_DEBOUNCE_MS);
	}

	private async update(): Promise<void> {
		if (this.disposed) {
			return;
		}
		const config = readConfig(this.resource);
		try {
			const document = await vscode.workspace.openTextDocument(this.resource);
			const { html, title } = render(document.getText(), {
				resolveResource: href => this.resolveResource(href),
				frontMatter: config.frontMatter,
				math: config.math,
			});

			this.panel.title = title ? `${title} — Preview` : previewTitle(this.resource);
			void this.panel.webview.postMessage({
				type: 'update',
				html,
				line: this.pendingInitialLine,
			});
			this.pendingInitialLine = undefined;
		} catch (error) {
			void this.panel.webview.postMessage({
				type: 'error',
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private postSettings(): void {
		const config = readConfig(this.resource);
		const theme = getTheme(config.theme);
		void this.panel.webview.postMessage({
			type: 'settings',
			resource: this.resource.toString(),
			themes: themeLinks(this.panel.webview, this.context.extensionUri),
			theme: theme.id,
			codeScheme: theme.codeScheme,
			customCss: config.customCss,
			tableDisplay: config.tableDisplay,
			exportOutputPath: config.exportOutputPath,
			fontSize: config.fontSize,
			lineWidth: config.lineWidth,
			showToolbar: config.showToolbar,
			doubleClickToSwitchToEditor: config.doubleClickToSwitchToEditor,
			scrollEditorWithPreview: config.scrollEditorWithPreview,
		});
	}

	/**
	 * Turns a `src`/`href` from the document into something the webview may
	 * actually load. Everything that is not a local file is passed through.
	 */
	private resolveResource(href: string): string {
		const target = resolveDocumentHref(this.resource, href);
		if (!target) {
			return href;
		}
		return this.panel.webview.asWebviewUri(target).toString() + splitHref(href).suffix;
	}

	// ── scroll sync ────────────────────────────────────────────────────────

	private onEditorScroll(event: vscode.TextEditorVisibleRangesChangeEvent): void {
		if (!this.matches(event.textEditor.document.uri) || event.visibleRanges.length === 0) {
			return;
		}
		if (!readConfig(this.resource).scrollPreviewWithEditor) {
			return;
		}
		if (Date.now() < this.previewDrivenScrollUntil) {
			return;
		}

		this.editorDrivenScrollUntil = Date.now() + SCROLL_ECHO_MS;
		void this.panel.webview.postMessage({
			type: 'scrollToLine',
			line: event.visibleRanges[0].start.line,
		});
	}

	/** Toolbar `→`: push the preview to wherever the editor's cursor is. */
	private syncPreviewToCursor(): void {
		const editor = vscode.window.visibleTextEditors.find(candidate =>
			this.matches(candidate.document.uri),
		);
		if (!editor) {
			void this.toast('No editor open for this document.');
			return;
		}

		this.editorDrivenScrollUntil = Date.now() + SCROLL_ECHO_MS;
		void this.panel.webview.postMessage({
			type: 'scrollToLine',
			line: editor.selection.active.line,
		});
	}

	private revealLineInEditor(line: number, force = false): void {
		if (!force && Date.now() < this.editorDrivenScrollUntil) {
			return;
		}
		const editors = vscode.window.visibleTextEditors.filter(editor =>
			this.matches(editor.document.uri),
		);
		if (editors.length === 0) {
			if (force) {
				void this.toast('No editor open for this document.');
			}
			return;
		}

		this.previewDrivenScrollUntil = Date.now() + SCROLL_ECHO_MS;
		for (const editor of editors) {
			const target = new vscode.Position(
				Math.max(0, Math.min(Math.floor(line), editor.document.lineCount - 1)),
				0,
			);
			// Only the viewport moves — moving the selection would fire
			// onDidChangeTextEditorSelection and fight the user's cursor.
			editor.revealRange(
				new vscode.Range(target, target),
				vscode.TextEditorRevealType.AtTop,
			);
		}
	}

	private async openSourceLine(line: number): Promise<void> {
		const document = await vscode.workspace.openTextDocument(this.resource);
		const clamped = Math.max(0, Math.min(Math.floor(line), document.lineCount - 1));
		const position = new vscode.Position(clamped, 0);
		const existing = vscode.window.visibleTextEditors.find(editor =>
			this.matches(editor.document.uri),
		);

		const editor = await vscode.window.showTextDocument(document, {
			viewColumn: existing?.viewColumn ?? vscode.ViewColumn.One,
			preserveFocus: false,
		});
		editor.selection = new vscode.Selection(position, position);
		editor.revealRange(
			new vscode.Range(position, position),
			vscode.TextEditorRevealType.InCenterIfOutsideViewport,
		);
	}

	private async openLink(href: string): Promise<void> {
		if (/^(https?|mailto):/i.test(href)) {
			await vscode.env.openExternal(vscode.Uri.parse(href));
			return;
		}

		const target = resolveDocumentHref(this.resource, href);
		if (!target) {
			return;
		}

		const fragment = splitHref(href).suffix.replace(/^#/, '');
		await vscode.commands.executeCommand(
			'vscode.open',
			fragment ? target.with({ fragment }) : target,
			{ viewColumn: vscode.ViewColumn.Active },
		);
	}

	// ── plumbing ───────────────────────────────────────────────────────────

	private matches(uri: vscode.Uri): boolean {
		return uri.toString() === this.resource.toString();
	}

	private toast(message: string): void {
		void this.panel.webview.postMessage({ type: 'toast', message });
	}

	private onMessage(message: WebviewMessage): void {
		switch (message.type) {
			case 'ready':
				this.postSettings();
				void this.update();
				break;

			case 'revealLine':
				if (typeof message.line === 'number') {
					this.revealLineInEditor(message.line, message.force === true);
				}
				break;

			case 'requestCursorLine':
				this.syncPreviewToCursor();
				break;

			case 'openSource':
				if (typeof message.line === 'number') {
					void this.openSourceLine(message.line);
				}
				break;

			case 'openLink':
				if (message.href) {
					void this.openLink(message.href);
				}
				break;

			case 'setTheme':
				if (message.theme) {
					void writeTheme(message.theme);
				}
				break;

			case 'setCustomCss':
				void writeCustomCss(message.css ?? '');
				break;

			case 'setTableDisplay':
				if (message.mode === 'scroll' || message.mode === 'expand') {
					void writeTableDisplay(message.mode);
				}
				break;

			case 'export':
				void exportDocument(this.context.extensionUri, this.resource, {
					format: message.format === 'pdf' ? 'pdf' : 'html',
					outputPath: message.outputPath,
				});
				break;
		}
	}
}

function previewTitle(resource: vscode.Uri): string {
	const segments = resource.path.split('/');
	return `${segments[segments.length - 1] || 'Markdown'} — Preview`;
}

function webviewOptions(
	context: vscode.ExtensionContext,
	resource: vscode.Uri,
): vscode.WebviewOptions & vscode.WebviewPanelOptions {
	const roots = [context.extensionUri, dirname(resource)];
	const folder = vscode.workspace.getWorkspaceFolder(resource);
	if (folder) {
		roots.push(folder.uri);
	}
	for (const other of vscode.workspace.workspaceFolders ?? []) {
		roots.push(other.uri);
	}

	return {
		enableScripts: true,
		retainContextWhenHidden: true,
		// VS Code's own find widget, rather than a hand-rolled one in the page.
		enableFindWidget: true,
		localResourceRoots: roots,
	};
}
