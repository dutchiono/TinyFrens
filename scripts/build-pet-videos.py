"""Create local H.264/AAC pet loops for Safari Picture in Picture."""
from pathlib import Path
from PIL import Image, ImageDraw
import subprocess, math, tempfile, argparse
PALETTE={'purple':'#a474f1','cyan':'#66c7d2','amber':'#ffb95e','mint':'#82eba1','pink':'#ee8fb9','blue':'#83a9ff'}
parser=argparse.ArgumentParser();parser.add_argument('--output',default='web/pip');args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
for shape in ['cat','blob','robot']:
 for name,color in PALETTE.items():
  path=out/f'{shape}-{name}.mp4'
  with tempfile.TemporaryDirectory() as tmp:
   for frame in range(90):
    im=Image.new('RGB',(320,240),'#17142a');d=ImageDraw.Draw(im)
    phase=frame/15*math.pi*2;cx=160+int(24*math.sin(phase/3));cy=130-int(5*abs(math.sin(phase)))
    # Render at video resolution: repeatable pixel geometry, no font dependencies.
    def r(x,y,w,h,c):d.rectangle((cx+x,cy+y,cx+x+w-1,cy+y+h-1),fill=c)
    dark='#35204e';blush='#ff82a7'
    d.ellipse((cx-47,190,cx+47,200),fill='#100d20')
    if shape=='cat':
     r(-42,-62,22,38,dark);r(20,-62,22,38,dark);r(-37,-57,12,27,color);r(25,-57,12,27,color)
     d.rounded_rectangle((cx-48,cy-35,cx+48,cy+40),radius=22,fill=dark)
     d.rounded_rectangle((cx-41,cy-29,cx+41,cy+33),radius=18,fill=color)
    elif shape=='blob':
     d.rounded_rectangle((cx-52,cy-37,cx+52,cy+44),radius=36,fill=dark)
     d.rounded_rectangle((cx-45,cy-30,cx+45,cy+37),radius=30,fill=color)
    else:
     r(-4,-64,8,30,dark);r(-10,-70,20,12,color)
     d.rounded_rectangle((cx-48,cy-40,cx+48,cy+40),radius=5,fill=dark)
     r(-41,-33,82,66,color)
    if frame%60<4:r(-25,-8,14,4,dark);r(14,-8,14,4,dark)
    else:r(-25,-17,14,19,dark);r(14,-17,14,19,dark);r(-22,-16,4,4,'white');r(17,-16,4,4,'white')
    r(-36,6,14,7,blush);r(26,6,14,7,blush);r(-4,13,8,5,dark)
    step=int(3*math.sin(phase));r(-29,38+step,20,9,dark);r(10,38-step,20,9,dark)
    d.text((125,215),'TinyFrens',fill='#cbb6ff')
    im.save(Path(tmp)/f'{frame:03}.png')
   subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','15','-i',str(Path(tmp)/'%03d.png'),'-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t','6','-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-profile:v','baseline','-level','3.0','-crf','23','-c:a','aac','-b:a','32k','-movflags','+faststart','-shortest',str(Path(tmp)/'output.mp4')],check=True)
   path.write_bytes((Path(tmp)/'output.mp4').read_bytes())
