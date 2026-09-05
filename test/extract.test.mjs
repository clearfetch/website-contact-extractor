import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { extractEmails, extractPhones, extractSocials, extractAddresses, extractCompany, findContactLinks, countryHint, deobfuscate } from '../src/extract.js';

const load = (html) => cheerio.load(html);

// --- emails ---------------------------------------------------------------------------------------------
{
    const $ = load(`<html><body>
        <a href="mailto:Hello@Example-Company.de?subject=Hi">write us</a>
        <p>Sales: sales [at] example-company [dot] de</p>
        <p>Support: support&#64;example-company.de</p>
        <span data-email="hidden@example-company.de">obfuscated</span>
        <p>junk: noreply@example-company.de, user@example.com, logo@2x.png, a94f2c1b9d8e4f6a7b3c2d1e5f8a9b0c@sentry.io</p>
        <p>glued to the next word: heretohelp@example-company.comt</p>
    </body></html>`);
    const emails = extractEmails($, '').map((e) => e.email).sort();
    assert.deepEqual(emails, ['hello@example-company.de', 'hidden@example-company.de', 'sales@example-company.de', 'support@example-company.de']);
    console.log('emails:', emails);
    const mailto = extractEmails($, '').find((e) => e.email === 'hello@example-company.de');
    assert.ok(mailto.sources.includes('mailto'), 'source recorded');
}
assert.equal(deobfuscate('info (at) site (dot) com'), 'info@site.com');
{
    // Script contents are JSON blobs, and scanning them produced "u003esales@..." from an escaped \u003e.
    const $ = load(`<html><body><p>real@acme.com</p>
        <script type="application/json">{"help":"\\u003esales@acme.com","tel":"+33 1 00 00 00 00"}</script>
        <style>.x{content:"style@acme.com"}</style></body></html>`);
    const emails = extractEmails($, '').map((e) => e.email);
    assert.deepEqual(emails, ['real@acme.com'], `only visible text is scanned, got ${emails}`);
}
assert.equal(deobfuscate('info [at] site [dot] com'), 'info@site.com');

// --- phones ---------------------------------------------------------------------------------------------
{
    const $ = load(`<html lang="de-DE"><body>
        <a href="tel:+49 30 901820">call</a>
        <p>Fax: 030 901820, Mobile: +44 20 7946 0958</p>
        <p>not a phone: 2024-01-15, price 1234.56, VAT 123456789012</p>
    </body></html>`);
    const phones = extractPhones($, countryHint('https://example.de/', $)).map((p) => p.phone);
    assert.ok(phones.includes('+4930901820'), `german tel link parsed: ${phones}`);
    assert.ok(phones.includes('+442079460958'), 'international number parsed');
    assert.ok(!phones.some((p) => p.includes('123456789012')), `VAT number must not be a phone: ${phones}`);
    assert.ok(!phones.some((p) => p.endsWith('123456')), 'price-like runs rejected');
    // Placeholder dial patterns, as published on some sales pages.
    const $ph = load('<html lang="fr-FR"><body><p>+33 1 00 00 00 00 and +33 5 00 00 00 00 and +33 8 05 11 19 67</p></body></html>');
    const fr = extractPhones($ph, 'FR').map((p) => p.phone);
    assert.deepEqual(fr, ['+33805111967'], `placeholder numbers rejected, got ${fr}`);
    // Fragments that parse as a valid but implausibly short national number are dropped from prose.
    const $short = load('<html lang="de-AT"><body><p>Kundenservice 01 243 und +43 1 5320 1234</p></body></html>');
    const at = extractPhones($short, 'AT').map((p) => p.phone);
    assert.ok(!at.includes('+431243'), `short fragment rejected, got ${at}`);
    console.log('phones:', phones);
}
assert.equal(countryHint('https://example.co.uk/', load('<html></html>')), 'GB');
assert.equal(countryHint('https://example.com/', load('<html lang="fr-FR"></html>')), 'FR');

// --- socials --------------------------------------------------------------------------------------------
{
    const $ = load(`<body>
        <a href="https://www.facebook.com/acmecorp">fb</a>
        <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
        <a href="https://twitter.com/intent/tweet?text=hi">tweet</a>
        <a href="https://x.com/acmecorp">x</a>
        <a href="https://www.linkedin.com/company/acme-corp/">li</a>
        <a href="https://www.linkedin.com/shareArticle?mini=true">share</a>
        <a href="https://instagram.com/acme.corp">ig</a>
        <a href="https://www.instagram.com/p/Cabc123/">post</a>
        <a href="https://youtube.com/@acmecorp">yt</a>
        <a href="https://www.youtube.com/watch?v=123">video</a>
        <a href="https://t.me/acmecorp">tg</a>
    </body>`);
    const socials = extractSocials($, 'https://acme.com/');
    const byPlatform = Object.fromEntries(socials.map((s) => [s.platform, s.url]));
    assert.deepEqual(Object.keys(byPlatform).sort(), ['facebook', 'instagram', 'linkedin', 'telegram', 'x', 'youtube']);
    assert.equal(byPlatform.linkedin, 'https://www.linkedin.com/company/acme-corp');
    assert.equal(socials.find((s) => s.platform === 'linkedin').handle, 'acme-corp');
    console.log('socials:', socials.map((s) => `${s.platform}:${s.handle}`));
}

// --- addresses and company -------------------------------------------------------------------------------
{
    const $ = load(`<html><head>
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme GmbH","address":{"@type":"PostalAddress","streetAddress":"Hauptstr. 1","addressLocality":"Berlin","postalCode":"10115","addressCountry":"DE"}}</script>
        <script type="application/ld+json">{ broken json </script>
        <meta property="og:site_name" content="Acme Site">
        <title>Contact | Acme</title>
        </head><body><address>Hauptstr. 1, 10115 Berlin, Germany</address></body></html>`);
    const addresses = extractAddresses($);
    assert.ok(addresses.some((a) => a.street === 'Hauptstr. 1' && a.postalCode === '10115'), 'json-ld address');
    assert.ok(addresses.some((a) => a.raw?.includes('Hauptstr')), 'address tag');
    assert.equal(extractCompany($, 'https://acme.de/').name, 'Acme GmbH');
    console.log('addresses:', addresses.length, '| company:', extractCompany($, 'https://acme.de/'));
}
{
    // Broken JSON-LD alone must not throw, and the fallbacks must still work.
    const $ = load('<html><head><script type="application/ld+json">{oops</script><title>Foo Ltd</title></head><body></body></html>');
    assert.equal(extractCompany($, 'https://foo.com/').name, 'Foo Ltd');
}

// --- contact link discovery -------------------------------------------------------------------------------
{
    const $ = load(`<body>
        <a href="/impressum">Impressum</a>
        <a href="/about-us/team/history/deep">About deep</a>
        <a href="/contact">Contact us</a>
        <a href="/blog/post-1">A blog post</a>
        <a href="https://other.com/contact">External contact</a>
        <a href="/logo.png">image</a>
    </body>`);
    const links = findContactLinks($, 'https://acme.com/');
    const urls = links.map((l) => l.url);
    assert.ok(urls.includes('https://acme.com/impressum') && urls.includes('https://acme.com/contact'), 'finds contact pages');
    assert.ok(!urls.some((u) => u.includes('other.com')), 'stays on the same registrable domain');
    assert.ok(!urls.some((u) => u.includes('blog')), 'ignores unrelated pages');
    assert.ok(links[0].score >= links[links.length - 1].score, 'sorted by score');
    console.log('contact links:', links.map((l) => `${l.url} (${l.score})`));
}

console.log('ALL EXTRACTION TESTS PASSED');
