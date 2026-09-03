// @ts-check
/* Markdown Atlas — preview client.
 *
 * Owns everything that has to happen inside the webview: swapping in freshly
 * rendered HTML, the two-way scroll sync, the outline and custom-CSS panels,
 * table display mode, zoom, and handing links, double-clicks and export
 * requests back to the extension host.
 *
 * Find-in-page is deliberately absent: the panel is created with
 * `enableFindWidget`, so Ctrl/Cmd+F opens VS Code's own find widget.
 */
(function () {
	'use strict';

	const vscode = acquireVsCodeApi();

	const $ = id => document.getElementById(id);

	const content = $('atlas-content');
	const toolbar = $('atlas-toolbar');
	const outline = $('atlas-outline');
	const outlinePanel = $('atlas-outline-panel');
	const stylePanel = $('atlas-style-panel');
	const themeSelect = /** @type {HTMLSelectElement} */ ($('atlas-theme-select'));
	const themeLink = $('atlas-theme-link');
	const customStyle = $('atlas-custom-style');
	const cssInput = /** @type {HTMLTextAreaElement} */ ($('atlas-css-input'));
	const zoomLabel = $('atlas-zoom-reset');
	const tableToggle = $('atlas-table-toggle');
	const outlineToggle = $('atlas-outline-toggle');
	const styleToggle = $('atlas-style-toggle');
	const exportButton = $('atlas-export');
	const exportMenu = $('atlas-export-menu');
	const exportPath = /** @type {HTMLInputElement} */ ($('atlas-export-path'));
	const toast = $('atlas-toast');

	const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
	const SCROLL_ECHO_MS = 250;
	const TOAST_MS = 1800;

	const restored = vscode.getState() || {};

	const state = {
		/** @type {{element: Element, line: number}[]} */
		lines: [],
		/** @type {{item: Element, heading: Element}[]} */
		outline: [],
		zoom: typeof restored.zoom === 'number' ? restored.zoom : 1,
		line: typeof restored.line === 'number' ? restored.line : 0,
		resource: typeof restored.resource === 'string' ? restored.resource : '',
		/** 'none' | 'outline' | 'style' */
		panel: restored.panel === 'outline' || restored.panel === 'style' ? restored.panel : 'none',
		tableDisplay: 'scroll',
		/** This preview's own choice, if the toolbar toggle was ever used.
		 *  Empty means "follow the setting". */
		tableDisplayOwn:
			restored.tableDisplayOwn === 'expand' || restored.tableDisplayOwn === 'scroll'
				? restored.tableDisplayOwn
				: '',
		exportPath: typeof restored.exportPath === 'string' ? restored.exportPath : '',
		scrollEditorWithPreview: true,
		doubleClickToSwitchToEditor: false,
		codeScheme: 'auto',
		/** Suppresses our own scroll handler while the extension drives us. */
		hostDrivenUntil: 0,
	};

	// ── helpers ────────────────────────────────────────────────────────────

	function saveState() {
		vscode.setState({
			resource: state.resource,
			line: Math.floor(state.line),
			zoom: state.zoom,
			panel: state.panel,
			exportPath: state.exportPath,
			tableDisplayOwn: state.tableDisplayOwn,
		});
	}

	function toolbarHeight() {
		return toolbar.hidden ? 0 : toolbar.getBoundingClientRect().height;
	}

	function documentTop(element) {
		return element.getBoundingClientRect().top + window.scrollY;
	}

	/** Where the viewport's "current" point sits, below the sticky toolbar. */
	function readingOffset() {
		return window.scrollY + toolbarHeight() + 8;
	}

	function scrollTo(top) {
		state.hostDrivenUntil = Date.now() + SCROLL_ECHO_MS;
		window.scrollTo(0, Math.max(0, top));
	}

	let toastTimer = 0;
	function showToast(message) {
		toast.textContent = message;
		toast.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toast.hidden = true;
		}, TOAST_MS);
	}

	function collectLines() {
		state.lines = Array.prototype.map
			.call(content.querySelectorAll('[data-line]'), element => ({
				element,
				line: Number(element.getAttribute('data-line')),
			}))
			.filter(entry => Number.isFinite(entry.line));
	}

	/** The two annotated elements that bracket `targetLine` in the source. */
	function bracket(targetLine) {
		let previous = state.lines[0];
		for (const entry of state.lines) {
			if (entry.line === targetLine) {
				return { previous: entry, next: undefined };
			}
			if (entry.line > targetLine) {
				return { previous: previous, next: entry };
			}
			previous = entry;
		}
		return { previous: previous, next: undefined };
	}

	function scrollToLine(line) {
		if (state.lines.length === 0) {
			return;
		}
		const { previous, next } = bracket(line);
		if (!previous) {
			return;
		}

		const rect = previous.element.getBoundingClientRect();
		const previousTop = rect.top + window.scrollY;
		let target = previousTop;

		if (next && next.line > previous.line) {
			const progress = (line - previous.line) / (next.line - previous.line);
			const previousEnd = previousTop + rect.height;
			const gap = Math.max(0, documentTop(next.element) - previousEnd);
			target = previousEnd + progress * gap;
		}

		scrollTo(target - toolbarHeight() - 8);
	}

	/** Fractional source line currently sitting at the top of the viewport. */
	function currentLine() {
		if (state.lines.length === 0) {
			return 0;
		}
		const offset = readingOffset();
		let previous = undefined;

		for (const entry of state.lines) {
			const top = documentTop(entry.element);
			if (top > offset) {
				if (!previous) {
					return entry.line;
				}
				const previousTop = documentTop(previous.element);
				const span = top - previousTop;
				const progress = span > 0 ? (offset - previousTop) / span : 0;
				return previous.line + progress * (entry.line - previous.line);
			}
			previous = entry;
		}
		return previous ? previous.line : 0;
	}

	// ── appearance ─────────────────────────────────────────────────────────

	function resolveCodeScheme() {
		if (state.codeScheme !== 'auto') {
			return state.codeScheme;
		}
		const classes = document.body.classList;
		return classes.contains('vscode-dark') || classes.contains('vscode-high-contrast')
			? 'dark'
			: 'light';
	}

	function applyCodeScheme() {
		document.body.setAttribute('data-code-scheme', resolveCodeScheme());
	}

	function applyZoom() {
		document.documentElement.style.setProperty('--atlas-zoom', String(state.zoom));
		zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
		saveState();
	}

	function stepZoom(direction) {
		const index = ZOOM_STEPS.indexOf(state.zoom);
		const from = index === -1 ? ZOOM_STEPS.indexOf(1) : index;
		const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, from + direction));
		state.zoom = ZOOM_STEPS[next];
		applyZoom();
	}

	function applyCustomCss(css) {
		customStyle.textContent = css || '';
	}

	// ── panels ─────────────────────────────────────────────────────────────

	function applyPanel() {
		outlinePanel.hidden = state.panel !== 'outline';
		stylePanel.hidden = state.panel !== 'style';
		outlineToggle.classList.toggle('is-active', state.panel === 'outline');
		styleToggle.classList.toggle('is-active', state.panel === 'style');
		document.body.classList.toggle('atlas-panel-open', state.panel === 'outline');
		document.body.classList.toggle('atlas-panel-open-wide', state.panel === 'style');
		if (state.panel === 'outline') {
			updateOutlineActive();
		}
		saveState();
	}

	function togglePanel(name) {
		state.panel = state.panel === name ? 'none' : name;
		applyPanel();
	}

	// ── outline ────────────────────────────────────────────────────────────

	function buildOutline() {
		const headings = content.querySelectorAll('h1, h2, h3, h4, h5, h6');
		state.outline = [];

		if (headings.length === 0) {
			outline.replaceChildren();
			const empty = document.createElement('p');
			empty.className = 'atlas-outline-empty';
			empty.textContent = '没有标题';
			outline.appendChild(empty);
			return;
		}

		const list = document.createElement('ul');
		list.className = 'atlas-outline-list';

		headings.forEach(heading => {
			const item = document.createElement('li');
			item.className = 'atlas-outline-item atlas-outline-h' + heading.tagName.charAt(1);

			const link = document.createElement('a');
			link.textContent = heading.textContent || '';
			link.title = heading.textContent || '';
			link.addEventListener('click', event => {
				event.preventDefault();
				scrollTo(documentTop(heading) - toolbarHeight() - 8);
				const line = Number(heading.getAttribute('data-line'));
				if (Number.isFinite(line) && state.scrollEditorWithPreview) {
					vscode.postMessage({ type: 'revealLine', line: line });
				}
				updateOutlineActive();
			});

			item.appendChild(link);
			list.appendChild(item);
			state.outline.push({ item: item, heading: heading });
		});

		outline.replaceChildren(list);
		updateOutlineActive();
	}

	/** Highlights the last heading at or above the reading offset. */
	function updateOutlineActive() {
		if (state.panel !== 'outline' || state.outline.length === 0) {
			return;
		}
		const offset = readingOffset();
		let active = null;
		for (const entry of state.outline) {
			if (documentTop(entry.heading) - 4 <= offset) {
				active = entry;
			}
		}
		for (const entry of state.outline) {
			entry.item.classList.toggle('is-active', entry === active);
		}
	}

	// ── tables ─────────────────────────────────────────────────────────────

	function applyTableDisplay() {
		const expanded = state.tableDisplay === 'expand';
		document.body.classList.toggle('atlas-tables-expanded', expanded);
		tableToggle.textContent = expanded ? '▦ 展开' : '▦ 滚动';
		tableToggle.classList.toggle('is-active', expanded);
	}

	function refreshTableToggle() {
		tableToggle.hidden = !content.querySelector('table');
	}

	// ── export menu ────────────────────────────────────────────────────────

	function setExportMenu(open) {
		exportMenu.hidden = !open;
		exportButton.setAttribute('aria-expanded', String(open));
		exportButton.classList.toggle('is-active', open);
		if (open) {
			exportPath.value = state.exportPath;
		}
	}

	function runExport(format) {
		state.exportPath = exportPath.value.trim();
		saveState();
		setExportMenu(false);
		vscode.postMessage({
			type: 'export',
			format: format,
			outputPath: state.exportPath,
		});
	}

	// ── code blocks ────────────────────────────────────────────────────────

	function copyCode(button) {
		const block = button.closest('.atlas-code');
		const code = block && block.querySelector('code');
		if (!code) {
			return;
		}

		const text = code.textContent || '';
		const done = () => {
			const original = button.textContent;
			button.textContent = '已复制';
			button.classList.add('is-copied');
			setTimeout(() => {
				button.textContent = original;
				button.classList.remove('is-copied');
			}, 1200);
		};

		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
		} else {
			fallbackCopy(text, done);
		}
	}

	function fallbackCopy(text, done) {
		const area = document.createElement('textarea');
		area.value = text;
		area.setAttribute('readonly', '');
		area.className = 'atlas-offscreen';
		document.body.appendChild(area);
		area.select();
		try {
			document.execCommand('copy');
			done();
		} finally {
			area.remove();
		}
	}

	// ── events ─────────────────────────────────────────────────────────────

	let scrollFrame = 0;
	window.addEventListener('scroll', () => {
		if (scrollFrame) {
			return;
		}
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = 0;
			state.line = currentLine();
			updateOutlineActive();
			saveState();
			if (Date.now() < state.hostDrivenUntil || !state.scrollEditorWithPreview) {
				return;
			}
			vscode.postMessage({ type: 'revealLine', line: state.line });
		});
	});

	document.addEventListener('click', event => {
		const target = /** @type {Element} */ (event.target);

		// Any click outside the export menu dismisses it, including one that
		// goes on to be handled below.
		if (!exportMenu.hidden && !target.closest('.atlas-menu-wrap')) {
			setExportMenu(false);
		}

		const formatItem = target.closest('[data-format]');
		if (formatItem) {
			runExport(formatItem.getAttribute('data-format'));
			return;
		}

		const copyButton = target.closest('.atlas-copy');
		if (copyButton) {
			copyCode(copyButton);
			return;
		}

		const closer = target.closest('[data-close-panel]');
		if (closer) {
			state.panel = 'none';
			applyPanel();
			return;
		}

		const anchor = target.closest('a');
		if (!anchor) {
			return;
		}

		const hash = anchor.getAttribute('href');
		if (hash && hash.startsWith('#')) {
			event.preventDefault();
			const heading = document.getElementById(decodeURIComponent(hash.slice(1)));
			if (heading) {
				scrollTo(documentTop(heading) - toolbarHeight() - 8);
			}
			return;
		}

		const href = anchor.getAttribute('data-href');
		if (href) {
			event.preventDefault();
			vscode.postMessage({ type: 'openLink', href: href });
		}
	});

	content.addEventListener('dblclick', event => {
		if (!state.doubleClickToSwitchToEditor) {
			return;
		}
		const target = /** @type {Element} */ (event.target);
		const block = target.closest('[data-line]');
		if (!block) {
			return;
		}
		const line = Number(block.getAttribute('data-line'));
		if (Number.isFinite(line)) {
			vscode.postMessage({ type: 'openSource', line: line });
		}
	});

	themeSelect.addEventListener('change', () => {
		vscode.postMessage({ type: 'setTheme', theme: themeSelect.value });
	});

	outlineToggle.addEventListener('click', () => togglePanel('outline'));
	styleToggle.addEventListener('click', () => togglePanel('style'));

	// Per preview, not a setting: which way one wide table is easier to read is
	// a property of that document, and rewriting a global setting from a view
	// toggle would change every other preview along with it.
	tableToggle.addEventListener('click', () => {
		state.tableDisplayOwn = state.tableDisplay === 'expand' ? 'scroll' : 'expand';
		state.tableDisplay = state.tableDisplayOwn;
		applyTableDisplay();
		saveState();
	});

	$('atlas-sync-to-preview').addEventListener('click', () => {
		vscode.postMessage({ type: 'requestCursorLine' });
	});

	$('atlas-sync-to-editor').addEventListener('click', () => {
		vscode.postMessage({ type: 'revealLine', line: currentLine(), force: true });
	});

	exportButton.addEventListener('click', () => setExportMenu(exportMenu.hidden));

	exportPath.addEventListener('input', () => {
		state.exportPath = exportPath.value;
		saveState();
	});

	document.addEventListener('keydown', event => {
		if (event.key === 'Escape' && !exportMenu.hidden) {
			setExportMenu(false);
			exportButton.focus();
		}
	});

	$('atlas-zoom-in').addEventListener('click', () => stepZoom(1));
	$('atlas-zoom-out').addEventListener('click', () => stepZoom(-1));
	zoomLabel.addEventListener('click', () => {
		state.zoom = 1;
		applyZoom();
	});

	$('atlas-css-apply').addEventListener('click', () => {
		const css = cssInput.value;
		applyCustomCss(css);
		vscode.postMessage({ type: 'setCustomCss', css: css });
		showToast('自定义 CSS 已应用');
	});

	$('atlas-css-reset').addEventListener('click', () => {
		cssInput.value = '';
		applyCustomCss('');
		vscode.postMessage({ type: 'setCustomCss', css: '' });
		showToast('自定义 CSS 已清空');
	});

	// The toolbar wraps on a narrow panel, so its height is not a constant.
	if (typeof ResizeObserver === 'function') {
		new ResizeObserver(() => {
			document.documentElement.style.setProperty(
				'--atlas-toolbar-h',
				toolbarHeight() + 'px',
			);
		}).observe(toolbar);
	}

	// VS Code re-themes the webview by swapping classes on <body>; the `editor`
	// theme has to follow that without a round trip to the extension host.
	new MutationObserver(applyCodeScheme).observe(document.body, {
		attributes: true,
		attributeFilter: ['class'],
	});

	window.addEventListener('message', event => {
		const message = event.data;
		switch (message.type) {
			case 'settings': {
				state.scrollEditorWithPreview = message.scrollEditorWithPreview !== false;
				state.doubleClickToSwitchToEditor =
					message.doubleClickToSwitchToEditor === true;
				state.codeScheme = message.codeScheme || 'auto';
				if (message.resource) {
					state.resource = message.resource;
				}

				toolbar.hidden = message.showToolbar === false;
				document.documentElement.style.setProperty(
					'--atlas-font-size',
					message.fontSize + 'px',
				);
				document.documentElement.style.setProperty(
					'--atlas-line-width',
					message.lineWidth + 'px',
				);

				// Only overwrite the editor while the user is not mid-edit in it.
				const css = message.customCss || '';
				if (document.activeElement !== cssInput) {
					cssInput.value = css;
				}
				applyCustomCss(css);

				// The configured path seeds the field; once the user types their own
				// one-off destination, it wins until they clear it again.
				if (!state.exportPath && message.exportOutputPath) {
					state.exportPath = message.exportOutputPath;
					if (document.activeElement !== exportPath) {
						exportPath.value = state.exportPath;
					}
				}

				// The setting is only the default; this preview's own toggle wins.
				state.tableDisplay =
					state.tableDisplayOwn ||
					(message.tableDisplay === 'expand' ? 'expand' : 'scroll');
				applyTableDisplay();

				if (Array.isArray(message.themes)) {
					const active = message.theme;
					themeSelect.replaceChildren(
						...message.themes.map(theme => {
							const option = document.createElement('option');
							option.value = theme.id;
							option.textContent = theme.label;
							option.selected = theme.id === active;
							return option;
						}),
					);
					const match = message.themes.find(theme => theme.id === active);
					if (match && themeLink.getAttribute('href') !== match.href) {
						themeLink.setAttribute('href', match.href);
					}
				}

				applyCodeScheme();
				applyZoom();
				break;
			}

			case 'update': {
				const previousLine = typeof message.line === 'number' ? message.line : state.line;
				content.innerHTML = message.html;
				collectLines();
				buildOutline();
				refreshTableToggle();
				scrollToLine(previousLine);
				break;
			}

			case 'scrollToLine': {
				if (typeof message.line === 'number') {
					scrollToLine(message.line);
				}
				break;
			}

			case 'toast': {
				showToast(message.message);
				break;
			}

			case 'error': {
				content.replaceChildren();
				const box = document.createElement('p');
				box.className = 'atlas-error';
				box.textContent = 'Markdown Atlas 无法渲染这个文件：' + message.message;
				content.appendChild(box);
				break;
			}
		}
	});

	applyPanel();
	applyTableDisplay();
	applyZoom();
	applyCodeScheme();
	vscode.postMessage({ type: 'ready' });
})();
