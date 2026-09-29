import type { Env } from "../env";
import { createMyXlClients } from "../myxl/clients";
import { getActiveUserSafe, refreshActiveUserForPurchase } from "../myxl/accounts";
import {
  executeBalancePurchase,
  executeEwalletPurchase,
  executeOptionPurchase,
  executeQrisPurchase,
  type PurchaseExecutionResult,
} from "../myxl/purchase-executor";
import { buildPaymentItem } from "../myxl/purchase";
import { SHARED_HOT2 } from "../storage/keys";
import { resolveStorage } from "../storage/resolve";
import type { PaymentItem } from "../clients/purchase/types";
import { getTextBlob } from "../myxl/blob";
import type { PurchaseQueueMessage } from "./purchase-jobs";
import { writeJobResult, writeJobStatus } from "./purchase-jobs";

async function readHot2Packages(storage: Awaited<ReturnType<typeof resolveStorage>>): Promise<Record<string, unknown>[]> {
  const raw = await getTextBlob(storage, null, SHARED_HOT2);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

async function executeHot2Job(
  env: Env,
  msg: PurchaseQueueMessage,
  storage: Awaited<ReturnType<typeof resolveStorage>>,
): Promise<PurchaseExecutionResult> {
  const clients = createMyXlClients(env, storage, msg.username);
  const active = await getActiveUserSafe(storage, msg.username, clients);
  if (!active) return { title: "Login dulu", result: { message: "Belum ada akun aktif." } };

  const hotPackages = await readHot2Packages(storage);
  const idx = msg.hot2Idx ?? -1;
  if (idx < 0 || idx >= hotPackages.length) {
    return { title: "Invalid", result: { message: "Index hot2 invalid." } };
  }

  const selected = hotPackages[idx];
  const subPackages = (selected.packages as Record<string, unknown>[]) ?? [];
  const items: PaymentItem[] = [];
  for (const p of subPackages) {
    const pkgDetail = await clients.engsel.getPackageDetails(
      active.tokens.id_token,
      String(p.family_code ?? ""),
      String(p.variant_code ?? ""),
      Number(p.order ?? 1),
      Boolean(p.is_enterprise),
      String(p.migration_type ?? "NONE"),
    );
    if (!pkgDetail) {
      return { title: "Detail gagal", result: { message: `family ${p.family_code} gagal fetch` } };
    }
    items.push(buildPaymentItem(pkgDetail));
  }

  const paymentFor = String(selected.payment_for ?? "BUY_PACKAGE");
  let overwrite = Number(selected.overwrite_amount ?? -1);
  const tokenIdx = Number(selected.token_confirmation_idx ?? 0);
  const amountIdx = Number(selected.amount_idx ?? -1);
  if (overwrite === -1) {
    const refIdx = amountIdx !== -1 ? amountIdx : items.length - 1;
    overwrite = items[refIdx]?.item_price ?? 0;
  }

  const rt = { config: clients.config, engsel: clients.engsel, tokens: active.tokens };
  const title = String(selected.name ?? "Hot-2");

  if (msg.method === "balance") {
    const out = await executeBalancePurchase(rt, items, paymentFor, overwrite, tokenIdx, amountIdx);
    return { ...out, title };
  }
  if (msg.method === "qris") {
    const out = await executeQrisPurchase(rt, items, paymentFor, overwrite, tokenIdx, amountIdx, title);
    return out;
  }
  const out = await executeEwalletPurchase(
    rt,
    items,
    msg.method,
    msg.walletNumber,
    paymentFor,
    overwrite,
    tokenIdx,
    amountIdx,
    title,
  );
  return out;
}

export async function processPurchaseJob(env: Env, msg: PurchaseQueueMessage): Promise<void> {
  const storage = await resolveStorage(env);
  const now = () => Math.floor(Date.now() / 1000);

  await writeJobStatus(storage, msg.id, { id: msg.id, status: "running", updatedAt: now() });

  try {
    let out: PurchaseExecutionResult;
    if (msg.kind === "hot2") {
      out = await executeHot2Job(env, msg, storage);
    } else {
      const clients = createMyXlClients(env, storage, msg.username);
      const active = await refreshActiveUserForPurchase(storage, msg.username, clients);
      if (!active) {
        out = { title: "Login dulu", result: { message: "Belum ada akun aktif atau token expired." } };
      } else {
        const rt = { config: clients.config, engsel: clients.engsel, tokens: active.tokens };
        out = await executeOptionPurchase(
          rt,
          storage,
          msg.username,
          active.subscription_type,
          clients.engsel,
          msg.optionCode ?? "",
          msg.method,
          msg.paymentFor,
          msg.walletNumber,
          msg.qrisAmount,
          msg.familyCode ?? "",
          msg.variantCode ?? "",
          msg.overwriteAmount ?? -1,
        );
      }
    }

    await writeJobResult(storage, msg.id, out);
    await writeJobStatus(storage, msg.id, {
      id: msg.id,
      status: "done",
      title: out.title,
      result: out.result,
      qrisCode: out.qrisCode,
      updatedAt: now(),
    });
  } catch (e) {
    await writeJobStatus(storage, msg.id, {
      id: msg.id,
      status: "failed",
      error: String(e),
      updatedAt: now(),
    });
  }
}