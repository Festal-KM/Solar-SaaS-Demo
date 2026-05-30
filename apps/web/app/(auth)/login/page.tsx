"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
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

import { signInAction, type SignInActionState } from "./actions";

const formSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});

type FormValues = z.infer<typeof formSchema>;

export default function SignInPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "" },
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    const fd = new FormData();
    fd.set("email", values.email);
    fd.set("password", values.password);

    startTransition(async () => {
      const prev: SignInActionState = { status: "IDLE" };
      const result = await signInAction(prev, fd);
      switch (result.status) {
        case "OK":
          router.push("/dashboard");
          return;
        case "LOCKED":
          router.push(
            result.lockedUntil
              ? `/locked?until=${encodeURIComponent(result.lockedUntil)}`
              : "/locked",
          );
          return;
        case "USER_SUSPENDED":
          setServerError(labels.signIn.suspended);
          return;
        case "USER_INVITED":
          setServerError(labels.signIn.invited);
          return;
        case "ERROR":
          setServerError(labels.signIn.unknownError);
          return;
        case "INVALID_CREDENTIALS":
        default:
          setServerError(labels.signIn.invalidCredentials);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{labels.signIn.title}</h1>
        <p className="text-muted-foreground text-sm">{labels.signIn.subtitle}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{labels.signIn.emailLabel}</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder={labels.signIn.emailPlaceholder}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{labels.signIn.passwordLabel}</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder={labels.signIn.passwordPlaceholder}
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
            {pending ? labels.signIn.submitting : labels.signIn.submit}
          </Button>
        </form>
      </Form>

      <div className="text-muted-foreground flex flex-col gap-2 text-center text-sm">
        <Link href="/reset" className="underline-offset-4 hover:underline">
          {labels.signIn.forgotPassword}
        </Link>
        <Link href="/signup/code" className="underline-offset-4 hover:underline">
          {labels.signIn.dealerInviteCode}
        </Link>
      </div>
    </div>
  );
}
