import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from 'obsidian';
import { App, Notice, ToggleComponent } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import RednotebookBackupImportPlugin from '../src/main';
import { readBackup } from '../src/archive';
import type { ImportModal } from '../src/modal';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select the Pro controls of the import window. The select shows the shared Pro notice with the
// "Sponsor on GitHub" button. No rule is saved, and each merge toggle shows off again.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const RULES = 'Saved category mapping rules need Pro.';
const MERGE = 'Merging into existing notes needs Pro.';
const fixture = () => readBackup(new Uint8Array(readFileSync('tests/fixtures/rednotebook-two-days.zip')));

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'rednotebook-backup-import' },
	} as unknown as SponsorsManager;
}

const toggles: ToggleComponent[] = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: { 'RedNotebook/2026-01-01.md': 'Keep' } });
	const plugin = new RednotebookBackupImportPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	plugin.saveSettings = vi.fn(async () => undefined);
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	vi.spyOn(ToggleComponent.prototype, 'constructor3__').mockImplementation(function (this: ToggleComponent) { toggles.push(this); });
	const modal = plugin.openImport(fixture());
	await expect.poll(() => modal.contentEl.querySelector('.rednotebook-counts')?.textContent).toContain('1 existing notes');
	await expect.poll(() => button(modal, 'Save rules')?.disabled).toBe(false);
	return { plugin, modal, shown };
}

function toggle(modal: ImportModal, name: string): ToggleComponent {
	const t = toggles.find((c) => modal.contentEl.contains(c.toggleEl) && c.toggleEl.closest('.setting-item')?.querySelector('.setting-item-name')?.textContent === name);
	if (!t) throw new Error(`No toggle in the row "${name}".`);
	return t;
}
const isOn = (t: ToggleComponent) => t.getValue() && t.toggleEl.classList.contains('is-enabled');
const button = (modal: ImportModal, text: string) => [...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === text);

beforeEach(() => {
	// The mock closes a modal on a timer. Use the app's open behavior for these checks.
	vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) { void this.onOpen(); });
});

describe('Pro controls of the import window', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); toggles.length = 0; });

	it('a free user who selects Save rules or a merge toggle gets the Pro notice with a Sponsor button, and nothing changes or saves', async () => {
		const { plugin, modal, shown } = await setup(false);
		const saveRules = vi.spyOn(plugin, 'saveRules');
		const before = JSON.stringify(plugin.settings);
		for (const name of ['Merge selected dates', '2026-01-01']) {
			const t = toggle(modal, name);
			expect(t.disabled).toBe(false);
			t.onClick();
			expect(isOn(toggle(modal, name))).toBe(false);
		}
		button(modal, 'Save rules')!.click();
		await flush();
		expect(shown).toEqual([
			{ text: `${MERGE} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${MERGE} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${RULES} ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		expect(saveRules).not.toHaveBeenCalled();
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(JSON.stringify(plugin.settings)).toBe(before);
		expect(button(modal, 'Create notes')?.disabled).toBe(false);
		modal.close();
	});

	it('a Pro user who selects the merge toggles and Save rules turns them on and saves the rules', async () => {
		const { plugin, modal, shown } = await setup(true);
		for (const name of ['Merge selected dates', '2026-01-01']) {
			toggle(modal, name).onClick();
			expect(isOn(toggle(modal, name))).toBe(true);
		}
		button(modal, 'Save rules')!.click();
		await vi.waitFor(() => { expect(plugin.saveSettings).toHaveBeenCalled(); });
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
		modal.close();
	});
});
