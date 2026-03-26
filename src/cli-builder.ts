import { Command } from "commander";
import type {
  CliOptions,
  CliContext,
  CommandRegistrar,
  DispatcherHandler,
  CommandDispatcher,
} from "./types";
import type { AuthSession } from "./auth/types";
import { resolveAuth, saveEnvironment, switchEnvironment, listEnvironments, getActiveEnvConfig, loadConfig, verifyCredentials } from "./config";
import { SessionManager } from "./session";
import { formatOutput, type OutputMode } from "./output";
import { prompt, hiddenPrompt } from "./prompt";
import { fetchAndGenerate } from "./codegen/index";
import { loadRoutineFile, loadSpecFile, listRoutines, validateRoutine, formatRoutineTree, formatRoutineList } from "./routine/loader";
import { executeRoutine } from "./routine/executor";
import { buildDispatcher } from "./routine/dispatcher";
import { existsSync, mkdirSync, cpSync, readdirSync } from "fs";
import { homedir } from "os";
import { resolve, join } from "path";

export interface Cli {
  command(name: string, registrar: CommandRegistrar): void;
  dispatcher(name: string, handler: DispatcherHandler): void;
  run(): Promise<void>;
}

const CORE_COMMANDS = new Set([
  "setup",
  "login",
  "config",
  "generate",
  "routine",
]);

function showCustomHelp(program: Command, cliName: string, showAll: boolean): void {
  console.log(`Usage: ${program.name()} [options] [command]\n`);
  console.log(`${program.description()}\n`);

  // Options
  console.log("Options:");
  for (const opt of program.options) {
    console.log(`  ${opt.flags.padEnd(30)} ${opt.description}`);
  }
  console.log(`  ${"-h, --help".padEnd(30)} display help for command`);

  // Core commands
  const core = program.commands.filter((c) => CORE_COMMANDS.has(c.name()));
  const api = program.commands.filter(
    (c) => !CORE_COMMANDS.has(c.name()) && c.name() !== "help",
  );

  if (core.length > 0) {
    console.log("\nCommands:");
    for (const cmd of core) {
      console.log(`  ${cmd.name().padEnd(30)} ${cmd.description()}`);
    }
  }

  if (showAll && api.length > 0) {
    console.log(`\nAPI Commands (${api.length}):`);
    for (const cmd of api) {
      console.log(`  ${cmd.name()}`);
    }
  } else if (api.length > 0) {
    console.log(
      `\n  ${api.length} API command groups available — run '${cliName} --help' to list all`,
    );
  }

  console.log(`\nRun '${cliName} <command> --help' for details on any command.`);
}

export function createCli(options: CliOptions): Cli {
  const consumerCommands: { name: string; registrar: CommandRegistrar }[] = [];
  const consumerDispatchers = new Map<string, DispatcherHandler>();
  const cliName = options.name;
  const routinesDir = join(homedir(), `.${cliName}`, "routines");
  const generatedDir = options.generatedDir ?? join(process.cwd(), "src", "generated");

  const cli: Cli = {
    command(name: string, registrar: CommandRegistrar): void {
      consumerCommands.push({ name, registrar });
    },

    dispatcher(name: string, handler: DispatcherHandler): void {
      consumerDispatchers.set(name, handler);
    },

    async run(): Promise<void> {
      const program = new Command();

      // 1. Build Commander program
      program
        .name(cliName)
        .description(options.description)
        .version(options.version);

      // 2. Register output mode flags
      if (options.outputModes?.includes("table")) {
        program.option("--table", "Output as table");
      }
      if (options.outputModes?.includes("quiet")) {
        program.option("--quiet", "Suppress output");
      }
      program.option(
        "-o, --output <format>",
        `Output format (${(options.outputModes || ["json", "table", "quiet"]).join(", ")}, routine-step)`,
      );

      // 3. Register built-in commands

      // setup / login
      const setupAction = async () => {
        await interactiveSetup(cliName);
      };
      program
        .command("setup")
        .description("Interactive setup — configure URL and credentials")
        .action(setupAction);
      program
        .command("login")
        .description("Alias for setup")
        .action(setupAction);

      // config
      const config = program
        .command("config")
        .description("Manage environment configurations");

      config
        .command("list")
        .description("List all configured environments")
        .action(async () => {
          const envs = await listEnvironments(cliName);
          if (envs.length === 0) {
            console.log(
              `No environments configured. Run '${cliName} setup' to add one.`,
            );
            return;
          }
          for (const env of envs) {
            const marker = env.active ? "* " : "  ";
            console.log(`${marker}${env.name}\t${env.url}\t${env.user}`);
          }
        });

      config
        .command("switch <name>")
        .description("Switch active environment")
        .action(async (name: string) => {
          const ok = await switchEnvironment(cliName, name);
          if (!ok) {
            const envs = await listEnvironments(cliName);
            console.error(
              `Environment '${name}' not found. Available: ${envs.map((e) => e.name).join(", ") || "none"}`,
            );
            process.exit(1);
          }
          // Clear session cache — old session is for a different server
          const sessionMgr = new SessionManager(cliName);
          sessionMgr.invalidate();
          console.log(`Switched to '${name}'`);
        });

      // config import — only if knownSites provided
      if (options.knownSites) {
        const knownSites = options.knownSites;
        config
          .command("import [alias]")
          .description("Import a known site — only provide credentials")
          .option("--user <email>", "Email for authentication")
          .option("--password <password>", "Password for authentication")
          .action(
            async (
              aliasArg: string | undefined,
              opts: { user?: string; password?: string },
            ) => {
              let alias = aliasArg;

              // Interactive picker if no alias provided
              if (!alias) {
                const siteEntries = Object.entries(knownSites);
                if (siteEntries.length === 0) {
                  console.error("No known sites configured.");
                  process.exit(1);
                }

                console.log("\nAvailable sites:");
                siteEntries.forEach(([name, site], i) => {
                  console.log(
                    `  ${(i + 1).toString().padStart(2)}. ${name.padEnd(22)} ${site.description}`,
                  );
                });

                const selection = await prompt(
                  `\nSelect site (1-${siteEntries.length}): `,
                );
                const index = parseInt(selection);
                if (index < 1 || index > siteEntries.length) {
                  console.error("Invalid selection.");
                  process.exit(1);
                }
                alias = siteEntries[index - 1]![0];
              }

              // Validate alias is known
              if (!knownSites[alias]) {
                console.error(`Unknown site '${alias}'.`);
                process.exit(1);
              }

              const site = knownSites[alias];
              const user = opts.user ?? (await prompt("Email: "));
              const password =
                opts.password ?? (await hiddenPrompt("Password: "));
              if (!user || !password) {
                console.error("Email and password are required.");
                process.exit(1);
              }

              // Verify credentials
              const result = await verifyCredentials(site.url, user, password);
              if (!result.ok) {
                console.error(result.reason);
                console.error(
                  "Credentials saved anyway — they'll be used when the server is available.",
                );
              } else {
                console.log("Credentials verified.");
              }

              await saveEnvironment(cliName, alias, {
                url: site.url,
                user,
                password,
              });
              console.log(`Saved and switched to '${alias}'.`);
            },
          );

        config
          .command("update-password [name]")
          .description("Update password for an environment (defaults to active)")
          .option("--password <password>", "New password")
          .action(
            async (
              name: string | undefined,
              opts: { password?: string },
            ) => {
              const cfg = await loadConfig(cliName);
              if (
                !cfg ||
                Object.keys(cfg.environments).length === 0
              ) {
                console.error(
                  `No environments configured. Run '${cliName} config import' first.`,
                );
                process.exit(1);
              }

              const envName = name ?? cfg.active;
              const env = cfg.environments[envName];
              if (!env) {
                console.error(`Environment '${envName}' not found.`);
                process.exit(1);
              }

              console.log(
                `Updating password for '${envName}' (${env.url})`,
              );

              const password =
                opts.password ?? (await hiddenPrompt("New password: "));
              if (!password) {
                console.error("Password is required.");
                process.exit(1);
              }

              await saveEnvironment(
                cliName,
                envName,
                { ...env, password },
                false,
              );
              console.log("Password updated.");
            },
          );
      }

      // generate
      program
        .command("generate")
        .description(
          "Regenerate CLI from the active environment's OpenAPI spec",
        )
        .action(async () => {
          const env = getActiveEnvConfig(cliName);
          if (!env) {
            console.error(
              `No active environment. Run '${cliName} setup' first.`,
            );
            process.exit(2);
          }
          console.log(`Generating from ${env.url} ...`);
          try {
            await fetchAndGenerate({
              baseUrl: env.url,
              specPath: options.specPath,
              outDir: generatedDir,
              auth: { username: env.user, password: env.password },
            });
            console.log(`Generated files written to ${generatedDir}`);
          } catch (err) {
            console.error(
              "Generation failed:",
              err instanceof Error ? err.message : String(err),
            );
            process.exit(1);
          }
        });

      // 4. Resolve auth
      let resolved = resolveAuth(cliName);

      const cmd = process.argv[2];
      const skipAuthCommands = new Set([
        "login",
        "setup",
        "config",
        "routine",
        "generate",
      ]);
      if (
        !resolved &&
        process.stdin.isTTY &&
        cmd &&
        !skipAuthCommands.has(cmd)
      ) {
        await interactiveSetup(cliName);
        resolved = resolveAuth(cliName);
      }

      // 5 + 6. Create session and build CliContext
      let ctx: CliContext | null = null;

      if (resolved) {
        try {
          const sessionMgr = new SessionManager(cliName);
          const session = await sessionMgr.resolve(
            options.auth,
            resolved,
          );

          ctx = {
            client: null,
            session,
            auth: resolved,
            strategy: options.auth,
            refreshSession: async () => {
              sessionMgr.invalidate();
              const newSession = await sessionMgr.resolve(
                options.auth,
                resolved!,
              );
              ctx!.session = newSession;
            },
          };

          // 7. Register generated commands — try to import from consumer's generated dir
          try {
            const commandsModule = await import(
              resolve(generatedDir, "commands")
            );
            if (commandsModule.registerGeneratedCommands) {
              const { ApiClient } = await import(
                resolve(generatedDir, "client")
              );
              const client = new ApiClient(
                resolved.baseUrl,
                () => ctx!.session.headers,
              );
              ctx.client = client;

              const onResult = (result: unknown) => {
                if (result === undefined) return;
                const mode: OutputMode = program.opts().table
                  ? "table"
                  : program.opts().quiet
                    ? "quiet"
                    : "json";
                const output = formatOutput(result, mode);
                if (output) console.log(output);
              };

              commandsModule.registerGeneratedCommands(
                program,
                client,
                onResult,
              );
            }
          } catch {
            // Generated commands not available — consumer hasn't run `generate` yet
          }

          // 8. Register consumer commands
          for (const { registrar } of consumerCommands) {
            registrar(program, ctx);
          }
        } catch {
          // Auth/session failed — only setup/login will work
        }
      } else {
        // No auth resolved — still register consumer commands with null context
        // so help text is available, but actions will fail at runtime
      }

      // 9. Build dispatcher
      let commandMap:
        | Record<
            string,
            {
              operationId: string;
              pathParams: string[];
              queryParams: string[];
              hasBody: boolean;
            }
          >
        | undefined;
      try {
        const mapModule = await import(
          resolve(generatedDir, "command-map")
        );
        commandMap = mapModule.commandMap;
      } catch {
        // No command-map available
      }

      // Only build dispatcher if we have a context
      let dispatch: CommandDispatcher | undefined;
      if (ctx) {
        dispatch = buildDispatcher({
          commandMap,
          client: ctx.client,
          consumerHandlers: consumerDispatchers.size > 0 ? consumerDispatchers : undefined,
          preDispatch: options.preDispatch,
          ctx,
          routinesDir,
          builtinsMap: options.builtinRoutinesDir
            ? loadBuiltinRoutines(options.builtinRoutinesDir)
            : undefined,
        });
      }

      // 10. Register routine commands
      registerRoutineCommand(program, cliName, routinesDir, dispatch, options.builtinRoutinesDir);

      // 11. Handle -o routine-step
      const isRoutineStep =
        (process.argv.includes("-o") &&
          process.argv[process.argv.indexOf("-o") + 1] === "routine-step") ||
        (process.argv.includes("--output") &&
          process.argv[process.argv.indexOf("--output") + 1] ===
            "routine-step");
      if (isRoutineStep) {
        program.hook("preAction", (_thisCommand, actionCommand) => {
          const cmdParts: string[] = [];
          let cmd: any = actionCommand;
          while (cmd.parent && cmd.parent !== program) {
            cmdParts.unshift(cmd.name());
            cmd = cmd.parent;
          }
          cmdParts.unshift(cmd.name());
          const commandPath = cmdParts.join(" ");

          // Get provided values
          const opts = actionCommand.opts();
          const providedArgs: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(opts)) {
            if (val !== undefined && key !== "output") {
              const flag =
                "--" + key.replace(/([A-Z])/g, "-$1").toLowerCase();
              providedArgs[flag] = val;
            }
          }

          // Build output lines manually for comment support
          const positional = actionCommand.args || [];
          const lines: string[] = [];
          lines.push(`- name: ${cmdParts[cmdParts.length - 1]}`);
          lines.push(`  command: ${commandPath}`);

          // Get all options from the command definition
          const allOptions = (actionCommand as any).options || [];
          const skipFlags = new Set([
            "--body",
            "--body-file",
            "--output",
            "-o",
            "--verbose",
          ]);
          const isVerbose = process.argv.includes("--verbose");

          if (
            allOptions.length > 0 ||
            Object.keys(providedArgs).length > 0
          ) {
            lines.push("  args:");
            const emitted = new Set<string>();

            // Provided args first (uncommented)
            for (const [flag, val] of Object.entries(providedArgs)) {
              if (skipFlags.has(flag)) continue;
              lines.push(`    ${flag}: ${JSON.stringify(val)}`);
              emitted.add(flag);
            }

            // Remaining options as commented-out
            for (const opt of allOptions) {
              const flag = opt.long || opt.short;
              if (!flag || skipFlags.has(flag) || emitted.has(flag))
                continue;
              // Skip hidden (variant-specific) options unless --verbose
              if (opt.hidden && !isVerbose) continue;
              const desc = opt.description || "";
              lines.push(
                `    # ${flag}: "" # optional — ${desc}`,
              );
            }
          }

          if (positional.length > 0) {
            lines.push("  args-positional:");
            for (const p of positional)
              lines.push(`    - ${JSON.stringify(p)}`);
          }

          console.log(lines.join("\n"));
          process.exit(0);
        });
      }

      // 12. Custom help — intercept no-args and --help
      const userArgs = process.argv.slice(2);
      if (
        userArgs.length === 0 ||
        (userArgs.length === 1 &&
          (userArgs[0] === "--help" || userArgs[0] === "-h"))
      ) {
        const showAll =
          userArgs[0] === "--help" || userArgs[0] === "-h";
        showCustomHelp(program, cliName, showAll);
        process.exit(0);
      }

      // 13. Parse and execute
      await program.parseAsync();
    },
  };

  return cli;
}

async function interactiveSetup(cliName: string): Promise<void> {
  console.log(`${cliName} Setup\n`);

  const envName = await prompt("Environment name [default]: ", "default");
  const url = await prompt("URL [http://localhost:8080]: ", "http://localhost:8080");
  const user = await prompt("Username/Email: ");
  const password = await hiddenPrompt("Password: ");

  if (!user || !password) {
    console.error("Setup cancelled.");
    process.exit(2);
  }

  // Verify credentials
  const result = await verifyCredentials(url, user, password);
  if (!result.ok) {
    console.error(result.reason);
    console.error(
      "Credentials saved anyway — they'll be used when the server is available.",
    );
  } else {
    console.log("Credentials verified.");
  }

  await saveEnvironment(cliName, envName, { url, user, password });
  console.log(`Saved environment '${envName}' to ~/.${cliName}/config.json`);
  console.log(`Switched to '${envName}'\n`);
}

function loadBuiltinRoutines(
  builtinDir: string,
): Record<string, string> | undefined {
  if (!existsSync(builtinDir)) return undefined;
  const map: Record<string, string> = {};

  function collect(dir: string, prefix: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = resolve(dir, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        collect(fullPath, key);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
      ) {
        const { readFileSync } = require("fs");
        map[key] = readFileSync(fullPath, "utf-8");
      }
    }
  }

  collect(builtinDir, "");
  return Object.keys(map).length > 0 ? map : undefined;
}

function registerRoutineCommand(
  program: Command,
  cliName: string,
  routinesDir: string,
  dispatch: CommandDispatcher | undefined,
  builtinRoutinesDir?: string,
): void {
  const builtinsMap = builtinRoutinesDir
    ? loadBuiltinRoutines(builtinRoutinesDir)
    : undefined;

  const routine = program
    .command("routine")
    .description("Manage and run routines");

  routine
    .command("list [path]")
    .description("List available routines (optionally drill into a group)")
    .option("--tree", "Show full tree structure")
    .action((path: string | undefined, opts: { tree?: boolean }) => {
      const routines = listRoutines(routinesDir, builtinsMap);
      if (routines.length === 0) {
        console.log(`No routines found in ~/.${cliName}/routines/`);
        console.log(`Run '${cliName} routine init' to install built-in routines.`);
        return;
      }

      let filtered = routines;
      if (path) {
        const prefix = path.replace(/\/+$/, "");
        filtered = routines
          .filter((r) => {
            const clean = r.replace(/\x1b\[[0-9;]*m/g, "").trim();
            return clean.startsWith(prefix + "/");
          })
          .map((r) => {
            const clean = r.replace(/\x1b\[[0-9;]*m/g, "").trim();
            return clean.slice(prefix.length + 1);
          });
        if (filtered.length === 0) {
          console.log(`No routines found under '${prefix}/'`);
          return;
        }
      }

      console.log(
        opts.tree
          ? formatRoutineTree(filtered)
          : formatRoutineList(filtered, path?.replace(/\/+$/, "")),
      );
    });

  routine
    .command("run <name>")
    .description("Execute a routine")
    .option("--set <pairs...>", "Override variables (key=value)")
    .option("--dry-run", "Print resolved commands without executing")
    .action(async (name: string, opts: { set?: string[]; dryRun?: boolean }) => {
      if (!dispatch) {
        console.error(
          `No active session. Run '${cliName} setup' first.`,
        );
        process.exit(2);
      }

      const def = loadRoutineFile(name, routinesDir, builtinsMap);
      const errors = validateRoutine(def);
      if (errors.length > 0) {
        console.error("Validation errors:");
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
      }

      // Clear stale session so routine starts fresh
      const sessionMgr = new SessionManager(cliName);
      sessionMgr.invalidate();

      const overrides: Record<string, unknown> = {};
      for (const s of opts.set || []) {
        const eq = s.indexOf("=");
        if (eq > 0) overrides[s.slice(0, eq)] = s.slice(eq + 1);
      }

      console.log(
        `Running routine: ${def.name}${def.description ? ` — ${def.description}` : ""}\n`,
      );

      const startTime = Date.now();
      const result = await executeRoutine(def, overrides, dispatch, {
        dryRun: opts.dryRun,
        onStep: (step, i, total) => {
          console.log(`\x1b[36m[${i + 1}/${total}]\x1b[0m ${step.name}`);
        },
      });

      const elapsed = Date.now() - startTime;
      const mins = Math.floor(elapsed / 60000);
      const secs = ((elapsed % 60000) / 1000).toFixed(1);
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      console.log(
        `\nRoutine ${result.success ? "\x1b[32mcompleted\x1b[0m" : "\x1b[31mfailed\x1b[0m"}: ${result.stepsRun} run, ${result.stepsSkipped} skipped, ${result.stepsFailed} failed (${timeStr})`,
      );
      if (!result.success) process.exit(1);
    });

  routine
    .command("validate <name>")
    .description("Validate a routine YAML file")
    .action((name: string) => {
      const def = loadRoutineFile(name, routinesDir, builtinsMap);
      const errors = validateRoutine(def);
      if (errors.length > 0) {
        console.error("Validation errors:");
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
      }
      console.log(`Routine "${def.name}" is valid.`);
    });

  routine
    .command("test <name>")
    .description("Run a routine's spec (test) file")
    .option("--set <pairs...>", "Override variables (key=value)")
    .action(async (name: string, opts: { set?: string[] }) => {
      if (!dispatch) {
        console.error(
          `No active session. Run '${cliName} setup' first.`,
        );
        process.exit(2);
      }

      const spec = loadSpecFile(name, routinesDir, builtinsMap);
      if (!spec) {
        console.error(`No spec.yaml found for routine "${name}".`);
        console.error(
          `Specs are optional but live at ~/.${cliName}/routines/<name>/spec.yaml`,
        );
        process.exit(1);
      }

      const errors = validateRoutine(spec);
      if (errors.length > 0) {
        console.error("Spec validation errors:");
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
      }

      const overrides: Record<string, unknown> = {};
      for (const s of opts.set || []) {
        const eq = s.indexOf("=");
        if (eq > 0) overrides[s.slice(0, eq)] = s.slice(eq + 1);
      }

      console.log(
        `\x1b[36mTesting routine: ${name}\x1b[0m${spec.description ? ` — ${spec.description}` : ""}\n`,
      );

      const result = await executeRoutine(spec, overrides, dispatch, {
        onStep: (step, i, total) => {
          console.log(
            `\x1b[36m[${i + 1}/${total}]\x1b[0m ${step.name}${step.assert ? " \x1b[33m(assert)\x1b[0m" : ""}`,
          );
        },
      });

      console.log("");
      if (result.success) {
        console.log(
          `\x1b[32mPASSED\x1b[0m: ${result.stepsRun} steps run, ${result.stepsSkipped} skipped`,
        );
      } else {
        console.log(
          `\x1b[31mFAILED\x1b[0m: ${result.stepsRun} steps run, ${result.stepsFailed} failed`,
        );
        process.exit(1);
      }
    });

  routine
    .command("init")
    .description(`Copy built-in routines to ~/.${cliName}/routines/`)
    .action(() => {
      mkdirSync(routinesDir, { recursive: true });
      const builtinDir = builtinRoutinesDir;
      if (!builtinDir || !existsSync(builtinDir)) {
        console.error("No built-in routines directory found.");
        return;
      }
      cpSync(builtinDir, routinesDir, { recursive: true });
      const routines = readdirSync(builtinDir);
      console.log(`Installed ${routines.length} routines to ${routinesDir}`);
    });
}
