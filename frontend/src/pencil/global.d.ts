export {}

/*
 * Ambient declarations the migrated editor relies on: Safari's gesture events and the File System
 * Access / Local Font Access APIs, none of which ship in TypeScript's DOM lib.
 *
 * Upstream's `mockWindowOpen` test hook is dropped along with the automation bridge.
 */
declare global {
	interface GestureEvent extends UIEvent {
		scale: number;
		rotation: number;
		clientX: number;
		clientY: number;
	}

	interface FilePickerAcceptType {
		description: string;
		accept: Record<string, string[]>;
	}

	interface FilePickerOptions {
		types?: FilePickerAcceptType[];
		suggestedName?: string;
	}

	interface Window {
		showOpenFilePicker?(options?: FilePickerOptions): Promise<FileSystemFileHandle[]>;
		showSaveFilePicker?(options?: FilePickerOptions): Promise<FileSystemFileHandle>;
		queryLocalFonts?(): Promise<
			{
				family: string;
				fullName: string;
				style: string;
				postscriptName: string;
				blob(): Promise<Blob>;
			}[]
		>;
	}
}
