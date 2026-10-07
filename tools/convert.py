#!/usr/bin/env python3
"""Convert Project Hawkthorne TMX levels + assets into a web-friendly bundle.

Usage: convert.py <hawkthorne src dir> <output dir> level [level ...]
"""
import base64, json, os, re, shutil, sys, zlib
import xml.etree.ElementTree as ET

SRC, OUT = sys.argv[1], sys.argv[2]
LEVELS = sys.argv[3:]
ASSETS = os.path.join(OUT, "assets")
os.makedirs(os.path.join(ASSETS, "levels"), exist_ok=True)

copied = set()


def copy_asset(rel):
    """Copy src/<rel> to assets/<rel>; return web path."""
    rel = os.path.normpath(rel)
    if rel not in copied:
        dst = os.path.join(ASSETS, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(os.path.join(SRC, rel), dst)
        copied.add(rel)
    return "assets/" + rel.replace(os.sep, "/")


def props(el):
    p = {}
    pe = el.find("properties")
    if pe is not None:
        for q in pe.findall("property"):
            p[q.get("name")] = q.get("value")
    return p


def decode(data_el, w, h):
    enc, comp = data_el.get("encoding"), data_el.get("compression")
    if enc == "base64":
        raw = base64.b64decode(data_el.text.strip())
        if comp == "zlib":
            raw = zlib.decompress(raw)
        elif comp == "gzip":
            raw = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
        n = len(raw) // 4
        return [int.from_bytes(raw[i * 4:i * 4 + 4], "little") & 0x1FFFFFFF for i in range(n)]
    if enc == "csv":
        return [int(v) & 0x1FFFFFFF for v in data_el.text.replace("\n", "").split(",") if v.strip()]
    return [int(t.get("gid", 0)) for t in data_el.findall("tile")]


for name in LEVELS:
    path = os.path.join(SRC, "maps", name + ".tmx")
    root = ET.parse(path).getroot()
    W, H = int(root.get("width")), int(root.get("height"))
    tw, th = int(root.get("tilewidth")), int(root.get("tileheight"))
    level = {"name": name, "width": W, "height": H, "tilewidth": tw, "tileheight": th,
             "properties": props(root), "tilesets": [], "layers": [], "objects": []}
    coll_first = None
    for ts in root.findall("tileset"):
        img = ts.find("image")
        rel = os.path.normpath(os.path.join("maps", img.get("source")))
        entry = {"name": ts.get("name"), "firstgid": int(ts.get("firstgid")),
                 "tilewidth": int(ts.get("tilewidth")), "tileheight": int(ts.get("tileheight")),
                 "width": int(img.get("width")), "height": int(img.get("height"))}
        if ts.get("name") == "collisions":
            coll_first = entry["firstgid"]
        else:
            entry["image"] = copy_asset(rel)
        level["tilesets"].append(entry)

    for layer in root.findall("layer"):
        data = decode(layer.find("data"), W, H)
        lname = layer.get("name")
        if lname == "collision":
            level["collision"] = [(g - coll_first) if g else -1 for g in data]
            continue
        if not any(data):
            continue
        level["layers"].append({"name": lname, "opacity": float(layer.get("opacity", 1)),
                                "visible": layer.get("visible", "1") != "0",
                                "properties": props(layer), "data": data})

    for og in root.findall("objectgroup"):
        for o in og.findall("object"):
            ob = {"type": o.get("type"), "name": o.get("name"),
                  "x": float(o.get("x")), "y": float(o.get("y")),
                  "width": float(o.get("width", 0)), "height": float(o.get("height", 0)),
                  "properties": props(o), "group": og.get("name")}
            level["objects"].append(ob)

    with open(os.path.join(ASSETS, "levels", name + ".json"), "w") as f:
        json.dump(level, f, separators=(",", ":"))
    print(name, W, "x", H, len(level["layers"]), "layers", len(level["objects"]), "objects")

# Sprites used by the game code
extra = ["images/enemies/acorn.png", "images/enemies/cat.png", "images/enemies/bat.png",
         "images/enemies/monkey.png", "images/blocks/boulder.png", "images/blocks/boulder-crumble.png",
         "images/blocks/grass-block.png", "images/blocks/dirt-block.png",
         "images/liquid/waterfall.png", "images/liquid/water.png",
         "images/materials/rock.png", "images/materials/stick.png", "images/materials/leaf.png",
         "images/enemies/fish.png", "audio/music/forest-2.ogg"]
extra += ["audio/sfx/%s.ogg" % s for s in
          ["jump", "punch", "hit", "acorn_crush", "acorn_squeak", "acorn_growl", "meow", "bat_attack",
           "bat_die", "pickup", "damage", "death", "boulder-crumble", "respawn", "confirm", "click"]]
for e in extra:
    copy_asset(e)

chars = []
for fn in sorted(os.listdir(os.path.join(SRC, "characters"))):
    if not fn.endswith(".json"):
        continue
    cname = fn[:-5]
    d = json.load(open(os.path.join(SRC, "characters", fn)))
    sheet = os.path.join("images", "characters", cname, "base.png")
    if not os.path.exists(os.path.join(SRC, sheet)) or "bbox" not in d:
        continue
    base_name = next((c["name"] for c in d.get("costumes", []) if c.get("sheet") == "base"), cname)
    chars.append({"id": cname, "name": base_name, "bbox": d["bbox"],
                  "sheet": copy_asset(sheet)})
with open(os.path.join(ASSETS, "characters.json"), "w") as f:
    json.dump(chars, f, indent=1)
shutil.copyfile(os.path.join(SRC, "character_map.json"), os.path.join(ASSETS, "character_map.json"))
print(len(chars), "characters,", len(copied), "files copied")
