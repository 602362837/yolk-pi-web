import { NextResponse } from "next/server";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

export type SlashCommandSource = "skill" | "prompt";

export interface SlashCommandEntry {
  name: string;
  source: SlashCommandSource;
  description?: string;
  location?: "user" | "project" | "temporary";
  path?: string;
}

// GET /api/commands?cwd=<path>
// Minimal Web slash-command discovery for Pi skills and prompt templates only.
// Built-in TUI commands are intentionally excluded; Pi core expands these
// commands when the selected invocation is sent through AgentSession.prompt().
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
    await loader.reload();

    const { skills, diagnostics: skillDiagnostics } = loader.getSkills();
    const { prompts, diagnostics: promptDiagnostics } = loader.getPrompts();

    const commands: SlashCommandEntry[] = [
      ...skills.map((skill) => ({
        name: `skill:${skill.name}`,
        source: "skill" as const,
        description: skill.description,
        location: skill.sourceInfo.scope,
        path: skill.filePath,
      })),
      ...prompts.map((prompt) => ({
        name: prompt.name,
        source: "prompt" as const,
        description: prompt.description,
        location: prompt.sourceInfo.scope,
        path: prompt.filePath,
      })),
    ].sort((a, b) => {
      if (a.source !== b.source) return a.source === "skill" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ commands, diagnostics: [...skillDiagnostics, ...promptDiagnostics] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
