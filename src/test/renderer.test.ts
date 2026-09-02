import * as assert from 'assert';
import { render } from '../render/renderer';

// Mirrors what PreviewPanel does: local paths get mapped into the webview,
// anything already carrying a scheme is passed through untouched.
const options = {
	resolveResource: (href: string) =>
		/^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `webview:/${href}`,
	frontMatter: 'hide' as const,
	math: true,
};

suite('renderer', () => {
	test('front matter is removed without shifting source lines', () => {
		const text = ['---', 'title: Doc', '---', '', '# Heading', '', 'Body.'].join('\n');
		const { html, title } = render(text, options);

		assert.strictEqual(title, 'Doc');
		assert.ok(!html.includes('title: Doc'), 'front matter leaked into the output');
		// `# Heading` is the fifth line of the source (zero-based: 4).
		assert.match(html, /<h1 id="heading" data-line="4"/);
	});

	test('front matter renders as a card when configured', () => {
		const text = ['---', 'title: Doc', 'author: decem', '---', '', 'Body.'].join('\n');
		const { html } = render(text, { ...options, frontMatter: 'card' });

		assert.ok(html.includes('atlas-front-matter'));
		assert.ok(html.includes('decem'));
	});

	test('block elements carry data-line back-references', () => {
		const text = ['Para one.', '', '> quote', '', '- item', '', '```js', 'let a = 1;', '```'].join(
			'\n',
		);
		const { html } = render(text, options);

		assert.match(html, /<p data-line="0"/);
		assert.match(html, /<blockquote data-line="2"/);
		assert.match(html, /<li data-line="4"/);
		assert.match(html, /class="atlas-code atlas-line" data-line="6"/);
	});

	test('task list items become checkboxes', () => {
		const { html } = render('- [ ] todo\n- [x] done', options);

		assert.ok(html.includes('class="atlas-task" type="checkbox" disabled>'));
		assert.ok(html.includes('class="atlas-task" type="checkbox" disabled checked>'));
		assert.ok(!html.includes('[ ]'), 'the raw checkbox marker survived');
	});

	test('a lone image becomes a captioned figure, an inline one does not', () => {
		const figure = render('![Caption](./a.png)', options).html;
		assert.match(figure, /<figure class="atlas-figure atlas-line"/);
		assert.ok(figure.includes('<figcaption>Caption</figcaption>'));

		const inline = render('text ![icon](./a.png) more', options).html;
		assert.ok(!inline.includes('<figure'), 'an inline image was promoted to a figure');
	});

	test('image sources go through the host resolver', () => {
		const { html } = render('![](./a.png)\n\n![](https://example.com/b.png)', options);

		assert.ok(html.includes('src="webview:/./a.png"'));
		assert.ok(html.includes('src="https://example.com/b.png"'));
	});

	test('links are tagged for the host to open', () => {
		const { html } = render('[x](./other.md) and [y](https://example.com)', options);

		assert.ok(html.includes('data-href="./other.md"'));
		assert.ok(html.includes('data-href="https://example.com"'));
	});

	test('tables are wrapped in a horizontal scroll container', () => {
		const { html } = render('| a | b |\n| --- | --- |\n| 1 | 2 |', options);

		assert.match(html, /<div class="atlas-table-scroll"><table/);
		assert.match(html, /<\/table>\s*<\/div>/);
	});

	test('math renders through KaTeX only when enabled', () => {
		assert.ok(render('$E = mc^2$', options).html.includes('katex'));
		assert.ok(!render('$E = mc^2$', { ...options, math: false }).html.includes('katex'));
	});

	test('fenced code is highlighted and labelled', () => {
		const { html } = render('```ts\nexport const a = 1;\n```', options);

		assert.ok(html.includes('atlas-code-lang">ts<'));
		assert.ok(html.includes('hljs-keyword'), 'code was not highlighted');
	});
});
