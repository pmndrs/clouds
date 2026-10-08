# @clouds/core

Renderer-independent cloud density descriptors and validation. World units are
metres, density is dimensionless, extinction is inverse metres, and matrices
follow right-handed, column-major conventions. No Three.js or React import.

`validateDensityDescriptor` checks bounds, dimensions, identity and encoding.
`densityPayloadBytes` validates before calculating payload size; loaders still
need their own resource limits. `homogeneousTransmittance` is the analytic optical
reference. This is an unpublished preview contract.
