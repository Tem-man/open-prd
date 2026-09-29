---
type: persistence
title: 会话、文档与版本
description: 打开着的 PRD 活在 prds 和当前章节行里，prd_versions 里的行是切走之前写回的快照。对话随版本一起重建，每篇 PRD 同时只有一个激活版本。
tags: [sqlite, versions, sessions, prd]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-4aff6d1caf9ba7257c5beb88
    resource: repo://backend/src/db/client.ts
  - id: openwiki-source-528e1a3fd89de49516de9f11
    resource: repo://backend/src/db/migrations.ts
  - id: openwiki-source-9157af8dcdd677c49fac3ce8
    resource: repo://backend/src/db/schema.ts
  - id: openwiki-source-db41499e61e4c6be1c27a9ad
    resource: repo://backend/src/services/prdVersions.ts
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# 会话、文档与版本

首次 `getDb()` 打开 WAL、外键，建好 `sessions`、`messages`、`prds`，再按 `user_version` 跑迁移。章节表、版本表和「每个 PRD 至多一个 `is_active = 1`」的部分唯一索引都在迁移里，不在那三条初始建表语句中。删会话会级联删掉它的消息和 PRD。

## 工作区才是正在编辑的文档

一条会话有一份 `prds` 行，`html` 是当前拼好的整页。每个模块在 `prd_sections` 里可以有多行，`is_current = 1` 的那行才是现在展示的内容；改完后旧行关掉，新行版本号加一。这是模块内部的撤回历史，不是版本抽屉里的那一页。

`prd_versions` 的每一行是一份独立文档：整页 HTML、章节 JSON、对话 JSON，加上 `source`（`snapshot`、`blank` 或 `clone`）。打开着的那一版，权威内容在工作区表里。版本行要等写回才更新。AI 改写和手动保存不会自动再插一行版本。

## 什么时候出现第一版

`listPrdVersions` 会先做懒引导。这篇 PRD 还没有任何版本、工作区里已经有当前章节、并且 `html` 去空白后非空，才插入 v1，备注是「当前内容」，`source` 为 `snapshot`，并标成激活。空文档不会物化出版本。

## 切换、新建、克隆、删除

这些操作都在一个事务里。

切到另一版时，如果工作区有内容却没有激活版本，先自动存一版「自动保存」（不激活）。然后把当前激活版本写回，删掉该 PRD 的全部章节行，按目标版本的 JSON 重新插入 `version = 1` 的当前行，并用新的消息 id 重写 `messages`。章节级撤回历史因此被清掉。有章节时按快照重渲染 `prds.html`，并按章节重建 `selected_modules`。已经是激活版本的切换是空操作。空白版本把大纲置空、HTML 写成空串，模块选择保持不动，避免空大纲被误判成生成中断。

新建 `duplicate` 先写回再复制工作区，新行成为唯一激活版本，工作区内容不变。新建 `blank` 会先保护未版本化的工作区，然后写入空章节、空对话和空 HTML，并立刻把工作区换成这个空壳。

克隆只复制 HTML 和章节 JSON，对话 JSON 固定是 `[]`，备注为「克隆自 vN」，然后切换过去。

删掉非激活版本只删那一行。删掉激活版本后，切到剩余里版本号最大的一版并载入工作区；已经是最后一版时，版本行没了，工作区内容留在原处。

部分唯一索引保证同一 `prd_id` 不能有两行 `is_active = 1`。写回函数在没有激活行时什么都不做。

## 接下来读哪里

- [运行时架构](/openwiki/architecture/runtime.md)：这个库文件放在哪。
- [PRD 生成](/openwiki/prd/generation.md)：章节行第一次怎么写出来。
- [PRD 章节编辑](/openwiki/prd/section-editing.md)：`is_current` 如何在一次改写里前进。
- [会话工作区](/openwiki/frontend/workspace.md)：版本操作之后界面如何整表换对话。
