import { App, PluginSettingTab, requestUrl, Setting } from "obsidian";
import type HelloWorldPlugin from "./main";

/** Persisted chat messages for the productivity assistant */
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  ts: number;
};

export type AssistantProvider = "api" | "ollama";

export interface DSASettings {
  chatHistory: ChatMessage[];
  assistantProvider: AssistantProvider;
  apiBaseUrl: string;
  apiKey: string;
  apiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
}

export const DEFAULT_SETTINGS: DSASettings = {
  chatHistory: [],
  assistantProvider: "api",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  apiModel: "gpt-4o-mini",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "",
};

export function normalizeAssistantSettings(
  loaded: Partial<DSASettings> & { chatModel?: string },
): DSASettings {
  const rest: Partial<DSASettings> & { chatModel?: string } = { ...loaded };
  delete rest.chatModel;
  const settings = Object.assign({}, DEFAULT_SETTINGS, rest);
  if (settings.assistantProvider !== "api" && settings.assistantProvider !== "ollama") {
    settings.assistantProvider = "api";
  }
  return settings;
}

export function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function assistantModel(settings: DSASettings): string {
  return settings.assistantProvider === "ollama"
    ? settings.ollamaModel.trim()
    : settings.apiModel.trim();
}

export function assistantChatCompletionsUrl(settings: DSASettings): string {
  if (settings.assistantProvider === "ollama") {
    return `${stripTrailingSlash(settings.ollamaBaseUrl)}/v1/chat/completions`;
  }
  return `${stripTrailingSlash(settings.apiBaseUrl)}/chat/completions`;
}

export function assistantRequestHeaders(settings: DSASettings): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.assistantProvider === "api") {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }
  return headers;
}

/** Throws a short message the chat status line can show as-is. */
export function assertAssistantConfigured(settings: DSASettings): void {
  if (settings.assistantProvider === "ollama") {
    if (!settings.ollamaBaseUrl.trim()) {
      throw new Error("Set an Ollama host in Day Planner Analyzer settings.");
    }
    if (!settings.ollamaModel.trim()) {
      throw new Error("Choose an Ollama model in settings.");
    }
    return;
  }
  if (!settings.apiBaseUrl.trim()) {
    throw new Error("Set an API base URL in Day Planner Analyzer settings.");
  }
  if (!settings.apiKey.trim()) {
    throw new Error("Add an API key in Day Planner Analyzer settings.");
  }
  if (!settings.apiModel.trim()) {
    throw new Error("Set a chat model in Day Planner Analyzer settings.");
  }
}

export function parseUnknownJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorMessage(body: unknown): string {
  if (!isRecord(body)) return "";
  const message = body.error;
  if (!isRecord(message)) return "";
  return typeof message.message === "string" ? message.message : "";
}

function readOllamaModelNames(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.models)) return [];
  const names: string[] = [];
  for (const model of body.models as readonly unknown[]) {
    if (!isRecord(model) || typeof model.name !== "string") continue;
    const trimmed = model.name.trim();
    if (trimmed) names.push(trimmed);
  }
  return names;
}

function redactSecret(text: string, secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) return text;
  return text.split(trimmed).join("[redacted]");
}

function errorDetail(status: number, json: unknown, text: string, secret: string): string {
  let detail = readErrorMessage(json);
  if (!detail && text) detail = text.slice(0, 300);
  if (!detail) detail = `HTTP ${status}`;
  return redactSecret(detail, secret);
}

export class DSASettingTab extends PluginSettingTab {
  plugin: HelloWorldPlugin;
  private ollamaModels: string[] = [];
  private statusMessage = "";

  constructor(app: App, plugin: HelloWorldPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Obsidian 1.13+ uses this for settings search and skips display(). */
  getSettingDefinitions() {
    const usesApi = () => this.plugin.settings.assistantProvider !== "ollama";
    const usesOllama = () => this.plugin.settings.assistantProvider === "ollama";
    return [
      {
        name: "Assistant provider",
        desc: "Ollama can run a local model. You can also use your own API key.",
        control: {
          type: "dropdown" as const,
          key: "assistantProvider",
          defaultValue: "api",
          options: {
            api: "API key",
            ollama: "Ollama (local)",
          },
        },
      },
      {
        name: "API base URL",
        desc: "Base URL for a chat-completions API. The plugin calls /chat/completions on this URL.",
        visible: usesApi,
        control: {
          type: "text" as const,
          key: "apiBaseUrl",
          placeholder: DEFAULT_SETTINGS.apiBaseUrl,
        },
      },
      {
        name: "API key",
        desc: "Sent only with each request. Stored in this vault's plugin data.",
        visible: usesApi,
        render: (setting: Setting) => {
          setting.addText((text) => {
            text.inputEl.type = "password";
            text
              .setPlaceholder("Paste your key")
              .setValue(this.plugin.settings.apiKey)
              .onChange(async (value) => {
                this.plugin.settings.apiKey = value.trim();
                await this.plugin.saveSettings();
              });
          });
        },
      },
      {
        name: "Model",
        desc: "Model ID for this provider, such as gpt-4o-mini.",
        visible: usesApi,
        control: {
          type: "text" as const,
          key: "apiModel",
          placeholder: DEFAULT_SETTINGS.apiModel,
        },
      },
      {
        name: "Ollama host",
        desc: "Local Ollama server. The default is http://127.0.0.1:11434.",
        visible: usesOllama,
        control: {
          type: "text" as const,
          key: "ollamaBaseUrl",
          placeholder: DEFAULT_SETTINGS.ollamaBaseUrl,
        },
      },
      {
        name: "Ollama model",
        desc: "Ollama models appear here after a refresh. You can also type a model name.",
        visible: usesOllama,
        control: {
          type: "text" as const,
          key: "ollamaModel",
          placeholder: "Model name",
        },
      },
      {
        name: "Refresh models",
        desc: "Load model names from the Ollama host.",
        visible: usesOllama,
        render: (setting: Setting) => {
          if (this.ollamaModels.length > 0) {
            setting.addDropdown((dropdown) => {
              dropdown.addOption("", "Select a model");
              for (const name of this.ollamaModels) dropdown.addOption(name, name);
              const current = this.plugin.settings.ollamaModel;
              dropdown.setValue(this.ollamaModels.includes(current) ? current : "");
              dropdown.onChange(async (value) => {
                if (!value) return;
                this.plugin.settings.ollamaModel = value;
                await this.plugin.saveSettings();
                this.refreshSettingsView();
              });
            });
          }
          setting.addButton((btn) =>
            btn.setButtonText("Refresh models").onClick(() => {
              btn.buttonEl.disabled = true;
              btn.setButtonText("Refreshing…");
              void this.finishOllamaRefresh();
            }),
          );
        },
      },
      {
        name: "Test connection",
        desc: "Sends a one-token completion with the selected provider.",
        render: (setting: Setting) => {
          setting.addButton((btn) =>
            btn.setButtonText("Test connection").onClick(() => {
              btn.buttonEl.disabled = true;
              btn.setButtonText("Testing…");
              void this.finishConnectionTest();
            }),
          );
        },
      },
      {
        name: "Connection status",
        desc: this.statusMessage,
        visible: () => this.statusMessage.length > 0,
      },
      {
        name: "Clear assistant chat history",
        desc: "Remove all saved messages from the productivity assistant.",
        render: (setting: Setting) => {
          setting.addButton((btn) =>
            btn.setButtonText("Clear chat").onClick(async () => {
              this.plugin.settings.chatHistory = [];
              await this.plugin.saveSettings();
            }),
          );
        },
      },
    ];
  }

  private refreshSettingsView(): void {
    const host = this as PluginSettingTab & { update?: () => void };
    if (typeof host.update === "function") {
      host.update();
      return;
    }
    this.display();
  }

  private async finishOllamaRefresh(): Promise<void> {
    const err = await this.fetchOllamaModels();
    const count = this.ollamaModels.length;
    this.statusMessage = err ?? `Found ${count} model${count === 1 ? "" : "s"}.`;
    this.refreshSettingsView();
  }

  private async finishConnectionTest(): Promise<void> {
    this.statusMessage = await this.testAssistantConnection();
    this.refreshSettingsView();
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl).setHeading().setName("Day planner analyzer");

    new Setting(containerEl)
      .setName("Assistant provider")
      .setDesc("Ollama can run a local model. You can also use your own API key.")
      .addDropdown((dropdown) => {
        dropdown.addOption("api", "API key");
        dropdown.addOption("ollama", "Ollama (local)");
        dropdown.setValue(this.plugin.settings.assistantProvider).onChange(async (value) => {
          this.plugin.settings.assistantProvider = value === "ollama" ? "ollama" : "api";
          this.statusMessage = "";
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (this.plugin.settings.assistantProvider === "ollama") {
      this.displayOllamaSettings(containerEl);
    } else {
      this.displayApiSettings(containerEl);
    }

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc(
        this.plugin.settings.assistantProvider === "ollama"
          ? "Checks that Ollama is running, then sends a one-token completion to the selected model."
          : "Sends a one-token completion with your API key.",
      )
      .addButton((btn) =>
        btn.setButtonText("Test connection").onClick(async () => {
          btn.buttonEl.disabled = true;
          btn.setButtonText("Testing…");
          this.statusMessage = await this.testAssistantConnection();
          this.display();
        }),
      );

    if (this.statusMessage) {
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: this.statusMessage,
      });
    }

    new Setting(containerEl)
      .setName("Clear assistant chat history")
      .setDesc("Remove all saved messages from the productivity assistant.")
      .addButton((btn) =>
        btn.setButtonText("Clear chat").onClick(async () => {
          this.plugin.settings.chatHistory = [];
          await this.plugin.saveSettings();
        }),
      );
  }

  private displayApiSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("API base URL")
      .setDesc("Base URL for a chat-completions API. The plugin calls /chat/completions on this URL.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.apiBaseUrl)
          .setValue(this.plugin.settings.apiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiBaseUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Sent only with each request. Stored in this vault's plugin data.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Paste your key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Model ID for this provider, such as gpt-4o-mini.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.apiModel)
          .setValue(this.plugin.settings.apiModel)
          .onChange(async (value) => {
            this.plugin.settings.apiModel = value.trim();
            await this.plugin.saveSettings();
          }),
      );
  }

  private displayOllamaSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Ollama host")
      .setDesc("Local Ollama server. The default is http://127.0.0.1:11434.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.ollamaBaseUrl)
          .setValue(this.plugin.settings.ollamaBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.ollamaBaseUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    const current = this.plugin.settings.ollamaModel;
    const names = [...this.ollamaModels];
    if (current && !names.includes(current)) names.unshift(current);

    let modelInput: HTMLInputElement | null = null;
    new Setting(containerEl)
      .setName("Ollama model")
      .setDesc("Ollama models appear here after a refresh. You can also type a model name.")
      .addDropdown((dropdown) => {
        if (names.length === 0) {
          dropdown.addOption("", "Refresh to list models");
        } else {
          dropdown.addOption("", "Select a model");
          for (const name of names) dropdown.addOption(name, name);
        }
        dropdown.setValue(current && names.includes(current) ? current : "");
        dropdown.onChange(async (value) => {
          this.plugin.settings.ollamaModel = value;
          if (modelInput) modelInput.value = value;
          await this.plugin.saveSettings();
        });
      })
      .addText((text) => {
        modelInput = text.inputEl;
        text.setPlaceholder("Model name").setValue(current).onChange(async (value) => {
          this.plugin.settings.ollamaModel = value.trim();
          await this.plugin.saveSettings();
        });
      })
      .addButton((btn) =>
        btn.setButtonText("Refresh models").onClick(async () => {
          btn.buttonEl.disabled = true;
          btn.setButtonText("Refreshing…");
          const err = await this.fetchOllamaModels();
          this.statusMessage =
            err ??
            `Found ${this.ollamaModels.length} model${this.ollamaModels.length === 1 ? "" : "s"}.`;
          this.display();
        }),
      );
  }

  private async fetchOllamaModels(): Promise<string | null> {
    const base = stripTrailingSlash(this.plugin.settings.ollamaBaseUrl);
    if (!base) return "Set an Ollama host in Day Planner Analyzer settings.";
    try {
      const res = await requestUrl({
        url: `${base}/api/tags`,
        method: "GET",
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) {
        this.ollamaModels = [];
        return `Could not reach Ollama (HTTP ${res.status}). You can still type a model name.`;
      }
      const found = readOllamaModelNames(parseUnknownJson(res.text));
      this.ollamaModels = found;
      if (found.length === 0) {
        return "Ollama is running, but no models are installed. You can still type a model name.";
      }
      return null;
    } catch (err) {
      this.ollamaModels = [];
      const msg = err instanceof Error ? err.message : String(err);
      return `Could not reach Ollama: ${msg}. You can still type a model name.`;
    }
  }

  private async testAssistantConnection(): Promise<string> {
    const settings = this.plugin.settings;
    try {
      assertAssistantConfigured(settings);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }

    if (settings.assistantProvider === "ollama") {
      const tagsError = await this.fetchOllamaModels();
      if (tagsError && this.ollamaModels.length === 0 && tagsError.startsWith("Could not reach")) {
        return tagsError;
      }
    }

    const secret = settings.assistantProvider === "api" ? settings.apiKey : "";
    try {
      const res = await requestUrl({
        url: assistantChatCompletionsUrl(settings),
        method: "POST",
        headers: assistantRequestHeaders(settings),
        throw: false,
        body: JSON.stringify({
          model: assistantModel(settings),
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0,
          stream: false,
        }),
      });
      const body = parseUnknownJson(res.text);
      if (res.status < 200 || res.status >= 300) {
        const detail = errorDetail(res.status, body, res.text, secret);
        return `Connection failed (${res.status}): ${detail}`;
      }
      const message = readErrorMessage(body);
      if (message) {
        return `Connection failed: ${redactSecret(message, secret)}`;
      }
      return "Connection succeeded.";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Connection failed: ${redactSecret(msg, secret)}`;
    }
  }
}
