-------------------------- MODULE Organization --------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Actors, Resources, MaxAttempt, MaxArtifact

VARIABLES
    taskState,
    currentAttempt,
    acceptedResultAttempt,
    acceptedResultArtifact,
    artifactVersion,
    evidenceVersion,
    decisionAuthorized,
    decisionCommitted,
    owners,
    durableAttempt,
    durableArtifactVersion,
    actorAlive

vars ==
    << taskState,
       currentAttempt,
       acceptedResultAttempt,
       acceptedResultArtifact,
       artifactVersion,
       evidenceVersion,
       decisionAuthorized,
       decisionCommitted,
       owners,
       durableAttempt,
       durableArtifactVersion,
       actorAlive >>

TerminalStates == {"done", "failed", "waiting"}

TypeInvariant ==
    /\ taskState \in {"idle", "running", "waiting", "done", "failed"}
    /\ currentAttempt \in 0..MaxAttempt
    /\ acceptedResultAttempt \in 0..MaxAttempt
    /\ acceptedResultArtifact \in 0..MaxArtifact
    /\ artifactVersion \in 1..MaxArtifact
    /\ evidenceVersion \in 0..MaxArtifact
    /\ decisionAuthorized \in BOOLEAN
    /\ decisionCommitted \in BOOLEAN
    /\ owners \in [Resources -> SUBSET Actors]
    /\ durableAttempt \in 0..MaxAttempt
    /\ durableArtifactVersion \in 1..MaxArtifact
    /\ actorAlive \in [Actors -> BOOLEAN]

Init ==
    /\ taskState = "idle"
    /\ currentAttempt = 0
    /\ acceptedResultAttempt = 0
    /\ acceptedResultArtifact = 0
    /\ artifactVersion = 1
    /\ evidenceVersion = 0
    /\ decisionAuthorized = FALSE
    /\ decisionCommitted = FALSE
    /\ owners = [r \in Resources |-> {}]
    /\ durableAttempt = 0
    /\ durableArtifactVersion = 1
    /\ actorAlive = [a \in Actors |-> TRUE]

Start ==
    /\ taskState = "idle"
    /\ currentAttempt = 0
    /\ taskState' = "running"
    /\ currentAttempt' = 1
    /\ durableAttempt' = 1
    /\ durableArtifactVersion' = artifactVersion
    /\ UNCHANGED << acceptedResultAttempt,
                     acceptedResultArtifact,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     actorAlive >>

Retry ==
    /\ taskState = "running"
    /\ currentAttempt < MaxAttempt
    /\ currentAttempt' = currentAttempt + 1
    /\ acceptedResultAttempt' = 0
    /\ acceptedResultArtifact' = 0
    /\ durableAttempt' = currentAttempt + 1
    /\ durableArtifactVersion' = artifactVersion
    /\ UNCHANGED << taskState,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     actorAlive >>

ReceiveResult(attempt) ==
    /\ taskState = "running"
    /\ attempt \in 1..MaxAttempt
    /\ IF attempt = currentAttempt
          THEN /\ acceptedResultAttempt' = attempt
               /\ acceptedResultArtifact' = artifactVersion
          ELSE /\ acceptedResultAttempt' = acceptedResultAttempt
               /\ acceptedResultArtifact' = acceptedResultArtifact
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableAttempt,
                     durableArtifactVersion,
                     actorAlive >>

ReceiveCurrentResult ==
    ReceiveResult(currentAttempt)

MutateArtifact ==
    /\ taskState = "running"
    /\ artifactVersion < MaxArtifact
    /\ artifactVersion' = artifactVersion + 1
    /\ evidenceVersion' = 0
    /\ acceptedResultAttempt' = 0
    /\ acceptedResultArtifact' = 0
    /\ durableAttempt' = currentAttempt
    /\ durableArtifactVersion' = artifactVersion + 1
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     actorAlive >>

Validate ==
    /\ taskState = "running"
    /\ evidenceVersion # artifactVersion
    /\ evidenceVersion' = artifactVersion
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     acceptedResultArtifact,
                     artifactVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableAttempt,
                     durableArtifactVersion,
                     actorAlive >>

AuthorizeDecision ==
    /\ ~decisionAuthorized
    /\ decisionAuthorized' = TRUE
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     acceptedResultArtifact,
                     artifactVersion,
                     evidenceVersion,
                     decisionCommitted,
                     owners,
                     durableAttempt,
                     durableArtifactVersion,
                     actorAlive >>

CommitDecision ==
    /\ decisionAuthorized
    /\ ~decisionCommitted
    /\ decisionCommitted' = TRUE
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     acceptedResultArtifact,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     owners,
                     durableAttempt,
                     durableArtifactVersion,
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
                     acceptedResultArtifact,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     durableAttempt,
                     durableArtifactVersion,
                     actorAlive >>

Release(a, r) ==
    /\ a \in Actors
    /\ r \in Resources
    /\ owners[r] = {a}
    /\ owners' = [owners EXCEPT ![r] = {}]
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     acceptedResultArtifact,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     durableAttempt,
                     durableArtifactVersion,
                     actorAlive >>

DurableCurrent ==
    /\ durableAttempt = currentAttempt
    /\ durableArtifactVersion = artifactVersion

LoseActor(a) ==
    /\ a \in Actors
    /\ actorAlive[a]
    /\ actorAlive' = [actorAlive EXCEPT ![a] = FALSE]
    /\ owners' = [r \in Resources |->
         IF owners[r] = {a} THEN {} ELSE owners[r]]
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     acceptedResultArtifact,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     durableAttempt,
                     durableArtifactVersion >>

RecoverActor(a) ==
    /\ a \in Actors
    /\ ~actorAlive[a]
    /\ DurableCurrent
    /\ actorAlive' = [actorAlive EXCEPT ![a] = TRUE]
    /\ UNCHANGED << taskState,
                     currentAttempt,
                     acceptedResultAttempt,
                     acceptedResultArtifact,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableAttempt,
                     durableArtifactVersion >>

Finish ==
    /\ taskState = "running"
    /\ acceptedResultAttempt = currentAttempt
    /\ acceptedResultArtifact = artifactVersion
    /\ evidenceVersion = artifactVersion
    /\ taskState' = "done"
    /\ UNCHANGED << currentAttempt,
                     acceptedResultAttempt,
                     acceptedResultArtifact,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableAttempt,
                     durableArtifactVersion,
                     actorAlive >>

Fail ==
    /\ taskState = "running"
    /\ taskState' = "failed"
    /\ UNCHANGED << currentAttempt,
                     acceptedResultAttempt,
                     acceptedResultArtifact,
                     artifactVersion,
                     evidenceVersion,
                     decisionAuthorized,
                     decisionCommitted,
                     owners,
                     durableAttempt,
                     durableArtifactVersion,
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
    /\ WF_vars(ReceiveCurrentResult)
    /\ WF_vars(Validate)
    /\ WF_vars(Finish)

IdentityIntegrity ==
    \/ /\ acceptedResultAttempt = 0
       /\ acceptedResultArtifact = 0
    \/ /\ acceptedResultAttempt = currentAttempt
       /\ acceptedResultArtifact = artifactVersion

EvidenceIntegrity ==
    evidenceVersion = 0 \/ evidenceVersion = artifactVersion

AuthorityIntegrity ==
    ~decisionCommitted \/ decisionAuthorized

MutableOwnershipSafety ==
    \A r \in Resources : Cardinality(owners[r]) <= 1

OrganizationalContinuity ==
    taskState # "running" \/ DurableCurrent

EventuallyTerminal ==
    taskState = "running" ~> taskState \in TerminalStates

=============================================================================
