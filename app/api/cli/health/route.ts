import { NextResponse } from "next/server";

// GET /api/cli/health
// Minimal health check used by the `ypic` CLI to distinguish a reusable
// yolk-pi-web server from another service occupying the same port.
// Returns stable identification metadata only; never expose env, tokens,
// user paths, or secrets here.
export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "yolk-pi-web",
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
    pid: process.pid,
    capabilities: {
      agentApi: true,
      studio: true,
    },
  });
}
