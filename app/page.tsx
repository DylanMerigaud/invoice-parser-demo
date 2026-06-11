import { ParserClient } from "@/components/parser-client";
import { EvalBadge } from "@/components/eval-badge";
import { loadEvalResults } from "@/lib/eval-results";

// Read eval/results.json fresh on each request so a new `pnpm eval` shows up
// without a rebuild in dev.
export const dynamic = "force-dynamic";

export default async function Home() {
  const evalResults = await loadEvalResults();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-10 sm:py-16">
      <Header />

      {evalResults && (
        <div className="mt-6">
          <EvalBadge results={evalResults} />
        </div>
      )}

      <div className="mt-8">
        <ParserClient />
      </div>

      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
          <LogoIcon />
        </span>
        <span className="text-sm font-semibold tracking-tight text-ink">
          AI Invoice Parser
        </span>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Turn any invoice PDF into structured, validated data.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          Claude reads the document directly — no OCR pipeline — and returns a
          schema-checked object. Every result is validated with Zod and run
          through automated consistency checks before you see it.
        </p>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-auto pt-12">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-5 text-xs text-muted">
        <span>Stateless — your PDF is never stored.</span>
        <span aria-hidden>·</span>
        <span>Rate-limited per IP.</span>
        <span aria-hidden>·</span>
        <span>
          Extraction by{" "}
          <span className="font-mono text-ink/70">claude-sonnet-4-6</span>.
        </span>
      </div>
    </footer>
  );
}

function LogoIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}
