## Software Design

**Testing**

* Do not create unit tests unless explicitly asked.
* Verify changes directly in the product experience whenever possible.

**Object model**

* Use OOP for domain behavior: objects own their state and enforce their invariants.
* Depend on interfaces or abstract base classes at replaceable boundaries.
* Use abstract methods for reusable behavior with multiple implementations.
* Inject dependencies; do not construct concrete implementations inside consumers.
* Components must be replaceable without changing their consumers.
* Keep engine/framework-specific types behind adapters and abstractions.
* Prefer composition over inheritance. Inherit only for true is-a substitutability.
* Keep state private and expose behavior, not getter/setter pairs.
* Constructors leave objects fully usable.
* Use RAII and explicit ownership. No raw owning pointers.

**Reuse**

* Search for existing types or helpers before adding new ones.
* Extend or parameterize existing code instead of duplicating it.
* Extract shared behavior on the second real occurrence.
* Place reusable code in the lowest layer that needs it.
* Lower layers never depend upward.

**Boundaries**

* Keep domain logic free of UI, I/O, persistence, rendering, physics-engine, and framework-specific types.
* Major subsystems such as physics, rendering, sensors, agents, and input should be replaceable through stable abstractions when appropriate.
* Cross-module dependencies go through abstractions.
* Extend behavior by adding implementations, not branches or type switches.
* Keep feature changes localized.

**Restraint**

* Do not add abstractions for hypothetical reuse.
* One implementation usually does not need an interface unless replacement is an explicit design goal.
* Keep hierarchies shallow.
* No generic `Manager`, `Helper`, or `Utils` classes.
