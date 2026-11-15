/**
 * session-sync —— 会话同步那几条「永久丢会话」的回归守卫（0.20.1）。
 *
 * ## 为什么是静态断言
 *
 * 这些行为都在 `apply()` 的闭包里、依赖手机端运行态（autosync 定时器、本地会话
 * 存储），没有能直接 import 的纯函数。但每一条都对应 2026-11-15 现场的真实故障，
 * 而且都是「少一行就永久丢会话」的形态 —— 用源码断言把它们钉住，比什么都不做强。
 *
 * 对应故障与修法（详见知识库 `dsh-link-0-19-0-20` 审计报告）：
 * 1. 基线把「本轮所有 id」都记进去，逐条失败也记 ⇒ 失败/空白会话永久拉黑。
 * 2. 基线在 blank 过滤之前记录 ⇒ 先建空对话、后说话，永远同步不过来。
 * 3. `autosync.json` 非原子写 ⇒ 写坏就重建基线，吞掉期间所有会话。
 * 4. 定时器重叠 ⇒ 两轮各自 loadState/saveState，互相覆盖基线。
 * 5. 归档减法没有空清单护栏 ⇒ 电脑侧一次空返回把整批会话归档。
 * 6. 电脑端占位标题「（未命名对话）」被当真标题写死。
 *
 * @module dsh-link/tests/session-sync
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const host = readFileSync(resolve(here, '../lib/mobile/index.js'), 'utf8');

let failures = 0;
const check = (label, condition, detail = '') => {
	if (condition) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`);
};

// ① 基线只记成功 id + 逐条失败要上报
check('基线只在成功时追加 synced id', host.includes('Array.isArray(outcome?.synced)'));
check('逐条失败会进退避表', host.includes('state.retry = retry'));
check('逐条失败会上报诊断', host.includes("pushDiag(config, 'sync-item-failed'"));

// ② 基线不记空白会话
check('基线过滤 blank', /基线\*\*不记空白会话|空白的不记/.test(host));

// ③ 原子写
check('autosync 状态原子写（tmp + rename）', host.includes('renameSync(tmp, STATE_PATH)'));

// ④ in-flight 锁
check('autosync 有 in-flight 锁', host.includes('const runGuarded = async () =>') && host.includes('if (running) {'));

// ⑤ 归档减法空清单护栏
check('归档减法跳过空清单', host.includes('本轮跳过归档减法'));

// ⑥ 占位标题不再写死，优先官方标题服务
check('占位标题常量存在', host.includes("const UNTITLED_PLACEHOLDER = '（未命名对话）'"));
check('占位标题归一成空', host.includes('rawTitle === UNTITLED_PLACEHOLDER'));
check('标题优先走官方 sessionTitle.rename', host.includes('titleService.rename(session, wantedTitle)'));
check('官方服务失败退回手工 append', host.includes('session.append(\'session/title\''));

// ⑦ 诊断不能依赖 run()（workspaceMap 为空时 run 会提前 return）
check('诊断有独立定时器', host.includes('const diagTick = async () =>'));
check('诊断带上 workspaceMap', host.includes('workspaceMap: Object.entries(workspaceMap'));

// ⑧ 电脑端清单兜底：cwd 命中但没挂在工作区实体上的会话也要进清单
const desktopSource = readFileSync(resolve(here, '../lib/desktop/index.js'), 'utf8');
check('挂载表兜底（cwd 命中即算）', desktopSource.includes('挂载表兜底'));

if (failures > 0) {
	console.log(`\nsession-sync: ${failures} 项失败`);
	process.exit(1);
}
console.log('\nsession-sync ok');
