import { Hono } from "hono";
import { parseNotificationDetail, parseNotificationList } from "../myxl/notifications";
import { renderActivePage, requireActiveSession , renderAppErrorPage} from "../myxl/require";
import type { AppEnv } from "../types";

export const notification = new Hono<AppEnv>();

notification.get("/notifications", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  try {
    const raw = await session.clients.engsel.getNotifications(session.activeUser.tokens.id_token);
    const items = parseNotificationList(raw);
    return renderActivePage(c, session, "notifications", {
      page_title: "Notifikasi · WebUI-XL",
      items,
      has_items: items.length > 0,
      raw_json: JSON.stringify(raw ?? {}, null, 2),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});

notification.get("/notifications/:nid", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const nid = c.req.param("nid");
  try {
    const raw = await session.clients.engsel.getNotificationDetail(session.activeUser.tokens.id_token, nid);
    const detail = parseNotificationDetail(raw);
    return renderActivePage(c, session, "notification_detail", {
      page_title: "Notifikasi · WebUI-XL",
      nid,
      ...detail,
      has_category: !!detail.category,
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});