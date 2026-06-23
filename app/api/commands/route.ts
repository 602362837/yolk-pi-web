import { NextResponse } from "next/server";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

export type SlashCommandSource = "skill" | "prompt";

export interface SlashCommandEntry {
  name: string;
  source: SlashCommandSource;
  description?: string;
  argumentHint?: string;
  location?: "user" | "project" | "temporary";
  path?: string;
}

/**
 * 获取当前工作目录可用的 Web 斜杠命令。
 *
 * @param req - Next.js 请求对象，必须包含 cwd 查询参数。
 * @returns skills 与 prompt templates 的命令列表；内置 TUI 命令不在此处暴露。
 */
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
        argumentHint: prompt.argumentHint,
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
