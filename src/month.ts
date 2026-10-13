// Safe reader for RedNotebook month files (YAML). No code runs: only plain maps, scalars and one legacy text tag are accepted.
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Node } from 'yaml';

export interface Category { name: string; values: string[] }
export interface Day { date: string; text: string; categories: Category[]; source: string }

const UNICODE_TAG = 'tag:yaml.org,2002:python/unicode';
const ALLOWED_TAGS = new Set([UNICODE_TAG, 'tag:yaml.org,2002:str', 'tag:yaml.org,2002:map', 'tag:yaml.org,2002:null', 'tag:yaml.org,2002:int', 'tag:yaml.org,2002:seq']);
export const MONTH_FILE = /(?:^|\/)(\d{4})-(\d{2})\.txt$/;
export const MAX_MONTH_TEXT = 16 * 1024 * 1024;

/** Returns "YYYY-MM" for a month file name, or null for other files. */
export function monthOf(name: string): string | null {
	const m = MONTH_FILE.exec(name);
	if (!m?.[1] || !m[2]) return null;
	const month = Number(m[2]);
	return month >= 1 && month <= 12 ? `${m[1]}-${m[2]}` : null;
}

function checkTags(node: unknown, file: string): void {
	if (isAlias(node)) throw new Error(`${file}: YAML aliases are not supported.`);
	if (isScalar(node) || isMap(node) || isSeq(node)) {
		const tag = (node as Node).tag;
		if (tag && !ALLOWED_TAGS.has(tag)) throw new Error(`${file}: The YAML tag ${tag} is not allowed.`);
	}
	if (isMap(node)) for (const pair of node.items) { checkTags(pair.key, file); checkTags(pair.value, file); }
	if (isSeq(node)) for (const item of node.items) checkTags(item, file);
}
function text(node: unknown, file: string, what: string): string {
	if (node === null || node === undefined) return '';
	if (!isScalar(node)) throw new Error(`${file}: ${what} must be text.`);
	const value = (node).value;
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return (node).source ?? String(value);
	throw new Error(`${file}: ${what} must be text.`);
}

/** Parses one month file. Invalid YAML, a code tag or an impossible day throws before any write. */
export function parseMonth(file: string, source: string): Day[] {
	const month = monthOf(file);
	if (!month) throw new Error(`${file}: The file name is not a RedNotebook month (YYYY-MM.txt).`);
	if (source.length > MAX_MONTH_TEXT) throw new Error(`${file}: The month file exceeds 16 MiB.`);
	const doc = parseDocument(source.replace(/^\uFEFF/, ''), {
		schema: 'core',
		customTags: [{ tag: UNICODE_TAG, resolve: (value: string) => value }],
		uniqueKeys: true,
		prettyErrors: false,
	});
	const problem = doc.errors[0] ?? doc.warnings[0];
	if (problem) throw new Error(`${file}: Invalid YAML. ${problem.message.split('\n')[0] ?? ''}`.trim());
	checkTags(doc.contents, file);
	if (doc.contents === null || (isScalar(doc.contents) && doc.contents.value === null)) return [];
	if (!isMap(doc.contents)) throw new Error(`${file}: The month file must be a map of day numbers.`);
	const [year, mon] = month.split('-').map(Number) as [number, number];
	const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
	const days: Day[] = [];
	for (const pair of doc.contents.items) {
		const key = isScalar(pair.key) ? pair.key.value : null;
		if (typeof key !== 'number' || !Number.isInteger(key) || key < 1 || key > last) throw new Error(`${file}: Invalid day ${isScalar(pair.key) ? String(pair.key.source ?? pair.key.value) : '?'} for ${month}.`);
		const date = `${month}-${String(key).padStart(2, '0')}`;
		const value = pair.value;
		if (value === null || (isScalar(value) && value.value === null)) { days.push({ date, text: '', categories: [], source: file }); continue; }
		if (!isMap(value)) throw new Error(`${file}: Day ${key} must be a map.`);
		let body = '';
		const categories: Category[] = [];
		for (const item of value.items) {
			const name = text(item.key, file, `A key on day ${key}`);
			if (name === 'text') { body = text(item.value, file, `The text of day ${key}`); continue; }
			const values: string[] = [];
			const entries = item.value;
			if (isMap(entries)) for (const entry of entries.items) values.push(text(entry.key, file, `A ${name} entry`));
			else if (isSeq(entries)) for (const entry of entries.items) values.push(text(entry, file, `A ${name} entry`));
			else { const one = text(entries, file, `A ${name} entry`); if (one) values.push(one); }
			categories.push({ name, values: values.filter((v) => v.length > 0) });
		}
		days.push({ date, text: body, categories, source: file });
	}
	return days.sort((a, b) => a.date.localeCompare(b.date));
}

/** True when a day has text or a category. */
export function hasContent(day: Day): boolean {
	return day.text.trim().length > 0 || day.categories.length > 0;
}
