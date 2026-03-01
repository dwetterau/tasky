import { NextResponse } from "next/server";

type ContinueRequest = {
  authorizeUrl?: unknown;
  betterAuthCookie?: unknown;
};

function isAllowedAuthorizeUrl(url: string): boolean {
  const configured = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? process.env.CONVEX_SITE_URL;
  if (!configured) return false;
  try {
    const target = new URL(url);
    const allowed = new URL(configured);
    return (
      target.origin === allowed.origin &&
      target.pathname.startsWith("/api/auth/mcp/authorize")
    );
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: ContinueRequest;
  try {
    body = (await req.json()) as ContinueRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const authorizeUrl =
    typeof body.authorizeUrl === "string" ? body.authorizeUrl : "";
  const betterAuthCookie =
    typeof body.betterAuthCookie === "string" ? body.betterAuthCookie : "";

  if (!authorizeUrl || !isAllowedAuthorizeUrl(authorizeUrl)) {
    return NextResponse.json(
      { error: "authorizeUrl must target this deployment's MCP authorize endpoint" },
      { status: 400 }
    );
  }
  if (!betterAuthCookie) {
    return NextResponse.json({ error: "Missing Better Auth cookie" }, { status: 400 });
  }

  const upstream = await fetch(authorizeUrl, {
    method: "GET",
    headers: {
      // Use normal Cookie header server-side; cross-domain plugin can resolve session.
      Cookie: betterAuthCookie,
    },
    redirect: "manual",
  });

  const location = upstream.headers.get("location");
  if (location) {
    return NextResponse.json({ location, status: upstream.status });
  }

  const text = await upstream.text();
  return NextResponse.json(
    { error: "No redirect location from authorize endpoint", status: upstream.status, body: text },
    { status: 502 }
  );
}

