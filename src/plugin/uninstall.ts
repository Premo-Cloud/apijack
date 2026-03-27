import { existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

export interface UninstallOptions {
  claudeDir: string;
}

export interface UninstallResult {
  success: boolean;
  message: string;
}

export async function uninstallPlugin(opts: UninstallOptions): Promise<UninstallResult> {
  const { claudeDir } = opts;

  // 1. Remove from installed_plugins.json
  const installedPath = join(claudeDir, "plugins", "installed_plugins.json");
  if (existsSync(installedPath)) {
    try {
      const installed = JSON.parse(readFileSync(installedPath, "utf-8"));
      delete installed.plugins["apijack@local"];
      writeFileSync(installedPath, JSON.stringify(installed, null, 2) + "\n");
    } catch {}
  }

  // 2. Remove from settings.json enabledPlugins
  const settingsPath = join(claudeDir, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      if (settings.enabledPlugins) {
        delete settings.enabledPlugins["apijack@local"];
      }
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    } catch {}
  }

  // 3. Remove plugin cache directory
  const cacheDir = join(claudeDir, "plugins", "cache", "local", "apijack");
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
  }

  // NOTE: User data at ~/.apijack/ is intentionally preserved

  return {
    success: true,
    message: "apijack plugin uninstalled. User data preserved at ~/.apijack/",
  };
}
