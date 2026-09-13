# Lean Modular Source Refactor Design

## Goal

Refactor every `src/` subsystem into lean, behavior-preserving modules with explicit ownership, reusable components, and replaceable boundaries only where a concrete variation exists. Remove code and tests only when they have no remaining supported production responsibility.

## Scope and Compatibility

The refactor covers Scene Studio, Scenario Studio, Asset Viewer, engine services, HUD/world features, editor state, scene/environment compilation, and WFC generation. Existing browser routes, server and CLI contracts, saved scene/environment formats, seeds, and visible editor behavior remain compatible.

The refactor does not add product capabilities, alter generated layouts for an unchanged seed and pack, or replace Three.js. It does not add unit tests; existing tests are retained as regression evidence unless the corresponding obsolete production behavior is deleted.

## Architecture

Each executable has a narrow composition root that constructs concrete browser, Three.js, HTTP, file-system, and worker adapters. It injects these into application controllers and domain objects. Composition roots own lifecycle and dispose all owned resources.

Domain modules own their state and invariants and do not import DOM, Three.js, Node filesystem, HTTP, or worker types. Rendering, storage, catalog access, input, and worker execution are concrete adapters behind small ports only where replacement is real and useful. Shared modules flow downward only; UI and adapters do not define domain rules.

Classes are used for stateful behavior and resource ownership. Stateless transformations remain focused functions. No catch-all managers, helpers, utilities, or interface hierarchies with one speculative implementation are introduced.

```text
Composition roots
├─ Scene Studio
├─ Scenario Studio
└─ Asset Viewer
        │ inject concrete adapters
        ▼
Application controllers / sessions
        ▼
Domain objects and policies
        ▲
Ports at real external boundaries
        ▲
Three.js · DOM · HTTP · filesystem · worker adapters
```

## Application and Rendering Boundaries

Scene Studio and Scenario Studio retain separate composition roots because they have different application responsibilities. Shared engine and HUD primitives remain reusable rendering infrastructure, with explicit `dispose` ownership where they allocate interaction registrations, renderer resources, event listeners, or animation loops.

Controllers coordinate input, state changes, and presenters without constructing their dependencies. Render-facing features translate domain/application state into Three.js objects; they do not make persistence, catalog, generation-policy, or scene-editing decisions. Browser-specific input and DOM access stay in adapter/entry modules.

## Scene and Environment Boundaries

Scene documents, validation, transforms, scene recipes, manifests, and planning remain engine-independent value/domain modules. Environment import/export, GLB traversal, filesystem access, and Node GLTF shims become edge adapters that translate external data into these models. Serialization and validation preserve existing data formats and diagnostics unless a behavior is demonstrably incorrect.

## WFC Architecture

WFC is an asset-pack-agnostic domain subsystem. The solver receives a normalized palette, a deterministic request, and explicit serializable policies; it returns progress, a solution, or diagnostics. It has no dependency on a catalog category, asset ID, Three.js, DOM, browser worker, scene object, or a particular road pack.

Pack metadata defines tile dimensions, rotations, sockets, weights, semantic roles, and optional capabilities. A metadata validator normalizes the pack and reports actionable diagnostics. A profile/policy resolver selects only policies supported by declared metadata. Plain tiling works from basic socket metadata; road, water, terrain, elevation, boundary, and scenic constraints are optional capabilities rather than hard-coded pack assumptions. A correctly described new asset pack requires no source change to solve under an existing profile.

World planning and scenic policy construction are separate deterministic domain responsibilities. They emit constraints for the solver and never perform worker transport or scene-object creation. The generation application service composes a palette builder, optional plan/policy provider, solver port, result validator, and solved-cell mapper.

```text
Pack metadata → validator/normalizer → palette + declared capabilities
                                             │
World/scenic policy providers ───────────────┤
                                             ▼
                                     deterministic WFC solver
                                             ▼
                              solution/progress/failure diagnostics
                                             ▼
                                application scene-object mapper
                                             ▲
                    worker solver adapter / in-process solver adapter
```

The compact palette is an internal performance representation behind the solver transport codec, not a second public palette model. Worker messages are validated, typed transport data. Browser-worker and in-process implementations satisfy the same solver port, preserving cancellation, progress, fallback, seed behavior, and result ordering.

## Deletion and Reuse Rules

Before adding a type, module, or component, existing code is searched and extended if it already owns the responsibility. Repetition is extracted only after a second real consumer. Public exports are limited to actual callers; local implementation details remain private.

Code can be deleted when repository call-path analysis and TypeScript imports show it has no supported runtime, CLI, server, or build consumer. Tests are deleted only with their now-deleted production responsibility, or when they duplicate a retained behavioral test without covering a distinct supported contract. Tests are never removed merely to make a refactor easier.

## Error Handling and Lifecycle

Domain constructors and behaviors reject invalid inputs at their boundary with existing-compatible diagnostics. Adapters convert external failures to application-visible errors without leaking framework types across boundaries. Workers, listeners, interaction registrations, render targets, objects, and loops have one explicit owner and one disposal path.

## Verification

Each increment is verified with TypeScript compilation and the relevant existing regression tests. Before final handoff, run the full test suite, production build, and direct browser smoke checks for `/scene_studio`, `/scenario_studio`, and the asset viewer. Confirm the WFC worker and in-process paths preserve current result contracts and diagnostics for existing packs, and validate a metadata-defined pack path without category-specific branching.
