# A five-minute engineering walkthrough

## 1. Show the executable workflow

Open Studio and choose **Revenue field rename**. The default recipe gathers independent evidence in parallel. Expand **Inspect or edit the workflow**: the JSON, compiler and visible graph describe the same operations. Change the concurrency limit to one to demonstrate that execution scheduling is a real control, not a change to an animation.

Run the review. Open a completed graph node to inspect its exact output. Show the source revision, observation time and digest. The result requires human review because renaming a consumed field changes a contract; there is no migration executor behind the button.

## 2. Demonstrate a meaningful failure

Choose **Evidence-source outage** and run it. The lineage read fails and the run stays incomplete. No low-risk decision or empty successful report is substituted. Inspect attempts and failure state in the trace.

Select **Restore synthetic source**, then resume. The same run ID advances to a new generation. Completed, still-valid evidence is reused; failed or cancelled steps execute again. The read-call budget is cumulative, and the original failure events remain inspectable.

For the local runtime, show `.lineageguard/runs.sqlite` only in a private development environment. The automated interruption test kills its own child after a committed checkpoint, reopens SQLite and resumes after the old writer lease expires. Do not pretend the public browser preview has this durable server behavior.

## 3. Separate evidence readiness from risk

Run **Missing usage evidence**. An additive field can have low compatibility risk while the evidence is insufficient. Run **Numeric narrowing** to show why BIGINT → SMALLINT is blocked even though both are numeric. Try **Truncated lineage** or **Stale catalog observation** to show that missing coverage and stale information remain visible.

This is deterministic policy. It is not an LLM confidence score or an estimate of the probability of a production incident.

## 4. Compare and carry the evidence

Complete the rename scenario again, then open **Compare** and execute an additive alternative. The comparison explicitly says the requests differ. Keeping an existing field while adding another is a different plan, not an identical run with a more flattering score.

Open **Review package** and export the run JSON. It contains exact inputs, recipe, evidence, events and draft artifacts. The brief and SQL are review material. A local acknowledgement binds the exact run, generation and result evidence but never authorizes execution.

## 5. Rerun the evaluations

Open **Evaluations** and execute the suite. Inspect expected versus observed outcomes, including corrupted-history refusal and resumed identity. These are current executions against the same interpreter, not a prerecorded results table.

Finish in **Architecture** and follow the source, verification and threat-model links. Explain the two runtime modes and the read-only DataHub integration profile. Live-tenant compatibility, multi-user authorization and production migration safety are explicitly outside the release evidence.

## Interview framing

“I used a schema-change review problem to build a bounded orchestration system: a typed DAG compiler, a shared browser/Node interpreter, source-bound evidence, failure and cancellation semantics, and a local SQLite coordinator with revision and lease fencing. I can show the failure cases and the tests that caught them. AI assisted implementation, while the product decisions and execution boundaries remained explicit.”

Do not claim enterprise adoption, an autonomous LLM team, production tenant validation or authenticated approvals that the project does not implement.
