"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
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

import { completeTotpSetupAction, initTotpSetupAction, type VerifyMfaState } from "../actions";

interface SetupPayload {
  qrcodeDataUrl: string;
  secretMasked: string;
  backupCodes: string[];
}

const schema = z.object({
  code: z.string().regex(/^\d{6}$/),
});
type FormValues = z.infer<typeof schema>;

export default function MfaSetupPage() {
  const router = useRouter();
  const [payload, setPayload] = useState<SetupPayload | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "" },
  });

  useEffect(() => {
    let mounted = true;
    initTotpSetupAction()
      .then((res) => {
        if (mounted) setPayload(res);
      })
      .catch(() => {
        if (mounted) setInitError(labels.mfaSetup.initError);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const downloadBackupCodes = useCallback(() => {
    if (!payload) return;
    const blob = new Blob([payload.backupCodes.join("\n") + "\n"], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "solar-saas-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }, [payload]);

  function onSubmit(values: FormValues) {
    setServerError(null);
    const fd = new FormData();
    fd.set("code", values.code);

    startTransition(async () => {
      const prev: VerifyMfaState = { status: "IDLE" };
      const res = await completeTotpSetupAction(prev, fd);
      if (res.status === "OK") {
        router.push("/dashboard");
        return;
      }
      setServerError(res.status === "ERROR" ? labels.mfa.unknownError : labels.mfa.invalidCode);
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{labels.mfaSetup.title}</h1>
        <p className="text-muted-foreground text-sm">{labels.mfaSetup.subtitle}</p>
      </div>

      {initError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {initError}
        </p>
      ) : null}

      {!payload && !initError ? (
        <p className="text-muted-foreground text-sm">{labels.mfaSetup.loading}</p>
      ) : null}

      {payload ? (
        <>
          <div className="border-border bg-muted/30 flex flex-col items-center gap-3 rounded-md border p-4">
            <Image
              src={payload.qrcodeDataUrl}
              alt="TOTP QR"
              width={192}
              height={192}
              unoptimized
              className="rounded-md bg-white p-2"
            />
            <div className="text-center">
              <p className="text-muted-foreground text-xs">{labels.mfaSetup.manualSecretLabel}</p>
              <code className="text-sm">{payload.secretMasked}</code>
            </div>
          </div>

          <section aria-label={labels.mfaSetup.backupCodesTitle} className="space-y-2">
            <h2 className="text-sm font-medium">{labels.mfaSetup.backupCodesTitle}</h2>
            <p className="text-muted-foreground text-xs">{labels.mfaSetup.backupCodesNotice}</p>
            <ul className="border-border bg-muted/20 grid grid-cols-2 gap-2 rounded-md border p-3 font-mono text-sm">
              {payload.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button type="button" variant="outline" size="sm" onClick={downloadBackupCodes}>
              {labels.mfaSetup.downloadBackupCodes}
            </Button>
          </section>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{labels.mfaSetup.codeLabel}</FormLabel>
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
                {pending ? labels.mfaSetup.submitting : labels.mfaSetup.submit}
              </Button>
            </form>
          </Form>
        </>
      ) : null}
    </div>
  );
}
