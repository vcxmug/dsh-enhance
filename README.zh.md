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

一次性、每台机器（包从本仓库**本地安装**，无需 npm 账号）。Harness 加载器从
profile 目录解析插件包名，因此要装进 profile 而不是全局：

```bash
npm pack ./packages/dsh-vision ./packages/dsh-native-web
dsh plugin --profile web add ./vcxmug-dsh-vision-0.1.0.tgz ./vcxmug-dsh-native-web-0.1.0.tgz
```

`dsh plugin` 转发给 profile 目录里的 pnpm，并记录指向 tarball 的 `file:`
依赖——请把 tarball 放在不会丢的位置，重启后重装才能继续解析。
（`npm install -g` 不够：profile 加载器看不见全局前缀；直接
`npm install -g ./packages/...` 还会创建依赖无法解析的符号链接。）

插件用 TypeScript 编写（`src/index.ts`，strict 模式）；构建产物 `lib/` 已提交，
因此打包安装无需构建步骤。修改源码后，在包目录内执行
`npm install && npm run build` 重新构建。

## 挂载组合行

两种受支持的挂载位置，二选一（行是纯挂载点，可直接复制
`presets/vision.cordis.yml` 与 `presets/native-web.cordis.yml`）：

**A. Profile 补丁层——该 profile 的所有会话从一开始就生效。**
向 profile 的 `cordis.patch.yml` 追加 insert 补丁：

```yaml
- insert:
    - id: vision
      name: '@vcxmug/dsh-vision'
    - id: native-web
      name: '@vcxmug/dsh-native-web'
```

补丁层会被运行中的 `dsh` 热加载，重启后依然生效，无需选预设、无需重开会话。

**B. 单个 Agent 预设——只对选该预设的会话生效。** 在 Web 界面：
设置 → Agent 预设——新建一个预设（或复制现有预设），加入这两行：

```yaml
- id: vision
  name: '@vcxmug/dsh-vision'
- id: native-web
  name: '@vcxmug/dsh-native-web'
```

两点注意：两种位置的行 `config:` 都是设置表单的 base 层；另外不要复制一个
会注册官方 inspect 提供者的预设（`cordis` 创造模式就是），并同时在同一进程里
保留原预设的会话——两次挂载会注册同一批进程级提供者，第二次挂载会被拒绝。

然后在 Web 界面：**设置 → 插件 → dsh-vision / dsh-native-web**——在表单里配置：
端点地址、模型、API Key、实例地址/Key、超时等。改动下一次工具调用即生效，
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
packages/dsh-vision/        # 识图插件（TS 源码在 src/，构建产物 lib/ 已入库）
packages/dsh-native-web/    # 原生联网插件（TS 源码在 src/，构建产物 lib/ 已入库）
presets/                    # 纯挂载点组合行片段
docs/                       # 已知限制、自测提示词
```

## 说明

- 原生联网 vs MCP：MCP 每次调用要经过 DSH 的 MCP client 和一个
  `firecrawl-mcp` 子进程——多跳、多会话轮次。原生路线是**一次直接 HTTP
  调用**你的实例。（更偏好 MCP？官方的 `@deepseek-ai/dsh-mcp-client` 可走该路线。）
- 已知限制：见 [docs/known-limitations.md](docs/known-limitations.md)。
- 端到端验证：见 [docs/self-test-prompt.md](docs/self-test-prompt.md)。

## 测试

`npm test` 运行一项运行时验证：脚本化 mock LLM（无需 API key、无网络）驱动
真实的 headless dsh agent 循环（两个插件均已挂载），断言工具循环端到端跑通。
需要 Node >= 22.18（原生运行 TypeScript，无需构建）且 `dsh` 在 PATH 上
（或用 `DSH` 环境变量指定）；找不到 dsh 时自动跳过。

`npm run typecheck` 检查测试源码类型；`npm run build` 从 `src/` 重建两个插件的
`lib/`。两者都需要先安装开发依赖（仓库根与各包目录内执行 `npm install`）。

License: MIT
