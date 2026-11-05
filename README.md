# Day Planner Analyzer v1.1.1

Track how you really spend your time. This plugin reads your Day Planner-style daily notes and displays advanced, customizable statistics to help track your long term progress and give insights to your habits.

Works alongside the [Day Planner](https://github.com/ivan-lednev/obsidian-day-planner) plugin — it does not replace your timeline; it adds a stats view on top of the notes you already write.

- [Report bugs or request features](https://github.com/RogueL90/obsidian-day-planner-analyzer/issues)
- [Submit a pull request](https://github.com/RogueL90/obsidian-day-planner-analyzer)

> Your daily notes should be named like **`2026-02-23.md`** (year-month-day). The plugin finds these files anywhere in your vault.

## What it does

- Reads time-boxed tasks from your daily notes and keeps stats up to date as you edit (Fromatting on sync with [Obsidian Day Planner Plugin](https://github.com/ivan-lednev/obsidian-day-planner)
- Shows how many days you planned, how long your days run, and how much time was left unplanned
- Tracks how often you finish tasks - especially ones you mark as priority
- Lets you pick a week, a month, or any custom date range for analysis
- Includes an AI chat assistant that gives you personalized advice to lifemaxx based on your daily notes
- Charts how much time you spend on each task over time
- Lists each day and each task in simple tables you can sort

## How to use

### Open the stats window

Press `Ctrl/Cmd + P`, type **Advanced statistics**, and run the command.

<img width="758" height="124" alt="Screenshot 2026-05-23 at 1 28 16 PM" src="https://github.com/user-attachments/assets/ff09ccfc-6be2-411b-835a-4cb5795fc7d9" />

---

### Write your day (daily note format)

Plan your day as normal checklist lines with a start time, an end time, and a task name. Use the Day Planner plugin or write directly in a note named `2026-02-23.md`.

Example:

```markdown
# Day planner

- [ ] 9:00am - 9:30am Morning routine
- [x] 10:00am - 11:00am* Deep work // focus block
```

**General rules**

- One task per line, with times on the left: `9:00am - 10:00am Task name`
- Check the box `[x]` when you finish a task
- Add a `*` after the **end** time for a priority task: `11:00am* Important meeting`
- Add `//` after the name for a note that should not count as part of the task name

<img width="696" height="595" alt="Screenshot 2026-05-20 at 5 50 18 PM" src="https://github.com/user-attachments/assets/ac88f476-9ecc-49c9-b770-5f6035889898" />

Tap **Info** inside the stats window anytime for a quick reminder of these rules.


---

### The stats window

<img width="976" height="736" alt="Screenshot 2026-05-23 at 5 12 43 PM" src="https://github.com/user-attachments/assets/0ac066a0-3df3-49ea-894e-ae2a981972d2" />

#### Pick a time range

Use the tabs at the top: **Past 7 days**, **Past 30 days**, or **Custom**.

<img width="575" height="368" alt="Screenshot 2026-05-20 at 5 52 43 PM" src="https://github.com/user-attachments/assets/256a9731-c473-4d4b-b350-94c4451320f1" />

#### Productivity assistant

Ask things like what to focus on today, how to reduce gaps in your schedule, or how to finish more priority tasks. The assistant only uses the summary for the range you have open — not your full note text.

You can expand the chat or clear the conversation. In plugin settings, connect the assistant with your own OpenAI-compatible API key or a model you have downloaded in [Ollama](https://ollama.com). Chat history is saved until you clear it.

<img width="1476" height="933" alt="Screenshot 2026-05-20 at 6 25 08 PM" src="https://github.com/user-attachments/assets/b21b2dec-2b56-4a01-a8ea-a28dc99f7f8d" />

#### Tasks graph

Choose a task from the dropdown to see how many hours you spent on it each day in your selected range.

<img width="449" height="317" alt="Screenshot 2026-05-20 at 6 31 06 PM" src="https://github.com/user-attachments/assets/71539d12-0c3e-41e5-99ff-362d3715f11f" />

#### Daily breakdown

A day-by-day table: when your day started and ended, priority tasks done, and how many tasks you planned vs completed.

<img width="926" height="347" alt="Screenshot 2026-05-20 at 6 31 58 PM" src="https://github.com/user-attachments/assets/b64e8f36-191d-44ef-bcb5-926d5d940c14" />

#### Tasks breakdown

See which tasks took the most time overall and when you last did each one.

<img width="924" height="349" alt="Screenshot 2026-05-20 at 6 32 24 PM" src="https://github.com/user-attachments/assets/993da9c4-3666-4382-8a85-b54ba4082532" />

---

## Good to know

- Only notes named `YYYY-MM-DD.md` are included
- Lines that don’t follow the time-range format are skipped
- This plugin analyzes and displays stats only — it does not edit your schedule
- The assistant only sees summary numbers, not your full notes. An API-key provider needs internet access. Ollama runs on your machine and does not call a remote model host
- If two tasks overlap in time, unplanned time is calculated as if they were one block

I don't take donations, this plugin being useful to someone is enough :)
