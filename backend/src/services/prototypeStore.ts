import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the data root used for SQLite and on-disk `.fig` files.
 * Matches `db/client.ts`: Electron injects `DATA_DIR` / `DB_PATH`;
 * in local `pnpm dev` we fall back to `backend/data/`.
 */
export function getDataDir(): string {
	if (process.env.DATA_DIR) {
		return path.resolve(process.env.DATA_DIR);
	}
	if (process.env.DB_PATH) {
		return path.dirname(path.resolve(process.env.DB_PATH));
	}
	return path.resolve(__dirname, "../../data");
}

export function getPrototypesDir(): string {
	return path.join(getDataDir(), "prototypes");
}

export function ensurePrototypesDir(): string {
	const dir = getPrototypesDir();
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

export function prototypeFilePath(fileName: string): string {
	// Only allow a single path segment — never accept user-controlled absolute paths.
	const base = path.basename(fileName);
	if (base !== fileName || fileName.includes("..")) {
		throw new Error(`Invalid prototype file name: ${fileName}`);
	}
	return path.join(getPrototypesDir(), base);
}

/** Atomically write `.fig` bytes: write tmp then rename over the target. */
export function writePrototypeFileAtomic(
	fileName: string,
	data: Buffer,
): number {
	ensurePrototypesDir();
	const target = prototypeFilePath(fileName);
	const tmp = `${target}.tmp`;
	fs.writeFileSync(tmp, data);
	fs.renameSync(tmp, target);
	return data.byteLength;
}

export function readPrototypeFile(fileName: string): Buffer | null {
	const target = prototypeFilePath(fileName);
	if (!fs.existsSync(target)) return null;
	return fs.readFileSync(target);
}

/** Best-effort delete; missing file is not an error (orphan-tolerant). */
export function deletePrototypeFile(fileName: string): void {
	const target = prototypeFilePath(fileName);
	try {
		fs.unlinkSync(target);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") throw err;
	}
}

export function figFileNameForId(id: string): string {
	return `${id}.fig`;
}
