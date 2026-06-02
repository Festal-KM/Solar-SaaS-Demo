"use client";

// 顧客チャット（CustomerMessage）— 顧客詳細「チャット」タブ.
// 担当者間のやり取りを時系列で表示し、テキストを投稿する。自分の投稿は右寄せ。

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { createCustomerMessage } from "./chat-actions";

import type { ChatMessage } from "./data";

interface CustomerChatProps {
  customerId: string;
  messages: ChatMessage[];
  currentUserId: string;
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function initial(name: string): string {
  return name.trim().charAt(0) || "?";
}

export function CustomerChat({ customerId, messages, currentUserId }: CustomerChatProps) {
  const t = labels.customer.detail.chat;
  const c = labels.common;
  const router = useRouter();

  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);

  // 末尾（最新メッセージ）へスクロール。
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  function handleSend() {
    const trimmed = body.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await createCustomerMessage({ customerId, body: trimmed });
        setBody("");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 送信 / Shift+Enter 改行。
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-[28rem] flex-col">
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-mute-light">{t.empty}</p>
        ) : (
          messages.map((m) => {
            const mine = m.authorUserId === currentUserId;
            return (
              <div
                key={m.id}
                className={["flex items-end gap-2", mine ? "flex-row-reverse" : "flex-row"].join(" ")}
              >
                <div
                  className={[
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                    mine ? "bg-primary/10 text-primary" : "bg-surface-soft text-mute-light",
                  ].join(" ")}
                  title={m.authorName}
                >
                  {initial(m.authorName)}
                </div>
                <div className={["max-w-[75%] space-y-0.5", mine ? "items-end text-right" : ""].join(" ")}>
                  <div className="flex items-center gap-2 text-[11px] text-mute-light">
                    {!mine && <span className="font-medium text-body-light">{m.authorName}</span>}
                    <span>{formatStamp(m.createdAt)}</span>
                  </div>
                  <div
                    className={[
                      "inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                      mine
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface-soft text-ink",
                    ].join(" ")}
                  >
                    {m.body}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 flex items-end gap-2 border-t border-hairline-light pt-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={t.placeholder}
          className="flex-1 resize-none rounded-md border border-hairline-light bg-white px-3 py-2 text-sm text-ink placeholder:text-mute-light focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <Button type="button" onClick={handleSend} disabled={isPending || !body.trim()} className="shrink-0">
          <Send size={16} className="mr-1" />
          {t.send}
        </Button>
      </div>
    </div>
  );
}
