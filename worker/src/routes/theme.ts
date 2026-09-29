import { Hono } from "hono";
import { getTheme, setTheme } from "../auth/users";
import { renderWebuiPage, requireWebuiUser } from "../myxl/require";
import type { AppEnv } from "../types";

export const theme = new Hono<AppEnv>();

theme.get("/settings/theme", (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const current = getTheme(webuiUser);
  const msg = c.req.query("msg") ?? "";
  return renderWebuiPage(c, webuiUser, "theme_settings", {
    page_title: "Tema · WebUI-XL",
    current_theme: current,
    is_dark: current === "dark",
    is_light: current === "light",
    msg,
    has_msg: !!msg,
  });
});

theme.post("/settings/theme", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const body = await c.req.parseBody();
  let selected = String(body.theme ?? "dark");
  if (selected !== "dark" && selected !== "light") selected = "dark";

  await setTheme(c.get("storage"), webuiUser.username, selected);
  return c.redirect(`/settings/theme?msg=Tema+berhasil+diubah+ke+${selected}`, 303);
});