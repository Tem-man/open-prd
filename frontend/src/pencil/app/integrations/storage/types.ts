/*
 * Remote (S3) storage was not migrated — open-prd persists prototypes through its own backend
 * (docs/plan-prototype-editor-migration.md 3.6 / 4.1). Only the binding type survives, because
 * `app/document/io` threads it through as an always-null value.
 */

export type StorageProviderID = string;

export type StorageDocumentBinding = {
	providerId: StorageProviderID;
	documentId: string;
};
