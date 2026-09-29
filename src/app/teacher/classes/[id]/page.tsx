import type { Metadata } from "next";
import { ClassDetailClient } from "./class-detail-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Class workspace — SyllabAI Hub teacher workspace",
  description:
    "One class's roster and announcements: enroll registered students, publish notices with per-student read state — live from the SyllabAI backend.",
};

export default async function TeacherClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClassDetailClient classId={id} />;
}
