import { App, Modal, Plugin, TFile } from "obsidian";
import { TimeBlock } from "./parseFile";
import parseFile from './parseFile'
import { DEFAULT_SETTINGS, DSASettings } from "./settings";
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

class StatsModal extends Modal {
  private activeTab: TabId = "7d";
  private bodyEl: HTMLElement | null = null;
  private showInfo = false;
  private currDayData: DayData[] = []

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
    this.bodyEl = this.contentEl.createDiv({ cls: "odpa-stats-body" });
    this.getDisplayDataPast(30)
    this.renderResults();
  }

  onClose() {
    this.contentEl.parentElement?.removeClass("odpa-stats-modal");
    this.contentEl.empty();
    this.bodyEl = null;
  }

  private renderResults() {
    console.error(this.currDayData)
    if (!this.bodyEl) return;
    this.bodyEl.empty();

    this.renderHeader();
    if (this.showInfo) {
      this.renderInfoDropdown();
    }
    this.renderTabs();
    this.renderSummaryCards();
    this.renderMainContent();
    this.renderDailyTable();
    this.renderTasksTable();
  }

  private renderCustom() {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    this.renderHeader();
    if (this.showInfo) {
      this.renderInfoDropdown();
    }
    this.renderTabs();

    const main = this.bodyEl.createDiv({ cls: "odpa-stats-main" });

    const left = main.createDiv({ cls: "odpa-panel odpa-panel-highlights" });
    left.createEl("h3", { text: "Custom" });
    const list = left.createEl("ul", { cls: "odpa-highlights-list" });
    ["Enter how long you want, between x and y"].forEach((text) =>
      list.createEl("li", { text })
    );

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

    right.createEl("span", { cls: "odpa-stats-updated", text: "Last updated: —" });
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
      "Best compatable with Daily Scheduler plugin",
      "Daily notes use YYYY-MM-DD.md naming convention for each file",
      "To mark tasks as priority for the day, put a star after the end time. Ex) 4:00pm - 4:30pm* Meditate",
      "To comment specifications of a task without it affecting the task analysis, comment with '//' AFTER the task name. Ex) 4:00pm - 4:30pm Meditate // with waterfall sounds",
    ].forEach((text) => {
      list.createEl("li", { text });
    });
  }

  private renderTabs() {
    const tabsWrap = this.bodyEl!.createDiv({ cls: "odpa-stats-tabs" });
    const tabs: { id: TabId; label: string }[] = [
      { id: "7d", label: "Past 7 days" },
      { id: "30d", label: "Past 30 days" },
      { id: "custom", label: "Custom" },
    ];
    tabs.forEach(({ id, label }) => {
      const tab = tabsWrap.createEl("button", { cls: "odpa-tab", text: label });
      if (this.activeTab === id) tab.addClass("is-active");
      tab.addEventListener("click", () => {
        this.activeTab = id;
        if(id == "7d"){
        this.getDisplayDataPast(30)
        this.renderResults(); 
        } else if(id == "30d"){
        this.getDisplayDataPast(45)
        this.renderResults(); 
        } else{
          this.renderCustom();
        }
        // Compute parameters
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
    const row = this.bodyEl!.createDiv({ cls: "odpa-stats-cards" });
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

  private renderMainContent() {
    const main = this.bodyEl!.createDiv({ cls: "odpa-stats-main" });

    const left = main.createDiv({ cls: "odpa-panel odpa-panel-highlights" });
    left.createEl("h3", { text: "Highlights" });
    const list = left.createEl("ul", { cls: "odpa-highlights-list" });
    ["Most productive day: —", "Earliest start: —", "Longest idle gap: —"].forEach((text) =>
      list.createEl("li", { text })
    );

    const right = main.createDiv({ cls: "odpa-panel odpa-panel-chart" });
    right.createEl("h3", { text: "Chart" });
    const chartBox = right.createDiv({ cls: "odpa-chart-placeholder" });
    chartBox.createEl("span", { text: "Chart goes here" });
  }

  private renderDailyTable() {
    const section = this.bodyEl!.createDiv({ cls: "odpa-table-section" });
    section.createEl("h3", { text: "Daily breakdown" });
    const tableWrap = section.createDiv({ cls: "odpa-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "odpa-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Date", "Planned", "Unplanned", "Tasks", "Completion"].forEach((col) =>
      thead.createEl("th", { text: col })
    );
    const tbody = table.createEl("tbody");
    // TODO: replace with real daily breakdown rows (from your computed stats)
    const placeholderRows = [
      { date: "", planned: "—", unplanned: "—", tasks: "—", completion: "—" },
      { date: "—", planned: "—", unplanned: "—", tasks: "—", completion: "—" },
      { date: "—", planned: "—", unplanned: "—", tasks: "—", completion: "—" },
      { date: "—", planned: "—", unplanned: "—", tasks: "—", completion: "—" },
      { date: "—", planned: "—", unplanned: "—", tasks: "—", completion: "—" },
    ];
    placeholderRows.forEach((row) => {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: row.date });
      tr.createEl("td", { text: row.planned });
      tr.createEl("td", { text: row.unplanned });
      tr.createEl("td", { text: row.tasks });
      tr.createEl("td", { text: row.completion });
    });
  }

  private renderTasksTable() {
    const section = this.bodyEl!.createDiv({ cls: "odpa-table-section" });
    section.createEl("h3", { text: "Tasks breakdown" });
    const tableWrap = section.createDiv({ cls: "odpa-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "odpa-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Date", "Start/End", "Priority Tasks", "Planned", "Completed"].forEach((col) =>
      thead.createEl("th", { text: col })
    );
    const tbody = table.createEl("tbody");
    const placeholderRows = [
      { date: "-", planned: "—", unplanned: "—", tasks: "—", completion: "—" },
      { date: "—", planned: "—", unplanned: "—", tasks: "—", completion: "—" },
      { date: "—", planned: "—", unplanned: "—", tasks: "—", completion: "—" },
      { date: "—", planned: "—", unplanned: "—", tasks: "—", completion: "—" },
      { date: "—", planned: "—", unplanned: "—", tasks: "—", completion: "—" },
    ];
    placeholderRows.forEach((row) => {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: row.date });
      tr.createEl("td", { text: row.planned });
      tr.createEl("td", { text: row.unplanned });
      tr.createEl("td", { text: row.tasks });
      tr.createEl("td", { text: row.completion });
    });
  }
}

export default class HelloWorldPlugin extends Plugin {
  settings: DSASettings;

  private readonly DAILY_NOTE_RE = /^\d{4}-\d{2}-\d{2}$/;

  dayData: DayData[] = []; // parse results stored

  private isDailyNoteByName(file: TFile): boolean {
    return this.DAILY_NOTE_RE.test(file.basename);
  }

  getDailyNotes(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => this.isDailyNoteByName(f));
  }

  async onload() {
    await this.loadSettings();
    await this.refreshDayData();
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
  console.error("[ODPA] dayData refreshed:", this.dayData.length);
}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<DSASettings>);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}