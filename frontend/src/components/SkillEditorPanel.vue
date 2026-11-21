<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "@open-pencil/vue";
import { useModulesStore } from "@/stores/modules";

const { editor: t } = useI18n();

const props = defineProps<{
	moduleId: string;
	moduleName: string;
}>();

const emit = defineEmits<{
	close: [];
}>();

const modulesStore = useModulesStore();

// ── 状态机 ──────────────────────────────────────────────────────────────────
type Step = "loading" | "edit" | "ai-optimize" | "preview" | "versions";
const step = ref<Step>("loading");
const error = ref("");
const loading = ref(false);

// ── 数据 ────────────────────────────────────────────────────────────────────
const currentVersion = ref(0);
const editContent = ref("");
const optimizeInstruction = ref("");
const optimizedContent = ref("");
const versions = ref<Array<{ id: string; version: number; isCurrent: boolean; createdAt: number }>>([]);
const previewingVersionContent = ref("");

// ── 初始化 ──────────────────────────────────────────────────────────────────
onMounted(async () => {
	try {
		const data = await modulesStore.getSkillContent(props.moduleId);
		editContent.value = data.content;
		currentVersion.value = data.version;
		step.value = "edit";
	} catch (e) {
		error.value = (e as Error).message;
		step.value = "edit";
	}
});

// ── 保存 ────────────────────────────────────────────────────────────────────
async function handleSave() {
	if (!editContent.value.trim()) return;
	loading.value = true;
	error.value = "";
	try {
		const result = await modulesStore.saveSkillContent(props.moduleId, editContent.value);
		currentVersion.value = result.version;
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

// ── AI 优化 ─────────────────────────────────────────────────────────────────
async function handleAiOptimize() {
	if (!optimizeInstruction.value.trim()) return;
	loading.value = true;
	error.value = "";
	try {
		const result = await modulesStore.optimizeSkill(props.moduleId, optimizeInstruction.value);
		optimizedContent.value = result.optimizedContent;
		step.value = "preview";
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

// 采用 AI 优化结果（填入编辑器等待用户确认保存）
function adoptOptimized() {
	editContent.value = optimizedContent.value;
	optimizeInstruction.value = "";
	step.value = "edit";
}

// ── 导出 ────────────────────────────────────────────────────────────────────
async function handleExport() {
	try {
		await modulesStore.exportSkill(props.moduleId, props.moduleName);
	} catch (e) {
		error.value = (e as Error).message;
	}
}

// ── 版本历史 ─────────────────────────────────────────────────────────────────
async function loadVersions() {
	loading.value = true;
	error.value = "";
	try {
		versions.value = await modulesStore.getSkillVersions(props.moduleId);
		step.value = "versions";
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

async function previewVersion(versionId: string) {
	try {
		const data = await modulesStore.getSkillVersion(props.moduleId, versionId);
		previewingVersionContent.value = data.content;
	} catch (e) {
		error.value = (e as Error).message;
	}
}

async function rollbackToVersion(versionId: string) {
	loading.value = true;
	error.value = "";
	try {
		const result = await modulesStore.rollbackSkill(props.moduleId, versionId);
		// 重新加载当前内容
		const data = await modulesStore.getSkillContent(props.moduleId);
		editContent.value = data.content;
		currentVersion.value = result.restoredVersion;
		previewingVersionContent.value = "";
		step.value = "edit";
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}

function formatDate(ts: number) {
	return new Date(ts).toLocaleString("zh-CN", {
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
</script>

<template>
	<div class="se-panel">
		<!-- Header -->
		<div class="se-header">
			<div class="se-header-left">
				<span class="se-title">
					<template v-if="step === 'edit'">{{ t.stepEdit({ name: moduleName }) }}</template>
					<template v-else-if="step === 'ai-optimize'">{{ t.stepAiOptimize }}</template>
					<template v-else-if="step === 'preview'">{{ t.stepPreview }}</template>
					<template v-else-if="step === 'versions'">{{ t.stepVersions }}</template>
					<template v-else>{{ t.stepLoading }}</template>
				</span>
				<span v-if="currentVersion > 0 && step === 'edit'" class="se-version-badge">
					v{{ currentVersion }}
				</span>
			</div>
			<button class="se-close-btn" @click="emit('close')">
				<svg viewBox="0 0 14 14" fill="none">
					<path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				</svg>
			</button>
		</div>

		<!-- 错误提示 -->
		<p v-if="error" class="se-error">{{ error }}</p>

		<!-- loading -->
		<div v-if="step === 'loading'" class="se-loading">
			<span class="se-loading-dot" />{{ t.stepLoading }}
		</div>

		<!-- ── 编辑模式 ── -->
		<template v-if="step === 'edit'">
			<div class="se-toolbar">
				<button class="se-tool-btn" @click="loadVersions" :disabled="loading">
					{{ t.stepVersions }}
				</button>
				<button class="se-tool-btn" @click="handleExport" :disabled="loading">
					{{ t.exportMd }}
				</button>
			</div>
			<textarea
				v-model="editContent"
				class="se-editor"
				spellcheck="false"
				:placeholder="t.skillContentPlaceholder"
				:disabled="loading"
			/>
			<div class="se-footer">
				<button
					class="se-ai-btn"
					:disabled="loading"
					@click="step = 'ai-optimize'; optimizeInstruction = ''"
				>
					✦ {{ t.aiOptimize }}
				</button>
				<div class="se-footer-right">
					<button class="se-cancel-btn" @click="emit('close')">{{ t.cancel }}</button>
					<button
						class="se-save-btn"
						:disabled="loading || !editContent.trim()"
						@click="handleSave"
					>
						{{ loading ? t.saving : t.saveNewVersion }}
					</button>
				</div>
			</div>
		</template>

		<!-- ── AI 优化模式 ── -->
		<template v-if="step === 'ai-optimize'">
			<div class="se-optimize-body">
				<p class="se-optimize-label">{{ t.optimizePromptLabel }}</p>
				<textarea
					v-model="optimizeInstruction"
					class="se-optimize-input"
					:placeholder="t.optimizePromptPlaceholder"
					rows="4"
					:disabled="loading"
				/>
			</div>
			<div class="se-footer">
				<button class="se-cancel-btn" @click="step = 'edit'">{{ t.backToEdit }}</button>
				<button
					class="se-save-btn"
					:disabled="loading || !optimizeInstruction.trim()"
					@click="handleAiOptimize"
				>
					{{ loading ? t.aiGenerating : t.generateOptimized }}
				</button>
			</div>
		</template>

		<!-- ── 优化预览 ── -->
		<template v-if="step === 'preview'">
			<div class="se-preview-wrap">
				<pre class="se-preview">{{ optimizedContent }}</pre>
			</div>
			<div class="se-footer">
				<button class="se-cancel-btn" :disabled="loading" @click="step = 'ai-optimize'">
					{{ t.regenerate }}
				</button>
				<button class="se-save-btn" @click="adoptOptimized">
					{{ t.adoptVersion }}
				</button>
			</div>
		</template>

		<!-- ── 历史版本 ── -->
		<template v-if="step === 'versions'">
			<div class="se-versions-body">
				<div
					v-for="v in versions"
					:key="v.id"
					class="se-version-row"
					:class="{ current: v.isCurrent }"
				>
					<div class="se-version-info">
						<span class="se-version-num">v{{ v.version }}</span>
						<span v-if="v.isCurrent" class="se-current-badge">{{ t.current }}</span>
						<span class="se-version-date">{{ formatDate(v.createdAt) }}</span>
					</div>
					<div class="se-version-actions">
						<button
							class="se-tool-btn"
							@click="previewVersion(v.id)"
						>
							{{ t.preview }}
						</button>
						<button
							v-if="!v.isCurrent"
							class="se-tool-btn se-tool-btn--warn"
							:disabled="loading"
							@click="rollbackToVersion(v.id)"
						>
							{{ t.rollback }}
						</button>
					</div>
				</div>
				<!-- 预览指定版本内容 -->
				<div v-if="previewingVersionContent" class="se-version-preview-wrap">
					<pre class="se-preview">{{ previewingVersionContent }}</pre>
				</div>
			</div>
			<div class="se-footer">
				<button class="se-cancel-btn" @click="step = 'edit'; previewingVersionContent = ''">
					{{ t.backToEdit }}
				</button>
			</div>
		</template>
	</div>
</template>

<style lang="scss" scoped>
.se-panel {
	display: flex;
	flex-direction: column;
	border: 1px solid var(--color-border);
	border-radius: 10px;
	background: var(--color-bg-primary);
	overflow: hidden;
}

/* ── Header ── */
.se-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 14px;
	border-bottom: 1px solid var(--color-border);
	background: var(--color-bg-secondary);
	gap: 8px;
}

.se-header-left {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}

.se-title {
	font-size: 13px;
	font-weight: 600;
	color: var(--color-text-primary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.se-version-badge {
	display: inline-flex;
	align-items: center;
	padding: 1px 7px;
	border-radius: 10px;
	background: #eef2ff;
	color: #4f46e5;
	font-size: 11px;
	font-weight: 600;
	flex-shrink: 0;
}

.se-close-btn {
	width: 24px;
	height: 24px;
	border: none;
	background: transparent;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 4px;
	color: var(--color-text-muted);
	flex-shrink: 0;
	padding: 0;
	transition: background 0.12s;

	&:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	svg {
		width: 12px;
		height: 12px;
	}
}

/* ── 错误 ── */
.se-error {
	font-size: 12px;
	color: #ef4444;
	padding: 6px 14px 0;
}

/* ── Loading ── */
.se-loading {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 20px 14px;
	font-size: 13px;
	color: var(--color-text-muted);
}

@keyframes se-pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.3; }
}

.se-loading-dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: #4f46e5;
	animation: se-pulse 1.2s ease-in-out infinite;
}

/* ── 工具栏 ── */
.se-toolbar {
	display: flex;
	gap: 6px;
	padding: 8px 14px 0;
}

.se-tool-btn {
	height: 26px;
	padding: 0 10px;
	font-size: 11px;
	background: transparent;
	color: var(--color-text-secondary);
	border: 1px solid var(--color-border);
	border-radius: 5px;
	cursor: pointer;
	transition: background 0.12s;
	font-family: var(--font-family);

	&:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
	}

	&:disabled {
		opacity: 0.5;
		cursor: default;
	}

	&--warn {
		color: #ef4444;
		border-color: #fecaca;

		&:hover:not(:disabled) {
			background: #fef2f2;
		}
	}
}

/* ── 编辑器 ── */
.se-editor {
	flex: 1;
	width: 100%;
	box-sizing: border-box;
	padding: 10px 14px;
	border: none;
	border-top: 1px solid var(--color-border);
	margin-top: 8px;
	font-family: "Fira Code", "Cascadia Code", "Consolas", monospace;
	font-size: 11.5px;
	line-height: 1.6;
	color: var(--color-text-primary);
	background: #f8fafc;
	resize: none;
	outline: none;
	min-height: 200px;
	max-height: 280px;
	overflow-y: auto;

	&:focus {
		background: #fff;
	}

	&:disabled {
		opacity: 0.6;
	}
}

/* ── AI 优化输入 ── */
.se-optimize-body {
	padding: 12px 14px 0;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.se-optimize-label {
	font-size: 13px;
	color: var(--color-text-primary);
	font-weight: 500;
}

.se-optimize-input {
	width: 100%;
	box-sizing: border-box;
	padding: 8px 10px;
	border: 1px solid var(--color-border);
	border-radius: 8px;
	font-size: 13px;
	color: var(--color-text-primary);
	background: var(--color-bg-primary);
	resize: vertical;
	outline: none;
	font-family: var(--font-family);
	line-height: 1.5;
	transition: border-color 0.15s;

	&::placeholder {
		color: var(--color-text-muted);
	}

	&:focus {
		border-color: #4f46e5;
	}

	&:disabled {
		background: var(--color-bg-secondary);
	}
}

/* ── 预览 ── */
.se-preview-wrap {
	border-top: 1px solid var(--color-border);
	margin-top: 8px;
	overflow: hidden;
}

.se-preview {
	display: block;
	font-family: "Fira Code", "Cascadia Code", "Consolas", monospace;
	font-size: 11px;
	line-height: 1.6;
	padding: 10px 14px;
	background: #f8fafc;
	overflow: auto;
	max-height: 240px;
	white-space: pre-wrap;
	word-break: break-word;
	color: #334155;
	margin: 0;
}

/* ── 版本历史 ── */
.se-versions-body {
	padding: 8px 0;
	overflow-y: auto;
	max-height: 300px;
}

.se-version-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 14px;
	border-bottom: 1px solid var(--color-bg-secondary);
	gap: 8px;

	&.current {
		background: #f5f3ff;
	}
}

.se-version-info {
	display: flex;
	align-items: center;
	gap: 8px;
}

.se-version-num {
	font-size: 12px;
	font-weight: 600;
	color: var(--color-text-primary);
	font-family: monospace;
}

.se-current-badge {
	display: inline-flex;
	align-items: center;
	padding: 1px 6px;
	border-radius: 8px;
	background: #4f46e5;
	color: #fff;
	font-size: 10px;
	font-weight: 600;
}

.se-version-date {
	font-size: 11px;
	color: var(--color-text-muted);
}

.se-version-actions {
	display: flex;
	gap: 6px;
	flex-shrink: 0;
}

.se-version-preview-wrap {
	border-top: 1px solid var(--color-border);
	margin-top: 4px;
}

/* ── Footer ── */
.se-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 14px;
	border-top: 1px solid var(--color-border);
	background: var(--color-bg-secondary);
	gap: 8px;
}

.se-footer-right {
	display: flex;
	gap: 8px;
}

.se-ai-btn {
	height: 32px;
	padding: 0 14px;
	font-size: 12px;
	font-weight: 500;
	background: #f5f3ff;
	color: #4f46e5;
	border: 1px solid #c4b5fd;
	border-radius: 7px;
	cursor: pointer;
	transition: background 0.12s;
	font-family: var(--font-family);

	&:hover:not(:disabled) {
		background: #ede9fe;
	}

	&:disabled {
		opacity: 0.5;
		cursor: default;
	}
}

.se-cancel-btn {
	height: 32px;
	padding: 0 14px;
	font-size: 12px;
	background: transparent;
	color: var(--color-text-secondary);
	border: 1px solid var(--color-border);
	border-radius: 7px;
	cursor: pointer;
	transition: background 0.12s;
	font-family: var(--font-family);

	&:hover {
		background: var(--color-bg-tertiary);
	}
}

.se-save-btn {
	height: 32px;
	padding: 0 16px;
	font-size: 12px;
	font-weight: 500;
	background: #4f46e5;
	color: #fff;
	border: none;
	border-radius: 7px;
	cursor: pointer;
	transition: background 0.15s;
	font-family: var(--font-family);

	&:hover:not(:disabled) {
		background: #4338ca;
	}

	&:disabled {
		opacity: 0.55;
		cursor: default;
	}
}
</style>
