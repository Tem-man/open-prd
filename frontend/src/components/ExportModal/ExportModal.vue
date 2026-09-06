<script setup lang="ts">
	import { ref, computed } from "vue";
	import { useSessionsStore } from "@/stores/sessions";
	import { useMessagesStore } from "@/stores/messages";

	const visible = defineModel<boolean>({ default: false });

	const sessionsStore = useSessionsStore();
	const messagesStore = useMessagesStore();

	const exportFormat = ref<"html" | "markdown" | "pdf">("html");
	const currentSession = computed(() => sessionsStore.currentSession);

	function close() {
		visible.value = false;
	}

	function handleExport() {
		if (!messagesStore.prdHtml) return;
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
					<span class="modal-title">导出 PRD</span>
					<button class="modal-close" @click="close" title="关闭">
						<icon-lucide-x />
					</button>
				</div>
				<p class="modal-desc">选择导出格式，将 PRD 下载到本地：</p>

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
							<strong>HTML 网页</strong>
							<span>完整的交互式网页，保留所有样式和图表</span>
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
							<span>纯文本格式，适合导入 Notion、GitHub 等</span>
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
							<strong>PDF 文档</strong>
							<span>适合打印和正式交付的版式文档</span>
						</div>
						<div
							class="format-radio"
							:class="{ checked: exportFormat === 'pdf' }"
						></div>
					</label>
				</div>

				<div class="modal-footer">
					<button class="btn-cancel" @click="close">取消</button>
					<button class="btn-confirm" @click="handleExport">确认导出</button>
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

	.btn-cancel {
		padding: 7px 18px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-btn-sm);
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 13px;
		cursor: pointer;
		transition: background 0.15s;

		&:hover {
			background: var(--color-bg-tertiary);
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
		transition: background 0.15s;

		&:hover {
			background: var(--color-primary-hover);
		}
	}
</style>
