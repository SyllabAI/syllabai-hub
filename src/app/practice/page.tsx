import type { Metadata } from "next";
import { getDataProvider } from "@/lib/data";
import { PracticeClient } from "./client";

export const metadata: Metadata = { title: "Practice" };

export default async function PracticePage() {
  const provider = getDataProvider();
  const topics = await provider.examQuestionTopics();
  return <PracticeClient topics={topics} />;
}
