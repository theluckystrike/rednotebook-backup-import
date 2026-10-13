// Basic txt2tags to Markdown. Headings, bold, italic and links change. Other markup stays as text and gets a report line.

export interface Converted { markdown: string; reports: string[]; images: string[] }

const IMAGE = /\[((?:""[^"\]]+"")|[^\s[\]"]+)\.(png|jpe?g|gif|bmp|svg|webp|tiff?)\]/gi;
const LINK = /\[([^[\]]*?\S)\s+(""[^"\]]+""|[^\s[\]]+)\]/g;
const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>[\]]+/gi;
const TOKEN = /\uE000(\d+)\uE001/g;

function linkTarget(raw: string): string | null {
	const target = raw.startsWith('""') && raw.endsWith('""') ? raw.slice(2, -2) : raw;
	if (/^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|www\.)/i.test(target)) return /^www\./i.test(target) ? `https://${target}` : target;
	return null;
}
function imagePath(base: string, ext: string): string {
	const path = (base.startsWith('""') && base.endsWith('""') ? base.slice(2, -2) : base) + '.' + ext;
	return path.replace(/^file:\/\//i, '');
}

/** Converts one line of inline markup. Links and URLs are protected first, so "//" inside a URL is not italic. */
function inline(line: string, reports: Set<string>, images: string[]): string {
	const saved: string[] = [];
	const keep = (text: string) => `\uE000${saved.push(text) - 1}\uE001`;
	let s = line.replace(/[\uE000\uE001]/g, '');
	s = s.replace(IMAGE, (all: string, base: string, ext: string) => {
		const path = imagePath(base, ext);
		images.push(path);
		reports.add(`Image not copied: ${path}`);
		return keep(all);
	});
	s = s.replace(LINK, (all: string, label: string, raw: string) => {
		const target = linkTarget(raw);
		if (!target) return all;
		const safe = /[\s()<>]/.test(target) ? `<${target}>` : target;
		return keep(`[${label.trim().replace(/[[\]]/g, '\\$&')}](${safe})`);
	});
	s = s.replace(URL, (url) => keep(url));
	s = s.replace(/\*\*(\S(?:.*?\S)?)\*\*/g, '**$1**');
	s = s.replace(/\/\/(\S(?:.*?\S)?)\/\//g, '*$1*');
	if (/__\S(?:.*?\S)?__/.test(s)) reports.add('Underline markup kept as text');
	if (/--\S(?:.*?\S)?--/.test(s)) reports.add('Strikethrough markup kept as text');
	if (/``\S(?:.*?\S)?``/.test(s)) reports.add('Monospace markup kept as text');
	if (/""\S(?:.*?\S)?""/.test(s)) reports.add('Raw text markup kept as text');
	if (/''\S(?:.*?\S)?''/.test(s)) reports.add('Tagged markup kept as text');
	return s.replace(TOKEN, (_all, i: string) => saved[Number(i)] ?? '');
}

/** Converts RedNotebook day text. The result keeps the line structure of the source. Shift moves headings down, up to level 6. */
export function convertTxt2tags(text: string, shift = 0): Converted {
	const reports = new Set<string>();
	const images: string[] = [];
	const out: string[] = [];
	let block: string | null = null;
	for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
		if (block) {
			out.push(line);
			if (line.trim() === block) block = null;
			continue;
		}
		const trimmed = line.trim();
		if (trimmed === '```' || trimmed === '""""' || trimmed === "''") {
			block = trimmed;
			reports.add(trimmed === '```' ? 'Verbatim block kept as text' : 'Raw or tagged block kept as text');
			out.push(line);
			continue;
		}
		const heading = /^\s*(={1,5}|\+{1,5})(?!=|\+)\s*(\S.*?)\s*\1(?:\[[\w-]*\])?\s*$/.exec(line);
		if (heading?.[1] && heading[2] && !/[=+]$/.test(heading[2])) {
			if (heading[1].startsWith('+')) reports.add('Numbered heading converted without its number');
			out.push(`${'#'.repeat(Math.min(6, heading[1].length + shift))} ${inline(heading[2], reports, images)}`);
			continue;
		}
		if (/^%/.test(line)) { reports.add('Comment line kept as text'); out.push(line); continue; }
		if (/^\s*\|/.test(line)) { reports.add('Table line kept as text'); out.push(line); continue; }
		if (/^\s*[-=_]{20,}\s*$/.test(line)) { reports.add('Separator line kept as text'); out.push(line); continue; }
		if (/^\s*[-+:]\s+\S/.test(line)) reports.add('List line kept as text');
		out.push(inline(line, reports, images));
	}
	if (block) reports.add('Unclosed block kept as text');
	return { markdown: out.join('\n').trim(), reports: [...reports].sort(), images };
}
