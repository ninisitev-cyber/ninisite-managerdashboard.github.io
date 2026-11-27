# دیدبان نی‌نی‌سایت | داشبورد مدیریتی

داشبورد فارسی برای مشاهدهٔ شاخص‌های تجمیعی گردآوری و برچسب‌گذاری داده‌های نی‌نی‌سایت. صفحهٔ «بازبینی خزش» وضعیت URLها، صفحه‌بندی، موضوع‌ها و خطاها را با متن خوانا و نمودارهای روشن توضیح می‌دهد.

## اجرا و ساخت

نیازمندی: Node.js 22 یا جدیدتر.

```sh
npm ci
npm run build
npm run preview
```

خروجی آمادهٔ انتشار در `dist/` ساخته می‌شود. برای توسعه، `npm run dev` ابتدا ساخت را انجام می‌دهد و سپس سرور محلی را اجرا می‌کند.

### مرکز کنترل (خزش + تحلیل خودکار + بازبینی کلیدواژه‌ای)

از پوشهٔ `manager-dashboard`:

```sh
npm run review
```

سپس باز کنید:

- `http://127.0.0.1:4173/control.html` — مرکز کنترل
- `http://127.0.0.1:4173/crawl-review.html` — بازبینی تفصیلی خزش

مرکز کنترل هر ۳۰ ثانیه تحلیل تجمیعی را از SQLite تازه می‌کند و دو اسکن محتوا دارد:

1. بازبینی ۳ صفحهٔ آخر هر تاپیک (سریع)
2. بازبینی ۱۰ صفحهٔ آخر هر تاپیک (هم‌تراز سقف صفحه‌بندی تاپیک)

اسکن از `scripts/scan_bad_content.py` و واژه‌نامهٔ `config/bad_content_keywords.json` استفاده می‌کند. نتیجه در جدول‌های `content_flag_runs` / `content_flags` ذخیره می‌شود. پرچم‌ها ارجاع بازبینی انسانی‌اند، نه حکم قانونی.

اسکن مستقل از داشبورد:

```powershell
.\.venv\Scripts\python.exe scripts\scan_bad_content.py --pages 3 --export manager-dashboard\public\data\bad-content-review.json
.\.venv\Scripts\python.exe scripts\scan_bad_content.py --pages 10
```

### سرور تحلیل زندهٔ خزش

دکمهٔ «به‌روزرسانی تحلیل» درخواست `POST /api/crawl-review/refresh` یا `POST /api/control/analysis/refresh` را می‌فرستد؛ سرور آمار را دوباره از `../data/crawler_database.sqlite` محاسبه می‌کند. این دکمه خزش تازه‌ای آغاز نمی‌کند. سرور فقط به `127.0.0.1` گوش می‌دهد.

برای پایگاه داده در مسیر دیگر، متغیر محیطی `CRAWL_DB_PATH` تنظیم شود. مسیر اختیاری `TOPIC_COVERAGE_PATH` نیز گزارش موضوع‌ها را مشخص می‌کند. حداقل Node.js 22 لازم است؛ ماژول SQLite داخلی این نسخه هنوز پیام ExperimentalWarning نمایش می‌دهد.

برای تازه‌سازی snapshot ایستای قابل انتشار، `npm run export:review` و سپس `npm run build` اجرا شود. انتشار این خروجی در GitHub Pages نیازمند commit و push است.

## داده‌ها و دامنهٔ داشبورد

فایل `public/data/snapshot.json` شامل شاخص‌های تجمیعی داشبورد اصلی است. صفحهٔ بازبینی خزش در سرور محلی از SQLite می‌خواند و در GitHub Pages از `public/data/crawl-review.json` استفاده می‌کند. نسخهٔ عمومی به پایگاه دادهٔ محلی دسترسی ندارد؛ دکمهٔ آن راه اجرای محلی را توضیح می‌دهد. وضعیت فعلی گردآوری ناتمام است؛ آمار برچسب‌گذاری نیز برای پایش داخلی و نیازمند اعتبارسنجی مستقل مدل است.

این انتشار فقط شامل آمار تجمیعی است و متن پیام‌ها، شناسهٔ کاربران، نام‌ها، ایمیل‌ها و کلیدهای API را منتشر نمی‌کند. پیش از انتشار عمومی، هر تصویر دادهٔ جدید باید با همین محدودیت بازبینی شود.

## انتشار

گردش‌کار GitHub Actions در `.github/workflows/deploy.yml` با هر push به شاخهٔ `main`، پروژه را می‌سازد و در GitHub Pages منتشر می‌کند. مخزن باید GitHub Pages را روی منبع **GitHub Actions** تنظیم کرده باشد. آدرس معمول مخزن:

`https://ninisitev-cyber.github.io/ninisite-managerdashboard.github.io/`

گزارش مدیریتی یکپارچه به‌صورت صفحهٔ مستقل و خودبسنده در [ninisite_all_in_one.html](https://ninisitev-cyber.github.io/ninisite-managerdashboard.github.io/ninisite_all_in_one.html) منتشر می‌شود.

