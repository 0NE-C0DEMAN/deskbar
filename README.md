# Deskbar

[![Deskbar: a 28-second tour](media/deskbar-launch-v1.gif)](media/deskbar-launch-16x9-v1-web.mp4)

The tour above is an animation made with demo data. Click it for the version with sound, or see the [vertical cut](media/deskbar-launch-9x16-v1-web.mp4).

A desk for the Claude Code prompt. One row of small widgets sits above the prompt box, and each one opens a dropdown:

| Widget | What it shows | What you can do |
|---|---|---|
| Weather | How full the context window is, as a weather icon and a percentage | `/weather` prints the token counts and their history |
| Mail | Your Gmail Primary tab, the latest few, unread ones marked | Click a subject to open that thread in Gmail |
| Calendar | How many meetings are left this week, and the next one as it gets close | A Join link, and a field to add an event by typing "call with Sam tomorrow 6pm for 45m" |
| Tasks | The task lists Claude keeps in each session, to do and done side by side, with a progress bar | Search and switch between the sessions of any project |
| Notes | One notes list shared by every session | Type or dictate a note; "in 30m", "at 5pm" or "tomorrow" sets a reminder; turn a note into a calendar event, or hand it to Claude |
| Music | A retro deck: track, artist, cover, progress and a live spectrum of your speaker output | Back, play or pause, stop, next, volume, for anything Windows sees as media (YouTube Music in a browser, Spotify) |
| Timer | A billable-hours clock for the project | Start and stop; today and the week against a weekly cap; Claude starts and stops it by the rules in `rules.md` |
| Settings | | Which widgets show, how often mail is checked, the music bars and sounds |

The widgets read their data directly. No model call is made unless you press the one button that asks for it (handing a note to Claude).

## Requirements

- **Claude Code 2.1.286 or later**, in the desktop app (Code tab) or a terminal. 2.1.287 or later is better: it draws the smooth animations in the desktop app too.
- **For mail and calendar:** the Gmail and Google Calendar connectors connected to your Claude account.
- **For music:** Windows 10 or 11 and Python 3.11 or later. Everything else works on any platform.

What each widget needs before it shows anything:

| Widget | Needs |
|---|---|
| Weather, tasks, notes, timer, settings | Nothing. They work as soon as the row is on. |
| Mail | The Gmail connector, connected in Claude's settings. |
| Calendar | The Google Calendar connector, connected in Claude's settings. |
| Music | Windows, Python 3.11 or later, and the helper set up as below. Any player Windows sees as media works; no browser extension is needed. |

A widget whose connector is missing shows `?` on its icon and says why in its dropdown. The rest of the row keeps working. To drop a widget you do not use, turn it off in the settings dropdown.

## Install

1. **Get the code.**

   ```bash
   git clone https://github.com/0NE-C0DEMAN/deskbar.git
   ```

   Put it somewhere permanent, for example `~/.claude/mods/deskbar`.

2. **Tell Claude Code to load it.** Open `~/.claude/settings.json` (create it if it does not exist) and add these two lines to its `env` block, with your own path:

   ```json
   {
     "env": {
       "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
       "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\you\\.claude\\mods\\deskbar"
     }
   }
   ```

   On macOS or Linux the path looks like `/Users/you/.claude/mods/deskbar`. To load several mods, separate their paths with `;` on Windows or `:` elsewhere.

3. **Restart Claude Code.** In the desktop app, quit it from the system tray or menu bar and open it again; closing the window is not enough.

4. **Turn it on where you want it.** In a session, run:

   ```
   /desk on
   ```

   The row is off in every session until you turn it on there, so it never appears where you did not ask for it, and never in scheduled-task sessions.

To try it for one terminal session without changing any settings:

```bash
claude --plugin-dir /path/to/deskbar
```

## Connect Gmail and Google Calendar

The mail and calendar widgets use Claude's own connectors; the mod never sees your password or a token.

1. Open Claude (the desktop app or claude.ai), go to **Settings**, then **Connectors**.
2. Connect **Gmail** and **Google Calendar** and approve the access Google asks for.
3. Restart Claude Code. The mail and calendar icons fill in within a few seconds of `/desk on`.

If an icon shows `?`, open its dropdown: it says what the connector answered.

## Set up the music deck (Windows)

The deck needs a small helper that reads Windows' media session (the same one the volume pop-up shows) and listens to the speaker output for the spectrum. It runs only while the music dropdown is open, and stops by itself about 12 seconds after you close it.

In a terminal, with Python 3.11 or later:

```bash
cd %USERPROFILE%\.claude
mkdir deskbar-data\music
cd deskbar-data\music
python -m venv .venv
.venv\Scripts\pip install -r C:\path\to\deskbar\helper\requirements.txt
```

Then open the music dropdown, click **Open YouTube Music** (or start your own player) and play something. With `uv`, `uv venv --python 3.11 .venv` and `uv pip install --python .venv\Scripts\python.exe -r ...` do the same, faster.

## Set up the timer

The timer shows in every project. The first time you press start, or ask Claude to time the work, it makes a `timelog` folder in the project with the folder's name as the client and no rate or cap. Until then Claude does not start the timer by itself. To set a rate and a weekly cap, run:

```
/timer setup 20 15 Acme
```

That makes `timelog/config.json` (a rate of 20 an hour, a 15-hour weekly cap, the client's name) and an empty ledger, `timelog/entries.jsonl`, which keeps one JSON line per entry:

```json
{"id": 1, "date": "2026-10-02", "start": "2026-10-02T09:30:00", "end": "2026-10-02T11:00:00", "hours": 1.5, "task": "Parser fix", "note": "", "evidence": "", "billable": true, "invoice": null}
```

Claude gets a `timer` tool and the rules in `rules.md`: when to start, when to stop, what is never timed. To give one project its own rules, put a `rules.md` in its `timelog` folder.

## Commands

| Command | What it does |
|---|---|
| `/desk on`, `/desk off`, `/desk` | Turn the row on or off for this session, or toggle it |
| `/desk demo` | Show made-up mail, meetings, tasks and notes instead of yours, for screenshots and recordings; run it again to switch back |
| `/weather` | Print the context usage in detail |
| `/timer start <task>`, `/timer call <task>` | Start timing; a call is recorded but never billed |
| `/timer stop [note]`, `/timer switch <task>` | Close the entry, or close it and start another |
| `/timer status`, `/timer panel` | Print today's, this week's and the unbilled totals, or open the timer in a side panel |
| `/timer setup <rate> <weekly cap> [client]` | Turn the timer on for this project |

## Settings

Click the gear at the end of the row. Settings apply to every session:

- **Widgets:** which ones show in the row.
- **Mail check:** every 1, 3, 5 or 10 minutes. Mail and calendar are also checked on every click of their icon and after each reply.
- **Music bars:** on or off.
- **Sounds:** on or off.

They are saved in `~/.claude/deskbar-data/settings.json`.

## Motion and sound

- In a terminal, and in the desktop app from Claude Code 2.1.287, the music bars, the tasks progress bar, the timer's week bar and the attention dots are surface modules (`hooks/spectrum.tsx`, `meter.tsx`, `pulse.tsx`): small regions the app animates on its own, at frame rate, without redrawing the row.
- In the desktop app on 2.1.286, which leaves those regions blank, the mod draws self-animating SVGs instead (`hooks/motion.ts`), and the music bars are drawn into the deck's picture.
- Short sounds (`fx/*.wav`) play when a note's reminder is due, ten minutes before a meeting, when the timer starts or stops, and when a note is saved.

## Privacy: what it reads and where it keeps things

- **Reads:** your Gmail Primary tab and your calendar, through Claude's connectors; the task lists Claude keeps under `~/.claude/tasks`; the names of your project folders under `~/.claude/projects` (to label sessions); the project's `timelog` folder; and, for the music deck, what Windows reports as playing.
- **Keeps:** everything in `~/.claude/deskbar-data/` (settings, which sessions it is on in, the music helper's files) and your notes in Claude Code's plugin store. Nothing is kept inside the mod's own folder.
- **Sends:** nothing of its own. The only network traffic is Claude's connectors talking to Google.

## Troubleshooting

| You see | Do this |
|---|---|
| No row at all | Run `/desk on` in that session. The row draws in the main pane, or a session's own window, but not in split side panes. |
| A grey `deskbar:` line in the transcript | It names what failed. Open an issue with that line. |
| `?` on the mail or calendar icon | Open the dropdown for the connector's answer; reconnect the connector if it has expired. |
| Music deck says "starting" and stays there | The helper is not installed: see the music setup above. |
| A blank gap where something should move | Your desktop app is on 2.1.286; update the app, or ignore it, since the mod falls back on its own. |
| The row scrolls away when a dropdown is open | It should not: every dropdown sizes itself to the 12 rows the app allows. Open an issue with a screenshot. |

## Uninstall

Remove the path from `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, restart Claude Code, and delete the mod's folder and `~/.claude/deskbar-data/`.

## Development

```bash
claude plugin validate /path/to/deskbar
claude plugin test /path/to/deskbar
```

`hooks/register.tsx` is the entry point. `hooks/desk.tsx` holds the weather, mail, calendar, tasks, notes, music and settings; `hooks/timer.tsx` holds the timer. The tests in `hooks/*.test.ts` run both halves against a fake engine on the desktop and terminal surfaces.

## License

MIT
