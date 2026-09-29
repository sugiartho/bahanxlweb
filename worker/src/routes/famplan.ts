import { Hono } from "hono";
import { formatApiResult, formatFamplanPage } from "../myxl/famplan";
import { renderActivePage, requireActiveSession , renderAppErrorPage} from "../myxl/require";
import type { AppEnv } from "../types";

export const famplan = new Hono<AppEnv>();

famplan.get("/family-plan", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  try {
    const data = await session.clients.famplan.getFamilyData(session.activeUser.tokens.id_token);
    return renderActivePage(c, session, "famplan", {
      page_title: "Akrab · WebUI-XL",
      ...formatFamplanPage(data),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});

famplan.post("/family-plan/change-member", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  try {
    const res = await session.clients.famplan.changeMember(
      session.activeUser.tokens.id_token,
      String(body.parent_alias ?? ""),
      String(body.alias ?? ""),
      Number.parseInt(String(body.slot_id ?? "0"), 10),
      String(body.family_member_id ?? ""),
      String(body.new_msisdn ?? ""),
    );
    return renderActivePage(c, session, "famplan_result", {
      page_title: "Ganti Member · WebUI-XL",
      title: "Ganti Member",
      ...formatApiResult(res),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Ganti member gagal", message: String(e) }, 500);
  }
});

famplan.post("/family-plan/remove-member", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  try {
    const res = await session.clients.famplan.removeMember(
      session.activeUser.tokens.id_token,
      String(body.family_member_id ?? ""),
    );
    return renderActivePage(c, session, "famplan_result", {
      page_title: "Hapus Member · WebUI-XL",
      title: "Hapus Member",
      ...formatApiResult(res),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Hapus member gagal", message: String(e) }, 500);
  }
});

famplan.post("/family-plan/set-quota", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  const newAllocMb = Number.parseInt(String(body.new_allocation_mb ?? "0"), 10);
  const newAlloc = newAllocMb * 1024 * 1024;
  try {
    const res = await session.clients.famplan.setQuotaLimit(
      session.activeUser.tokens.id_token,
      Number.parseInt(String(body.original_allocation ?? "0"), 10),
      newAlloc,
      String(body.family_member_id ?? ""),
    );
    return renderActivePage(c, session, "famplan_result", {
      page_title: "Set Quota · WebUI-XL",
      title: "Set Quota",
      ...formatApiResult(res),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Set quota gagal", message: String(e) }, 500);
  }
});

famplan.get("/validate-msisdn", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  return renderActivePage(c, session, "validate_msisdn", {
    page_title: "Validate MSISDN · WebUI-XL",
    has_res: false,
    msisdn: "",
  });
});

famplan.post("/validate-msisdn", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  const msisdn = String(body.msisdn ?? "");
  try {
    const res = await session.clients.famplan.validateMsisdn(session.activeUser.tokens.id_token, msisdn);
    return renderActivePage(c, session, "validate_msisdn", {
      page_title: "Validate MSISDN · WebUI-XL",
      msisdn,
      ...formatApiResult(res),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal validate", message: String(e) }, 500);
  }
});