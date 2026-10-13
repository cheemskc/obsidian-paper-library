<div align="center">

<img src="docs/assets/paper-library-hero.svg" alt="Paper Library — Library, Native PDF Reader and Paper Composer" width="100%">

# Paper Library

### 把论文管理、深度阅读与 AI 对话，放进同一个 Obsidian Vault。

从收藏论文到标注原文，从记录想法到追问整篇文档。一个插件，一条完整的研究工作流。

[![Version](https://img.shields.io/badge/version-0.43.0-2563d8?style=flat-square)](https://github.com/cheemskc/obsidian-paper-library/releases)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.5%2B-7c3aed?style=flat-square&logo=obsidian&logoColor=white)](https://obsidian.md)
[![Platforms](https://img.shields.io/badge/platforms-desktop%20%7C%20mobile-24415e?style=flat-square)](#平台支持)
[![License](https://img.shields.io/badge/license-MIT-2f7a61?style=flat-square)](LICENSE)

[下载安装](#安装) · [核心能力](#一个-vault完整覆盖研究流程) · [Paper Composer](#paper-composer) · [PDF 解析](#三种文档上下文模式) · [开发](#开发)

</div>

---

## 研究不该散落在五个应用里

Paper Library 将资料库、Obsidian 原生 PDF 阅读器、标注管理和智能对话整合为 Obsidian 原生工作区。论文、笔记、标注与关系数据保留在你的 Vault 中；阅读时产生的上下文，可以直接进入 Paper Composer，而不必反复复制、解释文件来源或重新上传。

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>01 · Organize</h3>
      <p><strong>建立真正属于你的论文库</strong></p>
      <p>集中管理论文、附件、作者、会议、标签、分类、评分、引用与阅读状态。</p>
    </td>
    <td width="33%" valign="top">
      <h3>02 · Read</h3>
      <p><strong>让阅读痕迹成为知识结构</strong></p>
      <p>在原生 PDF 阅读器中标注、添加备注，并在右栏集中查看和管理。</p>
    </td>
    <td width="33%" valign="top">
      <h3>03 · Compose</h3>
      <p><strong>带着整篇论文追问 AI</strong></p>
      <p>文字、图片和页面区域均可成为 linked content，并与全文语境联动。</p>
    </td>
  </tr>
</table>

## 一个 Vault，完整覆盖研究流程

### Library · 为论文建立秩序

- Obsidian 原生三栏布局：左侧导航、中央论文库、右侧详情。
- Starred、Daily Board、Recently Read、Flagged、Tags 与层级 Collections。
- 拖入文档后提取本地元数据，并可通过 DOI、arXiv 或标题补全信息。
- 自动识别期刊与会议信息，支持 CCF、JCR、影响因子和会议录用率。
- 管理论文主文件、补充材料、Markdown 阅读笔记及引用关系。
- APA、IEEE、Chicago、MLA、Harvard、Vancouver 等引用预览与导出。
- 统一采用标准视图，桌面端与移动端可分别设置强调色。

### PDF 阅读与标注 · 在原生阅读器里完成

- 双击论文使用 Obsidian 原生 PDF 阅读器；旧研究画布设置自动迁移。
- 选中文字后自动弹出标注窗口，选择颜色、样式并添加备注；点击保存才写入。
- 支持高亮、下划线、波浪线、删除线和文字注释，并保留自由画笔。
- 设置中可定义每种标注样式的含义，选文窗口和管理列表同步展示。
- 右栏「标注管理」查看当前文献或全部文献的 Paper Library 标注。
- 按样式、颜色、正文、备注、样式含义或文献标题筛选，回跳原文或删除。
- 文字标注与备注写入本地 PDF 和论文笔记，删除同步到两处；自由画笔保存在插件数据中。
- 原有标注、笔迹、摘录和想法数据保留；标注会随论文重命名或目录调整自动迁移。
- 识别论文中的图片并提供目录、轮播、缩放、全屏、图注与 PNG 下载。

### Ask AI · 选中什么，就从什么开始问

- 拖入论文、Markdown、文字选区、图片或标注内容。
- 圈选页面区域后，以图片形式加入当前对话。
- 右键文字、图片、论文卡片或中间栏论文即可添加到 Paper Composer。
- 所有上下文以清晰的小卡片展示，不向消息正文暴露内部标签或元数据。
- Linked content 在欢迎区和输入框中持续可见，并可随时移除。

## Paper Composer

Paper Composer 是 Paper Library 内置的智能写作与研究侧栏。它与其他插件实例隔离，只保留 Paper Library 自己的视图、会话和右键入口。

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>像编辑器一样工作</h3>
      <ul>
        <li>多标签对话与历史记录</li>
        <li>Inline Edit 与 Plan Mode</li>
        <li><code>@</code> 文件引用与斜杠命令</li>
        <li>Skills、MCP、Vault Agent 与检查点</li>
        <li>适配窄侧边栏的紧凑输入界面</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>连接你已经使用的模型</h3>
      <ul>
        <li>使用官方命令行工具完成账号授权</li>
        <li>ChatGPT / OpenAI Codex 与 Claude Code</li>
        <li>自动识别本地 Kimi CLI</li>
        <li>按 Provider 启用多个模型</li>
        <li>按模型显示推理强度与可用加速能力</li>
      </ul>
    </td>
  </tr>
</table>

> Paper Library 不保存第三方 OAuth token。登录与授权由对应的官方命令行工具管理。

## 三种文档上下文模式

在输入框上方的设置按钮中，可以随时为当前 linked content 选择处理方式。

| 模式 | 工作方式 | 适合场景 |
|---|---|---|
| **源文件** | 将完整源文件交给当前 AI；这是默认模式 | 模型原生支持文件、多模态理解或需要完整格式时 |
| **内置本地解析** | 在本机依次完成版面、文字、表格与公式处理，并生成结构化 Markdown | 离线使用、希望数据留在本机时 |
| **MinerU** | 调用兼容 MinerU 4 的 V1 服务，读取 Markdown 与 `structured_content` | 已部署 MinerU，或需要处理复杂公式、表格和版面时 |

文档正文只在当前会话首次建立 linked content 时注入一次；后续消息复用既有上下文，不会每轮重复发送全文或重复检索。解析结果会保存在本地缓存中，卡片实时显示阶段、进度和预计时间。

本地运行时与模型按需下载，不随插件仓库分发，也不依赖 PyTorch。组件缺失时不会伪装成本地解析成功，仍可切换回源文件模式继续使用。

### MinerU 设置与缓存

1. 启动兼容 MinerU 4 V1 的 API 服务；本机默认地址是 `http://127.0.0.1:8000`。
2. 在「Paper Library 设置 → Paper Composer · PDF」选择 **MinerU 解析 + 全文检索**。
3. 填写服务地址与解析质量；远端服务需要密钥时，通过 Obsidian SecretStorage 选择密钥。
4. 点击「测试连接」，确认服务支持 Markdown 与结构化内容输出。

示例本机服务：

```bash
uv venv --python 3.12 .venv
uv pip install -U "mineru>=4.0,<5"
mineru-kit api-server --host 127.0.0.1 --port 8000 --tier standard
```

MinerU 结果保存在 `<Vault>/.obsidian/plugins/paper-library/mineru-cache/v1/`。每个 PDF 按文件哈希、服务地址和质量档位生成独立缓存，只保存 `document.md`、`structured-content.json` 与元数据，不复制原始 PDF。设置页可以打开或清空该目录。此实现使用 MinerU 4 V1 的上传与解析任务协议，不支持旧版 `/file_parse` 接口。

## 一条自然的工作流

```text
收集论文 → 整理元数据与分类 → 原生 PDF 阅读
        → 选文标注与备注 → 右栏管理与回跳
        → 绑定为 linked content → 结合全文继续追问
```

1. 把本地文件拖入中央论文库，确认自动识别的元数据。
2. 双击论文使用 Obsidian 原生 PDF 阅读器。
3. 选中文字，在弹出窗口中设置样式、颜色和备注；在右栏管理标注。
4. 右键或拖动内容到 Paper Composer；论文自动成为 linked content。
5. 继续提问。当前会话会保留文档关系，而不会每轮重新附带完整正文。

## 安装

### 手动安装

1. 从 [GitHub Releases](https://github.com/cheemskc/obsidian-paper-library/releases/latest) 下载 `paper-library-版本号.zip`。
2. 解压后，把完整的 `paper-library` 文件夹放到 `<你的 Vault>/.obsidian/plugins`下；
3. 重载 Obsidian，然后在「设置 → 第三方插件」中启用 **Paper Library**。
4. 点击左侧 ribbon 的 Library 图标，或运行命令 `Open paper library`。

从不含内置更新器的旧版本升级时，也需要按上面步骤手动覆盖一次完整文件夹。此后打开「Paper Library 设置 → 插件更新」即可检查并一键安装新版本；更新器会保留设置、论文数据、本地模型和缓存，并自动重新加载插件。

## 浏览器一键导入

仓库中的 `browser-extension/` 提供 Chrome / Edge 扩展：

- 在开放获取页面查找并导入论文文件。
- 复用浏览器现有登录状态处理订阅网站。
- 已入库论文直接显示本地分类、指标和引用信息。
- 通过仅监听本机的服务与 Paper Library 通信。

在扩展管理页面开启开发者模式，加载 `browser-extension/`，随后在 Paper Library 设置中启用浏览器扩展服务并复制配对 Token。详细说明见 [browser-extension/README.md](browser-extension/README.md)。

## 平台支持

| 能力 | 桌面端 | iOS / Android |
|---|:---:|:---:|
| 论文库、详情、分类与标签 | ✓ | ✓ |
| 原生阅读标注与 Markdown 同步 | ✓ | ✓ |
| 原生 PDF 标注窗口与标注管理 | ✓ | 待真机验证 |
| Paper Composer 完整 Agent 能力 | ✓ | — |
| 本地版面与图片识别 | ✓ | — |

移动端采用更低的页面渲染倍率和紧凑工具栏，以降低 WebView 内存压力。桌面与移动端强调色设置互不覆盖。

## 开发

```bash
npm run check
npm test
```

- [标准视图与强调色](APPEARANCE_API.md)
- [浏览器扩展开发说明](browser-extension/README.md)
- `demo.html` 是独立 UI 预览，不读写 Vault 数据。

发布目录固定包含第三方运行时的许可与来源说明。`pdf-lib` 依据 MIT 许可证随插件分发，用于安全解析和更新本地批注。

## License

[MIT](LICENSE) © 2026 Lyle

<div align="center">

<sub>Built for long papers, messy questions, and the moment one note finally connects to another.</sub>

</div>
# 原生 PDF 即时标注

新增标注借鉴并适配 [Elton Reader](https://github.com/swayinfo/elton-reader)
的即时绘制、独立持久化方式，仍使用 Obsidian 原生 PDF 阅读器。
标注记录保存在插件 `data.json` 的对应文献中，同时同步到文献笔记；
新增、删除及修改这些独立标注不会改写或重载整份 PDF。
在标注管理中点击「写入 PDF」可批量嵌入，嵌入后由原生阅读器显示。
原来已嵌入 PDF 的标注不迁移、不删除。来源与许可见 [ELTON_NOTICE.md](ELTON_NOTICE.md)。
