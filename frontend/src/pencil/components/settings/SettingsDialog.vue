<script setup lang="ts">
	import { DialogClose } from "reka-ui";
	import { computed } from "vue";
	import { useI18n } from "@open-pencil/vue";
	import { IS_TAURI } from "@open-pencil/core/constants";

	import { useAIChat } from "@/app/ai/chat/use";
	import { appCredentialServices } from "@/app/settings/credentials/app";
	import {
		settingsDialogOpen,
		settingsDialogSection,
	} from "@/app/settings/dialog";
	import ModelsPanel from "@/components/settings/models/ModelsPanel.vue";
	import StockPhotoKeysSection from "@/components/settings/provider/StockPhotoKeysSection.vue";
	import VectorizeSettingsSection from "@/components/settings/vectorize/VectorizeSettingsSection.vue";
	import AppSwitch from "@/components/ui/AppSwitch.vue";
	import {
		AppDialogFooter,
		AppDialogHeader,
		AppDialogRoot,
	} from "@/components/ui/dialog";

	const { dialogs, locale, setLocale } = useI18n();
	const { browserCredentialsRemembered, setRememberCredentials } = useAIChat();
	function onOpenChange(open: boolean): void {
		settingsDialogOpen.value = open;
	}

	// 应用界面只提供简体中文与英文；底层编辑器仍保留其他语言能力。
	const UI_LOCALES = [
		{ code: "en", label: "English" },
		{ code: "zh-CN", label: "中文（简体）" },
	] as const;
	const appLocale = computed({
		get: () => {
			const current = locale.value;
			return current === "zh-CN" ? "zh-CN" : "en";
		},
		set: (code: "en" | "zh-CN") => setLocale(code),
	});

	const rememberCredentials = computed({
		get: () => browserCredentialsRemembered.value,
		set: (remembered: boolean) => {
			void setRememberCredentials(remembered);
		},
	});

	const credentialBackendLabel = computed(() => {
		void browserCredentialsRemembered.value;
		if (appCredentialServices.manager.backend === "native")
			return dialogs.value.credentialBackendNative;
		if (appCredentialServices.manager.backend === "browser") {
			return dialogs.value.credentialBackendBrowser;
		}
		return dialogs.value.credentialBackendMemory;
	});

	const navigationClass =
		"flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-hover hover:text-surface data-[state=active]:bg-hover data-[state=active]:text-surface";
</script>

<template>
	<AppDialogRoot
		:open="settingsDialogOpen"
		size="lg"
		height="tall"
		data-test-id="app-settings-dialog"
		@update:open="onOpenChange"
	>
		<AppDialogHeader
			:heading="dialogs.settings"
			:description="dialogs.settingsDescription"
			:close-label="dialogs.close"
		/>

		<div class="flex min-h-0 flex-1">
			<nav
				class="w-40 shrink-0 border-r border-border p-2"
				:aria-label="dialogs.settings"
			>
				<button
					type="button"
					:class="navigationClass"
					:data-state="settingsDialogSection === 'general' ? 'active' : 'inactive'"
					data-test-id="settings-section-general"
					@click="settingsDialogSection = 'general'"
				>
					<icon-lucide-settings-2 class="size-3.5" />
					{{ dialogs.settingsGeneral }}
				</button>
				<button
					type="button"
					:class="navigationClass"
					:data-state="settingsDialogSection === 'ai' ? 'active' : 'inactive'"
					data-test-id="settings-section-ai"
					@click="settingsDialogSection = 'ai'"
				>
					<icon-lucide-sparkles class="size-3.5" />
					{{ dialogs.settingsAIAndAgents }}
				</button>
				<button
					type="button"
					:class="navigationClass"
					:data-state="
						settingsDialogSection === 'media' ? 'active' : 'inactive'
					"
					data-test-id="settings-section-media"
					@click="settingsDialogSection = 'media'"
				>
					<icon-lucide-image class="size-3.5" />
					{{ dialogs.settingsMedia }}
				</button>
			</nav>

			<div class="min-h-0 flex-1 overflow-y-auto p-4">
				<section
					v-if="settingsDialogSection === 'general'"
					class="flex flex-col gap-3"
					data-test-id="settings-general-panel"
				>
					<h3 class="text-xs font-semibold text-surface">
						{{ dialogs.settingsGeneral }}
					</h3>
					<div class="flex flex-col gap-1.5">
						<p class="text-[11px] font-medium text-surface">{{ dialogs.language }}</p>
						<p class="text-[10px] text-muted">{{ dialogs.languageDescription }}</p>
						<div class="flex gap-1.5" data-test-id="settings-language-options">
							<button
								v-for="opt in UI_LOCALES"
								:key="opt.code"
								type="button"
								class="rounded border px-2.5 py-1.5 text-[11px] transition-colors"
								:class="
									appLocale === opt.code
										? 'border-accent bg-accent/10 text-accent'
										: 'border-border text-muted hover:bg-hover'
								"
								:data-state="appLocale === opt.code ? 'active' : 'inactive'"
								@click="appLocale = opt.code"
							>
								{{ opt.label }}
							</button>
						</div>
					</div>
				</section>

				<section
					v-else-if="settingsDialogSection === 'ai'"
					class="flex h-full flex-col"
					data-test-id="settings-ai-panel"
				>
					<ModelsPanel />
				</section>

				<!-- Upstream has a third "storage" section for remote S3 sync, which open-prd replaces
             with its own prototype persistence API, so the media section is kept here. -->
				<section
					v-else
					class="flex flex-col gap-2.5"
					data-test-id="settings-media-panel"
				>
					<h3 class="text-xs font-semibold text-surface">
						{{ dialogs.settingsMedia }}
					</h3>
					<StockPhotoKeysSection />
					<VectorizeSettingsSection />
				</section>
			</div>
		</div>

		<AppDialogFooter :ui="{ footer: 'justify-between' }">
			<div class="mr-auto flex items-center gap-2">
				<AppSwitch
					v-if="!IS_TAURI"
					v-model="rememberCredentials"
					:label="dialogs.rememberCredentials"
					data-test-id="settings-remember-credentials"
				/>
				<div>
					<p v-if="!IS_TAURI" class="text-[10px] text-surface">
						{{ dialogs.rememberCredentials }}
					</p>
					<p
						class="text-[10px] text-muted"
						data-test-id="settings-credential-backend"
					>
						{{ dialogs.credentialStorage({ backend: credentialBackendLabel }) }}
					</p>
				</div>
			</div>
			<DialogClose as-child>
				<button
					type="button"
					class="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90"
					data-test-id="app-settings-done"
				>
					{{ dialogs.done }}
				</button>
			</DialogClose>
		</AppDialogFooter>
	</AppDialogRoot>
</template>
