// What the splash screen says about how this app was made. Every number is measured, not
// estimated; refresh them rather than editing by hand:
//   session: python3 -I scripts/session_stats.py <the agent's session .jsonl>
//   code:    file and line counts of table/ page/ action/ api/ menu/ (YAML) and web/books/src
//   issues:  "## " headings in FEEDBACK.md

export const ABOUT = {
  vantageVersion: "1.13.3",
  agent: "Claude Opus 5.5",
  measuredOn: "7 November 2026",
  session: {
    started: "5 November 2026",
    wallHours: 56.8,          // first to last entry of the session log
    activeHours: 3.9,         // gaps between log entries, pauses over 10 minutes left out
    prompts: 51,              // messages the person typed
    modelTurns: 859,
    toolCalls: 1541,
    outputTokens: 809_437,
    inputTokens: 380_778_306, // 99.4% of it read back from the prompt cache
    cacheReadShare: 0.994,
  },
  build: {
    tables: 25, pages: 16, actions: 17, yamlLines: 2238,  // the Vantage app (YAML)
    webFiles: 40, webLines: 8140,                          // this web app (TypeScript, CSS)
    tests: 34, e2eTests: 24, unitTests: 10,                // npx playwright test, npm test
    issuesReported: 12,                                    // FEEDBACK.md, back to Vantage
  },
  books: { years: "2016–2022", documents: 1646, contacts: 44 },
} as const;
