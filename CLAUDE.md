## Software Design

**Object model**
- Model the domain as objects that own their data and enforce their own invariants.
- Program against interfaces or abstract base classes, not concrete types. Inject dependencies instead of constructing them inside.
- Prefer composition over inheritance. Inherit only for real is-a substitutability (LSP); a shared field is not a reason to subclass.
- One responsibility per class (SRP). Split when the fields fall into disjoint clusters used by disjoint methods.
- Keep state private and expose behavior, not getter/setter pairs that leak internals (tell, don't ask).
- Constructors leave the object fully usable. No two-phase `init()`.
- Encapsulate resources with RAII and explicit ownership. No raw owning pointers, no ambiguous lifetimes.

**Reuse**
- Search for an existing type or helper before adding one. Extend or generalize it instead of duplicating.
- Factor shared behavior into a base class, a strategy/policy, or a free function. Extract on the second occurrence, not the first.
- Parameterize existing code rather than forking a near-identical variant.
- Place reusable code in the lowest layer that needs it. Lower layers never depend upward.

**Boundaries**
- Keep domain logic free of UI, I/O, persistence, rendering, and framework types.
- Expose the minimum public surface. Hide implementation behind pimpl, anonymous namespaces, or module-private scope.
- Cross-module dependencies go through abstractions so implementations can be swapped or mocked.
- Extend behavior by adding an implementation, not by adding a branch or type switch in shared code (OCP).
- Keep feature changes localized. A change that touches three modules is a design smell, not a big feature.

**Restraint**
- No abstraction for hypothetical reuse. One implementer means no interface yet.
- Hierarchies stay shallow. Past two or three levels, composition was the right answer.
- No `Manager`, `Helper`, or `Utils` classes that are just namespaces for unrelated functions.