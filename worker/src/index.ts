import { Hono } from "hono";
import { sessionMiddleware } from "./middleware/session";
import { staticAssetsMiddleware } from "./middleware/static-assets";
import { myxlAuth } from "./routes/auth";
import { bookmark } from "./routes/bookmark";
import { circle } from "./routes/circle";
import { famplan } from "./routes/famplan";
import { dashboard } from "./routes/dashboard";
import { hot } from "./routes/hot";
import { packages } from "./routes/packages";
import { purchase } from "./routes/purchase";
import { decoySettings } from "./routes/decoy-settings";
import { donasi } from "./routes/donasi";
import { notification } from "./routes/notification";
import { registration } from "./routes/registration";
import { store } from "./routes/store";
import { theme } from "./routes/theme";
import { transaction } from "./routes/transaction";
import { monitoring } from "./routes/monitoring";
import { telegramWebhook } from "./telegram/webhook";
import { runMonitorCron } from "./monitor/cron";
import { processPurchaseJob } from "./queue/purchase-consumer";
import { resolveStorage } from "./storage/resolve";
import type { PurchaseQueueMessage } from "./queue/purchase-jobs";
import { webuiAuth } from "./routes/webui-auth";
import { renderAppErrorPage } from "./myxl/require";
import { htmlResponse } from "./ssr";
import type { AppEnv } from "./types";

export { FamilyLoopDO } from "./durable-objects/family-loop";

const app = new Hono<AppEnv>();

app.use("*", staticAssetsMiddleware);
app.use("*", sessionMiddleware);

app.onError((err, c) => {
  console.error("worker error", c.req.method, c.req.path, err);
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("text/html") || c.req.path.startsWith("/u/")) {
    return renderAppErrorPage(c, {
      title: "Error",
      message: "Terjadi kesalahan internal. Coba lagi dalam beberapa detik.",
    });
  }
  return c.json({ ok: false, error: "Internal Server Error" }, 500);
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "webui-xl",
    environment: c.env.ENVIRONMENT ?? "unknown",
  }),
);

app.route("/", webuiAuth);
app.route("/", myxlAuth);
app.route("/", dashboard);
app.route("/", packages);
app.route("/", store);
app.route("/", hot);
app.route("/", bookmark);
app.route("/", purchase);
app.route("/", famplan);
app.route("/", circle);
app.route("/", registration);
app.route("/", decoySettings);
app.route("/", theme);
app.route("/", donasi);
app.route("/", notification);
app.route("/", transaction);
app.route("/", monitoring);
app.route("/", telegramWebhook);

app.get("/demo/error", (c) =>
  renderAppErrorPage(c, {
    title: "Demo Error",
    message: "Ini halaman error contoh dari SSR engine.",
  }),
);

app.notFound((c) =>
  renderAppErrorPage(
    c,
    {
      title: "404",
      message: `Path tidak ditemukan: ${c.req.path}`,
    },
    404,
  ),
);

export default {
  fetch(request: Request, env: import("./env").Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: import("./env").Env): Promise<void> {
    const storage = resolveStorage(env);
    await runMonitorCron(env, storage);
  },
  async queue(batch: MessageBatch<PurchaseQueueMessage>, env: import("./env").Env): Promise<void> {
    for (const msg of batch.messages) {
      await processPurchaseJob(env, msg.body);
      msg.ack();
    }
  },
};