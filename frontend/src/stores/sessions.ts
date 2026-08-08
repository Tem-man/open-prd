import { defineStore } from "pinia";
import { ref } from "vue";
import { useRouter } from "vue-router";
import type { Session } from "@/types";

export const useSessionsStore = defineStore("sessions", () => {
	const router = useRouter();
	const sessions = ref<Session[]>([]);
	const currentSession = ref<Session | null>(null);
	const loading = ref(false);

	async function fetchSessions() {
		loading.value = true;
		try {
			const res = await fetch("/api/sessions");
			sessions.value = await res.json();
		} finally {
			loading.value = false;
		}
	}

	async function fetchSession(id: string) {
		const res = await fetch(`/api/sessions/${id}`);
		if (!res.ok) return null;
		const data = await res.json();
		currentSession.value = data;
		return data;
	}

	async function createSession(selectedModules?: string[], title = "") {
		const body: Record<string, unknown> = { title };
		if (selectedModules && selectedModules.length > 0) {
			body.selectedModules = selectedModules;
		}
		const res = await fetch("/api/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const session: Session = await res.json();
		sessions.value.unshift(session);
		await router.push(`/session/${session.id}`);
		return session;
	}

	async function updateSessionModules(
		sessionId: string,
		selectedModuleIds: string[],
	) {
		const res = await fetch(`/api/sessions/${sessionId}/modules`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ selectedModules: selectedModuleIds }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: "更新失败" }));
			throw new Error((err as { error?: string }).error ?? "更新失败");
		}
		const data = (await res.json()) as {
			selectedModules: Array<{ id: string; name: string }>;
		};
		if (currentSession.value?.id === sessionId) {
			currentSession.value = {
				...currentSession.value,
				selectedModules: data.selectedModules,
			};
		}
		return data.selectedModules;
	}

	async function updateTitle(id: string, title: string) {
		const session = sessions.value.find((s) => s.id === id);
		if (session) session.title = title;
		if (currentSession.value?.id === id) currentSession.value.title = title;
	}

	async function deleteSession(id: string) {
		await fetch(`/api/sessions/${id}`, { method: "DELETE" });
		sessions.value = sessions.value.filter((s) => s.id !== id);
	}

	return {
		sessions,
		currentSession,
		loading,
		fetchSessions,
		fetchSession,
		createSession,
		updateSessionModules,
		updateTitle,
		deleteSession,
	};
});
