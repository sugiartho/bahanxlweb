export function formatSseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function formatLoopPrice(price: number): string {
  return `Rp ${price.toLocaleString("id-ID")}`;
}

export function extractApiErr(res: unknown): string {
  if (!res || typeof res !== "object") {
    return res ? String(res).slice(0, 200) : "Tidak ada response";
  }
  const obj = res as Record<string, unknown>;
  const parts: string[] = [];
  if (obj.status) parts.push(`status=${obj.status}`);
  const data = (obj.data as Record<string, unknown> | undefined) ?? {};
  const msg = obj.message ?? data.message ?? obj.error;
  if (msg) parts.push(String(msg));
  const code = obj.code ?? data.code;
  if (code) parts.push(`code=${code}`);
  return parts.length > 0 ? parts.join(" · ") : JSON.stringify(res).slice(0, 200);
}

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};