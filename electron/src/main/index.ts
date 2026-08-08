import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "path";

let apiPort: number;

async function createWindow() {
	if (app.isPackaged) {
		const userData = app.getPath("userData");
		process.env.DATA_DIR = userData;
		process.env.DB_PATH = join(userData, "prd.db");
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
