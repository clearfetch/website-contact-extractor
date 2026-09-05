/**
 * Pure extraction helpers. No network, no Apify SDK, so every rule here is testable against a fixed HTML string.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { getDomain, parse as parseHost } from 'tldts';

// --- emails ---------------------------------------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;

// Addresses that are technically well-formed but are never a business contact.
const EMAIL_DOMAIN_BLOCKLIST = new Set([
    'example.com', 'example.org', 'example.net', 'domain.com', 'yourdomain.com', 'email.com',
    'sentry.io', 'sentry-cdn.com', 'wixpress.com', 'squarespace.com', 'godaddy.com', 'w3.org',
    'schema.org', 'googlegroups.com', 'name.com', 'test.com', 'mysite.com', 'company.com',
]);
const EMAIL_LOCAL_BLOCKLIST = /^(?:no-?reply|donotreply|do-not-reply|postmaster|abuse|user|username|email|your(?:name|email)|firstname|lastname|name|test|example|sample)$/i;
const ASSET_EXTENSION = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|json|woff2?|ttf|eot|mp4|webm|pdf)$/i;

/** Turns "info [at] example [dot] com" and friends into a plain address. */
export function deobfuscate(text) {
    return String(text)
        .replace(/&#(?:64|x40);/gi, '@')
        .replace(/&#(?:46|x2e);/gi, '.')
        .replace(/\s*[[({<]\s*(?:at|@|arobase)\s*[\])}>]\s*/gi, '@')
        .replace(/\s+(?:at)\s+(?=[A-Za-z0-9.-]+\s*(?:[[(.]\s*dot|\.)\s*)/gi, '@')
        .replace(/\s*[[({<]\s*(?:dot|punkt|punto)\s*[\])}>]\s*/gi, '.')
        .replace(/\s+dot\s+/gi, '.');
}

/**
 * Visible page text. cheerio's .text() includes the contents of script and style tags, which on modern sites
 * are large JSON blobs; scanning those produced artifacts such as "u003esales@stripe.com" from an escaped
 * "\u003e" sitting in front of a real address. Contact details are taken from what a visitor can actually read.
 */
export function visibleText($) {
    const body = $('body').clone();
    body.find('script, style, noscript, template, svg').remove();
    return body.text();
}

export function extractEmails($, html) {
    const found = new Map(); // lowercased address -> { email, sources:Set }
    const add = (raw, source) => {
        if (!raw) return;
        const email = String(raw).trim().replace(/^mailto:/i, '').split('?')[0].trim();
        if (!email || email.length > 254) return;
        const lower = email.toLowerCase();
        if (!EMAIL_RE.test(lower)) {
            EMAIL_RE.lastIndex = 0;
            return;
        }
        EMAIL_RE.lastIndex = 0;
        const [local, domain] = lower.split('@');
        if (!domain || domain.includes('..') || ASSET_EXTENSION.test(lower)) return;
        if (EMAIL_DOMAIN_BLOCKLIST.has(domain) || EMAIL_LOCAL_BLOCKLIST.test(local)) return;
        // tldts happily treats any trailing label as a suffix, so "stripe.comt" would pass a naive check.
        // Requiring an ICANN-recognised public suffix throws out addresses glued to a following word.
        const host = parseHost(domain);
        if (!host.domain || !host.isIcann) return;
        // Hashes in front of a tracking domain: 32+ hex characters is never a person.
        if (/^[0-9a-f]{24,}$/i.test(local)) return;
        const entry = found.get(lower) ?? { email: lower, sources: new Set() };
        entry.sources.add(source);
        found.set(lower, entry);
    };

    $('a[href^="mailto:" i]').each((_, el) => add(el.attribs?.href, 'mailto'));
    const text = deobfuscate(visibleText($) ?? '');
    for (const m of text.matchAll(EMAIL_RE)) add(m[0], 'text');
    // Some sites only put the address in an attribute such as data-email.
    $('[data-email], [data-mail], [data-contact-email]').each((_, el) => {
        const a = el.attribs ?? {};
        add(deobfuscate(a['data-email'] ?? a['data-mail'] ?? a['data-contact-email']), 'attribute');
    });
    return [...found.values()].map((e) => ({ email: e.email, sources: [...e.sources] }));
}

// --- phones ---------------------------------------------------------------------------------------------

const TLD_COUNTRY = {
    uk: 'GB', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', nl: 'NL', be: 'BE', at: 'AT', ch: 'CH', pl: 'PL',
    pt: 'PT', se: 'SE', no: 'NO', dk: 'DK', fi: 'FI', ie: 'IE', cz: 'CZ', sk: 'SK', hu: 'HU', ro: 'RO',
    gr: 'GR', bg: 'BG', hr: 'HR', si: 'SI', lt: 'LT', lv: 'LV', ee: 'EE', us: 'US', ca: 'CA', au: 'AU',
    nz: 'NZ', za: 'ZA', in: 'IN', br: 'BR', mx: 'MX', ar: 'AR', cl: 'CL', jp: 'JP', cn: 'CN', ru: 'RU',
    tr: 'TR', ae: 'AE', sa: 'SA', il: 'IL', ma: 'MA', eg: 'EG', ng: 'NG', ke: 'KE',
};

/** Best guess at the country a page's phone numbers belong to, used only for numbers written without +. */
export function countryHint(url, $) {
    const lang = ($('html').attr('lang') ?? '').trim();
    const region = /[-_]([A-Za-z]{2})$/.exec(lang)?.[1];
    if (region) return region.toUpperCase();
    try {
        const info = parseHost(new URL(url).hostname);
        const tld = info?.publicSuffix?.split('.').pop();
        if (tld && TLD_COUNTRY[tld]) return TLD_COUNTRY[tld];
    } catch {
        /* ignore */
    }
    return undefined;
}

const PHONE_CANDIDATE_RE = /(?:\+|00)?[\d][\d\s().-]{6,20}\d/g;

export function extractPhones($, defaultCountry) {
    const found = new Map();
    const add = (raw, source) => {
        if (!raw) return;
        const cleaned = String(raw).replace(/^tel:/i, '').trim();
        if (!cleaned) return;
        const digits = cleaned.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) return;
        if (/^(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(cleaned.trim())) return;
        // A bare run of digits found in prose is far more often a VAT, registration or order number than a
        // phone number. Text candidates therefore have to look like a written phone number: an international
        // prefix, or at least one separator. Numbers from tel: links are trusted as they are.
        if (source === 'text' && !/^(?:\+|00)/.test(cleaned) && !/[\s().-]/.test(cleaned)) return;
        const parsed = parsePhoneNumberFromString(cleaned, cleaned.startsWith('+') ? undefined : defaultCountry);
        if (!parsed || !parsed.isValid()) return;
        // Placeholder numbers pass validation but are never a real contact: a subscriber part that is all one
        // digit, or a long run of the same digit, is a dial-pattern example rather than someone's number.
        const national = parsed.nationalNumber;
        if (/^(\d)\1+$/.test(national) || /(\d)\1{5,}/.test(national)) return;
        // A number scraped out of prose needs a plausible length. libphonenumber accepts some very short
        // national formats that are real but are never a business contact, and they are usually fragments of a
        // longer string. A tel: link is the site declaring the number itself, so it is trusted as-is.
        if (source === 'text' && national.length < 7) return;
        const e164 = parsed.number;
        const entry = found.get(e164) ?? {
            phone: e164,
            national: parsed.formatNational(),
            country: parsed.country ?? null,
            type: parsed.getType() ?? null,
            sources: new Set(),
        };
        entry.sources.add(source);
        found.set(e164, entry);
    };

    $('a[href^="tel:" i]').each((_, el) => add(el.attribs?.href, 'tel-link'));
    const text = (visibleText($) ?? '').replace(/\s+/g, ' ');
    for (const m of text.matchAll(PHONE_CANDIDATE_RE)) add(m[0], 'text');
    return [...found.values()].map((p) => ({ ...p, sources: [...p.sources] }));
}

// --- social profiles ------------------------------------------------------------------------------------

const SOCIAL_RULES = [
    { platform: 'facebook', host: /(?:^|\.)(?:facebook\.com|fb\.com|fb\.me)$/i, reject: /^\/(?:sharer|share|dialog|plugins|tr|login|help|policies)/i },
    { platform: 'instagram', host: /(?:^|\.)instagram\.com$/i, reject: /^\/(?:p|reel|reels|explore|accounts|stories)(?:\/|$)/i },
    { platform: 'linkedin', host: /(?:^|\.)linkedin\.com$/i, accept: /^\/(?:company|in|school|showcase)\//i },
    { platform: 'x', host: /(?:^|\.)(?:twitter\.com|x\.com)$/i, reject: /^\/(?:intent|share|home|search|hashtag|i)(?:\/|$|\?)/i },
    { platform: 'youtube', host: /(?:^|\.)(?:youtube\.com|youtu\.be)$/i, accept: /^\/(?:@|channel\/|c\/|user\/)/i },
    { platform: 'tiktok', host: /(?:^|\.)tiktok\.com$/i, accept: /^\/@/i },
    { platform: 'github', host: /(?:^|\.)github\.com$/i, reject: /^\/(?:login|signup|features|about|pricing|marketplace|topics|search)(?:\/|$)/i },
    { platform: 'pinterest', host: /(?:^|\.)pinterest\.[a-z.]{2,7}$/i, reject: /^\/(?:pin|search|categories)(?:\/|$)/i },
    { platform: 'threads', host: /(?:^|\.)threads\.(?:net|com)$/i, accept: /^\/@/i },
    { platform: 'telegram', host: /(?:^|\.)(?:t\.me|telegram\.me)$/i, reject: /^\/(?:share|joinchat\/?$)/i },
    { platform: 'whatsapp', host: /(?:^|\.)(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)$/i },
    { platform: 'vimeo', host: /(?:^|\.)vimeo\.com$/i, reject: /^\/(?:\d+$|search|upload)/i },
    { platform: 'reddit', host: /(?:^|\.)reddit\.com$/i, accept: /^\/(?:r|user)\//i },
    { platform: 'discord', host: /(?:^|\.)(?:discord\.gg|discord\.com)$/i, accept: /^\/(?:invite\/|[A-Za-z0-9]+$)/i },
];

export function extractSocials($, baseUrl) {
    const found = new Map();
    $('a[href]').each((_, el) => {
        const href = el.attribs?.href;
        if (!href) return;
        let u;
        try {
            u = new URL(href, baseUrl);
        } catch {
            return;
        }
        if (!/^https?:$/.test(u.protocol)) return;
        const host = u.hostname.replace(/^www\./i, '');
        for (const rule of SOCIAL_RULES) {
            if (!rule.host.test(host)) continue;
            const path = u.pathname;
            if (path === '/' || path === '') return;
            if (rule.reject && rule.reject.test(path)) return;
            if (rule.accept && !rule.accept.test(path)) return;
            const clean = `${u.origin}${u.pathname}`.replace(/\/$/, '');
            const handle = path.replace(/^\/(?:company|in|school|showcase|channel|c|user|r|invite)\//i, '/').replace(/^\/+/, '').replace(/\/.*$/, '');
            if (!found.has(clean)) found.set(clean, { platform: rule.platform, url: clean, handle: handle || null });
            return;
        }
    });
    return [...found.values()];
}

// --- addresses and company ------------------------------------------------------------------------------

function jsonLdObjects($) {
    const out = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text();
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            const walk = (node) => {
                if (!node || typeof node !== 'object') return;
                if (Array.isArray(node)) return node.forEach(walk);
                out.push(node);
                for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
            };
            walk(parsed);
        } catch {
            /* a broken JSON-LD block should never fail the page */
        }
    });
    return out;
}

export function extractAddresses($) {
    const found = new Map();
    const push = (address, source) => {
        const key = JSON.stringify(address).toLowerCase();
        if (!found.has(key)) found.set(key, { ...address, source });
    };
    for (const node of jsonLdObjects($)) {
        const a = node.address && typeof node.address === 'object' && !Array.isArray(node.address) ? node.address : node;
        if (a['@type'] !== 'PostalAddress' && !a.streetAddress) continue;
        const address = {
            street: a.streetAddress ?? null,
            locality: a.addressLocality ?? null,
            region: a.addressRegion ?? null,
            postalCode: a.postalCode ?? null,
            country: a.addressCountry?.name ?? (typeof a.addressCountry === 'string' ? a.addressCountry : null),
            raw: null,
        };
        if (Object.values(address).some(Boolean)) push(address, 'json-ld');
    }
    $('address').each((_, el) => {
        const raw = $(el).text().replace(/\s+/g, ' ').trim();
        if (raw && raw.length > 8 && raw.length < 300) {
            push({ street: null, locality: null, region: null, postalCode: null, country: null, raw }, 'address-tag');
        }
    });
    return [...found.values()];
}

export function extractCompany($, url) {
    for (const node of jsonLdObjects($)) {
        const type = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
        if (type.some((t) => typeof t === 'string' && /Organization|LocalBusiness|Corporation|Store|Restaurant/i.test(t)) && typeof node.name === 'string') {
            return { name: node.name.trim(), source: 'json-ld' };
        }
    }
    const og = $('meta[property="og:site_name"]').attr('content');
    if (og?.trim()) return { name: og.trim(), source: 'og:site_name' };
    const title = $('title').first().text().trim();
    if (title) return { name: title.split(/\s+[|\-–—·]\s+/).pop().trim() || title, source: 'title' };
    try {
        return { name: getDomain(new URL(url).hostname), source: 'domain' };
    } catch {
        return null;
    }
}

// --- internal contact pages -----------------------------------------------------------------------------

const CONTACT_HINT = /(kontakt|contact|impressum|about|ueber-uns|über|team|legal|mentions-legales|aviso-legal|chi-siamo|quienes-somos|contatti|contacto|imprint|company)/i;

/** Ranks internal links by how likely they are to hold contact details. */
export function findContactLinks($, baseUrl, limit = 8) {
    const base = getDomain(new URL(baseUrl).hostname);
    const scored = new Map();
    $('a[href]').each((_, el) => {
        const href = el.attribs?.href;
        if (!href || /^(?:mailto:|tel:|javascript:|#)/i.test(href)) return;
        let u;
        try {
            u = new URL(href, baseUrl);
        } catch {
            return;
        }
        if (!/^https?:$/.test(u.protocol)) return;
        if (getDomain(u.hostname) !== base) return;
        if (ASSET_EXTENSION.test(u.pathname)) return;
        const clean = `${u.origin}${u.pathname}`.replace(/\/$/, '') || u.origin;
        if (clean === baseUrl.replace(/\/$/, '')) return;
        const anchor = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 80);
        const hay = `${u.pathname} ${anchor}`;
        if (!CONTACT_HINT.test(hay)) return;
        // An impressum or contact page beats an about page, and a short path beats a deep one.
        let score = 1;
        if (/impressum|kontakt|contact|contatti|contacto/i.test(hay)) score += 3;
        if (/legal|mentions|aviso|imprint/i.test(hay)) score += 2;
        if (/about|team|chi-siamo|quienes|company/i.test(hay)) score += 1;
        score -= Math.min(2, (u.pathname.match(/\//g)?.length ?? 1) - 1);
        const prev = scored.get(clean);
        if (!prev || prev.score < score) scored.set(clean, { url: clean, score, anchor });
    });
    return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
