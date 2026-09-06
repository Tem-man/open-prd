<script setup lang="ts">
	import { TooltipProvider } from "reka-ui";
	import { computed, nextTick, ref } from "vue";

	import ProviderModelSelect from "@/components/chat/ProviderModelSelect.vue";
	import Tip from "@/components/ui/Tip.vue";
	import { useButtonUI } from "@/components/ui/button";
	import { useAIChat } from "@/app/ai/chat/use";
	import { openSettingsDialog } from "@/app/settings/dialog";
	import { useI18n } from "@open-pencil/vue";
	import StopGenerateButton from "../../../components/StopGenerateButton.vue";

	const { providerID, providerDef, modelID, customModelID } = useAIChat();
	const { dialogs } = useI18n();

	const { status } = defineProps<{
		status: "ready" | "submitted" | "streaming" | "error";
	}>();

	const emit = defineEmits<{
		submit: [text: string];
		stop: [];
	}>();

	const input = ref("");
	const textareaRef = ref<HTMLTextAreaElement | null>(null);

	const isStreaming = computed(
		() => status === "streaming" || status === "submitted",
	);
	const isCustomProvider = computed(
		() =>
			providerID.value === "openai-compatible" ||
			providerID.value === "anthropic-compatible",
	);
	const sendButton = useButtonUI({
		tone: "accent",
		shape: "pill",
		size: "iconSm",
		ui: {
			base: "pointer-events-auto absolute right-2 bottom-2 size-6 disabled:bg-muted disabled:opacity-60",
		},
	});
	const customModelName = computed(() => customModelID.value.trim());
	const usesCustomModel = computed(
		() => !!providerDef.value.supportsCustomModel && !!customModelName.value,
	);

	const selectedModelName = computed(() => {
		if (usesCustomModel.value) return customModelName.value;
		if (isCustomProvider.value) return "No model";
		return (
			providerDef.value.models.find((m) => m.id === modelID.value)?.name ??
			modelID.value
		);
	});

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

	function handleSubmit(e: Event) {
		e.preventDefault();
		const text = input.value.trim();
		if (!text) return;
		emit("submit", text);
		input.value = "";
		void nextTick(() => {
			resetTextareaHeight();
		});
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit(e);
		}
	}
</script>

<template>
	<TooltipProvider>
		<div class="shrink-0 border-t border-border px-3 py-2">
			<!-- Model selector & settings -->
			<div class="mb-1.5 flex items-center gap-1">
				<template v-if="isCustomProvider || usesCustomModel">
					<div
						class="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted"
						data-test-id="chat-custom-model-label"
					>
						<icon-lucide-bot class="size-3" />
						{{ selectedModelName }}
					</div>
				</template>
				<ProviderModelSelect v-else>
					<template #value>{{ selectedModelName }}</template>
				</ProviderModelSelect>

				<div class="ml-auto">
					<Tip :label="dialogs.providerSettings">
						<button
							type="button"
							data-test-id="provider-settings-trigger"
							:aria-label="dialogs.providerSettings"
							class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
							@click="openSettingsDialog('ai')"
						>
							<icon-lucide-settings class="size-3" />
						</button>
					</Tip>
				</div>
			</div>

			<!-- Input form -->
			<form class="relative" @submit="handleSubmit">
				<textarea
					ref="textareaRef"
					v-model="input"
					data-test-id="chat-input"
					rows="1"
					:placeholder="dialogs.describeChange"
					class="scrollbar-pill block min-h-[62px] max-h-[286px] w-full resize-none overflow-y-auto rounded border border-transparent bg-panel-field px-2 pb-8 pt-1.5 pr-9 text-[11px] leading-normal text-surface outline-none placeholder:text-muted hover:bg-panel-field-hover focus:border-panel-focus focus:bg-panel-field-hover disabled:cursor-not-allowed disabled:text-muted disabled:opacity-60"
					:disabled="isStreaming"
					@input="autoResize"
					@keydown="onKeydown"
					@paste.stop
					@copy.stop
					@cut.stop
				/>
				<div class="pointer-events-none absolute inset-0">
					<Tip v-if="isStreaming" :label="dialogs.stopGenerating">
						<StopGenerateButton
							class="pointer-events-auto absolute right-2 bottom-2"
							data-test-id="chat-stop-button"
							:size="24"
							@click="emit('stop')"
						/>
					</Tip>
					<Tip v-else :label="dialogs.sendMessage">
						<button
							type="submit"
							data-test-id="chat-send-button"
							:class="sendButton.base"
							:disabled="!input.trim()"
						>
							<icon-lucide-arrow-up class="size-3" />
						</button>
					</Tip>
				</div>
			</form>
		</div>
	</TooltipProvider>
</template>
