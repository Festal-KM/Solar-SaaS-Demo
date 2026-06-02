"use client";

// shadcn/ui Tabs primitive — Radix `@radix-ui/react-tabs` のラッパー。
//
// 2 つの見た目をサポートする:
//   - "default"   : shadcn 既定（bg-muted のピル状トリガーリスト）。masters 等で使用。
//   - "underline" : アクティブタブ下にスライドするインジケーター（顧客詳細で使用）。
//
// underline は Radix の `data-state="active"` を MutationObserver で監視し、
// アクティブトリガーの offsetLeft / offsetWidth を測ってインジケーターを移動する
// （Base UI の Tabs.Indicator 相当を Tailwind v3 + Radix で再現）。

import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";

import { cn } from "@/lib/utils";

export type TabsVariant = "default" | "underline";

const TabsVariantContext = React.createContext<TabsVariant>("default");

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }
>(({ className, variant = "default", children, ...props }, ref) => {
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  React.useImperativeHandle(ref, () => innerRef.current as HTMLDivElement);

  const [indicator, setIndicator] = React.useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  React.useEffect(() => {
    if (variant !== "underline") return;
    const list = innerRef.current;
    if (!list) return;

    const update = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(list);
    // タブ切り替え（data-state の変化）を監視して追従。
    const mo = new MutationObserver(update);
    mo.observe(list, { attributes: true, subtree: true, attributeFilter: ["data-state"] });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [variant, children]);

  if (variant === "underline") {
    return (
      <TabsVariantContext.Provider value="underline">
        <TabsPrimitive.List
          ref={innerRef}
          className={cn(
            "border-hairline-light text-mute-light relative flex w-full items-center gap-x-1 overflow-x-auto border-b",
            className,
          )}
          {...props}
        >
          {children}
          <span
            aria-hidden
            className="bg-primary pointer-events-none absolute bottom-0 h-0.5 transition-all duration-200 ease-in-out"
            style={{ left: indicator.left, width: indicator.width }}
          />
        </TabsPrimitive.List>
      </TabsVariantContext.Provider>
    );
  }

  return (
    <TabsVariantContext.Provider value="default">
      <TabsPrimitive.List
        ref={innerRef}
        className={cn(
          "bg-muted text-muted-foreground inline-flex h-10 items-center justify-center rounded-md p-1",
          className,
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
    </TabsVariantContext.Provider>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);

  if (variant === "underline") {
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
          "text-mute-light hover:text-ink data-[state=active]:text-ink relative inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap px-3 text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  }

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "ring-offset-background focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "ring-offset-background focus-visible:ring-ring mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
