import path from "node:path";

/** Env-driven settings. Read lazily so tests can change process.env between cases. */
export function config() {
  const env = process.env;
  return {
    // Hosted libSQL / Turso database (required on Vercel). Leave unset to use the local file.
    databaseUrl: env.TURSO_DATABASE_URL || "",
    databaseAuthToken: env.TURSO_AUTH_TOKEN || "",
    databasePath: env.DATABASE_PATH || path.join(process.cwd(), "instance", "resume_builder.db"),
    cookieSecure: (env.SESSION_COOKIE_SECURE || "false").toLowerCase() === "true",
    sessionMaxAgeSeconds: 60 * 60 * 24 * 7, // 7 days

    aiProvider: (env.AI_PROVIDER || "").toLowerCase(),
    geminiApiKey: env.GEMINI_API_KEY || "",
    geminiModel: env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    openaiApiKey: env.OPENAI_API_KEY || "",
    openaiModel: env.OPENAI_MODEL || "gpt-5-mini",
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    anthropicModel: env.ANTHROPIC_MODEL || "claude-haiku-5-5",
    aiTimeoutSeconds: Number(env.AI_TIMEOUT || 30),
    aiRequestsPerHour: Number(env.AI_REQUESTS_PER_HOUR || 60),

    // Login brute-force protection
    loginMaxAttempts: 5,
    loginWindowSeconds: 15 * 60,
  };
}

export type Config = ReturnType<typeof config>;
