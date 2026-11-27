# NEO — لوحة التحكم (مجانية)

- صفحة المدير: `/admin.html`
- كل شيء يعمل على خطة Cloudflare المجانية:
  - **D1** (`neo-music-preview`, binding `DB`): بيانات الأغاني والزوار
  - **KV** (`neo-music-production`, binding `MEDIA`): ملفات الأغاني والأغلفة
  - **Pages Functions**: ملفات `functions/api/*`

## الإعداد (مرة واحدة)

1. **مفتاح المدير:** في Cloudflare → Workers & Pages → `neo-music-official` → Settings → Variables and Secrets
   أضف سراً (Secret) باسم `ADMIN_KEY` وقيمة طويلة (16 حرفاً على الأقل). أضفه لبيئة Production و Preview.
2. **الربط (Bindings):** يقرؤها Cloudflare تلقائياً من `wrangler.json`. إذا لم تظهر، أضفها يدوياً في Settings → Bindings:
   - D1 database: الاسم `DB` ← `neo-music-preview`
   - KV namespace: الاسم `MEDIA` ← `neo-music-production`
3. أعد النشر (Deployments → Retry deployment) بعد إضافة المفتاح.

إن كان المشروع غير مربوط بـ GitHub (رفع مباشر)، انشر من مجلد المشروع:

```
npx wrangler pages deploy
```

## حدود الخطة المجانية

| | الحد |
|---|---|
| حجم الأغنية | 25 MB (حد KV) |
| مساحة الملفات | 1 GB |
| رفع/تعديل ملفات | 1000 عملية يومياً |
| طلبات الموقع | 100,000 يومياً |

## الـ API

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/api/tracks` | الأغاني المنشورة (عام) |
| POST | `/api/tracks` | رفع أغنية (مدير) |
| PATCH | `/api/tracks/:id` | تعديل الاسم/الفنان/النشر (مدير) |
| PUT | `/api/tracks/:id` | استبدال الصوت/الغلاف (مدير) |
| DELETE | `/api/tracks/:id` | حذف (مدير) |
| GET | `/api/admin/overview` | كل الأغاني + الإحصائيات (مدير) |
| GET | `/api/media/audio/:id` · `/api/media/cover/:id` | الملفات |
| GET | `/api/visitors` | عدّاد الزوار |

طلبات المدير تحتاج الترويسة `Authorization: Bearer <ADMIN_KEY>`.
