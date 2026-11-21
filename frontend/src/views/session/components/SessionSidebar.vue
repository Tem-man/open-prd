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
	import { useI18n } from "@open-pencil/vue";
	import { useMessagesStore } from "@/stores/messages";
	import { useSessionsStore } from "@/stores/sessions";
	import { usePrdEditStore } from "@/stores/prdEdit";
	import { usePrototypesStore } from "@/stores/prototypes";
	import { useSSE, type ComposerTarget } from "@/composables/useSSE";
	import { useSectionActions } from "@/composables/useSectionActions";
	import TypingIndicator from "@/components/TypingIndicator.vue";
	import HistoryDrawer from "@/components/HistoryDrawer.vue";
	import ModuleManager from "@/components/ModuleManager.vue";
	import QuestionForm from "@/components/QuestionForm.vue";
	import ThinkingBlock from "@/components/ThinkingBlock.vue";
	import StopGenerateButton from "@/components/StopGenerateButton.vue";
	import ModelSelector from "@/components/ModelSelector.vue";
	import { CONFIRM_DECISIONS, type Message, type MessageEdit } from "@/types";

	const props = defineProps<{ sessionId: string }>();

	const { session: t } = useI18n();
	const messagesStore = useMessagesStore();
	const sessionsStore = useSessionsStore();
	const prdEditStore = usePrdEditStore();
	const prototypesStore = usePrototypesStore();
	const { sendMessage, retrySession, stopGeneration } = useSSE();
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
	const isStreaming = computed(() =>
		messagesStore.messages.some((m) => m.isStreaming),
	);
	const inputBusy = computed(() => isSending.value || isStreaming.value);

	// 选中模块后输入框出现 chip，AI 修改走对话
	const composerTarget = computed<ComposerTarget | null>(() =>
		prdEditStore.editingSection
			? {
					sectionId: prdEditStore.editingSection,
					sectionTitle: editingSectionTitle.value ?? undefined,
				}
			: null,
	);

	const inputPlaceholder = computed(() => {
		if (composerTarget.value) {
			return t.value.composerTarget({
				section: composerTarget.value.sectionTitle ?? t.value.defaultSection,
			});
		}
		return hasPrd.value ? t.value.composerContinue : t.value.composerDefault;
	});

	async function handleModuleSave() {
		if (moduleEditBusy.value || !prdEditStore.editingSection) return;
		await saveSection(props.sessionId, prdEditStore.editingSection, () =>
			prdEditStore.getHtml(),
		);
	}

	function handleModuleCancel() {
		prdEditStore.cancelEdit();
	}

	function citationLabel(msg: Message): string {
		const c = msg.meta?.citation;
		if (!c) return "";
		const title = c.sectionTitle ?? c.sectionId;
		return c.elementLabel ? `${title} · ${c.elementLabel}` : title;
	}

	function editLabel(edit: MessageEdit): string {
		return edit.elementLabel
			? `${edit.sectionTitle} · ${edit.elementLabel}`
			: edit.sectionTitle;
	}

	/** 只有模块仍停在这次编辑产生的版本时才能撤回，避免覆盖之后的修改 */
	function canUndo(edit: MessageEdit): boolean {
		if (edit.rolledBack) return false;
		const sec = prdEditStore.sections.find(
			(s) => s.sectionId === edit.sectionId,
		);
		return !!sec && sec.version === edit.resultVersion;
	}

	async function handleUndoEdit(msg: Message, edit: MessageEdit) {
		if (!canUndo(edit) || rolling.value || inputBusy.value) return;
		try {
			await rollbackSection(props.sessionId, edit.sectionId, msg.id);
			messagesStore.markEditRolledBack(
				msg.id,
				edit.sectionId,
				edit.resultVersion,
			);
		} catch (e) {
			console.error("[SessionSidebar] rollback failed:", e);
		}
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
			const title = `${currentSession.value?.title || t.value.untitled} - ${t.value.prototypeSuffix}`;
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
		if (!text || inputBusy.value) return;
		inputText.value = "";
		nextTick(resetTextareaHeight);
		isSending.value = true;
		try {
			await sendMessage(props.sessionId, text, {
				target: composerTarget.value ?? undefined,
			});
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
				return t.value.regen;
			case "continue_agent":
				return t.value.continueChat;
			case "continue_prd":
				return t.value.continuePrd;
			case "retry_section":
				return t.value.retryFailed;
			default:
				return t.value.continueAction;
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

	async function handleFormSubmit(
		msgId: string,
		answersText: string,
		answers: Record<string, string | string[]>,
	) {
		// 标记表单已提交（禁用该表单）
		messagesStore.markFormSubmitted(msgId);
		const form = messagesStore.messages.find((m) => m.id === msgId)?.formData;
		const action = form?.action;
		// 确认卡片：按选项下标映射决策，凭 token 让后端直接执行
		const question = form?.questions[0];
		const choice = question ? answers[question.id] : undefined;
		const decisionIdx =
			typeof choice === "string"
				? (question?.options ?? []).indexOf(choice)
				: -1;
		const decision =
			decisionIdx >= 0 ? CONFIRM_DECISIONS[decisionIdx] : undefined;
		inputText.value = "";
		isSending.value = true;
		try {
			if (action && decision) {
				await sendMessage(
					props.sessionId,
					typeof choice === "string" ? choice : answersText,
					{
						confirmAction: { token: action.token, decision },
					},
				);
			} else {
				await sendMessage(props.sessionId, answersText, { isFormAnswer: true });
			}
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
				{{ t.tabConversation }}
			</button>
			<button
				class="tab"
				:class="{ active: activeTab === 'modules' }"
				@click="openModules"
			>
				{{ t.tabModules }}
			</button>
			<button
				class="tab"
				:class="{ active: activeTab === 'history' }"
				@click="openHistory"
			>
				{{ t.tabHistory }}
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
							{{ t.welcomeGreeting }}
							<strong>{{ t.welcomeAssistant }}</strong
							>{{ t.welcomeIntro }}
						</p>
						<p>{{ t.welcomePrompt }}</p>
						<ul>
							<li>{{ t.welcomeExample1 }}</li>
							<li>{{ t.welcomeExample2 }}</li>
							<li>{{ t.welcomeExample3 }}</li>
							<li>{{ t.welcomeExample4 }}</li>
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
							msg.isStreaming && !stripFormBlock(msg.content) && !msg.thinking
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
						<span class="action-bubble__text">{{ t.interrupted }}</span>
						<button
							type="button"
							class="action-bubble__btn"
							:disabled="isSending"
							@click="handleRetryFromBubble(msg.id)"
						>
							{{
								msg.content.trim().length > 20 ? t.continueGenerating : t.regen
							}}
						</button>
					</div>
					<!-- 结构化提问表单 -->
					<QuestionForm
						v-if="msg.formData"
						:form="msg.formData"
						:default-answers="msg.formAnswers"
						:disabled="msg.formSubmitted || isSending"
						@submit="(text, answers) => handleFormSubmit(msg.id, text, answers)"
					/>
					<!-- 对话式编辑的改动记录 + 撤回 -->
					<div
						v-if="msg.meta?.edits?.length && !msg.isStreaming"
						class="edit-record"
					>
						<div
							v-for="edit in msg.meta.edits"
							:key="`${edit.sectionId}-${edit.resultVersion}`"
							class="edit-record__row"
						>
							<span class="cite-chip"># {{ editLabel(edit) }}</span>
							<span class="edit-record__version"
								>v{{ edit.resultVersion }}</span
							>
							<span v-if="edit.rolledBack" class="edit-record__state">{{
								t.rolledBack
							}}</span>
							<button
								v-else
								type="button"
								class="edit-record__undo"
								:disabled="!canUndo(edit) || rolling || inputBusy"
								:title="canUndo(edit) ? t.undoEdit : t.cannotUndo"
								@click="handleUndoEdit(msg, edit)"
							>
								<icon-lucide-undo-2 />
								{{ rolling ? t.undoing : t.undo }}
							</button>
						</div>
					</div>
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
							{{ isCreatingPrototype ? t.creatingPrototype : msg.action.label }}
						</button>
					</div>
				</div>
				<div v-else-if="msg.role === 'user'" class="bubble user-bubble">
					<span v-if="msg.meta?.citation" class="cite-chip cite-chip--user"
						># {{ citationLabel(msg) }}</span
					>
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
									t.generateInterrupted
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

		<!-- ── 对话输入区（选中模块时带 chip，AI 修改同样走对话） ── -->
		<div class="input-area">
			<div v-if="isModuleEditing" class="module-edit-actions">
				<span class="module-edit-hint">{{ t.editHint }}</span>
				<button
					class="mod-btn mod-btn-outline"
					:disabled="moduleEditBusy"
					@click="handleModuleSave"
				>
					{{ saving ? t.saving : t.saveDraft }}
				</button>
			</div>
			<div class="input-box" :class="{ disabled: inputBusy }">
				<div v-if="composerTarget" class="composer-chips">
					<span class="cite-chip">
						# {{ composerTarget.sectionTitle ?? composerTarget.sectionId }}
						<button
							type="button"
							class="cite-chip__close"
							:title="t.cancelReference"
							:disabled="moduleEditBusy"
							@click="handleModuleCancel"
						>
							<icon-lucide-x />
						</button>
					</span>
				</div>
				<textarea
					ref="textareaRef"
					v-model="inputText"
					:placeholder="inputPlaceholder"
					:disabled="inputBusy"
					@keydown="onKeydown"
					@input="autoResize"
					rows="1"
					class="input-textarea"
				></textarea>
				<div class="input-actions">
					<button
						class="input-icon-btn"
						:title="t.attachment"
						:disabled="isSending"
					>
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
							v-if="inputBusy"
							:size="30"
							:title="t.stopGenerating"
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
	.module-edit-hint {
		flex: 1;
		font-size: 12px;
		color: var(--color-text-muted);
		align-self: center;
	}

	.composer-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.cite-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		padding: 2px 8px;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-primary);
		background: #eef2ff;
		border-radius: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;

		&--user {
			display: flex;
			width: fit-content;
			margin-bottom: 4px;
		}

		&__close {
			display: inline-flex;
			padding: 0;
			border: none;
			background: transparent;
			color: inherit;
			cursor: pointer;
			opacity: 0.7;

			&:hover:not(:disabled) {
				opacity: 1;
			}
		}
	}

	.edit-record {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 6px;
		padding: 6px 10px;
		background: var(--color-bg-secondary, #f8fafc);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		max-width: 420px;

		&__row {
			display: flex;
			align-items: center;
			gap: 8px;
			font-size: 12px;
		}

		&__version {
			flex: 1;
			color: var(--color-text-muted);
		}

		&__state {
			color: var(--color-text-muted);
		}

		&__undo {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			padding: 2px 8px;
			font-size: 12px;
			color: #b45309;
			background: transparent;
			border: none;
			border-radius: 6px;
			cursor: pointer;

			&:hover:not(:disabled) {
				background: rgba(180, 83, 9, 0.08);
			}

			&:disabled {
				opacity: 0.45;
				cursor: not-allowed;
			}
		}
	}

	.module-edit-actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
		margin-bottom: 8px;
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

	.mod-btn-outline {
		background: #fff;
		border: 1.5px solid var(--color-primary);
		color: var(--color-primary);

		&:not(:disabled):hover {
			background: #eef2ff;
		}
	}
</style>
