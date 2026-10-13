// Writes the synthetic fixtures. Run: node tests/make-fixtures.mjs (from the product folder).
import { writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';

const mtime = new Date('2026-02-01T00:00:00Z');
const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [strToU8(v), { mtime }]])), { level: 6 });

const twoDays = `1:
  Places: {Paris: null}
  text: '= New year =

    **Bold**, //italic//, and [Example https://example.org].

    [""/home/user/Pictures/fireworks"".jpg]'
2:
  text: !!python/unicode '日本語 😀'
`;
writeFileSync('tests/fixtures/rednotebook-two-days.zip', zip({ '2026-01.txt': twoDays }));
writeFileSync('tests/fixtures/invalid-day.zip', zip({ '2026-01.txt': '32: {text: Late}\n' }));
writeFileSync('tests/fixtures/python-object.zip', zip({ '2026-01.txt': "1: {text: !!python/object/apply:os.system ['echo unsafe']}\n" }));

const january = `1:
  Places: {Paris: null}
  Mood: {Calm: null}
  text: '= New year =

    A slow morning with **coffee** and //rain// on the window.

    Read [The txt2tags guide https://txt2tags.org/userguide/] later.'
2:
  Places: {Lyon: null}
  Tags: {travel: null, family: null}
  text: '== Train to Lyon ==

    日本語 notes from the trip 😀


    - pack the camera

    - buy tickets'
3:
  Todo: {Call the bank: null}
  text: '| Item | Cost |

    | Tea | 4 |'
5:
  Mood: {Tired: null}
  text: 'A photo from the day: [""/home/user/Pictures/lyon"".jpg]'
`;
const february = `1:
  Places: {Paris: null}
  text: !!python/unicode '= February =

    Back home. **Unpacked** everything.'
14:
  Tags: {family: null}
  text: 'Dinner with friends. See [notes https://example.org/menu].'
`;
writeFileSync('docs/sample-notes/Demo backup.zip', zip({ '2026-01.txt': january, '2026-02.txt': february }));
