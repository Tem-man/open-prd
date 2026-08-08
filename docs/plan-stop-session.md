# 实现计划：暂停 AI 对话（Stop Generation）

> 状态：草稿 | 创建时间：2026-05-31

---

## 一、背景与目标

### 现状

用户在输入框中发送消息后，AI 进入流式生成（SSE 推送）阶段。整个生成过程——尤其是 PRD 多模块逐步生成——可能耗时数十秒甚至数分钟。目前输入框在生成期间完全禁用，用户无法主动中断，体验较差。

### 目标

在生成过程中，用输入框右下角的**暂停按钮**取代发送按钮：

1. 用户点击暂停按钮 → 前端立即中止 SSE 流（`AbortController.abort()`）；
2. 后端感知客户端断开 → 将已生成的部分内容安全落库；
3. 前端将流式消息气泡从"生成中"状态变为"已完成"状态，显示已收到的内容；
4. 用户可随即重新输入，继续正常对话。

---

## 二、UI 设计

### 2.1 按钮外观（对照截图）

| 属性       | 值                                                                     |
| ---------- | ---------------------------------------------------------------------- |
| 形状       | 圆角方形（`border-radius: 8px`）                                       |
| 尺寸       | 30 × 30 px                                                             |
| 背景       | `#FFFFFF`（白色）                                                      |
| 边框       | `1px solid #E5E7EB`                                                    |
| 阴影       | `0 1px 4px rgba(0,0,0,0.08)`                                           |
| 内部图标   | 10 × 10 px 红色实心正方形（`background: #EF4444; border-radius: 2px`） |
| Hover 状态 | 背景 `#FEF2F2`，边框 `#FCA5A5`，阴影带红色晕染                         |

### 2.2 状态切换逻辑

```
用户点击发送
    ↓
isSending = true
    ↓ (替换)
[发送按钮] → [暂停按钮]
    ↓
用户点击暂停 / 流结束
    ↓
isSending = false
    ↓ (恢复)
[暂停按钮] → [发送按钮]
```

### 2.3 输入框在生成期间的状态

| 元素       | 状态                                 |
| ---------- | ------------------------------------ |
| `textarea` | `disabled`，`opacity: 0.5`，不可编辑 |
| 附件按钮   | `disabled`，保持展示                 |
| 暂停按钮   | 可点击，hover 变红                   |

---

## 三、前端实现

### 3.1 `useSSE.ts` — 中止流

**已有机制**（无需新增）：

```ts
// 模块级 AbortController，每次 sendMessage 创建新实例
let activeAbortController: AbortController | null = null;

export function useSSE() {
	function stopGeneration() {
		if (activeAbortController) {
			activeAbortController.abort(); // 触发 AbortError
			activeAbortController = null;
		}
	}
	return { sendMessage, stopGeneration };
}
```

`sendMessage` 内部已处理 `AbortError`：

```ts
// 用户主动中止时，终止流并 finalize 气泡
if (signal.aborted) {
	messagesStore.finalizeMessage(tempId);
	return;
}
```

**关键点**：`abort()` 会触发 `reader.cancel()`（在 `onAbort` 回调里），导致 `reader.read()` reject，`done = true`，循环退出，最终调用 `messagesStore.finalizeMessage(tempId)` 将流式气泡固化为普通消息。

### 3.2 `SessionSidebar.vue` — 暂停按钮 UI

**`<script setup>` 部分**

```ts
const { sendMessage, stopGeneration } = useSSE();
const isSending = ref(false);

async function handleSend() {
	const text = inputText.value.trim();
	if (!text || isSending.value) return;
	inputText.value = "";
	nextTick(resetTextareaHeight);
	isSending.value = true;
	try {
		await sendMessage(props.sessionId, text);
		await sessionsStore.fetchSession(props.sessionId);
	} finally {
		isSending.value = false;
	}
}

function handleStop() {
	stopGeneration(); // 立即中止 SSE 流
	isSending.value = false; // 恢复 UI 为可输入状态
}
```

**Template 部分**

```html
<div class="input-actions">
	<!-- 附件按钮（生成中禁用） -->
	<button class="input-icon-btn" title="附件" :disabled="isSending">
		<!-- 附件 SVG... -->
	</button>

	<!-- 生成中：暂停按钮 -->
	<button
		v-if="isSending"
		class="btn-stop"
		title="停止生成"
		@click="handleStop"
	>
		<span class="stop-icon"></span>
	</button>

	<!-- 待发送：发送按钮 -->
	<button
		v-else
		class="btn-send"
		:disabled="!inputText.trim()"
		@click="handleSend"
	>
		<!-- 箭头 SVG... -->
	</button>
</div>
```

**样式部分（SCSS）**

```scss
.btn-stop {
	width: 30px;
	height: 30px;
	border-radius: 8px;
	background: #fff;
	border: 1px solid #e5e7eb;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
	transition:
		background 0.15s,
		box-shadow 0.15s;

	&:hover {
		background: #fef2f2;
		border-color: #fca5a5;
		box-shadow: 0 2px 6px rgba(239, 68, 68, 0.15);
	}

	.stop-icon {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: #ef4444;
		display: block;
	}
}
```

---

## 四、后端实现

### 4.1 客户端断开处理（已有机制）

后端在 `POST /api/sessions/:id/messages` 路由中已监听 `req.on("close")` 事件：

```ts
let partialReply = "";
let streamFinished = false;

req.on("close", () => {
	// 客户端断开（包括用户主动中止）时，若累积内容 > 20 字符则落库
	if (!streamFinished && partialReply.length > 20) {
		const brokenMsgId = uuidv4();
		db.prepare("INSERT INTO messages (...) VALUES (?,...)").run(
			brokenMsgId,
			sessionId,
			"assistant",
			`${partialReply} [⚠ 回复被中断]`,
			Date.now(),
		);
	}
});
```

**结论**：后端无需任何修改，已具备安全中断能力。

### 4.2 中断后的断线重连豁免

`useSSE.ts` 中，流结束后会判断是否需要断线重连：

```ts
// 用户主动中止：signal.aborted === true，直接 return，不重连
if (signal.aborted) {
	messagesStore.finalizeMessage(tempId);
	return;
}
```

用户点击暂停 → `abort()` → `signal.aborted = true` → 跳过重连逻辑，直接结束。不会重新发起请求。

---

## 五、完整交互时序图

```
用户               前端 (SessionSidebar)        useSSE.ts              后端 (Express)
 |                          |                       |                        |
 |-- 点击发送 ------------> |                       |                        |
 |                 isSending=true                   |                        |
 |                [按钮切换为暂停]                   |                        |
 |                          |-- sendMessage() ----> |                        |
 |                          |                  POST /api/sessions/:id/messages
 |                          |                       |----------------------->|
 |                          |                       |<--- SSE delta 流 ------|
 |                          |<-- appendDelta() -----|                        |
 |                          |                       |                        |
 |-- 点击暂停 ------------> |                       |                        |
 |                          |-- handleStop() -----> |                        |
 |                          |              stopGeneration()                  |
 |                          |              AbortController.abort()           |
 |                          |                       |---- 关闭 fetch ------->|
 |                          |                       |               req "close" 事件
 |                          |                       |               落库部分回复
 |                 isSending=false                  |                        |
 |                [按钮切换为发送]                   |                        |
 |                finalizeMessage()（气泡固化）       |                        |
```

---

## 六、边界情况与处理策略

| 场景                           | 处理方式                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 流已自然结束时点击暂停         | `stopGeneration()` 内部判断 `activeAbortController` 为 null，空操作，`isSending` 正常归零                                                  |
| 暂停后部分内容 < 20 字符       | 后端不落库（阈值保护），前端气泡仍显示已收到内容，但数据库不持久化碎片                                                                     |
| 生成 PRD 阶段中暂停            | 客户端断开 → 后端 `res.writableEnded` 变 true → `writePrdProgress` 等调用短路 → PRD 不完整，无 `prd_ready` 事件，前端不触发 `fetchPrdHtml` |
| 网络异常（非主动中止）导致断流 | `signal.aborted === false` → 触发断线重连一次，避免误判为用户暂停                                                                          |
| 快速连续点击发送               | `isSending` 为 true 时 `handleSend` 直接 return，防重复提交                                                                                |

---

## 七、文件改动清单

| 文件                                         | 操作     | 说明                                                                    |
| -------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `frontend/src/components/SessionSidebar.vue` | 修改     | 添加 `v-if="isSending"` 暂停按钮、`handleStop()` 函数、`.btn-stop` 样式 |
| `frontend/src/composables/useSSE.ts`         | 无需修改 | `AbortController` + `stopGeneration()` 已就位                           |
| `backend/src/routes/sessions.ts`             | 无需修改 | `req.on("close")` 落库逻辑已就位                                        |

> 本次改动只涉及 **1 个前端组件文件**，后端零改动。

---

## 八、验收标准

- [ ] 发送消息后，发送按钮立即替换为暂停按钮（白底红方块样式，与截图一致）
- [ ] 暂停按钮 hover 时出现红色晕染效果
- [ ] 点击暂停按钮后，流式生成中止，输入框恢复可用状态
- [ ] 气泡中显示已收到的部分内容，不出现"正在生成"打字动画
- [ ] 流自然结束后，输入框自动恢复，暂停按钮消失
- [ ] 在 PRD 多模块生成阶段点击暂停，不崩溃，不留残留 `isStreaming` 状态
- [ ] 暂停后可立即发送新消息，正常触发新一轮对话
