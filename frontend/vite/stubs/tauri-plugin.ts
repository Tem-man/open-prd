/** Browser/Electron stub for @tauri-apps/* packages that remain as dead branches. */
export async function readFile() { throw new Error('Tauri unavailable') }
export async function writeFile() { throw new Error('Tauri unavailable') }
export async function save() { return null }
export async function open() { return null }
export async function openUrl() {}
export async function listen() { return () => {} }
export async function once() { return () => {} }
export async function emit() {}
export function getCurrentWindow() { return { listen: async () => () => {} } }
export default {}
