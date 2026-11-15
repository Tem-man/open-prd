#!/usr/bin/env node
/**
 * 让主仓库的 better-sqlite3 原生二进制匹配「当前运行这个脚本的 Node」。
 *
 * 什么时候用：切换 Node 大版本后 `pnpm dev` 报
 *   NODE_MODULE_VERSION xxx / requires yyy（ERR_DLOPEN_FAILED）
 *
 *   pnpm fix:native
 *
 * 背景：pnpm deploy 在 Windows 上用硬链接指向 store，直接覆盖 .node 会
 * 污染 store 和已生成的打包产物。因此这里先把原文件改名让出路径（断开
 * 硬链接），再写入独立文件。桌面打包链路由 scripts/build-desktop.mjs 在
 * 隔离副本里按 Electron ABI 单独处理，不依赖本脚本的结果。
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(ROOT, ".packaging", "tmp");
const ISO = join(ROOT, ".packaging", "native-fix");
const nodeVersion = process.version.slice(1);
const abi = process.versions.modules;

function run(cmd, argv, { cwd = ROOT, shell = process.platform === "win32" } = {}) {
	const result = spawnSync(cmd, argv, { cwd, stdio: "inherit", shell });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`命令失败（退出码 ${result.status}）：${cmd} ${argv.join(" ")}`);
}

function findPrebuildInstallBin() {
	const pnpmDir = join(ROOT, "node_modules", ".pnpm");
	const entry = readdirSync(pnpmDir).find((name) => name.startsWith("prebuild-install@"));
	if (!entry) throw new Error("找不到 prebuild-install，请确认依赖已安装");
	const bin = join(pnpmDir, entry, "node_modules", "prebuild-install", "bin.js");
	if (!existsSync(bin)) throw new Error(`prebuild-install 入口缺失：${bin}`);
	return bin;
}

function main() {
	const link = join(ROOT, "backend", "node_modules", "better-sqlite3");
	if (!existsSync(link)) throw new Error("backend/node_modules/better-sqlite3 不存在，请先 pnpm install");
	const packageDir = realpathSync(link);
	const nativeFile = join(packageDir, "build", "Release", "better_sqlite3.node");
	console.log(`[fix:native] 当前 Node ${nodeVersion} / ABI ${abi}`);
	console.log(`[fix:native] 目标包：${packageDir}`);

	mkdirSync(TMP, { recursive: true });
	if (existsSync(ISO)) {
		try {
			rmSync(ISO, { recursive: true, force: true });
		} catch {
			renameSync(ISO, join(TMP, `native-fix-prev-${Date.now()}`));
		}
	}
	const isoModule = join(ISO, "node_modules", "better-sqlite3");
	mkdirSync(dirname(isoModule), { recursive: true });
	cpSync(packageDir, isoModule, { recursive: true, dereference: true, force: true });

	// 按当前 Node 版本取官方预编译包（命中本地 _prebuilds 缓存或联网下载）
	run(
		process.execPath,
		[
			findPrebuildInstallBin(),
			"--runtime=node",
			`--target=${nodeVersion}`,
			`--arch=${process.arch}`,
			`--platform=${process.platform}`,
		],
		{ cwd: isoModule, shell: false },
	);

	const fresh = join(isoModule, "build", "Release", "better_sqlite3.node");
	if (!existsSync(fresh)) throw new Error(`未生成 ABI ${abi} 的二进制：${fresh}`);

	// 断开与 pnpm store 的硬链接后再写入独立文件
	const backup = join(TMP, `better_sqlite3-abi-old-${Date.now()}.node`);
	if (existsSync(nativeFile)) renameSync(nativeFile, backup);
	copyFileSync(fresh, nativeFile);

	// 同一 Node 进程里实加载验证
	const requireFromBackend = createRequire(join(ROOT, "backend", "package.json"));
	const Database = requireFromBackend("better-sqlite3");
	const db = new Database(":memory:");
	db.exec("create table t(a)");
	const value = db.prepare("select 1 as x").get().x;
	db.close();
	console.log(`[fix:native] 已修复并验证：ABI ${abi}，better-sqlite3 查询返回 ${value}`);
	console.log(`[fix:native] 旧文件备份：${backup}`);
	console.log("[fix:native] 现在可以重新运行 pnpm dev");
}

try {
	main();
} catch (err) {
	console.error("[fix:native] 失败：", err instanceof Error ? err.message : err);
	process.exit(1);
}
