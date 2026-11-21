# P1.5a sheet: per page old | new, the frame (half size) with a 1:1 crop of the hero under it.
from PIL import Image, ImageDraw
D = 'work/captures/P1-5a/'
ROWS = [('flagship (Parkouring, voxel)', 'flagship', (320, 160)), ('vdb-sky (EmberGen cloudpack-02, route A direct)', 'vdbsky', (350, 250))]
W, H, L = 640, 360, 22
sheet = Image.new('RGB', (2 * W, len(ROWS) * (L + 2 * H)), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for r, (title, key, (cx, cy)) in enumerate(ROWS):
    y0 = r * (L + 2 * H)
    for c, v in enumerate(['old', 'new']):
        im = Image.open(f'{D}{key}-{v}/view.png').convert('RGB')
        x0 = c * W
        sheet.paste(im.resize((W, H), Image.LANCZOS), (x0, y0 + L))
        sheet.paste(im.crop((cx, cy, cx + W, cy + H)), (x0, y0 + L + H))
        d.text((x0 + 6, y0 + 5), f"{title}: {'old (page default, nubis)' if v == 'old' else 'new (?light=fit)'}  | below: 1:1 crop", fill=(255, 255, 255))
sheet.save(D + 'sheet.jpg', quality=82)
