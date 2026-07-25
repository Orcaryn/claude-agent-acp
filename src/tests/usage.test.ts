import { SessionNotification } from "@agentclientprotocol/sdk";
import type { AcpClient, ClaudeAcpAgent as ClaudeAcpAgentType } from "../acp-agent.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FIVE_HOUR = { utilization: 42, resets_at: "2026-01-01T00:00:00Z" };
const SEVEN_DAY = { utilization: 7, resets_at: "2026-01-07T00:00:00Z" };

let rateLimits: Record<string, unknown> | null = null;
let usageFailure: Error | undefined;
const close = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/claude-agent-sdk")>(
    "@anthropic-ai/claude-agent-sdk",
  );
  const { makeMockQuery } = await import("./helpers.js");
  return {
    ...actual,
    query: () =>
      makeMockQuery({
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
          if (usageFailure) {
            throw usageFailure;
          }
          return { rate_limits: rateLimits };
        },
        close,
      }),
  };
});

describe("_claude/usage", () => {
  let agent: ClaudeAcpAgentType;

  beforeEach(async () => {
    // Skips the CLI lookup readUsage would otherwise do to spawn the query.
    process.env.CLAUDE_CODE_EXECUTABLE = "/bin/true";
    rateLimits = { five_hour: FIVE_HOUR, seven_day: SEVEN_DAY };
    usageFailure = undefined;
    close.mockClear();
    vi.resetModules();
    const { ClaudeAcpAgent } = await import("../acp-agent.js");
    agent = new ClaudeAcpAgent({
      sessionUpdate: async (_notification: SessionNotification) => {},
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      readTextFile: async () => ({ content: "" }),
      writeTextFile: async () => ({}),
    } as unknown as AcpClient);
  });

  afterEach(() => void delete process.env.CLAUDE_CODE_EXECUTABLE);

  it("returns only the requested windows, verbatim", async () => {
    expect(await agent.readUsage({ keys: ["five_hour"] })).toEqual({ five_hour: FIVE_HOUR });
  });

  it("omits windows the SDK does not report", async () => {
    rateLimits = { five_hour: FIVE_HOUR };

    expect(await agent.readUsage({ keys: ["five_hour", "seven_day"] })).toEqual({
      five_hour: FIVE_HOUR,
    });
  });

  it("returns nothing when plan limits do not apply", async () => {
    rateLimits = null;

    expect(await agent.readUsage({ keys: ["five_hour", "seven_day"] })).toEqual({});
  });

  it("closes the ephemeral query even when the usage request fails", async () => {
    usageFailure = new Error("no usage for you");

    await expect(agent.readUsage({ keys: ["five_hour"] })).rejects.toThrow("no usage for you");
    expect(close).toHaveBeenCalled();
  });
});
