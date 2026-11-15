import "dotenv/config";
import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import type { Server } from "node:http";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db/client.js";
import sessionsRouter from "./routes/sessions/index.js";
import modulesRouter from "./routes/modules.js";
import prototypesRouter, { putPrototypeFig } from "./routes/prototypes.js";
import { ensurePrototypesDir } from "./services/prototypeStore.js";

let currentServer: Server | null = null;

/**
 * 桌面嵌入态只允许本机回环地址访问，避免同机恶意网页借 DNS rebinding
 * 以任意 Host 读取本地 /api 数据。Web 模式不启用此中间件。
 */
function mountHostGuard(app: Express): void {
	if (!process.env.OPENPRD_EMBEDDED) return;

	const isLoopback = (hostname: string): boolean =>
		hostname === "127.0.0.1" ||
		hostname === "localhost" ||
		hostname === "::1" ||
		hostname === "[::1]";

	app.use((req: Request, res: Response, next: NextFunction) => {
		const rawHost = (req.headers.host ?? "").toLowerCase();
		if (rawHost) {
			const hostname = rawHost.startsWith("[")
				? rawHost.slice(0, rawHost.indexOf("]") + 1)
				: rawHost.split(":")[0];
			if (!isLoopback(hostname)) {
				res.status(403).type("text/plain").send("Forbidden host");
				return;
			}
		}

		const origin = req.headers.origin;
		if (origin) {
			try {
				if (!isLoopback(new URL(origin).hostname.toLowerCase())) {
					res.status(403).type("text/plain").send("Forbidden origin");
					return;
				}
			} catch {
				res.status(403).type("text/plain").send("Invalid origin");
				return;
			}
		}
		next();
	});
}

/**
 * 桌面模式：Express 同时托管前端静态资源，让 `/api/...` 与页面同源。
 * 顺序必须在所有 API 路由之后：静态文件先命中，未命中且是页面导航才回退 index.html。
 */
function mountStatic(app: Express): void {
	const staticDir = process.env.STATIC_DIR;
	if (!staticDir) return;

	const indexFile = join(staticDir, "index.html");
	app.use(express.static(staticDir, { index: false }));

	// Express 5 的 path-to-regexp 不支持 app.get("*")，用中间件兜底。
	app.use((req: Request, res: Response, next: NextFunction) => {
		if (req.method !== "GET" && req.method !== "HEAD") return next();
		if (req.path.startsWith("/api/")) return next();
		const ext = extname(req.path);
		if (ext && ext !== ".html") return next(); // 静态资源缺失应报 404，不能回退成 HTML
		if (!req.accepts("html")) return next();
		if (!existsSync(indexFile)) return next();
		return res.sendFile(indexFile);
	});
}

function createApp(): Express {
	const app = express();

	mountHostGuard(app);

	// Binary .fig upload must be parsed before express.json touches the stream.
	app.put(
		"/api/prototypes/:id",
		express.raw({ type: "*/*", limit: "50mb" }),
		putPrototypeFig,
	);

	app.use(express.json({ limit: "10mb" }));

	app.get("/health", (_req, res) => {
		res.status(200).json({ status: "ok", timestamp: Date.now() });
	});

	app.use("/api/sessions", sessionsRouter);
	app.use("/api/modules", modulesRouter);
	app.use("/api/prototypes", prototypesRouter);

	mountStatic(app);

	return app;
}

export async function startServer(port?: number, host?: string): Promise<number> {
	getDb(); // 首次调用时自动建表
	ensurePrototypesDir();
	const app = createApp();
	const listenPort = port ?? Number(process.env.PORT ?? 3000);
	const listenHost = host ?? (process.env.OPENPRD_EMBEDDED ? "127.0.0.1" : undefined);

	return new Promise((resolvePort, reject) => {
		const onListening = (): void => {
			if (!currentServer) return;
			const addr = currentServer.address();
			const actualPort = typeof addr === "object" && addr ? addr.port : listenPort;
			console.log(`[backend] listening on ${listenHost ?? "0.0.0.0"}:${actualPort}`);
			resolvePort(actualPort);
		};

		currentServer = listenHost
			? app.listen(listenPort, listenHost, onListening)
			: app.listen(listenPort, onListening);
		currentServer.on("error", reject);
	});
}

/** 供 Electron 主进程在 before-quit 时关闭监听。 */
export function stopServer(): void {
	currentServer?.close();
	currentServer = null;
}

// 直接运行时自动启动；嵌入 Electron 时由主进程显式调用 startServer()，此处不得重复启动。
const selfPath = fileURLToPath(import.meta.url);
const invokedDirectly =
	Boolean(process.argv[1]) &&
	(process.argv[1]!.endsWith("index.js") || process.argv[1]!.endsWith("index.ts")) &&
	selfPath === resolve(process.argv[1]!);
if (invokedDirectly && !process.env.OPENPRD_EMBEDDED) {
	startServer().catch((err) => {
		console.error("[backend] failed to start:", err);
		process.exit(1);
	});
}
