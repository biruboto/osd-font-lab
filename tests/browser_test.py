"""Browser regressions: python -m unittest discover -s tests -p '*_test.py' -v."""
import asyncio
import functools
import json
import os
from pathlib import Path
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class BrowserTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join()

    async def asyncSetUp(self):
        asyncio.get_running_loop().set_debug(False)
        self.pw = await async_playwright().start()
        channel = os.environ.get('OSDFL_BROWSER_CHANNEL', 'msedge' if os.name == 'nt' else '')
        if channel == 'chromium':
            channel = ''  # use Playwright's installed Chromium
        self.browser = await self.pw.chromium.launch(headless=True, **({'channel': channel} if channel else {}))
        self.context = await self.browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, has_touch=True)
        self.page = await self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        # Deterministic letter choices and glitch timing keep checks repeatable.
        await self.context.add_init_script('Math.random = () => 0.5;')
        await self.load_default(self.page)

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()
        self.assertEqual(self.errors, [], 'unexpected browser errors')

    async def load_default(self, page):
        await page.goto(self.url, wait_until='networkidle')
        await page.locator('#bfFontSelect + .fontpicker').wait_for()
        await page.select_option('#bfFontSelect', 'betaflight.mcm')
        await page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded: betaflight.mcm')")

    async def download(self, selector):
        async with self.page.expect_download() as info:
            await self.page.locator(selector).click()
        result = await info.value
        return result.suggested_filename, Path(await result.path()).read_bytes()

    async def font(self, page=None):
        page = page or self.page
        async with page.expect_download() as info:
            await page.locator('#exportMCM').click()
        result = await info.value
        return await page.evaluate("""async text => {
          const {decodeMCM}=await import('/js/mcm.js');
          return decodeMCM(new TextEncoder().encode(text).buffer).glyphs.map(g=>Array.from(g));
        }""", Path(await result.path()).read_text())

    async def select_glyph_one(self):
        await self.select_glyph(1)

    async def select_glyph(self, index):
        point = await self.glyph_point(self.page, index)
        await self.page.mouse.click(point['x'], point['y'])

    async def glyph_point(self, page, index):
        return await page.locator('#resultGrid').evaluate("""(c,index) => {
          const cols=Number(c.dataset.columns),s=Number(c.dataset.scale),w=12*s,h=18*s;
          const x=(index%cols+0.5)*w,y=(Math.floor(index/cols)+0.5)*h;
          c.parentElement.scrollTop=Math.max(0,y-c.parentElement.clientHeight/2);
          c.parentElement.scrollLeft=Math.max(0,x-c.parentElement.clientWidth/2);
          const r=c.getBoundingClientRect();return {x:r.x+x,y:r.y+y};
        }""", index)

    async def settle_frames(self, page):
        await page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')

    async def test_theme_pixels_and_selection_render_budget(self):
        baseline = json.loads((ROOT/'tests/fixtures/render-baseline.json').read_text())
        # Check the original pixels at their original geometry, independently
        # of the new responsive column count.
        await self.page.locator('.sheet-wrap').evaluate("""e=>{
          e.style.width=(576+e.offsetWidth-e.clientWidth)+'px'; e.style.maxHeight='864px';
        }""")
        await self.page.select_option('#sheetZoom','3')
        await self.page.wait_for_function("document.querySelector('#resultGrid').dataset.columns==='16'")
        await self.page.locator('#appearanceTools > summary').click()
        for theme, expected in baseline.items():
            await self.page.locator(f'input[name="siteTheme"][value="{theme}"]').check()
            actual = await self.page.evaluate("""async () => Object.fromEntries(await Promise.all(
              ['resultGrid','resultZoom','bootSplashPreview'].map(async id => {
                const c=document.getElementById(id), pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',pixels));
                return [id,{width:c.width,height:c.height,sha256:Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')}];
              })))""")
            self.assertEqual(actual, expected, theme)
        await self.page.locator('.sheet-wrap').evaluate("e=>{e.style.removeProperty('width');e.style.removeProperty('max-height')}")
        await self.page.select_option('#sheetZoom','auto')
        await self.settle_frames(self.page)
        samples = await self.page.evaluate("""() => {
          const original=window.getComputedStyle; let reads=0; window.getComputedStyle=(...a)=>{reads++;return original(...a)};
          const c=document.querySelector('#resultGrid'), r=c.getBoundingClientRect(), samples=[];
          try { for(let i=0;i<3;i++){ reads=0;const start=performance.now();c.dispatchEvent(new MouseEvent('click',{clientX:r.x+36*i+18,clientY:r.y+18,bubbles:true}));samples.push({ms:performance.now()-start,styleReads:reads}); } }
          finally {window.getComputedStyle=original;} return samples;
        }""")
        print('\nSelection render samples:', json.dumps(samples), flush=True)
        self.assertTrue(all(s['styleReads'] < 100 for s in samples), samples)

    async def test_keyboard_touch_and_mouse_nudge_each_apply_once(self):
        await self.select_glyph_one()
        initial = (await self.font())[1]
        button = self.page.locator('.dpad[data-nudge-target="selection"] button[data-dx="1"]')
        for activation in ['keyboard', 'touch', 'mouse']:
            if activation == 'keyboard':
                await button.focus()
                await self.page.keyboard.press('Enter')
            elif activation == 'touch':
                await button.tap()
            else:
                await button.click()
            current = (await self.font())[1]
            self.assertEqual(current, shift(initial, 1), activation)
            initial = current

    async def test_paint_with_nudges_survives_rebuild_and_undo(self):
        await self.select_glyph_one()
        button = self.page.locator('.dpad[data-nudge-target="selection"] button[data-dx="1"]')
        await button.click()
        before = (await self.font())[1]
        await self.page.locator('#zoomModeEditor').click()
        pixel = before.index(1)
        box = await self.page.locator('#resultZoom').bounding_box()
        await self.page.locator('#resultZoom').click(position={'x': (pixel % 12 + 0.5)*box['width']/12,
                                                            'y': (pixel // 12 + 0.5)*box['height']/18})
        painted = (await self.font())[1]
        self.assertNotEqual(painted, before)
        await self.page.locator('#caseLowerBtn').click()  # no overlay: unrelated document rebuild
        self.assertEqual((await self.font())[1], painted)
        await button.click()
        self.assertEqual((await self.font())[1], shift(painted, 1))
        await self.page.locator('#editorUndoBtn').click()
        self.assertEqual((await self.font())[1], shift(before, 1))
        await self.page.locator('#caseUpperBtn').click()
        self.assertEqual((await self.font())[1], shift(before, 1))

    async def test_latest_font_selection_wins_even_when_older_response_arrives_last(self):
        await self.page.select_option('#overlaySelect', '__lib:cpc')
        await self.page.wait_for_function("Array.from(document.querySelector('#overlaySelect').options).some(o=>o.value==='alarm8x8.json')")
        base = await self.font()
        async with self.page.expect_response('**/alarm8x8.json') as loaded:
            await self.page.select_option('#overlaySelect', 'alarm8x8.json')
        await (await loaded.value).body()
        await self.settle_frames(self.page)
        expected = await self.font()
        self.assertTrue(expected != base, 'fixture must actually apply an overlay')
        other = await self.context.new_page()
        await self.load_default(other)
        await other.select_option('#overlaySelect', '__lib:cpc')
        await other.wait_for_function("Array.from(document.querySelector('#overlaySelect').options).some(o=>o.value==='alarm8x8.json')")
        async def delay_old(route):
            if route.request.url.endswith('/alarm8x5.json'):
                await asyncio.sleep(0.35)
            await route.continue_()
        await other.route('**/fonts/data/cpc/**', delay_old)
        async with other.expect_response('**/alarm8x5.json') as older:
            await other.select_option('#overlaySelect', 'alarm8x5.json')
            await other.select_option('#overlaySelect', 'alarm8x8.json')
        await (await older.value).body()
        await self.settle_frames(other)
        self.assertTrue(await self.font(other) == expected, 'export must match the latest selected font')

    async def test_global_and_per_glyph_nudges_are_not_baked_twice_when_painting(self):
        await self.page.locator('#yaffFile').set_input_files({'name': 'fixture.yaff', 'mimeType': 'text/plain',
            'buffer': b'u+0041:\n    .@.\n    @.@\n    @@@\n'})
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded YAFF')")
        await self.select_glyph(65)
        global_right = self.page.locator('.dpad[data-nudge-target="replaced"] button[data-dx="1"]')
        single_right = self.page.locator('.dpad[data-nudge-target="selection"] button[data-dx="1"]')
        await global_right.click()
        await single_right.click()
        before = (await self.font())[65]
        await self.page.locator('#zoomModeEditor').click()
        await self.page.locator('#resultZoom').click(position={'x': 6, 'y': 6})
        painted = (await self.font())[65]
        self.assertNotEqual(painted, before)
        await self.page.locator('#caseLowerBtn').click()
        self.assertEqual((await self.font())[65], painted)
        await global_right.click()
        await single_right.click()
        self.assertEqual((await self.font())[65], shift(painted, 2))
        await self.page.locator('#editorUndoBtn').click()
        self.assertEqual((await self.font())[65], shift(before, 2))

    async def test_latest_default_selection_wins(self):
        async def delay_old(route):
            await asyncio.sleep(0.35)
            await route.continue_()
        await self.page.route('**/fonts/betaflight/bold.mcm', delay_old)
        async with self.page.expect_response('**/fonts/betaflight/bold.mcm') as older:
            await self.page.select_option('#bfFontSelect', 'bold.mcm')
            await self.page.select_option('#bfFontSelect', 'clarity.mcm')
        await (await older.value).body()
        await self.settle_frames(self.page)
        expected = await self.page.evaluate("""async () => {
          const {decodeMCM}=await import('/js/mcm.js');
          return decodeMCM(await (await fetch('/fonts/betaflight/clarity.mcm')).arrayBuffer()).glyphs.map(g=>Array.from(g));
        }""")
        self.assertTrue(await self.font() == expected, 'late default response overwrote the latest base')

    async def test_clean_sheet_and_boot_exports_roundtrip(self):
        initial = await self.font()
        _, png = await self.download('#exportPNG1x')
        await self.page.locator('#file').set_input_files({'name': 'roundtrip.png', 'mimeType': 'image/png', 'buffer': png})
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded PNG')")
        self.assertTrue(await self.font() == initial, 'PNG roundtrip changed font pixels')
        for button in ['#bootLogoFmtNativeBtn', '#bootLogoFmtBfBtn']:
            if await self.page.locator('#bootTools').get_attribute('open') is None:
                await self.page.locator('#bootTools > summary').click()
            await self.page.locator(button).click()
            name, data = await self.download('#bootLogoExportBtn')
            await self.page.locator('#bootSplashFile').set_input_files({'name': name, 'mimeType': 'image/png' if name.endswith('.png') else 'image/bmp', 'buffer': data})
            await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded boot logo')")
            self.assertTrue(await self.font() == initial, f'{name} roundtrip changed font pixels')

    async def test_upload_cancel_uses_fake_device_and_releases_streams(self):
        await self.page.evaluate("""() => {
          let input;
          const readable=new ReadableStream({start(c){input=c}});
          const writes=[];
          const writable=new WritableStream({write(data){
            writes.push(Array.from(data));
            const cmd=data[4]; if(cmd===87)return; // simulate a silent character write
            const payload=cmd===1?[0,1,46]:cmd===2?[66,84,70,76]:cmd===3?[4,5,0]:[32];
            let checksum=payload.length^cmd;for(const b of payload)checksum^=b;
            input.enqueue(Uint8Array.from([36,77,62,payload.length,cmd,...payload,checksum]));
          }});
          window.fakeDevice={readable,writable,writes,closed:false};
          Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async()=>({
            readable,writable,open:async()=>{},close:async()=>{fakeDevice.closed=true}
          })}});
        }""")
        self.page.on('dialog', lambda d: d.accept())
        await self.page.locator('#uploadFC').click()
        await self.page.wait_for_function("document.querySelector('#uploadFC').textContent.includes('0%')")
        await self.page.locator('#uploadFC').click()
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Upload canceled') && !document.querySelector('#uploadFC').disabled")
        self.assertEqual(await self.page.evaluate("""() => ({
          closed:fakeDevice.closed,readLocked:fakeDevice.readable.locked,writeLocked:fakeDevice.writable.locked,
          characters:fakeDevice.writes.filter(v=>v[4]===87).length
        })"""), {'closed': True, 'readLocked': False, 'writeLocked': False, 'characters': 1})

    async def test_responsive_workspace_has_no_page_overflow_in_all_views(self):
        sizes = [(2560,1440),(1920,1080),(1440,900),(1366,768),(1280,720),(1024,768),
                 (961,800),(960,800),(768,1024),(390,844),(360,800),(360,640),(844,390),(720,450)]
        for w,h in sizes:
            await self.page.set_viewport_size({'width': w, 'height': h})
            for panel in (['preview','edit','tools'] if w <= 960 else ['preview']):
                if w <= 960:
                    await self.page.locator(f'[data-workspace-target="{panel}"]').click()
                if panel != 'edit':
                    for mode in (['sheet','hud'] if panel == 'preview' else ['sheet']):
                        if panel == 'preview':
                            await self.page.locator('#viewMode' + mode.title()).click()
                        await self.settle_frames(self.page)
                        metrics = await self.page.evaluate("""() => {
                          const root=document.documentElement, panel=document.querySelector('.panel-result').getBoundingClientRect(),
                            inspector=document.querySelector('.sidecar').getBoundingClientRect(),sheet=document.querySelector('#resultGrid').getBoundingClientRect();
                          return {overflow:root.scrollWidth>root.clientWidth+1,
                            inspectorEscapes:inspector.width>0&&(inspector.right>panel.right+1||inspector.left<panel.left-1),
                            sheetClipped:sheet.width>0&&(sheet.left<0||sheet.right>innerWidth),
                            sheetWidth:sheet.width,sheetHeight:sheet.height,
                            height:root.scrollHeight};
                        }""")
                        self.assertFalse(metrics['overflow'], (w,h,panel,mode,metrics))
                        self.assertFalse(metrics['inspectorEscapes'], (w,h,panel,mode,metrics))
                        self.assertFalse(metrics['sheetClipped'], (w,h,panel,mode,metrics))
                        if panel == 'preview' and mode == 'sheet':
                            self.assertGreater(metrics['sheetWidth'], 20, (w,h,panel,mode,metrics))
                            self.assertGreater(metrics['sheetHeight'], 30, (w,h,panel,mode,metrics))
                else:
                    self.assertTrue(await self.page.locator('#resultZoom').is_visible())
        await self.page.set_viewport_size({'width':390,'height':844})
        await self.page.locator('[data-workspace-target="tools"]').click()
        for section in ['iconTools','emojiTools','bootTools','appearanceTools']:
            if await self.page.locator('#'+section).get_attribute('open') is None:
                await self.page.locator('#'+section+' > summary').click()
        for select in ['bfFontSelect','overlaySelect','swapTargetSelect']:
            await self.page.locator('#'+select+' + .fontpicker .fontpicker-btn').click()
            self.assertFalse(await self.page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1'), select)
            await self.page.keyboard.press('Escape')

    async def test_mobile_zoom_pan_touch_selection_and_resize_preserve_the_font(self):
        original = await self.font()
        await self.page.set_viewport_size({'width':390,'height':844})
        await self.page.locator('[data-workspace-target="preview"]').click()
        await self.page.locator('#viewModeSheet').click()
        await self.page.select_option('#sheetZoom', '3')
        await self.settle_frames(self.page)
        point = await self.glyph_point(self.page, 255)
        await self.page.touchscreen.tap(point['x'],point['y'])
        await self.page.locator('[data-workspace-target="edit"]').click()
        self.assertIn('0xFF', await self.page.locator('#glyphInfo').inner_text())
        self.assertTrue(await self.font() == original, 'selection and zoom must not edit the font')
        await self.page.set_viewport_size({'width':1440,'height':900})
        await self.settle_frames(self.page)
        self.assertTrue(await self.page.locator('#resultGrid').is_visible())
        self.assertTrue(await self.page.locator('#resultZoom').is_visible())
        self.assertTrue(await self.font() == original, 'resizing must not edit the font')

    async def test_high_dpi_phone_touch_paints_the_selected_logical_pixel(self):
        context = await self.browser.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True)
        page = await context.new_page()
        page.on('pageerror', lambda e: self.errors.append(str(e)))
        await self.load_default(page)
        original = await self.font(page)
        point = await self.glyph_point(page,65)
        await page.touchscreen.tap(point['x'],point['y'])
        await page.locator('[data-workspace-target="edit"]').click()
        await self.settle_frames(page)
        self.assertIn('0x41', await page.locator('#glyphInfo').inner_text())
        await page.select_option('#inspectorZoom','8')
        await page.wait_for_function("document.querySelector('#resultZoom').dataset.scale==='8'")
        await page.locator('#zoomModeEditor').click()
        await page.locator('.editor-color-btn[data-editor-color="2"]').click()
        pixel = original[65].index(1)
        box = await page.locator('#resultZoom').bounding_box()
        await page.touchscreen.tap(box['x']+(pixel%12+0.5)*box['width']/12,box['y']+(pixel//12+0.5)*box['height']/18)
        expected = [glyph[:] for glyph in original]
        expected[65][pixel] = 2
        self.assertTrue(await self.font(page) == expected, 'touch painting must map CSS pixels to the correct glyph pixel at DPR 2')
        await context.close()

    async def test_saved_hud_mode_remains_sized_after_mobile_tools_and_resize(self):
        await self.page.locator('#viewModeHud').click()
        await self.page.set_viewport_size({'width':390,'height':844})
        await self.page.reload(wait_until='networkidle')
        self.assertTrue(await self.page.locator('#toolsPane').is_visible())
        await self.page.locator('[data-workspace-target="preview"]').click()
        await self.settle_frames(self.page)
        before = await self.page.locator('#resultHud').bounding_box()
        self.assertGreater(before['width'], 250)
        self.assertAlmostEqual(before['width']/before['height'],16/9,places=2)
        await self.page.locator('[data-workspace-target="tools"]').click()
        await self.page.set_viewport_size({'width':1024,'height':768})
        await self.settle_frames(self.page)
        after = await self.page.locator('#resultHud').bounding_box()
        self.assertGreater(after['width'],before['width'])
        self.assertAlmostEqual(after['width']/after['height'],16/9,places=2)

    async def test_sheet_reflows_at_integer_zoom_and_png_exports_stay_standard(self):
        original = await self.font()
        exports = {}
        for scale in [1,3]:
            _, data = await self.download(f'#exportPNG{scale}x')
            self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
            self.assertEqual((int.from_bytes(data[16:20]),int.from_bytes(data[20:24])), (192*scale,288*scale))
            exports[scale] = data
        await self.page.select_option('#sheetZoom','3')
        await self.settle_frames(self.page)
        await self.select_glyph(65)
        column_counts = []
        for w,h in [(1440,900),(1280,720),(1920,1080),(390,844)]:
            await self.page.set_viewport_size({'width':w,'height':h})
            if w <= 960:
                await self.page.locator('[data-workspace-target="preview"]').click()
            await self.settle_frames(self.page)
            layout = await self.page.locator('#resultGrid').evaluate("""c=>{
              const r=c.getBoundingClientRect(),cols=Number(c.dataset.columns),scale=Number(c.dataset.scale);
              return {cols,scale,w:c.width,h:c.height,cssW:r.width,cssH:r.height,
                capacity:Math.floor(c.parentElement.clientWidth/(12*scale)),horizontalScroll:c.parentElement.scrollWidth>c.parentElement.clientWidth};
            }""")
            self.assertEqual(layout['scale'],3)
            self.assertEqual(layout['cols'],layout['capacity'])
            self.assertEqual(layout['w'],layout['cols']*36)
            self.assertEqual(layout['h'],((256+layout['cols']-1)//layout['cols'])*54)
            self.assertEqual(layout['w'],layout['cssW'])
            self.assertEqual(layout['h'],layout['cssH'])
            self.assertFalse(layout['horizontalScroll'],layout)
            column_counts.append(layout['cols'])
            self.assertIn('0x41', await self.page.locator('#glyphInfo').inner_text())
        self.assertGreater(len(set(column_counts)),1)
        # The unused cells in the final row have no glyph index.
        if 256 % column_counts[-1]:
            point = await self.glyph_point(self.page,256)
            await self.page.touchscreen.tap(point['x'],point['y'])
            self.assertIn('0x41', await self.page.locator('#glyphInfo').inner_text())
        self.assertTrue(await self.font() == original, 'reflow changed document pixels')
        for scale in [1,3]:
            _, data = await self.download(f'#exportPNG{scale}x')
            self.assertEqual(data,exports[scale],f'{scale}x PNG changed after reflow')


    async def test_independent_inspector_zoom_reduces_height_and_preserves_edits_and_exports(self):
        await self.page.set_viewport_size({'width':1366,'height':768})
        await self.page.select_option('#sheetZoom','2')
        await self.select_glyph(65)
        original = await self.font()
        _, png = await self.download('#exportPNG1x')
        await self.page.select_option('#inspectorZoom','16')
        await self.page.wait_for_function("document.querySelector('#resultZoom').dataset.scale==='16'")
        large = await self.page.locator('.panel-result').bounding_box()
        sheet = await self.page.locator('#resultGrid').evaluate('c=>[c.width,c.height,c.dataset.columns,c.dataset.scale]')
        await self.page.select_option('#inspectorZoom','8')
        await self.page.wait_for_function("document.querySelector('#resultZoom').dataset.scale==='8'")
        small = await self.page.locator('.panel-result').bounding_box()
        self.assertGreater(large['height']-small['height'],100)
        self.assertEqual(await self.page.locator('#resultZoom').evaluate('c=>[c.width,c.height,c.getBoundingClientRect().width,c.getBoundingClientRect().height]'),[96,144,96,144])
        self.assertEqual(await self.page.locator('#resultGrid').evaluate('c=>[c.width,c.height,c.dataset.columns,c.dataset.scale]'),sheet)
        self.assertTrue(await self.font() == original)
        self.assertEqual((await self.download('#exportPNG1x'))[1],png)
        self.assertTrue(await self.page.evaluate("Math.abs(document.querySelector('#sheetZoom').getBoundingClientRect().right-document.querySelector('#resultGrid').getBoundingClientRect().right)<1"))
        await self.page.locator('#zoomModeEditor').click()
        await self.page.locator('.editor-color-btn[data-editor-color="2"]').click()
        pixel = original[65].index(1)
        await self.page.locator('#resultZoom').click(position={'x':(pixel%12+.5)*8,'y':(pixel//12+.5)*8})
        expected = [g[:] for g in original]
        expected[65][pixel] = 2
        self.assertTrue(await self.font() == expected)
        await self.page.locator('#editorUndoBtn').click()
        self.assertTrue(await self.font() == original)
        await self.page.select_option('#inspectorZoom','12')
        await self.load_default(self.page)
        self.assertEqual(await self.page.locator('#inspectorZoom').input_value(),'12')
        await self.page.wait_for_function("document.querySelector('#resultZoom').dataset.scale==='12'")
        for w,h in [(1024,768),(1366,768),(1440,900)]:
            await self.page.set_viewport_size({'width':w,'height':h})
            await self.page.select_option('#inspectorZoom','auto')
            await self.page.select_option('#sheetZoom','auto')
            await self.settle_frames(self.page)
            await asyncio.sleep(.1)
            metrics = await self.page.evaluate("""()=>({
              inspectorBottom:document.querySelector('.sidecar').getBoundingClientRect().bottom,
              pageHeight:document.documentElement.scrollHeight,viewport:innerHeight
            })""")
            self.assertLessEqual(metrics['inspectorBottom'],h,metrics)
            self.assertLessEqual(metrics['pageHeight'],h+1,metrics)

    async def test_brand_idle_and_reroll_do_not_run_js_animation_or_fetch_fonts(self):
        requests = []
        self.page.on('request', lambda request: requests.append(request.url))
        await self.page.reload(wait_until='networkidle')
        await self.page.locator('.brand-letter').nth(9).wait_for()
        self.assertEqual(await self.page.locator('.brand-drone-frame').count(), 2)
        await self.page.evaluate("""() => {
          window.brandChurn={styles:0,frames:0,reads:0};
          new MutationObserver(ms=>brandChurn.styles+=ms.length).observe(document.querySelector('.brandCluster'),{subtree:true,attributes:true});
          const raf=window.requestAnimationFrame, style=window.getComputedStyle;
          window.requestAnimationFrame=(...args)=>{brandChurn.frames++;return raf(...args)};
          window.getComputedStyle=(...args)=>{brandChurn.reads++;return style(...args)};
        }""")
        await asyncio.sleep(1.2)
        churn = await self.page.evaluate('brandChurn')
        print('\nBrand idle work over 1.2 seconds:', json.dumps(churn), flush=True)
        self.assertEqual(churn, {'styles':0,'frames':0,'reads':0})
        await self.page.wait_for_function("document.querySelector('.brandTitle').classList.contains('is-glitching')", timeout=23000)
        await self.page.wait_for_function("!document.querySelector('.brandTitle').classList.contains('is-glitching')")
        self.assertEqual(len([r for r in requests if r.endswith('/fonts/brand-glyphs.json')]),1)
        libraries = ['arcade-font-engine','atari','bbc','cpc','dg','oldschool-pc','zx']
        self.assertEqual([r for r in requests if any(f'/fonts/data/{lib}/' in r for lib in libraries)],[])

    async def test_brand_motion_lifecycle_theme_and_teardown(self):
        await self.page.evaluate("""async () => {
          const {createBrandAnimation}=await import('/js/modules/brand.js');
          const root=document.createElement('div');root.className='brandCluster';root.id='brandFixture';
          root.innerHTML='<div class="brandTitle" role="img" aria-label="OSD Font Lab"></div><span class="brandDrone"></span>';
          document.body.append(root);
          window.brandFixture=createBrandAnimation({root,glitchDelay:()=>250,glitchDuration:180});
          await brandFixture.ready;
        }""")
        await self.page.wait_for_function("document.querySelector('#brandFixture .brandTitle').classList.contains('is-glitching')")
        # Recolor both glitch layers and both drone frames from the current theme.
        colors = await self.page.evaluate("""() => {
          document.documentElement.style.setProperty('--brand-ink','#12ab34');brandFixture.refreshTheme();
          return [...document.querySelectorAll('#brandFixture canvas')].map(c=>{
            const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
            for(let i=0;i<data.length;i+=4)if(data[i+3])return [...data.slice(i,i+3)];
            return null;
          });
        }""")
        self.assertEqual(colors, [[18,171,52]]*23)
        await self.page.emulate_media(reduced_motion='reduce')
        await self.page.wait_for_function("document.querySelector('#brandFixture').classList.contains('is-reduced-motion')")
        await asyncio.sleep(.6)
        self.assertFalse(await self.page.locator('#brandFixture .brandTitle').evaluate("e=>e.classList.contains('is-glitching')"))
        self.assertTrue(await self.page.locator('#brandFixture').evaluate("e=>[...e.querySelectorAll('*')].every(n=>getComputedStyle(n).animationName==='none')"))
        await self.page.emulate_media(reduced_motion='no-preference')
        await self.page.wait_for_function("document.querySelector('#brandFixture .brandTitle').classList.contains('is-glitching')")
        await self.page.evaluate("""() => {
          Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
          document.dispatchEvent(new Event('visibilitychange'));
        }""")
        self.assertTrue(await self.page.locator('#brandFixture').evaluate("e=>e.classList.contains('is-paused') && !e.querySelector('.brandTitle').classList.contains('is-glitching')"))
        self.assertTrue(await self.page.locator('#brandFixture').evaluate("e=>[...e.querySelectorAll('*')].filter(n=>getComputedStyle(n).animationName!=='none').every(n=>getComputedStyle(n).animationPlayState==='paused')"))
        await self.page.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
        await self.page.wait_for_function("document.querySelector('#brandFixture .brandTitle').classList.contains('is-glitching')")
        await self.page.evaluate("window.dispatchEvent(new Event('pagehide'))")
        self.assertTrue(await self.page.locator('#brandFixture').evaluate("e=>e.classList.contains('is-paused')"))
        await self.page.evaluate("window.dispatchEvent(new Event('pageshow'))")
        await self.page.wait_for_function("document.querySelector('#brandFixture .brandTitle').classList.contains('is-glitching')")
        await self.page.evaluate("""() => {
          brandFixture.destroy();window.brandMutations=0;
          new MutationObserver(ms=>brandMutations+=ms.length).observe(document.querySelector('#brandFixture'),{attributes:true,subtree:true});
          document.documentElement.style.removeProperty('--brand-ink');
        }""")
        await asyncio.sleep(.7)
        self.assertEqual(await self.page.evaluate('brandMutations'),0)

    async def test_brand_asset_failure_keeps_readable_title_and_drone(self):
        await self.page.route('**/fonts/brand-glyphs.json', lambda route: route.fulfill(status=503,body='unavailable'))
        await self.page.emulate_media(reduced_motion='reduce')
        await self.page.reload(wait_until='networkidle')
        self.assertEqual(await self.page.locator('.brandTitle').inner_text(),'OSD Font Lab')
        self.assertEqual(await self.page.locator('.brandTitle').get_attribute('role'),'img')
        self.assertEqual(await self.page.locator('.brand-drone-frame').count(),2)
        self.assertTrue(await self.page.locator('.brandCluster').evaluate("e=>[...e.querySelectorAll('*')].every(n=>getComputedStyle(n).animationName==='none')"))
        await self.page.locator('#bfFontSelect + .fontpicker').wait_for()

    async def test_drone_frames_keep_one_color_and_hover_on_whole_pixels(self):
        await self.page.locator('.brand-drone-frame').nth(1).wait_for()
        result = await self.page.locator('.brandDrone').evaluate("""async drone => {
          const body=drone.querySelector('.brand-drone-body');
          const frames=[...drone.querySelectorAll('.brand-drone-frame')].map(c=>{
            const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
            const colors=new Set();let inkPixels=0;
            for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]){
              colors.add([...pixels.slice(i,i+4)].join(','));inkPixels++;
            }
            return {colors:[...colors],inkPixels};
          });
          const hover=drone.getAnimations().find(a=>a.animationName==='droneHover');
          hover.pause();
          const offsets=[];
          for(let t=0;t<=2200;t+=25){
            hover.currentTime=t;
            offsets.push(new DOMMatrixReadOnly(getComputedStyle(drone).transform).m42);
          }
          const reconstruction=[];
          for(let f=0;f<2;f++){
            const source=new Image();source.src=`drone${f+1}.png`;await source.decode();
            const expected=document.createElement('canvas');expected.width=body.width;expected.height=body.height;
            const ctx=expected.getContext('2d');ctx.drawImage(source,0,0);
            const original=ctx.getImageData(0,0,body.width,body.height).data;
            ctx.clearRect(0,0,body.width,body.height);ctx.drawImage(body,0,0);
            ctx.drawImage(drone.querySelectorAll('.brand-drone-frame')[f],0,0);
            const combined=ctx.getImageData(0,0,body.width,body.height).data;
            reconstruction.push(original.every((value,i)=>i%4!==3 || value===combined[i]));
          }
          const bodyPixels=body.getContext('2d').getImageData(0,0,body.width,body.height).data;
          const bodyInk=bodyPixels.filter((v,i)=>i%4===3 && v).length;
          const first=drone.querySelector('.brand-drone-frame').getAnimations()[0];
          const second=drone.querySelectorAll('.brand-drone-frame')[1].getAnimations()[0];
          first.pause();second.pause();const bodyStyles=[];
          for(let t=0;t<=90;t++){
            first.currentTime=second.currentTime=t;
            const style=getComputedStyle(body);
            bodyStyles.push([style.opacity,style.visibility,style.animationName]);
          }
          return {frames,offsets,reconstruction,bodyInk,bodyStyles};
        }""")
        self.assertEqual(result['frames'][0],result['frames'][1])
        self.assertEqual(len(result['frames'][0]['colors']),1)
        self.assertGreater(result['frames'][0]['inkPixels'],0)
        self.assertGreater(result['bodyInk'],result['frames'][0]['inkPixels'])
        self.assertEqual(result['reconstruction'],[True,True])
        self.assertTrue(all(s==['1','visible','none'] for s in result['bodyStyles']))
        self.assertTrue(all(abs(y-round(y))<.00001 for y in result['offsets']),result['offsets'])
        self.assertEqual(set(round(y) for y in result['offsets']),{0,1,2,3})


def shift(pixels, dx):
    return [pixels[y*12+x-dx] if 0 <= x-dx < 12 else 1 for y in range(18) for x in range(12)]


if __name__ == '__main__':
    unittest.main()
