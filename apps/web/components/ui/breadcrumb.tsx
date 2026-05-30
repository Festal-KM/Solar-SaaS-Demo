import Link from "next/link";

import { labels } from "@/lib/i18n/labels";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  const t = labels.breadcrumb;
  return (
    <nav aria-label={t.ariaLabel}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-pewter">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="flex items-center gap-1">
              {index > 0 && (
                <span aria-hidden="true" className="select-none">
                  {t.separator}
                </span>
              )}
              {isLast || !item.href ? (
                <span className={isLast ? "text-carbon-dark font-medium" : undefined}>
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="hover:text-carbon-dark transition-colors duration-[330ms]"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
