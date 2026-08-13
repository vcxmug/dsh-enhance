# dsh-enhance

[English](README.md)

一个原生插件**工具集**，用来填补 DeepSeek Harness / DeepSeek 模型的短板：
官方没有或做得不好的能力，每个都是**一行组合行（composition row）**接入，
配置完全在 **Web 设置界面**完成——没有 CLI 脚本、不用手改 YAML、不用发布 npm 包。

## 包含什么

| 能力 | 插件包 | 工具 | 填补的短板 |
|---|---|---|---|
| **识图 Vision** | `packages/dsh-vision` | `vision_describe`、`vision_list_models` | DeepSeek 模型没有图像输入；通过任意兼容 OpenAI Responses API 的多模态模型端点给 Agent 按需"眼睛" |
| **原生联网 Native web** | `packages/dsh-native-web` | `native_search`、`native_scrape` | 内置搜索依赖云服务（额外 token 开销）；MCP 桥接多一跳。本插件**直接 HTTP 访问你本地自托管的联网实例**（Firecrawl 兼容），无桥接、无云依赖 |

两个插件都是宿主机侧 Cordis 插件：每次工具调用一次 `fetch`，带超时与调用方
取消支持，API Key 标记为 secret 并在传输时脱敏。

## 安装

一次性、每台机器（包从本仓库**本地安装**，无需 npm 账号）：

```bash
npm pack ./packages/dsh-vision ./packages/dsh-native-web
npm install -g ./vcxmug-dsh-vision-0.1.0.tgz ./vcxmug-dsh-native-web-0.1.0.tgz
```

（`npm install -g ./packages/...` 会创建符号链接导致依赖无法解析；先 pack
再安装才是带依赖的真实副本。）

然后在 DeepSeek Harness Web 界面：

1. **设置 → Agent 预设**——新建一个预设（或复制现有预设），加入你要的行
   （复制 `presets/vision.cordis.yml` 与 `presets/native-web.cordis.yml`，
   或直接写这两行）：
   ```yaml
   - id: vision
     name: '@vcxmug/dsh-vision'
   - id: native-web
     name: '@vcxmug/dsh-native-web'
   ```
2. **设置 → 插件 → dsh-vision / dsh-native-web**——在表单里配置：
   端点地址、模型、API Key、实例地址/Key、超时等。
3. 用该预设**开一个新会话**。之后在设置里改配置，下一次工具调用即生效，
   无需重启。

## 依赖

- DeepSeek Harness 0.1.0-rc.6+（web 版；预设位于 `$DSH_HOME/.agent-presets`）
- Node 18+（全局 `fetch`）
- 识图：任意兼容 OpenAI Responses API（`/responses`）的多模态模型服务——
  官方 API 或第三方兼容端点均可
- 原生联网：可达的本地自托管 Firecrawl 兼容实例（docker compose，见
  [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl)）；
  `USE_DB_AUTHENTICATION=false` 的实例接受任意 API Key

## 仓库结构

```
packages/dsh-vision/        # 识图插件（vision_describe、vision_list_models）
packages/dsh-native-web/    # 原生联网插件（native_search、native_scrape）
src/dsh-http/               # 动态插件形态使用的 Go 辅助二进制（仅标准库）
presets/                    # 纯挂载点组合行片段
docs/                       # 已知限制、辅助二进制、自测提示词
```

## 说明

- 原生联网 vs MCP：MCP 每次调用要经过 DSH 的 MCP client 和一个
  `firecrawl-mcp` 子进程——多跳、多会话轮次。原生路线是**一次直接 HTTP
  调用**你的实例。（更偏好 MCP？官方的 `@deepseek-ai/dsh-mcp-client` 可走该路线。）
- 动态插件形态（会话级、无需预设）：插件通过 shell 服务调用 `dsh-http`
  Go 辅助二进制——**仅 Go 标准库、零第三方依赖**——所有变量经环境变量与
  stdin 传递，API key 不会出现在任何进程命令行里。契约与构建见
  [docs/helper-binary.md](docs/helper-binary.md)。
- 已知限制：见 [docs/known-limitations.md](docs/known-limitations.md)。
- 端到端验证：见 [docs/self-test-prompt.md](docs/self-test-prompt.md)。

License: MIT
