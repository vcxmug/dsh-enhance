# dsh-enhance

[English](README.md)

一组原生插件,补齐 DeepSeek Harness / DeepSeek 模型的短板:官方没有或做不好的
能力,**每个能力一行组合行**,全部在 **Web 设置界面**配置。安装是**一条命令**
(`./install.sh`):不发 npm、不用手写 YAML。

## 你能得到什么

| 能力 | 包 | 工具 | 补齐的短板 |
|---|---|---|---|
| **识图 Vision** | `packages/dsh-vision` | `vision_describe`、`vision_list_models` | DeepSeek 模型没有图像输入;通过任意 Responses API 兼容的多模态端点,给 Agent 装上"眼睛" |
| **原生联网 Native web** | `packages/dsh-native-web` | `native_search`、`native_scrape` | 内置搜索依赖云服务(额外 token 开销);MCP 桥接多一跳。本插件**直接 HTTP 访问你本地自托管的联网实例**(Firecrawl 兼容),无桥接、无云依赖 |

两个插件都是宿主机侧 Cordis 插件:每次工具调用一次 `fetch`,带超时与调用方
取消支持,API Key 标记为 secret 并在传输时脱敏。

## 快速开始

1. **前置条件** —— PATH 上有 `dsh`、`npm`、`pnpm`,Linux + GNU coreutils
   (脚本会显式检测 GNU sed)。仓库工具链(`--verify` / `npm test`)需要
   Node >= 22.18;插件本身运行在 Node 18+ 即可。
2. **一条命令装完整条链**:
   ```bash
   ./install.sh
   ```
   幂等,可放心重跑。它会:打包两个插件装进 `web` profile、把两行挂载写进
   profile 补丁层(该 profile 的所有会话都有工具)、创建 `enhance` 预设
   (shipped `standard` 预设 + 关闭内置 `web_search`)并设为新会话默认。若
   `dsh web` 正在运行则**无需重启**(补丁层热加载);没运行的话直接启动
   `dsh web` 即可。(`./install.sh --restart` 会自己完成受控重启,见
   [bin/restart-web.sh](bin/restart-web.sh)。)
3. **配置工具**:Web 界面 → **设置 → 插件 → dsh-vision / dsh-native-web**
   (字段说明见下)。配置之前调用工具会报明确的 "not configured" 错误 ——
   属预期。
4. **端到端自检**:随便开一个会话,发送
   [自检提示词](docs/self-test-prompt.md)。
5. **跑一遍回归套件**(可选但推荐):
   ```bash
   ./install.sh --verify   # 等价于 npm test
   ```

## install.sh 做了什么

每一步都会检测自己之前的结果并跳过(已装好的 profile 会直接短路打包+安装):

1. 硬检查 `dsh` / `npm` / `pnpm` / `realpath` / GNU sed —— 缺工具直接报红,
   绝不静默跳过;
2. 打包两个插件并用 `dsh plugin --profile <name> add` 安装 —— 真实生产安装
   路径;tarball 保存在 `$DSH_HOME/enhance-pkgs`,profile 里的 `file:` 依赖
   重装后仍可解析(之后迁移 `$DSH_HOME` 需要重跑 `install.sh`);
3. 向 profile 的 `cordis.patch.yml` 追加两行纯挂载点;半挂载状态会自愈
   (只补缺失的行,绝不重复);
4. 复制**当前 dsh 安装自带的 shipped `standard` 预设**为 `enhance` 预设并
   关闭内置 `web_search`,再设为后续新会话的默认预设。刻意不复制 cordis
   预设:同进程里两个 cordis 系预设会在宿主检查提供者上冲突;
5. 可选 `--restart`(仅 web profile,走 `bin/restart-web.sh` 受控重启)与
   `--verify`(跑 `npm test`)。

## 配置

以下全部在 Web 设置表单里改(设置 → 插件);修改在下一次工具调用时生效,
无需重启。

### dsh-vision

| 字段 | 含义 |
|---|---|
| `baseUrl` | Responses API 兼容端点根地址,例如 `https://api.openai.com/v1` —— 任何支持 `/responses` 的服务商都行 |
| `model` | 该端点提供的多模态模型名 |
| `apiKey` | 明文密钥(按 secret 存储、传输脱敏)。留空 → 读 `apiKeyFile` |
| `apiKeyFile` | 存放密钥的 JSON 文件(`$HOME` 下相对路径或绝对路径),按 `apiKeyField` 取字段 |
| `apiKeyField` | JSON 文件里的字段名(默认 `API_KEY`) |
| `detail` | 默认图像精度:`auto` / `low` / `high` |
| `maxImageBytes` | 本地图片 base64 编码前的体积上限(默认 20 MB) |
| `timeoutMs` | 单次调用超时 |

### dsh-native-web

| 字段 | 含义 |
|---|---|
| `baseUrl` | 自托管实例根地址,例如 `http://127.0.0.1:3002`。留空 → 调用时探测 `probeUrls` |
| `probeUrls` | `baseUrl` 为空时逐个探测的候选地址 |
| `apiKey` | 实例 API key。留空 → 不带 `Authorization` 头(`USE_DB_AUTHENTICATION=false` 的实例不需要) |
| `apiVersion` | API 前缀:自托管 Firecrawl 2.11.x 用 `v1`;云文档写的是 `v2` |
| `searchTimeoutMs` / `scrapeTimeoutMs` | 单次调用超时 |

联网实例本身(docker compose,见
[firecrawl/firecrawl](https://github.com/firecrawl/firecrawl))必须已启动:
工具会懒解析实例,实例不在时第一次调用会报明确的
"no local web instance detected" 错误。

## 挂载组合行(手工参考)

`install.sh` 自动采用方式 A。两种方式等价 —— 手工安装时二选一(行是纯挂载点,
可直接复制 `presets/vision.cordis.yml` 与 `presets/native-web.cordis.yml`):

**A. Profile 补丁层——该 profile 的所有会话从一开始就生效。**
向 profile 的 `cordis.patch.yml` 追加 insert 补丁:

```yaml
- insert:
    - id: vision
      name: '@vcxmug/dsh-vision'
    - id: native-web
      name: '@vcxmug/dsh-native-web'
```

补丁层会被运行中的 `dsh` 热加载,重启后依然存在,无需选预设或重启会话。

**B. 单个 Agent 预设——只对使用该预设的会话生效。** Web 界面:设置 →
Agent 预设 —— 新建预设(或复制现有预设)并加入两行:

```yaml
- id: vision
  name: '@vcxmug/dsh-vision'
- id: native-web
  name: '@vcxmug/dsh-native-web'
```

两个注意点:两种方式里的 `config:` 键都会成为设置表单的 base 层;另外
**不要复制会注册第一方检查提供者的预设**(创造模式 cordis 预设就是),同时
与原预设的会话同进程运行 —— 两次挂载会注册同一份进程级提供者,第二次挂载
会被拒绝。

## 更新与卸载

**更新**插件:重新打包出新版本 tarball 后
`dsh plugin --profile <name> add <new.tgz>`(会更新记录的 `file:` 指向),
然后重跑 `./install.sh` 刷新其余部分。

**卸载**:

```bash
dsh plugin --profile web remove @vcxmug/dsh-vision @vcxmug/dsh-native-web
rm -rf "$DSH_HOME/.agent-presets/enhance"
# 若不再需要默认预设覆盖,再从 $DSH_HOME/settings.yaml 删除 agent-presets: 段
```

## 环境要求

- DeepSeek Harness 0.1.0-rc.6+(web profile;预设位于 `$DSH_HOME/.agent-presets`)
- 运行时(插件):Node 18+(全局 `fetch`);仓库工具链(测试/typecheck):
  Node >= 22.18
- 识图:任意支持 OpenAI Responses API(`/responses`)的多模态端点,官方或
  第三方均可
- 原生联网:一个可访问的自托管 Firecrawl 兼容实例
  (`USE_DB_AUTHENTICATION=false` 的实例接受任意 API key)

## 仓库结构

```
install.sh                  # 一条命令安装整条链
bin/restart-web.sh          # 受控重启 dsh web + 健康检查
packages/dsh-vision/        # 识图插件(TS 源码在 src/,构建产物 lib/ 已提交)
packages/dsh-native-web/    # 原生联网插件(同上)
presets/                    # 纯挂载点组合片段
docs/                       # 已知限制与自检提示词
tests/                      # 安装路径回归套件 + 脚本化 mock LLM
```

## 备注

- **为什么插件不携带运行时 `dependencies`**:Harness 安装自带的包
  (`@deepseek-ai/dsh-tools`、`schemastery` 等)被声明为可选 peer 依赖。
  若写成普通依赖,pnpm 会把**第二份副本** hoist 进 profile 的
  `node_modules`,遮蔽组合行解析到的 Harness 自带副本,破坏模块级身份
  (例如 `dsh-tools` 的工具运行时 Symbol)—— 冷启动后每次工具调用都会死于
  `Cannot read properties of undefined (reading 'prepare')`。回归套件钉死了
  这条不变式,见 `tests/install-and-loop.test.ts`。
- 原生联网 vs MCP:MCP 每次调用都要经过 DSH MCP 客户端和一个
  `firecrawl-mcp` 子进程 —— 多跳、多回合。原生路线是对你的实例直发一次
  HTTP。(想用 MCP?上游的 `@deepseek-ai/dsh-mcp-client` 仍然可用。)
- 已知限制:见 [docs/known-limitations.md](docs/known-limitations.md)。
- 端到端验证:[docs/self-test-prompt.md](docs/self-test-prompt.md)。

## 测试

`npm test` 运行安装路径回归套件(无需 API key;修复后的包安装不依赖注册表):
先用 `npm pack` 打包两个插件,再用生产命令 `dsh plugin add` 把真实 tarball
装进一次性 profile,然后断言根本不变式 —— profile 的 node_modules 里绝不
出现 Harness 安装自带包的第二份副本 —— 最后用脚本化 mock LLM 驱动一次真实
的 headless agent 工具循环。需要 Node >= 22.18(原生运行 TypeScript,无需
构建)、PATH 上的 `dsh`(或 `DSH` 环境变量)、npm 和 pnpm。工具链缺失时测试
**报红**、绝不静默跳过:跳过的绿套件会恰好放行本套件要拦截的那类回归。

`npm run typecheck` 检查测试源码类型;`npm run build` 从 `src/` 重建两个插件
的 `lib/`。两者都需要先安装开发依赖(仓库根与各包目录内执行
`npm install`)。

License: MIT
