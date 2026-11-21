<script setup lang="ts">
	import { computed, onMounted, onUnmounted, ref } from "vue";
	import { useI18n } from "@open-pencil/vue";
	import {
		aiModelSettings,
		isACPModelProfile,
		isPrdSupportedProvider,
		modelConnection,
		resolveAIModelRole,
		setModelRoleAssignment,
		type AIModelProfile,
	} from "@/app/ai/models";
	import { openSettingsDialog } from "@/app/settings/dialog";

	const { editor: t } = useI18n();
	const open = ref(false);
	const rootRef = ref<HTMLElement | null>(null);

	const prdModels = computed(() =>
		aiModelSettings.value.models.filter((profile) => {
			if (isACPModelProfile(profile)) return false;
			const connection = modelConnection(profile.connectionId);
			return connection
				? isPrdSupportedProvider(connection.providerID)
				: false;
		}),
	);

	const selected = computed(
		() => resolveAIModelRole("prd")?.profile ?? null,
	);

	function displayName(profile: AIModelProfile): string {
		return (
			profile.name.trim() ||
			profile.customModelID.trim() ||
			profile.modelID ||
			t.value.unnamedModel
		);
	}

	const selectedName = computed(() =>
		selected.value ? displayName(selected.value) : t.value.selectModel,
	);

	function isSelected(profile: AIModelProfile): boolean {
		return selected.value?.id === profile.id;
	}

	function toggle(): void {
		open.value = !open.value;
	}

	function selectModel(profile: AIModelProfile): void {
		setModelRoleAssignment("prd", profile.id);
		open.value = false;
	}

	function openAddModel(): void {
		open.value = false;
		openSettingsDialog("ai");
	}

	function onDocPointerDown(event: PointerEvent): void {
		if (!rootRef.value?.contains(event.target as Node)) {
			open.value = false;
		}
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") open.value = false;
	}

	onMounted(() => {
		document.addEventListener("pointerdown", onDocPointerDown);
		document.addEventListener("keydown", onKeydown);
	});

	onUnmounted(() => {
		document.removeEventListener("pointerdown", onDocPointerDown);
		document.removeEventListener("keydown", onKeydown);
	});
</script>

<template>
	<div ref="rootRef" class="model-selector">
		<button
			type="button"
			class="model-selector__trigger"
			:class="{ open }"
			:title="selectedName"
			aria-haspopup="listbox"
			:aria-expanded="open"
			@click="toggle"
		>
			<span class="model-selector__name">{{ selectedName }}</span>
			<svg
				class="model-selector__chevron"
				viewBox="0 0 16 16"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M4 6l4 4 4-4"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>

		<div v-if="open" class="model-selector__menu" role="listbox">
			<div class="model-selector__list">
				<button
					v-for="profile in prdModels"
					:key="profile.id"
					type="button"
					class="model-selector__item"
					:class="{ selected: isSelected(profile) }"
					role="option"
					:aria-selected="isSelected(profile)"
					@click="selectModel(profile)"
				>
					<span class="model-selector__item-name">{{
						displayName(profile)
					}}</span>
					<svg
						v-if="isSelected(profile)"
						class="model-selector__check"
						viewBox="0 0 16 16"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M3.5 8.5l3 3 6-6"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
				<div v-if="prdModels.length === 0" class="model-selector__empty">
					{{ t.noModels }}
				</div>
			</div>

			<div class="model-selector__footer">
				<button
					type="button"
					class="model-selector__add"
					@click="openAddModel"
				>
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<circle
							cx="12"
							cy="12"
							r="3"
							stroke="currentColor"
							stroke-width="1.5"
						/>
				</svg>
				{{ t.addModel }}
			</button>
			</div>
		</div>
	</div>
</template>

<style lang="scss" scoped>
	.model-selector {
		position: relative;
		min-width: 0;
		flex-shrink: 1;
	}

	.model-selector__trigger {
		display: flex;
		align-items: center;
		gap: 4px;
		max-width: 168px;
		padding: 4px 8px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-primary);
		cursor: pointer;
		font-family: inherit;
		font-size: 13px;
		line-height: 1.3;
		transition: background 0.15s;

		&:hover,
		&.open {
			background: var(--color-bg-tertiary);
		}
	}

	.model-selector__name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}

	.model-selector__chevron {
		width: 12px;
		height: 12px;
		flex-shrink: 0;
		color: var(--color-text-muted);
		transition: transform 0.15s;

		.open & {
			transform: rotate(180deg);
		}
	}

	.model-selector__menu {
		position: absolute;
		right: 0;
		bottom: calc(100% + 6px);
		z-index: 40;
		display: flex;
		flex-direction: column;
		min-width: 220px;
		max-width: min(280px, calc(100vw - 32px));
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow:
			0 10px 24px rgba(15, 23, 42, 0.12),
			0 1px 3px rgba(0, 0, 0, 0.08);
		overflow: hidden;
	}

	.model-selector__list {
		max-height: 240px;
		overflow-y: auto;
		padding: 6px;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
	}

	.model-selector__item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 10px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-primary);
		cursor: pointer;
		font-family: inherit;
		font-size: 13px;
		text-align: left;
		transition: background 0.15s;

		&:hover {
			background: var(--color-bg-secondary);
		}

		&.selected {
			background: var(--color-bg-secondary);
		}
	}

	.model-selector__item-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.model-selector__check {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		color: var(--color-primary);
	}

	.model-selector__empty {
		padding: 12px 10px;
		font-size: 12px;
		color: var(--color-text-muted);
		text-align: center;
	}

	.model-selector__footer {
		border-top: 1px solid var(--color-border);
		padding: 4px 6px 6px;
	}

	.model-selector__add {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 10px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-primary);
		cursor: pointer;
		font-family: inherit;
		font-size: 13px;
		font-weight: 500;
		text-align: left;
		transition: background 0.15s;

		&:hover {
			background: var(--color-bg-secondary);
		}

		svg {
			width: 15px;
			height: 15px;
			flex-shrink: 0;
			color: var(--color-text-secondary);
		}
	}
</style>
