import { Actor, log } from 'apify';
import * as cheerio from 'cheerio';
import { gotScraping } from 'got-scraping';
import { getDomain } from 'tldts';
import {
    countryHint,
    extractAddresses,
    extractCompany,
    extractEmails,
    extractPhones,
    extractSocials,
    findContactLinks,
} from './extract.js';

const EVENT = 'website-processed';
const MAX_HTML = 1_500_000;

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const urls = normalizeUrls(input);
if (!urls.length) {
    await Actor.fail('No websites provided. Pass "urls" (list of domains or URLs), or "url" (single string), or "startUrls".');
}
const maxPagesPerSite = clamp(Number(input.maxPagesPerSite ?? 5), 1, 20);
const maxConcurrency = clamp(Number(input.maxConcurrency ?? 10), 1, 50);
const timeoutMs = clamp(Number(input.timeoutSecs ?? 20), 5, 60) * 1000;
const includeEmails = input.includeEmails !== false;
const includePhones = input.includePhones !== false;
const includeSocials = input.includeSocials !== false;
const includeAddresses = input.includeAddresses !== false;
const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);

log.info(`Extracting contacts from ${urls.length} website(s), up to ${maxPagesPerSite} page(s) each, concurrency ${maxConcurrency}`);

let done = 0;
let charged = 0;
let failed = 0;
let stop = false;

await runPool(urls, maxConcurrency, async (url) => {
    if (stop) return;
    const item = await processSite(url);
    done += 1;
    if (item.ok) {
        const result = await Actor.pushData(item, EVENT);
        charged += 1;
        if (result?.eventChargeLimitReached) {
            stop = true;
            log.warning('The maximum cost set for this run has been reached, stopping.');
        }
    } else {
        failed += 1;
        await Actor.pushData(item);
    }
    if (done % 10 === 0 || done === urls.length) {
        await Actor.setStatusMessage(`${done}/${urls.length} websites, ${charged} with data, ${failed} failed`);
    }
});

log.info(`Finished: ${charged} website(s) processed, ${failed} failed, ${urls.length - done} skipped`);
await Actor.exit();

// ---------------------------------------------------------------------------------------------------------

async function processSite(url) {
    const started = Date.now();
    const pages = [];
    const errors = [];
    try {
        const first = await fetchPage(url);
        pages.push(first);
        if (maxPagesPerSite > 1) {
            const links = findContactLinks(first.$, first.finalUrl, maxPagesPerSite - 1);
            for (const link of links.slice(0, maxPagesPerSite - 1)) {
                try {
                    pages.push(await fetchPage(link.url));
                } catch (err) {
                    errors.push({ url: link.url, error: err.message });
                }
            }
        }
    } catch (err) {
        log.warning(`Failed ${url}: ${err.message}`);
        return {
            url,
            ok: false,
            statusCode: err.statusCode ?? err.response?.statusCode ?? null,
            error: err.message,
            errorCode: err.code ?? null,
            elapsedMs: Date.now() - started,
            scrapedAt: new Date().toISOString(),
        };
    }

    const emails = new Map();
    const phones = new Map();
    const socials = new Map();
    const addresses = [];
    let company = null;

    for (const page of pages) {
        const weight = pageWeight(page.finalUrl);
        if (includeEmails) {
            for (const e of extractEmails(page.$, page.html)) {
                const prev = emails.get(e.email);
                const entry = prev ?? { ...e, sources: [...e.sources], foundOn: [], score: 0 };
                if (!entry.foundOn.includes(page.finalUrl)) entry.foundOn.push(page.finalUrl);
                entry.score = Math.max(entry.score, weight);
                for (const s of e.sources) if (!entry.sources.includes(s)) entry.sources.push(s);
                emails.set(e.email, entry);
            }
        }
        if (includePhones) {
            const hint = countryHint(page.finalUrl, page.$);
            for (const p of extractPhones(page.$, hint)) {
                const prev = phones.get(p.phone);
                const entry = prev ?? { ...p, sources: [...p.sources], foundOn: [], score: 0 };
                if (!entry.foundOn.includes(page.finalUrl)) entry.foundOn.push(page.finalUrl);
                entry.score = Math.max(entry.score, weight);
                for (const s of p.sources) if (!entry.sources.includes(s)) entry.sources.push(s);
                phones.set(p.phone, entry);
            }
        }
        if (includeSocials) for (const s of extractSocials(page.$, page.finalUrl)) if (!socials.has(s.url)) socials.set(s.url, s);
        if (includeAddresses) {
            for (const a of extractAddresses(page.$)) {
                const key = JSON.stringify(a).toLowerCase();
                if (!addresses.some((x) => JSON.stringify(x).toLowerCase() === key)) addresses.push(a);
            }
        }
        if (!company || company.source === 'domain' || company.source === 'title') {
            const found = extractCompany(page.$, page.finalUrl);
            if (found && (!company || rank(found.source) > rank(company.source))) company = found;
        }
    }

    const first = pages[0];
    const sortByScore = (a, b) => b.score - a.score;
    const emailList = [...emails.values()].sort(sortByScore);
    const phoneList = [...phones.values()].sort(sortByScore);
    return {
        url,
        finalUrl: first.finalUrl,
        ok: true,
        statusCode: first.statusCode,
        company: company?.name ?? null,
        companySource: company?.source ?? null,
        emails: emailList.map(({ score, ...rest }) => rest),
        phones: phoneList.map(({ score, ...rest }) => rest),
        socials: [...socials.values()],
        addresses,
        primaryEmail: emailList[0]?.email ?? null,
        primaryPhone: phoneList[0]?.phone ?? null,
        counts: { emails: emailList.length, phones: phoneList.length, socials: socials.size, addresses: addresses.length },
        pagesCrawled: pages.map((p) => p.finalUrl),
        pageErrors: errors.length ? errors : undefined,
        elapsedMs: Date.now() - started,
        scrapedAt: new Date().toISOString(),
    };
}

/** Contact and legal pages are the authoritative source, so their findings outrank the home page's. */
function pageWeight(url) {
    if (/impressum|kontakt|contact|contatti|contacto|mentions|aviso|imprint|legal/i.test(url)) return 3;
    if (/about|team|company|chi-siamo|quienes/i.test(url)) return 2;
    return 1;
}
function rank(source) {
    return { 'json-ld': 3, 'og:site_name': 2, title: 1, domain: 0 }[source] ?? 0;
}

async function fetchPage(url) {
    const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
    const res = await gotScraping({
        url,
        proxyUrl,
        timeout: { request: timeoutMs },
        followRedirect: true,
        maxRedirects: 10,
        throwHttpErrors: false,
        responseType: 'text',
        retry: { limit: 1 },
        headerGeneratorOptions: {
            browsers: [{ name: 'chrome', minVersion: 120 }],
            devices: ['desktop'],
            operatingSystems: ['windows', 'macos'],
        },
    });
    const html = String(res.body ?? '').slice(0, MAX_HTML);
    if (res.statusCode >= 400 && !html) {
        const err = new Error(`HTTP ${res.statusCode}`);
        err.statusCode = res.statusCode;
        throw err;
    }
    return { $: cheerio.load(html), html, finalUrl: res.url || url, statusCode: res.statusCode };
}

function normalizeUrls(inp) {
    const raw = [];
    const push = (v) => {
        if (!v) return;
        if (Array.isArray(v)) return v.forEach(push);
        if (typeof v === 'object') return push(v.url ?? v.domain ?? v.website);
        String(v)
            .split(/[\n\r,;]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((s) => raw.push(s));
    };
    for (const key of ['urls', 'url', 'startUrls', 'domains', 'websites', 'targetUrls']) push(inp[key]);
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
        const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(entry);
        if (scheme && !/^https?$/i.test(scheme[1])) {
            log.warning(`Skipping unsupported scheme "${scheme[1]}:": ${entry}`);
            continue;
        }
        let parsed;
        try {
            parsed = new URL(scheme ? entry : `https://${entry}`);
        } catch {
            log.warning(`Skipping invalid URL: ${entry}`);
            continue;
        }
        if (!parsed.hostname?.includes('.')) {
            log.warning(`Skipping URL without a valid hostname: ${entry}`);
            continue;
        }
        if (!seen.has(parsed.href)) {
            seen.add(parsed.href);
            out.push(parsed.href);
        }
    }
    return out;
}

async function runPool(items, size, worker) {
    let index = 0;
    const next = async () => {
        while (index < items.length) await worker(items[index++]);
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
}

function clamp(n, lo, hi) {
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
