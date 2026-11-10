import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { ModuleTemplate } from '@/types'

export const useModulesStore = defineStore('modules', () => {
  const library = ref<ModuleTemplate[]>([])
  const loading = ref(false)

  async function fetchModules() {
    loading.value = true
    try {
      const res = await fetch('/api/modules')
      if (!res.ok) throw new Error('获取模块列表失败')
      library.value = await res.json() as ModuleTemplate[]
    } finally {
      loading.value = false
    }
  }

  async function addModule(name: string, description?: string): Promise<ModuleTemplate> {
    const res = await fetch('/api/modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description || undefined }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '添加失败' }))
      throw new Error((err as { error?: string }).error ?? '添加失败')
    }
    const module = await res.json() as ModuleTemplate
    library.value.push(module)
    return module
  }

  async function deleteModule(id: string) {
    const res = await fetch(`/api/modules/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) {
      const err = await res.json().catch(() => ({ error: '删除失败' }))
      throw new Error((err as { error?: string }).error ?? '删除失败')
    }
    library.value = library.value.filter(m => m.id !== id)
  }

  async function getSkillContent(moduleId: string): Promise<{ version: number; content: string }> {
    const res = await fetch(`/api/modules/${moduleId}/skill`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '获取失败' }));
      throw new Error((err as { error?: string }).error ?? '获取失败');
    }
    return res.json() as Promise<{ version: number; content: string }>;
  }

  async function saveSkillContent(moduleId: string, content: string): Promise<{ version: number }> {
    const res = await fetch(`/api/modules/${moduleId}/skill`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '保存失败' }));
      throw new Error((err as { error?: string }).error ?? '保存失败');
    }
    return res.json() as Promise<{ version: number }>;
  }

  async function getSkillVersions(moduleId: string): Promise<Array<{ id: string; version: number; isCurrent: boolean; createdAt: number }>> {
    const res = await fetch(`/api/modules/${moduleId}/skill/versions`);
    if (!res.ok) throw new Error('获取版本列表失败');
    return res.json() as Promise<Array<{ id: string; version: number; isCurrent: boolean; createdAt: number }>>;
  }

  async function getSkillVersion(moduleId: string, versionId: string): Promise<{ version: number; content: string }> {
    const res = await fetch(`/api/modules/${moduleId}/skill/versions/${versionId}`);
    if (!res.ok) throw new Error('获取版本内容失败');
    return res.json() as Promise<{ version: number; content: string }>;
  }

  async function rollbackSkill(moduleId: string, versionId: string): Promise<{ restoredVersion: number }> {
    const res = await fetch(`/api/modules/${moduleId}/skill/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '回滚失败' }));
      throw new Error((err as { error?: string }).error ?? '回滚失败');
    }
    return res.json() as Promise<{ restoredVersion: number }>;
  }

  async function exportSkill(moduleId: string, moduleName: string): Promise<void> {
    const res = await fetch(`/api/modules/${moduleId}/skill/export`);
    if (!res.ok) throw new Error('导出失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${moduleName}-skill.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function importSkill(file: File, moduleName: string): Promise<ModuleTemplate> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('moduleName', moduleName);
    const res = await fetch('/api/modules/import-skill', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '导入失败' }));
      throw new Error((err as { error?: string }).error ?? '导入失败');
    }
    const module = await res.json() as ModuleTemplate;
    library.value.push(module);
    return module;
  }

  /** 复制定制：复制官方内置模块的 Skill 为用户副本（新建自定义模块） */
  async function duplicateSkill(moduleId: string): Promise<ModuleTemplate> {
    const res = await fetch(`/api/modules/${moduleId}/skill/duplicate`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '复制失败' }));
      throw new Error((err as { error?: string }).error ?? '复制失败');
    }
    const module = await res.json() as ModuleTemplate;
    library.value.push(module);
    return module;
  }

  async function optimizeSkill(moduleId: string, instruction: string): Promise<{ optimizedContent: string }> {
    const res = await fetch(`/api/modules/${moduleId}/skill/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '优化失败' }));
      throw new Error((err as { error?: string }).error ?? '优化失败');
    }
    return res.json() as Promise<{ optimizedContent: string }>;
  }

  return {
    library, loading, fetchModules, addModule, deleteModule,
    getSkillContent, saveSkillContent, getSkillVersions, getSkillVersion,
    rollbackSkill, exportSkill, importSkill, optimizeSkill, duplicateSkill,
  }
})
