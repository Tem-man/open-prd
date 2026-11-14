<script setup lang="ts">
	import {
		DropdownMenuContent,
		DropdownMenuPortal,
		DropdownMenuRoot,
		DropdownMenuTrigger,
	} from "reka-ui";
	import { computed, ref, useTemplateRef } from "vue";

	import type { CommentThread } from "@open-pencil/scene-graph";
	import { liveReplies } from "@open-pencil/scene-graph/comments";
	import { useCommentMessages } from "@open-pencil/vue";

	import { useMenuUI } from "@/components/ui/menu";
	import { iconButtonClass } from "@/theme/icon-button";
	import IconButton from "@/components/ui/IconButton.vue";
	import PanelHeader from "@/components/ui/panel/PanelHeader.vue";

	import CommentComposer from "./CommentComposer.vue";
	import CommentMessage from "./CommentMessage.vue";
	import { comments } from "./ui";

	/** An open thread: the comment, its replies, and a reply box, as in Figma's comment card. */
	const { thread } = defineProps<{ thread: CommentThread }>();

	const emit = defineEmits<{
		close: [];
		resolve: [threadId: string, resolved: boolean];
		reply: [threadId: string, text: string];
		deleteReply: [threadId: string, replyId: string];
	}>();

	defineSlots<{ menu?(): unknown }>();

	const messages = useCommentMessages();
	const menuCls = useMenuUI({ content: "min-w-40" });
	const iconBtnCls = iconButtonClass({ size: "md" });
	// The card's header shows the same full-size, high-contrast speech bubble as the reference:
	// PanelHeader's default 3.5 muted glyph is too small and faint here, and its 14px grid column
	// would clip a larger icon, so widen that column for this header only.
	const headerUI = {
		root: "grid-cols-[1.125rem_minmax(0,1fr)_auto] gap-2",
		icon: "size-[1.125rem] text-muted",
	};
	const ui = comments();
	const replyText = ref("");
	const composer = useTemplateRef<{ focus: () => void }>("composer");
	const replies = computed(() => liveReplies(thread));

	function sendReply(text: string) {
		emit("reply", thread.id, text);
		replyText.value = "";
	}

	defineExpose({ focus: () => composer.value?.focus() });
</script>

<template>
	<section
		data-slot="comment-thread"
		:data-resolved="thread.resolved || undefined"
		:aria-label="messages.comment"
		:class="ui.threadCard()"
	>
		<PanelHeader :ui="headerUI">
			<template #icon
				><icon-lucide-message-circle class="size-[1.125rem] shrink-0"
			/></template>
			{{ messages.comment }}
			<template #actions>
				<DropdownMenuRoot v-if="$slots.menu" :modal="false">
					<!-- The trigger must be a real button: `as-child` over IconButton loses the popper's
             anchor ref, which drops the menu at the viewport's top-left corner. -->
					<DropdownMenuTrigger
						:class="iconBtnCls"
						:aria-label="messages.moreActions"
					>
						<icon-lucide-ellipsis class="size-4 shrink-0" />
					</DropdownMenuTrigger>
					<DropdownMenuPortal>
						<DropdownMenuContent
							:class="menuCls.content"
							align="end"
							:side-offset="4"
						>
							<slot name="menu" />
						</DropdownMenuContent>
					</DropdownMenuPortal>
				</DropdownMenuRoot>
				<IconButton
					:label="thread.resolved ? messages.reopen : messages.resolve"
					:active="thread.resolved"
					size="md"
					data-command="comment-resolve"
					@click="emit('resolve', thread.id, !thread.resolved)"
				>
					<icon-lucide-circle-check-big
						v-if="thread.resolved"
						class="size-4 shrink-0"
					/>
					<icon-lucide-circle-check v-else class="size-4 shrink-0" />
				</IconButton>
				<IconButton :label="messages.close" size="md" @click="emit('close')">
					<icon-lucide-x class="size-4 shrink-0" />
				</IconButton>
			</template>
		</PanelHeader>

		<div :class="ui.thread()">
			<CommentMessage
				:author="thread.author"
				:color="thread.authorColor"
				:at="thread.createdAt"
				:text="thread.text"
			/>
			<CommentMessage
				v-for="entry in replies"
				:key="entry.id"
				:author="entry.author"
				:color="entry.authorColor"
				:at="entry.createdAt"
				:text="entry.text"
			>
				<template #actions>
					<IconButton
						:label="messages.deleteReply"
						size="lg"
						@click="emit('deleteReply', thread.id, entry.id)"
					>
						<icon-lucide-trash-2 class="size-3.5 shrink-0" />
					</IconButton>
				</template>
			</CommentMessage>
		</div>

		<div :class="ui.composerSlot()">
			<CommentComposer
				ref="composer"
				v-model="replyText"
				:label="messages.reply"
				@submit="sendReply"
				@cancel="emit('close')"
			/>
		</div>
	</section>
</template>
