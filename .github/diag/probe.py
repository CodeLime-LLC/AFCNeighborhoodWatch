"""One-off: what is the Polk County Assessor actually publishing right now?"""
import csv, io, re, sys, urllib.request, urllib.parse
from datetime import datetime

csv.field_size_limit(10**9)
HOST = "https://web.assess.co.polk.ia.us"
UA = {"User-Agent": "Mozilla/5.0 (AFCNeighborhoodWatch diagnostic)"}

def get(url, method="GET"):
    req = urllib.request.Request(url, headers=UA, method=method)
    try:
        r = urllib.request.urlopen(req, timeout=120)
        return r.status, dict(r.headers), (r.read() if method == "GET" else b"")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), b""
    except Exception as e:
        return f"ERR {e}", {}, b""

def date(s):
    for f in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S", "%Y%m%d"):
        try: return datetime.strptime(s.strip()[:19], f)
        except Exception: pass
    return None

def profile(url, date_cols, book_col=None):
    st, h, body = get(url)
    print(f"\n### {url}\n  status={st} last-modified={h.get('Last-Modified')} bytes={len(body)}")
    if st != 200: return
    rows = list(csv.DictReader(io.StringIO(body.decode("utf-8", "replace"))))
    print(f"  rows={len(rows)} columns={len(rows[0]) if rows else 0}")
    for c in date_cols:
        ds = sorted(d for d in (date(r.get(c) or "") for r in rows) if d)
        if not ds: print(f"  {c}: no parseable dates"); continue
        tail = [d.date().isoformat() for d in ds[-5:]]
        recent = sum(1 for d in ds if d >= datetime(2026, 8, 1))
        print(f"  {c}: max={ds[-1].date()} newest5={tail} since-Aug1={recent}")
    if book_col:
        bs = sorted(int(r[book_col]) for r in rows if (r.get(book_col) or "").isdigit())
        if bs: print(f"  {book_col}: max={bs[-1]}")
    if rows:
        dated = [c for c in rows[0] if re.search(r"date|transfer|_dt|updat|modif", c, re.I)]
        print(f"  date-like columns: {dated}")

def listing(url, depth=0, seen=set()):
    if url in seen or depth > 5: return
    seen.add(url)
    st, h, body = get(url)
    text = body.decode("utf-8", "replace")
    print(f"\n--- LISTING {url} status={st}")
    if st != 200: return
    # IIS / Apache listings: keep the human-readable lines so dates show
    plain = re.sub(r"<[^>]+>", " ", text)
    plain = re.sub(r"[ \t]+", " ", plain)
    for line in plain.splitlines():
        line = line.strip()
        if line: print("   ", line[:160])
    for href in re.findall(r'href="([^"]+)"', text, re.I):
        nxt = urllib.parse.urljoin(url, href)
        if nxt.startswith(url) and nxt.endswith("/") and nxt != url:
            listing(nxt, depth + 1, seen)

print("=" * 70, "\nKNOWN FILES (HEAD)")
for p in ["/info/web/exports/res/sales/juris/AK/2026.csv",
          "/info/web/exports/res/sales/juris/AK/2025.csv",
          "/info/web/exports/res/inven/juris/AK.csv"]:
    st, h, _ = get(HOST + p, "HEAD")
    print(f"  {p}: {st} lm={h.get('Last-Modified')} len={h.get('Content-Length')}")

print("=" * 70, "\nEXPORTS TREE (every file, newest first)")
entries = []
def walk(url, depth=0):
    if depth > 6: return
    st, h, body = get(url)
    if st != 200:
        print(f"  {url}: {st}"); return
    text = body.decode("utf-8", "replace")
    for m in re.finditer(r'href="([^"?/][^"]*)".*?(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+(\S+)', text, re.I | re.S):
        href, when, size = m.groups()
        nxt = urllib.parse.urljoin(url, href)
        if not nxt.startswith(url): continue
        if href.endswith("/"):
            walk(nxt, depth + 1)
        else:
            entries.append((when, size, nxt[len(HOST):]))
walk(HOST + "/info/web/exports/")
entries.sort(reverse=True)
print(f"  {len(entries)} files")
for when, size, path in entries[:60]:
    print(f"  {when}  {size:>6}  {path}")
# Any file that is NOT one of the familiar per-juris names
odd = [e for e in entries if not re.search(r"/juris/[A-Z]{2}(/\d{4})?\.csv$", e[2])]
print(f"\n  non-standard paths ({len(odd)}):")
for when, size, path in odd[:80]:
    print(f"  {when}  {size:>6}  {path}")
# Newest file per top-level folder
tops = {}
for when, size, path in entries:
    key = "/".join(path.split("/")[:6])
    tops.setdefault(key, (when, path))
print("\n  newest file per folder:")
for k, (when, path) in sorted(tops.items(), key=lambda kv: kv[1][0], reverse=True):
    print(f"  {when}  {path}")
