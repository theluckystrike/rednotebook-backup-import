import { normalizePath, stringifyYaml } from 'obsidian';
import type { Day } from './month';
import { convertTxt2tags } from './txt2tags';

export interface Rule { category: string; property: string }
const RESERVED = ['rednotebook_date', 'rednotebook_source', 'rednotebook_categories', '__proto__', 'constructor', 'prototype'];

export function validProperty(key: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(key) && !RESERVED.includes(key);
}
/** Keeps rules with a category and a valid property. Throws for a reserved or invalid property name. */
export function validateRules(rules: Rule[]): Rule[] {
	const clean: Rule[] = [];
	const seen = new Set<string>();
	for (const rule of rules) {
		const category = rule.category.trim();
		const property = rule.property.trim();
		if (!category || !property) continue;
		if (!validProperty(property)) throw new Error(`Property "${property}" is not valid. Start with a letter. Source properties are reserved.`);
		if (seen.has(category)) continue;
		seen.add(category);
		clean.push({ category: category.slice(0, 100), property });
	}
	return clean.slice(0, 50);
}
export function safeFolder(value: string): string {
	const raw = value.trim();
	if (!raw || raw.startsWith('/') || /[\\:*?"<>|]/.test(raw) || Array.from(raw).some((c) => c.charCodeAt(0) < 32)) throw new Error('Use a relative vault folder path.');
	const path = normalizePath(raw);
	if (!path || path === '/' || path.split('/').some((part) => part === '.' || part === '..' || part.startsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(part))) throw new Error('Use a relative vault folder path without hidden folders or parent steps.');
	return path;
}
export function notePath(date: string, folder: string): string {
	return normalizePath(`${folder}/${date}.md`);
}
export function sourcePath(month: string, folder: string): string {
	return normalizePath(`${folder}/RedNotebook source/${month}.txt`);
}
export function tagName(value: string): string {
	const tag = value.trim().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_/-]/gu, '');
	return /^\d+$/.test(tag) ? `_${tag}` : tag;
}

export interface DayOutput { body: string; reports: string[]; images: string[] }

/** Converted text and the category list. Category names and values stay as in the source. */
export function dayBody(day: Day, shift = 0, categoriesLevel = 2): DayOutput {
	const converted = convertTxt2tags(day.text, shift);
	const lines = day.categories.map((c) => `- ${c.name}${c.values.length ? `: ${c.values.join(', ')}` : ''}`);
	const parts = [converted.markdown, lines.length ? `${'#'.repeat(categoriesLevel)} Categories\n\n${lines.join('\n')}` : ''].filter((p) => p.length > 0);
	return { body: parts.join('\n\n'), reports: converted.reports, images: converted.images };
}

/** The full note. Rules (Pro) copy category values into named properties. */
export function noteText(day: Day, rules: Rule[] = []): DayOutput {
	const output = dayBody(day);
	const props: Record<string, unknown> = { rednotebook_date: day.date, rednotebook_source: day.source };
	if (day.categories.length) props.rednotebook_categories = day.categories.map((c) => c.name);
	for (const rule of rules) {
		const category = day.categories.find((c) => c.name === rule.category);
		if (!category?.values.length) continue;
		const values = rule.property === 'tags' ? category.values.map(tagName).filter((t) => t.length > 0) : category.values;
		const old = Array.isArray(props[rule.property]) ? props[rule.property] as string[] : [];
		props[rule.property] = [...new Set([...old, ...values])];
	}
	const missing = output.images.length ? `\n\n> [!note] RedNotebook import\n> ${output.images.length} image path(s) were kept as text. The image files were not copied.` : '';
	return { ...output, body: `---\n${stringifyYaml(props).trimEnd()}\n---\n\n${output.body}${missing}\n` };
}

export function hasSection(text: string, section: string): boolean {
	return text.split(/\r?\n/).some((line) => line.trim() === `## ${section}`);
}
/** The block that Pro adds to the end of an existing daily note. Day headings move down two levels, so they stay inside the section. */
export function mergeBlock(day: Day, section: string): string {
	return `## ${section}\n\n${dayBody(day, 2, 3).body}\n`;
}
export function validSection(section: string): boolean {
	return /^\S(?:.{0,58}\S)?$/.test(section) && !/[#\n\r]/.test(section);
}
