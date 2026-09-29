import { Hono } from "hono";
import { refreshActiveUserForPurchase } from "../myxl/accounts";
import { EWALLET_FORM_METHODS, isAsyncPurchaseMethod } from "../clients/purchase/types";
import { createFamilyLoopSseResponse, type FamilyLoopParams } from "../myxl/family-loop-runner";
import { executeOptionPurchase, isRedeemPurchaseMethod } from "../myxl/purchase-executor";
import { formatPurchaseResult } from "../myxl/purchase";
import { renderActivePage, requireActiveSession , renderAppErrorPage} from "../myxl/require";
import { createPurchaseJob, newJobId, readJobStatus, type PurchaseJobPayload } from "../queue/purchase-jobs";
import { processPurchaseJob } from "../queue/purchase-consumer";
import type { AppEnv } from "../types";

const FAMILY_LOOP_USERNAME_HEADER = "X-WebUI-Username";

export const purchase = new Hono<AppEnv>();

function parseFormInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function validateDanaNumber(walletNumber: string): string | null {
  if (walletNumber.startsWith("08") && /^\d+$/.test(walletNumber) && walletNumber.length >= 10 && walletNumber.length <= 13) {
    return null;
  }
  return "Format harus 08xxxxxxxxx";
}

async function enqueueOrRun(
  c: import("hono").Context<AppEnv>,
  payload: PurchaseJobPayload,
): Promise<{ jobId: string; pending: boolean }> {
  const storage = c.get("storage");
  await createPurchaseJob(storage, payload);

  const queue = c.env.PURCHASE_QUEUE;
  if (queue) {
    await queue.send(payload);
    return { jobId: payload.id, pending: true };
  }

  await processPurchaseJob(c.env, payload);
  return { jobId: payload.id, pending: false };
}

function parseFamilyLoopParams(
  familyCode: string,
  startFromRaw: string | undefined,
  delayRaw: string | undefined,
  useDecoyRaw: string | undefined,
): FamilyLoopParams {
  return {
    familyCode: familyCode.trim(),
    startFrom: Math.max(1, parseFormInt(startFromRaw, 1)),
    delaySeconds: Math.min(60, Math.max(0, parseFormInt(delayRaw, 0))),
    useDecoy: useDecoyRaw === "true",
  };
}

function renderPurchaseResult(
  c: import("hono").Context<AppEnv>,
  session: Awaited<ReturnType<typeof requireActiveSession>>,
  title: string,
  result: unknown,
  qrisCode?: string | null,
  job?: { jobId: string; pending: boolean },
) {
  if (session instanceof Response) return session;
  const ctx = formatPurchaseResult(title, result, qrisCode, {
    jobPending: job?.pending,
    jobId: job?.jobId,
  });
  return renderActivePage(c, session, "purchase_result", {
    page_title: `${title} · WebUI-XL`,
    ...ctx,
  });
}

purchase.get("/purchase/family-loop", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const familyCode = c.req.query("family_code")?.trim() ?? "";
  return renderActivePage(c, session, "family_loop", {
    page_title: "Loop Beli Family · WebUI-XL",
    family_code: familyCode,
  });
});

purchase.post("/purchase/family-loop/start", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  const familyCode = String(body.family_code ?? "").trim();
  if (!familyCode) {
    return renderAppErrorPage(c, { title: "Invalid", message: "Family code wajib diisi." }, 400);
  }

  const startFrom = Math.max(1, parseFormInt(String(body.start_from ?? ""), 1));
  const delaySeconds = Math.min(60, Math.max(0, parseFormInt(String(body.delay_seconds ?? ""), 0)));
  const useDecoy = body.use_decoy === "true";

  return renderActivePage(c, session, "family_loop_stream", {
    page_title: "Loop berjalan · WebUI-XL",
    family_code: familyCode,
    family_code_encoded: encodeURIComponent(familyCode),
    start_from: startFrom,
    delay_seconds: delaySeconds,
    use_decoy: useDecoy,
    use_decoy_str: useDecoy ? "true" : "false",
  });
});

purchase.get("/purchase/family-loop/stream", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const params = parseFamilyLoopParams(
    c.req.query("family_code") ?? "",
    c.req.query("start_from") ?? undefined,
    c.req.query("delay_seconds") ?? undefined,
    c.req.query("use_decoy") ?? undefined,
  );

  if (!params.familyCode) {
    return c.text("family_code is required", 400);
  }

  const doBinding = c.env.FAMILY_LOOP;
  if (doBinding) {
    const stub = doBinding.get(doBinding.idFromName(`${session.webuiUser.username}:${params.familyCode}`));
    const req = new Request(c.req.url, {
      headers: { [FAMILY_LOOP_USERNAME_HEADER]: session.webuiUser.username },
      signal: c.req.raw.signal,
    });
    return stub.fetch(req);
  }

  return createFamilyLoopSseResponse(c.env, session.webuiUser.username, params, c.req.raw.signal);
});

purchase.get("/internal/jobs/purchase/:id", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const job = await readJobStatus(c.get("storage"), c.req.param("id"));
  if (!job) {
    return renderAppErrorPage(c, { title: "Job tidak ditemukan", message: "ID invalid atau sudah expired." }, 404);
  }

  if (job.status === "pending" || job.status === "running") {
    const ctx = formatPurchaseResult(job.title ?? "Memproses…", { status: job.status }, null, {
      jobPending: true,
      jobId: job.id,
    });
    return renderActivePage(c, session, "purchase_job_status", {
      page_title: "Memproses pembelian · WebUI-XL",
      ...ctx,
    });
  }

  const ctx = formatPurchaseResult(
    job.title ?? "Pembelian",
    job.result ?? { status: job.status, message: job.error },
    job.qrisCode,
  );
  return renderActivePage(c, session, "purchase_job_status", {
    page_title: `${ctx.title} · WebUI-XL`,
    ...ctx,
  });
});

purchase.post("/purchase/hot2", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  const hot2Idx = parseFormInt(String(body.hot2_idx ?? ""), -1);
  const method = String(body.method ?? "");
  const walletNumber = String(body.wallet_number ?? "");

  if (!["balance", "qris", ...Object.keys(EWALLET_FORM_METHODS)].includes(method)) {
    return renderAppErrorPage(c, { title: "Metode invalid", message: method }, 400);
  }

  if (method === "balance") {
    const jobId = newJobId();
    const payload: PurchaseJobPayload = {
      id: jobId,
      kind: "hot2",
      username: session.webuiUser.username,
      method,
      paymentFor: "BUY_PACKAGE",
      walletNumber,
      qrisAmount: -1,
      hot2Idx,
      createdAt: Math.floor(Date.now() / 1000),
    };
    await createPurchaseJob(c.get("storage"), payload);
    await processPurchaseJob(c.env, payload);
    const job = await readJobStatus(c.get("storage"), jobId);
    return renderPurchaseResult(c, session, job?.title ?? "Hot-2", job?.result, job?.qrisCode);
  }

  const jobId = newJobId();
  const { pending } = await enqueueOrRun(c, {
    id: jobId,
    kind: "hot2",
    username: session.webuiUser.username,
    method,
    paymentFor: "BUY_PACKAGE",
    walletNumber,
    qrisAmount: -1,
    hot2Idx,
    createdAt: Math.floor(Date.now() / 1000),
  });

  if (!pending) {
    const job = await readJobStatus(c.get("storage"), jobId);
    return renderPurchaseResult(c, session, job?.title ?? "Hot-2", job?.result, job?.qrisCode);
  }

  return renderPurchaseResult(c, session, "Memproses Hot-2…", { status: "PENDING" }, null, {
    jobId,
    pending: true,
  });
});

purchase.post("/purchase/:option_code", async (c) => {
  let session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const optionCode = c.req.param("option_code");
  const body = await c.req.parseBody();
  const method = String(body.method ?? "");
  const paymentFor = String(body.payment_for ?? "BUY_PACKAGE");
  const familyCode = String(body.family_code ?? "").trim();
  const variantCode = String(body.variant_code ?? "").trim();
  const walletNumber = String(body.wallet_number ?? "");
  const destinationMsisdn = String(body.destination_msisdn ?? "").trim();
  const qrisAmount = parseFormInt(String(body.qris_amount ?? ""), -1);
  const overwriteAmount = parseFormInt(String(body.overwrite_amount ?? ""), -1);

  const refreshed = await refreshActiveUserForPurchase(
    c.get("storage"),
    session.webuiUser.username,
    session.clients,
  );
  if (!refreshed) {
    return renderAppErrorPage(
      c,
      { title: "Sesi MyXL expired", message: "Gagal refresh token. Login ulang akun MyXL." },
      401,
    );
  }
  session = { ...session, activeUser: refreshed };

  if (method === "ewallet_dana") {
    const err = validateDanaNumber(walletNumber);
    if (err) {
      return renderAppErrorPage(c, { title: "Nomor DANA invalid", message: err }, 400);
    }
  }

  const rt = {
    config: session.clients.config,
    engsel: session.clients.engsel,
    tokens: session.activeUser.tokens,
  };

  if (method === "balance" || isRedeemPurchaseMethod(method)) {
    try {
      const out = await executeOptionPurchase(
        rt,
        c.get("storage"),
        session.webuiUser.username,
        session.activeUser.subscription_type,
        session.clients.engsel,
        optionCode,
        method,
        paymentFor,
        walletNumber,
        qrisAmount,
        familyCode,
        variantCode,
        overwriteAmount,
        destinationMsisdn,
      );
      return renderPurchaseResult(c, session, out.title, out.result, out.qrisCode);
    } catch (e) {
      return renderAppErrorPage(c, { title: "Pembelian gagal", message: String(e) }, 500);
    }
  }

  if (isAsyncPurchaseMethod(method) || method in EWALLET_FORM_METHODS) {
    const jobId = newJobId();
    const { jobId: id, pending } = await enqueueOrRun(c, {
      id: jobId,
      kind: "option",
      username: session.webuiUser.username,
      method,
      paymentFor,
      walletNumber,
      qrisAmount,
      optionCode,
      familyCode,
      variantCode,
      overwriteAmount,
      createdAt: Math.floor(Date.now() / 1000),
    });

    if (!pending) {
      const job = await readJobStatus(c.get("storage"), id);
      return renderPurchaseResult(c, session, job?.title ?? "Pembelian", job?.result, job?.qrisCode);
    }

    return renderPurchaseResult(c, session, "Memproses pembelian…", { status: "PENDING" }, null, {
      jobId: id,
      pending: true,
    });
  }

  return renderAppErrorPage(c, { title: "Metode invalid", message: `Method '${method}' tidak dikenal.` }, 400);
});