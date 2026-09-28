import { getDataProvider } from "@/lib/data";
import { PracticeClient } from "./client";

export default async function PracticePage() {
  const provider = getDataProvider();
  const topics = await provider.examQuestionTopics();
  return <PracticeClient topics={topics} />;
}
