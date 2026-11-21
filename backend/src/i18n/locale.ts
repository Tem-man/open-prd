import type { Request } from "express";

/** 应用界面支持的语言。编辑器底层还有其他语种，应用侧只做中英两版。 */
export type Locale = "zh-CN" | "en";

export const DEFAULT_LOCALE: Locale = "en";

/** 从 Accept-Language 解析出应用语言；zh* → zh-CN，其余一律 en。 */
export function localeFromHeader(header: string | undefined): Locale {
	if (!header) return DEFAULT_LOCALE;
	const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
	return first.startsWith("zh") ? "zh-CN" : "en";
}

/** 从 Express 请求读取界面语言。 */
export function getLocale(req: Request): Locale {
	return localeFromHeader(req.headers["accept-language"]);
}
