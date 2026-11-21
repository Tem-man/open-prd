<script setup lang="ts">
	/**
	 * VersionDrawer — PRD 版本管理抽屉（左侧弹出）
	 * Figma Page 模型：每个版本是独立文档，点击版本行即切换工作区内容。
	 * 支持：切换版本、顶部新建空白版本、行内复制该版本、删除版本。
	 * 详见 docs/plan-prd-version-create-options.md
	 */
	import { ref, computed, watch, nextTick } from "vue";
	import { useI18n } from "@open-pencil/vue";
	import { useSessionsStore } from "@/stores/sessions";
	import { usePrdVersionsStore } from "@/stores/prdVersions";
	import { useMessagesStore } from "@/stores/messages";
	import { hasCollectionIntake } from "@/utils/versionIntake";
	import type { PrdVersionMeta } from "@/types";

	const props = defineProps<{
		modelValue: boolean;
	}>();

	const emit = defineEmits<{
		"update:modelValue": [value: boolean];
	}>();

	const { version: t } = useI18n();
	const sessionsStore = useSessionsStore();
	const versionsStore = usePrdVersionsStore();
	const messagesStore = useMessagesStore();

	const sessionId = computed(() => sessionsStore.currentSession?.id ?? "");
	const sessionTitle = computed(
		() => sessionsStore.currentSession?.title ?? "",
	);

	// ── 弹窗状态 ──
	const showAddDialog = ref(false);
	const addLabel = ref("");
	const copyIntake = ref(false);
	const addLabelInputRef = ref<HTMLInputElement | null>(null);
	const copyTarget = ref<PrdVersionMeta | null>(null);
	const copyLabel = ref("");
	const copyConversation = ref(true);
	const copyLabelInputRef = ref<HTMLInputElement | null>(null);
	/** 正在行内重命名的版本 id（双击版本名称触发） */
	const renamingId = ref<string | null>(null);
	const renameLabel = ref("");
	const renameInputRef = ref<HTMLInputElement | null>(null);
	const deleteTarget = ref<PrdVersionMeta | null>(null);
	const errorMsg = ref("");

	/** 下一个版本号（列表按 version DESC，首项即最大） */
	const nextVersionNumber = computed(
		() => (versionsStore.versions[0]?.version ?? 0) + 1,
	);

	const hasCollectionForm = computed(() =>
		hasCollectionIntake(messagesStore.messages),
	);

	watch(hasCollectionForm, (ok) => {
		if (!ok) copyIntake.value = false;
	});
	function displayName(v: PrdVersionMeta) {
		return v.label || `v${v.version}`;
	}

	watch(
		() => props.modelValue,
		(open) => {
			if (open && sessionId.value) {
				errorMsg.value = "";
				versionsStore.fetchVersions(sessionId.value).catch(() => {
					errorMsg.value = t.value.loadFailed;
				});
			}
		},
	);

	// 抽屉打开期间切换了会话 → 重新拉取
	watch(sessionId, (id) => {
		if (props.modelValue && id) {
			versionsStore.fetchVersions(id).catch(() => {
				errorMsg.value = t.value.loadFailed;
			});
		}
	});

	function close() {
		finishCurrentRename();
		emit("update:modelValue", false);
	}

	function sourceLabel(source: PrdVersionMeta["source"]) {
		if (source === "blank") return t.value.sourceBlank;
		return t.value.sourceSnapshot;
	}

	function relativeTime(ts: number) {
		const diff = Date.now() - ts;
		const m = Math.floor(diff / 60000);
		if (m < 1) return t.value.justNow;
		if (m < 60) return t.value.minutesAgo({ n: m });
		const h = Math.floor(m / 60);
		if (h < 24) return t.value.hoursAgo({ n: h });
		return t.value.daysAgo({ n: Math.floor(h / 24) });
	}

	// ── 切换版本 ──
	async function onRowClick(v: PrdVersionMeta) {
		if (renamingId.value) finishCurrentRename();
		if (v.isActive || versionsStore.mutating || !sessionId.value) return;
		try {
			await versionsStore.activateVersion(sessionId.value, v.id);
		} catch {
			errorMsg.value = t.value.switchFailed;
		}
	}

	// ── 新增版本 ──
	// 名称预填下一个默认版本号（如 v5）并全选，用户可立即输入新名称覆盖
	async function openAddDialog() {
		addLabel.value = `v${nextVersionNumber.value}`;
		copyIntake.value = false;
		showAddDialog.value = true;
		await nextTick();
		addLabelInputRef.value?.focus();
		addLabelInputRef.value?.select();
	}

	async function confirmAdd() {
		if (!sessionId.value) return;
		const label = addLabel.value.trim();
		try {
			await versionsStore.addVersion(
				sessionId.value,
				label === `v${nextVersionNumber.value}` ? "" : label,
				{ copyIntake: copyIntake.value && hasCollectionForm.value },
			);
			showAddDialog.value = false;
		} catch {
			errorMsg.value = t.value.createFailed;
			showAddDialog.value = false;
		}
	}

	async function openCopyDialog(v: PrdVersionMeta) {
		copyTarget.value = v;
		copyLabel.value = `v${nextVersionNumber.value}`;
		copyConversation.value = true;
		await nextTick();
		copyLabelInputRef.value?.focus();
		copyLabelInputRef.value?.select();
	}

	async function confirmCopy() {
		const target = copyTarget.value;
		if (!target || !sessionId.value) return;
		const label = copyLabel.value.trim();
		try {
			await versionsStore.duplicateVersion(
				sessionId.value,
				target.id,
				label === `v${nextVersionNumber.value}` ? "" : label,
				copyConversation.value,
			);
			copyTarget.value = null;
		} catch {
			errorMsg.value = t.value.copyFailed;
			copyTarget.value = null;
		}
	}

	// ── 行内重命名（双击版本名称）──
	function bindRenameInput(el: Element | { $el?: unknown } | null) {
		renameInputRef.value = el instanceof HTMLInputElement ? el : null;
	}

	function finishCurrentRename() {
		if (!renamingId.value) return;
		const current = versionsStore.versions.find(
			(x) => x.id === renamingId.value,
		);
		if (current) void commitRename(current);
		else renamingId.value = null;
	}

	function onDrawerMouseDown(e: MouseEvent) {
		if (!renamingId.value) return;
		const target = e.target;
		if (!(target instanceof Element)) return;
		if (target.closest(".version-name-edit-wrap")) return;
		finishCurrentRename();
	}

	function onNameClick(v: PrdVersionMeta) {
		if (renamingId.value && renamingId.value !== v.id) {
			finishCurrentRename();
		}
	}

	async function startRename(v: PrdVersionMeta) {
		if (versionsStore.mutating) return;
		if (renamingId.value && renamingId.value !== v.id) {
			finishCurrentRename();
		}
		renamingId.value = v.id;
		renameLabel.value = displayName(v);
		await nextTick();
		renameInputRef.value?.focus();
		renameInputRef.value?.select();
	}

	async function commitRename(v: PrdVersionMeta) {
		// Enter 与 blur 都会触发，先清状态防止重复提交
		if (renamingId.value !== v.id) return;
		renamingId.value = null;
		const label = renameLabel.value.trim();
		// 无变化或清空（= 恢复默认名）时不发请求
		if (label === displayName(v)) return;
		if (!sessionId.value) return;
		try {
			await versionsStore.renameVersion(
				sessionId.value,
				v.id,
				label === `v${v.version}` ? "" : label,
			);
		} catch {
			errorMsg.value = t.value.renameFailed;
		}
	}

	function cancelRename() {
		renamingId.value = null;
	}

	// ── 删除版本 ──
	async function confirmDelete() {
		const target = deleteTarget.value;
		if (!target || !sessionId.value) return;
		try {
			await versionsStore.deleteVersion(sessionId.value, target.id);
			deleteTarget.value = null;
		} catch {
			errorMsg.value = t.value.deleteFailed;
			deleteTarget.value = null;
		}
	}
</script>

<template>
	<Teleport to="body">
		<!-- 遮罩 -->
		<Transition name="drawer-mask">
			<div v-if="modelValue" class="drawer-mask" @click="close"></div>
		</Transition>

		<!-- 抽屉（左侧） -->
		<Transition name="drawer-slide-left">
			<div
				v-if="modelValue"
				class="version-drawer"
				role="dialog"
				:aria-label="t.title"
				@mousedown="onDrawerMouseDown"
			>
				<!-- Header -->
				<div class="drawer-header">
					<div class="drawer-header-left">
						<icon-lucide-history class="drawer-icon" />
						<div>
							<p class="drawer-title">{{ t.title }}</p>
							<p class="drawer-subtitle" v-if="sessionTitle">
								{{ sessionTitle }}
							</p>
						</div>
					</div>
					<button class="drawer-close" @click="close">
						<icon-lucide-x />
					</button>
				</div>

				<!-- 新增版本入口 -->
				<div class="drawer-actions">
					<button
						class="btn-add-version"
						:disabled="versionsStore.mutating"
						@click="openAddDialog"
					>
						<icon-lucide-plus />
						{{ t.addVersion }}
					</button>
				</div>

				<!-- 错误提示 -->
				<div v-if="errorMsg" class="drawer-error">{{ errorMsg }}</div>

				<!-- 加载中 -->
			<div v-if="versionsStore.loading" class="drawer-empty">
				<p>{{ t.loading }}</p>
			</div>

				<!-- 空状态 -->
				<div
					v-else-if="versionsStore.versions.length === 0"
					class="drawer-empty"
				>
				<icon-lucide-history class="empty-icon" />
				<p>{{ t.empty }}</p>
				<p class="empty-hint">{{ t.emptyHint }}</p>
				</div>

				<!-- 版本列表 -->
				<div class="drawer-list" v-else>
					<div
						v-for="v in versionsStore.versions"
						:key="v.id"
						class="version-item"
						:class="{ active: v.isActive, disabled: versionsStore.mutating }"
						@click="onRowClick(v)"
					>
						<div class="version-body">
							<div class="version-title-row">
								<!-- 编辑态：隐藏镜像 span 撑开与原名称完全相同的尺寸，
								     输入框绝对覆盖其上——切换时文本零漂移，宽度随输入增长 -->
								<span
									v-if="renamingId === v.id"
									class="version-name-edit-wrap"
									@click.stop
								>
									<span class="version-name mirror">{{
										renameLabel || " "
									}}</span>
									<input
										:ref="bindRenameInput"
										v-model="renameLabel"
										class="version-name-input"
										type="text"
										maxlength="50"
										@keydown.enter.prevent="commitRename(v)"
										@keydown.esc.prevent="cancelRename"
										@blur="commitRename(v)"
									/>
								</span>
								<span
									v-else
									class="version-name editable"
									:title="t.renameHint"
									@click.stop="onNameClick(v)"
									@dblclick.stop="startRename(v)"
									>{{ displayName(v) }}</span
								>
								<span class="badge-source">{{ sourceLabel(v.source) }}</span>
							</div>
							<span class="version-time">{{ relativeTime(v.updatedAt) }}</span>
						</div>

						<!-- 行内操作 -->
						<div class="version-actions" @click.stop>
							<button
								class="icon-btn"
								:title="t.copyHint"
								:disabled="versionsStore.mutating"
								@click="openCopyDialog(v)"
							>
								<icon-lucide-copy />
							</button>
							<button
								class="icon-btn danger"
								:title="t.deleteHint"
								:disabled="versionsStore.mutating"
								@click="deleteTarget = v"
							>
								<icon-lucide-trash-2 />
							</button>
						</div>
					</div>
				</div>

				<!-- Footer 说明 -->
			<div class="drawer-footer">
				{{ t.note }}
			</div>
			</div>
		</Transition>

		<!-- 新增版本弹窗 -->
		<Transition name="drawer-mask">
			<div
				v-if="showAddDialog"
				class="dialog-mask"
				@click.self="showAddDialog = false"
			>
				<div class="dialog">
					<p class="dialog-title">{{ t.newBlank }}</p>
					<label class="dialog-field-label" for="add-version-name">
						{{ t.versionName }}
					</label>
					<input
						id="add-version-name"
						ref="addLabelInputRef"
						v-model="addLabel"
						class="dialog-input"
						type="text"
						:placeholder="t.namePlaceholder"
						maxlength="50"
						@keydown.enter="confirmAdd"
					/>
					<div class="mode-options">
						<label class="mode-option" :class="{ checked: !copyIntake }">
							<input type="radio" v-model="copyIntake" :value="false" />
							<div>
								<p class="mode-name">{{ t.modeNoCollection }}</p>
								<p class="mode-desc">
									{{ t.modeNoCollectionDesc }}
								</p>
							</div>
						</label>
						<label
							class="mode-option"
							:class="{
								checked: copyIntake && hasCollectionForm,
								disabled: !hasCollectionForm,
							}"
						>
							<input
								type="radio"
								v-model="copyIntake"
								:value="true"
								:disabled="!hasCollectionForm"
							/>
							<div>
								<p class="mode-name">{{ t.modeWithCollection }}</p>
								<p class="mode-desc">
									{{
										hasCollectionForm
											? t.modeWithCollectionDesc1
											: t.modeWithCollectionDesc2
									}}
								</p>
							</div>
						</label>
					</div>
					<div class="dialog-actions">
						<button class="btn-cancel" @click="showAddDialog = false">
							{{ t.cancel }}
						</button>
						<button
							class="btn-confirm"
							:disabled="versionsStore.mutating"
							@click="confirmAdd"
						>
							{{ t.create }}
						</button>
					</div>
				</div>
			</div>
		</Transition>

		<!-- 复制版本弹窗 -->
		<Transition name="drawer-mask">
			<div
				v-if="copyTarget"
				class="dialog-mask"
				@click.self="copyTarget = null"
			>
				<div class="dialog">
					<p class="dialog-title">{{ t.copyVersion }}</p>
					<p class="dialog-text">
						{{ t.copyDesc({ name: displayName(copyTarget) }) }}
					</p>
					<label class="dialog-field-label" for="copy-version-name">
						{{ t.versionName }}
					</label>
					<input
						id="copy-version-name"
						ref="copyLabelInputRef"
						v-model="copyLabel"
						class="dialog-input"
						type="text"
						:placeholder="t.namePlaceholder"
						maxlength="50"
						@keydown.enter="confirmCopy"
					/>
					<div class="mode-options">
						<label class="mode-option" :class="{ checked: copyConversation }">
							<input type="radio" v-model="copyConversation" :value="true" />
							<div>
								<p class="mode-name">{{ t.copyWithChat }}</p>
								<p class="mode-desc">{{ t.copyWithChatDesc }}</p>
							</div>
						</label>
						<label class="mode-option" :class="{ checked: !copyConversation }">
							<input type="radio" v-model="copyConversation" :value="false" />
							<div>
								<p class="mode-name">{{ t.copyWithoutChat }}</p>
								<p class="mode-desc">{{ t.copyWithoutChatDesc }}</p>
							</div>
						</label>
					</div>
					<div class="dialog-actions">
						<button class="btn-cancel" @click="copyTarget = null">{{ t.cancel }}</button>
						<button
							class="btn-confirm"
							:disabled="versionsStore.mutating"
							@click="confirmCopy"
						>
							{{ t.copy }}
						</button>
					</div>
				</div>
			</div>
		</Transition>

		<!-- 删除确认弹窗 -->
		<Transition name="drawer-mask">
			<div
				v-if="deleteTarget"
				class="dialog-mask"
				@click.self="deleteTarget = null"
			>
				<div class="dialog">
					<p class="dialog-title">{{ t.deleteVersion }}</p>
					<p class="dialog-text" v-if="deleteTarget.isActive">
						{{ t.deleteCurrentConfirm({ name: displayName(deleteTarget) }) }}
						{{ t.deleteCurrentHint }}
					</p>
					<p class="dialog-text" v-else>
						{{ t.deleteConfirm({ name: displayName(deleteTarget) }) }}
						{{ t.deleteHintFull }}
					</p>
					<div class="dialog-actions">
						<button class="btn-cancel" @click="deleteTarget = null">
							{{ t.cancel }}
						</button>
						<button
							class="btn-danger"
							:disabled="versionsStore.mutating"
							@click="confirmDelete"
						>
							{{ t.delete }}
						</button>
					</div>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style lang="scss">
	.drawer-mask {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.28);
		z-index: 300;
	}

	.version-drawer {
		position: fixed;
		top: 0;
		left: 0;
		width: 340px;
		height: 100vh;
		background: var(--color-bg-primary);
		box-shadow: 6px 0 32px rgba(0, 0, 0, 0.1);
		z-index: 301;
		display: flex;
		flex-direction: column;
	}

	/* ── Header ── */
	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 18px;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}
	.drawer-header-left {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.drawer-icon {
		width: 18px;
		height: 18px;
		color: var(--color-primary);
		flex-shrink: 0;
	}
	.drawer-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}
	.drawer-subtitle {
		font-size: 11px;
		color: var(--color-text-muted);
		margin: 2px 0 0;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.drawer-close {
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-btn-sm);
		color: var(--color-text-muted);
		transition: background 0.15s;
		flex-shrink: 0;
		&:hover {
			background: var(--color-bg-tertiary);
			color: var(--color-text-primary);
		}
		svg {
			width: 14px;
			height: 14px;
		}
	}

	/* ── 新增版本按钮 ── */
	.drawer-actions {
		padding: 12px 18px;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}
	.btn-add-version {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		width: 100%;
		padding: 8px 0;
		background: var(--color-primary);
		color: #fff;
		border: none;
		border-radius: var(--radius-btn-sm);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
		&:hover:not(:disabled) {
			background: var(--color-primary-hover);
		}
		&:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
		svg {
			width: 14px;
			height: 14px;
		}
	}

	/* ── 错误提示 ── */
	.drawer-error {
		margin: 10px 18px 0;
		padding: 8px 12px;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: var(--radius-btn-sm);
		color: var(--color-error);
		font-size: 12px;
		flex-shrink: 0;
	}

	/* ── Empty ── */
	.drawer-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--color-text-muted);
		font-size: 13px;
		.empty-icon {
			width: 48px;
			height: 48px;
			color: #cbd5e1;
		}
		.empty-hint {
			font-size: 12px;
			color: var(--color-text-muted);
		}
	}

	/* ── List ── */
	.drawer-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px 0;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
	}

	.version-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 18px;
		cursor: pointer;
		transition: background 0.12s;
		border-bottom: 1px solid var(--color-bg-tertiary);

		&:hover {
			background: var(--color-bg-secondary);
		}
		&:last-child {
			border-bottom: none;
		}
		&.active {
			background: #eef2ff;
			cursor: default;
			&:hover {
				background: #eef2ff;
			}
		}
		&.disabled {
			pointer-events: none;
			opacity: 0.7;
		}
	}

	.version-body {
		flex: 1;
		overflow: hidden;
		/* 向左扩裁剪盒：抵消名称负边距 + 输入框左边框，避免被 overflow 裁掉 */
		padding-left: 10px;
		margin-left: -10px;
	}

	.version-title-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 3px;
	}

	.version-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
		&.editable {
			cursor: text;
			border-radius: 4px;
			padding: 0 8px;
			margin-left: -8px;
			&:hover {
				background: var(--color-bg-tertiary);
			}
		}
	}

	/* ── 行内重命名（镜像占位 + 绝对覆盖，保证零漂移） ── */
	.version-name-edit-wrap {
		position: relative;
		display: inline-block;
		margin-left: -8px; /* 与 .version-name.editable 的偏移一致 */
		flex-shrink: 0;
	}

	.version-name.mirror {
		visibility: hidden;
		display: inline-block;
		padding: 0 8px;
		white-space: pre;
	}

	.version-name-input {
		position: absolute;
		inset: 0;
		width: 100%;
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		line-height: inherit;
		color: var(--color-text-primary);
		border: 1px solid var(--color-primary);
		border-radius: 4px;
		/* 1px border + 7px padding = 镜像 span 的 8px padding，文本起点完全对齐 */
		padding: 0 7px;
		margin: 0;
		outline: none;
		background: var(--color-bg-primary);
		box-sizing: border-box;
	}

	.badge-source {
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: 10px;
	}

	.version-time {
		font-size: 10px;
		color: var(--color-text-muted);
	}

	.version-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.icon-btn {
		width: 26px;
		height: 26px;
		border: none;
		background: transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-btn-sm);
		color: var(--color-text-muted);
		transition:
			background 0.15s,
			color 0.15s;
		&:hover:not(:disabled) {
			background: var(--color-bg-tertiary);
			color: var(--color-text-primary);
		}
		&.danger:hover:not(:disabled) {
			background: #fef2f2;
			color: var(--color-error);
		}
		&:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		svg {
			width: 14px;
			height: 14px;
		}
	}

	/* ── Footer ── */
	.drawer-footer {
		padding: 10px 18px;
		border-top: 1px solid var(--color-border);
		font-size: 11px;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	/* ── 弹窗 ── */
	.dialog-mask {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.32);
		z-index: 400;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.dialog {
		width: 400px;
		background: var(--color-bg-primary);
		border-radius: var(--radius-card);
		box-shadow:
			0 10px 25px rgba(0, 0, 0, 0.12),
			0 4px 10px rgba(0, 0, 0, 0.06);
		padding: 20px;
	}

	.dialog-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 12px;
	}

	.dialog-field-label {
		display: block;
		font-size: 12px;
		color: var(--color-text-secondary);
		margin: 0 0 6px;
	}

	.dialog-text {
		font-size: 13px;
		color: var(--color-text-secondary);
		line-height: 1.6;
		margin: 0 0 16px;
	}

	.dialog-input {
		width: 100%;
		padding: 8px 10px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-btn-sm);
		font-size: 13px;
		color: var(--color-text-primary);
		outline: none;
		box-sizing: border-box;
		margin-bottom: 12px;
		&:focus {
			border-color: var(--color-primary);
		}
	}

	.mode-options {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 16px;
	}

	.mode-option {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-btn-sm);
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;

		&.checked {
			border-color: var(--color-primary);
			background: #eef2ff;
		}
		input {
			margin-top: 3px;
			accent-color: var(--color-primary);
		}

		&.disabled {
			cursor: not-allowed;
			opacity: 0.55;
		}
	}

	.mode-sub-options {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: -2px 0 4px 22px;
	}

	.mode-option.sub {
		padding: 8px 10px;
	}

	.mode-name {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-primary);
		margin: 0;
	}

	.mode-desc {
		font-size: 11px;
		color: var(--color-text-muted);
		margin: 2px 0 0;
		line-height: 1.5;
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.btn-cancel {
		padding: 7px 14px;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-btn-sm);
		font-size: 13px;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background 0.15s;
		&:hover {
			background: var(--color-border);
		}
	}

	.btn-confirm {
		padding: 7px 14px;
		background: var(--color-primary);
		border: none;
		border-radius: var(--radius-btn-sm);
		font-size: 13px;
		font-weight: 500;
		color: #fff;
		cursor: pointer;
		transition: background 0.15s;
		&:hover:not(:disabled) {
			background: var(--color-primary-hover);
		}
		&:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
	}

	.btn-danger {
		padding: 7px 14px;
		background: var(--color-error);
		border: none;
		border-radius: var(--radius-btn-sm);
		font-size: 13px;
		font-weight: 500;
		color: #fff;
		cursor: pointer;
		transition: opacity 0.15s;
		&:hover:not(:disabled) {
			opacity: 0.88;
		}
		&:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
	}

	/* ── 动画 ── */
	.drawer-slide-left-enter-active,
	.drawer-slide-left-leave-active {
		transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.drawer-slide-left-enter-from,
	.drawer-slide-left-leave-to {
		transform: translateX(-100%);
	}

	.drawer-mask-enter-active,
	.drawer-mask-leave-active {
		transition: opacity 0.24s ease;
	}
	.drawer-mask-enter-from,
	.drawer-mask-leave-to {
		opacity: 0;
	}
</style>
