const windows = new Map<string, { start: number; count: number }>();

export function allowRequest(request: Request, bucket: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const key = `${bucket}:${address.slice(0, 80)}`;
  let state = windows.get(key);
  if (!state || now - state.start >= windowMs) state = { start: now, count: 0 };
  state.count += 1;
  windows.set(key, state);
  if (windows.size > 2_000) {
    for (const [entry, value] of windows) if (now - value.start > windowMs * 2) windows.delete(entry);
  }
  return state.count <= max;
}

export function rateLimitResponse(): Response {
  return Response.json({ error: "Too many requests. Please wait a moment and try again." }, { status: 429, headers: { "Retry-After": "60" } });
}
