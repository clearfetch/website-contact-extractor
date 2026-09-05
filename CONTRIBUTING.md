# Working on this Actor

```bash
npm install
node test/extract.test.mjs                       # unit tests, no network
./scripts/run-test.sh default                    # runs the Actor against real sites, charging simulated
```

`src/extract.js` holds every extraction rule as a pure function, which is why the tests can assert on fixed HTML
without touching the network. `src/main.js` is the Actor shell: fetching, following the site's contact pages,
merging findings and charging.

## The filters are the product

Anyone can write an email regex. What makes the output usable is what it refuses to return, and every filter here
comes from a false positive seen on a real site:

| Seen on | Cause | Rule |
|---|---|---|
| `heretohelp@stripe.comt` | address glued to the following word | require an ICANN-recognised public suffix |
| `+33 1 00 00 00 00` | dial-pattern placeholder on a sales page | reject all-one-digit or six-in-a-row national numbers |
| `+49123456789012` from "VAT 123456789012" | bare digit run in prose | text candidates need a `+`/`00` prefix or a separator |
| `u003esales@stripe.com` | cheerio's `.text()` includes `<script>` contents | scan visible text only |

If you add a rule, add the case that motivated it to `test/extract.test.mjs`. If you remove one, expect the junk
rate to go up.
