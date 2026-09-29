import { Hono } from "hono";
import { addBookmark, getBookmarks, removeBookmark } from "../myxl/bookmark";
import { renderActivePage, requireActiveSession , renderAppErrorPage} from "../myxl/require";
import type { AppEnv } from "../types";

function parseBool(value: string): boolean {
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

export const bookmark = new Hono<AppEnv>();

bookmark.get("/bookmark", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  try {
    const bookmarks = await getBookmarks(c.get("storage"), session.webuiUser.username);
    return renderActivePage(c, session, "bookmark", {
      page_title: "Bookmark · WebUI-XL",
      bookmarks,
      has_bookmarks: bookmarks.length > 0,
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal load bookmark", message: String(e) }, 500);
  }
});

bookmark.post("/bookmark/add", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  try {
    await addBookmark(c.get("storage"), session.webuiUser.username, {
      family_code: String(body.family_code ?? ""),
      family_name: String(body.family_name ?? ""),
      is_enterprise: parseBool(String(body.is_enterprise ?? "false")),
      variant_name: String(body.variant_name ?? ""),
      option_name: String(body.option_name ?? ""),
      order: Number.parseInt(String(body.order ?? "0"), 10) || 0,
      package_option_code: String(body.package_option_code ?? ""),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Tambah bookmark gagal", message: String(e) }, 500);
  }
  return c.redirect("/bookmark", 303);
});

bookmark.post("/bookmark/remove", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  try {
    await removeBookmark(
      c.get("storage"),
      session.webuiUser.username,
      String(body.family_code ?? ""),
      parseBool(String(body.is_enterprise ?? "false")),
      String(body.variant_name ?? ""),
      Number.parseInt(String(body.order ?? "0"), 10) || 0,
    );
  } catch (e) {
    return renderAppErrorPage(c, { title: "Hapus bookmark gagal", message: String(e) }, 500);
  }
  return c.redirect("/bookmark", 303);
});