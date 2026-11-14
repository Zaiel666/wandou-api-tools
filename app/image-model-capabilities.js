(function (root) {
  "use strict";
  // Verified 2026-11-14. Native capability and gateway aliases are deliberately separate.
  const sources = {
    google: "https://ai.google.dev/gemini-api/docs/image-generation",
    openai: "https://developers.openai.com/api/docs/guides/image-generation",
    xai: "https://docs.x.ai/developers/model-capabilities/images/generation"
  };
  const geminiPixels = {
    "1:1":[1024,1024],"2:3":[848,1264],"3:2":[1264,848],"3:4":[896,1200],"4:3":[1200,896],
    "4:5":[928,1152],"5:4":[1152,928],"9:16":[768,1376],"16:9":[1376,768],"21:9":[1584,672]
  };
  const legacyGeminiPixels = {
    "1:1":[1024,1024],"2:3":[832,1248],"3:2":[1248,832],"3:4":[864,1184],"4:3":[1184,864],
    "4:5":[896,1152],"5:4":[1152,896],"9:16":[768,1344],"16:9":[1344,768],"21:9":[1536,672]
  };
  const grokRatios=["1:1","16:9","9:16","4:3","3:4","3:2","2:3","2:1","1:2","19.5:9","9:19.5","20:9","9:20","21:9","5:2"];
  function normalize(model) {
    const value=String(model||"").replace(/\s*·\s*渠道\s*2\s*$/,"").trim().toLowerCase();
    return {"nano banana2":"gemini-3.1-flash-image-preview","nano bananapro":"gemini-3-pro-image-preview"}[value]||value;
  }
  function resolve(model) {
    const id=normalize(model);
    const base={id,verified:false,nativeTiers:[],kind:"unknown",label:"渠道能力待验证",source:""};
    if (/^gemini-(?:3\.1-flash|3-pro)-image(?:-preview)?$/.test(id) || id==="gemini-nano-banana-2.1") {
      const pixels={...geminiPixels};
      if (/3\.1-flash|nano-banana-2\.1/.test(id)) Object.assign(pixels,{"1:4":[512,2048],"4:1":[2048,512],"1:8":[384,3072],"8:1":[3072,384]});
      return {...base,kind:"gemini",verified:true,nativeTiers:["1K","2K","4K"],pixels,ratios:Object.keys(pixels),label:"原生分辨率",source:sources.google};
    }
    if (/^gemini-(?:2\.5-flash-image|3\.1-flash-lite-image)(?:-preview)?$/.test(id)) {
      const legacy=id.includes("2.5"),pixels=legacy?legacyGeminiPixels:geminiPixels;
      return {...base,kind:"gemini",verified:true,nativeTiers:["1K"],pixels,ratios:Object.keys(pixels),omitImageSize:legacy,label:"原生仅 1K",source:sources.google};
    }
    if (/^gpt-image-2\.6-(?:flare|sunburst)$/.test(id)) return {...base,kind:"openai-standard",verified:true,nativeTiers:["1K"],nativeSvg:true,nativeGif:true,complexity:true,formats:["png","jpeg","webp","svg","gif"],label:"原生 SVG / GIF；高分辨率像素能力待验证",source:sources.openai};
    if (/^gpt-image-(?:2|2\.5-(?:flare|sunburst))$/.test(id)) return {...base,kind:"openai-flex",verified:true,nativeTiers:["1K","2K","4K"],label:"原生像素（4K 受比例上限限制）",source:sources.openai};
    if (/^gpt-image-2\.5-1k$/.test(id)) return {...base,kind:"gateway-1k",nativeTiers:["1K"],label:"渠道 1K 别名，非官方型号"};
    if (id==="grok-imagine-image-2.0") return {...base,kind:"grok",verified:true,nativeTiers:["1K","2K"],ratios:grokRatios,label:"原生最高 2K",source:sources.xai};
    return base;
  }
  function dimensions(size) { const parts=String(size||"").split(/[x×]/i).map(Number);return {width:Math.max(1,parts[0]||1024),height:Math.max(1,parts[1]||1024)}; }
  function closestRatio(size,ratios) {
    const {width,height}=dimensions(size),ratio=width/height;
    return ratios.reduce((best,key)=>{const [w,h]=key.split(":").map(Number);return Math.abs(Math.log(ratio/(w/h)))<best.diff?{key,diff:Math.abs(Math.log(ratio/(w/h)))}:best},{key:"1:1",diff:Infinity}).key;
  }
  function gptSize(size) {
    const {width,height}=dimensions(size),ratio=Math.max(1/3,Math.min(3,width/height));
    let pixels=Math.min(8294400,Math.max(655360,width*height));
    let w=Math.sqrt(pixels*ratio),h=w/ratio;
    const edgeScale=Math.min(1,3840/Math.max(w,h));w*=edgeScale;h*=edgeScale;
    w=Math.max(16,Math.floor(w/16)*16);h=Math.max(16,Math.floor(h/16)*16);
    if(w>h*3)w=h*3;if(h>w*3)h=w*3;
    while(w*h<655360){if(w/h<ratio)w+=16;else h+=16;}
    return `${w}x${h}`;
  }
  function nativeSize(model,tier,requestedSize) {
    const cap=resolve(model),selected=cap.nativeTiers.includes(tier)?tier:cap.nativeTiers[0];
    if(cap.kind==="gemini") {
      const ratio=closestRatio(requestedSize,cap.ratios),scale={"1K":1,"2K":2,"4K":4}[selected]||1;
      return cap.pixels[ratio].map(value=>value*scale).join("x");
    }
    if(cap.kind==="openai-flex") {
      const {width,height}=dimensions(requestedSize),ratio=Math.max(1/3,Math.min(3,width/height));
      const area={"1K":1048576,"2K":4194304,"4K":8294400}[selected]||1048576;
      return gptSize(`${Math.sqrt(area*ratio)}x${Math.sqrt(area/ratio)}`);
    }
    if(cap.kind==="gateway-1k" || cap.kind==="openai-standard") {
      const {width,height}=dimensions(requestedSize);
      return Math.abs(width-height)<=Math.max(width,height)*.08?"1024x1024":width>height?"1536x1024":"1024x1536";
    }
    return requestedSize;
  }
  const api=Object.freeze({resolve,normalize,dimensions,closestRatio,gptSize,nativeSize,sources});
  root.WandouImageCapabilities=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
