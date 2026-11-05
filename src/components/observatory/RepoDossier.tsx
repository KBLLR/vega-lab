import type { ReactNode } from "react";
import { ExternalLink, FileText, Lock, MessageSquare, ShieldAlert } from "lucide-react";
import type { AttentionEntry } from "../../lib/attention";
import type { Repo, RepoInspection, SkillExtraction } from "../../types";
import {
  isAcceptedByHuman,
  presentActionItemStatus,
  presentActionRun,
  presentResearchStatus,
  presentWorkflowStage,
} from "../../lib/review-status";
import type { ProvenanceClass } from "../../lib/review-status";
import { buildDossierRisks, formatRelativeDays } from "../../lib/dossier";
import { candidateReceipts } from "../../lib/candidate-receipts";
import { getRepoAboutUrl } from "../../lib/repo-links";
import { ProvenanceTag, StatusChip } from "./StatusChip";

interface RepoDossierProps {
  entry: AttentionEntry;
  extraction: SkillExtraction | null;
  inspection: RepoInspection | null;
  now: number;
  actionsDisabledReason: string | null;
  onPrepareAction: (repo: Repo, prompt: string) => void;
  onOpenReadme: (repo: Repo) => void;
}

function Section({ title, provenance, children, id }: { title: string; provenance?: ProvenanceClass; children: ReactNode; id: string }) {
  return (
    <section className={`vx-panel${provenance ? ` vx-panel--${provenance}` : ""}`} aria-labelledby={id}>
      <header className="vx-panel__header">
        <h3 id={id} className="vx-section-label">{title}</h3>
        {provenance ? <ProvenanceTag kind={provenance} /> : null}
      </header>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  const missing = value === null || value === undefined || value === "";
  return (
    <div className="vx-fact">
      <dt>{label}</dt>
      <dd className={missing ? "is-missing" : undefined}>{missing ? "Not recorded" : value}</dd>
    </div>
  );
}

function stubRepo(nwo: string): Repo {
  const [author, name] = nwo.split("/");
  return {
    author, name, description: "", stars: 0, forks: 0, open_issues: 0, date: "", last_updated: "",
    languages: [], topics: [], url: `https://github.com/${nwo}`,
  };
}

export function RepoDossier({ entry, extraction, inspection, now, actionsDisabledReason, onPrepareAction, onOpenReadme }: RepoDossierProps) {
  const repo = entry.repo;
  const signal = entry.signal;
  const target = repo || stubRepo(entry.nwo);
  const step = entry.nextStep;
  const risks = buildDossierRisks({ repo, signal, inspection, blockedRun: entry.blockedRun });
  const candidates = candidateReceipts(entry.runs, entry.nwo);
  const ledger = entry.actionItems.map((item) => ({ item, presentation: presentActionItemStatus(item.status) }));
  const acceptedCount = ledger.filter((row) => isAcceptedByHuman(row.presentation)).length;
  const language = repo?.primary_language || repo?.language || repo?.languages?.[0]?.language;
  const updated = repo?.last_updated_at || repo?.last_updated;
  const stepBadge = step.requiresHuman ? "Human decision" : step.writesDraft ? "Writes an internal draft" : step.actionKind ? "Read-only" : null;
  const titleId = `vx-dossier-${entry.nwo.replace(/[^a-z0-9]/gi, "-")}`;

  return (
    <article className="vx-dossier" aria-labelledby={titleId}>
      <header className="vx-dossier__header">
        <div>
          <p className="vx-eyebrow">Repository dossier</p>
          <h2 id={titleId} className="vx-dossier__title">
            {target.name}
            {entry.visibility === "private" ? <span className="vx-private"><Lock size={14} aria-hidden="true" /> Private</span> : null}
          </h2>
          <p className="vx-mono">{entry.nwo}</p>
        </div>
        <div className="vx-dossier__header-actions">
          <StatusChip presentation={presentResearchStatus(entry.queueItem?.status)} />
          {actionsDisabledReason ? (
            <span className="vx-meta">Synthetic repository · no external link</span>
          ) : (
            <a className="vx-button vx-button--ghost" href={getRepoAboutUrl(target)} target="_blank" rel="noopener noreferrer">
              Open on GitHub <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
          {repo && !actionsDisabledReason ? (
            <button type="button" className="vx-button vx-button--ghost" onClick={() => onOpenReadme(repo)}>
              <FileText size={14} aria-hidden="true" /> README evidence
            </button>
          ) : null}
        </div>
      </header>

      <section className={`vx-next vx-next--${step.kind}`} aria-labelledby={`${titleId}-next`}>
        <div className="vx-next__body">
          <p className="vx-eyebrow" id={`${titleId}-next`}>Next step</p>
          <p className="vx-next__label">{step.label}</p>
          <p className="vx-next__detail">{step.detail}</p>
          {stepBadge ? <span className={`vx-next__badge${step.requiresHuman ? " is-human" : ""}`}>{stepBadge}</span> : null}
        </div>
        <div className="vx-next__actions">
          {step.prompt && !actionsDisabledReason ? (
            <button type="button" className="vx-button vx-button--primary" onClick={() => onPrepareAction(target, step.prompt as string)}>
              <MessageSquare size={14} aria-hidden="true" /> Prepare in orchestrator
            </button>
          ) : null}
          {step.prompt && actionsDisabledReason ? (
            <button type="button" className="vx-button vx-button--primary" disabled aria-describedby={`${titleId}-disabled`}>
              Prepare in orchestrator
            </button>
          ) : null}
          {step.prompt ? (
            <p className="vx-next__hint" id={`${titleId}-disabled`}>
              {actionsDisabledReason || "Opens the orchestrator with this typed action filled in. Nothing runs until you send it."}
            </p>
          ) : (
            <p className="vx-next__hint">
              {step.requiresHuman ? "Vega has no button for this. Record the decision through the review gate." : "Nothing to run right now."}
            </p>
          )}
        </div>
      </section>

      <div className="vx-dossier__grid">
        <Section id={`${titleId}-facts`} title="Source facts" provenance="source-fact">
          <p className="vx-body">{repo?.description || "No description recorded."}</p>
          <dl className="vx-facts">
            <Fact label="Source" value={entry.source === "owned" ? "Owned repository" : entry.source === "starred" ? "Starred repository" : "Research record only"} />
            <Fact label="Visibility" value={repo ? (repo.private ? "Private" : "Public") : null} />
            <Fact label="License" value={repo?.license && repo.license !== "None" ? repo.license : null} />
            <Fact label="Language" value={language} />
            <Fact label="Stars · forks" value={repo ? `${repo.stars.toLocaleString()} · ${repo.forks.toLocaleString()}` : null} />
            <Fact label="Open issues" value={repo ? repo.open_issues.toLocaleString() : null} />
            <Fact label="Last activity" value={updated ? `${formatRelativeDays(updated, now)} · ${updated.slice(0, 10)}` : null} />
            <Fact label={entry.source === "owned" ? "Created" : "Starred"} value={(entry.source === "owned" ? repo?.created_at : repo?.date)?.slice(0, 10)} />
            <Fact label="README" value={repo?.has_readme === false ? "Missing" : repo?.has_readme ? "Present" : null} />
          </dl>
          {repo?.topics?.length ? (
            <ul className="vx-tags" aria-label="Topics">
              {repo.topics.slice(0, 10).map((topic) => <li key={topic}>{topic}</li>)}
            </ul>
          ) : null}
        </Section>

        <Section id={`${titleId}-signals`} title="Derived signals" provenance="derived-heuristic">
          {signal ? (
            <>
              <div className="vx-score">
                <span className="vx-score__value">{signal.adoptionScore}</span>
                <span className="vx-score__unit">/100 heuristic fit</span>
                <span className="vx-score__bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, signal.adoptionScore))}%` }} /></span>
              </div>
              <dl className="vx-facts">
                <Fact label="Adoption kind" value={signal.adoptionKind} />
                <Fact label="Activity" value={signal.staleness} />
                <Fact label="Capabilities" value={signal.capabilities.join(", ")} />
                <Fact label="House skills" value={signal.houseSkills.join(", ")} />
              </dl>
              <ul className="vx-list">
                {signal.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </>
          ) : (
            <p className="vx-empty-inline">No derived signal for this repository.</p>
          )}
          <p className="vx-footnote">Deterministic score from stars, forks, license, README, recency and keyword matches (house-model). It ranks; it does not verify.</p>
        </Section>
      </div>

      <Section id={`${titleId}-drafts`} title="Capability candidate & drafts" provenance="generated-draft">
        {extraction ? (
          <div className="vx-candidate">
            <p className="vx-body">{extraction.summary}</p>
            <div className="vx-candidate__cols">
              <div>
                <h4 className="vx-mini-label">Draft rules</h4>
                <ul className="vx-list">{extraction.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
              </div>
              <div>
                <h4 className="vx-mini-label">Suggested flows</h4>
                <ul className="vx-list vx-list--mono">{extraction.flows.map((flow) => <li key={flow}>{flow}</li>)}</ul>
              </div>
            </div>
            <details className="vx-details">
              <summary>Mission brief drafts (Codex · Claude)</summary>
              <pre className="vx-pre">{extraction.codexBrief}</pre>
              <pre className="vx-pre">{extraction.claudeBrief}</pre>
            </details>
          </div>
        ) : (
          <p className="vx-empty-inline">No skill extraction draft recorded for this repository.</p>
        )}

        <h4 className="vx-mini-label">Candidate evidence from durable receipts</h4>
        {candidates.length ? candidates.map((candidate) => (
          <details className="vx-details" key={`${candidate.id}:${candidate.checksum}`}>
            <summary>{candidate.name} · pending independent review</summary>
            <p className="vx-body-sm">{candidate.description}</p>
            <dl className="vx-facts">
              <Fact label="Candidate" value={candidate.id} />
              <Fact label="Checksum" value={candidate.checksum} />
              <Fact label="Source snapshot" value={candidate.snapshot} />
              <Fact label="Source ref" value={candidate.sourceRef} />
              <Fact label="Validation" value={candidate.validation} />
              <Fact label="Receipt" value={candidate.runId} />
            </dl>
            <p className="vx-body-sm">{candidate.evidence}</p>
            {candidate.provenance.length ? <ul className="vx-list vx-list--mono">{candidate.provenance.map((ref) => <li key={ref}>{ref}</li>)}</ul> : null}
            <p className="vx-footnote">This receipt is a machine-produced draft. It does not establish human approval.</p>
          </details>
        )) : <p className="vx-empty-inline">No candidate evidence is available in the loaded receipts.</p>}

        <h4 className="vx-mini-label">Draft actions</h4>
        {ledger.length === 0 ? (
          <p className="vx-empty-inline">No draft actions for this repository.</p>
        ) : (
          <ul className="vx-actions">
            {ledger.map(({ item, presentation }) => (
              <li key={item.id} className={`vx-action vx-action--${presentation.status}`}>
                <div className="vx-action__head">
                  <StatusChip presentation={presentation} compact />
                  <span className="vx-meta">{item.kind} · {item.priority} · {item.source}</span>
                </div>
                <p className="vx-action__title">{item.title}</p>
                <p className="vx-body-sm">{item.summary}</p>
                {item.evidence.length > 0 ? (
                  <details className="vx-details">
                    <summary>Evidence ({item.evidence.length})</summary>
                    <ul className="vx-list vx-list--mono">{item.evidence.map((line) => <li key={line}>{line}</li>)}</ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="vx-dossier__grid">
        <Section id={`${titleId}-risks`} title="Risks & unknowns">
          <ul className="vx-risks">
            {risks.map((risk) => (
              <li key={risk.text} className={`vx-risk vx-risk--${risk.severity}`}>
                {risk.severity === "info" ? null : <ShieldAlert size={14} aria-hidden="true" />}
                <span className="vx-risk__severity">{risk.severity}</span>
                <span>{risk.text}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id={`${titleId}-review`} title="Review ledger" provenance="human-decision">
          <dl className="vx-ledger">
            <div><dt>Drafts awaiting review</dt><dd>{ledger.filter((row) => row.presentation.status === "draft").length}</dd></div>
            <div><dt>In review</dt><dd>{ledger.filter((row) => row.presentation.status === "in-review").length}</dd></div>
            <div><dt>Accepted by a person</dt><dd>{acceptedCount}</dd></div>
            <div><dt>Dismissed</dt><dd>{ledger.filter((row) => row.presentation.status === "dismissed").length}</dd></div>
          </dl>
          <p className="vx-footnote">
            {acceptedCount === 0
              ? "No accepted decision is recorded. Durable receipts below are drafts, not approvals."
              : "Accepted drafts still need a separate, explicit execution step. Vega does not execute them."}
          </p>
        </Section>
      </div>

      <Section id={`${titleId}-workflow`} title="Capability workflow">
        {[
          { key: "draft", title: "Vega draft steps · durable receipts, internal only", stages: entry.stages.filter((stage) => !stage.locked) },
          { key: "gates", title: "Human gates · outside Vega, no button here", stages: entry.stages.filter((stage) => stage.locked) },
        ].map((group) => (
          <div key={group.key} className={`vx-stage-group vx-stage-group--${group.key}`}>
            <h4 className="vx-mini-label">{group.title}</h4>
            <ol className="vx-stages" aria-label={group.title}>
              {group.stages.map((stage) => {
                const presentation = presentWorkflowStage(stage.state);
                return (
                  <li key={stage.id} className={`vx-stage vx-stage--${presentation.status}`}>
                    <span className="vx-stage__label">
                      {stage.locked ? <Lock size={12} aria-hidden="true" /> : null} {stage.label}
                    </span>
                    <StatusChip presentation={presentation} compact />
                    <span className="vx-stage__desc">{stage.description}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
        <h4 className="vx-mini-label">Durable receipts</h4>
        {entry.runs.length === 0 ? (
          <p className="vx-empty-inline">No action receipts for this repository{actionsDisabledReason ? "" : " (or the local action bridge is offline)"}.</p>
        ) : (
          <table className="vx-table">
            <caption className="vx-sr-only">Durable action receipts for {entry.nwo}</caption>
            <thead><tr><th scope="col">Run</th><th scope="col">Action</th><th scope="col">Status</th><th scope="col">Completed</th><th scope="col">Artifact</th></tr></thead>
            <tbody>
              {entry.runs.map((run) => (
                <tr key={run.run_id}>
                  <td className="vx-mono">{run.run_id}</td>
                  <td className="vx-mono">{run.action_kind}</td>
                  <td><StatusChip presentation={presentActionRun(run)} compact /></td>
                  <td className="vx-mono">{run.completed_at.slice(0, 16).replace("T", " ")}</td>
                  <td className="vx-mono">{run.artifacts[0]?.path || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </article>
  );
}
