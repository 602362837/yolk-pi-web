import { NextResponse } from "next/server";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { grokCliExtension } from "@/lib/pi-provider-extensions";
import { YPI_STUDIO_SLASH_COMMANDS } from "@/lib/ypi-studio-extension";

export const dynamic = "force-dynamic";

export type SlashCommandSource = "extension" | "skill" | "prompt";

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
    const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir(), extensionFactories: [grokCliExtension] });
    await loader.reload();

    const { skills, diagnostics: skillDiagnostics } = loader.getSkills();
    const { prompts, diagnostics: promptDiagnostics } = loader.getPrompts();

    const commands: SlashCommandEntry[] = [
      ...YPI_STUDIO_SLASH_COMMANDS.map((command) => ({
        name: command.name,
        source: "extension" as const,
        description: command.description,
        argumentHint: command.argumentHint,
      })),
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
      const sourceOrder: Record<SlashCommandSource, number> = { extension: 0, prompt: 1, skill: 2 };
      if (a.source !== b.source) return sourceOrder[a.source] - sourceOrder[b.source];
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ commands, diagnostics: [...skillDiagnostics, ...promptDiagnostics] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
