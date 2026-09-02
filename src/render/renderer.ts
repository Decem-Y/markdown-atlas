import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import katexPlugin from '@vscode/markdown-it-katex';

/** markdown-it only publishes `Token` through its ESM entry; derive it instead. */
type Token = ReturnType<MarkdownIt['parse']>[number];

export type FrontMatterMode = 'hide' | 'card';

export interface RenderOptions {
	/** Maps an `src`/`href` found in the document to something the webview may load. */
	resolveResource(href: string): string;
	frontMatter: FrontMatterMode;
	math: boolean;
	/** The copy button is preview chrome; an exported file has nothing to wire it to. */
	codeCopyButton?: boolean;
}

export interface RenderResult {
	html: string;
	/** Front matter `title`, else the first heading, else empty. */
	title: string;
}

/**
 * Elements that carry a `data-line` back-reference to the source. This mirrors
 * the set VS Code's own preview annotates, which is what makes scroll sync land
 * on the right block instead of the nearest heading.
 */
const LINE_NUMBER_RULES = [
	'paragraph_open',
	'heading_open',
	'image',
	'code_block',
	'fence',
	'blockquote_open',
	'list_item_open',
	'table_open',
	'hr',
] as const;

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/;

/**
 * Replaces a leading YAML front matter block with the same number of blank
 * lines. Blank lines render to nothing, so the block disappears from the output
 * while every remaining line keeps its original number — no offset arithmetic
 * anywhere downstream.
 */
function stripFrontMatter(text: string): { body: string; data: Map<string, string> } {
	const match = FRONT_MATTER_RE.exec(text);
	const data = new Map<string, string>();
	if (!match) {
		return { body: text, data };
	}

	for (const line of match[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
		if (kv) {
			data.set(kv[1], kv[2].trim().replace(/^["']|["']$/g, ''));
		}
	}

	const blanks = '\n'.repeat(match[0].split('\n').length - 1);
	return { body: blanks + text.slice(match[0].length), data };
}

function slugify(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[\s　]+/g, '-')
		.replace(/[^\p{Letter}\p{Number}\-_]/gu, '')
		.replace(/-{2,}/g, '-')
		.replace(/^-|-$/g, '');
}

function createEngine(options: RenderOptions): MarkdownIt {
	const md = new MarkdownIt({
		html: true,
		linkify: true,
		typographer: false,
		breaks: false,
	});

	addLineNumbers(md);
	addHeadingIds(md);
	addTaskLists(md);
	addFigures(md);
	addResourceResolution(md, options);
	addCodeBlocks(md, options.codeCopyButton !== false);
	addTableScroll(md);

	if (options.math) {
		// Registered last on purpose: the plugin wraps whatever `fence` renderer
		// it finds, so it must see ours in order to delegate non-math fences back.
		md.use(katexPlugin, { enableFencedBlocks: true, throwOnError: false });
	}

	return md;
}

function addLineNumbers(md: MarkdownIt): void {
	for (const rule of LINE_NUMBER_RULES) {
		const original = md.renderer.rules[rule];
		md.renderer.rules[rule] = (tokens, idx, opts, env, self) => {
			const token = tokens[idx];
			if (token.map?.length) {
				token.attrSet('data-line', String(token.map[0]));
				token.attrJoin('class', 'atlas-line');
			}
			return original
				? original(tokens, idx, opts, env, self)
				: self.renderToken(tokens, idx, opts);
		};
	}
}

function addHeadingIds(md: MarkdownIt): void {
	md.core.ruler.push('atlas_heading_ids', state => {
		const seen = new Map<string, number>();
		for (let i = 0; i < state.tokens.length; i++) {
			const token = state.tokens[i];
			if (token.type !== 'heading_open') {
				continue;
			}
			const inline = state.tokens[i + 1];
			const base = slugify(inline?.content ?? '') || 'section';
			const count = seen.get(base) ?? 0;
			seen.set(base, count + 1);
			token.attrSet('id', count === 0 ? base : `${base}-${count}`);
		}
		return true;
	});
}

/**
 * GFM task lists. Small enough to keep in-tree rather than take a dependency
 * that has to be kept in step with markdown-it's token shape.
 */
function addTaskLists(md: MarkdownIt): void {
	md.core.ruler.after('inline', 'atlas_task_lists', state => {
		const tokens = state.tokens;
		for (let i = 2; i < tokens.length; i++) {
			const inline = tokens[i];
			if (
				inline.type !== 'inline' ||
				tokens[i - 1].type !== 'paragraph_open' ||
				tokens[i - 2].type !== 'list_item_open'
			) {
				continue;
			}

			const match = /^\[([ xX])\][ \t]+/.exec(inline.content);
			if (!match) {
				continue;
			}

			inline.content = inline.content.slice(match[0].length);
			const first = inline.children?.[0];
			if (first?.type === 'text') {
				first.content = first.content.replace(/^\[([ xX])\][ \t]+/, '');
			}

			const checked = match[1] !== ' ';
			const box = new state.Token('html_inline', '', 0);
			box.content =
				`<input class="atlas-task" type="checkbox" disabled${checked ? ' checked' : ''}> `;
			inline.children?.unshift(box);

			tokens[i - 2].attrJoin('class', 'atlas-task-item');
		}
		return true;
	});
}

/**
 * A paragraph containing nothing but a single image becomes a `<figure>`, with
 * the alt text lifted into a `<figcaption>`. Carried over from Markdown2Anything,
 * where captioned images are the norm.
 */
function addFigures(md: MarkdownIt): void {
	md.core.ruler.push('atlas_figures', state => {
		const tokens = state.tokens;
		for (let i = 0; i + 2 < tokens.length; i++) {
			if (tokens[i].type !== 'paragraph_open' || tokens[i + 2].type !== 'paragraph_close') {
				continue;
			}
			const inline = tokens[i + 1];
			if (inline.type !== 'inline' || !inline.children) {
				continue;
			}

			const meaningful = inline.children.filter(
				child =>
					child.type !== 'softbreak' &&
					!(child.type === 'text' && child.content.trim() === ''),
			);
			if (meaningful.length !== 1 || meaningful[0].type !== 'image') {
				continue;
			}

			tokens[i].tag = 'figure';
			tokens[i + 2].tag = 'figure';
			tokens[i].attrJoin('class', 'atlas-figure');

			const alt = meaningful[0].content.trim();
			if (alt) {
				const caption = new state.Token('html_inline', '', 0);
				caption.content = `<figcaption>${md.utils.escapeHtml(alt)}</figcaption>`;
				inline.children.push(caption);
			}
		}
		return true;
	});
}

/**
 * Rewrites local image sources so the webview may load them, and tags links so
 * the client can hand them back to the extension host instead of trying (and
 * failing) to navigate the webview itself.
 */
function addResourceResolution(md: MarkdownIt, options: RenderOptions): void {
	const defaultImage = md.renderer.rules.image;
	md.renderer.rules.image = (tokens, idx, opts, env, self) => {
		const token = tokens[idx];
		const src = token.attrGet('src');
		if (src) {
			token.attrSet('src', options.resolveResource(src));
		}
		// markdown-it keeps the alt text in the token's children, not in an attr.
		const alt = token.content;
		if (alt && !token.attrGet('alt')) {
			token.attrSet('alt', alt);
		}
		return defaultImage
			? defaultImage(tokens, idx, opts, env, self)
			: self.renderToken(tokens, idx, opts);
	};

	const defaultLink = md.renderer.rules.link_open;
	md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
		const token = tokens[idx];
		const href = token.attrGet('href');
		if (href && !href.startsWith('#')) {
			token.attrSet('data-href', href);
		}
		return defaultLink
			? defaultLink(tokens, idx, opts, env, self)
			: self.renderToken(tokens, idx, opts);
	};
}

const CODE_DOTS =
	'<span class="atlas-dot atlas-dot-red"></span>' +
	'<span class="atlas-dot atlas-dot-amber"></span>' +
	'<span class="atlas-dot atlas-dot-green"></span>';

function highlight(code: string, language: string, md: MarkdownIt): string {
	if (language && hljs.getLanguage(language)) {
		try {
			return hljs.highlight(code, { language, ignoreIllegals: true }).value;
		} catch {
			// fall through to plain text
		}
	}
	return md.utils.escapeHtml(code);
}

function addCodeBlocks(md: MarkdownIt, copyButton: boolean): void {
	const renderBlock = (token: Token, content: string, info: string): string => {
		const language = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
		const known = language && hljs.getLanguage(language) ? language : '';
		const line = token.map?.length ? ` data-line="${token.map[0]}"` : '';
		const body = highlight(content.replace(/\n$/, ''), known, md);

		return (
			`<div class="atlas-code atlas-line"${line}>` +
			`<div class="atlas-code-chrome">` +
			`<span class="atlas-dots">${CODE_DOTS}</span>` +
			`<span class="atlas-code-lang">${md.utils.escapeHtml(known || language)}</span>` +
			(copyButton
				? `<button type="button" class="atlas-copy" title="Copy">Copy</button>`
				: '') +
			`</div>` +
			`<pre><code class="hljs${known ? ` language-${known}` : ''}">${body}</code></pre>` +
			`</div>\n`
		);
	};

	md.renderer.rules.fence = (tokens, idx) =>
		renderBlock(tokens[idx], tokens[idx].content, tokens[idx].info);

	md.renderer.rules.code_block = (tokens, idx) =>
		renderBlock(tokens[idx], tokens[idx].content, '');
}

/**
 * Wraps tables so a wide table scrolls inside the column instead of stretching
 * the whole article.
 */
function addTableScroll(md: MarkdownIt): void {
	const defaultOpen = md.renderer.rules.table_open;
	md.renderer.rules.table_open = (tokens, idx, opts, env, self) => {
		const rendered = defaultOpen
			? defaultOpen(tokens, idx, opts, env, self)
			: self.renderToken(tokens, idx, opts);
		return `<div class="atlas-table-scroll">${rendered}`;
	};
	md.renderer.rules.table_close = (tokens, idx, opts, env, self) =>
		`${self.renderToken(tokens, idx, opts)}</div>`;
}

function renderFrontMatterCard(data: Map<string, string>, md: MarkdownIt): string {
	if (data.size === 0) {
		return '';
	}
	const rows = [...data]
		.map(
			([key, value]) =>
				`<div class="atlas-fm-row">` +
				`<span class="atlas-fm-key">${md.utils.escapeHtml(key)}</span>` +
				`<span class="atlas-fm-value">${md.utils.escapeHtml(value)}</span>` +
				`</div>`,
		)
		.join('');
	return `<div class="atlas-front-matter">${rows}</div>`;
}

export function render(text: string, options: RenderOptions): RenderResult {
	const md = createEngine(options);
	const { body, data } = stripFrontMatter(text);

	const html = md.render(body);

	let title = data.get('title') ?? '';
	if (!title) {
		const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(body);
		title = heading ? heading[1].trim() : '';
	}

	const card = options.frontMatter === 'card' ? renderFrontMatterCard(data, md) : '';
	return { html: card + html, title };
}
