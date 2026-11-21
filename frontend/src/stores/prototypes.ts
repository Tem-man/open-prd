import { sessionMessages } from '@open-pencil/vue'
import { defineStore } from "pinia";
import { ref } from "vue";
import { useRouter } from "vue-router";
import type { Prototype } from "@/types";

export const usePrototypesStore = defineStore("prototypes", () => {
	const router = useRouter();
	const prototypes = ref<Prototype[]>([]);
	const current = ref<Prototype | null>(null);
	const loading = ref(false);
	const saveStatus = ref<"idle" | "saving" | "saved" | "error">("idle");

	async function fetchPrototypes() {
		loading.value = true;
		try {
			const res = await fetch("/api/prototypes");
			if (!res.ok) throw new Error(sessionMessages.get().errLoadPrototypes);
			prototypes.value = (await res.json()) as Prototype[];
		} finally {
			loading.value = false;
		}
	}

	async function fetchMeta(id: string): Promise<Prototype | null> {
		const res = await fetch(`/api/prototypes/${id}/meta`);
		if (!res.ok) return null;
		const data = (await res.json()) as Prototype;
		current.value = data;
		return data;
	}

	/** Download `.fig` bytes. Empty buffer means a brand-new placeholder file. */
	async function fetchFigBytes(id: string): Promise<Uint8Array> {
		const res = await fetch(`/api/prototypes/${id}`);
		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: sessionMessages.get().errFetch }));
			throw new Error((err as { error?: string }).error ?? sessionMessages.get().errFetch);
		}
		const buf = await res.arrayBuffer();
		return new Uint8Array(buf);
	}

	async function createPrototype(title = "", sessionId?: string) {
		const res = await fetch("/api/prototypes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(sessionId ? { title, sessionId } : { title }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: sessionMessages.get().errCreate }));
			throw new Error((err as { error?: string }).error ?? sessionMessages.get().errCreate);
		}
		const proto = (await res.json()) as Prototype;
		prototypes.value.unshift(proto);
		current.value = proto;
		await router.push({
			name: "prototype",
			params: { id: proto.id },
			query: { tab: "proto" },
		});
		return proto;
	}

	async function saveFigBytes(
		id: string,
		data: Uint8Array,
	): Promise<Prototype> {
		saveStatus.value = "saving";
		try {
			const res = await fetch(`/api/prototypes/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/octet-stream" },
				body: data,
			});
			if (!res.ok) {
				saveStatus.value = "error";
				const err = await res.json().catch(() => ({ error: sessionMessages.get().errSave }));
				throw new Error((err as { error?: string }).error ?? sessionMessages.get().errSave);
			}
			const updated = (await res.json()) as Prototype;
			const idx = prototypes.value.findIndex((p) => p.id === id);
			if (idx >= 0) prototypes.value[idx] = updated;
			if (current.value?.id === id) current.value = updated;
			saveStatus.value = "saved";
			return updated;
		} catch (e) {
			saveStatus.value = "error";
			throw e;
		}
	}

	async function updateMeta(
		id: string,
		patch: { title?: string; thumbnail?: string | null },
	): Promise<Prototype> {
		const res = await fetch(`/api/prototypes/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(patch),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: sessionMessages.get().errUpdate }));
			throw new Error((err as { error?: string }).error ?? sessionMessages.get().errUpdate);
		}
		const updated = (await res.json()) as Prototype;
		const idx = prototypes.value.findIndex((p) => p.id === id);
		if (idx >= 0) prototypes.value[idx] = updated;
		if (current.value?.id === id) current.value = updated;
		return updated;
	}

	async function deletePrototype(id: string) {
		const res = await fetch(`/api/prototypes/${id}`, { method: "DELETE" });
		if (!res.ok && res.status !== 204) {
			const err = await res.json().catch(() => ({ error: sessionMessages.get().errDelete }));
			throw new Error((err as { error?: string }).error ?? sessionMessages.get().errDelete);
		}
		prototypes.value = prototypes.value.filter((p) => p.id !== id);
		if (current.value?.id === id) current.value = null;
	}

	function openPrototype(id: string) {
		return router.push({
			name: "prototype",
			params: { id },
			query: { tab: "proto" },
		});
	}

	return {
		prototypes,
		current,
		loading,
		saveStatus,
		fetchPrototypes,
		fetchMeta,
		fetchFigBytes,
		createPrototype,
		saveFigBytes,
		updateMeta,
		deletePrototype,
		openPrototype,
	};
});
