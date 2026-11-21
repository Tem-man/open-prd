<script setup lang="ts">
	import { ref, computed } from "vue";
	import { useI18n } from "@open-pencil/vue";
	import { useSessionsStore } from "@/stores/sessions";
	import { useMessagesStore } from "@/stores/messages";
	import { usePrdEditStore } from "@/stores/prdEdit";
	import { exportPrdToDocx } from "@/utils/docxExport";

	const visible = defineModel<boolean>({ default: false });

	const { export: t } = useI18n();
	const sessionsStore = useSessionsStore();
	const messagesStore = useMessagesStore();
	const prdEditStore = usePrdEditStore();

	const exportFormat = ref<"html" | "markdown" | "pdf" | "docx">("html");
	const currentSession = computed(() => sessionsStore.currentSession);
	const exporting = ref(false); // docx 导出中（图表渲染 + 光栅化耗时较长）
	const exportError = ref("");

	function close() {
		visible.value = false;
	}

	/** 重新选择格式或重新打开弹窗时清掉上一次的错误提示 */
	function clearError() {
		exportError.value = "";
	}

	async function exportDocx() {
		const session = currentSession.value;
		if (!session?.id) {
			exportError.value = t.value.sessionUnavailable;
			return;
		}
		exporting.value = true;
		try {
			// 权威数据源是结构化模块内容（prdHtml 里图表是未渲染的源码文本）
			if (!prdEditStore.sections.length) {
				await prdEditStore.loadSections(session.id);
			}
			const sections = prdEditStore.sections.map((s) => ({
				sectionId: s.sectionId,
				title: s.title,
				html: s.html,
			}));
			if (!sections.length) throw new Error(t.value.sectionsEmpty);
			await exportPrdToDocx({ title: session.title || "prd", sections });
			close();
		} catch (err) {
			console.error("[docx] 导出失败", err);
			exportError.value =
				err instanceof Error ? err.message : t.value.exportFailed;
		} finally {
			exporting.value = false;
		}
	}

	async function handleExport() {
		if (!messagesStore.prdHtml || exporting.value) return;
		clearError();
		// docx 流程独立（图表渲染 + 光栅化耗时，成功前不关闭弹窗）
		if (exportFormat.value === "docx") {
			await exportDocx();
			return;
		}
		if (exportFormat.value === "html") {
			const blob = new Blob([messagesStore.prdHtml], {
				type: "text/html;charset=utf-8",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${currentSession.value?.title || "prd"}.html`;
			a.click();
			URL.revokeObjectURL(url);
		} else if (exportFormat.value === "markdown") {
			const tmp = document.createElement("div");
			tmp.innerHTML = messagesStore.prdHtml;
			const text = tmp.innerText;
			const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${currentSession.value?.title || "prd"}.md`;
			a.click();
			URL.revokeObjectURL(url);
		} else {
			window.print();
		}
		close();
	}
</script>

<template>
	<Teleport to="body">
		<div class="modal-mask" v-if="visible" @click.self="close">
			<div class="modal-card">
				<div class="modal-header">
				<span class="modal-title">{{ t.title }}</span>
				<button class="modal-close" @click="close" :title="t.close">
					<icon-lucide-x />
				</button>
			</div>
			<p class="modal-desc">{{ t.desc }}</p>

				<div class="format-list">
					<label
						class="format-item"
						:class="{ active: exportFormat === 'html' }"
					>
						<input
							type="radio"
							name="fmt"
							value="html"
							v-model="exportFormat"
						/>
						<div class="format-icon html">
							<icon-lucide-globe />
						</div>
						<div class="format-info">
							<strong>{{ t.htmlTitle }}</strong>
							<span>{{ t.htmlDesc }}</span>
						</div>
						<div
							class="format-radio"
							:class="{ checked: exportFormat === 'html' }"
						></div>
					</label>

					<label
						class="format-item"
						:class="{ active: exportFormat === 'markdown' }"
					>
						<input
							type="radio"
							name="fmt"
							value="markdown"
							v-model="exportFormat"
						/>
						<div class="format-icon markdown">
							<icon-lucide-file-pen />
						</div>
						<div class="format-info">
							<strong>Markdown</strong>
							<span>{{ t.markdownDesc }}</span>
						</div>
						<div
							class="format-radio"
							:class="{ checked: exportFormat === 'markdown' }"
						></div>
					</label>

					<label class="format-item" :class="{ active: exportFormat === 'pdf' }">
						<input type="radio" name="fmt" value="pdf" v-model="exportFormat" />
						<div class="format-icon pdf">
							<icon-lucide-file-text />
						</div>
						<div class="format-info">
							<strong>{{ t.pdfTitle }}</strong>
							<span>{{ t.pdfDesc }}</span>
						</div>
						<div
							class="format-radio"
							:class="{ checked: exportFormat === 'pdf' }"
						></div>
					</label>

					<label class="format-item" :class="{ active: exportFormat === 'docx' }">
						<input
							type="radio"
							name="fmt"
							value="docx"
							v-model="exportFormat"
							@change="clearError"
						/>
						<div class="format-icon docx">
							<icon-lucide-file-type />
						</div>
						<div class="format-info">
							<strong>{{ t.docxTitle }}</strong>
							<span>{{ t.docxDesc }}</span>
						</div>
						<div
							class="format-radio"
							:class="{ checked: exportFormat === 'docx' }"
						></div>
					</label>
				</div>

				<p v-if="exportError" class="modal-error">{{ exportError }}</p>

				<div class="modal-footer">
				<button class="btn-cancel" :disabled="exporting" @click="close">
					{{ t.cancel }}
				</button>
					<button
						class="btn-confirm"
						:disabled="exporting"
						:class="{ loading: exporting }"
						@click="handleExport"
					>
						{{ exporting ? t.exporting : t.confirm }}
					</button>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style lang="scss" scoped>
	.modal-mask {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal-card {
		background: var(--color-bg-primary);
		border-radius: 12px;
		width: 420px;
		max-width: 92vw;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 0;
	}

	.modal-title {
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.modal-close {
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: var(--radius-btn-sm);
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;

		&:hover {
			background: var(--color-bg-tertiary);
		}

		svg {
			width: 16px;
			height: 16px;
		}
	}

	.modal-desc {
		font-size: 13px;
		color: var(--color-text-secondary);
		padding: 10px 20px 4px;
		margin: 0;
	}

	.format-list {
		padding: 0 20px 4px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.format-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-card);
		cursor: pointer;
		transition: all 0.15s;

		input[type="radio"] {
			display: none;
		}

		&:hover {
			border-color: #a5b4fc;
			background: #f5f3ff;
		}

		&.active {
			border-color: var(--color-primary);
			background: #eef2ff;
		}
	}

	.format-icon {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;

		svg {
			width: 20px;
			height: 20px;
		}

		&.html {
			color: #2563eb;
		}

		&.markdown {
			color: #ea580c;
		}

		&.pdf {
			color: var(--color-primary);
		}

		&.docx {
			color: #185abd; // Word 品牌蓝
		}
	}

	.format-info {
		flex: 1;

		strong {
			display: block;
			font-size: 13px;
			font-weight: 600;
			color: var(--color-text-primary);
			margin-bottom: 2px;
		}

		span {
			font-size: 11px;
			color: var(--color-text-muted);
		}
	}

	.format-radio {
		width: 16px;
		height: 16px;
		border: 2px solid var(--color-border);
		border-radius: 50%;
		flex-shrink: 0;
		transition: all 0.15s;

		&.checked {
			border-color: var(--color-primary);
			background: var(--color-primary);
			box-shadow: inset 0 0 0 3px #fff;
		}
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		padding: 16px 20px;
		border-top: 1px solid var(--color-border);
		margin-top: 12px;
	}

	.modal-error {
		font-size: 12px;
		color: #ef4444;
		padding: 8px 20px 0;
		margin: 0;
	}

	.btn-cancel {
		padding: 7px 18px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-btn-sm);
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 13px;
		cursor: pointer;
		transition: background 0.15s;

		&:hover:not(:disabled) {
			background: var(--color-bg-tertiary);
		}

		&:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
	}

	.btn-confirm {
		padding: 7px 18px;
		background: var(--color-primary);
		color: #fff;
		border: none;
		border-radius: var(--radius-btn-sm);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s, opacity 0.15s;

		&:hover:not(:disabled) {
			background: var(--color-primary-hover);
		}

		&:disabled {
			opacity: 0.7;
			cursor: not-allowed;
		}
	}
</style>
