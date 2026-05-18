# /page-health — UI health check across all key pages

Run `scripts/pageHealthCheck.js` to inspect every key page (default: `/`, `/portfolio`, `/command-center`, `/scanner`), capture screenshots + console + network errors, and produce a traffic-light summary.

## Usage

```
/page-health                              # all default pages
/page-health /scanner,/command-center     # specific pages
```

## What you should do

1. Read the user's args. If they specified pages, pass `--pages=<comma-list>` to the CLI.
2. Run:
   ```
   node scripts/pageHealthCheck.js [--pages=<list>]
   ```
3. Wait for completion (~10-30 seconds depending on page count).
4. Output is already markdown-formatted — pass it through verbatim, then add a one-sentence verdict at the top.
5. If any page has more than 0 errors that aren't on the known-acceptable list (see `.claude/agents/ui-inspector.md`), call them out specifically and suggest the next step (usually: invoke the `ui-inspector` subagent for a detailed diagnosis on the offending page).

## Output format

```
## UI Health: ✅ all green | ⚠️ N pages with issues | ❌ N broken

[verbatim CLI output]

## Next step
[1 sentence — either "all clear, nothing to do" or "run ui-inspector on /scanner for details on the 3 console errors"]
```

Don't auto-fix anything found. Diagnostic only.
