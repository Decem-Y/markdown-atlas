import { spawn, type ChildProcess } from 'child_process';
import { promises as fs, constants as fsConstants } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface PdfOptions {
	/** `markdownAtlas.export.chromePath`; empty means "go and find one". */
	chromePath: string;
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
/** How long a browser gets to wind itself down before it is killed outright. */
const SHUTDOWN_MS = 5_000;

/**
 * Run in the page just before printing.
 *
 * The KaTeX faces arrive as data: URIs, so there is no network to wait on — but
 * they are still decoded asynchronously, and printing before they land lays the
 * maths out with fallback metrics. Two frames after that is the usual belt and
 * braces for "the first paint has actually happened".
 */
const WAIT_FOR_PAINT = `new Promise(resolve => {
	const settle = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
	if (document.fonts && document.fonts.ready) {
		document.fonts.ready.then(settle, settle);
	} else {
		settle();
	}
})`;

/**
 * Renders a self-contained HTML string to PDF using a Chromium-family browser
 * already installed on the machine.
 *
 * Nothing is bundled: shipping a browser is what makes an extension like this a
 * multi-megabyte download. The browser is driven over the DevTools protocol
 * instead of the `--print-to-pdf` switch, which looks simpler and is not:
 * the switch has no way to wait for webfonts, no way to turn backgrounds off,
 * page geometry only through CSS, and on current Chrome the process keeps
 * running after the file is written, so there is nothing to wait for.
 *
 * The protocol goes over a pipe rather than a debugging port: `--remote-
 * debugging-port` needs a WebSocket client, and Node did not have a global
 * `WebSocket` until v22 — VS Code 1.90, the floor in `engines`, ships Node 20.
 * The pipe is a pair of file descriptors carrying NUL-delimited JSON, so it
 * costs no dependency and opens no socket.
 */
export async function renderPdf(
	html: string,
	target: vscode.Uri,
	options: PdfOptions,
): Promise<void> {
	const browser = await findBrowser(options.chromePath);
	const name = path.basename(browser);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	// A throwaway profile per launch, never the user's own. Two browsers sharing
	// a --user-data-dir is not a slow path, it is a failure: the second exits
	// with code 21 on the profile lock and writes no PDF.
	const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-atlas-'));
	const session = launch(browser, name, profileDir);

	let pdf: Buffer;
	try {
		pdf = await withDeadline(
			print(session, html),
			timeoutMs,
			`${name} 在 ${Math.round(timeoutMs / 1000)} 秒内没有完成打印。`,
		);
	} finally {
		await session.close();
		await fs.rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
	}

	// Written through the workspace API rather than fs, so an export can land on
	// a remote or virtual file system.
	await vscode.workspace.fs.writeFile(target, pdf);
}

/* ── the conversation ─────────────────────────────────────────────────── */

interface CreatedTarget { targetId: string }
interface AttachedSession { sessionId: string }
interface FrameTree { frameTree: { frame: { id: string } } }
interface PrintedPdf { data: string }

async function print(session: Session, html: string): Promise<Buffer> {
	const { targetId } = await session.send<CreatedTarget>('Target.createTarget', {
		url: 'about:blank',
	});
	// `flatten` puts the session id in each command instead of tunnelling
	// messages through Target.sendMessageToTarget, which is deprecated.
	const { sessionId } = await session.send<AttachedSession>('Target.attachToTarget', {
		targetId,
		flatten: true,
	});

	await session.send('Page.enable', {}, sessionId);
	const { frameTree } = await session.send<FrameTree>('Page.getFrameTree', {}, sessionId);

	// The HTML goes straight in. A data: URL also works but is several times
	// slower on a large document, and a temp file would only add a path to get
	// wrong on Windows.
	await session.send(
		'Page.setDocumentContent',
		{ frameId: frameTree.frame.id, html },
		sessionId,
	);
	await session.send(
		'Runtime.evaluate',
		{ expression: WAIT_FOR_PAINT, awaitPromise: true },
		sessionId,
	);

	const { data } = await session.send<PrintedPdf>(
		'Page.printToPDF',
		{
			// Without this the root canvas prints white however the CSS asks;
			// `print-color-adjust: exact` alone does not cover it.
			printBackground: true,
			// Page size and margins stay in the `@page` rule the export writes,
			// so there is one place to look when a document comes out wrong.
			preferCSSPageSize: true,
			displayHeaderFooter: false,
			transferMode: 'ReturnAsBase64',
		},
		sessionId,
	);

	const pdf = Buffer.from(data, 'base64');
	if (!pdf.byteLength) {
		throw new Error(`${session.name} 返回了一个空的 PDF。`);
	}
	return pdf;
}

/* ── the pipe ─────────────────────────────────────────────────────────── */

interface Session {
	readonly name: string;
	send<T = unknown>(method: string, params?: object, sessionId?: string): Promise<T>;
	close(): Promise<void>;
}

interface Frame {
	id?: number;
	result?: unknown;
	error?: { code?: number; message?: string };
}

function browserArgs(profileDir: string): string[] {
	return [
		// `=new` rather than bare `--headless`: from Chrome 132 they are the
		// same thing, but on 112–131 the bare switch still selects the old
		// headless shell, whose printing is the one we are trying to leave.
		'--headless=new',
		'--remote-debugging-pipe',
		`--user-data-dir=${path.join(profileDir, 'profile')}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-gpu',
		'--disable-extensions',
		'--disable-background-networking',
		'--disable-sync',
		'--disable-component-update',
		'--disable-default-apps',
		'--mute-audio',
		'--no-pings',
		'--disable-features=Translate,MediaRouter',
	];
}

function launch(browser: string, name: string, profileDir: string): Session {
	const child = spawn(browser, browserArgs(profileDir), {
		// 0–2 as usual, then the protocol pair: 3 is ours to write to, 4 is
		// ours to read from.
		stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
	});
	const write = child.stdio[3] as NodeJS.WritableStream;
	const read = child.stdio[4] as NodeJS.ReadableStream;

	const pending = new Map<number, { resolve(value: never): void; reject(error: Error): void }>();
	let nextId = 1;
	let stderr = '';
	let dead: Error | undefined;
	let tail: Buffer = Buffer.alloc(0);

	child.stderr?.on('data', chunk => {
		stderr = (stderr + String(chunk)).slice(-4096);
	});

	read.on('data', (chunk: Buffer) => {
		const decoded = decodeFrames(tail, chunk);
		tail = decoded.tail;
		for (const frame of decoded.frames) {
			dispatch(frame);
		}
	});

	const fail = (error: Error): void => {
		dead ??= error;
		for (const entry of pending.values()) {
			entry.reject(error);
		}
		pending.clear();
	};

	child.on('error', error => fail(new Error(`无法启动 ${name}：${error.message}`)));
	child.on('exit', code => fail(new Error(`${name} 提前退出（代码 ${code}）。${lastLine(stderr)}`)));
	// The pipe ends are ours; nothing else is listening if they break.
	read.on('error', () => undefined);
	write.on('error', () => undefined);

	function dispatch(text: string): void {
		let frame: Frame;
		try {
			frame = JSON.parse(text) as Frame;
		} catch {
			return;
		}
		// Everything without an id is an event, and this client subscribes to none.
		if (typeof frame.id !== 'number') {
			return;
		}
		const entry = pending.get(frame.id);
		if (!entry) {
			return;
		}
		pending.delete(frame.id);
		if (frame.error) {
			entry.reject(new Error(frame.error.message ?? 'DevTools 协议返回了错误'));
		} else {
			entry.resolve((frame.result ?? {}) as never);
		}
	}

	function send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
		if (dead) {
			return Promise.reject(dead);
		}
		const id = nextId++;
		const message = JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params });
		return new Promise<T>((resolve, reject) => {
			pending.set(id, {
				resolve: resolve as (value: never) => void,
				reject,
			});
			write.write(`${message}\0`, error => {
				if (error) {
					pending.delete(id);
					reject(error);
				}
			});
		});
	}

	return {
		name,
		send,
		async close(): Promise<void> {
			if (hasExited(child)) {
				return;
			}
			const gone = exited(child);
			// Browser.close often never gets a reply — the browser is already on
			// its way out — so the exit is what we actually wait on.
			void send('Browser.close').catch(() => undefined);
			if (!(await raceTimeout(gone, SHUTDOWN_MS))) {
				// A leaked headless Chrome is a quarter of a gigabyte the user
				// never sees and cannot find.
				child.kill('SIGKILL');
				await raceTimeout(exited(child), SHUTDOWN_MS);
			}
		},
	};
}

/**
 * Pulls the NUL-delimited frames out of a chunk, carrying any partial frame
 * over to the next call.
 *
 * Exported for the tests. A base64 PDF is megabytes and arrives across many
 * chunks that do not line up with frame boundaries, so getting this wrong is
 * silent corruption rather than an error.
 */
export function decodeFrames(tail: Buffer, chunk: Buffer): { frames: string[]; tail: Buffer } {
	let buffer = tail.length ? Buffer.concat([tail, chunk]) : chunk;
	const frames: string[] = [];

	for (let end = buffer.indexOf(0); end !== -1; end = buffer.indexOf(0)) {
		frames.push(buffer.subarray(0, end).toString('utf8'));
		buffer = buffer.subarray(end + 1);
	}
	return { frames, tail: buffer };
}

function hasExited(child: ChildProcess): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

function exited(child: ChildProcess): Promise<void> {
	if (hasExited(child)) {
		return Promise.resolve();
	}
	return new Promise(resolve => child.once('exit', () => resolve()));
}

async function raceTimeout(work: Promise<void>, ms: number): Promise<boolean> {
	let timer: NodeJS.Timeout | undefined;
	const guard = new Promise<boolean>(resolve => {
		timer = setTimeout(() => resolve(false), ms);
	});
	try {
		return await Promise.race([work.then(() => true), guard]);
	} finally {
		clearTimeout(timer);
	}
}

async function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const guard = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	try {
		return await Promise.race([work, guard]);
	} finally {
		clearTimeout(timer);
	}
}

function lastLine(stderr: string): string {
	return stderr.trim().split('\n').slice(-2).join(' ').trim();
}

/* ── finding a browser ────────────────────────────────────────────────── */

function candidates(): string[] {
	if (process.platform === 'darwin') {
		return [
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
			'/Applications/Chromium.app/Contents/MacOS/Chromium',
			'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
			'/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
		];
	}

	if (process.platform === 'win32') {
		const roots = [
			process.env['PROGRAMFILES'],
			process.env['ProgramW6432'],
			process.env['PROGRAMFILES(X86)'],
			process.env['LOCALAPPDATA'],
		].filter((value): value is string => Boolean(value));

		const relative = [
			'Google\\Chrome\\Application\\chrome.exe',
			'Microsoft\\Edge\\Application\\msedge.exe',
			'Chromium\\Application\\chrome.exe',
			'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
		];
		return roots.flatMap(root => relative.map(suffix => path.join(root, suffix)));
	}

	return [
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/microsoft-edge',
		'/snap/bin/chromium',
		'/opt/google/chrome/chrome',
	];
}

export async function findBrowser(configured: string): Promise<string> {
	if (configured.trim()) {
		const explicit = configured.trim();
		if (await isExecutable(explicit)) {
			return explicit;
		}
		throw new Error(
			`markdownAtlas.export.chromePath 指向 "${explicit}"，那不是一个可执行文件。`,
		);
	}

	for (const candidate of candidates()) {
		if (await isExecutable(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		'没有找到 Chrome、Edge 或 Chromium。请装一个，或设置 markdownAtlas.export.chromePath。',
	);
}

async function isExecutable(candidate: string): Promise<boolean> {
	try {
		await fs.access(candidate, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}
