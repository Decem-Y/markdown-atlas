import * as assert from 'assert';
import * as vscode from 'vscode';
import { writeTarget } from '../config';
import { remapResource } from '../preview/previewPanel';

const uri = (path: string) => vscode.Uri.file(path);

suite('settings write scope', () => {
	test('follows the layer the value is already defined in', () => {
		assert.strictEqual(
			writeTarget({ workspaceFolderValue: 'academic', workspaceValue: 'notion' }),
			vscode.ConfigurationTarget.WorkspaceFolder,
		);
		assert.strictEqual(
			writeTarget({ workspaceValue: 'notion' }),
			vscode.ConfigurationTarget.Workspace,
		);
	});

	test('falls back to user settings when nothing else defines it', () => {
		assert.strictEqual(writeTarget(undefined), vscode.ConfigurationTarget.Global);
		assert.strictEqual(writeTarget({}), vscode.ConfigurationTarget.Global);
	});

	test('an explicitly empty workspace value still counts as defined', () => {
		assert.strictEqual(
			writeTarget({ workspaceValue: '' }),
			vscode.ConfigurationTarget.Workspace,
		);
	});
});

suite('rename tracking', () => {
	test('follows the file itself', () => {
		const moved = remapResource(uri('/w/docs/a.md'), uri('/w/docs/a.md'), uri('/w/docs/b.md'));
		assert.strictEqual(moved?.path, '/w/docs/b.md');
	});

	test('follows a folder renamed above it', () => {
		const moved = remapResource(uri('/w/docs/deep/a.md'), uri('/w/docs'), uri('/w/notes'));
		assert.strictEqual(moved?.path, '/w/notes/deep/a.md');
	});

	test('ignores a sibling whose path is only a string prefix', () => {
		assert.strictEqual(
			remapResource(uri('/w/docs-old/a.md'), uri('/w/docs'), uri('/w/notes')),
			undefined,
		);
	});

	test('ignores an unrelated rename', () => {
		assert.strictEqual(
			remapResource(uri('/w/docs/a.md'), uri('/w/other/c.md'), uri('/w/other/d.md')),
			undefined,
		);
	});

	test('ignores a rename on a different scheme', () => {
		assert.strictEqual(
			remapResource(uri('/w/a.md'), vscode.Uri.parse('untitled:/w/a.md'), uri('/w/b.md')),
			undefined,
		);
	});
});
