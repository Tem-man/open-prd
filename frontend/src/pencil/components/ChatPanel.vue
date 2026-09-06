<script setup lang="ts">
	import {
		ScrollAreaRoot,
		ScrollAreaScrollbar,
		ScrollAreaThumb,
		ScrollAreaViewport,
	} from "reka-ui";
	import { refAutoReset } from "@vueuse/core";
	import { computed, markRaw, nextTick, ref, watch } from "vue";

	import { isReasoningUIPart, isTextUIPart, isToolUIPart } from "ai";

	import { copyChatLog } from "@/app/ai/debug";
	import { prdBasis } from "@/app/ai/prdContext";
	import { clearToolLogEntries, didHitStepLimit } from "@/app/ai/tools";
	import { activeTab } from "@/app/tabs";
	import ChatInput from "@/components/chat/ChatInput.vue";
	import ChatMessage from "@/components/chat/ChatMessage.vue";
	import AppPlaceholder from "@/components/ui/AppPlaceholder.vue";
	import AppTextButton from "@/components/ui/AppTextButton.vue";
	import ProviderSetup from "@/components/chat/ProviderSetup.vue";
	import { useAIChat } from "@/app/ai/chat/use";
	import { toast } from "@/app/shell/ui";
	import { useI18n } from "@open-pencil/vue";

	import type { Chat } from "@ai-sdk/vue";
	import type { UIMessage } from "ai";

	const IS_DEV = import.meta.env.DEV;

	const { isConfigured, ensureChat, resetChat } = useAIChat();
	const { dialogs } = useI18n();

	const chat = ref<Chat<UIMessage> | null>(null);

	void ensureChat()
		.then((c) => {
			if (c) chat.value = markRaw(c);
			return undefined;
		})
		.catch((error: unknown) => {
			toast.error(
				error instanceof Error ? error.message : "Failed to initialize chat",
			);
		});
	const messagesEnd = ref<HTMLDivElement>();
	const debugCopied = refAutoReset(false, 1500);

	const messages = computed(() => chat.value?.messages ?? []);
	const status = computed(() => chat.value?.status ?? "ready");
	const isThinking = computed(() => {
		const s = status.value;
		if (s !== "submitted" && s !== "streaming") return false;
		if (messages.value.length === 0) return true;
		const last = messages.value[messages.value.length - 1];
		if (last.role !== "assistant") return true;
		const parts = last.parts;
		if (parts.length === 0) return true;
		// ChatMessage renders tool, reasoning and text parts with their own progress state, so
		// the indicator only fills the gaps they leave: step boundaries, parts with no content
		// yet, and part types the message body does not render.
		const lastPart = parts[parts.length - 1];
		if (isToolUIPart(lastPart)) return false;
		if (isReasoningUIPart(lastPart) || isTextUIPart(lastPart))
			return !lastPart.text;
		return true;
	});

	const showContinue = computed(() => {
		if (status.value !== "ready") return false;
		if (messages.value.length === 0) return false;
		const last = messages.value[messages.value.length - 1];
		return last.role === "assistant" && didHitStepLimit();
	});

	function scrollToBottom() {
		nextTick(() => {
			messagesEnd.value?.scrollIntoView({ behavior: "smooth", block: "end" });
		});
	}

	watch(messages, scrollToBottom, { deep: true });
	watch(
		() => chat.value?.error,
		(error) => {
			if (error) toast.error(error.message);
		},
	);
	watch(
		() => activeTab.value?.id,
		async () => {
			const nextChat = await ensureChat();
			chat.value = nextChat ? markRaw(nextChat) : null;
		},
	);

	async function handleSubmit(text: string) {
		if (status.value === "streaming" || status.value === "submitted") return;
		try {
			const c = await ensureChat();
			if (c) chat.value = markRaw(c);
		} catch (e) {
			console.error("Failed to initialize chat:", e);
			toast.error(e instanceof Error ? e.message : String(e));
			return;
		}
		chat.value?.sendMessage({ text }).catch((e: unknown) => {
			console.error("Chat error:", e);
			toast.error(e instanceof Error ? e.message : String(e));
		});
	}

	// ── 一键生成原型：关联 PRD 依据时免输入触发设计代理 ──────────────────────────
	const isBusy = computed(
		() => status.value === "streaming" || status.value === "submitted",
	);

	const PRD_BASIS_PROMPT = `请根据已注入的 PRD「原型设计依据」生成原型稿：
1. 按「页面清单」为每个 P0 页面创建一个独立画板，画板名称与依据中的页面名称保持一致；
2. 每个画板严格按「页面详情」中的布局结构与关键组件绘制；
3. 配色、字体、圆角等视觉规范严格遵循「设计规范」中给出的具体值；
4. 全部页面完成后，简要说明各页面之间的跳转关系。`;

	function generateFromPrdBasis() {
		if (isBusy.value) return;
		handleSubmit(PRD_BASIS_PROMPT);
	}

	function handleStop() {
		chat.value?.stop();
	}

	async function handleCopyDebug() {
		await copyChatLog(messages.value);
		debugCopied.value = true;
	}

	function handleClearChat() {
		chat.value = null;
		resetChat();
		clearToolLogEntries();
	}
</script>

<template>
	<div
		data-test-id="chat-panel"
		class="flex min-w-0 flex-1 flex-col overflow-hidden select-text"
	>
		<ProviderSetup v-if="!isConfigured" />

		<template v-else>
			<!-- PRD 依据关联徽标：原型关联了 PRD 会话且依据已加载时显示 -->
			<div
				v-if="prdBasis"
				data-test-id="prd-basis-badge"
				class="mx-3 mt-2 flex shrink-0 items-center gap-1.5 rounded-md bg-accent/10 px-2.5 py-1.5 text-xs text-accent"
				title="AI 生成原型时将遵循 PRD「原型设计依据」中的页面清单、结构与设计规范"
			>
				<icon-lucide-file-text class="size-3.5 shrink-0" />
				<span class="truncate">已关联 PRD「原型设计依据」</span>
				<button
					v-if="messages.length > 0"
					type="button"
					class="ml-auto shrink-0 rounded-full px-2 py-0.5 font-medium transition-colors hover:bg-accent/20 disabled:opacity-50"
					:disabled="isBusy"
					@click="generateFromPrdBasis"
				>
					重新生成
				</button>
			</div>
			<ScrollAreaRoot class="min-h-0 flex-1">
				<ScrollAreaViewport class="h-full px-3 py-3 [&>div]:h-full">
					<!-- 已关联 PRD 依据的空状态：一键生成原型稿 -->
					<div
						v-if="messages.length === 0 && prdBasis"
						data-test-id="chat-prd-basis-cta"
						class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
					>
						<icon-lucide-sparkles class="size-6 text-accent" />
						<p class="text-sm text-foreground">PRD「原型设计依据」已就绪</p>
						<button
							type="button"
							class="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
							:disabled="isBusy"
							@click="generateFromPrdBasis"
						>
							<icon-lucide-play class="size-3" />
							{{ isBusy ? "正在生成…" : "一键生成原型稿" }}
						</button>
						<p class="text-xs text-muted">
							也可以在下方输入框直接描述你想要的页面或调整
						</p>
					</div>

					<AppPlaceholder
						v-else-if="messages.length === 0"
						data-test-id="chat-empty-state"
						:label="dialogs.describeCreateOrChange"
						:ui="{ root: 'h-full' }"
					>
						<template #icon>
							<icon-lucide-message-circle class="size-5" />
						</template>
					</AppPlaceholder>

					<!-- Messages -->
					<div v-else data-test-id="chat-messages" class="flex flex-col gap-3">
						<ChatMessage v-for="msg in messages" :key="msg.id" :message="msg" />

						<!-- Thinking indicator: shown when AI is working but no visible activity -->
						<div
							v-if="isThinking"
							data-test-id="chat-typing-indicator"
							class="flex gap-2"
						>
							<div
								class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/20 text-[10px] font-bold text-muted"
							>
								AI
							</div>
							<div class="flex items-center gap-1 py-2">
								<span
									class="size-1.5 animate-bounce rounded-full bg-muted"
									style="animation-delay: 0ms"
								/>
								<span
									class="size-1.5 animate-bounce rounded-full bg-muted"
									style="animation-delay: 150ms"
								/>
								<span
									class="size-1.5 animate-bounce rounded-full bg-muted"
									style="animation-delay: 300ms"
								/>
							</div>
						</div>

						<!-- Continue button when step limit reached -->
						<div v-if="showContinue" class="flex justify-center py-2">
							<button
								class="flex items-center gap-1.5 rounded-full bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
								@click="handleSubmit('Continue where you left off')"
							>
								<icon-lucide-play class="size-3" />
								Continue
							</button>
						</div>

						<div ref="messagesEnd" />
					</div>
				</ScrollAreaViewport>
				<ScrollAreaScrollbar
					orientation="vertical"
					class="flex w-1.5 touch-none p-px select-none"
				>
					<ScrollAreaThumb class="relative flex-1 rounded-full bg-muted/30" />
				</ScrollAreaScrollbar>
			</ScrollAreaRoot>

			<!-- Chat toolbar -->
			<div
				v-if="messages.length > 0"
				class="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1"
			>
				<AppTextButton
					v-if="IS_DEV"
					:ui="{
						base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover',
					}"
					@click="handleCopyDebug"
				>
					<icon-lucide-clipboard-copy v-if="!debugCopied" class="size-3" />
					<icon-lucide-check v-else class="size-3 text-green-400" />
					{{ debugCopied ? "Copied" : "Copy log" }}
				</AppTextButton>
				<AppTextButton
					:ui="{
						base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover',
					}"
					@click="handleClearChat"
				>
					<icon-lucide-trash-2 class="size-3" />
					Clear
				</AppTextButton>
			</div>

			<ChatInput :status="status" @submit="handleSubmit" @stop="handleStop" />
		</template>
	</div>
</template>
