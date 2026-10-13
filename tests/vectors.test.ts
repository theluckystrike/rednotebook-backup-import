import data from './vectors/rednotebook-backup-import.json';
import { describe, it, expect } from 'vitest';
import { parseMonth } from '../src/month';
import { convertTxt2tags } from '../src/txt2tags';
import { inspectFiles, validateMembers } from '../src/archive';

const vectors = data as { cases: { name: string; function: string; args: unknown[]; expected: unknown }[] };
const functions: Record<string, (...args: never[]) => unknown> = { parseMonth, convertTxt2tags, inspectFiles, validateMembers };

describe('golden acceptance vectors', () => {
	it('has 20 or more cases', () => { expect(vectors.cases.length).toBeGreaterThanOrEqual(20); });
	for (const c of vectors.cases) it(c.name, () => {
		let result: unknown;
		try { result = functions[c.function]!(...c.args as never[]); } catch (e) { result = { error: e instanceof Error ? e.message : String(e) }; }
		expect(result).toEqual(c.expected);
	});
});
