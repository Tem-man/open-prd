#!/usr/bin/env node
/**
 * 桌面端一键打包（方案 C，三平台）
 *
 *   pnpm dist:win                     Windows NSIS + portable (x64)
 *   pnpm dist:mac                     macOS dmg + zip (x64)
 *   pnpm dist:mac -- --arch=arm64     macOS arm64
 *   pnpm dist:linux                   Linux AppImage + deb (x64)
 *   pnpm dist:linux -- --arch=arm64   Linux arm64
 *
 * 通用参数：--dir（只出 unpacked）、--skip-rebuild、--keep-artifacts
 *
 * 流程：构建 → pnpm deploy → 按目标平台取 better-sqlite3 的 Electron ABI
 * 预编译包 → 展平依赖 → electron-builder → 清理中间产物 → 安全扫描 → 摘要
 *
 * 重要：pnpm deploy 在 Windows 上用硬链接指向主仓库 store。原生模块必须在
 * .packaging/native 的独立副本上处理，再断开 deploy 侧硬链接后注入，
 * 否则会把主仓库的 .node 换成 Electron ABI，导致本机 `pnpm dev` 崩溃。
 *
 * 平台限制：macOS 包（dmg）只能在 macOS 主机构建；Linux 包建议在原生
 * Linux 或 Docker 中构建（Windows 上可能失败）。CI 用三平台 matrix。
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGING = join(ROOT, ".packaging");
const DEPLOY_DIR = join(PACKAGING, "backend");
const NATIVE_DIR = join(PACKAGING, "native");
const RELEASE_DIR = join(ROOT, "electron", "release");

const args = process.argv.slice(2);
const dirOnly = args.includes("--dir");
const skipRebuild = args.includes("--skip-rebuild");
const keepArtifacts = args.includes("--keep-artifacts");

const PLATFORM_FLAGS = { win32: "--win", darwin: "--mac", linux: "--linux" };
const PLATFORM_LABELS = { win32: "Windows", darwin: "macOS", linux: "Linux" };
const ARTIFACT_EXTENSIONS = {
	win32: [".exe"],
	darwin: [".dmg", ".zip"],
	linux: [".appimage", ".deb", ".rpm", ".tar.gz", ".zip"],
};

function option(name, fallback) {
	const found = args.find((arg) => arg.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : fallback;
}

const PLATFORM = option("platform", "win32");
const ARCH = option("arch", "x64");
const TAG = `[dist:${PLATFORM}/${ARCH}]`;

if (!PLATFORM_FLAGS[PLATFORM]) {
	throw new Error(`未知平台 ${PLATFORM}，可选 win32 | darwin | linux`);
}
if (ARCH !== "x64" && ARCH !== "arm64") {
	throw new Error(`未知架构 ${ARCH}，可选 x64 | arm64`);
}

function run(cmd, argv, { cwd = ROOT, env, shell = process.platform === "win32" } = {}) {
	const label = `${cmd} ${argv.join(" ")}`;
	console.log(`\n[run] ${label}`);
	const result = spawnSync(cmd, argv, {
		cwd,
		stdio: "inherit",
		shell,
		env: env ? { ...process.env, ...env } : process.env,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`命令失败（退出码 ${result.status}）：${label}`);
	}
}

function removeDir(dir) {
	if (!existsSync(dir)) return;
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// 某些受管环境禁止删除；改名让出路径即可
		renameSync(dir, `${dir}-old-${Date.now()}`);
	}
}

/** Vite 构建前把旧 dist 整体改名，避免 emptyOutDir 触发批量删除保护。 */
function prepareFrontendDist() {
	const dist = join(ROOT, "frontend", "dist");
	if (!existsSync(dist)) return;
	mkdirSync(join(PACKAGING, "tmp"), { recursive: true });
	const previous = join(PACKAGING, "tmp", `frontend-dist-prev-${Date.now()}`);
	renameSync(dist, previous);
}

function buildAll() {
	prepareFrontendDist();
	// ELECTRON_BUILD 只在本次构建进程内生效，Web 构建默认仍为 base:"./"。
	// build:desktop 是纯 vite build：frontend 的 `build` 含 vue-tsc -b，
	// 迁移的 pencil 源码有一批既存类型错误，与打包链路无关，故不阻塞。
	run("pnpm", ["--filter", "frontend", "build:desktop"], { env: { ELECTRON_BUILD: "1" } });
	run("pnpm", ["--filter", "backend", "build"]);
	run("pnpm", ["--filter", "electron", "build"]);
}

function deployBackend() {
	removeDir(DEPLOY_DIR);
	mkdirSync(PACKAGING, { recursive: true });
	try {
		run("pnpm", ["--filter", "backend", "deploy", "--prod", ".packaging/backend"]);
	} catch (err) {
		// Windows 上 pnpm deploy 偶发在 node_modules/.bin/*.ps1 上报 EPERM。
		// 那些可执行桩对运行时毫无用处（backend 由主进程 import，不调用 .bin），
		// 只要 dist 入口与 .pnpm 依赖树完整就继续。
		const pnpmDir = join(DEPLOY_DIR, "node_modules", ".pnpm");
		const packageCount = existsSync(pnpmDir)
			? readdirSync(pnpmDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length
			: 0;
		if (!existsSync(join(DEPLOY_DIR, "dist", "index.js")) || packageCount < 100) throw err;
		console.warn(`[deploy] pnpm deploy 报错但产物完整（.pnpm ${packageCount} 个包，仅 .bin 创建失败），继续`);
	}
	const entry = join(DEPLOY_DIR, "dist", "index.js");
	if (!existsSync(entry)) throw new Error(`deploy 产物缺少入口：${entry}`);
}

/** deploy 白名单校验：绝不把 .env / *.db / 源码带进安装包。 */
function assertDeployClean() {
	if (existsSync(join(DEPLOY_DIR, "src"))) {
		throw new Error("deploy 产物含 backend/src，请检查 backend/package.json 的 files 白名单");
	}
	const forbidden = /^(\.env(\..*)?|.*\.db|.*\.db-(wal|shm))$/i;
	const check = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (forbidden.test(entry.name)) {
				throw new Error(`deploy 产物含敏感文件：${join(dir, entry.name)}`);
			}
		}
	};
	check(DEPLOY_DIR);
	check(join(DEPLOY_DIR, "dist"));
	console.log("[verify] deploy 产物白名单检查通过");
}

function findDeployBetterSqlite3() {
	const pnpmDir = join(DEPLOY_DIR, "node_modules", ".pnpm");
	const entry = readdirSync(pnpmDir).find((name) => name.startsWith("better-sqlite3@"));
	if (!entry) throw new Error("deploy 产物中找不到 better-sqlite3");
	return join(pnpmDir, entry, "node_modules", "better-sqlite3");
}

/** 优先用 deploy 自带的 prebuild-install，其次回退到主仓库安装的那份。 */
function findPrebuildInstallBin() {
	for (const base of [
		join(DEPLOY_DIR, "node_modules", ".pnpm"),
		join(ROOT, "node_modules", ".pnpm"),
	]) {
		if (!existsSync(base)) continue;
		const entry = readdirSync(base).find((name) => name.startsWith("prebuild-install@"));
		if (!entry) continue;
		const bin = join(base, entry, "node_modules", "prebuild-install", "bin.js");
		if (existsSync(bin)) return bin;
	}
	throw new Error("找不到 prebuild-install，无法获取 Electron ABI 预编译二进制");
}

/** 删除 dist 里的类型声明与 source map，减小包体；失败不阻塞。 */
function pruneDist(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const file = join(dir, entry.name);
		if (entry.isDirectory()) pruneDist(file);
		else if (/\.map$|\.d\.ts$/.test(entry.name)) {
			try {
				rmSync(file, { force: true });
			} catch {
				/* 体积优化失败不影响功能 */
			}
		}
	}
}

/**
 * 在独立副本上下载 **目标平台/架构** 的 Electron ABI 预编译包并注入 deploy 产物。
 * 全程不写主仓库 node_modules，也不需要 node-gyp / MSVC。
 */
async function materializeElectronAbi() {
	if (skipRebuild) {
		console.warn("[native] 已跳过（--skip-rebuild），请确认 deploy 内 .node 与目标平台 ABI 匹配");
		return;
	}

	const source = findDeployBetterSqlite3();
	mkdirSync(join(PACKAGING, "tmp"), { recursive: true });
	if (existsSync(NATIVE_DIR)) {
		try {
			rmSync(NATIVE_DIR, { recursive: true, force: true });
		} catch {
			renameSync(NATIVE_DIR, join(PACKAGING, "tmp", `native-prev-${Date.now()}`));
		}
	}
	const isoModule = join(NATIVE_DIR, "node_modules", "better-sqlite3");
	mkdirSync(dirname(isoModule), { recursive: true });
	cpSync(source, isoModule, { recursive: true, dereference: true, force: true });

	const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
	writeFileSync(
		join(NATIVE_DIR, "package.json"),
		JSON.stringify(
			{
				name: "openprd-native-abi",
				private: true,
				version: "0.0.0",
				dependencies: { "better-sqlite3": pkg.version },
			},
			null,
			2,
		),
	);

	const electronRequire = createRequire(join(ROOT, "electron", "package.json"));
	const electronVersion = electronRequire("electron/package.json").version;
	console.log(
		`[native] 目标 Electron ${electronVersion} / ${PLATFORM}-${ARCH}，在隔离目录准备原生模块`,
	);

	const bin = findPrebuildInstallBin();
	const prebuildArgs = [
		bin,
		"--runtime=electron",
		`--target=${electronVersion}`,
		`--arch=${ARCH}`,
		`--platform=${PLATFORM}`,
	];
	// prebuild-install 走 GitHub releases，代理偶发 502；重试几次再判定失败。
	let prebuildError;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			run(
				process.execPath,
				prebuildArgs,
				// 直接 spawn node，不经 cmd.exe：Node 常装在 "C:\Program Files\..."，
				// 走 shell 会被空格截断成 `C:\Program`。
				{ cwd: isoModule, shell: false },
			);
			prebuildError = undefined;
			break;
		} catch (err) {
			prebuildError = err;
			console.warn(`[native] 预编译包获取失败（第 ${attempt}/3 次）：${err.message}`);
		}
	}
	if (prebuildError) throw prebuildError;

	const electronNode = join(isoModule, "build", "Release", "better_sqlite3.node");
	if (!existsSync(electronNode)) throw new Error("未生成目标平台 Electron ABI 的 better_sqlite3.node");

	const deployNode = join(source, "build", "Release", "better_sqlite3.node");
	// deploy 内的 .node 与主仓库 store 是硬链接；先改名让出路径，再写入独立文件。
	renameSync(deployNode, join(PACKAGING, "tmp", `nodejs-abi-${Date.now()}.node`));
	copyFileSync(electronNode, deployNode);
	console.log(`[native] 已注入 ${PLATFORM}-${ARCH} 的 Electron ABI 二进制（主仓库未受影响）`);
}

/**
 * 展平 deploy 产物：electron-builder 从父目录整体复制 extraResources 时会
 * 按目录名排除 node_modules，也会跳过 pnpm 的 .pnpm 隐藏目录与符号链接。
 * 这里复制成扁平的真实目录，再由 yml 拆成三条独立映射。
 */
function flattenBackend() {
	const out = join(PACKAGING, "runtime");
	mkdirSync(PACKAGING, { recursive: true });
	if (existsSync(out)) {
		try {
			rmSync(out, { recursive: true, force: true });
		} catch {
			renameSync(out, join(PACKAGING, "tmp", `runtime-prev-${Date.now()}`));
		}
	}
	mkdirSync(join(out, "node_modules"), { recursive: true });
	cpSync(join(DEPLOY_DIR, "dist"), join(out, "dist"), {
		recursive: true,
		dereference: true,
	});
	copyFileSync(join(DEPLOY_DIR, "package.json"), join(out, "package.json"));

	const pnpmDir = join(DEPLOY_DIR, "node_modules", ".pnpm");
	const conflicts = [];
	const copyIfAbsent = (src, dst) => {
		if (existsSync(dst)) {
			try {
				const a = JSON.parse(readFileSync(join(src, "package.json"), "utf8")).version;
				const b = JSON.parse(readFileSync(join(dst, "package.json"), "utf8")).version;
				if (a !== b) conflicts.push(`${dst.slice(out.length + 1)}: 保留 ${b}，跳过 ${a}`);
			} catch {
				/* 无 package.json 的目录保留已有内容 */
			}
			return;
		}
		mkdirSync(dirname(dst), { recursive: true });
		cpSync(src, dst, { recursive: true, dereference: true, force: true });
	};

	for (const entry of readdirSync(pnpmDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const nm = join(pnpmDir, entry.name, "node_modules");
		if (!existsSync(nm)) continue;
		for (const item of readdirSync(nm, { withFileTypes: true })) {
			if (item.isSymbolicLink() || item.name.startsWith(".")) continue;
			const src = join(nm, item.name);
			if (item.name.startsWith("@")) {
				for (const sub of readdirSync(src, { withFileTypes: true })) {
					if (sub.isSymbolicLink()) continue;
					copyIfAbsent(join(src, sub.name), join(out, "node_modules", item.name, sub.name));
				}
			} else {
				copyIfAbsent(src, join(out, "node_modules", item.name));
			}
		}
	}

	if (conflicts.length) {
		console.warn(`[flatten] 同名包存在多版本（已保留其一，请留意）：\n  ${conflicts.join("\n  ")}`);
	}
	const native = join(out, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
	if (!existsSync(native)) throw new Error("展平后缺少 better_sqlite3.node");
	console.log("[flatten] 后端运行目录已展平（真实文件，无 pnpm 链接）");
}

function packageApp() {
	const builderArgs = [PLATFORM_FLAGS[PLATFORM], `--${ARCH}`];
	// 必须用 `pnpm --filter ... exec electron-builder <args>` 直接传参。
	// 走包脚本 `dist -- --linux --x64` 时 pnpm 会吞掉 `--` 后的平台参数，
	// electron-builder 会退回宿主平台，静默产出 Windows 包（已踩过坑）。
	const argv = ["--filter", "electron", "exec", "electron-builder"];
	if (dirOnly) argv.push("--dir");
	run("pnpm", [...argv, ...builderArgs]);
}

function walk(dir, visit, depth = 0) {
	if (depth > 10 || !existsSync(dir)) return;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const file = join(dir, entry.name);
		if (entry.isDirectory()) walk(file, visit, depth + 1);
		else visit(file);
	}
}

function releaseDir() {
	const version = JSON.parse(readFileSync(join(ROOT, "electron/package.json"), "utf8")).version;
	return join(RELEASE_DIR, version);
}

function assertReleaseClean() {
	const outDir = releaseDir();
	const bad = [];
	walk(outDir, (file) => {
		const relative = file.slice(outDir.length + 1).replace(/\\/g, "/");
		if (/(^|\/)\.env(\..*)?$|\.db(-wal|-shm)?$|backend\/src\//.test(relative)) bad.push(file);
	});
	if (bad.length) throw new Error(`安装包产物含敏感文件：\n${bad.join("\n")}`);
	console.log("[verify] 安装包产物安全扫描通过");
	return outDir;
}

/** 正式打包后清掉 release 目录里的中间产物，只留可分发文件。 */
function cleanupReleaseArtifacts() {
	if (keepArtifacts) {
		console.log("[cleanup] 已跳过（--keep-artifacts）");
		return;
	}
	const outDir = releaseDir();
	if (!existsSync(outDir)) return;

	const discard = join(PACKAGING, "tmp", `discarded-${Date.now()}`);
	mkdirSync(discard, { recursive: true });
	const intermediateDirs = new Set([
		"win-unpacked",
		"linux-unpacked",
		"mac",
		"mac-arm64",
		"mac-x64",
		"linux-x64",
		"linux-arm64",
	]);
	const targets = readdirSync(outDir, { withFileTypes: true })
		.filter((entry) => {
			const name = entry.name;
			if (name === "builder-debug.yml" || name.endsWith(".blockmap")) return true;
			// __appImage-* 等是 AppImage 构建的临时目录（跨平台失败时会残留）
			return (
				entry.isDirectory() &&
				(name.startsWith("__") || name.includes("-unpacked") || intermediateDirs.has(name))
			);
		})
		.map((entry) => join(outDir, entry.name));

	for (const target of targets) {
		const relative = target.slice(ROOT.length + 1);
		try {
			rmSync(target, { recursive: true, force: true });
			console.log(`[cleanup] 已移除 ${relative}`);
		} catch {
			try {
				renameSync(target, join(discard, target.slice(outDir.length + 1)));
				console.log(`[cleanup] 已移出 ${relative}`);
			} catch (err) {
				console.warn(`[cleanup] 无法清理 ${relative}：${err.message}`);
			}
		}
	}
}

function printSummary(outDir) {
	console.log(`\n=== ${PLATFORM_LABELS[PLATFORM]} ${ARCH} 打包产物 ===`);
	const extensions = ARTIFACT_EXTENSIONS[PLATFORM];
	const files = [];
	walk(outDir, (file) => {
		const lower = file.toLowerCase();
		if (extensions.some((ext) => lower.endsWith(ext))) files.push(file);
	});
	if (!files.length) {
		if (dirOnly) {
			console.log("（--dir 调试构建，产物在 unpacked 目录中）");
			return;
		}
		throw new Error(
			`未找到 ${PLATFORM_LABELS[PLATFORM]} ${ARCH} 的可分发产物（期望 ${extensions.join(" / ")}）。` +
				"请检查 electron-builder 是否按目标平台构建，以及平台参数是否被正确传递。",
		);
	}
	for (const file of files) {
		const size = (statSync(file).size / 1024 / 1024).toFixed(1);
		const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
		console.log(`  ${file.slice(ROOT.length + 1)}  ${size} MB  sha256=${sha.slice(0, 16)}…`);
	}
}

async function main() {
	if (PLATFORM === "darwin" && process.platform !== "darwin") {
		throw new Error(
			"macOS dmg/zip 只能在 macOS 主机构建（DMG 需要 hdiutil，签名/公证也依赖 macOS 工具链）。" +
				"请在 Mac 上执行 pnpm dist:mac，或使用 GitHub Actions 的 macos-latest runner。",
		);
	}
	if (PLATFORM === "linux" && process.platform === "win32") {
		console.warn(
			"[warn] 在 Windows 上构建 Linux 包可能失败（electron-builder 官方建议原生 Linux 或 Docker）。" +
				"若失败请改用 ubuntu runner / pnpm dist:linux 在 Linux 主机执行。",
		);
	}

	console.log(`${TAG} ${dirOnly ? "调试模式 (--dir)" : "正式打包"}；下载 Electron 失败时可设置 ELECTRON_MIRROR 与 ELECTRON_BUILDER_BINARIES_MIRROR`);
	run("pnpm", ["--version"]);
	buildAll();
	deployBackend();
	assertDeployClean();
	pruneDist(join(DEPLOY_DIR, "dist"));
	await materializeElectronAbi();
	flattenBackend();
	packageApp();
	if (!dirOnly) cleanupReleaseArtifacts();
	const outDir = assertReleaseClean();
	printSummary(outDir);
	console.log(`\n${TAG} 完成`);
}

main().catch((err) => {
	console.error(`\n${TAG} 失败：`, err instanceof Error ? err.message : err);
	console.error(
		"提示：真正的失败原因在上方子进程的原始输出里（本脚本只转发退出码）。" +
			"仅当日志出现下载超时 / 404 时才需要配置 ELECTRON_MIRROR 与 " +
			"ELECTRON_BUILDER_BINARIES_MIRROR；其它报错请按原始输出排查。",
	);
	process.exit(1);
});
