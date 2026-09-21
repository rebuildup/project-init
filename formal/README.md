# Formal organization model

`Organization.tla` is a small tool-independent model of the project-init constitutional core.

## Purpose

The model exists to find counterexamples in organizational semantics before those semantics are encoded across Skills, delivery workflows, or provider-specific tooling.

It intentionally does not model GitHub, Linear, Worktrunk, Codex, Claude, Orca, CI vendors, or concrete commands.

## Modeled concepts

- task lifecycle
- execution attempt identity
- accepted result identity, including the artifact version it was produced for
- artifact / validation-evidence binding
- decision authorization
- exclusive mutable-resource ownership
- durable attempt/artifact checkpoint identity
- actor loss / recovery against that durable identity
- terminal progress

## Checked safety properties

- `IdentityIntegrity`
- `EvidenceIntegrity`
- `AuthorityIntegrity`
- `MutableOwnershipSafety`
- `OrganizationalContinuity`

## Checked liveness property

- `EventuallyTerminal`

The model uses weak fairness for current-result receipt, validation, and completion so a runnable task cannot remain running forever solely because enabled progress actions are ignored indefinitely.

`OrganizationalContinuity` is not a constant durability flag. It requires the durable checkpoint identity to match the current attempt and artifact while a task is running. `Start`, `Retry`, and `MutateArtifact` must advance that durable identity atomically with the work identity; actor loss leaves the durable checkpoint intact, and actor recovery is allowed only when that checkpoint is current. A future transition that changes current work without maintaining the checkpoint can therefore produce a TLC counterexample.

## Run

With a local TLA+ / TLC installation:

```bash
tlc formal/Organization.tla -config formal/Organization.cfg
```

Equivalent project-local wrappers may be added later if the repository adopts a reproducible TLA+ toolchain.

## Evidence boundary

A successful TLC run means no counterexample was found in the explored finite model under the specification/configuration.

It does **not** prove:

- every real implementation conforms to the model
- an external tool enforces the modeled property
- every possible unbounded state has been mathematically proven
- qualitative/product decisions are correct

Implementation conformance, integration tests, policy evals, and review remain separate evidence layers.

## Evolution

When a real organizational failure escapes the current model:

1. determine whether it violates an existing constitutional property
2. if yes, add the smallest transition/state needed to reproduce the failure
3. preserve the broken case as a regression model/eval where practical
4. add a new constitutional property only when the failure cannot be expressed by the existing kernel
