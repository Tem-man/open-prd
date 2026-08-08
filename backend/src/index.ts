import "dotenv/config";
import express from "express";
import type { Express } from "express";
import { getDb } from "./db/client.js";
import sessionsRouter from "./routes/sessions.js";
import modulesRouter from "./routes/modules.js";
import prototypesRouter, { putPrototypeFig } from "./routes/prototypes.js";
import { ensurePrototypesDir } from "./services/prototypeStore.js";

function createApp(): Express {
	const app = express();

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

	return app;
}

export async function startServer(port?: number): Promise<number> {
	getDb(); // 首次调用时自动建表
	ensurePrototypesDir();
	const app = createApp();
	const listenPort = port ?? Number(process.env.PORT ?? 3000);

	return new Promise((resolve, reject) => {
		const server = app.listen(listenPort, () => {
			const addr = server.address();
			const actualPort =
				typeof addr === "object" && addr ? addr.port : listenPort;
			console.log(`[backend] listening on port ${actualPort}`);
			resolve(actualPort);
		});
		server.on("error", reject);
	});
}

// 直接运行时自动启动
const isMain =
	process.argv[1]?.endsWith("index.js") ||
	process.argv[1]?.endsWith("index.ts");
if (isMain) {
	startServer().catch((err) => {
		console.error("[backend] failed to start:", err);
		process.exit(1);
	});
}
