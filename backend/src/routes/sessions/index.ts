import { Router, type IRouter } from "express";
import { registerCrud } from "./crud.js";
import { registerMessages } from "./messages.js";
import { registerPrdRead } from "./prdRead.js";
import { registerVersions } from "./versions.js";
import { registerSectionEdit } from "./sectionEdit.js";
import { registerSectionMutate } from "./sectionMutate.js";

const router: IRouter = Router();
registerCrud(router);
registerMessages(router);
registerPrdRead(router);
registerVersions(router);
registerSectionEdit(router);
registerSectionMutate(router);
export default router;
