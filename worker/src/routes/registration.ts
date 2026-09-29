import { Hono } from "hono";
import { createMyXlClients } from "../myxl/clients";
import { formatApiResult } from "../myxl/famplan";
import { renderWebuiPage, requireWebuiUser , renderAppErrorPage} from "../myxl/require";
import type { AppEnv } from "../types";

export const registration = new Hono<AppEnv>();

registration.get("/register", (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;
  return renderWebuiPage(c, webuiUser, "register", {
    page_title: "Register · WebUI-XL",
    has_res: false,
    msisdn: "",
  });
});

registration.post("/register", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const body = await c.req.parseBody();
  const msisdn = String(body.msisdn ?? "");
  try {
    const clients = createMyXlClients(c.env, c.get("storage"), webuiUser.username);
    const res = await clients.registration.dukcapil(msisdn, String(body.kk ?? ""), String(body.nik ?? ""));
    return renderWebuiPage(c, webuiUser, "register", {
      page_title: "Register · WebUI-XL",
      msisdn,
      ...formatApiResult(res),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Register error", message: String(e) }, 500);
  }
});

registration.get("/register/puk", (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;
  return renderWebuiPage(c, webuiUser, "register_puk", {
    page_title: "PUK · WebUI-XL",
    has_res: false,
    msisdn: "",
  });
});

registration.post("/register/puk", async (c) => {
  const webuiUser = requireWebuiUser(c);
  if (webuiUser instanceof Response) return webuiUser;

  const body = await c.req.parseBody();
  const msisdn = String(body.msisdn ?? "");
  try {
    const clients = createMyXlClients(c.env, c.get("storage"), webuiUser.username);
    const res = await clients.registration.validatePuk(msisdn, String(body.puk ?? ""));
    return renderWebuiPage(c, webuiUser, "register_puk", {
      page_title: "PUK · WebUI-XL",
      msisdn,
      ...formatApiResult(res),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "PUK error", message: String(e) }, 500);
  }
});