import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { safeFolder, validSection, validateRules, type Rule } from './model';
import { PRO_UI } from './pro';
import type RednotebookBackupImportPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface RednotebookBackupImportSettings { folder: string; keepSources: boolean; section: string; rules: Rule[] }
export const DEFAULT_SETTINGS: RednotebookBackupImportSettings = { folder: 'RedNotebook', keepSources: true, section: 'RedNotebook', rules: [] };

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: unknown): RednotebookBackupImportSettings {
	const s = typeof saved === 'object' && saved !== null ? saved as Partial<RednotebookBackupImportSettings> : {};
	let folder = DEFAULT_SETTINGS.folder;
	try { if (typeof s.folder === 'string') folder = safeFolder(s.folder); } catch { /* Use the default folder. */ }
	let rules: Rule[] = [];
	try {
		if (Array.isArray(s.rules)) rules = validateRules(s.rules.filter((r): r is Rule => typeof r === 'object' && r !== null && typeof (r).category === 'string' && typeof (r).property === 'string'));
	} catch { rules = []; }
	return {
		folder,
		keepSources: typeof s.keepSources === 'boolean' ? s.keepSources : DEFAULT_SETTINGS.keepSources,
		section: typeof s.section === 'string' && validSection(s.section) ? s.section : DEFAULT_SETTINGS.section,
		rules,
	};
}

export class RednotebookBackupImportSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly plugin: RednotebookBackupImportPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Import folder', desc: 'Folder for the dated notes. You can change it in the import window.', control: { type: 'text', key: 'folder', defaultValue: DEFAULT_SETTINGS.folder } },
			{ name: 'Keep month source files', desc: 'Copy each month file into a source folder inside the import folder.', control: { type: 'toggle', key: 'keepSources', defaultValue: DEFAULT_SETTINGS.keepSources } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'folder' && typeof value === 'string') { try { safeFolder(value); } catch { return; } }
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
