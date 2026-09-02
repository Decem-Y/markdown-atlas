import * as assert from 'assert';
import * as os from 'os';
import * as vscode from 'vscode';
import { buildStandaloneHtml } from '../export/document';
import type { AtlasConfig } from '../config';
import { resolveTarget } from '../export';
import { decodeFrames, findBrowser } from '../export/pdf';

type Config = AtlasConfig;

const BASE_CONFIG: Config = {
	theme: 'macos',
	fontSize: 17,
	lineWidth: 800,
	scrollPreviewWithEditor: true,
	scrollEditorWithPreview: true,
	doubleClickToSwitchToEditor: true,
	showToolbar: true,
	tableDisplay: 'scroll',
	math: true,
	frontMatter: 'hide',
	customCss: '.atlas-content h1 { color: #ff0000; }',
	exportOutputPath: '',
	exportEmbedImages: true,
	chromePath: '',
	pdfPageSize: 'A4',
	pdfMargin: '16mm',
};

// 1×1 transparent PNG.
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

let extensionUri: vscode.Uri;
let workDir: vscode.Uri;
let docUri: vscode.Uri;

suite('export', () => {
	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension('decemy.markdown-atlas');
		assert.ok(extension, 'extension decemy.markdown-atlas was not found');
		extensionUri = extension.extensionUri;

		workDir = vscode.Uri.joinPath(vscode.Uri.file(os.tmpdir()), 'markdown-atlas-export-test');
		docUri = vscode.Uri.joinPath(workDir, 'doc.md');
		await vscode.workspace.fs.createDirectory(workDir);
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(workDir, 'pic.png'), PNG);
	});

	suiteTeardown(async () => {
		await vscode.workspace.fs.delete(workDir, { recursive: true, useTrash: false });
	});

	test('produces a standalone document with the theme and custom CSS inlined', async () => {
		const html = await buildStandaloneHtml(
			extensionUri,
			docUri,
			'# Title\n\nSome text.',
			BASE_CONFIG,
		);

		assert.ok(html.startsWith('<!DOCTYPE html>'));
		assert.ok(html.includes('<title>Title</title>'));
		assert.ok(html.includes('.atlas-table-scroll'), 'base.css was not inlined');
		assert.ok(html.includes('macOS Minimal'), 'the theme stylesheet was not inlined');
		assert.ok(html.includes('.atlas-content h1 { color: #ff0000; }'), 'custom CSS is missing');
		assert.ok(html.includes('--atlas-font-size: 17px'));
		assert.ok(html.includes('--atlas-line-width: 800px'));
		assert.ok(!html.includes('<link'), 'the export still references external stylesheets');
	});

	test('omits preview-only chrome', async () => {
		const html = await buildStandaloneHtml(extensionUri, docUri, '```js\nlet a = 1;\n```', BASE_CONFIG);

		assert.ok(html.includes('atlas-code-lang'), 'the code block chrome is missing');
		assert.ok(!html.includes('class="atlas-copy"'), 'the copy button leaked into the export');
		assert.ok(!html.includes('atlas-toolbar'), 'preview chrome CSS leaked into the export');
	});

	test('embeds local images and leaves remote ones alone', async () => {
		const html = await buildStandaloneHtml(
			extensionUri,
			docUri,
			'![local](./pic.png)\n\n![remote](https://example.com/x.png)',
			BASE_CONFIG,
		);

		assert.ok(html.includes('src="data:image/png;base64,'), 'the local image was not embedded');
		assert.ok(html.includes('src="https://example.com/x.png"'));
	});

	test('leaves image paths alone when embedding is off', async () => {
		const html = await buildStandaloneHtml(extensionUri, docUri, '![local](./pic.png)', {
			...BASE_CONFIG,
			exportEmbedImages: false,
		});

		assert.ok(!html.includes('data:image/png'));
		assert.ok(html.includes('src="./pic.png"'));
	});

	test('ships KaTeX only for documents that use math', async () => {
		const withMath = await buildStandaloneHtml(extensionUri, docUri, '$E = mc^2$', BASE_CONFIG);
		assert.ok(withMath.includes('KaTeX_Main'), 'KaTeX CSS is missing from a math document');
		assert.ok(
			withMath.includes('url(data:font/woff2;base64,'),
			'KaTeX fonts were not inlined',
		);
		assert.ok(!withMath.includes('url(fonts/'), 'a relative font url survived');

		const withoutMath = await buildStandaloneHtml(
			extensionUri,
			docUri,
			'Just prose.',
			BASE_CONFIG,
		);
		assert.ok(!withoutMath.includes('KaTeX_Main'), 'KaTeX CSS was shipped needlessly');
	});

	test('resolves the auto code scheme, which an exported file cannot follow', async () => {
		const editor = await buildStandaloneHtml(extensionUri, docUri, 'text', {
			...BASE_CONFIG,
			theme: 'editor',
		});
		assert.ok(editor.includes('data-code-scheme="light"'));
	});

	test('resolves export destinations from a typed or configured path', () => {
		const doc = vscode.Uri.file('/work/notes/guide.md');
		const at = (requested: string, format: 'html' | 'pdf') =>
			resolveTarget(doc, requested, format).path;

		// Empty means beside the source file — the one-click default.
		assert.strictEqual(at('', 'html'), '/work/notes/guide.html');
		assert.strictEqual(at('', 'pdf'), '/work/notes/guide.pdf');

		// A directory, relative or absolute, keeps the document's name.
		assert.strictEqual(at('../out', 'html'), '/work/out/guide.html');
		assert.strictEqual(at('/tmp/exports', 'pdf'), '/tmp/exports/guide.pdf');
		assert.strictEqual(at('build/', 'html'), '/work/notes/build/guide.html');

		// A filename is honoured, but the extension always matches the format,
		// so a PDF never lands inside a file called .html.
		assert.strictEqual(at('../out/article.html', 'html'), '/work/out/article.html');
		assert.strictEqual(at('../out/article.html', 'pdf'), '/work/out/article.pdf');
	});

	test('the PDF variant carries print rules and forces image embedding', async () => {
		const source = '![local](./pic.png)\n\nText.';
		const print = { print: { pageSize: 'A5', margin: '9mm' } };

		const html = await buildStandaloneHtml(extensionUri, docUri, source, BASE_CONFIG, print);
		assert.ok(html.includes('size: A5;'), 'the configured page size is missing');
		assert.ok(html.includes('margin: 9mm;'), 'the configured margin is missing');
		assert.ok(
			html.includes('print-color-adjust: exact'),
			'without this the printer drops every theme background',
		);

		// The PDF is printed from a document injected into a blank frame, which has
		// no base URL for a relative image path to resolve against — so embedding
		// has to happen even when it is off.
		const optedOut = await buildStandaloneHtml(
			extensionUri,
			docUri,
			source,
			{ ...BASE_CONFIG, exportEmbedImages: false },
			print,
		);
		assert.ok(optedOut.includes('src="data:image/png;base64,'));
	});

	test('the HTML variant carries no print rules', async () => {
		const html = await buildStandaloneHtml(extensionUri, docUri, 'Text.', BASE_CONFIG);
		assert.ok(!html.includes('@page'));
	});

	test('a browser path that is not an executable is reported, not guessed past', async () => {
		await assert.rejects(
			() => findBrowser(vscode.Uri.joinPath(workDir, 'not-a-browser').fsPath),
			/not an executable file/,
		);
	});

	test('protocol frames survive being split across chunks', () => {
		const feed = (chunks: Buffer[]): string[] => {
			let tail: Buffer = Buffer.alloc(0);
			const seen: string[] = [];
			for (const chunk of chunks) {
				const decoded = decodeFrames(tail, chunk);
				tail = decoded.tail;
				seen.push(...decoded.frames);
			}
			assert.strictEqual(tail.length, 0, 'a whole frame was left unread');
			return seen;
		};

		const wire = Buffer.from(
			'{"id":1,"error":{"message":"数学"}}\0{"id":2,"result":{"data":"AA"}}\0',
			'utf8',
		);
		const whole = feed([wire]);
		assert.deepStrictEqual(whole, [
			'{"id":1,"error":{"message":"数学"}}',
			'{"id":2,"result":{"data":"AA"}}',
		]);

		// The real connection delivers a megabyte of base64 in chunks that fall
		// wherever they like — including mid-frame and mid-codepoint.
		const split = [wire.subarray(0, 29), wire.subarray(29, 40), wire.subarray(40)];
		assert.deepStrictEqual(feed(split), whole);

		// A chunk with no terminator yields nothing and loses nothing.
		const partial = decodeFrames(Buffer.alloc(0), Buffer.from('{"id":', 'utf8'));
		assert.deepStrictEqual(partial.frames, []);
		assert.strictEqual(partial.tail.toString('utf8'), '{"id":');
	});
});
