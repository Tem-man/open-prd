import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	appendFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	writeFileSync,
} from "node:fs";

type BackendModule = {
	startServer: (port?: number, host?: string) => Promise<number>;
	stopServer?: () => void;
};

/** electron-vite dev 会注入 NODE_ENV=development；此时后端由 `pnpm dev` 独立提供。 */
const isDev = process.env.NODE_ENV === "development" && !app.isPackaged;

let apiPort = 0;
let backend: BackendModule | null = null;
let mainWindow: BrowserWindow | null = null;
let appUrl = "";
let logFile = "";

const ENV_TEMPLATE = `# OpenPRD 模型配置（可选）
# 应用内「设置 → 模型服务」填写的配置优先；此文件用于覆盖其它环境变量。
# 修改后需重启应用生效。请勿把本文件分享给他人。

# 选择协议标准: openai | anthropic | ollama
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o

# OpenAI 标准（OpenAI / OpenRouter / DeepSeek / SiliconFlow 等兼容服务）
# OPENAI_API_KEY=sk-...
# OPENAI_BASE_URL=https://api.openai.com/v1

# Anthropic 标准
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_BASE_URL=https://api.anthropic.com

# Ollama（本地离线推理，无需 API Key）
# OLLAMA_BASE_URL=http://localhost:11434

# 位图矢量化（可选）
# VECTORIZE_PROVIDER=recraft
# RECRAFT_API_KEY=
`;

function log(
	level: "info" | "warn" | "error",
	message: string,
	detail?: unknown,
): void {
	const detailText =
		detail === undefined
			? ""
			: ` ${detail instanceof Error ? (detail.stack ?? detail.message) : String(detail)}`;
	const line = `[${new Date().toISOString()}] [${level}] ${message}${detailText}\n`;
	try {
		if (logFile) appendFileSync(logFile, line, "utf8");
	} catch {
		// 写日志失败不能影响启动
	}
	if (level === "error") console.error(line.trimEnd());
	else if (level === "warn") console.warn(line.trimEnd());
	else console.log(line.trimEnd());
}

function setupLogging(): void {
	const dir = join(app.getPath("userData"), "logs");
	try {
		mkdirSync(dir, { recursive: true });
		logFile = join(dir, "main.log");
	} catch (err) {
		console.warn("[main] 无法创建日志目录：", err);
	}
}

/**
 * 迁移旧版本遗留的用户 Skill：
 * 历史版本把 skill-custom-* 写进了应用资源目录（<resources>/skills/），
 * 该目录随更新被替换、随卸载被删除；这里把其中的用户 Skill 拷贝到
 * userData/skills/（更新不触碰、卸载默认保留），只做一次、目标存在则跳过。
 */
function migrateLegacyUserSkills(userSkillsDir: string): void {
	try {
		const builtinSkillsRoot = join(process.resourcesPath, "skills");
		if (!existsSync(builtinSkillsRoot)) return;

		for (const entry of readdirSync(builtinSkillsRoot, { withFileTypes: true })) {
			if (!entry.isDirectory() || !entry.name.startsWith("skill-custom-")) continue;
			const target = join(userSkillsDir, entry.name);
			if (existsSync(target)) continue; // 用户目录已有，不覆盖
			cpSync(join(builtinSkillsRoot, entry.name), target, { recursive: true });
		}
	} catch (err) {
		log("warn", "用户 Skill 迁移失败（下次启动会重试）", err);
	}
}

/**
 * 所有 env 注入必须发生在动态 import backend 之前：
 * backend 入口的 `import "dotenv/config"` 在模块加载时就会读取 DOTENV_CONFIG_PATH。
 */
function setupEnvironment(): { backendEntry: string; staticDir: string } {
	const packaged = app.isPackaged;
	// 打包态：process.resourcesPath；本地非打包调试：out/main → 仓库根目录。
	const resources = packaged ? process.resourcesPath : resolve(__dirname, "../../..");

	const userData = app.getPath("userData");
	if (packaged) {
		process.env.DATA_DIR = userData;
		process.env.DB_PATH = join(userData, "prd.db");
		const userSkillsDir = join(userData, "skills");
		process.env.USER_SKILLS_DIR = userSkillsDir;
		mkdirSync(userSkillsDir, { recursive: true });
		migrateLegacyUserSkills(userSkillsDir);
	}

	const dotenvPath = packaged
		? join(userData, ".env")
		: join(resources, "backend", ".env");
	if (packaged && !existsSync(dotenvPath)) {
		try {
			writeFileSync(dotenvPath, ENV_TEMPLATE, "utf8");
		} catch (err) {
			log("warn", "无法写入 .env 模板", err);
		}
	}
	process.env.DOTENV_CONFIG_PATH = dotenvPath;

	process.env.STATIC_DIR = join(resources, "frontend", "dist");
	process.env.OPENPRD_EMBEDDED = "1";
	if (!isDev) process.env.NODE_ENV = "production";

	return {
		backendEntry: join(resources, "backend", "dist", "index.js"),
		staticDir: process.env.STATIC_DIR,
	};
}

async function startBackend(entry: string): Promise<number> {
	if (!existsSync(entry)) {
		throw new Error(`后端入口不存在：${entry}`);
	}
	// 用变量动态 import：electron-vite 会保留原生 import()，可加载 ESM backend，
	// 也不会在构建期尝试按裸包名解析。
	const url = pathToFileURL(entry).href;
	const mod = (await import(url)) as BackendModule;
	backend = mod;
	const port = await mod.startServer(0, "127.0.0.1");
	log("info", `后端已启动：127.0.0.1:${port}`);
	return port;
}

function createWindow(url: string): BrowserWindow {
	const win = new BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 1024,
		minHeight: 640,
		title: "OpenPRD",
		show: false,
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	win.once("ready-to-show", () => win.show());
	win.on("closed", () => {
		if (mainWindow === win) mainWindow = null;
	});
	win.webContents.on(
		"did-fail-load",
		(_event, code, description, validatedURL) => {
			log("error", `页面加载失败 ${code} ${description} ${validatedURL}`);
		},
	);
	win.loadURL(url).catch((err) => log("error", `loadURL 失败：${url}`, err));
	if (isDev) win.webContents.openDevTools();
	return win;
}

async function bootstrap(): Promise<void> {
	if (isDev) {
		// 开发态：前端 Vite :5173 + 独立后端 :3000（Vite proxy），不内嵌 backend。
		appUrl = "http://localhost:5173";
		mainWindow = createWindow(appUrl);
		return;
	}

	const { backendEntry, staticDir } = setupEnvironment();
	log("info", `资源目录：${process.resourcesPath || "(未打包)"}`);
	log("info", `静态目录：${staticDir}`);
	apiPort = await startBackend(backendEntry);
	appUrl = `http://127.0.0.1:${apiPort}/`;
	mainWindow = createWindow(appUrl);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (!mainWindow) return;
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	});
}

ipcMain.handle("get-api-port", () => apiPort);

app.whenReady().then(async () => {
	if (!gotSingleInstanceLock) return;
	setupLogging();
	try {
		await bootstrap();
	} catch (err) {
		log("error", "启动失败", err);
		try {
			dialog.showErrorBox(
				"OpenPRD 启动失败",
				`${err instanceof Error ? err.message : String(err)}\n\n日志文件：${logFile}`,
			);
		} catch {
			// ready 之前可能无法显示对话框，日志已记录
		}
		app.quit();
	}
});

app.on("before-quit", () => {
	try {
		backend?.stopServer?.();
	} catch (err) {
		log("warn", "关闭后端服务时出错", err);
	}
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
	// 后端仍在运行，只重建窗口，避免重复启动 Express。
	if (BrowserWindow.getAllWindows().length === 0 && appUrl) {
		mainWindow = createWindow(appUrl);
	}
});

process.on("unhandledRejection", (reason) => {
	log("error", "未处理的 Promise 拒绝", reason);
});
process.on("uncaughtException", (err) => {
	log("error", "未捕获异常", err);
});
