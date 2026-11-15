# OpenPRD Windows 桌面版使用说明

> macOS / Linux 版本的产物、安装方式与数据目录见 [`electron-guide.md`](./electron-guide.md) 的「多平台构建」章节。

## 安装

`pnpm dist:win` 会在 `electron/release/<version>/` 产出两个 exe：

| 文件 | 用途 |
| --- | --- |
| `OpenPRD-Setup-<version>.exe` | 安装版（默认）。用户级安装，不需要管理员权限，可自定义安装目录，会创建桌面快捷方式 |
| `OpenPRD-Portable-<version>.exe` | 免安装便携版，双击直接运行 |

首次运行可能看到 Windows SmartScreen 的「未知发布者」提示——当前安装包**未做代码签名**，请确认文件来源后再选择「仍要运行」。

应用启动后会先在本机启动一个只监听 `127.0.0.1` 随机端口的本地服务，然后打开窗口；不需要另外安装 Node.js、数据库或浏览器服务。

---

## 首次配置模型

生成 PRD 需要一个可用的 LLM 服务。两种方式任选其一：

1. **推荐：应用内设置**。打开右上角「设置 → 模型服务」，选择 Provider、填写模型与 API Key。配置随每次对话请求下发，不需要写文件。
2. **环境变量兜底**：编辑 `%APPDATA%/OpenPRD/.env`（首次启动会自动生成带中文注释的模板）。这里可以配置 `LLM_PROVIDER`、`LLM_MODEL`、`OPENAI_API_KEY` / `OPENAI_BASE_URL`、`ANTHROPIC_API_KEY`、`OLLAMA_BASE_URL`、`VECTORIZE_*` 等。修改后**需重启应用**生效。

也可以直接使用系统环境变量（如 `OPENAI_API_KEY`），应用会透传。

> ⚠️ `.env` 是**明文**保存在用户目录的，请不要把该文件分享给他人，也不要填入不愿落盘的凭据。后续版本计划用系统钥匙串（`safeStorage`）加密存储。

没有配置任何模型时应用仍可启动（可浏览历史会话、查看已有 PRD），但发起对话会给出可读的错误提示。

---

## 数据位置与备份

所有用户数据都在 `%APPDATA%/OpenPRD/`（在资源管理器地址栏输入 `%APPDATA%\OpenPRD` 即可打开）：

```
prd.db (+ -wal / -shm)   SQLite：会话、消息、PRD 与版本
prototypes/*.fig         原型设计文档
skills/skill-custom-*    用户自建 Skill
.env                     可选的模型配置
logs/main.log            启动与错误日志
```

- **覆盖安装升级**：数据保留，不会被新版本覆盖。
- **卸载**：默认保留上述目录（`deleteAppDataOnUninstall: false`），卸载后重装仍可看到历史数据。
- **备份**：关闭应用后复制整个 `%APPDATA%/OpenPRD/` 目录即可；恢复时同样在关闭状态下覆盖回去。

---

## 常见问题

| 现象 | 排查 |
| --- | --- |
| 启动后白屏 / 弹「启动失败」 | 查看 `%APPDATA%/OpenPRD/logs/main.log`；常见原因是后端入口缺失或端口初始化失败 |
| 对话无响应、报模型错误 | 检查设置里的 API Key 与 Base URL；外网不可达时改用本地 Ollama |
| PRD 里的架构图 / 流程图空白 | Mermaid、markmap 等图表脚本来自公网 CDN，断网或内网环境无法渲染；导出的 HTML 同样依赖 CDN |
| 提示「已有实例在运行」 | 应用为单实例设计，二次启动会聚焦已有窗口；如需重启请在任务管理器结束旧进程 |
| 想回到开发模式 | 项目根目录执行 `pnpm dev`，前端 `:5173` + 后端 `:3000`，与桌面版数据目录互相独立 |

---

## 已知限制

- 图表 CDN 未本地化，**不承诺完全离线可用**；LLM 调用本身也需要网络。
- 未做代码签名与自动更新。
- macOS / Linux 未验收。
