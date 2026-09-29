import type { Metadata } from "next";
import { ClassKGClient } from "./client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Class KG heatmap — SyllabAI Hub teacher workspace",
  description:
    "The class knowledge-graph heatmap: which topics the whole class struggles with, and which curriculum is simply not taught yet — the taught/not-taught × understanding matrix over the class's enrolled students.",
};

export default async function TeacherClassKGPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClassKGClient classId={id} />;
}
