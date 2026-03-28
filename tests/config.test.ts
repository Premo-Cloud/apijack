import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  resolveAuth,
  saveEnvironment,
  switchEnvironment,
  listEnvironments,
  getActiveEnvConfig,
  updateEnvironmentField,
  loadConfig,
} from "../src/config";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "cli-config-test-"));
}

describe("config management", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configPath = join(tmpDir, "config.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    // Clean env vars that tests may set
    delete process.env.MYAPP_URL;
    delete process.env.MYAPP_USER;
    delete process.env.MYAPP_PASS;
    delete process.env.TESTCLI_URL;
    delete process.env.TESTCLI_USER;
    delete process.env.TESTCLI_PASS;
  });

  describe("resolveAuth()", () => {
    test("reads env vars with parameterized prefix", () => {
      process.env.MYAPP_URL = "https://env.example.com";
      process.env.MYAPP_USER = "envuser";
      process.env.MYAPP_PASS = "envpass";

      const result = resolveAuth("myapp", { configPath });
      expect(result).not.toBeNull();
      expect(result!.baseUrl).toBe("https://env.example.com");
      expect(result!.username).toBe("envuser");
      expect(result!.password).toBe("envpass");
    });

    test("env vars take precedence over config file", async () => {
      await saveEnvironment("testcli", "prod", {
        url: "https://file.example.com",
        user: "fileuser",
        password: "filepass",
      }, true, { configPath, allowInsecureStorage: true });

      process.env.TESTCLI_URL = "https://env.example.com";
      process.env.TESTCLI_USER = "envuser";
      process.env.TESTCLI_PASS = "envpass";

      const result = resolveAuth("testcli", { configPath });
      expect(result!.baseUrl).toBe("https://env.example.com");
      expect(result!.username).toBe("envuser");
    });

    test("reads config file and returns active environment", async () => {
      await saveEnvironment("myapp", "staging", {
        url: "http://localhost:9090",
        user: "staginguser",
        password: "stagingpass",
      }, true, { configPath });

      const result = resolveAuth("myapp", { configPath });
      expect(result).not.toBeNull();
      expect(result!.baseUrl).toBe("http://localhost:9090");
      expect(result!.username).toBe("staginguser");
      expect(result!.password).toBe("stagingpass");
    });

    test("returns null when no env vars and no config file", () => {
      const result = resolveAuth("myapp", { configPath });
      expect(result).toBeNull();
    });

    test("returns null when env vars are partially set", () => {
      process.env.MYAPP_URL = "https://example.com";
      // MYAPP_USER and MYAPP_PASS not set

      const result = resolveAuth("myapp", { configPath });
      expect(result).toBeNull();
    });

    test("uppercases cli name for env var prefix", () => {
      process.env.MYAPP_URL = "https://upper.example.com";
      process.env.MYAPP_USER = "upperuser";
      process.env.MYAPP_PASS = "upperpass";

      const result = resolveAuth("MyApp", { configPath });
      expect(result).not.toBeNull();
      expect(result!.baseUrl).toBe("https://upper.example.com");
    });
  });

  describe("saveEnvironment()", () => {
    test("creates config file with correct structure", async () => {
      await saveEnvironment("myapp", "local", {
        url: "http://localhost:8080",
        user: "admin",
        password: "secret",
      }, true, { configPath });

      expect(existsSync(configPath)).toBe(true);

      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(raw.active).toBe("local");
      expect(raw.environments.local).toEqual({
        url: "http://localhost:8080",
        user: "admin",
        password: "secret",
      });
    });

    test("adds environment to existing config", async () => {
      await saveEnvironment("myapp", "local", {
        url: "http://localhost:8080",
        user: "admin",
        password: "secret",
      }, true, { configPath });

      await saveEnvironment("myapp", "staging", {
        url: "http://localhost:9091",
        user: "stageuser",
        password: "stagepass",
      }, false, { configPath });

      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(raw.active).toBe("local"); // didn't change active
      expect(Object.keys(raw.environments)).toEqual(["local", "staging"]);
    });

    test("sets active when setActive is true (default)", async () => {
      await saveEnvironment("myapp", "first", {
        url: "http://first.example.com",
        user: "u1",
        password: "p1",
      }, true, { configPath, allowInsecureStorage: true });

      await saveEnvironment("myapp", "second", {
        url: "http://second.example.com",
        user: "u2",
        password: "p2",
      }, true, { configPath, allowInsecureStorage: true });

      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(raw.active).toBe("second");
    });

    test("preserves extra fields in environment object", async () => {
      await saveEnvironment("myapp", "local", {
        url: "http://localhost:8080",
        user: "admin",
        password: "secret",
        projectId: 42,
        region: "us-east-1",
      } as any, true, { configPath });

      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(raw.environments.local.projectId).toBe(42);
      expect(raw.environments.local.region).toBe("us-east-1");
    });
  });

  describe("switchEnvironment()", () => {
    test("changes active environment", async () => {
      await saveEnvironment("myapp", "local", {
        url: "http://localhost",
        user: "u",
        password: "p",
      }, true, { configPath });

      await saveEnvironment("myapp", "prod", {
        url: "https://prod.example.com",
        user: "u2",
        password: "p2",
      }, false, { configPath, allowInsecureStorage: true });

      const switched = await switchEnvironment("myapp", "prod", { configPath });
      expect(switched).toBe(true);

      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(raw.active).toBe("prod");
    });

    test("returns false for non-existent environment", async () => {
      await saveEnvironment("myapp", "local", {
        url: "http://localhost",
        user: "u",
        password: "p",
      }, true, { configPath });

      const switched = await switchEnvironment("myapp", "missing", { configPath });
      expect(switched).toBe(false);
    });

    test("returns false when no config file exists", async () => {
      const switched = await switchEnvironment("myapp", "anything", { configPath });
      expect(switched).toBe(false);
    });
  });

  describe("listEnvironments()", () => {
    test("returns all environments with active flag", async () => {
      await saveEnvironment("myapp", "local", {
        url: "http://localhost",
        user: "admin",
        password: "pass",
      }, true, { configPath });

      await saveEnvironment("myapp", "staging", {
        url: "http://localhost:9091",
        user: "stage",
        password: "pass2",
      }, false, { configPath });

      const envs = await listEnvironments("myapp", { configPath });
      expect(envs).toHaveLength(2);

      const local = envs.find((e) => e.name === "local");
      expect(local).toBeDefined();
      expect(local!.active).toBe(true);
      expect(local!.url).toBe("http://localhost");
      expect(local!.user).toBe("admin");

      const staging = envs.find((e) => e.name === "staging");
      expect(staging).toBeDefined();
      expect(staging!.active).toBe(false);
    });

    test("returns empty array when no config file exists", async () => {
      const envs = await listEnvironments("myapp", { configPath });
      expect(envs).toEqual([]);
    });
  });

  describe("getActiveEnvConfig()", () => {
    test("returns full env object including extra fields", async () => {
      await saveEnvironment("myapp", "local", {
        url: "http://localhost:8080",
        user: "admin",
        password: "secret",
        projectId: 99,
        customField: "hello",
      } as any, true, { configPath });

      const env = getActiveEnvConfig("myapp", { configPath });
      expect(env).not.toBeNull();
      expect(env!.url).toBe("http://localhost:8080");
      expect(env!.user).toBe("admin");
      expect(env!.password).toBe("secret");
      expect(env!.projectId).toBe(99);
      expect(env!.customField).toBe("hello");
    });

    test("returns null when no config file exists", () => {
      const env = getActiveEnvConfig("myapp", { configPath });
      expect(env).toBeNull();
    });

    test("returns null when active environment is missing", async () => {
      // Write a config with an active that doesn't exist
      const { writeFileSync, mkdirSync } = await import("fs");
      const { dirname } = await import("path");
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify({
        active: "missing",
        environments: {
          local: { url: "http://localhost", user: "u", password: "p" },
        },
      }));

      const env = getActiveEnvConfig("myapp", { configPath });
      expect(env).toBeNull();
    });
  });

  describe("updateEnvironmentField()", () => {
    test("sets arbitrary field on active environment", async () => {
      await saveEnvironment("myapp", "local", {
        url: "http://localhost",
        user: "admin",
        password: "pass",
      }, true, { configPath });

      await updateEnvironmentField("myapp", "projectId", 42, { configPath });

      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(raw.environments.local.projectId).toBe(42);
    });

    test("overwrites existing field value", async () => {
      await saveEnvironment("myapp", "local", {
        url: "http://localhost",
        user: "admin",
        password: "pass",
        region: "us-east-1",
      } as any, true, { configPath });

      await updateEnvironmentField("myapp", "region", "eu-west-1", { configPath });

      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(raw.environments.local.region).toBe("eu-west-1");
    });

    test("does nothing when no config exists", async () => {
      // Should not throw
      await updateEnvironmentField("myapp", "key", "value", { configPath });
      expect(existsSync(configPath)).toBe(false);
    });

    test("does nothing when no active environment", async () => {
      const { writeFileSync, mkdirSync } = await import("fs");
      const { dirname } = await import("path");
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify({
        active: "missing",
        environments: {},
      }));

      await updateEnvironmentField("myapp", "key", "value", { configPath });

      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(raw.environments).toEqual({});
    });
  });

  describe("config paths", () => {
    test("uses ~/.<name>/config.json by default", () => {
      const { homedir } = require("os");
      // We can't easily test the default path without side effects,
      // but we can verify resolveAuth doesn't crash with a missing file at the default path
      const result = resolveAuth("nonexistent_cli_test_xyz");
      expect(result).toBeNull();
    });
  });

  describe("loadConfig()", () => {
    test("returns null for missing file", async () => {
      const config = await loadConfig("myapp", { configPath });
      expect(config).toBeNull();
    });

    test("loads valid config", async () => {
      await saveEnvironment("myapp", "local", {
        url: "http://localhost",
        user: "u",
        password: "p",
      }, true, { configPath });

      const config = await loadConfig("myapp", { configPath });
      expect(config).not.toBeNull();
      expect(config!.active).toBe("local");
      expect(config!.environments.local.url).toBe("http://localhost");
    });
  });

  describe("saveEnvironment() URL classification", () => {
    test("allows localhost URLs", async () => {
      await saveEnvironment("testcli", "local", {
        url: "http://localhost:8080",
        user: "admin",
        password: "pass",
      }, true, { configPath });

      const config = await loadConfig("testcli", { configPath });
      expect(config!.environments.local.password).toBe("pass");
    });

    test("blocks production URLs by default", async () => {
      expect(
        saveEnvironment("testcli", "prod", {
          url: "https://api.example.com",
          user: "admin",
          password: "pass",
        }, true, { configPath }),
      ).rejects.toThrow("Production API detected");
    });

    test("allows production URLs with allowInsecureStorage", async () => {
      await saveEnvironment("testcli", "prod", {
        url: "https://api.example.com",
        user: "admin",
        password: "pass",
      }, true, { configPath, allowInsecureStorage: true });

      const config = await loadConfig("testcli", { configPath });
      expect(config!.environments.prod.password).toBe("pass");
    });

    test("allows IPs in allowed CIDRs", async () => {
      await saveEnvironment("testcli", "internal", {
        url: "http://192.168.1.50:8080",
        user: "admin",
        password: "pass",
      }, true, { configPath, allowedCidrs: ["192.168.1.0/24"] });

      const config = await loadConfig("testcli", { configPath });
      expect(config!.environments.internal.password).toBe("pass");
    });

    test("blocks IPs outside allowed CIDRs", async () => {
      expect(
        saveEnvironment("testcli", "external", {
          url: "http://54.231.10.5:8080",
          user: "admin",
          password: "pass",
        }, true, { configPath, allowedCidrs: ["192.168.1.0/24"] }),
      ).rejects.toThrow("Production API detected");
    });
  });
});
