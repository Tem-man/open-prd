<script setup lang="ts">
	/**
	 * VersionDrawer — PRD 版本管理抽屉（左侧弹出）
	 * Figma Page 模型：每个版本是独立文档，点击版本行即切换工作区内容。
	 * 支持：切换版本、新增版本（复制当前/空白）、克隆为新会话、删除版本。
	 * 详见 docs/plan-prd-version-management.md
	 */
	import { ref, computed, watch, nextTick } from "vue";
	import { useRouter } from "vue-router";
	import { useSessionsStore } from "@/stores/sessions";
	import { usePrdVersionsStore } from "@/stores/prdVersions";
	import type { PrdVersionMeta } from "@/types";

	const props = defineProps<{
		modelValue: boolean;
	}>();

	const emit = defineEmits<{
		"update:modelValue": [value: boolean];
	}>();

	const router = useRouter();
	const sessionsStore = useSessionsStore();
	const versionsStore = usePrdVersionsStore();

	const sessionId = computed(() => sessionsStore.currentSession?.id ?? "");
	const sessionTitle = computed(
		() => sessionsStore.currentSession?.title ?? "",
	);

	// ── 弹窗状态 ──
	const showAddDialog = ref(false);
	const addLabel = ref("");
	const addMode = ref<"duplicate" | "blank">("blank");
	const addLabelInputRef = ref<HTMLInputElement | null>(null);
	/** 正在行内重命名的版本 id（双击版本名称触发） */
	const renamingId = ref<string | null>(null);
	const renameLabel = ref("");
	const renameInputRef = ref<HTMLInputElement | null>(null);
	const deleteTarget = ref<PrdVersionMeta | null>(null);
	const cloneTarget = ref<PrdVersionMeta | null>(null);
	const errorMsg = ref("");

	/** 下一个版本号（列表按 version DESC，首项即最大） */
	const nextVersionNumber = computed(
		() => (versionsStore.versions[0]?.version ?? 0) + 1,
	);

	/** 版本显示名：有自定义名称用名称，否则回退 v{N} */
	function displayName(v: PrdVersionMeta) {
		return v.label || `v${v.version}`;
	}

	watch(
		() => props.modelValue,
		(open) => {
			if (open && sessionId.value) {
				errorMsg.value = "";
				versionsStore.fetchVersions(sessionId.value).catch(() => {
					errorMsg.value = "版本列表加载失败";
				});
			}
		},
	);

	// 抽屉打开期间切换了会话 → 重新拉取
	watch(sessionId, (id) => {
		if (props.modelValue && id) {
			versionsStore.fetchVersions(id).catch(() => {
				errorMsg.value = "版本列表加载失败";
			});
		}
	});

	function close() {
		finishCurrentRename();
		emit("update:modelValue", false);
	}

	function sourceLabel(source: PrdVersionMeta["source"]) {
		if (source === "blank") return "空白";
		if (source === "clone") return "克隆";
		return "快照";
	}

	function relativeTime(ts: number) {
		const diff = Date.now() - ts;
		const m = Math.floor(diff / 60000);
		if (m < 1) return "刚刚";
		if (m < 60) return `${m} 分钟前`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} 小时前`;
		return `${Math.floor(h / 24)} 天前`;
	}

	// ── 切换版本 ──
	async function onRowClick(v: PrdVersionMeta) {
		if (renamingId.value) finishCurrentRename();
		if (v.isActive || versionsStore.mutating || !sessionId.value) return;
		try {
			await versionsStore.activateVersion(sessionId.value, v.id);
		} catch {
			errorMsg.value = "切换版本失败，请重试";
		}
	}

	// ── 新增版本 ──
	// 名称预填下一个默认版本号（如 v5）并全选，用户可立即输入新名称覆盖
	async function openAddDialog() {
		addLabel.value = `v${nextVersionNumber.value}`;
		addMode.value = "blank";
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
				// 与默认名一致时不落库，展示层回退 v{N}
				label === `v${nextVersionNumber.value}` ? "" : label,
				addMode.value,
			);
			showAddDialog.value = false;
		} catch {
			errorMsg.value = "新增版本失败，请重试";
			showAddDialog.value = false;
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
			errorMsg.value = "重命名失败，请重试";
		}
	}

	function cancelRename() {
		renamingId.value = null;
	}

	// ── 删除版本 ──
	async function confirmDelete() {
		const t = deleteTarget.value;
		if (!t || !sessionId.value) return;
		try {
			await versionsStore.deleteVersion(sessionId.value, t.id);
			deleteTarget.value = null;
		} catch {
			errorMsg.value = "删除版本失败，请重试";
			deleteTarget.value = null;
		}
	}

	// ── 克隆为新会话 ──
	async function confirmClone() {
		const t = cloneTarget.value;
		if (!t || !sessionId.value) return;
		try {
			const newId = await versionsStore.cloneVersion(sessionId.value, t.id);
			cloneTarget.value = null;
			close();
			await sessionsStore.fetchSessions();
			router.push(`/session/${newId}`);
		} catch {
			errorMsg.value = "克隆失败，请重试";
			cloneTarget.value = null;
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
				aria-label="版本管理"
				@mousedown="onDrawerMouseDown"
			>
				<!-- Header -->
				<div class="drawer-header">
					<div class="drawer-header-left">
						<icon-lucide-history class="drawer-icon" />
						<div>
							<p class="drawer-title">版本管理</p>
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
						新增版本
					</button>
				</div>

				<!-- 错误提示 -->
				<div v-if="errorMsg" class="drawer-error">{{ errorMsg }}</div>

				<!-- 加载中 -->
				<div v-if="versionsStore.loading" class="drawer-empty">
					<p>加载中…</p>
				</div>

				<!-- 空状态 -->
				<div
					v-else-if="versionsStore.versions.length === 0"
					class="drawer-empty"
				>
					<icon-lucide-history class="empty-icon" />
					<p>还没有版本记录</p>
					<p class="empty-hint">点击上方「新增版本」保存当前 PRD 内容</p>
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
									title="双击重命名"
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
								title="克隆为新会话"
								:disabled="versionsStore.mutating"
								@click="cloneTarget = v"
							>
								<icon-lucide-copy-plus />
							</button>
							<button
								class="icon-btn danger"
								title="删除版本"
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
					版本为手动创建；切换版本时当前内容会自动保存回原版本。
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
					<p class="dialog-title">新增版本</p>
					<label class="dialog-field-label" for="add-version-name">
						版本名称
					</label>
					<input
						id="add-version-name"
						ref="addLabelInputRef"
						v-model="addLabel"
						class="dialog-input"
						type="text"
						placeholder="版本名称，如：初稿 / 评审版"
						maxlength="50"
						@keydown.enter="confirmAdd"
					/>
					<div class="mode-options">
						<label
							class="mode-option"
							:class="{ checked: addMode === 'duplicate' }"
						>
							<input type="radio" v-model="addMode" value="duplicate" />
							<div>
								<p class="mode-name">复制当前内容</p>
								<p class="mode-desc">
									在本会话内创建内容相同的平行版本，共享对话记录
								</p>
							</div>
						</label>
						<label
							class="mode-option"
							:class="{ checked: addMode === 'blank' }"
						>
							<input type="radio" v-model="addMode" value="blank" />
							<div>
								<p class="mode-name">空白版本</p>
								<p class="mode-desc">
									创建空白版本并切换过去，当前内容保留在原版本中
								</p>
							</div>
						</label>
					</div>
					<div class="dialog-actions">
						<button class="btn-cancel" @click="showAddDialog = false">
							取消
						</button>
						<button
							class="btn-confirm"
							:disabled="versionsStore.mutating"
							@click="confirmAdd"
						>
							创建
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
					<p class="dialog-title">删除版本</p>
					<p class="dialog-text" v-if="deleteTarget.isActive">
						删除当前版本「{{ displayName(deleteTarget) }}」？
						将自动切换到最新剩余版本；若是最后一个版本，当前编辑内容会保留在工作区。
					</p>
					<p class="dialog-text" v-else>
						删除「{{ displayName(deleteTarget) }}」？
						该版本内容将被永久删除，不影响当前 PRD。
					</p>
					<div class="dialog-actions">
						<button class="btn-cancel" @click="deleteTarget = null">
							取消
						</button>
						<button
							class="btn-danger"
							:disabled="versionsStore.mutating"
							@click="confirmDelete"
						>
							删除
						</button>
					</div>
				</div>
			</div>
		</Transition>

		<!-- 克隆确认弹窗 -->
		<Transition name="drawer-mask">
			<div
				v-if="cloneTarget"
				class="dialog-mask"
				@click.self="cloneTarget = null"
			>
				<div class="dialog">
					<p class="dialog-title">克隆为新会话</p>
					<p class="dialog-text">
						基于「{{ displayName(cloneTarget) }}」创建一个独立会话？
						将复制该版本内容与对话记录，原会话不受影响。
					</p>
					<div class="dialog-actions">
						<button class="btn-cancel" @click="cloneTarget = null">取消</button>
						<button
							class="btn-confirm"
							:disabled="versionsStore.mutating"
							@click="confirmClone"
						>
							克隆
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
		width: 360px;
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
