/**
 * plugin-install-confirm —— 「电脑推插件 → 手机确认条」这条新通道的静态守卫（0.20.0）。
 *
 * ## 为什么是静态测试
 *
 * 这条链路横跨两个文件、两趟 RPC，而且 host 侧那段逻辑在 `apply()` 闭包里、
 * 前端那段在 WebView 的页面世界里 —— 没有能直接 import 的纯函数可测。
 * 但历史上真正咬人的是**漂移**：
 *   · `lib/mobile/client.js` 改了、`lib/client.mobile.js`（构建产物）没重建 ⇒ 手机上跑旧代码；
 *   · 事件名 / RPC 方法名两边写岔一个字母 ⇒ 确认条永远不弹，也不报错。
 * 所以这里钉住三件事：用法名一致、chunk 与源同步、事件确实是广播出去的。
 *
 * @module dsh-link/tests/plugin-install-confirm
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, '..', path), 'utf8');

const host = read('lib/mobile/index.js');
const source = read('lib/mobile/client.js');
const chunk = read('lib/client.mobile.js');

let failures = 0;
const check = (label, condition, detail = '') => {
	if (condition) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`);
};

// ① host：广播事件名、待答表、RPC 入口
check('host 广播 plugin-install-request', host.includes("broadcast('plugin-install-request'"));
check('host 有待答表 pluginInstallWaiters', host.includes('const pluginInstallWaiters = new Map()'));
check('host 有 RPC case answerPluginInstall', host.includes("case 'answerPluginInstall'"));
check(
	'host 没有活着的 agent 时不再直接 503',
	host.includes('confirmOnPluginPage({ name: pkgName, version: pkgVersion })'),
);
check(
	'host 兜底仍 fail-closed（没有浏览器订阅者 ⇒ NO_CHANNEL）',
	host.includes("watchers.size === 0") && host.includes("code: 'NO_CHANNEL'"),
);

// ② 前端源：监听 + 自绘 + 回传
check('前端监听 plugin-install-request', source.includes("addEventListener('plugin-install-request'"));
check('前端有 showPluginInstallBar', source.includes('function showPluginInstallBar('));
check('前端回传 answerPluginInstall', source.includes("bridge('answerPluginInstall'"));
check('前端把 id / allow 一起送回去', source.includes('{ id: installId, allow: allow }'));

// ③ 构建产物：必须与源同步（否则手机 WebView 跑的是旧代码）
const sourceHash = createHash('sha256').update(source).digest('hex');
check(
	'lib/client.mobile.js 是当前源构建的',
	chunk.includes(`源 SHA256=${sourceHash}`),
	'跑 node scripts/build-client-chunk.mjs 重建',
);
check('chunk 里确实带着确认条与事件监听', chunk.includes('showPluginInstallBar') && chunk.includes("addEventListener('plugin-install-request'"));

if (failures > 0) {
	console.log(`\nplugin-install-confirm: ${failures} 项失败`);
	process.exit(1);
}
console.log('\nplugin-install-confirm ok');
