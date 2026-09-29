import { Hono } from "hono";
import { renderWebuiPage, requireWebuiUser } from "../myxl/require";
import type { AppEnv } from "../types";

export const donasi = new Hono<AppEnv>();

donasi.get("/donasi", (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  return renderWebuiPage(c, webuiUser, "donasi", {
    page_title: "Dukung Developer · WebUI-XL",
  });
});