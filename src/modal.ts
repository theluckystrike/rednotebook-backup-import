import { TEXT } from './copy';
import { Modal, Notice, Setting } from 'obsidian';
import { MAX_ZIP, type Backup } from './archive';
import type { ImportPlan } from './importer';
import type { Rule } from './model';
import { isPro } from './pro';
import type RednotebookBackupImportPlugin from './main';

export class ImportModal extends Modal {
	private backup: Backup | null;
	private plan: ImportPlan | null = null;
	private folder: string;
	private keepSources: boolean;
	private merge = false;
	private section: string;
	private mergeDates = new Set<string>();
	private rules: Rule[];
	private busy = false;
	private importing = false;
	private cancelRequested = false;
	private disposed = false;
	private status: HTMLElement | null = null;
	private preview: HTMLElement | null = null;
	private proControls: HTMLElement | null = null;
	private actions: HTMLElement | null = null;

	constructor(private readonly plugin: RednotebookBackupImportPlugin, backup?: Backup) {
		super(plugin.app);
		this.backup = backup ?? null;
		this.folder = plugin.settings.folder;
		this.keepSources = plugin.settings.keepSources;
		this.section = plugin.settings.section;
		this.rules = plugin.settings.rules.map((r) => ({ ...r }));
	}
	onOpen(): void {
		this.setTitle(TEXT.title);
		this.modalEl.addClass('rednotebook-import-modal');
		this.contentEl.addClass('rednotebook-import');
		this.contentEl.createEl('p', { text: TEXT.description });
		const picker = new Setting(this.contentEl).setName(TEXT.fileLabel).setDesc(TEXT.fileHelp);
		const input = picker.controlEl.createEl('input', { type: 'file', cls: 'rednotebook-picker' });
		input.accept = '.zip';
		input.setAttribute('aria-label', TEXT.fileLabel);
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (file) void this.run(async () => {
				this.backup = null;
				this.plan = null;
				if (file.size > MAX_ZIP) throw new Error('The ZIP file exceeds 20 MiB.');
				this.backup = this.plugin.readBackup(new Uint8Array(await file.arrayBuffer()));
				this.refreshPreview();
			});
		});
		new Setting(this.contentEl).setName('Import folder').setDesc('One note for each date: YYYY-MM-DD.md.').addText((t) => t.setValue(this.folder).onChange((value) => { this.folder = value; this.invalidate(); }));
		new Setting(this.contentEl).setName('Keep month source files').setDesc('Copy each month file into a source folder inside the import folder. Existing copies are kept.').addToggle((t) => t.setValue(this.keepSources).onChange((value) => { this.keepSources = value; }));
		this.proControls = this.contentEl.createDiv({ cls: 'rednotebook-pro' });
		this.status = this.contentEl.createDiv({ cls: 'rednotebook-status', attr: { role: 'status', 'aria-live': 'polite' } });
		this.preview = this.contentEl.createDiv({ cls: 'rednotebook-preview' });
		this.actions = this.contentEl.createDiv({ cls: 'rednotebook-actions' });
		this.updatePro();
		if (this.backup) void this.run(async () => { this.refreshPreview(); });
	}
	private invalidate(): void {
		this.plan = null;
		this.preview?.empty();
		this.message('Select Preview to check the current folder.');
		this.drawActions();
	}
	private message(text: string): void { this.status?.setText(text); }
	private setInputs(disabled: boolean): void {
		this.contentEl.querySelectorAll<HTMLInputElement>('input').forEach((input) => { input.disabled = disabled; });
	}
	private async run(action: () => Promise<void>): Promise<void> {
		if (this.busy || this.disposed) return;
		this.busy = true;
		this.setInputs(true);
		this.drawActions();
		try { await action(); } catch (e) { this.plan = null; this.preview?.empty(); this.message(e instanceof Error ? e.message : String(e)); }
		finally {
			this.busy = false;
			if (!this.disposed) { this.setInputs(false); this.updatePro(); }
		}
	}
	refreshPreview(): void {
		if (!this.backup) { this.message('Select a ZIP backup first.'); return; }
		this.plan = this.plugin.prepare(this.backup, this.folder);
		this.mergeDates = new Set([...this.mergeDates].filter((d) => this.plan?.days.some((p) => p.exists && p.day.date === d)));
		this.drawPreview(this.plan);
		this.message('Preview ready. Existing notes and conflicts are skipped.');
		this.updatePro();
	}
	private drawPreview(plan: ImportPlan): void {
		const el = this.preview;
		if (!el) return;
		el.empty();
		const existing = plan.days.filter((d) => d.exists).length;
		el.createEl('p', { cls: 'rednotebook-counts', text: `${plan.days.length} dates · ${existing} existing notes · ${plan.backup.conflicts.length} conflicts · ${plan.reports.length} markup reports` });
		const table = el.createEl('table', { cls: 'rednotebook-table' });
		const header = table.createEl('thead').createEl('tr');
		for (const name of ['Date', 'Categories', 'Text', 'Status']) header.createEl('th', { text: name });
		const body = table.createEl('tbody');
		for (const item of plan.days.slice(0, 10)) {
			const row = body.createEl('tr');
			const categories = item.day.categories.map((c) => `${c.name}${c.values.length ? `: ${c.values.join(', ')}` : ''}`).join('; ') || '—';
			const text = item.day.text.replace(/\s+/g, ' ').trim();
			for (const value of [item.day.date, categories, text.length > 60 ? `${text.slice(0, 60)}…` : text || '—', item.exists ? 'Exists, skipped' : 'New note']) row.createEl('td', { text: value });
		}
		if (plan.days.length > 10) el.createEl('p', { text: `The table shows the first 10 of ${plan.days.length} dates.` });
		this.list(el, 'Conflicts', [...plan.blocked.map((p) => `A file blocks the folder: ${p}`), ...plan.backup.conflicts]);
		this.list(el, 'Existing notes', plan.days.filter((d) => d.exists).map((d) => d.path));
		this.list(el, 'Markup reports', plan.reports);
		this.list(el, 'Empty dates not imported', plan.backup.empty);
		this.list(el, 'Other ZIP files not read', plan.backup.ignored);
	}
	private list(el: HTMLElement, title: string, values: string[]): void {
		if (!values.length) return;
		const details = el.createEl('details');
		details.createEl('summary', { text: `${title} (${values.length})` });
		const list = details.createEl('ul');
		for (const value of values.slice(0, 50)) list.createEl('li', { text: value });
		if (values.length > 50) list.createEl('li', { text: `${values.length - 50} more items.` });
	}
	updatePro(): void {
		const el = this.proControls;
		if (!el || this.disposed) return;
		el.empty();
		const pro = isPro();
		if (!pro) this.merge = false;
		const rules = el.createEl('details', { cls: 'rednotebook-rules' });
		rules.createEl('summary', { text: TEXT.rules });
		rules.createEl('p', { cls: 'setting-item-description', text: 'Copy the values of a category into a note property. Leave a field blank to keep the category in the note body only.' });
		const names = new Set(this.rules.map((r) => r.category));
		for (const day of this.backup?.days ?? []) for (const c of day.categories) names.add(c.name);
		for (const name of [...names].sort().slice(0, 50)) {
			const current = this.rules.find((r) => r.category === name)?.property ?? '';
			new Setting(rules).setName(name).addText((t) => t.setPlaceholder('Property name').setValue(current).setDisabled(!pro).onChange((value) => {
				this.rules = [...this.rules.filter((r) => r.category !== name), { category: name, property: value.trim() }];
			}));
		}
		new Setting(rules).setName(TEXT.saveRules).addButton((b) => b.setButtonText('Save rules').setDisabled(!pro || this.busy).onClick(() => void this.run(async () => {
			if (await this.plugin.saveRules(this.rules)) { this.rules = this.plugin.settings.rules.map((r) => ({ ...r })); new Notice('Category mapping rules saved.'); }
		})));
		const merge = el.createEl('details', { cls: 'rednotebook-merge' });
		merge.createEl('summary', { text: TEXT.merge });
		new Setting(merge).setName('Merge selected dates').setDesc('Add the converted day to the end of an existing note under this heading. A note that has the heading is not changed.').addToggle((t) => t.setValue(this.merge).setDisabled(!pro).onChange((value) => { this.merge = isPro() && value; }));
		new Setting(merge).setName('Section name').addText((t) => t.setValue(this.section).setDisabled(!pro).onChange((value) => { this.section = value.trim(); }));
		for (const item of this.plan?.days.filter((d) => d.exists).slice(0, 100) ?? []) {
			new Setting(merge).setName(item.day.date).setDesc(item.path).addToggle((t) => t.setValue(this.mergeDates.has(item.day.date)).setDisabled(!pro).onChange((value) => {
				if (value) this.mergeDates.add(item.day.date); else this.mergeDates.delete(item.day.date);
			}));
		}
		if (this.busy) this.setInputs(true);
		this.drawActions();
	}
	private drawActions(): void {
		const el = this.actions;
		if (!el || this.disposed) return;
		el.empty();
		new Setting(el).addButton((b) => b.setButtonText('Preview').setDisabled(this.busy || !this.backup).onClick(() => void this.run(async () => { this.refreshPreview(); })))
			.addButton((b) => b.setButtonText('Cancel import').setDisabled(!this.importing).onClick(() => { this.cancelRequested = true; this.message('Stopping after the current batch…'); }))
			.addButton((b) => b.setButtonText('Create notes').setCta().setDisabled(this.busy || !this.plan || !this.plan.days.length).onClick(() => void this.run(async () => {
				const plan = this.plan;
				if (!plan) return;
				const merge = this.merge && isPro() && this.mergeDates.size ? { section: this.section, dates: [...this.mergeDates] } : null;
				this.importing = true;
				this.cancelRequested = false;
				this.drawActions();
				this.message('Creating notes…');
				let result;
				try { result = await this.plugin.importPlan(plan, { keepSources: this.keepSources, merge, cancelled: () => this.cancelRequested || this.disposed }); }
				finally { this.importing = false; }
				this.plan = null;
				if (this.disposed) return;
				this.preview?.empty();
				this.message(`${result.cancelled ? 'Import stopped. Partial write: ' : 'Import complete: '}${result.created} notes created, ${result.skipped} skipped, ${result.merged} merged, ${result.sources} source files kept, ${result.errors.length} errors.`);
				if (this.preview) { this.list(this.preview, 'Import errors', result.errors); this.list(this.preview, 'Skipped paths', result.skippedPaths); }
				this.plugin.settings.folder = plan.folder;
				this.plugin.settings.keepSources = this.keepSources;
				if (merge) this.plugin.settings.section = merge.section;
				await this.plugin.saveSettings();
			})));
	}
	onClose(): void { this.disposed = true; this.contentEl.empty(); this.backup = null; this.plan = null; this.plugin.closed(this); }
}
