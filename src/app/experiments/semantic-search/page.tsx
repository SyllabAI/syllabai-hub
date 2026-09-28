import { getDataProvider } from "@/lib/data";
import { SemanticSearchExperiment } from "./client";

export const metadata = { title: "semantic-search — experiments" };

export default async function SemanticSearchPage() {
  const provider = getDataProvider();
  const [notes, topics, graph] = await Promise.all([
    provider.revisionNotes(),
    provider.examQuestionTopics(),
    provider.conceptGraph(),
  ]);
  return <SemanticSearchExperiment notes={notes} topics={topics} graph={graph} />;
}
