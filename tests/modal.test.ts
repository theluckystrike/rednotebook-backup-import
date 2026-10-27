import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import RednotebookBackupImportPlugin from '../src/main';
import { readBackup } from '../src/archive';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

const fixture = () => readBackup(new Uint8Array(readFileSync('tests/fixtures/rednotebook-two-days.zip')));
// The mock closes a modal on a timer. Use the app's open behavior for these checks.
beforeEach(() => {
	vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) { void this.onOpen(); });
});
afterEach(() => { resetPro(); vi.restoreAllMocks(); });

describe('import window', () => {
	it('shows the preview counts and keeps Save rules enabled without Pro', async () => {
		const app = App.createConfigured__({ files: { 'RedNotebook/2026-01-01.md': 'Keep' } });
		const plugin = new RednotebookBackupImportPlugin(app as never, manifest as never);
		const modal = plugin.openImport(fixture());
		await expect.poll(() => modal.contentEl.querySelector('.rednotebook-counts')?.textContent).toBe('2 dates · 1 existing notes · 0 conflicts · 1 markup reports');
		const save = Array.from(modal.contentEl.querySelectorAll('button')).find((b) => b.textContent === 'Save rules');
		// Free users can select Save rules: the select shows the Pro notice (tests/pro-notice.test.ts).
		expect(save?.disabled).toBe(false);
		modal.close();
	});
	it('enables the rule field and save button with Pro', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const app = App.createConfigured__({});
		const plugin = new RednotebookBackupImportPlugin(app as never, manifest as never);
		const modal = plugin.openImport(fixture());
		await expect.poll(() => Array.from(modal.contentEl.querySelectorAll('button')).find((b) => b.textContent === 'Save rules')?.disabled).toBe(false);
		expect(modal.contentEl.querySelector('.rednotebook-rules')?.textContent).toContain('Places');
		modal.close();
	});
});
