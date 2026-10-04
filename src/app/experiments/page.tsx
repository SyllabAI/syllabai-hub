import Link from "next/link";
import { FlaskConical, Network, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Experiments",
};

const EXPERIMENTS = [
  {
    href: "/experiments/kg-navigation",
    icon: Network,
    title: "kg-navigation",
    status: "SEED",
    desc: "Graph-driven navigation: pick a spec point, jump straight into its notes and questions in one flow. Tests whether the KG can act as the product's front door.",
  },
  {
    href: "/experiments/semantic-search",
    icon: Search,
    title: "semantic-search",
    status: "SEED",
    desc: "One search box over the whole bundled corpus (notes + questions + concepts) with kind filters and spec-point chips. Tests retrieval UX before any semantic backend exists.",
  },
];

export default function ExperimentsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <FlaskConical className="size-5 text-primary" aria-hidden />
          Experiments
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Isolated, deletable prototypes. Each experiment is one folder under{" "}
          <span className="font-mono text-xs">src/app/experiments/</span> — it may import the data
          providers and contracts, but the permanent architecture never imports an experiment.
          Failed experiments should be easy to delete; successful ones easy to promote.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {EXPERIMENTS.map((e) => (
          <Link key={e.href} href={e.href} className="group focus-visible:outline-none">
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <e.icon className="size-4 text-primary" aria-hidden />
                  <span className="font-mono">{e.title}</span>
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {e.status}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="leading-relaxed">{e.desc}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Add your own in minutes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            1. Create <span className="font-mono text-xs">src/app/experiments/my-idea/page.tsx</span>{" "}
            (server or client component).
          </p>
          <p>
            2. Read data via the provider seam{" "}
            <span className="font-mono text-xs">getDataProvider()</span> — mock/neon/core-api swap
            without touching your UI.
          </p>
          <p>
            3. Keep writes confined to the SIMULATED overlay; never mutate canonical semantics.
          </p>
          <p>4. Delete it when the question is answered. Document the finding in the page footer.</p>
        </CardContent>
      </Card>
    </div>
  );
}
