"""Browser regressions: python -m unittest discover -s tests -p '*_test.py' -v."""
import asyncio
import base64
import functools
import json
import os
import subprocess
from pathlib import Path
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]


@functools.lru_cache(maxsize=2)
def outline_fixture(variant=0):
    return subprocess.check_output([
        'node', '--input-type=module', '-e',
        "import {makeOutlineFixture} from './tests/fixtures/outline-font.mjs';"
        "process.stdout.write(Buffer.from(makeOutlineFixture(Number(process.argv[1]))));",
        str(variant),
    ], cwd=ROOT)


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

    async def set_zoom(self, kind, value, page=None):
        page = page or self.page
        control = page.locator('#'+kind+'Zoom')
        await self.settle_frames(page)
        if str(value) == 'auto':
            if await control.get_attribute('data-zoom') != 'auto':
                await control.locator('.zoom-auto').click()
        else:
            target = int(value)
            for _ in range(40):
                current = int((await control.locator('output').inner_text()).removesuffix('×'))
                if current == target and await control.get_attribute('data-zoom') != 'auto':
                    break
                if current == target:
                    await control.locator('.zoom-auto').click()
                else:
                    direction = 1 if target > current else -1
                    await control.locator(f'[data-zoom-step="{direction}"]').click()
                await self.settle_frames(page)
            canvas = 'resultGrid' if kind == 'sheet' else 'resultZoom'
            await page.wait_for_function("([id,scale])=>document.getElementById(id).dataset.scale===scale",arg=[canvas,str(target)])
            self.assertEqual(await control.get_attribute('data-zoom'),str(target))
        await self.settle_frames(page)

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

    async def import_outline_fixture(self, name='fixture.otf', variant=0):
        await self.page.locator('#yaffFile').set_input_files({
            'name': name, 'mimeType': 'font/otf', 'buffer': outline_fixture(variant),
        })

    async def test_ttf_shared_baseline_coverage_and_reused_source(self):
        result = await self.page.evaluate(r'''async () => {
          const {loadTtfSource,parseTtfToOverlay}=await import('/js/modules/ttf-overlay.js');
          const {makeOutlineFixture}=await import('/tests/fixtures/outline-font.mjs');
          const bytes=makeOutlineFixture(),file=new File([bytes],'test.otf');
          let reads=0,canvases=0;
          file.arrayBuffer=async()=>{reads++;return bytes};
          const create=document.createElement.bind(document),before=document.fonts.size;
          document.createElement=(tag,...args)=>{if(tag==='canvas')canvases++;return create(tag,...args)};
          let source;
          try {
            source=await loadTtfSource(file);
            const charset="AHWxagp.,'_!- Z\u0378\u{1F600}\uD800";
            const overlay=source.render({charset,sizePx:12});
            const smaller=source.render({charset,sizePx:6});
            const bounds=g=>{
              if(!g)return null;
              const points=[];
              for(let y=0;y<18;y++)for(let x=0;x<12;x++)if(g.rows[y]&(1<<(11-x)))points.push([x,y]);
              return points.length?{top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))}:null;
            };
            const boundsByChar=Object.fromEntries([..."AHxg.,'"].map(ch=>[ch,bounds(overlay.glyphs['U+'+ch.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')]) ]));
            const marginClear=Object.values(overlay.glyphs).every(g=>g.rows[0]===0&&g.rows[17]===0&&g.rows.every(r=>(r&0x801)===0));
            const hasSpace=overlay.glyphs['U+0020']?.rows.every(r=>r===0);
            const missingAbsent=!overlay.glyphs['U+005A']&&!overlay.glyphs['U+0378'];
            source.dispose();source.dispose();
            let disposedThrows=false;
            try{source.render({charset})}catch{disposedThrows=true}
            let badOptionsThrow=false;
            try{await parseTtfToOverlay(file,{charset,cellW:33})}catch{badOptionsThrow=true}
            return {stats:overlay._importStats,smallerSize:smaller._importStats.effectiveSizePx,boundsByChar,marginClear,hasSpace,missingAbsent,disposedThrows,badOptionsThrow,reads,canvases,fontDelta:document.fonts.size-before};
          } finally {source?.dispose();document.createElement=create}
        }''')
        self.assertEqual(result['stats']['missing'], 2)
        self.assertEqual(result['stats']['blank'], 1)
        self.assertEqual(result['stats']['empty'], 1)
        self.assertEqual(result['stats']['skippedOutOfRange'], 2)
        self.assertEqual(result['smallerSize'], 6)
        bounds = result['boundsByChar']
        self.assertGreater(bounds['.']['top'], bounds["'"]['bottom'])
        self.assertGreater(bounds['x']['top'], bounds['H']['top'])
        self.assertGreater(bounds['g']['bottom'], bounds['H']['bottom'])
        self.assertGreater(bounds[',']['bottom'], bounds['.']['bottom'])
        self.assertLessEqual(abs(bounds['H']['bottom']-bounds['x']['bottom']), 1)
        for key in ['marginClear', 'hasSpace', 'missingAbsent', 'disposedThrows', 'badOptionsThrow']:
            self.assertTrue(result[key], (key, result))
        self.assertEqual(result['fontDelta'], 0)
        self.assertEqual(result['reads'], 2)  # Retained source + one-shot failure.
        self.assertEqual(result['canvases'], 4)  # Two per source, reused across sizes.

    async def test_ttf_missing_glyphs_keep_base_and_size_changes_reuse_font(self):
        before = await self.font()
        await self.page.evaluate('''()=>{
          window.ttfLoads=0;const load=FontFace.prototype.load;
          FontFace.prototype.load=function(){ttfLoads++;return load.call(this)};
        }''')
        await self.import_outline_fixture()
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded TTF overlay: fixture.otf')")
        after = await self.font()
        self.assertNotEqual(after[65], before[65])
        self.assertEqual(after[90], before[90], 'missing Z must keep the base glyph')
        self.assertEqual(after[32], [1]*216, 'supported space must be transparent')
        self.assertIn('missing (kept base)', await self.page.locator('#loadStatus').inner_text())
        await self.page.locator('#ttfSizeRange').evaluate("e=>{e.value='6';e.dispatchEvent(new Event('input',{bubbles:true}))}")
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Updated TTF overlay: fixture.otf') && document.querySelector('#loadStatus').textContent.includes('size 6')")
        small = await self.font()
        self.assertNotEqual(small[65], after[65])
        self.assertEqual(await self.page.evaluate('ttfLoads'), 1)
        self.assertEqual(await self.page.evaluate("Array.from(document.fonts).filter(f=>f.family.startsWith('osd_ttf_')).length"), 1)
        # Base imports retain the active overlay and its adjustable source.
        await self.page.locator('#file').set_input_files(str(ROOT/'fonts/betaflight/bold.mcm'))
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded: bold.mcm')")
        self.assertEqual((await self.font())[65], small[65])
        await self.page.locator('#ttfSizeRange').evaluate("e=>{e.value='12';e.dispatchEvent(new Event('input',{bubbles:true}))}")
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Updated TTF overlay: fixture.otf') && document.querySelector('#loadStatus').textContent.includes('size 12')")
        self.assertEqual((await self.font())[65], after[65])
        await self.page.select_option('#fontLibraryFilter', 'cpc')
        self.assertEqual(await self.page.evaluate("Array.from(document.fonts).filter(f=>f.family.startsWith('osd_ttf_')).length"), 1)
        self.assertEqual(await self.page.locator('#fontCurrentName').inner_text(), 'fixture.otf')
        await self.page.locator('#clearOverlayBtn').click()
        self.assertEqual(await self.page.evaluate("Array.from(document.fonts).filter(f=>f.family.startsWith('osd_ttf_')).length"), 0)

    async def test_ttf_ornate_outliers_do_not_limit_the_other_letters(self):
        result = await self.page.evaluate(r'''async () => {
          const {loadTtfSource}=await import('/js/modules/ttf-overlay.js');
          const {makeOutlineFixture}=await import('/tests/fixtures/outline-font.mjs');
          const charset="ABHWxagp.,'_!- ";
          const regular=await loadTtfSource(new File([makeOutlineFixture(0)],'regular.otf'));
          const ornate=await loadTtfSource(new File([makeOutlineFixture(2)],'ornate.otf'));
          try {
            const expected=regular.render({charset,sizePx:24});
            const small=ornate.render({charset,sizePx:8});
            const large=ornate.render({charset,sizePx:24});
            const marginClear=Object.values(large.glyphs).every(g=>g.rows[0]===0&&g.rows[17]===0&&g.rows.every(r=>(r&0x801)===0));
            return {
              size:large._importStats.effectiveSizePx,
              expectedSize:expected._importStats.effectiveSizePx,
              ordinaryUnchanged:JSON.stringify(large.glyphs['U+0048'])===JSON.stringify(expected.glyphs['U+0048']),
              ordinaryGrew:JSON.stringify(large.glyphs['U+0048'])!==JSON.stringify(small.glyphs['U+0048']),
              hasWide:!!large.glyphs['U+0057'],hasTall:!!large.glyphs['U+0042'],
              narrowed:large._importStats.narrowed,shortened:large._importStats.shortened,marginClear,
            };
          } finally {regular.dispose();ornate.dispose()}
        }''')
        self.assertGreater(result['size'], 15)
        self.assertAlmostEqual(result['size'], result['expectedSize'])
        self.assertGreaterEqual(result['narrowed'], 1)
        self.assertGreaterEqual(result['shortened'], 1)
        for key in ['ordinaryUnchanged', 'ordinaryGrew', 'hasWide', 'hasTall', 'marginClear']:
            self.assertTrue(result[key], (key, result))

    async def test_ttf_slider_during_new_import_uses_new_font_and_latest_size(self):
        await self.import_outline_fixture('first.otf')
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded TTF overlay: first.otf')")
        await self.page.evaluate('''()=>{
          window.ttfPending=[];window.ttfOriginalLoad=FontFace.prototype.load;
          FontFace.prototype.load=function(){return new Promise(resolve=>ttfPending.push(async()=>{const face=await ttfOriginalLoad.call(this);resolve(face)}))};
        }''')
        await self.import_outline_fixture('second.otf', 1)
        await self.page.wait_for_function('ttfPending.length===1')
        await self.page.locator('#ttfSizeRange').evaluate("e=>{e.value='6';e.dispatchEvent(new Event('input',{bubbles:true}))}")
        await asyncio.sleep(.2)  # Let the old debounce period pass while load is held.
        self.assertEqual(await self.page.evaluate('ttfPending.length'), 1)
        await self.page.evaluate('()=>{ttfPending[0]()}')
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded TTF overlay: second.otf')")
        self.assertIn('size 6', await self.page.locator('#loadStatus').inner_text())
        actual = await self.font()
        await self.page.evaluate('()=>{FontFace.prototype.load=ttfOriginalLoad}')
        await self.import_outline_fixture('expected.otf', 1)
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded TTF overlay: expected.otf')")
        self.assertEqual(await self.font(), actual)
        self.assertEqual(await self.page.evaluate("Array.from(document.fonts).filter(f=>f.family.startsWith('osd_ttf_')).length"), 1)

    async def test_ttf_superseded_and_failed_imports_release_sources(self):
        await self.page.evaluate('''()=>{
          window.ttfPending=[];window.ttfOriginalLoad=FontFace.prototype.load;
          FontFace.prototype.load=function(){return new Promise(resolve=>ttfPending.push(async()=>{const face=await ttfOriginalLoad.call(this);resolve(face)}))};
        }''')
        await self.import_outline_fixture('older.otf')
        await self.page.wait_for_function('ttfPending.length===1')
        await self.import_outline_fixture('newer.otf', 1)
        await self.page.wait_for_function('ttfPending.length===2')
        await self.page.evaluate('()=>{ttfPending[1]()}')
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded TTF overlay: newer.otf')")
        expected = await self.font()
        await self.page.evaluate('async()=>{await ttfPending[0]()}')
        await self.settle_frames(self.page)
        self.assertEqual(await self.font(), expected)
        self.assertEqual(await self.page.evaluate("Array.from(document.fonts).filter(f=>f.family.startsWith('osd_ttf_')).length"), 1)
        await self.page.evaluate('()=>{FontFace.prototype.load=ttfOriginalLoad}')
        await self.page.locator('#yaffFile').set_input_files({'name':'broken.otf','mimeType':'font/otf','buffer':b'not a font'})
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('TTF import failed: broken.otf')")
        self.assertEqual(await self.font(), expected)
        self.assertEqual(await self.page.evaluate("Array.from(document.fonts).filter(f=>f.family.startsWith('osd_ttf_')).length"), 1)

    async def test_status_wrapping_does_not_move_the_header_or_workspace(self):
        for width, height in [(1440,900), (1200,800), (1024,768), (768,1024), (390,844), (320,640)]:
            with self.subTest(width=width):
                await self.page.set_viewport_size({'width':width,'height':height})
                await self.page.evaluate("window.scrollTo(0,0)")
                snapshots = []
                for message in ['Loaded', "Loaded font: Blackletter community edition (NFG's Arcade Font Engine)", 'VeryLongFontNameWithoutSpaces'*12, 'Import failed: '+('Detailed diagnostic information. '*20)]:
                    await self.page.locator('#loadStatus').evaluate('(el,text)=>{el.textContent=text;el.scrollTop=0}', message)
                    await self.settle_frames(self.page)
                    snapshots.append(await self.page.evaluate('''()=>{
                      const header=document.querySelector('.app-header').getBoundingClientRect();
                      const exports=document.querySelector('.exports').getBoundingClientRect();
                      const status=document.querySelector('#loadStatus').getBoundingClientRect();
                      return {headerHeight:header.height,workspaceTop:document.querySelector('.split').getBoundingClientRect().top,
                        exportX:exports.x,exportY:exports.y,exportWidth:exports.width,statusHeight:status.height,
                        overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};
                    }'''))
                self.assertTrue(all(not snapshot['overflow'] for snapshot in snapshots), snapshots)
                for snapshot in snapshots[1:]:
                    self.assertEqual(snapshot, snapshots[0], snapshots)

    async def test_theme_pixels_and_selection_render_budget(self):
        baseline = json.loads((ROOT/'tests/fixtures/render-baseline.json').read_text())
        # Check the original pixels at their original geometry, independently
        # of the new responsive column count.
        await self.page.locator('.sheet-wrap').evaluate("""e=>{
          e.style.width=(576+e.offsetWidth-e.clientWidth)+'px'; e.style.maxHeight='864px';
        }""")
        await self.set_zoom('sheet','3')
        await self.set_zoom('inspector','19')
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
        await self.set_zoom('sheet','auto')
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
        await self.page.select_option('#fontLibraryFilter', 'cpc')
        await self.page.locator('#fontSearch').fill('alarm')
        base = await self.font()
        async with self.page.expect_response('**/alarm8x8.json') as loaded:
            await self.page.locator('[data-font-id="cpc::alarm8x8.json"]').click()
        await (await loaded.value).body()
        await self.settle_frames(self.page)
        expected = await self.font()
        self.assertTrue(expected != base, 'fixture must actually apply an overlay')
        other = await self.context.new_page()
        await self.load_default(other)
        await other.select_option('#fontLibraryFilter', 'cpc')
        await other.locator('#fontSearch').fill('alarm')
        async def delay_old(route):
            if route.request.url.endswith('/alarm8x5.json'):
                await asyncio.sleep(0.35)
            await route.continue_()
        await other.route('**/fonts/data/cpc/**', delay_old)
        async with other.expect_response('**/alarm8x5.json') as older:
            await other.locator('[data-font-id="cpc::alarm8x5.json"]').click()
            await other.locator('[data-font-id="cpc::alarm8x8.json"]').click()
        await (await older.value).body()
        await self.settle_frames(other)
        self.assertTrue(await self.font(other) == expected, 'export must match the latest selected font')

    async def test_font_browser_filters_preserve_the_applied_font_and_edits(self):
        await self.page.select_option('#fontLibraryFilter', 'cpc')
        await self.page.locator('#fontSearch').fill('alarm8x8')
        await self.page.locator('[data-font-id="cpc::alarm8x8.json"]').click()
        await self.page.wait_for_function("document.querySelector('#fontCurrentName').textContent==='alarm8x8'")
        before = await self.font()
        await self.select_glyph(65)
        await self.page.locator('#zoomModeEditor').click()
        await self.page.locator('.editor-color-btn[data-editor-color="2"]').click()
        pixel = before[65].index(1)
        box = await self.page.locator('#resultZoom').bounding_box()
        await self.page.locator('#resultZoom').click(position={'x':(pixel%12+.5)*box['width']/12,'y':(pixel//12+.5)*box['height']/18})
        painted = await self.font()
        self.assertNotEqual(painted, before)
        await self.page.locator('[data-font-id="cpc::alarm8x8.json"]').click()
        self.assertEqual(await self.font(), painted, 'selecting the active font must not erase edits')
        await self.page.select_option('#fontLibraryFilter', 'dg')
        await self.page.locator('#fontSearch').fill('no such font 123456789')
        self.assertTrue(await self.page.locator('.font-browser-empty').is_visible())
        self.assertEqual(await self.page.locator('#fontCurrentName').inner_text(), 'alarm8x8')
        self.assertEqual(await self.font(), painted, 'browsing must not change the document')
        self.assertEqual(await self.page.locator('#editorUndoCount').inner_text(), '1')
        await self.page.locator('#editorUndoBtn').click()
        self.assertEqual(await self.font(), before, 'browsing must retain undo history')

    async def test_font_browser_bounds_rows_and_does_not_fetch_full_fonts_for_previews(self):
        requests = []
        self.page.on('request', lambda request: requests.append(request.url))
        await self.page.reload(wait_until='networkidle')
        await self.page.select_option('#fontLibraryFilter', 'dg')
        await self.page.wait_for_function("document.querySelector('#fontResultsCount').textContent==='469 fonts'")
        await self.page.locator('.font-browser-row img[src]').first.wait_for()
        for key in ['End', 'Home', 'PageDown', 'PageDown', 'PageUp']:
            await self.page.locator('#fontResults').focus()
            await self.page.keyboard.press(key)
            await self.settle_frames(self.page)
            self.assertLessEqual(await self.page.locator('.font-browser-row').count(), 9)
            positions = await self.page.locator('.font-browser-row').evaluate_all("rows=>rows.map(row=>Number(row.getAttribute('aria-posinset')))")
            self.assertEqual(positions, sorted(positions), 'screen-reader order must match the visible rows')
        libraries = ['arcade-font-engine','atari','bbc','cpc','dg','oldschool-pc','zx']
        self.assertEqual([url for url in requests if any(f'/fonts/data/{lib}/' in url for lib in libraries)], [])
        self.assertEqual(len([url for url in requests if url.endswith('/fonts/previews/dg.json')]), 1)
        for lib in libraries:
            self.assertEqual(len([url for url in requests if url.endswith(f'/fonts/manifest-{lib}.json')]), 1)

    async def test_font_browser_keyboard_theme_refresh_and_clear(self):
        original = await self.font()
        await self.page.select_option('#fontLibraryFilter', 'cpc')
        await self.page.locator('#fontSearch').fill('alarm8x8')
        await self.page.locator('[data-font-id="cpc::alarm8x8.json"] img[src]').wait_for()
        await self.page.locator('#fontResults').focus()
        await self.page.keyboard.press('Enter')
        await self.page.wait_for_function("document.querySelector('#fontCurrentName').textContent==='alarm8x8'")
        self.assertNotEqual(await self.font(), original)
        preview = self.page.locator('[data-font-id="cpc::alarm8x8.json"] img')
        old_url = await preview.get_attribute('src')
        await self.page.evaluate("document.querySelector('input[name=siteTheme][value=afterburn]').click()")
        await self.page.wait_for_function("old=>{const img=document.querySelector('[data-font-id=\"cpc::alarm8x8.json\"] img');return img?.src&&img.getAttribute('src')!==old}", arg=old_url)
        await self.page.locator('#clearOverlayBtn').click()
        self.assertEqual(await self.font(), original)
        self.assertEqual(await self.page.locator('#fontCurrentName').inner_text(), 'Original lettering')
        self.assertTrue(await self.page.locator('#clearOverlayBtn').is_disabled())

    async def test_font_browser_failed_selection_keeps_the_current_font(self):
        await self.page.select_option('#fontLibraryFilter', 'cpc')
        await self.page.locator('#fontSearch').fill('alarm')
        await self.page.locator('[data-font-id="cpc::alarm8x8.json"]').click()
        await self.page.wait_for_function("document.querySelector('#fontCurrentName').textContent==='alarm8x8'")
        expected = await self.font()
        await self.page.route('**/fonts/data/cpc/alarm8x5.json', lambda route: route.fulfill(status=503, body='unavailable'))
        await self.page.locator('[data-font-id="cpc::alarm8x5.json"]').click()
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Failed to load font: alarm8x5')")
        self.assertEqual(await self.page.locator('#fontCurrentName').inner_text(), 'alarm8x8')
        self.assertEqual(await self.font(), expected)

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
        for select in ['bfFontSelect','swapTargetSelect']:
            await self.page.locator('#'+select+' + .fontpicker .fontpicker-btn').click()
            self.assertFalse(await self.page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1'), select)
            await self.page.keyboard.press('Escape')

    async def test_mobile_zoom_pan_touch_selection_and_resize_preserve_the_font(self):
        original = await self.font()
        await self.page.set_viewport_size({'width':390,'height':844})
        await self.page.locator('[data-workspace-target="preview"]').click()
        await self.page.locator('#viewModeSheet').click()
        await self.set_zoom('sheet','3')
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
        await self.set_zoom('inspector','8',page)
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
        await self.set_zoom('sheet','3')
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
        await self.set_zoom('sheet','2')
        await self.select_glyph(65)
        original = await self.font()
        _, png = await self.download('#exportPNG1x')
        await self.set_zoom('inspector','16')
        await self.page.wait_for_function("document.querySelector('#resultZoom').dataset.scale==='16'")
        large = await self.page.locator('.panel-result').bounding_box()
        sheet = await self.page.locator('#resultGrid').evaluate('c=>[c.width,c.height,c.dataset.columns,c.dataset.scale]')
        await self.set_zoom('inspector','8')
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
        await self.set_zoom('inspector','12')
        await self.load_default(self.page)
        self.assertEqual(await self.page.locator('#inspectorZoom').get_attribute('data-zoom'),'12')
        await self.page.wait_for_function("document.querySelector('#resultZoom').dataset.scale==='12'")
        for w,h in [(1024,768),(1366,768),(1440,900)]:
            await self.page.set_viewport_size({'width':w,'height':h})
            await self.set_zoom('inspector','auto')
            await self.set_zoom('sheet','auto')
            await self.settle_frames(self.page)
            await asyncio.sleep(.1)
            metrics = await self.page.evaluate("""()=>({
              inspectorBottom:document.querySelector('.sidecar').getBoundingClientRect().bottom,
              pageHeight:document.documentElement.scrollHeight,viewport:innerHeight
            })""")
            self.assertLessEqual(metrics['inspectorBottom'],h,metrics)
            self.assertLessEqual(metrics['pageHeight'],h+1,metrics)

    async def test_zoom_buttons_step_from_auto_and_keep_large_canvas_gutters(self):
        sheet = self.page.locator('#sheetZoom')
        self.assertEqual(await sheet.locator('.zoom-auto').get_attribute('aria-pressed'),'true')
        fitted = int(await self.page.locator('#resultGrid').get_attribute('data-scale'))
        await sheet.locator('.zoom-auto').click()
        self.assertEqual(await sheet.get_attribute('data-zoom'),str(fitted))
        self.assertEqual(await sheet.locator('.zoom-auto').get_attribute('aria-pressed'),'false')
        await sheet.locator('.zoom-auto').click()
        await self.settle_frames(self.page)
        self.assertEqual(await sheet.locator('.zoom-auto').get_attribute('aria-pressed'),'true')
        direction = -1 if fitted == 4 else 1
        await sheet.locator(f'[data-zoom-step="{direction}"]').press('Enter')
        await self.page.wait_for_function("scale=>document.querySelector('#resultGrid').dataset.scale===String(scale)",arg=fitted+direction)
        self.assertEqual(await sheet.get_attribute('data-zoom'),str(fitted+direction))
        self.assertEqual(await sheet.locator('.zoom-auto').get_attribute('aria-pressed'),'false')
        await self.set_zoom('sheet',4)
        self.assertTrue(await sheet.locator('[data-zoom-step="1"]').is_disabled())
        await self.set_zoom('sheet',2)
        self.assertTrue(await sheet.locator('[data-zoom-step="-1"]').is_disabled())
        await self.set_zoom('sheet','auto')
        self.assertEqual(await sheet.locator('.zoom-auto').get_attribute('aria-pressed'),'true')
        inspector = self.page.locator('#inspectorZoom')
        fitted = int(await self.page.locator('#resultZoom').get_attribute('data-scale'))
        await inspector.locator('[data-zoom-step="1"]').click()
        self.assertEqual(await inspector.get_attribute('data-zoom'),str(fitted+1))
        await self.set_zoom('inspector',20)
        self.assertTrue(await inspector.locator('[data-zoom-step="1"]').is_disabled())
        for w,h in [(1440,900),(1024,768),(390,844)]:
            await self.page.set_viewport_size({'width':w,'height':h})
            if w<=960:
                await self.page.locator('[data-workspace-target="edit"]').click()
            await self.settle_frames(self.page)
            margins = await self.page.locator('.zoom-viewport').evaluate("""e=>{
              const box=e.parentElement.getBoundingClientRect(),v=e.getBoundingClientRect(),c=e.querySelector('canvas');
              e.scrollLeft=0;const left=c.getBoundingClientRect().left-box.left;
              e.scrollLeft=e.scrollWidth;const right=box.right-c.getBoundingClientRect().right;
              const mode=e.parentElement.querySelector('.zoom-mode-toggle').getBoundingClientRect();
              const aside=e.closest('.sidecar').getBoundingClientRect();
              return {left,right,top:v.top-mode.bottom,inside:box.left>=aside.left&&box.right<=aside.right,
                width:c.getBoundingClientRect().width,height:c.getBoundingClientRect().height,
                overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};
            }""")
            self.assertGreaterEqual(margins['left'],20,margins)
            self.assertGreaterEqual(margins['right'],20,margins)
            self.assertGreaterEqual(margins['top'],12,margins)
            self.assertTrue(margins['inside'],margins)
            self.assertFalse(margins['overflow'],margins)
            self.assertEqual((margins['width'],margins['height']),(240,360))
        await self.set_zoom('inspector',4)
        self.assertTrue(await inspector.locator('[data-zoom-step="-1"]').is_disabled())
        await self.set_zoom('inspector','auto')
        self.assertEqual(await inspector.locator('.zoom-auto').get_attribute('aria-pressed'),'true')

    async def test_cell_clipboard_copies_active_cell_and_paste_is_undoable(self):
        self.assertFalse(await self.page.locator('#copyCell').is_disabled())
        self.assertTrue(await self.page.locator('#pasteCell').is_disabled())
        original = await self.font()
        await self.select_glyph(65)
        status_before = await self.page.locator('#loadStatus').inner_text()
        await self.page.locator('#copyCell').focus()
        await self.page.keyboard.press('Enter')
        self.assertEqual(await self.page.locator('#loadStatus').inner_text(),status_before)
        self.assertEqual(await self.page.locator('#copyCell').inner_text(),'Copied')
        self.assertIn('Copied cell 0x41',await self.page.locator('#cellClipboardStatus').inner_text())
        self.assertTrue(await self.font() == original, 'copy must not edit the font')
        self.assertFalse(await self.page.locator('#pasteCell').is_disabled())
        point = await self.glyph_point(self.page,66)
        await self.page.keyboard.down('Control')
        await self.page.mouse.click(point['x'],point['y'])
        await self.page.keyboard.up('Control')
        self.assertIn('2',await self.page.locator('#selCount').inner_text())
        await self.page.locator('#pasteCell').click()
        expected = [g[:] for g in original]
        expected[66] = original[65][:]
        self.assertTrue(await self.font() == expected, 'paste must change only the active cell')
        await self.page.locator('#pasteCell').click()  # Identical paste must preserve the previous undo.
        await self.page.locator('#zoomModeEditor').click()
        await self.page.locator('#editorUndoBtn').click()
        self.assertTrue(await self.font() == original)
        await self.page.select_option('#bfFontSelect','bold.mcm')
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded: bold.mcm')")
        other_font = await self.font()
        await self.select_glyph(67)
        await self.page.locator('#pasteCell').click()
        expected = [g[:] for g in other_font]
        expected[67] = original[65][:]
        self.assertTrue(await self.font() == expected, 'clipboard must survive loading another font')
        await self.page.locator('#zoomModeEditor').click()
        await self.page.locator('#editorUndoBtn').click()
        self.assertTrue(await self.font() == other_font)
        fresh = await self.context.new_page()
        await fresh.goto(self.url,wait_until='networkidle')
        self.assertTrue(await fresh.locator('#copyCell').is_disabled())
        self.assertTrue(await fresh.locator('#pasteCell').is_disabled())
        await fresh.close()

    async def test_cell_clipboard_snapshot_nudges_and_boot_preview_undo(self):
        await self.page.locator('#yaffFile').set_input_files({'name':'copy-fixture.yaff','mimeType':'text/plain',
            'buffer':b'u+0041:\n    .@.\n    @.@\n    @@@\nu+0042:\n    @@.\n    @.@\n    @@.\n'})
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded YAFF')")
        await self.select_glyph(65)
        global_right = self.page.locator('.dpad[data-nudge-target="replaced"] button[data-dx="1"]')
        single_right = self.page.locator('.dpad[data-nudge-target="selection"] button[data-dx="1"]')
        await global_right.click()
        await single_right.click()
        copied = (await self.font())[65]
        await self.page.locator('#copyCell').click()
        await single_right.click()
        self.assertNotEqual((await self.font())[65],copied)
        await self.select_glyph(66)
        await single_right.click()
        before = (await self.font())[66]
        await self.page.locator('#pasteCell').click()
        self.assertEqual((await self.font())[66],copied, 'paste must not apply the destination nudge twice')
        await single_right.click()
        await self.page.locator('#caseLowerBtn').click()
        self.assertEqual((await self.font())[66],shift(copied,1))
        await self.page.locator('#zoomModeEditor').click()
        await self.page.locator('#editorUndoBtn').click()
        self.assertEqual((await self.font())[66],shift(before,1))
        await self.select_glyph(0xA0)
        tile_before = (await self.font())[0xA0]
        preview_before = await self.page.locator('#bootSplashPreview').evaluate('c=>c.toDataURL()')
        await self.page.locator('#pasteCell').click()
        self.assertEqual((await self.font())[0xA0],copied)
        self.assertNotEqual(await self.page.locator('#bootSplashPreview').evaluate('c=>c.toDataURL()'),preview_before)
        await self.page.locator('#editorUndoBtn').click()
        self.assertEqual((await self.font())[0xA0],tile_before)
        self.assertEqual(await self.page.locator('#bootSplashPreview').evaluate('c=>c.toDataURL()'),preview_before)

    async def test_compact_preview_controls_hold_with_keyboard_and_pointer(self):
        await self.select_glyph(65)
        original = await self.page.locator('#resultZoom').evaluate('c=>c.toDataURL()')
        await self.page.locator('.dpad[data-nudge-target="selection"] button[data-dx="1"]').click()
        edited = await self.page.locator('#resultZoom').evaluate('c=>c.toDataURL()')
        self.assertNotEqual(edited,original)
        hold = self.page.locator('#holdOriginalPreview')
        await hold.focus()
        await self.page.keyboard.down('Space')
        self.assertEqual(await self.page.locator('#resultZoom').evaluate('c=>c.toDataURL()'),original)
        await self.page.keyboard.up('Space')
        self.assertEqual(await self.page.locator('#resultZoom').evaluate('c=>c.toDataURL()'),edited)
        box = await hold.bounding_box()
        await self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        await self.page.mouse.down()
        self.assertEqual(await self.page.locator('#resultZoom').evaluate('c=>c.toDataURL()'),original)
        await hold.dispatch_event('pointercancel')
        self.assertEqual(await self.page.locator('#resultZoom').evaluate('c=>c.toDataURL()'),edited)
        await self.page.mouse.up()
        await self.page.locator('.preview-controls label').click()
        self.assertFalse(await self.page.locator('#showGrids').is_checked())
        self.assertFalse(await self.page.locator('#hudShowGuides').is_checked())
        self.assertEqual(await self.page.evaluate("localStorage.getItem('showGrids')"),'0')
        await self.page.locator('.preview-controls label').click()
        self.assertTrue(await self.page.locator('#showGrids').is_checked())
        for w,h in [(1440,900),(1024,768),(390,844)]:
            await self.page.set_viewport_size({'width':w,'height':h})
            if w<=960:
                await self.page.locator('[data-workspace-target="edit"]').click()
            await self.settle_frames(self.page)
            row = await self.page.locator('.preview-controls').evaluate("""e=>{
              const r=e.getBoundingClientRect(),b=e.querySelector('button').getBoundingClientRect(),g=e.querySelector('label').getBoundingClientRect();
              return {inside:b.left>=r.left&&g.right<=r.right,centerDifference:Math.abs(b.top+b.height/2-g.top-g.height/2),
                clipped:e.querySelector('button').scrollWidth>e.querySelector('button').clientWidth};
            }""")
            self.assertTrue(row['inside'],row)
            self.assertLess(row['centerDifference'],1,row)
            self.assertFalse(row['clipped'],row)

    async def test_multistep_undo_groups_strokes_and_pastes_across_cells_with_nudges(self):
        await self.select_glyph(65)
        await self.page.locator('#zoomModeEditor').click()
        await self.set_zoom('inspector',8)
        await self.page.locator('.editor-color-btn[data-editor-color="2"]').click()
        original = await self.font()
        frames = []
        pixels = [i for i,p in enumerate(original[65]) if p==1][:3]
        for pixel in pixels:
            frames.append((65,await self.font()))
            await self.page.locator('#resultZoom').click(position={'x':(pixel%12+.5)*8,'y':(pixel//12+.5)*8})
        await self.select_glyph(67)
        await self.page.locator('#copyCell').click()
        await self.select_glyph(65)
        frames.append((65,await self.font()))
        await self.page.locator('#pasteCell').click()
        await self.page.locator('#pasteCell').click()  # No-op paste is not another undo step.
        await self.select_glyph(66)
        frames.append((66,await self.font()))
        pixel = next(i for i in range(215) if i%12<11 and original[66][i:i+2]==[1,1])
        box = await self.page.locator('#resultZoom').bounding_box()
        x,y = box['x']+(pixel%12+.5)*8,box['y']+(pixel//12+.5)*8
        await self.page.mouse.move(x,y)
        await self.page.mouse.down()
        await self.page.mouse.move(x+8,y)
        await self.page.mouse.up()
        await self.page.locator('#resultZoom').click(position={'x':(pixel%12+.5)*8,'y':(pixel//12+.5)*8})  # No-op paint.
        self.assertEqual(await self.page.locator('#editorUndoCount').inner_text(),'5')
        for index in [65,66]:
            await self.select_glyph(index)
            await self.page.locator('.dpad[data-nudge-target="selection"] button[data-dx="1"]').click()
        await self.page.locator('#caseLowerBtn').click()
        await self.set_zoom('inspector',10)
        self.assertEqual(await self.page.locator('#editorUndoCount').inner_text(),'5')
        for remaining,(index,snapshot) in enumerate(reversed(frames)):
            await self.page.locator('#editorUndoBtn').focus()
            await self.page.keyboard.press('Enter')
            expected = [g[:] for g in snapshot]
            for nudged in [65,66]:
                expected[nudged] = shift(expected[nudged],1)
            self.assertTrue(await self.font() == expected, f'undo frame {remaining+1} must preserve later nudges')
            self.assertIn(f'0x{index:02X}',await self.page.locator('#glyphInfo').inner_text())
            self.assertEqual(await self.page.locator('#editorUndoCount').inner_text(),str(4-remaining))
        self.assertTrue(await self.page.locator('#editorUndoBtn').is_disabled())

    async def test_multistep_undo_limit_and_loading_font_during_a_stroke(self):
        await self.select_glyph(65)
        await self.page.locator('#zoomModeEditor').click()
        await self.set_zoom('inspector',8)
        original = await self.font()
        pixel = original[65].index(1)
        point = {'x':(pixel%12+.5)*8,'y':(pixel//12+.5)*8}
        for i in range(25):
            color = 2 if i%2==0 else 3
            await self.page.locator(f'.editor-color-btn[data-editor-color="{color}"]').click()
            await self.page.locator('#resultZoom').click(position=point)
        self.assertEqual(await self.page.locator('#editorUndoCount').inner_text(),'20')
        for _ in range(20):
            await self.page.locator('#editorUndoBtn').click()
        expected = [g[:] for g in original]
        expected[65][pixel] = 2  # First five edits remain after undoing the newest twenty.
        self.assertTrue(await self.font() == expected)
        self.assertTrue(await self.page.locator('#editorUndoBtn').is_disabled())
        await self.page.locator('.editor-color-btn[data-editor-color="3"]').click()
        await self.page.locator('#resultZoom').click(position=point)
        self.assertEqual(await self.page.locator('#editorUndoCount').inner_text(),'1')
        await self.page.locator('.editor-color-btn[data-editor-color="2"]').click()
        box = await self.page.locator('#resultZoom').bounding_box()
        await self.page.mouse.move(box['x']+point['x'],box['y']+point['y'])
        await self.page.mouse.down()
        await self.page.select_option('#bfFontSelect','bold.mcm')
        await self.page.wait_for_function("document.querySelector('#loadStatus').textContent.includes('Loaded: bold.mcm')")
        await self.page.mouse.up()
        self.assertEqual(await self.page.locator('#editorUndoCount').inner_text(),'0')
        self.assertTrue(await self.page.locator('#editorUndoBtn').is_disabled())
        expected = await self.page.evaluate("""async()=>{
          const {decodeMCM}=await import('/js/mcm.js');
          return decodeMCM(await (await fetch('/fonts/betaflight/bold.mcm')).arrayBuffer()).glyphs.map(g=>Array.from(g));
        }""")
        self.assertTrue(await self.font() == expected, 'old stroke/history must not leak into the new font')

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

    async def test_drone_brightness_stays_constant_at_fractional_display_scales(self):
        # Count screenshot pixels, not just canvas data or CSS offsets. Hide the
        # propellers to isolate the permanently visible hull. Separate contexts
        # keep screenshots at the actual requested DPR (Playwright restores
        # context metrics when capturing, undoing ad-hoc CDP DPR overrides).
        for width, height, dpr in [(1440,900,0.8), (1440,900,1), (1440,900,1.1), (1440,900,1.25), (1440,900,1.5), (1440,900,2), (390,844,1.25)]:
            with self.subTest(width=width, dpr=dpr):
                context = await self.browser.new_context(viewport={'width':width,'height':height}, device_scale_factor=dpr)
                page = await context.new_page()
                try:
                    await page.goto(self.url, wait_until='networkidle')
                    await page.evaluate("""async()=>{
                      document.documentElement.dataset.theme='afterburn';
                      const {createBrandAnimation}=await import('/js/modules/brand.js');
                      const root=document.createElement('div');root.id='dronePixelFixture';root.className='brandCluster';
                      root.style='position:absolute;left:40px;top:160px;width:100px;height:100px;display:flex;align-items:flex-start;background:#17191f;z-index:1000';
                      root.innerHTML='<span class="brandDrone" style="margin-top:1px"></span>';document.body.append(root);
                      window.dronePixelBrand=createBrandAnimation({root});await dronePixelBrand.ready;
                      root.querySelectorAll('.brand-drone-frame').forEach(c=>c.style.display='none');
                      window.dronePixelHover=root.querySelector('.brandDrone').getAnimations()[0];dronePixelHover.pause();await dronePixelHover.ready;
                    }""")
                    steps = max(1, int(3*dpr+0.5))
                    pngs = []
                    offsets = []
                    for step in range(steps+1):
                        time = 1100 if step == steps else (step+0.1)*1100/steps
                        offset = await page.evaluate("""time=>{
                          dronePixelHover.currentTime=time;
                          return new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#dronePixelFixture .brandDrone')).transform).m42*devicePixelRatio;
                        }""", time)
                        offsets.append(offset)
                        png = await page.screenshot(clip={'x':40,'y':160,'width':80,'height':60}, animations='allow')
                        pngs.append(base64.b64encode(png).decode())
                    rendered = await page.evaluate("""async images=>Promise.all(images.map(async png=>{
                      const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
                      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
                      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
                      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
                      let ink=0,other=0;
                      for(let i=0;i<pixels.length;i+=4){
                        const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
                        if(r===255&&g===116&&b===87)ink++;
                        else if(r!==23||g!==25||b!==31)other++;
                      }
                      return {ink,other,width:canvas.width};
                    }))""", pngs)
                    self.assertGreater(rendered[0]['ink'], 0)
                    self.assertTrue(all(r['width'] == round(80*dpr) for r in rendered), rendered)
                    self.assertEqual({r['ink'] for r in rendered}, {rendered[0]['ink']}, rendered)
                    self.assertTrue(all(r['other'] == 0 for r in rendered), rendered)
                    self.assertTrue(all(abs(y-round(y)) < .0001 for y in offsets), offsets)
                    self.assertEqual({round(y) for y in offsets}, set(range(steps+1)), offsets)
                    if width == 390:
                        await page.set_viewport_size({'width':1440,'height':900})
                        await page.wait_for_function("document.querySelector('#dronePixelFixture .brand-drone-body').width===65")
                    await page.evaluate('()=>dronePixelBrand.destroy()')
                finally:
                    await context.close()

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
            const expected=document.createElement('canvas');expected.width=source.naturalWidth;expected.height=source.naturalHeight;
            const {width,height}=expected;
            const ctx=expected.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(source,0,0);
            const original=ctx.getImageData(0,0,width,height).data;
            ctx.clearRect(0,0,width,height);ctx.drawImage(body,0,0,width,height);
            ctx.drawImage(drone.querySelectorAll('.brand-drone-frame')[f],0,0,width,height);
            const combined=ctx.getImageData(0,0,width,height).data;
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
