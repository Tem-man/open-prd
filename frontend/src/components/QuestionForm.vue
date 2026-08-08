<script setup lang="ts">
	import { ref, computed } from "vue";
	import type { QuestionForm, Question } from "@/types";

	const props = defineProps<{
		form: QuestionForm;
		disabled?: boolean;
		defaultAnswers?: Record<string, string | string[]>;
		submitLabel?: string;
		/** 底部左侧提示文字，传空字符串可隐藏 */
		hintText?: string;
	}>();

	const emit = defineEmits<{
		submit: [answersText: string];
	}>();

	// 每道题的答案状态
	// single_choice: string（选中的选项）
	// multi_choice: string[]（选中的选项列表）
	// text: string（输入内容）
	type AnswerState = string | string[];
	const answers = ref<Record<string, AnswerState>>({});

	// 初始化答案状态，优先使用 defaultAnswers 中的预设值
	props.form.questions.forEach((q) => {
		if (props.defaultAnswers?.[q.id] !== undefined) {
			answers.value[q.id] = props.defaultAnswers[q.id];
		} else if (q.type === "multi_choice") {
			answers.value[q.id] = [];
		} else {
			answers.value[q.id] = "";
		}
	});

	// 防御性处理：文本题强制非必填
	const safeQuestions = computed<Question[]>(() =>
		props.form.questions.map((q) => ({
			...q,
			required: q.type === "text" ? false : q.required,
		})),
	);

	// 所有必填题是否已完成
	const isComplete = computed(() =>
		safeQuestions.value
			.filter((q) => q.required)
			.every((q) => {
				const ans = answers.value[q.id];
				if (q.type === "multi_choice")
					return Array.isArray(ans) && ans.length > 0;
				return typeof ans === "string" && ans.trim() !== "";
			}),
	);

	function selectSingle(questionId: string, option: string) {
		if (props.disabled) return;
		answers.value[questionId] = option;
	}

	function toggleMulti(questionId: string, option: string) {
		if (props.disabled) return;
		const current = answers.value[questionId];
		if (!Array.isArray(current)) {
			answers.value[questionId] = [option];
			return;
		}
		const idx = current.indexOf(option);
		if (idx === -1) {
			answers.value[questionId] = [...current, option];
		} else {
			answers.value[questionId] = current.filter((o) => o !== option);
		}
	}

	function isSelected(questionId: string, option: string): boolean {
		const ans = answers.value[questionId];
		if (Array.isArray(ans)) return ans.includes(option);
		return ans === option;
	}

	function handleSubmit() {
		if (!isComplete.value || props.disabled) return;

		const lines = safeQuestions.value
			.map((q) => {
				const ans = answers.value[q.id];
				let ansText = "";
				if (Array.isArray(ans)) {
					ansText = ans.length > 0 ? ans.join("、") : "（未填写）";
				} else {
					ansText = (ans as string).trim() || "（未填写）";
				}
				return `${q.label}：${ansText}`;
			})
			// 文本题保留空答案（调用方自行处理），choice 题未作答时过滤
			.filter((line, i) => {
				if (safeQuestions.value[i].type === "text") return true;
				return !line.endsWith("：（未填写）");
			});

		emit("submit", lines.join("\n"));
	}
</script>

<template>
	<div class="question-form" :class="{ 'is-disabled': disabled }">
		<div class="form-body">
			<div v-for="q in safeQuestions" :key="q.id" class="question-item">
				<!-- 题目标题 -->
				<div class="question-label">
					<span class="label-text">{{ q.label }}</span>
					<span v-if="q.required" class="required-mark">*</span>
				</div>

				<!-- 单选 / 多选选项 -->
				<div
					v-if="q.type === 'single_choice' || q.type === 'multi_choice'"
					class="options-wrap"
				>
					<button
						v-for="opt in q.options"
						:key="opt"
						type="button"
						class="option-pill"
						:class="{ selected: isSelected(q.id, opt) }"
						:disabled="disabled"
						@click="
							q.type === 'single_choice'
								? selectSingle(q.id, opt)
								: toggleMulti(q.id, opt)
						"
					>
						{{ opt }}
					</button>
				</div>

				<!-- 文本输入 -->
				<div v-else-if="q.type === 'text'" class="text-input-wrap">
					<textarea
						v-model="answers[q.id] as string"
						class="text-input"
						:placeholder="q.placeholder || '请输入...'"
						:disabled="disabled"
						rows="3"
					/>
				</div>
			</div>
		</div>

		<!-- 底部操作栏 -->
		<div class="form-footer">
			<span v-if="hintText !== ''" class="footer-hint">
				{{ hintText ?? '选填项可以跳过，Agent 会使用默认值' }}
			</span>
			<button
				type="button"
				class="btn-submit"
				:disabled="!isComplete || disabled"
				@click="handleSubmit"
			>
				{{ submitLabel ?? '发送答案' }}
			</button>
		</div>
	</div>
</template>

<style lang="scss" scoped>
	.question-form {
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-bg-primary);
		overflow: hidden;
		margin-top: 8px;
		width: 100%;

		&.is-disabled {
			opacity: 0.65;
			pointer-events: none;
		}
	}

	.form-body {
		padding: 16px 16px 8px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* ── 题目 ── */
	.question-item {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.question-label {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 14px;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.required-mark {
		color: #ef4444;
		font-size: 14px;
		line-height: 1;
	}

	/* ── 选项 Pill ── */
	.options-wrap {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.option-pill {
		padding: 6px 14px;
		border-radius: 20px;
		border: 1px solid var(--color-border);
		background: var(--color-bg-primary);
		color: var(--color-text-primary);
		font-size: 13px;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s,
			color 0.15s;
		white-space: normal;
		word-break: break-word;
		text-align: left;
		line-height: 1.45;
		max-width: 100%;
		font-family: var(--font-family);

		&:hover:not(:disabled) {
			border-color: #4f46e5;
			color: #4f46e5;
		}

		&.selected {
			border-color: #4f46e5;
			background: #eef2ff;
			color: #4f46e5;
			font-weight: 500;
		}

		&:disabled {
			cursor: default;
		}
	}

	/* ── 文本输入 ── */
	.text-input-wrap {
		width: 100%;
	}

	.text-input {
		width: 100%;
		box-sizing: border-box;
		padding: 8px 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		font-size: 13px;
		color: var(--color-text-primary);
		background: var(--color-bg-primary);
		resize: vertical;
		font-family: var(--font-family);
		line-height: 1.5;
		outline: none;
		transition: border-color 0.15s;

		&::placeholder {
			color: var(--color-text-muted);
		}

		&:focus {
			border-color: #4f46e5;
		}

		&:disabled {
			background: var(--color-bg-secondary);
			cursor: default;
		}
	}

	/* ── 底部操作栏 ── */
	.form-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 10px 16px 12px;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.footer-hint {
		font-size: 12px;
		color: var(--color-text-muted);
		flex: 1;
		line-height: 1.4;
	}

	.btn-submit {
		flex-shrink: 0;
		padding: 0 16px;
		height: 36px;
		border-radius: 8px;
		border: none;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		font-family: var(--font-family);
		transition:
			background 0.15s,
			opacity 0.15s;
		background: #4f46e5;
		color: #fff;

		&:hover:not(:disabled) {
			background: #4338ca;
		}

		&:disabled {
			background: var(--color-text-muted);
			cursor: not-allowed;
			opacity: 0.7;
		}
	}
</style>
