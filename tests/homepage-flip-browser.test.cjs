const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');

const pageUrl=pathToFileURL(path.resolve(__dirname,'../app/homepage-test.html')).href;
const artifacts=path.resolve(__dirname,'../artifacts');
fs.mkdirSync(artifacts,{recursive:true});

test('homepage covers reveal actions while labels stay below and links and dialogs remain usable',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route(/^https?:/,route=>route.abort());
    await page.goto(pageUrl);
    await page.waitForSelector('#home-tools .home-cover-card');
    assert.equal(await page.locator('.module-card.home-cover-card').count(),12);
    for(const cover of await page.locator('.tool-cover>img').all()){
      await cover.scrollIntoViewIfNeeded();
      await cover.evaluate(img=>img.decode());
    }
    assert.equal(new Set(await page.locator('.tool-cover>img').evaluateAll(imgs=>imgs.map(img=>img.src))).size,12);
    const first=page.locator('#home-tools .module-card').first();
    const href=await first.getAttribute('href');
    assert.equal(href,'./project-hub.html');
    await first.scrollIntoViewIfNeeded();
    await page.mouse.move(0,0);await page.waitForTimeout(700);
    assert.equal(await first.locator('.tool-cover').getAttribute('aria-hidden'),'true');
    const before=await first.locator('.cover-reveal').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m33);
    assert.ok(before<.1,`fold starts at ${before}`);
    await first.hover();
    await page.waitForTimeout(700);
    const after=await first.locator('.cover-reveal').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m33);
    assert.ok(after>.95);
    assert.equal(await first.getAttribute('href'),href);
    const clipped=await page.locator('.module-card').evaluateAll(cards=>cards.filter(card=>{const cover=card.querySelector('.tool-cover').getBoundingClientRect();const title=card.querySelector('.tool-label').getBoundingClientRect();return title.top<cover.bottom||card.scrollWidth>card.clientWidth+2}).map(card=>card.textContent));
    assert.deepEqual(clipped,[]);
    await page.mouse.move(0,0);await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(700);
    await page.screenshot({path:path.join(artifacts,'homepage-covers-light.png'),fullPage:true});
    await page.locator('[data-next]').click();
    assert.equal(await page.locator('.poster-1').getAttribute('data-position'),'current');
    await page.locator('[data-prev]').click();
    assert.equal(await page.locator('.poster-0').getAttribute('data-position'),'current');
    await page.screenshot({path:path.join(artifacts,'homepage-flip-light.png')});
    await page.locator('[data-theme-toggle]').click();
    await first.hover();await page.waitForTimeout(700);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.screenshot({path:path.join(artifacts,'homepage-flip-dark.png')});
    await page.locator('.home-nav [data-home-nav="blog"]').click();
    const blog=page.locator('.blog-entry-card.home-flip-card');
    await blog.hover();await page.waitForTimeout(700);
    assert.ok(await blog.locator('.home-flip-back').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m33)>.95);
    await page.screenshot({path:path.join(artifacts,'homepage-flip-blog.png')});
    await page.locator('.home-nav [data-home-nav="notice"]').click();
    const service=page.locator('.service-card.home-flip-card').first();
    assert.equal(await service.count(),1);
    await service.hover();await page.waitForTimeout(700);
    await page.screenshot({path:path.join(artifacts,'homepage-flip-service.png')});
    await service.click();
    assert.equal(await page.locator('[data-service-dialog]').evaluate(el=>el.open),true);
    assert.deepEqual(errors,[]);

    const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await mobile.route(/^https?:/,route=>route.abort());
    await mobile.goto(pageUrl);
    await mobile.waitForSelector('#home-tools .home-cover-card');
    assert.equal(await mobile.locator('#home-tools .cover-reveal').first().isVisible(),false);
    assert.equal(await mobile.locator('#home-tools .module-copy').first().isVisible(),true);
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=2);
    await mobile.screenshot({path:path.join(artifacts,'homepage-flip-mobile.png')});
    const reduced=await browser.newPage({viewport:{width:1200,height:800},reducedMotion:'reduce'});
    await reduced.goto(pageUrl);
    await reduced.waitForSelector('#home-tools .home-cover-card');
    assert.equal(await reduced.locator('#home-tools .cover-reveal').first().isVisible(),false);
    assert.equal(await reduced.locator('#home-tools .module-copy').first().isVisible(),true);
  }finally{await browser.close();}
});
