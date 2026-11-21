<script setup lang="ts">
	import { onMounted, ref, computed, watch } from "vue";
	import { useRouter, useRoute } from "vue-router";
	import { useI18n } from "@open-pencil/vue";
	import { useSessionsStore } from "@/stores/sessions";
	import { usePrototypesStore } from "@/stores/prototypes";
	import ConfirmDialog from "./components/ConfirmDialog.vue";
	import ModuleManager from "@/components/ModuleManager.vue";
	import type { Session, Prototype } from "@/types";

	type HomeTab = "prd" | "eval" | "proto";
	type DeleteTarget =
		| { kind: "prd"; id: string; title: string }
		| { kind: "proto"; id: string; title: string };

	const { home } = useI18n();
	const router = useRouter();
	const route = useRoute();
	const sessionsStore = useSessionsStore();
	const prototypesStore = usePrototypesStore();

	const deleteTarget = ref<DeleteTarget | null>(null);
	const showModuleManager = ref(false);
	const activeTypeTab = ref<HomeTab>("prd");
	const activeViewTab = ref<HomeTab>("prd");
	const viewMode = ref<"grid" | "list">("grid");
	const projectName = ref("");
	const creating = ref(false);

	function isHomeTab(value: unknown): value is HomeTab {
		return value === "prd" || value === "eval" || value === "proto";
	}

	function applyTab(tab: HomeTab) {
		activeTypeTab.value = tab;
		activeViewTab.value = tab;
	}

	function setHomeTab(tab: HomeTab) {
		applyTab(tab);
		if (route.query.tab !== tab) {
			router.replace({ query: { ...route.query, tab } });
		}
	}

	function syncTabFromRoute() {
		const tab = route.query.tab;
		if (isHomeTab(tab)) {
			applyTab(tab);
		}
	}

	const createSectionTitle = computed(() => {
		if (activeTypeTab.value === "eval") return home.value.newEval;
		if (activeTypeTab.value === "proto") return home.value.newProto;
		return home.value.newPrd;
	});
	const createButtonLabel = computed(() => {
		if (creating.value) return home.value.creating;
		if (activeTypeTab.value === "eval") return home.value.newEval;
		if (activeTypeTab.value === "proto") return home.value.newProto;
		return home.value.newPrd;
	});

	function openModuleManager() {
		showModuleManager.value = true;
	}

	async function onCreateClick() {
		if (creating.value) return;
		if (activeTypeTab.value === "proto") {
			creating.value = true;
			try {
				await prototypesStore.createPrototype(projectName.value.trim());
				projectName.value = "";
			} catch (e) {
				console.error(e);
				alert(e instanceof Error ? e.message : home.value.createProtoFailed);
			} finally {
				creating.value = false;
			}
			return;
		}
		if (activeTypeTab.value === "eval") return;
		openModuleManager();
	}

	async function onModuleManagerConfirm(selectedModules: string[]) {
		showModuleManager.value = false;
		await sessionsStore.createSession(
			selectedModules,
			projectName.value.trim(),
		);
		projectName.value = "";
	}

	function confirmDeleteSession(e: MouseEvent, session: Session) {
		e.stopPropagation();
		deleteTarget.value = {
			kind: "prd",
			id: session.id,
			title: session.title || home.value.untitledPrd,
		};
	}

	function confirmDeletePrototype(e: MouseEvent, proto: Prototype) {
		e.stopPropagation();
		deleteTarget.value = {
			kind: "proto",
			id: proto.id,
			title: proto.title || home.value.untitledProto,
		};
	}

	function cancelDelete() {
		deleteTarget.value = null;
	}

	async function doDelete() {
		if (!deleteTarget.value) return;
		const target = deleteTarget.value;
		if (target.kind === "prd") {
			await sessionsStore.deleteSession(target.id);
		} else {
			await prototypesStore.deletePrototype(target.id);
		}
		deleteTarget.value = null;
	}

	onMounted(() => {
		syncTabFromRoute();
		void sessionsStore.fetchSessions();
		void prototypesStore.fetchPrototypes();
	});

	watch(
		() => route.query.tab,
		() => syncTabFromRoute(),
	);

	const CARD_GRADIENTS = [
		"linear-gradient(135deg,#dbeafe 0%,#bfdbfe 100%)",
		"linear-gradient(135deg,#d1fae5 0%,#a7f3d0 100%)",
		"linear-gradient(135deg,#fef9c3 0%,#fde68a 100%)",
		"linear-gradient(135deg,#ede9fe 0%,#ddd6fe 100%)",
		"linear-gradient(135deg,#fee2e2 0%,#fecaca 100%)",
		"linear-gradient(135deg,#cffafe 0%,#a5f3fc 100%)",
		"linear-gradient(135deg,#fce7f3 0%,#fbcfe8 100%)",
		"linear-gradient(135deg,#ffedd5 0%,#fed7aa 100%)",
	];

	function cardGradient(i: number) {
		return CARD_GRADIENTS[i % CARD_GRADIENTS.length];
	}

	const statusLabel = (s: Session): string => {
		const map: Record<string, string> = {
			active: home.value.statusActive,
			completed: home.value.statusCompleted,
			failed: home.value.statusFailed,
			cancelled: home.value.statusCancelled,
		};
		return map[s.status ?? "active"] ?? home.value.statusActive;
	};

	function relativeTime(ts: number) {
		const diff = Date.now() - ts;
		const m = Math.floor(diff / 60000);
		if (m < 1) return home.value.justNow;
		if (m < 60) return home.value.minutesAgo({ n: m });
		const h = Math.floor(m / 60);
		if (h < 24) return home.value.hoursAgo({ n: h });
		const d = Math.floor(h / 24);
		if (d < 7) return home.value.daysAgo({ n: d });
		return home.value.weeksAgo({ n: Math.floor(d / 7) });
	}

	function formatFileSize(bytes: number) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<template>
	<div class="home-layout">
		<!-- 左侧边栏 -->
		<aside class="home-sidebar">
			<!-- 第二行：类型导航 -->
			<nav class="type-nav">
				<button
					class="type-tab"
					:class="{ active: activeTypeTab === 'prd' }"
					@click="setHomeTab('prd')"
				>
					PRD
				</button>
				<button
					class="type-tab"
					:class="{ active: activeTypeTab === 'eval' }"
					@click="setHomeTab('eval')"
				>
					{{ home.tabEval }}
				</button>
				<button
					class="type-tab"
					:class="{ active: activeTypeTab === 'proto' }"
					@click="setHomeTab('proto')"
				>
					{{ home.tabProto }}
				</button>
			</nav>

			<div class="sidebar-divider"></div>

			<!-- 第三个模块：新建 -->
			<div class="create-section">
				<h3 class="create-section-title">{{ createSectionTitle }}</h3>
				<div class="create-field">
				<label class="create-field-label">{{ home.projectName }}</label>
				<input
					v-model="projectName"
					type="text"
					class="create-field-input"
					:placeholder="home.projectNamePlaceholder"
					@keydown.enter="onCreateClick"
				/>
				</div>
				<button class="create-btn" :disabled="creating" @click="onCreateClick">
					<svg viewBox="0 0 16 16" fill="none">
						<path
							d="M8 3v10M3 8h10"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
					{{ createButtonLabel }}
				</button>
			</div>
		</aside>

		<!-- 右侧内容区 -->
		<main class="home-main">
			<!-- 第二行：视图 tabs + 搜索/视图切换 -->
			<div class="main-subheader">
				<div class="view-pill-tabs">
					<button
						class="view-pill"
						:class="{ active: activeViewTab === 'prd' }"
						@click="setHomeTab('prd')"
					>
						PRD
					</button>
					<button
						class="view-pill"
						:class="{ active: activeViewTab === 'eval' }"
						@click="setHomeTab('eval')"
					>
						{{ home.tabEval }}
					</button>
					<button
						class="view-pill"
						:class="{ active: activeViewTab === 'proto' }"
						@click="setHomeTab('proto')"
					>
						{{ home.tabProto }}
					</button>
				</div>
				<div class="main-tools">
					<div class="search-box">
						<svg class="search-icon" viewBox="0 0 16 16" fill="none">
							<circle
								cx="7"
								cy="7"
								r="4.5"
								stroke="currentColor"
								stroke-width="1.4"
							/>
							<path
								d="M10.5 10.5l3 3"
								stroke="currentColor"
								stroke-width="1.4"
								stroke-linecap="round"
							/>
						</svg>
						<input type="text" :placeholder="home.searchPlaceholder" />
					</div>
					<button
						class="view-mode-btn"
						:class="{ active: viewMode === 'grid' }"
						@click="viewMode = 'grid'"
						:title="home.gridView"
					>
						<svg viewBox="0 0 16 16" fill="none">
							<rect
								x="1"
								y="1"
								width="6"
								height="6"
								rx="1"
								stroke="currentColor"
								stroke-width="1.4"
							/>
							<rect
								x="9"
								y="1"
								width="6"
								height="6"
								rx="1"
								stroke="currentColor"
								stroke-width="1.4"
							/>
							<rect
								x="1"
								y="9"
								width="6"
								height="6"
								rx="1"
								stroke="currentColor"
								stroke-width="1.4"
							/>
							<rect
								x="9"
								y="9"
								width="6"
								height="6"
								rx="1"
								stroke="currentColor"
								stroke-width="1.4"
							/>
						</svg>
					</button>
					<button
						class="view-mode-btn"
						:class="{ active: viewMode === 'list' }"
						@click="viewMode = 'list'"
						:title="home.listView"
					>
						<svg viewBox="0 0 16 16" fill="none">
							<path
								d="M2 4h12M2 8h12M2 12h12"
								stroke="currentColor"
								stroke-width="1.4"
								stroke-linecap="round"
							/>
						</svg>
					</button>
				</div>
			</div>

			<!-- 内容区：PRD tab -->
			<div v-if="activeViewTab === 'prd'" class="content-area">
				<!-- 加载中 -->
				<div v-if="sessionsStore.loading" class="empty-state">
					<p>{{ home.loading }}</p>
				</div>

				<!-- 空状态 -->
				<div
					v-else-if="sessionsStore.sessions.length === 0"
					class="empty-state"
				>
					<div class="empty-icon">📄</div>
					<p>{{ home.emptyPrd }}</p>
				</div>

				<!-- 卡片网格 -->
				<div
					v-else
					class="card-grid"
					:class="{ 'list-mode': viewMode === 'list' }"
				>
					<div
						v-for="(session, i) in sessionsStore.sessions"
						:key="session.id"
						class="prd-card"
						@click="router.push(`/session/${session.id}`)"
					>
						<div class="card-preview" :style="{ background: cardGradient(i) }">
							<span>{{ home.prdCover }}</span>
						</div>
						<button
							class="card-delete-btn"
							@click="confirmDeleteSession($event, session)"
							:title="home.delete"
						>
							<svg viewBox="0 0 16 16" fill="none">
								<path
									d="M4 4l8 8M12 4l-8 8"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
								/>
							</svg>
						</button>
						<div class="card-body">
							<p class="card-title">{{ session.title || home.untitledPrd }}</p>
							<div class="card-meta">
								<span class="tag tag-style">Open PRD</span>
								<span class="tag" :class="`tag-${session.status ?? 'active'}`">
									{{ statusLabel(session) }}
								</span>
							</div>
							<p class="card-time">{{ relativeTime(session.updated_at) }}</p>
						</div>
					</div>
				</div>
			</div>

			<!-- 内容区：需求评估 tab -->
			<div v-else-if="activeViewTab === 'eval'" class="content-area">
				<div class="empty-state">
					<div class="empty-icon">🔍</div>
					<p>{{ home.evalComingSoon }}</p>
				</div>
			</div>

			<!-- 内容区：原型设计 tab -->
			<div v-else class="content-area">
				<div v-if="prototypesStore.loading" class="empty-state">
					<p>{{ home.loading }}</p>
				</div>

				<div
					v-else-if="prototypesStore.prototypes.length === 0"
					class="empty-state"
				>
					<div class="empty-icon">✏️</div>
					<p>{{ home.emptyProto }}</p>
				</div>

				<div
					v-else
					class="card-grid"
					:class="{ 'list-mode': viewMode === 'list' }"
				>
					<div
						v-for="(proto, i) in prototypesStore.prototypes"
						:key="proto.id"
						class="prd-card"
						@click="prototypesStore.openPrototype(proto.id)"
					>
						<div
							class="card-preview"
							:style="{
								background: proto.thumbnail
									? `center / cover no-repeat url(${proto.thumbnail})`
									: cardGradient(i),
							}"
						>
						<span v-if="!proto.thumbnail">{{ home.protoPreview }}</span>
					</div>
					<button
						class="card-delete-btn"
						:title="home.delete"
						@click="confirmDeletePrototype($event, proto)"
					>
							<svg viewBox="0 0 16 16" fill="none">
								<path
									d="M4 4l8 8M12 4l-8 8"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
								/>
							</svg>
						</button>
						<div class="card-body">
						<p class="card-title">{{ proto.title || home.untitledProto }}</p>
						<div class="card-meta">
							<span class="tag tag-style">{{ home.tagPrototype }}</span>
								<span class="tag tag-active">{{
									formatFileSize(proto.fileSize)
								}}</span>
							</div>
							<p class="card-time">{{ relativeTime(proto.updatedAt) }}</p>
						</div>
					</div>
				</div>
			</div>
		</main>
	</div>

	<!-- 模块管理弹窗 -->
	<ModuleManager
		:visible="showModuleManager"
		mode="modal"
		@confirm="onModuleManagerConfirm"
		@cancel="showModuleManager = false"
	/>

	<!-- 删除确认对话框 -->
	<ConfirmDialog
		:visible="!!deleteTarget"
		@confirm="doDelete"
		@cancel="cancelDelete"
	>
		{{ home.deleteConfirm({ name: deleteTarget?.title ?? "" }) }}
	</ConfirmDialog>
</template>

<style lang="scss" scoped>
	/* ── 整体布局 ── */
	.home-layout {
		display: flex;
		height: calc(100vh - 52px);
		overflow: hidden;
		background: var(--color-bg-secondary);
	}

	/* ── 左侧边栏 ── */
	.home-sidebar {
		width: 320px;
		flex-shrink: 0;
		background: var(--color-bg-primary);
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		padding: 0;
		overflow: hidden;
	}

	/* 类型导航 */
	.type-nav {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 12px 12px 8px;
	}

	.type-tab {
		padding: 5px 12px;
		border: none;
		background: transparent;
		border-radius: var(--radius-btn-sm);
		font-size: 13px;
		cursor: pointer;
		color: var(--color-text-secondary);
		transition: all 0.15s;
		white-space: nowrap;

		&:hover {
			background: var(--color-bg-tertiary);
		}

		&.active {
			background: #eef2ff;
			color: var(--color-primary);
			font-weight: 500;
		}
	}

	.sidebar-divider {
		height: 1px;
		background: var(--color-border);
		margin: 4px 0;
	}

	/* 新建 PRD 区块 */
	.create-section {
		padding: 16px 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.create-section-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.create-field {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.create-field-label {
		font-size: 11px;
		color: var(--color-text-muted);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.create-field-input {
		width: 100%;
		padding: 7px 10px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-btn-sm);
		background: var(--color-bg-secondary);
		font-size: 13px;
		color: var(--color-text-primary);
		outline: none;
		box-sizing: border-box;
		transition: border-color 0.15s;
		font-family: var(--font-family);

		&::placeholder {
			color: var(--color-text-muted);
		}

		&:focus {
			border-color: var(--color-primary);
			background: var(--color-bg-primary);
		}
	}

	.create-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		padding: 8px 14px;
		background: var(--color-primary);
		color: #fff;
		border: none;
		border-radius: var(--radius-btn-lg);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
		box-shadow: var(--shadow-float);

		&:hover {
			background: var(--color-primary-hover);
		}

		svg {
			width: 13px;
			height: 13px;
		}
	}

	/* ── 右侧内容区 ── */
	.home-main {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* 第二行子标题栏 */
	.main-subheader {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 24px;
		background: var(--color-bg-primary);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.view-pill-tabs {
		display: flex;
		gap: 4px;
		background: var(--color-bg-tertiary);
		border-radius: 8px;
		padding: 3px;
	}

	.view-pill {
		padding: 5px 14px;
		border: none;
		border-radius: 6px;
		font-size: 13px;
		cursor: pointer;
		color: var(--color-text-secondary);
		background: transparent;
		transition: all 0.15s;
		font-weight: 400;

		&:hover {
			color: var(--color-text-primary);
		}

		&.active {
			background: var(--color-primary);
			color: #fff;
			font-weight: 500;
		}
	}

	.main-tools {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: 20px;
		padding: 5px 12px;
		width: 180px;

		input {
			border: none;
			background: transparent;
			outline: none;
			font-size: 13px;
			color: var(--color-text-primary);
			width: 100%;
			font-family: var(--font-family);

			&::placeholder {
				color: var(--color-text-muted);
			}
		}
	}

	.search-icon {
		width: 13px;
		height: 13px;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.view-mode-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-btn-sm);
		background: var(--color-bg-primary);
		cursor: pointer;
		color: var(--color-text-muted);
		transition: all 0.15s;

		&:hover {
			color: var(--color-text-secondary);
			background: var(--color-bg-tertiary);
		}

		&.active {
			background: var(--color-primary);
			border-color: var(--color-primary);
			color: #fff;
		}

		svg {
			width: 15px;
			height: 15px;
		}
	}

	/* ── 内容区 ── */
	.content-area {
		flex: 1;
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		padding: 28px 24px;
	}

	/* ── 卡片网格 ── */
	.card-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 20px;

		@media (max-width: 1200px) {
			grid-template-columns: repeat(3, 1fr);
		}

		@media (max-width: 900px) {
			grid-template-columns: repeat(2, 1fr);
		}

		&.list-mode {
			grid-template-columns: 1fr;
			gap: 8px;

			.prd-card {
				display: flex;
				align-items: center;

				.card-preview {
					width: 80px;
					height: 60px;
					flex-shrink: 0;
				}

				.card-body {
					flex: 1;
					padding: 10px 14px;
				}
			}
		}
	}

	.prd-card {
		background: var(--color-bg-primary);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		overflow: hidden;
		cursor: pointer;
		transition:
			transform 0.15s,
			box-shadow 0.15s;
		position: relative;

		&:hover {
			transform: translateY(-2px);
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		}

		&:hover .card-delete-btn {
			opacity: 1;
			pointer-events: auto;
		}
	}

	.card-delete-btn {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: none;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(4px);
		color: #6b7280;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 0.15s,
			background 0.15s,
			color 0.15s;
		z-index: 10;
		padding: 0;

		&:hover {
			background: #fee2e2;
			color: #ef4444;
		}

		svg {
			width: 12px;
			height: 12px;
		}
	}

	.card-preview {
		height: 120px;
		display: flex;
		align-items: center;
		justify-content: center;

		span {
			font-size: 12px;
			color: rgba(0, 0, 0, 0.35);
		}
	}

	.card-body {
		padding: 12px 14px 14px;
	}

	.card-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 8px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-meta {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-bottom: 8px;
	}

	.tag {
		display: inline-block;
		padding: 2px 7px;
		border-radius: 4px;
		font-size: 11px;

		&-style {
			background: var(--color-bg-tertiary);
			color: var(--color-text-secondary);
		}

		&-active {
			background: #d1fae5;
			color: #065f46;
		}

		&-completed {
			background: #dbeafe;
			color: #1e40af;
		}

		&-failed {
			background: #fee2e2;
			color: #991b1b;
		}

		&-cancelled {
			background: var(--color-bg-tertiary);
			color: var(--color-text-muted);
		}
	}

	.card-time {
		font-size: 11px;
		color: var(--color-text-muted);
		margin: 0;
	}

	.empty-state {
		text-align: center;
		padding: 80px 0;
		color: var(--color-text-muted);

		.empty-icon {
			font-size: 48px;
			margin-bottom: 16px;
		}

		p {
			font-size: 14px;
		}
	}
</style>
