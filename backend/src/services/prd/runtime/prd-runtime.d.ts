// prd-runtime.js 的类型声明（后端与前端共用）；改 JS 导出签名时需同步此文件。

export interface DiagramLibrary {
	readonly name: string;
	readonly selector: string;
	readonly htmlPattern: RegExp;
	readonly scripts: readonly string[];
	ready(): boolean;
}

export declare const DIAGRAM_LIBRARIES: readonly DiagramLibrary[];
export declare const DIAGRAM_MAX_HEIGHT: Readonly<Record<string, number>>;
export declare const MERMAID_CONFIG: Readonly<Record<string, unknown>>;

export declare function collectDiagramScripts(contents: readonly string[]): string[];
export declare function waitFrames(n: number): Promise<void>;
export declare function loadDiagramLibraries(root: ParentNode): Promise<void>;
export declare function preloadDiagramLibraries(): Promise<void>;
export declare function runMermaid(
	nodes: Element[],
	options?: { suppressErrors?: boolean },
): Promise<boolean>;
export declare function initZoomIn(
	container: ParentNode,
	maxHeight?: number,
): Array<() => void>;
export declare function renderMarkmapIn(container: ParentNode): void;
export declare function renderDiagrams(
	container: HTMLElement,
	options?: { maxHeight?: number; loadLibraries?: boolean },
): Promise<Array<() => void>>;
export declare function mountPrdPage(): void;
