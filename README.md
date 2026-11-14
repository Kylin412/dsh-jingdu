# 鲸读（dsh-jingdu）

在 DeepSeek Harness 中把助手回复变成语音。**鲸读**默认静音，点按才读；也可以打开任务完成自动播报。支持总结/全文两种模式、流式首包即播、`soul.md` 人设、`stella`/`tide` 双声线，以及本机音频与总结缓存。

> 当前版本 `1.0.0`。仓库：<https://github.com/Kylin412/dsh-jingdu>
>
> 测试数据见 [TEST-REPORT.md](./TEST-REPORT.md)，版本记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 特性

- **点按朗读**：每条已完成回复下方出现 🔊 按钮；播放中可暂停/停止，合成中可取消。
- **总结优先**：长回复先由 DeepSeek Chat 压成 2–3 句口语再合成；短回复直接朗读。可在设置中切换为全文模式。
- **流式播放**：浏览器直连 DeepSeek TTS WebSocket，首个 PCM 包到达即开始播放，不再等整段 WAV。
- **自动播报**：回复完成时可自动朗读；可选在朗读结束后响一声提示音（不再在开始前响，避免和 DSH 自带完成音重复）。默认关闭。
- **`soul.md` 人设**：用 Markdown 定义助手的身份、语气与规则；设置页可直接编辑、保存、重载，也可一键关闭。
- **双声线**：`stella`（女声）/ `tide`（男声）。
- **本地缓存**：音频写入 IndexedDB，重复内容直接播放；总结写入 localStorage，7 天内复用。音频默认最多 120 条 / 200 MB，按时间淘汰；总结最多 50 条。
- **Key 隔离**：API Key 只写入插件私有凭据与当前浏览器，不污染 DSH 共享的 `DEEPSEEK_API_KEY`；Key 旁有绿/红状态灯。
- **左侧栏入口**：不用每次打开设置弹窗，常用配置在侧栏面板内完成。

## 快速开始

### 环境要求

- 已安装并可运行的 DeepSeek Harness（Web profile，`0.2.2` 系列）。
- Node.js 22 或更高版本。
- 一个 DeepSeek 开放平台的 `sk-` API Key。DSH 账号登录令牌不能调用 TTS。
- 浏览器可访问 `api.deepseek.com`，并允许 WebSocket、IndexedDB 与音频播放。
- 运行时无需额外 npm 依赖；React 由 DSH 客户端提供。

### 安装

从 npm 安装（包发布后）：

```powershell
dsh plugin --profile web add dsh-jingdu
```

从源码安装：

```powershell
git clone https://github.com/Kylin412/dsh-jingdu.git
dsh plugin --profile web add ./dsh-jingdu
```

也可以在已启动的 DSH 会话中安装 bundle 目录，把路径换成克隆后的绝对路径：

```text
plugin_manager install_bundle C:\path\to\dsh-jingdu
```

安装完成后刷新页面，左侧栏会出现「鲸读」。

离线分发可以使用 `dist/dsh-jingdu-1.0.0.tgz`；校验值见 `dist/SHA256SUMS.txt`。

### 从旧版升级

旧版包名是 `dsh-deepseek-tts`。先移除旧 bundle，再安装 `dsh-jingdu`：

```text
plugin_manager remove_bundle dsh-deepseek-tts
```

Key、设置与缓存沿用旧内部存储键，升级后不会丢失；显示名与 bundle 标识统一为 `dsh-jingdu`。

### 第一次使用

1. 打开左侧栏「鲸读」。
2. 填入 `sk-` 开头的 API Key，点「保存」；标题旁圆点变绿表示已配置。
3. 点「试听」确认能出声；也可以在任意助手回复下点 🔊。
4. 如需自动播报，打开「任务完成后自动播报」。

没有 Key 时，第一次点 🔊 也会弹出填写引导。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| API Key | 空 | DeepSeek 开放平台 Key；只存入插件私有凭据与本机浏览器 |
| 朗读内容 | 总结 | 「总结」先压缩再读；「全文」按原文分句朗读 |
| 回复声线 | `stella` | `stella` 女声 / `tide` 男声 |
| 人设 / 语气 | 空 | 对 `soul.md` 的补充，只在不冲突时生效 |
| 启用人设 | 开 | 关闭后 `soul.md` 与人设 / 语气都不进入总结 prompt |
| 任务完成后自动播报 | 关 | 只对 30 秒内新完成、且未播过的回复自动朗读一次 |
| 播报结束后播放提示音 | 开 | 自动朗读结束后响一声；关闭自动播报时不可用 |
| 语音缓存 | 开启 | 显示条数与占用，可一键清理 |

人设优先级：`soul.md` 最高，是身份与规则的权威来源；设置页的「人设 / 语气」只在不冲突时补充口吻。

## 使用

### 手动朗读

1. 等助手回复完成。
2. 鼠标移到回复底部，点 🔊（与复制、点赞、分享同一行）。
3. 默认先请求总结，再进入 TTS；按钮显示加载环，开始播放后变为停止方块。
4. 再点一次停止。

### 自动播报

在设置中打开「任务完成后自动播报」即可。浏览器通常要求页面先有一次真实交互才能自动播放声音；刷新后点一下页面，或先手动播放一次。

### 关于「0 延迟」

插件把等待从「整段 WAV 合成完」变成「首包到达」：第一个 PCM 包一到就播，后续音频边收边播。总结阶段仍需要一次 DeepSeek Chat 调用（约 0.7–1.2 秒）；短回复、总结缓存命中时可以跳过这一步。

## 工作原理

### Host 路由

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/api/dsh-tts/speak` | POST | 读取 Key，调用 `https://api.deepseek.com/v1/tools/tts`，返回 `audio/wav`；作为流式失败时的回退 |
| `/api/dsh-tts/summarize` | POST | 调用 `https://api.deepseek.com/chat/completions`（`deepseek-chat`），把长回复压成口语总结；短文本直接回原文 |
| `/api/dsh-tts/key` | GET/POST/DELETE | 查询/保存/清除插件私有凭据记录 `dsh-deepseek-tts/api-key` |
| `/api/dsh-tts/soul` | GET/POST | 读取/保存 `soul.md`（UTF-8，上限 20 KB） |

Key 解析顺序：请求头 `x-dsh-tts-key` → 请求体 `apiKey` → 插件私有凭据记录 → 环境变量 `DSH_TTS_API_KEY`。不会读取或覆盖 DSH 共享的 `DEEPSEEK_API_KEY`。

凭据记录名沿用 `dsh-deepseek-tts/api-key`，这是旧版留下的内部名称，只为升级时不丢 Key；显示名与新包名均为 `dsh-jingdu`。

### Client 挂载点

- `conversation.chat.assistant-actions`：每条已完成回复的 🔊 按钮。
- `conversation.chat.turnTail`：自动播报，只处理新 settled 的 turn。
- `sidebar.panellist` + `main`：左侧栏入口与完整设置面板。
- `settings.section`：设置弹窗中的「鲸读」页。

### 音频链路

1. 清理正文，按长度决定「总结」或「全文」。
2. 请求 `/api/dsh-tts/summarize` 得到朗读文本。
3. 浏览器有本地 Key 时直连 `wss://api.deepseek.com/v1/tools/tts`，使用 `format=pcm`；PCM 转 24kHz mono `AudioBuffer` 顺序调度。
4. 流式不可用时回退到 Host 的 `/speak`，拿到 WAV 后用 `Audio` 播放。
5. 播放结束把音频写入 IndexedDB；总结写入 localStorage。

## 隐私与安全

- 文本与音频只发送到 `api.deepseek.com`；插件没有遥测、没有第三方上传。
- Key 保存在两处：当前浏览器 `localStorage` 与 DSH 凭据的插件私有记录。它不会写入 DSH 共享 Key。
- 清除 Key：设置页点「清除」，两处副本都会删除。
- 音频与总结缓存只在本机；可在设置页清理。
- 仓库与发布包不包含 API Key。

## 性能与消耗

实测环境与完整时间轴见 [TEST-REPORT.md](./TEST-REPORT.md)。

| 场景 | 实测 |
| --- | --- |
| 手动朗读（总结 + WAV） | 点击到播放约 3.7s；其中总结约 1.0s、WAV 约 2.5s |
| 流式播放 | WebSocket open 约 0.15s；首个音频帧约 0.95s |
| 缓存回放 | 约 0.14s，无新 TTS 请求 |
| 试听 | 约 1.6s 开始播放 |
| 自动播报（流式） | 合成开始后约 1.2s 首帧 |

TTS 按计费字符收费（中文 1 字按 2 个计费字符）。一条约 60 字总结、11 秒音频的朗读，限时价约 ¥0.02–0.04/次；短句自动播报通常不到 ¥0.01。总结 LLM 调用另计，通常很低。实际费用以 DeepSeek 账单为准。

## 限制

- 单次手动朗读正文最多 4000 字；总结输入最多 12000 字；`soul.md` 最多 20000 字节。
- TTS 接口单请求最多 10000 计费字符，且不支持语速控制；插件暂未提供语速设置。
- 一次只播放一条回复；开始新的朗读会停止上一条。
- 流式播放依赖浏览器 `localStorage` 中的 Key；只有服务端 Key 时会回退到较慢的 WAV 路径。
- 浏览器自动播放策略可能拦截自动播报；这是浏览器行为，手动点 🔊 不受影响。
- 目前只适配 DSH Web profile；移动端浏览器未做专门适配。

## 常见问题

**点了 🔊 没有声音？**

1. 先刷新页面（必要时 `Ctrl+F5`），确认左侧栏面板里的 Key 是绿点。
2. 点设置页「试听」：能听到说明链路正常，问题在具体回复或自动播放策略；听不到则检查标签页静音、系统输出设备与浏览器权限。
3. 自动播报需要页面先有一次用户交互；刷新后点一下页面再试。
4. 仍然无声时，按 F12 看 Console/Network 是否有 401、409 或 WebSocket 错误。

**提示 401 / `Authentication Fails`？**

TTS 必须使用 `sk-` 开头的开放平台 API Key。DSH 账号登录令牌只能用于聊天，不能调用 TTS。

**提示 `missing_api_key` / 409？**

设置页还没保存 Key。填入后保存，或按首次点击的弹窗提示填写。

**更新后界面没变化？**

客户端 `client.js` 更新后刷新页面；Host `index.js` / `lib/` 更新后对 `include:dsh-jingdu` 执行一次 disable/enable，或重启 DSH。

**如何更换人设文件？**

直接编辑设置页的 `soul.md` 文本框并保存；也可以用环境变量 `DSH_TTS_SOUL` 指向其他文件。

## 开发与打包

仓库没有构建步骤：`client.js` 是手写的 `window.__ModuleLoader__.load(...)` 客户端 bundle，Host 直接以 ESM 运行。

```powershell
node --check client.js
node --check index.js
npm pack --pack-destination dist
```

安装后调试：

- 客户端改动：刷新页面。
- Host 改动：重载 `include:dsh-jingdu`，或重启 DSH。
- 卸载：`plugin_manager remove_bundle dsh-jingdu`。

### 目录结构

```text
dsh-jingdu/
├─ index.js              # Host 路由注册
├─ lib/
│  ├─ config.js          # 常量
│  ├─ http.js            # JSON 响应
│  ├─ credentials.js     # Key 解析与隔离存储
│  ├─ soul.js            # soul.md 读写
│  ├─ summary.js         # 总结 prompt 与清洗
│  └─ routes/            # speak / summarize / soul / key
├─ client.js             # 客户端：按钮、面板、流式、缓存
├─ soul.md               # 默认人设
├─ locale/               # 中英文元数据
├─ dist/                 # tgz 与校验值
├─ TEST-REPORT.md
├─ CHANGELOG.md
├─ LICENSE
└─ README.md
```

## 友链

- [LINUX DO](https://linux.do) —— 中文技术社区；感谢社区与佬友的监督。

## 许可证

本项目采用 [MIT License](./LICENSE)。

Copyright (c) 2026 Kylin412
