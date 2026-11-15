export {};

declare global {
	interface Window {
		/** 由 electron/preload 暴露；Web 模式下不存在。仅作桌面模式探测与调试用。 */
		electronAPI?: {
			getApiPort: () => Promise<number>;
		};
	}
}
