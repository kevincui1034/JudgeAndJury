import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Lock, Terminal, X } from "lucide-react";

import { DashboardPreview } from "@/components/marketing/DashboardPreview";
import { TerminalCard } from "@/components/marketing/TerminalCard";
import {
  FAILURE_CLASSES,
  HOW_IT_WORKS,
  SPONSORS,
} from "@/components/marketing/fixtures";
import { MountIn } from "@/components/motion/MountIn";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { Badge, ClassChip, Mono } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Proofjury — the last command before production",
  description:
    "The correctness gate for AI-written code. Deterministic checks decide, the judge explains with evidence, and every block becomes a prior the gate recalls.",
};

function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`mx-auto w-full max-w-6xl px-5 ${className}`}>
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium tracking-[0.16em] text-amber-ink uppercase">
      {children}
    </p>
  );
}

export default function LandingPage() {
  return (
    <>
      {/* ───────────────────────── hero ───────────────────────── */}
      <Section className="relative pt-16 pb-10 sm:pt-24">
        <div
          aria-hidden
          className="dot-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
        />
        <div className="mx-auto max-w-3xl text-center">
          <MountIn>
            <span className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-surface-2 px-3 py-1 text-[12px] text-body">
              <Terminal className="size-3.5 text-amber-ink" />
              Agent-neutral · Claude Code, Codex, Cursor
            </span>
          </MountIn>

          <MountIn delay={0.06}>
            <h1 className="mt-6 font-serif text-[44px] leading-[1.05] tracking-[-0.01em] text-ink sm:text-[64px]">
              The last command
              <br />
              before production.
            </h1>
          </MountIn>

          <MountIn delay={0.12}>
            <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-body">
              Your agent writes code no one reviews, then ships it. Proofjury
              intercepts the deploy command itself — deterministic checks decide,
              the judge explains with evidence, and every block becomes a prior
              the gate recalls next time.
            </p>
          </MountIn>

          <MountIn delay={0.18}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl bg-amber px-5 py-2.5 text-[14px] font-medium text-on-amber transition-colors hover:bg-amber-deep"
              >
                Connect a repo
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-xl border border-line-2 px-5 py-2.5 text-[14px] text-body transition-colors hover:border-amber/50 hover:text-ink"
              >
                See how it decides
              </a>
            </div>
          </MountIn>

          <MountIn delay={0.24}>
            <TerminalCard className="mx-auto mt-12 max-w-2xl" />
          </MountIn>
        </div>
      </Section>

      {/* ─────────────────── dashboard preview ─────────────────── */}
      <Section className="pt-6 pb-20">
        <Reveal>
          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-x-8 -top-6 -z-10 h-40 rounded-full bg-amber/10 blur-3xl"
            />
            <DashboardPreview className="[mask-image:linear-gradient(to_bottom,black_78%,transparent)]" />
          </div>
        </Reveal>
        <p className="mt-5 text-center text-[12px] text-faint">
          Every gate run as a trace — the verdict, the evidence, and what the
          judge told your agent.
        </p>
      </Section>

      {/* ───────────────────── how it works ───────────────────── */}
      <Section id="how" className="border-t border-line py-20">
        <Reveal>
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[38px]">
            The gate cannot be talked past.
          </h2>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-body">
            An agent can argue with a linter. It cannot argue with a command
            that never ran.
          </p>
        </Reveal>

        <Stagger className="mt-10 grid gap-4 md:grid-cols-3">
          {HOW_IT_WORKS.map((s, i) => (
            <StaggerItem key={s.step} index={i}>
              <div className="glass glass-edge h-full rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] text-amber-ink">
                    {s.step}
                  </span>
                  <Badge tone={s.lane.includes("DECIDES") ? "red" : "faint"} mono>
                    {s.lane}
                  </Badge>
                </div>
                <h3 className="mt-4 text-[17px] font-semibold text-ink">
                  {s.title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-body">
                  {s.body}
                </p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      {/* ─────────────────── what it catches ─────────────────── */}
      <Section id="catches" className="border-t border-line py-20">
        <Reveal>
          <Eyebrow>What it catches</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[38px]">
            Named failures, not vibes.
          </h2>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-body">
            Each block carries a class from an open taxonomy, so a recurrence is
            recognisable months later. Examples:
          </p>
        </Reveal>

        <Stagger className="mt-10 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {FAILURE_CLASSES.map((c, i) => (
            <StaggerItem key={c.name} index={i}>
              <div className="glass-flat flex h-full items-start gap-3 rounded-xl px-4 py-3">
                <X
                  className="mt-0.5 size-3.5 shrink-0 text-verdict-red"
                  strokeWidth={2.5}
                />
                <div className="min-w-0">
                  <ClassChip name={c.name} />
                  <p className="mt-1.5 text-[12px] leading-snug text-faint">
                    {c.blurb}
                  </p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      {/* ────────────────────── the proof ────────────────────── */}
      <Section id="proof" className="border-t border-line py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <Eyebrow>The proof record</Eyebrow>
            <h2 className="mt-3 text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[38px]">
              Proof, not promises.
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-body">
              Every run writes a reproducible record: the checks and their exit
              codes, the diff, the blast radius, and the diagnosis. The judge
              writes prose over that evidence — it never produces the verdict.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                ["checks.json", "every check, its result and its exit code"],
                ["diff.patch", "exactly what was about to ship"],
                ["impact.json", "the blast radius the checks measured"],
                ["context.json", "the priors recalled, and why they matched"],
              ].map(([file, note]) => (
                <li key={file} className="flex items-start gap-3">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-verdict-green"
                    strokeWidth={2.5}
                  />
                  <span className="text-[13px] text-body">
                    <Mono className="text-ink">{file}</Mono> — {note}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-6 flex items-start gap-2 text-[12px] leading-relaxed text-faint">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              BYOK, scrubbed at the edge, and nothing uploads until you run{" "}
              <Mono className="text-body">proofjury connect</Mono>.
            </p>
          </Reveal>

          <Reveal delay={1}>
            <div className="glass glass-edge rounded-2xl p-5">
              <p className="text-[12px] tracking-[0.08em] text-faint uppercase">
                Sponsor surfaces
              </p>
              <div className="mt-4 space-y-3">
                {SPONSORS.map((s) => (
                  <div
                    key={s.name}
                    className="border-t border-line pt-3 first:border-t-0 first:pt-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium text-ink">
                        {s.name}
                      </span>
                      <span className="text-[12px] text-faint">{s.role}</span>
                      <Badge tone={s.decides ? "red" : "faint"}>
                        {s.decides ? "can fail the gate" : "context only"}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
                      {s.note}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ───────────────────────── cta ───────────────────────── */}
      <Section className="border-t border-line py-20">
        <Reveal>
          <div className="glass glass-edge relative overflow-hidden rounded-3xl px-6 py-14 text-center">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-amber/10 blur-3xl"
            />
            <h2 className="relative text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[40px]">
              Make no mistakes — but for real this time.
            </h2>
            <p className="relative mx-auto mt-4 max-w-lg text-[14px] leading-relaxed text-body">
              One command in front of your deploy. It blocks, it explains, and
              it remembers.
            </p>
            <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl bg-amber px-5 py-2.5 text-[14px] font-medium text-on-amber transition-colors hover:bg-amber-deep"
              >
                Connect a repo
                <ArrowRight className="size-4" />
              </Link>
              <code className="glass-flat rounded-xl px-4 py-2.5 font-mono text-[13px] text-body">
                proofjury guard deploy -- ./deploy.sh
              </code>
            </div>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
