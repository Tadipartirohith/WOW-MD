# WOW-MD architecture

The design is written at three altitudes, one document each. Start at the one
that matches the question you have.

| | Document | Answers | Read it when |
| --- | --- | --- | --- |
| **HLD** | [HLD.md](HLD.md) | What the system is, who it serves, why it is built this way, what it deliberately will not do | You are new to the product, or deciding whether an approach fits |
| **SLD** | [SLD.md](SLD.md) | How the subsystems divide the work, what each owns, how they talk, and the end-to-end flows | You are changing behaviour that crosses a module boundary |
| **LLD** | [LLD.md](LLD.md) | Tables, indexes, the permission matrix, every route, the algorithms, configuration, operations | You are about to type something |

Each stands alone. Cite them by section — the numbering is stable.

---

## The one paragraph version

A matrimony and wedding-services marketplace built for how Indian agencies
actually work: the family walks into the office and hands over their details,
and the agent circulates the biodata looking for a match. Everything
downstream — the identity model, the permission system, the consent rules, the
choice of SMS over email — falls out of that one fact. A profile is not an
account, circulation is a first-class operation with the consent machinery it
demands, and the phone number rather than the email address is the identity.

| | | | |
|---|---|---|---|
| **8** roles | **51** permissions | **30** modules | **43** tables |
| **225** routes | **13** migrations | **755** checks | **40k** lines TS |

---

## Everything else

| Document | Covers |
| --- | --- |
| [RBAC-AND-ROLES.md](RBAC-AND-ROLES.md) | The permission contract in full — every role, every capability, the guard order, and the defects this replaced |
| [PROFILES-AND-INVITATIONS.md](PROFILES-AND-INVITATIONS.md) | The profile/account split, stewardship, the invitation and claim flow |
| [CIRCULATION.md](CIRCULATION.md) | Phone-first intake, the two consent scopes, the five circulation paths |
| [PHASE-1-OPERATIONS.md](PHASE-1-OPERATIONS.md) | Field verification, support cases and frozen escrow, Match Fixed and provisioning, agency fees, quotations, escrow milestones, identity, chat redaction, the profile lifecycle |
| [ISSUE-REGISTER.md](ISSUE-REGISTER.md) | The 115-page specification, item by item, with what is deferred and why |
| [NEW-ISSUE-REGISTER.md](NEW-ISSUE-REGISTER.md) | The 74-page follow-up, item by item — including the two places it reverses the first, and the one place the implementation diverges from it |
| [SELF-REVIEW.md](SELF-REVIEW.md) | Six rounds of work, every defect found, and what is deliberately still open |
| [SETUP-GUIDE.md](SETUP-GUIDE.md) | Getting it running, with and without Docker |
| [DOCKER-AND-TESTING.md](DOCKER-AND-TESTING.md) | Container and test-stack detail, and how to run all six verification suites |
| [DESIGN-BLUEPRINT.md](DESIGN-BLUEPRINT.md) | The original product blueprint |
