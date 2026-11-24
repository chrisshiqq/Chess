// Shared evaluation configuration. This module has no board, UI, or worker
// dependencies so a native/WASM engine can use the same public settings.
export const VALUE_WEIGHTS = {
    material: 1,
    position: 1,
    threat: 1,
    safety: 1,
    mobility: 1
};

export const setValueWeights = (weights = {}) => {
    Object.assign(VALUE_WEIGHTS, weights);
};
