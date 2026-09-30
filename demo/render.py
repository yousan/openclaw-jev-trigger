#!/usr/bin/env python3
"""Renders demo/demo.gif from demo/transcript.txt (the output of record.sh).

The commands mirror demo/record.sh (condition text shortened to fit); the tick
lines are pasted verbatim from a real run, so the probabilities are measured.
"""
import pathlib, sys
from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).parent
FONT = ImageFont.truetype(sys.argv[1] if len(sys.argv) > 1 else "DejaVuSansMono.ttf", 15)
W, H, PAD, LH = 980, 340, 18, 21
BG, FG, DIM, GRN, YEL, CYA, RED = "#0d1117", "#e6edf3", "#7d8590", "#3fb950", "#d29922", "#58a6ff", "#f85149"

ticks = [l.rstrip() for l in (HERE / "transcript.txt").read_text().splitlines() if l.startswith("tick")]
model = (HERE / "model.txt").read_text().strip() if (HERE / "model.txt").exists() else "typesafe/jev-latest"

script = [
    ("cmd", 'openclaw-jev-trigger \\'),
    ("cont", '  --when "The work in this thread is finished" \\'),
    ("cont", '  --not-when "only waiting for a reply, CI, or a job" \\'),
    ("cont", '  --exec "tail -n 2 thread.log" > watch.js'),
    ("cmd", 'openclaw automations add --every 30s --trigger-script watch.js \\'),
    ("cont", '  --command "echo woke the model"     # stand-in for --message'),
    ("out", f"# decisionModel: {model}  (condition text shortened here; full: demo/record.sh)"),
] + [("tick", t) for t in ticks]

frames, durations = [], []
lines = []  # (kind, text) fully shown


def draw(partial=None):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    for i, c in enumerate([RED, YEL, GRN]):
        d.ellipse((PAD + i * 20, 12, PAD + i * 20 + 12, 24), fill=c)
    d.text((W // 2 - 150, 9), "Jev × OpenClaw — natural-language trigger", font=FONT, fill=DIM)
    y = 44
    for kind, text in lines + ([partial] if partial else []):
        if kind == "cmd":
            d.text((PAD, y), "$ ", font=FONT, fill=GRN)
            d.text((PAD + 18, y), text, font=FONT, fill=FG)
        elif kind == "cont":
            d.text((PAD + 18, y), text, font=FONT, fill=FG)
        elif kind == "out":
            d.text((PAD, y), text, font=FONT, fill=DIM)
        else:
            head, _, verdict = text.partition("→")
            d.text((PAD, y), head, font=FONT, fill=FG)
            x = PAD + d.textlength(head, font=FONT)
            d.text((x, y), "→" + verdict, font=FONT, fill=YEL if "FIRE" in verdict else DIM)
        y += LH + (6 if kind == "out" else 0)
    return img


for kind, text in script:
    if kind in ("cmd", "cont"):
        step = 3
        for n in range(0, len(text) + 1, step):
            frames.append(draw((kind, text[:n])))
            durations.append(28)
        lines.append((kind, text))
        frames.append(draw()); durations.append(350)
    else:
        lines.append((kind, text))
        frames.append(draw()); durations.append(1300 if kind == "tick" else 600)
durations[-1] = 4000

out = HERE / "demo.gif"
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print(f"wrote {out} ({len(frames)} frames, {out.stat().st_size // 1024} KB)")
