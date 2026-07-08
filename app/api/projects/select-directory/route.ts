import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

interface DirectoryPickResult {
  path?: string;
  canceled?: boolean;
  error?: string;
}

type DirectoryPickerPurpose = "project" | "git-parent";

// Fixed prompt/title strings per purpose. Only these enum values are accepted so
// arbitrary client strings never reach the OS picker shell/PowerShell scripts.
const PICKER_PROMPTS: Record<DirectoryPickerPurpose, string> = {
  project: "Select project directory",
  "git-parent": "Select Git parent directory",
};

function isCancelError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String(error.message) : "";
  const stderr = "stderr" in error ? String(error.stderr) : "";
  return /cancel/i.test(`${message}\n${stderr}`);
}

async function pickDirectory(purpose: DirectoryPickerPurpose): Promise<DirectoryPickResult> {
  const prompt = PICKER_PROMPTS[purpose];

  if (process.platform === "darwin") {
    // Pass the fixed prompt as a separate osascript argument; no client string
    // interpolation is used, preventing shell injection.
    const script = `POSIX path of (choose folder with prompt "${prompt}")`;
    try {
      const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 120000 });
      const selectedPath = String(stdout).trim();
      return selectedPath ? { path: selectedPath } : { canceled: true };
    } catch (error) {
      if (isCancelError(error)) return { canceled: true };
      throw error;
    }
  }

  if (process.platform === "win32") {
    // PowerShell single-quoted string with embedded single quotes escaped. The
    // prompt comes from the fixed PICKER_PROMPTS map, so no client text can reach
    // the command line.
    const escapedPrompt = prompt.replace(/'/g, "''");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$dialog.Description = '${escapedPrompt}'`,
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }",
    ].join("; ");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { timeout: 120000 });
    const selectedPath = String(stdout).trim();
    return selectedPath ? { path: selectedPath } : { canceled: true };
  }

  // Linux: title for zenity/kdialog uses the fixed prompt string only.
  const title = prompt;
  const script = [
    "if command -v zenity >/dev/null 2>&1; then",
    `  zenity --file-selection --directory --title='${title.replace(/'/g, "'\\''")}'`,
    "elif command -v kdialog >/dev/null 2>&1; then",
    `  kdialog --getexistingdirectory . '${title.replace(/'/g, "'\\''")}'`,
    "else",
    "  echo 'No supported directory picker found. Install zenity or kdialog, or enter the path manually.' >&2",
    "  exit 127",
    "fi",
  ].join("\n");

  try {
    const { stdout } = await execFileAsync("sh", ["-lc", script], { timeout: 120000 });
    const selectedPath = String(stdout).trim();
    return selectedPath ? { path: selectedPath } : { canceled: true };
  } catch (error) {
    if (isCancelError(error)) return { canceled: true };
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    // Accept an optional JSON body `{ purpose?: "project" | "git-parent" }`.
    // Older callers send no body; default to "project" for compatibility.
    const body = (await request.json().catch(() => ({}))) as { purpose?: unknown };
    const purpose = body?.purpose;
    if (purpose !== undefined && purpose !== "project" && purpose !== "git-parent") {
      return NextResponse.json({ error: "Invalid purpose. Expected 'project' or 'git-parent'." }, { status: 400 });
    }
    const resolvedPurpose: DirectoryPickerPurpose = purpose === "git-parent" ? "git-parent" : "project";
    const result = await pickDirectory(resolvedPurpose);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}