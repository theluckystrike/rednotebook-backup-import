import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type RednotebookBackupImportPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';
import { pluginId, reloadPlugin } from './load';

const fixture = Array.from(readFileSync('tests/fixtures/rednotebook-two-days.zip'));

async function closeModals(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, RednotebookBackupImportPlugin> } }).plugins.plugins['rednotebook-backup-import']!;
		p.closeImportWindows();
	});
}
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, RednotebookBackupImportPlugin> } }).plugins.plugins['rednotebook-backup-import']!;
		const pro = p.pro as SponsorsManager;
		if (!enabled) { pro.signOut(); return; }
		// Synthetic token store and HTTP answer. No network request or Keychain key.
		let token: string | null = 'gho_' + '0'.repeat(36);
		pro.opts.tokens.get = () => token; pro.opts.tokens.set = (v) => { token = v; }; pro.opts.tokens.clear = () => { token = null; };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader', totalSponsorshipAmountAsSponsorInCents: 1500 }, user: { viewerIsSponsoring: true, sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		await pro.refreshNow();
	}, on);
}

describe('RedNotebook Backup Import in real Obsidian', function () {
	afterEach(async () => { await closeModals(); await setPro(false); });

	it('loads and reloads with no errors', async () => {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('reads the two-day ZIP fixture in the app', async () => {
		const results = await browser.executeObsidian(({ app }, cases) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, RednotebookBackupImportPlugin> } }).plugins.plugins['rednotebook-backup-import']!;
			return cases.map((c) => {
				try { return JSON.stringify(p.readBackup(new Uint8Array(c)).days); } catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : String(e) }); }
			});
		}, [fixture]);
		const days = JSON.parse(results[0]!) as { date: string }[];
		expect(days.map((d) => d.date)).toEqual(['2026-01-01', '2026-01-02']);
	});

	it('selects a local ZIP in the UI and creates two dated notes', async () => {
		await browser.executeObsidian(({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, RednotebookBackupImportPlugin> } }).plugins.plugins['rednotebook-backup-import']!;
			p.settings.folder = 'E2E journal';
			p.settings.keepSources = true;
		});
		await browser.executeObsidianCommand(`${pluginId}:import-backup`);
		await browser.$('input[type="file"]').setValue(resolve('tests/fixtures/rednotebook-two-days.zip'));
		await browser.waitUntil(async () => (await browser.$('.rednotebook-status').getText()).includes('Preview ready'), { timeout: 20000, timeoutMsg: 'Import preview did not finish' });
		expect(await browser.$('.rednotebook-counts').getText()).toContain('2 dates');
		await browser.$('button=Create notes').click();
		await browser.waitUntil(async () => (await browser.$('.rednotebook-status').getText()).includes('2 notes created'), { timeout: 20000, timeoutMsg: 'Import did not finish' });
		const output = await browser.executeObsidian(async ({ app }) => {
			const one = app.vault.getFileByPath('E2E journal/2026-01-01.md')!;
			const two = app.vault.getFileByPath('E2E journal/2026-01-02.md')!;
			const source = app.vault.getFileByPath('E2E journal/RedNotebook source/2026-01.txt');
			return { one: await app.vault.read(one), two: await app.vault.read(two), source: source !== null };
		});
		expect(output.one).toContain('# New year');
		expect(output.one).toContain('[Example](https://example.org)');
		expect(output.one).toContain('- Places: Paris');
		expect(output.two).toContain('日本語 😀');
		expect(output.source).toBe(true);
	});

	it('skips existing notes on a repeat import', async () => {
		const result = await browser.executeObsidian(async ({ app }, bytes) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, RednotebookBackupImportPlugin> } }).plugins.plugins['rednotebook-backup-import']!;
			const backup = p.readBackup(new Uint8Array(bytes));
			await p.importPlan(p.prepare(backup, 'E2E repeat'));
			const one = app.vault.getFileByPath('E2E repeat/2026-01-01.md')!;
			const before = await app.vault.read(one);
			const repeated = await p.importPlan(p.prepare(backup, 'E2E repeat'));
			return { ...repeated, unchanged: await app.vault.read(one) === before };
		}, fixture);
		expect(result.created).toBe(0);
		expect(result.skipped).toBe(2);
		expect(result.unchanged).toBe(true);
	});

	it('saves a category rule in the UI and applies it only with Pro', async () => {
		await setPro(true);
		await browser.executeObsidianCommand(`${pluginId}:import-backup`);
		await browser.$('input[type="file"]').setValue(resolve('tests/fixtures/rednotebook-two-days.zip'));
		await browser.waitUntil(async () => (await browser.$('.rednotebook-status').getText()).includes('Preview ready'), { timeout: 20000 });
		await browser.$('.rednotebook-rules summary').click();
		await browser.$('.rednotebook-rules input[type="text"]').setValue('place');
		await browser.$('button=Save rules').click();
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, RednotebookBackupImportPlugin> } }).plugins.plugins['rednotebook-backup-import']!;
			return p.settings.rules.some((r) => r.category === 'Places' && r.property === 'place');
		}), { timeout: 20000 });
		const output = await browser.executeObsidian(async ({ app }, bytes) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, RednotebookBackupImportPlugin> } }).plugins.plugins['rednotebook-backup-import']!;
			const backup = p.readBackup(new Uint8Array(bytes));
			await p.importPlan(p.prepare(backup, 'E2E rules Pro'), { keepSources: false });
			p.pro!.signOut();
			await p.importPlan(p.prepare(backup, 'E2E rules free'), { keepSources: false });
			return {
				pro: await app.vault.read(app.vault.getFileByPath('E2E rules Pro/2026-01-01.md')!),
				free: await app.vault.read(app.vault.getFileByPath('E2E rules free/2026-01-01.md')!),
			};
		}, fixture);
		expect(output.pro).toContain('place:\n  - Paris');
		expect(output.free).not.toContain('place:');
		expect(output.free).toContain('- Places: Paris');
	});

	it('merges a selected date with Pro and blocks the merge after sign out', async () => {
		await setPro(true);
		const result = await browser.executeObsidian(async ({ app }, bytes) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, RednotebookBackupImportPlugin> } }).plugins.plugins['rednotebook-backup-import']!;
			if (!app.vault.getFolderByPath('E2E daily')) await app.vault.createFolder('E2E daily');
			const file = app.vault.getFileByPath('E2E daily/2026-01-01.md') ?? await app.vault.create('E2E daily/2026-01-01.md', '# My day\n');
			const merge = { section: 'RedNotebook', dates: ['2026-01-01'] };
			const r = await p.importPlan(p.prepare(p.readBackup(new Uint8Array(bytes)), 'E2E daily'), { keepSources: false, merge });
			p.pro!.signOut();
			let blocked = '';
			try { await p.importPlan(p.prepare(p.readBackup(new Uint8Array(bytes)), 'E2E daily'), { merge }); } catch (e) { blocked = e instanceof Error ? e.message : String(e); }
			return { merged: r.merged, text: await app.vault.read(file), blocked };
		}, fixture);
		expect(result.merged).toBe(1);
		expect(result.text).toContain('## RedNotebook');
		expect(result.blocked).toContain('needs Pro');
	});

	it('shows an error for an invalid day and enables no create button', async () => {
		const before = await browser.executeObsidian(({ app }) => app.vault.getFiles().map((f) => f.path).sort());
		await browser.executeObsidianCommand(`${pluginId}:import-backup`);
		await browser.$('input[type="file"]').setValue(resolve('tests/fixtures/invalid-day.zip'));
		await browser.waitUntil(async () => (await browser.$('.rednotebook-status').getText()).includes('Invalid day 32'), { timeout: 20000 });
		expect(await browser.$('button=Create notes').isEnabled()).toBe(false);
		expect(await browser.executeObsidian(({ app }) => app.vault.getFiles().map((f) => f.path).sort())).toEqual(before);
	});
});
