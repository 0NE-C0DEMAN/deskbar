This project is billed by the hour. The ledger is `timelog/entries.jsonl` in the project root (one JSON object per line) and `timelog/running.json` exists while a timer runs. The band above the prompt shows the timer to the user. Drive it with the `mcp__deskbar__timer` tool (actions: start, stop, switch, status). Where the project also has `timelog/timelog.py`, that script writes the same files, so either works; prefer the tool.

When to start
- Start the timer whenever you begin working on a task for this client, at the first tool call of the work, without being asked. A task being given is the signal. Claude working means the user is working.
- Timed work: building, fixing, testing and deploying code, running or watching scrapes and AI passes, validation, investigating data, walkthroughs in the browser.
- Give the timer a short task name that would make sense on an invoice.

When to stop
- Stop only when the task is finished and you are waiting on the user, or when they say stop, done, or that's it for today. Pass a note saying what actually got done.
- Use switch when the work changes to a different task without a break.

Never timed
- Admin, however long it takes: downloading or saving files, emails, attachments or transcripts, copying things into folders, tracker, sheet or memory upkeep, sending emails the user dictated, meeting briefs and status summaries.
- Tooling built for the user (the timer, skills, mods).
- If a timer was started for one of these by mistake, stop it with hours 0.

Client calls
- Start with call true. Calls are recorded in the ledger and never billed.

Corrections
- A timer left open more than 10 hours is refused on stop. Stop it again with the real hours.
- If the user says not to start the timer today, do not start it for the rest of that day unless told otherwise. The normal rule applies again the next day.
- If an estimate would push the week past the weekly cap, say so before committing to the work.

How to report
- Confirm a start or a stop in one short line ("Timer started: ..."), never a paragraph.
