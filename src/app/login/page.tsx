import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginClient } from "./login-client";

export const metadata: Metadata = {
  title: "Sign in — SyllabAI Hub",
  description:
    "Sign in or create your SyllabAI account — your tutor, assistant and progress live on your account. Browsing the course hubs stays open to everyone.",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
          Loading sign-in…
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
