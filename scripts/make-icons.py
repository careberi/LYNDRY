#!/usr/bin/env python3
"""
Cut every logo file the site serves from the one piece of artwork.

CLAUDE.md is emphatic that the mark is ARTWORK and is never re-derived - the
favicon was hand-drawn in CSS once, came out as a green rounded rectangle, and
Neil found it in a Google result: "That is not my logo." The rule that replaced
it is "if the logo changes, regenerate these from it; never redraw one", and
until now that was an instruction with nothing to run. This is the something.

WHY PYTHON IN A NODE REPO. There is no image library in package.json and there
should not be: this runs by hand on the rare day the mark changes, and adding
sharp would put a native build step into a deploy that never needs one. Pillow
is already on this machine. The OUTPUT is what ships; this file is the record
of how it was cut.

    python scripts/make-icons.py            # say what it would write
    python scripts/make-icons.py --write    # write it

TWO BACKGROUNDS, AND THE DIFFERENCE IS NOT COSMETIC. Favicons are transparent,
because Google shows them in a circle of its own colour. Home-screen icons are
solid cream, because iOS paints a transparent home-screen icon BLACK.
"""

import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'assets', 'logo-source-colour.png')

# --paper-100, the page ground. The same cream the ops icons already carried.
CREAM = (255, 248, 236, 255)

# --suds-500, the brand green the contact photo sits on.
SUDS = (14, 164, 122)

# The mark on the page: 600px wide is what the old one was, and it is plenty -
# the largest placement is 132px tall. It lives in public/css so assets.js
# fingerprints it, which is what makes a new logo actually reach a browser that
# has the old one cached.
PAGE_WIDTH = 600

# How much of a square icon the mark fills. Favicons can run close to the edge
# because nothing crops them; a home-screen icon is rounded off by the phone, so
# it is pulled in further to keep the bag's corners clear of the curve.
FAVICON_FILL = 0.88
HOMESCREEN_FILL = 0.76

WRITE = '--write' in sys.argv


def load():
    art = Image.open(SOURCE).convert('RGBA')
    # The canvas carries a few pixels of empty margin; crop to the ink so every
    # size below is framed on the MARK rather than on whatever the export left
    # around it.
    return art.crop(art.getbbox())


# The mark is flat: cream, ink, and a few shading tones. A full-colour PNG of it
# is around ten times the size of a quantised one for no visible gain, and this
# file is fetched on every page. FASTOCTREE is the one PIL method that keeps an
# alpha channel through the quantise - the others drop it and the bag comes back
# as a rectangle.
QUANTISE_COLOURS = 64


def squeeze(im):
    if im.mode == 'RGB':
        return im.quantize(colors=QUANTISE_COLOURS)
    return im.quantize(colors=QUANTISE_COLOURS, method=Image.FASTOCTREE)


def save(im, *path):
    out = os.path.join(ROOT, *path)
    rel = os.path.relpath(out, ROOT).replace(os.sep, '/')
    if not WRITE:
        print(f'  would write  {rel:34} {im.size[0]}x{im.size[1]}')
        return
    os.makedirs(os.path.dirname(out), exist_ok=True)
    squeeze(im).save(out, optimize=True)
    print(f'  wrote        {rel:34} {im.size[0]}x{im.size[1]}  '
          f'{os.path.getsize(out) / 1024:.0f} KB')


def fitted(art, box, fill, background):
    """The mark centred in a square, at `fill` of its width."""
    target = round(box * fill)
    w, h = art.size
    scaled = art.resize((target, round(h * target / w)), Image.LANCZOS)

    canvas = Image.new('RGBA', (box, box), background)
    canvas.paste(scaled,
                 ((box - scaled.size[0]) // 2, (box - scaled.size[1]) // 2),
                 scaled)
    return canvas


def main():
    if not os.path.exists(SOURCE):
        sys.exit(f'No artwork at {SOURCE}')

    art = load()
    print(f'Artwork: {art.size[0]}x{art.size[1]} from '
          f'{os.path.relpath(SOURCE, ROOT)}')
    print()

    # 1. The mark itself.
    w, h = art.size
    page = art.resize((PAGE_WIDTH, round(h * PAGE_WIDTH / w)), Image.LANCZOS)
    save(page, 'public', 'css', 'logo.png')

    print(f'\n  aspect-ratio for .ly-logo__mark is '
          f'{page.size[0]} / {page.size[1]}\n')

    # 2. Favicons - transparent, because Google draws its own circle behind one.
    for size in (48, 96, 192, 512):
        save(fitted(art, size, FAVICON_FILL, (0, 0, 0, 0)),
             'public', 'icons', f'favicon-{size}.png')

    ico = fitted(art, 48, FAVICON_FILL, (0, 0, 0, 0))
    if WRITE:
        ico.save(os.path.join(ROOT, 'public', 'icons', 'favicon.ico'),
                 sizes=[(48, 48)])  # .ico carries its own compression
        print('  wrote        public/icons/favicon.ico            48x48')
    else:
        print('  would write  public/icons/favicon.ico            48x48')

    # 3. Home-screen icons - solid cream, or iOS paints the transparency black.
    save(fitted(art, 180, HOMESCREEN_FILL, CREAM).convert('RGB'),
         'public', 'icons', 'apple-touch-icon.png')

    for size in (192, 512):
        save(fitted(art, size, HOMESCREEN_FILL, CREAM).convert('RGB'),
             'public', 'icons', f'app-icon-{size}.png')

    # 4. The contact photo the vCard carries.
    #
    # A phone crops a contact photo to a CIRCLE, so what has to fit is the
    # mark's DIAGONAL, not its width - and that is why this is derived rather
    # than a number copied from the old file. The old mark was nearly square and
    # 356px wide put its diagonal at about 482px inside the 512px circle; this
    # one is wider, so the same 356 would push its corners outside the crop.
    #
    # The ground is brand green rather than transparency, because a transparent
    # photo sits on whatever the handset paints behind it - white in light mode,
    # near-black in dark - and the mark's ink outline vanishes into one of them.
    box, diagonal = 512, 482
    ratio = art.size[1] / art.size[0]
    width = round(diagonal / (1 + ratio ** 2) ** 0.5)

    mark = art.resize((width, round(width * ratio)), Image.LANCZOS)
    photo = Image.new('RGB', (box, box), SUDS)
    photo.paste(mark,
                ((box - mark.size[0]) // 2, (box - mark.size[1]) // 2),
                mark)

    out = os.path.join(ROOT, 'src', 'web', 'contact-photo.jpg')
    if WRITE:
        photo.save(out, quality=90)
        print(f'  wrote        src/web/contact-photo.jpg          {box}x{box}  '
              f'{os.path.getsize(out) / 1024:.0f} KB  (mark {mark.size[0]}px wide)')
    else:
        print(f'  would write  src/web/contact-photo.jpg          {box}x{box}'
              f'  (mark {mark.size[0]}px wide)')

    if not WRITE:
        print('\nDry run. Pass --write to actually replace them.')


main()
