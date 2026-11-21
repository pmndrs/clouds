#!/usr/bin/env python3
"""P2-1 driver: segment the photo set and our renders, measure, compare.

Usage: run_all.py --repo /path/to/main/checkout --work SCRATCH_DIR [--out work/captures/P2-1]
  --repo  where artifacts/research/cloud-photos and work/captures live (they are
          not in git worktrees)
  --work  where masks and overlays go (regenerable, not committed)
Writes <out>/measures/*.json, <out>/summary.json, <out>/table.md.
Sheets are made by sheets.py.
"""
import argparse
import json
import math
import os
import sys
import time
from multiprocessing import Pool

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import measure as ms  # noqa: E402
import segment as sg  # noqa: E402

PH = "artifacts/research/cloud-photos"
# Daytime cumulus-family photos against clear blue sky, chosen from the 59
# grade A/B ground-view day photos in cumulus-humilis, cumulus-mediocris and
# congestus (manifest notes with backlit/rays/veil/cirrostratus/altostratus/
# panorama excluded before looking), plus the owner's target and Santa's
# Sleigh frames. Each was looked at on a contact sheet first.
PHOTOS = [
    ("texas-afternoon", "_targets/texas-afternoon.jpg"),
    ("santa-early", "santasSleigh/early.jpg"),
    # santasSleigh/end.jpg is the same frame as texas-afternoon (and congestus DSC00629): not repeated
    ("hum-050524", "cumulus-humilis/A_20220602-050524_B7EE8102.jpg"),
    ("med-052716", "cumulus-mediocris/A_20220602-052716_33766D33.jpg"),
    ("hum-DSC00138", "cumulus-humilis/A_20220701-151519_DSC00138.jpg"),
    ("hum-DSC00139", "cumulus-humilis/A_20220701-151538_DSC00139.jpg"),
    ("med-DSC00194", "cumulus-mediocris/A_20220702-153929_DSC00194.jpg"),
    ("med-DSC00200", "cumulus-mediocris/A_20220702-154025_DSC00200.jpg"),
    ("med-DSC00234", "cumulus-mediocris/A_20220702-154617_DSC00234.jpg"),
    ("hum-DSC00268", "cumulus-humilis/A_20220702-155133_DSC00268.jpg"),
    ("med-852856DC", "cumulus-mediocris/A_20220725-035657_852856DC.jpg"),
    ("med-DSC00528", "cumulus-mediocris/A_20220729-161955_DSC00528.jpg"),
    ("con-DSC00531", "congestus/A_20220729-162113_DSC00531.jpg"),
    ("med-DSC00534", "cumulus-mediocris/A_20220729-162203_DSC00534.jpg"),
    ("con-DSC00570", "congestus/A_20220729-162741_DSC00570.jpg"),
    ("con-DSC00669", "congestus/A_20220729-173330_DSC00669.jpg"),
    ("con-DSC00678", "congestus/A_20220729-173342_DSC00678.jpg"),
    ("med-BE3E3F66", "cumulus-mediocris/A_20220730-063310_BE3E3F66.jpg"),
    ("med-DSC00809", "cumulus-mediocris/A_20220801-105340_DSC00809.jpg"),
    ("hum-DSC00822", "cumulus-humilis/A_20220801-105416_DSC00822.jpg"),
    ("med-DSC00850", "cumulus-mediocris/A_20220801-105600_DSC00850.jpg"),
    ("med-DSC00873", "cumulus-mediocris/A_20220801-105745_DSC00873.jpg"),
    ("hum-530EF5C2", "cumulus-humilis/A_20220804-013925_530EF5C2.jpg"),
    ("med-873F9F38", "cumulus-mediocris/A_20220809-050109_873F9F38.jpg"),
    ("med-3F491003", "cumulus-mediocris/A_20220809-065428_3F491003.jpg"),
    ("med-E74922AE", "cumulus-mediocris/A_20221019-055521_E74922AE.jpg"),
    ("med-FE402C72", "cumulus-mediocris/B_20220511-051216_FE402C72.jpg"),
    ("med-92CB2AA7", "cumulus-mediocris/B_20220602-054818_92CB2AA7.jpg"),
    ("med-A87BA223", "cumulus-mediocris/B_20220622-075052_A87BA223.jpg"),
    ("hum-3CCBC693", "cumulus-humilis/B_20220703-061308_3CCBC693.jpg"),
    ("hum-DSC00838", "cumulus-humilis/B_20220801-105516_DSC00838.jpg"),
    ("med-FC253C20", "cumulus-mediocris/B_20220809-050147_FC253C20.jpg"),
    ("med-2D72F567", "cumulus-mediocris/B_20220809-061201_2D72F567.jpg"),
    ("med-IMG_4922", "cumulus-mediocris/B_20221011-173850_IMG_4922.jpg"),
]
RENDERS = [(f"ours-{style}-{view}", f"work/captures/S1/final/{style}/{view}.jpg")
           for style in ("horizon", "early", "real") for view in ("ground", "gp7")]
# Exact alpha (Parkouring, PT1) and the same frames colour-segmented, to check the segmentation.
ALPHA = [("parkouring-alpha", "work/captures/PT1/alpha-noon.png")]
CHECK = [("parkouring-pt-seg", "work/captures/PT1/pt-noon.png"),
         ("parkouring-nubis-seg", "work/captures/PT1/nubis-noon.png")]

# name -> reason; filled after looking at every overlay
DROP = {"med-FE402C72": "power lines cross the cloud and are segmented as cloud strands"}


def find_photo(repo, rel):
    p = os.path.join(repo, PH, rel)
    if os.path.exists(p):
        return p
    # the same file may sit in another category folder
    base = os.path.basename(rel)
    for d in os.listdir(os.path.join(repo, PH)):
        q = os.path.join(repo, PH, d, base)
        if os.path.exists(q):
            return q
    raise FileNotFoundError(rel)


def seg_job(args):
    name, path, work = args
    t = time.time()
    img = sg.load(path, 1600)
    cloud, valid, _, info = sg.segment(img)
    Image.fromarray(sg.encode_mask(cloud, valid)).save(os.path.join(work, name + "_mask.png"))
    sg.overlay(img, cloud, valid).save(os.path.join(work, name + "_overlay.jpg"), quality=82)
    info["seconds"] = round(time.time() - t, 1)
    return name, info


def measure_job(args):
    name, mask_path, alpha = args
    if alpha:
        a = np.asarray(Image.open(mask_path).convert("L"))
        cloud = a > 127
        valid = np.ones_like(cloud)
    else:
        cloud, valid = ms.load_mask(mask_path)
    res = ms.measure_mask(cloud, valid)
    res["summary"] = ms.summarise(res)
    return name, res


# ---------------------------------------------------------------- stats
def ranksum(a, b):
    """Mann-Whitney U, normal approximation with tie correction. Returns (AUC of a>b, two-sided p)."""
    a = np.asarray([x for x in a if x is not None and np.isfinite(x)], float)
    b = np.asarray([x for x in b if x is not None and np.isfinite(x)], float)
    n1, n2 = len(a), len(b)
    if n1 < 2 or n2 < 2:
        return None, None
    allv = np.concatenate([a, b])
    order = np.argsort(allv, kind="mergesort")
    ranks = np.empty(len(allv))
    sv = allv[order]
    i = 0
    tie = 0.0
    while i < len(sv):
        j = i
        while j + 1 < len(sv) and sv[j + 1] == sv[i]:
            j += 1
        ranks[order[i:j + 1]] = 0.5 * (i + j) + 1
        t = j - i + 1
        tie += t ** 3 - t
        i = j + 1
    U = ranks[:n1].sum() - n1 * (n1 + 1) / 2
    N = n1 + n2
    sd = math.sqrt(n1 * n2 / 12.0 * ((N + 1) - tie / (N * (N - 1))))
    z = (U - n1 * n2 / 2) / sd if sd > 0 else 0.0
    p = math.erfc(abs(z) / math.sqrt(2))
    return U / (n1 * n2), p


def q(a, p):
    a = [x for x in a if x is not None and np.isfinite(x)]
    return float(np.percentile(a, p)) if a else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", default="work/captures/P2-1")
    ap.add_argument("--jobs", type=int, default=6)
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    os.makedirs(os.path.join(a.out, "measures"), exist_ok=True)
    t0 = time.time()
    photos = [(n, find_photo(a.repo, r)) for n, r in PHOTOS]
    renders = [(n, os.path.join(a.repo, r)) for n, r in RENDERS + CHECK]
    jobs = [(n, p, a.work) for n, p in photos + renders]
    with Pool(a.jobs) as pool:
        seginfo = dict(pool.map(seg_job, jobs))
    print(f"segmented {len(jobs)} images in {time.time() - t0:.0f} s")
    mjobs = [(n, os.path.join(a.work, n + "_mask.png"), False) for n, _ in photos + renders]
    mjobs += [(n, os.path.join(a.repo, p), True) for n, p in ALPHA]
    with Pool(a.jobs) as pool:
        meas = dict(pool.map(measure_job, mjobs))
    print(f"measured in {time.time() - t0:.0f} s")
    for n, res in meas.items():
        res["segment"] = seginfo.get(n)
        with open(os.path.join(a.out, "measures", n + ".json"), "w") as f:
            json.dump(res, f, default=ms._json_default, separators=(",", ":"))

    # segmentation check against the exact alpha
    alpha = np.asarray(Image.open(os.path.join(a.repo, ALPHA[0][1])).convert("L")) > 127
    check = {}
    for n, _ in CHECK:
        m = np.asarray(Image.open(os.path.join(a.work, n + "_mask.png")))
        if m.shape != alpha.shape:
            m = np.asarray(Image.fromarray(m).resize(alpha.shape[::-1], Image.NEAREST))
        c = m > 200
        check[n] = dict(iou=float((c & alpha).sum() / max(1, (c | alpha).sum())),
                        area_ratio=float(c.sum() / max(1, alpha.sum())))

    groups = dict(photos=[n for n, _ in photos if n not in DROP],
                  ours=[n for n, _ in RENDERS if n not in DROP])
    S = {n: meas[n]["summary"] for n in meas}
    keys = ["aspect_mom_med", "aspect_bbox_med", "aspect_log2_iqr", "aspect_p90_over_p10", "aspect_max",
            "mid_share_med", "mid_over_fine_med", "top_round_over_fuzz_med",
            "E8_med", "E16_med", "E32_med", "E64_med",
            "E_top16_med", "E_top32_med", "E_top64_med", "E_base16_med", "E_base32_med", "E_base64_med",
            "base_rms_med", "base_frac_med", "area_med", "area_log10_p90_p10",
            "gap_med", "gap_p90", "chord_med", "cloud_fraction", "n_complete", "n_spectrum"]
    table = {}
    for k in keys:
        ph = [S[n].get(k) for n in groups["photos"]]
        ou = [S[n].get(k) for n in groups["ours"]]
        auc, p = ranksum(ph, ou)
        row = dict(photos=[q(ph, 10), q(ph, 25), q(ph, 50), q(ph, 75), q(ph, 90)],
                   ours=[q(ou, 25), q(ou, 50), q(ou, 75)],
                   ours_values=ou, n_photos=len([x for x in ph if x is not None]),
                   n_ours=len([x for x in ou if x is not None]), auc=auc, p=p,
                   parkouring=S["parkouring-alpha"].get(k))
        if row["photos"][1] is not None and row["ours"][0] is not None:
            row["iqr_overlap"] = not (row["ours"][2] < row["photos"][1] or row["ours"][0] > row["photos"][3])
        table[k] = row
    # body-level pooled aspect (complete bodies), and by vertical position in the frame
    def bodies(names, key, cond=lambda b: True):
        return [b[key] for n in names for b in meas[n]["bodies"] if b["complete"] and key in b and cond(b)]
    pooled = {}
    for k in ("aspect_mom", "aspect_bbox", "base_rms", "base_frac"):
        ph, ou = bodies(groups["photos"], k), bodies(groups["ours"], k)
        auc, p = ranksum(ph, ou)
        pooled[k] = dict(photos=[q(ph, 10), q(ph, 25), q(ph, 50), q(ph, 75), q(ph, 90)], n_photos=len(ph),
                         ours=[q(ou, 10), q(ou, 25), q(ou, 50), q(ou, 75), q(ou, 90)], n_ours=len(ou), auc=auc, p=p)
    for half, cond in (("upper", lambda b: b["cy"] < 0.5), ("lower", lambda b: b["cy"] >= 0.5)):
        ph, ou = bodies(groups["photos"], "aspect_mom", cond), bodies(groups["ours"], "aspect_mom", cond)
        auc, p = ranksum(ph, ou)
        pooled["aspect_mom_" + half] = dict(photos=[q(ph, 10), q(ph, 50), q(ph, 90)], n_photos=len(ph),
                                            ours=[q(ou, 10), q(ou, 50), q(ou, 90)], n_ours=len(ou), auc=auc, p=p)
    # pooled spectra (bodies with all core bands)
    spec = {}
    for g, names in groups.items():
        rows = [b["E"] for n in names for b in meas[n]["bodies"] if "E" in b and all(r in b["E"] for r in ms.CORE)]
        spec[g] = {r: [q([e[r] for e in rows], p) for p in (10, 25, 50, 75, 90)] for r in ms.CORE}
        spec[g]["n"] = len(rows)
    spec["per_render"] = {n: {r: S[n].get(f"E{r}_med") for r in ms.CORE} for n in groups["ours"]}
    spec["parkouring"] = {r: S["parkouring-alpha"].get(f"E{r}_med") for r in ms.CORE}
    out = dict(groups=groups, dropped=DROP, segmentation_check=check, table=table, pooled_bodies=pooled,
               spectrum=spec, per_image=S, seconds=round(time.time() - t0, 1))
    with open(os.path.join(a.out, "summary.json"), "w") as f:
        json.dump(out, f, indent=1, default=ms._json_default)

    def f3(x):
        return "-" if x is None else f"{x:.3g}"
    lines = ["| measure | photos p10 | p25 | median | p75 | p90 | ours p25 | median | p75 | Parkouring | AUC | p | IQR overlap |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for k, r in table.items():
        lines.append(f"| {k} | " + " | ".join(f3(x) for x in r["photos"]) + " | " +
                     " | ".join(f3(x) for x in r["ours"]) + f" | {f3(r['parkouring'])} | {f3(r['auc'])} | {f3(r['p'])} | "
                     f"{r.get('iqr_overlap')} |")
    lines += ["", "Pooled complete bodies:", ""]
    for k, r in pooled.items():
        lines.append(f"- {k}: photos {[f3(x) for x in r['photos']]} (n={r['n_photos']}), ours {[f3(x) for x in r['ours']]}"
                     f" (n={r['n_ours']}), AUC {f3(r['auc'])}, p {f3(r['p'])}")
    lines += ["", f"Segmentation check vs exact alpha: {json.dumps(check)}", f"Run time {out['seconds']} s"]
    with open(os.path.join(a.out, "table.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
