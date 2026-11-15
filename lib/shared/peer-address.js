/**
 * peer-address —— 手机地址自动校正。
 *
 * ## 为什么需要
 *
 * 手机是 DHCP 的，同一个家里换两三次地址很正常。`link-peer.json` 里的 `url` 是
 * 手写的，一旦过期，电脑→手机的**插件推送**和**回合结束通知**就全打在空气上；
 * 而且报错是 `ECONNREFUSED` / `socket hang up`，看起来像「手机不在线」，
 * 真正原因只是那个数字变了。
 *
 * ## 活的真相在哪
 *
 * `devices.json` 的 `lastIp`：手机每次连上电脑、通过设备鉴权时都会刷新
 * （内存里即时，落盘节流 60s，见 `lib/desktop/device-auth.js`）。所以电脑这边
 * 其实一直知道手机现在的地址，只是推送/通知没去读它。
 *
 * ## 安全边界（改这个文件时别破坏）
 *
 * - 只换**主机名**，端口沿用配置里的值；
 * - 身份不靠 IP：`x-link-key` 与 `certFp` 指纹 pin 一道都不少，换地址不会放宽任何校验；
 * - 读不到 / 解析失败 / 配置地址本身非法 ⇒ **原样返回**，绝不让「自动」变成新的故障源。
 *
 * @module dsh-link/shared/peer-address
 */
import { readFileSync } from 'node:fs';

import { statePathOf } from './home.js';

/**
 * 最近一次出现在 `devices.json` 里的手机 IP。
 *
 * 排序依据 `lastSeen`；没有 lastSeen 的条目排最后。只认非空字符串，不做格式校验
 * （IPv6 字面量交给 URL 处理）。
 *
 * @param {string} [devicesPath] - 设备库路径，缺省 `$DSH_HOME/dsh-remote/devices.json`。
 * @returns {string} IP；读不到返回空串（不抛）。
 */
export function latestDeviceIp(devicesPath) {
	let raw;
	try {
		raw = JSON.parse(readFileSync(devicesPath ?? statePathOf('devices.json'), 'utf8'));
	} catch {
		return '';
	}
	if (!Array.isArray(raw)) return '';
	const rows = raw
		.filter((item) => item !== null && typeof item === 'object' && typeof item.lastIp === 'string' && item.lastIp.trim() !== '')
		.map((item) => ({ ip: item.lastIp.trim(), at: Date.parse(String(item.lastSeen ?? '')) || 0 }))
		.sort((left, right) => right.at - left.at);
	return rows.length === 0 ? '' : rows[0].ip;
}

/**
 * 把配置里的对端地址换成该手机最近一次的 IP。
 *
 * @param {string} configuredUrl - `link-peer.json` 里的 `url`（可以是空串）。
 * @param {object} [options]
 * @param {string} [options.devicesPath] - 设备库路径（自测用）。
 * @param {Function} [options.log] - 校正时打一行日志，签名 `(line) => void`。
 * @returns {string} 校正后的地址；任何一步不成立都原样返回输入。
 */
export function preferCurrentPeerUrl(configuredUrl, { devicesPath, log = () => {} } = {}) {
	const text = String(configuredUrl ?? '').trim();
	if (text === '') return text;
	let base;
	try {
		base = new URL(text);
	} catch {
		return text;
	}
	const ip = latestDeviceIp(devicesPath);
	if (ip === '' || ip === base.hostname) return text;
	const hostPart = ip.includes(':') ? `[${ip}]` : ip;
	base.host = base.port === '' ? hostPart : `${hostPart}:${base.port}`;
	log(`对端地址自动校正 ${text} → ${base.href}（devices.json lastIp）`);
	return base.href;
}
