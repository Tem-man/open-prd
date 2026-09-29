---
type: workflow
title: PRD 生成
description: generate_prd 在没有现成文档时跑大纲、按选定模块逐个生成，并把失败模块写成占位段后仍组装成单文件 HTML。章节行是权威数据，prds.html 是带版本指纹的渲染缓存。
tags: [prd, generation, renderer, skills]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-6bf9edadf4526c6e9f468f3f
    resource: repo://backend/src/services/prd/index.ts
  - id: openwiki-source-305700adbcd01c703295cc96
    resource: repo://backend/src/services/prd/modules/architecture.ts
  - id: openwiki-source-7f1fd1afee120912646da7e9
    resource: repo://backend/src/services/prd/modules/prototypeBasis.ts
  - id: openwiki-source-a0ff57bc365c25600f1cbd22
    resource: repo://backend/src/services/prd/renderer.ts
  - id: openwiki-source-accbbbd71d55e9b29dde6afa
    resource: repo://backend/src/services/prdFinalize.ts
  - id: openwiki-source-3fffa407ac9609c73e30a6c7
    resource: repo://backend/src/services/prdPipeline.ts
  - id: openwiki-source-08612556bed6d771d40f7d07
    resource: repo://backend/src/services/skillLoader.ts
  - id: openwiki-source-fe831814fe4f0f8ddd1a0faa
    resource: repo://backend/src/services/tools/generatePrd.ts
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# PRD 生成

还没有 PRD 时，`generate_prd` 调用 `runPrdPipeline`。已有 PRD 时它只发确认卡片，这条流水线要等用户确认后才由路由再跑一遍。流水线先写大纲，再 `generateFullPrd`，最后校验落库的 HTML。用户中止会继续向外抛；其他异常变成 `failed`，原因是 `prd_generation_failed`。

## 按选定顺序逐个模块生成

生成器按模块 id 分发。内置的八个是背景、用户与场景、功能清单、产品架构、业务流程、信息架构、数据模型和原型依据。不在这张表里的 id 走自定义生成器。顺序跟会话的 `selected_modules` 走，大纲里多出来的模块补在末尾。

循环开始前如果已经中止，直接抛出。大纲里状态已是 `done` 且 `prd_sections` 有当前缓存的模块不再调用模型，进度仍报 `done`，所以 `continue_prd` 可以接着上次的断点。状态是完成但缓存丢了，会先改回 `pending` 再生成。

单个模块抛错不会停掉后面的模块。该节标成 `error`，结果里放一段「模块生成失败」的段落，然后继续。全部走完后才 `persistResults`：按同一顺序交给渲染器，更新或插入 `prds.html`，并把每个非空结果写成新的当前章节行（旧的当前行 `is_current` 置 0，版本加一）。因此一次局部失败仍会留下一份可打开的文档，失败的那一节是占位 HTML。

`retry_section` 只重新生成目标节，其余节从缓存填回，再整页组装。

架构、流程、信息架构、数据模型和原型依据在调用模型前用 `buildSkillBlock` 把对应 `SKILL.md` 包进系统提示。架构图还会把输出收成 `graph TB`，并包进 `<div class="mermaid">`。Skill 正文的约束见图表 Skill 那一页。

## 单文件 HTML 只是缓存

`renderPrd` 按传入顺序做标签页：第一项默认选中，空内容换成「本模块内容生成失败」的段落。CSS 和运行时脚本内联，图表所需的 CDN 脚本按各节内容收集。`<head>` 里有 `prd-renderer` 版本元信息。

`prd_sections` 的当前行才是权威内容。`getFreshPrdHtml` 看到空 HTML 会保持空串（空白版本）。指纹仍是当前渲染器的，直接返回缓存。没有章节行的旧文档也沿用旧 HTML。指纹对不上且已有章节时，按当前行重渲染并写回，而且不因此更新会话时间。

校验读的是刚写入的 `prds.html`。读不到内容则失败，原因是 `prd_write_error`。通过时可以带警告，仍算 `ready`。

## 接下来读哪里

- [对话回合](/openwiki/conversation/agent-turn.md)：什么时候允许调用 `generate_prd`。
- [图表与模块 Skill](/openwiki/skills/diagram-skills.md)：Skill 文件如何被读进来。
- [PRD 章节编辑](/openwiki/prd/section-editing.md)：生成之后如何改一节而不重跑整份。
- [会话、文档与版本](/openwiki/persistence/documents.md)：这些章节行和版本快照的关系。
