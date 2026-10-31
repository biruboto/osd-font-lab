```
   ___  ___ ___    ___        _     _         _    
  / _ \/ __|   \  | __|__ _ _| |_  | |   __ _| |__ 
 | (_) \__ \ |) | | _/ _ \ ' \  _| | |__/ _` | '_ \
  \___/|___/___/  |_|\___/_||_\__| |____\__,_|_.__/
                                                  
```
OSD Font Lab is a web application designed to help you create custom fonts for analog FPV OSDs (Betaflight).

10.31.2026 OSD FONT LAB LIVES!
+ Layout overhaul for desktop, tablet and phone, with clearer controls and collapsible tools.
+ Glyph sheet now flows to fit your screen while keeping crisp integer scaling. PNG exports stay in the standard 16×16 format.
+ Huge font and library picker overhaul, including search.
+ Independent sheet and inspector zoom controls, with Auto fitting and +/− buttons.
+ Copy cell / Paste cell, including copying between fonts.
+ 20-step undo for editor strokes and cell pastes.
+ Faster previews and lighter logo animation, with reduced-motion support. Significant performance improvements.
+ Fixes for MCM transparency, edits after nudging, and rapid font switching.
+ FC uploads now support cancellation and better timeout/disconnect handling.
+ Improved TTF import.
+ Two new color schemes: Field Notes and Afterburn.

02.27.2026
+ Direct upload to flight controller support! Thanks to an implementation by [BUSHA](https://vtx.in.ua/max7456/), in Chromium based browsers OSD Font Lab can now upload your font creation directly to your quad.

02.26.2026
+ Added OSD | BOOT toggle in HUD view so custom boot logo can now be previewed in that view.
+ Added export boot logo option. Can export to native OSDFL format (PNG with gray background) or BTFL format (BMP with green background). Note that OSDFL can import either format.

02.25.2026
+ New *experimental* TTF import support! There are plenty of reasons why importing a modern TTF font into such a limited bitmap space isn't as straightforward as you may think, but TTF support is generally the first question I get about Font Lab from people, so here it is! Results will vary wildly in quality, because of the nature of proportional fonts, hinting, ascenders/descenders, etc, but in my own testing I got surprisingly usable results out of a lot of fonts. Play around with it and see for yourself. Have fun!
+ Added lowercase support. Don't want all caps? Flip the "case" toggle to L for lowercase A-Z. *Note that not all fonts HAVE lowercase letters.*

02.21.2026
+ 92 new fonts in the ZX library! New crosshair sprites: gbpanda, meowth, and ryuhiko.

02.18.2026
+ New emoji support! Replace safe characters with emoji for use in PILOT NAME or CRAFT NAME, etc, or turn safe mode off and replace any glyph with an emoji. 500+ emoji from pixel artist Idan Rooze. Also lots of performance tweaks

02.16.2026
+ Added 8-neighbor stroke style option for slightly heavier outlines

02.15.2026
+ New NFG's Arcade Font Engine library (170 fonts)

02.14.2026
+ New Amstrad CPC font library (44 new fonts)
+ New ZX Spectrum font library (55 new fonts)
+ New BBC Micro font library (89 new fonts)
+ New Oldschool PC font library (163 fonts)

02.13.2026
+ New HUD VIEW! Preview your OSD in an in-goggles style overlay on a flight background. Toggle common elements on/off, drag elements to your layout, switch NTSC/PAL safe areas, and compare changes live against the glyph sheet.
+ New boot logo support! Import a 288x72px BMP or PNG and inject it into your font.
+ New pixel editor! Ability to manually edit single glyphs pixel-by-pixel.
