// Better Auth's endpoints (ADR-0003) behind CommuCal's rate limits (ADR-0007).
import { clientIp } from "@/server/rate-limit";
import { getServices } from "@/server/services";

export const dynamic = "force-dynamic";

const AUTH_PREFIX = "/api/auth";

/** Email from a JSON body, for per-account limits; the body itself is passed on untouched. */
async function emailOf(request: Request): Promise<string | null> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return null;
  }
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    return typeof body.email === "string" ? body.email : null;
  } catch {
    // Malformed JSON: Better Auth answers it; per-IP limits still apply.
    return null;
  }
}

async function handle(request: Request): Promise<Response> {
  const { auth, rateLimiter } = await getServices();
  if (request.method === "POST") {
    const path = new URL(request.url).pathname.slice(AUTH_PREFIX.length);
    const decision = await rateLimiter.check(path, {
      ip: clientIp(request.headers),
      email: await emailOf(request),
    });
    if (!decision.allowed) {
      return Response.json(
        { code: "RATE_LIMITED", message: "Too many attempts" },
        { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
      );
    }
  }
  return auth.handler(request);
}

export const GET = handle;
export const POST = handle;
