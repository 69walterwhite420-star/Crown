"use client";

import { DevToolbar } from "@/components/layout/dev-toolbar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useData } from "@/lib/data/context";
import { useSession } from "@/lib/data/hooks";
import { formatPoints, formatUSDC, shortAddress, toMicro } from "@/lib/utils";

const COLORS = [
  "--bg",
  "--surface",
  "--surface-2",
  "--border",
  "--border-strong",
  "--text",
  "--text-muted",
  "--text-faint",
  "--status",
  "--status-dim",
  "--money",
  "--money-dim",
  "--danger",
  "--warn",
  "--info",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 className="text-h2 text-fg">{title}</h2>
      {children}
    </section>
  );
}

export default function KitchenSink() {
  const session = useSession();
  const data = useData();

  return (
    <main className="mx-auto flex max-w-content flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-1">
        <span className="mono text-caption text-fg-faint">/dev/kitchen-sink</span>
        <h1 className="text-display-l text-fg">Kitchen sink</h1>
        <p className="text-fg-muted">All Phase 0 tokens and primitives in one place — for visual review.</p>
      </header>

      <Section title="Color (tokens)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {COLORS.map((name) => (
            <div key={name} className="flex flex-col gap-2">
              <div
                className="h-14 rounded border border-border"
                style={{ background: `var(${name})` }}
              />
              <span className="mono text-small text-fg-muted">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="flex flex-col gap-2">
          <p className="text-display-xl">Display XL</p>
          <p className="text-display-l">Display L</p>
          <p className="text-h1">H1 — section heading</p>
          <p className="text-h2">H2 — subsection</p>
          <p className="text-h3">H3 — card</p>
          <p className="text-body">Body — main interface text.</p>
          <p className="text-small text-fg-muted">Small — meta info.</p>
          <p className="text-caption">Caption / eyebrow</p>
          <p className="mono text-fg">Mono · 1,234.56 · 7xKp…3fQa</p>
        </div>
      </Section>

      <Section title="Formatting (utils)">
        <div className="mono flex flex-col gap-1 text-small text-fg">
          <span>formatUSDC(toMicro(12.5)) → {formatUSDC(toMicro(12.5))}</span>
          <span>formatUSDC(9_700_000n) → {formatUSDC(9_700_000n)}</span>
          <span>formatPoints(5000) → {formatPoints(5000)}</span>
          <span>shortAddress(&quot;7xKpHnQ9aR4dF2sV3fQa&quot;) → {shortAddress("7xKpHnQ9aR4dF2sV3fQa")}</span>
        </div>
      </Section>

      <Section title="Button">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="money">Money (final)</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Input fields">
        <div className="grid max-w-xl gap-4">
          <Input label="Realm handle" placeholder="my-channel" helper="Latin letters, digits, hyphen" />
          <Input label="Amount" mono placeholder="0.00" defaultValue="10.00" />
          <Input label="With error" defaultValue="bad" error="Address is invalid" />
          <Textarea
            label="Crown message"
            placeholder="Text…"
            maxLength={200}
            showCount
            helper="Text is private until shown (HELD)"
          />
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All-time</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="top">Top supporter</TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <p className="text-small text-fg-muted">All-time leaderboard (placeholder).</p>
          </TabsContent>
          <TabsContent value="month">
            <p className="text-small text-fg-muted">Monthly leaderboard (placeholder).</p>
          </TabsContent>
          <TabsContent value="top">
            <p className="text-small text-fg-muted">Top supporter of the month (placeholder).</p>
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Tooltip · Dialog · Toast">
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary">Hover (tooltip)</Button>
            </TooltipTrigger>
            <TooltipContent>Reign cannot be bought or transferred.</TooltipContent>
          </Tooltip>

          <Dialog>
            <DialogTrigger asChild>
              <Button>Open Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirmation</DialogTitle>
                <DialogDescription>
                  A crown is irreversible. No refunds. (Demo dialog, no actions.)
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="money">Confirm</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button
            variant="secondary"
            onClick={() => toast({ variant: "success", title: "Shown", description: "Message published." })}
          >
            Toast success
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast({ variant: "error", title: "Error", description: "Could not complete." })}
          >
            Toast error
          </Button>
        </div>
      </Section>

      <Section title="States (loading / empty / error)">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
          <EmptyState
            title="Nothing yet"
            description="Connect wallet and activate your realm."
            action={<Button size="sm">Activate</Button>}
          />
          <ErrorState description="Could not load." onRetry={() => toast({ title: "Retry" })} />
        </div>
      </Section>

      <Section title="useData() — smoke check (empty mock)">
        <div className="mono flex flex-col gap-1 rounded border border-border bg-surface p-4 text-small text-fg">
          <span>getSession(): {session.isLoading ? "loading…" : JSON.stringify(session.data)}</span>
          <span className="text-fg-muted">
            The request goes through useData() → MockDataProvider (NEXT_PUBLIC_DATA_SOURCE).
          </span>
        </div>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await data.createDonation({ channelId: "demo", amountUSDC: 10 });
              } catch (e) {
                toast({
                  variant: "error",
                  title: "Mutation not implemented (Phase 0)",
                  description: e instanceof Error ? e.message : String(e),
                });
              }
            }}
          >
            Call createDonation (as guest we expect &quot;connect wallet&quot;)
          </Button>
        </div>
      </Section>

      <Section title="Dev toolbar (sessions · errors · fixtures)">
        <DevToolbar />
      </Section>
    </main>
  );
}
