import { Hono } from "hono";
import {
  BUILTIN_KEYS,
  DECOY_NAME_RE,
  builtinStorageKey,
  customStorageKey,
  formatDecoyRow,
  listBuiltinDecoys,
  listCustomDecoys,
  loadDecoyByKind,
  parseDecoyForm,
  saveDecoyJson,
  testDecoyFetch,
} from "../myxl/decoy-settings";
import { renderAppErrorPage, renderWebuiPage, requireActiveSession, requireWebuiUser } from "../myxl/require";
import type { AppEnv } from "../types";

export const decoySettings = new Hono<AppEnv>();

async function decoyPageContext(c: Parameters<typeof renderWebuiPage>[0], webuiUser: { username: string }) {
  const storage = c.get("storage");
  const builtins = await listBuiltinDecoys(storage, webuiUser.username);
  const customs = await listCustomDecoys(storage, webuiUser.username);
  return {
    page_title: "Decoy Settings · WebUI-XL",
    msg: c.req.query("msg") ?? "",
    has_msg: !!c.req.query("msg"),
    builtins: builtins.map((b) => formatDecoyRow(b.data, "builtin", b.key, b.label, b.subtype)),
    customs: customs.map((c) =>
      formatDecoyRow(c.data, "custom", c.name, `Custom ${c.name}`, "", ),
    ),
    customs_count: customs.length,
    has_customs: customs.length > 0,
  };
}

decoySettings.get("/settings/decoy", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;
  return renderWebuiPage(c, webuiUser, "decoy_settings", await decoyPageContext(c, webuiUser));
});

decoySettings.post("/settings/decoy/builtin/:key", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const key = c.req.param("key");
  if (!BUILTIN_KEYS.has(key)) {
    return renderAppErrorPage(c, { title: "Slot tidak dikenal", message: `Builtin slot '${key}' invalid` }, 400);
  }

  const body = await c.req.parseBody();
  const data = parseDecoyForm(body as Record<string, unknown>);
  await saveDecoyJson(c.get("storage"), webuiUser.username, builtinStorageKey(key), data);
  return c.redirect(`/settings/decoy?msg=Built-in+%27${key}%27+disimpan`, 303);
});

decoySettings.post("/settings/decoy/custom/add", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const body = await c.req.parseBody();
  const name = String(body.name ?? "").trim().toLowerCase();
  if (!DECOY_NAME_RE.test(name)) {
    return renderAppErrorPage(c, { title: "Nama invalid", message: "Nama hanya boleh: huruf kecil, angka, _, - (max 31 char). Contoh: v1, vtest, my-decoy" }, 400);
  }

  const storage = c.get("storage");
  if (await storage.blobExists(webuiUser.username, customStorageKey(name))) {
    return renderAppErrorPage(c, { title: "Nama duplikat", message: `Custom decoy bernama '${name}' sudah ada. Pilih nama lain atau edit yang ada.` }, 400);
  }

  const data = parseDecoyForm(body as Record<string, unknown>, true);
  await saveDecoyJson(storage, webuiUser.username, customStorageKey(name), data);
  return c.redirect(`/settings/decoy?msg=Custom+%27${name}%27+ditambahkan`, 303);
});

decoySettings.post("/settings/decoy/custom/:name", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const name = c.req.param("name");
  if (!DECOY_NAME_RE.test(name)) {
    return renderAppErrorPage(c, { title: "Nama invalid", message: name }, 400);
  }

  const storage = c.get("storage");
  const objectKey = customStorageKey(name);
  if (!(await storage.blobExists(webuiUser.username, objectKey))) {
    return renderAppErrorPage(c, { title: "Tidak ditemukan", message: `custom-${name}.json belum ada` }, 404);
  }

  const body = await c.req.parseBody();
  const data = parseDecoyForm(body as Record<string, unknown>, true);
  await saveDecoyJson(storage, webuiUser.username, objectKey, data);
  return c.redirect(`/settings/decoy?msg=Custom+%27${name}%27+disimpan`, 303);
});

decoySettings.post("/settings/decoy/custom/:name/delete", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const name = c.req.param("name");
  if (!DECOY_NAME_RE.test(name)) {
    return renderAppErrorPage(c, { title: "Nama invalid", message: name }, 400);
  }

  await c.get("storage").deleteBlob(webuiUser.username, customStorageKey(name));
  return c.redirect(`/settings/decoy?msg=Custom+%27${name}%27+dihapus`, 303);
});

decoySettings.post("/settings/decoy/raw/:kind/:key", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const kind = c.req.param("kind");
  const key = c.req.param("key");
  const body = await c.req.parseBody();
  const raw = String(body.raw_json ?? "");
  if (!raw.trim()) {
    return renderAppErrorPage(c, { title: "JSON kosong", message: "Masukin JSON yang valid" }, 400);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Root harus berupa object (dict)");
    }
  } catch (e) {
    return renderAppErrorPage(c, { title: "JSON invalid", message: String(e) }, 400);
  }

  const storage = c.get("storage");
  if (kind === "builtin") {
    if (!BUILTIN_KEYS.has(key)) {
      return renderAppErrorPage(c, { title: "Slot tidak dikenal", message: key }, 400);
    }
    await saveDecoyJson(storage, webuiUser.username, builtinStorageKey(key), data);
    return c.redirect(`/settings/decoy?msg=Built-in+%27${key}%27+(JSON)+disimpan`, 303);
  }

  if (kind === "custom") {
    if (!DECOY_NAME_RE.test(key)) {
      return renderAppErrorPage(c, { title: "Nama invalid", message: key }, 400);
    }
    if (!("base_method" in data)) data.base_method = "balance";
    await saveDecoyJson(storage, webuiUser.username, customStorageKey(key), data);
    return c.redirect(`/settings/decoy?msg=Custom+%27${key}%27+(JSON)+disimpan`, 303);
  }

  return renderAppErrorPage(c, { title: "Kind invalid", message: kind }, 400);
});

decoySettings.post("/settings/decoy/test/:kind/:key", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) {
    return c.json({ ok: false, error: "Belum ada akun aktif" });
  }

  const kind = c.req.param("kind");
  const key = c.req.param("key");
  const data = await loadDecoyByKind(c.get("storage"), session.webuiUser.username, kind, key);
  if (!data) {
    return c.json({ ok: false, error: kind === "custom" ? "Nama custom invalid" : "Kind invalid" });
  }
  if (!Object.keys(data).length) {
    return c.json({ ok: false, error: "File kosong / tidak ditemukan" });
  }

  const result = await testDecoyFetch(
    session.clients.engsel,
    session.activeUser.tokens.id_token,
    data,
    session.activeUser.subscription_type,
  );
  return c.json(result);
});