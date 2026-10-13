import { TFile, TFolder, normalizePath, type Vault } from 'obsidian';
import type { Backup, SourceFile } from './archive';
import type { Day } from './month';
import { hasSection, mergeBlock, notePath, noteText, safeFolder, sourcePath, validSection, type Rule } from './model';

export interface PlannedDay { day: Day; path: string; exists: boolean }
export interface PlannedSource { source: SourceFile; path: string; exists: boolean }
export interface ImportPlan {
	backup: Backup;
	folder: string;
	days: PlannedDay[];
	sources: PlannedSource[];
	/** Paths that block writes: a file where a folder must be. */
	blocked: string[];
	reports: string[];
}
export interface WriteOptions {
	keepSources: boolean;
	rules: Rule[];
	merge: { section: string; dates: string[] } | null;
	cancelled: () => boolean;
}
export interface ImportResult { created: number; skipped: number; merged: number; sources: number; errors: string[]; skippedPaths: string[]; cancelled: boolean }

export const BATCH = 10;

async function ensureFolder(vault: Vault, folder: string): Promise<void> {
	let current = '';
	for (const part of folder.split('/')) {
		current = normalizePath(current ? `${current}/${part}` : part);
		const found = vault.getAbstractFileByPath(current);
		if (found && !(found instanceof TFolder)) throw new Error(`A file blocks folder ${current}.`);
		if (!found) await vault.createFolder(current);
	}
}
function blockers(vault: Vault, folder: string): string[] {
	const result: string[] = [];
	let current = '';
	for (const part of [...folder.split('/'), 'RedNotebook source']) {
		current = current ? `${current}/${part}` : part;
		const found = vault.getAbstractFileByPath(current);
		if (found && !(found instanceof TFolder)) result.push(current);
	}
	return result;
}

/** Builds the plan without writes. Existing notes are marked and skipped later. */
export function prepareImport(vault: Vault, backup: Backup, folderInput: string): ImportPlan {
	const folder = safeFolder(folderInput);
	const days = backup.days.map((day) => {
		const path = notePath(day.date, folder);
		return { day, path, exists: vault.getAbstractFileByPath(path) !== null };
	});
	const sources = backup.sources.map((source) => {
		const path = sourcePath(source.month, folder);
		return { source, path, exists: vault.getAbstractFileByPath(path) !== null };
	});
	const reports: string[] = [];
	for (const item of days) for (const line of noteText(item.day).reports) reports.push(`${item.day.date}: ${line}`);
	return { backup, folder, days, sources, blocked: blockers(vault, folder), reports };
}

/**
 * Creates new notes in batches. Existing notes are not changed, except a Pro merge of a selected date.
 * The cancel check runs between batches. The result counts the files already written.
 */
export async function writeImport(vault: Vault, plan: ImportPlan, options: WriteOptions): Promise<ImportResult> {
	const result: ImportResult = { created: 0, skipped: 0, merged: 0, sources: 0, errors: [], skippedPaths: [], cancelled: false };
	if (plan.blocked.length) throw new Error(`A file blocks the import folder: ${plan.blocked.join(', ')}.`);
	const merge = options.merge;
	if (merge && !validSection(merge.section)) throw new Error('Enter a section name of 1 to 60 characters without "#".');
	const selected = new Set(merge?.dates ?? []);
	await ensureFolder(vault, plan.folder);
	for (let start = 0; start < plan.days.length; start += BATCH) {
		if (options.cancelled()) { result.cancelled = true; return result; }
		for (const item of plan.days.slice(start, start + BATCH)) {
			try {
				const found = vault.getAbstractFileByPath(item.path);
				if (found) {
					if (merge && selected.has(item.day.date) && found instanceof TFile) {
						let added = false;
						await vault.process(found, (text) => {
							if (hasSection(text, merge.section)) return text;
							added = true;
							return `${text.replace(/\s*$/, '')}\n\n${mergeBlock(item.day, merge.section)}`;
						});
						if (added) { result.merged++; continue; }
						result.errors.push(`${item.path}: The section "${merge.section}" exists. The note was not changed.`);
					}
					result.skipped++;
					result.skippedPaths.push(item.path);
					continue;
				}
				await vault.create(item.path, noteText(item.day, options.rules).body);
				result.created++;
			} catch (e) { result.errors.push(`${item.path}: ${e instanceof Error ? e.message : String(e)}`); }
		}
	}
	if (options.keepSources && !options.cancelled()) {
		for (const item of plan.sources) {
			try {
				if (vault.getAbstractFileByPath(item.path)) { result.skippedPaths.push(item.path); continue; }
				await ensureFolder(vault, item.path.slice(0, item.path.lastIndexOf('/')));
				await vault.create(item.path, item.source.text);
				result.sources++;
			} catch (e) { result.errors.push(`${item.path}: ${e instanceof Error ? e.message : String(e)}`); }
		}
	} else if (options.keepSources) result.cancelled = true;
	return result;
}
