import { App, Modal, Plugin, TFile } from "obsidian";
import { TimeBlock } from "./parseFile";
import parseFile from './parseFile'
import { DEFAULT_SETTINGS, DSASettings } from "./settings";

type DayData = {
	schedule: TimeBlock[],
    date: string,
    earliest: number,
    latest: number,
}; 

class StatsModal extends Modal {
  constructor(
    app: App,
    private plugin: HelloWorldPlugin
  ) {
    super(app);
  }

  onOpen() {
    const contentEl = this.contentEl
    contentEl.empty();

    contentEl.createEl("h2", { text: "Advanced statistics" });

    const items = this.plugin.dayData;
    contentEl.createEl("p", { text: `Daily notes analyzed: ${items.length}` });

    const ul = contentEl.createEl("ul");
    for (const item of items.slice(0, 10)) {
      ul.createEl("li", { text: JSON.stringify(item) });
    }
  }

  onClose() {
    this.contentEl.empty();
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

    // 2) Register command palette command
    this.addCommand({
      id: "day-planner-analyzer-open",
      name: "Advanced statistics",
      callback: () => {
        new StatsModal(this.app, this).open();
      },
    });

    // 3) Populate the array (do it once on load, or recompute on demand)
    await this.refreshDayData();
  }

  async refreshDayData() {
    const dailyNotes = this.getDailyNotes();
    this.dayData = [];

    for (const file of dailyNotes) {
      const parsed = await parseFile(this.app, file);
      this.dayData.push(parsed);
	  console.error(parsed)
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<DSASettings>);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}