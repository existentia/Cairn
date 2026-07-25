# Demo data & screenshots

The screenshots in the main README come from a throwaway Cairn instance seeded
with an invented persona — Alex Morgan, 38, Edinburgh, £72k salary. **None of
those figures are real.** These two scripts regenerate them.

## Why it exists

Screenshots of a personal finance app would otherwise expose real balances, and
once published they're in git history for good. Keeping the demo dataset in the
repo means the images can be regenerated after a UI change without anyone
having to point a camera at their own money.

The persona is deliberately imperfect, so the advisor has something to say:
a credit card at 22.9% APR, a workplace match left 2% short, one child and a
salary inside the HICBC taper, and a variable mortgage above base rate. It
produces 13 insights across every category.

## Regenerating

**1. Run an isolated instance.** `DATA_DIR` keeps the demo database out of your
real one — never seed an instance holding real data, the import is destructive.

```bash
cd backend
DATA_DIR=/tmp/cairn-demo ADMIN_USERNAME=demo ADMIN_PASSWORD=demo \
  FLASK_DEBUG=1 python3 app.py
```

**2. Seed it.**

```bash
python3 docs/demo/seed_demo_data.py --push http://localhost:8000 \
  --username demo --password demo
```

**3. Start the frontend** in another shell (`cd frontend && npm run dev`), then
capture:

```bash
npm i playwright && npx playwright install chromium
node docs/demo/capture_screenshots.js docs/screenshots
```

Output is ten retina PNGs at 1280×820 CSS px, about 2.2 MB total.

## Notes

- `seed_demo_data.py` is stdlib-only and deterministic — the same seed gives the
  same 30-month history every run, so unrelated diffs don't appear in the images.
- Playwright is intentionally *not* a project dependency; install it ad hoc.
- If you add a tool or tab, add a matching `shot()` call in the capture script
  and a row to the screenshot table in the main README.
