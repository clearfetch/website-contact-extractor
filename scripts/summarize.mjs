import { readFileSync, readdirSync, existsSync } from 'node:fs';
const dir = 'storage/datasets/default';
const items = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${dir}/${f}`))) : [];
const ok = items.filter((i) => i.ok);
const bad = items.filter((i) => !i.ok);
const tally = (fn) => { const t = {}; for (const i of ok) { const k = fn(i) ?? '-'; t[k] = (t[k] ?? 0) + 1; } return t; };
console.log(`items: ${items.length} (ok ${ok.length}, failed ${bad.length})`);
for (const i of ok) {
    console.log(`  ${(i.company ?? '-').slice(0, 26).padEnd(26)} ${(i.primaryEmail ?? '-').padEnd(30)} ${(i.primaryPhone ?? '-').padEnd(17)} e${i.counts.emails} p${i.counts.phones} s${i.counts.socials} a${i.counts.addresses}  ${i.pagesCrawled.length} page(s)  ${i.url}`);
}
for (const b of bad) console.log(`FAILED: ${b.matchId ?? 'day ' + b.dayOffset} -> ${b.error}`);
const cdir = 'storage/datasets/charging_log';
const charges = existsSync(cdir) ? readdirSync(cdir).filter((f) => f.endsWith('.json')) : [];
const byEvent = {};
for (const f of charges) { const e = JSON.parse(readFileSync(`${cdir}/${f}`)).eventName; byEvent[e] = (byEvent[e] ?? 0) + 1; }
console.log('charged   :', charges.length, byEvent);
if (charges.length !== ok.length) console.log(`!! charge/item mismatch: ${charges.length} charges for ${ok.length} good items`);
