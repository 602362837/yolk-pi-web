import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, service: "ypi-browser-share", version: 1 });
}
