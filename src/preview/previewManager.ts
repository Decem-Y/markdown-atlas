import * as vscode from 'vscode';
import { PREVIEW_VIEW_TYPE, PreviewPanel, type PreviewSnapshot } from './previewPanel';

export class PreviewManager implements vscode.Disposable, vscode.WebviewPanelSerializer {
	private readonly panels = new Map<string, PreviewPanel>();

	constructor(private readonly context: vscode.ExtensionContext) {}

	show(resource: vscode.Uri, viewColumn: vscode.ViewColumn, preserveFocus: boolean): void {
		const key = resource.toString();
		const existing = this.panels.get(key);
		if (existing) {
			existing.reveal(existing.viewColumn ?? viewColumn, preserveFocus);
			return;
		}

		this.track(PreviewPanel.create(this.context, resource, viewColumn, preserveFocus));
	}

	/** The document behind the focused preview panel, if one has focus. */
	activeResource(): vscode.Uri | undefined {
		for (const panel of this.panels.values()) {
			if (panel.active) {
				return panel.resource;
			}
		}
		return undefined;
	}

	refresh(resource?: vscode.Uri): void {
		if (resource) {
			this.panels.get(resource.toString())?.refresh();
			return;
		}
		for (const panel of this.panels.values()) {
			panel.refresh();
		}
	}

	async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
		const snapshot = state as PreviewSnapshot | undefined;
		if (!snapshot?.resource) {
			panel.dispose();
			return;
		}

		const key = vscode.Uri.parse(snapshot.resource).toString();
		if (this.panels.has(key)) {
			// A preview for this document was already restored; drop the duplicate.
			panel.dispose();
			return;
		}

		this.track(
			PreviewPanel.revive(this.context, panel, {
				resource: snapshot.resource,
				line: typeof snapshot.line === 'number' ? snapshot.line : 0,
			}),
		);
	}

	dispose(): void {
		for (const panel of [...this.panels.values()]) {
			panel.dispose();
		}
		this.panels.clear();
	}

	private track(preview: PreviewPanel): void {
		const key = preview.resource.toString();
		this.panels.set(key, preview);
		preview.onDidDispose(() => {
			if (this.panels.get(key) === preview) {
				this.panels.delete(key);
			}
		});
	}

	static readonly viewType = PREVIEW_VIEW_TYPE;
}
