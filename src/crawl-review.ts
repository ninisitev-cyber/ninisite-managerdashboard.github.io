type Counts = Record<string,number>;
type Item = {reason:string|null;count:number};
type Review = {schemaVersion:number;analyzedAt:string;databaseUpdatedAt:string;discovered:number;inScope:number;successfulPages:number;statuses:Counts;coveragePercent:number;pagination:{total:number;completed:number};run:{status:string;startedAt:string|null;lastRequestAt:string|null;requestRecentlyObserved:boolean};topics:Counts|null;topicsUpdatedAt:string|null;history:{day:string;pages:number}[];failures:Item[];exclusions:Item[];complete:boolean};
const content=document.querySelector<HTMLElement>('#content')!;
const button=document.querySelector<HTMLButtonElement>('#update')!;
const mode=document.querySelector<HTMLElement>('#source-mode')!;
const error=document.querySelector<HTMLElement>('#error')!;
const n=(x:number)=>new Intl.NumberFormat('fa-IR').format(x);
const pct=(x:number)=>`${new Intl.NumberFormat('fa-IR',{maximumFractionDigits:1}).format(x)}٪`;
const when=(s:string|null)=>s?new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tehran'}).format(new Date(s)):'ثبت نشده';
const clean=(s:string)=>s.replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]!));
const statusNames:Record<string,string>={completed:'تکمیل‌شده',pending:'در انتظار',processing:'در حال پردازش',failed:'ناموفق',skipped:'کنارگذاشته‌شده',blocked:'مسدود'};
let local=false;
function rows(items:Item[],empty:string){return items.length?`<ul class="list">${items.map(x=>`<li><span>${clean(x.reason||'دلیل ثبت نشده')}</span><strong>${n(x.count)}</strong></li>`).join('')}</ul>`:`<p>${empty}</p>`;}
function render(d:Review){
  const remaining=(d.statuses.pending||0)+(d.statuses.processing||0);
  const seqPct=d.pagination.total?100*d.pagination.completed/d.pagination.total:0;
  const topics=d.topics;
  const peak=Math.max(1,...d.history.map(x=>x.pages));
  content.innerHTML=`<section class="banner ${d.complete?'':'warn'}"><strong>${d.complete?'خزش ثبت‌شده کامل است.':'خزش هنوز کامل نشده است.'}</strong><p>${n(remaining)} نشانی در صف یا در حال پردازش است. آخرین درخواست: ${when(d.run.lastRequestAt)}. ${d.run.requestRecentlyObserved?'درخواست تازه در پنج دقیقهٔ اخیر ثبت شده است.':'در پنج دقیقهٔ اخیر درخواست تازه‌ای ثبت نشده است.'}</p><p class="note">زمان محاسبه تحلیل: ${when(d.analyzedAt)} · دادهٔ SQLite: ${when(d.databaseUpdatedAt)}</p></section>
  <section class="grid metrics" aria-label="شاخص‌های اصلی"><article class="card"><span class="label">نشانی‌های درون محدوده</span><strong>${n(d.inScope)}</strong><small>URL کشف‌شده</small></article><article class="card"><span class="label">صفحه‌های موفق</span><strong>${n(d.successfulPages)}</strong><small>HTML/JSON ذخیره‌شده</small></article><article class="card"><span class="label">پوشش URL</span><strong>${pct(d.coveragePercent)}</strong><small>تکمیل‌شده ÷ درون محدوده</small></article><article class="card"><span class="label">نشانی‌های باقی‌مانده</span><strong>${n(remaining)}</strong><small>در انتظار + پردازش</small></article></section>
  <div class="grid sections"><section class="panel"><h2>وضعیت نشانی‌ها</h2><p>مجموع وضعیت‌ها برابر با نشانی‌های درون محدوده است.</p>${Object.entries(statusNames).map(([key,label])=>`<div class="status-row"><span>${label}</span><b>${n(d.statuses[key]||0)}</b><div class="track" aria-label="${label}: ${pct(100*(d.statuses[key]||0)/Math.max(1,d.inScope))}"><i class="fill ${key}" style="width:${100*(d.statuses[key]||0)/Math.max(1,d.inScope)}%"></i></div></div>`).join('')}</section><section class="panel"><h2>پیشرفت صفحه‌بندی</h2><p>دنباله‌های صفحه‌بندی تا سقف تنظیم‌شده یا انتهای شناسایی‌شده بررسی می‌شوند.</p><div class="big">${n(d.pagination.completed)} از ${n(d.pagination.total)}</div><div class="progress" role="img" aria-label="${pct(seqPct)} تکمیل"><span style="width:${seqPct}%"></span></div><div>${pct(seqPct)} از دنباله‌ها تکمیل شده است.</div>${topics?`<h2 style="margin-top:24px">موضوع‌های گفتگو</h2><ul class="list"><li><span>موضوع کشف‌شده</span><strong>${n(topics.topics_discovered||0)}</strong></li><li><span>دارای صفحه‌های ۱ تا ۱۰</span><strong>${n(topics.topics_with_first_ten_pages||0)}</strong></li><li><span>موضوع کوتاه‌ترِ کامل</span><strong>${n(topics.shorter_topics_complete||0)}</strong></li><li><span>هنوز ناقص</span><strong>${n(topics.topics_pending||0)}</strong></li></ul><p class="note">زمان گزارش موضوع‌ها: ${when(d.topicsUpdatedAt)}</p>`:''}</section></div>
  <div class="grid sections"><section class="panel"><h2>صفحه‌های ذخیره‌شده در هر روز</h2><p>روز دریافت صفحه، نه تاریخ انتشار مطلب.</p><div class="bars" role="img" aria-label="نمودار تعداد صفحه‌ها بر اساس روز">${d.history.map(x=>`<div class="bar-wrap"><i class="bar" style="height:${Math.max(2,100*x.pages/peak)}%"></i><span class="tip">${clean(x.day)}: ${n(x.pages)}</span></div>`).join('')}</div><p class="note">${n(d.history.length)} روز دارای صفحهٔ موفق ثبت‌شده</p></section><section class="panel"><h2>خطاها و کنارگذاری‌ها</h2><p>این موارد در درصد تکمیل‌شده حساب نشده‌اند.</p><h3>خطاهای پرتکرار</h3>${rows(d.failures,'خطایی ثبت نشده است.')}<h3>دلایل کنارگذاری</h3>${rows(d.exclusions,'کنارگذاری ثبت نشده است.')}</section></div>
  <section class="panel"><h2>این گزارش چگونه به‌روز می‌شود؟</h2><p>در اجرای محلی، دکمهٔ «به‌روزرسانی تحلیل» داده‌های تجمیعی را مستقیم از SQLite فقط‌خواندنی دوباره محاسبه می‌کند. این دکمه خزش تازه‌ای آغاز نمی‌کند. در GitHub Pages، آخرین snapshot منتشرشده نمایش داده می‌شود؛ برای تازه‌سازی عمومی باید snapshot جدید صادر و سایت دوباره منتشر شود.</p><p class="note">آخرین وضعیتِ ثبت‌شدهٔ فرایند: ${clean(d.run.status)}. فعال بودن فرایند فقط با زمان درخواست‌های اخیر سنجیده می‌شود.</p></section>`;
}
async function load(refresh=false){
  button.disabled=true;button.textContent=refresh?'در حال محاسبه…':'در حال بارگذاری…';error.hidden=true;
  try{
    let response:Response;
    if(refresh && !local) throw new Error('برای محاسبهٔ تازه از SQLite، سایت را با سرور محلی اجرا کنید.');
    try{response=await fetch(refresh?'./api/crawl-review/refresh':'./api/crawl-review',{method:refresh?'POST':'GET',cache:'no-store'});if(!response.ok)throw new Error('Local API unavailable');local=true;}
    catch(e){if(refresh)throw e;response=await fetch('./data/crawl-review.json',{cache:'no-store'});if(!response.ok)throw new Error('تصویر دادهٔ منتشرشده در دسترس نیست.');local=false;}
    const data=await response.json() as Review;
    if(data.schemaVersion!==1 || !Number.isFinite(data.inScope) || Object.values(data.statuses).reduce((a,b)=>a+b,0)!==data.inScope)throw new Error('ساختار یا جمع وضعیت‌های گزارش معتبر نیست.');
    render(data);mode.textContent=local?'متصل به SQLite محلی · تحلیل تازه با دکمه':'نسخهٔ منتشرشده · محاسبهٔ تازه فقط در سرور محلی';
  }catch(e){error.hidden=false;error.textContent=e instanceof Error?e.message:'به‌روزرسانی ممکن نشد.';}
  finally{button.disabled=false;button.textContent='به‌روزرسانی تحلیل';}
}
button.addEventListener('click',()=>void load(true));
void load();
