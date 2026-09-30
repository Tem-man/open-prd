---
type: workflow
title: PRD 章节编辑
description: 手动保存、元素补丁、实体补丁和整章改写都新插一条当前章节行并重渲染整页。整章重生成失败时不覆盖原文。回滚只是把上一版本重新标成当前。
tags: [prd, editing, sections]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-db108b0869f372c662944b0a
    resource: repo://backend/src/routes/sessions/helpers/sectionPersist.ts
  - id: openwiki-source-2e215282fe8e45284e917cea
    resource: repo://backend/src/routes/sessions/sectionEdit.ts
  - id: openwiki-source-f59220e0737b03b02eb482c9
    resource: repo://backend/src/routes/sessions/sectionMutate.ts
  - id: openwiki-source-52fa6003cbc9ed98a06b188c
    resource: repo://backend/src/services/sectionEditService.ts
  - id: openwiki-source-9919e9f6335262441e32ffa6
    resource: repo://backend/src/services/tools/sectionEdit.ts
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# PRD 章节编辑

编辑发生在当前工作区，不新建版本抽屉里的那一页。三条 AI 路径和一次手动保存，最后都走 `persistSectionRevision`：把该节所有 `is_current` 行关掉，插入版本号加一的新当前行，再按当前章节重渲染 `prds.html`。回滚不走这条插入路径。

## 对话里的三种改法

`edit_section` 看用户选中了什么。带实体名就改数据模型里的实体；带选中元素 HTML 就只改那个元素；否则按指令重写整节。元素目标在首轮会忽略模型填写的 `sectionId`。元素已经改完后，同一轮再整章改写或 `regenerate_section` 会被拒绝。

`edit_entity` 只在数据模型节，或正文里含 `erDiagram` 的那一节上打补丁。实体名必须是 1 到 64 个字母、数字、下划线、中文或连字符。

`regenerate_section` 按大纲重做整节。可选的 `reason` 会写进该节要点，并去掉上一次同样前缀的反馈。没有大纲要点时它拒绝执行，让模型改用 `edit_section`。生成成功才写入新版本。生成失败把大纲状态拨回 `done`，不覆盖原来的 HTML。

整份重新生成不是这些工具。那是确认卡片之后的流水线，见对话回合。

## 直接打到路由上的编辑

`PATCH /api/sessions/:id/prd/sections/:sectionId` 用 SSE 推送。有 `entityName` 走实体补丁，有 `selectedElementHtml` 走元素补丁，否则整节重写。缺指令、没有 PRD 或没有当前章节行会直接 4xx，不开流。

元素补丁让模型只返回那一个元素。表格路径会带上整张表，用 `tableIndex` 区分多表。定位失败时保留原 HTML，仍经过同一次保存（并去掉选中态 class）。整节重写会带上最近 6 条对话摘要；模块模板上若有 `skill_name`，会把那份 Skill 放进提示，文件缺失则忽略这段规范。

`PUT .../content` 是手动内联保存，不调用模型。正文会先去掉 `el-selected`，避免选中态被写进库。空 HTML 返回 400。

`POST .../rollback` 要求当前版本大于 1，并且找得到 `version - 1` 且已不是当前的那一行。它把当前行关掉、把那一行重新标成当前，然后重渲染整页。找不到上一行则 400，不改数据。

## 接下来读哪里

- [对话回合](/openwiki/conversation/agent-turn.md)：这些工具何时可见。
- [PRD 生成](/openwiki/prd/generation.md)：整章重生成用的是哪一个生成器。
- [会话、文档与版本](/openwiki/persistence/documents.md)：章节版本和版本抽屉不是同一层。
- [会话工作区](/openwiki/frontend/workspace.md)：保存和回滚之后预览如何更新。
