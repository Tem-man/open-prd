<script setup lang="ts">
	/**
	 * ModuleManager — 模块管理器
	 * 管理模块的添加、删除、排序
	 * 支持 modal 和 drawer 两种模式
	 * 支持拖拽排序
	 * 支持添加自定义模块
	 * 支持删除模块
	 * 支持保存模块配置
	 */

	import { ref, watch, computed, onMounted, onBeforeUnmount } from "vue";
	import { useI18n } from "@open-pencil/vue";
	import { useModulesStore } from "@/stores/modules";
	import type { ModuleTemplate } from "@/types";
	import ModuleBuilderPanel from "./ModuleBuilderPanel.vue";
	import SkillEditorPanel from "./SkillEditorPanel.vue";

	const props = defineProps<{
		visible: boolean;
		mode: "modal" | "drawer";
		initialSelected?: string[];
	}>();

	const emit = defineEmits<{
		confirm: [selectedModules: string[]];
		cancel: [];
	}>();

	const { module: t } = useI18n();
	const modulesStore = useModulesStore();

	const localSelected = ref<string[]>([]);
	const customModuleName = ref("");
	const customModuleDescription = ref("");
	const showAddInput = ref(false);
	const showAiBuilder = ref(false);
	const showAddMenu = ref(false);
	const addMenuRef = ref<HTMLElement | null>(null);
	const editingSkillModule = ref<ModuleTemplate | null>(null);
	const addError = ref("");
	const addLoading = ref(false);

	function onClickOutsideMenu(e: MouseEvent) {
		if (addMenuRef.value && !addMenuRef.value.contains(e.target as Node)) {
			showAddMenu.value = false;
		}
	}
	onMounted(() => document.addEventListener("mousedown", onClickOutsideMenu));
	onBeforeUnmount(() =>
		document.removeEventListener("mousedown", onClickOutsideMenu),
	);

	function openManualAdd() {
		showAddMenu.value = false;
		showAddInput.value = true;
	}
	function openAiBuilder() {
		showAddMenu.value = false;
		showAiBuilder.value = true;
	}
	function openImportSkill() {
		showAddMenu.value = false;
		triggerImportFile();
	}

	// 导入 Skill
	const importFileRef = ref<HTMLInputElement | null>(null);
	const showImportNameInput = ref(false);
	const importModuleName = ref("");
	const importPendingFile = ref<File | null>(null);
	const importLoading = ref(false);
	const importError = ref("");

	function triggerImportFile() {
		importFileRef.value?.click();
	}

	function onImportFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		if (!file.name.endsWith(".md")) {
			importError.value = t.value.uploadMdOnly;
			return;
		}
		importPendingFile.value = file;
		importModuleName.value = file.name
			.replace(/[-_]?skill\.md$/i, "")
			.replace(/[-_]/g, " ")
			.trim();
		showImportNameInput.value = true;
		importError.value = "";
		// 重置 input 以支持重复选同一文件
		if (importFileRef.value) importFileRef.value.value = "";
	}

	async function handleImportSkill() {
		if (!importPendingFile.value || !importModuleName.value.trim()) return;
		importLoading.value = true;
		importError.value = "";
		try {
			const newModule = await modulesStore.importSkill(
				importPendingFile.value,
				importModuleName.value.trim(),
			);
			localSelected.value = [...localSelected.value, newModule.id];
			showImportNameInput.value = false;
			importPendingFile.value = null;
			importModuleName.value = "";
		} catch (e) {
			importError.value = (e as Error).message;
		} finally {
			importLoading.value = false;
		}
	}

	// 拖拽排序状态
	const draggingIndex = ref<number | null>(null);
	const dragOverIndex = ref<number | null>(null);

	// 按 localSelected 顺序映射出完整模块对象
	const selectedModuleObjects = computed<ModuleTemplate[]>(() =>
		localSelected.value
			.map((id) => modulesStore.library.find((m) => m.id === id))
			.filter((m): m is ModuleTemplate => m !== undefined),
	);

	const confirmLabel = computed(() =>
		props.mode === "modal" ? t.value.confirmCreatePrd : t.value.saveConfig,
	);

	function isSelected(id: string) {
		return localSelected.value.includes(id);
	}

	function toggleModule(id: string) {
		if (isSelected(id)) {
			localSelected.value = localSelected.value.filter((v) => v !== id);
		} else {
			localSelected.value = [...localSelected.value, id];
		}
	}

	async function handleDeleteModule(m: ModuleTemplate) {
		try {
			await modulesStore.deleteModule(m.id);
			localSelected.value = localSelected.value.filter((id) => id !== m.id);
		} catch (e) {
			console.error(e);
		}
	}

	async function handleAddModule() {
		const name = customModuleName.value.trim();
		if (!name) {
			addError.value = t.value.nameRequired;
			return;
		}
		if (name.length > 50) {
			addError.value = t.value.nameTooLong;
			return;
		}
		const desc = customModuleDescription.value.trim();
		if (desc.length > 200) {
			addError.value = t.value.descTooLong;
			return;
		}
		addError.value = "";
		addLoading.value = true;
		try {
			const newModule = await modulesStore.addModule(name, desc || undefined);
			localSelected.value = [...localSelected.value, newModule.id];
			customModuleName.value = "";
			customModuleDescription.value = "";
			showAddInput.value = false;
		} catch (e) {
			addError.value = (e as Error).message;
		} finally {
			addLoading.value = false;
		}
	}

	async function handleBuilderDone(newModule: ModuleTemplate) {
		await modulesStore.fetchModules();
		localSelected.value = [...localSelected.value, newModule.id];
		showAiBuilder.value = false;
	}

	function openSkillEditor(m: ModuleTemplate) {
		editingSkillModule.value = m;
		showAddInput.value = false;
		showAiBuilder.value = false;
	}

	// 复制定制：复制官方 Skill 为用户副本并进入编辑
	const duplicatingId = ref<string | null>(null);
	const duplicateError = ref("");

	async function handleDuplicateSkill(m: ModuleTemplate) {
		duplicateError.value = "";
		duplicatingId.value = m.id;
		try {
			const copy = await modulesStore.duplicateSkill(m.id);
			localSelected.value = [...localSelected.value, copy.id];
			openSkillEditor(copy);
		} catch (e) {
			duplicateError.value = (e as Error).message;
		} finally {
			duplicatingId.value = null;
		}
	}

	function handleConfirm() {
		if (localSelected.value.length === 0) return;
		emit("confirm", [...localSelected.value]);
	}

	// 拖拽处理
	function onDragStart(index: number, e: DragEvent) {
		draggingIndex.value = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", String(index));
		}
	}

	function onDragOver(index: number, e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
		dragOverIndex.value = index;
	}

	function onDrop(targetIndex: number) {
		const fromIndex = draggingIndex.value;
		if (fromIndex === null || fromIndex === targetIndex) return;
		const arr = [...localSelected.value];
		const [moved] = arr.splice(fromIndex, 1);
		arr.splice(targetIndex, 0, moved);
		localSelected.value = arr;
		draggingIndex.value = null;
		dragOverIndex.value = null;
	}

	function onDragEnd() {
		draggingIndex.value = null;
		dragOverIndex.value = null;
	}

	// 打开时初始化
	watch(
		() => props.visible,
		async (val) => {
			if (!val) return;
			await modulesStore.fetchModules();
			if (props.initialSelected && props.initialSelected.length > 0) {
				localSelected.value = [...props.initialSelected];
			} else {
				localSelected.value = modulesStore.library
					.filter((m) => m.isBuiltin)
					.map((m) => m.id);
			}
			showAddInput.value = false;
			showAiBuilder.value = false;
			showAddMenu.value = false;
			editingSkillModule.value = null;
			customModuleName.value = "";
			customModuleDescription.value = "";
			addError.value = "";
			duplicateError.value = "";
			duplicatingId.value = null;
		},
	);
</script>

<template>
	<Teleport to="body">
		<!-- 遮罩 -->
		<Transition name="mm-mask">
			<div
				v-if="visible"
				class="mm-mask"
				:class="{ 'mm-mask--modal': mode === 'modal' }"
				@click="mode === 'modal' ? emit('cancel') : undefined"
			/>
		</Transition>

		<!-- 容器：modal 居中 | drawer 右侧抽屉 -->
		<Transition :name="mode === 'modal' ? 'mm-modal' : 'drawer-slide'">
			<div
				v-if="visible"
				class="mm-container"
				:class="mode === 'modal' ? 'mm-modal' : 'mm-drawer'"
				role="dialog"
				:aria-label="t.title"
			>
				<!-- Header -->
				<div class="mm-header">
					<div class="mm-header-left">
						<svg class="mm-header-icon" viewBox="0 0 18 18" fill="none">
							<rect
								x="2"
								y="2"
								width="6"
								height="6"
								rx="1.5"
								stroke="currentColor"
								stroke-width="1.5"
							/>
							<rect
								x="10"
								y="2"
								width="6"
								height="6"
								rx="1.5"
								stroke="currentColor"
								stroke-width="1.5"
							/>
							<rect
								x="2"
								y="10"
								width="6"
								height="6"
								rx="1.5"
								stroke="currentColor"
								stroke-width="1.5"
							/>
							<rect
								x="10"
								y="10"
								width="6"
								height="6"
								rx="1.5"
								stroke="currentColor"
								stroke-width="1.5"
							/>
						</svg>
						<div>
							<p class="mm-header-title">{{ t.title }}</p>
							<p class="mm-header-sub">{{ t.subtitle }}</p>
						</div>
					</div>
					<button class="mm-close" @click="emit('cancel')">
						<svg viewBox="0 0 16 16" fill="none">
							<path
								d="M4 4l8 8M12 4l-8 8"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
							/>
						</svg>
					</button>
				</div>

				<!-- Body -->
				<div class="mm-body">
					<!-- 右：已选模块（拖拽排序） -->
					<div class="mm-selected">
					<p class="mm-panel-label">
						{{ t.selected }} <span class="mm-count">{{ localSelected.length }}</span>
					</p>

						<div
							class="mm-selected-list"
							v-if="selectedModuleObjects.length > 0"
						>
							<div
								v-for="(m, i) in selectedModuleObjects"
								:key="m.id"
								class="mm-sel-item"
								:class="{
									dragging: draggingIndex === i,
									'drag-over': dragOverIndex === i && draggingIndex !== i,
								}"
								draggable="true"
								@dragstart="onDragStart(i, $event)"
								@dragover="onDragOver(i, $event)"
								@drop="onDrop(i)"
								@dragend="onDragEnd"
							>
								<span class="mm-drag-handle" :title="t.dragToSort">
									<svg viewBox="0 0 14 18" fill="none">
										<circle cx="4" cy="3" r="1.5" fill="#94a3b8" />
										<circle cx="10" cy="3" r="1.5" fill="#94a3b8" />
										<circle cx="4" cy="9" r="1.5" fill="#94a3b8" />
										<circle cx="10" cy="9" r="1.5" fill="#94a3b8" />
										<circle cx="4" cy="15" r="1.5" fill="#94a3b8" />
										<circle cx="10" cy="15" r="1.5" fill="#94a3b8" />
									</svg>
								</span>
								<span class="mm-sel-idx">{{ i + 1 }}</span>
								<span class="mm-sel-name">{{ m.name }}</span>
							<span v-if="!m.isBuiltin" class="mm-tag mm-tag--custom"
								>{{ t.custom }}</span
							>
							<button
								class="mm-sel-remove"
								:title="t.remove"
									@click="toggleModule(m.id)"
								>
									<svg viewBox="0 0 12 12" fill="none">
										<path
											d="M2 2l8 8M10 2l-8 8"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
										/>
									</svg>
								</button>
							</div>
						</div>

						<div v-else class="mm-selected-empty">
							<svg viewBox="0 0 48 48" fill="none">
								<circle
									cx="24"
									cy="24"
									r="22"
									stroke="#e2e8f0"
									stroke-width="2"
								/>
								<path
									d="M16 24h16M24 16v16"
									stroke="#cbd5e1"
									stroke-width="2.5"
									stroke-linecap="round"
								/>
							</svg>
						<p>{{ t.selectAtLeastOne }}</p>
					</div>
				</div>

				<!-- 左：模块库 -->
				<div class="mm-library">
					<p class="mm-panel-label">{{ t.library }}</p>

						<div class="mm-library-list">
							<div
								v-for="m in modulesStore.library"
								:key="m.id"
								class="mm-lib-item"
								:class="{ selected: isSelected(m.id) }"
								@click="toggleModule(m.id)"
							>
								<!-- 勾选图标 -->
								<span class="mm-check">
									<svg v-if="isSelected(m.id)" viewBox="0 0 16 16" fill="none">
										<circle cx="8" cy="8" r="7" fill="#4F46E5" />
										<path
											d="M5 8l2.5 2.5L11 5.5"
											stroke="#fff"
											stroke-width="1.6"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
									<svg v-else viewBox="0 0 16 16" fill="none">
										<circle
											cx="8"
											cy="8"
											r="7"
											stroke="#cbd5e1"
											stroke-width="1.5"
										/>
									</svg>
								</span>

								<span class="mm-lib-name-wrap">
									<span class="mm-lib-name">{{ m.name }}</span>
									<span v-if="m.description" class="mm-lib-desc">{{
										m.description
									}}</span>
								</span>

								<span
									class="mm-tag"
									:class="m.isBuiltin ? 'mm-tag--builtin' : 'mm-tag--custom'"
								>
									{{ m.isBuiltin ? t.builtin : t.custom }}
								</span>

								<!-- 编辑 Skill 按钮（仅有 skillName 的自定义模块） -->
								<button
									v-if="!m.isBuiltin && m.skillName"
									class="mm-skill-btn"
									:title="t.editSkill"
									@click.stop="openSkillEditor(m)"
								>
									<svg viewBox="0 0 14 14" fill="none">
										<path
											d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"
											stroke="currentColor"
											stroke-width="1.3"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</button>

							<!-- 复制定制按钮（官方内置模块：Skill 只读，先复制为用户副本再编辑） -->
								<button
									v-else-if="m.isBuiltin && m.skillName"
									class="mm-skill-btn"
									:title="duplicatingId === m.id ? t.duplicating : t.duplicateSkill"
									:disabled="duplicatingId !== null"
									@click.stop="handleDuplicateSkill(m)"
								>
									<svg viewBox="0 0 14 14" fill="none">
										<rect
											x="5"
											y="5"
											width="7"
											height="7"
											rx="1.5"
											stroke="currentColor"
											stroke-width="1.3"
										/>
										<path
											d="M2 9V2.5A.5.5 0 012.5 2H9"
											stroke="currentColor"
											stroke-width="1.3"
											stroke-linecap="round"
										/>
									</svg>
								</button>

								<!-- 删除按钮（仅自定义） -->
								<button
									v-if="!m.isBuiltin"
									class="mm-del-btn"
									:title="t.remove"
									@click.stop="handleDeleteModule(m)"
								>
									<svg viewBox="0 0 14 14" fill="none">
										<path
											d="M3 3l8 8M11 3l-8 8"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
										/>
									</svg>
								</button>
							</div>
						</div>
						<p v-if="duplicateError" class="mm-add-error mm-duplicate-error">
							{{ duplicateError }}
						</p>

						<!-- Skill 编辑面板 -->
						<div v-if="editingSkillModule" class="mm-skill-editor-area">
							<SkillEditorPanel
								:module-id="editingSkillModule.id"
								:module-name="editingSkillModule.name"
								@close="editingSkillModule = null"
							/>
						</div>

						<!-- 添加自定义模块 -->
						<div v-if="!editingSkillModule" class="mm-add-area">
							<!-- 隐藏的文件输入 -->
							<input
								ref="importFileRef"
								type="file"
								accept=".md"
								style="display: none"
								@change="onImportFileChange"
							/>

							<!-- 添加入口：单按钮 + 上弹下拉菜单 -->
							<div
								v-if="!showAddInput && !showAiBuilder && !showImportNameInput"
								ref="addMenuRef"
								class="mm-add-menu-wrap"
							>
								<button
									class="mm-add-main-btn"
									@click="showAddMenu = !showAddMenu"
								>
									<svg viewBox="0 0 14 14" fill="none">
										<path
											d="M7 2v10M2 7h10"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
										/>
									</svg>
									<span>{{ t.addModule }}</span>
									<svg
										class="mm-add-caret"
										:class="{ open: showAddMenu }"
										viewBox="0 0 10 6"
										fill="none"
									>
										<path
											d="M1 5L5 1l4 4"
											stroke="currentColor"
											stroke-width="1.4"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</button>

								<Transition name="mm-menu">
									<div v-if="showAddMenu" class="mm-add-dropdown">
										<button class="mm-dropdown-item" @click="openManualAdd">
											<svg viewBox="0 0 14 14" fill="none">
												<path
													d="M2 7h10M7 2v10"
													stroke="currentColor"
													stroke-width="1.4"
													stroke-linecap="round"
												/>
											</svg>
											<span>
												<strong>{{ t.addManual }}</strong>
												<em>{{ t.addManualDesc }}</em>
											</span>
										</button>
										<button
											class="mm-dropdown-item mm-dropdown-item--ai"
											@click="openAiBuilder"
										>
											<svg viewBox="0 0 14 14" fill="none">
												<circle
													cx="7"
													cy="7"
													r="5.5"
													stroke="currentColor"
													stroke-width="1.3"
												/>
												<path
													d="M5 7l1.5 1.5L9 5"
													stroke="currentColor"
													stroke-width="1.3"
													stroke-linecap="round"
													stroke-linejoin="round"
												/>
											</svg>
											<span>
												<strong>{{ t.addWithAI }}</strong>
												<em>{{ t.addWithAIDesc }}</em>
											</span>
										</button>
										<button
											class="mm-dropdown-item mm-dropdown-item--import"
											@click="openImportSkill"
										>
											<svg viewBox="0 0 14 14" fill="none">
												<path
													d="M7 1v8M4 6l3 3 3-3"
													stroke="currentColor"
													stroke-width="1.4"
													stroke-linecap="round"
													stroke-linejoin="round"
												/>
												<path
													d="M2 11h10"
													stroke="currentColor"
													stroke-width="1.4"
													stroke-linecap="round"
												/>
											</svg>
											<span>
												<strong>{{ t.importSkill }}</strong>
												<em>{{ t.importSkillDesc }}</em>
											</span>
										</button>
									</div>
								</Transition>
							</div>

							<!-- 导入：填写模块名称 -->
							<div v-if="showImportNameInput" class="mm-add-form">
							<p class="mm-import-hint">
								{{ t.importSelected({ name: importPendingFile?.name ?? "" }) }}
							</p>
								<div class="mm-add-fields">
									<input
										v-model="importModuleName"
										class="mm-add-input"
										:placeholder="t.namePlaceholder"
										maxlength="50"
										autofocus
										@keydown.enter="handleImportSkill"
										@keydown.esc="
											showImportNameInput = false;
											importPendingFile = null;
										"
									/>
								</div>
								<div class="mm-add-actions">
									<button
										class="mm-add-btn"
										:disabled="importLoading || !importModuleName.trim()"
										@click="handleImportSkill"
									>
										{{ importLoading ? t.importing : t.importConfirm }}
									</button>
									<button
										class="mm-add-cancel"
										@click="
											showImportNameInput = false;
											importPendingFile = null;
											importError = '';
										"
									>
										{{ t.cancel }}
									</button>
								</div>
								<p v-if="importError" class="mm-add-error">{{ importError }}</p>
							</div>

							<!-- AI 引导面板 -->
							<ModuleBuilderPanel
								v-if="showAiBuilder"
								@done="handleBuilderDone"
								@cancel="showAiBuilder = false"
							/>

							<!-- 手动添加表单 -->
							<div v-if="showAddInput && !showAiBuilder" class="mm-add-form">
								<div class="mm-add-fields">
									<input
										v-model="customModuleName"
										class="mm-add-input"
										:placeholder="t.namePlaceholder"
										maxlength="50"
										autofocus
										@keydown.enter="handleAddModule"
										@keydown.esc="
											showAddInput = false;
											customModuleDescription = '';
											addError = '';
										"
									/>
									<textarea
										v-model="customModuleDescription"
										class="mm-add-textarea"
										:placeholder="t.descPlaceholder"
										maxlength="200"
										rows="3"
										@keydown.esc="
											showAddInput = false;
											customModuleDescription = '';
											addError = '';
										"
									/>
								</div>
								<div class="mm-add-actions">
									<button
										class="mm-add-btn"
										:disabled="addLoading || !customModuleName.trim()"
										@click="handleAddModule"
									>
										{{ addLoading ? "…" : t.add }}
									</button>
									<button
										class="mm-add-cancel"
										@click="
											showAddInput = false;
											customModuleDescription = '';
											addError = '';
										"
									>
										{{ t.cancel }}
									</button>
								</div>
							</div>
							<p v-if="addError" class="mm-add-error">{{ addError }}</p>
						</div>
					</div>
				</div>

				<!-- Footer -->
				<div class="mm-footer">
					<button class="mm-btn-cancel" @click="emit('cancel')">{{ t.cancel }}</button>
					<button
						class="mm-btn-confirm"
						:disabled="localSelected.length === 0"
						@click="handleConfirm"
					>
						{{ confirmLabel }}
					</button>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style lang="scss">
	/* ── 遮罩 ─────────────────────────────────────────────────────────────────── */
	.mm-mask {
		position: fixed;
		inset: 0;
		z-index: 400;
		background: rgba(0, 0, 0, 0.28);

		&--modal {
			background: rgba(0, 0, 0, 0.45);
		}
	}

	.mm-mask-enter-active,
	.mm-mask-leave-active {
		transition: opacity 0.22s ease;
	}
	.mm-mask-enter-from,
	.mm-mask-leave-to {
		opacity: 0;
	}

	/* ── 容器：modal ──────────────────────────────────────────────────────────── */
	.mm-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 780px;
		max-width: calc(100vw - 32px);
		max-height: calc(100vh - 64px);
		background: #fff;
		border-radius: 12px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
		z-index: 401;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.mm-modal-enter-active,
	.mm-modal-leave-active {
		transition:
			opacity 0.22s ease,
			transform 0.22s ease;
	}
	.mm-modal-enter-from,
	.mm-modal-leave-to {
		opacity: 0;
		transform: translate(-50%, calc(-50% + 12px));
	}

	/* ── 容器：drawer ─────────────────────────────────────────────────────────── */
	.mm-drawer {
		position: fixed;
		top: 0;
		right: 0;
		width: 760px;
		max-width: 100vw;
		height: 100vh;
		background: #fff;
		box-shadow: -6px 0 32px rgba(0, 0, 0, 0.12);
		z-index: 401;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* 复用 HistoryDrawer 同款动画 */
	.drawer-slide-enter-active,
	.drawer-slide-leave-active {
		transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.drawer-slide-enter-from,
	.drawer-slide-leave-to {
		transform: translateX(100%);
	}

	/* ── Header ──────────────────────────────────────────────────────────────── */
	.mm-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid #e2e8f0;
		flex-shrink: 0;
	}
	.mm-header-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.mm-header-icon {
		width: 20px;
		height: 20px;
		color: #4f46e5;
		flex-shrink: 0;
	}
	.mm-header-title {
		font-size: 15px;
		font-weight: 600;
		color: #1e293b;
		margin: 0;
	}
	.mm-header-sub {
		font-size: 12px;
		color: #94a3b8;
		margin: 2px 0 0;
	}
	.mm-close {
		width: 30px;
		height: 30px;
		border: none;
		background: transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		color: #94a3b8;
		transition: background 0.15s;
		flex-shrink: 0;
		padding: 0;

		&:hover {
			background: #f1f5f9;
			color: #1e293b;
		}
		svg {
			width: 14px;
			height: 14px;
		}
	}

	/* ── Body ────────────────────────────────────────────────────────────────── */
	.mm-body {
		display: flex;
		// flex: 1;
		height: 480px;
		overflow: auto;
	}

	.mm-panel-label {
		font-size: 12px;
		font-weight: 600;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 1px 16px 1px;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.mm-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: #4f46e5;
		color: #fff;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0;
	}

	/* ── 左：模块库 ──────────────────────────────────────────────────────────── */
	.mm-library {
		padding-right: 16px;
		width: 340px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
	}
	.mm-library-list {
		flex: 1;
		overflow-y: auto;
		padding: 4px 0;
		scrollbar-width: thin;
		scrollbar-color: #e2e8f0 transparent;
	}

	.mm-lib-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 16px;
		cursor: pointer;
		transition: background 0.12s;
		border-bottom: 1px solid #f8fafc;

		&:hover {
			background: #f8fafc;
		}
		&.selected {
			background: #eef2ff;
		}
		&:last-child {
			border-bottom: none;
		}
	}
	.mm-check {
		flex-shrink: 0;
		svg {
			width: 16px;
			height: 16px;
			display: block;
		}
	}
	.mm-lib-name-wrap {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow: hidden;
	}
	.mm-lib-name {
		font-size: 13px;
		color: #1e293b;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mm-lib-desc {
		font-size: 11px;
		color: #94a3b8;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mm-tag {
		display: inline-flex;
		align-items: center;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 10px;
		font-weight: 500;
		flex-shrink: 0;

		&--builtin {
			background: #f1f5f9;
			color: #94a3b8;
		}
		&--custom {
			background: #ede9fe;
			color: #7c3aed;
		}
	}
	.mm-skill-btn {
		width: 22px;
		height: 22px;
		border: none;
		background: transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		color: #94a3b8;
		transition:
			background 0.12s,
			color 0.12s;
		flex-shrink: 0;
		padding: 0;

		&:hover {
			background: #eef2ff;
			color: #4f46e5;
		}
		svg {
			width: 12px;
			height: 12px;
		}
	}

	.mm-del-btn {
		width: 22px;
		height: 22px;
		border: none;
		background: transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		color: #94a3b8;
		transition:
			background 0.12s,
			color 0.12s;
		flex-shrink: 0;
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

	.mm-skill-editor-area {
		padding: 10px 16px 12px;
		border-top: 1px solid #e2e8f0;
	}

	.mm-duplicate-error {
		padding: 4px 16px 0;
		margin: 0;
	}

	/* ── 添加区 ──────────────────────────────────────────────────────────────── */
	.mm-add-area {
		padding: 10px 16px 12px;
		border-top: 1px solid #e2e8f0;
		flex-shrink: 0;
	}
	/* ── 添加模块：下拉菜单 ── */
	.mm-add-menu-wrap {
		position: relative;
	}

	.mm-add-main-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		border: 1px dashed #c7d2fe;
		border-radius: 6px;
		background: transparent;
		color: #4f46e5;
		font-size: 13px;
		cursor: pointer;
		width: 100%;
		transition: background 0.12s;
		font-family: var(--font-family);

		&:hover {
			background: #eef2ff;
		}

		svg:first-child {
			width: 12px;
			height: 12px;
			flex-shrink: 0;
		}

		// 把箭头推到最右
		span {
			flex: 1;
			text-align: left;
		}
	}

	.mm-add-caret {
		width: 10px;
		height: 6px;
		flex-shrink: 0;
		color: #a5b4fc;
		transition: transform 0.18s ease;
		margin-left: auto;

		&.open {
			transform: rotate(180deg);
		}
	}

	.mm-add-dropdown {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		right: 0;
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		box-shadow:
			0 4px 16px rgba(0, 0, 0, 0.1),
			0 1px 4px rgba(0, 0, 0, 0.06);
		z-index: 10;
		overflow: hidden;
	}

	.mm-dropdown-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		border: none;
		background: transparent;
		cursor: pointer;
		width: 100%;
		text-align: left;
		transition: background 0.1s;
		font-family: var(--font-family);

		& + & {
			border-top: 1px solid #f1f5f9;
		}

		&:hover {
			background: #f8fafc;
		}

		svg {
			width: 14px;
			height: 14px;
			flex-shrink: 0;
			color: #64748b;
		}

		span {
			display: flex;
			flex-direction: column;
			gap: 1px;

			strong {
				font-size: 13px;
				font-weight: 500;
				color: #1e293b;
				display: block;
			}

			em {
				font-size: 11px;
				color: #94a3b8;
				font-style: normal;
				display: block;
			}
		}

		&--ai {
			svg {
				color: #4f46e5;
			}
			&:hover {
				background: #f5f3ff;
			}
		}

		&--import {
			svg {
				color: #0369a1;
			}
			&:hover {
				background: #f0f9ff;
			}
		}
	}

	/* 下拉动画 */
	.mm-menu-enter-active,
	.mm-menu-leave-active {
		transition:
			opacity 0.15s ease,
			transform 0.15s ease;
	}
	.mm-menu-enter-from,
	.mm-menu-leave-to {
		opacity: 0;
		transform: translateY(6px);
	}

	.mm-import-hint {
		font-size: 11px;
		color: var(--color-text-muted);
		margin-bottom: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mm-add-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.mm-add-fields {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.mm-add-actions {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.mm-add-input {
		flex: 1;
		height: 38px;
		padding: 0 12px;
		border: 1px solid #4f46e5;
		border-radius: 6px;
		font-size: 13px;
		color: #1e293b;
		outline: none;
		background: #fff;
		box-sizing: border-box;

		&:focus {
			box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
		}
	}
	.mm-add-textarea {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid #e2e8f0;
		border-radius: 6px;
		font-size: 13px;
		color: #475569;
		outline: none;
		background: #fff;
		resize: vertical;
		min-height: 82px;
		font-family: inherit;
		line-height: 1.5;
		box-sizing: border-box;

		&::placeholder {
			color: #94a3b8;
		}
		&:focus {
			border-color: #4f46e5;
			box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
		}
	}
	.mm-add-btn {
		height: 32px;
		padding: 0 12px;
		background: #4f46e5;
		color: #fff;
		border: none;
		border-radius: 6px;
		font-size: 13px;
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.15s;

		&:hover:not(:disabled) {
			background: #4338ca;
		}
		&:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
	}
	.mm-add-cancel {
		height: 32px;
		padding: 0 10px;
		background: transparent;
		color: #64748b;
		border: 1px solid #e2e8f0;
		border-radius: 6px;
		font-size: 13px;
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.12s;

		&:hover {
			background: #f1f5f9;
		}
	}
	.mm-add-error {
		font-size: 12px;
		color: #ef4444;
		margin: 6px 0 0;
	}

	/* ── 右：已选模块 ────────────────────────────────────────────────────────── */
	.mm-selected {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-right: 1px solid #e2e8f0;
	}
	.mm-selected-list {
		flex: 1;
		overflow-y: auto;
		padding: 4px 0;
		scrollbar-width: thin;
		scrollbar-color: #e2e8f0 transparent;
	}

	.mm-sel-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 16px;
		border-bottom: 1px solid #f8fafc;
		transition:
			background 0.12s,
			opacity 0.12s;
		user-select: none;

		&:last-child {
			border-bottom: none;
		}
		&.dragging {
			opacity: 0.45;
		}
		&.drag-over {
			background: #eef2ff;
			border-top: 2px solid #4f46e5;
		}
	}
	.mm-drag-handle {
		cursor: grab;
		flex-shrink: 0;
		color: #94a3b8;
		display: flex;
		align-items: center;

		&:active {
			cursor: grabbing;
		}
		svg {
			width: 14px;
			height: 18px;
		}
	}
	.mm-sel-idx {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 10px;
		font-weight: 600;
		color: #64748b;
		flex-shrink: 0;
	}
	.mm-sel-name {
		flex: 1;
		font-size: 13px;
		color: #1e293b;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mm-sel-remove {
		width: 22px;
		height: 22px;
		border: none;
		background: transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		color: #94a3b8;
		transition:
			background 0.12s,
			color 0.12s;
		flex-shrink: 0;
		padding: 0;
		opacity: 0;

		.mm-sel-item:hover & {
			opacity: 1;
		}
		&:hover {
			background: #fee2e2;
			color: #ef4444;
		}
		svg {
			width: 11px;
			height: 11px;
		}
	}

	.mm-selected-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		color: #94a3b8;
		font-size: 13px;
		padding: 24px;
		text-align: center;

		svg {
			width: 52px;
			height: 52px;
		}
	}

	/* ── Footer ──────────────────────────────────────────────────────────────── */
	.mm-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		padding: 14px 20px;
		border-top: 1px solid #e2e8f0;
		flex-shrink: 0;
		background: #f8fafc;
	}
	.mm-btn-cancel {
		height: 36px;
		padding: 0 16px;
		background: transparent;
		color: #64748b;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		font-size: 14px;
		cursor: pointer;
		transition: background 0.15s;

		&:hover {
			background: #f1f5f9;
		}
	}
	.mm-btn-confirm {
		height: 36px;
		padding: 0 20px;
		background: #4f46e5;
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
		box-shadow: 0 1px 3px rgba(79, 70, 229, 0.3);

		&:hover:not(:disabled) {
			background: #4338ca;
		}
		&:disabled {
			opacity: 0.45;
			cursor: not-allowed;
			box-shadow: none;
		}
	}
</style>
