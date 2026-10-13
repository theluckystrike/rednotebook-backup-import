import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian-test-mocks/obsidian';
import RednotebookBackupImportPlugin from '../src/main';
import { readBackup } from '../src/archive';
import { inspectFiles } from '../src/archive';
import { prepareImport, writeImport } from '../src/importer';
import { mergeBlock, noteText, safeFolder, tagName, validateRules } from '../src/model';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { bindPro, resetPro, SPONSORS } from '../src/pro';
import manifest from '../manifest.json';

const fixture = () => readBackup(new Uint8Array(readFileSync('tests/fixtures/rednotebook-two-days.zip')));
function setup(files: Record<string, string> = {}) {
	const app = App.createConfigured__({ files });
	const plugin = new RednotebookBackupImportPlugin(app as never, manifest as never);
	return { app, plugin };
}
const read = async (app: ReturnType<typeof setup>['app'], path: string) => app.vault.read(app.vault.getAbstractFileByPath(path) as TFile);
function pro(value: boolean) { bindPro({ isPro: () => value, onChange: () => () => undefined } as never); }
afterEach(() => resetPro());

describe('vault import', () => {
	it('loads and repairs saved settings', async () => {
		const { plugin } = setup();
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ folder: '../x', keepSources: 'yes', section: '#bad', rules: [{ category: 'A', property: 'rednotebook_date' }] })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
	it('previews without writes, then creates 2026-01-01.md and 2026-01-02.md', async () => {
		const { app, plugin } = setup();
		const plan = plugin.prepare(fixture(), 'Journal');
		expect(app.vault.getFiles()).toHaveLength(0);
		expect(plan.reports).toEqual(['2026-01-01: Image not copied: /home/user/Pictures/fireworks.jpg']);
		const r = await plugin.importPlan(plan);
		expect(r).toMatchObject({ created: 2, skipped: 0, merged: 0, sources: 1, errors: [], cancelled: false });
		const one = await read(app, 'Journal/2026-01-01.md');
		expect(one).toContain('rednotebook_date: 2026-01-01');
		expect(one).toContain('# New year\n**Bold**, *italic*, and [Example](https://example.org).');
		expect(one).toContain('- Places: Paris');
		expect(one).toContain('[""/home/user/Pictures/fireworks"".jpg]');
		expect(one).toContain('The image files were not copied.');
		expect(await read(app, 'Journal/2026-01-02.md')).toContain('日本語 😀');
		expect(await read(app, 'Journal/RedNotebook source/2026-01.txt')).toContain("text: !!python/unicode '日本語 😀'");
	});
	it('skips an existing note and does not change it', async () => {
		const { app, plugin } = setup({ 'Journal/2026-01-01.md': 'Keep me' });
		const plan = plugin.prepare(fixture(), 'Journal');
		expect(plan.days.filter((d) => d.exists).map((d) => d.path)).toEqual(['Journal/2026-01-01.md']);
		const r = await plugin.importPlan(plan, { keepSources: false });
		expect(r).toMatchObject({ created: 1, skipped: 1, sources: 0, skippedPaths: ['Journal/2026-01-01.md'] });
		expect(await read(app, 'Journal/2026-01-01.md')).toBe('Keep me');
		expect(app.vault.getAbstractFileByPath('Journal/RedNotebook source/2026-01.txt')).toBeNull();
	});
	it('a repeat import skips each note and keeps the source copy', async () => {
		const { plugin } = setup();
		await plugin.importPlan(plugin.prepare(fixture(), 'Journal'));
		const r = await plugin.importPlan(plugin.prepare(fixture(), 'Journal'));
		expect(r).toMatchObject({ created: 0, skipped: 2, sources: 0 });
	});
	it('a file that blocks the folder stops the import before writes', async () => {
		const { app, plugin } = setup({ Journal: 'A file' });
		const plan = plugin.prepare(fixture(), 'Journal');
		expect(plan.blocked).toEqual(['Journal']);
		await expect(plugin.importPlan(plan)).rejects.toThrow('blocks');
		expect(app.vault.getFiles()).toHaveLength(1);
	});
	it('a duplicate month is reported and its dates are not written', async () => {
		const { app } = setup();
		const backup = inspectFiles({ '2026-01.txt': '1: {text: A}\n', 'data/2026-01.txt': '1: {text: B}\n' });
		const plan = prepareImport(app.vault as never, backup, 'Journal');
		expect(plan.days).toHaveLength(0);
		expect(backup.conflicts[0]).toContain('2026-01-01');
	});
	it('stops between batches on cancel and reports the partial write', async () => {
		const { app } = setup();
		const lines = Array.from({ length: 25 }, (_, i) => `${i + 1}: {text: Day ${i + 1}}`).join('\n');
		const plan = prepareImport(app.vault as never, inspectFiles({ '2026-03.txt': lines }), 'Journal');
		let calls = 0;
		const r = await writeImport(app.vault as never, plan, { keepSources: true, rules: [], merge: null, cancelled: () => ++calls > 1 });
		expect(r).toMatchObject({ created: 10, cancelled: true, sources: 0 });
	});
	it('reports a write error and continues with later dates', async () => {
		const { app, plugin } = setup();
		const plan = plugin.prepare(fixture(), 'Journal');
		const spy = vi.spyOn(app.vault, 'create').mockRejectedValueOnce(new Error('Disk full'));
		const r = await plugin.importPlan(plan, { keepSources: false });
		expect(r.errors[0]).toContain('Disk full');
		expect(r.created).toBe(1);
		spy.mockRestore();
	});
	it('rejects unsafe folders and keeps tag names valid', () => {
		for (const value of ['', '../Journal', '/Journal', '.obsidian', 'A\\B', 'A/CON']) expect(() => safeFolder(value)).toThrow();
		expect(safeFolder('Journal/2026')).toBe('Journal/2026');
		expect(tagName('2026')).toBe('_2026');
		expect(tagName('day trip')).toBe('day-trip');
	});
});

describe('Pro features', () => {
	it('merge needs Pro at execution time', async () => {
		const { plugin } = setup({ 'Daily/2026-01-01.md': '# My day' });
		const plan = plugin.prepare(fixture(), 'Daily');
		await expect(plugin.importPlan(plan, { merge: { section: 'RedNotebook', dates: ['2026-01-01'] } })).rejects.toThrow('needs Pro');
	});
	it('Pro merges a selected date into a named section once', async () => {
		pro(true);
		const { app, plugin } = setup({ 'Daily/2026-01-01.md': '# My day\n' });
		const merge = { section: 'RedNotebook', dates: ['2026-01-01'] };
		const r = await plugin.importPlan(plugin.prepare(fixture(), 'Daily'), { keepSources: false, merge });
		expect(r).toMatchObject({ created: 1, merged: 1, skipped: 0 });
		const text = await read(app, 'Daily/2026-01-01.md');
		expect(text.startsWith('# My day\n\n## RedNotebook\n\n### New year')).toBe(true);
		expect(text).toContain('### Categories\n\n- Places: Paris');
		const again = await plugin.importPlan(plugin.prepare(fixture(), 'Daily'), { keepSources: false, merge });
		expect(again).toMatchObject({ merged: 0, skipped: 2 });
		expect(again.errors[0]).toContain('exists');
		expect(await read(app, 'Daily/2026-01-01.md')).toBe(text);
	});
	it('merged day headings stay below the section heading', () => {
		const day = { date: '2026-01-03', text: '= Trip =\n== Categories ==\n===== Deep =====\n```\n# code\n```', categories: [{ name: 'Places', values: ['Lyon'] }], source: '2026-01.txt' };
		expect(mergeBlock(day, 'RedNotebook')).toBe('## RedNotebook\n\n### Trip\n#### Categories\n###### Deep\n```\n# code\n```\n\n### Categories\n\n- Places: Lyon\n');
		expect(noteText(day).body).toContain('# Trip\n## Categories\n##### Deep');
	});
	it('an unselected existing date is not merged', async () => {
		pro(true);
		const { app, plugin } = setup({ 'Daily/2026-01-01.md': 'Keep' });
		await plugin.importPlan(plugin.prepare(fixture(), 'Daily'), { merge: { section: 'RedNotebook', dates: ['2026-01-02'] } });
		expect(await read(app, 'Daily/2026-01-01.md')).toBe('Keep');
	});
	it('saved category rules need Pro and apply only with Pro', async () => {
		const { app, plugin } = setup();
		expect(await plugin.saveRules([{ category: 'Places', property: 'place' }])).toBe(false);
		pro(true);
		expect(await plugin.saveRules([{ category: 'Places', property: 'place' }])).toBe(true);
		expect(plugin.settings.rules).toEqual([{ category: 'Places', property: 'place' }]);
		await plugin.importPlan(plugin.prepare(fixture(), 'Pro'));
		expect(await read(app, 'Pro/2026-01-01.md')).toContain('place:\n  - Paris');
		pro(false);
		await plugin.importPlan(plugin.prepare(fixture(), 'Free'));
		expect(await read(app, 'Free/2026-01-01.md')).not.toContain('place:');
	});
	it('rules reject reserved property names and map tags', () => {
		expect(() => validateRules([{ category: 'A', property: 'rednotebook_source' }])).toThrow();
		const day = { date: '2026-01-07', text: '', categories: [{ name: 'Tags', values: ['day trip', '2026'] }], source: '2026-01.txt' };
		expect(noteText(day, [{ category: 'Tags', property: 'tags' }]).body).toContain('tags:\n  - day-trip\n  - _2026');
	});
	it('Sponsors config matches the reference', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
	});
});
