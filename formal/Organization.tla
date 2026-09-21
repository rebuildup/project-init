-------------------------- MODULE Organization --------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Actors, Resources, MaxAttempt, MaxArtifact

VARIABLES
    taskState,
    currentAttempt,
    acceptedResultAttempt,
    artifactVersion,
    evidenceVersion,
    decisionAuthorized,
    decisionCommitted,
    owners,
    durableState,
    actorAlive

vars ==
    << taskState,
       currentAttempt,
       acceptedResultAttempt,
       artifactVersion,
       evidenceVersion,
       decisionAuthorized,
       decisionCommitted,
       owners,
       durableState,
       actorAlive >>

TerminalStates == {"done", "failed", "waiting"}

TypeInvariant ==
    /\ taskState \in {"idle", "running", "waiting", "done", "failed"}
    /\ currentAttempt \in 0..MaxAttempt
    /\ acceptedResultAttempt \in 0..MaxAttempt
    /\ artifactVersion \in 1..MaxArtifact
    /\ evidenceVersion \in 0..MaxArtifact
    /\ decisionAuthorized \in BOOLEAN
    /\ decisionCommitted \in BOOLEAN
    /\ owners \in [Resources -> SUBSET Actors]
    /\ durableState \in BOOLEAN
    /\ actorAlive \in [Actors -> BOOLEAN]

Init ==
    /\ taskState = "idle"
    /\ currentAttempt = 0
    /\ acceptedResultAttempt = 0
    /\ artifactVersion = 1
    /\ evidenceVersion = 0
    /\ decisionAuthorized = FALSE
    /\ decisionCommitted = FALSE
    /\ owners = [r \in Resources |-> {}]
    /\ durableState = TRUE
    /\ actorAlive = [a \in Actors |-> TRUE]

Start ==
    /\ taskState = "idle"
    /\ currentAttempt = 0
    /\ taskState' = "running"
    /\ currentAttempt' = 1
    /\ UNCHANGED << acceptedResultAttempt,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableState,
                     actorAlive >>

Retry ==
    /\ taskState = "running"
    /\ currentAttempt < MaxAttempt
    /\ currentAttempt' = currentAttempt + 1
    /\ acceptedResultAttempt' = 0
    /\ UNCHANGED << taskState,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableState,
                     actorAlive >>

ReceiveResult(attempt) ==
    /\ taskState = "running"
    /\ attempt \in 1..MaxAttempt
    /\ acceptedResultAttempt' =
         IF attempt = currentAttempt
         THEN attempt
         ELSE acceptedResultAttempt
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableState,
                     actorAlive >>

MutateArtifact ==
    /\ taskState = "running"
    /\ artifactVersion < MaxArtifact
    /\ artifactVersion' = artifactVersion + 1
    /\ evidenceVersion' = 0
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableState,
                     actorAlive >>

Validate ==
    /\ taskState = "running"
    /\ evidenceVersion # artifactVersion
    /\ evidenceVersion' = artifactVersion
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     artifactVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableState,
                     actorAlive >>

AuthorizeDecision ==
    /\ ~decisionAuthorized
    /\ decisionAuthorized' = TRUE
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     artifactVersion,
                     evidenceVersion,
                     decisionCommitted,
                     owners,
                     durableState,
                     actorAlive >>

CommitDecision ==
    /\ decisionAuthorized
    /\ ~decisionCommitted
    /\ decisionCommitted' = TRUE
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     owners,
                     durableState,
                     actorAlive >>

Acquire(a, r) ==
    /\ a \in Actors
    /\ r \in Resources
    /\ actorAlive[a]
    /\ owners[r] = {}
    /\ owners' = [owners EXCEPT ![r] = {a}]
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     durableState,
                     actorAlive >>

Release(a, r) ==
    /\ a \in Actors
    /\ r \in Resources
    /\ owners[r] = {a}
    /\ owners' = [owners EXCEPT ![r] = {}]
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     durableState,
                     actorAlive >>

LoseActor(a) ==
    /\ a \in Actors
    /\ actorAlive[a]
    /\ actorAlive' = [actorAlive EXCEPT ![a] = FALSE]
    /\ owners' = [r \in Resources |->
         IF owners[r] = {a} THEN {} ELSE owners[r]]
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     durableState >>

RecoverActor(a) ==
    /\ a \in Actors
    /\ ~actorAlive[a]
    /\ durableState
    /\ actorAlive' = [actorAlive EXCEPT ![a] = TRUE]
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableState >>

Finish ==
    /\ taskState = "running"
    /\ evidenceVersion = artifactVersion
    /\ taskState' = "done"
    /\ UNCHANGED << currentAttempt,
                     acceptedResultAttempt,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableState,
                     actorAlive >>

Fail ==
    /\ taskState = "running"
    /\ taskState' = "failed"
    /\ UNCHANGED << currentAttempt,
                     acceptedResultAttempt,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableState,
                     actorAlive >>

Next ==
    \/ Start
    \/ Retry
    \/ \E attempt \in 1..MaxAttempt : ReceiveResult(attempt)
    \/ MutateArtifact
    \/ Validate
    \/ AuthorizeDecision
    \/ CommitDecision
    \/ \E a \in Actors, r \in Resources : Acquire(a, r)
    \/ \E a \in Actors, r \in Resources : Release(a, r)
    \/ \E a \in Actors : LoseActor(a)
    \/ \E a \in Actors : RecoverActor(a)
    \/ Finish
    \/ Fail

Spec ==
    Init /\ [][Next]_vars
    /\ WF_vars(Validate)
    /\ WF_vars(Finish)

IdentityIntegrity ==
    acceptedResultAttempt = 0 \/ acceptedResultAttempt = currentAttempt

EvidenceIntegrity ==
    evidenceVersion = 0 \/ evidenceVersion = artifactVersion

AuthorityIntegrity ==
    ~decisionCommitted \/ decisionAuthorized

MutableOwnershipSafety ==
    \A r \in Resources : Cardinality(owners[r]) <= 1

OrganizationalContinuity ==
    durableState

EventuallyTerminal ==
    taskState = "running" ~> taskState \in TerminalStates

=============================================================================
