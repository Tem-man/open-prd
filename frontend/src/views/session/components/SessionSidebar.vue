<script setup lang="ts">
	/**
	 * SessionSidebar — 会话侧边栏
	 * 显示会话侧边栏
	 * 支持对话、模块管理、历史会话
	 * 支持进度步骤条
	 * 支持消息列表
	 * 支持输入区
	 * 支持历史会话抽屉
	 * 支持模块管理抽屉
	 */

	import { ref, computed, nextTick, watch, onUnmounted } from "vue";
	import { useMessagesStore } from "@/stores/messages";
	import { useSessionsStore } from "@/stores/sessions";
	import { usePrdEditStore } from "@/stores/prdEdit";
	import { usePrototypesStore } from "@/stores/prototypes";
	import { useSSE, useSectionEdit } from "@/composables/useSSE";
	import { useSectionActions } from "@/composables/useSectionActions";
	import TypingIndicator from "@/components/TypingIndicator.vue";
	import HistoryDrawer from "@/components/HistoryDrawer.vue";
	import ModuleManager from "@/components/ModuleManager.vue";
	import QuestionForm from "@/components/QuestionForm.vue";
	import ThinkingBlock from "@/components/ThinkingBlock.vue";
	import StopGenerateButton from "@/components/StopGenerateButton.vue";
	import ModelSelector from "@/components/ModelSelector.vue";

	const props = defineProps<{ sessionId: string }>();

	const messagesStore = useMessagesStore();
	const sessionsStore = useSessionsStore();
	const prdEditStore = usePrdEditStore();
	const prototypesStore = usePrototypesStore();
	const { sendMessage, retrySession, stopGeneration } = useSSE();
	const { editSection } = useSectionEdit();
	const { saving, rolling, saveSection, rollbackSection } = useSectionActions();

	type Tab = "chat" | "modules" | "history";
	const activeTab = ref<Tab>("chat");
	const historyOpen = ref(false);
	const modulesOpen = ref(false);
	const inputText = ref("");
	const isSending = ref(false);
	const messageListRef = ref<HTMLElement | null>(null);
	const textareaRef = ref<HTMLTextAreaElement | null>(null);

	function autoResize() {
		const el = textareaRef.value;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}

	function resetTextareaHeight() {
		const el = textareaRef.value;
		if (!el) return;
		el.style.height = "";
	}
	const currentSession = computed(() => sessionsStore.currentSession);
	const hasMessages = computed(() => messagesStore.messages.length > 0);
	const hasPrd = computed(() => !!messagesStore.prdReady);

	// ── 模块编辑控制区 ────────────────────────────────────────────────────────────
	const isModuleEditing = computed(() => !!prdEditStore.editingSection);
	const editingSectionTitle = computed(() => prdEditStore.editingSectionTitle);
	const isAiRewriting = computed(() => !!prdEditStore.aiEditingSection);
	const moduleEditBusy = computed(
		() => isAiRewriting.value || saving.value || rolling.value,
	);
	const moduleInstruction = ref("");

	async function handleModuleAiRewrite() {
		const text = moduleInstruction.value.trim();
		if (!text || moduleEditBusy.value || !prdEditStore.editingSection) return;
		moduleInstruction.value = "";
		await editSection(props.sessionId, prdEditStore.editingSection, text);
	}

	async function handleModuleSave() {
		if (moduleEditBusy.value || !prdEditStore.editingSection) return;
		await saveSection(props.sessionId, prdEditStore.editingSection, () =>
			prdEditStore.getHtml(),
		);
	}

	async function handleModuleRollback() {
		if (moduleEditBusy.value || !prdEditStore.editingSection) return;
		await rollbackSection(props.sessionId, prdEditStore.editingSection);
	}

	function handleModuleCancel() {
		prdEditStore.cancelEdit();
	}

	function openHistory() {
		activeTab.value = "history";
		historyOpen.value = true;
		modulesOpen.value = false;
	}
	function closeHistory() {
		historyOpen.value = false;
		activeTab.value = "chat";
	}

	function openModules() {
		activeTab.value = "modules";
		modulesOpen.value = true;
		historyOpen.value = false;
	}
	function closeModules() {
		modulesOpen.value = false;
		activeTab.value = "chat";
	}

	const currentSessionModuleIds = computed(() =>
		(sessionsStore.currentSession?.selectedModules ?? []).map((m) => m.id),
	);

	async function onModulesConfirm(selectedModuleIds: string[]) {
		closeModules();
		try {
			const updatedModules = await sessionsStore.updateSessionModules(
				props.sessionId,
				selectedModuleIds,
			);
			// 同步进度步骤条与已选模块
			messagesStore.initWorkflowSteps(updatedModules);
		} catch (e) {
			console.error("[SessionSidebar] updateSessionModules failed:", e);
		}
	}

	// ── 生成原型稿（PRD 完成后的引导动作） ──────────────────────────────────────
	const isCreatingPrototype = ref(false);

	async function handleCreatePrototype() {
		if (isCreatingPrototype.value) return;
		isCreatingPrototype.value = true;
		try {
			const title = `${currentSession.value?.title || "未命名"} - 原型`;
			// createPrototype 内部会跳转 /prototype/:id
			await prototypesStore.createPrototype(title, props.sessionId);
		} catch (e) {
			console.error("[SessionSidebar] createPrototype failed:", e);
		} finally {
			isCreatingPrototype.value = false;
		}
	}

	/** 点击抽屉中某轮次 → 滚动到对应用户消息 */
	function scrollToMsg(msgId: string) {
		nextTick(() => {
			const el = messageListRef.value?.querySelector(
				`[data-msg-id="${msgId}"]`,
			);
			el?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	}

	function scrollToBottom() {
		nextTick(() => {
			if (messageListRef.value) {
				messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
			}
		});
	}

	watch(() => messagesStore.messages.length, scrollToBottom);
	watch(
		() => messagesStore.messages[messagesStore.messages.length - 1]?.content,
		scrollToBottom,
	);

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
		stopGeneration();
		isSending.value = false;
	}

	async function handleRetryFromBubble(msgId: string) {
		const msg = messagesStore.messages.find((m) => m.id === msgId);
		if (!msg || !msg.interrupted) return;
		isSending.value = true;
		try {
			const mode =
				msg.content.trim().length > 20 ? "continue_agent" : "retry_last";
			await retrySession(props.sessionId, mode);
			await sessionsStore.fetchSession(props.sessionId);
		} finally {
			isSending.value = false;
		}
	}

	/** pipeline 系统气泡（PRD 中断 / 模块失败等）的重试按钮文案 */
	const pipelineRetryLabel = computed(() => {
		switch (messagesStore.pipelineState?.lastError?.suggestedMode) {
			case "retry_last":
				return "重新生成";
			case "continue_agent":
				return "继续对话";
			case "continue_prd":
				return "继续生成 PRD";
			case "retry_section":
				return "重试失败模块";
			default:
				return "继续";
		}
	});

	/** 是否显示 pipeline 系统气泡（排除对话中断——那个走 interrupted 气泡） */
	const showPipelineBubble = computed(() => {
		const state = messagesStore.pipelineState;
		if (!state?.lastError?.retryable) return false;
		if (state.phase === "done") return false;
		// 对话中断已有 interrupted 气泡，不重复
		if (state.phase === "agent_interrupted") return false;
		return true;
	});

	async function handlePipelineRetry() {
		const state = messagesStore.pipelineState;
		if (!state?.lastError) return;
		const mode = state.lastError.suggestedMode ?? "retry_last";
		const sectionId = state.failedSectionId;
		messagesStore.clearPipelineState();
		isSending.value = true;
		try {
			await retrySession(
				props.sessionId,
				mode as import("@/types").RetryMode,
				sectionId,
			);
			await sessionsStore.fetchSession(props.sessionId);
		} finally {
			isSending.value = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	async function handleFormSubmit(msgId: string, answersText: string) {
		// 标记表单已提交（禁用该表单）
		messagesStore.markFormSubmitted(msgId);
		// 将整合好的答案文本作为普通用户消息发送
		inputText.value = "";
		isSending.value = true;
		try {
			await sendMessage(props.sessionId, answersText, { isFormAnswer: true });
			await sessionsStore.fetchSession(props.sessionId);
		} finally {
			isSending.value = false;
		}
	}

	/**
	 * 从渲染内容中剥离 [QUESTION_FORM]...[/QUESTION_FORM] 块。
	 * 完整块（首尾标记均存在）→ 整体移除。
	 * 不完整块（流式传输中，只有开始标记）→ 截断开始标记及之后的所有内容，
	 * 防止 JSON 在流式期间直接暴露在气泡中。
	 */
	function stripFormBlock(text: string): string {
		// 完整块：直接移除
		let result = text.replace(
			/\[QUESTION_FORM\][\s\S]*?\[\/QUESTION_FORM\]/g,
			"",
		);
		// 不完整块（只有开始标记，流式传输中）：截断其后所有内容
		const partialIdx = result.indexOf("[QUESTION_FORM]");
		if (partialIdx !== -1) {
			result = result.slice(0, partialIdx);
		}
		return result.trim();
	}

	// ── 拖拽调整宽度 ────────────────────────────────────────────────────────────
	const SIDEBAR_MIN_WIDTH = 280;
	const SIDEBAR_MAX_WIDTH = 680;
	const sidebarWidth = ref(440);
	const isResizing = ref(false);
	let resizeStartX = 0;
	let resizeStartWidth = 0;

	function startResize(e: MouseEvent) {
		e.preventDefault();
		isResizing.value = true;
		resizeStartX = e.clientX;
		resizeStartWidth = sidebarWidth.value;
		document.addEventListener("mousemove", onResize);
		document.addEventListener("mouseup", stopResize);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	}

	function onResize(e: MouseEvent) {
		if (!isResizing.value) return;
		const delta = e.clientX - resizeStartX;
		sidebarWidth.value = Math.min(
			SIDEBAR_MAX_WIDTH,
			Math.max(SIDEBAR_MIN_WIDTH, resizeStartWidth + delta),
		);
	}

	function stopResize() {
		isResizing.value = false;
		document.removeEventListener("mousemove", onResize);
		document.removeEventListener("mouseup", stopResize);
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	}

	onUnmounted(() => {
		document.removeEventListener("mousemove", onResize);
		document.removeEventListener("mouseup", stopResize);
	});

	function renderMarkdown(text: string): string {
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
			.replace(/`([^`]+)`/g, "<code>$1</code>")
			.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
			.replace(/\*(.+?)\*/g, "<em>$1</em>")
			.replace(/^• (.+)$/gm, "<li>$1</li>")
			.replace(/^- (.+)$/gm, "<li>$1</li>")
			.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
			.replace(/\n\n/g, "</p><p>")
			.replace(/\n/g, "<br>")
			.replace(/^(.+)$/, "<p>$1</p>");
	}
</script>

<template>
	<aside class="sidebar" :style="{ width: sidebarWidth + 'px' }">
		<!-- 拖拽调整宽度手柄 -->
		<div
			class="resize-handle"
			:class="{ resizing: isResizing }"
			@mousedown="startResize"
		></div>
		<!-- Tab 切换 -->
		<div class="tabs">
			<button
				class="tab"
				:class="{ active: activeTab === 'chat' }"
				@click="
					activeTab = 'chat';
					historyOpen = false;
					modulesOpen = false;
				"
			>
				对话
			</button>
			<button
				class="tab"
				:class="{ active: activeTab === 'modules' }"
				@click="openModules"
			>
				模块管理
			</button>
			<button
				class="tab"
				:class="{ active: activeTab === 'history' }"
				@click="openHistory"
			>
				历史会话
			</button>
		</div>

		<!-- 消息列表 -->
		<div class="message-list" ref="messageListRef">
			<!-- 欢迎语 -->
			<div v-if="!hasMessages" class="welcome-msg">
				<div class="msg-row assistant">
					<div class="avatar ai">AI</div>
					<div class="bubble assistant-bubble">
						<p>
							你好！我是你的
							<strong>PRD 助手</strong
							>。我可以帮助你从零开始构建一份完整、结构化的产品需求文档。
						</p>
						<p>请告诉我你想做什么产品？越详细越好。比如：</p>
						<ul>
							<li>产品类型（App / Web / 小程序 / 后台系统）</li>
							<li>目标用户群体</li>
							<li>核心功能和业务场景</li>
							<li>任何你已经思考过的设计方案</li>
						</ul>
					</div>
				</div>
			</div>

			<!-- 消息 -->
			<div
				v-for="msg in messagesStore.messages"
				:key="msg.id"
				:data-msg-id="msg.id"
				class="msg-row"
				:class="msg.role"
				v-show="!msg.isFormAnswer"
			>
				<div v-if="msg.role === 'assistant'" class="avatar ai">AI</div>
				<div class="assistant-msg-wrap" v-if="msg.role === 'assistant'">
					<ThinkingBlock
						v-if="msg.thinking"
						:thinking="msg.thinking"
						:streaming="!!msg.isThinkingStreaming"
					/>
					<!-- 流式开始前（内容为空且尚无思考）显示打字动画 -->
					<div
						v-if="
							msg.isStreaming &&
							!stripFormBlock(msg.content) &&
							!msg.thinking
						"
						class="bubble assistant-bubble"
					>
						<TypingIndicator />
					</div>
					<!-- 有内容时显示气泡 -->
					<div
						class="bubble assistant-bubble"
						v-if="stripFormBlock(msg.content)"
					>
						<div
							class="md-content"
							v-html="renderMarkdown(stripFormBlock(msg.content))"
						></div>
						<TypingIndicator v-if="msg.isStreaming" class="typing-inline" />
					</div>
					<!-- 对话中断操作气泡 -->
					<div v-if="msg.interrupted && !msg.isStreaming" class="action-bubble">
						<span class="action-bubble__icon">⚠</span>
						<span class="action-bubble__text">回复因超时中断</span>
						<button
							type="button"
							class="action-bubble__btn"
							:disabled="isSending"
							@click="handleRetryFromBubble(msg.id)"
						>
							{{ msg.content.trim().length > 20 ? "继续生成" : "重新生成" }}
						</button>
					</div>
					<!-- 结构化提问表单 -->
					<QuestionForm
						v-if="msg.formData"
						:form="msg.formData"
						:default-answers="msg.formAnswers"
						:disabled="msg.formSubmitted || isSending"
						@submit="(text) => handleFormSubmit(msg.id, text)"
					/>
					<!-- PRD 完成后的「生成原型稿」引导动作 -->
					<div
						v-if="msg.action?.type === 'create-prototype'"
						class="action-bubble"
					>
						<span class="action-bubble__icon">🎨</span>
						<button
							type="button"
							class="action-bubble__btn"
							:disabled="isCreatingPrototype"
							@click="handleCreatePrototype"
						>
							{{ isCreatingPrototype ? "正在创建原型…" : msg.action.label }}
						</button>
					</div>
				</div>
				<div v-else-if="msg.role === 'user'" class="bubble user-bubble">
					<span>{{ msg.content }}</span>
				</div>
				<!-- PRD 生成/模块失败的系统气泡（显示在消息流末尾） -->
				<Transition name="action-bubble-fade">
					<div v-if="showPipelineBubble" class="msg-row assistant system-row">
						<div class="avatar ai">AI</div>
						<div class="action-bubble">
							<span class="action-bubble__icon">⚠</span>
							<span class="action-bubble__text">
								{{
									messagesStore.pipelineState?.lastError?.message ??
									"生成中断，可继续完成"
								}}
							</span>
							<button
								type="button"
								class="action-bubble__btn"
								:disabled="isSending"
								@click="handlePipelineRetry"
							>
								{{ pipelineRetryLabel }}
							</button>
						</div>
					</div>
				</Transition>
			</div>
		</div>

		<!-- ── 模块编辑控制区（编辑模式激活时替换普通输入框） ── -->
		<div v-if="isModuleEditing" class="input-area module-edit-area">
			<!-- 上下文标题 -->
			<div class="module-edit-context">
				<span class="module-edit-icon">✏</span>
				<span class="module-edit-label">正在编辑：</span>
				<span class="module-edit-title">{{ editingSectionTitle }}</span>
			</div>

			<!-- AI 指令输入 -->
			<div class="input-box" :class="{ disabled: moduleEditBusy }">
				<textarea
					v-model="moduleInstruction"
					class="input-textarea"
					placeholder="输入指令让 AI 重写整个模块…"
					:disabled="moduleEditBusy"
					@keydown.enter.exact.prevent="handleModuleAiRewrite"
					rows="1"
					@input="autoResize"
				></textarea>
				<div class="input-actions">
					<button
						class="btn-rewrite"
						:disabled="!moduleInstruction.trim() || moduleEditBusy"
						@click="handleModuleAiRewrite"
					>
						<span v-if="isAiRewriting" class="module-spinner" />
						<span v-else>AI 重写</span>
					</button>
				</div>
			</div>

			<!-- 操作按钮行 -->
			<div class="module-edit-actions">
				<button
					class="mod-btn mod-btn-ghost"
					:disabled="moduleEditBusy"
					@click="handleModuleCancel"
				>
					取消
				</button>
				<button
					class="mod-btn mod-btn-ghost mod-btn-warning"
					:disabled="moduleEditBusy"
					@click="handleModuleRollback"
				>
					{{ rolling ? "回滚中…" : "↩ 撤回" }}
				</button>
				<button
					class="mod-btn mod-btn-outline"
					:disabled="moduleEditBusy"
					@click="handleModuleSave"
				>
					{{ saving ? "保存中…" : "保存文案" }}
				</button>
			</div>
		</div>

		<!-- ── 普通对话输入区（默认） ── -->
		<div v-else class="input-area">
			<div class="input-box" :class="{ disabled: isSending }">
				<textarea
					ref="textareaRef"
					v-model="inputText"
					:placeholder="hasPrd ? '继续对话...' : '描述你的产品需求...'"
					:disabled="isSending"
					@keydown="onKeydown"
					@input="autoResize"
					rows="1"
					class="input-textarea"
				></textarea>
				<div class="input-actions">
					<button class="input-icon-btn" title="附件" :disabled="isSending">
						<svg viewBox="0 0 16 16" fill="none">
							<path
								d="M13.5 7.5l-6 6a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5"
								stroke="currentColor"
								stroke-width="1.3"
								stroke-linecap="round"
							/>
						</svg>
					</button>
					<div class="input-actions-right">
						<ModelSelector />
						<!-- 生成中：停止按钮 -->
						<StopGenerateButton
							v-if="isSending"
							:size="30"
							title="停止生成"
							@click="handleStop"
						/>
						<!-- 待发送：发送按钮 -->
						<button
							v-else
							class="btn-send"
							:disabled="!inputText.trim()"
							@click="handleSend"
						>
							<svg viewBox="0 0 16 16" fill="none">
								<path
									d="M8 12V4M4 8l4-4 4 4"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
					</div>
				</div>
			</div>
		</div>
	</aside>

	<!-- 历史会话抽屉（独立组件） -->
	<HistoryDrawer
		:open="historyOpen"
		:messages="messagesStore.messages"
		:current-session-title="currentSession?.title"
		@close="closeHistory"
		@scroll-to="scrollToMsg"
	/>

	<!-- 模块管理抽屉 -->
	<ModuleManager
		:visible="modulesOpen"
		mode="drawer"
		:initial-selected="currentSessionModuleIds"
		@confirm="onModulesConfirm"
		@cancel="closeModules"
	/>
</template>

<style lang="scss" scoped>
	.sidebar {
		flex-shrink: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--color-bg-primary);
		border-right: 1px solid var(--color-border);
		overflow: hidden;
		position: relative;
	}

	/* ── 拖拽调整宽度手柄 ── */
	.resize-handle {
		position: absolute;
		top: 0;
		right: -2px;
		width: 5px;
		height: 100%;
		cursor: col-resize;
		z-index: 20;

		&::after {
			content: "";
			position: absolute;
			top: 0;
			left: 50%;
			transform: translateX(-50%);
			width: 2px;
			height: 100%;
			background: transparent;
			transition: background 0.2s;
			border-radius: 2px;
		}

		&:hover::after {
			background: var(--color-primary);
			opacity: 0.45;
		}

		&.resizing::after {
			background: var(--color-primary);
			opacity: 0.7;
		}
	}

	/* ── Tabs ── */
	.tabs {
		display: flex;
		padding: 8px 14px 0;
		border-bottom: 1px solid var(--color-border);
	}
	.tab {
		padding: 6px 12px;
		font-size: 13px;
		border: none;
		background: transparent;
		cursor: pointer;
		color: var(--color-text-muted);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		white-space: nowrap;
		transition: all 0.15s;
		&:hover {
			color: var(--color-text-primary);
		}
		&.active {
			color: var(--color-primary);
			border-bottom-color: var(--color-primary);
			font-weight: 500;
		}
	}

	/* ── Progress ── */
	.progress-wrap {
		padding: 6px 14px;
		border-bottom: 1px solid var(--color-border);
	}

	/* ── Messages ── */
	.message-list {
		flex: 1;
		overflow-y: auto;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
	}

	.msg-row {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		&.user {
			flex-direction: row-reverse;
		}
	}
	.avatar {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-avatar);
		font-size: 11px;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		&.ai {
			background: var(--color-primary);
			color: #fff;
		}
		&.user {
			background: #e0e7ff;
			color: var(--color-primary);
		}
	}
	.assistant-msg-wrap {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: calc(100% - 44px);
		min-width: 0;
	}
	.bubble {
		max-width: 100%;
		padding: 10px 12px;
		border-radius: var(--radius-bubble);
		font-size: 13px;
		line-height: 1.6;
		word-break: break-word;
		&.assistant-bubble {
			background: var(--color-bg-primary);
			border: 1px solid var(--color-border);
			color: var(--color-text-primary);
			border-top-left-radius: 4px;
		}
		&.user-bubble {
			max-width: 260px;
			background: var(--color-primary);
			color: #fff;
			border-top-right-radius: 4px;
		}
	}
	.typing-inline {
		display: inline-flex;
		vertical-align: middle;
	}

	/* ── 操作气泡（对话中断 / PRD 中断）── */
	.action-bubble {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		background: #fefce8;
		border: 1px solid #fde047;
		border-radius: var(--radius-bubble, 12px);
		border-top-left-radius: 4px;
		font-size: 13px;
		max-width: 420px;
		&__icon {
			flex-shrink: 0;
			font-size: 15px;
		}
		&__text {
			flex: 1;
			color: #78350f;
			line-height: 1.4;
		}
		&__btn {
			flex-shrink: 0;
			padding: 5px 14px;
			font-size: 12px;
			font-weight: 600;
			color: #fff;
			background: var(--color-primary, #4f46e5);
			border: none;
			border-radius: 6px;
			cursor: pointer;
			white-space: nowrap;
			transition: opacity 0.15s;
			&:hover:not(:disabled) {
				opacity: 0.88;
			}
			&:disabled {
				opacity: 0.45;
				cursor: not-allowed;
			}
		}
	}
	.system-row {
		align-items: flex-start;
	}
	.action-bubble-fade-enter-active,
	.action-bubble-fade-leave-active {
		transition:
			opacity 0.2s,
			transform 0.2s;
	}
	.action-bubble-fade-enter-from,
	.action-bubble-fade-leave-to {
		opacity: 0;
		transform: translateY(6px);
	}

	:deep(.md-content) {
		p {
			margin: 0 0 6px;
		}
		p:last-child {
			margin-bottom: 0;
		}
		ul {
			margin: 4px 0;
			padding-left: 16px;
		}
		li {
			margin-bottom: 2px;
		}
		strong {
			font-weight: 600;
		}
		code {
			background: var(--color-bg-tertiary);
			padding: 1px 4px;
			border-radius: 3px;
			font-size: 12px;
		}
		pre {
			background: var(--color-bg-tertiary);
			padding: 8px;
			border-radius: 6px;
			overflow-x: auto;
			code {
				background: none;
				padding: 0;
			}
		}
	}

	/* ── Input ── */
	.input-area {
		position: relative;
		z-index: 10;
		padding: 12px 14px;
		border-top: 1px solid var(--color-border);
	}
	.input-box {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 10px 12px 8px;
		transition: border-color 0.15s;
		&:focus-within {
			border-color: var(--color-primary);
		}
		&.disabled {
			.input-textarea {
				opacity: 0.5;
			}
		}
	}
	.input-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.input-actions-right {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.input-icon-btn {
		width: 24px;
		height: 24px;
		border: none;
		background: transparent;
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		flex-shrink: 0;
		transition: color 0.15s;
		&:hover {
			color: var(--color-text-secondary);
		}
		svg {
			width: 15px;
			height: 15px;
		}
	}
	.input-textarea {
		width: 100%;
		border: none;
		background: transparent;
		outline: none;
		font-size: 13px;
		color: var(--color-text-primary);
		resize: none;
		font-family: var(--font-family);
		line-height: 1.5;
		min-height: 62px;
		max-height: 286px;
		overflow-y: auto;
		&::placeholder {
			color: var(--color-text-muted);
		}
		scrollbar-width: none;
		&::-webkit-scrollbar {
			display: none;
		}
	}
	.btn-send {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: var(--color-primary);
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
		flex-shrink: 0;
		transition: background 0.15s;
		&:hover:not(:disabled) {
			background: var(--color-primary-hover);
		}
		&:disabled {
			background: var(--color-text-muted);
			cursor: not-allowed;
		}
		svg {
			width: 14px;
			height: 14px;
		}
	}
	.welcome-msg {
		width: 100%;
	}

	/* ── 模块编辑控制区 ── */
	.module-edit-area {
		background: #eef2ff;
		border-top: 2px solid var(--color-primary);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.module-edit-context {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: var(--color-text-secondary);

		.module-edit-icon {
			font-size: 13px;
			flex-shrink: 0;
		}

		.module-edit-label {
			flex-shrink: 0;
		}

		.module-edit-title {
			font-weight: 600;
			color: var(--color-primary);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.module-edit-actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
	}

	.mod-btn {
		height: 28px;
		padding: 0 10px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		border: none;
		transition: all 0.15s;
		display: inline-flex;
		align-items: center;

		&:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
	}

	.mod-btn-ghost {
		background: transparent;
		color: #64748b;

		&:not(:disabled):hover {
			background: rgba(79, 70, 229, 0.08);
		}
	}

	.mod-btn-warning {
		color: #b45309;

		&:not(:disabled):hover {
			color: #92400e;
			background: rgba(180, 83, 9, 0.08);
		}
	}

	.mod-btn-outline {
		background: #fff;
		border: 1.5px solid var(--color-primary);
		color: var(--color-primary);

		&:not(:disabled):hover {
			background: #eef2ff;
		}
	}

	.btn-rewrite {
		height: 30px;
		padding: 0 12px;
		border-radius: 15px;
		background: var(--color-primary);
		border: none;
		cursor: pointer;
		color: #fff;
		font-size: 12px;
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;

		&:hover:not(:disabled) {
			background: var(--color-primary-hover);
		}

		&:disabled {
			background: var(--color-text-muted);
			cursor: not-allowed;
		}
	}

	.module-spinner {
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: #fff;
		border-radius: 50%;
		animation: module-spin 0.7s linear infinite;
	}

	@keyframes module-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
