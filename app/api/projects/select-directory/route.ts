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

function isCancelError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String(error.message) : "";
  const stderr = "stderr" in error ? String(error.stderr) : "";
  return /cancel/i.test(`${message}\n${stderr}`);
}

async function pickDirectory(): Promise<DirectoryPickResult> {
  if (process.platform === "darwin") {
    const script = `POSIX path of (choose folder with prompt "Select project directory")`;
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
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Select project directory'",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }",
    ].join("; ");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { timeout: 120000 });
    const selectedPath = String(stdout).trim();
    return selectedPath ? { path: selectedPath } : { canceled: true };
  }

  const script = [
    "if command -v zenity >/dev/null 2>&1; then",
    "  zenity --file-selection --directory --title='Select project directory'",
    "elif command -v kdialog >/dev/null 2>&1; then",
    "  kdialog --getexistingdirectory . 'Select project directory'",
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

export async function POST() {
  try {
    const result = await pickDirectory();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
