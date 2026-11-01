#!/usr/bin/env python3
"""Subset the UI web fonts into a preloaded core file and a lazy extended file.

Run by hand from the repo root (never part of the build):

    python3 -m pip install -r apps/ui/scripts/fonts/requirements.txt
    python3 apps/ui/scripts/fonts/subset_fonts.py          # regenerate
    python3 apps/ui/scripts/fonts/subset_fonts.py --check  # exit 1 if a rerun is needed

Inputs: fonts.json (sources, used axis ranges, kept OpenType features) and the
characters found in the content roots. Outputs, all committed:
apps/ui/src/fonts/files/*.woff2, the generated next/font modules
(apps/ui/src/fonts/site.ts, apps/ui/src/fonts/editorial.ts) and
apps/ui/src/fonts/fonts.lock.json.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import uharfbuzz as hb

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables
from fontTools.ttLib.tables._g_l_y_f import Glyph
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
FILES_DIR = ROOT / "apps/ui/src/fonts/files"
LOCK_PATH = ROOT / "apps/ui/src/fonts/fonts.lock.json"
CONTENT_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".md", ".mdx", ".json", ".css"}
SKIP_PARTS = {"node_modules", ".next", ".next-dev", ".content-collections", "fonts"}
ENTITY = re.compile(r"&(?:#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);")
ESCAPE = re.compile(r"\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})")
RFN = re.compile(r"with\s+reserved\s+font\s+names?", re.IGNORECASE)
RASTER_REFERENCE = {ord("X")}
RENAMED_NAME_IDS = (1, 3, 4, 6, 16, 17, 18, 21, 22, 25)


def parse_ranges(spec: str) -> set[int]:
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip().upper().removeprefix("U+")
        if not part:
            continue
        lo, _, hi = part.partition("-")
        out.update(range(int(lo, 16), int(hi or lo, 16) + 1))
    return out


def format_ranges(codepoints: set[int]) -> str:
    cps = sorted(codepoints)
    parts: list[str] = []
    start = prev = None
    for cp in cps + [None]:
        if start is None:
            start = prev = cp
            continue
        if cp is not None and cp == prev + 1:
            prev = cp
            continue
        parts.append(f"U+{start:04X}" if start == prev else f"U+{start:04X}-{prev:04X}")
        start = prev = cp
    return ",".join(parts)


def content_files(roots: list[str]):
    for root in roots:
        path = ROOT / root
        if path.is_file():
            yield path
            continue
        for file in sorted(path.rglob("*")):
            rel = file.relative_to(path).parts
            if (
                file.is_file()
                and file.suffix in CONTENT_SUFFIXES
                and not SKIP_PARTS.intersection(rel)
                and ".spec." not in file.name
                and ".test." not in file.name
            ):
                yield file


def content_codepoints(roots: list[str]) -> set[int]:
    chars: set[str] = set()
    for file in content_files(roots):
        text = file.read_text(encoding="utf-8", errors="ignore")
        chars.update(text)
        chars.update(html.unescape(m.group(0)) for m in ENTITY.finditer(text))
        for m in ESCAPE.finditer(text):
            chars.add(chr(int(m.group(1) or m.group(2), 16)))
    expanded: set[int] = set()
    for ch in chars:
        for variant in (ch, ch.upper(), ch.lower()):
            expanded.update(ord(c) for c in variant if ord(c) >= 0x20 and not 0x7F <= ord(c) <= 0x9F and not 0xD800 <= ord(c) <= 0xDFFF)
    return expanded


def check_license(font: TTFont, cfg: dict) -> str | None:
    texts = [font["name"].getDebugName(i) or "" for i in (0, 13)]
    license_path = ROOT / cfg["license"]
    if license_path.exists():
        texts.append(license_path.read_text(encoding="utf-8", errors="ignore"))
    if any(RFN.search(t.split("This Font Software is licensed")[0]) for t in texts):
        rename = cfg.get("renameTo")
        if not rename:
            sys.exit(f"{cfg['name']}: the license declares a Reserved Font Name; set renameTo in fonts.json")
        return rename
    return None


def rename_font(font: TTFont, family: str) -> None:
    name = font["name"]
    style = name.getDebugName(17) or name.getDebugName(2) or "Regular"
    values = {
        1: family,
        3: f"{family}-{style}".replace(" ", ""),
        4: f"{family} {style}",
        6: f"{family}-{style}".replace(" ", ""),
        16: family,
        17: style,
        18: f"{family} {style}",
        21: family,
        22: style,
        25: family.replace(" ", ""),
    }
    for record in list(name.names):
        if record.nameID in RENAMED_NAME_IDS and record.nameID in values:
            record.string = values[record.nameID]


def master_locations(font: TTFont, tag: str) -> list[float]:
    axis = next(a for a in font["fvar"].axes if a.axisTag == tag)
    peaks = {0.0, -1.0, 1.0}
    if "gvar" in font:
        for variations in font["gvar"].variations.values():
            for var in variations:
                if tag in var.axes:
                    peaks.update(var.axes[tag])
    segments = font["avar"].segments.get(tag) if "avar" in font else None

    def unmap(v: float) -> float:
        if not segments:
            return v
        points = sorted(segments.items(), key=lambda kv: kv[1])
        for (a_in, a_out), (b_in, b_out) in zip(points, points[1:]):
            if a_out <= v <= b_out:
                return a_in if b_out == a_out else a_in + (v - a_out) * (b_in - a_in) / (b_out - a_out)
        return v

    def denormalize(v: float) -> float:
        v = unmap(v)
        if v < 0:
            return axis.defaultValue + v * (axis.defaultValue - axis.minValue)
        return axis.defaultValue + v * (axis.maxValue - axis.defaultValue)

    return sorted({round(denormalize(p), 3) for p in peaks})


def axis_limits(font: TTFont, cfg: dict) -> dict:
    limits = {}
    for axis in font["fvar"].axes:
        tag = axis.axisTag
        used = cfg.get("usedAxes", {}).get(tag)
        if not used:
            continue
        lo, hi = min(used), max(used)
        if lo == hi == axis.defaultValue:
            limits[tag] = axis.defaultValue
            continue
        lo, hi = min(lo, axis.defaultValue), max(hi, axis.defaultValue)
        masters = master_locations(font, tag)
        limits[tag] = (
            max(m for m in masters if m <= lo),
            min(m for m in masters if m >= hi),
        )
    return limits


def apply_axis_limits(font: TTFont, limits: dict, name: str) -> TTFont:
    pinned = {tag: v for tag, v in limits.items() if not isinstance(v, tuple)}
    if pinned:
        font = instancer.instantiateVariableFont(font, pinned, updateFontNames=False)
        if "fvar" not in font:
            return font
    for axis in font["fvar"].axes:
        limit = limits.get(axis.axisTag)
        if not isinstance(limit, tuple) or limit == (axis.minValue, axis.maxValue):
            continue
        lo, hi = limit
        if lo not in (axis.minValue, axis.defaultValue) or hi not in (axis.maxValue, axis.defaultValue):
            sys.exit(f"{name}: {axis.axisTag} limit {limit} needs an intermediate master; widen usedAxes")
        def kept(var, tag=axis.axisTag, lo=lo, hi=hi, default=axis.defaultValue) -> bool:
            peak = var.axes.get(tag, (0, 0, 0))[1]
            return not ((peak < 0 and lo == default) or (peak > 0 and hi == default))
        for glyph, variations in font["gvar"].variations.items():
            font["gvar"].variations[glyph] = [v for v in variations if kept(v)]
        axis.minValue, axis.maxValue = lo, hi
        font["fvar"].instances = [
            i for i in font["fvar"].instances if lo <= i.coordinates.get(axis.axisTag, axis.defaultValue) <= hi
        ]
    return font


def load(data: bytes) -> TTFont:
    return TTFont(io.BytesIO(data), recalcBBoxes=False, recalcTimestamp=False)


def to_bytes(font: TTFont) -> bytes:
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def add_decompositions(font: TTFont, composed: set[int]) -> None:
    cmap = font.getBestCmap()
    glyph_order = font.getGlyphOrder()
    gsub = font["GSUB"].table
    mapping = {}
    for cp in sorted(composed):
        name = f"uni{cp:04X}.decomposed"
        mapping[name] = [cmap[ord(c)] for c in unicodedata.normalize("NFD", chr(cp))]
        glyph_order.append(name)
        font["glyf"].glyphs[name] = Glyph()
        font["hmtx"].metrics[name] = (0, 0)
        if "gvar" in font:
            font["gvar"].variations[name] = []
        if "HVAR" in font:
            adv = font["HVAR"].table.AdvWidthMap.mapping
            adv[name] = adv[mapping[name][0]]
        for table in font["cmap"].tables:
            if table.isUnicode():
                table.cmap[cp] = name
    font.setGlyphOrder(glyph_order)
    font["glyf"].glyphOrder = glyph_order
    lookup = otTables.Lookup()
    lookup.LookupType = 2
    lookup.LookupFlag = 0
    subtable = otTables.MultipleSubst()
    subtable.Format = 1
    subtable.mapping = mapping
    lookup.SubTable = [subtable]
    lookup.SubTableCount = 1
    if gsub.LookupList is None:
        gsub.LookupList = otTables.LookupList()
        gsub.LookupList.Lookup = []
    gsub.LookupList.Lookup.insert(0, lookup)
    gsub.LookupList.LookupCount = len(gsub.LookupList.Lookup)
    for record in gsub.FeatureList.FeatureRecord:
        record.Feature.LookupListIndex = [i + 1 for i in record.Feature.LookupListIndex]
    for existing in gsub.LookupList.Lookup[1:]:
        for sub in existing.SubTable:
            sub = sub.ExtSubTable if existing.LookupType == 7 else sub
            for attr in ("SubstLookupRecord", "SubstLookupRecords"):
                for container in [sub] + list(getattr(sub, "SubRuleSet", None) or []) + list(getattr(sub, "ChainSubRuleSet", None) or []):
                    for rule in [container] + list(getattr(container, "SubRule", None) or []) + list(getattr(container, "ChainSubRule", None) or []):
                        for rec in getattr(rule, attr, None) or []:
                            rec.LookupListIndex += 1
            for attr in ("SubClassSet", "ChainSubClassSet"):
                for cls in getattr(sub, attr, None) or []:
                    for rule in (cls.SubClassRule if cls and hasattr(cls, "SubClassRule") else cls.ChainSubClassRule if cls else []):
                        for rec in rule.SubstLookupRecord:
                            rec.LookupListIndex += 1
    ccmp = [r for r in gsub.FeatureList.FeatureRecord if r.FeatureTag == "ccmp"]
    if ccmp:
        for record in ccmp:
            record.Feature.LookupListIndex.insert(0, 0)
            record.Feature.LookupCount = len(record.Feature.LookupListIndex)
        return
    record = otTables.FeatureRecord()
    record.FeatureTag = "ccmp"
    record.Feature = otTables.Feature()
    record.Feature.FeatureParams = None
    record.Feature.LookupListIndex = [0]
    record.Feature.LookupCount = 1
    records = gsub.FeatureList.FeatureRecord
    records.append(record)
    order = sorted(range(len(records)), key=lambda i: records[i].FeatureTag)
    remap = {old: new for new, old in enumerate(order)}
    gsub.FeatureList.FeatureRecord = [records[i] for i in order]
    gsub.FeatureList.FeatureCount = len(records)
    new_index = remap[len(records) - 1]
    for script in gsub.ScriptList.ScriptRecord:
        langsys = [script.Script.DefaultLangSys] + [r.LangSys for r in script.Script.LangSysRecord]
        for ls in filter(None, langsys):
            ls.FeatureIndex = sorted([remap[i] for i in ls.FeatureIndex] + [new_index])
            ls.FeatureCount = len(ls.FeatureIndex)


def subset_font(data: bytes, unicodes: set[int], cfg: dict, rename: str | None, composed: set[int] = frozenset()) -> bytes:
    font = load(data)
    options = subset.Options()
    options.layout_features = cfg["features"]
    options.layout_scripts = ["*"]
    options.hinting = cfg.get("hinting", True)
    options.glyph_names = True
    options.drop_tables = options.drop_tables + ["STAT"]
    options.flavor = "woff2"
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    if composed:
        add_decompositions(font, composed)
    if rename:
        rename_font(font, rename)
    font.flavor = "woff2"
    return to_bytes(font)


def static_instance(data: bytes, location: dict) -> TTFont:
    font = load(data)
    if "fvar" not in font:
        return font
    return instancer.instantiateVariableFont(font, location, static=True)


def verify_outlines(source: bytes, output: bytes, cfg: dict) -> None:
    out = load(output)
    weights = check_weights(cfg, out)
    for w in weights:
        loc = {"wght": w} if w is not None else {}
        a, b = static_instance(source, loc), static_instance(output, loc)
        for gname in b.getGlyphOrder():
            if gname == ".notdef" or gname.endswith(".decomposed"):
                continue
            ga, gb = a["glyf"][gname], b["glyf"][gname]
            ca = ga.getCoordinates(a["glyf"])[0] if ga.numberOfContours else []
            cb = gb.getCoordinates(b["glyf"])[0] if gb.numberOfContours else []
            if list(ca) != list(cb) or a["hmtx"][gname] != b["hmtx"][gname]:
                sys.exit(f"{cfg['name']}: glyph {gname} differs from the source at {loc or 'default'}")


def inspect(data: bytes) -> dict:
    font = load(data)
    features = sorted(
        {r.FeatureTag for t in ("GSUB", "GPOS") if t in font and font[t].table.FeatureList for r in font[t].table.FeatureList.FeatureRecord}
    )
    return {
        "bytes": len(data),
        "glyphs": font["maxp"].numGlyphs,
        "codepoints": sorted(font.getBestCmap()),
        "axes": {a.axisTag: [a.minValue, a.defaultValue, a.maxValue] for a in font["fvar"].axes} if "fvar" in font else {},
        "features": features,
        "hinting": sorted(t.strip() for t in ("fpgm", "prep", "cvt ", "gasp") if t in font),
        "family": font["name"].getDebugName(1),
    }


def check_weights(cfg: dict, font: TTFont) -> list[float | None]:
    if "fvar" not in font:
        return [None]
    used = sorted(cfg["usedAxes"]["wght"])
    default = next(a.defaultValue for a in font["fvar"].axes if a.axisTag == "wght")
    return sorted(set(range(int(used[0]), int(used[-1]) + 1, 100)) | {default})


def shaper(data: bytes, weight: float | None = None):
    font = load(data)
    font.flavor = None
    hb_font = hb.Font(hb.Face(to_bytes(font)))
    if weight is not None:
        hb_font.set_variations({"wght": weight})
    order = font.getGlyphOrder()

    def shape(text: str) -> list[tuple]:
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(hb_font, buf, {})
        return [
            (order[i.codepoint], p.x_advance, p.y_advance, p.x_offset, p.y_offset)
            for i, p in zip(buf.glyph_infos, buf.glyph_positions)
        ]

    return shape


def verify_shaping(source: bytes, output: bytes, codepoints: set[int], cfg: dict, part: str) -> None:
    for w in check_weights(cfg, load(output)):
        before, after = shaper(source, w), shaper(output, w)
        for cp in sorted(codepoints):
            if before(chr(cp)) != after(chr(cp)):
                sys.exit(f"{cfg['name']}-{part}: U+{cp:04X} shapes differently from the source at wght {w}")


def build_font(cfg: dict, content: set[int], punctuation: set[int], blocks: set[int]):
    source = (ROOT / cfg["source"]).read_bytes()
    font = load(source)
    rename = check_license(font, cfg)
    cmap = set(font.getBestCmap())
    shape = shaper(source)

    def renderable(cp: int) -> bool:
        if cp in cmap:
            return True
        parts = unicodedata.normalize("NFD", chr(cp))
        return (
            parts != chr(cp)
            and all(ord(c) in cmap for c in parts)
            and all(g[0] != ".notdef" for g in shape(chr(cp)))
        )

    limits = axis_limits(font, cfg) if "fvar" in font else {}
    if limits:
        font = apply_axis_limits(font, limits, cfg["name"])
    base = to_bytes(font)
    wanted = set(range(0x20, 0x7F)) | punctuation
    if cfg.get("chars") == "content":
        wanted |= content
    core = {cp for cp in wanted if renderable(cp)}
    extended = {cp for cp in blocks - core if renderable(cp)}
    files = {}
    claimed: set[int] = set()
    for part, targets in (("core", core), ("extended", extended)):
        if not targets:
            continue
        composed = targets - cmap
        components = {ord(c) for cp in composed for c in unicodedata.normalize("NFD", chr(cp))} & cmap
        unicodes = (targets & cmap) | components | (RASTER_REFERENCE & cmap)
        data = subset_font(base, unicodes, cfg, rename, composed)
        info = inspect(data)
        missing = unicodes - set(info["codepoints"])
        if missing:
            sys.exit(f"{cfg['name']}-{part}: subset is missing {format_ranges(missing)}")
        info["range"] = set(info["codepoints"]) - claimed
        claimed |= info["range"]
        unexpected = set(info["features"]) - set(cfg["features"])
        if unexpected:
            sys.exit(f"{cfg['name']}-{part}: unexpected features {sorted(unexpected)}")
        verify_outlines(source, data, cfg)
        verify_shaping(source, data, info["range"], cfg, part)
        files[part] = (data, info)
    return {
        "source": source,
        "sourceInfo": inspect(source),
        "limits": {k: list(v) if isinstance(v, tuple) else v for k, v in limits.items()},
        "renamed": rename,
        "files": files,
    }


def kebab(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()


def local_font_call(var: str, cfg: dict, file: str, info: dict, preload: bool, fallback: bool) -> str:
    props = [f'\tsrc: "./files/{file}",', f'\tweight: "{cfg["weight"]}",']
    if cfg.get("style"):
        props.append(f'\tstyle: "{cfg["style"]}",')
    props.append(f'\tdisplay: "{cfg["display"]}",')
    if not preload:
        props.append("\tpreload: false,")
    if not fallback:
        props.append("\tadjustFontFallback: false,")
    elif cfg.get("adjustFontFallback"):
        props.append(f'\tadjustFontFallback: "{cfg["adjustFontFallback"]}",')
    props.append("\tdeclarations: [")
    props.append(f'\t\t{{ prop: "font-family", value: "{cfg.get("family", cfg["name"])}" }},')
    props.append("\t\t{")
    props.append('\t\t\tprop: "unicode-range",')
    props.append(f'\t\t\tvalue: "{format_ranges(info["range"])}",')
    props.append("\t\t},")
    props.append("\t],")
    return f"const {var} = localFont({{\n" + "\n".join(props) + "\n});\n"


def render_module(module: dict, built: dict) -> str:
    lines = [
        "// Generated by apps/ui/scripts/fonts/subset_fonts.py. Do not edit; see apps/ui/scripts/fonts/README.md.",
        'import localFont from "next/font/local";',
        "",
        'import { fontStack } from "./font-stack";',
        "",
        'import type { CSSProperties } from "react";',
        "",
    ]
    entries = []
    for cfg in module["fonts"]:
        name = cfg["name"]
        primary = "family" not in cfg
        files = built[name]["files"]
        core_var = name if primary else f"_{name}"
        lines.append(local_font_call(core_var, cfg, f"{kebab(name)}-core.woff2", files["core"][1], cfg.get("preload", True), primary))
        if "extended" in files:
            lines.append(local_font_call(f"_{name}Extended", cfg, f"{kebab(name)}-extended.woff2", files["extended"][1], False, False))
        if primary:
            key = f'"{cfg["cssVariable"]}"' if module["kind"] == "variables" else "fontFamily"
            entries.append(f'\t{key}: fontStack("{name}", {name}),')
    lines.append(f"export const {module['export']} = {{\n" + "\n".join(entries) + "\n} as CSSProperties;\n")
    return "\n".join(lines)


def plan(config: dict):
    content = content_codepoints(config["contentRoots"])
    punctuation = parse_ranges(config["corePunctuation"])
    blocks = parse_ranges(config["extendedBlocks"])
    built = {}
    for module in config["modules"]:
        for cfg in module["fonts"]:
            built[cfg["name"]] = build_font(cfg, content, punctuation, blocks)
    return built


def lock_data(config: dict, built: dict) -> dict:
    fonts = {}
    for name, b in built.items():
        fonts[name] = {
            "source": {
                "sha256": hashlib.sha256(b["source"]).hexdigest(),
                "bytes": b["sourceInfo"]["bytes"],
                "glyphs": b["sourceInfo"]["glyphs"],
                "axes": b["sourceInfo"]["axes"],
                "features": b["sourceInfo"]["features"],
                "hinting": b["sourceInfo"]["hinting"],
            },
            "axisLimits": b["limits"],
            "renamedTo": b["renamed"],
            "files": {
                part: {
                    "file": f"{kebab(name)}-{part}.woff2",
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "bytes": info["bytes"],
                    "glyphs": info["glyphs"],
                    "unicodeRange": format_ranges(info["range"]),
                    "codepoints": format_ranges(set(info["codepoints"])),
                    "axes": info["axes"],
                    "features": info["features"],
                    "hinting": info["hinting"],
                }
                for part, (data, info) in b["files"].items()
            },
        }
    return {
        "configSha256": hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest(),
        "fonts": fonts,
    }


def prettier(path: Path, text: str) -> str:
    result = subprocess.run(
        ["pnpm", "exec", "prettier", "--stdin-filepath", str(path)],
        cwd=ROOT / "apps/ui",
        input=text,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="exit 1 if the committed output is stale")
    args = parser.parse_args()
    config = json.loads((HERE / "fonts.json").read_text())
    built = plan(config)
    lock = lock_data(config, built)
    outputs = {ROOT / m["output"]: render_module(m, built) for m in config["modules"]}
    outputs[LOCK_PATH] = json.dumps(lock, indent="\t") + "\n"
    outputs = {path: prettier(path, text) for path, text in outputs.items()}
    fonts = {
        FILES_DIR / f"{kebab(name)}-{part}.woff2": data
        for name, b in built.items()
        for part, (data, _) in b["files"].items()
    }
    orphans = sorted(set(FILES_DIR.glob("*.woff2")) - set(fonts))

    if args.check:
        stale = [path for path, text in outputs.items() if not path.exists() or path.read_text() != text]
        stale += [path for path, data in fonts.items() if not path.exists() or path.read_bytes() != data]
        stale += orphans
        if stale:
            print("Fonts are stale, rerun apps/ui/scripts/fonts/subset_fonts.py:\n  " + "\n  ".join(str(p.relative_to(ROOT)) for p in stale))
            sys.exit(1)
        print("Fonts are up to date.")
        return

    FILES_DIR.mkdir(parents=True, exist_ok=True)
    for path, data in fonts.items():
        path.write_bytes(data)
    for path in orphans:
        path.unlink()
    for path, text in outputs.items():
        path.write_text(text)

    for name, b in built.items():
        src = b["sourceInfo"]
        parts = ", ".join(f"{part} {info['bytes']} B / {info['glyphs']} glyphs" for part, (_, info) in b["files"].items())
        print(f"{name}: source {src['bytes']} B / {src['glyphs']} glyphs -> {parts}; axes {b['limits'] or '-'}")


if __name__ == "__main__":
    main()
