import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { MAX_MEMBERS, MAX_ZIP, readBackup, validateMembers } from '../src/archive';

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const firstMember = (bytes: Uint8Array) => {
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let i = 0; i < bytes.length - 46; i++) if (v.getUint32(i, true) === 0x02014b50) return { v, i };
	throw new Error('no member');
};

describe('local ZIP backup', () => {
	it('reads the two-day fixture with category and Unicode text', () => {
		const b = readBackup(fixture('rednotebook-two-days.zip'));
		expect(b.days.map((d) => d.date)).toEqual(['2026-01-01', '2026-01-02']);
		expect(b.days[0]!.categories).toEqual([{ name: 'Places', values: ['Paris'] }]);
		expect(b.days[1]!.text).toBe('日本語 😀');
		expect(b.sources.map((s) => s.month)).toEqual(['2026-01']);
	});
	it('rejects day 32 and a python object tag before any write', () => {
		expect(() => readBackup(fixture('invalid-day.zip'))).toThrow('Invalid day 32');
		expect(() => readBackup(fixture('python-object.zip'))).toThrow('python/object/apply');
	});
	it('rejects parent steps and absolute paths before expansion', () => {
		for (const name of ['../escape.txt', '/escape.txt', 'data/../../escape.txt', 'data\\escape.txt']) {
			expect(() => readBackup(zipSync({ '2026-01.txt': strToU8('1: {text: A}\n'), [name]: new Uint8Array([1]) }))).toThrow('unsafe path');
		}
	});
	it('rejects a declared expansion above 100 MiB', () => {
		const bytes = zipSync({ '2026-01.txt': strToU8('1: {text: A}\n') });
		const { v, i } = firstMember(bytes);
		v.setUint32(i + 24, 101 * 1024 * 1024, true);
		expect(() => readBackup(bytes)).toThrow('100 MiB');
	});
	it('rejects a ZIP above 20 MiB', () => { expect(() => readBackup(new Uint8Array(MAX_ZIP + 1))).toThrow('20 MiB'); });
	it('rejects more than 5000 members and duplicate member names', () => {
		expect(() => validateMembers(Array.from({ length: MAX_MEMBERS + 1 }, (_, i) => ({ name: `${i}.txt`, size: 0 })))).toThrow('5000');
		expect(() => validateMembers([{ name: '2026-01.txt', size: 1 }, { name: '2026-01.txt', size: 1 }])).toThrow('duplicate name');
	});
	it('rejects split archive fields in the directory and in a member', () => {
		for (const field of [4, 6]) {
			const bytes = fixture('rednotebook-two-days.zip');
			new DataView(bytes.buffer).setUint16(bytes.length - 22 + field, 1, true);
			expect(() => readBackup(bytes)).toThrow('Split ZIP');
		}
		const bytes = fixture('rednotebook-two-days.zip');
		const { v, i } = firstMember(bytes);
		v.setUint16(i + 34, 1, true);
		expect(() => readBackup(bytes)).toThrow('Split ZIP');
	});
	it('rejects ZIP64 fields and a ZIP64 locator before expansion', () => {
		for (const field of [20, 24, 42]) {
			const bytes = fixture('rednotebook-two-days.zip');
			const { v, i } = firstMember(bytes);
			v.setUint32(i + field, 0xffffffff, true);
			expect(() => readBackup(bytes)).toThrow('ZIP64');
		}
		for (const field of [8, 10, 12, 16]) {
			const bytes = fixture('rednotebook-two-days.zip');
			const v = new DataView(bytes.buffer);
			if (field < 12) v.setUint16(bytes.length - 22 + field, 0xffff, true);
			else v.setUint32(bytes.length - 22 + field, 0xffffffff, true);
			expect(() => readBackup(bytes)).toThrow('ZIP64');
		}
		const source = fixture('rednotebook-two-days.zip');
		const end = source.length - 22;
		const bytes = new Uint8Array(source.length + 20);
		bytes.set(source.subarray(0, end));
		new DataView(bytes.buffer).setUint32(end, 0x07064b50, true);
		bytes.set(source.subarray(end), end + 20);
		expect(() => readBackup(bytes)).toThrow('ZIP64');
	});
	it('rejects random bytes, encryption flags and checksum errors', () => {
		expect(() => readBackup(new Uint8Array([1, 2, 3]))).toThrow('Cannot read');
		const enc = fixture('rednotebook-two-days.zip'); const a = firstMember(enc); a.v.setUint16(a.i + 8, a.v.getUint16(a.i + 8, true) | 1, true);
		expect(() => readBackup(enc)).toThrow('Encrypted');
		const bad = fixture('rednotebook-two-days.zip'); const b = firstMember(bad); b.v.setUint32(b.i + 16, 0, true);
		expect(() => readBackup(bad)).toThrow('checksum');
	});
	it('rejects text that is not UTF-8 and a ZIP with no month files', () => {
		expect(() => readBackup(zipSync({ '2026-01.txt': new Uint8Array([0x31, 0x3a, 0x20, 0xff, 0xfe]) }))).toThrow('not UTF-8');
		expect(() => readBackup(zipSync({ 'notes.txt': strToU8('x') }))).toThrow('no RedNotebook month files');
	});
	it('reads month files inside a data folder and keeps the byte order mark out of the YAML', () => {
		const b = readBackup(zipSync({ 'data/2026-04.txt': strToU8('﻿4: {text: April}\n') }));
		expect(b.days[0]).toMatchObject({ date: '2026-04-04', text: 'April', source: 'data/2026-04.txt' });
	});
});
