import { App, Modal, Plugin, TFile } from "obsidian";
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

class StatsModal extends Modal {
  private activeTab: TabId = "7d";
  private bodyEl: HTMLElement | null = null;
  private showInfo = false;
  private currDayData: DayData[] = [];
  private taskChart: Chart | null = null;

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

    const customWrap = this.bodyEl.createDiv({ cls: "odpa-custom-controls" });

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
      "Best compatable with Day Planner plugin",
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

    const left = main.createDiv({
      cls: "odpa-panel odpa-panel-highlights",
      attr: {
        style: "flex: 1 1 0; min-width: 0;",
      },
    });
    left.createEl("h3", { text: "Highlights" });
    const list = left.createEl("ul", { cls: "odpa-highlights-list" });
    ["Most productive day: —", "Earliest start: —", "Longest idle gap: —"].forEach((text) =>
      list.createEl("li", { text })
    );

    const right = main.createDiv({
      cls: "odpa-panel odpa-panel-chart",
      attr: {
        style: "flex: 1 1 0; min-width: 0;",
      },
    });

    const chartHeader = right.createDiv({
      cls: "odpa-chart-header",
      attr: {
        style:
          "display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;",
      },
    });
    // eslint-disable-next-line -- product title per design
    chartHeader.createEl("h3", { text: "Tasks Graph" });

    const selectWrap = chartHeader.createDiv({
      cls: "odpa-chart-select-wrap",
      attr: {
        style:
          "display: flex; align-items: center; gap: 0.25rem; max-width: 60%; flex: 0 1 60%; justify-content: flex-end; overflow: hidden;",
      },
    });
    selectWrap.createEl("span", {
      text: "Task:",
      cls: "odpa-chart-select-label",
    });

    const selectEl = selectWrap.createEl("select", {
      cls: "odpa-chart-select",
    });
    setCssProps(selectEl, {
      "max-width": "100%",
      "min-width": "10rem",
      "white-space": "nowrap",
      overflow: "hidden",
      "text-overflow": "ellipsis",
    });

    const chartBox = right.createDiv({
      cls: "odpa-chart-placeholder",
      attr: {
        style:
          "margin-top: 0.5rem; height: 180px !important; max-height: 180px !important; flex: 0 0 auto; overflow: hidden; box-sizing: border-box; display: flex; flex-direction: column;",
      },
    });

    const canvasWrap = chartBox.createDiv({
      cls: "odpa-chart-canvas-wrap",
      attr: {
        style: "flex: 1; min-height: 0; position: relative;",
      },
    });

    const canvas = canvasWrap.createEl("canvas", {
      cls: "odpa-chart-canvas",
    });
    setCssProps(canvas, {
      width: "100%",
      height: "100%",
      display: "block",
    });

    const legendEl = chartBox.createDiv({
      cls: "odpa-chart-legend",
      attr: {
        style: "margin-top: 4px; font-size: 0.7rem; color: var(--text-muted);",
      },
    });
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
    const section = this.bodyEl!.createDiv({ cls: "odpa-table-section" });
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
    const section = this.bodyEl!.createDiv({ cls: "odpa-table-section" });
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
        const existing = taskMap.get(normalized);
        if (!existing) {
          taskMap.set(normalized, {
            name: task.name.trim(),
            timeSpentMinutes: duration,
            lastPerformed: day.date,
          });
        } else {
          existing.timeSpentMinutes += duration;
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
        tr.createEl("td", { text: timeFormat(row.timeSpentMinutes) });
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