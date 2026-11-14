# DeepSeek 朗读（dsh-deepseek-tts）

在 DeepSeek Harness 里用 DeepSeek 官方 TTS 朗读助手回复。默认静音，只有点击按钮或显式打开自动播报才会出声。

当前版本：`0.4.0-beta.6`（预发布）。安装后刷新页面即可使用。

## 0.4.0-beta.6 预发布说明

- **修复自动播报“只响提示音、不出声”**：turnTail 组件卸载时不再取消正在执行的自动播报；新回复完成后会正常走总结 + 流式合成。
- 增加 [TEST-REPORT.md](./TEST-REPORT.md)：手动朗读、流式播放、自动播报、试听、缓存、Key 灯的时间轴与消耗记录。
- 功能与 0.4.0-beta.5 一致。

## 0.4.0-beta.5 预发布说明

- **设置面板二次清洗**：去掉卡片说明与文件中转路径；按钮改为「保存 / 清除 / 试听」「保存 / 重载」「清理」，下拉改为「总结（推荐）/ 全文」，开关改为「启用人设」「任务完成后自动播报」「播报前播放提示音」。
- Key 隔离、人设优先级等说明改为悬停提示，不再占用面板正文。
- 功能与 0.4.0-beta.4 一致。

## 0.4.0-beta.4 预发布说明

- **Key 说明文案修正**：设置面板改为「只存入插件自己的凭据，不影响 DSH 本体」，不再出现「保存后同 DSH 共用」的旧说法。
- 功能与 0.4.0-beta.3 一致。

## 0.4.0-beta.3 预发布说明

- **Key 状态灯**：左侧栏 / 设置页的「API Key」标题旁增加状态圆点——绿色已配置、红色未配置、琥珀色检查中。
- **Key 与 DSH 本体隔离**：插件把 Key 存在自己的凭据记录 `dsh-deepseek-tts/api-key`，不写入共享的 `DEEPSEEK_API_KEY`，正常朗读/总结也不会把共享 Key 当作插件 Key；DSH 的模型 provider 与账户登录不受影响。旧版本写入的共享 Key 只会在首次使用同一 Key 时读取比对并迁移到插件记录，随后从共享 refs 移除。
- 版本 0.4.0-beta.3，功能与 0.4.0-beta.2 一致。

## 0.4.0-beta.2 预发布说明

- **设置面板精简**：去掉顶部长介绍、卡片说明和底部分发说明，只保留字段与必要提示；左侧栏页面更紧凑。
- 其余行为与 0.4.0-beta.1 相同：Host 模块化、流式首包即播、总结/全文、soul.md 人设、自动播报、语音缓存、人设开关都保留。

## 0.4.0-beta.1 预发布说明

- **Host 代码结构化**：`index.js` 只保留路由注册；实现拆到 `lib/config.js`、`lib/http.js`、`lib/credentials.js`、`lib/soul.js`、`lib/summary.js` 与 `lib/routes/*.js`，便于单独测试与维护。
- 行为与 0.3.4 一致：侧栏入口、流式首包即播、总结/全文、soul.md 人设、自动播报、语音缓存、人设开关都保留。
- 预发布包通过 `npm pack` 生成，位于 `dist/dsh-deepseek-tts-0.4.0-beta.1.tgz`；安装方式不变。
- 这是预发布版本，接口与文件结构仍可能调整；稳定版将去掉 `-beta` 标记。

## 本次更新（0.3.x）

- **流式 TTS，首包即播**：不再等整段 WAV 合成完。浏览器直接连接 DeepSeek TTS WebSocket，收到第一个 PCM 包就开始播放，后续边收边播；长回复的等待从「整段合成」缩短为「首包时间」。
- **soul.md 人设**：插件目录下的 `soul.md` 控制总结的口吻与风格；左侧栏或设置页可直接编辑、保存、重新加载。修改后新的总结立即使用新人设，旧总结缓存自动失效。人设旁新增**启用人设**开关：关闭后 soul.md 与「人设 / 语气」都不进入总结 prompt，使用中性口吻。
- **总结仍走 DeepSeek Chat**：先总结再朗读；短回复、总结缓存命中时会跳过总结，直接进入流式 TTS。
- 仍保留：总结/全文开关、`stella`/`tide` 声线、任务完成自动播报、完成提示音、语音缓存与清理、首次点击引导填 Key。
- **开关控件**：人设启用、自动播报、完成提示音统一改为滑动开关，与 DSH 设置风格一致；版本升至 `0.3.2`。
- **人设优先级**：`soul.md` 优先级最高，是身份与规则的权威来源；设置页「人设 / 语气」只在不冲突时补充口吻，冲突时以 soul.md 为准。`0.3.4` 修正了此前把优先级写反的问题，并升级总结缓存版本，旧缓存自动失效。

## 功能

- **左侧栏入口**：左侧栏「DeepSeek 朗读」打开完整设置面板，不用每次进设置弹窗。
- **两种播报方式**：默认「总结」——先把长回复压缩成 2–3 句口语再合成；可切换「全文」——按原文分句朗读。
- **两种声线**：`stella`（女声，默认）与 `tide`（男声）。
- **soul.md 人设**：用 Markdown 文件描述助手是谁、怎么说话，优先级最高；设置页的「人设 / 语气」只在不冲突时补充口吻。总结 prompt 会同时使用两者。
- **任务完成自动播报**：打开后，回复完成时自动朗读总结；可再打开「完成提示音」，先响一声再读。
- **流式播放**：TTS 音频以 24kHz PCM 流式返回，插件按时间轴顺序调度，首包到达即开始播放；播放中可随时停止。
- **语音缓存**：合成过的音频存进本机 IndexedDB，同一段文字再次朗读直接播放，不再消耗 TTS 额度。缓存跨会话保留，默认最多 120 条 / 200 MB，按时间淘汰。
- **总结缓存**：同一段文字 + 同一人设的总结存本地，7 天内复用，最多 50 条；soul.md 或人设变化后自动失效。
- **可停止、可取消**：播放中再点停止；合成中再点会中断请求，不会迟来播放；开始朗读另一条时上一条自动停止。
- **Key 安全**：Key 只保存在本机浏览器 `localStorage` 与 DSH 凭据的插件私有记录 `dsh-deepseek-tts/api-key`；不写入共享的 `DEEPSEEK_API_KEY`，正常使用也不会把共享 Key 当作插件 Key，因此不会影响 DSH 本体的模型调用。请求只发往 `api.deepseek.com`。首次点击没有 Key 时会弹窗引导填写。

## 安装

仓库地址：<https://github.com/Kylin412/dsh-tts>。

```powershell
git clone https://github.com/Kylin412/dsh-tts.git
# 在 DSH 会话中安装；把绝对路径换成克隆下来的目录
plugin_manager install_bundle C:\path\to\dsh-tts
```

预发布包：`dist/dsh-deepseek-tts-0.4.0-beta.6.tgz`，校验值在 `dist/SHA256SUMS.txt`。分发时把 tgz 或整个仓库目录交给目标机器即可。

- 客户端 `client.js` 更新后刷新页面即可。
- Host `index.js` / `lib/` 更新后，对 `include:dsh-deepseek-tts` 执行一次 disable/enable，或重启 DSH。
- `soul.md` 会随包一起安装；也可以设置环境变量 `DSH_TTS_SOUL` 指向其他文件。

## 配置

打开左侧栏「DeepSeek 朗读」（或「设置 → DeepSeek 朗读」），可以配置：

1. **API Key**：填 `sk-` 开头的 DeepSeek 开放平台 Key，保存 / 清除 / 试听。标题旁圆点表示状态：绿=已配置，红=未配置，琥珀=检查中。
2. **朗读内容**：总结（推荐）或全文。
3. **回复声线**：`stella` 女声 / `tide` 男声。
4. **人设 / 语气**：一句话补充，例如「像同事汇报，语气温和、不啰嗦」。soul.md 优先，这里只在不冲突时补充口吻。
5. **人设 soul.md**：显示文件路径与是否存在，可直接编辑正文并保存；保存后清空旧总结缓存。旁边的「启用人设」开关关闭时，soul.md 与「人设 / 语气」都不生效。
6. **自动播报**：任务完成后自动播报总结；打开「自动播报前播放完成提示音」可先响一声再读。
7. **语音缓存**：查看已缓存条数与占用，点击清理。

> DSH 账号登录令牌不能调用 TTS，必须是 DeepSeek 开放平台的 `sk-` API Key。也可以在启动 DSH 前通过环境变量 `DSH_TTS_API_KEY` 提供；插件不会读取或覆盖 DSH 共享的 `DEEPSEEK_API_KEY`。

## 使用

1. 等助手回复完成。
2. 鼠标移到回复底部，点 🔊（图标与复制、点赞、分享按钮同一行）。
3. 默认先请求总结（约 0.7–1.2 秒），随后连接 TTS WebSocket：首个音频包约 1.2 秒到达并立即播放，按钮显示加载环，开始播放后变为停止方块。
4. 再点一次停止。按钮的 `title` 会显示「朗读这条回复的总结」/「停止朗读」等状态。

打开自动播报后，每个会话只对最新完成的回复自动播报一次；浏览器可能拦截自动播放，此时仍可手动点 🔊。

### 关于「0 延迟」

TTS 的等待由「整段 WAV 合成完」变成「首包到达」：首包一到就播，后续音频在播放过程中继续接收。总结阶段仍需要一次 DeepSeek Chat 调用（约 0.7–1.2 秒）；短回复会跳过总结，总结缓存命中时也没有这一步，因此可以更快进入播放。

## 限制

- 单次朗读正文最多 4000 字，超出截断；总结输入最多 12000 字。
- 一次只播放一条回复。
- TTS 接口本身不支持语速控制；本插件暂未提供语速设置。
- 总结走 DeepSeek Chat，会产生少量额外 token 费用；总结失败会回退为本地提取式摘要。
- 流式播放使用浏览器直连 `wss://api.deepseek.com` 和 `localStorage` 中的 Key；没有 Key 或浏览器 WebSocket 失败时自动回退到 Host 的 WAV 路由。
- 需要本机可访问 `api.deepseek.com`；网络失败时按钮变红并在 `title`/弹窗中提示原因。
- 浏览器自动播放策略要求首次播放来自真实用户操作；自动播报被拦截时属预期行为。
- 音频缓存按「声线 + 文字内容」去重；修改人设只影响总结，不影响已缓存音频。

## 分发与不同设备

- 这是本地 bundle，不依赖 npm 发布；把整个 `tts-plugin` 目录（含 `soul.md`）拷到目标机器，用 `plugin_manager install_bundle` 安装即可。
- Key 存在 DSH 凭据的插件私有记录 `dsh-deepseek-tts/api-key` 里时，同一 DSH 的其他浏览器/设备无需重复填写；但浏览器 `localStorage` 里的副本按浏览器隔离。
- 界面沿用 DSH 主题变量与 28px 动作栏尺寸，桌面/窄屏由 DSH 自身布局适配；窄屏下左侧栏入口与设置面板均可正常使用。
- 不同设备需各自满足：能访问 `api.deepseek.com`、浏览器允许 IndexedDB、Audio 与 WebSocket 播放。

## 实现

- **Host（`index.js` + `lib/`）**：四个同源路由，路由实现按文件拆分
  - `lib/routes/speak.js`：`POST /api/dsh-tts/speak`，读 Key，调用 `https://api.deepseek.com/v1/tools/tts`（`voice_id=stella|tide`、`format=wav`），返回 `audio/wav`，作为流式失败时的回退。
  - `lib/routes/summarize.js`：`POST /api/dsh-tts/summarize`，读 Key，调用 `https://api.deepseek.com/chat/completions`（`deepseek-chat`，temperature 0.2，max_tokens 300），读取 `soul.md` + persona 组成 system prompt，返回 `{summary, source}`；短文本直接回原文。
  - `lib/routes/key.js`：`GET/POST/DELETE /api/dsh-tts/key`，查询 / 保存 / 清除 DSH 凭据中的插件私有记录 `dsh-deepseek-tts/api-key`；不写共享 `DEEPSEEK_API_KEY`。
  - `lib/routes/soul.js`：`GET/POST /api/dsh-tts/soul`，读取 / 保存 `soul.md`（UTF-8，≤20000 字节）。
  - `lib/config.js` 常量、`lib/http.js` JSON 响应、`lib/credentials.js` Key 解析、`lib/soul.js` 文件读写、`lib/summary.js` prompt 与摘要清洗。
- **Client（`client.js`）**：
  - `conversation.chat.assistant-actions`：每条已完成回复的 🔊 按钮。
  - `conversation.chat.turnTail`：自动播报（只处理新 settled 的 turn）。
  - `sidebar.panellist` + `main`：左侧栏入口与设置面板。
  - `settings.section`：设置弹窗中的「DeepSeek 朗读」页。
  - 流式播放：`wss://api.deepseek.com/v1/tools/tts?voice_id=...&format=pcm`，子协议 `['tts', 'bearer.<key>']`；PCM 转 AudioBuffer 顺序调度。
  - IndexedDB `dsh-deepseek-tts-cache` v2（`audio` / `meta`）；总结缓存 localStorage `dsh-deepseek-tts/summaries`。

## 卸载

```powershell
plugin_manager remove_bundle dsh-deepseek-tts
```

浏览器里的 Key 可在设置页点「清除」删除；语音缓存可在设置页点「清理」。
