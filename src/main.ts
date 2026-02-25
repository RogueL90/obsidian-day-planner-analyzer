import {App, Editor, MarkdownView, Modal, Notice, Plugin, TFile, TAbstractFile} from 'obsidian';
import {DEFAULT_SETTINGS, DSASettings, DSASettingTab} from "./settings";
import parseFile from './parseFile'

// Remember to rename these classes and interfaces!

export default class HelloWorldPlugin extends Plugin {
	settings: DSASettings;
	
	private readonly DAILY_NOTE_RE = /^\d{4}-\d{2}-\d{2}$/;

	private isDailyNoteByName(file: TFile): boolean {
    	return this.DAILY_NOTE_RE.test(file.basename);
  	}

  	getDailyNotes(): TFile[] {
    	return this.app.vault.getMarkdownFiles().filter((f) => this.isDailyNoteByName(f));
  	}

	// Main stuff (when plugin enabled)
	async onload() {
		await this.loadSettings();

		const dailyNotes = this.getDailyNotes();
		console.error('Vault name ', dailyNotes.length)
		for(const file of dailyNotes){
			const curr = await parseFile(this.app, file)
			console.error('File: ', curr)
		}
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<DSASettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
