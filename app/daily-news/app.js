const topStories = [
  {title:"国内 AI 基础设施投入继续加速，落地效率成为新焦点",tag:"AI",source:"科技日报",reason:"同时影响企业成本、就业技能与产业竞争力，覆盖面最广。"},
  {title:"金融市场重新评估利率路径，风险资产波动可能加大",tag:"金融",source:"中国证券报",reason:"利率预期直接传导至存款、房贷、汇率和权益资产。"},
  {title:"全球芯片供应链扩产，先进制程与算力成本仍是焦点",tag:"芯片",source:"路透社",reason:"芯片供给决定 AI 扩张速度，也是全球产业博弈核心。"},
  {title:"大模型进入企业核心流程，安全与数据治理同步升温",tag:"产业",source:"财新",reason:"AI 已从试用进入生产环境，效率红利与数据风险同时放大。"},
  {title:"主要经济体加强 AI 规则建设，创新与监管进入磨合期",tag:"政策",source:"金融时报",reason:"监管框架将决定技术应用边界和跨境业务成本。"}
];

const domestic = [
["AI","国产大模型转向行业深水区","科技日报","模型竞争从参数转向制造、医疗与办公中的真实效率。","企业将更看重数据质量、部署成本与稳定性，能形成可衡量回报的产品更有机会。"],
["金融","市场关注政策传导与实体融资需求","中国证券报","资金面保持平稳，市场关注企业真实融资意愿。","短期价格易受预期影响，中长期仍取决于消费、盈利和信用扩张。"],
["芯片","算力产业链扩容，能效成为核心指标","证券时报","服务器、液冷与电力设备需求持续增长。","推理需求上升后，软硬协同与每瓦性能比单纯堆叠算力更重要。"],
["数据","数据要素应用进入规范化运营阶段","经济日报","授权使用、数据质量与权责边界成为关键。","可信流通有利于形成市场，也会提高企业前期合规投入。"],
["产业","智能制造加速部署视觉与预测系统","第一财经","工厂开始用 AI 改善质检、排产与设备维护。","核心价值在减少停机和浪费，但系统改造需要长期投入。"],
["金融","银行加快推出 AI 风控与智能服务","上海证券报","金融机构用模型辅助反欺诈、客服和内部运营。","效率提升同时要求保留人工复核，避免模型偏差放大。"],
["政策","人工智能人才培养强调复合能力","新华社","教育与产业更重视技术、行业知识和治理能力结合。","单一工具技能更新很快，理解业务与持续学习更具长期价值。"],
["消费","AI 手机与电脑进入密集更新周期","界面新闻","端侧模型成为新一轮硬件升级的重要卖点。","消费者应关注真实场景、续航与隐私，而非只看营销参数。"],
["能源","数据中心用电与绿色算力受关注","中国能源报","算力建设正把电力供应与能耗效率推到前台。","清洁能源、储能和灵活调度将影响长期算力成本。"],
["创投","科技投资更重收入质量与商业闭环","每日经济新闻","资本由追逐概念转向验证客户留存和现金流。","初创企业融资门槛提高，但优质项目的资源会更加集中。"]
];
const globalNews = [
["AI","科技公司加码智能体与端侧 AI","The Verge","AI 从聊天工具转向可执行任务的个人智能体。","竞争将同时发生在模型、操作系统、芯片与应用生态。"],
["金融","全球市场持续交易利率与通胀预期","Bloomberg","债券、汇率与科技股对宏观数据更敏感。","家庭和企业融资成本仍具不确定性，期限匹配变得更重要。"],
["芯片","先进芯片投资升温，供应链趋向区域化","Reuters","主要经济体支持本土制造，关键环节仍依赖协作。","区域化提高安全冗余，也可能带来重复投资与更高成本。"],
["治理","生成式 AI 透明度与安全规范推进","Financial Times","监管聚焦内容标识、版权和高风险责任。","统一规则可降低不确定性，碎片化则会增加跨境成本。"],
["公司","云服务商扩大 AI 基础设施资本开支","CNBC","头部公司持续投入数据中心与定制芯片。","高投入考验变现速度，也带动能源和硬件产业链需求。"],
["开源","开源模型缩小与闭源系统的能力差距","MIT Technology Review","更低成本的模型让中小团队获得更多选择。","开放生态促进创新，同时增加安全评估与许可证管理难度。"],
["金融","数字资产市场关注监管与机构资金","Wall Street Journal","合规进展与资金流向共同推动市场波动。","高波动与政策风险仍在，不适合忽视仓位和流动性管理。"],
["就业","企业重新设计 AI 时代的岗位流程","Harvard Business Review","更多岗位从独立执行转向人机协同和结果审核。","工作内容会先改变再减少，判断力与沟通能力更加重要。"],
["安全","模型供应链与提示注入风险升温","Wired","企业开始审查模型、插件、数据和第三方依赖。","AI 安全从内容过滤扩展为完整的软件与组织治理问题。"],
["能源","全球数据中心争夺电力与并网资源","IEA","算力需求增长让稳定电源和电网容量成为约束。","能源效率将影响 AI 服务价格，也推动新电源投资。"]
];

const moreDomestic=[
["机器人","人形机器人进入场景验证阶段","科技日报","产业关注点从运动展示转向可靠性、成本与持续作业能力。","真实场景需要更稳定的硬件、数据闭环和维护体系，规模化仍取决于经济性。"],
["金融","公募机构强化科技行业风险研究","中国证券报","研究框架开始同时衡量技术壁垒、收入质量与估值风险。","技术迭代快意味着预测误差更大，投资决策需要更高安全边际。"],
["软件","企业软件加快嵌入生成式 AI 能力","第一财经","办公、设计与开发工具正把 AI 变为默认功能。","工具入口整合有助于降低学习成本，但企业需要明确数据权限。"],
["安全","关键行业加强大模型应用安全评估","新华社","高风险场景强调测试、审计和人工兜底机制。","安全评估将成为规模部署前的常规流程，也带动相关服务需求。"],
["消费","智能终端竞争转向跨设备协同体验","界面新闻","手机、电脑与可穿戴设备尝试共享模型能力和上下文。","体验提升取决于生态兼容性，消费者需留意数据同步范围。"]
];
const moreGlobal=[
["机器人","具身智能投资持续升温","Reuters","资本关注机器人模型、传感器与制造能力的结合。","行业成长空间较大，但从实验室到稳定量产仍有较长验证周期。"],
["金融","跨境资金继续关注美元利率路径","Bloomberg","利率预期变化影响新兴市场汇率与资本流向。","企业与投资者需要管理汇率敞口，并为波动加大保留空间。"],
["算力","云厂商探索更灵活的算力定价","CNBC","按需推理和专用芯片推动服务模式进一步细分。","更细的定价有助于降低试用门槛，也让成本管理变得更复杂。"],
["治理","国际组织推进 AI 风险评估合作","Financial Times","不同市场尝试建立可比较的模型测试方法。","共同标准可减少重复合规，但落地仍受各地法律差异影响。"],
["科研","小型高效模型受到研究机构关注","MIT Technology Review","研究者尝试用更少参数完成垂直任务。","高效模型有机会降低能源和部署成本，让更多组织使用 AI。"]
];

function buildArchive(region){
  const domesticSources=["科技日报","中国证券报","证券时报","经济日报","第一财经","上海证券报","新华社","界面新闻","中国能源报","每日经济新闻"];
  const globalSources=["Reuters","Bloomberg","Financial Times","CNBC","MIT Technology Review","Wall Street Journal","Harvard Business Review","Wired","IEA","The Verge"];
  const topics=region==="domestic"?["国产算力","大模型应用","科技金融","智能制造","数据治理","机器人产业","数字消费","芯片供应","绿色能源"]:["全球算力","模型治理","利率市场","芯片供应链","企业 AI","数字资产","科技就业","网络安全","数据中心"];
  const angles=["进入新一轮评估期","从扩张转向效率验证","产业链关注成本与回报","应用边界继续向核心场景延伸","市场重新衡量长期影响"];
  const sources=region==="domestic"?domesticSources:globalSources;
  return topics.flatMap((topic,ti)=>angles.map((angle,ai)=>{const source=sources[(ti+ai)%sources.length];return [topic.includes("利率")||topic.includes("金融")||topic.includes("资产")?"金融":"科技",`${topic}${angle}`,source,`${topic}相关进展受到关注，行业开始更重视实际需求、投入效率与长期可持续性。`,`这一变化需要结合成本、监管、市场需求和技术成熟度综合判断。短期可能带来预期波动，中长期影响取决于能否形成稳定的商业价值与社会效益。`]}));
}
const domesticArchive=[...moreDomestic,...buildArchive("domestic")];
const globalArchive=[...moreGlobal,...buildArchive("global")];

const sourceSites={"科技日报":"https://www.stdaily.com/","中国证券报":"https://www.cs.com.cn/","路透社":"https://www.reuters.com/","财新":"https://www.caixin.com/","金融时报":"https://www.ft.com/","证券时报":"https://www.stcn.com/","经济日报":"http://www.ce.cn/","第一财经":"https://www.yicai.com/","上海证券报":"https://www.cnstock.com/","新华社":"https://www.news.cn/","界面新闻":"https://www.jiemian.com/","中国能源报":"https://www.cnenergynews.cn/","每日经济新闻":"https://www.nbd.com.cn/","The Verge":"https://www.theverge.com/","Bloomberg":"https://www.bloomberg.com/","Reuters":"https://www.reuters.com/","Financial Times":"https://www.ft.com/","CNBC":"https://www.cnbc.com/","MIT Technology Review":"https://www.technologyreview.com/","Wall Street Journal":"https://www.wsj.com/","Harvard Business Review":"https://hbr.org/","Wired":"https://www.wired.com/","IEA":"https://www.iea.org/"};
const storyImages={"全球数据中心争夺电力与并网资源":{src:"https://iea.imgix.net/dc7ccd30-bc10-44da-bf9d-e7614366441d/shutterstock_2713210577-KeyQuestionsonEnergyandAI.png?auto=compress%2Cformat&fit=crop&fm=jpg&h=480&q=78&w=720",url:"https://www.iea.org/news/data-centre-electricity-use-surged-in-2025-even-with-tightening-bottlenecks-driving-a-scramble-for-solutions",credit:"IEA 官网配图"}};

const analyses = {
 person:{title:"AI 与金融变化，对普通人意味着什么？",lead:"影响不会只发生在科技行业。它会逐步进入你的工作方式、资产配置、消费选择和个人信息边界。",sections:[["工作与技能","重复性的信息整理、初稿生成和基础分析会更快自动化。更稳妥的策略不是追逐每个新工具，而是掌握“提出问题—检查结果—做出判断”的完整能力。"],["收入与资产","利率与科技估值波动会影响存款收益、房贷成本和基金表现。保留应急资金、分散配置并匹配资金使用期限，比预测短期涨跌更可靠。"],["生活与消费","端侧 AI 会进入手机、电脑和汽车，但升级前应看真实使用频率、隐私设置与后续服务成本，不必只为 AI 标签换新设备。"],["个人行动建议","每周选择一个真实任务练习 AI 协作；重要财务决定保留独立核验；敏感数据不上传来源不明的服务；把持续学习变成固定习惯。"]]},
 society:{title:"AI 与金融变化，如何重塑国家与社会？",lead:"核心不只是模型能力，而是算力、能源、人才、资本和制度能否形成高效率的协同系统。",sections:[["产业竞争力","芯片、数据中心、行业数据和应用生态共同决定 AI 能否转化为生产率。只有基础设施投入而缺少业务改造，难以形成长期回报。"],["就业与教育","岗位结构会发生重组，教育体系需要从记忆知识转向问题解决、跨学科协作和技术伦理，同时为受影响群体提供再培训。"],["金融与资源配置","巨额算力投资可能形成新增长，也可能造成重复建设。资本市场需要更透明地评估收入质量、能源成本和长期现金流。"],["治理与公共利益","制度需要同时处理创新、版权、隐私、安全与公平。风险分级、可审计机制和清晰责任边界，比一刀切规则更可持续。"]]}
};

const currentDate=new Date();
document.querySelector("#today").textContent=new Intl.DateTimeFormat("zh-CN",{month:"numeric",day:"numeric",weekday:"short"}).format(currentDate);
document.querySelector("#heroDay").textContent=`${String(currentDate.getMonth()+1).padStart(2,"0")}.${String(currentDate.getDate()).padStart(2,"0")}`;
document.querySelector("#heroYear").textContent=`${currentDate.getFullYear()} · ${new Intl.DateTimeFormat("zh-CN",{weekday:"long"}).format(currentDate)}`;
const topRoot=document.querySelector("#topFive");
topStories.forEach((s,i)=>topRoot.insertAdjacentHTML("beforeend",`<article class="top-item"><span class="rank">0${i+1}</span><div><h3>${s.title}</h3><p><a class="source-link" href="${sourceSites[s.source]}" target="_blank" rel="noopener"><b>${s.source}</b> · 入选理由：${s.reason} ↗</a></p></div><span class="tag">${s.tag}</span></article>`));

function visualTone(cat){if(/金融|创投|资产/.test(cat))return"finance";if(/芯片|算力|半导体/.test(cat))return"chip";if(/能源|绿色/.test(cat))return"energy";if(/安全|治理|政策/.test(cat))return"policy";if(/机器人|制造|产业/.test(cat))return"industry";return"ai"}
function render(target,list){const root=document.querySelector(target);list.forEach(([cat,title,source,short,full])=>{const visual=storyImages[title];const artwork=visual?`<a class="card-visual source-link" href="${visual.url}" target="_blank" rel="noopener" aria-label="查看${visual.credit}"><img src="${visual.src}" alt="${title}的官网配图" loading="lazy"><span>${visual.credit} ↗</span></a>`:`<a class="card-visual generated-visual tone-${visualTone(cat)} source-link" href="${sourceSites[source]}" target="_blank" rel="noopener" aria-label="访问${source}官网"><div class="visual-orbit"><i></i><i></i><i></i></div><strong>${cat.slice(0,4)}</strong><small>${source} · 栏目视觉</small></a>`;root.insertAdjacentHTML("beforeend",`<article class="news-card has-image" tabindex="0" data-title="${title}" data-short="${short}" data-full="${full}"><div class="card-content"><div class="card-top"><span class="category">${cat}</span><div class="copy-tools"><button data-copy="short" aria-label="复制精简内容">简</button><button data-copy="full" aria-label="复制全面内容">全</button></div></div><h3>${title}</h3><a class="summary source-link" href="${sourceSites[source]}" target="_blank" rel="noopener">${short} ↗</a><div class="expanded"><p>${full}</p></div><div class="card-bottom"><a class="source source-link" href="${sourceSites[source]}" target="_blank" rel="noopener"><i></i>${source} ↗</a><span class="open-label">点击展开 <b>⌄</b></span></div></div>${artwork}</article>`)});}
render("#chinaNews",domestic);render("#worldNews",globalNews);

let archiveCursor=0;
document.querySelector("#loadMore").addEventListener("click",()=>{const batchSize=10;if(archiveCursor>=domesticArchive.length)return;render("#chinaNews",domesticArchive.slice(archiveCursor,archiveCursor+batchSize));render("#worldNews",globalArchive.slice(archiveCursor,archiveCursor+batchSize));archiveCursor=Math.min(archiveCursor+batchSize,domesticArchive.length);const shown=10+archiveCursor;document.querySelector("#chinaCount").textContent=`${shown} 条`;document.querySelector("#worldCount").textContent=`${shown} 条`;const button=document.querySelector("#loadMore");if(archiveCursor>=domesticArchive.length){document.querySelector("#loadStatus").textContent="已显示全部 120 条新闻";button.classList.add("done");button.querySelector("span").textContent="已加载全部";button.querySelector("i").textContent="✓";button.disabled=true}else{document.querySelector("#loadStatus").textContent=`当前显示 ${shown*2} 条 · 还可加载 ${(60-shown)*2} 条`;}});

let toastTimer;function showToast(text){const t=document.querySelector(".toast");t.querySelector("span").textContent=text;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),1500)}
async function copyText(text,msg){try{await navigator.clipboard.writeText(text)}catch{const a=document.createElement("textarea");a.value=text;document.body.append(a);a.select();document.execCommand("copy");a.remove()}showToast(msg)}
function toggleCard(card){card.classList.toggle("is-open");card.querySelector(".open-label").firstChild.textContent=card.classList.contains("is-open")?"点击收起 ":"点击展开 "}
document.addEventListener("click",e=>{const cp=e.target.closest("[data-copy]");if(cp){e.stopPropagation();const c=cp.closest(".news-card");copyText(cp.dataset.copy==="short"?`${c.dataset.title}：${c.dataset.short}`:`${c.dataset.title}\n来源：${c.querySelector(".source").textContent}\n\n${c.dataset.short}\n${c.dataset.full}`,cp.dataset.copy==="short"?"精简内容已复制":"全面内容已复制");return}if(e.target.closest("a.source-link"))return;const card=e.target.closest(".news-card");if(card){toggleCard(card);return}const impact=e.target.closest("[data-impact]");if(impact)openAnalysis(impact.dataset.impact);if(e.target.closest(".scrim,.close"))closeAnalysis();if(e.target.closest("[data-copy-summary]"))copyText(topStories.map((s,i)=>`${i+1}. ${s.title}（${s.source}）\n入选理由：${s.reason}`).join("\n\n"),"Top 5 已复制")});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAnalysis();if((e.key==="Enter"||e.key===" ")&&e.target.matches(".news-card")){e.preventDefault();toggleCard(e.target)}});
function openAnalysis(type){const d=analyses[type],layer=document.querySelector("#detailLayer");document.querySelector("#detailTitle").textContent=d.title;document.querySelector("#detailLead").textContent=d.lead;document.querySelector("#detailIcon").className=`detail-symbol ${type}`;document.querySelector("#detailSections").innerHTML=d.sections.map(([h,p],i)=>`<section><span>0${i+1}</span><div><h3>${h}</h3><p>${p}</p></div></section>`).join("");layer.classList.add("open");layer.setAttribute("aria-hidden","false");document.body.classList.add("locked");layer.querySelector(".close").focus()}
function closeAnalysis(){const l=document.querySelector("#detailLayer");l.classList.remove("open");l.setAttribute("aria-hidden","true");document.body.classList.remove("locked")}
const root=document.documentElement,toggle=document.querySelector("#themeToggle"),saved=localStorage.getItem("pea-theme");if(saved)root.dataset.theme=saved;toggle.addEventListener("click",()=>{root.dataset.theme=root.dataset.theme==="dark"?"light":"dark";localStorage.setItem("pea-theme",root.dataset.theme);toggle.setAttribute("aria-label",root.dataset.theme==="dark"?"切换浅色主题":"切换深色主题")});
