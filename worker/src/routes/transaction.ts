import { Hono } from "hono";
import { renderActivePage, requireActiveSession , renderAppErrorPage} from "../myxl/require";
import { formatTransactions } from "../myxl/transactions";
import type { AppEnv } from "../types";

export const transaction = new Hono<AppEnv>();

transaction.get("/transactions", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  try {
    const raw = await session.clients.engsel.getTransactionHistory(session.activeUser.tokens.id_token);
    const items = formatTransactions(raw);
    return renderActivePage(c, session, "transactions", {
      page_title: "Riwayat Transaksi · WebUI-XL",
      items,
      has_items: items.length > 0,
      items_count: items.length,
      raw_json: JSON.stringify(raw ?? {}, null, 2),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});