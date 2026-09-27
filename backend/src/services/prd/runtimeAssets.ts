import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// build 脚本会把 runtime/ 原样拷到 dist 同位置，dev（tsx）与构建产物共用这一相对路径
const RUNTIME_DIR = new URL("./runtime/", import.meta.url);

function read(name: string): string {
	return readFileSync(new URL(name, RUNTIME_DIR), "utf8");
}

export const PRD_RUNTIME_CSS = `${read("prd-page.css")}\n${read("prd-content.css")}`;
export const PRD_RUNTIME_JS = read("prd-runtime.js");

/** 运行时资产指纹：资产一变，已落库的 prds.html 缓存即判定过期 */
export const PRD_RUNTIME_FINGERPRINT = createHash("sha256")
	.update(PRD_RUNTIME_CSS)
	.update(PRD_RUNTIME_JS)
	.digest("hex")
	.slice(0, 12);
