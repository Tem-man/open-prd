// 本地 multer 类型声明（网络无法安装 @types/multer 时使用）
declare module "multer" {
	import { RequestHandler } from "express";

	interface File {
		fieldname: string;
		originalname: string;
		encoding: string;
		mimetype: string;
		size: number;
		buffer: Buffer;
		filename?: string;
		path?: string;
	}

	interface Options {
		storage?: StorageEngine;
		limits?: {
			fileSize?: number;
			files?: number;
		};
		fileFilter?: (
			req: Express.Request,
			file: File,
			cb: (error: Error | null, acceptFile: boolean) => void,
		) => void;
	}

	interface StorageEngine {}

	interface Multer {
		single(fieldname: string): RequestHandler;
		array(fieldname: string, maxCount?: number): RequestHandler;
		fields(fields: Array<{ name: string; maxCount?: number }>): RequestHandler;
		none(): RequestHandler;
	}

	interface MemoryStorageEngine extends StorageEngine {}

	function multer(options?: Options): Multer;
	namespace multer {
		function memoryStorage(): MemoryStorageEngine;
	}

	export = multer;
}

declare namespace Express {
	interface Request {
		file?: import("multer").File;
		files?: import("multer").File[] | Record<string, import("multer").File[]>;
	}
}
