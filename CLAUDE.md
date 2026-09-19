## Software Design

**Testing**

* Do not create unit tests unless explicitly asked.
* Verify changes directly in the product experience whenever possible.
* Verify behavior, not only the absence of exceptions or compiler errors.
* Turn reported symptoms into measurable invariants at subsystem boundaries, then inspect both sides of the boundary during verification.
* Exercise lifecycle transitions and asymmetric edge cases relevant to the change, such as rest, active input, input release, suspended state, and one-sided contact or load.
* When a rendered or derived representation follows authoritative state, measure their agreement with a stated tolerance in addition to visual inspection.
* Add temporary diagnostic instrumentation at component boundaries when ownership, timing, or coordinate conversion is unclear. Remove it after verification unless it provides lasting operational value.

**Object model**

* Use OOP for domain behavior: objects own their state and enforce their invariants.
* Model a logical entity as one aggregate when its behavior spans several engine objects, resources, or child components.
* The aggregate owns operations that must affect all of its parts, including commands, wake/reset, sampling, and disposal.
* Do not spread one entity's invariants across unrelated free functions. If several functions repeatedly receive and mutate the same state bundle, move that state and behavior into a cohesive object.
* Data-only records are for immutable messages and snapshots. Mutable domain state belongs to an object that controls its transitions.
* Depend on interfaces or abstract base classes at replaceable boundaries.
* Use abstract methods for reusable behavior with multiple implementations.
* Inject dependencies; do not construct concrete implementations inside consumers.
* Components must be replaceable without changing their consumers.
* Keep engine/framework-specific types behind adapters and abstractions.
* Prefer composition over inheritance. Inherit only for true is-a substitutability.
* Keep state private and expose behavior, not getter/setter pairs.
* Constructors leave objects fully usable.
* Use RAII and explicit ownership. No raw owning pointers.

**State authority**

* Keep one authoritative representation of mutable state. Other subsystems consume immutable snapshots or projections from that authority.
* Do not let two subsystems independently integrate, infer, or reconstruct the same state over time.
* A projection must come from the object that owns the source state. Consumers may interpolate a projection for presentation but must not create a second simulation.
* When a logical entity spans physics, rendering, input, or runtime components, define which object owns its state and which adapters publish or apply snapshots.
* Preserve authored rest transforms and other baseline data. Apply runtime changes relative to that baseline instead of assuming identity transforms or zero offsets.

**Data contracts**

* Values crossing a module boundary must state their meaning, coordinate frame, unit, sign convention, and scope when those are not obvious from the type.
* Prefer names such as `chassisLocalHubPositionMeters` or dedicated value types over ambiguous names such as `position`, `offset`, or `force`.
* Distinguish per-component values from aggregate totals in names and documentation, such as per-wheel force versus total vehicle force.
* Convert coordinate frames and units once at the owning boundary. Do not repeat equivalent conversions in producers and consumers.
* Keep serialized messages immutable and validate them at the boundary before applying them to owned state.

**Lifecycle**

* Lifecycle operations apply to the complete owned aggregate. Starting, waking, pausing, resetting, or disposing a parent must leave every owned child in the corresponding valid state.
* Constructors register all required resources or fail without publishing a partial object.
* Disposal removes owned resources, callbacks, registrations, and lookup entries. Make repeated disposal harmless.
* Commands that cross asynchronous steps carry explicit generation or ownership context. The receiver validates that context against the state it owns.

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
