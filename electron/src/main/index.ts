import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";

let apiPort: number;

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
		// 迁移失败不阻塞启动，后续版本仍可再次尝试
		console.warn("[main] 用户 Skill 迁移失败：", err);
	}
}

async function createWindow() {
	if (app.isPackaged) {
		const userData = app.getPath("userData");
		process.env.DATA_DIR = userData;
		process.env.DB_PATH = join(userData, "prd.db");
		// 用户 Skill 落盘 userData（更新/卸载不丢失），内置 Skill 保持在只读资源目录
		const userSkillsDir = join(userData, "skills");
		process.env.USER_SKILLS_DIR = userSkillsDir;
		mkdirSync(userSkillsDir, { recursive: true });
		migrateLegacyUserSkills(userSkillsDir);
	}

	// 动态引入 backend，避免在 Electron 打包时出现模块解析问题
	const { startServer } = await import("backend");
	apiPort = await startServer();

	const win = new BrowserWindow({
		width: 1280,
		height: 800,
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	if (process.env.NODE_ENV === "development") {
		win.loadURL("http://localhost:5173");
		win.webContents.openDevTools();
	} else {
		win.loadFile(join(__dirname, "../../frontend/dist/index.html"));
	}
}

ipcMain.handle("get-api-port", () => apiPort);

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});
