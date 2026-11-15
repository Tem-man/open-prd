import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const nodeTarget = "node22";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // electron-vite 5 + Vite 8 要求显式声明构建目标，否则 main 构建直接报错。
    // Electron 42 内置 Node 22+，这里与运行时对齐。
    build: { target: nodeTarget },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { target: nodeTarget },
  },
  // 无 renderer 配置：渲染进程由独立的 frontend/ 包负责
})
