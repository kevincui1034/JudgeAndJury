import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileText,
  Gavel,
  Lock,
  MessageSquareReply,
  Sparkles,
  TrendingDown,
} from "lucide-react";

import { DashboardPreview } from "@/components/marketing/DashboardPreview";
import { TerminalCard } from "@/components/marketing/TerminalCard";
import {
  FAILURE_CLASSES,
  HOW_IT_LEARNS,
  SIGNAL_SOURCES,
} from "@/components/marketing/fixtures";
import { MountIn } from "@/components/motion/MountIn";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import {
  AuthorityBadge,
  SponsorMark,
} from "@/components/sponsors/SponsorMark";
import { Badge, ClassChip, Mono } from "@/components/ui/primitives";
import { SENSO_DOCS } from "@/lib/senso-docs";
import { SPONSOR_LIST } from "@/lib/sponsors";

export const metadata: Metadata = {
  title: "Judge & Jury — the judge that learns your codebase",
  description:
    "A self-improving judge for AI-written code. It reviews what your agent ships, explains every finding with evidence, and retrains on the labels you give it.",
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

const SIGNAL_ICONS = [MessageSquareReply, Sparkles, TrendingDown];

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
              <Gavel className="size-3.5 text-amber-ink" />
              Agent-neutral · Claude Code, Codex, Cursor
            </span>
          </MountIn>

          <MountIn delay={0.06}>
            <h1 className="mt-6 font-serif text-[44px] leading-[1.05] tracking-[-0.01em] text-ink sm:text-[64px]">
              The judge that learns
              <br />
              your codebase.
            </h1>
          </MountIn>

          <MountIn delay={0.12}>
            <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-body">
              Judge &amp; Jury reviews everything your coding agent ships and explains
              each finding with the evidence behind it. Then you tell it what it
              got wrong — and it retrains on that. The advice you reject stops
              coming back, and the mistakes you keep correcting turn into rules
              the agent gets before it writes a line.
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
                href="#learns"
                className="inline-flex items-center gap-2 rounded-xl border border-line-2 px-5 py-2.5 text-[14px] text-body transition-colors hover:border-amber/50 hover:text-ink"
              >
                See how it learns
              </a>
            </div>
          </MountIn>

          <MountIn delay={0.24}>
            <TerminalCard className="mx-auto mt-12 max-w-2xl" />
          </MountIn>

          <MountIn delay={0.3}>
            <p className="mx-auto mt-4 max-w-xl text-[12px] leading-relaxed text-faint">
              One finding, one recalled prior, one preference it already learned
              — from three corrections you never had to repeat a fourth time.
            </p>
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
          Every judgment as a trace — what it found, what it cited, and whether
          you agreed.
        </p>
      </Section>

      {/* ───────────────────── how it learns ───────────────────── */}
      <Section id="learns" className="border-t border-line py-20">
        <Reveal>
          <Eyebrow>How it learns</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[38px]">
            A reviewer that gets sharper, not noisier.
          </h2>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-body">
            Most review tools are static: they make the same wrong call in month
            six that they made on day one, and you learn to ignore them. This one
            has an opinion you can correct — and correcting it is the whole
            interface.
          </p>
        </Reveal>

        <Stagger className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_LEARNS.map((s, i) => (
            <StaggerItem key={s.step} index={i}>
              <div className="glass glass-edge h-full rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] text-amber-ink">
                    {s.step}
                  </span>
                  <Badge tone="faint" mono>
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

      {/* ─────────────── what it learns from ─────────────── */}
      <Section id="signal" className="border-t border-line py-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
          <Reveal>
            <Eyebrow>What it learns from</Eyebrow>
            <h2 className="mt-3 text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[38px]">
              You are already labelling. It just wasn&apos;t being kept.
            </h2>
            <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-body">
              Every time you push back on your agent, you produce a labelled
              example of what &ldquo;wrong&rdquo; means in your codebase. That
              signal is normally thrown away. Here it is the training set — no
              annotation queue, no separate labelling job, nothing extra to run.
            </p>

            <div className="mt-8 space-y-4">
              {SIGNAL_SOURCES.map((s, i) => {
                const Icon = SIGNAL_ICONS[i];
                return (
                  <div key={s.title} className="flex gap-3.5">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-tint text-amber-ink">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[14px] font-medium text-ink">
                          {s.title}
                        </h3>
                        <Badge tone="faint" mono>
                          {s.metric}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-body">
                        {s.body}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Reveal>

          <Reveal delay={1}>
            <div className="glass glass-edge rounded-2xl p-5">
              <p className="text-[11px] tracking-[0.08em] text-faint uppercase">
                What changes as it learns
              </p>
              <div className="mt-4 space-y-3.5">
                {[
                  [
                    "Noisy classes fade",
                    "A class you keep marking a false positive is demoted in recall, so it stops leading the evidence.",
                  ],
                  [
                    "Corrections become rules",
                    "Three corrections in one category graduate into a candidate preference — and an active one is injected before the agent writes code.",
                  ],
                  [
                    "Recall stops needing exact words",
                    "A recurrence phrased completely differently still matches the prior that explains it.",
                  ],
                  [
                    "The model itself is retrained",
                    "Labelled findings pair with the prompts that produced them into a fine-tune corpus. Adopting the tuned judge is one line of config.",
                  ],
                ].map(([title, body]) => (
                  <div
                    key={title}
                    className="border-t border-line pt-3.5 first:border-t-0 first:pt-0"
                  >
                    <p className="text-[13.5px] font-medium text-ink">{title}</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
                      {body}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-5 rounded-lg bg-tint px-3 py-2 font-mono text-[11.5px] text-body">
                proofjury memory finetune
              </p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ─────────────────── the vocabulary ─────────────────── */}
      <Section id="catches" className="border-t border-line py-20">
        <Reveal>
          <Eyebrow>The vocabulary it judges in</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[38px]">
            Named failures, not vibes.
          </h2>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-body">
            A judgment is only trainable if it is specific. Every finding is
            tagged with a class from an open taxonomy — which is what makes a
            recurrence recognisable months later, and what makes your label mean
            something the next time. Examples:
          </p>
        </Reveal>

        <Stagger className="mt-10 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {FAILURE_CLASSES.map((c, i) => (
            <StaggerItem key={c.name} index={i}>
              <div className="glass-flat flex h-full items-start gap-3 rounded-xl px-4 py-3">
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

      {/* ──────────────── evidence + integrations ──────────────── */}
      <Section id="proof" className="border-t border-line py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <Reveal>
            <Eyebrow>Why you can trust the label</Eyebrow>
            <h2 className="mt-3 text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[38px]">
              Proof, not promises.
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-body">
              A judge you are meant to correct has to show its work, or your
              label is a coin flip. Every run writes a reproducible record, and
              the judge writes prose over that evidence rather than in place of
              it. Where a run is blocked, deterministic checks made that call —
              never the model.
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
            {/* The inline <Mono> must live inside a single span: as a direct
                child of the flex row it becomes a flex item and gets pushed
                to the far edge, away from the sentence it belongs to. */}
            <p className="mt-6 flex items-start gap-2 text-[12px] leading-relaxed text-faint">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Bring your own key, scrubbed at the edge, and nothing uploads
                until you run{" "}
                <Mono className="text-body">proofjury connect</Mono>.
              </span>
            </p>
          </Reveal>

          <Reveal delay={1}>
            <div className="glass glass-edge overflow-hidden rounded-2xl">
              <div className="border-b border-line px-5 py-4">
                <p className="text-[13.5px] font-medium text-ink">Integrations</p>
                <p className="mt-1 text-[12px] leading-relaxed text-faint">
                  Exactly one of these can fail a run, and it does so from a
                  recorded exit code — never from model output. The rest are
                  evidence, context, or transport.
                </p>
              </div>
              <div>
                {SPONSOR_LIST.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-start gap-3 border-t border-line px-5 py-3.5 first:border-t-0"
                  >
                    <SponsorMark sponsor={s} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-medium text-ink">
                          {s.name}
                        </span>
                        <span className="text-[12px] text-faint">{s.role}</span>
                        <AuthorityBadge sponsor={s} />
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-faint">
                        {s.note}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* The authored policy the judge is allowed to cite. Real
                published documents, not fixtures — a citation carries a
                [source: doc] tag into the finding so advice is traceable to
                something a human wrote. */}
            <div className="glass glass-edge mt-4 overflow-hidden rounded-2xl">
              <div className="border-b border-line px-5 py-4">
                <p className="text-[13.5px] font-medium text-ink">
                  Conventions it can cite
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-faint">
                  Policy your team authored. When the judge leans on one, the
                  finding carries the source — so you can argue with the
                  document rather than with the model.
                </p>
              </div>
              {SENSO_DOCS.map((d) => (
                <a
                  key={d.slug}
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3 border-t border-line px-5 py-3.5 transition-colors first:border-t-0 hover:bg-tint"
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-amber-ink" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                      <span className="truncate">{d.title}</span>
                      <ArrowUpRight className="size-3.5 shrink-0 text-faint transition-colors group-hover:text-amber-ink" />
                    </span>
                    <span className="mt-1 block text-[12px] leading-relaxed text-faint">
                      {d.summary}
                    </span>
                  </span>
                </a>
              ))}
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
              Stop repeating yourself to your agent.
            </h2>
            <p className="relative mx-auto mt-4 max-w-lg text-[14px] leading-relaxed text-body">
              Correct it once. The judge keeps the correction, and the next
              agent on the repo inherits it.
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
                proofjury connect
              </code>
            </div>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
