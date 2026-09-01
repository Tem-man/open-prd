/**
 * markmapExport — extract markmap Markdown from #markmap-data and download as .md
 */

function queryMarkmapData(root: ParentNode | string): Element | null {
	if (typeof root === "string") {
		const tmp = document.createElement("div");
		tmp.innerHTML = root;
		return tmp.querySelector("#markmap-data");
	}
	return root.querySelector("#markmap-data");
}

/** True when the section HTML/DOM contains a markmap payload or svg. */
export function hasMarkmapContent(root: ParentNode | string): boolean {
	if (typeof root === "string") {
		return (
			root.includes('id="markmap-data"') || root.includes('id="markmap-svg"')
		);
	}
	return (
		root.querySelector("#markmap-data") !== null ||
		root.querySelector("#markmap-svg") !== null
	);
}

/**
 * Read Markdown from `<script type="application/json" id="markmap-data">`.
 * The generator stores a JSON-encoded string; raw markdown is accepted as fallback.
 */
export function extractMarkmapMarkdown(root: ParentNode | string): string | null {
	const dataEl = queryMarkmapData(root);
	const raw = dataEl?.textContent?.trim() ?? "";
	if (!raw) return null;

	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed === "string" && parsed.trim()) return parsed;
		return null;
	} catch {
		return raw.startsWith("#") ? raw : null;
	}
}

export function sanitizeDownloadFilename(name: string): string {
	const cleaned = name
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned || "信息架构";
}

export function downloadTextFile(
	content: string,
	filename: string,
	mime = "text/markdown;charset=utf-8",
): void {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
	a.click();
	URL.revokeObjectURL(url);
}

/**
 * Download the markmap tree as `{sessionTitle}-{sectionTitle}.md`.
 * Returns false when #markmap-data is missing or empty.
 */
export function downloadMarkmapMarkdown(
	root: ParentNode | string,
	sessionTitle?: string,
	sectionTitle = "信息架构",
): boolean {
	const markdown = extractMarkmapMarkdown(root);
	if (!markdown) return false;

	const sectionPart = sanitizeDownloadFilename(sectionTitle);
	const base = sessionTitle?.trim()
		? `${sanitizeDownloadFilename(sessionTitle)}-${sectionPart}`
		: sectionPart;
	downloadTextFile(markdown, `${base}.md`);
	return true;
}
