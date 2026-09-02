# Markdown Atlas

给 VS Code 的 Markdown 预览换一套排版。8 套主题、双向滚动同步、KaTeX 公式、代码高亮、自定义样式、导出独立 HTML 与 PDF —— 只做预览和导出，不碰任何发布平台。

## 主题

| id | 名称 | 风格 |
| --- | --- | --- |
| `editor` | Editor · 跟随编辑器 | 跟随当前 VS Code 配色主题，明暗自动切换（默认） |
| `wechat` | WeChat Classic · 微信经典 | 居中暖色标题 + 蓝色强调 |
| `macos` | macOS Minimal · macOS 简约 | 中性灰、圆角、留白充足 |
| `academic` | Academic Paper · 学术论文 | 衬线正文、首行缩进、三线表 |
| `notion` | Notion Clean · Notion 简洁 | 扁平无衬线、柔和分隔线 |
| `medium` | Medium Editorial · Medium 编辑 | 大号衬线正文、无衬线标题 |
| `tech-blog` | Tech Blog · 科技博客 | 紧凑无衬线、斑马纹表格 |
| `clean-blue` | Clean Blue · 简约蓝 | 蓝色标题条，商务报告感 |

除 `editor` 外都是固定亮色主题。它们会强制使用亮色的代码高亮配色 —— 否则在暗色 VS Code 主题下，白纸上会出现深色代码块字体。

## 功能

- **块级双向滚动同步**。每个段落、标题、列表项、代码块、表格都带 `data-line` 源码行号，编辑器和预览互相跟随，不是「滚到最近的标题」。
- **跳回源码**。工具栏 `←` 把编辑器滚到预览当前位置。双击跳转默认**关闭** —— 双击在网页里的默认含义是选中一个词，抢掉它会让预览里的文字没法正常复制；想要 VS Code 内置预览那种行为的话，打开 `markdownAtlas.preview.doubleClickToSwitchToEditor`。
- **KaTeX 公式**：`$...$`、`$$...$$`，以及 ` ```math ` 代码块。字体随扩展打包，离线可用。
- **代码高亮**：highlight.js，带 macOS 三色点标题栏、语言标签和复制按钮。
- **图片标题**：一个段落里只有一张图时自动变成 `<figure>`，alt 文本变成图注。
- **宽表格**：超宽表格在正文列内横向滚动，不撑宽整篇文章。
- **YAML front matter**：默认隐藏，也可以渲染成一张元信息卡片。
- **目录面板**：文档标题树，点击跳转，滚动时自动高亮当前所在的标题。
- **自定义样式面板**：在预览里直接写 CSS 覆盖当前主题，`应用` 即时生效并存进设置，重启还在。附常用选择器速查。
- **导出独立 HTML**：当前主题 + 自定义 CSS 全部内联，本地图片转 data URI，文档里有公式才带上 KaTeX 字体。一个文件，断网也能打开。
- **宽表格两种模式**：正文内横向滚动（默认）／完整展开（页面横向滚动），工具栏一键切换，文档里没有表格时按钮自动隐藏。
- **两个同步按钮**：`→` 把预览跳到编辑器光标处，`←` 把编辑器跳到预览当前位置。
- `Ctrl/Cmd+F` 是 VS Code 原生的查找组件（面板开了 `enableFindWidget`），正则和大小写都有。
- **缩放**、**主题下拉** 也在工具栏里。
- 关掉 VS Code 再打开，预览面板、滚动位置、缩放和面板开合状态都会自己恢复。

## 用法

- 命令面板：`Markdown Atlas: Open Preview` / `Open Preview to the Side`
- Markdown 编辑器右上角的预览按钮
- 快捷键 `Cmd+K A` / `Ctrl+K A`
- 换主题：预览工具栏的下拉框，或命令 `Markdown Atlas: Select Preview Theme`

编辑器右上角的按钮是一枚青绿色实心图标 —— 标题栏里其余都是细线条单色 codicon，实心配色块最容易一眼找到，也不会和内置 Markdown 预览的按钮混淆（两者原本是同一个 `$(open-preview)` 图标）。

### 工具栏

`[主题 ▾]` · `📑 目录` · `🎨 样式` · `▦ 滚动/展开` · `→` `←` · `− 100% +` · `💾 导出 ▾`

### 导出

工具栏 `💾 导出 ▾` 打开下拉，选 **HTML** 或 **PDF**；下拉里还有一个**目标路径输入框**。也可以走命令面板（`导出…` / `导出为 HTML` / `导出为 PDF`）或在资源管理器里右键 `.md` 文件。

**路径怎么写**（输入框和 `markdownAtlas.export.outputPath` 设置是同一套规则，输入框优先，只对本次导出生效）：

| 填什么 | 结果 |
| --- | --- |
| 留空 | 写到 md 文件同目录，同名 |
| `../out` `build/` `/tmp/exports` | 当成目录，文件名沿用文档名 |
| `../out/article.html` | 当成文件名直接用，扩展名会被强制改成当前格式（导 PDF 就是 `article.pdf`，不会出现 `.html` 里装着 PDF） |

同名文件会被直接覆盖，导出成功的通知里会显示完整路径。

**HTML** 是自包含的：CSS 全部内联，本地图片转 data URI。**只有文档里真的用了公式**才带上 KaTeX 的 CSS 和 woff2 字体（约 380 KB）；纯文字文档通常只有几十 KB。

**PDF** 调用你机器上**已经装好的 Chrome / Edge / Chromium**，扩展本身不打包任何浏览器（这正是被参考的那个扩展 vsix 有 18MB 的原因）。自动探测常见安装位置，找不到会提示你去填 `markdownAtlas.export.chromePath`。页面大小和页边距用 `markdownAtlas.export.pdf.pageSize` / `.margin` 控制，走的是 CSS `@page`。

浏览器不是用 `--print-to-pdf` 命令行开关驱动的，而是走 DevTools 协议（`--remote-debugging-pipe`，一对文件描述符上跑 NUL 分隔的 JSON，不开端口、不加依赖）。原因是那个开关拿不到字体就绪的时机、关不掉背景、页面尺寸只能靠 CSS，而且在当前 Chrome 上写完文件后进程不退出，没有可等待的结束信号。

> PDF 的 HTML 是直接灌进一个空白 frame 里打印的，没有可供相对图片路径解析的 base URL，所以**导 PDF 时无论 `embedImages` 设成什么都会内联图片**。

### 自定义样式

工具栏 `🎨 样式` 打开面板，写 CSS，点 `应用`。所有规则要以 `.atlas-content` 开头（代码块容器是 `.atlas-code`）：

```css
.atlas-content h1 {
  color: #07c160;
  border-bottom: 2px solid #07c160;
}
.atlas-content blockquote {
  background: #f0fff4;
  border-left: 4px solid #07c160;
}
```

内容存在 `markdownAtlas.customCss` 设置里，所有预览共享，也会一起被导出。命令 `Markdown Atlas: Edit Custom CSS` 直接跳到该设置项。

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `markdownAtlas.theme` | `editor` | 预览主题 |
| `markdownAtlas.preview.fontSize` | `16` | 正文字号（px），标题和代码按比例缩放 |
| `markdownAtlas.preview.lineWidth` | `760` | 正文栏最大宽度（px） |
| `markdownAtlas.preview.scrollPreviewWithEditor` | `true` | 预览跟随编辑器滚动 |
| `markdownAtlas.preview.scrollEditorWithPreview` | `true` | 编辑器跟随预览滚动 |
| `markdownAtlas.preview.doubleClickToSwitchToEditor` | `false` | 双击预览跳到源码（默认关，避免抢掉「双击选词」） |
| `markdownAtlas.preview.showToolbar` | `true` | 显示预览工具栏 |
| `markdownAtlas.preview.tableDisplay` | `scroll` | 宽表格 `scroll` 列内滚动 / `expand` 完整展开 |
| `markdownAtlas.customCss` | `""` | 叠加在主题之上的 CSS |
| `markdownAtlas.export.outputPath` | `""` | 默认导出目标，绝对或相对 md 文件；留空＝同目录 |
| `markdownAtlas.export.embedImages` | `true` | HTML 导出时把本地图片内联成 data URI（PDF 恒为内联） |
| `markdownAtlas.export.chromePath` | `""` | PDF 用的浏览器可执行文件；留空自动探测 |
| `markdownAtlas.export.pdf.pageSize` | `A4` | PDF 页面大小 |
| `markdownAtlas.export.pdf.margin` | `16mm` | PDF 页边距，CSS 长度 |
| `markdownAtlas.preview.frontMatter` | `hide` | `hide` 隐藏 / `card` 渲染成元信息卡片 |
| `markdownAtlas.math.enabled` | `true` | KaTeX 公式渲染 |

## 开发

```bash
npm install
npm run watch     # esbuild + tsc 监听
```

然后按 `F5` 启动扩展开发宿主。

```bash
npm run compile   # 类型检查 + lint + 构建
npm test          # 渲染器测试
npm run package   # 生产构建
```

`media/vendor/katex` 由 `esbuild.js` 在构建时从 `node_modules/katex` 复制生成（只拷 woff2），不进版本库。

样式表分三层，改的时候注意落在哪一层：

- `media/base.css` — 文章本体（版心、表格、代码块、图注、公式）。**导出时会被内联**，所以这里写的东西必须在脱离 VS Code 的独立文件里也成立。
- `media/chrome.css` — 只属于实时预览的外壳（工具栏、两个面板、toast、滚动列、表格展开模式）。导出不带。
- `media/themes/*.css` — 配色与排版，只有当前主题那一份会被加载。

## 致谢

主题排版、目录面板、自定义样式面板和工具栏布局参考自 [Markdown2Anything](https://github.com/marsggbo/markdown2anything)（MIT）。其中与微信/知乎/小红书发布相关的约束（juice 行内样式、base64 图片、680px 手机宽度）在预览里已全部去掉 —— base64 图片只在导出时保留，因为独立文件确实需要自包含。

## License

MIT
