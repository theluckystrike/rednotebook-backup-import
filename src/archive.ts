// Local ZIP reader. The central directory is checked before expansion, so unsafe names and size bombs stop early.
import { strFromU8, unzipSync } from 'fflate';
import { hasContent, monthOf, parseMonth, type Day } from './month';

export const MAX_ZIP = 20 * 1024 * 1024;
export const MAX_EXPANDED = 100 * 1024 * 1024;
export const MAX_MEMBERS = 5000;

export interface Member { name: string; size: number }
export interface SourceFile { path: string; month: string; text: string }
export interface Backup {
	days: Day[];
	sources: SourceFile[];
	conflicts: string[];
	ignored: string[];
	empty: string[];
}

export function safeArchivePath(name: string): boolean {
	if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || /^[a-z]:/i.test(name)) return false;
	const parts = name.replace(/\/$/, '').split('/');
	return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

/** Checks names and declared sizes. Throws for parent paths, absolute paths, duplicate names and expansion over 100 MiB. */
export function validateMembers(members: Member[]): string {
	if (members.length > MAX_MEMBERS) throw new Error(`The ZIP file has more than ${MAX_MEMBERS} members.`);
	const names = new Set<string>();
	let total = 0;
	for (const member of members) {
		if (!safeArchivePath(member.name)) throw new Error(`The ZIP file has an unsafe path: ${member.name}`);
		if (names.has(member.name)) throw new Error(`The ZIP file has a duplicate name: ${member.name}`);
		names.add(member.name);
		total += member.size;
		if (total > MAX_EXPANDED) throw new Error('The expanded data exceeds 100 MiB.');
	}
	return 'ok';
}

interface Entry extends Member { crc: number }

function directory(bytes: Uint8Array): Entry[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let end = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
		if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
	}
	if (end < 0) throw new Error('ZIP central directory not found.');
	if ((end >= 20 && view.getUint32(end - 20, true) === 0x07064b50)
		|| view.getUint16(end + 8, true) === 0xffff || view.getUint16(end + 10, true) === 0xffff
		|| view.getUint32(end + 12, true) === 0xffffffff || view.getUint32(end + 16, true) === 0xffffffff) {
		throw new Error('ZIP64 files are not supported.');
	}
	if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('Split ZIP files are not supported.');
	const count = view.getUint16(end + 10, true);
	let cursor = view.getUint32(end + 16, true);
	const directoryEnd = cursor + view.getUint32(end + 12, true);
	if (count !== view.getUint16(end + 8, true) || directoryEnd > end) throw new Error('Invalid ZIP directory.');
	const result: Entry[] = [];
	for (let i = 0; i < count; i++) {
		if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid ZIP member.');
		if (view.getUint16(cursor + 8, true) & 1) throw new Error('Encrypted ZIP files are not supported.');
		if (view.getUint16(cursor + 34, true)) throw new Error('Split ZIP files are not supported.');
		const length = view.getUint16(cursor + 28, true);
		const next = cursor + 46 + length + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
		if (next > directoryEnd) throw new Error('Invalid ZIP member length.');
		const size = view.getUint32(cursor + 24, true);
		if (size === 0xffffffff || view.getUint32(cursor + 20, true) === 0xffffffff || view.getUint32(cursor + 42, true) === 0xffffffff) throw new Error('ZIP64 files are not supported.');
		result.push({ name: strFromU8(bytes.subarray(cursor + 46, cursor + 46 + length)), size, crc: view.getUint32(cursor + 16, true) });
		cursor = next;
	}
	if (cursor !== directoryEnd) throw new Error('Invalid ZIP directory size.');
	return result;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
	let value = i;
	for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
	return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 255] ?? 0);
	return (crc ^ 0xffffffff) >>> 0;
}
function sidecar(name: string): boolean {
	return name.startsWith('__MACOSX/') || /(?:^|\/)\._/.test(name);
}

/** Validates every month file before the caller writes. Two files for one month are a conflict: their dates are skipped. */
export function inspectFiles(files: Record<string, string>): Backup {
	const byMonth = new Map<string, string[]>();
	const ignored: string[] = [];
	for (const name of Object.keys(files).sort()) {
		const month = sidecar(name) ? null : monthOf(name);
		if (!month) { if (!name.endsWith('/')) ignored.push(name); continue; }
		byMonth.set(month, [...(byMonth.get(month) ?? []), name]);
	}
	const days: Day[] = [];
	const sources: SourceFile[] = [];
	const conflicts: string[] = [];
	const empty: string[] = [];
	for (const [month, names] of [...byMonth].sort((a, b) => a[0].localeCompare(b[0]))) {
		const parsed = names.map((name) => parseMonth(name, files[name] ?? ''));
		if (names.length > 1) {
			const dates = [...new Set(parsed.flat().map((d) => d.date))].sort();
			conflicts.push(`${month}: ${names.length} source files (${names.join(', ')}) map to the same dates. Skipped dates: ${dates.join(', ') || 'none'}.`);
			continue;
		}
		const name = names[0] ?? '';
		sources.push({ path: name, month, text: files[name] ?? '' });
		for (const day of parsed[0] ?? []) {
			if (hasContent(day)) days.push(day); else empty.push(day.date);
		}
	}
	return { days, sources, conflicts, ignored, empty };
}

/** Reads a local RedNotebook backup ZIP. Throws before any vault write when the file is unsafe or invalid. */
export function readBackup(bytes: Uint8Array): Backup {
	if (bytes.length > MAX_ZIP) throw new Error('The ZIP file exceeds 20 MiB.');
	let index: Entry[];
	let files: Record<string, Uint8Array>;
	try {
		index = directory(bytes);
		validateMembers(index);
		let total = 0;
		files = unzipSync(bytes, { filter: (file) => {
			if (!safeArchivePath(file.name)) throw new Error(`The ZIP file has an unsafe path: ${file.name}`);
			total += file.originalSize;
			if (total > MAX_EXPANDED) throw new Error('The expanded data exceeds 100 MiB.');
			return !sidecar(file.name) && monthOf(file.name) !== null;
		} });
	} catch (e) {
		throw new Error(`Cannot read the ZIP backup. ${e instanceof Error ? e.message : String(e)}`);
	}
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const texts: Record<string, string> = {};
	for (const member of index) {
		const data = files[member.name];
		if (!data) { texts[member.name] = ''; continue; }
		if (data.length !== member.size || crc32(data) !== member.crc) throw new Error(`ZIP checksum failed: ${member.name}.`);
		try { texts[member.name] = decoder.decode(data); } catch { throw new Error(`${member.name}: The file is not UTF-8 text.`); }
	}
	const backup = inspectFiles(texts);
	if (!backup.sources.length && !backup.conflicts.length) throw new Error('The ZIP file has no RedNotebook month files (YYYY-MM.txt).');
	return backup;
}
