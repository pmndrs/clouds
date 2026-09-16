# Agent orchestration and cost controls

Prepared 2026-09-16. Applies to implementing the [phase plan](implementation-plan.md). These are proposed project operating rules for the authorized implementation, not an automation or a new set of user-owned tasks.

## Division of responsibility

**Orchestrator (this task):** maintain the source/render contracts and phase queue; select ready work; assign ownership; resolve architecture decisions; integrate changes; inspect GPU results; accept or return packets; communicate the few useful human decisions. Perform difficult cross-system work locally when splitting it would add more coordination than value.

**Implementation agents:** deliver one bounded result against an existing contract. Sources, small shader kernels, fixture generation, loaders, 2D rendering, benchmark tooling and later React wrappers are good candidates. A packet must have independent useful work while the orchestrator or another agent works elsewhere.

**Focused reviewer:** review a specific implementation seam or evidence set when risk warrants it, rather than automatically spending a second agent on every change. GPU ordering, conservative traversal, radiance/transmittance, temporal motion and shadow integration deserve this attention; simple docs and fixture metadata usually do not.

## Model routing

| Work | Initial routing | Escalation |
| --- | --- | --- |
| Docs, fixture metadata, simple validation or tests | `gpt-5.6-luna`, low/medium reasoning | Orchestrator clarifies the brief before increasing model capability |
| Bounded source/kernel, loader, layer, wrapper | `gpt-5.6-luna`, medium; high for math-sensitive packets | Narrow the failure; use `gpt-5.6-sol` or handle locally when integration reasoning is the obstacle |
| Shared GPU contracts, temporal/optical reasoning, integration acceptance | Current orchestrator | Optional focused independent review of a specific unresolved risk |

These model names are available in this session; Luna is described by the session as the fast/affordable coding option. Availability and prices should be checked when a later run starts. This is a proposed allocation, not a claim that the smallest model always gives the cheapest completed result. The [official model guidance](https://developers.openai.com/api/docs/guides/latest-model) also emphasizes completed-task efficiency when discussing stronger models. No dollar budget or percentage savings has been verified or promised.

Default to two implementation workers at once, using a third only for genuinely independent work or focused review. This session supports four active agents including the orchestrator. Do not occupy slots merely to appear parallel. No recursive delegation without an explicit packet instruction. Use child agents in this task, not sidebar tasks, for implementation subtasks.

## Narrow context, bounded iteration

- Start workers with a fresh, self-contained packet and selected file references rather than the full conversation history. Pass exact source revisions and relevant decisions.
- Give each packet one output and one acceptance contract. Split a packet that spans source generation, shadows and reconstruction into several dependency-linked pieces.
- Reuse the research notes instead of reopening every paper. Browse a specific unresolved API fact only when needed.
- Include an initial attempt plus one focused correction. If the same failure repeats or needs a shared contract change, return evidence to the orchestrator; do not spend many speculative retries. This is a review trigger, not a reason to abandon the feature.
- Return concise handoffs with artifact paths. Do not dump shader sources or full logs into the parent context when files already exist.
- Track model/effort, attempts, elapsed time and reported token usage when available. Never invent per-agent usage or infer dollar cost from account-wide usage percentages.
- Run focused checks per packet. Re-run cross-package/GPU checks after integration or a change that can affect them; avoid blanket test runs after every small edit.

## Ownership and integration

The orchestrator owns root configuration, dependency installation/lockfiles, public exports, shared contract versions, the work queue and central fixture index. It may explicitly assign a one-time edit to one worker; other workers must not edit these files concurrently.

Assign disjoint paths for ordinary packets. In the current shared workspace, changes are immediately visible to everyone, so a worker must not mistake another worker's unfinished files for an accepted dependency. Integrate dependent work only after the producer's checkpoint is accepted. Do not run destructive resets or broad formatters across other ownership paths.

For high-conflict experiments, use isolated worktrees after repository setup; return a commit/diff and integrate serially. Do not make worktrees mandatory for independent small packets. Until Git exists, use disjoint workspace paths or isolated scratch directories with explicit patch handoff. One owner handles each experiment's shared shader/pass file. Agents request contract changes in their handoff rather than edit every consumer.

Review a returned diff before accepting it. Passing unit tests is not GPU acceptance. Run the relevant scene, inspect captures and confirm that the intended device/backend ran. Only the orchestrator marks a packet accepted and unlocks its dependents.

## Packet template

```text
ID / phase:
Outcome: one concrete result.
Inputs: accepted packet IDs, exact contract version, selected files/sources.
Model / reasoning:
Owned paths:
Shared files or APIs: read-only unless explicitly assigned.
Deliverables: implementation, fixture/demo, evidence paths.
Acceptance: observable behavior and checks; reference comparison if relevant.
Limits: scope exclusions, dependency policy, bounded attempts.
Stop-and-report conditions: incompatible interface, repeated failure, missing capability.
Handoff: status, changed paths, checks/results, limitations, next integration step.
```

Reports distinguish `ready-for-review`, `needs-decision` and `failed-check`. “Done” from a worker does not mean integrated or accepted. Include unrun tests, unavailable devices and assumptions explicitly. Report benchmark resolution and settings alongside timings.

## Escalation without unnecessary user interruptions

Workers escalate to the orchestrator for cross-boundary edits, uncertain math, repeated GPU validation failure, resource ownership conflicts, new dependencies, license ambiguity, budget misses or incompatible Three/R3F behavior. They provide the smallest reproducer and attempted fixes.

The orchestrator resolves routine technical choices. Ask the user only for meaningful art/API preferences, missing information that affects scope, access to the RTX 3060 test run, or an external action requiring their instruction. Continue useful independent work while optional feedback is pending. Never interpret elapsed time as acceptance.

## Shared execution record

Use [the work queue](implementation-work-queue.md) as the compact source of truth. Each accepted packet records its implementation revision, evidence paths and gate outcome. Store substantial logs/captures under `artifacts/<phase>/<run-id>/` during implementation; record settings and provenance alongside them. Generated artifacts are proposed future paths, not existing results.

At the end of a phase, summarize: visible result, technical gate, human feedback status, measured costs, remaining risks, and next ready packet. Carry this record across context compaction so agents do not restart research or redo accepted work.

## Human review bundle

Bring the user a runnable example or capture, two or three concrete alternatives where needed, the important measurements, and one concise decision. Ask about cloud appearance, transition quality, ghosting or API use—not whether routine tests should run. Keep `technical acceptance` separate from `human feedback received` in the queue. Pending art feedback should not block loaders or unrelated tests; a missing decision about a public API should block only its dependent API freeze.
