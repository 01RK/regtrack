# Engineering principles

1. Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
2. Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
3. Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
4. Keep components modular and concerns clearly separated.
5. Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
6. Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
7. Make architectural decisions for the long term. Do not accept a stop gap that only works for now and is meant to be replaced later.
8. Proactively use Context7 MCP or @Context7 to consult existing development documentation, examples, reference implementations, and reusable partial implementations before building functionality from scratch.
9. Avoid defensive programming for impossible or internally controlled states. Validate at trust boundaries, but do not add redundant checks, fallbacks, guards, or error handling for conditions the system itself already guarantees. Do not add hashing, checksums, SHA-256 verification, or similar integrity machinery to low-stakes operations without a concrete failure mode that requires it.
