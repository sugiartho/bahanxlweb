import type { PaymentItem } from "../clients/purchase/types";
import type { StorageBackend } from "../storage/types";
import { getTextBlob } from "../myxl/blob";

export type PurchaseJobStatus = "pending" | "running" | "done" | "failed";

export type PurchaseJobKind = "option" | "hot2";

export interface PurchaseJobPayload {
  id: string;
  kind: PurchaseJobKind;
  username: string;
  method: string;
  paymentFor: string;
  walletNumber: string;
  qrisAmount: number;
  optionCode?: string;
  familyCode?: string;
  variantCode?: string;
  overwriteAmount?: number;
  hot2Idx?: number;
  createdAt: number;
}

export interface PurchaseJobRecord {
  id: string;
  status: PurchaseJobStatus;
  title?: string;
  error?: string;
  result?: unknown;
  qrisCode?: string | null;
  updatedAt: number;
}

function statusKey(jobId: string): string {
  return `jobs/purchase/${jobId}/status.json`;
}

function resultKey(jobId: string): string {
  return `jobs/purchase/${jobId}/result.json`;
}

export function newJobId(): string {
  return crypto.randomUUID();
}

export async function writeJobStatus(
  storage: StorageBackend,
  jobId: string,
  record: PurchaseJobRecord,
): Promise<void> {
  await storage.putBlob(null, statusKey(jobId), JSON.stringify(record));
}

export async function readJobStatus(
  storage: StorageBackend,
  jobId: string,
): Promise<PurchaseJobRecord | null> {
  const raw = await getTextBlob(storage, null, statusKey(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PurchaseJobRecord;
  } catch {
    return null;
  }
}

export async function writeJobResult(
  storage: StorageBackend,
  jobId: string,
  result: unknown,
): Promise<void> {
  await storage.putBlob(null, resultKey(jobId), JSON.stringify(result));
}

export async function readJobResult(storage: StorageBackend, jobId: string): Promise<unknown> {
  const raw = await getTextBlob(storage, null, resultKey(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function createPurchaseJob(
  storage: StorageBackend,
  payload: PurchaseJobPayload,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await writeJobStatus(storage, payload.id, {
    id: payload.id,
    status: "pending",
    updatedAt: now,
  });
}

export type PurchaseQueueMessage = PurchaseJobPayload;