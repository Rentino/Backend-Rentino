/**
 * Backend allow-list for gear specification keys. Mirrors
 * `frontend/src/lib/catalog-limits.ts` so the API and the provider form agree.
 */
export const ALLOWED_SPEC_KEYS: Record<string, string[]> = {
  consoles: ["نسل", "نسخه", "حافظه", "دسته", "بازی همراه", "اشتراک", "رزولوشن"],
  bikes: [
    "مدل",
    "جنس بدنه",
    "سایز چرخ",
    "سایز",
    "دنده",
    "ترمز",
    "وزن",
    "سبد حمل بار",
    "قفل و چراغ",
    "برند",
  ],
  cameras: [
    "حسگر",
    "لنز",
    "رزولوشن",
    "لرزشگیر",
    "فیلمبرداری",
    "کارت حافظه",
    "باتری همراه",
    "ضدآب",
    "لوازم جانبی",
  ],
  laptops: ["پردازنده", "رم", "حافظه", "نمایشگر", "گرافیک", "شارژدهی"],
  sports: ["سطح", "تعداد راکت", "توپ همراه", "کیف حمل", "برند"],
};

export const ALL_SPEC_KEYS = Array.from(
  new Set(Object.values(ALLOWED_SPEC_KEYS).flat()),
);

/** http(s) links and local `/images/...` paths are accepted image sources. */
export function isValidImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }
  return trimmed.startsWith("/") && !trimmed.startsWith("//");
}
