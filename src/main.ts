import {
  App,
  Component,
  Debouncer,
  MarkdownRenderChild,
  MarkdownRenderer,
  Modal,
  Plugin,
  TAbstractFile,
  TFile,
  debounce,
  requestUrl,
} from "obsidian";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from "chart.js";
import { TimeBlock } from "./parseFile";
import parseFile from './parseFile'
import {
  assertAssistantConfigured,
  assistantChatCompletionsUrl,
  assistantModel,
  assistantRequestHeaders,
  DSASettingTab,
  DSASettings,
  normalizeAssistantSettings,
} from "./settings";
import convTime from './convTime'
import timeFormat from'./timeFormat'

type DayData = {
	schedule: TimeBlock[],
    date: string,
    earliest: number,
    latest: number,
    idle: number
}; 

type TabId = "7d" | "30d" | "custom";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
);

const setCssProps = (el: HTMLElement, props: Record<string, string>) => {
  for (const [key, value] of Object.entries(props)) {
    el.style.setProperty(key, value);
  }
};

/** Screen-corner brackets: outward = expand, inward = minimize (stroke icon). */
function createExpandToggleSvg(expanded: boolean): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute(
    "d",
    expanded
      ? "M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"
      : "M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4",
  );
  svg.appendChild(path);
  return svg;
}

const ASSISTANT_SYSTEM_PROMPT = `You are a concise, supportive productivity coach for someone using a Day Planner style schedule in Obsidian.
You MUST base your reasoning only on the activity summary in this message. It matches the on-screen summary cards and tasks rollup (no per-day schedule or raw notes). If something is not in that summary, say you cannot infer it.
Focus on: realistic prioritization, timeboxing, reducing idle/unplanned gaps, protecting deep work, and improving completion on priority tasks.
Give short, actionable bullet points when possible. Avoid medical or clinical claims.`;

const MAX_HISTORY_MESSAGE_CHARS = 6000;
/** Safety cap on full system message (prompt + activity) passed to the API. */
const MAX_SYSTEM_TOTAL_CHARS = 48000;

class StatsModal extends Modal {
  private activeTab: TabId = "7d";
  private bodyEl: HTMLElement | null = null;
  /** Wrapper below tabs; receives summary, tables, custom controls, or empty state. */
  private tabContentMount: HTMLElement | null = null;
  private showInfo = false;
  private currDayData: DayData[] = [];
  private taskChart: Chart | null = null;
  /** When true, stats UI is hidden and the assistant uses most of the modal */
  private chatExpanded = false;
  private modalRoot: HTMLElement | null = null;
  /** Owns MarkdownRenderer children for assistant bubbles (modal-scoped, no plugin-as-component). */
  private chatMdScope: Component | null = null;

  constructor(
    app: App,
    private plugin: HelloWorldPlugin
  ) {
    super(app);
  }

getDisplayDataPast(days: number){
  const data = this.plugin.dayData;
  if (days === -1){
    this.currDayData = data;
    return;
  }
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - days);
  const target = d.toLocaleDateString("en-CA");
  let lo = 0;
  let hi = data.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (data[mid]!.date < target) lo = mid + 1;
    else hi = mid;
  }
  console.error("start: ", d.toString())
  this.currDayData = data.slice(lo);
}

getDisplayDataBetw(dayStart: string, dayEnd: string){
  const data = this.plugin.dayData;
  if (dayStart > dayEnd) return;
  let lo = 0, hi = data.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (data[mid]!.date < dayStart) lo = mid + 1;
    else hi = mid;
  }
  const left = lo;
  lo = 0; hi = data.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (data[mid]!.date <= dayEnd) lo = mid + 1;
    else hi = mid;
  }
  const right = lo;

  this.currDayData = data.slice(left, right);
}

  onOpen() {
    this.contentEl.parentElement?.addClass("odpa-stats-modal");
    this.modalRoot = this.contentEl.closest(".modal");
    this.chatMdScope = new Component();
    this.plugin.addChild(this.chatMdScope);
    this.bodyEl = this.contentEl.createDiv({ cls: "odpa-stats-body" });
    this.getDisplayDataPast(30)
    this.renderResults();
  }

  onClose() {
    this.modalRoot?.removeClass("odpa-chat-expanded");
    this.modalRoot = null;
    this.chatExpanded = false;
    if (this.chatMdScope) {
      this.plugin.removeChild(this.chatMdScope);
      this.chatMdScope = null;
    }
    this.contentEl.parentElement?.removeClass("odpa-stats-modal");
    this.contentEl.empty();
    this.bodyEl = null;
  }

  private getTabContentParent(): HTMLElement {
    return this.tabContentMount ?? this.bodyEl!;
  }

  /** Panel under tabs; plays one-shot enter animation. */
  private beginTabContentPanel() {
    this.tabContentMount = this.bodyEl!.createDiv({
      cls: "odpa-tab-panel odpa-tab-panel--enter",
    });
    const panel = this.tabContentMount;
    window.setTimeout(() => panel.removeClass("odpa-tab-panel--enter"), 280);
  }

  private applyChatExpandedLayout() {
    if (!this.modalRoot) {
      this.modalRoot = this.contentEl.closest(".modal");
    }
    if (!this.bodyEl) return;
    if (this.chatExpanded) {
      this.bodyEl.addClass("odpa-chat-expanded");
      this.modalRoot?.addClass("odpa-chat-expanded");
    } else {
      this.bodyEl.removeClass("odpa-chat-expanded");
      this.modalRoot?.removeClass("odpa-chat-expanded");
    }
  }

  private renderResults() {
    console.error(this.currDayData)
    if (!this.bodyEl) return;
    if (this.taskChart) {
      this.taskChart.destroy();
      this.taskChart = null;
    }
    this.bodyEl.empty();

    this.renderHeader();
    if (this.showInfo) {
      this.renderInfoDropdown();
    }
    this.renderTabs();
    this.beginTabContentPanel();
    if (this.currDayData.length === 0) {
      this.chatExpanded = false;
      this.renderNoDataState();
      this.applyChatExpandedLayout();
      return;
    }
    this.renderSummaryCards();
    this.renderMainContent();
    this.renderDailyTable();
    this.renderTasksTable();
    this.applyChatExpandedLayout();
  }

  private renderCustom() {
    if (!this.bodyEl) return;
    this.chatExpanded = false;
    this.bodyEl.empty();
    this.renderHeader();
    if (this.showInfo) {
      this.renderInfoDropdown();
    }
    this.renderTabs();
    this.beginTabContentPanel();

    const customWrap = this.tabContentMount!.createDiv({ cls: "odpa-custom-controls" });

    const title = customWrap.createDiv({ cls: "odpa-custom-title" });
    title.createEl("h3", { text: "Custom stats" });
    title.createEl("p", {
      cls: "odpa-custom-subtitle",
      text: "Choose how you want to define the time range, then press calculate.",
    });

    const optionsWrap = customWrap.createDiv({
      cls: "odpa-custom-options",
      attr: { style: "margin-top: 0.75rem; margin-bottom: 0.25rem;" },
    });
    const errorEl = customWrap.createDiv({
      cls: "odpa-custom-error",
      attr: { style: "margin-top: 0.5rem; min-height: 1.2em;" },
    });

    type Mode = "past" | "range" | "lifetime";
    let mode: Mode = "past";

    const makeRadioRow = (labelText: string, value: Mode) => {
      const row = optionsWrap.createDiv({
        cls: "odpa-custom-row",
        attr: { style: "display: flex; flex-direction: column; align-items: flex-start; margin-bottom: 0.75rem;" },
      });
      const left = row.createDiv({
        cls: "odpa-custom-row-left",
        attr: { style: "display: flex; align-items: center; gap: 0.35rem;" },
      });
      const right = row.createDiv({
        cls: "odpa-custom-row-right",
        attr: { style: "margin-top: 0.25rem;" },
      });

      const radio = left.createEl("input", {
        attr: {
          type: "radio",
          name: "odpa-custom-mode",
        },
      });
      if (value === mode) radio.checked = true;

      const label = left.createEl("label", { text: labelText });

      const selectThis = () => {
        mode = value;
        const radios = optionsWrap.querySelectorAll<HTMLInputElement>('input[type="radio"][name="odpa-custom-mode"]');
        radios.forEach((r) => {
          r.checked = r === radio;
        });
        errorEl.empty();
      };

      radio.addEventListener("change", () => {
        if (radio.checked) selectThis();
      });
      label.addEventListener("click", () => {
        radio.checked = true;
        selectThis();
      });

      return { row, right };
    };

    // Option A: past N days
    const { right: pastRight } = makeRadioRow("Past N days", "past");
    pastRight.createSpan({ text: "Past " });
    const pastInput = pastRight.createEl("input", {
      attr: {
        type: "number",
        min: "1",
        placeholder: "7",
        style: "width: 4rem; margin-right: 0.25rem;",
      },
    });
    pastRight.createSpan({ text: " days" });

    // Option B: between dates
    const { right: rangeRight } = makeRadioRow("Between dates", "range");
    rangeRight.createSpan({ text: "From " });
    const startInput = rangeRight.createEl("input", {
      attr: {
        type: "date",
        style: "margin: 0 0.25rem;",
      },
    });
    rangeRight.createSpan({ text: " to " });
    const endInput = rangeRight.createEl("input", {
      attr: {
        type: "date",
        style: "margin: 0 0.25rem;",
      },
    });

    // Option C: lifetime
    makeRadioRow("All time (lifetime stats)", "lifetime");

    const actions = customWrap.createDiv({
      cls: "odpa-custom-actions",
      attr: { style: "margin-top: 0.25rem;" },
    });
    const calculateBtn = actions.createEl("button", {
      cls: "odpa-button odpa-button-primary",
      text: "Calculate stats  ❯",
      attr: {
        style:
          "margin-top: 0.5rem; padding: 0.45rem 0.9rem; font-size: 0.95rem; background-color: var(--color-green); color: var(--background-primary); transition: background-color 0.12s ease, transform 0.05s ease;",
      },
    });

    // Basic press feedback
    calculateBtn.addEventListener("mousedown", () => {
      setCssProps(calculateBtn, { transform: "scale(0.98)" });
    });
    const resetButtonVisual = () => {
      setCssProps(calculateBtn, { transform: "" });
    };
    calculateBtn.addEventListener("mouseup", resetButtonVisual);
    calculateBtn.addEventListener("mouseleave", resetButtonVisual);

    calculateBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      errorEl.empty();

      // Green button color change on mouse click
      const originalBg = calculateBtn.style.getPropertyValue("background-color");
      setCssProps(calculateBtn, { "background-color": "var(--color-green-dark, #2a8a3a)" });
      window.setTimeout(() => {
        setCssProps(calculateBtn, { "background-color": originalBg });
      }, 120);

      if (mode === "lifetime") {
        this.getDisplayDataPast(-1);
        this.renderResults();
        return;
      }

      if (mode === "past") {
        const numVal = pastInput.value.trim();
        const days = Number(numVal);
        if (!numVal || Number.isNaN(days) || days <= 0) {
          errorEl.createSpan({ text: "Please enter a positive number of days." });
          return;
        }
        this.getDisplayDataPast(days);
        this.renderResults();
        return;
      }

      if (mode === "range") {
        const startVal = startInput.value;
        const endVal = endInput.value;
        if (!startVal || !endVal) {
          errorEl.createSpan({ text: "Please select both a start and end date." });
          return;
        }
        if (startVal > endVal) {
          errorEl.createSpan({ text: "Start date must be on or before end date." });
          return;
        }
        this.getDisplayDataBetw(startVal, endVal);
        this.renderResults();
      }
    });

    this.applyChatExpandedLayout();
  }

  private renderHeader() {
    const header = this.bodyEl!.createDiv({ cls: "odpa-stats-header" });
    const left = header.createDiv({ cls: "odpa-stats-header-left" });
    // eslint-disable-next-line -- product title per design
    left.createEl("h2", { text: "Day Planner Analyzer" });
    left.createEl("p", { cls: "odpa-stats-subtitle", text: "Advanced statistics" });

    const right = header.createDiv({ cls: "odpa-stats-header-right" });

    const infoButton = right.createEl("button", {
      cls: "odpa-info-button",
    });
    infoButton.createSpan({
      cls: "odpa-info-label",
      text: "Info",
    });
    infoButton.createSpan({
      cls: "odpa-info-arrow",
      text: "▸",
    });

    if (this.showInfo) {
      infoButton.addClass("is-active");
    }

    infoButton.addEventListener("click", () => {
      this.showInfo = !this.showInfo;
      this.renderResults();
    });

    const updatedAt = this.plugin.dayDataUpdatedAt;
    const updatedLabel =
      updatedAt > 0
        ? `Last updated: ${new Date(updatedAt).toLocaleString(undefined, {
            dateStyle: "short",
            timeStyle: "short",
          })}`
        : "Last updated: —";
    right.createEl("span", { cls: "odpa-stats-updated", text: updatedLabel });
  }

  private renderInfoDropdown() {
    const info = this.bodyEl!.createDiv({ cls: "odpa-info-dropdown" });
    info.createEl("h3", { text: "Analyzer guidelines" });
    info.createEl("p", {
      cls: "odpa-info-text",
      text: "Adhere to these simple conventions so the tool can recognize your files!",
    });

    const list = info.createEl("ul");
    [
      "Best compatable with Day Planner plugin",
      "Daily notes use YYYY-MM-DD.md naming convention for each file",
      "To mark tasks as priority for the day, put a star after the end time. Ex) 4:00pm - 4:30pm* Meditate",
      "To comment specifications of a task without it affecting the task analysis, comment with '//' AFTER the task name. Ex) 4:00pm - 4:30pm Meditate // with waterfall sounds",
    ].forEach((text) => {
      list.createEl("li", { text });
    });
  }

  private renderNoDataState() {
    const emptyWrap = this.getTabContentParent().createDiv({
      cls: "odpa-empty-state",
    });

    emptyWrap.createEl("h3", { text: "No files found for this time range." });
    emptyWrap.createEl("p", {
      cls: "odpa-empty-state-desc",
      text:
        "There are no daily note files in the selected days/date range to analyze. Try a wider range or choose all time.",
    });
  }

  private renderTabs() {
    const tabsWrap = this.bodyEl!.createDiv({ cls: "odpa-stats-tabs" });
    tabsWrap.setAttribute("role", "tablist");
    tabsWrap.setAttribute("aria-label", "Time range");
    const tabs: { id: TabId; label: string }[] = [
      { id: "7d", label: "Past 7 days" },
      { id: "30d", label: "Past 30 days" },
      { id: "custom", label: "Custom" },
    ];
    tabs.forEach(({ id, label }) => {
      const tab = tabsWrap.createEl("button", {
        cls: "odpa-tab",
        text: label,
        attr: { type: "button", role: "tab" },
      });
      tab.setAttribute("aria-selected", this.activeTab === id ? "true" : "false");
      if (this.activeTab === id) tab.addClass("is-active");
      tab.addEventListener("click", () => {
        this.activeTab = id;
        if (id == "7d") {
          this.getDisplayDataPast(30);
          this.renderResults();
        } else if (id == "30d") {
          this.getDisplayDataPast(45);
          this.renderResults();
        } else {
          this.renderCustom();
        }
      });
    });
  }

  private renderSummaryCards() {
    let start = 0
    let end = 0
    let idleTime = 0
    const len = this.currDayData.length
    let priorityTasks = 0
    let completedPriorityTasks = 0
    let totalTasks = 0
    let completedTasks = 0
    for(const curr of this.currDayData){
      for(const currTask of curr.schedule){
        if(currTask.priority){
          if(currTask.completed){
            completedPriorityTasks++
            completedTasks++
          }
          priorityTasks++
        } else if(currTask.completed){
          completedTasks++
        }
      }
      totalTasks += curr.schedule.length
      if(!Number.isNaN(curr.earliest))
      start += curr.earliest
      if(!Number.isNaN(curr.latest))
      end += curr.latest
      if(!Number.isNaN(curr.idle)){
        idleTime += curr.idle
      }
    }
    start /= len;
    end /= len;
    const priorityRate = priorityTasks === 0 ? "N/A" : completedPriorityTasks/priorityTasks*100
    const taskRate = completedTasks/totalTasks*100
    console.error(idleTime)
    const row = this.getTabContentParent().createDiv({ cls: "odpa-stats-cards" });
    const cards: { label: string; value: string }[] = [
      { label: "Days analyzed", value: ""+this.currDayData.length },
      { label: "Avg day length", value: ""+convTime(Math.round(start)) +" - " + convTime(Math.round(end))},
      { label: "Avg Unplanned/idle time", value: ""+timeFormat(Math.round(idleTime/len)) },
      { label: "Priority task completion rate", value: priorityRate==="N/A" ? priorityRate : priorityRate.toFixed(1)+"%" },
      { label: "Task completion rate", value: taskRate.toFixed(1)+"%" },
    ];
    cards.forEach((c) => this.renderCard(row, c.label, c.value));
  }

  private renderCard(parent: HTMLElement, label: string, value: string) {
    const card = parent.createDiv({ cls: "odpa-card" });
    card.createEl("div", { cls: "odpa-card-label", text: label });
    card.createEl("div", { cls: "odpa-card-value", text: value });
  }

  /** Aggregate metrics only—same idea as the summary cards plus top tasks by time (tasks breakdown). No per-day rows. */
  private buildActivityContext(): string {
    const days = this.currDayData;
    if (days.length === 0) {
      return "No daily planner data in the currently selected time range (no matching daily notes or empty schedules).";
    }

    const sortedDates = [...days].map((d) => d.date).sort();
    const rangeStart = sortedDates[0]!;
    const rangeEnd = sortedDates[sortedDates.length - 1]!;
    const n = days.length;

    let startSum = 0;
    let endSum = 0;
    let idleSum = 0;
    let priorityTasks = 0;
    let completedPriorityTasks = 0;
    let totalTasks = 0;
    let completedTasks = 0;

    for (const curr of days) {
      for (const currTask of curr.schedule) {
        totalTasks++;
        if (currTask.completed) completedTasks++;
        if (currTask.priority) {
          priorityTasks++;
          if (currTask.completed) completedPriorityTasks++;
        }
      }
      if (!Number.isNaN(curr.earliest)) startSum += curr.earliest;
      if (!Number.isNaN(curr.latest)) endSum += curr.latest;
      if (!Number.isNaN(curr.idle)) idleSum += curr.idle;
    }

    const avgStart = convTime(Math.round(startSum / n));
    const avgEnd = convTime(Math.round(endSum / n));
    const avgIdle = timeFormat(Math.round(idleSum / n));
    const priorityRate =
      priorityTasks === 0
        ? "N/A"
        : `${((completedPriorityTasks / priorityTasks) * 100).toFixed(1)}% (${completedPriorityTasks}/${priorityTasks})`;
    const taskRate =
      totalTasks === 0
        ? "N/A"
        : `${((completedTasks / totalTasks) * 100).toFixed(1)}% (${completedTasks}/${totalTasks})`;

    const normalizeTaskName = (name: string) =>
      name.trim().toLowerCase().replace(/\s+/g, " ");
    const taskMinutes = new Map<string, { display: string; minutes: number }>();
    for (const day of days) {
      for (const block of day.schedule) {
        const norm = normalizeTaskName(block.name);
        if (!norm) continue;
        const mins = block.endTime - block.startTime;
        if (!Number.isFinite(mins) || mins < 0) continue;
        const display = block.name.trim();
        const prev = taskMinutes.get(norm);
        if (!prev) taskMinutes.set(norm, { display, minutes: mins });
        else prev.minutes += mins;
      }
    }

    const topTasks = Array.from(taskMinutes.values())
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 15)
      .map((t) => `- ${t.display}: ${timeFormat(t.minutes)} total`);

    return [
      "Summary (stat cards):",
      `Days analyzed: ${n}`,
      `Date range: ${rangeStart} to ${rangeEnd}`,
      `Average day length: ${avgStart} – ${avgEnd}`,
      `Average unplanned/idle per day: ${avgIdle}`,
      `Priority task completion: ${priorityRate}`,
      `Overall task completion: ${taskRate}`,
      "",
      "Tasks breakdown (top by total time spent, as in the tasks table):",
      topTasks.length ? topTasks.join("\n") : "(none)",
    ].join("\n");
  }

  private clipMessageForApi(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max - 40)}\n… [message truncated for API size]`;
  }

  private async callLLM(): Promise<string> {
    assertAssistantConfigured(this.plugin.settings);

    const activityContext = this.buildActivityContext();
    let systemContent = `${ASSISTANT_SYSTEM_PROMPT}\n\n--- Activity data for this stats view ---\n${activityContext}`;
    if (systemContent.length > MAX_SYSTEM_TOTAL_CHARS) {
      systemContent = `${systemContent.slice(0, MAX_SYSTEM_TOTAL_CHARS - 120)}\n\n… [system prompt truncated for API size]`;
    }

    const trimmed = this.plugin.settings.chatHistory.slice(-20);
    const messages: { role: string; content: string }[] = [
      { role: "system", content: systemContent },
      ...trimmed.map((m) => ({
        role: m.role,
        content: this.clipMessageForApi(m.content, MAX_HISTORY_MESSAGE_CHARS),
      })),
    ];

    const res = await requestUrl({
      url: assistantChatCompletionsUrl(this.plugin.settings),
      method: "POST",
      headers: assistantRequestHeaders(this.plugin.settings),
      throw: false,
      body: JSON.stringify({
        model: assistantModel(this.plugin.settings),
        messages,
        temperature: 0.7,
        stream: false,
      }),
    });

    const secret =
      this.plugin.settings.assistantProvider === "api" ? this.plugin.settings.apiKey.trim() : "";
    const scrub = (text: string) => (secret ? text.split(secret).join("[redacted]") : text);

    if (res.status < 200 || res.status >= 300) {
      const fromJson = res.json as { error?: { message?: string } } | null;
      let detail =
        fromJson?.error?.message ??
        (typeof res.text === "string" && res.text.length > 0
          ? res.text.slice(0, 800)
          : "");
      if (!detail) detail = `HTTP ${res.status}`;
      throw new Error(`Assistant request failed (${res.status}): ${scrub(detail)}`);
    }

    const data = res.json as {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string };
    };
    if (data.error?.message) {
      throw new Error(scrub(data.error.message));
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("Empty response from assistant.");
    }
    return content;
  }

  private renderAssistantPanel(container: HTMLElement) {
    container.addClass("odpa-chat-shell");

    const header = container.createDiv({ cls: "odpa-chat-header" });
    header.createEl("h3", { text: "Assistant" });

    const headerActions = header.createDiv({ cls: "odpa-chat-header-actions" });

    const expandBtn = headerActions.createEl("button", {
      cls: "odpa-chat-expand",
      attr: { type: "button" },
    });
    const expandIconWrap = expandBtn.createSpan({ cls: "odpa-chat-expand-icon-wrap" });
    const syncExpandIcon = () => {
      expandIconWrap.empty();
      expandIconWrap.appendChild(createExpandToggleSvg(this.chatExpanded));
      expandBtn.setAttribute(
        "aria-label",
        this.chatExpanded ? "Minimize chat" : "Expand chat",
      );
    };
    syncExpandIcon();
    expandBtn.addEventListener("click", () => {
      this.chatExpanded = !this.chatExpanded;
      syncExpandIcon();
      this.applyChatExpandedLayout();
      requestAnimationFrame(() => {
        logEl.scrollTop = logEl.scrollHeight;
        textarea.focus();
      });
    });

    const clearBtn = headerActions.createEl("button", {
      cls: "odpa-chat-clear mod-small",
      text: "Clear",
      attr: { type: "button" },
    });

    const logEl = container.createDiv({ cls: "odpa-chat-log" });

    const statusEl = container.createDiv({ cls: "odpa-chat-status" });

    const composer = container.createDiv({ cls: "odpa-chat-composer" });
    const composerRow = composer.createDiv({ cls: "odpa-chat-composer-row" });
    const textarea = composerRow.createEl("textarea", {
      cls: "odpa-chat-input",
      attr: {
        rows: "2",
        placeholder: "Message…",
      },
    });
    const sendBtn = composerRow.createEl("button", {
      cls: "odpa-chat-send",
      attr: { type: "button", "aria-label": "Send message" },
    });
    const sendInner = sendBtn.createSpan({ cls: "odpa-chat-send-inner" });
    const iconWrap = sendInner.createSpan({ cls: "odpa-chat-send-icon" });
    const sendSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    sendSvg.setAttribute("viewBox", "0 0 24 24");
    sendSvg.setAttribute("width", "18");
    sendSvg.setAttribute("height", "18");
    sendSvg.setAttribute("aria-hidden", "true");
    const sendPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    sendPath.setAttribute("fill", "currentColor");
    sendPath.setAttribute("d", "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z");
    sendSvg.appendChild(sendPath);
    iconWrap.appendChild(sendSvg);
    sendInner.createSpan({ cls: "odpa-chat-send-label", text: "Send" });

    const renderMessages = async (animateTail = 0) => {
      logEl.empty();
      const hist = this.plugin.settings.chatHistory;
      const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";

      if (hist.length === 0) {
        const hint = logEl.createDiv({ cls: "odpa-chat-empty" });
        hint.createDiv({
          cls: "odpa-chat-empty-title",
          text: "Productivity assistant",
        });
        hint.createDiv({
          cls: "odpa-chat-empty-desc",
          text: "Ask about your schedule in this stats view. Messages are saved across sessions. Set an API key or an Ollama model in plugin settings. Expand for a full-screen chat.",
        });
      } else {
        const n = hist.length;
        for (let i = 0; i < hist.length; i++) {
          const m = hist[i]!;
          const row = logEl.createDiv({
            cls: `odpa-chat-row odpa-chat-row-${m.role}`,
          });
          if (animateTail > 0 && i >= n - animateTail) {
            row.addClass("odpa-chat-row--enter");
            const clearEnter = () => row.removeClass("odpa-chat-row--enter");
            row.addEventListener("animationend", clearEnter, { once: true });
            window.setTimeout(clearEnter, 380);
          }
          const bubble = row.createDiv({
            cls: `odpa-chat-bubble odpa-chat-bubble-${m.role}`,
          });
          const bodyEl = bubble.createDiv({
            cls: "odpa-chat-bubble-body",
          });

          if (m.role === "assistant" && this.chatMdScope) {
            bodyEl.addClass("odpa-chat-md");
            const mdChild = new MarkdownRenderChild(bodyEl);
            this.chatMdScope.addChild(mdChild);
            await MarkdownRenderer.render(
              this.app,
              m.content,
              bodyEl,
              sourcePath,
              mdChild,
            );
          } else {
            bodyEl.setText(m.content);
          }

          row.createDiv({
            cls: "odpa-chat-meta",
            text: new Date(m.ts).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            }),
          });
        }
      }
      requestAnimationFrame(() => {
        logEl.scrollTop = logEl.scrollHeight;
      });
    };

    void renderMessages();

    clearBtn.addEventListener("click", () => {
      void (async () => {
        this.plugin.settings.chatHistory = [];
        await this.plugin.saveSettings();
        statusEl.setText("");
        await renderMessages();
      })();
    });

    const setBusy = (busy: boolean) => {
      textarea.disabled = busy;
      sendBtn.disabled = busy;
    };

    const send = async () => {
      const text = textarea.value.trim();
      if (!text) return;

      textarea.value = "";
      sendBtn.addClass("odpa-chat-send--success");
      window.setTimeout(() => sendBtn.removeClass("odpa-chat-send--success"), 220);

      this.plugin.settings.chatHistory.push({
        role: "user",
        content: text,
        ts: Date.now(),
      });
      await this.plugin.saveSettings();
      await renderMessages(1);

      statusEl.setText("Thinking…");
      setBusy(true);
      try {
        const reply = await this.callLLM();
        this.plugin.settings.chatHistory.push({
          role: "assistant",
          content: reply,
          ts: Date.now(),
        });
        await this.plugin.saveSettings();
        await renderMessages(1);
        statusEl.setText("");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        statusEl.setText(`Error: ${msg}`);
      } finally {
        setBusy(false);
      }
    };

    sendBtn.addEventListener("click", () => {
      void send();
    });

    textarea.addEventListener("keydown", (evt: KeyboardEvent) => {
      if (evt.key === "Enter" && !evt.shiftKey) {
        evt.preventDefault();
        void send();
      }
    });
  }

  private renderMainContent() {
    const main = this.getTabContentParent().createDiv({ cls: "odpa-stats-main" });

    const left = main.createDiv({
      cls: "odpa-panel odpa-panel-assistant",
      attr: {
        style: "flex: 1 1 0; min-width: 0;",
      },
    });
    this.renderAssistantPanel(left);

    const right = main.createDiv({
      cls: "odpa-panel odpa-panel-chart",
      attr: {
        style: "flex: 1 1 0; min-width: 0;",
      },
    });

    const chartHeader = right.createDiv({ cls: "odpa-chart-header" });
    // eslint-disable-next-line -- product title per design
    chartHeader.createEl("h3", { text: "Tasks Graph" });

    const selectWrap = chartHeader.createDiv({ cls: "odpa-chart-select-wrap" });
    selectWrap.createEl("span", {
      text: "Task:",
      cls: "odpa-chart-select-label",
    });

    const selectShell = selectWrap.createDiv({ cls: "odpa-chart-select-shell" });
    const selectEl = selectShell.createEl("select", {
      cls: "odpa-chart-select",
    });
    setCssProps(selectEl, {
      "max-width": "100%",
      "min-width": "10rem",
      "white-space": "nowrap",
      overflow: "hidden",
      "text-overflow": "ellipsis",
    });

    const caret = selectShell.createSpan({
      cls: "odpa-chart-select-caret",
      attr: { "aria-hidden": "true" },
    });
    const caretSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    caretSvg.setAttribute("viewBox", "0 0 24 24");
    caretSvg.setAttribute("width", "14");
    caretSvg.setAttribute("height", "14");
    const caretPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    caretPath.setAttribute("fill", "none");
    caretPath.setAttribute("stroke", "currentColor");
    caretPath.setAttribute("stroke-width", "2");
    caretPath.setAttribute("stroke-linecap", "round");
    caretPath.setAttribute("stroke-linejoin", "round");
    caretPath.setAttribute("d", "M6 9l6 6 6-6");
    caretSvg.appendChild(caretPath);
    caret.appendChild(caretSvg);

    const chartArea = right.createDiv({ cls: "odpa-chart-area" });

    const chartBox = chartArea.createDiv({ cls: "odpa-chart-placeholder" });

    const canvasWrap = chartBox.createDiv({ cls: "odpa-chart-canvas-wrap" });

    const canvas = canvasWrap.createEl("canvas", {
      cls: "odpa-chart-canvas",
    });
    setCssProps(canvas, {
      width: "100%",
      height: "100%",
      display: "block",
    });

    const legendEl = chartBox.createDiv({ cls: "odpa-chart-legend" });
    legendEl.setText(
      "Line shows total minutes spent on the selected task each day.",
    );

    const chartEmptyState = () => {
      if (this.taskChart) {
        this.taskChart.destroy();
        this.taskChart = null;
      }
    };

    // Helper to normalize task names (ignore casing and extra spacing)
    const normalizeTaskName = (name: string) =>
      name.trim().toLowerCase().replace(/\s+/g, " ");

    // Collect unique task names from current data (normalized)
    const taskNameMap = new Map<string, string>(); // normalized -> display name
    for (const day of this.currDayData) {
      for (const block of day.schedule) {
        const trimmed = block.name.trim();
        const norm = normalizeTaskName(trimmed);
        if (norm && !taskNameMap.has(norm)) {
          taskNameMap.set(norm, trimmed);
        }
      }
    }

    const namesArray = Array.from(taskNameMap.values()).sort((a, b) =>
      a.localeCompare(b)
    );

    // Pick default task: highest total minutes across the analyzed range
    const totalByTask = new Map<string, number>(); // normalized -> total minutes
    for (const day of this.currDayData) {
      for (const block of day.schedule) {
        const norm = normalizeTaskName(block.name);
        if (!norm) continue;
        const prev = totalByTask.get(norm) ?? 0;
        totalByTask.set(norm, prev + (block.endTime - block.startTime));
      }
    }
    let defaultTaskNorm = "";
    let defaultTaskMinutes = -1;
    for (const [norm, minutes] of totalByTask) {
      if (minutes > defaultTaskMinutes) {
        defaultTaskMinutes = minutes;
        defaultTaskNorm = norm;
      }
    }
    const defaultTaskDisplay = defaultTaskNorm ? (taskNameMap.get(defaultTaskNorm) ?? "") : "";

    // Populate dropdown
    const placeholderOption = selectEl.createEl("option", {
      text: "Select task",
      attr: { value: "" },
    });
    placeholderOption.selected = !defaultTaskDisplay;

    namesArray.forEach((name) => {
      selectEl.createEl("option", {
        text: name,
        attr: { value: name },
      });
    });

    const renderTaskChart = (taskName: string) => {
      if (!taskName) {
        chartEmptyState();
        return;
      }

      // Build per-day totals for this task
      const dayDurations: { date: string; minutes: number }[] = [];
      for (const day of this.currDayData) {
        let total = 0;
        for (const block of day.schedule) {
          if (normalizeTaskName(block.name) === normalizeTaskName(taskName)) {
            total += block.endTime - block.startTime;
          }
        }
        dayDurations.push({ date: day.date, minutes: total });
      }

      const labels = dayDurations.map((d) => {
        const dateObj = new Date(d.date);
        return Number.isNaN(dateObj.getTime())
          ? d.date
          : dateObj.toLocaleDateString(undefined, {
              year: "2-digit",
              month: "2-digit",
              day: "2-digit",
            });
      });

      const data = dayDurations.map((d) => d.minutes / 60); // hours

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (this.taskChart) {
        this.taskChart.data.labels = labels;
        if (this.taskChart.data.datasets[0]) {
          this.taskChart.data.datasets[0].data = data;
          this.taskChart.data.datasets[0].label = taskName;
        }
        this.taskChart.update();
        return;
      }

      this.taskChart = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: taskName,
              data,
              borderColor: "#a78bfa",
              backgroundColor: "rgba(167, 139, 250, 0.20)",
              tension: 0.3,
              pointRadius: 3,
              pointBackgroundColor: "#a78bfa",
              pointHoverRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              callbacks: {
                label(context) {
                  const val = context.parsed.y as number;
                  return `${val.toFixed(2)} hours`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: {
                maxTicksLimit: 5,
              },
            },
            y: {
              beginAtZero: true,
              ticks: {
                callback(value) {
                  return `${value}h`;
                },
              },
            },
          },
        },
      });
    };

    if (defaultTaskDisplay) {
      selectEl.value = defaultTaskDisplay;
      renderTaskChart(defaultTaskDisplay);
    } else {
      chartEmptyState();
    }

    selectEl.addEventListener("change", () => {
      const value = selectEl.value;
      renderTaskChart(value);
    });
  }

  private renderDailyTable() {
    const section = this.getTabContentParent().createDiv({ cls: "odpa-table-section" });
    section.createEl("h3", { text: "Daily breakdown" });
    const tableWrap = section.createDiv({ cls: "odpa-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "odpa-table" });
    const thead = table.createEl("thead").createEl("tr");
    const tbody = table.createEl("tbody");

    const maxVisibleDays = 5;
    let showAll = false;

    type SortKey = "date" | "startEnd" | "priorityTasks" | "planned" | "completed";
    let sortKey: SortKey = "date";
    let sortDir: "asc" | "desc" = "asc";

    const getDayMetrics = (day: DayData) => {
      const planned = day.schedule.length;
      const completed = day.schedule.filter((t) => t.completed).length;

      const priorityBlocks = day.schedule.filter((t) => t.priority);
      const priorityTotal = priorityBlocks.length;
      const priorityCompleted = priorityBlocks.filter((t) => t.completed).length;
      const priorityRatio = priorityTotal ? priorityCompleted / priorityTotal : 0;

      const start = day.earliest;
      const end = day.latest;

      return {
        planned,
        completed,
        priorityTotal,
        priorityCompleted,
        priorityRatio,
        start,
        end,
      };
    };

    const getSortedDays = () => {
      const dir = sortDir === "asc" ? 1 : -1;
      const sorted = [...this.currDayData].sort((a, b) => {
        if (sortKey === "date") {
          return dir * a.date.localeCompare(b.date);
        }

        const am = getDayMetrics(a);
        const bm = getDayMetrics(b);

        let av = 0;
        let bv = 0;
        if (sortKey === "startEnd") {
          // Prefer earliest; fall back to latest.
          av = Number.isNaN(am.start) ? -Infinity : am.start;
          bv = Number.isNaN(bm.start) ? -Infinity : bm.start;
          if (av !== bv) return dir * (av - bv);
          av = Number.isNaN(am.end) ? -Infinity : am.end;
          bv = Number.isNaN(bm.end) ? -Infinity : bm.end;
          return dir * (av - bv);
        }

        if (sortKey === "priorityTasks") {
          av = am.priorityRatio;
          bv = bm.priorityRatio;
        } else if (sortKey === "planned") {
          av = am.planned;
          bv = bm.planned;
        } else if (sortKey === "completed") {
          av = am.completed;
          bv = bm.completed;
        }
        return dir * (av - bv);
      });
      return sorted;
    };

    const sortIndicator = (key: SortKey) => {
      if (sortKey !== key) return "↕";
      return sortDir === "asc" ? "↑" : "↓";
    };

    const addSortableHeader = (label: string, key: SortKey) => {
      const th = thead.createEl("th");
      th.createEl("span", { text: label });
      const btn = th.createEl("button", {
        text: sortIndicator(key),
        attr: {
          style:
            "margin-left: 0.35rem; padding: 0.15rem 0.35rem; font-size: 0.8rem; line-height: 1; cursor: pointer;",
          type: "button",
        },
      });

      btn.addEventListener("click", () => {
        if (sortKey === key) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = key;
          sortDir = "asc";
        }
        // Update indicators and rerender
        const headerBtns = thead.querySelectorAll<HTMLButtonElement>("button");
        headerBtns.forEach((b) => {
          const parentTh = b.parentElement;
          if (!parentTh) return;
          const labelSpan = parentTh.querySelector("span");
          const currentLabel = labelSpan?.textContent ?? "";
          // Map label back to key
          const labelToKey: Record<string, SortKey> = {
            Date: "date",
            "Start/End": "startEnd",
            "Priority Tasks": "priorityTasks",
            Planned: "planned",
            Completed: "completed",
          };
          const mappedKey = labelToKey[currentLabel];
          if (mappedKey) {
            b.textContent = sortIndicator(mappedKey);
          }
        });
        renderRows();
      });
    };

    addSortableHeader("Date", "date");
    addSortableHeader("Start/End", "startEnd");
    addSortableHeader("Priority Tasks", "priorityTasks");
    addSortableHeader("Planned", "planned");
    addSortableHeader("Completed", "completed");

    const renderRows = () => {
      tbody.empty();

      const sortedDays = getSortedDays();
      const visibleDays = showAll
        ? sortedDays
        : sortedDays.slice(0, maxVisibleDays);

      visibleDays.forEach((day) => {
        const plannedTasks = day.schedule.length;
        const completedTasks = day.schedule.filter((t) => t.completed).length;

        const priorityTasks = day.schedule.filter((t) => t.priority);
        const priorityTotal = priorityTasks.length;
        const priorityCompleted = priorityTasks.filter((t) => t.completed).length;

        const startEndText =
          !Number.isNaN(day.earliest) && !Number.isNaN(day.latest)
            ? `${convTime(day.earliest)} - ${convTime(day.latest)}`
            : "—";

        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: day.date });
        tr.createEl("td", { text: startEndText });
        tr.createEl("td", {
          text: priorityTotal === 0 ? "0/0" : `${priorityCompleted}/${priorityTotal}`,
        });
        tr.createEl("td", { text: `${plannedTasks}` });
        tr.createEl("td", { text: `${completedTasks}` });
      });
    };

    renderRows();

    if (this.currDayData.length > maxVisibleDays) {
      const actions = section.createDiv({
        cls: "odpa-table-actions",
        attr: { style: "margin-top: 0.75rem; margin-bottom: 0.25rem;" },
      });
      const moreBtn = actions.createEl("button", {
        cls: "odpa-button odpa-button-secondary",
        text: "Show more ▾",
        attr: {
          style:
            "padding: 0.25rem 0.55rem; font-size: 0.85rem; line-height: 1;",
        },
      });

      moreBtn.addEventListener("click", () => {
        showAll = !showAll;
        moreBtn.setText(showAll ? "Show less ▴" : "Show more ▾");
        renderRows();
      });
    }
  }

  private renderTasksTable() {
    const section = this.getTabContentParent().createDiv({ cls: "odpa-table-section" });
    section.createEl("h3", { text: "Tasks breakdown" });
    const tableWrap = section.createDiv({ cls: "odpa-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "odpa-table" });
    const thead = table.createEl("thead").createEl("tr");
    const tbody = table.createEl("tbody");

    type TaskRow = {
      name: string;
      timeSpentMinutes: number;
      lastPerformed: string;
    };
    type SortKey = "name" | "timeSpent" | "lastPerformed";

    const normalizeTaskName = (name: string) =>
      name.trim().toLowerCase().replace(/\s+/g, " ");

    const taskMap = new Map<string, TaskRow>();
    for (const day of this.currDayData) {
      for (const task of day.schedule) {
        const normalized = normalizeTaskName(task.name);
        if (!normalized) continue;

        const duration = task.endTime - task.startTime;
        if (!Number.isFinite(duration) || duration < 0) continue;
        const existing = taskMap.get(normalized);
        if (!existing) {
          taskMap.set(normalized, {
            name: task.name.trim(),
            timeSpentMinutes: duration,
            lastPerformed: day.date,
          });
        } else {
          const prev = Number.isFinite(existing.timeSpentMinutes) ? existing.timeSpentMinutes : 0;
          existing.timeSpentMinutes = prev + duration;
          if (day.date > existing.lastPerformed) {
            existing.lastPerformed = day.date;
          }
        }
      }
    }

    const allRows = Array.from(taskMap.values());
    const maxVisibleRows = 5;
    let showAll = false;
    let sortKey: SortKey = "timeSpent";
    let sortDir: "asc" | "desc" = "desc";

    const getSortedRows = () => {
      const dir = sortDir === "asc" ? 1 : -1;
      return [...allRows].sort((a, b) => {
        if (sortKey === "name") return dir * a.name.localeCompare(b.name);
        if (sortKey === "lastPerformed") return dir * a.lastPerformed.localeCompare(b.lastPerformed);
        return dir * (a.timeSpentMinutes - b.timeSpentMinutes);
      });
    };

    const sortIndicator = (key: SortKey) => {
      if (sortKey !== key) return "↕";
      return sortDir === "asc" ? "↑" : "↓";
    };

    const renderRows = () => {
      tbody.empty();
      const sorted = getSortedRows();
      const visible = showAll ? sorted : sorted.slice(0, maxVisibleRows);

      visible.forEach((row) => {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: row.name });
        const safeMinutes = Number.isFinite(row.timeSpentMinutes) ? row.timeSpentMinutes : 0;
        tr.createEl("td", { text: timeFormat(safeMinutes) });
        tr.createEl("td", { text: row.lastPerformed });
      });
    };

    const addSortableHeader = (label: string, key: SortKey) => {
      const th = thead.createEl("th");
      th.createEl("span", { text: label });
      const btn = th.createEl("button", {
        text: sortIndicator(key),
        attr: {
          style:
            "margin-left: 0.35rem; padding: 0.15rem 0.35rem; font-size: 0.8rem; line-height: 1; cursor: pointer;",
          type: "button",
        },
      });

      btn.addEventListener("click", () => {
        if (sortKey === key) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = key;
          sortDir = "asc";
        }

        const headerBtns = thead.querySelectorAll<HTMLButtonElement>("button");
        headerBtns.forEach((b) => {
          const parentTh = b.parentElement;
          if (!parentTh) return;
          const labelSpan = parentTh.querySelector("span");
          const currentLabel = labelSpan?.textContent ?? "";
          const labelToKey: Record<string, SortKey> = {
            Name: "name",
            "Time Spent": "timeSpent",
            "Last Performed": "lastPerformed",
          };
          const mappedKey = labelToKey[currentLabel];
          if (mappedKey) {
            b.textContent = sortIndicator(mappedKey);
          }
        });

        renderRows();
      });
    };

    addSortableHeader("Name", "name");
    addSortableHeader("Time Spent", "timeSpent");
    addSortableHeader("Last Performed", "lastPerformed");

    renderRows();

    if (allRows.length > maxVisibleRows) {
      const actions = section.createDiv({
        cls: "odpa-table-actions",
        attr: { style: "margin-top: 0.75rem; margin-bottom: 0.25rem;" },
      });
      const moreBtn = actions.createEl("button", {
        cls: "odpa-button odpa-button-secondary",
        text: "Show more ▾",
        attr: {
          style:
            "padding: 0.25rem 0.55rem; font-size: 0.85rem; line-height: 1;",
        },
      });

      moreBtn.addEventListener("click", () => {
        showAll = !showAll;
        moreBtn.setText(showAll ? "Show less ▴" : "Show more ▾");
        renderRows();
      });
    }
  }
}

export default class HelloWorldPlugin extends Plugin {
  settings: DSASettings;

  private readonly DAILY_NOTE_RE = /^\d{4}-\d{2}-\d{2}$/;

  dayData: DayData[] = []; // parse results stored

  /** When `refreshDayData` last finished (ms since epoch). */
  dayDataUpdatedAt = 0;

  private dayDataRefreshDebouncer: Debouncer<[], void> | null = null;

  private isDailyNoteByName(file: TFile): boolean {
    return this.DAILY_NOTE_RE.test(file.basename);
  }

  getDailyNotes(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => this.isDailyNoteByName(f));
  }

  async onload() {
    await this.loadSettings();

    this.dayDataRefreshDebouncer = debounce(
      () => {
        void this.refreshDayData();
      },
      400,
      true,
    );

    const scheduleRefreshIfDailyNote = (file: TAbstractFile) => {
      if (file instanceof TFile && this.isDailyNoteByName(file)) {
        this.dayDataRefreshDebouncer?.run();
      }
    };

    this.app.workspace.onLayoutReady(() => {
      void this.refreshDayData();
    });

    this.registerEvent(this.app.vault.on("modify", scheduleRefreshIfDailyNote));
    this.registerEvent(this.app.vault.on("create", scheduleRefreshIfDailyNote));
    this.registerEvent(this.app.vault.on("delete", scheduleRefreshIfDailyNote));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        scheduleRefreshIfDailyNote(file);
        const seg = oldPath.split("/").pop() ?? "";
        const oldBasename = seg.replace(/\.md$/i, "");
        if (this.DAILY_NOTE_RE.test(oldBasename)) {
          this.dayDataRefreshDebouncer?.run();
        }
      }),
    );

    this.addSettingTab(new DSASettingTab(this.app, this));
    this.addCommand({
      id: "day-planner-analyzer-open",
      name: "Advanced statistics",
      callback: () => {
        new StatsModal(this.app, this).open();
      },
    });
  }

async refreshDayData() {
  const dailyNotes = this.getDailyNotes();
  const next: DayData[] = [];

  for (const file of dailyNotes) {
    try {
      const parsed = await parseFile(this.app, file);
      next.push(parsed);
    } catch (err) {
      console.error("[ODPA] Failed to parse", file.path, err);
    }
  }

  this.dayData = next;
  this.dayData.sort((a, b) => a.date.localeCompare(b.date));
  this.dayDataUpdatedAt = Date.now();
  console.error("[ODPA] dayData refreshed:", this.dayData.length);
}

  async loadSettings() {
    const loaded = ((await this.loadData()) ?? {}) as Partial<DSASettings> & { chatModel?: string };
    this.settings = normalizeAssistantSettings(loaded);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}