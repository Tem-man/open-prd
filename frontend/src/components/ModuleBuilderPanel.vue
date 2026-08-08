<script setup lang="ts">
	import { ref, computed } from "vue";
	import QuestionForm from "./QuestionForm.vue";
	import type {
		QuestionForm as QuestionFormType,
		ModuleTemplate,
	} from "@/types";

	const emit = defineEmits<{
		done: [module: ModuleTemplate];
		cancel: [];
	}>();

	// ── 状态机 ──────────────────────────────────────────────────────────────────
	type Step = "input" | "points" | "format" | "preview";
	const step = ref<Step>("input");
	const loading = ref(false);
	const error = ref("");

	// ── 收集的数据 ───────────────────────────────────────────────────────────────
	const moduleName = ref("");
	const userDescription = ref("");
	const suggestedPoints = ref<string[]>([]);
	const selectedPoints = ref<string[]>([]);
	const customPointInput = ref("");
	const selectedFormat = ref("");
	const skillName = ref("");
	const skillContent = ref("");

	// ── 第一步表单（模块名 + 描述）──────────────────────────────────────────────
	const inputForm = computed<QuestionFormType>(() => ({
		questions: [
			{
				id: "name",
				label: "模块名称",
				type: "text",
				required: true,
				placeholder: "例：竞品分析、风险矩阵、上线计划…",
			},
			{
				id: "desc",
				label: "描述一下你想要这个模块展示什么内容",
				type: "text",
				required: true,
				placeholder:
					"例：对比主要竞品的核心功能、定价和优劣势，帮助团队了解市场格局",
			},
		],
	}));

	// ── 第二步表单（内容要点多选）───────────────────────────────────────────────
	const pointsForm = computed<QuestionFormType>(() => ({
		questions: [
			{
				id: "points",
				label: "AI 建议的内容要点（可多选，可手动增删）",
				type: "multi_choice",
				required: true,
				options: suggestedPoints.value,
			},
		],
	}));

	// 不预选任何要点，让用户主动勾选
	const pointsDefaultAnswers = computed(() => ({
		points: [] as string[],
	}));

	// ── 第三步表单（展示形式单选）───────────────────────────────────────────────
	const FORMAT_OPTIONS = ["文段", "表格", "文段+表格", "Mermaid图", "思维导图"];

	const formatForm = computed<QuestionFormType>(() => ({
		questions: [
			{
				id: "format",
				label: "选择展示形式",
				type: "single_choice",
				required: true,
				options: FORMAT_OPTIONS,
			},
		],
	}));

	// ── 步骤处理函数 ─────────────────────────────────────────────────────────────

	function parseAnswers(answersText: string): Record<string, string> {
		const result: Record<string, string> = {};
		answersText.split("\n").forEach((line) => {
			const colonIdx = line.indexOf("：");
			if (colonIdx > 0) {
				const key = line.slice(0, colonIdx).trim();
				const val = line.slice(colonIdx + 1).trim();
				// "（未填写）" 统一转为空字符串
				result[key] = val === "（未填写）" ? "" : val;
			}
		});
		return result;
	}

	async function handleInputSubmit(answersText: string) {
		const parsed = parseAnswers(answersText);
		moduleName.value = parsed["模块名称"] || "";
		userDescription.value = parsed["描述一下你想要这个模块展示什么内容"] || "";

		if (!moduleName.value) {
			error.value = "请填写模块名称";
			return;
		}
		if (!userDescription.value) {
			error.value = "请描述一下这个模块展示的内容";
			return;
		}

		loading.value = true;
		error.value = "";
		try {
			const res = await fetch("/api/modules/suggest-points", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					moduleName: moduleName.value,
					userDescription: userDescription.value,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || "请求失败");
			suggestedPoints.value = data.points ?? [];
			// 如果 API 返回空，给一个默认要点防止空表单
			if (suggestedPoints.value.length === 0) {
				suggestedPoints.value = ["请手动输入内容要点"];
			}
			selectedPoints.value = [...suggestedPoints.value];
			step.value = "points";
		} catch (e) {
			error.value = (e as Error).message;
		} finally {
			loading.value = false;
		}
	}

	function handlePointsSubmit(answersText: string) {
		const parsed = parseAnswers(answersText);
		const raw = parsed["AI 建议的内容要点（可多选，可手动增删）"] || "";
		selectedPoints.value = raw
			.split("、")
			.map((p) => p.trim())
			.filter(Boolean);
		if (selectedPoints.value.length === 0) {
			error.value = "请至少选择一个内容要点";
			return;
		}
		error.value = "";
		step.value = "format";
	}

	function addCustomPoint() {
		const pt = customPointInput.value.trim();
		if (!pt) return;
		if (!suggestedPoints.value.includes(pt)) {
			suggestedPoints.value = [...suggestedPoints.value, pt];
			selectedPoints.value = [...selectedPoints.value, pt];
		}
		customPointInput.value = "";
	}

	function handleFormatSubmit(answersText: string) {
		const parsed = parseAnswers(answersText);
		selectedFormat.value = parsed["选择展示形式"] || "";
		if (!selectedFormat.value) return;
		buildSkill();
	}

	const FORMAT_TO_RENDER_TYPE: Record<string, string> = {
		文段: "html",
		表格: "table",
		"文段+表格": "html+table",
		Mermaid图: "mermaid",
		思维导图: "markmap",
	};

	async function buildSkill() {
		loading.value = true;
		error.value = "";
		try {
			const res = await fetch("/api/modules/build-skill", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					moduleName: moduleName.value,
					userDescription: userDescription.value,
					confirmedPoints: selectedPoints.value,
					renderType: FORMAT_TO_RENDER_TYPE[selectedFormat.value] || "html",
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || "生成失败");
			skillName.value = data.skillName;
			skillContent.value = data.skillContent;
			step.value = "preview";
		} catch (e) {
			error.value = (e as Error).message;
		} finally {
			loading.value = false;
		}
	}

	async function confirmSkill() {
		loading.value = true;
		error.value = "";
		try {
			const res = await fetch("/api/modules/confirm-skill", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: moduleName.value,
					description: userDescription.value.slice(0, 200),
					skillName: skillName.value,
					skillContent: skillContent.value,
					renderType: FORMAT_TO_RENDER_TYPE[selectedFormat.value] || "html",
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || "创建失败");
			emit("done", data as ModuleTemplate);
		} catch (e) {
			error.value = (e as Error).message;
		} finally {
			loading.value = false;
		}
	}

	function goBack() {
		error.value = "";
		if (step.value === "points") step.value = "input";
		else if (step.value === "format") step.value = "points";
		else if (step.value === "preview") step.value = "format";
	}

	// 步骤标题
	const STEP_LABELS: Record<Step, string> = {
		input: "1 / 3  描述模块",
		points: "2 / 3  确认要点",
		format: "3 / 3  选择形式",
		preview: "预览 Skill 规范",
	};
</script>

<template>
	<div class="mb-panel">
		<!-- 顶部进度与返回 -->
		<div class="mb-header">
			<button
				class="mb-back-btn"
				:disabled="loading"
				@click="step === 'input' ? emit('cancel') : goBack()"
			>
				← 返回
			</button>
			<span class="mb-step-label">{{ STEP_LABELS[step] }}</span>
		</div>

		<!-- 错误提示 -->
		<p v-if="error" class="mb-error">{{ error }}</p>

		<!-- step: input -->
		<QuestionForm
			v-if="step === 'input'"
			:form="inputForm"
			:disabled="loading"
			submit-label="AI 分析内容要点 →"
			hint-text=""
			@submit="handleInputSubmit"
		/>

		<!-- step: points -->
		<template v-if="step === 'points'">
			<QuestionForm
				:form="pointsForm"
				:default-answers="pointsDefaultAnswers"
				:disabled="loading"
				submit-label="确认要点，选择展示形式 →"
				hint-text=""
				@submit="handlePointsSubmit"
			/>
			<!-- 手动添加要点 -->
			<div class="mb-add-point">
				<input
					v-model="customPointInput"
					class="mb-point-input"
					placeholder="+ 手动添加要点"
					maxlength="40"
					@keydown.enter.prevent="addCustomPoint"
				/>
				<button
					class="mb-point-add-btn"
					:disabled="!customPointInput.trim()"
					@click="addCustomPoint"
				>
					添加
				</button>
			</div>
		</template>

		<!-- step: format -->
		<QuestionForm
			v-if="step === 'format'"
			:form="formatForm"
			:disabled="loading"
			submit-label="生成 Skill 规范 →"
			hint-text=""
			@submit="handleFormatSubmit"
		/>

		<!-- step: preview -->
		<template v-if="step === 'preview'">
			<div class="mb-preview-wrap">
				<pre class="mb-skill-preview">{{ skillContent }}</pre>
			</div>
			<div class="mb-preview-actions">
				<button class="mb-regen-btn" :disabled="loading" @click="buildSkill">
					{{ loading ? "生成中…" : "← 重新生成" }}
				</button>
				<button
					class="mb-confirm-btn"
					:disabled="loading"
					@click="confirmSkill"
				>
					{{ loading ? "创建中…" : "确认，创建模块 ✓" }}
				</button>
			</div>
		</template>

		<!-- loading 遮罩提示 -->
		<div v-if="loading && step !== 'preview'" class="mb-loading">
			<span class="mb-loading-dot" />
			<span>AI 分析中，请稍候…</span>
		</div>
	</div>
</template>

<style lang="scss" scoped>
	.mb-panel {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* ── 顶部进度 ── */
	.mb-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 2px;
	}

	.mb-step-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-muted);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.mb-back-btn {
		font-size: 12px;
		color: #4f46e5;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 4px;
		transition: background 0.12s;

		&:hover:not(:disabled) {
			background: #eef2ff;
		}

		&:disabled {
			opacity: 0.5;
			cursor: default;
		}
	}

	/* ── 错误 ── */
	.mb-error {
		font-size: 12px;
		color: #ef4444;
		padding: 0 2px;
	}

	/* ── 手动添加要点 ── */
	.mb-add-point {
		display: flex;
		gap: 6px;
		padding: 0 2px;
	}

	.mb-point-input {
		flex: 1;
		height: 30px;
		padding: 0 10px;
		border: 1px dashed #c7d2fe;
		border-radius: 6px;
		font-size: 12px;
		color: var(--color-text-primary);
		background: transparent;
		outline: none;
		font-family: var(--font-family);

		&::placeholder {
			color: var(--color-text-muted);
		}

		&:focus {
			border-color: #4f46e5;
			background: #fff;
		}
	}

	.mb-point-add-btn {
		height: 30px;
		padding: 0 12px;
		font-size: 12px;
		background: transparent;
		color: #4f46e5;
		border: 1px solid #c7d2fe;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.12s;
		white-space: nowrap;

		&:hover:not(:disabled) {
			background: #eef2ff;
		}

		&:disabled {
			opacity: 0.4;
			cursor: default;
		}
	}

	/* ── Skill 预览 ── */
	.mb-preview-wrap {
		border: 1px solid var(--color-border);
		border-radius: 8px;
		overflow: hidden;
	}

	.mb-skill-preview {
		display: block;
		font-family: "Fira Code", "Cascadia Code", "Consolas", monospace;
		font-size: 11.5px;
		line-height: 1.6;
		padding: 12px 14px;
		background: #f8fafc;
		overflow: auto;
		max-height: 260px;
		white-space: pre-wrap;
		word-break: break-word;
		color: #334155;
		margin: 0;
	}

	.mb-preview-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		padding: 0 2px;
	}

	.mb-regen-btn {
		height: 34px;
		padding: 0 14px;
		font-size: 13px;
		background: transparent;
		color: #64748b;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		cursor: pointer;
		transition: background 0.12s;
		font-family: var(--font-family);

		&:hover:not(:disabled) {
			background: #f1f5f9;
		}

		&:disabled {
			opacity: 0.5;
			cursor: default;
		}
	}

	.mb-confirm-btn {
		height: 34px;
		padding: 0 16px;
		font-size: 13px;
		font-weight: 500;
		background: #4f46e5;
		color: #fff;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: background 0.15s;
		font-family: var(--font-family);

		&:hover:not(:disabled) {
			background: #4338ca;
		}

		&:disabled {
			opacity: 0.6;
			cursor: default;
		}
	}

	/* ── loading 提示 ── */
	.mb-loading {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 2px;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	@keyframes mb-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}

	.mb-loading-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #4f46e5;
		animation: mb-pulse 1.2s ease-in-out infinite;
		flex-shrink: 0;
	}
</style>
