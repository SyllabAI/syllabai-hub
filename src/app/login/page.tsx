import type { Metadata } from "next";
import { LoginClient } from "./login-client";

export const metadata: Metadata = {
  title: "Sign in — SyllabAI Hub",
  description:
    "Mockup login that splits the student and teacher modes. Authentication is not wired yet — any credentials sign you in locally.",
};

export default function LoginPage() {
  return <LoginClient />;
}
