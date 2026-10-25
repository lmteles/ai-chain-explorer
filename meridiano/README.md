# Meridiano: planning pack

Documents for building Meridiano from scratch. Read in this order:

1. `MEMO.md`: decisions, prices, news-access layers (GDELT included), AI model costs, architecture, operating model.
   Living document: update it and its changelog when a decision changes.
2. `BUILD_PROMPTS.md`: the build, split into phases 0–12. Paste one phase at a time into Claude Code; each has
   acceptance tests and a security gate.
3. `WEBSITE_PROMPT.md`: website and subscriber-area brief, design tokens, and copyright guardrails on design.
4. `SECURITY_PRIVACY.md`: security, LGPD and GDPR review and the pre-launch checklist.

To start the build later, ask Claude: "Build Meridiano from scratch following meridiano/BUILD_PROMPTS.md, starting
with Phase 0." These files can move to a dedicated private repository; copy them into its `docs/` folder.
