"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { verifyMfaAction, type VerifyMfaState } from "./actions";

const schema = z.object({
  code: z.string().regex(/^\d{6}$/),
});
type FormValues = z.infer<typeof schema>;

export default function MfaChallengePage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "" },
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    const fd = new FormData();
    fd.set("code", values.code);

    startTransition(async () => {
      const prev: VerifyMfaState = { status: "IDLE" };
      const result = await verifyMfaAction(prev, fd);
      if (result.status === "OK") {
        router.push("/dashboard");
        return;
      }
      setServerError(result.status === "ERROR" ? labels.mfa.unknownError : labels.mfa.invalidCode);
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{labels.mfa.title}</h1>
        <p className="text-muted-foreground text-sm">{labels.mfa.subtitle}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{labels.mfa.codeLabel}</FormLabel>
                <FormControl>
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder={labels.mfa.codePlaceholder}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {serverError ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {serverError}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? labels.mfa.submitting : labels.mfa.submit}
          </Button>
        </form>
      </Form>
    </div>
  );
}
