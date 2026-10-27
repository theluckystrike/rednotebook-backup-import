import { browser, expect } from '@wdio/globals';
import { resolve } from 'node:path';
import type RednotebookBackupImportPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';
import { pluginId } from './load';

// A free user can select the Pro controls of the import window. The select shows the shared Pro notice with the
// "Sponsor on GitHub" button. The merge toggle shows off again and no rule is saved. A Pro user turns the toggle on.
type Host = { plugins: { plugins: Record<string, RednotebookBackupImportPlugin> } };
const RULES = 'Saved category mapping rules need Pro.';
const MERGE = 'Merging into existing notes needs Pro.';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Host).plugins.plugins['rednotebook-backup-import']!;
		const pro = p.pro as SponsorsManager;
		if (!enabled) { pro.signOut(); return pro.isPro(); }
		// Synthetic token store and HTTP answer. No network request or Keychain key.
		let token: string | null = 'gho_' + '0'.repeat(36);
		pro.opts.tokens.get = () => token; pro.opts.tokens.set = (v) => { token = v; }; pro.opts.tokens.clear = () => { token = null; };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader', totalSponsorshipAmountAsSponsorInCents: 1500 }, user: { viewerIsSponsoring: true, sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		await pro.refreshNow();
		return pro.isPro();
	}, on);
}

async function openWindow(): Promise<void> {
	await browser.executeObsidian(() => { activeDocument.querySelectorAll('.notice').forEach((n) => n.remove()); });
	await browser.executeObsidianCommand(`${pluginId}:import-backup`);
	await browser.$('input[type="file"]').setValue(resolve('tests/fixtures/rednotebook-two-days.zip'));
	await browser.waitUntil(async () => (await browser.$('.rednotebook-status').getText()).includes('Preview ready'), { timeout: 20000, timeoutMsg: 'Import preview did not finish' });
}

/** Selects the toggle of the row with this name and then the button, and returns the toggle state, the notices and the settings. */
async function select(name: string | null, button: string | null) {
	return browser.executeObsidian(async ({ app }, name, button) => {
		const root = activeDocument.querySelector('.rednotebook-import-modal')!;
		const row = (n: string) => [...root.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === n);
		if (name) (row(name)?.querySelector('.checkbox-container') as HTMLElement | null)?.click();
		if (button) [...root.querySelectorAll('button')].find((b) => b.textContent === button)?.click();
		await new Promise((r) => setTimeout(r, 300));
		const p = (app as unknown as Host).plugins.plugins['rednotebook-backup-import']!;
		return {
			on: name ? row(name)?.querySelector('.checkbox-container')?.classList.contains('is-enabled') ?? null : null,
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			settings: JSON.stringify(p.settings),
			saved: JSON.stringify((await p.loadData()) ?? {}),
		};
	}, name, button);
}

describe('Pro controls of the import window', function () {
	afterEach(async () => {
		await browser.executeObsidian(({ app }) => { (app as unknown as Host).plugins.plugins['rednotebook-backup-import']!.closeImportWindows(); });
		await setPro(false);
	});

	it('a free user who selects Merge selected dates or Save rules gets the Pro notice with a Sponsor button, the toggle shows off and nothing is saved', async () => {
		expect(await setPro(false)).toBe(false);
		await openWindow();
		const before = await select(null, null);
		const after = await select('Merge selected dates', 'Save rules');
		for (const lead of [MERGE, RULES]) {
			if (!after.notices.some((n) => n.text.includes(lead) && n.sponsor === 1)) throw new Error(`No Pro notice with "${lead}": ${JSON.stringify(after.notices)}`);
		}
		expect(after.on).toBe(false);
		expect(after.settings).toBe(before.settings);
		expect(after.saved).toBe(before.saved);
	});

	it('a Pro user who selects Merge selected dates turns it on', async () => {
		expect(await setPro(true)).toBe(true);
		await openWindow();
		const after = await select('Merge selected dates', null);
		expect(after.on).toBe(true);
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
