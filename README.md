# Website Contact Extractor - Emails, Phones & Social Profiles

Give this Actor a list of websites and it returns the business contact details behind each one: email addresses,
phone numbers normalised to E.164, social profiles, postal addresses and the company name. It does not just read
the page you give it. It finds the site's own contact, imprint, about and team pages and reads those too, which
is where the real address usually lives. No login, no API key and no proxy. **$0.004 per website**, and sites it
cannot reach are free.

## What data you get

- **Emails**, including ones written to defeat scrapers such as `info [at] example [dot] com` or `&#64;`
  entities, with the source recorded (mailto link, page text, data attribute) and the pages each was found on.
- **Phone numbers in E.164** with the country and the line type where the format allows it, so mobile and
  landline are distinguishable. Local formats are resolved using the site's own country.
- **Social profiles** for Facebook, Instagram, LinkedIn, X, YouTube, TikTok, GitHub, Pinterest, Threads,
  Telegram, WhatsApp, Discord, Reddit and Vimeo, with the handle pulled out. Share and intent links are ignored.
- **Postal addresses** from schema.org data, structured into street, locality, region, postcode and country,
  plus raw text from address tags.
- **Company name**, taken from schema.org Organization data, the og:site_name tag, the page title or the domain,
  in that order, with the source recorded so you know how much to trust it.
- **`primaryEmail` and `primaryPhone`**, the single best of each, preferring details found on a contact or
  imprint page over ones in a footer. Handy for a CRM import where one value per company is all you want.

## How to use

1. Paste domains or URLs into **Websites**, one per line. Bare domains are fine.
2. Leave **Pages per website** at 5, or lower it to 1 to read only the exact URL you gave.
3. Run it. Each website is one row, exportable as JSON, CSV or Excel, or readable from the API.

## Input

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `urls` | array | — | Domains or URLs. Also accepts `url` and `startUrls` for compatibility with other Actors. |
| `maxPagesPerSite` | integer | `5` | Pages to read per website: the one you gave, plus its most promising contact, imprint, about and team pages. |
| `includeEmails` | boolean | `true` | Extract email addresses. |
| `includePhones` | boolean | `true` | Extract and normalise phone numbers. |
| `includeSocials` | boolean | `true` | Extract social profile links. |
| `includeAddresses` | boolean | `true` | Extract postal addresses. |
| `maxConcurrency` | integer | `10` | Websites processed in parallel (1-50). |
| `timeoutSecs` | integer | `20` | Per-page timeout. |
| `proxyConfiguration` | object | off | Optional. Not needed for most sites. |

## Output example

One website, trimmed to the first address, three phones and four social profiles:

```json
{
  "url": "https://www.zalando.de/",
  "finalUrl": "https://en.zalando.de/?_rfl=de",
  "ok": true,
  "statusCode": 200,
  "company": "Zalando",
  "companySource": "title",
  "emails": [
    {
      "email": "authorities-dsa@zalando.de",
      "sources": [
        "mailto",
        "text"
      ],
      "foundOn": [
        "https://en.zalando.de/legal-notice"
      ]
    },
    {
      "email": "legalnotice@zalando.de",
      "sources": [
        "text"
      ],
      "foundOn": [
        "https://en.zalando.de/legal-notice"
      ]
    }
  ],
  "phones": [
    {
      "phone": "+447428390555",
      "national": "07428 390555",
      "country": "GB",
      "type": "MOBILE",
      "sources": [
        "text"
      ],
      "foundOn": [
        "https://en.zalando.de/?_rfl=de",
        "https://en.zalando.de/faq",
        "https://en.zalando.de/legal-notice",
        "https://en.zalando.de/faq/what-should-i-know-about-the-newsletter.html"
      ]
    },
    {
      "phone": "+442398169220",
      "national": "023 9816 9220",
      "country": "GB",
      "type": "FIXED_LINE",
      "sources": [
        "text"
      ],
      "foundOn": [
        "https://en.zalando.de/?_rfl=de",
        "https://en.zalando.de/faq",
        "https://en.zalando.de/legal-notice",
        "https://en.zalando.de/faq/what-should-i-know-about-the-newsletter.html"
      ]
    },
    {
      "phone": "+447899149931",
      "national": "07899 149931",
      "country": "GB",
      "type": "MOBILE",
      "sources": [
        "text"
      ],
      "foundOn": [
        "https://en.zalando.de/?_rfl=de",
        "https://en.zalando.de/faq",
        "https://en.zalando.de/legal-notice",
        "https://en.zalando.de/faq/what-should-i-know-about-the-newsletter.html"
      ]
    }
  ],
  "socials": [
    {
      "platform": "facebook",
      "url": "https://www.facebook.com/Zalando",
      "handle": "Zalando"
    },
    {
      "platform": "instagram",
      "url": "https://instagram.com/zalando",
      "handle": "zalando"
    },
    {
      "platform": "pinterest",
      "url": "https://www.pinterest.com/zalando",
      "handle": "zalando"
    },
    {
      "platform": "tiktok",
      "url": "https://www.tiktok.com/@zalando",
      "handle": "@zalando"
    }
  ],
  "addresses": [],
  "primaryEmail": "authorities-dsa@zalando.de",
  "primaryPhone": "+447428390555",
  "counts": {
    "emails": 2,
    "phones": 4,
    "socials": 4,
    "addresses": 0
  },
  "pagesCrawled": [
    "https://en.zalando.de/?_rfl=de",
    "https://en.zalando.de/faq",
    "https://en.zalando.de/legal-notice",
    "https://en.zalando.de/faq/what-should-i-know-about-the-newsletter.html"
  ],
  "elapsedMs": 2596,
  "scrapedAt": "2026-09-05T17:42:04.630Z"
}
```

A website that cannot be reached is reported and costs nothing:

```json
{
  "url": "https://this-domain-does-not-exist-12345.com/",
  "ok": false,
  "statusCode": null,
  "error": "getaddrinfo ENOTFOUND this-domain-does-not-exist-12345.com",
  "errorCode": "ENOTFOUND",
  "elapsedMs": 1122,
  "scrapedAt": "2026-09-05T17:42:03.157Z"
}
```

## Pricing

**$0.004 per website**, whatever number of pages it takes to read. 1,000 websites is $4. Websites that fail are
free. No subscription and no API key; it runs on the Apify free plan.

Paid Apify plans pay less: 10% off on Bronze, 20% on Silver and 30% on Gold and higher tiers.

Apify also charges a run-start fee of $0.00005 per started GB of allocated memory (minimum one event), including runs that produce no chargeable results.

## What it filters out, and why that matters

Contact scrapers are judged on their junk rate, so this one is deliberately strict:

- Emails must sit on a real, ICANN-recognised domain, which throws out addresses glued to the following word
  such as `hello@example.comt`, as well as asset filenames like `logo@2x.png`.
- Placeholder and vendor addresses are dropped: `noreply@`, `user@example.com`, Sentry ingest keys,
  `@wixpress.com`, `@squarespace.com` and similar.
- Numbers found in prose must look like written phone numbers, so VAT, registration and order numbers are not
  reported as contacts.
- Dial-pattern placeholders such as `+33 1 00 00 00 00`, which some sales pages publish, are rejected.
- Social share and intent URLs are not profiles, so `facebook.com/sharer`, `twitter.com/intent` and
  `linkedin.com/shareArticle` never appear.

## Use cases

- **Lead generation**: turn a list of domains from any source into a contact sheet with one email and one phone
  per company.
- **CRM enrichment**: fill in missing contact details for accounts you already have.
- **Sales prospecting**: pull the company's LinkedIn and other profiles alongside the email.
- **Compliance and due diligence**: collect imprint and legal-notice details, which European sites are required
  to publish.
- **Recruiting and partnerships**: find the team or contact page address rather than a generic info@ box.
- **AI agents**: give an assistant a tool that answers "how do I contact this company".

## Integrations

```bash
curl -X POST "https://api.apify.com/v2/acts/clearfetch~website-contact-extractor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["stripe.com", "basecamp.com"], "maxPagesPerSite": 5}'
```

```python
from apify_client import ApifyClient
client = ApifyClient("YOUR_TOKEN")
run = client.actor("clearfetch/website-contact-extractor").call(run_input={"urls": ["stripe.com"]})
for site in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(site["company"], site["primaryEmail"], site["primaryPhone"])
```

Works with the Apify integrations for n8n, Make, Zapier, Google Sheets, Slack and webhooks, with scheduled runs,
and with AI agents through the Apify MCP server.

## FAQ

**Do I need proxies?** No. Pages are fetched with ordinary browser-like requests. A proxy input exists for sites
that block datacenter traffic.

**Why does it read more than one page?** Because home pages rarely carry the real contact details. The Actor
follows the site's own links whose text or path looks like contact, imprint, about, team or legal, ranked so an
imprint or contact page is read before an about page. You are charged once per website regardless.

**Does it execute JavaScript?** No. Details rendered only by client-side JavaScript, such as an email revealed
after a click, will be missed. That keeps runs fast and cheap for the large majority of sites that do not need it.

**Is this legal?** It reads pages exactly as a browser would, with no login. Business contact details published
on a company's own website are public. How you use them is your responsibility: in the EU and UK, sending
marketing email to those addresses is governed by GDPR and the ePrivacy rules, and this Actor is not a
substitute for a lawful basis or for honouring opt-outs.

## More tools from clearfetch

- [Tech Stack Detector](https://apify.com/clearfetch/tech-stack-detector): the CMS, frameworks, analytics and hosting behind any website
- [Document Text Extractor](https://apify.com/clearfetch/document-text-extractor): PDF, DOCX and HTML to clean text and markdown
- [Website Sitemap Extractor](https://apify.com/clearfetch/website-sitemap-extractor): every URL of a website from its sitemaps, from just the domain
- [Broken Link Checker](https://apify.com/clearfetch/broken-link-checker): 404s, redirect chains and soft 404s in bulk
- [ATS Jobs Scraper](https://apify.com/clearfetch/ats-jobs-scraper): every open job from company careers pages on Greenhouse, Lever, Ashby, Workday and more

## Changelog

- **1.0.0** (2026-09) — first release: emails with de-obfuscation, phones in E.164 with line type, social
  profiles with handles, schema.org and text addresses, company name, and automatic discovery of a site's
  contact and imprint pages.
