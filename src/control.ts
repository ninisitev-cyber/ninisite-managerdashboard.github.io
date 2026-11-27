type Counts = Record<string, number>;
type Item = { reason: string | null; count: number };
type Crawl = {
  schemaVersion: number; analyzedAt: string; databaseUpdatedAt: string; discovered: number; inScope: number;
  successfulPages: number; topicPages?: number; statuses: Counts; coveragePercent: number;
  pagination: { total: number; completed: number };
  run: { status: string; startedAt: string | null; lastRequestAt: string | null; requestRecentlyObserved: boolean; id?: string | null };
  adsSkipped?: number; topics: Counts | null; topicsUpdatedAt: string | null; history: { day: string; pages: number }[];
  failures: Item[]; exclusions: Item[]; complete: boolean;
};
type Flag = {
  topic_id: string | null; page_number: number; category: string; term: string; severity: string;
  policy_hint: string; title: string; snippet: string; flagged_at: string; url: string;
};
type Scan = {
  run: null | { id: string; started_at: string; finished_at: string | null; page_depth: number; lexicon_version: string; statistics: Counts & Record<string, unknown> };
  flags: Flag[]; by_category: Counts; by_severity: Counts;
};
type Status = { crawl: Crawl; scan: Scan; lexicon: { version: string; purpose: string; categories: Record<string, { severity: string; terms: number }> }; autoAnalysisSeconds: number };

const content = document.querySelector<HTMLElement>('#content')!;
const error = document.querySelector<HTMLElement>('#error')!;
const mode = document.querySelector<HTMLElement>('#source-mode')!;
const refreshBtn = document.querySelector<HTMLButtonElement>('#refresh')!;
const autoBox = document.querySelector<HTMLInputElement>('#auto')!;
const scan3 = document.querySelector<HTMLButtonElement>('#scan3')!;
const scan10 = document.querySelector<HTMLButtonElement>('#scan10')!;
const scanStatus = document.querySelector<HTMLElement>('#scan-status')!;

const n = (x: number) => new Intl.NumberFormat('fa-IR').format(x);
const pct = (x: number) => `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(x)}٪`;
const when = (s: string | null | undefined) => s ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' }).format(new Date(s)) : 'ثبت نشده';
const clean = (s: string) => s.replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]!));
const catFa: Record<string, string> = {
  child_sexual_safety_review: 'ایمنی جنسی کودک',
  adult_sexual_explicit: 'محتوای جنسی صریح بزرگسال',
  sexual_violence_or_coercion: 'خشونت/اجبار جنسی',
  threat_or_violence: 'تهدید یا خشونت',
  self_harm_encouragement_or_instructions: 'تشویق/آموزش خودآزاری',
  hate_or_identity_abuse: 'نفرت‌پراکنی',
  targeted_harassment: 'آزار هدفمند',
  potentially_dangerous_instructions: 'دستورالعمل خطرناک',
  suspected_scam_or_deception_review: 'کلاهبرداری مشکوک',
  commercial_promotion: 'تبلیغ تجاری',
  medical_claim_needs_verification: 'ادعای پزشکی نیازمند بررسی',
};

let timer: number | undefined;
let local = false;

function rows(items: Item[], empty: string) {
  return items.length
    ? `<ul class="list">${items.map(x => `<li><span>${clean(x.reason || 'دلیل ثبت نشده')}</span><strong>${n(x.count)}</strong></li>`).join('')}</ul>`
    : `<p>${empty}</p>`;
}

function render(status: Status) {
  const d = status.crawl;
  const scan = status.scan;
  const remaining = (d.statuses.pending || 0) + (d.statuses.processing || 0);
  const stats = (scan.run?.statistics || {}) as Counts;
  content.innerHTML = `
  <section class="banner ${d.complete ? '' : 'warn'}">
    <strong>${d.complete ? 'خزش ثبت‌شده کامل است.' : 'خزش هنوز کامل نشده است.'}</strong>
    <p>${n(remaining)} نشانی در صف است. آخرین درخواست: ${when(d.run.lastRequestAt)}. ${d.run.requestRecentlyObserved ? 'کارگر خزش اخیراً فعال بوده است.' : 'در ۵ دقیقه اخیر درخواست تازه‌ای دیده نشد.'}</p>
    <p class="note">تحلیل: ${when(d.analyzedAt)} · SQLite: ${when(d.databaseUpdatedAt)} · واژه‌نامه: ${clean(status.lexicon.version)}</p>
  </section>
  <section class="grid metrics" aria-label="شاخص‌های کنترل">
    <article class="card"><span class="label">صفحه‌های موفق</span><strong>${n(d.successfulPages)}</strong><small>ذخیره‌شده در پایگاه</small></article>
    <article class="card"><span class="label">پوشش URL</span><strong>${pct(d.coveragePercent)}</strong><small>تکمیل‌شده ÷ درون محدوده</small></article>
    <article class="card"><span class="label">تاپیک‌های ذخیره‌شده</span><strong>${n(d.topicPages || 0)}</strong><small>صفحهٔ موضوع گفتگو</small></article>
    <article class="card"><span class="label">تبلیغ کنارگذاشته</span><strong>${n(d.adsSkipped || 0)}</strong><small>مسیر/میزبان آگهی</small></article>
  </section>
  <div class="grid sections">
    <section class="panel">
      <h2>وضعیت خزش</h2>
      <ul class="list">
        <li><span>تکمیل‌شده</span><strong>${n(d.statuses.completed || 0)}</strong></li>
        <li><span>در انتظار</span><strong>${n(d.statuses.pending || 0)}</strong></li>
        <li><span>در حال پردازش</span><strong>${n(d.statuses.processing || 0)}</strong></li>
        <li><span>ناموفق</span><strong>${n(d.statuses.failed || 0)}</strong></li>
        <li><span>کنارگذاشته</span><strong>${n(d.statuses.skipped || 0)}</strong></li>
      </ul>
      <h3>خطاهای پرتکرار</h3>${rows(d.failures, 'خطایی ثبت نشده است.')}
    </section>
    <section class="panel">
      <h2>آخرین اسکن کلیدواژه</h2>
      ${scan.run ? `
        <p>اجرا: <b>${clean(scan.run.id)}</b> · عمق صفحه: <b>${n(scan.run.page_depth)}</b></p>
        <p>شروع: ${when(scan.run.started_at)} · پایان: ${when(scan.run.finished_at)}</p>
        <div class="chip-row">
          <span class="chip">پرچم‌ها: ${n(Number(stats.flags || scan.flags.length || 0))}</span>
          <span class="chip">موضوع‌های علامت‌خورده: ${n(Number(stats.flagged_topics || 0))}</span>
          <span class="chip">صفحهٔ اسکن‌شده: ${n(Number(stats.pages_scanned || 0))}</span>
        </div>
        <h3>بر اساس دسته</h3>
        <ul class="list">${Object.entries(scan.by_category).map(([k, v]) => `<li><span>${clean(catFa[k] || k)}</span><strong>${n(v)}</strong></li>`).join('') || '<li><span>موردی نیست</span><strong>۰</strong></li>'}</ul>
        <h3>بر اساس شدت</h3>
        <ul class="list">${Object.entries(scan.by_severity).map(([k, v]) => `<li><span class="sev ${clean(k)}">${clean(k)}</span><strong>${n(v)}</strong></li>`).join('') || '<li><span>موردی نیست</span><strong>۰</strong></li>'}</ul>
      ` : '<p>هنوز اسکنی اجرا نشده است. یکی از دکمه‌های ۳ یا ۱۰ صفحه را بزنید.</p>'}
      <p class="note">${clean(status.lexicon.purpose)}</p>
    </section>
  </div>
  <section class="panel">
    <h2>صف بازبینی پست‌های علامت‌خورده</h2>
    <p>فقط عنوان، دسته، کلیدواژه و برش کوتاه نرمال‌شده نمایش داده می‌شود.</p>
    ${scan.flags.length ? `
      <table class="flag-table">
        <thead><tr><th>شدت</th><th>دسته / کلیدواژه</th><th>عنوان</th><th>صفحه</th><th>نشانی</th></tr></thead>
        <tbody>${scan.flags.map(f => `
          <tr>
            <td><span class="sev ${clean(f.severity)}">${clean(f.severity)}</span></td>
            <td><div>${clean(catFa[f.category] || f.category)}</div><small>${clean(f.term)}</small><div class="note">${clean(f.snippet || '')}</div></td>
            <td>${clean(f.title || 'بدون عنوان')}</td>
            <td>${n(f.page_number)}</td>
            <td class="mono">${clean(f.url || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p>پرچمی برای نمایش وجود ندارد.</p>'}
  </section>`;
}

async function load(refresh = false) {
  refreshBtn.disabled = true;
  refreshBtn.textContent = refresh ? 'در حال محاسبه…' : 'در حال بارگذاری…';
  error.hidden = true;
  try {
    let response: Response;
    if (refresh) {
      response = await fetch('./api/control/analysis/refresh', { method: 'POST', cache: 'no-store' });
      if (!response.ok) throw new Error('تازه‌سازی تحلیل ممکن نشد.');
      local = true;
      const payload = await response.json();
      render({ crawl: payload.crawl, scan: payload.scan, lexicon: (await (await fetch('./api/control/status', { cache: 'no-store' })).json()).lexicon, autoAnalysisSeconds: 30 });
    } else {
      try {
        response = await fetch('./api/control/status', { cache: 'no-store' });
        if (!response.ok) throw new Error('Local API unavailable');
        local = true;
        render(await response.json() as Status);
      } catch (e) {
        response = await fetch('./data/crawl-review.json', { cache: 'no-store' });
        if (!response.ok) throw e;
        local = false;
        const crawl = await response.json() as Crawl;
        let scan: Scan = { run: null, flags: [], by_category: {}, by_severity: {} };
        try { scan = await (await fetch('./data/bad-content-review.json', { cache: 'no-store' })).json(); } catch { /* optional snapshot */ }
        render({ crawl, scan, lexicon: { version: 'snapshot', purpose: 'نسخهٔ منتشرشده', categories: {} }, autoAnalysisSeconds: 30 });
      }
    }
    mode.textContent = local ? 'متصل به SQLite و خزش محلی · تحلیل خودکار فعال‌شدنی است' : 'نسخهٔ ایستا · اسکن زنده فقط روی سرور محلی';
  } catch (e) {
    error.hidden = false;
    error.textContent = e instanceof Error ? e.message : 'بارگذاری مرکز کنترل ممکن نشد.';
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'تازه‌سازی تحلیل';
  }
}

async function runScan(pages: 3 | 10) {
  if (!local) {
    error.hidden = false;
    error.textContent = 'اسکن زنده فقط با سرور محلی (npm run review) ممکن است.';
    return;
  }
  scan3.disabled = scan10.disabled = true;
  scanStatus.textContent = `در حال اسکن عمق ${pages} صفحه…`;
  error.hidden = true;
  try {
    const response = await fetch('./api/control/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages }),
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'اسکن ناموفق بود');
    const status = await (await fetch('./api/control/status', { cache: 'no-store' })).json() as Status;
    render(status);
    const flags = status.scan.run?.statistics?.flags ?? status.scan.flags.length;
    scanStatus.textContent = `اسکن عمق ${pages} تمام شد · ${n(Number(flags))} پرچم`;
  } catch (e) {
    error.hidden = false;
    error.textContent = e instanceof Error ? e.message : 'اسکن ممکن نشد.';
    scanStatus.textContent = 'اسکن ناموفق';
  } finally {
    scan3.disabled = scan10.disabled = false;
  }
}

function setupAuto() {
  if (timer) window.clearInterval(timer);
  if (!autoBox.checked || !local) return;
  timer = window.setInterval(() => { void load(true); }, 30_000);
}

refreshBtn.addEventListener('click', () => { void load(true).then(setupAuto); });
autoBox.addEventListener('change', setupAuto);
scan3.addEventListener('click', () => void runScan(3));
scan10.addEventListener('click', () => void runScan(10));
void load().then(setupAuto);

export {};
