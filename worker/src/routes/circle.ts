import { Hono } from "hono";
import { formatApiResult } from "../myxl/famplan";
import { renderActivePage, requireActiveSession , renderAppErrorPage} from "../myxl/require";
import type { AppEnv } from "../types";

export const circle = new Hono<AppEnv>();

circle.get("/circle", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  try {
    const group = await session.clients.circle.getGroupData(session.activeUser.tokens.id_token);
    let members: unknown = null;
    let spend: unknown = null;
    let bonus: unknown = null;
    let groupId: string | undefined;

    if (group && typeof group === "object") {
      const data = (group as Record<string, unknown>).data as Record<string, unknown> | undefined;
      groupId = data?.group_id ? String(data.group_id) : undefined;
      const parentSubsId = data?.parent_subs_id ? String(data.parent_subs_id) : undefined;
      if (groupId) {
        try {
          members = await session.clients.circle.getGroupMembers(session.activeUser.tokens.id_token, groupId);
        } catch {
          members = null;
        }
        if (parentSubsId) {
          try {
            spend = await session.clients.circle.spendingTracker(
              session.activeUser.tokens.id_token,
              parentSubsId,
              groupId,
            );
            bonus = await session.clients.circle.getBonusData(
              session.activeUser.tokens.id_token,
              parentSubsId,
              groupId,
            );
          } catch {
            spend = null;
            bonus = null;
          }
        }
      }
    }

    return renderActivePage(c, session, "circle", {
      page_title: "Circle · WebUI-XL",
      group_json: JSON.stringify(group ?? null, null, 2),
      members_json: members ? JSON.stringify(members, null, 2) : "",
      spend_json: spend ? JSON.stringify(spend, null, 2) : "",
      bonus_json: bonus ? JSON.stringify(bonus, null, 2) : "",
      has_members: members != null,
      has_spend: spend != null,
      has_bonus: bonus != null,
      group_id: groupId ?? "",
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Gagal fetch", message: String(e) }, 500);
  }
});

circle.post("/circle/invite", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  try {
    const res = await session.clients.circle.inviteCircleMember(
      session.activeUser.tokens.id_token,
      session.activeUser.tokens.access_token,
      String(body.msisdn ?? ""),
      String(body.name ?? ""),
      String(body.group_id ?? ""),
      String(body.member_id_parent ?? ""),
    );
    return renderActivePage(c, session, "circle_result", {
      page_title: "Invite Member · WebUI-XL",
      title: "Invite Member",
      ...formatApiResult(res),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Invite gagal", message: String(e) }, 500);
  }
});

circle.post("/circle/remove", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  const isLast = ["true", "1", "yes", "on"].includes(String(body.is_last_member ?? "").toLowerCase());
  try {
    const res = await session.clients.circle.removeCircleMember(
      session.activeUser.tokens.id_token,
      String(body.member_id ?? ""),
      String(body.group_id ?? ""),
      String(body.member_id_parent ?? ""),
      isLast,
    );
    return renderActivePage(c, session, "circle_result", {
      page_title: "Remove Member · WebUI-XL",
      title: "Remove Member",
      ...formatApiResult(res),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Remove gagal", message: String(e) }, 500);
  }
});

circle.post("/circle/accept", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  try {
    const res = await session.clients.circle.acceptCircleInvitation(
      session.activeUser.tokens.id_token,
      session.activeUser.tokens.access_token,
      String(body.group_id ?? ""),
      String(body.member_id ?? ""),
    );
    return renderActivePage(c, session, "circle_result", {
      page_title: "Accept Invitation · WebUI-XL",
      title: "Accept Invitation",
      ...formatApiResult(res),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Accept gagal", message: String(e) }, 500);
  }
});

circle.post("/circle/create", async (c) => {
  const session = await requireActiveSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.parseBody();
  try {
    const res = await session.clients.circle.createCircle(
      session.activeUser.tokens.id_token,
      session.activeUser.tokens.access_token,
      String(body.parent_name ?? ""),
      String(body.group_name ?? ""),
      String(body.member_msisdn ?? ""),
      String(body.member_name ?? ""),
    );
    return renderActivePage(c, session, "circle_result", {
      page_title: "Create Circle · WebUI-XL",
      title: "Create Circle",
      ...formatApiResult(res),
    });
  } catch (e) {
    return renderAppErrorPage(c, { title: "Create circle gagal", message: String(e) }, 500);
  }
});