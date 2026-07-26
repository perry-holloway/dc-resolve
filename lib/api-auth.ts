import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";

const unauthorized = () =>
  Response.json({ error: "authentication required" }, { status: 401 });

export async function requireConsoleUser(): Promise<Response | null> {
  const user = await getChatGPTUser();
  return user ? null : unauthorized();
}

export async function requireReportIngestToken(
  request: Request,
): Promise<Response | null> {
  const configured = (env as unknown as { REPORT_INGEST_TOKEN?: string })
    .REPORT_INGEST_TOKEN;
  if (!configured) {
    return Response.json(
      { error: "report ingestion is not configured" },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!(await tokensEqual(configured, supplied))) return unauthorized();
  return null;
}

async function tokensEqual(expected: string, supplied: string): Promise<boolean> {
  if (!supplied) return false;
  const encoder = new TextEncoder();
  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
  ]);
  const left = new Uint8Array(expectedDigest);
  const right = new Uint8Array(suppliedDigest);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ (right[index] ?? 0);
  }
  return difference === 0;
}
