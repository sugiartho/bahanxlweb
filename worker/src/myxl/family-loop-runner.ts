import type { Env } from "../env";
import { createMyXlClients } from "./clients";
import { getActiveUserSafe } from "./accounts";
import { buildPaymentItem } from "./purchase";
import { executeBalancePurchase } from "./purchase-executor";
import { extractApiErr, formatLoopPrice, formatSseEvent, SSE_HEADERS } from "./family-loop-sse";
import { resolveStorage } from "../storage/resolve";

export interface FamilyLoopParams {
  familyCode: string;
  startFrom: number;
  delaySeconds: number;
  useDecoy: boolean;
}

export type FamilyLoopEmit = (event: string, data: Record<string, unknown>) => Promise<void>;

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("aborted"));
        },
        { once: true },
      );
    }
  });
}

export async function runFamilyLoop(
  env: Env,
  username: string,
  params: FamilyLoopParams,
  emit: FamilyLoopEmit,
  signal?: AbortSignal,
): Promise<void> {
  const storage = resolveStorage(env);
  const clients = createMyXlClients(env, storage, username);
  const active = await getActiveUserSafe(storage, username, clients);
  if (!active) {
    await emit("error", { step: "auth", msg: "Login dulu — belum ada akun aktif." });
    return;
  }

  const rt = { config: clients.config, engsel: clients.engsel, tokens: active.tokens };

  await emit("phase", {
    phase: "fetch_family",
    msg: ` Mengambil daftar paket untuk family ${params.familyCode}…`,
  });

  let family: Record<string, unknown> | null;
  try {
    family = await clients.engsel.getFamily(active.tokens.id_token, params.familyCode);
  } catch (e) {
    await emit("error", { step: "fetch_family", msg: ` Gagal fetch family: ${e}` });
    return;
  }

  if (!family) {
    await emit("error", {
      step: "fetch_family",
      msg: ` Family code ${params.familyCode} tidak ditemukan / tidak valid untuk subscription lo.`,
    });
    return;
  }

  const familyName = String(
    ((family.package_family as Record<string, unknown> | undefined)?.name as string) ?? params.familyCode,
  );
  const variants = (family.package_variants as Record<string, unknown>[]) ?? [];
  const totalOpts = variants.reduce(
    (sum, v) => sum + (((v.package_options as unknown[]) ?? []).length),
    0,
  );

  if (totalOpts === 0) {
    await emit("error", {
      step: "fetch_family",
      msg: ` Family '${familyName}' tidak punya opsi paket apa pun.`,
    });
    return;
  }

  await emit("info", {
    msg: ` Family '${familyName}': ${variants.length} variant, ${totalOpts} opsi total.`,
    total: totalOpts,
    start_from: params.startFrom,
    delay: params.delaySeconds,
  });

  if (params.startFrom > 1) {
    await emit("info", { msg: `⏭️  Skip ${params.startFrom - 1} opsi pertama (mulai dari opsi #${params.startFrom}).` });
  }

  if (params.useDecoy) {
    await emit("info", { msg: "Decoy flag diterima — belum diimplementasikan di loop (sama seperti Python)." });
  }

  let seq = 0;
  let okCount = 0;
  let failCount = 0;
  let errCount = 0;
  const paymentFor = String(
    ((family.package_family as Record<string, unknown> | undefined)?.payment_for as string) ?? "BUY_PACKAGE",
  );

  for (const variant of variants) {
    if (signal?.aborted) return;
    const variantName = String(variant.name ?? "?");
    const variantCode = String(variant.package_variant_code ?? "");
    const options = (variant.package_options as Record<string, unknown>[]) ?? [];

    for (const opt of options) {
      if (signal?.aborted) return;
      seq += 1;
      if (seq < params.startFrom) continue;

      const optionName = String(opt.name ?? "?");
      const price = Number(opt.price ?? 0);
      const code = String(opt.package_option_code ?? "");

      await emit("progress", {
        seq,
        total: totalOpts,
        variant: variantName,
        option: optionName,
        price,
        code,
        step: "start",
        msg: `▶ [#${seq}/${totalOpts}] ${variantName} · ${optionName} — ${formatLoopPrice(price)}`,
      });

      await emit("progress", { seq, step: "fetch_detail", msg: "   ↳  Fetch package detail…" });

      let pkg: Record<string, unknown> | null;
      try {
        pkg = await clients.engsel.getPackage(active.tokens.id_token, code, params.familyCode, variantCode);
      } catch (e) {
        errCount += 1;
        await emit("fail", {
          seq,
          step: "fetch_detail",
          msg: `   ↳  Gagal fetch detail: ${e}`,
          summary: { ok: okCount, fail: failCount, err: errCount },
        });
        await sleepMs(params.delaySeconds * 1000, signal).catch(() => undefined);
        continue;
      }

      if (!pkg) {
        errCount += 1;
        await emit("fail", {
          seq,
          step: "fetch_detail",
          msg: "   ↳  Detail paket kosong (mungkin opsi tidak tersedia).",
          summary: { ok: okCount, fail: failCount, err: errCount },
        });
        await sleepMs(params.delaySeconds * 1000, signal).catch(() => undefined);
        continue;
      }

      const item = buildPaymentItem(pkg);

      await emit("progress", {
        seq,
        step: "submit",
        msg: `   ↳  Submit pembayaran via Pulsa (${formatLoopPrice(item.item_price)})…`,
      });

      let res: unknown;
      try {
        const out = await executeBalancePurchase(rt, [item], paymentFor, item.item_price);
        res = out.result;
      } catch (e) {
        errCount += 1;
        await emit("fail", {
          seq,
          step: "submit",
          msg: `   ↳  Exception saat submit: ${e}`,
          summary: { ok: okCount, fail: failCount, err: errCount },
        });
        await sleepMs(params.delaySeconds * 1000, signal).catch(() => undefined);
        continue;
      }

      const ok = typeof res === "object" && res != null && (res as Record<string, unknown>).status === "SUCCESS";
      if (ok) {
        okCount += 1;
        await emit("success", {
          seq,
          step: "done",
          msg: `   ↳  BERHASIL beli ${optionName}`,
          summary: { ok: okCount, fail: failCount, err: errCount },
        });
      } else {
        failCount += 1;
        let detail = extractApiErr(res);
        let hint = "";
        if (detail.includes("Bizz-err.Amount.Total")) {
          hint = "   Amount tidak match. Server biasanya kasih amount yang benar di pesan error.";
        } else if (/balance|insufficient/i.test(detail)) {
          hint = "   Saldo pulsa nggak cukup.";
        } else if (/already|duplicate/i.test(detail)) {
          hint = "   Paket mungkin sudah aktif/baru saja dibeli.";
        }
        await emit("fail", {
          seq,
          step: "done",
          msg: `   ↳ ️ Ditolak server: ${detail}${hint}`,
          summary: { ok: okCount, fail: failCount, err: errCount },
        });
      }

      if (params.delaySeconds > 0 && seq < totalOpts) {
        await emit("progress", {
          seq,
          step: "wait",
          msg: `   ↳ ⏳ Tunggu ${params.delaySeconds}s sebelum opsi berikutnya…`,
        });
        await sleepMs(params.delaySeconds * 1000, signal).catch(() => undefined);
      }
    }
  }

  await emit("done", {
    msg: ` Selesai — ${okCount} sukses, ${failCount} ditolak, ${errCount} error dari ${totalOpts} opsi.`,
    summary: { ok: okCount, fail: failCount, err: errCount, total: totalOpts },
  });
}

export function createFamilyLoopSseResponse(
  env: Env,
  username: string,
  params: FamilyLoopParams,
  signal?: AbortSignal,
): Response {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const emit: FamilyLoopEmit = async (event, data) => {
    if (signal?.aborted) return;
    await writer.write(encoder.encode(formatSseEvent(event, data)));
  };

  runFamilyLoop(env, username, params, emit, signal)
    .catch(async (e) => {
      if (!signal?.aborted) {
        await emit("error", { step: "internal", msg: String(e) }).catch(() => undefined);
      }
    })
    .finally(() => {
      writer.close().catch(() => undefined);
    });

  return new Response(readable, { headers: SSE_HEADERS });
}