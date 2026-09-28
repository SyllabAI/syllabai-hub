import { getDataProvider } from "@/lib/data";
import { KgNavigationExperiment } from "./client";

export const metadata = { title: "kg-navigation — experiments" };

export default async function KgNavigationPage() {
  const provider = getDataProvider();
  const [curriculum, notes, topics] = await Promise.all([
    provider.curriculum(),
    provider.revisionNotes(),
    provider.examQuestionTopics(),
  ]);
  return <KgNavigationExperiment curriculum={curriculum} notes={notes} topics={topics} />;
}
