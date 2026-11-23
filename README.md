# dsh-link

**在同一局域网里，把手机上的 DSH 和电脑上的 DSH 直连起来。** 手机接着用电脑的会话、看实时输出；电脑每轮跑完把结果推回手机；电脑还能把新版本插件直接推到手机──无隧道、无第三方域名、无公网中继。

- 手机端不另开模型：直接驱动电脑上那一台，模型、工作区、文件都在电脑那边；
- 流量只走局域网（跨网络可选 DDNS，见下文）；
- 一个包，两端都装：启动时读 `<DSH_HOME>/dsh-remote/role.json` 的 `role`，只加载对应那一半实现。

当前版本 **0.22.1**。

## 它是什么、不是什么

| 是 | 不是 |
|---|---|
| 手机 ↔ 电脑 的局域网直连桥 | 远程桌面 / 投屏 |
| 手机接着用**电脑的** DSH 会话 | 手机自己跑模型推理 |
| 自签证书 + 指纹 pin 的加密链路 | 依赖任何第三方账号或云端 |
| 每轮结束把结果推回手机 | 全量会话云同步 |

## 工作原理

1. **配对**：手机先发起，电脑弹卡片确认（卡上 6 位数字与手机端一致）。确认后手机进入设备白名单，拿到一把 `pairKey` 用于反向通道。
2. **通道**：两端各起一个 TLS 网关（电脑 `8899` / 手机 `8898`），自签证书 + **指纹 pin**，不信任系统 CA。手机 → 电脑走 RPC 与 SSE 实时流；电脑 → 手机走 `agent-message` / `plugin-install`，凭 `x-link-key` + 时间戳 + **一次性 nonce**。
3. **打开会话（0.22.0 起）**：**联机时同步会话一律走远端流**──首屏历史按官方分页协议向电脑要（`page` → 电脑 `readHistory`，每页 500 条、最多取到 2000 条），实时事件纯转发；**往上滑也代理到电脑**（`beforeSeq` / `throughSeq` 原样透传），`hasMore` 据实回报。本地镜像只在**断线**时兜底。这样不会出现「本地镜像半截 → 官方读盘判损坏 → 历史加载失败」，也不会只有开头一小段、往上翻不动。
4. **自动同步（autosync）**：每 `syncIntervalMs`（缺省 10 秒，最小 5 秒）拉一次电脑的会话清单，把**新出现、非空白、非归档**的会话登记到手机侧边栏。基线只记**真正建成**的 id；逐条失败进退避表（10s → 10min）并上报，不会一次失败就永久拉黑。

所有运行时数据都在 `<DSH_HOME>/dsh-remote/`（默认 `~/.dsh/dsh-remote/`），不进仓库、不上传。

## 安装

两端装**同一版本**（跨版本时反向通道可能因协议差异 401）：

```bash
# 电脑、手机各一次
dsh plugin add @k-w7/dsh-link@0.22.1

# 离线也可以
dsh plugin add --offline file:k-w7-dsh-link-0.22.1.tgz

# 确认/写角色：电脑 desktop，手机 mobile
#   <DSH_HOME>/dsh-remote/role.json → {"role": "desktop"}
#   <DSH_HOME>/dsh-remote/role.json → {"role": "mobile"}

# 重启 DSH
```

首次启动按平台预填角色（Windows / macOS → `desktop`，其余 → `mobile`），可随时改；也可用插件配置 `{ role }` 或环境变量 `DSH_LINK_ROLE` 覆盖。

## 配对（只做一次）

1. 电脑：`设置 → 局域互联`，确认监听地址与端口（默认 `0.0.0.0:8899`）；
2. 手机：`设置 → 局域互联` → 填电脑局域网 IP 与端口 → 「测试连接」（显示证书指纹前 8 位与耗时）→「保存并连接」；
3. 电脑弹出确认卡片：卡上 6 位数字应与手机端一致，核对后点「允许」；
4. 手机状态变为「已连接」，电脑勾选的工作区自动同步过来。

> 提示「电脑不认识这台手机」= 不在白名单里，重走第 2~3 步。

## 日常用法

- **接续电脑会话**：手机打开电脑页签，选工作区/会话直接发消息，实时看输出。
- **回合结束通知**：只回投**手机发起**的那一轮；触发条件（每轮 / 仅出错 / 仅长任务）与保留天数在 `设置 → 局域互联 → 通知推送` 里配。
- **手机 → 电脑 主动推消息**（给 agent / 本机调用方，无 UI）：

  ```jsonc
  POST /api/dsh-remote/rpc          // 手机本地宿主桥（同源）
  { "method": "sendToDesktop", "params": { "text": "把今天的报告发我", "sessionId": "…（可选）" } }
  // { "ok": true, "sessionId": "…" } 或 { "ok": false, "error": "…" }
  ```

- **电脑给手机装 / 升级插件**：

  ```bash
  node <profile>/node_modules/@k-w7/dsh-link/scripts/link-install.mjs <插件.tgz>
  # 也可显式指定 --url https://<手机>:8898 与 --key <pairKey>
  ```

  手机会弹一张确认卡（**必须人工点「允许」**），装完返回 `requiresRestart: true`，**重启手机 DSH 才生效**。
  - 0.20.0 起确认不再依赖「活着的运行时根 agent」：没有 agent 时改走手机界面上的确认条；只有当**手机界面一个订阅者都没有**（App 不在前台/没加载）时才回 `503 no-confirm-channel`。
  - 收包端支持 scope 包名（`@scope/name`），`inbox` 与 `backups` 目录不会因为 `/` 拼不出来而 ENOENT。

- **手机给电脑推插件**：手机装了比电脑新的版本时，会自动把包推给电脑换装（电脑重启后生效）。

## 会话同步模型（0.22.x）

| 场景 | 行为 |
|---|---|
| 联机 + 打开某个同步会话 | 走**远端流**：首屏历史向电脑取（每页 500 条、上限 2000 条）+ 转发电脑实时事件，不读本地镜像 |
| 联机 + 往上滑 | `controller.page` 代理到电脑的 `readHistory`：`beforeSeq` / `throughSeq` 原样透传，`hasMore` 据实回报 |
| 断线 + 打开同步会话 | 回退读**本地镜像**（所以离线时能否看历史取决于镜像是否完整） |
| 新会话出现 | autosync 每 10 秒拉清单导入；空白会话（还没说话）不导入，等它有内容后自然进来 |
| 电脑侧归档 | 手机侧跟着归档；电脑清单**为空**时不做减法（避免瞬时失败把整批会话清空） |
| 本地镜像坏了 | 命中 `corrupt` / `SessionFormatError` 时把旧日志**改名隔离**（不删，可还原）再重建 |

> 0.20.9 / 0.21.1 起，**联机时不再往本地镜像搬历史**（`drainPreloadQueue` 与 `growMirrors` 都已停）。原因：手写事件搬运过不了官方 v4 surface 校验（真机：写入 2000+ 条后仍报 `SessionFormatError: system/…`），只会反复「写坏 → 隔离 → 重建」，白耗流量。代价是**断线时看不了历史**，本来也看不了。

## 诊断与日志

| 位置 | 内容 |
|---|---|
| `<DSH_HOME>/dsh-remote/desktop-debug.log`（电脑） | 网关/通知/权限卡，以及 **RPC 追踪**：`rpc <方法> <ms> | <入参摘要> | <结果摘要>`。出错必记；结果变或距上次 60 秒才记，避免 10 秒轮询刷屏 |
| `<DSH_HOME>/dsh-remote/phone-diag.jsonl`（电脑） | 手机每 5 分钟推来的一条现场快照：`paths` / `workspaceMap` / `baselines` 计数 / `synced` / `remote` / 最近 10 行手机日志。**不插 USB 也能查手机侧** |
| 手机 App 沙箱 `…/dsh-remote/mobile-debug.log` | 手机端完整日志；只有 `hdc` 读得到 |

常用判读：

```powershell
# 手机问过什么、电脑回了什么
Get-Content ~/.dsh/dsh-remote/desktop-debug.log -Tail 200 | Select-String ' rpc '
# 手机侧现场（每 5 分钟一条）
Get-Content ~/.dsh/dsh-remote/phone-diag.jsonl -Tail 1 | ConvertFrom-Json | Select-Object at,reason,synced,remote
```

## 配置

| 文件（`<DSH_HOME>/dsh-remote/`） | 用途 |
|---|---|
| `role.json` | 本机角色：`desktop` / `mobile` |
| `link.json` | 网关：`port` / `listen` / `upstreamPort` / `addressFamily` / `allowGlobal` / `discovery` / `ddns`；同步节奏：`syncIntervalMs`（缺省 10s、最小 5s）、`memsyncIntervalMs`（记忆同步，缺省 30s、最小 10s） |
| `link-peer.json`（电脑） | 反向通道：`url` / `key` / `certFp`；`link-install` 与通知共用 |
| `link-client.json`（手机） | 电脑地址信任：`certFp` / `allowHost` / `allowSelfSigned` |
| `mobile.json`（手机） | 电脑端点、设备身份、`notifyTargetSession`、`resolveSources` |
| `devices.json`（电脑） | 设备白名单（**含 deviceKey，不要提交、不要外传**） |
| `setup.json`（电脑） | `sessionSync` 策略（`scope` / `newSync` / `delSync` / `keepDays`）、共享工作区列表 |
| `autosync.json`（手机） | 每个电脑目录的**基线 id 列表**与失败退避表（`baselines` / `retry`） |
| `phone-diag.jsonl`（电脑） | 手机诊断快照（2 MB 轮转一次） |

端口：电脑网关 `8899`、手机网关 `8898`、本机中继 `17890`（电脑）/ 本机 DSH `3120`（手机）、局域网发现 `UDP 8897`。

### 网络选项

- **地址族**：`ipv4`（默认）/ `dual` / `ipv6`。IPv6 无 NAT，全局地址默认**不监听、不写进证书**；要暴露必须显式开 `allowGlobal`（日志会告警）。
- **自动发现**：同网段点「自动查找」即可找到电脑（UDP 广播）；**找到 ≠ 信任**，仍要走配对与 pin。广播不过路由器。
- **跨网络（可选）**：电脑把当前地址写到**你自己的**服务器（`ddns`），手机从 `resolveSources` 读回来。必须 https。

## 安全边界

| 接触面 | 门槛 | 说明 |
|---|---|---|
| `GET /link/ping` | 无 | 只回 `{ok,name,ver,fp}`，供「测试连接」用 |
| 反代路径 | 电脑：设备白名单 + HMAC；手机：回环放行，非回环必须 `x-link-key` + 时间戳 + nonce | 验不过一律 403 |
| `POST /link/claim` | 手机发起 + 电脑卡片确认 | 桌面端确认只允许本机回环调用 |
| 电脑 → 手机通道 | `x-link-key` + 时间戳 + 一次性 nonce | nonce 缺失 401、重放 401 |
| 电脑 → 手机装插件 | 同上 + **手机人工确认** | 没有订阅者时 fail-closed 回 503 |

取舍：自签证书 + 指纹 pin（TOFU）不用 CA；未 pin 就不发（不发比发错人好）；`listDirectory` 可浏览全盘但列不出 `$DSH_HOME` 后代与 `.ssh`/`.aws`/`AppData` 一类凭据目录；证书 SAN 漂移只告警不自动重签。

## 刻意不做的事

- 不做公网中继 / 第三方隧道服务（跨网络只支持写到你自己的服务器）；
- 不要求注册外部账号；
- 不做虚拟组网（Tailscale / WireGuard 那一类）；
- 不做网络层门禁（防火墙、单包授权属于系统与路由器）；
- 不做云端同步与托管。

## 排障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| 手机连不上 | 不同网段 / 端口被占 | 确认同一局域网；看电脑日志 `监听失败 … EADDRINUSE` |
| 「电脑不认识这台手机」 | 不在白名单 | 手机重新配对，电脑点「允许」 |
| 推插件回 `503 no-confirm-channel` | 手机界面没有订阅者（App 不在前台） | 打开手机 DSH 停在任意会话再推；确认卡必须人工点「允许」 |
| 推插件回 401 | 两端版本不一致（旧版不带 nonce） | 两端升到同一版本 |
| 会话里「历史加载失败」 | 本地镜像是空壳/损坏，而联机远端流没走起来 | 确认已连电脑（`follow 拦截 … fromRemote=true` 应出现在手机日志）；升级到 ≥0.22.0 |
| 往上滑没反应 / 只有开头一小段 | 旧版把 `hasMore` 写死成 `false`，或两端版本不一致 | 两端升到 ≥0.22.0；日志里应有 `page 代理到电脑 … 取=N 更多=true/false` |
| 会话显示成「（未命名对话）」 | 电脑侧那条会话本来没标题 | 0.20.1 起占位文案不再写进本地日志；正常会显示官方「未命名」 |
| 通知不推送 | 该轮不是手机发起的 / 没指定回投会话 / `notify=false` | 看电脑日志 `notify 跳过（…）` 的具体原因 |
| 一律 401 | 两端版本不一致 | 两端升到同一版本 |

## 开发与测试

```bash
npm test        # pretest 先重建手机端 chunk，再跑 10 组语法/行为自检
npm run build   # 由 lib/mobile/client.js 重建包内 chunk（lib/client.mobile.js）
```

- 干净检出没有 `lib/client.mobile.js`（`.gitignore` 忽略），`pretest` 会先跑 `scripts/build-client-chunk.mjs`；CI 也只跑 `npm test`，不再因为缺构建产物红叉。

- `lib/client.js` 必须是经典脚本 bundle（不能写 `import`）；手机 UI 是包内 chunk，由 `scripts/build-client-chunk.mjs` 生成。
- `tests/session-sync.mjs` / `tests/plugin-install-confirm.mjs` 是**静态守卫**：钉住「基线只记成功 id」「诊断不依赖 run()」「空壳走远端流」「收包端 scope 名」这些一改就丢会话的行为。
- 发版：`npm publish`（scope `@k-w7`）。注意 **pnpm publish 会假成功**（2FA 下只 staged），要用官方 npm CLI + `NODE_AUTH_TOKEN`。

## 版本历史

| 版本 | 变更 |
|---|---|
| 0.22.1 | 文档与 CI 收口：README 对齐 0.22.x（安装版本、历史协议、版本表）；`pretest` 先构建手机端 chunk，干净检出也能通过 `npm test`。 |
| 0.22.0 | **首屏历史与上滑翻页按官方 `page` 协议重做**：首屏 500 条/页、最多取到 2000 条，`hasMore` 据实回报；`controller.page` 代理到电脑，`beforeSeq` / `throughSeq` 透传。以前写死 `hasMore=false`，等于把「加载更多」删了。 |
| 0.21.7 | 历史翻页按三种 record 形状取上界（不再只取第一页）。 |
| 0.21.6 | 真正删掉设置页「最近同步」。 |
| 0.21.5 | 同步会话的历史读取代理到电脑（`controller.page`）。 |
| 0.21.4 | 远端快照取满历史，并显式 `hasMore=false`。 |
| 0.21.3 | 远端快照取足够历史 + 卡片按钮居中 + 去掉「最近同步」。 |
| 0.21.2 | 设置页「最近同步」认后台 autosync 的结果（不再永远「成功 0 个」）。 |
| 0.21.1 | 联机时 `growMirrors`（启动补深）也停掉，不再白写坏镜像。 |
| 0.21.0 | 插件安装确认卡按官方提问卡规格重排（20px 圆角 / elevation-panel 阴影 / 11px 眉标 / 16px 标题 / 整行 40px 选项）。 |
| 0.20.9 | 联机时停掉本地镜像历史搬运（`drainPreloadQueue`），不再「写坏 → 隔离 → 重建」循环。 |
| 0.20.7 | **联机时同步会话一律走远端流**（快照 + 纯转发 SSE），本地镜像只作离线兜底。 |
| 0.20.5 | 打开镜像前先补历史（2.5s 上限）；`corrupt` 命中隔离重建一次；`no-window` 有限重试。 |
| 0.20.4 | `listWorkspaceSessions` 补上「cwd 命中但没挂在工作区」的会话（非 subagent）。 |
| 0.20.3 | 收包端支持 scope 包名（`inbox/@k-w7/…` ENOENT）。 |
| 0.20.2 | 诊断快照改独立定时器（`run()` 提前 return 时也能上报）。 |
| 0.20.1 | 会话同步修复：基线只记成功 id + 退避表、blank 不进基线、原子写、in-flight 锁、空清单护栏；标题走官方 `sessionTitle`；新增 RPC 追踪与 `linkDiag` 诊断。 |
| 0.20.0 | 电脑推插件不再依赖「活着的运行时根 agent」：改走手机界面确认条（SSE `plugin-install-request` + RPC `answerPluginInstall`）。 |
| 0.19.0 | 包名迁到组织：`@klrsl/dsh-link` → **`@k-w7/dsh-link`**（收包白名单同时认新旧名）。 |
| 0.18.38 | 对端地址自动跟随 DHCP（`devices.json` 的 `lastIp`）；`setup.json` 的 `host` 跟随本机 IPv4。 |
| 0.18.36 | 局域网直连主链路：两段式配对、设备白名单 + HMAC + nonce、IPv6/双栈、发现、DDNS、通知回投、`sendToDesktop`、插件双向分发、记忆同步、会话镜像。 |
| 0.18.37 | 同步节奏改成「连上就同步」：autosync 缺省 10s、memsync 缺省 30s，均可配。 |
| 0.18.x | 稳定性收口：seq 平移与预载、镜像唤醒、归档处理、标题三级回落、pairKey 自愈。 |
| 0.2.0 | 首次连接配置向导、工作区多选与四档隐藏策略、配对状态轮询；UI 去渐变/毛玻璃/emoji。 |
| 0.1.4 | 手机 → 电脑 `agentMessage` / `sendToDesktop`；通知回投目标 `notifyTargetSession`。 |
| 0.1.2 | 通知重试；手机端 `/link/plugin-install` 与 `scripts/link-install.mjs`。 |
| 0.1.0 | 单包：desktop/mobile 按 `role.json` 分半加载。 |

## 来源与许可

MIT。衍生自 [`pht88888888/dsh-jiuling-remote-plugins`](https://github.com/pht88888888/dsh-jiuling-remote-plugins)（MIT），保留原作者版权；在此基础上移除公网隧道链路，改为局域网 TLS 直连，并补齐双向唤醒、通知、设备白名单与插件分发。
