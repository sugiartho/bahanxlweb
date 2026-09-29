import type { Env } from "../env";
import { createFamilyLoopSseResponse, type FamilyLoopParams } from "../myxl/family-loop-runner";

const USERNAME_HEADER = "X-WebUI-Username";

function parseParams(url: URL): FamilyLoopParams {
  return {
    familyCode: url.searchParams.get("family_code")?.trim() ?? "",
    startFrom: Math.max(1, Number.parseInt(url.searchParams.get("start_from") ?? "1", 10) || 1),
    delaySeconds: Math.min(60, Math.max(0, Number.parseInt(url.searchParams.get("delay_seconds") ?? "0", 10) || 0)),
    useDecoy: url.searchParams.get("use_decoy") === "true",
  };
}

export class FamilyLoopDO implements DurableObject {
  constructor(
    private readonly _state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const username = request.headers.get(USERNAME_HEADER);
    if (!username) {
      return new Response("Missing session context", { status: 401 });
    }

    const params = parseParams(new URL(request.url));
    if (!params.familyCode) {
      return new Response("family_code is required", { status: 400 });
    }

    return createFamilyLoopSseResponse(this.env, username, params, request.signal);
  }
}