const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * KaTeX ships its stylesheet and fonts inside node_modules, which is excluded
 * from the VSIX. Mirror just what the preview links into media/vendor so the
 * packaged extension is self-contained.
 */
function copyKatexAssets() {
	const from = path.dirname(require.resolve("katex/package.json"));
	const to = path.join(__dirname, "media", "vendor", "katex");

	fs.rmSync(to, { recursive: true, force: true });
	fs.mkdirSync(to, { recursive: true });
	fs.copyFileSync(
		path.join(from, "dist", "katex.min.css"),
		path.join(to, "katex.min.css"),
	);
	// Only woff2: the preview runs in Chromium, and katex.min.css lists woff2
	// first in every @font-face, so the ttf/woff fallbacks are never fetched.
	const fontsFrom = path.join(from, "dist", "fonts");
	const fontsTo = path.join(to, "fonts");
	fs.mkdirSync(fontsTo, { recursive: true });
	for (const file of fs.readdirSync(fontsFrom)) {
		if (file.endsWith(".woff2")) {
			fs.copyFileSync(path.join(fontsFrom, file), path.join(fontsTo, file));
		}
	}
}


async function main() {
	copyKatexAssets();

	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
