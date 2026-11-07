<div align="center">
  <img src="./build/icon.svg" width="96" alt="红薯文案工坊图标" />

  **简体中文** | [English](./README_EN.md)

  # 红薯文案工坊

  **一个本地优先、事实驱动的小红书内容生产桌面应用**

  从业务素材、事实核对、微选题策略，到文案审核、配图生成与终稿入库，用一条可回溯的流程管理内容生产。

  [![Version](https://img.shields.io/badge/version-2.2.0-2563eb?style=flat-square)](./package.json)
  [![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
  [![Electron](https://img.shields.io/badge/Electron-45-47848f?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
  [![Windows build](https://img.shields.io/badge/Windows-build-0078d4?style=flat-square&logo=windows&logoColor=white)](./.github/workflows/build-windows.yml)
  ![Local first](https://img.shields.io/badge/data-local--first-16a34a?style=flat-square)

  [产品亮点](#产品亮点) • [产品界面](#产品界面) • [快速开始](#快速开始) • [工作流](#工作流) • [开发与打包](#开发与打包)
</div>

<br />

<div align="center">
  <img src="./docs/images/00-generated-gallery.webp" width="100%" alt="红薯文案工坊的图文套图生成与逐页管理页面" />
  <br />
  <sub>截图来自实际运行的桌面应用，未使用 AI 重绘界面。</sub>
</div>

## 为什么做这个工具

通用 AI 聊天很容易把“写一篇小红书”变成一次性对话：素材散落、口径冲突、参考文案不可追溯，下一篇又从零开始。

红薯文案工坊把内容生产变成一个可积累的本地项目：

- 先从原始素材提取可确认的业务事实，再开始创作。
- 把关键词、参考文案、合规准则与图片样本长期保存在项目内。
- 记录策略、修订、图片与终稿，新一轮生成不会覆盖历史。
- 显式宣传与生活化种草分开建库，同模式内自动避免重复选题。

## 产品亮点

| 能力 | 说明 |
| --- | --- |
| 事实先行 | 从 Markdown、PDF 或图片提取业务事实，标记冲突口径，确认后再进入创作。 |
| 两套内容契约 | “显式宣传”可清晰介绍产品；“生活化种草”优先解决一个具体问题，再自然承接业务。 |
| 微选题策略 | 一次生成 3–5 个小切口，可多选并为每篇分别添加最高优先级要求。 |
| 人机协同审稿 | 在可编辑画布中直接修改，或用自然语言生成修订稿；每个版本都保留。 |
| 素材资产化 | 关键词、合规准则、高表现参考文案支持手动维护、Excel 批量导入和导出。 |
| 参考图驱动的配图 | 先对优秀图片样本做视觉标签，再为每一页选参考图生成 3:4 小红书套图，保留参考来源与版本。 |
| 本地项目存储 | 业务素材、JSON 资产、Markdown 终稿和图片都保存在你选择的文件夹中。 |

## 产品界面

<table>
  <tr>
    <td width="50%">
      <img src="./docs/images/04-copy-review.webp" alt="文案审核与修订页面" />
      <p align="center"><b>文案审核</b><br /><sub>手动编辑、AI 修订、多文档与版本确认</sub></p>
    </td>
    <td width="50%">
      <img src="./docs/images/01-asset-library.webp" alt="素材管理页面" />
      <p align="center"><b>素材管理</b><br /><sub>原始素材、关键词、参考文案与合规准则</sub></p>
    </td>
  </tr>
</table>

### 先消除事实冲突，再进入创作

模型会把素材中的冲突口径集中展示。人工确认住宿、时间、价格或适用人群等标准后，系统才重新形成完整业务事实。

<img src="./docs/images/02-fact-check.webp" width="100%" alt="业务事实冲突核对页面" />

### 从已确认文案生成完整套图

配图工作台会规划 4–6 张 3:4 图片，并为封面和每一张内容页匹配参考样本。每页都可以单独导出、换图或带着修改要求重新生成。

<img src="./docs/images/05-image-studio.webp" width="100%" alt="小红书图文套图生成页面" />

> [!NOTE]
> 上述图片均为真实产品页面截图；README 只做了裁边、尺寸统一与 WebP 压缩。

## 快速开始

### 环境要求

- Node.js 22 或更高版本
- npm
- macOS、Windows 或 Linux

### 本地运行

```bash
git clone https://github.com/qfzhao670/xhs-ads-agent.git
cd xhs-ads-agent
npm ci
npm run dev
```

启动后：

1. 在“设置”中填写模型接口地址、API Key、文案模型和视觉理解模型。
2. 选择一个空文件夹创建项目，或打开已初始化的项目文件夹。
3. 导入业务原始素材，按页面上的 8 个步骤完成第一轮生成。

> [!IMPORTANT]
> 应用数据保存在本地，但调用文案、OCR 或图片模型时，当次任务所需的文本或图片会发送到你配置的模型服务商。请根据数据敏感级别选择合适的接口。

### 模型配置

| 用途 | 要求 |
| --- | --- |
| 文案工作流 | 支持 Chat Completions 形式的兼容接口，模型需能稳定输出 JSON。 |
| PDF / 图片提取 | 视觉理解模型；PDF 还需当前接口支持文件输入。 |
| 参考图打标 | 支持图片理解的视觉模型。 |
| 套图生成（可选） | 支持图生图的图片模型；内置了阿里云百炼 Qwen Image 与 OpenAI 兼容协议配置。 |

API Key 只保存在本机应用数据中，不会写入项目文件夹。

## 工作流

```text
准备素材 → 核对事实 → 选择内容模式 → 选择微选题策略
        → 生成文案 → 审核确认 → 制作配图（可跳过） → 确认入库
```

1. **准备素材**：检查原始素材和当前生效的内容资产。
2. **核对事实**：提取事实，若发现冲突则等待人工确认统一口径。
3. **内容模式**：选择显式宣传或生活化种草，可追加本轮自然语言要求。
4. **选择策略**：从候选小切口中选择一个或多个，并为每篇单独补充要求。
5. **生成文案**：按策略生成标题、正文和话题标签。
6. **审核确认**：直接编辑或用 AI 修订，再确认选定的版本。
7. **制作配图**：基于已确认文案和参考图库生成封面与内容页，可逐页重生成。
8. **确认入库**：将文字和图片作为终稿保存，核心策略同时进入后续避重范围。

## 项目数据

每个业务项目都是一个普通的本地文件夹，无需独立数据库：

```text
你的项目/
├── 小红书运营工坊.json       # 项目标识与计数器
├── 业务原始素材.md            # 事实来源
├── 项目数据/
│   ├── 关键词库.json
│   ├── 高表现参考文案库.json
│   ├── 合规性准则.json
│   ├── 小红书图片参考库.json
│   └── 终稿内容库.json
└── 生成结果/                  # 事实、策略、版本、配图与历史记录
```

这些文件可以正常备份、同步或加入你自己的版本管理流程。

## 开发与打包

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动 Vite 和 Electron 开发环境。 |
| `npm run check` | 运行 TypeScript 检查并构建前端。 |
| `npm test` | 运行 Electron 主进程的 Node.js 单元测试。 |
| `npm run package` | 构建未封装的当前平台应用目录。 |
| `npm run dist` | 构建当前平台安装包。 |
| `npm run dist:win` | 构建 Windows x64 NSIS 安装包。 |

### 技术栈

- React + TypeScript + Vite
- Electron + context-isolated preload bridge
- 本地 JSON / Markdown / 图片文件
- OpenAI 兼容的文案与视觉模型接口
- DashScope / OpenAI 兼容的图片生成接口

Windows 安装包可在 GitHub Actions 中手动构建，或在推送 `v*` 标签时自动发布到 GitHub Releases。完整步骤见 [命令行打包说明](./docs/命令行打包说明.md)。

## 常见问题

<details>
<summary><b>应用提示“请先配置模型”</b></summary>

前往“设置”，确认接口地址、API Key 和模型名称都已填写。OCR 与参考图打标需要额外填写支持图片理解的视觉模型。

</details>

<details>
<summary><b>为什么配图按钮不可用？</b></summary>

图生图流程必须先有可用的参考图。请在“素材管理 → 小红书图片”上传封面或内容页样本，并等待视觉打标完成。

</details>

<details>
<summary><b>`npm run dev` 报告 5173 端口被占用</b></summary>

关闭之前启动的 Vite / Electron 开发进程，再重新运行命令。应用的 Electron 主进程在开发模式下会连接 `http://127.0.0.1:5173`。

</details>
