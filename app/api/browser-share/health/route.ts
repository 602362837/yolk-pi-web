import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "ypi-browser-share",
    version: 3,
    capabilities: {
      serviceAddressConfig: true,
      captureModes: ["dom", "debugger", "debugger_fallback"],
      commandLongPoll: true,
      screenshot: true,
      persistentDebugger: true,
      shareHeartbeat: true,
      commandControlProjection: true,
      activeShareOperator: true,
    },
  });
}
